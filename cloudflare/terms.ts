/** HTTP handlers for /v1/terms, /v1/terms/status, and signed agent /v1/terms/agree. */
import { principal } from "../src/auth.js";
import { Fault, need } from "../src/core.js";
import { correlationId, errorEnvelope } from "../src/errors.js";
import { parseMcpJSON } from "../src/mcp-json.js";
import { buildTermsInfo, TERMS_HASH, TERMS_VERSION, verifyTermsAgreement } from "../src/terms.js";

const MAX_TERMS_BODY_BYTES = 8_192;

export interface TermsAgreementRecord {
  actor: string;
  termsVersion: string;
  termsHash: string;
  agreedAt: number;
  recordedAt: number;
  signature: string;
  statementJson: string;
}

export interface TermsStore {
  getTermsAgreement(actor: string, termsVersion: string): Promise<TermsAgreementRecord | null>;
  recordTermsAgreement(row: TermsAgreementRecord): Promise<{ record: TermsAgreementRecord; alreadyAgreed: boolean }>;
}

export interface TermsEnv {
  BACKEND_HOST: string;
  PUBLIC_EXPLORER_URL?: string;
  PROFILES?: R2Bucket;
  MCP_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

function allowedHost(hostname: string, env: TermsEnv): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "poadomains.link" || h === env.BACKEND_HOST)
    return true;
  if (env.PUBLIC_EXPLORER_URL) {
    try {
      if (h === new URL(env.PUBLIC_EXPLORER_URL).hostname.toLowerCase()) return true;
    } catch {}
  }
  return false;
}

function checkSameSiteOrigin(request: Request, u: URL, env: TermsEnv): boolean {
  const originHeader = request.headers.get("origin");
  if (originHeader === null) return true;
  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return false;
  }
  if (
    !allowedHost(origin.hostname, env) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (u.hostname !== "127.0.0.1" && u.hostname !== "localhost" && (origin.protocol !== "https:" || !!origin.port))
  )
    return false;
  return true;
}

async function readBoundedText(request: Request, limit: number): Promise<string> {
  const reader = request.body?.getReader();
  need(reader, "EMPTY_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Fault("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  need(size > 0, "EMPTY_BODY");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function handleTermsInfo(
  request: Request,
  env: TermsEnv,
  options?: { nowSec?: () => number },
): Promise<Response> {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  };
  const u = new URL(request.url);
  if (!allowedHost(u.hostname, env)) {
    return Response.json(errorEnvelope("HOST", requestId), { status: 403, headers });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json(errorEnvelope("METHOD_NOT_ALLOWED", requestId), { status: 405, headers });
  }
  if (u.search) {
    return Response.json(errorEnvelope("QUERY_NOT_ALLOWED", requestId), { status: 400, headers });
  }
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  const baseUrl = env.PUBLIC_EXPLORER_URL || u.origin;
  return Response.json(
    buildTermsInfo({
      baseUrl,
      nowSec: (options?.nowSec ?? (() => Math.floor(Date.now() / 1000)))(),
    }),
    { status: 200, headers },
  );
}

export async function handleTermsStatus(
  request: Request,
  env: TermsEnv,
  store: TermsStore,
): Promise<Response> {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  };
  const u = new URL(request.url);
  if (!allowedHost(u.hostname, env)) {
    return Response.json(errorEnvelope("HOST", requestId), { status: 403, headers });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json(errorEnvelope("METHOD_NOT_ALLOWED", requestId), { status: 405, headers });
  }
  const keys = [...u.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "actor") {
    return Response.json(errorEnvelope("QUERY_NOT_ALLOWED", requestId), { status: 400, headers });
  }
  let actor: string;
  try {
    actor = principal(u.searchParams.get("actor") ?? "");
  } catch {
    return Response.json(errorEnvelope("PRINCIPAL", requestId), { status: 400, headers });
  }
  const existing = await store.getTermsAgreement(actor, TERMS_VERSION);
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  const agreed = Boolean(existing && existing.termsHash === TERMS_HASH);
  return Response.json(
    {
      actor,
      agreed,
      termsVersion: TERMS_VERSION,
      termsHash: TERMS_HASH,
      agreedAt: agreed ? existing!.agreedAt : null,
      recordedAt: agreed ? existing!.recordedAt : null,
    },
    { status: 200, headers },
  );
}

export async function handleTermsAgree(
  request: Request,
  env: TermsEnv,
  store: TermsStore,
  options?: { nowMs?: () => number },
): Promise<Response> {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const fail = (status: number, code: string) =>
    Response.json(errorEnvelope(code, requestId), {
      status,
      headers: status === 429 ? { ...headers, "retry-after": "60" } : headers,
    });
  try {
    const u = new URL(request.url);
    if (!allowedHost(u.hostname, env)) return fail(403, "HOST");
    if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
    if (u.search) return fail(400, "QUERY_NOT_ALLOWED");
    if (request.headers.has("content-encoding")) return fail(400, "ENCODING");
    if (!checkSameSiteOrigin(request, u, env)) return fail(403, "HOST");

    const ctype = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (ctype !== "application/json") return fail(400, "CONTENT_TYPE");

    const lenHeader = request.headers.get("content-length");
    if (lenHeader !== null && (!/^[0-9]+$/.test(lenHeader) || Number(lenHeader) > MAX_TERMS_BODY_BYTES)) {
      return fail(413, "BODY_TOO_LARGE");
    }

    const ip = request.headers.get("cf-connecting-ip") ?? "local";
    if (env.MCP_RATE_LIMITER) {
      try {
        const ok = (await env.MCP_RATE_LIMITER.limit({ key: "poa-domains:terms:" + ip })).success;
        if (!ok) return fail(429, "TERMS_RATE_LIMITED");
      } catch {
        return fail(503, "MCP_RATE_UNAVAILABLE");
      }
    }

    const rawText = await readBoundedText(request, MAX_TERMS_BODY_BYTES);
    const parsed = parseMcpJSON(rawText, MAX_TERMS_BODY_BYTES, 8);
    const nowMs = (options?.nowMs ?? Date.now)();
    const verified = verifyTermsAgreement(parsed, Math.floor(nowMs / 1000));

    const saved = await store.recordTermsAgreement({
      actor: verified.statement.actor,
      termsVersion: verified.statement.termsVersion,
      termsHash: verified.statement.termsHash,
      agreedAt: verified.statement.agreedAt,
      recordedAt: nowMs,
      signature: verified.signature,
      statementJson: verified.statementJson,
    });

    if (env.PROFILES && !saved.alreadyAgreed) {
      await env.PROFILES.put(
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
    }

    return Response.json(
      {
        ok: true,
        actor: saved.record.actor,
        termsVersion: saved.record.termsVersion,
        termsHash: saved.record.termsHash,
        agreedAt: saved.record.agreedAt,
        recordedAt: saved.record.recordedAt,
        alreadyAgreed: saved.alreadyAgreed,
      },
      { status: saved.alreadyAgreed ? 200 : 201, headers },
    );
  } catch (error) {
    if (error instanceof Fault) {
      const status =
        error.code === "BODY_TOO_LARGE"
          ? 413
          : error.code === "TERMS_VERSION_MISMATCH"
            ? 409
            : 400;
      return fail(status, error.code);
    }
    return fail(400, "TERMS_INVALID_INPUT");
  }
}
