import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Engine, LEGACY_LEASE_POLICY } from "../dist/src/engine.js";
import { buildProfileWitness, extractLatestProfile } from "../dist/src/profile.js";
import { quote } from "../dist/src/registry-reads.js";
import { McpCore } from "../dist/src/mcp-core.js";
import { registryMcpProfile } from "../dist/src/mcp-registry.js";
import { registryRoute } from "../dist/src/registry-routes.js";
import { errorReply } from "../dist/src/errors.js";
import { nativeAddress } from "../dist/src/native-crypto.js";
import { setup, witness as makeWitness } from "../dist/test/helpers.js";
import { publicRegistryRoute, HIDDEN } from "../dist/public-registry-view.mjs";
import { auditedEngine } from "./fixtures/audited-engine.mjs";
import {
  buildSetPrimaryPrompt,
  buildTransferDomainPrompt,
  primaryNameForOwner,
  resolveOwnerInput,
  resolveTransferRecipient,
} from "../reference-web/shared.js";

function mintRoot(t, name, winner, reserve = "100") {
  const ann = t.e.submit(
    t.packet(
      "announceAuction",
      {
        name,
        asset: "POA",
        reserve,
        openAt: t.clock.now() + 86400,
        expectedDeedId: null,
        expectedVersion: 0,
        metadata: makeWitness(name),
      },
      t.issuer,
    ),
  );
  assert.equal(ann.status, "succeeded", ann.code);
  const aucId = ann.result.auctionId;
  const auc = t.e.snapshot().auctions[aucId];
  t.clock.set(auc.openAt);
  const bid = t.e.submit(
    t.packet(
      "bid",
      {
        auctionId: aucId,
        expectedVersion: auc.version,
        asset: "POA",
        amount: reserve,
        beneficiary: winner.id,
      },
      winner,
    ),
  );
  assert.equal(bid.status, "succeeded", bid.code);
  const aucAfter = t.e.snapshot().auctions[aucId];
  t.clock.set(t.e.closeEligible(aucAfter));
  const fin = t.e.submit(
    t.packet("finalize", { auctionId: aucId, expectedVersion: aucAfter.version }, winner),
  );
  assert.equal(fin.status, "succeeded", fin.code);
  return t.e.snapshot().deeds[t.e.snapshot().names[name].activeId];
}

