import { parseNetworkStatus } from "./network-schema.js";
// Independent component: official public-node observations, NEVER registry state.
const SOURCE = 'https://minepoa.com';
const CHAIN = 'poa-mainnet-1';
const URLS = Object.freeze([
  `${SOURCE}/chain/${CHAIN}/api/status`,
  `${SOURCE}/chain/${CHAIN}/api/network-facts`,
]);
const MAX_BYTES = 65536;
const REQUEST_MS = 10500;
const OVERALL_MS = 22000;
const TTL_MS = 900000;
const MESSAGES = Object.freeze({
  INVALID_OPTIONS: 'Invalid reader dependencies.',
  INVALID_RESPONSE: 'The public node returned an invalid response.',
  REDIRECT_REFUSED: 'Redirected public-node responses are refused.',
  INVALID_CONTENT_TYPE: 'The public node did not return JSON.',
  RESPONSE_TOO_LARGE: 'The public-node response exceeds the size limit.',
  INVALID_UTF8: 'The public-node response is not valid UTF-8.',
  INVALID_JSON: 'The public-node response is not valid bounded JSON.',
  DUPLICATE_JSON_KEY: 'Duplicate JSON keys are refused.',
  UNSAFE_JSON_KEY: 'Unsafe JSON keys are refused.',
  JSON_LIMIT: 'The JSON structure exceeds the complexity limit.',
  STALE_RESPONSE: 'The public-node response has an invalid or excessive cache age.',
  INVALID_SCHEMA: 'The public-node response does not match the required schema.',
  CHAIN_MISMATCH: 'The public node reported a different chain.',
  CONSISTENCY_MISMATCH: 'The public-node observations disagree.',
  FUTURE_CHECKPOINT: 'The checkpoint timestamp is too far in the future.',
  CHECKPOINT_ROLLBACK: 'Checkpoint rollback was detected.',
  CHECKPOINT_MISMATCH: 'The same checkpoint height reported a different cutoff.',
  EPOCH_ROLLBACK: 'Epoch rollback was detected.',
  HASH_DRIFT: 'The reported engine or parameter digest changed.',
  CLOCK_INVALID: 'The observation clock is invalid.',
  CLOCK_ROLLBACK: 'The observation clock moved backwards.',
  CLOCK_JUMP: 'The observation exceeded the clock budget.',
  HTTP_RATE_LIMITED: 'The public node is rate limiting requests.',
  HTTP_UNAVAILABLE: 'The public node is temporarily unavailable.',
  HTTP_ERROR: 'The public node returned an unsuccessful HTTP status.',
  NETWORK_ERROR: 'The public-node request failed.',
  ABORTED: 'The public-node request was aborted.',
  TIMEOUT: 'The public-node request exceeded its deadline.',
});
const INCIDENTS = new Set([
  'CHAIN_MISMATCH', 'CONSISTENCY_MISMATCH', 'FUTURE_CHECKPOINT',
  'CHECKPOINT_ROLLBACK', 'CHECKPOINT_MISMATCH', 'EPOCH_ROLLBACK', 'HASH_DRIFT',
  'CLOCK_INVALID', 'CLOCK_ROLLBACK', 'CLOCK_JUMP',
]);
export class LiveNetworkError extends Error {
  constructor(code) {
    const safe = Object.hasOwn(MESSAGES, code) ? code : 'NETWORK_ERROR';
    super(MESSAGES[safe]);
    this.name = 'LiveNetworkError';
    this.code = safe;
    Object.freeze(this);
  }
}
const fail = code => { throw new LiveNetworkError(code); };
function safeError(e) {
  try {
    if (e instanceof LiveNetworkError) return e;
    if (e?.name === 'AbortError') return new LiveNetworkError('ABORTED');
  } catch { /* hostile error properties are not public messages */ }
  return new LiveNetworkError('NETWORK_ERROR');
}

