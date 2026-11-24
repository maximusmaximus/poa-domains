/** Public domain profile backup (R2 + optional Pinata IPFS pinning) and validated avatar media endpoints. */
import { canonical, Fault, need } from "../src/core.js";
import { correlationId, errorEnvelope } from "../src/errors.js";
import { validCid } from "../src/metadata.js";
import { parseMcpJSON } from "../src/mcp-json.js";
import {
  ALLOWED_IMAGE_TYPES,
  cidForBytes,
  MAX_PROFILE_IMAGE_BYTES,
  PROFILE_SCHEMA_V1,
  sniffImageFormat,
} from "../src/profile.js";

export interface ProfileStorageEnv {
  PROFILES?: R2Bucket;
  BACKEND_HOST: string;
  PUBLIC_EXPLORER_URL?: string;
  PINATA_JWT?: string;
  PINATA_API_URL?: string;
  MCP_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const MAX_JSON_UPLOAD_BYTES = Math.ceil((MAX_PROFILE_IMAGE_BYTES * 4) / 3) + 4096;
const ALLOWED_MIME_SET = new Set<string>(ALLOWED_IMAGE_TYPES);

async function readBoundedBytes(request: Request, limit: number, tooLargeCode: string): Promise<Uint8Array> {
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
        throw new Fault(tooLargeCode);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  need(size > 0, "EMPTY_BODY");
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function decodeStrictBase64(value: string): Uint8Array {
  const cleaned = value.trim();
  need(cleaned.length > 0 && cleaned.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(cleaned), "INVALID_IMAGE_FORMAT");
  const raw = atob(cleaned);
  need(raw.length > 0 && raw.length <= MAX_PROFILE_IMAGE_BYTES, "IMAGE_TOO_LARGE");
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function pinBytesToPinata(
  bytes: Uint8Array,
  filename: string,
  contentType: string,
  env: ProfileStorageEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<{ pinned: boolean; pinataCid?: string }> {
  const jwt = typeof env.PINATA_JWT === "string" ? env.PINATA_JWT.trim() : "";
  if (!jwt) return { pinned: false };
  const baseUrl = (env.PINATA_API_URL || "https://api.pinata.cloud").replace(/\/+$/, "");
  try {
    const form = new FormData();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    form.append("file", new Blob([copy.buffer], { type: contentType }), filename);
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
    form.append("pinataMetadata", JSON.stringify({ name: filename }));
    const res = await fetchImpl(`${baseUrl}/pinning/pinFileToIPFS`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}` },
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { pinned: false };
    const body = (await res.json()) as { IpfsHash?: unknown };
    const pinataCid = typeof body?.IpfsHash === "string" && body.IpfsHash.length <= 128 ? body.IpfsHash : undefined;
    return { pinned: Boolean(pinataCid), ...(pinataCid ? { pinataCid } : {}) };
  } catch {
    return { pinned: false };
  }
}

function allowedHost(hostname: string, env: ProfileStorageEnv): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "poadomains.grok.me" || h === env.BACKEND_HOST || h.endsWith(".grok.me"))
    return true;
  if (env.PUBLIC_EXPLORER_URL) {
    try {
      if (h === new URL(env.PUBLIC_EXPLORER_URL).hostname.toLowerCase()) return true;
    } catch {}
  }
  return false;
}

export async function handleMediaUpload(
  request: Request,
  env: ProfileStorageEnv,
  fetchImpl: typeof fetch = fetch,
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
    // Browser uploads must come from an allowed same-site origin; non-browser agents omit Origin.
    const originHeader = request.headers.get("origin");
    if (originHeader !== null) {
      let origin: URL;
      try {
        origin = new URL(originHeader);
      } catch {
        return fail(403, "HOST");
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
        return fail(403, "HOST");
    }
    if (!env.PROFILES) return fail(503, "MEDIA_STORAGE_DISABLED");
    if (env.MCP_RATE_LIMITER) {
      const ip = request.headers.get("cf-connecting-ip") ?? "local";
      let ok = false;
      try {
        ok = (await env.MCP_RATE_LIMITER.limit({ key: "poa-domains:media:" + ip })).success;
      } catch {
        return fail(503, "MCP_RATE_UNAVAILABLE");
      }
      if (!ok) return fail(429, "MEDIA_RATE_LIMITED");
    }
    const rawType = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const lengthHeader = request.headers.get("content-length");
    let bytes: Uint8Array;
    let declaredType: string;
    if (ALLOWED_MIME_SET.has(rawType)) {
      if (lengthHeader !== null && (!/^[0-9]+$/.test(lengthHeader) || Number(lengthHeader) > MAX_PROFILE_IMAGE_BYTES))
        return fail(413, "IMAGE_TOO_LARGE");
      bytes = await readBoundedBytes(request, MAX_PROFILE_IMAGE_BYTES, "IMAGE_TOO_LARGE");
      declaredType = rawType;
    } else if (rawType === "application/json") {
      if (lengthHeader !== null && (!/^[0-9]+$/.test(lengthHeader) || Number(lengthHeader) > MAX_JSON_UPLOAD_BYTES))
        return fail(413, "IMAGE_TOO_LARGE");
      const rawBytes = await readBoundedBytes(request, MAX_JSON_UPLOAD_BYTES, "IMAGE_TOO_LARGE");
      const parsed = parseMcpJSON(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes), MAX_JSON_UPLOAD_BYTES, 8);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.keys(parsed).length !== 2 ||
        typeof parsed.contentType !== "string" ||
        typeof parsed.dataBase64 !== "string" ||
        !ALLOWED_MIME_SET.has(parsed.contentType.toLowerCase())
      )
        return fail(400, "INVALID_IMAGE_FORMAT");
      declaredType = parsed.contentType.toLowerCase();
      bytes = decodeStrictBase64(parsed.dataBase64);
    } else {
      return fail(400, "INVALID_IMAGE_FORMAT");
    }
    const detected = sniffImageFormat(bytes);
    if (!detected || detected !== declaredType) return fail(400, "INVALID_IMAGE_FORMAT");
    const cid = cidForBytes(bytes);
    const key = `v1/media/${cid}`;
    try {
      const existing = await env.PROFILES.head(key);
      if (!existing) {
        await env.PROFILES.put(key, bytes, {
          httpMetadata: { contentType: detected },
          customMetadata: {
            cid,
            contentType: detected,
            bytes: String(bytes.byteLength),
            uploadedAt: new Date().toISOString(),
          },
        });
      }
    } catch {
      return fail(503, "MEDIA_UPLOAD_FAILED");
    }
    const pin = await pinBytesToPinata(bytes, `poadomains-media-${cid}`, detected, env, fetchImpl);
    return Response.json(
      {
        cid,
        uri: `ipfs://${cid}`,
        mediaUrl: `/v1/media/${cid}`,
        contentType: detected,
        bytes: bytes.byteLength,
        r2Stored: true,
        ipfsPinned: pin.pinned,
        ...(pin.pinataCid ? { pinataCid: pin.pinataCid } : {}),
      },
      { status: 200, headers },
    );
  } catch (error) {
    if (error instanceof Fault) {
      const status = error.code === "IMAGE_TOO_LARGE" || error.code === "BODY_TOO_LARGE" ? 413 : 400;
      return fail(status, error.code);
    }
    return fail(400, "INVALID_REQUEST");
  }
}

export async function handleMediaGet(request: Request, env: ProfileStorageEnv, rawCid: string): Promise<Response> {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const fail = (status: number, code: string) =>
    Response.json(errorEnvelope(code, requestId), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  if (request.method !== "GET" && request.method !== "HEAD") return fail(405, "METHOD_NOT_ALLOWED");
  let cid: string;
  try {
    cid = validCid(rawCid);
  } catch {
    return fail(400, "CID");
  }
  if (!env.PROFILES) return fail(404, "RESOURCE_NOT_FOUND");
  const key = `v1/media/${cid}`;
  if (request.method === "HEAD") {
    const head = await env.PROFILES.head(key);
    if (!head) return fail(404, "RESOURCE_NOT_FOUND");
    const ct = head.httpMetadata?.contentType ?? "";
    if (!ALLOWED_MIME_SET.has(ct)) return fail(404, "RESOURCE_NOT_FOUND");
    return new Response(null, {
      status: 200,
      headers: {
        "content-type": ct,
        "content-length": String(head.size),
        "cache-control": "public, max-age=31536000, immutable",
        "content-disposition": "inline",
      },
    });
  }
  const obj = await env.PROFILES.get(key);
  if (!obj) return fail(404, "RESOURCE_NOT_FOUND");
  const ct = obj.httpMetadata?.contentType ?? "";
  if (!ALLOWED_MIME_SET.has(ct)) return fail(404, "RESOURCE_NOT_FOUND");
  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": ct,
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": "inline",
    },
  });
}

