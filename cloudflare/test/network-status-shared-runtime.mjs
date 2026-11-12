// REAL gateway + DO SQLite: the last known network status survives a fresh isolate and answers instantly,
// in a side table that never changes registry sequence/stateHash. Outbound reads are local synthetic replies only.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from "miniflare";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const root = resolve(import.meta.dirname, "../..");
const bundle = await build({ entryPoints: [resolve(root, "cloudflare/worker.ts")], bundle: true, write: false, format: "esm", platform: "node", target: "es2022", external: ["cloudflare:workers", "node:*"], alias: { "#poa-unicode-data": resolve(root, "cloudflare/unicode-data.ts") }, loader: { ".txt": "text" } });
const persist = mkdtempSync(join(tmpdir(), "net-status-do-"));
let denied = 0;
const status = () => Response.json({ chain_id: "poa-mainnet-1", epochs_closed: 10, agents_joined: 1, txs: 2, final: 2, K: 5, checkpoint: { height: 9, cutoff_ts: Math.floor(Date.now() / 1000) - 30 } });
const start = (slowMs) => new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, cf: false, log: new Log(LogLevel.ERROR), telemetry: { enabled: false }, resourcePersistencePath: persist,
  workers: [{ name: "network-status-shared-local", rootPath: root, modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-11-08", compatibilityFlags: ["nodejs_compat"],
    bindings: { PUBLIC_EXPLORER_URL: "https://app.example", BACKEND_HOST: "backend.example" }, durableObjects: { REGISTRY: { className: "PoaRegistry", useSQLite: true } },
    outboundService: async (req) => { const url = new URL(req.url); if (req.method !== "GET" || url.href !== "https://minepoa.com/chain/poa-mainnet-1/api/status") { denied++; throw Error("OUTBOUND_FORBIDDEN"); } if (slowMs) await delay(slowMs); return status(); } }] }));
const json = async (mf, path) => { const r = await mf.dispatchFetch("https://app.example" + path); assert.equal(r.status, 200, path); return r.json(); };
try {
  let mf = start(0);
  const before = await json(mf, "/v1/state");
  const first = await json(mf, "/v1/network-status");
  assert.ok(["online", "degraded"].includes(first.level));
  assert.equal(first.lastKnown, undefined);
  await delay(300);
  await mf.dispose();
  // Fresh isolate, slow upstream: the stored value answers without waiting for the 11 s probe.
  mf = start(11000);
  const t0 = Date.now(), second = await json(mf, "/v1/network-status");
  assert.ok(Date.now() - t0 < 3000, "last known answered instantly, took " + (Date.now() - t0) + "ms");
  assert.equal(second.level, first.level);
  const after = await json(mf, "/v1/state");
  assert.equal(after.state.sequence, before.state.sequence, "registry sequence unchanged");
  assert.equal(after.stateHash, before.stateHash, "registry stateHash unchanged");
  assert.equal(denied, 0);
  await mf.dispose();
  console.log("PASS last known network status: real DO side table survives a fresh isolate, instant answer, registry sequence/stateHash unchanged");
} finally { rmSync(persist, { recursive: true, force: true }); }
