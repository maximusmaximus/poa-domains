import { HIDDEN } from "./public-registry-view.js";
import { intentId } from "../src/auth.js";
/** Stateless Streamable HTTP. No sessions, keys, direct PoA I/O or server-side signing. */
import { McpCore, MCP_VERSION, rpcError } from "../src/mcp-core.js";
import { registryMcpProfile, McpRegistryBackend } from "../src/mcp-registry.js";
import { parseMcpJSON } from "../src/mcp-json.js";
import { correlationId, errorEnvelope, errorReply } from "../src/errors.js";
import { Fault, need } from "../src/core.js";
import { SINGLETON } from "./registry.js";
import { networkStatusMonitor } from "./network-status.js";
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
async function bodyText(request: Request): Promise<string> {
  need(!request.headers.has("content-encoding"), "ENCODING");
  need(
    /^application\/json(?:;\s*charset=utf-8)?$/i.test(
      request.headers.get("content-type") ?? "",
    ),
    "CONTENT_TYPE",
  );
  const length = request.headers.get("content-length");
  if (length !== null)
    need(/^[0-9]+$/.test(length) && Number(length) <= 65536, "BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  need(reader, "EMPTY_BODY");
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Fault("BODY_TOO_LARGE");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export async function mcpHttp(request: Request, env: Env): Promise<Response> {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const fail = (status: number, code: string, rpcCode = -32600) =>
    new Response(
      JSON.stringify(
        rpcError(rpcCode, code, undefined, errorEnvelope(code, requestId)),
      ),
      {
        status,
        headers: {
          ...HEADERS,
          ...(status === 429 ? { "retry-after": "60" } : {}),
          ...(status === 405 ? { allow: "POST" } : {}),
        },
      },
    );
  try {
    if (request.headers.has("origin") || request.headers.has("sec-fetch-site"))
      return fail(403, "MCP_ORIGIN");
    if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
    need(new URL(request.url).search === "", "QUERY_NOT_ALLOWED");
    const version = request.headers.get("mcp-protocol-version");
    if (version !== null && version !== MCP_VERSION)
      return fail(400, "MCP_PROTOCOL_VERSION");
    const accept = (request.headers.get("accept") ?? "")
      .split(",")
      .map((x) => x.trim().split(";")[0]);
    if (
      !accept.includes("application/json") ||
      !accept.includes("text/event-stream")
    )
      return fail(406, "MCP_ACCEPT");
    if (!env.MCP_RATE_LIMITER) return fail(503, "MCP_RATE_UNAVAILABLE");
    // CF-Connecting-IP is supplied by Cloudflare, never trust X-Forwarded-For or a signer.
    const ip = request.headers.get("cf-connecting-ip") ?? "missing-ip";
    let allowed: boolean;
    try {
      allowed = (
        await env.MCP_RATE_LIMITER.limit({ key: "poa-domains:mcp:" + ip })
      ).success;
    } catch {
      return fail(503, "MCP_RATE_UNAVAILABLE");
    }
    if (!allowed) return fail(429, "MCP_RATE_LIMITED");
    const raw = await bodyText(request);
    let message: any;
    try {
      message = parseMcpJSON(raw);
    } catch {
      return fail(400, "MCP_PARSE_ERROR", -32700);
    }
    if (
      message?.jsonrpc === "2.0" &&
      !message.method &&
      (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))
    )
      return fail(400, "RPC");
    if (version === null && message?.method !== "initialize")
      return fail(400, "MCP_PROTOCOL_VERSION");
    const backend: McpRegistryBackend = async (
      method,
      path,
      query = {},
      packet,
    ) => {
      const submitting = method === "POST" && path === "/v1/intents";
      if (submitting && networkStatusMonitor.peekStatus().hold)
        throw Object.assign(new Fault("NETWORK_HELD"), {
          detail: errorEnvelope("NETWORK_HELD", requestId),
        });
      let reply, data;
      try {
        reply = await env.REGISTRY.getByName(SINGLETON).handle({
          method,
          path,
          // The hardened MCP parser intentionally returns null-prototype records.
          // DO RPC accepts ordinary records, not those parser objects. These are
          // schema-validated flat string filters; signed packets stay JSON text.
          query: { ...query },
          requestId,
          ...(packet !== undefined ? { packet: JSON.stringify(packet) } : {}),
        });
        data = JSON.parse(reply.jsonText);
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw Error("Malformed RPC reply");
        if (
          submitting &&
          reply.status < 400 &&
          (data.intentId !== intentId(packet.body) ||
            data.requestId !== packet.body.requestId ||
            !["succeeded", "rejected"].includes(data.status) ||
            data.accepted !== true)
        )
          throw Error("Mismatched RPC receipt");
      } catch (error) {
        const code =
          error instanceof Fault
            ? error.code
            : submitting
              ? "DURABILITY_UNKNOWN_RESTART_AND_QUERY"
              : "REGISTRY_UNAVAILABLE";
        throw Object.assign(new Fault(code), {
          detail: errorEnvelope(code, requestId, {
            accepted:
              submitting && !(error instanceof Fault) ? "unknown" : false,
          }),
        });
      }
      if (reply.status >= 400)
        throw Object.assign(new Fault(data.code), {
          detail: errorReply(reply.status, data, requestId).body,
        });
      return data;
    };
    const response = await new McpCore(
      registryMcpProfile(backend, async args => {
        await backend("GET", "/v1/resolve", {name: args.name});
        if(args.parentId && (HIDDEN.deeds as readonly string[]).includes(args.parentId)) throw new Fault("PUBLIC_RECORD_WITHHELD");
      }),
      true,
    ).handle(raw);
    return response === null
      ? new Response(null, {
          status: 202,
          headers: { "cache-control": "no-store" },
        })
      : new Response(JSON.stringify(response), {
          status: 200,
          headers: HEADERS,
        });
  } catch (error) {
    return fail(
      error instanceof Fault && error.code === "BODY_TOO_LARGE" ? 413 : 400,
      error instanceof Fault ? error.code : "MCP_PARSE_ERROR",
      error instanceof Fault ? -32600 : -32700,
    );
  }
}
