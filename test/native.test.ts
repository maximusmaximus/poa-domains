import test from "node:test";
import assert from "node:assert/strict";
import { NativeReader, NativeMonitor, NATIVE_ORIGIN, NATIVE_CHAIN, nativeFailure, validateNetworkDocument, OBSERVATION_TTL_MS } from "../src/native.js";
import { publicHttps } from "../src/public-http.js";
import { publicCanonical, parsePublicJSON } from "../src/native-json.js";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { base58, unbase58, nativeAddress, nativeTransferMicros, verifyNativeCheckpointSignatures, signNativeEnvelope, verifyNativeEnvelope } from "../src/native-crypto.js";
const now = 1794088800000;
function status() { return { chain_id: NATIVE_CHAIN, checkpoint: { height: 50, cutoff_ts: 1794088000 }, K: 5, epochs_closed: 56, agents_joined: 120, txs: 100, final: 90 }; }
function facts() { return { chain_id: NATIVE_CHAIN, open_epoch: 56, engine_sha256: "a".repeat(64), params_sha256: "b".repeat(64), economics: { K: 5, unrelated_rate: 0.25 } }; }
function response(value: unknown, status = 200, headers: Record<string, string> = {}) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } }); }
function setup() {
  let s = status(), f = facts(), clock = now;
  const calls: { url: string; init: RequestInit }[] = [];
  const reader = new NativeReader(async (url, init) => { calls.push({ url, init }); return response(url.endsWith("/status") ? s : f); }, () => clock);
  return { reader, calls, get s() { return s; }, get f() { return f; }, set s(value) { s = value; }, set f(value) { f = value; }, advance() { clock += 1000; } };
}

test("real native reader pins documented origin, chain-scoped read-only routes and projects only reported fields", async () => {
  const c = setup(), result = await c.reader.network();
  assert.equal(result.chainId, NATIVE_CHAIN); assert.equal(result.registryReady, false); assert.equal(result.finalityVerified, false);
  assert.equal(result.verification, "node-reported-unverified"); assert.equal(result.expiresAt, now + OBSERVATION_TTL_MS);
  assert.deepEqual(validateNetworkDocument(result, now), result);
  assert.deepEqual(c.calls.map(c => c.url), ["status", "network-facts"].map(path => NATIVE_ORIGIN + "/chain/poa-mainnet-1/api/" + path));
  for (const call of c.calls) { assert.equal(call.init.method, "GET"); assert.equal(call.init.credentials, "omit"); assert.equal(call.init.redirect, "error"); assert.deepEqual(call.init.headers, { accept: "application/json" }); assert.equal(call.init.body, undefined); }
  assert.equal(Object.hasOwn(result, "economics"), false);
});

test("native reader rejects cross-network, inconsistent, future, malformed and unsafe-integer reports", async () => {
  const edits: ((c: ReturnType<typeof setup>) => void)[] = [
    c => c.s.chain_id = "other-chain", c => c.f.chain_id = "other-chain", c => c.f.open_epoch++, c => c.f.economics.K++,
    c => c.s.checkpoint.cutoff_ts = 9999999999, c => c.s.checkpoint.height = 2 ** 53,
    c => c.s.agents_joined = -1, c => c.s.final = c.s.txs + 1, c => c.f.engine_sha256 = "<script>",
  ];
  for (const edit of edits) { const c = setup(); edit(c); await assert.rejects(c.reader.network()); }
});

test("bounded upstream parser rejects duplicate/unsafe/credential keys, deep JSON and numeric overflow without widening registry integers", () => {
  assert.equal(parsePublicJSON('{"rate":0.25}').rate, 0.25);
  for (const value of ['{"chain_id":"a","chain_id":"b"}', '{"__proto__":{}}', '{"privkey":"redacted-test-only"}', '{"n":1e100}', '['.repeat(26) + '0' + ']'.repeat(26), '{"x":NaN}']) assert.throws(() => parsePublicJSON(value));
  assert.throws(() => publicCanonical({ value: undefined }));
  assert.throws(() => publicCanonical({ value: BigInt(1) }));
});

