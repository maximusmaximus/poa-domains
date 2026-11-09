// Local end-to-end backup/restore test against real workerd + local R2 + SQLite.
// Uses a throwaway RSA key pair and admin token; all state lives in a temp dir.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { restoreBackup } from "../../scripts/registry-restore.mjs";

const root = resolve(import.meta.dirname, "../.."), wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
const work = mkdtempSync(join(tmpdir(), "poadomains-backup-test-")), persist = join(work, "state");
const port = Number(process.env.CF_BACKUP_TEST_PORT ?? 18893), base = `http://127.0.0.1:${port}`;
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 4096 });
const pemPath = join(work, "test-decrypt.pem"); writeFileSync(pemPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const token = randomBytes(32).toString("hex");
let server; const pass = (n) => console.log(`PASS ${n}`);
async function start() {
  const log = openSync(join(work, "dev.log"), "w", 0o600);
  server = spawn(process.execPath, [wrangler, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", persist,
    "--test-scheduled", "--var", `BACKUP_ADMIN_TOKEN:${token}`, "--var", `BACKUP_PUBLIC_KEY_SPKI:${spki}`],
    { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, detached: true, stdio: ["ignore", log, log] });
  closeSync(log);
  for (let i = 0; i < 600; i++) {
    if (server.exitCode !== null) throw Error("wrangler exited; see dev.log");
    try { const r = await fetch(base + "/healthz"); if (r.status === 200) return r.json(); } catch {}
    await delay(200);
  }
  throw Error("not ready");
}
async function stop() { if (!server || server.exitCode !== null) return; const d = once(server, "exit"); process.kill(-server.pid, "SIGTERM"); await Promise.race([d, delay(10000)]); try { process.kill(-server.pid, "SIGKILL"); } catch {} }
const getObject = (key) => { const f = join(work, key.replace(/\//g, "_"));
  execFileSync(process.execPath, [wrangler, "r2", "object", "get", `poadomains-registry-backups/${key}`, "--local", "--persist-to", persist, "--file", f], { cwd: root, stdio: "ignore" });
  return readFileSync(f); };
try {
  const health = await start();
  const post = (path, headers = {}) => fetch(base + path, { method: "POST", headers });
  assert.equal((await post("/v1/admin/backup")).status, 404);
  assert.equal((await post("/v1/admin/backup", { authorization: "Bearer " + "0".repeat(64) })).status, 404);
  assert.equal((await post("/v1/admin/backup", { authorization: `Bearer ${token}`, origin: "https://evil.example" })).status, 400);
  assert.equal((await post("/v1/admin/restore?target=restore-x", { "content-type": "application/json" })).status, 404);
  assert.equal((await fetch(base + "/v1/admin/backup")).status, 405);
  pass("admin endpoints hidden without token; restore route absent unless local-only flag; browser origin refused");
  const manualRes = await post("/v1/admin/backup", { authorization: `Bearer ${token}` });
  const manual = await manualRes.json();
  assert.equal(manualRes.status, 200); assert.equal(manual.kind, "manual"); assert.equal(manual.sequence, health.sequence);
  assert.match(manual.key, /^v1\/manual\/\d{4}\/\d{2}\/\d{2}\/.+-seq0+\d+-[0-9a-f]{16}\.json$/);
  pass(`manual backup ${manual.key}`);
  const sched = await fetch(`${base}/__scheduled?cron=${encodeURIComponent("47 8 * * *")}`); assert.equal(sched.status, 200);
  await delay(1500);
  await stop();
  const bytes = getObject(manual.key), text = bytes.toString("utf8");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manual.sha256); assert.equal(bytes.byteLength, manual.size);
  assert.ok(!text.includes("PRIVATE KEY"), "no plaintext keys in R2 object");
  pass("object sha256/size match; no plaintext private keys");
  const daily = JSON.parse(getObject("v1/latest-daily.json").toString());
  assert.equal(daily.kind, "daily"); assert.ok(getObject(daily.key).byteLength === daily.size);
  pass(`daily scheduled cron wrote ${daily.key}`);
  const file = join(work, "manual.json"); writeFileSync(file, bytes);
  const r = await restoreBackup({ file, privateKeyPath: pemPath, port: port + 1 });
  assert.equal(r.ok, true, JSON.stringify(r.checks)); assert.equal(r.restoredHead.sequence, health.sequence);
  assert.equal(r.issuer, health.principals.issuer); assert.equal(r.treasury, health.principals.treasury);
  pass(`isolated restore matches seq ${r.restoredHead.sequence} stateHash ${r.restoredHead.stateHash.slice(0, 16)}…`);
  const bad = JSON.parse(text); bad.journal[3].record = bad.journal[3].record.replace(/"time":\d+/, '"time":1');
  writeFileSync(join(work, "bad.json"), JSON.stringify(bad));
  await assert.rejects(restoreBackup({ file: join(work, "bad.json"), privateKeyPath: pemPath, port: port + 2 }), /CHECKSUM/);
  pass("tampered backup rejected before restore");
  console.log("ALL BACKUP/RESTORE CHECKS PASSED");
} finally { await stop(); rmSync(work, { recursive: true, force: true }); }
