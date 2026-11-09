// Trigger one manual backup of the live registry into the private R2 bucket.
// The admin token is read from a local file (never an argument, URL or log line).
// Usage: node scripts/registry-backup.mjs [--token-file ~/.config/poadomains-backup/admin-token] [--base URL]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const a = process.argv.slice(2), opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const token = readFileSync(opt("--token-file") ?? join(homedir(), ".config/poadomains-backup/admin-token"), "utf8").trim();
const base = opt("--base") ?? "https://poadomains-registry.maxinfeld-artshow.workers.dev";
const res = await fetch(`${base}/v1/admin/backup`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
const body = await res.json();
console.log(JSON.stringify({ status: res.status, ...body }, null, 2));
process.exit(res.status === 200 ? 0 : 1);
