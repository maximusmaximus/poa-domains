import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endpoint } from "../src/client.js";
import { startRegistryApp } from "../src/app.js";

test("extracted shared seed preserves Node app bootstrap and restart identity/state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "poa-shared-seed-"));
  let app;
  try {
    app = await startRegistryApp({ dataDir: dir, port: 0 });
    const principals = app.principals, snapshot = app.engine.snapshot(), hash = app.engine.stateHash();
    assert.equal(snapshot.sequence, 15);
    for (const name of ["👩‍🦰", "🫪.👩‍🦰", "nexus"]) assert.ok(snapshot.names[name]?.activeId);
    await app.close();
    app = await startRegistryApp({ dataDir: dir, port: 0 });
    assert.deepEqual(app.principals, principals);
    assert.deepEqual(app.engine.snapshot(), snapshot);
    assert.equal(app.engine.stateHash(), hash);
    assert.equal(app.engine.durability(), "fsynced-journal");
  } finally { await app?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("reference client allowlists exact Cloudflare backend, not arbitrary workers.dev", () => {
  assert.equal(endpoint("https://poadomains-registry.maxinfeld-artshow.workers.dev"), "https://poadomains-registry.maxinfeld-artshow.workers.dev");
  assert.throws(() => endpoint("https://untrusted.maxinfeld-artshow.workers.dev"));
  assert.throws(() => endpoint("https://poadomains-registry.maxinfeld-artshow.workers.dev.attacker.invalid"));
});
