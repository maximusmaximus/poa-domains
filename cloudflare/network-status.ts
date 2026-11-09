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
};

export function createNetworkStatusMonitor(deps: NetworkStatusDeps = {}) {
  const fetcher = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const now = deps.now ?? Date.now;
  let cache: Cache | null = null;
  let consecutiveFailures = 0;
  let everSucceeded = false;
  let inflight: Promise<NetworkStatusSnapshot> | null = null;

  async function probe(): Promise<NetworkStatusSnapshot> {
    const started = now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_MS);
      let response: Response;
      try {
        response = await fetcher(STATUS_URL, {
          method: "GET",
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const latencyMs = Math.max(0, now() - started);
      if (!response || response.status !== 200) {
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
      const body = (await response.json()) as Record<string, unknown>;
      const chainOk =
        body &&
        (body.chain_id === CHAIN || body.chain_id === undefined) &&
        typeof body.epochs_closed === "number";
      if (!chainOk) {
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
      const checkpoint = body.checkpoint as
        | { height?: number }
        | undefined;
      const stale =
        typeof body.stale === "boolean" ? body.stale : null;
      const staleAgeS =
        typeof body.stale_age_s === "number" ? body.stale_age_s : null;
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
        detail: {
          epochsClosed:
            typeof body.epochs_closed === "number" ? body.epochs_closed : null,
          checkpointHeight:
            typeof checkpoint?.height === "number"
              ? checkpoint.height
              : typeof body.checkpoint_height === "number"
                ? body.checkpoint_height
                : null,
          agentsJoined:
            typeof body.agents_joined === "number" ? body.agents_joined : null,
          txs: typeof body.txs === "number" ? body.txs : null,
          final: typeof body.final === "number" ? body.final : null,
          stale,
        },
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
    }
  }

  async function getStatus(options?: {
    bypassCache?: boolean;
  }): Promise<NetworkStatusSnapshot> {
    const t = now();
    if (
      !options?.bypassCache &&
      cache &&
      t - cache.at < CACHE_MS
    ) {
      return cache.snap;
    }
    if (inflight) return inflight;
    inflight = probe().then((snap) => {
      cache = { at: now(), snap };
      inflight = null;
      return snap;
    });
    return inflight;
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
