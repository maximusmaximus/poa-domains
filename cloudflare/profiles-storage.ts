/** Public domain profile backup (R2 + optional Pinata IPFS pinning) and validated avatar media endpoints. */
import { canonical, Fault, need } from "../src/core.js";
import { correlationId, errorEnvelope } from "../src/errors.js";
import { validCid } from "../src/metadata.js";
import { parseMcpJSON } from "../src/mcp-json.js";
import {
  ALLOWED_IMAGE_TYPES,
  cidForBytes,
  extractLatestProfile,
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
  PINATA_GROUP_ID?: string;
  MEDIA_UPLOAD_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

/** Per-client hourly upload cap (on top of the per-minute MEDIA_UPLOAD_LIMITER binding). */
export const MEDIA_UPLOAD_HOURLY_PER_CLIENT = 30;
/** Hourly cap across all clients; bounds storage and pinning use even behind a shared proxy IP. */
export const MEDIA_UPLOAD_HOURLY_GLOBAL = 200;
const LIMIT_PREFIX = "v1/limits/uploads/";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PinLog = (event: Record<string, unknown>) => void;
const defaultPinLog: PinLog = (event) => console.warn(JSON.stringify(event));

function safeText(value: unknown, secret: string): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  let text = value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200);
  if (secret && text.includes(secret)) text = text.split(secret).join("[redacted]");
  return text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

/** Extracts only Pinata's error code/message; never headers or request data. */
function pinataError(body: unknown, secret: string): { code?: string; message?: string } {
  const b = body as any;
  const e = b?.error;
  if (typeof e === "string") return { message: safeText(e, secret) };
  if (e && typeof e === "object")
    return { code: safeText(e.code ?? e.reason, secret), message: safeText(e.details ?? e.message, secret) };
  return { code: safeText(b?.code ?? b?.reason, secret), message: safeText(b?.message ?? b?.details, secret) };
}

const MAX_JSON_UPLOAD_BYTES = Math.ceil((MAX_PROFILE_IMAGE_BYTES * 4) / 3) + 4096;
const ALLOWED_MIME_SET = new Set<string>(ALLOWED_IMAGE_TYPES);