test("Engine setPrimaryName sets, switches, clears, validates ownership/versions, and clears atomically on transfer/sale/revoke", () => {
  const t = setup();
  const moon = mintRoot(t, "moon", t.alice);
  const star = mintRoot(t, "star", t.alice);

  // Initially omitted from state so historical snapshots remain unchanged
  assert.equal(t.e.snapshot().primaryNames, undefined);

  // Non-owner cannot bind someone else's domain as their primary name
  const badOwner = t.e.submit(
    t.packet(
      "setPrimaryName",
      { name: "moon", expectedDeedId: moon.id, expectedVersion: moon.version },
      t.bob,
    ),
  );
  assert.equal(badOwner.status, "rejected");
  assert.equal(badOwner.code, "NOT_OWNER");

  // Stale version fails closed
  const badVer = t.e.submit(
    t.packet(
      "setPrimaryName",
      { name: "moon", expectedDeedId: moon.id, expectedVersion: moon.version + 5 },
      t.alice,
    ),
  );
  assert.equal(badVer.status, "rejected");
  assert.equal(badVer.code, "STALE_VERSION");

  // Invalid partial clear params rejected
  const badClear = t.e.submit(
    t.packet(
      "setPrimaryName",
      { name: null, expectedDeedId: moon.id, expectedVersion: 0 },
      t.alice,
    ),
  );
  assert.equal(badClear.status, "rejected");
  assert.equal(badClear.code, "STALE_VERSION");

  // Quote works for setPrimaryName
  const q = quote(t.e, { name: "moon", action: "setPrimaryName", signer: t.alice.id });
  assert.equal(q.requiredMaxTotal, "0");
  assert.deepEqual(q.params, {
    name: "moon",
    expectedDeedId: moon.id,
    expectedVersion: moon.version,
  });

  // Owner binds "moon" as default domain address
  const set1 = t.e.submit(
    t.packet(
      "setPrimaryName",
      { name: "moon", expectedDeedId: moon.id, expectedVersion: moon.version },
      t.alice,
    ),
  );
  assert.equal(set1.status, "succeeded");
  assert.equal(set1.result.primaryName, "moon");
  assert.equal(t.e.snapshot().primaryNames?.[t.alice.id], "moon");

  // Switch primary to "star"
  const set2 = t.e.submit(
    t.packet(
      "setPrimaryName",
      { name: "star", expectedDeedId: star.id, expectedVersion: star.version },
      t.alice,
    ),
  );
  assert.equal(set2.status, "succeeded");
  assert.equal(t.e.snapshot().primaryNames?.[t.alice.id], "star");

  // Clear primary name -> primaryNames map removed when empty
  const clr = t.e.submit(
    t.packet(
      "setPrimaryName",
      { name: null, expectedDeedId: null, expectedVersion: 0 },
      t.alice,
    ),
  );
  assert.equal(clr.status, "succeeded");
  assert.equal(clr.result.primaryName, null);
  assert.equal(t.e.snapshot().primaryNames, undefined);

  // Re-bind "moon", attach records & profile metadata, then transfer to Bob:
  // fields reset AND alice's primaryNames entry clears automatically!
  const poaA = nativeAddress(randomBytes(32));
  const moonProf = buildProfileWitness({
    name: "moon",
    rightsHash: moon.rightsHash,
    poa: poaA,
    description: "Alice moon bio",
  });
  assert.equal(
    t.e.submit(
      t.packet(
        "setMetadata",
        { name: "moon", expectedDeedId: moon.id, expectedVersion: moon.version, metadata: moonProf },
        t.alice,
      ),
    ).status,
    "succeeded",
  );
  let moonNow = t.e.snapshot().deeds[moon.id];
  assert.equal(
    t.e.submit(
      t.packet(
        "setRecords",
        {
          name: "moon",
          expectedDeedId: moonNow.id,
          expectedVersion: moonNow.version,
          records: [{ type: "wallet", chain: "poa", address: poaA }],
        },
        t.alice,
      ),
    ).status,
    "succeeded",
  );
  moonNow = t.e.snapshot().deeds[moon.id];
  assert.equal(
    t.e.submit(
      t.packet(
        "setPrimaryName",
        { name: "moon", expectedDeedId: moonNow.id, expectedVersion: moonNow.version },
        t.alice,
      ),
    ).status,
    "succeeded",
  );
  assert.equal(t.e.snapshot().primaryNames?.[t.alice.id], "moon");

  const xfer = t.e.submit(
    t.packet(
      "transfer",
      { name: "moon", expectedDeedId: moonNow.id, expectedVersion: moonNow.version, recipient: t.bob.id },
      t.alice,
    ),
  );
  assert.equal(xfer.status, "succeeded");
  const moonAfter = t.e.snapshot().deeds[moon.id];
  assert.equal(moonAfter.owner, t.bob.id);
  assert.equal(t.e.snapshot().primaryNames, undefined);
  assert.deepEqual(moonAfter.records, []);
  assert.equal(extractLatestProfile(moonAfter).isDefault, true);
  assert.equal(moonAfter.previousFields?.length, 1);
  assert.equal(moonAfter.previousFields?.[0]?.records?.length, 1);

  // Subdomain primary name clears on revokeChild
  const starNow = t.e.snapshot().deeds[star.id];
  const offer = t.e.submit(
    t.packet(
      "createChildOffer",
      {
        parent: "star",
        parentDeedId: starNow.id,
        expectedOwnerVersion: starNow.ownerVersion,
        asset: "POA",
        price: "10",
        validUntil: t.clock.now() + 3600,
        rights: { kind: "permanent" },
        labels: ["sub"],
        maxUses: 1,
      },
      t.alice,
    ),
  );
  assert.equal(offer.status, "succeeded");
  const offerObj = t.e.snapshot().offers[offer.result.offerId];
  const fill = t.e.submit(
    t.packet(
      "fillChildOffer",
      {
        offerId: offerObj.id,
        expectedVersion: offerObj.version,
        expectedGeneration: 1,
        label: "sub",
        asset: "POA",
        amount: "10",
        metadata: makeWitness("sub.star", { kind: "permanent" }, starNow.id),
      },
      t.bob,
      { maxTotal: "10" },
    ),
  );
  assert.equal(fill.status, "succeeded", fill.code);
  const subDeed = t.e.snapshot().deeds[fill.result.deedId];
  assert.equal(
    t.e.submit(
      t.packet(
        "setPrimaryName",
        { name: "sub.star", expectedDeedId: subDeed.id, expectedVersion: subDeed.version },
        t.bob,
      ),
    ).status,
    "succeeded",
  );
  assert.equal(t.e.snapshot().primaryNames?.[t.bob.id], "sub.star");

  const rev = t.e.submit(
    t.packet(
      "revokeChild",
      {
        name: "sub.star",
        expectedDeedId: subDeed.id,
        expectedVersion: subDeed.version,
        parentOwnerVersion: starNow.ownerVersion,
      },
      t.bob,
      {},
      [t.alice],
    ),
  );
  assert.equal(rev.status, "succeeded", rev.code);
  assert.equal(t.e.snapshot().primaryNames, undefined);

  // Invariant check catches tampered primaryNames pointing to wrong owner
  const tampered = t.e.snapshot();
  tampered.primaryNames = { [t.bob.id]: "star" };
  assert.throws(() => t.e.assertInvariants(tampered), /INVARIANT_PRIMARY/);
});

