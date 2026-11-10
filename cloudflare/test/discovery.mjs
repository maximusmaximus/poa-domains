// Real workerd and Node HTTP servers, identical public fixture state and signed bytes.
// No upstream requests; the only private key is a disposable fixture kept in memory.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { generateKeyPairSync } from "node:crypto";
import { fixtureConfig } from "../../dist/src/config.js";
import { publicPrincipal, signBody, intentId } from "../../dist/src/auth.js";
import {
  capabilities,
  prepare,
  buildMetadataWitness,
} from "../../dist/src/interface.js";
import { startReferenceServer } from "../../dist/src/reference-server.js";
import {
  contractEngine,
  CONTRACT_OPTIONS,
  CONTRACT_TIME,
} from "../../dist/test/fixtures/contract-engine.js";
import { discoveryDocuments } from "../../dist/src/discovery.js";
import { API_LIMITS, API_SCHEMA_VERSION } from "../../dist/src/api-contract.js";

const config = fixtureConfig(
    "ed25519:" + "2".repeat(64),
    "ed25519:" + "3".repeat(64),
    [],
  ),
  engine = contractEngine(config);
const node = await startReferenceServer(engine, 0, {
  host: "127.0.0.1",
  routes: CONTRACT_OPTIONS,
});
const scratch = mkdtempSync(join(tmpdir(), "poa-routes-contract-")),
  port = Number(process.env.CF_DISCOVERY_PORT ?? 18898),
  base = `http://127.0.0.1:${port}`;
const logPath = join(scratch, "workerd.log"),
  log = openSync(logPath, "w", 0o600);
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--config",
    "cloudflare/test/discovery.wrangler.jsonc",
    "--local",
    "--local-upstream",
    "poadomains.grok.me",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--inspector-port",
    "0",
    "--persist-to",
    join(scratch, "state"),
    "--var",
    `CONTRACT_CONFIG:${JSON.stringify(config)}`,
  ],
  {
    cwd: resolve(import.meta.dirname, "../.."),
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    detached: true,
    stdio: ["ignore", log, log],
  },
);
closeSync(log);
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null)
      throw Error(`Local contract workerd exited; inspect ${logPath}`);
    try {
      const r = await fetch(base + "/llms.txt", {
        signal: AbortSignal.timeout(1000),
      });
      if (r.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert.ok(
    ready,
    `Local contract workerd readiness failed; inspect ${logPath}`,
  );
  const docs = discoveryDocuments();
  let count = 0;
  for (const [path, doc] of Object.entries(docs))
    for (const method of ["GET", "HEAD", "POST"]) {
      for (const origin of [node.url, base]) {
        const r = await fetch(origin + path, {
          method,
          headers: { "x-request-id": "discovery-contract" },
          signal: AbortSignal.timeout(8000),
        });
        assert.equal(r.status, method === "POST" ? 405 : 200, path);
        const text = await r.text();
        if (method === "GET") {
          assert.equal(text, doc.text);
          assert.match(
            r.headers.get("content-type"),
            new RegExp(doc.type.split(";")[0]),
          );
        } else if (method === "HEAD") assert.equal(text, "");
        else assert.equal(JSON.parse(text).code, "METHOD_NOT_ALLOWED");
        count++;
      }
    }
  const cap = await (await fetch(node.url + "/v1/capabilities")).json();
  assert.equal(cap.schemaVersion, API_SCHEMA_VERSION);
  assert.deepEqual(cap.limits, API_LIMITS);
  assert.equal(cap.surface.status.livePoA, false);
  assert.equal((await fetch(base + "/llms.txt?ignored=1")).status, 200);
  console.log(
    `PASS discovery: ${count} real Node/workerd GET/HEAD/405 contracts, exact docs, custom host, no registry/assets access, capability surface/limits`,
  );
} finally {
  await node.close();
  if (child.exitCode === null) {
    const exited = once(child, "exit");
    process.kill(-child.pid, "SIGTERM");
    let timer;
    try {
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Local contract workerd shutdown timeout")),
            10000,
          );
        }),
      ]);
    } catch (error) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