async function readBoundedBytes(source: { body: ReadableStream<Uint8Array> | null }, limit: number, tooLargeCode: string): Promise<Uint8Array> {
  const reader = source.body?.getReader();
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
  log: PinLog = defaultPinLog,
): Promise<{ pinned: boolean; pinataCid?: string }> {
  const jwt = typeof env.PINATA_JWT === "string" ? env.PINATA_JWT.trim() : "";
  if (!jwt) return { pinned: false };
  const baseUrl = (env.PINATA_API_URL || "https://api.pinata.cloud").replace(/\/+$/, "");
  const groupId = typeof env.PINATA_GROUP_ID === "string" && UUID_RE.test(env.PINATA_GROUP_ID.trim())
    ? env.PINATA_GROUP_ID.trim().toLowerCase()
    : undefined;
  const fail = (detail: Record<string, unknown>) => {
    try {
      log({ event: "pinata_pin_failed", filename, ...detail });
    } catch {}
    return { pinned: false };
  };
  let res: Response;
  try {
    const form = new FormData();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    form.append("file", new File([copy], filename, { type: contentType }));
    // Legacy pinning API: the group goes in pinataOptions.groupId.
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1, ...(groupId ? { groupId } : {}) }));
    form.append("pinataMetadata", JSON.stringify({ name: filename }));
    // Workers reject redirect:"error"; use "manual" and treat any non-2xx as a failure.
    res = await fetchImpl(`${baseUrl}/pinning/pinFileToIPFS`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}` },
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    return fail({ status: 0, code: safeText((error as any)?.name, jwt) ?? "FETCH_FAILED", message: safeText((error as any)?.message, jwt) });
  }
  let body: unknown = undefined;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) return fail({ status: res.status, ...pinataError(body, jwt) });
  const hash = (body as { IpfsHash?: unknown } | undefined)?.IpfsHash;
  const pinataCid = typeof hash === "string" && hash.length <= 128 ? hash : undefined;
  if (!pinataCid) return fail({ status: res.status, code: "NO_IPFS_HASH" });
  return { pinned: true, pinataCid };
}

async function clientKey(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("poa-domains:media:" + ip));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readCount(bucket: R2Bucket, key: string): Promise<number> {
  const obj = await bucket.get(key);
  if (!obj) return 0;
  const n = Number(await obj.text());
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/**
 * Approximate hourly caps kept as small counter objects in R2 (no raw IPs stored; keys hold a
 * truncated hash). Counters may undercount slightly under concurrency; the per-minute binding
 * bounds bursts. Reports the seconds until the window resets when limited.
 */
export async function checkHourlyUploadCaps(
  bucket: R2Bucket,
  ip: string,
  now: number = Date.now(),
): Promise<{ limited: false } | { limited: true; retryAfter: number }> {
  const hour = new Date(now).toISOString().slice(0, 13).replace(/[-T:]/g, "");
  const retryAfter = Math.max(1, Math.ceil((3600000 - (now % 3600000)) / 1000));
  const globalKey = `${LIMIT_PREFIX}${hour}/all`;
  const clientCounter = `${LIMIT_PREFIX}${hour}/c-${await clientKey(ip)}`;
  const [all, mine] = await Promise.all([readCount(bucket, globalKey), readCount(bucket, clientCounter)]);
  if (all >= MEDIA_UPLOAD_HOURLY_GLOBAL || mine >= MEDIA_UPLOAD_HOURLY_PER_CLIENT) return { limited: true, retryAfter };
  const meta = { httpMetadata: { contentType: "text/plain" } };
  await Promise.all([bucket.put(globalKey, String(all + 1), meta), bucket.put(clientCounter, String(mine + 1), meta)]);
  return { limited: false };
}

function allowedHost(hostname: string, env: ProfileStorageEnv): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "poadomains.grok.me" || h === "poadomains.link" || h === env.BACKEND_HOST || h.endsWith(".grok.me"))
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
  now: () => number = Date.now,
): Promise<Response> {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const fail = (status: number, code: string, retryAfter = 60) =>
    Response.json(errorEnvelope(code, requestId), {
      status,
      headers: status === 429 ? { ...headers, "retry-after": String(retryAfter) } : headers,
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
    // Uploads have their own limiter, well below the general MCP limit; fail closed if unavailable.
    if (!env.MEDIA_UPLOAD_LIMITER) return fail(503, "MEDIA_RATE_UNAVAILABLE");
    const ip = request.headers.get("cf-connecting-ip") ?? "missing-ip";
    let ok = false;
    try {
      ok = (await env.MEDIA_UPLOAD_LIMITER.limit({ key: "poa-domains:media:" + ip })).success;
    } catch {
      return fail(503, "MEDIA_RATE_UNAVAILABLE");
    }
    if (!ok) return fail(429, "MEDIA_RATE_LIMITED");
    let hourly: Awaited<ReturnType<typeof checkHourlyUploadCaps>>;
    try {
      hourly = await checkHourlyUploadCaps(env.PROFILES, ip, now());
    } catch {
      return fail(503, "MEDIA_RATE_UNAVAILABLE");
    }
    if (hourly.limited) return fail(429, "MEDIA_HOURLY_LIMITED", hourly.retryAfter);
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

export interface DomainAvatarLookupResult {
  status: number;
  deed?: any;
  code?: string;
}

const BLOCKED_IMAGE_TLDS = new Set([
  "localhost",
  "local",
  "internal",
  "lan",
  "arpa",
  "localdomain",
  "invalid",
]);

/** Validates an external committed profile image URL against SSRF/private-host rules. */
export function validateSafePublicImageUrl(rawUrl: string): URL | null {
  if (typeof rawUrl !== "string" || !rawUrl || rawUrl.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port !== "" && u.port !== "443") return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.includes(":") || host.startsWith("[")) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  const tld = labels[labels.length - 1]!;
  // Alphabetic or punycode TLD automatically excludes numeric/octal/hex IPv4 and single-label hosts.
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return null;
  if (BLOCKED_IMAGE_TLDS.has(tld)) return null;
  return u;
}

function isSelfHost(hostname: string, env: ProfileStorageEnv): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "poadomains.grok.me" || h === "poadomains.link" || h === env.BACKEND_HOST.toLowerCase()) return true;
  if (env.PUBLIC_EXPLORER_URL) {
    try {
      if (h === new URL(env.PUBLIC_EXPLORER_URL).hostname.toLowerCase()) return true;
    } catch {}
  }
  return false;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Same-origin read-only avatar endpoint for a domain's committed profile.image.
 * Only ever serves images committed in the registry state (never arbitrary caller URLs),
 * validates image magic bytes, enforces the 5 MiB cap, and caches verified external images in R2.
 */
export async function handleDomainAvatarGet(
  request: Request,
  env: ProfileStorageEnv,
  rawName: string,
  lookupDeed: (rawName: string, requestId: string) => Promise<DomainAvatarLookupResult>,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const fail = (status: number, code: string) =>
    Response.json(errorEnvelope(code, requestId), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  if (request.method !== "GET" && request.method !== "HEAD") return fail(405, "METHOD_NOT_ALLOWED");
  if (!rawName || rawName.includes("/")) return fail(400, "NAME");
  const lookup = await lookupDeed(rawName, requestId);
  if (lookup.status >= 400) return fail(lookup.status, lookup.code ?? "RESOURCE_NOT_FOUND");
  const deed = lookup.deed;
  if (!deed || deed.retired) return fail(404, "RESOURCE_NOT_FOUND");
  const extracted = extractLatestProfile(deed);
  const image = extracted && !extracted.isDefault ? extracted.profile?.image : null;
  if (typeof image !== "string" || !image) return fail(404, "RESOURCE_NOT_FOUND");
  if (image.startsWith("ipfs://")) {
    return handleMediaGet(request, env, image.slice(7));
  }
  const safeUrl = validateSafePublicImageUrl(image);
  if (!safeUrl || isSelfHost(safeUrl.hostname, env)) return fail(404, "RESOURCE_NOT_FOUND");
  const urlHash = await sha256Hex("poa-domains:ext-avatar:" + safeUrl.href);
  const cacheKey = `v1/media/ext/${urlHash}`;
  const imageHeaders = (ct: string, len?: number): Record<string, string> => ({
    "content-type": ct,
    ...(len !== undefined ? { "content-length": String(len) } : {}),
    "cache-control": "public, max-age=600",
    "content-disposition": "inline",
  });
  if (env.PROFILES) {
    try {
      if (request.method === "HEAD") {
        const head = await env.PROFILES.head(cacheKey);
        const ct = head?.httpMetadata?.contentType ?? "";
        if (head && ALLOWED_MIME_SET.has(ct)) {
          return new Response(null, { status: 200, headers: imageHeaders(ct, head.size) });
        }
      } else {
        const cached = await env.PROFILES.get(cacheKey);
        const ct = cached?.httpMetadata?.contentType ?? "";
        if (cached && ALLOWED_MIME_SET.has(ct)) {
          return new Response(cached.body, { status: 200, headers: imageHeaders(ct, cached.size) });
        }
      }
    } catch {}
  }
  let upstream: Response;
  try {
    // Workers reject redirect:"error"; use "manual" and treat any non-200 (including 3xx) as failure.
    upstream = await fetchImpl(safeUrl.href, {
      method: "GET",
      headers: { accept: "image/png,image/jpeg,image/webp,image/gif" },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return fail(404, "RESOURCE_NOT_FOUND");
  }
  if (upstream.status !== 200) return fail(404, "RESOURCE_NOT_FOUND");
  const lenHeader = upstream.headers.get("content-length");
  if (lenHeader !== null && (!/^[0-9]+$/.test(lenHeader) || Number(lenHeader) > MAX_PROFILE_IMAGE_BYTES)) {
    return fail(413, "IMAGE_TOO_LARGE");
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBytes(upstream, MAX_PROFILE_IMAGE_BYTES, "IMAGE_TOO_LARGE");
  } catch (error) {
    if (error instanceof Fault && error.code === "IMAGE_TOO_LARGE") return fail(413, "IMAGE_TOO_LARGE");
    return fail(404, "INVALID_IMAGE_FORMAT");
  }
  const detected = sniffImageFormat(bytes);
  if (!detected) return fail(400, "INVALID_IMAGE_FORMAT");
  if (env.PROFILES) {
    try {
      await env.PROFILES.put(cacheKey, bytes, {
        httpMetadata: { contentType: detected },
        customMetadata: {
          urlHash,
          contentType: detected,
          bytes: String(bytes.byteLength),
          cachedAt: new Date().toISOString(),
        },
      });
    } catch {}
  }
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return new Response(request.method === "HEAD" ? null : out, {
    status: 200,
    headers: imageHeaders(detected, bytes.byteLength),
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
      (packet.body?.action !== "setMetadata" && packet.body?.action !== "issueReserved") ||
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
