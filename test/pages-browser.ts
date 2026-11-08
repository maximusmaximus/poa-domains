/** Independent acceptance harness. All official-node replies below are synthetic
 * local transport TEST RESPONSES, never production observations or registry data.
 * Not run by the author; the integrator supplies Playwright and the fixture page.
 */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const OFFICIAL = [
  'https://minepoa.com/chain/poa-mainnet-1/api/status',
  'https://minepoa.com/chain/poa-mainnet-1/api/network-facts',
] as const;
const PAYLOAD = '<img src="https://attacker.invalid/SECRET" onerror="window.__poaPwned=true">';
type LiveMode = 'good' | '429' | '503' | 'malformed' | 'content-type' | 'chain' | 'checkpoint' | 'hash';
type GuardMode = 'good' | 'ready' | 'state' | 'message' | 'demo' | 'backend';
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, description: string, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return; await delay(20); }
  assert.fail(`Timed out: ${description}`);
}

export async function verifyStaticPage(url: string, screenshot?: string) {
  const entry = new URL(url);
  assert.ok(['http:', 'https:'].includes(entry.protocol), 'A fixture HTTP(S) URL is required');
  assert.equal(entry.search + entry.hash + entry.username + entry.password, '', 'No query, fragment or URL credentials');
  assert.ok(entry.pathname.endsWith('/') || entry.pathname.endsWith('/index.html'), 'Use the explicit page directory or index.html');
  const base = new URL('./', entry);
  const asset = (name: string) => new URL(name, base).href;
  const permitted = new Set([base.href, asset('index.html'), ...['app.js', 'live-network.js', 'emoji-format-checker.mjs', 'emoji-format-checker.css', 'emoji17.mjs', 'emoji17-data.mjs', 'style.css', 'icon.svg', 'config.json', 'status.json'].map(asset)]);
  const counts = { requests: 0, backend: 0, mutationAttempts: 0 };
  const violations: string[] = [], routeErrors: string[] = [], pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const checks: string[] = [];
  let liveMode: LiveMode = 'good', guardMode: GuardMode = 'good';
  let liveGate: Promise<void> | null = null, releaseGate: (() => void) | null = null;
  function releaseHeldRequests() {
    const release = releaseGate; releaseGate = null; liveGate = null;
    if (release) release();
  }
  let txs = 42, final = 40;
  // Fixed for the entire test: an immutable checkpoint must not acquire a new cutoff.
  const cutoff = Math.floor(Date.now() / 1000) - 3600;
  const syntheticStatus = () => ({ chain_id: 'poa-mainnet-1', checkpoint: { height: 12345, cutoff_ts: cutoff }, epochs_closed: 57, agents_joined: 77, txs, final, K: 5 });
  const syntheticFacts = () => ({ chain_id: 'poa-mainnet-1', open_epoch: 57, engine_sha256: 'a'.repeat(64), params_sha256: 'b'.repeat(64), economics: { K: 5 } });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.name));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  // Observe the application fetch contract. This instrumentation never changes a
  // request, obtains credentials, creates a wallet, or substitutes an API client.
  await context.addInitScript(() => {
    const state = { calls: [] as { url: string; method: string; credentials: string; redirect: string; cache: string }[] };
    (window as any).__poaAcceptance = state;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const req = input instanceof Request ? input : null;
      state.calls.push({
        url: new URL(req ? req.url : String(input), document.baseURI).href,
        method: (init?.method ?? req?.method ?? 'GET').toUpperCase(),
        credentials: init?.credentials ?? req?.credentials ?? 'same-origin',
        redirect: init?.redirect ?? req?.redirect ?? 'follow',
        cache: init?.cache ?? req?.cache ?? 'default',
      });
      return nativeFetch(input, init);
    };
  });
  async function abort(route: Route, reason: string) {
    violations.push(reason);
    await route.abort('blockedbyclient');
  }
  await context.route('**/*', async route => {
    try {
      const request = route.request(); counts.requests++;
      const target = new URL(request.url());
      if (request.method() !== 'GET') { counts.mutationAttempts++; await abort(route, 'Non-GET request'); return; }
      if (target.search || target.hash || target.username || target.password) { await abort(route, 'Query/fragment/credential request'); return; }
      const headers = await request.allHeaders();
      if (Object.keys(headers).some(k => /^(cookie|authorization|proxy-authorization|x-api-key|x-wallet.*)$/i.test(k))) {
        await abort(route, 'Credential-bearing request'); return;
      }
      if ((OFFICIAL as readonly string[]).includes(target.href)) {
        counts.backend++;
        const mode = liveMode, isStatus = target.href === OFFICIAL[0];
        const status = syntheticStatus(); const facts = syntheticFacts();
        if (mode === 'chain' && isStatus) status.chain_id = PAYLOAD;
        if (mode === 'checkpoint' && isStatus) status.checkpoint.cutoff_ts++;
        if (mode === 'hash' && !isStatus) facts.engine_sha256 = 'c'.repeat(64);
        const gate = liveGate; if (gate) await gate;
        const http = mode === '429' ? 429 : mode === '503' ? 503 : 200;
        const body = http !== 200 ? '{"test_only":true}' : mode === 'malformed' && isStatus ? '{BROKEN_SECRET' :
          mode === 'content-type' && isStatus ? PAYLOAD : JSON.stringify(isStatus ? status : facts);
        await route.fulfill({ status: http, body, headers: {
          'Content-Type': mode === 'content-type' && isStatus ? 'text/html' : 'application/json',
          'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store',
          'X-Test-Only-Synthetic-Node-Response': 'true',
        } });
        return;
      }
      if (target.origin !== entry.origin || !permitted.has(target.href)) { await abort(route, 'Non-allowlisted asset or API request'); return; }
      // Only local/site assets may reach the supplied fixture origin. Official
      // requests are always fulfilled above; no route.fetch/continue reaches them.
      if (target.href === asset('status.json') || target.href === asset('config.json')) {
        const response = await route.fetch({ maxRedirects: 0 });
        if (response.status() !== 200) { await abort(route, 'Guard document not HTTP200'); return; }
        const original: unknown = await response.json();
        assert.ok(original && typeof original === 'object' && !Array.isArray(original), 'Guard document must be an object');
        let document: Record<string, unknown> = { ...(original as Record<string, unknown>) };
        if (target.href === asset('status.json')) {
          if (guardMode === 'ready') document = { ...document, ready: true };
          if (guardMode === 'state') document = { ...document, state: 'ready' };
          if (guardMode === 'message') document = { ...document, backendMessage: PAYLOAD };
        } else {
          if (guardMode === 'demo') document = { ...document, mode: 'demo' };
          if (guardMode === 'backend') document = { ...document, backend: 'https://attacker.invalid/api' };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(document), headers: { 'Cache-Control': 'no-store' } });
        return;
      }
      // Using route.fetch with maxRedirects:0 keeps same-origin asset redirects
      // from escaping interception. No auth/storage state is installed in context.
      const response = await route.fetch({ maxRedirects: 0 });
      if (response.status() >= 300 && response.status() < 400) { await abort(route, 'Asset redirect'); return; }
      await route.fulfill({ response });
    } catch {
      routeErrors.push('Request interception failed');
      try { await route.abort('failed'); } catch { /* context can close during cleanup */ }
    }
  });
  async function capabilityChecks() {
    assert.deepEqual(violations, [], 'Every request must stay inside the GET allowlist');
    assert.deepEqual(routeErrors, [], 'Interception must not fail');
    assert.equal(counts.mutationAttempts, 0);
    assert.deepEqual(pageErrors, [], 'No unhandled page errors');
    const calls = await page.evaluate(() => (window as any).__poaAcceptance.calls as { url: string; method: string; credentials: string; redirect: string; cache: string }[]);
    for (const call of calls) {
      assert.equal(call.method, 'GET'); assert.equal(call.credentials, 'omit', 'Every application fetch must explicitly omit credentials');
      const target = new URL(call.url); assert.equal(target.search, '');
      assert.ok(permitted.has(target.href) || (OFFICIAL as readonly string[]).includes(target.href));
      assert.notEqual(target.href, asset('network.json'), 'Published network snapshot must not be consumed');
      if ((OFFICIAL as readonly string[]).includes(target.href)) { assert.equal(call.redirect, 'error'); assert.equal(call.cache, 'no-store'); }
    }
    assert.equal(await page.locator('form,input,select,textarea').count(), 0);
    assert.equal(await page.locator('button:not(#refresh)').count(), 0, 'No transaction or signing buttons');
    assert.equal(await page.locator('#name,#names,#auction,#auctions,#state,#handoff,#digest,#copy,#sign,#signing,#wallet,[data-registry-ready="true"]').count(), 0);
    assert.equal(await page.locator('img,iframe,object,embed').count(), 0, 'No injected executable/image surface');
    assert.equal(await page.evaluate(() => (window as any).__poaPwned), undefined);
    const body = await page.locator('body').innerText();
    assert.ok(!body.includes('BROKEN_SECRET') && !body.includes('attacker.invalid') && !body.includes('onerror='), 'Raw upstream data must not be reflected');
    assert.match(body, /not production-ready naming/i);
    assert.match((await page.locator('#availability').innerText()).trim(), /^Native registry unavailable$/i);
  }
  async function settled() {
    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('#refresh');
      return button !== null && button.disabled === false;
    });
  }
  async function ready(expectedTransactions = txs) {
    await settled();
    await page.waitForFunction(() => /Verified application guard/i.test(document.querySelector('#status')?.textContent || ''));
    await page.waitForFunction(() => /Official.node observation\s*\(unverified\)/i.test(document.querySelector('#network-status')?.textContent || ''));
    const details = (await page.locator('#network-details').innerText()).replace(/,/g, '');
    assert.match(details, /Network\s*:?\s*poa-mainnet-1/i);
    for (const n of [77, expectedTransactions, 57]) assert.match(details, new RegExp(`\\b${n}\\b`), 'Expected test-only node counters');
    await capabilityChecks();
  }
  async function failed(pattern: RegExp) {
    await until(async () => {
      const snapshot = await page.evaluate(() => {
        const button = document.querySelector<HTMLButtonElement>('#refresh');
        return {
          settled: button !== null && button.disabled === false,
          text: (document.querySelector('#network-status')?.textContent || '').trim(),
          details: (document.querySelector('#network-details')?.textContent || '').trim(),
        };
      });
      return snapshot.settled && pattern.test(snapshot.text) && !snapshot.details;
    }, 'safe live failure and cleared values');
    assert.equal((await page.locator('#network-details').innerText()).trim(), '');
    await capabilityChecks();
  }
  async function load(mode: LiveMode = 'good', guard: GuardMode = 'good') {
    liveMode = mode; guardMode = guard;
    await page.goto(entry.href, { waitUntil: 'load' });
    assert.equal((await page.locator('h1').innerText()).trim(), 'PoA domains');
  }
  async function refresh() {
    await page.locator('#refresh').click();
    await settled();
  }
  try {
    await load(); await ready();
    assert.equal(counts.backend, 2, 'Initial load performs one pair of real-reader GETs with synthetic transport responses');
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy" i]').getAttribute('content');
    assert.ok(csp, 'An explicit CSP meta policy is required');
    const directives = csp.split(';').map(x => x.trim().split(/\s+/)).filter(x => x[0]);
    const connect = directives.filter(x => x[0] === 'connect-src'); assert.equal(connect.length, 1); assert.ok(connect[0]);
    assert.deepEqual(connect[0].slice(1).sort(), ["'self'", ...OFFICIAL].sort(), 'CSP permits exactly the two scoped official GET paths plus self');
    const scripts = directives.filter(x => x[0] === 'script-src'); assert.equal(scripts.length, 1); assert.ok(scripts[0]);
    assert.deepEqual(scripts[0].slice(1), ["'self'"], 'No remote/unsafe script execution');
    for (const script of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => (node as HTMLScriptElement).src))) assert.equal(script, asset('app.js'));
    checks.push('Initial production guard and unverified counters; exact-path CSP; no action fields or synthetic registry');

    txs = 43; final = 41;
    const before = counts.backend;
    liveGate = new Promise<void>(resolve => { releaseGate = resolve; });
    await page.locator('#refresh').evaluate(button => { for (let i = 0; i < 8; i++) (button as HTMLButtonElement).click(); });
    await until(() => counts.backend >= before + 2, 'refresh GET pair');
    // Hold both replies while all eight same-turn clicks are dispatched. A disabled
    // button or the reader singleflight must prevent any extra official requests.
    await delay(100); assert.equal(counts.backend, before + 2, 'Repeated clicks do not burst official requests');
    releaseHeldRequests();
    await ready(43); assert.equal(counts.backend, before + 2);
    checks.push('Refresh fetches a new pair; eight pending clicks coalesce or stay disabled');

    for (const [mode, pattern] of [['429', /rate.limit/i], ['503', /unavailable/i]] as const) {
      liveMode = mode; await refresh(); await failed(pattern);
      liveMode = 'good'; await refresh(); await ready();
    }
    checks.push('HTTP429 and HTTP503 clear previous values, show safe failures, then recover');

    for (const mode of ['malformed', 'content-type', 'chain'] as const) {
      await load(mode); await failed(/JSON|chain|response|unavailable/i);
      if (mode === 'chain') {
        const start: number = counts.backend; liveMode = 'good'; await refresh(); await failed(/chain|unavailable/i);
        assert.equal(counts.backend, start, 'Chain incident stays sticky without further official GETs');
      }
    }
    checks.push('Fresh-page malformed JSON, wrong content type and malicious chain ID fail safely without XSS or stale values');

    for (const mode of ['checkpoint', 'hash'] as const) {
      await load(); await ready(); liveMode = mode; await refresh();
      await failed(mode === 'checkpoint' ? /checkpoint|inconsisten|unavailable/i : /digest|hash|changed|unavailable/i);
      const start: number = counts.backend; liveMode = 'good'; await refresh();
      await failed(mode === 'checkpoint' ? /checkpoint|inconsisten|unavailable/i : /digest|hash|changed|unavailable/i);
      assert.equal(counts.backend, start, 'Consistency incidents stay sticky for the page reader lifetime');
    }
    checks.push('Same-height cutoff change and digest drift are sticky; no previous-value fallback');

    for (const mode of ['ready', 'state', 'message', 'demo', 'backend'] as const) {
      const start: number = counts.backend; await load('good', mode);
      await page.waitForFunction(() => /Fail.closed/i.test(document.querySelector('#status')?.textContent || '') && /could not be validated/i.test(document.querySelector('#error')?.textContent || ''));
      await delay(100); assert.equal(counts.backend, start, 'Invalid application guards must prevent official GETs');
      assert.equal((await page.locator('#network-details').innerText()).trim(), ''); await capabilityChecks();
    }
    checks.push('Forged ready/state/backend-message status and demo/backend-override config fail before official reads');

    await load(); await ready();
    if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
    // Chromium logs unsuccessful HTTP responses even when the application handles
    // them. Record/filter expected 429/503 messages; never claim zero total errors.
    const expectedConsole = consoleErrors.filter(text => /(?:429|503)/.test(text) && /Failed to load resource|status/i.test(text));
    const unexpectedConsole = consoleErrors.filter(text => !expectedConsole.includes(text));
    assert.deepEqual(unexpectedConsole, [], 'No unexpected browser console errors');
    await capabilityChecks();
    return {
      status: 'passed' as const, assertionGroups: checks.length, checks,
      operational: false, fixtureData: false,
      syntheticTransportResponses: 'Explicit test-only public-node replies; no registry/ownership/balance simulation',
      requests: counts.requests, mutations: counts.mutationAttempts, backendRequests: counts.backend,
      consoleErrors: { total: consoleErrors.length, expectedHttpErrors: expectedConsole.length, unexpected: unexpectedConsole },
    };
  } finally {
    releaseHeldRequests();
    await context.close(); await browser.close();
  }
}
