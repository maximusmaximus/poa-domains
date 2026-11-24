import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { build } from "esbuild";
import { buildProfileWitness } from "../dist/src/profile.js";
import { nativeAddress } from "../dist/src/native-crypto.js";

const root = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "poa-profiles-storage-"));
await build({
  entryPoints: [join(root, "cloudflare/profiles-storage.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(work, "profiles-storage.mjs"),
});
const { handleMediaUpload, handleMediaGet, backupCommittedProfile } = await import(
  pathToFileURL(join(work, "profiles-storage.mjs")).href
);

test.after(() => {
  rmSync(work, { recursive: true, force: true });
});

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
    MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
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
    { ...baseEnv, MCP_RATE_LIMITER: { limit: async () => ({ success: false }) } },
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
