import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { startRegistryApp } from "../src/app.js";
import {
  canonical,
  parseJSON,
  MAX_AMOUNT,
  amount,
  bounded,
  hash,
} from "../src/core.js";
import {
  normalizeName,
  canonicalName,
  nameKey,
  manifest,
  emoji17Manifest,
  EMOJI17_ALIASES,
  EMOJI17_RECORD_COUNT,
  EMOJI17_NORMALIZATION_HASH,
  NORMALIZATION_HASH,
  normalizationHashFor,
  normalizationModeForHash,
} from "../src/names.js";
import { cidFor, metadata, validCid } from "../src/metadata.js";
import {
  mainnetConfig,
  minimumNext,
  validateConfig,
  SINGLE_LETTER_RESERVED,
  PROTOCOL_AND_SYSTEM_RESERVED,
  TOP_BRAND_AND_PRODUCT_RESERVED,
  DEFAULT_RESERVED_NAMES,
} from "../src/config.js";
import { Engine } from "../src/engine.js";
import { ManualClock } from "../src/clock.js";
import { setup, witness } from "./helpers.js";
import { rightsHash } from "../src/model.js";
import { prepare, handoff, capabilities } from "../src/interface.js";
import {
  authenticate,
  intentId,
  nativePrincipal,
  principal,
  signBody,
} from "../src/auth.js";

