import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Prefer Node's TypeScript strip-types when available (engines >= 22.15).
const mod = await import("../cloudflare/network-status.ts");

const {
  classifyProbe,
  shouldHoldTransactions,
  bannerCopy,
  createNetworkStatusMonitor,
} = mod;

test("worker classifyProbe online/degraded/down", () => {
  assert.equal(classifyProbe({ ok: true, latencyMs: 900, consecutiveFailures: 0, everSucceeded: true }), "online");
  assert.equal(classifyProbe({ ok: true, latencyMs: 4500, consecutiveFailures: 0, everSucceeded: true }), "degraded");
  assert.equal(classifyProbe({ ok: false, latencyMs: 100, consecutiveFailures: 1, everSucceeded: false }), "checking");
  assert.equal(classifyProbe({ ok: false, latencyMs: 100, consecutiveFailures: 2, everSucceeded: true }), "down");
});

test("worker hold only on down", () => {
  assert.equal(shouldHoldTransactions("down"), true);
  assert.equal(shouldHoldTransactions("degraded"), false);
  assert.match(bannerCopy("down"), /held/i);
});

test("monitor: two consecutive failures set hold", async () => {
  const monitor = createNetworkStatusMonitor({
    now: (() => { let t = 1e12; return () => (t += 1000); })(),
    fetch: async () => { throw new Error("boom"); },
  });
  const a = await monitor.getStatus({ bypassCache: true });
  assert.equal(a.level, "checking");
  assert.equal(a.hold, false);
  const b = await monitor.getStatus({ bypassCache: true });
  assert.equal(b.level, "down");
  assert.equal(b.hold, true);
});

