import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { buildProfileWitness } from "../dist/src/profile.js";
import { nativeAddress } from "../dist/src/native-crypto.js";
import {
  handleMediaUpload,
  handleMediaGet,
  backupCommittedProfile,
  pinBytesToPinata,
  checkHourlyUploadCaps,
  MEDIA_UPLOAD_HOURLY_PER_CLIENT,
  MEDIA_UPLOAD_HOURLY_GLOBAL,
} from "../dist/profiles-storage.mjs";

function mockR2() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts = {}) {
      const buf = value instanceof Uint8Array ? new Uint8Array(value) : new TextEncoder().encode(String(value));
      store.set(key, {
        body: buf,
        size: buf.byteLength,
        httpMetadata: opts.httpMetadata ?? {},
        customMetadata: opts.customMetadata ?? {},
      });
    },
    async head(key) {
      const item = store.get(key);
      if (!item) return null;
      return { size: item.size, httpMetadata: item.httpMetadata, customMetadata: item.customMetadata };
    },
    async get(key) {
      const item = store.get(key);
      if (!item) return null;
      return {
        body: new Uint8Array(item.body),
        async text() {
          return new TextDecoder().decode(item.body);
        },
        size: item.size,
        httpMetadata: item.httpMetadata,
        customMetadata: item.customMetadata,
      };
    },
  };
}

// Valid minimal PNG header + bytes
const SAMPLE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

test("handleMediaUpload validates binary & JSON base64 uploads, stores in R2, pins to Pinata, and serves via handleMediaGet", async () => {
  const r2 = mockR2();
  const pinataCalls = [];
  const mockFetch = async (url, init) => {
    pinataCalls.push({ url, auth: init.headers.authorization });
    return Response.json({ IpfsHash: "bafkreipinatatest1234567890" }, { status: 200 });
  };
  const env = {
    PROFILES: r2,
    BACKEND_HOST: "poadomains.grok.me",
    PUBLIC_EXPLORER_URL: "https://poadomains.grok.me",
    PINATA_JWT: "test-pinata-jwt",
    MEDIA_UPLOAD_LIMITER: { limit: async () => ({ success: true }) },
  };

  // Raw PNG binary upload from allowed origin
  const req1 = new Request("https://poadomains.grok.me/v1/media/upload", {
    method: "POST",
    headers: {
      "content-type": "image/png",
      origin: "https://poadomains.grok.me",
      "cf-connecting-ip": "203.0.113.5",
    },
    body: SAMPLE_PNG,
  });
  const res1 = await handleMediaUpload(req1, env, mockFetch);
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.contentType, "image/png");
  assert.equal(body1.r2Stored, true);
  assert.equal(body1.ipfsPinned, true);
  assert.equal(body1.pinataCid, "bafkreipinatatest1234567890");
  assert.equal(body1.uri, `ipfs://${body1.cid}`);
  assert.equal(body1.mediaUrl, `/v1/media/${body1.cid}`);
  assert.equal(pinataCalls.length, 1);

  // JSON base64 upload (agent/CLI friendly, no Origin header) -> same deterministic CID
  const req2 = new Request("https://poadomains.grok.me/v1/media/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contentType: "image/png",
      dataBase64: Buffer.from(SAMPLE_PNG).toString("base64"),
    }),
  });
  const res2 = await handleMediaUpload(req2, { ...env, PINATA_JWT: "" });
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.cid, body1.cid);
  assert.equal(body2.ipfsPinned, false);
  assert.equal(body2.r2Stored, true);

  // Serve via GET and HEAD
  const getRes = await handleMediaGet(new Request(`https://poadomains.grok.me/v1/media/${body1.cid}`), env, body1.cid);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers.get("content-type"), "image/png");
  assert.match(getRes.headers.get("cache-control"), /immutable/);
  assert.deepEqual(new Uint8Array(await getRes.arrayBuffer()), SAMPLE_PNG);

  const headRes = await handleMediaGet(new Request(`https://poadomains.grok.me/v1/media/${body1.cid}`, { method: "HEAD" }), env, body1.cid);
  assert.equal(headRes.status, 200);
  assert.equal(headRes.headers.get("content-length"), String(SAMPLE_PNG.byteLength));
});

