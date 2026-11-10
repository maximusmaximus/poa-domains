// Shared schema projection. Availability probes preserve their deployed status-only contract;
// native observations require the complete pinned status + network-facts pair.
const SOURCE = "https://minepoa.com", CHAIN = "poa-mainnet-1", TTL_MS = 900000;
const record = v => v !== null && typeof v === "object" && !Array.isArray(v);
const count = v => Number.isSafeInteger(v) && v >= 0;
export function parseNetworkStatus(status, { facts, now, fail, availabilityOnly = false }) {
  if (availabilityOnly) {
    if (!record(status) || (status.chain_id !== undefined && status.chain_id !== CHAIN) || typeof status.epochs_closed !== "number") fail("INVALID_SCHEMA");
    return { epochsClosed: status.epochs_closed, checkpointHeight: typeof status.checkpoint?.height === "number" ? status.checkpoint.height : typeof status.checkpoint_height === "number" ? status.checkpoint_height : null, agentsJoined: typeof status.agents_joined === "number" ? status.agents_joined : null, txs: typeof status.txs === "number" ? status.txs : null, final: typeof status.final === "number" ? status.final : null, stale: typeof status.stale === "boolean" ? status.stale : null, staleAgeS: typeof status.stale_age_s === "number" ? status.stale_age_s : null };
  }
  if (!record(status) || !record(facts) || !record(status.checkpoint) || !record(facts.economics)) fail('INVALID_SCHEMA');
  if (typeof status.chain_id !== 'string' || typeof facts.chain_id !== 'string') fail('INVALID_SCHEMA');
  if (status.chain_id !== CHAIN || facts.chain_id !== CHAIN) fail('CHAIN_MISMATCH');
  for (const n of [status.checkpoint.height, status.checkpoint.cutoff_ts, status.epochs_closed,
    status.agents_joined, status.txs, status.final, status.K, facts.open_epoch, facts.economics.K]) {
    if (!count(n)) fail('INVALID_SCHEMA');
  }
  if (status.K < 1 || status.K > 256 || facts.economics.K < 1 || facts.economics.K > 256) fail('INVALID_SCHEMA');
  if (status.K !== facts.economics.K || facts.open_epoch !== status.epochs_closed || status.final > status.txs) fail('CONSISTENCY_MISMATCH');
  for (const digest of [facts.engine_sha256, facts.params_sha256]) {
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) fail('INVALID_SCHEMA');
  }
  if (status.checkpoint.cutoff_ts > Math.floor((now + 300000) / 1000)) fail('FUTURE_CHECKPOINT');
  return Object.freeze({
    kind: 'native-network-observation', source: SOURCE, chainId: CHAIN,
    observedAt: now, expiresAt: now + TTL_MS,
    verification: 'node-reported-unverified', finalityVerified: false, registryReady: false,
    checkpoint: Object.freeze({ height: status.checkpoint.height, cutoffTs: status.checkpoint.cutoff_ts }),
    epochsClosed: status.epochs_closed, agentsJoined: status.agents_joined,
    transactions: status.txs, reportedFinalTransactions: status.final,
    attestationThreshold: status.K, engineSha256: facts.engine_sha256, paramsSha256: facts.params_sha256,
  });
}