test("strict JSON rejects duplicate/unsafe/secret keys, floats, depth and excess bytes", () => {
  for (const s of [
    '{"a":1,"a":2}',
    '{"a":1.1}',
    '{"__proto__":{}}',
    '{"privateKey":"not-allowed"}',
    '{"seed":"not-allowed"}',
    '{"a":-1}',
    '{"a":01}',
    "[1,]",
    "{}junk",
    '{"a":"\\ud800"}',
    "[".repeat(26) + "0" + "]".repeat(26),
  ])
    assert.throws(() => parseJSON(s));
  assert.throws(() => parseJSON(" ".repeat(65537)));
  assert.equal(canonical(parseJSON('{"b":"2","a":1}')), '{"a":1,"b":"2"}');
});
test("integer monetary bounds do not lose precision", () => {
  assert.equal(amount("9007199254740993"), 9007199254740993n);
  assert.equal(bounded(MAX_AMOUNT), MAX_AMOUNT.toString());
  for (const x of [1, "01", "1.0", "-1", "1e9", (MAX_AMOUNT + 1n).toString()])
    assert.throws(() => amount(x));
  assert.throws(() => bounded(MAX_AMOUNT + 1n));
  assert.throws(() => bounded(-1n));
});
test("increment candidates use exact strict boundaries, configured hybrid minimum and large values", () => {
  assert.equal(minimumNext(100000000n, { kind: "eosStrict10" }), 110000001n);
  assert.equal(
    minimumNext(100n, { kind: "strictBps", bps: 250, minUnits: "10" }),
    110n,
  );
  assert.equal(
    minimumNext(10000n, { kind: "strictBps", bps: 250, minUnits: "1" }),
    10251n,
  );
  assert.equal(
    minimumNext(9007199254740993n, { kind: "eosStrict10" }),
    9907919180215093n,
  );
});
test("every supported emoji alias collapses to the pinned base, counts as one, and is idempotent", () => {
  assert.equal(manifest.aliases.length, 140);
  for (const a of manifest.aliases) {
    const n = normalizeName(a.input);
    assert.equal(n.canonical, a.canonical);
    assert.equal(n.labels[0]!.tokens.length, 1);
    assert.equal(normalizeName(n.canonical).canonical, n.canonical);
  }
  assert.match(NORMALIZATION_HASH, /^[0-9a-f]{64}$/);
});
test("ASCII prefix/case, mixed emoji and classification boundaries", () => {
  assert.equal(normalizeName("poa:AbC").canonical, "abc");
  for (const [name, tier] of [
    ["a", "premium"],
    ["abc", "premium"],
    ["a🚀2", "premium"],
    ["abcd", "standard"],
    ["🚀".repeat(32), "standard"],
  ] as const)
    assert.equal(normalizeName(name).tier, tier);
  assert.equal(normalizeName("👨🏿‍💻").canonical, "🧑‍💻");
  assert.equal(normalizeName("👍🏽").canonical, "👍");
  assert.equal(normalizeName("1️⃣").labels[0]!.tokens.length, 1);
  assert.notEqual(normalizeName("1️⃣").canonical, normalizeName("1").canonical);
});
test("unsupported Unicode, components, dangling VS/ZWJ/tags, hyphens and depth fail rather than strip", () => {
  for (const s of [
    "",
    "a".repeat(33),
    "-abc",
    "ab-c",
    "a..b",
    "a.b.c",
    "é",
    "a\u200db",
    "👍\ufe0f",
    "👩‍🦰",
    "🏴\u{e0067}",
    "1\ufe0f",
    "🏽",
    "a\u202eb",
    "a\n",
    "🚀\u200d",
  ])
    assert.throws(() => normalizeName(s), s);
});
test("full Unicode 17 emoji canonicalization supports all 5,216 non-component sequences and rejects standalone components", async () => {
  assert.equal(EMOJI17_RECORD_COUNT, 5216);
  assert.equal(EMOJI17_ALIASES.length, 5216);
  assert.match(EMOJI17_NORMALIZATION_HASH, /^[0-9a-f]{64}$/);
  assert.notEqual(EMOJI17_NORMALIZATION_HASH, NORMALIZATION_HASH);
  assert.equal(normalizationHashFor("reference-subset"), NORMALIZATION_HASH);
  assert.equal(
    normalizationHashFor("emoji17-full"),
    EMOJI17_NORMALIZATION_HASH,
  );
  assert.equal(
    normalizationModeForHash(NORMALIZATION_HASH),
    "reference-subset",
  );
  assert.equal(
    normalizationModeForHash(EMOJI17_NORMALIZATION_HASH),
    "emoji17-full",
  );
  assert.throws(() => normalizationModeForHash("0".repeat(64)));
  const web: any = await import(
    new URL("../../reference-web/shared.js", import.meta.url).href
  );
  for (const a of EMOJI17_ALIASES) {
    const n = normalizeName(a.input, "emoji17-full");
    assert.equal(n.canonical, a.canonical);
    assert.equal(n.labels[0]!.tokens.length, 1);
    assert.equal(n.tier, "premium");
    assert.equal(
      canonicalName(n.canonical, "emoji17-full").canonical,
      n.canonical,
    );
    assert.equal(web.normalize(a.input, emoji17Manifest), a.canonical);
  }
  assert.equal(
    normalizeName("poa:👩‍🦰.🫪🫯", "emoji17-full").canonical,
    "👩‍🦰.🫪🫯",
  );
  assert.equal(normalizeName("❤.#⃣", "emoji17-full").canonical, "❤️.#️⃣");
  assert.match(nameKey("reg-1", "👩‍🦰", "emoji17-full"), /^[0-9a-f]{64}$/);
  for (const bad of [
    "🏻",
    "🏼",
    "🏽",
    "🏾",
    "🏿",
    "🦰",
    "🦱",
    "🦳",
    "🦲",
    "🇺",
    "🏴\u{e0067}",
    "👍\ufe0f",
    "1\ufe0f",
    "🚀\u200d",
    "a\u200db",
  ]) {
    assert.throws(() => normalizeName(bad, "emoji17-full"), bad);
    assert.throws(() => web.normalize(bad, emoji17Manifest), bad);
  }
});
test("metadata accepts only verified raw CIDv1 sha256 witness bound to name and immutable rights", () => {
  const w = witness("alpha");
  assert.equal(validCid(w.cid), w.cid);
  assert.deepEqual(
    metadata(w, "alpha", rightsHash({ kind: "permanent" }, null)),
    w,
  );
  assert.throws(() =>
    metadata({ ...w, cid: cidFor(null) }, "alpha", w.document.rightsHash),
  );
  assert.throws(() => metadata(w, "bravo", w.document.rightsHash));
  for (const cid of [
    "Qm" + "a".repeat(44),
    "ipfs://" + w.cid,
    w.cid + "a",
    w.cid.toUpperCase(),
    w.cid.slice(0, -1) + "1",
  ])
    assert.throws(() => validCid(cid));
});
test("missing mandatory fixture policies and unsupported live assets fail closed", () => {
  for (const key of [
    "increment",
    "feeBps",
    "highestSelfRaise",
    "clockPolicy",
    "signingMode",
    "assets",
  ]) {
    const c = setup().config as any;
    delete c[key];
    assert.throws(
      () => new (setup().e.constructor as any)(c, { now: () => 1 }),
    );
  }
  const c = setup().config;
  assert.equal(c.assets.POA!.kind, "local-fixture");
  assert.throws(() => validateConfig({ ...c, reserved: ["system", "system"] }));
});
test("reserved list covers letters a-z, protocol/system/anti-phishing names, and 500 brand/product names", () => {
  assert.equal(SINGLE_LETTER_RESERVED.length, 26);
  assert.deepEqual(
    SINGLE_LETTER_RESERVED,
    Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)),
  );
  assert.equal(PROTOCOL_AND_SYSTEM_RESERVED.length, 129);
  assert.equal(TOP_BRAND_AND_PRODUCT_RESERVED.length, 500);
  assert.equal(DEFAULT_RESERVED_NAMES.length, 655);
  assert.equal(
    new Set(DEFAULT_RESERVED_NAMES).size,
    DEFAULT_RESERVED_NAMES.length,
  );
  const c = setup();
  for (const sample of [
    "a",
    "z",
    "poa",
    "minepoa",
    "system",
    "admin",
    "wallet",
    "openai",
    "apple",
    "google",
    "microsoft",
    "nvidia",
    "bitcoin",
    "visa",
    "netflix",
    "tesla",
  ]) {
    assert.ok(DEFAULT_RESERVED_NAMES.includes(sample), sample);
    const n = normalizeName(sample);
    const r = c.send(
      "announceAuction",
      {
        name: n.canonical,
        asset: "POA",
        reserve: n.tier === "premium" ? "1000" : "100",
        openAt: c.clock.now() + 86400,
        expectedDeedId: null,
        expectedVersion: 0,
        metadata: witness(n.canonical),
      },
      c.issuer,
    );
    assert.equal(r.status, "rejected");
    assert.equal(r.code, "RESERVED_NAME");
  }
});
test("poa-mainnet-v1 config profile executes full Unicode 17 emoji domain lifecycle with poa1 principals", () => {
  const c = setup();
  const issuerPoa = nativePrincipal(c.issuer.key);
  const treasuryPoa = nativePrincipal(c.treasury.key);
  const alicePoa = nativePrincipal(c.alice.key);
  const bobPoa = nativePrincipal(c.bob.key);
  assert.throws(() => mainnetConfig(c.issuer.id, treasuryPoa, [alicePoa]));
  const cfg = mainnetConfig(issuerPoa, treasuryPoa, [alicePoa, bobPoa]);
  assert.equal(cfg.revision, "poa-mainnet-v1");
  assert.equal(cfg.chainId, "poa-mainnet-1");
  assert.equal(cfg.signingMode, "poa1-ed25519");
  assert.equal(cfg.normalizationHash, EMOJI17_NORMALIZATION_HASH);
  assert.equal(cfg.assets.POA!.kind, "poa-native");
  assert.equal(cfg.reserved.length, 655);
  const clock = new ManualClock(1000000);
  const e = new Engine(cfg, clock);
  const cap = capabilities(e);
  assert.equal(cap.emojiAliases, 5216);
  let reqSeq = 0;
  const submitPoa = (
    signerId: string,
    key: any,
    action: string,
    params: Record<string, any>,
  ) => {
    const body = prepare(
      {
        signer: signerId,
        coSigners: [],
        requestId: "mainnet-" + ++reqSeq,
        nonce: e.nextNonce(signerId),
        notBefore: 0,
        deadline: clock.now() + 300000,
        maxTotal: "10000000000",
        maxNetworkFee: "0",
        action,
        params,
      },
      cap,
    );
    return e.submit(signBody(body, [key]));
  };
  const reservedTry = submitPoa(issuerPoa, c.issuer.key, "announceAuction", {
    name: "openai",
    asset: "POA",
    reserve: "1000",
    openAt: clock.now() + 86400,
    expectedDeedId: null,
    expectedVersion: 0,
    metadata: witness("openai"),
  });
  assert.equal(reservedTry.status, "rejected");
  assert.equal(reservedTry.code, "RESERVED_NAME");
  const rootName = "👩‍🦰";
  const announced = submitPoa(issuerPoa, c.issuer.key, "announceAuction", {
    name: rootName,
    asset: "POA",
    reserve: "100000",
    openAt: clock.now() + 86400,
    expectedDeedId: null,
    expectedVersion: 0,
    metadata: witness(rootName),
  });
  assert.equal(announced.status, "succeeded", announced.code);
  const auctionId = announced.result.auctionId;
  clock.advance(86400);
  const bidRes = submitPoa(alicePoa, c.alice.key, "bid", {
    auctionId,
    expectedVersion: 1,
    asset: "POA",
    amount: "100000",
    beneficiary: alicePoa,
  });
  assert.equal(bidRes.status, "succeeded", bidRes.code);
  clock.advance(86400);
  const finRes = submitPoa(bobPoa, c.bob.key, "finalize", {
    auctionId,
    expectedVersion: 2,
  });
  assert.equal(finRes.status, "succeeded", finRes.code);
  const resolvedRoot = e.resolve(rootName);
  assert.equal(resolvedRoot.deed.owner, alicePoa);
  const childOffer = submitPoa(alicePoa, c.alice.key, "createChildOffer", {
    parent: rootName,
    parentDeedId: resolvedRoot.deed.id,
    expectedOwnerVersion: 1,
    asset: "POA",
    price: "5000000",
    validUntil: clock.now() + 86400,
    rights: { kind: "permanent" },
    labels: ["🫪"],
    maxUses: 1,
  });
  assert.equal(childOffer.status, "succeeded", childOffer.code);
  const childName = "🫪." + rootName;
  const filled = submitPoa(bobPoa, c.bob.key, "fillChildOffer", {
    offerId: childOffer.result.offerId,
    expectedVersion: 1,
    expectedGeneration: 1,
    label: "🫪",
    asset: "POA",
    amount: "5000000",
    metadata: witness(childName, { kind: "permanent" }, resolvedRoot.deed.id),
  });
  assert.equal(filled.status, "succeeded", filled.code);
  assert.equal(e.resolve(childName).deed.owner, bobPoa);
  e.assertInvariants();
});
test("real Ed25519 signature rejects forgery before consuming nonce", () => {
  const c = setup();
  const p = c.packet("transfer", {
    name: "alpha",
    expectedDeedId: "x",
    expectedVersion: 1,
    recipient: c.bob.id,
  });
  p.signatures[c.alice.id] = "00".repeat(64);
  const before = c.e.stateHash();
  assert.throws(() => c.e.submit(p), /SIGNATURE/);
  assert.equal(c.e.stateHash(), before);
  assert.equal(c.e.nextNonce(c.alice.id), 0);
});
test("native poa1 Base58 principals and signatures authenticate and maintain browser parity", async () => {
  const c = setup();
  const alicePoa = nativePrincipal(c.alice.key);
  const bobPoa = nativePrincipal(c.bob.key);
  assert.ok(alicePoa.startsWith("poa1"));
  assert.equal(principal(alicePoa), alicePoa);
  assert.equal(principal(bobPoa), bobPoa);
  for (const invalid of [
    "poa1",
    "poa10000",
    "poa1" + "1".repeat(31),
    "poa1" + "1".repeat(33),
    "poa2" + alicePoa.slice(4),
  ]) {
    assert.throws(() => principal(invalid), /PRINCIPAL/);
  }
  const web: any = await import(
    new URL("../../reference-web/shared.js", import.meta.url).href
  );
  const cap = capabilities(c.e);
  const coSigners = [bobPoa].sort();
  const input = {
    signer: alicePoa,
    coSigners,
    requestId: "poa1-auth-test-1",
    nonce: 0,
    notBefore: 100,
    deadline: 200,
    maxTotal: "100",
    maxNetworkFee: "0",
    action: "transfer",
    params: {
      name: "poa:ALPHA",
      expectedDeedId: "deed-1",
      expectedVersion: 1,
      recipient: bobPoa,
    },
  };
  const body = prepare(input, cap);
  assert.deepEqual(web.makeBody(input, cap), body);
  const signed = signBody(body, [c.alice.key, c.bob.key]);
  assert.ok(!/^[0-9a-f]{128}$/.test(signed.signatures[alicePoa]!));
  assert.deepEqual(authenticate(signed), signed);
  const forged = structuredClone(signed);
  forged.signatures[alicePoa] = signed.signatures[bobPoa]!;
  assert.throws(() => authenticate(forged), /SIGNATURE/);
});
test("domain, network/genesis, registry, policy and normalization replay protection", () => {
  const c = setup();
  for (const field of [
    "domain",
    "revision",
    "chainId",
    "genesisHash",
    "registryId",
    "policyHash",
    "normalizationHash",
  ]) {
    const p = c.packet("closeNoBid", { auctionId: "x", expectedVersion: 1 });
    const b = { ...p.body, [field]: "different" };
    assert.throws(() => c.e.submit(signBody(b, [c.alice.key])), /DOMAIN/);
  }
  assert.equal(c.e.nextNonce(c.alice.id), 0);
});
test("idempotency returns exact durable success/rejection; changed payload conflicts", () => {
  const c = setup();
  const p = c.packet("closeNoBid", {
    auctionId: "missing",
    expectedVersion: 1,
  });
  const r = c.e.submit(p);
  assert.equal(r.status, "rejected");
  assert.deepEqual(c.e.submit(p), r);
  assert.equal(c.e.nextNonce(c.alice.id), 1);
  const other = signBody({ ...p.body, maxTotal: "1" }, [c.alice.key]);
  assert.throws(() => c.e.submit(other), /IDEMPOTENCY_CONFLICT/);
});
test("stale nonce does not consume another nonce and expired intent is an admitted business rejection", () => {
  const c = setup();
  const p = c.packet(
    "closeNoBid",
    { auctionId: "missing", expectedVersion: 1 },
    c.alice,
    { nonce: 2 },
  );
  assert.throws(() => c.e.submit(p), /NONCE/);
  assert.equal(c.e.nextNonce(c.alice.id), 0);
  const r = c.send(
    "closeNoBid",
    { auctionId: "missing", expectedVersion: 1 },
    c.alice,
    { notBefore: 1, deadline: c.clock.now() },
  );
  assert.equal(r.code, "INTENT_EXPIRED");
  assert.equal(c.e.nextNonce(c.alice.id), 1);
});
test("unknown action rejects with no economic effects; arbitrary unselected policies are not enabled", () => {
  const c = setup();
  const before = c.e.snapshot().balances;
  const r = c.send("arbitrationSeize", { name: "alpha" });
  assert.equal(r.code, "UNSUPPORTED_ACTION");
  assert.deepEqual(c.e.snapshot().balances, before);
});
test("interface handoff binds exact canonical fields, caps, versions and operation digest", () => {
  const c = setup();
  const p = c.packet("transfer", {
    name: "poa:ALPHA",
    expectedDeedId: "abc",
    expectedVersion: 3,
    recipient: c.bob.id,
  });
  const { body: b } = p;
  const input = {
    signer: b.signer,
    coSigners: b.coSigners,
    requestId: b.requestId,
    nonce: b.nonce,
    notBefore: b.notBefore,
    deadline: b.deadline,
    maxTotal: b.maxTotal,
    maxNetworkFee: b.maxNetworkFee,
    action: b.action,
    params: b.params,
  };
  const prepared = prepare(input, capabilities(c.e));
  assert.equal(prepared.params.name, "alpha");
  const h = handoff(prepared);
  assert.equal(h.intentId, intentId(prepared));
  assert.deepEqual(h.body, prepared);
  assert.match(h.instructions, /UNKNOWN/);
  assert.equal(h.body.maxTotal, b.maxTotal);
});
test("submitted packet and returned snapshots cannot mutate committed state", () => {
  const c = setup();
  const p = c.packet(
    "announceAuction",
    {
      name: "alpha",
      asset: "POA",
      reserve: "100",
      openAt: c.clock.now() + 86400,
      expectedDeedId: null,
      expectedVersion: 0,
      metadata: witness("alpha"),
    },
    c.issuer,
  );
  const r = c.e.submit(p);
  assert.equal(r.status, "succeeded");
  const root = c.e.stateHash();
  p.body.params.metadata.document.description = "mutated";
  const snap = c.e.snapshot();
  snap.auctions[r.result.auctionId]!.metadata.document.description = "mutated";
  assert.equal(c.e.stateHash(), root);
  assert.throws(() => {
    c.e.config.feeBps = 9999;
  });
});
test("browser shared module maintains exact canonical, normalization, parser, and digest parity with engine", async () => {
  const web: any = await import(
    new URL("../../reference-web/shared.js", import.meta.url).href
  );
  const c = setup();
  const cap = capabilities(c.e);
  for (const a of manifest.aliases) {
    assert.equal(web.normalize(a.input, manifest), a.canonical);
  }
  assert.equal(web.normalize("poa:ALPHA.🚀", manifest), "alpha.🚀");
  for (const badKey of ["a\u0000b", "a\ud800b"]) {
    assert.throws(() => canonical({ [badKey]: 1 }));
    assert.throws(() => web.canonical({ [badKey]: 1 }));
    assert.throws(() =>
      web.parsePublicJSON(JSON.stringify({ [badKey]: "ok" })),
    );
  }
  for (const badJson of [
    '{"a":1,"a":2}',
    '{"a":1.5}',
    '{"privateKey":"x"}',
    '{"a":"\\u0000"}',
    '{"a":"\\ud800"}',
    "[" + "0,".repeat(256) + "0]",
  ]) {
    assert.throws(() => web.parsePublicJSON(badJson));
  }
  const input = {
    signer: c.alice.id,
    coSigners: [c.bob.id],
    requestId: "parity-check-1",
    nonce: 0,
    notBefore: 100,
    deadline: 200,
    maxTotal: "500",
    maxNetworkFee: "0",
    action: "transfer",
    params: {
      name: "poa:ALPHA",
      expectedDeedId: "deed-1",
      expectedVersion: 1,
      recipient: c.carol.id,
    },
  };
  const engineBody = prepare(input, cap);
  const webBody = web.makeBody(input, cap);
  assert.deepEqual(webBody, engineBody);
  assert.equal(web.canonical(webBody), canonical(engineBody));
  assert.equal(await web.digest(webBody), intentId(engineBody));
  assert.match(
    web.instructions(webBody, intentId(engineBody)),
    /submit_intent/,
  );
  const inspectedRoot = web.inspectName("poa:ALPHA", manifest);
  assert.equal(inspectedRoot.name, "alpha");
  assert.equal(inspectedRoot.kind, "root");
  assert.equal(inspectedRoot.tier, "standard");
  assert.equal(inspectedRoot.tokenCount, 5);
  const inspectedPremium = web.inspectName("🌐", emoji17Manifest);
  assert.equal(inspectedPremium.name, "🌐");
  assert.equal(inspectedPremium.kind, "root");
  assert.equal(inspectedPremium.tier, "premium");
  assert.equal(inspectedPremium.tokenCount, 1);
  assert.equal(inspectedPremium.isSingleEmoji, true);
  assert.equal(web.rootAuctionPolicy(cap, inspectedPremium).reserve, cap.assets.POA.premiumReserve);
  assert.equal(Object.hasOwn(inspectedPremium, "minimumBidPoa"), false);
  const inspectedMultiEmoji = web.inspectName("🚀🚀", emoji17Manifest);
  assert.equal(inspectedMultiEmoji.name, "🚀🚀");
  assert.equal(inspectedMultiEmoji.tier, "standard");
  assert.equal(inspectedMultiEmoji.tokenCount, 2);
  assert.equal(inspectedMultiEmoji.isMultiEmoji, true);
  assert.equal(web.rootAuctionPolicy(cap, inspectedMultiEmoji).reserve, cap.assets.POA.standardReserve);
  assert.equal(Object.hasOwn(inspectedMultiEmoji, "minimumBidPoa"), false);
  assert.equal(
    web.minimumNextBid("1000", {
      kind: "eos10Percent",
      bps: 1000,
      minUnit: "1",
    }),
    "1101",
  );
  const promptText = await web.buildAgentCartPrompt(
    [
      {
        name: "quantum",
        action: "announceAuction+bid",
        asset:"POA", isRoot:true,
        params:{name:"quantum",asset:"POA",reserve:"100",maxBid:"100",expectedDeedId:null,expectedVersion:0},
        amount: "100",
        tier: "standard",
        note: "Open root auction & place opening bid",
      },
      {
        name: "🌐",
        action: "bid",
        amount: "1321",
        tier: "premium",
        note: "Place ascending bid on live auction",
        asset:"POA",isRoot:true,params:{auctionId:"a".repeat(64),expectedVersion:1,asset:"POA",amount:"1321"},
      },
    ],
    cap,
    c.alice.id,
    "http://127.0.0.1:8787",
    "local-reference-only",
    {state:c.e.snapshot(),stateHash:c.e.stateHash()},
    1000000000,
  );
  assert.match(promptText, /POA DOMAINS REGISTRY CART/);
  assert.match(promptText, /quantum/);
  assert.match(promptText, /1321/);
  assert.match(promptText, /submit_intent/);
});
test("launchable full-stack registry app initializes mainnet profile, serves Unicode 17 emoji domains, and replays from journal across restarts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "poa-app-test-"));
  try {
    const app1 = await startRegistryApp({ dataDir: dir, port: 0 });
    let stateHash1 = "";
    let sequence1 = 0;
    try {
      assert.equal(app1.config.revision, "poa-mainnet-v1");
      assert.equal(app1.config.chainId, "poa-mainnet-1");
      assert.ok(app1.principals.alice!.startsWith("poa1"));
      const healthRes = await fetch(app1.url + "/healthz", {
        headers: { host: "poadomains.grok.me" },
      });
      assert.equal(healthRes.status, 200);
      const health: any = await healthRes.json();
      assert.equal(health.status, "ok");
      assert.equal(health.chainId, "poa-mainnet-1");
      const capRes = await fetch(app1.url + "/v1/capabilities");
      assert.equal(capRes.status, 200);
      const cap: any = await capRes.json();
      assert.equal(cap.emojiAliases, 5216);
      assert.equal(cap.chainId, "poa-mainnet-1");
      assert.equal(cap.reservedCount, 655);
      assert.equal(cap.publicExplorerUrl, "https://poadomains.grok.me");
      assert.equal(cap.newAccountRegistryUnits, "10000000");
      assert.equal(cap.onboardingGrantPoa, "10000000");
      assert.equal(cap.onboardingGrantRegistryUnits, "10000000");
      assert.ok(
        typeof cap.reservedCatalog === "string" &&
          cap.reservedCatalog.split(",").includes("google"),
      );
      const resolveEmoji = await fetch(
        app1.url + "/v1/resolve?name=" + encodeURIComponent("🫪.👩‍🦰"),
      );
      assert.equal(resolveEmoji.status, 200);
      const resolvedChild: any = await resolveEmoji.json();
      assert.equal(resolvedChild.deed.owner, app1.principals.bob);
      const resolveAscii = await fetch(
        app1.url + "/v1/resolve?name=" + encodeURIComponent("nexus"),
      );
      assert.equal(resolveAscii.status, 200);
      const resolvedNexus: any = await resolveAscii.json();
      assert.equal(resolvedNexus.deed.owner, app1.principals.alice);
      assert.equal(resolvedNexus.deed.records.length, 2);
      const snap1 = app1.engine.snapshot();
      assert.equal(
        snap1.auctions[snap1.names["🌐"]!.auctionId!]?.high?.amount,
        "100000",
      );
      assert.equal(
        snap1.auctions[snap1.names["🚀🚀"]!.auctionId!]?.high?.amount,
        "1000",
      );
      assert.ok(Object.keys(snap1.offers).length >= 2);
      assert.ok(Object.keys(snap1.bids).length >= 3);
      const cliPath = resolve("dist/src/reference-cli.js");
      const newKeyPath = join(dir, "new-agent.pem");
      const keygenOut = JSON.parse(
        (
          await execFileAsync(process.execPath, [
            cliPath,
            "keygen",
            "--out",
            newKeyPath,
          ])
        ).stdout,
      );
      assert.ok(keygenOut.principal.startsWith("poa1"));
      const actOut = JSON.parse(
        (
          await execFileAsync(process.execPath, [
            cliPath,
            "act",
            "--url",
            app1.url,
            "--key-file",
            newKeyPath,
            "--action",
            "announceAuction+bid",
            "--params",
            JSON.stringify({
              name: "🔥",
              asset: "POA",
              reserve: "100000",
              maxBid: "100000",
            }),
            "--max-total",
            "100000",
          ])
        ).stdout,
      );
      assert.equal(actOut.status, "succeeded");
      const snapAfterAct = app1.engine.snapshot();
      assert.equal(
        snapAfterAct.auctions[actOut.auctionId]?.high?.amount,
        "100000",
      );
      assert.equal(snapAfterAct.balances[keygenOut.principal]?.POA, "9900000");
      stateHash1 = app1.engine.stateHash();
      sequence1 = snapAfterAct.sequence;
      assert.ok(sequence1 > 0);
    } finally {
      await app1.close();
    }
    const app2 = await startRegistryApp({ dataDir: dir, port: 0 });
    try {
      assert.equal(app2.engine.stateHash(), stateHash1);
      assert.equal(app2.engine.snapshot().sequence, sequence1);
      assert.deepEqual(app2.principals, app1.principals);
    } finally {
      await app2.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
