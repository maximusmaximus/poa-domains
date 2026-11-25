import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { Engine } from "../dist/src/engine.js";
import { mainnetConfig } from "../dist/src/config.js";
import { DOMAIN, nativePrincipal, signBody } from "../dist/src/auth.js";
import { BootableSystemClock } from "../dist/src/seed.js";
import { rightsHash } from "../dist/src/model.js";
import { buildProfileWitness, extractLatestProfile, PROFILE_SCHEMA_V1 } from "../dist/src/profile.js";
import { provisionProtocolDomains } from "../dist/src/protocol-domains.js";
import { publicRegistryRoute, HIDDEN, AUDITED_REGISTRY } from "../dist/public-registry-view.mjs";
import { backupCommittedProfile } from "../dist/profiles-storage.mjs";
import { auditedEngine, get } from "./fixtures/audited-engine.mjs";

function mkKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { key: privateKey, addr: nativePrincipal(privateKey) };
}

function makeSignedPacket(engine, signerKey, signerAddr, action, params, { requestId, maxTotal = "0", time } = {}) {
  const now = time ?? Math.max(Math.floor(Date.now() / 1000), engine.snapshot().time);
  return signBody(
    {
      domain: DOMAIN,
      revision: engine.config.revision,
      chainId: engine.config.chainId,
      genesisHash: engine.config.genesisHash,
      registryId: engine.registryId,
      policyHash: engine.policyHash,
      normalizationHash: engine.config.normalizationHash,
      signer: signerAddr,
      coSigners: [],
      requestId: requestId ?? `req-${action}-${engine.nextNonce(signerAddr)}`,
      nonce: engine.nextNonce(signerAddr),
      notBefore: 0,
      deadline: now + 600,
      maxTotal,
      maxNetworkFee: "0",
      action,
      params,
    },
    [signerKey],
  );
}

