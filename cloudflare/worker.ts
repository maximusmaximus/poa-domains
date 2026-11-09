import { Fault, need, parseJSON } from "../src/core.js";
import { parseRestoreInput, RESTORE_INPUT_LIMIT } from "./restore-input.js";
import { SINGLETON } from "./registry.js";
import { networkStatusMonitor } from "./network-status.js";
import { BackupKind, RETENTION_DAYS, backupObjectKey, kindForCron } from "./backup-codec.js";
export { PoaRegistry } from "./registry.js";

const SECURITY: Record<string, string> = {
  "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
function json(status: number, body: unknown, read = false): Response {
  return Response.json(body, { status, headers: { ...SECURITY, ...(read ? { "access-control-allow-origin": "*" } : {}) } });
}
async function readPacket(request: Request): Promise<unknown> {
  need(!request.headers.has("origin") && !request.headers.has("sec-fetch-site"), "BROWSER_WRITES_DISABLED");
  need(request.headers.get("content-type") === "application/json", "CONTENT_TYPE");
  need(!request.headers.has("content-encoding"), "ENCODING");
  const length = request.headers.get("content-length");
  if (length !== null) need(/^[0-9]+$/.test(length) && Number(length) <= 65536, "BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  need(reader, "EMPTY_BODY");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new Fault("BODY_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  return parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
const RESTORE_TARGET = /^restore-[a-z0-9-]{1,48}$/;
async function readLimited(request: Request, limit: number): Promise<string> {
  const reader = request.body?.getReader(); need(reader, "EMPTY_BODY");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Fault("BODY_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([given, expected].map((v) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))));
  const x = new Uint8Array(a!), y = new Uint8Array(b!); let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}
export interface BackupResult { key: string; size: number; sha256: string; sequence: number; stateHash: string; createdAt: string; kind: BackupKind; created: boolean; }
/** Export the live registry and write one immutable, checksummed object to the private R2 bucket. */
export async function runBackup(env: Env, kind: BackupKind): Promise<BackupResult> {
  const exp = await env.REGISTRY.getByName(SINGLETON).exportBackup(kind);
  const key = backupObjectKey(kind, exp.createdAt, exp.sequence, exp.sha256);
  const existing = await env.BACKUPS.head(key);
  if (!existing) {
    await env.BACKUPS.put(key, exp.bodyText, {
      sha256: exp.sha256,
      httpMetadata: { contentType: "application/json" },
      customMetadata: { format: "poadomains-registry-backup/v1", kind, sha256: exp.sha256, sequence: String(exp.sequence),
        stateHash: exp.stateHash, createdAt: exp.createdAt, retentionDays: String(RETENTION_DAYS[kind]) },
    });
  }
  const result: BackupResult = { key, size: exp.size, sha256: exp.sha256, sequence: exp.sequence, stateHash: exp.stateHash, createdAt: exp.createdAt, kind, created: !existing };
  // Small pointer for operators (metadata only, no registry contents or secrets).
  await env.BACKUPS.put(`v1/latest-${kind}.json`, JSON.stringify(result), { httpMetadata: { contentType: "application/json" } });
  console.log(JSON.stringify({ event: "registry-backup", ...result }));
  return result;
}
async function admin(request: Request, env: Env, u: URL): Promise<Response> {
  if (request.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED" });
  need(!request.headers.has("origin") && !request.headers.has("sec-fetch-site"), "BROWSER_WRITES_DISABLED");
  if (u.pathname === "/v1/admin/escrow") {
    const expected = env.ESCROW_ADMIN_TOKEN ?? "", auth = request.headers.get("authorization") ?? "";
    if (String(env.POA_ESCROW_ENABLED) !== "true" || expected.length < 32 || !auth.startsWith("Bearer ") || !(await tokenMatches(auth.slice(7), expected)))
      return json(404, { code: "NOT_FOUND" });
    need(u.search === "", "QUERY_NOT_ALLOWED");
    const reply = await env.REGISTRY.getByName(SINGLETON).escrowAdmin(await readPacket(request));
    return new Response(reply.jsonText, { status: reply.status, headers: { ...SECURITY, "content-type": "application/json" } });
  }
  if (u.pathname === "/v1/admin/backup") {
    const expected = env.BACKUP_ADMIN_TOKEN ?? "";
    const auth = request.headers.get("authorization") ?? "";
    if (expected.length < 32 || !auth.startsWith("Bearer ") || !(await tokenMatches(auth.slice(7), expected)))
      return json(404, { code: "NOT_FOUND" });
    need(u.search === "", "QUERY_NOT_ALLOWED");
    return json(200, await runBackup(env, "manual"));
  }
  if (u.pathname === "/v1/admin/restore") {
    const host = u.hostname.toLowerCase();
    if (env.BACKUP_RESTORE_ENABLED !== "local-only" || (host !== "127.0.0.1" && host !== "localhost")) return json(404, { code: "NOT_FOUND" });
    const target = u.searchParams.get("target") ?? "";
    need(RESTORE_TARGET.test(target) && target !== SINGLETON, "RESTORE_TARGET");
    need(request.headers.get("content-type") === "application/json", "CONTENT_TYPE");
    need(!request.headers.has("content-encoding"), "ENCODING");
    const body = parseRestoreInput(await readLimited(request, RESTORE_INPUT_LIMIT));
    const result = await env.REGISTRY.getByName(target).restoreBackup(body.backup, body.keys, body.escrow as import("./registry.js").EscrowExport | undefined);
    return json(200, { target, ...result });
  }
  return json(404, { code: "NOT_FOUND" });
}
export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runBackup(env, kindForCron(controller.cron)).then(() => undefined, (error: unknown) => {
      const code = error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "BACKUP_FAILED";
      console.error(JSON.stringify({ event: "registry-backup-failed", cron: controller.cron, code }));
      throw error;
    }));
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    let submitting = false, dispatched = false;
    try {
      need(request.url.length <= 8192, "URL_SIZE");
      const u = new URL(request.url);
      need((u.pathname + u.search).length <= 4096, "URL_SIZE");
      const host = u.hostname.toLowerCase();
      need(host === "localhost" || host === "127.0.0.1" || host === env.BACKEND_HOST ||
        host === new URL(env.PUBLIC_EXPLORER_URL).hostname || host.endsWith(".grok.me"), "HOST");

      // Same-origin network status: Worker probes minepoa.com; browser never needs a PoA key.
      if (u.pathname === "/v1/network-status") {
        if (request.method !== "GET" && request.method !== "HEAD") return json(405, { code: "METHOD_NOT_ALLOWED" });
        const status = await networkStatusMonitor.getStatus();
        return json(200, status, true);
      }

      if (u.pathname !== "/healthz" && !u.pathname.startsWith("/v1/")) {
        if (request.method !== "GET" && request.method !== "HEAD") return json(405, { code: "METHOD_NOT_ALLOWED" });
        // Deep links: return the SPA shell at 200 without following Assets redirects to "/".
        if (/^\/(d|p)\/[^/]+\/?$/.test(u.pathname)) {
          let shell = await env.ASSETS.fetch(new Request(new URL("/", u.origin), { method: "GET" }));
          if (shell.status >= 300 && shell.status < 400) {
            const loc = shell.headers.get("Location");
            if (loc) shell = await env.ASSETS.fetch(new Request(new URL(loc, u.origin), { method: "GET" }));
          }
          const headers = new Headers(shell.headers);
          headers.set("cache-control", "no-cache, no-store, must-revalidate");
          return new Response(shell.body, { status: 200, headers });
        }
        return env.ASSETS.fetch(request);
      }
      if (u.pathname.startsWith("/v1/admin/")) return await admin(request, env, u);
      if (request.method !== "GET" && !(request.method === "POST" && u.pathname === "/v1/intents")) return json(405, { code: "METHOD_NOT_ALLOWED" });

      // Hold state-changing writes while the public PoA network is Down (2 consecutive failures).
      if (request.method === "POST" && u.pathname === "/v1/intents") {
        need(u.search === "", "QUERY_NOT_ALLOWED");
        const net = networkStatusMonitor.peekStatus();
        if (net.hold) {
          return json(503, {
            code: "NETWORK_HELD",
            accepted: false,
            hold: true,
            level: net.level,
            message: net.message,
            livePoA: false,
          });
        }
      }

      const packet = request.method === "POST" ? await readPacket(request) : undefined;
      submitting = request.method === "POST";
      dispatched = true;
      const reply = await env.REGISTRY.getByName(SINGLETON).handle({ method: request.method, path: u.pathname,
        query: Object.fromEntries(u.searchParams), ...(submitting ? { packet: JSON.stringify(packet) } : {}) });
      return new Response(reply.jsonText, { status: reply.status, headers: { ...SECURITY, "content-type": "application/json; charset=utf-8", ...(request.method === "GET" ? { "access-control-allow-origin": "*" } : {}) } });
    } catch (error) {
      if (error instanceof Fault) return json(error.code === "BODY_TOO_LARGE" ? 413 : 400, { code: error.code, accepted: false });
      if (!dispatched && error instanceof TypeError) return json(400, { code: "INVALID_REQUEST", accepted: false });
      if (submitting) return json(503, { code: "DURABILITY_UNKNOWN_RESTART_AND_QUERY", accepted: "unknown" });
      return json(503, { code: "REGISTRY_UNAVAILABLE", accepted: false });
    }
  },
} satisfies ExportedHandler<Env>;