/** Strict UTF-8 JSON parser. All keys (including unknown fields) are checked. */
export function parseBoundedJson(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('INVALID_JSON');
  if (bytes.byteLength > MAX_BYTES) fail('RESPONSE_TOO_LARGE');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('INVALID_UTF8'); }
  let i = 0;
  const ws = () => { while (i < text.length && /[\x20\t\n\r]/.test(text[i])) i++; };
  function str() {
    if (text[i] !== '"') fail('INVALID_JSON');
    const start = i++;
    let escaped = false;
    while (i < text.length) {
      const ch = text[i++];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') {
        try { return JSON.parse(text.slice(start, i)); }
        catch { fail('INVALID_JSON'); }
      }
      if (ch.charCodeAt(0) < 32) fail('INVALID_JSON');
    }
    fail('INVALID_JSON');
  }
  function value(depth) {
    ws();
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      if (depth >= 24) fail('JSON_LIMIT');
      const object = ch === '{'; i++; ws();
      const close = object ? '}' : ']';
      const out = object ? Object.create(null) : [];
      const keys = new Set(); let count = 0;
      if (text[i] === close) { i++; return out; }
      for (;;) {
        if (++count > 256) fail('JSON_LIMIT');
        let key;
        if (object) {
          key = str(); ws();
          if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('UNSAFE_JSON_KEY');
          if (keys.has(key)) fail('DUPLICATE_JSON_KEY');
          keys.add(key);
          if (text[i++] !== ':') fail('INVALID_JSON');
        }
        const item = value(depth + 1);
        if (object) out[key] = item; else out.push(item);
        ws();
        if (text[i] === close) { i++; return out; }
        if (text[i++] !== ',') fail('INVALID_JSON');
        ws();
      }
    }
    if (ch === '"') return str();
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(token, i)) { i += token.length; return result; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match || match[0].length > 128) fail('INVALID_JSON');
    const token = match[0]; const n = Number(token);
    if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) fail('INVALID_JSON');
    // Do not let decimal rounding or underflow turn a fractional count into an integer.
    if (Number.isInteger(n) && /[.eE]/.test(token)) {
      const parts = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
      const exponent = Number(parts[4] || 0) - (parts[3]?.length || 0);
      if (Math.abs(exponent) > 400) fail('INVALID_JSON');
      const coefficient = BigInt(parts[1] + parts[2] + (parts[3] || ''));
      const scale = 10n ** BigInt(Math.abs(exponent));
      if (exponent >= 0 ? coefficient * scale !== BigInt(n) : coefficient !== BigInt(n) * scale) fail('INVALID_JSON');
    }
    i += token.length; return n;
  }
  const result = value(0); ws();
  if (i !== text.length) fail('INVALID_JSON');
  return result;
}

const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = v => Number.isSafeInteger(v) && v >= 0;