test("native transport rejects redirects, HTML, stale caches, excessive lengths and bodies, and does not expose upstream text", async () => {
  const bad = [
    () => new Response("no", { status: 302, headers: { location: "http://127.0.0.1/" } }),
    () => new Response("<html>hostile</html>", { headers: { "content-type": "text/html" } }),
    () => response(status(), 200, { age: "301" }),
    () => response(status(), 200, { "content-length": "65537" }),
    () => new Response("x".repeat(65537), { headers: { "content-type": "application/json" } }),
    () => new Response('{"chain_id":"poa-mainnet-1","chain_id":"evil"}', { headers: { "content-type": "application/json" } }),
  ];
  for (const make of bad) await assert.rejects(new NativeReader(async () => make(), () => now).network());
  assert.deepEqual(nativeFailure(new Error("hostile upstream text")), { kind: "native-network-unavailable", code: "NATIVE_READ_FAILED", registryReady: false, finalityVerified: false });
});

test("native unknown/included/rejected receipts never assert finality or authorize resubmission", async () => {
  const id = "c".repeat(64);
  for (const state of [null, { status: "included", checkpoint_covered: true, valid_in_open_window: false }, { status: "rejected", next_nonce: 4 }]) {
    const reader = new NativeReader(async () => state === null ? new Response(null, { status: 404 }) : response(state), () => now);
    const result = await reader.receipt(id);
    assert.equal(result.reportedStatus, state?.status ?? "unknown"); assert.equal(result.finalityVerified, false); assert.equal(result.safeToResubmit, false); assert.equal(result.submitted, false);
  }
  for (const value of [{ status: "success" }, { status: "included", txid: "d".repeat(64) }, { status: "included", chain_id: "evil" }, { status: "included", checkpoint_covered: "true" }]) await assert.rejects(new NativeReader(async () => response(value), () => now).receipt(id));
  let calls = 0;
  const reader = new NativeReader(async () => { calls++; return response({}); });
  for (const bad of ["../status", "https://127.0.0.1/", "a".repeat(63), "a".repeat(64) + "?key=x", "A".repeat(64)]) await assert.rejects(reader.receipt(bad));
  assert.equal(calls, 0);
});

test("native monitor coalesces races and latches rollback/release incidents without trusting later apparent recovery", async () => {
  for (const field of ["height", "cutoffTs", "epoch", "engine", "params"]) {
    const c = setup(), monitor = new NativeMonitor(c.reader);
    await Promise.all([monitor.observe(), monitor.observe(), monitor.observe()]); assert.equal(c.calls.length, 2);
    c.advance();
    if (field === "height") c.s.checkpoint.height--;
    if (field === "cutoffTs") c.s.checkpoint.cutoff_ts++;
    if (field === "epoch") { c.s.epochs_closed--; c.f.open_epoch--; }
    if (field === "engine") c.f.engine_sha256 = "d".repeat(64);
    if (field === "params") c.f.params_sha256 = "d".repeat(64);
    await assert.rejects(monitor.observe(), /NATIVE_(ROLLBACK_DETECTED|RELEASE_DRIFT)/);
    c.s = status(); c.f = facts();
    const before = c.calls.length;
    await assert.rejects(monitor.observe()); assert.equal(c.calls.length, before);
  }
});

test("native observation documents expire and reject forged ready flags or injected fields", async () => {
  const value = await setup().reader.network();
  assert.throws(() => validateNetworkDocument(value, now + OBSERVATION_TTL_MS + 1), /STALE/);
  for (const edit of [{ registryReady: true }, { finalityVerified: true }, { source: "http://127.0.0.1" }, { balances: {} }, { observedAt: now + 9999999 }]) assert.throws(() => validateNetworkDocument({ ...value, ...edit }, now));
  assert.throws(() => validateNetworkDocument({ kind: "native-network-unavailable", code: "<script>", registryReady: false, finalityVerified: false }, now));
});

