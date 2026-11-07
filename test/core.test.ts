import test from "node:test";
import assert from "node:assert/strict";
import {
  canonical,
  parseJSON,
  MAX_AMOUNT,
  amount,
  bounded,
  hash,
} from "../src/core.js";
import { normalizeName, manifest, NORMALIZATION_HASH } from "../src/names.js";
import { cidFor, metadata, validCid } from "../src/metadata.js";
import { minimumNext } from "../src/config.js";
import { setup, witness } from "./helpers.js";
import { rightsHash } from "../src/model.js";
import { prepare, handoff, capabilities } from "../src/interface.js";
import { intentId, signBody } from "../src/auth.js";

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
});
