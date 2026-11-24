import test from "node:test";
import assert from "node:assert/strict";
import * as treasury from "../dist/treasury.mjs";
import * as feedback from "../dist/feedback.mjs";
import { formatEmojiCounter } from "../reference-web/shared.js";

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

test("treasury and feedback enforce HTTP bounds, origin/method/host checks, rate limits, and upstream error handling", async () => {
  const env = {
    BACKEND_HOST: "poadomains.grok.me",
    PUBLIC_EXPLORER_URL: "https://poadomains.grok.me",
    FEEDBACK_GITHUB_TOKEN: "test-gh-token-for-unit-only",
    MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  const store = createMemoryFeedbackStore();

  // Treasury helpers & error paths
  assert.equal(treasury.parsePoaMicros(123), null);
  assert.equal(treasury.parsePoaMicros("bad"), null);
  assert.equal(treasury.formatPoaMicros(-5n), "0.000000");
  assert.equal(treasury.validPoaAddr(null), null);
  assert.equal(treasury.validPoaAddr("not-poa"), null);
  const qRes = await treasury.handleTreasuryRequest(
    new Request("https://poadomains.grok.me/v1/treasury?x=1"),
    env,
    async () => ({ escrow: ESCROW_ADDR, treasury: TREASURY_ADDR }),
  );
  assert.equal(qRes.status, 400);
  const errRes = await treasury.handleTreasuryRequest(
    new Request("https://poadomains.grok.me/v1/treasury"),
    env,
    async () => {
      throw Error("boom");
    },
  );
  assert.equal(errRes.status, 503);
  assert.equal((await errRes.json()).code, "TREASURY_UNAVAILABLE");

  // Secret patterns & PoW bounds
  assert.equal(feedback.containsSecretLikeText("-----BEGIN PRIVATE KEY-----"), true);
  assert.equal(feedback.containsSecretLikeText("ghp_1234567890123456789012345"), true);
  assert.equal(feedback.containsSecretLikeText("Bearer abcdefghijklmnopqrstuvwxyz1234"), true);
  assert.equal(feedback.containsSecretLikeText("seed phrase: word1 word2"), true);
  assert.equal(feedback.containsSecretLikeText("normal bug report text"), false);
  assert.equal(await feedback.verifyPow("salt", "abc", 8), false);
  assert.equal(feedback.leadingZeroBits(new Uint8Array([0, 0x0f])), 12);

  // Challenge host / method / query / origin / rate-limit guards
  assert.equal((await feedback.handleFeedbackChallenge(new Request("https://evil.invalid/v1/feedback/challenge"), env, store)).status, 403);
  assert.equal((await feedback.handleFeedbackChallenge(new Request("https://poadomains.grok.me/v1/feedback/challenge", { method: "POST" }), env, store)).status, 405);
  assert.equal((await feedback.handleFeedbackChallenge(new Request("https://poadomains.grok.me/v1/feedback/challenge?a=1"), env, store)).status, 400);
  assert.equal((await feedback.handleFeedbackChallenge(new Request("https://poadomains.grok.me/v1/feedback/challenge", { headers: { origin: "https://evil.invalid" } }), env, store)).status, 403);
  assert.equal((await feedback.handleFeedbackChallenge(new Request("https://poadomains.grok.me/v1/feedback/challenge", { headers: { origin: "not a url" } }), env, store)).status, 403);
  assert.equal((await feedback.handleFeedbackChallenge(new Request("https://poadomains.grok.me/v1/feedback/challenge"), { ...env, MCP_RATE_LIMITER: { limit: async () => ({ success: false }) } }, store)).status, 429);
  assert.equal((await feedback.handleFeedbackChallenge(new Request("https://poadomains.grok.me/v1/feedback/challenge"), { ...env, MCP_RATE_LIMITER: { limit: async () => { throw Error("rl"); } } }, store)).status, 503);
  assert.equal((await feedback.handleFeedbackChallenge(new Request("https://poadomains.grok.me/v1/feedback/challenge"), env, { ...store, createFeedbackChallenge: async () => ({ ok: false, code: "FEEDBACK_RATE_LIMITED" }) })).status, 429);

  // Captcha HEAD, bad host/method/id/expired
  const ch = await (await feedback.handleFeedbackChallenge(new Request("https://poadomains.grok.me/v1/feedback/challenge"), env, store, { powBits: 4 })).json();
  assert.equal((await feedback.handleFeedbackCaptcha(new Request("https://evil.invalid/v1/feedback/captcha/" + ch.challengeId), env, store, ch.challengeId)).status, 403);
  assert.equal((await feedback.handleFeedbackCaptcha(new Request("https://poadomains.grok.me/v1/feedback/captcha/" + ch.challengeId, { method: "POST" }), env, store, ch.challengeId)).status, 405);
  assert.equal((await feedback.handleFeedbackCaptcha(new Request("https://poadomains.grok.me/v1/feedback/captcha/bad"), env, store, "bad")).status, 404);
  assert.equal((await feedback.handleFeedbackCaptcha(new Request("https://poadomains.grok.me/v1/feedback/captcha/" + "0".repeat(32)), env, store, "0".repeat(32))).status, 404);
  const headCaptcha = await feedback.handleFeedbackCaptcha(new Request("https://poadomains.grok.me/v1/feedback/captcha/" + ch.challengeId, { method: "HEAD" }), env, store, ch.challengeId);
  assert.equal(headCaptcha.status, 200);
  assert.equal(await headCaptcha.text(), "");

  // Submit protocol/bounds/validation/upstream error paths
  const post = (body, hdrs = {}, url = "https://poadomains.grok.me/v1/feedback", envOver = env) =>
    feedback.handleFeedbackSubmit(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://poadomains.grok.me", ...hdrs },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      envOver,
      store,
      { minDwellMs: 0, fetch: async () => new Response("err", { status: 500 }) },
    );
  assert.equal((await post({}, {}, "https://evil.invalid/v1/feedback")).status, 403);
  assert.equal((await feedback.handleFeedbackSubmit(new Request("https://poadomains.grok.me/v1/feedback", { method: "GET" }), env, store)).status, 405);
  assert.equal((await post({}, {}, "https://poadomains.grok.me/v1/feedback?q=1")).status, 400);
  assert.equal((await post({}, { "content-encoding": "gzip" })).status, 400);
  assert.equal((await post({}, { origin: "https://evil.invalid" })).status, 403);
  assert.equal((await post({}, { "content-type": "text/plain" })).status, 400);
  assert.equal((await post({}, { "content-length": "999999" })).status, 413);
  assert.equal((await post("x".repeat(20000))).status, 413);
  assert.equal((await post("")).status, 400);
  assert.equal((await post("[]")).status, 400);
  assert.equal((await post({ unknownKey: 1 })).status, 400);
  assert.equal((await post({}, {}, "https://poadomains.grok.me/v1/feedback", { ...env, MCP_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
  assert.equal((await post({}, {}, "https://poadomains.grok.me/v1/feedback", { ...env, MCP_RATE_LIMITER: { limit: async () => { throw Error("rl"); } } })).status, 503);

  const svg = await (await feedback.handleFeedbackCaptcha(new Request("https://poadomains.grok.me" + ch.captchaUrl), env, store, ch.challengeId)).text();
  const code = [...svg.matchAll(/<text[^>]*>([A-Z0-9])<\/text>/g)].map((m) => m[1]).join("");
  const powNonce = await solvePowLocal(ch.powSalt, ch.powBits);
  const validPayload = {
    kind: "bug",
    title: "Valid issue summary",
    details: "Detailed reproducible bug report description here.",
    challengeId: ch.challengeId,
    captchaAnswer: code,
    powNonce,
  };
  assert.equal((await post({ ...validPayload, poaAddress: "bad-addr" })).status, 400);
  assert.equal((await post({ ...validPayload, pagePath: "no-leading-slash" })).status, 400);
  assert.equal((await post({ ...validPayload, powNonce: "999999999" })).status, 400);
  assert.equal((await post(validPayload, {}, "https://poadomains.grok.me/v1/feedback", { ...env, FEEDBACK_GITHUB_REPO: "bad repo" })).status, 503);

  // Upstream GitHub failure returns 502
  const ch502 = await (await feedback.handleFeedbackChallenge(new Request("https://poadomains.grok.me/v1/feedback/challenge"), env, store, { powBits: 4 })).json();
  const svg502 = await (await feedback.handleFeedbackCaptcha(new Request("https://poadomains.grok.me" + ch502.captchaUrl), env, store, ch502.challengeId)).text();
  const code502 = [...svg502.matchAll(/<text[^>]*>([A-Z0-9])<\/text>/g)].map((m) => m[1]).join("");
  const pow502 = await solvePowLocal(ch502.powSalt, ch502.powBits);
  const failUp = await post({
    ...validPayload,
    title: "Distinct upstream failure report",
    challengeId: ch502.challengeId,
    captchaAnswer: code502,
    powNonce: pow502,
  });
  assert.equal(failUp.status, 502);
  assert.equal((await failUp.json()).code, "FEEDBACK_UPSTREAM_FAILED");
});

test("formatEmojiCounter renders 6-digit keycap emoji counters cleanly", () => {
  assert.equal(formatEmojiCounter(0), "0️⃣0️⃣0️⃣0️⃣0️⃣0️⃣");
  assert.equal(formatEmojiCounter(2), "0️⃣0️⃣0️⃣0️⃣0️⃣2️⃣");
  assert.equal(formatEmojiCounter(42), "0️⃣0️⃣0️⃣0️⃣4️⃣2️⃣");
  assert.equal(formatEmojiCounter(123456), "1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣");
  assert.equal(formatEmojiCounter(1000000), "1️⃣0️⃣0️⃣0️⃣0️⃣0️⃣0️⃣");
  assert.equal(formatEmojiCounter(-5), "0️⃣0️⃣0️⃣0️⃣0️⃣0️⃣");
  assert.equal(formatEmojiCounter(Number.NaN), "0️⃣0️⃣0️⃣0️⃣0️⃣0️⃣");
});
