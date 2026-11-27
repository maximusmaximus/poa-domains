import { HIDDEN } from "./public-registry-view.js";
import { intentId } from "../src/auth.js";
/** Stateless Streamable HTTP. No sessions, keys, direct PoA I/O or server-side signing. */
import { McpCore, MCP_VERSION, rpcError } from "../src/mcp-core.js";
import { registryMcpProfile, McpRegistryBackend } from "../src/mcp-registry.js";
import { parseMcpJSON } from "../src/mcp-json.js";
import { correlationId, ERROR_CATALOGUE, errorEnvelope, errorReply } from "../src/errors.js";
import { Fault, need } from "../src/core.js";
import { SINGLETON } from "./registry.js";
import { networkStatusMonitor } from "./network-status.js";
import { backupCommittedProfile } from "./profiles-storage.js";
import { buildTermsInfo, TERMS_HASH, TERMS_VERSION, verifyTermsAgreement } from "../src/terms.js";
import { principal } from "../src/auth.js";
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
export async function mcpHttp(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
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
      if (path === "/v1/terms" && method === "GET") {
        return buildTermsInfo({ baseUrl: env.PUBLIC_EXPLORER_URL || new URL(request.url).origin });
      }
      if (path === "/v1/terms/status" && method === "GET") {
        const actor = principal(query.actor ?? "");
        const existing = await env.REGISTRY.getByName(SINGLETON).getTermsAgreement(actor, TERMS_VERSION);
        const agreed = Boolean(existing && existing.termsHash === TERMS_HASH);
        return {
          actor,
          agreed,
          termsVersion: TERMS_VERSION,
          termsHash: TERMS_HASH,
          agreedAt: agreed ? existing!.agreedAt : null,
          recordedAt: agreed ? existing!.recordedAt : null,
        };
      }
      if (path === "/v1/terms/agree" && method === "POST") {
        const nowMs = Date.now();
        const verified = verifyTermsAgreement(packet, Math.floor(nowMs / 1000));
        const saved = await env.REGISTRY.getByName(SINGLETON).recordTermsAgreement({
          actor: verified.statement.actor,
          termsVersion: verified.statement.termsVersion,
          termsHash: verified.statement.termsHash,
          agreedAt: verified.statement.agreedAt,
          recordedAt: nowMs,
          signature: verified.signature,
          statementJson: verified.statementJson,
        });
        if (env.PROFILES && !saved.alreadyAgreed) {
          const putTask = env.PROFILES.put(
            `v1/terms-agreements/${saved.record.termsVersion}/${saved.record.actor}.json`,
            JSON.stringify({
              actor: saved.record.actor,
              termsVersion: saved.record.termsVersion,
              termsHash: saved.record.termsHash,
              agreedAt: saved.record.agreedAt,
              recordedAt: saved.record.recordedAt,
              signature: saved.record.signature,
              statement: verified.statement,
            }),
            { httpMetadata: { contentType: "application/json; charset=utf-8" } },
          ).catch(() => {});
          if (ctx) ctx.waitUntil(putTask);
          else await putTask;
        }
        return {
          ok: true,
          actor: saved.record.actor,
          termsVersion: saved.record.termsVersion,
          termsHash: saved.record.termsHash,
          agreedAt: saved.record.agreedAt,
          recordedAt: saved.record.recordedAt,
          alreadyAgreed: saved.alreadyAgreed,
        };
      }
      if (path.startsWith("/v1/escrow/")) {
        const part = path.slice("/v1/escrow/".length);
        const escrowEnabled = String(env.POA_ESCROW_ENABLED) === "true";
        if (method === "GET" && part === "capabilities" && !escrowEnabled) {
          return {
            enabled: false,
            paused: true,
            held: true,
            holdReason: "POA payments not open",
            address: null,
            limits: {
              perTransaction: env.POA_ESCROW_PER_TX ?? "250000.000000",
              daily: env.POA_ESCROW_DAILY ?? "1000000.000000",
            },
          };
        }
        if (!escrowEnabled) {
          throw Object.assign(new Fault("ESCROW_DISABLED"), {
            detail: errorEnvelope("ESCROW_DISABLED", requestId),
          });
        }
        if (method === "GET" && ["capabilities", "market", "domain", "subnames", "intent"].includes(part)) {
          try {
            return await env.REGISTRY.getByName(SINGLETON).escrowRead(part, { ...query });
          } catch (error) {
            const code = error instanceof Fault ? error.code : error instanceof Error && /^ESCROW_[A-Z_]+$/.test(error.message) ? error.message : "ESCROW_UNAVAILABLE";
            throw Object.assign(new Fault(code), { detail: errorEnvelope(code, requestId) });
          }
        }
        if (method === "POST" && part === "command") {
          const isWrite = packet?.command?.action !== "view";
          if (isWrite && networkStatusMonitor.peekStatus().hold) {
            throw Object.assign(new Fault("NETWORK_HELD"), {
              detail: errorEnvelope("NETWORK_HELD", requestId),
            });
          }
          try {
            return await env.REGISTRY.getByName(SINGLETON).escrowCommand(JSON.stringify(packet), "command");
          } catch (error) {
            const knownCode = error instanceof Fault ? error.code : error instanceof Error && (/^ESCROW_[A-Z_]+$/.test(error.message) || Object.hasOwn(ERROR_CATALOGUE, error.message)) ? error.message : null;
            const unknown = !knownCode || knownCode === "ESCROW_UNAVAILABLE" || knownCode === "ESCROW_HELD" || knownCode === "DURABILITY_UNKNOWN_RESTART_AND_QUERY" || knownCode === "OUTCOME_UNKNOWN" || knownCode === "UNKNOWN_OUTCOME";
            const code = knownCode ?? "ESCROW_UNAVAILABLE";
            throw Object.assign(new Fault(code), {
              detail: errorEnvelope(code, requestId, { accepted: unknown && isWrite ? "unknown" : false }),
            });
          }
        }
        throw Object.assign(new Fault("ESCROW_ROUTE"), { detail: errorEnvelope("ESCROW_ROUTE", requestId) });
      }
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
      if (submitting && packet?.body?.action === "setMetadata") {
        const backupTask = backupCommittedProfile(env, packet, data);
        if (ctx) ctx.waitUntil(backupTask);
        else await backupTask;
      }
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