test("issueReserved and provisionProtocolDomains: treasury claims escrow & treasury with v1 profiles, idempotently and safely", async () => {
  const issuer = mkKey();
  const treasury = mkKey();
  const escrowWallet = mkKey();
  const outsider = mkKey();

  const clock = new BootableSystemClock();
  const config = mainnetConfig(issuer.addr, treasury.addr, [outsider.addr]);
  const engine = new Engine(config, clock);
  const rootRights = rightsHash({ kind: "permanent" }, null);

  // Non-treasury cannot invoke issueReserved (rejected in admit without burning sequence).
  const seqBefore = engine.snapshot().sequence;
  const badCaller = makeSignedPacket(engine, outsider.key, outsider.addr, "issueReserved", {
    name: "escrow",
    expectedVersion: 0,
    expectedDeedId: null,
    metadata: buildProfileWitness({ name: "escrow", rightsHash: rootRights, poa: outsider.addr, description: "hijack" }),
  });
  assert.throws(() => engine.submit(badCaller), (e) => e.code === "RESERVED_NAME");
  assert.equal(engine.snapshot().sequence, seqBefore);

  // Treasury cannot use issueReserved on a non-reserved name or with non-zero maxTotal.
  const nonReserved = makeSignedPacket(engine, treasury.key, treasury.addr, "issueReserved", {
    name: "ordinaryword",
    expectedVersion: 0,
    expectedDeedId: null,
    metadata: buildProfileWitness({ name: "ordinaryword", rightsHash: rootRights, poa: treasury.addr, description: "nope" }),
  });
  const rNonRes = engine.submit(nonReserved);
  assert.equal(rNonRes.status, "rejected");
  assert.equal(rNonRes.code, "RESERVED_NAME");

  const nonZeroCap = makeSignedPacket(
    engine,
    treasury.key,
    treasury.addr,
    "issueReserved",
    {
      name: "escrow",
      expectedVersion: 0,
      expectedDeedId: null,
      metadata: buildProfileWitness({ name: "escrow", rightsHash: rootRights, poa: escrowWallet.addr, description: "cap" }),
    },
    { maxTotal: "100" },
  );
  const rCap = engine.submit(nonZeroCap);
  assert.equal(rCap.status, "rejected");
  assert.equal(rCap.code, "AMOUNT_CAP");

  // Provision official "treasury" and "escrow" protocol domains.
  const provisioned = provisionProtocolDomains(engine, clock, treasury.key, escrowWallet.addr);
  assert.deepEqual(provisioned.map((x) => x.name), ["treasury", "escrow"]);

  // Re-running provisioning is a 100% idempotent no-op.
  const seqAfterProvision = engine.snapshot().sequence;
  assert.deepEqual(provisionProtocolDomains(engine, clock, treasury.key, escrowWallet.addr), []);
  assert.equal(engine.snapshot().sequence, seqAfterProvision);

  // Verify permanent ownership & Profile v1 fields for both domains.
  const resTreasury = engine.resolve("treasury");
  const resEscrow = engine.resolve("escrow");
  assert.equal(resTreasury.deed.owner, treasury.addr);
  assert.equal(resEscrow.deed.owner, treasury.addr);
  assert.equal(resTreasury.deed.rights.kind, "permanent");
  assert.equal(resEscrow.deed.rights.kind, "permanent");

  const profTreasury = extractLatestProfile(resTreasury.deed);
  const profEscrow = extractLatestProfile(resEscrow.deed);
  assert.equal(profTreasury.isDefault, false);
  assert.equal(profEscrow.isDefault, false);
  assert.equal(profTreasury.profile.schema, PROFILE_SCHEMA_V1);
  assert.equal(profTreasury.profile.poa, treasury.addr);
  assert.match(profTreasury.profile.description, /Treasury wallet/i);
  assert.equal(profEscrow.profile.poa, escrowWallet.addr);
  assert.match(profEscrow.profile.description, /Escrow wallet/i);

  // Treasury can update management profile fields via setMetadata on owned reserved names.
  const updatedEscrowMeta = buildProfileWitness({
    name: "escrow",
    rightsHash: resEscrow.deed.rightsHash,
    poa: escrowWallet.addr,
    description: "Updated PoA Domains Escrow wallet description.",
  });
  const updatePacket = makeSignedPacket(engine, treasury.key, treasury.addr, "setMetadata", {
    name: "escrow",
    expectedDeedId: resEscrow.deed.id,
    expectedVersion: resEscrow.deed.version,
    metadata: updatedEscrowMeta,
  });
  const updateReceipt = engine.submit(updatePacket);
  assert.equal(updateReceipt.status, "succeeded");
  assert.equal(extractLatestProfile(engine.resolve("escrow").deed).profile.description, "Updated PoA Domains Escrow wallet description.");

  // Outsider cannot modify an owned reserved domain.
  const hijackMeta = makeSignedPacket(engine, outsider.key, outsider.addr, "setMetadata", {
    name: "escrow",
    expectedDeedId: resEscrow.deed.id,
    expectedVersion: engine.resolve("escrow").deed.version,
    metadata: buildProfileWitness({ name: "escrow", rightsHash: resEscrow.deed.rightsHash, poa: outsider.addr, description: "evil" }),
  });
  const rHijack = engine.submit(hijackMeta);
  assert.equal(rHijack.status, "rejected");
  assert.equal(rHijack.code, "NOT_OWNER");

  // Unclaimed reserved names still remain strictly reserved.
  const otherReserved = makeSignedPacket(engine, outsider.key, outsider.addr, "setMetadata", {
    name: "google",
    expectedDeedId: "0".repeat(64),
    expectedVersion: 1,
    metadata: buildProfileWitness({ name: "google", rightsHash: rootRights, poa: outsider.addr, description: "nope" }),
  });
  const rOtherRes = engine.submit(otherReserved);
  assert.equal(rOtherRes.status, "rejected");
  assert.equal(rOtherRes.code, "RESERVED_NAME");

  // backupCommittedProfile backs up issueReserved v1 profiles to R2.
  const puts = new Map();
  const r2 = {
    async put(key, value, opts) {
      puts.set(key, { bytes: new Uint8Array(value), opts });
    },
  };
  const backupRes = await backupCommittedProfile(
    { PROFILES: r2, BACKEND_HOST: "poadomains.grok.me" },
    provisioned[1].packet,
    provisioned[1].receipt,
  );
  assert.equal(backupRes.backedUp, true);
  assert.ok(puts.has(`v1/profiles/by-cid/${backupRes.cid}.json`));
  assert.ok(puts.has("v1/profiles/by-name/escrow/latest.json"));
});

