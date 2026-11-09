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
