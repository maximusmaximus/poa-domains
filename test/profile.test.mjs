import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  buildProfileWitness,
  canonicalProfileJson,
  cidForBytes,
  extractLatestProfile,
  MAX_PROFILE_DESCRIPTION_CHARS,
  MAX_PROFILE_IMAGE_BYTES,
  PROFILE_SCHEMA_V1,
  sniffImageFormat,
  toEip55Address,
  validBtcAddress,
  validEthAddress,
  validPoaAddress,
  validProfileDescription,
  validateProfileDocument,
  validProfileImage,
} from "../dist/src/profile.js";
import { McpCore } from "../dist/src/mcp-core.js";
import { registryMcpProfile } from "../dist/src/mcp-registry.js";
import { registryRoute } from "../dist/src/registry-routes.js";
import { capabilities } from "../dist/src/interface.js";
import { errorReply } from "../dist/src/errors.js";
import {
  checkBtcAddress,
  checkEthAddress,
  checkProfileDescription,
  checkProfileImage,
  cidForDocument,
  collectPreviousDomainFields,
  extractDomainProfile,
  findDomainSalesAndAuctions,
  profileImageMediaPath,
  SALE_FIELDS_WARNING,
  toEip55Address as uiToEip55Address,
} from "../reference-web/shared.js";
import { SUGGESTION_WORDS, suggestNames } from "../reference-web/ideas-generator.js";
import { canonical } from "../dist/src/core.js";
import { Engine, LEGACY_LEASE_POLICY, TRANSFER_FIELD_RESET_TIME } from "../dist/src/engine.js";
import { nativeAddress } from "../dist/src/native-crypto.js";
import { setup, witness as makeWitness } from "../dist/test/helpers.js";

const EIP55_VECTORS = [
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
  "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  "0x52908400098527886E0F7030069857D2E4169EE7",
  "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
  "0xde709f2102306220921060314715629080e2fb77",
  "0x27b1fdb04752bbc536007a920d24acb045561c26",
];

const BTC_MAINNET_VALID = [
  "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // BIP-173 P2WPKH
  "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", // BIP-173 P2WSH
  "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297", // BIP-350 P2TR Taproot
  "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // Legacy P2PKH (Genesis)
  "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // Legacy P2SH
];

const BTC_INVALID = [
  "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", // testnet
  "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5", // bad bech32 checksum
  "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3298", // bad bech32m checksum
  "bc1Qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // mixed case
  "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb", // bad base58check
  "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn", // testnet legacy
  "not-a-btc-address",
];

const SAMPLE_POA = nativeAddress(randomBytes(32));

test("EIP-55 Keccak-256 ETH validation matches official vectors on both server and browser", () => {
  for (const addr of EIP55_VECTORS) {
    assert.equal(toEip55Address(addr.toLowerCase()), addr);
    assert.equal(uiToEip55Address(addr.toLowerCase()), addr);
    assert.equal(validEthAddress(addr), addr);
    const uiRes = checkEthAddress(addr);
    assert.equal(uiRes.ok, true);
    assert.equal(uiRes.value, addr);
  }
  const bad = "0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  assert.throws(() => validEthAddress(bad), /INVALID_ETH_CHECKSUM/);
  const uiBad = checkEthAddress(bad);
  assert.equal(uiBad.ok, false);
  assert.equal(uiBad.checksum, EIP55_VECTORS[0]);

  const needsMix = EIP55_VECTORS[0].toLowerCase();
  assert.throws(() => validEthAddress(needsMix), /INVALID_ETH_CHECKSUM/);
  assert.equal(checkEthAddress(needsMix).ok, false);

  assert.throws(() => validEthAddress("0x1234"), /INVALID_ETH_ADDRESS/);
  assert.equal(checkEthAddress("0x1234").ok, false);
  assert.equal(checkEthAddress("").ok, true);
  assert.equal(checkEthAddress("").value, null);
});