function keys() { const pair = generateKeyPairSync("ed25519"); return { ...pair, address: nativeAddress(pair.publicKey.export({ format: "der", type: "spki" }).subarray(12)) }; }
function unsigned(address: string) { return { type: "transfer", from: address, to: address, amount: "0.000001", nonce: 1, ts: 1794088000, parents: [], cid: NATIVE_CHAIN }; }

test("native wire canonicalization/hash/signature are compatible, without asserting native transaction validity", async () => {
  const k = keys(), data = unsigned(k.address), message = publicCanonical(data);
  assert.equal(publicCanonical({ z: [true, 0.25], a: "v" }), '{"a":"v","z":[true,0.25]}');
  const result = await signNativeEnvelope(data, NATIVE_CHAIN, { address: k.address, sign: async bytes => sign(null, bytes, k.privateKey) });
  assert.equal(result.txid, createHash("sha256").update(message).digest("hex"));
  assert.deepEqual(verifyNativeEnvelope(result.body, { chainId: NATIVE_CHAIN, txid: result.txid }), { txid: result.txid, chainId: NATIVE_CHAIN, signer: k.address, signatureValid: true, protocolValidityVerified: false, finalityVerified: false });
  assert.equal(result.submitted, false);
  // Verification never loads nonce, balance, PoW or finality from a fabricated ledger.
});

test("native signatures reject forgery, cross-chain replay, body/hash changes and wrong callback signers", async () => {
  const k = keys(), other = keys(), result = await signNativeEnvelope(unsigned(k.address), NATIVE_CHAIN, { address: k.address, sign: async bytes => sign(null, bytes, k.privateKey) });
  for (const body of [{ ...result.body, amount: "2" }, { ...result.body, sig: base58(new Uint8Array(64)) }, { ...result.body, from: other.address }]) assert.throws(() => verifyNativeEnvelope(body, { chainId: NATIVE_CHAIN, txid: result.txid }));
  assert.throws(() => verifyNativeEnvelope(result.body, { chainId: "other-chain", txid: result.txid }), /CHAIN/);
  assert.throws(() => verifyNativeEnvelope(result.body, { chainId: NATIVE_CHAIN, txid: "f".repeat(64) }), /TXID/);
  await assert.rejects(signNativeEnvelope(unsigned(k.address), NATIVE_CHAIN, { address: k.address, sign: async bytes => sign(null, bytes, other.privateKey) }), /SIGNATURE/);
  await assert.rejects(signNativeEnvelope(unsigned(k.address), NATIVE_CHAIN, { address: other.address, sign: async () => new Uint8Array(64) }), /SIGNER/);
});

test("native signer snapshots caller intent across asynchronous signing and rejects missing explicit ordering data", async () => {
  const k = keys(), data = unsigned(k.address);
  const result = await signNativeEnvelope(data, NATIVE_CHAIN, { address: k.address, sign: async bytes => { data.amount = "9"; return sign(null, bytes, k.privateKey); } });
  assert.equal(result.body.amount, "0.000001");
  for (const edit of [{ cid: "other" }, { nonce: 0 }, { nonce: 2 ** 53 }, { ts: -1 }, { parents: ["bad"] }, { sig: "existing" }]) await assert.rejects(signNativeEnvelope({ ...data, ...edit }, NATIVE_CHAIN, { address: k.address, sign: async () => new Uint8Array(64) }));
});

test("native Base58 property roundtrips zero-prefixed public bytes, rejects invalid alphabet/length, and never accepts private data fields", () => {
  for (let i = 0; i < 256; i++) { const bytes = createHash("sha256").update(String(i)).digest(); bytes[0] = i % 3 ? bytes[0]! : 0; assert.deepEqual(unbase58(base58(bytes), 32), bytes); }
  assert.deepEqual(unbase58(base58(Buffer.alloc(32)), 32), Buffer.alloc(32));
  for (const bad of ["0", "O", "I", "l", "1".repeat(33)]) assert.throws(() => unbase58(bad, 32));
  assert.throws(() => publicCanonical({ privkey: "test-only-not-a-key" }), /SECRET/);
});


