/** Anti-abuse user bug/feature feedback endpoint with self-hosted SVG CAPTCHA, SHA-256 PoW, DO quotas, and GitHub Issue filing. */
import { Fault, need, noSecrets } from "../src/core.js";
import { correlationId, errorEnvelope } from "../src/errors.js";
import { parseMcpJSON } from "../src/mcp-json.js";
import { poascanAddressUrl, validPoaAddr } from "./treasury.js";

export const DEFAULT_FEEDBACK_REPO = "maximusmaximus/poa-domains";
export const CAPTCHA_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CAPTCHA_LENGTH = 5;
export const DEFAULT_POW_BITS = 16;
export const DEFAULT_MIN_DWELL_MS = 3_000;
export const CHALLENGE_TTL_MS = 10 * 60_000;
const MAX_FEEDBACK_BODY_BYTES = 16_384;

export interface FeedbackChallengeRow {
  id: string;
  answerHash: string;
  svg: string;
  powSalt: string;
  powBits: number;
  createdAt: number;
  expiresAt: number;
  ipHash: string;
}

export interface FeedbackConsumeInput {
  id: string;
  answerHash: string;
  ipHash: string;
  poaHash: string | null;
  contentHash: string;
  now: number;
  minDwellMs: number;
}

export type FeedbackConsumeResult =
  | { ok: true; powSalt: string; powBits: number }
  | { ok: false; code: string; retryAfterSec?: number };

export interface FeedbackStore {
  createFeedbackChallenge(row: FeedbackChallengeRow): Promise<{ ok: true } | { ok: false; code: string }>;
  getFeedbackChallengeMeta(id: string, now: number): Promise<{ powSalt: string; powBits: number; svg: string } | null>;
  consumeFeedbackChallenge(input: FeedbackConsumeInput): Promise<FeedbackConsumeResult>;
}

export interface FeedbackEnv {
  BACKEND_HOST: string;
  PUBLIC_EXPLORER_URL?: string;
  FEEDBACK_GITHUB_TOKEN?: string;
  FEEDBACK_GITHUB_REPO?: string;
  PROFILES?: R2Bucket;
  MCP_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateCaptchaCode(length = CAPTCHA_LENGTH): string {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CAPTCHA_ALPHABET[buf[i]! % CAPTCHA_ALPHABET.length];
  }
  return out;
}

/** Pure presentation-attribute SVG (zero style= attributes, zero scripts) so it renders cleanly under strict CSP img-src 'self'. */
export function renderCaptchaSvg(code: string): string {
  const rand = new Uint8Array(32);
  crypto.getRandomValues(rand);
  let ri = 0;
  const next = (min: number, max: number) => min + (rand[ri++ % rand.length]! % (max - min + 1));

  const lines: string[] = [];
  for (let i = 0; i < 4; i++) {
    const x1 = next(4, 24), y1 = next(8, 48);
    const cx = next(55, 125), cy = next(6, 50);
    const x2 = next(156, 176), y2 = next(8, 48);
    const color = i % 2 === 0 ? "#2d606c" : "#3a5068";
    lines.push(`<path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="1.6" opacity="0.75"/>`);
  }
  const dots: string[] = [];
  for (let i = 0; i < 14; i++) {
    dots.push(`<circle cx="${next(8, 172)}" cy="${next(8, 48)}" r="1.4" fill="#527c89" opacity="0.65"/>`);
  }
  const glyphs: string[] = [];
  const palette = ["#9cffe0", "#ffd18b", "#cfefff", "#b9f5d0", "#ffe6a8"];
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    const x = 22 + i * 31 + next(-3, 3);
    const y = 37 + next(-5, 5);
    const rot = next(-18, 18);
    const color = palette[(i + next(0, palette.length - 1)) % palette.length];
    glyphs.push(
      `<text x="${x}" y="${y}" fill="${color}" font-family="monospace" font-size="28" font-weight="700" transform="rotate(${rot} ${x} ${y})">${ch}</text>`,
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="56" viewBox="0 0 180 56" role="img" aria-label="Verification code">` +
    `<rect width="180" height="56" rx="6" fill="#09131a" stroke="#4d6f82" stroke-width="1"/>` +
    lines.join("") +
    dots.join("") +
    glyphs.join("") +
    `</svg>`
  );
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      count += 8;
      continue;
    }
    for (let bit = 7; bit >= 0; bit--) {
      if ((byte & (1 << bit)) === 0) count++;
      else return count;
    }
  }
  return count;
}

export async function verifyPow(powSalt: string, nonce: string, bits: number): Promise<boolean> {
  if (!/^[0-9]{1,12}$/.test(nonce) || !Number.isSafeInteger(bits) || bits < 0 || bits > 32) return false;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${powSalt}:${nonce}`)),
  );
  return leadingZeroBits(digest) >= bits;
}

