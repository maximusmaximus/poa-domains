import { Fault, need, parseJSON } from "../src/core.js";
import { SINGLETON } from "./registry.js";
import { networkStatusMonitor } from "./network-status.js";
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
export default {
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
          headers.set("cache-control", "no-store");
          return new Response(shell.body, { status: 200, headers });
        }
        return env.ASSETS.fetch(request);
      }
      if (request.method !== "GET" && !(request.method === "POST" && u.pathname === "/v1/intents")) return json(405, { code: "METHOD_NOT_ALLOWED" });

      // Hold state-changing writes while the public PoA network is Down (2 consecutive failures).
      if (request.method === "POST" && u.pathname === "/v1/intents") {
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
