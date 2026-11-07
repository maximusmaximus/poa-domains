import { Fault, need, obj, integer, exact } from "./core.js";
import { publicHttps } from "./public-http.js";
import { parsePublicJSON } from "./native-json.js";

// Documented public routes only. No URL, proxy, credential, redirect, wallet or
// environment input is accepted. Default-network changes cannot change our target.
export const NATIVE_CHAIN = "poa-mainnet-1";
export const NATIVE_ORIGIN = "https://minepoa.com";
const prefix = "/chain/" + NATIVE_CHAIN + "/api/";
export const OBSERVATION_TTL_MS = 15 * 60 * 1000;
const MAX_BYTES = 65536;
export type PublicTransport = (url: string, init: RequestInit) => Promise<Response>;
const digest = (value: unknown) => {
  need(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "NATIVE_DIGEST");
  return value;
};
export function transactionId(value: unknown): string { return digest(value); }

export type NetworkObservation = {
  kind: "native-network-observation";
  source: typeof NATIVE_ORIGIN;
  chainId: typeof NATIVE_CHAIN;
  observedAt: number;
  expiresAt: number;
  verification: "node-reported-unverified";
  finalityVerified: false;
  registryReady: false;
  checkpoint: { height: number; cutoffTs: number };
  epochsClosed: number;
  agentsJoined: number;
  transactions: number;
  reportedFinalTransactions: number;
  attestationThreshold: number;
  engineSha256: string;
  paramsSha256: string;
};
export type NetworkFailure = {
  kind: "native-network-unavailable";
  code: string;
  registryReady: false;
  finalityVerified: false;
};
export function nativeFailure(error: unknown): NetworkFailure {
  return { kind: "native-network-unavailable", code: error instanceof Fault ? error.code : "NATIVE_READ_FAILED", registryReady: false, finalityVerified: false };
}
// Dependencies are code-level test seams, not accepted by HTTP/CLI/MCP/config.
export class NativeReader {
  private active = 0;
  constructor(private transport: PublicTransport = publicHttps, private clock: () => number = Date.now) {}
  private async read(route: "status" | "network-facts" | `receipt/${string}`): Promise<unknown | null> {
    need(route === "status" || route === "network-facts" || /^receipt\/[a-f0-9]{64}$/.test(route), "NATIVE_ROUTE");
    need(this.active < 4, "NATIVE_BUSY");
    this.active++;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10500);
    let response: Response | undefined;
    try {
      response = await this.transport(NATIVE_ORIGIN + prefix + route, {
        method: "GET", credentials: "omit", redirect: "error", cache: "no-store",
        headers: { accept: "application/json" }, signal: abort.signal,
      });
      need(!response.redirected && (!response.url || response.url === NATIVE_ORIGIN + prefix + route), "NATIVE_REDIRECT");
      if (response.status === 404 && route.startsWith("receipt/")) return null;
      need(response.ok, "NATIVE_HTTP");
      need(/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? ""), "NATIVE_CONTENT_TYPE");
      const size = response.headers.get("content-length"), age = response.headers.get("age");
      if (size !== null) need(/^\d+$/.test(size) && Number(size) <= MAX_BYTES, "BODY_TOO_LARGE");
      if (age !== null) need(/^\d+$/.test(age) && Number(age) <= 300, "NATIVE_STALE_CACHE");
      need(response.body, "NATIVE_BODY");
      const reader = response.body.getReader();
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          bytes += result.value.length;
          need(bytes <= MAX_BYTES, "BODY_TOO_LARGE");
          chunks.push(result.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      return parsePublicJSON(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), MAX_BYTES);
    } catch (error) {
      if (error instanceof Fault) throw error;
      throw new Fault("NATIVE_READ_FAILED");
    } finally {
      clearTimeout(timer);
      this.active--;
      // Also stop uploads/streams on a rejected content type, length or 404.
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    }
  }
  async network(): Promise<NetworkObservation> {
    const started = integer(this.clock()), status = obj(await this.read("status")), facts = obj(await this.read("network-facts"));
    need(status.chain_id === NATIVE_CHAIN && facts.chain_id === NATIVE_CHAIN, "NATIVE_CHAIN_MISMATCH");
    const cp = obj(status.checkpoint), economics = obj(facts.economics);
    const observedAt = integer(this.clock());
    need(observedAt >= started && observedAt - started <= 22000, "NATIVE_CLOCK");
    const height = integer(cp.height), cutoffTs = integer(cp.cutoff_ts);
    need(cutoffTs * 1000 <= observedAt + 300000, "NATIVE_FUTURE_CHECKPOINT");
    const epochsClosed = integer(status.epochs_closed);
    need(integer(facts.open_epoch) === epochsClosed && integer(economics.K, 1, 256) === integer(status.K, 1, 256), "NATIVE_INCONSISTENT");
    const transactions = integer(status.txs), reportedFinalTransactions = integer(status.final);
    need(reportedFinalTransactions <= transactions, "NATIVE_INCONSISTENT");
    return {
      kind: "native-network-observation", source: NATIVE_ORIGIN, chainId: NATIVE_CHAIN,
      observedAt, expiresAt: observedAt + OBSERVATION_TTL_MS,
      verification: "node-reported-unverified", finalityVerified: false, registryReady: false,
      checkpoint: { height, cutoffTs }, epochsClosed, agentsJoined: integer(status.agents_joined),
      transactions, reportedFinalTransactions, attestationThreshold: status.K,
      engineSha256: digest(facts.engine_sha256), paramsSha256: digest(facts.params_sha256),
    };
  }
  async receipt(id: unknown) {
    const txid = transactionId(id), value = await this.read(`receipt/${txid}`);
    const base = { kind: "native-receipt-observation", source: NATIVE_ORIGIN, chainId: NATIVE_CHAIN, txid, observedAt: integer(this.clock()), finalityVerified: false, safeToResubmit: false, submitted: false } as const;
    if (value === null) return { ...base, reportedStatus: "unknown" };
    const data = obj(value);
    need(data.status === "included" || data.status === "rejected", "NATIVE_RECEIPT_STATUS");
    if (data.txid !== undefined) need(data.txid === txid, "NATIVE_RECEIPT_MISMATCH");
    if (data.chain_id !== undefined) need(data.chain_id === NATIVE_CHAIN, "NATIVE_CHAIN_MISMATCH");
    for (const field of ["checkpoint_covered", "valid_in_open_window"])
      if (data[field] !== undefined) need(typeof data[field] === "boolean", "NATIVE_RECEIPT_FLAG");
    // Flags and next_nonce are node reports, NOT authorization/finality evidence.
    return { ...base, reportedStatus: data.status as "included" | "rejected", reportedCheckpointCovered: data.checkpoint_covered ?? null, reportedValidInOpenWindow: data.valid_in_open_window ?? null };
  }
}