test("Bitcoin mainnet Bech32, Bech32m, and legacy Base58Check validation matches on server and browser", async () => {
  for (const addr of BTC_MAINNET_VALID) {
    const expected = addr.startsWith("bc1") ? addr.toLowerCase() : addr;
    assert.equal(validBtcAddress(addr), expected);
    const uiRes = await checkBtcAddress(addr);
    assert.equal(uiRes.ok, true);
    assert.equal(uiRes.value, expected);
  }
  assert.equal(validBtcAddress(BTC_MAINNET_VALID[0].toUpperCase()), BTC_MAINNET_VALID[0]);
  const upperRes = await checkBtcAddress(BTC_MAINNET_VALID[0].toUpperCase());
  assert.equal(upperRes.ok, true);
  assert.equal(upperRes.value, BTC_MAINNET_VALID[0]);

  for (const bad of BTC_INVALID) {
    assert.throws(() => validBtcAddress(bad), /INVALID_BTC_ADDRESS/, bad);
    assert.equal((await checkBtcAddress(bad)).ok, false, bad);
  }
  const emptyRes = await checkBtcAddress("");
  assert.equal(emptyRes.ok, true);
  assert.equal(emptyRes.value, null);
});

test("Profile description, image URI, and magic-byte sniffing enforce bounds and safety", () => {
  assert.equal(validPoaAddress(SAMPLE_POA), SAMPLE_POA);
  assert.throws(() => validPoaAddress("ed25519:" + "0".repeat(64)), /INVALID_POA_ADDRESS/);

  const maxBio = "🌙".repeat(MAX_PROFILE_DESCRIPTION_CHARS);
  assert.equal(validProfileDescription(maxBio), maxBio);
  const uiBio = checkProfileDescription(maxBio);
  assert.equal(uiBio.ok, true);
  assert.equal(uiBio.value, maxBio);
  assert.throws(
    () => validProfileDescription(maxBio + "x"),
    /INVALID_PROFILE_DESCRIPTION/,
  );
  assert.equal(checkProfileDescription(maxBio + "x").ok, false);
  const withLink = "Visit https://example.com <script>alert(1)</script>";
  assert.equal(validProfileDescription(withLink), withLink);
  assert.throws(() => validProfileDescription("bad\x00char"), /INVALID_PROFILE_DESCRIPTION/);

  const sampleCid = cidForBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.equal(validProfileImage(`ipfs://${sampleCid}`), `ipfs://${sampleCid}`);
  assert.equal(profileImageMediaPath(`ipfs://${sampleCid}`), `/v1/media/${sampleCid}`);
  assert.equal(validProfileImage("https://example.com/avatar.png"), "https://example.com/avatar.png");
  assert.equal(profileImageMediaPath("https://example.com/avatar.png"), null);
  for (const badUri of ["javascript:alert(1)", "data:image/png;base64,AAAA", "http://insecure.example/a.png", "ipfs://bad cid"]) {
    assert.throws(() => validProfileImage(badUri), /INVALID_PROFILE_IMAGE/, badUri);
    assert.equal(checkProfileImage(badUri).ok, false, badUri);
  }

  assert.equal(sniffImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), "image/png");
  assert.equal(sniffImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1])), "image/jpeg");
  assert.equal(sniffImageFormat(new Uint8Array([0x52, 0x49, 0x46, 0x46, 12, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(sniffImageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0])), "image/gif");
  assert.equal(sniffImageFormat(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  assert.equal(MAX_PROFILE_IMAGE_BYTES, 5 * 1024 * 1024);
});

test("Engine commits poa-domains.profile.v1 via setMetadata, CID matches browser, and MCP exposes profile tools/prompts", async () => {
  const t = setup();
  const deed = t.win("moon", t.alice);

  const defaultProf = extractLatestProfile(deed);
  assert.equal(defaultProf.isDefault, true);
  assert.equal(defaultProf.profile.poa, t.alice.id);

  const avatarCid = cidForBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]));
  const witness = buildProfileWitness({
    name: "moon",
    rightsHash: deed.rightsHash,
    poa: SAMPLE_POA,
    btc: BTC_MAINNET_VALID[0],
    eth: EIP55_VECTORS[0],
    description: "Builder on PoA https://minepoa.com",
    image: `ipfs://${avatarCid}`,
  });
  assert.equal(witness.document.schema, PROFILE_SCHEMA_V1);
  assert.equal(witness.document.version, 1);
  assert.equal(witness.document.poa, SAMPLE_POA);
  assert.equal(await cidForDocument(witness.document), witness.cid);
  assert.equal(canonicalProfileJson(witness.document), canonical(witness.document));
  validateProfileDocument(witness.document, "moon", deed.rightsHash);

  const setMeta = t.packet(
    "setMetadata",
    {
      name: "moon",
      expectedDeedId: deed.id,
      expectedVersion: deed.version,
      metadata: witness,
    },
    t.alice,
  );
  const updated = t.e.submit(setMeta);
  assert.equal(updated.status, "succeeded");
  const freshDeed = t.e.snapshot().deeds[deed.id];
  const latest = extractLatestProfile(freshDeed);
  assert.equal(latest.isDefault, false);
  assert.equal(latest.cid, witness.cid);
  assert.equal(latest.profile.poa, SAMPLE_POA);
  assert.equal(latest.profile.btc, BTC_MAINNET_VALID[0]);
  assert.equal(latest.profile.eth, EIP55_VECTORS[0]);
  assert.equal(latest.profile.image, `ipfs://${avatarCid}`);
  const uiExtracted = extractDomainProfile(freshDeed);
  assert.equal(uiExtracted.isDefault, false);
  assert.equal(uiExtracted.profile.eth, EIP55_VECTORS[0]);

  const backend = async (method, path, query = {}, packet) => {
    try {
      const r = registryRoute(t.e, { method, path, query, packet: packet ? JSON.stringify(packet) : undefined, requestId: "profile-mcp-test" });
      const data = JSON.parse(r.jsonText);
      if (r.status >= 400) throw Object.assign(Error(data.code), { detail: data });
      return data;
    } catch (err) {
      if (err.detail) throw err;
      throw Object.assign(err, { detail: errorReply(400, { code: err.code }, "profile-mcp-test").body });
    }
  };
  const mcp = new McpCore(registryMcpProfile(backend));
  await mcp.handle(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "profile-test", version: "1" } },
    }),
  );
  await mcp.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));

  const getRes = await mcp.handle(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_domain_profile", arguments: { name: "moon" } },
    }),
  );
  assert.equal(getRes.result.isError, false);
  assert.equal(getRes.result.structuredContent.exists, true);
  assert.equal(getRes.result.structuredContent.cid, witness.cid);
  assert.equal(getRes.result.structuredContent.profile.eth, EIP55_VECTORS[0]);
  assert.equal(getRes.result.structuredContent.profile.btc, BTC_MAINNET_VALID[0]);

  const buildRes = await mcp.handle(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "build_profile_witness",
        arguments: {
          name: "moon",
          poa: SAMPLE_POA,
          btc: BTC_MAINNET_VALID[2],
          eth: EIP55_VECTORS[1],
          description: "Updated via MCP",
        },
      },
    }),
  );
  assert.equal(buildRes.result.isError, false);
  assert.equal(buildRes.result.structuredContent.setMetadataParams.expectedDeedId, deed.id);
  assert.equal(buildRes.result.structuredContent.document.poa, SAMPLE_POA);
  assert.equal(buildRes.result.structuredContent.document.btc, BTC_MAINNET_VALID[2]);
  assert.equal(buildRes.result.structuredContent.publicNotice.includes("IPFS"), true);

  const promptRes = await mcp.handle(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "prompts/get",
      params: { name: "update_domain_profile", arguments: { name: "moon" } },
    }),
  );
  assert.ok(promptRes.result.messages[0].content.text.includes("build_profile_witness"));
  assert.ok(promptRes.result.messages[0].content.text.includes("publicly"));
});