/** Only fetch/now are injectable code-level dependencies; URLs and limits are fixed. */
export function createLiveNetworkReader(options = {}) {
  if (!record(options) || Object.keys(options).some(k => !['fetch', 'now'].includes(k))) fail('INVALID_OPTIONS');
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const now = options.now ?? Date.now;
  if (typeof fetcher !== 'function' || typeof now !== 'function') fail('INVALID_OPTIONS');
  let flight = null, incident = null, previous = null, lastClock = null;
  function clock() {
    let t;
    try { t = now(); } catch { fail('CLOCK_INVALID'); }
    if (!count(t) || t > 8640000000000000 - TTL_MS) fail('CLOCK_INVALID');
    if (lastClock !== null && t < lastClock) fail('CLOCK_ROLLBACK');
    lastClock = t; return t;
  }
  function request(url, controllers) {
    const controller = new AbortController(); controllers.add(controller);
    let reader = null, response = null, ended = false, timer, rejectStop;
    const cancel = () => {
      try {
        const p = reader ? reader.cancel() : response?.body?.cancel();
        Promise.resolve(p).catch(() => {});
      } catch { /* cancellation is best-effort and never delays rejection */ }
    };
    const stop = (code = 'ABORTED') => { try { controller.abort(); } catch {} cancel(); rejectStop?.(new LiveNetworkError(code)); };
    controllers.add(stop);
    const work = Promise.resolve().then(async () => {
      response = await fetcher(url, {
        method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (ended || controller.signal.aborted) { cancel(); fail('TIMEOUT'); }
      if (!response || typeof response.headers?.get !== 'function' || !Number.isInteger(response.status)) fail('INVALID_RESPONSE');
      if (response.redirected || (response.url !== undefined && response.url !== url) || (response.status >= 300 && response.status <= 399)) fail('REDIRECT_REFUSED');
      if (response.status === 429) fail('HTTP_RATE_LIMITED');
      if (response.status === 503) fail('HTTP_UNAVAILABLE');
      if (response.status !== 200) fail('HTTP_ERROR');
      const contentType = response.headers.get('content-type') || '';
      if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;[^\r\n]*)?$/i.test(contentType)) fail('INVALID_CONTENT_TYPE');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > MAX_BYTES)) fail('RESPONSE_TOO_LARGE');
      const age = response.headers.get('age');
      if (age !== null && (!/^\d+$/.test(age) || !Number.isSafeInteger(Number(age)) || Number(age) > 300)) fail('STALE_RESPONSE');
      if (typeof response.body?.getReader !== 'function') fail('INVALID_RESPONSE');
      reader = response.body.getReader();
      const chunks = []; let total = 0, reads = 0;
      for (;;) {
        if (++reads > 4096) fail('INVALID_RESPONSE');
        const part = await reader.read();
        if (ended || controller.signal.aborted) fail('TIMEOUT');
        if (!part || typeof part.done !== 'boolean') fail('INVALID_RESPONSE');
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)) fail('INVALID_RESPONSE');
        total += part.value.byteLength;
        if (total > MAX_BYTES) fail('RESPONSE_TOO_LARGE');
        chunks.push(part.value.slice());
      }
      const bytes = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return parseBoundedJson(bytes);
    });
    const deadline = new Promise((_, reject) => {
      rejectStop = reject;
      timer = setTimeout(() => { ended = true; stop('TIMEOUT'); }, REQUEST_MS);
    });
    return Promise.race([work, deadline]).catch(e => { throw safeError(e); }).finally(() => {
      ended = true; clearTimeout(timer); controllers.delete(controller); controllers.delete(stop);
      stop();
      try { reader?.releaseLock(); } catch {}
    });
  }
  async function run() {
    const controllers = new Set(); let overallTimer;
    try {
      const start = clock();
      const work = Promise.all(URLS.map(url => request(url, controllers)));
      const deadline = new Promise((_, reject) => {
        overallTimer = setTimeout(() => reject(new LiveNetworkError('TIMEOUT')), OVERALL_MS);
      });
      const [status, facts] = await Promise.race([work, deadline]);
      const end = clock();
      if (end - start > OVERALL_MS) fail('CLOCK_JUMP');
      const result = parseNetworkStatus(status, {facts, now:end, fail});
      if (previous) {
        if (result.checkpoint.height === previous.checkpoint.height && result.checkpoint.cutoffTs !== previous.checkpoint.cutoffTs) fail('CHECKPOINT_MISMATCH');
        if (result.checkpoint.height < previous.checkpoint.height || result.checkpoint.cutoffTs < previous.checkpoint.cutoffTs) fail('CHECKPOINT_ROLLBACK');
        if (result.epochsClosed < previous.epochsClosed) fail('EPOCH_ROLLBACK');
        if (result.engineSha256 !== previous.engineSha256 || result.paramsSha256 !== previous.paramsSha256) fail('HASH_DRIFT');
      }
      previous = result;
      return result;
    } catch (e) {
      const error = safeError(e);
      if (INCIDENTS.has(error.code)) incident = error;
      throw error;
    } finally {
      clearTimeout(overallTimer);
      for (const item of controllers) {
        try { typeof item === 'function' ? item() : item.abort(); } catch {}
      }
    }
  }
  return Object.freeze({ observe() {
    if (incident) return Promise.reject(incident);
    if (flight) return flight;
    flight = Promise.resolve().then(run).finally(() => { flight = null; });
    return flight;
  } });
}