test("handleMediaUpload enforces origin, format, size, rate-limit, and storage guards", async () => {
  const r2 = mockR2();
  const baseEnv = {
    PROFILES: r2,
    BACKEND_HOST: "poadomains.grok.me",
    PUBLIC_EXPLORER_URL: "https://poadomains.grok.me",
    MEDIA_UPLOAD_LIMITER: { limit: async () => ({ success: true }) },
  };

  // Untrusted Origin -> 403
  const badOrigin = await handleMediaUpload(
    new Request("https://poadomains.grok.me/v1/media/upload", {
      method: "POST",
      headers: { "content-type": "image/png", origin: "https://evil.example" },
      body: SAMPLE_PNG,
    }),
    baseEnv,
  );
  assert.equal(badOrigin.status, 403);

  // Missing PROFILES binding -> 503 MEDIA_STORAGE_DISABLED
  const noStorage = await handleMediaUpload(
    new Request("https://poadomains.grok.me/v1/media/upload", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: SAMPLE_PNG,
    }),
    { BACKEND_HOST: "poadomains.grok.me" },
  );
  assert.equal(noStorage.status, 503);
  assert.equal((await noStorage.json()).code, "MEDIA_STORAGE_DISABLED");

  // Rate limited -> 429 MEDIA_RATE_LIMITED
  const limited = await handleMediaUpload(
    new Request("https://poadomains.grok.me/v1/media/upload", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: SAMPLE_PNG,
    }),
    { ...baseEnv, MEDIA_UPLOAD_LIMITER: { limit: async () => ({ success: false }) } },
  );
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, "MEDIA_RATE_LIMITED");

  // Spoofed SVG declared as image/png -> 400 INVALID_IMAGE_FORMAT
  const spoofed = await handleMediaUpload(
    new Request("https://poadomains.grok.me/v1/media/upload", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    }),
    baseEnv,
  );
  assert.equal(spoofed.status, 400);
  assert.equal((await spoofed.json()).code, "INVALID_IMAGE_FORMAT");

  // Oversized content-length > 5 MiB -> 413 IMAGE_TOO_LARGE
  const oversized = await handleMediaUpload(
    new Request("https://poadomains.grok.me/v1/media/upload", {
      method: "POST",
      headers: { "content-type": "image/png", "content-length": String(6 * 1024 * 1024) },
      body: SAMPLE_PNG,
    }),
    baseEnv,
  );
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "IMAGE_TOO_LARGE");

  // Malformed CID on GET -> 400
  const badCid = await handleMediaGet(new Request("https://poadomains.grok.me/v1/media/not-a-cid"), baseEnv, "not-a-cid");
  assert.equal(badCid.status, 400);
});

test("backupCommittedProfile backs up v1 profile JSON to R2 and optionally pins to Pinata", async () => {
  const r2 = mockR2();
  const owner = nativeAddress(randomBytes(32));
  const witness = buildProfileWitness({
    name: "moon",
    rightsHash: "a".repeat(64),
    poa: owner,
    btc: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    eth: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    description: "Public profile backup test",
  });
  let pinnedCount = 0;
  const mockFetch = async () => {
    pinnedCount++;
    return Response.json({ IpfsHash: "bafkreiprofilepin123" }, { status: 200 });
  };
  const env = {
    PROFILES: r2,
    BACKEND_HOST: "poadomains.grok.me",
    PINATA_JWT: "test-jwt",
  };
  const packet = {
    body: {
      action: "setMetadata",
      params: { name: "moon", metadata: witness },
    },
  };
  const receipt = { status: "succeeded", result: { metadataVersion: 2 } };
  const result = await backupCommittedProfile(env, packet, receipt, mockFetch);
  assert.equal(result.backedUp, true);
  assert.equal(result.ipfsPinned, true);
  assert.equal(result.cid, witness.cid);
  assert.equal(pinnedCount, 1);
  assert.ok(r2.store.has(`v1/profiles/by-cid/${witness.cid}.json`));
  assert.ok(r2.store.has(`v1/profiles/by-name/moon/v2-${witness.cid}.json`));
  assert.ok(r2.store.has(`v1/profiles/by-name/moon/latest.json`));

  // Non-profile actions are ignored
  const ignored = await backupCommittedProfile(env, { body: { action: "transfer", params: {} } }, receipt, mockFetch);
  assert.equal(ignored.backedUp, false);
  assert.equal(pinnedCount, 1);
});

