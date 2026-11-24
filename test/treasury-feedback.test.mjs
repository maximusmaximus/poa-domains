import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "poa-treasury-feedback-"));
await build({
  entryPoints: [
    join(root, "cloudflare/treasury.ts"),
    join(root, "cloudflare/feedback.ts"),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: work,
  outExtension: { ".js": ".mjs" },
});
const treasury = await import(pathToFileURL(join(work, "treasury.mjs")).href);
const feedback = await import(pathToFileURL(join(work, "feedback.mjs")).href);

test.after(() => {
  rmSync(work, { recursive: true, force: true });
});

const ESCROW_ADDR = "poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf";
const TREASURY_ADDR = "poa1GHppB8pYZ43gK8yBzR1RJhzfWjzrJn29q96ykwngUP7N";

async function solvePowLocal(salt, bits) {
  for (let n = 0; n < 500000; n++) {
    if (await feedback.verifyPow(salt, String(n), bits)) return String(n);
  }
  throw Error("pow failed");
}

function createMemoryFeedbackStore() {
  const challenges = new Map();
  const events = [];
  return {
    challenges,
    events,
    async createFeedbackChallenge(row) {
      challenges.set(row.id, { ...row, used: 0 });
      return { ok: true };
    },
    async getFeedbackChallengeMeta(id, now) {
      const r = challenges.get(id);
      if (!r || r.used !== 0 || r.expiresAt <= now) return null;
      return { powSalt: r.powSalt, powBits: r.powBits, svg: r.svg };
    },
    async consumeFeedbackChallenge(input) {
      const r = challenges.get(input.id);
      if (!r || r.used !== 0 || r.expiresAt <= input.now || r.ipHash !== input.ipHash) {
        return { ok: false, code: "FEEDBACK_CAPTCHA_EXPIRED" };
      }
      if (input.now - r.createdAt < input.minDwellMs) {
        return { ok: false, code: "FEEDBACK_TOO_FAST" };
      }
      r.used = 1;
      r.svg = "";
      if (r.answerHash !== input.answerHash) {
        return { ok: false, code: "FEEDBACK_CAPTCHA_INVALID" };
      }
      const recent = events.filter((e) => e.createdAt > input.now - 24 * 60 * 60_000);
      if (recent.filter((e) => e.ipHash === input.ipHash && e.createdAt > input.now - 60 * 60_000).length >= 3) {
        return { ok: false, code: "FEEDBACK_RATE_LIMITED", retryAfterSec: 1800 };
      }
      if (recent.some((e) => e.contentHash === input.contentHash)) {
        return { ok: false, code: "FEEDBACK_DUPLICATE" };
      }
      events.push({ ...input, createdAt: input.now });
      return { ok: true, powSalt: r.powSalt, powBits: r.powBits };
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

test("treasury reader sums escrow + treasury balances, builds POAScan links, caches, and serves stale on 503", async () => {
  let clock = 1_700_000_000_000;
  let mode = "ok";
  let calls = 0;
  const mockFetch = async (url) => {
    calls++;
    const u = String(url);
    if (mode === "busy") return new Response("busy", { status: 503 });
    if (u.includes(ESCROW_ADDR)) {
      return Response.json({ address: ESCROW_ADDR, balance: "201.000000" });
    }
    if (u.includes(TREASURY_ADDR)) {
      return Response.json({ address: TREASURY_ADDR, balance: "15.500000" });
    }
    return new Response("not found", { status: 404 });
  };
  const reader = treasury.createTreasuryReader({ fetch: mockFetch, now: () => clock });
  const env = { BACKEND_HOST: "poadomains.grok.me" };
  const addrs = async () => ({ escrow: ESCROW_ADDR, treasury: TREASURY_ADDR });

  const r1 = await treasury.handleTreasuryRequest(
    new Request("https://poadomains.grok.me/v1/treasury"),
    env,
    addrs,
    reader,
  );
  assert.equal(r1.status, 200);
  const b1 = await r1.json();
  assert.equal(b1.total, "216.500000");
  assert.equal(b1.stale, false);
  assert.equal(b1.poascanHomeUrl, "https://poascan.io/");
  assert.equal(b1.escrow.address, ESCROW_ADDR);
  assert.equal(b1.escrow.balance, "201.000000");
  assert.equal(b1.escrow.poascanUrl, `https://poascan.io/address/${ESCROW_ADDR}`);
  assert.equal(b1.treasury.address, TREASURY_ADDR);
  assert.equal(b1.treasury.balance, "15.500000");
  assert.equal(b1.treasury.poascanUrl, `https://poascan.io/address/${TREASURY_ADDR}`);
  assert.equal(calls, 2);

  // Within 60s cache window -> zero extra upstream fetches
  clock += 10_000;
  const r2 = await treasury.handleTreasuryRequest(
    new Request("https://poadomains.grok.me/v1/treasury"),
    env,
    addrs,
    reader,
  );
  assert.equal((await r2.json()).total, "216.500000");
  assert.equal(calls, 2);

  // After 60s when minepoa.com is 503 busy -> retains last-known balances with stale: true
  clock += 65_000;
  mode = "busy";
  const r3 = await treasury.handleTreasuryRequest(
    new Request("https://poadomains.grok.me/v1/treasury"),
    env,
    addrs,
    reader,
  );
  const b3 = await r3.json();
  assert.equal(b3.total, "216.500000");
  assert.equal(b3.stale, true);

  // HEAD works, POST returns 405
  const rHead = await treasury.handleTreasuryRequest(
    new Request("https://poadomains.grok.me/v1/treasury", { method: "HEAD" }),
    env,
    addrs,
    reader,
  );
  assert.equal(rHead.status, 200);
  const rPost = await treasury.handleTreasuryRequest(
    new Request("https://poadomains.grok.me/v1/treasury", { method: "POST" }),
    env,
    addrs,
    reader,
  );
  assert.equal(rPost.status, 405);
});

test("feedback challenge renders CSP-safe SVG, enforces anti-abuse guards, sanitizes markdown, and posts GitHub issue", async () => {
  const store = createMemoryFeedbackStore();
  const r2 = mockR2();
  let clock = 1_700_000_000_000;
  const ghCalls = [];
  const mockFetch = async (url, init) => {
    ghCalls.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization });
    return Response.json(
      { number: 113, html_url: "https://github.com/maximusmaximus/poa-domains/issues/113" },
      { status: 201 },
    );
  };
  const env = {
    BACKEND_HOST: "poadomains.grok.me",
    PUBLIC_EXPLORER_URL: "https://poadomains.grok.me",
    FEEDBACK_GITHUB_TOKEN: "test-gh-token-for-unit-only",
    PROFILES: r2,
    MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };

  async function issueChallenge() {
    const chRes = await feedback.handleFeedbackChallenge(
      new Request("https://poadomains.grok.me/v1/feedback/challenge", {
        headers: { origin: "https://poadomains.grok.me", "cf-connecting-ip": "198.51.100.7" },
      }),
      env,
      store,
      { now: () => clock, powBits: 6, minDwellMs: 3000 },
    );
    assert.equal(chRes.status, 200);
    const ch = await chRes.json();
    const svgRes = await feedback.handleFeedbackCaptcha(
      new Request(`https://poadomains.grok.me${ch.captchaUrl}`),
      env,
      store,
      ch.challengeId,
      { now: () => clock },
    );
    assert.equal(svgRes.status, 200);
    assert.match(svgRes.headers.get("content-type"), /image\/svg\+xml/);
    const svg = await svgRes.text();
    assert.ok(!svg.includes("<script") && !svg.includes("style="), "SVG must be CSP-safe");
    const code = [...svg.matchAll(/<text[^>]*>([A-Z0-9])<\/text>/g)].map((m) => m[1]).join("");
    assert.equal(code.length, 5);
    return { ch, code };
  }

  // 1. Too-fast submission rejected
  const c1 = await issueChallenge();
  const nonce1 = await solvePowLocal(c1.ch.powSalt, c1.ch.powBits);
  const fastRes = await feedback.handleFeedbackSubmit(
    new Request("https://poadomains.grok.me/v1/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://poadomains.grok.me",
        "cf-connecting-ip": "198.51.100.7",
      },
      body: JSON.stringify({
        kind: "bug",
        title: "Search button glitch",
        details: "When I tap check on mobile it flickers briefly.",
        poaAddress: ESCROW_ADDR,
        challengeId: c1.ch.challengeId,
        captchaAnswer: c1.code,
        powNonce: nonce1,
      }),
    }),
    env,
    store,
    { fetch: mockFetch, now: () => clock + 500, minDwellMs: 3000 },
  );
  assert.equal(fastRes.status, 400);
  assert.equal((await fastRes.json()).code, "FEEDBACK_TOO_FAST");

  // 2. Honeypot filled -> rejected
  clock += 4000;
  const hpRes = await feedback.handleFeedbackSubmit(
    new Request("https://poadomains.grok.me/v1/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://poadomains.grok.me",
        "cf-connecting-ip": "198.51.100.7",
      },
      body: JSON.stringify({
        kind: "bug",
        title: "Spam bot entry",
        details: "Automated bot filled the hidden honeypot field.",
        website: "https://spam.invalid",
        challengeId: c1.ch.challengeId,
        captchaAnswer: c1.code,
        powNonce: nonce1,
      }),
    }),
    env,
    store,
    { fetch: mockFetch, now: () => clock, minDwellMs: 3000 },
  );
  assert.equal(hpRes.status, 400);
  assert.equal((await hpRes.json()).code, "FEEDBACK_INVALID_INPUT");

  // 3. Secret-like text rejected
  const secretRes = await feedback.handleFeedbackSubmit(
    new Request("https://poadomains.grok.me/v1/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://poadomains.grok.me",
        "cf-connecting-ip": "198.51.100.7",
      },
      body: JSON.stringify({
        kind: "bug",
        title: "Accidental key paste",
        details: "My private key is " + "a".repeat(64) + " please help!",
        challengeId: c1.ch.challengeId,
        captchaAnswer: c1.code,
        powNonce: nonce1,
      }),
    }),
    env,
    store,
    { fetch: mockFetch, now: () => clock, minDwellMs: 3000 },
  );
  assert.equal(secretRes.status, 400);
  assert.equal((await secretRes.json()).code, "FEEDBACK_CONTAINS_SECRET");

  // 4. Wrong CAPTCHA burns challenge (one guess only)
  const wrongRes = await feedback.handleFeedbackSubmit(
    new Request("https://poadomains.grok.me/v1/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://poadomains.grok.me",
        "cf-connecting-ip": "198.51.100.7",
      },
      body: JSON.stringify({
        kind: "bug",
        title: "Search button glitch",
        details: "When I tap check on mobile it flickers briefly.",
        challengeId: c1.ch.challengeId,
        captchaAnswer: "ZZZZZ",
        powNonce: nonce1,
      }),
    }),
    env,
    store,
    { fetch: mockFetch, now: () => clock, minDwellMs: 3000 },
  );
  assert.equal(wrongRes.status, 400);
  assert.equal((await wrongRes.json()).code, "FEEDBACK_CAPTCHA_INVALID");
  // Reusing same challengeId with the right code is now expired/burned
  const retrySame = await feedback.handleFeedbackSubmit(
    new Request("https://poadomains.grok.me/v1/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://poadomains.grok.me",
        "cf-connecting-ip": "198.51.100.7",
      },
      body: JSON.stringify({
        kind: "bug",
        title: "Search button glitch",
        details: "When I tap check on mobile it flickers briefly.",
        challengeId: c1.ch.challengeId,
        captchaAnswer: c1.code,
        powNonce: nonce1,
      }),
    }),
    env,
    store,
    { fetch: mockFetch, now: () => clock, minDwellMs: 3000 },
  );
  assert.equal(retrySame.status, 400);
  assert.equal((await retrySame.json()).code, "FEEDBACK_CAPTCHA_EXPIRED");

  // 5. Valid feature request -> posts GitHub issue with sanitized markdown & R2 archive
  const c2 = await issueChallenge();
  const nonce2 = await solvePowLocal(c2.ch.powSalt, c2.ch.powBits);
  clock += 4000;
  const okRes = await feedback.handleFeedbackSubmit(
    new Request("https://poadomains.grok.me/v1/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://poadomains.grok.me",
        "cf-connecting-ip": "198.51.100.7",
      },
      body: JSON.stringify({
        kind: "feature",
        title: "Add dark mode contrast toggle",
        details: "Hi @maximusmaximus please add <script>x</script> a high-contrast theme toggle!",
        poaAddress: ESCROW_ADDR,
        pagePath: "/d/cosmic",
        challengeId: c2.ch.challengeId,
        captchaAnswer: c2.code,
        powNonce: nonce2,
      }),
    }),
    env,
    store,
    { fetch: mockFetch, now: () => clock, minDwellMs: 3000 },
  );
  assert.equal(okRes.status, 201);
  const okBody = await okRes.json();
  assert.equal(okBody.ok, true);
  assert.equal(okBody.issueNumber, 113);
  assert.equal(okBody.issueUrl, "https://github.com/maximusmaximus/poa-domains/issues/113");
  assert.equal(ghCalls.length, 1);
  assert.equal(ghCalls[0].url, "https://api.github.com/repos/maximusmaximus/poa-domains/issues");
  assert.equal(ghCalls[0].body.title, "[Feature] Add dark mode contrast toggle");
  assert.deepEqual(ghCalls[0].body.labels, ["enhancement"]);
  assert.ok(ghCalls[0].body.body.includes("`@maximusmaximus`"), "must defang @mentions");
  assert.ok(!ghCalls[0].body.body.includes("<script>"), "must escape HTML tags");
  assert.ok(ghCalls[0].body.body.includes(`https://poascan.io/address/${ESCROW_ADDR}`));
  assert.equal(r2.store.size, 1);

  // 6. Duplicate submission rejected with 409
  const c3 = await issueChallenge();
  const nonce3 = await solvePowLocal(c3.ch.powSalt, c3.ch.powBits);
  clock += 4000;
  const dupRes = await feedback.handleFeedbackSubmit(
    new Request("https://poadomains.grok.me/v1/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://poadomains.grok.me",
        "cf-connecting-ip": "198.51.100.7",
      },
      body: JSON.stringify({
        kind: "feature",
        title: "Add dark mode contrast toggle",
        details: "Hi @maximusmaximus please add <script>x</script> a high-contrast theme toggle!",
        challengeId: c3.ch.challengeId,
        captchaAnswer: c3.code,
        powNonce: nonce3,
      }),
    }),
    env,
    store,
    { fetch: mockFetch, now: () => clock, minDwellMs: 3000 },
  );
  assert.equal(dupRes.status, 409);
  assert.equal((await dupRes.json()).code, "FEEDBACK_DUPLICATE");

  // 7. Missing FEEDBACK_GITHUB_TOKEN returns 503 FEEDBACK_DISABLED
  const c4 = await issueChallenge();
  const nonce4 = await solvePowLocal(c4.ch.powSalt, c4.ch.powBits);
  clock += 4000;
  const disabledRes = await feedback.handleFeedbackSubmit(
    new Request("https://poadomains.grok.me/v1/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://poadomains.grok.me",
        "cf-connecting-ip": "198.51.100.7",
      },
      body: JSON.stringify({
        kind: "bug",
        title: "Another distinct bug report",
        details: "This tests when the GitHub token secret is not configured yet.",
        challengeId: c4.ch.challengeId,
        captchaAnswer: c4.code,
        powNonce: nonce4,
      }),
    }),
    { ...env, FEEDBACK_GITHUB_TOKEN: "" },
    store,
    { fetch: mockFetch, now: () => clock, minDwellMs: 3000 },
  );
  assert.equal(disabledRes.status, 503);
  assert.equal((await disabledRes.json()).code, "FEEDBACK_DISABLED");
});
