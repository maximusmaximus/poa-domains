import { parseNetworkStatus } from "../web/network-schema.js";
/** Read-only PoA public-node status for the UI banner and write-hold gate. No API keys. */

export type NetworkLevel = "checking" | "online" | "degraded" | "down";

export type NetworkStatusSnapshot = {
  level: NetworkLevel;
  emoji: string;
  label: string;
  color: "grey" | "green" | "amber" | "red";
  hold: boolean;
  message: string;
  chainId: string;
  livePoA: false;
  checkedAt: number;
  latencyMs: number | null;
  failures: number;
  source: string;
  /** Present only when served from the shared last-known store, not this isolate's own fresh check. */
  lastKnown?: true;
  ageMs?: number;
  stale?: boolean;
  detail: {
    epochsClosed: number | null;
    checkpointHeight: number | null;
    agentsJoined: number | null;
    txs: number | null;
    final: number | null;
    stale: boolean | null;
  } | null;
};

const CHAIN = "poa-mainnet-1";
const STATUS_URL = `https://minepoa.com/chain/${CHAIN}/api/status`;
const REQUEST_MS = 10500;
const CACHE_MS = 20_000;
const SLOW_MS = 4000;
const FAIL_THRESHOLD = 2;
/** Last-known status older than this is shown with a subtle stale indicator. */
export const STALE_MS = 5 * 60_000;
const SHARED_READ_MS = 1500;

/** Display-only shared store (registry DO side table). Never consulted for the write hold. */
export type SharedStatusStore = {
  load(): Promise<{ at: number; value: string } | null>;
  save(at: number, value: string): Promise<void>;
};

const LEVEL_META: Record<
  NetworkLevel,
  { emoji: string; label: string; color: NetworkStatusSnapshot["color"] }
> = {
  checking: { emoji: "⚪", label: "Checking", color: "grey" },
  online: { emoji: "🟢", label: "Online", color: "green" },
  degraded: { emoji: "🟡", label: "Slow", color: "amber" },
  down: { emoji: "🔴", label: "Down", color: "red" },
};

export function classifyProbe(input: {
  ok: boolean;
  latencyMs: number | null;
  stale?: boolean | null;
  staleAgeS?: number | null;
  consecutiveFailures: number;
  everSucceeded: boolean;
}): NetworkLevel {
  if (!input.ok) {
    if (input.consecutiveFailures >= FAIL_THRESHOLD) return "down";
    return input.everSucceeded ? "degraded" : "checking";
  }
  const slow = (input.latencyMs ?? 0) >= SLOW_MS;
  const stale =
    input.stale === true ||
    (typeof input.staleAgeS === "number" && input.staleAgeS > 120);
  if (slow || stale) return "degraded";
  return "online";
}

export function shouldHoldTransactions(level: NetworkLevel): boolean {
  return level === "down";
}

export function bannerCopy(level: NetworkLevel): string {
  switch (level) {
    case "online":
      return `${LEVEL_META.online.emoji} PoA network Online`;
    case "degraded":
      return `${LEVEL_META.degraded.emoji} PoA network Slow — actions still work, expect delays`;
    case "down":
      return `${LEVEL_META.down.emoji} PoA network Down — actions held ⏸️ until the network is back`;
    default:
      return `${LEVEL_META.checking.emoji} Checking PoA network…`;
  }
}

function snapshot(
  level: NetworkLevel,
  extras: Partial<NetworkStatusSnapshot> & {
    checkedAt: number;
    failures: number;
  },
): NetworkStatusSnapshot {
  const meta = LEVEL_META[level];
  return {
    level,
    emoji: meta.emoji,
    label: meta.label,
    color: meta.color,
    hold: shouldHoldTransactions(level),
    message: bannerCopy(level),
    chainId: CHAIN,
    livePoA: false,
    latencyMs: extras.latencyMs ?? null,
    checkedAt: extras.checkedAt,
    failures: extras.failures,
    source: STATUS_URL,
    detail: extras.detail ?? null,
  };
}

type Cache = {
  at: number;
  snap: NetworkStatusSnapshot;
};

export type NetworkStatusDeps = {
  fetch?: typeof fetch;
  now?: () => number;
  /** Test hook; production uses REQUEST_MS. */
  requestMs?: number;
};