export function containsSecretLikeText(value: string): boolean {
  if (/-----BEGIN [A-Z0-9 ]*KEY-----/i.test(value)) return true;
  if (/\b(?:gh[pous]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,})\b/.test(value)) return true;
  if (/\bbearer\s+[A-Za-z0-9._-]{24,}\b/i.test(value)) return true;
  if (/\b(?:private\s*key|seed\s*phrase|recovery\s*phrase|mnemonic)\s*[:=]/i.test(value)) return true;
  if (/(?:^|[^a-f0-9])[a-f0-9]{64}(?:$|[^a-f0-9])/i.test(value)) return true;
  return false;
}

export function sanitizeMarkdownUserText(text: string): string {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/```/g, "`\u200b``")
    // Defang GitHub @mentions so public submissions cannot mass-ping users or teams.
    .replace(/(^|[\s([{"'])(@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}))/g, "$1`$2`");
}

function allowedHost(hostname: string, env: FeedbackEnv): boolean {
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

function checkSameSiteOrigin(request: Request, u: URL, env: FeedbackEnv): boolean {
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

export function buildGitHubIssuePayload(input: {
  kind: "bug" | "feature";
  title: string;
  details: string;
  poaAddress: string | null;
  pagePath: string | null;
  submissionId: string;
}): { title: string; body: string; labels: string[] } {
  const prefix = input.kind === "bug" ? "[Bug]" : "[Feature]";
  const cleanTitle = input.title.replace(/[\r\n]+/g, " ").trim();
  const safeDetails = sanitizeMarkdownUserText(input.details.trim());
  const poaLine = input.poaAddress
    ? `\`${input.poaAddress}\` ([POAScan](${poascanAddressUrl(input.poaAddress)}))`
    : "_Not provided_";
  const pageLine = input.pagePath ? `\`${sanitizeMarkdownUserText(input.pagePath)}\`` : "`/`";
  const body = [
    `> **Public user submission pending maintainer review** (from \`poadomains.link\`)`,
    `> Treat all user-supplied text below as untrusted input.`,
    ``,
    `| Field | Value |`,
    `| --- | --- |`,
    `| **Type** | ${input.kind === "bug" ? "Bug report" : "Feature request"} |`,
    `| **Reporter POA** | ${poaLine} |`,
    `| **Page** | ${pageLine} |`,
    `| **Submission ID** | \`${input.submissionId}\` |`,
    ``,
    `### Details`,
    ``,
    safeDetails,
  ].join("\n");

  return {
    title: `${prefix} ${cleanTitle}`.slice(0, 140),
    body,
    labels: [input.kind === "bug" ? "bug" : "enhancement"],
  };
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

export async function handleFeedbackChallenge(
  request: Request,
  env: FeedbackEnv,
  store: FeedbackStore,
  options?: { now?: () => number; powBits?: number; minDwellMs?: number },
): Promise<Response> {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const fail = (status: number, code: string) =>
    Response.json(errorEnvelope(code, requestId), {
      status,
      headers: status === 429 ? { ...headers, "retry-after": "60" } : headers,
    });
  const u = new URL(request.url);
  if (!allowedHost(u.hostname, env)) return fail(403, "HOST");
  if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED");
  if (u.search) return fail(400, "QUERY_NOT_ALLOWED");
  if (!checkSameSiteOrigin(request, u, env)) return fail(403, "HOST");

  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (env.MCP_RATE_LIMITER) {
    try {
      const ok = (await env.MCP_RATE_LIMITER.limit({ key: "poa-domains:feedback-ch:" + ip })).success;
      if (!ok) return fail(429, "FEEDBACK_RATE_LIMITED");
    } catch {
      return fail(503, "MCP_RATE_UNAVAILABLE");
    }
  }

  const now = (options?.now ?? Date.now)();
  const id = randomHex(16);
  const code = generateCaptchaCode();
  const powSalt = randomHex(16);
  const powBits = options?.powBits ?? DEFAULT_POW_BITS;
  const minDwellMs = options?.minDwellMs ?? DEFAULT_MIN_DWELL_MS;
  const answerHash = await sha256Hex(`${powSalt}:${code.toUpperCase()}`);
  const ipHash = await sha256Hex(`ip:${ip}`);
  const svg = renderCaptchaSvg(code);
  const expiresAt = now + CHALLENGE_TTL_MS;

  const stored = await store.createFeedbackChallenge({
    id,
    answerHash,
    svg,
    powSalt,
    powBits,
    createdAt: now,
    expiresAt,
    ipHash,
  });
  if (!stored.ok) {
    return fail(stored.code === "FEEDBACK_RATE_LIMITED" ? 429 : 503, stored.code);
  }
  return Response.json(
    {
      challengeId: id,
      captchaUrl: `/v1/feedback/captcha/${id}`,
      powSalt,
      powBits,
      minDwellMs,
      expiresAt,
      enabled: Boolean(env.FEEDBACK_GITHUB_TOKEN?.trim()),
    },
    { status: 200, headers },
  );
}

export async function handleFeedbackCaptcha(
  request: Request,
  env: FeedbackEnv,
  store: FeedbackStore,
  rawId: string,
  options?: { now?: () => number },
): Promise<Response> {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const u = new URL(request.url);
  if (!allowedHost(u.hostname, env)) {
    return Response.json(errorEnvelope("HOST", requestId), { status: 403, headers: jsonHeaders });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json(errorEnvelope("METHOD_NOT_ALLOWED", requestId), { status: 405, headers: jsonHeaders });
  }
  if (!/^[0-9a-f]{32}$/.test(rawId)) {
    return Response.json(errorEnvelope("NOT_FOUND", requestId), { status: 404, headers: jsonHeaders });
  }
  const meta = await store.getFeedbackChallengeMeta(rawId, (options?.now ?? Date.now)());
  if (!meta) {
    return Response.json(errorEnvelope("FEEDBACK_CAPTCHA_EXPIRED", requestId), { status: 404, headers: jsonHeaders });
  }
  return new Response(request.method === "HEAD" ? null : meta.svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleFeedbackSubmit(
  request: Request,
  env: FeedbackEnv,
  store: FeedbackStore,
  deps?: { fetch?: typeof fetch; now?: () => number; minDwellMs?: number },
): Promise<Response> {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const fail = (status: number, code: string, retryAfterSec?: number) =>
    Response.json(errorEnvelope(code, requestId), {
      status,
      headers: status === 429 ? { ...headers, "retry-after": String(retryAfterSec ?? 300) } : headers,
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
    if (lenHeader !== null && (!/^[0-9]+$/.test(lenHeader) || Number(lenHeader) > MAX_FEEDBACK_BODY_BYTES)) {
      return fail(413, "BODY_TOO_LARGE");
    }

    const ip = request.headers.get("cf-connecting-ip") ?? "local";
    if (env.MCP_RATE_LIMITER) {
      try {
        const ok = (await env.MCP_RATE_LIMITER.limit({ key: "poa-domains:feedback:" + ip })).success;
        if (!ok) return fail(429, "FEEDBACK_RATE_LIMITED", 60);
      } catch {
        return fail(503, "MCP_RATE_UNAVAILABLE");
      }
    }

    const rawText = await readBoundedText(request, MAX_FEEDBACK_BODY_BYTES);
    const parsed = parseMcpJSON(rawText, MAX_FEEDBACK_BODY_BYTES, 8);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "FEEDBACK_INVALID_INPUT");

    const allowedKeys = new Set([
      "kind",
      "title",
      "details",
      "poaAddress",
      "pagePath",
      "challengeId",
      "captchaAnswer",
      "powNonce",
      "website",
    ]);
    for (const k of Object.keys(parsed)) {
      if (!allowedKeys.has(k)) return fail(400, "FEEDBACK_INVALID_INPUT");
    }

    // Honeypot field must remain empty.
    if (parsed.website !== undefined && parsed.website !== "") {
      return fail(400, "FEEDBACK_INVALID_INPUT");
    }

    const kind = parsed.kind === "bug" || parsed.kind === "feature" ? parsed.kind : null;
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const details = typeof parsed.details === "string" ? parsed.details.trim() : "";
    const rawPoa = parsed.poaAddress === undefined || parsed.poaAddress === null ? "" : parsed.poaAddress;
    const rawPage = parsed.pagePath === undefined || parsed.pagePath === null ? "" : parsed.pagePath;
    const challengeId = typeof parsed.challengeId === "string" ? parsed.challengeId.trim() : "";
    const captchaAnswer = typeof parsed.captchaAnswer === "string" ? parsed.captchaAnswer.trim().toUpperCase() : "";
    const powNonce = typeof parsed.powNonce === "string" ? parsed.powNonce.trim() : "";

    if (
      !kind ||
      title.length < 5 ||
      title.length > 120 ||
      /[\u0000-\u001f\u007f]/.test(title) ||
      details.length < 15 ||
      details.length > 3000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(details) ||
      typeof rawPoa !== "string" ||
      typeof rawPage !== "string" ||
      !/^[0-9a-f]{32}$/.test(challengeId) ||
      !/^[A-Z0-9]{4,8}$/.test(captchaAnswer) ||
      !/^[0-9]{1,12}$/.test(powNonce)
    ) {
      return fail(400, "FEEDBACK_INVALID_INPUT");
    }

    let poaAddress: string | null = null;
    if (rawPoa.trim()) {
      poaAddress = validPoaAddr(rawPoa);
      if (!poaAddress) return fail(400, "INVALID_POA_ADDRESS");
    }

    let pagePath: string | null = null;
    if (rawPage.trim()) {
      const p = rawPage.trim();
      if (!p.startsWith("/") || p.length > 256 || /[\s\u0000-\u001f\u007f]/.test(p)) {
        return fail(400, "FEEDBACK_INVALID_INPUT");
      }
      pagePath = p.split("?")[0]!.split("#")[0]!;
    }

    // Reject accidental secret/key leaks before anything leaves the Worker.
    if (containsSecretLikeText(title) || containsSecretLikeText(details)) {
      return fail(400, "FEEDBACK_CONTAINS_SECRET");
    }
    try {
      noSecrets({ title, details });
    } catch {
      return fail(400, "FEEDBACK_CONTAINS_SECRET");
    }

    const token = typeof env.FEEDBACK_GITHUB_TOKEN === "string" ? env.FEEDBACK_GITHUB_TOKEN.trim() : "";
    if (!token) return fail(503, "FEEDBACK_DISABLED");

    const now = (deps?.now ?? Date.now)();
    const meta = await store.getFeedbackChallengeMeta(challengeId, now);
    if (!meta) return fail(400, "FEEDBACK_CAPTCHA_EXPIRED");

    if (!(await verifyPow(meta.powSalt, powNonce, meta.powBits))) {
      return fail(400, "FEEDBACK_POW_INVALID");
    }

    const answerHash = await sha256Hex(`${meta.powSalt}:${captchaAnswer}`);
    const ipHash = await sha256Hex(`ip:${ip}`);
    const poaHash = poaAddress ? await sha256Hex(`poa:${poaAddress}`) : null;
    const contentHash = await sha256Hex(`${kind}|${title.toLowerCase()}|${details.toLowerCase()}`);

    const consumed = await store.consumeFeedbackChallenge({
      id: challengeId,
      answerHash,
      ipHash,
      poaHash,
      contentHash,
      now,
      minDwellMs: deps?.minDwellMs ?? DEFAULT_MIN_DWELL_MS,
    });
    if (!consumed.ok) {
      const status =
        consumed.code === "FEEDBACK_RATE_LIMITED"
          ? 429
          : consumed.code === "FEEDBACK_DUPLICATE"
            ? 409
            : 400;
      return fail(status, consumed.code, consumed.retryAfterSec);
    }

    const submissionId = randomHex(8);
    const repo = (env.FEEDBACK_GITHUB_REPO || DEFAULT_FEEDBACK_REPO).trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      return fail(503, "FEEDBACK_DISABLED");
    }
    const issuePayload = buildGitHubIssuePayload({
      kind,
      title,
      details,
      poaAddress,
      pagePath,
      submissionId,
    });

    const fetcher = deps?.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
    let issueNumber: number;
    let issueUrl: string;
    try {
      const ghRes = await fetcher(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "poadomains-feedback-worker",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify(issuePayload),
        signal: AbortSignal.timeout(12_000),
      });
      if (!ghRes.ok) {
        await ghRes.body?.cancel?.().catch(() => {});
        return fail(502, "FEEDBACK_UPSTREAM_FAILED");
      }
      const created = (await ghRes.json()) as { number?: unknown; html_url?: unknown };
      if (
        typeof created?.number !== "number" ||
        typeof created?.html_url !== "string" ||
        !created.html_url.startsWith("https://github.com/")
      ) {
        return fail(502, "FEEDBACK_UPSTREAM_FAILED");
      }
      issueNumber = created.number;
      issueUrl = created.html_url;
    } catch {
      return fail(502, "FEEDBACK_UPSTREAM_FAILED");
    }

    // Best-effort archive in R2 PROFILES bucket for auditability.
    if (env.PROFILES) {
      const day = new Date(now).toISOString().slice(0, 10);
      await env.PROFILES.put(
        `v1/feedback/${day}/${submissionId}.json`,
        JSON.stringify({
          id: submissionId,
          kind,
          title: issuePayload.title,
          poaAddress,
          pagePath,
          issueNumber,
          issueUrl,
          createdAt: new Date(now).toISOString(),
        }),
        { httpMetadata: { contentType: "application/json; charset=utf-8" } },
      ).catch(() => {});
    }

    return Response.json(
      { ok: true, id: submissionId, kind, issueNumber, issueUrl },
      { status: 201, headers },
    );
  } catch (error) {
    if (error instanceof Fault) {
      return fail(error.code === "BODY_TOO_LARGE" ? 413 : 400, error.code);
    }
    return fail(400, "FEEDBACK_INVALID_INPUT");
  }
}
