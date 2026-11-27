import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { nativePrincipal, publicPrincipal } from "../dist/src/auth.js";
import {
  TERMS_DOMAIN,
  TERMS_HASH,
  TERMS_VERSION,
  buildTermsInfo,
  signTermsAgreement,
  verifyTermsAgreement,
} from "../dist/src/terms.js";
import { McpCore } from "../dist/src/mcp-core.js";
import { registryMcpProfile } from "../dist/src/mcp-registry.js";
import { startReferenceServer } from "../dist/src/reference-server.js";
import { request } from "../dist/src/client.js";
import { profileEngine } from "./fixtures/ui-harness.mjs";
import * as termsWorker from "../dist/terms.mjs";
import {
  TERMS_HASH as UI_TERMS_HASH,
  TERMS_VERSION as UI_TERMS_VERSION,
  TERMS_AGREED_KEY,
  buildAgentTermsPrompt,
  hasAgreedToTerms,
  saveTermsAgreement,
} from "../reference-web/shared.js";

function createMemoryTermsStore() {
  const rows = new Map();
  return {
    rows,
    async getTermsAgreement(actor, termsVersion) {
      return rows.get(`${actor}:${termsVersion}`) ?? null;
    },
    async recordTermsAgreement(row) {
      const key = `${row.actor}:${row.termsVersion}`;
      const existing = rows.get(key);
      if (existing && existing.termsHash === row.termsHash) {
        return { record: existing, alreadyAgreed: true };
      }
      rows.set(key, { ...row });
      return { record: { ...row }, alreadyAgreed: false };
    },
  };
}

function mockR2() {
  const store = new Map();
  return {
    store,
    async put(key, value) {
      store.set(key, String(value));
    },
  };
}

test("TERMS_HASH matches exact SHA-256 of reference-web/terms.html and stays synced with UI", () => {
  const html = readFileSync("reference-web/terms.html", "utf8");
  const digest = createHash("sha256").update(html, "utf8").digest("hex");
  assert.equal(TERMS_HASH, digest, "Update TERMS_HASH in src/terms.ts and reference-web/shared.js when terms.html changes");
  assert.equal(UI_TERMS_HASH, TERMS_HASH);
  assert.equal(UI_TERMS_VERSION, TERMS_VERSION);
  assert.match(html, /Public domain profiles/i);
  assert.match(html, /Bug reports &amp; feature requests/i);
  assert.match(html, /POST \/v1\/terms\/agree/);
  assert.match(html, /Domains Treasury/);
});

