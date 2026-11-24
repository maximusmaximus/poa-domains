/** Read-only Domains Treasury balance aggregator (escrow + treasury on PoA mainnet) with POAScan links. */
import { correlationId, errorEnvelope } from "../src/errors.js";

export const POASCAN_HOME_URL = "https://poascan.io/";
export const CHAIN = "poa-mainnet-1";
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;
const POA_ADDR_RE = /^poa1[1-9A-HJ-NP-Za-km-z]{32,56}$/;
const POA_AMOUNT_RE = /^([0-9]{1,12})\.([0-9]{6})$/;

export interface TreasuryWalletView {
  address: string;
  balance: string | null;
  poascanUrl: string;
}

export interface TreasurySnapshot {
  total: string | null;
  escrow: TreasuryWalletView | null;
  treasury: TreasuryWalletView | null;
  poascanHomeUrl: string;
  checkedAt: number;
  stale: boolean;
}

export interface TreasuryEnv {
  BACKEND_HOST: string;
  PUBLIC_EXPLORER_URL?: string;
  POA_API_TOKEN?: string;
}

export function poascanAddressUrl(address: string): string {
  return `https://poascan.io/address/${encodeURIComponent(address)}`;
}

export function parsePoaMicros(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const m = POA_AMOUNT_RE.exec(value.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 1_000_000n + BigInt(m[2]!);
}

export function formatPoaMicros(micros: bigint): string {
  const safe = micros < 0n ? 0n : micros;
  const whole = safe / 1_000_000n;
  const frac = (safe % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac}`;
}

export function validPoaAddr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return POA_ADDR_RE.test(s) ? s : null;
}

async function fetchAddressBalance(
  address: string,
  fetchImpl: typeof fetch,
  apiToken?: string,
): Promise<string | null> {
  const token = typeof apiToken === "string" ? apiToken.trim() : "";
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const paths = [
    `/api/explorer/address/${encodeURIComponent(address)}`,
    `/chain/${CHAIN}/api/explorer/address/${encodeURIComponent(address)}`,
  ];
  for (const path of paths) {
    try {
      const res = await fetchImpl(`https://minepoa.com${path}`, {
        method: "GET",
        redirect: "manual",
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status !== 200) {
        await res.body?.cancel?.().catch(() => {});
        continue;
      }
      const data = (await res.json()) as { address?: unknown; balance?: unknown };
      if (data?.address === address && parsePoaMicros(data.balance) !== null) {
        return String(data.balance).trim();
      }
    } catch {
      /* try fallback path */
    }
  }
  return null;
}

export function createTreasuryReader(deps?: { fetch?: typeof fetch; now?: () => number }) {
  const fetcher = deps?.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const now = deps?.now ?? Date.now;
  let cached: { key: string; at: number; snap: TreasurySnapshot } | null = null;
  let inflight: Promise<TreasurySnapshot> | null = null;

  async function read(input: {
    escrowAddress: string | null;
    treasuryAddress: string | null;
    apiToken?: string;
    bypassCache?: boolean;
  }): Promise<TreasurySnapshot> {
    const escrowAddr = validPoaAddr(input.escrowAddress);
    const treasuryAddr = validPoaAddr(input.treasuryAddress);
    const key = `${escrowAddr ?? ""}|${treasuryAddr ?? ""}`;
    const t = now();
    if (!input.bypassCache && cached && cached.key === key && t - cached.at < CACHE_TTL_MS) {
      return cached.snap;
    }
    if (inflight && !input.bypassCache) return inflight;

    const task = (async (): Promise<TreasurySnapshot> => {
      const unique = [...new Set([escrowAddr, treasuryAddr].filter((x): x is string => Boolean(x)))];
      const balances = new Map<string, string | null>();
      await Promise.all(
        unique.map(async (addr) => {
          balances.set(addr, await fetchAddressBalance(addr, fetcher, input.apiToken));
        }),
      );

      // Retain last-known individual balances when upstream is momentarily busy (e.g. 503 during mining).
      let stale = false;
      const prevMap = new Map<string, string | null>();
      if (cached && cached.key === key) {
        if (cached.snap.escrow) prevMap.set(cached.snap.escrow.address, cached.snap.escrow.balance);
        if (cached.snap.treasury) prevMap.set(cached.snap.treasury.address, cached.snap.treasury.balance);
      }
      for (const addr of unique) {
        if (balances.get(addr) === null) {
          const prev = prevMap.get(addr) ?? null;
          if (prev !== null) {
            balances.set(addr, prev);
            stale = true;
          }
        }
      }

      let totalMicros = 0n;
      let anyKnown = false;
      for (const addr of unique) {
        const m = parsePoaMicros(balances.get(addr));
        if (m !== null) {
          totalMicros += m;
          anyKnown = true;
        }
      }

      const snap: TreasurySnapshot = {
        total: anyKnown ? formatPoaMicros(totalMicros) : null,
        escrow: escrowAddr
          ? {
              address: escrowAddr,
              balance: balances.get(escrowAddr) ?? null,
              poascanUrl: poascanAddressUrl(escrowAddr),
            }
          : null,
        treasury: treasuryAddr
          ? {
              address: treasuryAddr,
              balance: balances.get(treasuryAddr) ?? null,
              poascanUrl: poascanAddressUrl(treasuryAddr),
            }
          : null,
        poascanHomeUrl: POASCAN_HOME_URL,
        checkedAt: now(),
        stale,
      };
      cached = { key, at: snap.checkedAt, snap };
      return snap;
    })().finally(() => {
      inflight = null;
    });

    inflight = task;
    return task;
  }

  return { read };
}

export const treasuryReader = createTreasuryReader();

export async function handleTreasuryRequest(
  request: Request,
  env: TreasuryEnv,
  getAddresses: () => Promise<{ escrow: string | null; treasury: string | null }>,
  reader = treasuryReader,
): Promise<Response> {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const baseHeaders: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json(errorEnvelope("METHOD_NOT_ALLOWED", requestId), { status: 405, headers: baseHeaders });
  }
  const u = new URL(request.url);
  if (u.search) {
    return Response.json(errorEnvelope("QUERY_NOT_ALLOWED", requestId), { status: 400, headers: baseHeaders });
  }
  try {
    const addrs = await getAddresses();
    const snap = await reader.read({
      escrowAddress: addrs.escrow,
      treasuryAddress: addrs.treasury,
      apiToken: env.POA_API_TOKEN,
    });
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers: baseHeaders });
    }
    return Response.json(snap, { status: 200, headers: baseHeaders });
  } catch {
    return Response.json(errorEnvelope("TREASURY_UNAVAILABLE", requestId), { status: 503, headers: baseHeaders });
  }
}