test("monitor: success clears failures", async () => {
  const monitor = createNetworkStatusMonitor({
    now: () => 1e12,
    fetch: async () =>
      new Response(JSON.stringify({
        chain_id: "poa-mainnet-1",
        epochs_closed: 10,
        agents_joined: 1,
        txs: 2,
        final: 2,
        K: 5,
        checkpoint: { height: 9, cutoff_ts: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const s = await monitor.getStatus({ bypassCache: true });
  assert.equal(s.level, "online");
  assert.equal(s.hold, false);
  assert.equal(s.detail.epochsClosed, 10);
});

// Regression (Nov 11 prod): a stalled body or a shared probe whose request was cancelled hung /v1/network-status for minutes.
test("monitor: stalled response body is aborted by the request timer", async () => {
  const monitor = createNetworkStatusMonitor({
    requestMs: 50,
    fetch: async () => new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const t0 = Date.now(), snap = await monitor.getStatus();
  assert.ok(Date.now() - t0 < 1000, "resolved after the request timeout, not hung");
  assert.equal(snap.level, "checking");
  assert.equal(snap.failures, 1);
  assert.equal(snap.livePoA, false);
});

test("monitor: a never-settling shared probe cannot hang callers, and is replaced after the deadline", async () => {
  let calls = 0, clock = 0;
  const monitor = createNetworkStatusMonitor({
    requestMs: 30,
    now: () => clock,
    fetch: async () => { calls += 1; return new Promise(() => {}); }, // ignores abort, like a cancelled cross-request fetch
  });
  const t0 = Date.now(), [a, b] = await Promise.all([monitor.getStatus(), monitor.getStatus()]);
  assert.ok(Date.now() - t0 < 2500, "bounded by requestMs + 1s deadline");
  assert.equal(calls, 1, "concurrent callers share one probe");
  assert.equal(a.level, "checking");
  assert.equal(b.level, "checking");
  clock += 2000;
  await monitor.getStatus();
  assert.equal(calls, 2, "stale in-flight probe is replaced");
});

// Last known status (Nov 11): instant display from the shared store, background refresh, fresh-only hold.
function memoryStore(row = null) {
  const store = { row, saves: [], async load() { return store.row; }, async save(at, value) { store.saves.push({ at, value }); store.row = { at, value }; } };
  return store;
}
const okBody = () => new Response(JSON.stringify({ chain_id: "poa-mainnet-1", epochs_closed: 10, agents_joined: 1, txs: 2, final: 2, K: 5, checkpoint: { height: 9, cutoff_ts: 1 } }), { status: 200, headers: { "content-type": "application/json" } });

test("last known: an older shared value answers instantly, refreshes in the background, and never holds", async () => {
  let clock = 1_000_000, calls = 0;
  const pending = [];
  const store = memoryStore({ at: clock - 60_000, value: JSON.stringify({ level: "down", failures: 2, latencyMs: 10 }) });
  const monitor = createNetworkStatusMonitor({ now: () => clock, fetch: async () => { calls += 1; return new Promise(() => {}); }, requestMs: 20 });
  const t0 = Date.now(), snap = await monitor.getStatus({ shared: store, waitUntil: (p) => pending.push(p) });
  assert.ok(Date.now() - t0 < 500, "no wait on the slow probe");
  assert.equal(snap.level, "down");
  assert.equal(snap.lastKnown, true);
  assert.equal(snap.hold, false, "display-only value never holds");
  assert.equal(snap.stale, false);
  assert.equal(calls, 1, "one background probe");
  assert.equal(pending.length, 1);
  assert.equal(monitor.peekStatus().hold, false, "write hold never reads the shared value");
  assert.equal(monitor.peekStatus().level, "checking");
  await monitor.getStatus({ shared: store, waitUntil: (p) => pending.push(p) });
  assert.equal(calls, 1, "background probe deduplicated");
});

test("last known: stale after 5 minutes, fresh-equivalent inside the cache window, checking never overwrites", async () => {
  let clock = 10_000_000;
  const stale = memoryStore({ at: clock - 6 * 60_000, value: JSON.stringify({ level: "online" }) });
  const m1 = createNetworkStatusMonitor({ now: () => clock, fetch: async () => new Promise(() => {}), requestMs: 20 });
  const s1 = await m1.getStatus({ shared: stale });
  assert.equal(s1.stale, true);
  assert.equal(s1.ageMs, 6 * 60_000);
  const recent = memoryStore({ at: clock - 5_000, value: JSON.stringify({ level: "down", failures: 2 }) });
  const m2 = createNetworkStatusMonitor({ now: () => clock, fetch: async () => new Promise(() => {}), requestMs: 20 });
  const s2 = await m2.getStatus({ shared: recent });
  assert.equal(s2.lastKnown, undefined, "inside CACHE_MS it is what a cache hit would serve");
  assert.equal(s2.hold, true);
  const empty = memoryStore();
  const m3 = createNetworkStatusMonitor({ requestMs: 20, fetch: async () => { throw Error("offline"); } });
  const s3 = await m3.getStatus({ shared: empty });
  assert.equal(s3.level, "checking");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(empty.saves.length, 0, "checking is never stored");
  const bad = memoryStore({ at: clock, value: JSON.stringify({ level: "hacked", hold: false }) });
  const m4 = createNetworkStatusMonitor({ requestMs: 20, fetch: async () => { throw Error("offline"); } });
  assert.equal((await m4.getStatus({ shared: bad })).level, "checking", "unknown stored levels are ignored");
});

test("last known: down still needs two failed checks, and successful probes are saved", async () => {
  const store = memoryStore({ at: 1e12 - 60_000, value: JSON.stringify({ level: "down", failures: 2 }) });
  let fail = true;
  const monitor = createNetworkStatusMonitor({ now: () => 1e12, requestMs: 200, fetch: async () => { if (fail) throw Error("offline"); return okBody(); } });
  const first = await monitor.getStatus({ shared: store, bypassCache: true });
  assert.notEqual(first.level, "down", "one failure after a stored down is not down");
  assert.equal(first.failures, 1);
  const second = await monitor.getStatus({ shared: store, bypassCache: true });
  assert.equal(second.level, "down");
  assert.equal(second.hold, true);
  fail = false;
  const third = await monitor.getStatus({ shared: store, bypassCache: true });
  assert.equal(third.level, "online");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(JSON.parse(store.row.value).level, "online");
});