test("terms worker endpoints verify native poa1 and fixture ed25519 signed agreements, enforce bounds, and archive to R2", async () => {
  const store = createMemoryTermsStore();
  const r2 = mockR2();
  const nowSec = 1_795_550_000;
  const nowMs = nowSec * 1000;
  const env = {
    BACKEND_HOST: "poadomains.link",
    PUBLIC_EXPLORER_URL: "https://poadomains.link",
    PROFILES: r2,
    MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };

  // GET & HEAD /v1/terms
  const infoRes = await termsWorker.handleTermsInfo(
    new Request("https://poadomains.link/v1/terms"),
    env,
    { nowSec: () => nowSec },
  );
  assert.equal(infoRes.status, 200);
  const info = await infoRes.json();
  assert.equal(info.termsVersion, TERMS_VERSION);
  assert.equal(info.termsHash, TERMS_HASH);
  assert.equal(info.termsUrl, "https://poadomains.link/terms");
  assert.equal((await termsWorker.handleTermsInfo(new Request("https://poadomains.link/v1/terms", { method: "HEAD" }), env)).status, 200);
  assert.equal((await termsWorker.handleTermsInfo(new Request("https://evil.invalid/v1/terms"), env)).status, 403);
  assert.equal((await termsWorker.handleTermsInfo(new Request("https://poadomains.link/v1/terms", { method: "POST" }), env)).status, 405);
  assert.equal((await termsWorker.handleTermsInfo(new Request("https://poadomains.link/v1/terms?x=1"), env)).status, 400);

  // Sign with a real native poa1... Ed25519 key
  const { privateKey: nativeKey } = generateKeyPairSync("ed25519");
  const poaActor = nativePrincipal(nativeKey);

  // Status before agreement -> agreed: false
  const beforeRes = await termsWorker.handleTermsStatus(
    new Request(`https://poadomains.link/v1/terms/status?actor=${encodeURIComponent(poaActor)}`),
    env,
    store,
  );
  assert.equal(beforeRes.status, 200);
  assert.equal((await beforeRes.json()).agreed, false);
  assert.equal((await termsWorker.handleTermsStatus(new Request(`https://poadomains.link/v1/terms/status?actor=${encodeURIComponent(poaActor)}`, { method: "HEAD" }), env, store)).status, 200);
  assert.equal((await termsWorker.handleTermsStatus(new Request("https://evil.invalid/v1/terms/status?actor=" + poaActor), env, store)).status, 403);
  assert.equal((await termsWorker.handleTermsStatus(new Request("https://poadomains.link/v1/terms/status?actor=" + poaActor, { method: "POST" }), env, store)).status, 405);
  assert.equal((await termsWorker.handleTermsStatus(new Request("https://poadomains.link/v1/terms/status"), env, store)).status, 400);
  assert.equal((await termsWorker.handleTermsStatus(new Request("https://poadomains.link/v1/terms/status?actor=bad"), env, store)).status, 400);

  const statement = {
    domain: TERMS_DOMAIN,
    chainId: "poa-mainnet-1",
    actor: poaActor,
    termsVersion: TERMS_VERSION,
    termsHash: TERMS_HASH,
    agreed: true,
    agreedAt: nowSec,
  };
  const signed = signTermsAgreement(statement, nativeKey);

  // Submit signed agreement -> 201 + R2 archive
  const agreeRes = await termsWorker.handleTermsAgree(
    new Request("https://poadomains.link/v1/terms/agree", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.9" },
      body: JSON.stringify(signed),
    }),
    env,
    store,
    { nowMs: () => nowMs },
  );
  assert.equal(agreeRes.status, 201);
  const agreeBody = await agreeRes.json();
  assert.equal(agreeBody.ok, true);
  assert.equal(agreeBody.actor, poaActor);
  assert.equal(agreeBody.alreadyAgreed, false);
  assert.equal(r2.store.size, 1);

  // Status after agreement -> agreed: true
  const afterRes = await termsWorker.handleTermsStatus(
    new Request(`https://poadomains.link/v1/terms/status?actor=${encodeURIComponent(poaActor)}`),
    env,
    store,
  );
  const afterBody = await afterRes.json();
  assert.equal(afterBody.agreed, true);
  assert.equal(afterBody.agreedAt, nowSec);

  // Idempotent replay -> 200 alreadyAgreed: true
  const replayRes = await termsWorker.handleTermsAgree(
    new Request("https://poadomains.link/v1/terms/agree", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://poadomains.link" },
      body: JSON.stringify(signed),
    }),
    env,
    store,
    { nowMs: () => nowMs + 5000 },
  );
  assert.equal(replayRes.status, 200);
  assert.equal((await replayRes.json()).alreadyAgreed, true);

  // Fixture ed25519: actor also verifies & malformed branch checks
  const { privateKey: fixKey } = generateKeyPairSync("ed25519");
  const fixActor = publicPrincipal(fixKey);
  const fixSigned = signTermsAgreement(
    { ...statement, chainId: "local:test", actor: fixActor },
    fixKey,
  );
  assert.equal(verifyTermsAgreement(fixSigned, nowSec).statement.actor, fixActor);
  assert.throws(() => verifyTermsAgreement({ statement: { bad: true }, signature: "x" }, nowSec), /TERMS_INVALID_INPUT/);
  assert.throws(() => verifyTermsAgreement({ statement: { ...statement, actor: "not-a-principal" }, signature: "x" }, nowSec), /TERMS_INVALID_INPUT/);
  assert.throws(() => verifyTermsAgreement({ statement: { ...statement, agreed: false }, signature: "x" }, nowSec), /TERMS_INVALID_INPUT/);
  assert.throws(() => verifyTermsAgreement({ statement: { ...statement, chainId: "other-chain" }, signature: "x" }, nowSec), /TERMS_INVALID_INPUT/);
  assert.throws(() => verifyTermsAgreement({ statement: { ...statement, agreedAt: "now" }, signature: "x" }, nowSec), /TERMS_INVALID_INPUT/);
  assert.throws(() => verifyTermsAgreement({ statement: { ...statement, agreedAt: nowSec + 600 }, signature: "x" }, nowSec), /TERMS_EXPIRED/);
  assert.throws(() => verifyTermsAgreement({ statement, signature: "not-base58-0OIl" }, nowSec), /TERMS_SIGNATURE_INVALID/);
  assert.throws(() => verifyTermsAgreement({ statement: fixSigned.statement, signature: "not-hex" }, nowSec), /TERMS_SIGNATURE_INVALID/);
  assert.throws(() => signTermsAgreement(statement, fixKey), /TERMS_SIGNATURE_INVALID/);

  // Invalid signature, version mismatch, expired, bad inputs & HTTP bounds
  const post = (body, hdrs = {}, url = "https://poadomains.link/v1/terms/agree", envOver = env) =>
    termsWorker.handleTermsAgree(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...hdrs },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      envOver,
      store,
      { nowMs: () => nowMs },
    );

  const tampered = structuredClone(signed);
  tampered.statement.agreedAt = nowSec + 1;
  assert.equal((await post(tampered)).status, 400);

  const wrongVersion = signTermsAgreement({ ...statement, termsVersion: "2020-01-01.v0" }, nativeKey);
  const wrongVerRes = await post(wrongVersion);
  assert.equal(wrongVerRes.status, 409);
  assert.equal((await wrongVerRes.json()).code, "TERMS_VERSION_MISMATCH");

  const expired = signTermsAgreement({ ...statement, agreedAt: nowSec - 7200 }, nativeKey);
  const expRes = await post(expired);
  assert.equal(expRes.status, 400);
  assert.equal((await expRes.json()).code, "TERMS_EXPIRED");

  assert.equal((await post(signed, {}, "https://evil.invalid/v1/terms/agree")).status, 403);
  assert.equal((await termsWorker.handleTermsAgree(new Request("https://poadomains.link/v1/terms/agree", { method: "GET" }), env, store)).status, 405);
  assert.equal((await post(signed, {}, "https://poadomains.link/v1/terms/agree?a=1")).status, 400);
  assert.equal((await post(signed, { "content-encoding": "gzip" })).status, 400);
  assert.equal((await post(signed, { origin: "https://evil.invalid" })).status, 403);
  assert.equal((await post(signed, { origin: "not a url" })).status, 403);
  assert.equal((await post(signed, { "content-type": "text/plain" })).status, 400);
  assert.equal((await post(signed, { "content-length": "99999" })).status, 413);
  assert.equal((await post("x".repeat(9000))).status, 413);
  assert.equal((await post("")).status, 400);
  assert.equal((await post("{bad")).status, 400);
  assert.equal((await post({ ...signed, extra: 1 })).status, 400);
  assert.equal((await post(signed, {}, "https://poadomains.link/v1/terms/agree", { ...env, MCP_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
  assert.equal((await post(signed, {}, "https://poadomains.link/v1/terms/agree", { ...env, MCP_RATE_LIMITER: { limit: async () => { throw Error("rl"); } } })).status, 503);
});

test("MCP get_terms and agree_terms work end-to-end against reference server and UI helpers persist versioned agreement", async () => {
  const engine = profileEngine("mainnet");
  const srv = await startReferenceServer(engine, 0);
  try {
    const mcp = new McpCore(
      registryMcpProfile((method, path, query = {}, packet) =>
        request(
          srv.url,
          path + (Object.keys(query).length ? "?" + new URLSearchParams(query) : ""),
          method === "POST" ? packet : undefined,
        ),
      ),
      true,
    );
    const { privateKey } = generateKeyPairSync("ed25519");
    const actor = nativePrincipal(privateKey);

    const callTool = async (id, name, args) => {
      const res = await mcp.handle(
        JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
      );
      return res.result.structuredContent;
    };

    const t1 = await callTool(1, "get_terms", { actor });
    assert.equal(t1.termsVersion, TERMS_VERSION);
    assert.equal(t1.termsHash, TERMS_HASH);
    assert.equal(t1.agreed, false);

    const signed = signTermsAgreement(
      {
        ...t1.statementTemplate,
        actor,
      },
      privateKey,
    );
    const ag = await callTool(2, "agree_terms", signed);
    assert.equal(ag.ok, true);
    assert.equal(ag.actor, actor);
    assert.equal(ag.alreadyAgreed, false);

    const t2 = await callTool(3, "get_terms", { actor });
    assert.equal(t2.agreed, true);
    assert.equal(t2.actor, actor);

    // Local UI storage helpers
    const mem = new Map();
    const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    assert.equal(hasAgreedToTerms(storage), false);
    saveTermsAgreement(storage, actor);
    assert.equal(hasAgreedToTerms(storage), true);
    assert.equal(JSON.parse(mem.get(TERMS_AGREED_KEY)).actor, actor);
    const prompt = buildAgentTermsPrompt({ actor, endpointUrl: "https://poadomains.link" });
    assert.ok(prompt.includes(TERMS_VERSION) && prompt.includes(TERMS_HASH) && prompt.includes(actor));
    assert.ok(buildTermsInfo().summary.includes("custodial POA escrow"));
  } finally {
    await srv.close();
  }
});
