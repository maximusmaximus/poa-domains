// Restore a registry backup into an ISOLATED local workerd instance (fresh temp storage,
// separate Durable Object name) and prove it matches by head sequence, state hash and
// journal head. Never restores over the live registry: the restore route only exists when
// BACKUP_RESTORE_ENABLED=local-only is passed on the local CLI, and the Durable Object
// refuses the production singleton name.
//
// Usage:
//   node --experimental-strip-types scripts/registry-restore.mjs --key v1/daily/...json
//   node --experimental-strip-types scripts/registry-restore.mjs --file ./backup.json
// Options: --private-key <pem> (default ~/.config/poadomains-backup/backup-decrypt-rsa4096.pem)
//          --expect-sha256 <hex>  --port 18891  --keep (keep temp storage; contains keys)
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash, createPrivateKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, openSync, closeSync, chmodSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const codec = await import(pathToFileURL(join(root, "cloudflare/backup-codec.ts")).href);

export function downloadBackup(key, dir) {
  if (!/^v1\/(hourly|daily|manual)\/[0-9A-Za-z/_.-]+\.json$/.test(key)) throw Error("BAD_BACKUP_KEY");
  const file = join(dir, "backup.json");
  execFileSync(process.execPath, [join(root, "node_modules/wrangler/bin/wrangler.js"), "r2", "object", "get",
    `${codec.BACKUP_BUCKET}/${key}`, "--remote", "--file", file], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  return file;
}

export async function restoreBackup({ file, key, privateKeyPath, expectSha256, port = 18891, keep = false, wranglerArgs = [] }) {
  const work = mkdtempSync(join(tmpdir(), "poadomains-restore-")); chmodSync(work, 0o700);
  let server;
  try {
    if (!file) file = downloadBackup(key, work);
    const bytes = readFileSync(file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (expectSha256 && expectSha256 !== sha256) throw Error("BACKUP_SHA256_MISMATCH");
    const suffix = (key ?? file).match(/-([0-9a-f]{16})\.json$/)?.[1];
    if (suffix && !sha256.startsWith(suffix)) throw Error("BACKUP_KEY_CHECKSUM_MISMATCH");
    const text = bytes.toString("utf8");
    const backup = await codec.verifyBackup(JSON.parse(text));
    const der = new Uint8Array(createPrivateKey(readFileSync(privateKeyPath ?? join(homedir(), ".config/poadomains-backup/backup-decrypt-rsa4096.pem")))
      .export({ type: "pkcs8", format: "der" }));
    const { keys } = await codec.decryptSecrets(backup.secrets, der, codec.secretAad(backup.registry.policyHash, backup.head));

    const persist = join(work, "state"), base = `http://127.0.0.1:${port}`;
    const log = openSync(join(work, "wrangler.log"), "w", 0o600);
    server = spawn(process.execPath, [join(root, "node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--ip", "127.0.0.1",
      "--port", String(port), "--persist-to", persist, "--var", "BACKUP_RESTORE_ENABLED:local-only", ...wranglerArgs],
      { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, detached: true, stdio: ["ignore", log, log] });
    closeSync(log);
    for (let i = 0; ; i++) {
      if (server.exitCode !== null) throw Error("WRANGLER_EXITED");
      try { if ((await fetch(base + "/healthz", { signal: AbortSignal.timeout(3000) })).status === 200) break; } catch {}
      if (i > 600) throw Error("WRANGLER_NOT_READY"); await delay(200);
    }
    const target = `restore-${new Date().toISOString().toLowerCase().replace(/[^0-9a-z]/g, "-").slice(0, 40)}`;
    const res = await fetch(`${base}/v1/admin/restore?target=${target}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ backup: text, keys }), signal: AbortSignal.timeout(60000) });
    const restored = await res.json();
    if (res.status !== 200) throw Error(`RESTORE_HTTP_${res.status}_${restored.code ?? ""}`);
    const liveRefused = await fetch(`${base}/v1/admin/restore?target=poa-mainnet-registry-v1`, { method: "POST",
      headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.status);
    const checks = {
      sequence: restored.sequence === backup.head.sequence,
      stateHash: restored.stateHash === backup.head.stateHash,
      journalHead: restored.journalHead === backup.head.journalHead,
      principals: JSON.stringify(restored.principals) === JSON.stringify(backup.registry.principals),
      singletonTargetRefused: liveRefused === 400,
    };
    return { ok: Object.values(checks).every(Boolean), checks, source: key ?? file, size: bytes.byteLength, sha256,
      target, isolatedStorage: keep ? persist : "temporary (deleted)", backupHead: backup.head, restoredHead: {
        sequence: restored.sequence, stateHash: restored.stateHash, journalHead: restored.journalHead },
      issuer: restored.principals.issuer, treasury: restored.principals.treasury };
  } finally {
    if (server && server.exitCode === null) {
      const done = once(server, "exit"); try { process.kill(-server.pid, "SIGTERM"); } catch {}
      await Promise.race([done, delay(10000)]); try { process.kill(-server.pid, "SIGKILL"); } catch {}
    }
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const a = process.argv.slice(2), opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const result = await restoreBackup({ key: opt("--key"), file: opt("--file") && resolve(opt("--file")), privateKeyPath: opt("--private-key"),
    expectSha256: opt("--expect-sha256"), port: Number(opt("--port") ?? 18891), keep: a.includes("--keep") });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