export async function backupCommittedProfile(
  env: ProfileStorageEnv,
  packet: any,
  receipt: any,
  fetchImpl: typeof fetch = fetch,
): Promise<{ backedUp: boolean; ipfsPinned: boolean; cid?: string }> {
  try {
    if (
      !packet ||
      packet.body?.action !== "setMetadata" ||
      receipt?.status !== "succeeded" ||
      packet.body?.params?.metadata?.document?.schema !== PROFILE_SCHEMA_V1
    )
      return { backedUp: false, ipfsPinned: false };
    const meta = packet.body.params.metadata;
    const doc = meta.document;
    const cid = validCid(meta.cid);
    const bytes = new TextEncoder().encode(canonical(doc));
    if (cidForBytes(bytes) !== cid) return { backedUp: false, ipfsPinned: false };
    const metadataVersion = Number.isSafeInteger(receipt.result?.metadataVersion)
      ? receipt.result.metadataVersion
      : 1;
    const nameKey = encodeURIComponent(String(doc.name));
    let backedUp = false;
    if (env.PROFILES) {
      const commonMeta = {
        schema: PROFILE_SCHEMA_V1,
        name: String(doc.name),
        cid,
        metadataVersion: String(metadataVersion),
        backedUpAt: new Date().toISOString(),
      };
      await Promise.all([
        env.PROFILES.put(`v1/profiles/by-cid/${cid}.json`, bytes, {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
          customMetadata: commonMeta,
        }),
        env.PROFILES.put(`v1/profiles/by-name/${nameKey}/v${metadataVersion}-${cid}.json`, bytes, {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
          customMetadata: commonMeta,
        }),
        env.PROFILES.put(`v1/profiles/by-name/${nameKey}/latest.json`, bytes, {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
          customMetadata: commonMeta,
        }),
      ]);
      backedUp = true;
    }
    const pin = await pinBytesToPinata(
      bytes,
      `poadomains-profile-${nameKey}-v${metadataVersion}.json`,
      "application/json",
      env,
      fetchImpl,
    );
    return { backedUp, ipfsPinned: pin.pinned, cid };
  } catch {
    return { backedUp: false, ipfsPinned: false };
  }
}