const GROUP = "8c21bf28-7ce3-4282-a200-d9e7f50dcedc";
const uploadReq = (ip = "198.51.100.7") =>
  new Request("https://poadomains.grok.me/v1/media/upload", {
    method: "POST",
    headers: { "content-type": "image/png", "cf-connecting-ip": ip },
    body: SAMPLE_PNG,
  });

test("pinBytesToPinata uses redirect manual, a File part, and the configured Pinata group", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ IpfsHash: "bafkreigrouped" }, { status: 200 });
  };
  const env = { BACKEND_HOST: "x", PINATA_JWT: "jwt-value", PINATA_GROUP_ID: GROUP };
  const out = await pinBytesToPinata(SAMPLE_PNG, "poadomains-media-x", "image/png", env, fetchImpl, () => assert.fail("no log on success"));
  assert.deepEqual(out, { pinned: true, pinataCid: "bafkreigrouped" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.pinata.cloud/pinning/pinFileToIPFS");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.method, "POST");
  const form = calls[0].init.body;
  assert.deepEqual(JSON.parse(form.get("pinataOptions")), { cidVersion: 1, groupId: GROUP });
  const file = form.get("file");
  assert.equal(file.name, "poadomains-media-x");
  assert.equal(file.type, "image/png");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), SAMPLE_PNG);

  // Missing or malformed group id: pin still goes through, without a group.
  for (const PINATA_GROUP_ID of [undefined, "not-a-uuid"]) {
    calls.length = 0;
    await pinBytesToPinata(SAMPLE_PNG, "f", "image/png", { ...env, PINATA_GROUP_ID }, fetchImpl);
    assert.deepEqual(JSON.parse(calls[0].init.body.get("pinataOptions")), { cidVersion: 1 });
  }

  // No JWT -> no request at all.
  calls.length = 0;
  assert.deepEqual(await pinBytesToPinata(SAMPLE_PNG, "f", "image/png", { BACKEND_HOST: "x" }, fetchImpl), { pinned: false });
  assert.equal(calls.length, 0);
});

test("pin failures log only status and Pinata's error code/message, never the JWT or headers", async () => {
  const jwt = "secret-jwt-abc.def.ghi";
  const env = { BACKEND_HOST: "x", PINATA_JWT: jwt, PINATA_GROUP_ID: GROUP };
  const cases = [
    [async () => Response.json({ error: { reason: "INVALID_CREDENTIALS", details: "Bad key " + jwt } }, { status: 401 }),
      { status: 401, code: "INVALID_CREDENTIALS", message: "Bad key [redacted]" }],
    [async () => Response.json({ error: "Invalid request format." }, { status: 400 }), { status: 400, message: "Invalid request format." }],
    [async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }), { status: 302 }],
    [async () => { throw new TypeError("Invalid redirect value"); }, { status: 0, code: "TypeError", message: "Invalid redirect value" }],
    [async () => Response.json({ ok: true }, { status: 200 }), { status: 200, code: "NO_IPFS_HASH" }],
  ];
  for (const [fetchImpl, expected] of cases) {
    const logs = [];
    const out = await pinBytesToPinata(SAMPLE_PNG, "poadomains-media-x", "image/png", env, fetchImpl, (e) => logs.push(e));
    assert.deepEqual(out, { pinned: false });
    assert.equal(logs.length, 1);
    const entry = logs[0];
    assert.equal(entry.event, "pinata_pin_failed");
    assert.equal(entry.filename, "poadomains-media-x");
    for (const [k, v] of Object.entries(expected)) assert.equal(entry[k], v, k);
    const text = JSON.stringify(entry);
    assert.ok(!text.includes(jwt), "jwt never logged");
    assert.ok(!/authorization|bearer|location/i.test(text), "no headers logged");
    assert.deepEqual(Object.keys(entry).filter((k) => !["event", "filename", "status", "code", "message"].includes(k)), []);
  }
});