export function createNetworkStatusMonitor(deps: NetworkStatusDeps = {}) {
  const fetcher = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const now = deps.now ?? Date.now;
  let cache: Cache | null = null;
  let consecutiveFailures = 0;
  let everSucceeded = false;
  const requestMs = deps.requestMs ?? REQUEST_MS;
  // Hard per-caller deadline: a probe shared from another request (or a stalled body) can never hang a response.
  const deadlineMs = requestMs + 1000;
  let inflight: Promise<NetworkStatusSnapshot> | null = null;
  let inflightAt = 0;

  async function probe(): Promise<NetworkStatusSnapshot> {
    const started = now();
    // The abort timer covers headers AND body; previously it was cleared once headers arrived.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestMs);
    try {
      // Workers Fetch rejects some browser-only init fields; keep this minimal.
      const response: Response = await fetcher(STATUS_URL, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const latencyMs = Math.max(0, now() - started);
      if (!response || response.status !== 200 || response.status >= 300) {
        consecutiveFailures += 1;
        const level = classifyProbe({
          ok: false,
          latencyMs,
          consecutiveFailures,
          everSucceeded,
        });
        return snapshot(level, {
          checkedAt: now(),
          failures: consecutiveFailures,
          latencyMs,
        });
      }
      const ctype = response.headers.get("content-type") || "";
      if (!/json/i.test(ctype)) {
        consecutiveFailures += 1;
        const level = classifyProbe({
          ok: false,
          latencyMs,
          consecutiveFailures,
          everSucceeded,
        });
        return snapshot(level, {
          checkedAt: now(),
          failures: consecutiveFailures,
          latencyMs,
        });
      }
      const body = (await Promise.race([
        response.json(),
        new Promise((_, reject) => {
          if (controller.signal.aborted) reject(Error("NETWORK_TIMEOUT"));
          controller.signal.addEventListener("abort", () => reject(Error("NETWORK_TIMEOUT")), { once: true });
        }),
      ])) as Record<string, unknown>;
      let parsed;
      try { parsed = parseNetworkStatus(body, {availabilityOnly:true, now:started, fail: () => { throw Error("NETWORK_SCHEMA"); }}); }
      catch { /* Keep the deployed status-only probe failure/hold behavior. */ }
      if (!parsed) {
        consecutiveFailures += 1;
        const level = classifyProbe({
          ok: false,
          latencyMs,
          consecutiveFailures,
          everSucceeded,
        });
        return snapshot(level, {
          checkedAt: now(),
          failures: consecutiveFailures,
          latencyMs,
        });
      }
      consecutiveFailures = 0;
      everSucceeded = true;
      const {staleAgeS, ...detail} = parsed;
      const stale = detail.stale;
      const level = classifyProbe({
        ok: true,
        latencyMs,
        stale,
        staleAgeS,
        consecutiveFailures: 0,
        everSucceeded: true,
      });
      return snapshot(level, {
        checkedAt: now(),
        failures: 0,
        latencyMs,
        detail,
      });
    } catch {
      consecutiveFailures += 1;
      const level = classifyProbe({
        ok: false,
        latencyMs: Math.max(0, now() - started),
        consecutiveFailures,
        everSucceeded,
      });
      return snapshot(level, {
        checkedAt: now(),
        failures: consecutiveFailures,
        latencyMs: Math.max(0, now() - started),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Same result a failed probe would give, without mutating counters (the probe itself still records). */
  function timedOut(): NetworkStatusSnapshot {
    const failures = consecutiveFailures + 1;
    return snapshot(classifyProbe({ ok: false, latencyMs: deadlineMs, consecutiveFailures: failures, everSucceeded }), {
      checkedAt: now(),
      failures,
      latencyMs: deadlineMs,
    });
  }

  function withDeadline(run: Promise<NetworkStatusSnapshot>): Promise<NetworkStatusSnapshot> {
    let id: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<NetworkStatusSnapshot>((resolve) => { id = setTimeout(() => resolve(timedOut()), deadlineMs); });
    return Promise.race([run, limit]).finally(() => clearTimeout(id));
  }

  function persist(run: Promise<NetworkStatusSnapshot>, shared?: SharedStatusStore): Promise<unknown> {
    // "checking" carries no information; never overwrite a real last-known level with it.
    return run.then((snap) => (shared && snap.level !== "checking" ? shared.save(snap.checkedAt, JSON.stringify(snap)) : undefined)).catch(() => undefined);
  }

  function fromShared(row: { at: number; value: string } | null, t: number): NetworkStatusSnapshot | null {
    if (!row || !Number.isSafeInteger(row.at) || typeof row.value !== "string" || row.value.length > 4096) return null;
    let v: Record<string, unknown>;
    try { v = JSON.parse(row.value); } catch { return null; }
    const level = v?.level;
    if (level !== "online" && level !== "degraded" && level !== "down") return null;
    const ageMs = Math.max(0, t - row.at);
    // Rebuild from the level only; stored text is never trusted as-is.
    const base = snapshot(level, {
      checkedAt: row.at,
      failures: Number.isSafeInteger(v.failures) ? (v.failures as number) : 0,
      latencyMs: Number.isSafeInteger(v.latencyMs) ? (v.latencyMs as number) : null,
    });
    // Within the normal cache window this is exactly what a local cache hit would serve.
    if (ageMs < CACHE_MS) return base;
    // Older values are display-only: the hold always comes from fresh checks.
    return { ...base, hold: false, lastKnown: true, ageMs, stale: ageMs > STALE_MS };
  }

  async function getStatus(options?: {
    bypassCache?: boolean;
    shared?: SharedStatusStore;
    waitUntil?: (p: Promise<unknown>) => void;
  }): Promise<NetworkStatusSnapshot> {
    const t = now();
    if (
      !options?.bypassCache &&
      cache &&
      t - cache.at < CACHE_MS
    ) {
      return cache.snap;
    }
    const shared = options?.shared;
    if (shared && !options?.bypassCache) {
      let row: { at: number; value: string } | null = null;
      let id: ReturnType<typeof setTimeout> | undefined;
      try {
        row = await Promise.race([shared.load(), new Promise<null>((resolve) => { id = setTimeout(() => resolve(null), SHARED_READ_MS); })]);
      } catch { row = null; } finally { clearTimeout(id); }
      const last = fromShared(row, t);
      if (last) {
        // Answer instantly; refresh in the background (one probe per isolate, deduplicated).
        if (!(inflight && t - inflightAt < deadlineMs)) {
          const run = start(t);
          const bg = persist(run, shared);
          if (options?.waitUntil) options.waitUntil(bg);
        }
        return last;
      }
    }
    // Reuse a recent shared probe, but never one older than the deadline (its request may have been cancelled).
    if (inflight && t - inflightAt < deadlineMs) return withDeadline(inflight);
    const run = start(t);
    const saved = persist(run, shared);
    if (options?.waitUntil) options.waitUntil(saved);
    return withDeadline(run);
  }

  function start(t: number): Promise<NetworkStatusSnapshot> {
    const run: Promise<NetworkStatusSnapshot> = probe().then((snap) => {
      cache = { at: now(), snap };
      if (inflight === run) inflight = null;
      return snap;
    });
    inflight = run;
    inflightAt = t;
    return run;
  }

  /** Non-probing read for write-hold: never increments failures on a POST path. */
  function peekStatus(): NetworkStatusSnapshot {
    if (cache) return cache.snap;
    return snapshot("checking", {
      checkedAt: now(),
      failures: consecutiveFailures,
      latencyMs: null,
    });
  }

  /** Test helper: seed failure/success counters without a network call. */
  function __testSetState(state: {
    consecutiveFailures?: number;
    everSucceeded?: boolean;
    cache?: NetworkStatusSnapshot | null;
  }) {
    if (state.consecutiveFailures !== undefined)
      consecutiveFailures = state.consecutiveFailures;
    if (state.everSucceeded !== undefined) everSucceeded = state.everSucceeded;
    if (state.cache === null) cache = null;
    else if (state.cache)
      cache = { at: now(), snap: state.cache };
  }

  return { getStatus, peekStatus, __testSetState, STATUS_URL, FAIL_THRESHOLD, CACHE_MS };
}

export const networkStatusMonitor = createNetworkStatusMonitor();