test("native transfer signer supports only the explicit documented transfer subset, exact 6dp strings, and no naming operations", async () => {
  assert.equal(nativeTransferMicros("9007199254740993.000001"), 9007199254740993000001n);
  for (const bad of [1.5, "0", "0.0000001", "1e6", "01", "1.0000000", "9".repeat(39)]) assert.throws(() => nativeTransferMicros(bad));
  const k = keys(); let signed = false;
  for (const edit of [{ type: "announceAuction" }, { to: "invalid" }, { amount: "0.0000001" }, { privateKey: "test-only-not-a-key" }]) await assert.rejects(signNativeEnvelope({ ...unsigned(k.address), ...edit }, NATIVE_CHAIN, { address: k.address, sign: async () => { signed = true; return new Uint8Array(64); } }));
  assert.equal(signed, false);
});


test("native checkpoint evidence validates exact trusted signers and quorum, never infers chain binding, root computation or external anchors", () => {
  const signers = [keys(), keys(), keys()], root = "a".repeat(64), height = 50;
  const sigs = signers.map(k => { const body = { type: "checkpoint-sig", root, height, verifier: k.address }; return { ...body, sig: base58(sign(null, Buffer.from(publicCanonical(body)), k.privateKey)) }; });
  const policy = { chainId: NATIVE_CHAIN, expectedRoot: root, expectedHeight: height, trustedVerifiers: signers.map(k => k.address), threshold: 2 };
  const result = verifyNativeCheckpointSignatures({ state_root: root, height, sigs }, policy);
  assert.equal(result.validTrustedSignatures, 3); assert.equal(result.quorumSatisfied, true);
  for (const field of ["networkBindingVerified", "stateRootVerified", "externalAnchorsVerified", "finalityVerified"] as const) assert.equal(result[field], false);
  assert.equal(verifyNativeCheckpointSignatures({ state_root: root, height, sigs: sigs.slice(0, 1) }, policy).quorumSatisfied, false);
  for (const bad of [[sigs[0], sigs[0]], [{ ...sigs[0], height: height + 1 }], [{ ...sigs[0], sig: base58(Buffer.alloc(64)) }]]) assert.throws(() => verifyNativeCheckpointSignatures({ state_root: root, height, sigs: bad }, policy));
  assert.throws(() => verifyNativeCheckpointSignatures({ state_root: root, height, sigs }, { ...policy, threshold: 0 }));
  assert.throws(() => verifyNativeCheckpointSignatures({ state_root: root, height, sigs }, { ...policy, trustedVerifiers: [signers[0]!.address] }));
});

test("standard public HTTPS transport rejects arbitrary endpoints/SSRF and writes before any process/network call", () => {
  const get: RequestInit = { method: "GET", credentials: "omit", redirect: "error" };
  for (const url of ["http://127.0.0.1/", "https://minepoa.com.evil/chain/poa-mainnet-1/api/status", "https://minepoa.com/api/hosted/register", "https://minepoa.com/chain/poa-mainnet-1/api/status?key=test", "https://minepoa.com/chain/poa-mainnet-1/api/receipt/../status", "https://user:pass@minepoa.com/chain/poa-mainnet-1/api/status"]) assert.throws(() => publicHttps(url, get), /NATIVE_ROUTE/);
  assert.throws(() => publicHttps("https://minepoa.com/chain/poa-mainnet-1/api/status", { ...get, method: "POST" }), /NATIVE_TRANSPORT/);
});


test("native transport caps concurrent upstream work without racing the active counter", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  const reader = new NativeReader(async url => { await gate; return response(url.endsWith("/status") ? status() : facts()); }, () => now);
  const requests = [reader.network(), reader.network(), reader.network(), reader.network()];
  await assert.rejects(reader.network(), /NATIVE_BUSY/);
  release(); await Promise.all(requests);
  assert.equal((await reader.network()).registryReady, false);
});