test("publicRegistryRoute exposes owned protocol domains (escrow, treasury) while keeping legacy seed balances & hidden records withheld", () => {
  const e = auditedEngine();
  assert.equal(e.registryId, AUDITED_REGISTRY);
  const treasuryAddr = e.config.treasury;
  const escrowAddr = "poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf";
  const rootRights = rightsHash({ kind: "permanent" }, null);

  // Inject provisioned "escrow" and "treasury" deeds + receipts into the audited public-view engine.
  const addDeed = (name, poa, desc, seq) => {
    const id = (seq === 20 ? "d" : "e").repeat(64);
    const meta = buildProfileWitness({ name, rightsHash: rootRights, poa, description: desc });
    e.state.names[name] = { name, key: (seq === 20 ? "a" : "b").repeat(64), generation: 1, activeId: id, auctionId: null };
    e.state.deeds[id] = {
      id,
      name,
      generation: 1,
      owner: treasuryAddr,
      ownerVersion: 1,
      version: 1,
      parentId: null,
      rights: { kind: "permanent" },
      rightsHash: rootRights,
      expiry: null,
      renewals: 0,
      retired: false,
      metadata: [meta],
      records: [],
      recordsVersion: 0,
      lock: null,
      encumbranceVersion: 0,
    };
    const rid = (seq === 20 ? "1" : "2").repeat(64);
    e.state.receipts[rid] = {
      intentId: rid,
      requestId: `protocol-domain-${name}-v1`,
      signer: treasuryAddr,
      sequence: seq,
      time: 1795573000 + seq,
      status: "succeeded",
      code: "OK",
      result: { deedId: id, name, owner: treasuryAddr },
    };
    e.state.requests[`${treasuryAddr}:protocol-domain-${name}-v1`] = rid;
  };
  addDeed("treasury", treasuryAddr, "Official PoA Domains Treasury wallet.", 20);
  addDeed("escrow", escrowAddr, "Official PoA Domains Escrow wallet.", 21);
  e.state.nonces[treasuryAddr] = 2;
  e.state.sequence = 21;

  const stateRes = get(e, "/v1/state");
  assert.equal(stateRes.status, 200);
  const st = stateRes.data.state;
  assert.deepEqual(Object.keys(st.names).sort(), ["escrow", "treasury"]);
  assert.equal(Object.keys(st.deeds).length, 2);
  assert.equal(Object.keys(st.receipts).length, 2);
  assert.equal(st.nonces[treasuryAddr], 2);
  // Legacy seed balances and ALL hidden seed accounts/names remain strictly withheld.
  assert.deepEqual(st.balances, {});
  assert.deepEqual(st.auctions, {});
  assert.deepEqual(st.offers, {});
  for (const hiddenName of HIDDEN.names) assert.equal(st.names[hiddenName], undefined);

  // /v1/resolve and /v1/nonce work for escrow, treasury, and treasury signer.
  const rEsc = get(e, "/v1/resolve", { name: "escrow" });
  assert.equal(rEsc.status, 200);
  assert.equal(rEsc.data.deed.owner, treasuryAddr);
  assert.equal(extractLatestProfile(rEsc.data.deed).profile.poa, escrowAddr);

  const rTreas = get(e, "/v1/resolve", { name: "treasury" });
  assert.equal(rTreas.status, 200);
  assert.equal(rTreas.data.deed.owner, treasuryAddr);
  assert.equal(extractLatestProfile(rTreas.data.deed).profile.poa, treasuryAddr);

  const rNonce = get(e, "/v1/nonce", { signer: treasuryAddr });
  assert.equal(rNonce.status, 200);
  assert.equal(rNonce.data.nonce, 2);

  // Non-treasury hidden accounts & hidden names remain strictly 409 PUBLIC_RECORD_WITHHELD.
  assert.equal(get(e, "/v1/nonce", { signer: HIDDEN.accounts[0] }).status, 409);
  assert.equal(get(e, "/v1/resolve", { name: "nexus" }).status, 409);
  const hiddenSubmit = publicRegistryRoute(
    e,
    { method: "POST", path: "/v1/intents", query: {}, packet: JSON.stringify({ body: { signer: HIDDEN.accounts[0], params: { name: "nexus" } } }) },
    {},
  );
  assert.equal(hiddenSubmit.status, 409);
});