test("upload endpoint has its own per-minute limiter and fails closed without it", async () => {
  const env = { PROFILES: mockR2(), BACKEND_HOST: "poadomains.grok.me" };
  const missing = await handleMediaUpload(uploadReq(), env);
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).code, "MEDIA_RATE_UNAVAILABLE");

  const broken = await handleMediaUpload(uploadReq(), { ...env, MEDIA_UPLOAD_LIMITER: { limit: async () => { throw Error("down"); } } });
  assert.equal(broken.status, 503);

  const keys = [];
  const limited = await handleMediaUpload(uploadReq("192.0.2.9"), {
    ...env,
    MEDIA_UPLOAD_LIMITER: { limit: async ({ key }) => (keys.push(key), { success: false }) },
    MCP_RATE_LIMITER: { limit: async () => assert.fail("general MCP limiter is not used for uploads") },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal((await limited.json()).code, "MEDIA_RATE_LIMITED");
  assert.deepEqual(keys, ["poa-domains:media:192.0.2.9"]);
  assert.equal(env.PROFILES.store.size, 0, "nothing stored when limited");
});

test("hourly caps: per client and global, with Retry-After to the next hour and no raw IPs stored", async () => {
  const r2 = mockR2();
  const now = Date.UTC(2026, 10, 24, 5, 59, 30);
  const env = { PROFILES: r2, BACKEND_HOST: "poadomains.grok.me", MEDIA_UPLOAD_LIMITER: { limit: async () => ({ success: true }) } };
  for (let i = 0; i < MEDIA_UPLOAD_HOURLY_PER_CLIENT; i++) {
    const ok = await handleMediaUpload(uploadReq("203.0.113.50"), env, undefined, () => now);
    assert.equal(ok.status, 200, "upload " + i);
  }
  const over = await handleMediaUpload(uploadReq("203.0.113.50"), env, undefined, () => now);
  assert.equal(over.status, 429);
  assert.equal((await over.json()).code, "MEDIA_HOURLY_LIMITED");
  assert.equal(over.headers.get("retry-after"), "30");
  // Another client is still allowed this hour; the same client is allowed next hour.
  assert.equal((await handleMediaUpload(uploadReq("203.0.113.51"), env, undefined, () => now)).status, 200);
  assert.equal((await handleMediaUpload(uploadReq("203.0.113.50"), env, undefined, () => now + 60_000)).status, 200);
  for (const key of r2.store.keys()) assert.ok(!key.includes("203.0.113"), "raw IP not in key: " + key);

  // Global cap across clients.
  const g = mockR2();
  for (let i = 0; i < MEDIA_UPLOAD_HOURLY_GLOBAL; i++) assert.deepEqual(await checkHourlyUploadCaps(g, "10.0.0." + (i % 250), now), { limited: false });
  const globalOver = await checkHourlyUploadCaps(g, "10.9.9.9", now);
  assert.equal(globalOver.limited, true);

  // Counter storage failure fails closed.
  const failing = { ...mockR2(), get: async () => { throw Error("r2 down"); } };
  const down = await handleMediaUpload(uploadReq(), { ...env, PROFILES: failing }, undefined, () => now);
  assert.equal(down.status, 503);
  assert.equal((await down.json()).code, "MEDIA_RATE_UNAVAILABLE");
});