test("MCP get_owner_profile resolves principal or domain and set_primary_name prompt is registered", async () => {
  const t = setup();
  const moon = mintRoot(t, "moon", t.alice);
  const star = mintRoot(t, "star", t.alice);
  const poaA = nativeAddress(randomBytes(32));
  const prof = buildProfileWitness({
    name: "moon",
    rightsHash: moon.rightsHash,
    poa: poaA,
    description: "Main domain profile",
  });
  assert.equal(
    t.e.submit(
      t.packet(
        "setMetadata",
        { name: "moon", expectedDeedId: moon.id, expectedVersion: moon.version, metadata: prof },
        t.alice,
      ),
    ).status,
    "succeeded",
  );
  const moonV2 = t.e.snapshot().deeds[moon.id];
  assert.equal(
    t.e.submit(
      t.packet(
        "setPrimaryName",
        { name: "moon", expectedDeedId: moonV2.id, expectedVersion: moonV2.version },
        t.alice,
      ),
    ).status,
    "succeeded",
  );

  const backend = async (method, path, query = {}, packet) => {
    try {
      const r = registryRoute(t.e, { method, path, query, packet: packet ? JSON.stringify(packet) : undefined, requestId: "primary-mcp-test" });
      const data = JSON.parse(r.jsonText);
      if (r.status >= 400) throw Object.assign(Error(data.code), { detail: data });
      return data;
    } catch (err) {
      if (err.detail) throw err;
      throw Object.assign(err, { detail: errorReply(400, { code: err.code }, "primary-mcp-test").body });
    }
  };
  const core = new McpCore(registryMcpProfile(backend));

  const init = await core.handle(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    }),
  );
  assert.equal(init.result.protocolVersion, "2025-11-25");
  await core.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));

  const byOwner = await core.handle(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_owner_profile", arguments: { owner: t.alice.id } },
    }),
  );
  const ownerData = byOwner.result.structuredContent;
  assert.equal(ownerData.owner, t.alice.id);
  assert.equal(ownerData.resolvedFromDomain, null);
  assert.equal(ownerData.primaryName, "moon");
  assert.equal(ownerData.primaryDeedId, moon.id);
  assert.equal(ownerData.primaryProfile.description, "Main domain profile");
  assert.deepEqual(ownerData.names, ["moon", "star"]);

  const byDomain = await core.handle(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_owner_profile", arguments: { owner: "star" } },
    }),
  );
  const domainData = byDomain.result.structuredContent;
  assert.equal(domainData.owner, t.alice.id);
  assert.equal(domainData.resolvedFromDomain, "star");
  assert.equal(domainData.primaryName, "moon");

  const promptRes = await core.handle(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "prompts/get",
      params: { name: "set_primary_name", arguments: { name: "moon" } },
    }),
  );
  assert.match(promptRes.result.messages[0].content.text, /setPrimaryName/);
  assert.match(promptRes.result.messages[0].content.text, /moon/);
});

