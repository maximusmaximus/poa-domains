/** Public display diagnostics only. Never contains URLs, node bodies, keys or identifiers. */
export interface ReadTiming { statusMs: number | null; factsMs: number | null; totalMs: number; }
export interface DisplayReadiness {
  held: boolean; reason: string | null; asOf: number | null;
  code: string | null; checkedAt: number; durationMs: number; slow: boolean;
  timing: ReadTiming | null;
}
const REASONS: Record<string, string> = {
  ESCROW_NODE_TIMEOUT: "The public network read timed out. Payments stay held.",
  ESCROW_NODE_UNAVAILABLE: "The public network read is unavailable. Payments stay held.",
  ESCROW_NODE_AUTH: "PoA's ledger is locked right now, so payments wait until it reopens. 🔒",
  ESCROW_NODE_HTTP: "The public node returned an error. Payments stay held.",
  ESCROW_NODE_REDIRECT: "The public node redirected a safety read. Payments stay held.",
  ESCROW_NODE_RESPONSE_LIMIT: "The public node response was too large. Payments stay held.",
  ESCROW_NODE_INVALID_RESPONSE: "The public node response could not be verified. Payments stay held.",
  ESCROW_NODE_CHAIN: "The public network identity did not match. Payments stay held.",
  ESCROW_CHAIN: "The network identity did not match. Payments stay held.",
  ESCROW_STALE: "The network reading is stale or inconsistent. Payments stay held.",
  ESCROW_PROTOCOL_UNPINNED: "Network protocol pins are not valid. Payments stay held.",
  ESCROW_PROTOCOL_CHANGED: "Network protocol pins do not match. Payments stay held.",
  ESCROW_UNALIGNED_CUT: "The network readings do not describe the same checkpoint. Payments stay held.",
  ESCROW_CHECKPOINT: "The network checkpoint could not be verified. Payments stay held.",
  ESCROW_FUTURE_CHECKPOINT: "The network checkpoint is in the future. Payments stay held.",
  ESCROW_CHECKPOINT_ROLLBACK: "The network checkpoint went backwards. Payments stay held.",
  ESCROW_FEE_POLICY: "The network fee does not match policy. Payments stay held.",
};
export function displayCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "ESCROW_NODE_TIMEOUT";
    const code = "code" in error ? error.code : error.message;
    if (typeof code === "string" && Object.hasOwn(REASONS, code)) return code;
    if (error instanceof SyntaxError || code === "INTEGER") return "ESCROW_NODE_INVALID_RESPONSE";
  }
  return "ESCROW_NODE_UNAVAILABLE";
}
export const displayReason = (code: string): string => "Network freshness or verification is held. " + (Object.hasOwn(REASONS, code) ? REASONS[code]! : REASONS.ESCROW_NODE_UNAVAILABLE!);
/** Only this locally-created safe error may carry timing into a public response. */
export class DisplayReadError extends Error {
  readonly code: string;
  constructor(error: unknown, readonly timing: ReadTiming) { const code = displayCode(error); super(code); this.code = code; }
}