test("Search autocomplete word bank is large and returns obvious available suggestions", () => {
  const t = setup();
  const manifest = capabilities(t.e).emojiManifest;
  assert.ok(SUGGESTION_WORDS.length >= 800, `Expected >= 800 curated words, got ${SUGGESTION_WORDS.length}`);
  assert.ok(SUGGESTION_WORDS.includes("moon"));
  assert.ok(SUGGESTION_WORDS.includes("agent"));
  assert.ok(SUGGESTION_WORDS.includes("wallet"));

  const taken = new Set(["moon"]);
  const avail = suggestNames("moo", { manifest, accept: (n) => !taken.has(n), limit: 8 });
  assert.equal(avail.items.some((x) => x.name === "moon"), false);
  assert.ok(avail.items.length > 0);

  const open = suggestNames("moo", { manifest, accept: () => true, limit: 8 });
  assert.ok(open.completion && open.completion.startsWith("moo"));
  assert.ok(open.items.some((x) => x.name === "moon"));

  const ag = suggestNames("agen", { manifest, accept: () => true, limit: 8 });
  assert.equal(ag.completion, "agent");
  assert.ok(ag.items.some((x) => x.name === "agent"));
});

test("Ownership transfer drops attached records & profile fields, archives previousFields, replays identically, and keeps MCP clean", async () => {
  const commits = [];
  const t = setup();
  const baseDeed = t.win("comet", t.alice);
  assert.ok(Number.isSafeInteger(TRANSFER_FIELD_RESET_TIME) && TRANSFER_FIELD_RESET_TIME > 1795500000);
  assert.ok(SALE_FIELDS_WARNING.includes("dropped"));

  // Alice attaches wallet/service/ipfs records AND sets a v1 public profile
  const ipfsCid = cidForBytes(new Uint8Array([1, 2, 3, 4, 5]));
  const avatarCid = cidForBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8]));
  const records = [
    { type: "wallet", chain: "poa", address: SAMPLE_POA },
    { type: "service", url: "https://alice.example/api" },
    { type: "ipfs", cid: ipfsCid },
  ];
  const r1 = t.e.submit(
    t.packet(
      "setRecords",
      {
        name: "comet",
        expectedDeedId: baseDeed.id,
        expectedVersion: baseDeed.version,
        records,
      },
      t.alice,
    ),
  );
  assert.equal(r1.status, "succeeded");
  const dAfterRecs = t.e.snapshot().deeds[baseDeed.id];
  assert.equal(dAfterRecs.records.length, 3);

  const aliceProfile = buildProfileWitness({
    name: "comet",
    rightsHash: dAfterRecs.rightsHash,
    poa: SAMPLE_POA,
    btc: BTC_MAINNET_VALID[0],
    eth: EIP55_VECTORS[0],
    description: "Alice original profile bio",
    image: `ipfs://${avatarCid}`,
  });
  const r2 = t.e.submit(
    t.packet(
      "setMetadata",
      {
        name: "comet",
        expectedDeedId: dAfterRecs.id,
        expectedVersion: dAfterRecs.version,
        metadata: aliceProfile,
      },
      t.alice,
    ),
  );
  assert.equal(r2.status, "succeeded");
  const dBeforeTransfer = t.e.snapshot().deeds[baseDeed.id];
  assert.equal(extractLatestProfile(dBeforeTransfer).isDefault, false);
  assert.equal(extractDomainProfile(dBeforeTransfer).isDefault, false);

  // While listed for sale, collectPreviousDomainFields surfaces Alice's paused active fields
  const pausedEntries = collectPreviousDomainFields(dBeforeTransfer, { listedForSale: true });
  assert.equal(pausedEntries[0].status, "paused");
  assert.equal(pausedEntries[0].records.length, 3);
  assert.equal(pausedEntries[0].profile.eth, EIP55_VECTORS[0]);

  // 1) Direct transfer (same engine path POA escrow settle uses): Alice -> Bob
  const rTransfer = t.e.submit(
    t.packet(
      "transfer",
      {
        name: "comet",
        expectedDeedId: dBeforeTransfer.id,
        expectedVersion: dBeforeTransfer.version,
        recipient: t.bob.id,
      },
      t.alice,
    ),
  );
  assert.equal(rTransfer.status, "succeeded");
  const dBob = t.e.snapshot().deeds[baseDeed.id];
  assert.equal(dBob.owner, t.bob.id);
  assert.deepEqual(dBob.records, []);
  assert.equal(dBob.profileResetAt, dBob.metadata.length);
  assert.equal(dBob.previousFields.length, 1);
  assert.equal(dBob.previousFields[0].owner, t.alice.id);
  assert.equal(dBob.previousFields[0].records.length, 3);
  assert.equal(dBob.previousFields[0].profile.cid, aliceProfile.cid);

  // Clean slate for Bob on BOTH server (extractLatestProfile) and browser (extractDomainProfile)
  const bobServerProf = extractLatestProfile(dBob);
  assert.equal(bobServerProf.isDefault, true);
  assert.equal(bobServerProf.profile.poa, t.bob.id);
  assert.equal(bobServerProf.profile.btc, null);
  assert.equal(bobServerProf.profile.eth, null);
  assert.equal(bobServerProf.profile.description, "");
  assert.equal(bobServerProf.profile.image, null);
  assert.equal(bobServerProf.cid, null);

  const bobUiProf = extractDomainProfile(dBob);
  assert.equal(bobUiProf.isDefault, true);
  assert.equal(bobUiProf.profile.description, "");
  assert.equal(bobUiProf.profile.btc, null);
  assert.equal(bobUiProf.profile.eth, null);

  // Previous fields helper exposes Alice's dropped records & profile on /d/comet
  const archivedForBob = collectPreviousDomainFields(dBob);
  const droppedEntry = archivedForBob.find((e) => e.status === "dropped");
  assert.ok(droppedEntry);
  assert.equal(droppedEntry.owner, t.alice.id);
  assert.equal(droppedEntry.records.length, 3);
  assert.equal(droppedEntry.profile.eth, EIP55_VECTORS[0]);
  assert.equal(droppedEntry.profile.btc, BTC_MAINNET_VALID[0]);
  assert.equal(droppedEntry.profile.description, "Alice original profile bio");

  // MCP get_domain_profile and build_profile_witness start completely clean for Bob
  const backend = async (method, path, query = {}, packet) => {
    const r = registryRoute(t.e, { method, path, query, packet: packet ? JSON.stringify(packet) : undefined, requestId: "transfer-mcp-test" });
    const data = JSON.parse(r.jsonText);
    if (r.status >= 400) throw Object.assign(Error(data.code), { detail: data });
    return data;
  };
  const mcp = new McpCore(registryMcpProfile(backend));
  await mcp.handle(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } }));
  await mcp.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
  const mcpProf = await mcp.handle(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_domain_profile", arguments: { name: "comet" } } }));
  assert.equal(mcpProf.result.isError, false);
  assert.equal(mcpProf.result.structuredContent.isDefault, true);
  assert.equal(mcpProf.result.structuredContent.owner, t.bob.id);
  assert.equal(mcpProf.result.structuredContent.profile.btc, null);
  assert.equal(mcpProf.result.structuredContent.profile.eth, null);
  assert.equal(mcpProf.result.structuredContent.profile.description, "");

  // 2) Bob sets his own profile, lists via sellFixed, and Alice buys back via buyFixed
  const bobProfile = buildProfileWitness({
    name: "comet",
    rightsHash: dBob.rightsHash,
    poa: SAMPLE_POA,
    btc: null,
    eth: EIP55_VECTORS[1],
    description: "Bob second holder bio",
    image: null,
  });
  assert.equal(
    t.e.submit(t.packet("setMetadata", { name: "comet", expectedDeedId: dBob.id, expectedVersion: dBob.version, metadata: bobProfile }, t.bob)).status,
    "succeeded",
  );
  const dBobV2 = t.e.snapshot().deeds[dBob.id];
  const sellRes = t.e.submit(
    t.packet(
      "sellFixed",
      { name: "comet", expectedDeedId: dBobV2.id, expectedVersion: dBobV2.version, asset: "POA", price: "50", validUntil: t.e.snapshot().time + 3600 },
      t.bob,
    ),
  );
  assert.equal(sellRes.status, "succeeded");
  const offerId = sellRes.result.offerId;

  // Check findDomainSalesAndAuctions detects the active registry resale listing
  const saleInfo = findDomainSalesAndAuctions({ name: "comet", deed: dBobV2, state: t.e.snapshot(), escrowMarket: [] });
  assert.equal(saleInfo.listedForSale, true);
  assert.equal(saleInfo.kind, "registry-resale");

  assert.equal(
    t.e.submit(t.packet("buyFixed", { offerId, expectedVersion: 1, asset: "POA", amount: "50" }, t.alice)).status,
    "succeeded",
  );
  const dAfterBuy = t.e.snapshot().deeds[dBob.id];
  assert.equal(dAfterBuy.owner, t.alice.id);
  assert.equal(dAfterBuy.previousFields.length, 2);
  assert.equal(dAfterBuy.previousFields[1].owner, t.bob.id);
  assert.equal(dAfterBuy.previousFields[1].profile.cid, bobProfile.cid);
  assert.equal(extractLatestProfile(dAfterBuy).isDefault, true);
  assert.equal(extractLatestProfile(dAfterBuy).profile.eth, null);

  // 3) Secondary auction finalize ALSO drops records & archives previousFields
  assert.equal(
    t.e.submit(
      t.packet(
        "setRecords",
        { name: "comet", expectedDeedId: dAfterBuy.id, expectedVersion: dAfterBuy.version, records: [{ type: "ipfs", cid: ipfsCid }] },
        t.alice,
      ),
    ).status,
    "succeeded",
  );
  const dBeforeAuc = t.e.snapshot().deeds[dBob.id];
  const ann = t.e.submit(
    t.packet(
      "announceAuction",
      {
        name: "comet",
        asset: "POA",
        reserve: "100",
        openAt: t.clock.now() + 86400,
        expectedDeedId: dBeforeAuc.id,
        expectedVersion: dBeforeAuc.version,
        metadata: dBeforeAuc.metadata.at(-1),
      },
      t.alice,
    ),
  );
  assert.equal(ann.status, "succeeded");
  const aucId = ann.result.auctionId;
  const aucObj = t.e.snapshot().auctions[aucId];
  t.clock.set(aucObj.openAt);
  assert.equal(
    t.e.submit(t.packet("bid", { auctionId: aucId, expectedVersion: aucObj.version, asset: "POA", amount: "120", beneficiary: t.bob.id }, t.bob)).status,
    "succeeded",
  );
  const aucAfterBid = t.e.snapshot().auctions[aucId];
  t.clock.set(t.e.closeEligible(aucAfterBid));
  assert.equal(t.e.submit(t.packet("finalize", { auctionId: aucId, expectedVersion: aucAfterBid.version }, t.bob)).status, "succeeded");
  const dAfterAuc = t.e.snapshot().deeds[dBob.id];
  assert.equal(dAfterAuc.owner, t.bob.id);
  assert.deepEqual(dAfterAuc.records, []);
  assert.equal(dAfterAuc.previousFields.length, 3);
  assert.equal(dAfterAuc.previousFields[2].records.length, 1);
  assert.equal(extractLatestProfile(dAfterAuc).isDefault, true);

  // Replay verification: committing into a recorded Engine and replaying reproduces exact stateHash
  const tReplay = setup();
  const recorded = [];
  const recEngine = new Engine(tReplay.config, tReplay.clock, LEGACY_LEASE_POLICY);
  recEngine.attach({ append: (c) => recorded.push(c), close() {} });
  const pAnn = tReplay.packet(
    "announceAuction",
    { name: "orbit", asset: "POA", reserve: "100", openAt: tReplay.clock.now() + 86400, expectedDeedId: null, expectedVersion: 0, metadata: makeWitness("orbit") },
    tReplay.issuer,
    { nonce: recEngine.nextNonce(tReplay.issuer.id) },
  );
  const rAnn = recEngine.submit(pAnn);
  assert.equal(rAnn.status, "succeeded");
  const aRec = recEngine.snapshot().auctions[rAnn.result.auctionId];
  tReplay.clock.set(aRec.openAt);
  const rBid = recEngine.submit(
    tReplay.packet("bid", { auctionId: aRec.id, expectedVersion: aRec.version, asset: "POA", amount: "100", beneficiary: tReplay.alice.id }, tReplay.alice, { nonce: recEngine.nextNonce(tReplay.alice.id) }),
  );
  assert.equal(rBid.status, "succeeded");
  const aRec2 = recEngine.snapshot().auctions[aRec.id];
  tReplay.clock.set(recEngine.closeEligible(aRec2));
  assert.equal(
    recEngine.submit(tReplay.packet("finalize", { auctionId: aRec2.id, expectedVersion: aRec2.version }, tReplay.bob, { nonce: recEngine.nextNonce(tReplay.bob.id) })).status,
    "succeeded",
  );
  const orbDeed = recEngine.snapshot().deeds[recEngine.snapshot().names.orbit.activeId];
  assert.equal(
    recEngine.submit(
      tReplay.packet(
        "setRecords",
        { name: "orbit", expectedDeedId: orbDeed.id, expectedVersion: orbDeed.version, records: [{ type: "service", url: "https://orbit.example" }] },
        tReplay.alice,
        { nonce: recEngine.nextNonce(tReplay.alice.id) },
      ),
    ).status,
    "succeeded",
  );
  const orbV2 = recEngine.snapshot().deeds[orbDeed.id];
  assert.equal(
    recEngine.submit(
      tReplay.packet(
        "transfer",
        { name: "orbit", expectedDeedId: orbV2.id, expectedVersion: orbV2.version, recipient: tReplay.bob.id },
        tReplay.alice,
        { nonce: recEngine.nextNonce(tReplay.alice.id) },
      ),
    ).status,
    "succeeded",
  );
  assert.equal(recorded.length, 5);
  const replayed = new Engine(tReplay.config, { now: () => 0 }, LEGACY_LEASE_POLICY);
  for (const commit of recorded) replayed.replay(commit);
  assert.equal(replayed.stateHash(), recEngine.stateHash());
  assert.equal(replayed.snapshot().deeds[orbDeed.id].previousFields.length, 1);
  assert.deepEqual(replayed.snapshot().deeds[orbDeed.id].records, []);
});