test("Public registry view filters hidden primaryNames entries without mutating Engine state", () => {
  const e = auditedEngine();
  const publicAddr = "poa1" + "1".repeat(32);
  e.state.names.publicdomain = { name: "publicdomain", generation: 1, activeId: "d".repeat(64), auctionId: null, version: 1 };
  e.state.deeds["d".repeat(64)] = {
    id: "d".repeat(64), name: "publicdomain", parentId: null, generation: 1, owner: publicAddr,
    version: 1, ownerVersion: 1, rights: { kind: "permanent" }, rightsHash: "0".repeat(64),
    records: [], metadata: [],
  };
  e.state.primaryNames = {
    [HIDDEN.accounts[0]]: HIDDEN.names[0],
    [publicAddr]: "publicdomain",
  };
  const stateResp = publicRegistryRoute(e, { method: "GET", path: "/v1/state", query: {} });
  assert.equal(stateResp.status, 200);
  const parsed = JSON.parse(stateResp.jsonText);
  assert.deepEqual(parsed.state.primaryNames, {
    [publicAddr]: "publicdomain",
  });
});

test("UI default-domain & transfer-recipient helpers handle addresses, default domains, attached POA, paused listings, and prompts", () => {
  const ownerA = nativeAddress(randomBytes(32));
  const ownerB = nativeAddress(randomBytes(32));
  const ownerC = nativeAddress(randomBytes(32));
  const vaultPoa = nativeAddress(randomBytes(32));
  const recPoa = nativeAddress(randomBytes(32));
  const cap = { poaOnly: { status: "on" }, publicView: { unavailableNameKeys: [] } };
  const state = {
    time: 1000,
    primaryNames: {
      [ownerA]: "alpha",
      [ownerB]: "beta",
    },
    names: {
      alpha: { name: "alpha", activeId: "d1" },
      beta: { name: "beta", activeId: "d2" },
      vault: { name: "vault", activeId: "d3" },
      walletrec: { name: "walletrec", activeId: "d4" },
      bare: { name: "bare", activeId: "d5" },
      listed: { name: "listed", activeId: "d6" },
    },
    deeds: {
      d1: { id: "d1", name: "alpha", owner: ownerA, version: 3, ownerVersion: 1, retired: false, records: [], metadata: [] },
      d2: { id: "d2", name: "beta", owner: ownerB, version: 2, ownerVersion: 1, retired: false, records: [], metadata: [] },
      d3: {
        id: "d3",
        name: "vault",
        owner: ownerC,
        version: 4,
        ownerVersion: 1,
        retired: false,
        records: [],
        metadata: [
          {
            cid: "cid-v",
            document: { schema: "poa-domains.profile.v1", version: 1, name: "vault", rightsHash: "0".repeat(64), poa: vaultPoa, btc: null, eth: null, description: "Vault", image: null },
          },
        ],
      },
      d4: {
        id: "d4",
        name: "walletrec",
        owner: ownerC,
        version: 1,
        ownerVersion: 1,
        retired: false,
        records: [{ type: "wallet", chain: "POA", address: recPoa }],
        metadata: [],
      },
      d5: { id: "d5", name: "bare", owner: ownerC, version: 1, ownerVersion: 1, retired: false, records: [], metadata: [] },
      d6: {
        id: "d6",
        name: "listed",
        owner: ownerC,
        version: 1,
        ownerVersion: 1,
        retired: false,
        records: [],
        metadata: [
          {
            cid: "cid-l",
            document: { schema: "poa-domains.profile.v1", version: 1, name: "listed", rightsHash: "0".repeat(64), poa: vaultPoa, btc: null, eth: null, description: "Paused", image: null },
          },
        ],
      },
    },
  };
  const escrowMarket = [
    { id: "sale1", name: "listed", seller: ownerC, kind: "fixed", price: "50.000000", status: "OPEN", closes: 9999999999999 },
  ];

  // primaryNameForOwner
  assert.equal(primaryNameForOwner(state, ownerA), "alpha");
  assert.equal(primaryNameForOwner(state, ownerC), null);

  // resolveOwnerInput (principal & domain)
  assert.deepEqual(resolveOwnerInput(state, ownerA, cap), { owner: ownerA, viaDomain: null, isPrimary: false });
  assert.deepEqual(resolveOwnerInput(state, "ALPHA", cap), { owner: ownerA, viaDomain: "alpha", isPrimary: true });
  assert.deepEqual(resolveOwnerInput(state, "bare", cap), { owner: ownerC, viaDomain: "bare", isPrimary: false });
  assert.equal(resolveOwnerInput(state, "nonexistent", cap), null);

  // resolveTransferRecipient: direct POA address
  const direct = resolveTransferRecipient(state, ownerB, { currentOwner: ownerA, cap, escrowMarket });
  assert.equal(direct.ok, true);
  assert.equal(direct.recipient, ownerB);
  assert.equal(direct.source, "address");

  // Rejects self-transfer
  const self = resolveTransferRecipient(state, ownerA, { currentOwner: ownerA, cap, escrowMarket });
  assert.equal(self.ok, false);
  assert.match(self.error, /already owned/);

  // Rejects malformed poa1 string
  const badAddr = resolveTransferRecipient(state, "poa1notvalidaddr", { currentOwner: ownerA, cap, escrowMarket });
  assert.equal(badAddr.ok, false);

  // Default domain address resolves to its owner POA address even without profile metadata
  const defDom = resolveTransferRecipient(state, "beta", { currentOwner: ownerA, cap, escrowMarket });
  assert.equal(defDom.ok, true);
  assert.equal(defDom.recipient, ownerB);
  assert.equal(defDom.source, "default-domain");
  assert.equal(defDom.domainName, "beta");

  // Domain with attached profile POA resolves to profile.poa
  const profDom = resolveTransferRecipient(state, "vault", { currentOwner: ownerA, cap, escrowMarket });
  assert.equal(profDom.ok, true);
  assert.equal(profDom.recipient, vaultPoa);
  assert.equal(profDom.source, "domain-profile-poa");

  // Domain with attached POA wallet record resolves to record.address
  const recDom = resolveTransferRecipient(state, "walletrec", { currentOwner: ownerA, cap, escrowMarket });
  assert.equal(recDom.ok, true);
  assert.equal(recDom.recipient, recPoa);
  assert.equal(recDom.source, "domain-record-poa");

  // Domain with NO POA address attached (and not default) fails closed
  const bareDom = resolveTransferRecipient(state, "bare", { currentOwner: ownerA, cap, escrowMarket });
  assert.equal(bareDom.ok, false);
  assert.match(bareDom.error, /does not have a POA address attached/);

  // Listed domain (paused profile fields, not default) fails closed
  const listedDom = resolveTransferRecipient(state, "listed", { currentOwner: ownerA, cap, escrowMarket, nowMs: 1000 });
  assert.equal(listedDom.ok, false);
  assert.match(listedDom.error, /listed for sale/);

  // Prompt builders
  const setPrompt = buildSetPrimaryPrompt({ name: "alpha", deed: state.deeds.d1, signer: ownerA, endpointUrl: "https://poadomains.grok.me" });
  assert.match(setPrompt, /setPrimaryName/);
  assert.match(setPrompt, /"expectedDeedId": "d1"/);
  assert.match(setPrompt, /"expectedVersion": 3/);

  const clearPrompt = buildSetPrimaryPrompt({ name: null, signer: ownerA, endpointUrl: "https://poadomains.grok.me" });
  assert.match(clearPrompt, /"name": null/);
  assert.match(clearPrompt, /"expectedDeedId": null/);

  const xferPrompt = buildTransferDomainPrompt({
    name: "alpha",
    deed: state.deeds.d1,
    recipient: ownerB,
    resolvedFromDomain: "beta",
    resolutionSource: "default-domain",
    isPrimary: true,
    endpointUrl: "https://poadomains.grok.me",
  });
  assert.match(xferPrompt, /"recipient":/);
  assert.match(xferPrompt, /default domain address/);
  assert.match(xferPrompt, /resets all attached profile fields and records/);
  assert.match(xferPrompt, /clears "alpha" as my default\/main domain address/);
});