// Read-only incident tripwire. It detects some rollbacks and release drift, NOT
// consensus/reorg proofs. No reset on a subsequent successful response.
export class NativeMonitor {
  private previous?: NetworkObservation;
  private incident?: string;
  private inFlight?: Promise<NetworkObservation>;
  constructor(private reader = new NativeReader()) {}
  observe(): Promise<NetworkObservation> {
    if (this.incident) return Promise.reject(new Fault(this.incident));
    return this.inFlight ??= this.perform().finally(() => { this.inFlight = undefined; });
  }
  private async perform() {
    const next = await this.reader.network(), previous = this.previous;
    let code: string | undefined;
    if (previous) {
      if (next.observedAt < previous.observedAt || next.checkpoint.height < previous.checkpoint.height || next.checkpoint.cutoffTs < previous.checkpoint.cutoffTs || next.epochsClosed < previous.epochsClosed || (next.checkpoint.height === previous.checkpoint.height && next.checkpoint.cutoffTs !== previous.checkpoint.cutoffTs)) code = "NATIVE_ROLLBACK_DETECTED";
      else if (next.engineSha256 !== previous.engineSha256 || next.paramsSha256 !== previous.paramsSha256) code = "NATIVE_RELEASE_DRIFT";
    }
    if (code) { this.incident = code; throw new Fault(code); }
    this.previous = structuredClone(next);
    return next;
  }
}

export function validateNetworkDocument(value: unknown, now = Date.now()): NetworkObservation | NetworkFailure {
  const data = obj(value);
  if (data.kind === "native-network-unavailable") {
    exact(data, ["kind", "code", "registryReady", "finalityVerified"]);
    need(typeof data.code === "string" && /^[A-Z_]{1,64}$/.test(data.code) && data.registryReady === false && data.finalityVerified === false, "NATIVE_DOCUMENT");
    return structuredClone(data) as NetworkFailure;
  }
  exact(data, ["kind", "source", "chainId", "observedAt", "expiresAt", "verification", "finalityVerified", "registryReady", "checkpoint", "epochsClosed", "agentsJoined", "transactions", "reportedFinalTransactions", "attestationThreshold", "engineSha256", "paramsSha256"]);
  need(data.kind === "native-network-observation" && data.source === NATIVE_ORIGIN && data.chainId === NATIVE_CHAIN && data.verification === "node-reported-unverified" && data.finalityVerified === false && data.registryReady === false, "NATIVE_DOCUMENT");
  integer(now); integer(data.observedAt); integer(data.expiresAt);
  need(data.expiresAt === data.observedAt + OBSERVATION_TTL_MS && data.observedAt <= now + 300000 && now <= data.expiresAt, "NATIVE_STALE_OBSERVATION");
  const cp = exact(data.checkpoint, ["height", "cutoffTs"]); integer(cp.height); integer(cp.cutoffTs);
  need(cp.cutoffTs * 1000 <= data.observedAt + 300000, "NATIVE_FUTURE_CHECKPOINT");
  for (const field of ["epochsClosed", "agentsJoined", "transactions", "reportedFinalTransactions"]) integer(data[field]);
  integer(data.attestationThreshold, 1, 256);
  need(data.reportedFinalTransactions <= data.transactions, "NATIVE_INCONSISTENT");
  digest(data.engineSha256); digest(data.paramsSha256);
  return structuredClone(data) as NetworkObservation;
}
