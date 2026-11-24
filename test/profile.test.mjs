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
  extractDomainProfile,
  profileImageMediaPath,
  toEip55Address as uiToEip55Address,
} from "../reference-web/shared.js";
import { SUGGESTION_WORDS, suggestNames } from "../reference-web/ideas-generator.js";
import { canonical } from "../dist/src/core.js";
import { nativeAddress } from "../dist/src/native-crypto.js";
import { setup } from "../dist/test/helpers.js";

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
