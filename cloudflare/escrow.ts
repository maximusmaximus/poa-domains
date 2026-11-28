import { DisplayReadError, displayCode, displayReason, type DisplayReadiness, type ReadTiming } from "./display-freshness.js";
import { Fault, canonical, exact, integer, need, obj, text } from "../src/core.js";
import { Packet, authenticate } from "../src/auth.js";
import { CHAIN, Command, Signer, Transfer, address, decimal, digest, micros, txid, verifyTransfer } from "./escrow-codec.js";

export const PILOT_JOURNAL_LIMIT = 2000;
export const PILOT_ADMISSION_LIMIT = 1900;
export const COMPACT_KEEP_TAIL = 32;
export const COMPACT_TRIGGER_ROWS = 128;
export const COMPACTED_JOURNAL_LIMIT = 100000;
export const COMPACTED_ADMISSION_LIMIT = 90000;
export const STATE_KEEP_REQUESTS = 200;
export const STATE_KEEP_PAYMENTS = 64;
export const STATE_KEEP_DEPOSITS = 120;
export const STATE_KEEP_TERMINAL_AUCTIONS = 500;
const FOLD_MIN_ITEMS = 64;
const FOLD_MIN_REQUESTS = 100;
const journalQueues = new WeakMap<Journal, Promise<unknown>>();
// Immediate shared kill latch while the durable pause waits behind in-flight I/O.
const pendingPauses = new WeakMap<Journal, symbol>();

export interface Observation {
  id: string; body: Transfer; chain: string; valid: boolean; attestations: number;
  checkpoint: { height: number; root: string; anchored: boolean; quorum: number } | null;
}
export interface Status {
  chain: string; asOf: number; stale: boolean; height: number; root: string; fee: string; cutoff?: number; readTiming?: ReadTiming;
}
export interface Context { nextNonce: number; parents: string[]; cutoff: number; }
export interface Cut { chain: string; height: number; root: string; balance: string; covered: string[]; }
/** These are trusted-node observations, not independent consensus-proof verification. */
export interface Network {
  status(): Promise<Status>;
  /** Optional display-only observation; NEVER authorizes a financial operation. */
  displayStatus?(): Promise<Status>;
  /** Optional incoming transfer txids to the escrow wallet, used to auto-credit open intents before reconciliation. */
  incoming?(wallet: string): Promise<string[]>;
  lookup(id: string): Promise<Observation | null>;
  context(wallet: string, knownTxid?: string): Promise<Context>; cut(wallet: string, ids: string[], status: Status): Promise<Cut>;
  submit(body: Transfer): Promise<void>;
}
export interface TitleStore {
  terms(name: string, seller: string): { reserve: string; window: number; quiet: number; deedId?: string; ownerVersion?: number };
  validate(packet: Packet, name: string, seller: string, buyer: string): void;
  commit(packet: Packet): void;
  /** Optional zero-handover automatic title settlement after seller/fee payouts reach finality. */
  validateAutoSettle?(name: string, seller: string, buyer: string, auctionId: string, priceMicros: string, deedId?: string, ownerVersion?: number): void;
  commitAutoSettle?(name: string, seller: string, buyer: string, auctionId: string, priceMicros: string, deedId?: string, ownerVersion?: number): void;
  /** POA new-name checkout (optional; absent => OFF). Price in POA micros from the registry reserve schedule. */
  issueTerms?(name: string): { price: string };
  validateIssue?(packet: Packet, name: string, buyer: string, price: string): void;
  issue?(packet: Packet): void;
  /** POA subname sales (optional; absent => OFF). The seller must hold the permanent, unlocked root. */
  subTerms?(parent: string, seller: string): { parentDeedId: string; ownerVersion: number };
  validateSub?(packet: Packet, name: string, buyer: string, price: string, listing: SubListing): void;
  issueSub?(packet: Packet): void;
}
/** One owner-reviewed credit for a deposit that arrived while escrow was held.
 * Bound to one exact txid, sender, amount and intent; usable once; never pauses or unpauses. */
export interface ReviewedCredit { id: string; txid: string; from: string; amount: string; intent: string; halt: string; }
/** Reviewed by Max (t140s1299, Nov 14 2026): DT1's 1 POA deposit to its own intent, received while held. */
export const REVIEWED_CREDITS: Readonly<Record<string, ReviewedCredit>> = Object.freeze({
  "dt1-deposit-2026-11-13": Object.freeze({
    id: "dt1-deposit-2026-11-13",
    txid: "e0c05f6b24f5bcd85abacb078ada23367fc5b98eeec35088b73d2d6f84585123",
    from: "poa15kUYz7V59rd1zY12bp1Kvnx5HWjYhTeS6o74uu9KUXCC",
    amount: "1.000000",
    intent: "659ff32af83914966fa9f16edf23a21857aafca06b50a16d8d4e092f55d0a9fc",
    halt: "ASSET_LIABILITY_MISMATCH",
  }),
});
export function reviewedCredit(id: unknown): ReviewedCredit {
  const key = text(id, 80); need(Object.hasOwn(REVIEWED_CREDITS, key), "ESCROW_REVIEW"); return REVIEWED_CREDITS[key]!;
}
export interface Policy { wallet: string; treasury: string; perTx: string; daily: string; feeBps: number; maxAgeMs: number; }
type PayStatus = "READY" | "SIGNED" | "UNKNOWN" | "FINAL";
export interface Payment {
  id: string; kind: "refund" | "seller" | "fee"; to: string; amount: string; status: PayStatus;
  day: string | null; body: Transfer | null; txid: string | null;
}
interface Deposit { payer: string; amount: string; tx: string | null; createdAt?: number; auto?: boolean; }
interface Auction {
  id: string; name: string; seller: string; reserve: string; closes: number; quiet: number; kind?: "auction" | "fixed"; createdAt?: number;
  /** Auction duration (ms) started when the first bid lands (closes === 0 until first bid). */
  window?: number;
  /** Timestamp (ms) when the first bid started the auction timer. */
  startedAt?: number | null;
  /** Extended handover deadline (ms) granted when another auction by the same seller finishes SETTLING. */
  handoverUntil?: number;
  /** Deed ID and ownerVersion pinned at listing time for zero-handover auto-settlement. */
  deedId?: string;
  ownerVersion?: number;
  autoSettle?: boolean;
  history?: {event:string;at:number;amount?:string;payer?:string}[];
  high: { payer: string; amount: string } | null; status: "OPEN" | "CANCELLED" | "SETTLING" | "COMPLETE";
}
interface Settlement { auction: string; packet: Packet | null; auto?: boolean; payments: string[]; status: "PAYING" | "TITLE_PENDING" | "COMPLETE"; }
export interface FoldedLedger {
  /** Immutable PoA checkpoint height at or below which every folded tx was cryptographically verified covered. */
  height: number;
  /** Exact net signed micros of folded covered transactions: sum(folded credited) - sum(folded FINAL payments). */
  netMicros: string;
  /** Highest outgoing nonce among folded FINAL payments; every remaining payment with a body must have nonce > maxOutNonce. */
  maxOutNonce: number;
  creditedCount: number;
  uncreditedCount: number;
  paymentCount: number;
  /** UTC day (YYYY-MM-DD) for same-day folded payouts still counting against daily payout cap. */
  day?: string;
  dayUsedMicros?: string;
}
export interface State {
  sequence: number; policy: string; paused: boolean; halt: string | null; assets: string; nonce: number | null;
  quarantine: Record<string,{observed:string;expectedMicros:string}>;
  available: Record<string,string>; deposits: Record<string,Deposit>; credited: Record<string,Transfer>;
  auctions: Record<string,Auction>; payments: Record<string,Payment>; settlements: Record<string,Settlement>;
  requests: Record<string,{ fingerprint: string; result: unknown }>;
  /** Owner-reviewed one-shot credits (absent in older journals). */
  reviews?: Record<string,{ txid: string; intent: string; height: number; root: string; observed: string; at: number }>;
  /** POA subname listings set by a parent holder (absent in older journals). */
  subListings?: Record<string,SubListing>;
  /** Unsolicited or mismatched incoming transfers booked solely for sender-bound bounce-back refunds (absent in older journals). */
  uncredited?: Record<string,Transfer>;
  /** Checkpoint-verified folded totals for archived finalized deposits and payments (absent before compaction). */
  folded?: FoldedLedger;
}
export interface SubListing {
  id: string; parent: string; parentDeedId: string; ownerVersion: number; seller: string; price: string;
  status: "OPEN" | "CANCELLED"; createdAt: number; sold: { name: string; buyer: string; at: number; payments: string[] }[];
}
export interface Entry { sequence: number; previous: string; event: string; payload: unknown; state: State; checksum: string; }
export type EscrowCheckpoint = Entry;
export interface EscrowArchivedRequest { rk: string; fingerprint: string; result: unknown; }
export interface EscrowArchivedTx { txid: string; kind: "credited" | "payment"; senderNonce: string | null; memo: string | null; amount: string; height: number; }
export interface EscrowArchivedDeposit { intent: string; payer: string; amount: string; tx: string; createdAt: number | null; finalAt: number | null; }
export interface EscrowArchivedRefund { id: string; payer: string; amount: string; status: PayStatus; txid: string | null; day: string | null; seq: number; }
export interface EscrowArchivedData {
  requests: EscrowArchivedRequest[];
  txs: EscrowArchivedTx[];
  deposits: EscrowArchivedDeposit[];
  refunds: EscrowArchivedRefund[];
}
export interface EscrowArchiveStore {
  getRequest(rk: string): { fingerprint: string; result: unknown } | null;
  hasTxConflict(txid: string, from: string, nonce: number, memo?: string): boolean;
  getDeposit(intent: string): EscrowArchivedDeposit | null;
  listDeposits(payer: string, limit: number): EscrowArchivedDeposit[];
  listRefunds(payer: string, limit: number): EscrowArchivedRefund[];
  writeBatch(batch: Partial<EscrowArchivedData>): void;
  exportAll(): EscrowArchivedData;
}
export interface JournalCapacityMeta {
  checkpointSequence: number;
  retainedRows: number;
  admissionLimit: number;
  hardLimit: number;
  compacting: boolean;
}
export interface EscrowCapacity extends JournalCapacityMeta {
  sequence: number;
  reserve: number;
  remainingForAdmission: number;
  remainingForWork: number;
  admissionOpen: boolean;
  foldedTransactions: number;
}
export interface Journal {
  load(): State;
  append(event: string, payload: unknown, change: (s: State) => void, onCommit?: () => void): State;
  capacityInfo?(): JournalCapacityMeta;
  compact?(): boolean;
  readonly archive?: EscrowArchiveStore;
}
/** Non-journal reconciliation watermark so dust/surplus alerts consume zero journal entries while still halting on any unexplained surplus drop. */
export interface SurplusWatermark { height: number; root: string; unexplainedMicros: string; cutoff?: number; observedAt: number; }
export interface SurplusStore { read(wallet: string): SurplusWatermark | null; write(wallet: string, mark: SurplusWatermark): void; clear?(wallet: string): void; }
const defaultSurplusStores = new WeakMap<Journal, Map<string, SurplusWatermark>>();
export function initial(policy: Policy): State {
  address(policy.wallet); address(policy.treasury); need(policy.wallet!==policy.treasury,"ESCROW_DISTINCT_WALLET"); need(micros(policy.perTx)>0n && micros(policy.daily)>=micros(policy.perTx), "ESCROW_LIMITS");
  integer(policy.feeBps,0,10000); integer(policy.maxAgeMs,1,300000);
  return { sequence:0,policy:digest(policy),paused:true,halt:null,assets:"0",nonce:null,
    quarantine:{},available:{},deposits:{},credited:{},auctions:{},payments:{},settlements:{},requests:{} };
}
/** Integer-micro accounting. Every credited asset remains a liability until verified outgoing finality. */
export function invariant(s: State): void {
  let liabilities = 0n;
  for(const n of Object.values(s.available)) { need(/^(0|[1-9][0-9]*)$/.test(n),"ESCROW_ACCOUNTING"); liabilities += BigInt(n); }
  for(const a of Object.values(s.auctions)) if(a.status === "OPEN" && a.high) liabilities += BigInt(a.high.amount);
  for(const p of Object.values(s.payments)) if(p.status !== "FINAL") liabilities += BigInt(p.amount);
  need(liabilities === BigInt(s.assets) && liabilities >= 0n,"ESCROW_ACCOUNTING");
  if (s.folded) {
    integer(s.folded.height, 0);
    need(/^-?(0|[1-9][0-9]*)$/.test(s.folded.netMicros), "ESCROW_ACCOUNTING");
    integer(s.folded.maxOutNonce, 0);
    integer(s.folded.creditedCount, 0);
    integer(s.folded.uncreditedCount, 0);
    integer(s.folded.paymentCount, 0);
    if (s.folded.day !== undefined) {
      need(/^\d{4}-\d{2}-\d{2}$/.test(s.folded.day) && /^(0|[1-9][0-9]*)$/.test(s.folded.dayUsedMicros ?? ""), "ESCROW_ACCOUNTING");
    }
  }
  const minLiveNonce = s.folded?.maxOutNonce ?? 0;
  const nonces = Object.values(s.payments).filter(p=>p.body).map(p=>p.body!.nonce);
  need(new Set(nonces).size === nonces.length,"ESCROW_NONCE_REUSE");
  if (minLiveNonce > 0) need(nonces.every(n => n > minLiveNonce), "ESCROW_NONCE_REUSE");
  const uncredited = s.uncredited ?? {};
  for(const id of Object.keys(uncredited)) need(!s.credited[id],"ESCROW_DEPOSIT_DUPLICATE");
  const depNonces = [...Object.values(s.credited), ...Object.values(uncredited)].map(b=>`${b.from}:${b.nonce}`);
  const depMemos = Object.values(s.credited).map(b=>b.memo);
  need(new Set(depNonces).size === depNonces.length && new Set(depMemos).size === depMemos.length,"ESCROW_DEPOSIT_DUPLICATE");
  for(const p of Object.values(s.payments)) if(p.body) need(p.txid === txid(p.body) &&
    p.to === p.body.to && decimal(BigInt(p.amount)) === p.body.amount,"ESCROW_OUTBOX_CORRUPT");
}
/** Worst-case records to drain existing obligations, without admitting new money.
 * Includes deposits already invited by an intent, capped withdrawal chunks,
 * both seller/fee outboxes, and one failed-title + seller-repair transition.
 */
export function recoveryReserve(s: State, policy: Policy): bigint {
  const cap=micros(policy.perTx);
  const chunks=(n:bigint)=>(n+cap-1n)/cap;
  let n=Object.values(s.available).reduce((n,v)=>n+4n*chunks(BigInt(v)),0n);
  for(const d of Object.values(s.deposits))if(!d.tx)n+=1n+4n*chunks(micros(d.amount));
  for(const a of Object.values(s.auctions))if(a.status==="OPEN")n+=a.high?9n:1n;
  for(const p of Object.values(s.payments))n+=BigInt({READY:3,SIGNED:2,UNKNOWN:1,FINAL:0}[p.status]);
  for(const st of Object.values(s.settlements))n+=st.status==="PAYING"?2n:st.status==="TITLE_PENDING"?1n:0n;
  return n;
}
const DRAIN_EVENTS=new Set(["deposit","withdraw","cancel","expire","auto-expire","auto-settle","settle","repair-title",
  "outgoing-intent","outgoing-unknown","payment-final","title-pending","title-complete"]);
export function nextEntry(
  s: State,
  previous: string,
  event: string,
  payload: unknown,
  change: (s: State) => void,
  policy: Policy,
  limits?: { checkpointSequence: number; hardLimit: number },
): Entry {
  const emergency=event==="pause"||event==="halt"||event==="reconciliation-quarantine"||event==="restore-paused"||event==="compact-state";
  // Emergency controls and state compaction must remain available after a legacy drain crosses the
  // old cap; they never admit financial obligations. Repeated controls dedupe.
  const next = structuredClone(s); change(next); next.sequence++; invariant(next);
  if(!emergency){
    const remaining=recoveryReserve(next,policy);
    const baseSeq=limits?.checkpointSequence??0;
    const hardLimit=limits?.hardLimit??PILOT_JOURNAL_LIMIT;
    const retained=BigInt(Math.max(0,next.sequence-baseSeq));
    // New work must reserve its entire drain budget atomically. Legacy journals
    // (or emergency entries) may already exceed that budget: permit only a
    // strictly decreasing, finite recovery lane, never new admissions/noops.
    const drains=DRAIN_EVENTS.has(event)&&remaining<recoveryReserve(s,policy);
    need(retained+remaining<=BigInt(hardLimit)||drains,"ESCROW_JOURNAL_CAPACITY");
  }
  const v = { sequence:next.sequence,previous,event,payload,state:next }; return {...v,checksum:digest(v)};
}
function verifyCheckpointEntry(cp: EscrowCheckpoint, policyHash: string): Entry {
  need(Boolean(cp && typeof cp === "object"), "ESCROW_JOURNAL_CORRUPT");
  const row = cp as Entry;
  const { checksum, ...v } = row;
  need(
    Number.isSafeInteger(row.sequence) &&
    row.sequence >= 1 &&
    row.state?.sequence === row.sequence &&
    row.state?.policy === policyHash &&
    checksum === digest(v),
    "ESCROW_JOURNAL_CORRUPT",
  );
  invariant(row.state);
  return row;
}
export function replay(rows: Entry[], policy: Policy, checkpoint?: EscrowCheckpoint): State {
  const init = initial(policy);
  let s = init, previous = digest(["escrow-genesis/v1", init.policy]);
  if (checkpoint) {
    const cp = verifyCheckpointEntry(checkpoint, init.policy);
    s = cp.state;
    previous = cp.checksum;
  }
  for(const row of rows) {
    const {checksum,...v}=row;
    need(row.sequence===s.sequence+1 && row.previous===previous && checksum===digest(v) && row.state.policy===init.policy,"ESCROW_JOURNAL_CORRUPT");
    invariant(row.state); s=row.state; previous=checksum;
  }
  return structuredClone(s);
}
const ESCROW_REPLAY_PAGE_SIZE = 16;
class SQLiteEscrowArchiveStore implements EscrowArchiveStore {
  constructor(private storage: DurableObjectStorage) {}
  getRequest(rk: string): { fingerprint: string; result: unknown } | null {
    const row = this.storage.sql.exec<{ fingerprint: string; result: string }>(
      "SELECT fingerprint, result FROM escrow_request_archive WHERE rk = ?",
      rk,
    ).toArray()[0];
    return row ? { fingerprint: String(row.fingerprint), result: JSON.parse(String(row.result)) } : null;
  }
  hasTxConflict(tx: string, from: string, nonce: number, memo?: string): boolean {
    const sn = `${from}:${nonce}`;
    const hit = this.storage.sql.exec<{ txid: string }>(
      memo
        ? "SELECT txid FROM escrow_archived_txs WHERE txid = ? OR sender_nonce = ? OR memo = ? LIMIT 1"
        : "SELECT txid FROM escrow_archived_txs WHERE txid = ? OR sender_nonce = ? LIMIT 1",
      ...(memo ? [tx, sn, memo] : [tx, sn]),
    ).toArray()[0];
    return Boolean(hit);
  }
  getDeposit(intent: string): EscrowArchivedDeposit | null {
    const r = this.storage.sql.exec<{ intent: string; payer: string; amount: string; tx: string; created_at: number | null; final_at: number | null }>(
      "SELECT intent, payer, amount, tx, created_at, final_at FROM escrow_archived_deposits WHERE intent = ?",
      intent,
    ).toArray()[0];
    return r ? { intent: String(r.intent), payer: String(r.payer), amount: String(r.amount), tx: String(r.tx), createdAt: r.created_at === null ? null : Number(r.created_at), finalAt: r.final_at === null ? null : Number(r.final_at) } : null;
  }
  listDeposits(payer: string, limit: number): EscrowArchivedDeposit[] {
    return this.storage.sql.exec<{ intent: string; payer: string; amount: string; tx: string; created_at: number | null; final_at: number | null }>(
      "SELECT intent, payer, amount, tx, created_at, final_at FROM escrow_archived_deposits WHERE payer = ? ORDER BY COALESCE(final_at, created_at, 0) DESC LIMIT ?",
      payer,
      limit,
    ).toArray().map(r => ({ intent: String(r.intent), payer: String(r.payer), amount: String(r.amount), tx: String(r.tx), createdAt: r.created_at === null ? null : Number(r.created_at), finalAt: r.final_at === null ? null : Number(r.final_at) })).reverse();
  }
  listRefunds(payer: string, limit: number): EscrowArchivedRefund[] {
    return this.storage.sql.exec<{ id: string; payer: string; amount: string; status: string; txid: string | null; day: string | null; seq: number }>(
      "SELECT id, payer, amount, status, txid, day, seq FROM escrow_archived_refunds WHERE payer = ? ORDER BY seq DESC LIMIT ?",
      payer,
      limit,
    ).toArray().map(r => ({ id: String(r.id), payer: String(r.payer), amount: String(r.amount), status: String(r.status) as PayStatus, txid: r.txid === null ? null : String(r.txid), day: r.day === null ? null : String(r.day), seq: Number(r.seq) })).reverse();
  }
  writeBatch(batch: Partial<EscrowArchivedData>): void {
    for (const r of batch.requests ?? []) {
      this.storage.sql.exec(
        "INSERT OR REPLACE INTO escrow_request_archive(rk,fingerprint,result) VALUES (?,?,?)",
        r.rk, r.fingerprint, canonical(r.result),
      );
    }
    for (const t of batch.txs ?? []) {
      this.storage.sql.exec(
        "INSERT OR REPLACE INTO escrow_archived_txs(txid,kind,sender_nonce,memo,amount,height) VALUES (?,?,?,?,?,?)",
        t.txid, t.kind, t.senderNonce, t.memo, t.amount, t.height,
      );
    }
    for (const d of batch.deposits ?? []) {
      this.storage.sql.exec(
        "INSERT OR REPLACE INTO escrow_archived_deposits(intent,payer,amount,tx,created_at,final_at) VALUES (?,?,?,?,?,?)",
        d.intent, d.payer, d.amount, d.tx, d.createdAt, d.finalAt,
      );
    }
    for (const f of batch.refunds ?? []) {
      this.storage.sql.exec(
        "INSERT OR REPLACE INTO escrow_archived_refunds(id,payer,amount,status,txid,day,seq) VALUES (?,?,?,?,?,?,?)",
        f.id, f.payer, f.amount, f.status, f.txid, f.day, f.seq,
      );
    }
  }
  exportAll(): EscrowArchivedData {
    const requests = this.storage.sql.exec<{ rk: string; fingerprint: string; result: string }>(
      "SELECT rk, fingerprint, result FROM escrow_request_archive ORDER BY rk ASC",
    ).toArray().map(r => ({ rk: String(r.rk), fingerprint: String(r.fingerprint), result: JSON.parse(String(r.result)) }));
    const txs = this.storage.sql.exec<{ txid: string; kind: string; sender_nonce: string | null; memo: string | null; amount: string; height: number }>(
      "SELECT txid, kind, sender_nonce, memo, amount, height FROM escrow_archived_txs ORDER BY txid ASC",
    ).toArray().map(r => ({ txid: String(r.txid), kind: String(r.kind) as "credited" | "payment", senderNonce: r.sender_nonce === null ? null : String(r.sender_nonce), memo: r.memo === null ? null : String(r.memo), amount: String(r.amount), height: Number(r.height) }));
    const deposits = this.storage.sql.exec<{ intent: string; payer: string; amount: string; tx: string; created_at: number | null; final_at: number | null }>(
      "SELECT intent, payer, amount, tx, created_at, final_at FROM escrow_archived_deposits ORDER BY intent ASC",
    ).toArray().map(r => ({ intent: String(r.intent), payer: String(r.payer), amount: String(r.amount), tx: String(r.tx), createdAt: r.created_at === null ? null : Number(r.created_at), finalAt: r.final_at === null ? null : Number(r.final_at) }));
    const refunds = this.storage.sql.exec<{ id: string; payer: string; amount: string; status: string; txid: string | null; day: string | null; seq: number }>(
      "SELECT id, payer, amount, status, txid, day, seq FROM escrow_archived_refunds ORDER BY seq ASC, id ASC",
    ).toArray().map(r => ({ id: String(r.id), payer: String(r.payer), amount: String(r.amount), status: String(r.status) as PayStatus, txid: r.txid === null ? null : String(r.txid), day: r.day === null ? null : String(r.day), seq: Number(r.seq) }));
    return { requests, txs, deposits, refunds };
  }
}
export class SQLiteEscrowJournal implements Journal {
  private cached?: { sequence: number; checksum: string; state: State };
  private readonly policyHash: string;
  readonly archive: EscrowArchiveStore;
  constructor(private storage: DurableObjectStorage, private policy: Policy) {
    this.policyHash = digest(policy);
    this.archive = new SQLiteEscrowArchiveStore(storage);
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS escrow_journal (sequence INTEGER PRIMARY KEY, record TEXT NOT NULL); " +
      "CREATE TABLE IF NOT EXISTS escrow_policy (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); " +
      "CREATE TABLE IF NOT EXISTS escrow_verified_head (id INTEGER PRIMARY KEY CHECK(id=1), policy TEXT NOT NULL, sequence INTEGER NOT NULL, checksum TEXT NOT NULL); " +
      "CREATE TABLE IF NOT EXISTS escrow_checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL, record TEXT NOT NULL); " +
      "CREATE TABLE IF NOT EXISTS escrow_request_archive (rk TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL); " +
      "CREATE TABLE IF NOT EXISTS escrow_archived_txs (txid TEXT PRIMARY KEY, kind TEXT NOT NULL, sender_nonce TEXT, memo TEXT, amount TEXT NOT NULL, height INTEGER NOT NULL); " +
      "CREATE INDEX IF NOT EXISTS idx_escrow_archived_txs_sn ON escrow_archived_txs(sender_nonce); " +
      "CREATE INDEX IF NOT EXISTS idx_escrow_archived_txs_memo ON escrow_archived_txs(memo); " +
      "CREATE TABLE IF NOT EXISTS escrow_archived_deposits (intent TEXT PRIMARY KEY, payer TEXT NOT NULL, amount TEXT NOT NULL, tx TEXT NOT NULL, created_at INTEGER, final_at INTEGER); " +
      "CREATE INDEX IF NOT EXISTS idx_escrow_archived_deposits_payer ON escrow_archived_deposits(payer); " +
      "CREATE TABLE IF NOT EXISTS escrow_archived_refunds (id TEXT PRIMARY KEY, payer TEXT NOT NULL, amount TEXT NOT NULL, status TEXT NOT NULL, txid TEXT, day TEXT, seq INTEGER NOT NULL); " +
      "CREATE INDEX IF NOT EXISTS idx_escrow_archived_refunds_payer ON escrow_archived_refunds(payer)",
    );
    const saved = storage.sql.exec<{value:string}>("SELECT value FROM escrow_policy WHERE id=1").toArray()[0];
    const hasLedger = storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM escrow_journal").one().n > 0 || this.readCheckpointSeq() > 0;
    if(saved && hasLedger) need(saved.value === canonical(policy),"ESCROW_POLICY_CHANGED");
    else storage.sql.exec("INSERT OR REPLACE INTO escrow_policy(id,value) VALUES (1,?)",canonical(policy));
  }
  private readCheckpointSeq(): number {
    const r = this.storage.sql.exec<{sequence:number}>("SELECT sequence FROM escrow_checkpoint WHERE id=1").toArray()[0];
    return r ? Number(r.sequence) : 0;
  }
  readCheckpoint(): EscrowCheckpoint | null {
    const r = this.storage.sql.exec<{sequence:number;record:string}>("SELECT sequence, record FROM escrow_checkpoint WHERE id=1").toArray()[0];
    if (!r) return null;
    const cp = verifyCheckpointEntry(JSON.parse(r.record) as EscrowCheckpoint, this.policyHash);
    need(cp.sequence === Number(r.sequence), "ESCROW_JOURNAL_CORRUPT");
    return cp;
  }
  private latestSeq(): number {
    const r = this.storage.sql.exec<{seq:number|null}>("SELECT MAX(sequence) AS seq FROM escrow_journal").one();
    const jSeq = r.seq === null ? 0 : Number(r.seq);
    return Math.max(jSeq, this.readCheckpointSeq());
  }
  private readVerifiedHead(): { policy: string; sequence: number; checksum: string } | null {
    const r = this.storage.sql.exec<{policy:string;sequence:number;checksum:string}>(
      "SELECT policy, sequence, checksum FROM escrow_verified_head WHERE id=1",
    ).toArray()[0];
    return r ? { policy: String(r.policy), sequence: Number(r.sequence), checksum: String(r.checksum) } : null;
  }
  private saveVerifiedHead(sequence: number, checksum: string): void {
    this.storage.sql.exec(
      "INSERT OR REPLACE INTO escrow_verified_head(id,policy,sequence,checksum) VALUES (1,?,?,?)",
      this.policyHash,
      sequence,
      checksum,
    );
  }
  capacityInfo(): JournalCapacityMeta {
    const cpSeq = this.readCheckpointSeq();
    const seq = this.latestSeq();
    return {
      checkpointSequence: cpSeq,
      retainedRows: Math.max(0, seq - cpSeq),
      admissionLimit: COMPACTED_ADMISSION_LIMIT,
      hardLimit: COMPACTED_JOURNAL_LIMIT,
      compacting: true,
    };
  }
  /** Roll the verified checkpoint forward and prune older redundant journal rows atomically.
   * Reads ONLY the target checkpoint row plus the short hot tail (COMPACT_KEEP_TAIL rows) — O(1) RAM. */
  private compactRowsLocked(): boolean {
    const cpSeq = this.readCheckpointSeq();
    const seq = this.latestSeq();
    if (seq - cpSeq <= COMPACT_TRIGGER_ROWS) return false;
    const targetSeq = seq - COMPACT_KEEP_TAIL;
    if (targetSeq <= cpSeq) return false;
    const rawCp = this.storage.sql.exec<{record:string}>("SELECT record FROM escrow_journal WHERE sequence = ?", targetSeq).toArray()[0];
    need(!!rawCp, "ESCROW_JOURNAL_CORRUPT");
    const cpEntry = verifyCheckpointEntry(JSON.parse(rawCp.record) as EscrowCheckpoint, this.policyHash);
    need(cpEntry.sequence === targetSeq, "ESCROW_JOURNAL_CORRUPT");
    let prevSeq = cpEntry.sequence, prevHash = cpEntry.checksum;
    for (const raw of this.storage.sql.exec<{sequence:number;record:string}>(
      "SELECT sequence, record FROM escrow_journal WHERE sequence > ? ORDER BY sequence LIMIT ?",
      targetSeq,
      COMPACT_KEEP_TAIL + 4,
    )) {
      const row = JSON.parse(raw.record) as Entry;
      const { checksum, ...v } = row;
      need(
        row.sequence === prevSeq + 1 &&
        row.previous === prevHash &&
        checksum === digest(v) &&
        row.state.policy === this.policyHash,
        "ESCROW_JOURNAL_CORRUPT",
      );
      invariant(row.state);
      prevSeq = row.sequence;
      prevHash = checksum;
    }
    need(prevSeq === seq, "ESCROW_JOURNAL_CORRUPT");
    const head = this.readVerifiedHead();
    if (head && head.policy === this.policyHash && head.sequence === seq) {
      need(head.checksum === prevHash, "ESCROW_JOURNAL_CORRUPT");
    }
    this.storage.sql.exec(
      "INSERT OR REPLACE INTO escrow_checkpoint(id,sequence,record) VALUES (1,?,?)",
      cpEntry.sequence,
      canonical(cpEntry),
    );
    this.storage.sql.exec("DELETE FROM escrow_journal WHERE sequence <= ?", cpEntry.sequence);
    this.saveVerifiedHead(prevSeq, prevHash);
    return true;
  }
  compact(): boolean {
    return this.storage.transactionSync(() => this.compactRowsLocked());
  }
  /** Load the latest state in O(1) memory: fast-path via verified tip checksum when intact,
   * otherwise page-replay from the verified checkpoint (or genesis) without materializing the journal in RAM. */
  private loadLatest(inTx = false): { state: State; checksum: string } {
    const seq = this.latestSeq();
    if (seq === 0) {
      const s = initial(this.policy);
      return { state: s, checksum: digest(["escrow-genesis/v1", s.policy]) };
    }
    const head = this.readVerifiedHead();
    if (head && head.policy === this.policyHash && head.sequence === seq) {
      const raw = this.storage.sql.exec<{record:string}>("SELECT record FROM escrow_journal WHERE sequence = ?", seq).toArray()[0];
      if (raw) {
        const row = JSON.parse(raw.record) as Entry;
        const { checksum, ...v } = row;
        need(
          row.sequence === seq &&
          checksum === head.checksum &&
          checksum === digest(v) &&
          row.state.policy === this.policyHash,
          "ESCROW_JOURNAL_CORRUPT",
        );
        invariant(row.state);
        if (!inTx && seq - this.readCheckpointSeq() > COMPACT_TRIGGER_ROWS) {
          this.storage.transactionSync(() => this.compactRowsLocked());
        }
        return { state: row.state, checksum };
      }
      const cp = this.readCheckpoint();
      need(Boolean(cp && cp.sequence === seq && cp.checksum === head.checksum), "ESCROW_JOURNAL_CORRUPT");
      return { state: cp!.state, checksum: cp!.checksum };
    }
    const cp = this.readCheckpoint();
    let s = cp ? cp.state : initial(this.policy);
    let previous = cp ? cp.checksum : digest(["escrow-genesis/v1", s.policy]);
    let cursorSeq = cp ? cp.sequence : 0;
    while (true) {
      let pageCount = 0;
      for (const raw of this.storage.sql.exec<{sequence:number;record:string}>(
        "SELECT sequence, record FROM escrow_journal WHERE sequence > ? ORDER BY sequence LIMIT ?",
        cursorSeq,
        ESCROW_REPLAY_PAGE_SIZE,
      )) {
        pageCount++;
        cursorSeq = Number(raw.sequence);
        const row = JSON.parse(raw.record) as Entry;
        const { checksum, ...v } = row;
        need(
          row.sequence === s.sequence + 1 &&
          row.previous === previous &&
          checksum === digest(v) &&
          row.state.policy === this.policyHash,
          "ESCROW_JOURNAL_CORRUPT",
        );
        invariant(row.state);
        s = row.state;
        previous = checksum;
      }
      if (pageCount < ESCROW_REPLAY_PAGE_SIZE) break;
    }
    need(s.sequence === seq, "ESCROW_JOURNAL_CORRUPT");
    this.saveVerifiedHead(s.sequence, previous);
    if (!inTx && seq - this.readCheckpointSeq() > COMPACT_TRIGGER_ROWS) {
      this.storage.transactionSync(() => this.compactRowsLocked());
    }
    return { state: s, checksum: previous };
  }
  rows(): Entry[] { return this.storage.sql.exec<{record:string}>("SELECT record FROM escrow_journal ORDER BY sequence").toArray().map(r=>JSON.parse(r.record) as Entry); }
  load(): State {
    const seq = this.latestSeq();
    if(this.cached && this.cached.sequence === seq) return structuredClone(this.cached.state);
    const { state, checksum } = this.loadLatest(false);
    this.cached = { sequence: state.sequence, checksum, state: structuredClone(state) };
    return state;
  }
  append(event:string,payload:unknown,change:(s:State)=>void,onCommit?:()=>void): State {
    try {
      return this.storage.transactionSync(()=>{
        const seq = this.latestSeq();
        let s: State, prev: string;
        if(this.cached && this.cached.sequence === seq) {
          s = structuredClone(this.cached.state);
          prev = this.cached.checksum;
        } else {
          const loaded = this.loadLatest(true);
          s = loaded.state;
          prev = loaded.checksum;
        }
        // Compact retained rows BEFORE capacity checks so the rolling window never stalls.
        this.compactRowsLocked();
        const cpSeq = this.readCheckpointSeq();
        const e=nextEntry(s,prev,event,payload,change,this.policy,{checkpointSequence:cpSeq,hardLimit:COMPACTED_JOURNAL_LIMIT});
        this.storage.sql.exec("INSERT INTO escrow_journal(sequence,record) VALUES (?,?)",e.sequence,canonical(e));
        if(onCommit) onCommit();
        this.saveVerifiedHead(e.sequence, e.checksum);
        this.compactRowsLocked();
        this.cached = { sequence: e.sequence, checksum: e.checksum, state: structuredClone(e.state) };
        return e.state;
      });
    } catch (error) {
      this.cached = undefined;
      throw error;
    }
  }
}
export class Escrow {
  constructor(readonly journal: Journal, private network: Network, private signer: Signer,
    private titles: TitleStore, readonly policy: Policy, private now=()=>Date.now(), private enabled=()=>false,
    private crash: (point:string)=>void=()=>{}, private newNames: ()=>boolean=()=>false, private subnames: ()=>boolean=()=>false,
    private surplusStore?: SurplusStore) {
    need(journal.load().policy===digest(policy) && signer.address===policy.wallet,"ESCROW_POLICY_CHANGED");
  }
  private readSurplus(): SurplusWatermark | null {
    if (this.surplusStore) return this.surplusStore.read(this.policy.wallet);
    return defaultSurplusStores.get(this.journal)?.get(this.policy.wallet) ?? null;
  }
  private writeSurplus(mark: SurplusWatermark): void {
    if (this.surplusStore) { this.surplusStore.write(this.policy.wallet, mark); return; }
    let map = defaultSurplusStores.get(this.journal);
    if (!map) { map = new Map(); defaultSurplusStores.set(this.journal, map); }
    map.set(this.policy.wallet, mark);
  }
  /** Decrement the unexplained-surplus floor when a deposit that was already covered at or before prev.height is legitimately booked. */
  private acknowledgeSurplus(o: Observation, amountMicros: bigint, coveredAtHeight?: number): void {
    const prev = this.readSurplus();
    if (!prev) return;
    const prevAmt = BigInt(prev.unexplainedMicros);
    if (prevAmt <= 0n) return;
    const alreadyInPrev =
      (o.checkpoint !== null && o.checkpoint.height <= prev.height) ||
      (prev.cutoff !== undefined && o.body.ts < prev.cutoff) ||
      (coveredAtHeight !== undefined && coveredAtHeight <= prev.height);
    if (!alreadyInPrev) return;
    const nextAmt = prevAmt > amountMicros ? prevAmt - amountMicros : 0n;
    this.writeSurplus({ ...prev, unexplainedMicros: String(nextAmt), observedAt: this.now() });
  }
  private serial<T>(fn:()=>Promise<T>): Promise<T> {
    const prev=journalQueues.get(this.journal) ?? Promise.resolve();
    const result=prev.then(fn); journalQueues.set(this.journal,result.catch(()=>{})); return result;
  }
  private canAutoSettle(): boolean { return Boolean(this.titles.validateAutoSettle && this.titles.commitAutoSettle); }
  instantSettlement(): boolean { return this.canAutoSettle(); }
  state(): State { return this.journal.load(); }
  private journalWindow(s: State): { checkpointSequence: number; retained: number; admissionLimit: number; hardLimit: number; compacting: boolean } {
    const info = this.journal.capacityInfo?.();
    if (info) {
      return {
        checkpointSequence: info.checkpointSequence,
        retained: Math.max(0, s.sequence - info.checkpointSequence),
        admissionLimit: info.admissionLimit,
        hardLimit: info.hardLimit,
        compacting: info.compacting,
      };
    }
    return {
      checkpointSequence: 0,
      retained: s.sequence,
      admissionLimit: PILOT_ADMISSION_LIMIT,
      hardLimit: PILOT_JOURNAL_LIMIT,
      compacting: false,
    };
  }
  capacity(): EscrowCapacity {
    const s = this.state();
    const w = this.journalWindow(s);
    const reserve = Number(recoveryReserve(s, this.policy));
    const remainingForAdmission = Math.max(0, Math.min(w.admissionLimit - w.retained, w.hardLimit - w.retained - reserve));
    const remainingForWork = Math.max(0, Math.min(w.hardLimit - 32 - w.retained, w.hardLimit - w.retained - reserve));
    return {
      sequence: s.sequence,
      checkpointSequence: w.checkpointSequence,
      retainedRows: w.retained,
      reserve,
      admissionLimit: w.admissionLimit,
      hardLimit: w.hardLimit,
      remainingForAdmission,
      remainingForWork,
      admissionOpen: remainingForAdmission > 0,
      compacting: w.compacting,
      foldedTransactions: (s.folded?.creditedCount ?? 0) + (s.folded?.uncreditedCount ?? 0) + (s.folded?.paymentCount ?? 0),
    };
  }
  private setAvailable(s: State, actor: string, nextAmount: bigint): void {
    s.available[actor] = String(nextAmount);
  }
  private hasArchivedDepositConflict(id: string, body: Transfer, checkMemo: boolean): boolean {
    return this.journal.archive?.hasTxConflict(id, body.from, body.nonce, checkMemo ? body.memo : undefined) ?? false;
  }
  private hasArchivedRequest(rk: string): boolean {
    return Boolean(this.journal.archive?.getRequest(rk));
  }
  titleLocked(): boolean { return Object.values(this.state().auctions).some(a=>a.status==="OPEN"||a.status==="SETTLING"); }
  hasActiveWork(treasury: string): boolean {
    const s=this.state();
    if(s.paused||s.halt)return false;
    const nowMs=this.now(), auto=this.canAutoSettle();
    return Object.values(s.payments).some(p=>p.status!=="FINAL")||
      Object.values(s.settlements).some(st=>st.status!=="COMPLETE")||
      Object.values(s.auctions).some(a=>a.status==="OPEN"&&a.high!==null&&a.closes>0&&nowMs>=a.closes&&(auto||a.seller===treasury));
  }
  /**
   * Idempotently open first-bid POA auctions for Treasury-owned inventory in a single atomic
   * journal entry (zero POA moved, timer starts on first bid). Never re-lists previously seeded,
   * active, settled, or cancelled auctions and fails closed if escrow is disabled or halted.
   */
  seedInventoryAuctions(
    seller: string,
    items: readonly { name: string; reserve: string }[],
    seedTag = "treasury-inventory-auction-v1",
  ): string[] {
    need(this.enabled(), "ESCROW_DISABLED");
    address(seller);
    need(seller !== this.policy.wallet, "ESCROW_SELF_DEPOSIT");
    const tag = text(seedTag, 64);
    const s0 = this.state();
    if (s0.halt) return [];
    const eligible: { id: string; name: string; reserveMicros: string; window: number; quiet: number; deedId?: string; ownerVersion?: number }[] = [];
    const seenNames = new Set<string>();
    for (const item of items) {
      const name = text(item.name, 256);
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      const id = digest([tag, seller, name]);
      if (s0.auctions[id]) continue;
      if (Object.values(s0.auctions).some((a) => a.name === name && a.status !== "CANCELLED")) continue;
      if (Object.values(s0.subListings ?? {}).some((l) => l.parent === name && l.status === "OPEN")) continue;
      let terms: { reserve: string; window: number; quiet: number; deedId?: string; ownerVersion?: number };
      try { terms = this.titles.terms(name, seller); } catch { continue; }
      const rMicros = micros(item.reserve);
      if (rMicros < micros(terms.reserve) || rMicros > micros(this.policy.perTx)) continue;
      eligible.push({ id, name, reserveMicros: String(rMicros), window: terms.window, quiet: terms.quiet, deedId: terms.deedId, ownerVersion: terms.ownerVersion });
    }
    if (!eligible.length) return [];
    const now = this.now();
    const opened: string[] = [];
    const autoSettle = this.canAutoSettle();
    this.journal.append("open-inventory", { seller, count: eligible.length }, (s) => {
      need(this.enabled(), "ESCROW_DISABLED");
      need(!s.halt, "ESCROW_HALTED");
      const w = this.journalWindow(s);
      need(w.retained < w.admissionLimit, "ESCROW_JOURNAL_CAPACITY");
      for (const item of eligible) {
        if (s.auctions[item.id]) continue;
        if (Object.values(s.auctions).some((a) => a.name === item.name && a.status !== "CANCELLED")) continue;
        if (Object.values(s.subListings ?? {}).some((l) => l.parent === item.name && l.status === "OPEN")) continue;
        s.auctions[item.id] = {
          id: item.id,
          name: item.name,
          seller,
          reserve: item.reserveMicros,
          kind: "auction",
          createdAt: now,
          window: item.window,
          startedAt: null,
          ...(item.deedId ? { deedId: item.deedId } : {}),
          ...(item.ownerVersion !== undefined ? { ownerVersion: item.ownerVersion } : {}),
          ...(autoSettle ? { autoSettle: true } : {}),
          history: [{ event: "Auction queued; timer starts on first bid", at: now }],
          closes: 0,
          quiet: item.quiet,
          high: null,
          status: "OPEN",
        };
        opened.push(item.id);
      }
    });
    return opened;
  }
  private gate(): void { need(this.enabled(),"ESCROW_DISABLED"); const s=this.state(); need(!s.paused&&!pendingPauses.has(this.journal),"ESCROW_PAUSED"); need(!s.halt,"ESCROW_HALTED"); }
  pause(paused:boolean): Promise<void> {
    need(this.enabled(),"ESCROW_DISABLED"); need(typeof paused==="boolean","ESCROW_PAUSE");
    const prior=pendingPauses.get(this.journal),token=Symbol();
    if(paused)pendingPauses.set(this.journal,token);
    return this.serial(async()=>{
      need(this.enabled(),"ESCROW_DISABLED");
      if(this.state().paused!==paused)this.journal.append("pause",{paused},s=>{s.paused=paused;});
      // Never clear a newer pause request (including across Escrow instances).
      if(pendingPauses.get(this.journal)===(paused?token:prior))pendingPauses.delete(this.journal);
    });
  }
  private halt(code:string): void { if(this.state().halt!==code)this.journal.append("halt",{code},s=>{s.halt=code;}); }
  private publicFresh?: { until: number; value: DisplayReadiness };
  private publicInflight?: Promise<DisplayReadiness>;
  /** Display-only single flight. Its TTL starts at settlement, not request start.
   * Commands still call fresh() directly and never read either display field. */
  readiness(): Promise<DisplayReadiness> {
    if (this.publicInflight) return this.publicInflight;
    if (this.publicFresh && this.publicFresh.until > this.now()) return Promise.resolve(this.publicFresh.value);
    const started = this.now();
    const probe = async (): Promise<DisplayReadiness> => {
      try {
        const status = await (this.network.displayStatus?.() ?? this.network.status());
        this.verifyFresh(status);
        const checkedAt = this.now(), durationMs = Math.max(0, checkedAt - started);
        return { held: false, reason: null, asOf: status.asOf, code: null, checkedAt, durationMs,
          slow: durationMs >= 3000, timing: status.readTiming ?? null };
      } catch (error) {
        const checkedAt = this.now(), durationMs = Math.max(0, checkedAt - started), code = displayCode(error);
        return { held: true, reason: displayReason(code), asOf: null, code, checkedAt, durationMs,
          slow: durationMs >= 3000, timing: error instanceof DisplayReadError ? error.timing : null };
      }
    };
    this.publicInflight = probe().then(value => {
      // Never serve a successful display beyond the same financial age boundary.
      // Respect minepoa.com's 15s retry backoff on stale/HTTP holds; commands still call uncached fresh().
      const ttlMs = value.held && (value.code === "ESCROW_STALE" || value.code === "ESCROW_NODE_HTTP" || value.code === "ESCROW_PROTOCOL_CHANGED") ? 15000 : 10000;
      this.publicFresh = { until: Math.min(this.now() + ttlMs,
        value.asOf === null ? Infinity : value.asOf + this.policy.maxAgeMs), value };
      return value;
    }).finally(() => { this.publicInflight = undefined; });
    return this.publicInflight;
  }
  /** Read-only receipt preview: never credits funds or signs/sends a transaction. */
  async depositView(id: string, candidate?: string): Promise<unknown> {
    need(/^[0-9a-f]{64}$/.test(id),"ESCROW_DEPOSIT_INTENT");
    const s=this.state(),d=s.deposits[id];
    if(!d){
      const archived=this.journal.archive?.getDeposit(id);
      need(archived,"ESCROW_DEPOSIT_INTENT");
      return {intent:archived.intent,payer:archived.payer,to:this.policy.wallet,amount:archived.amount,memo:`poadomains:${archived.intent}`,status:"final",txid:archived.tx,createdAt:archived.createdAt,seenAt:null,finalAt:archived.finalAt};
    }
    let status="waiting",seenAt:number|null=null,mismatch:string|undefined;
    const tx=d.tx??candidate??null;
    if(d.tx) status="final";
    else if(tx){
      need(/^[0-9a-f]{64}$/.test(tx),"ESCROW_TXID");
      try { const o=await this.network.lookup(tx);
        if(o && o.id===tx && o.chain===CHAIN && o.valid===true){
          verifyTransfer(o.body);need(txid(o.body)===tx,"ESCROW_TX_BINDING");
          if(o.body.to!==this.policy.wallet){status="mismatch";mismatch="recipient";}
          else if(o.body.from!==d.payer){status="mismatch";mismatch="sender";}
          else if(o.body.amount!==d.amount){status="mismatch";mismatch="amount";}
          else if(o.body.memo!==`poadomains:${id}`){status="mismatch";mismatch="memo";}
          else{status="seen";seenAt=o.body.ts*1000;}
        }
      }catch { /* Unknown or invalid observations never imply a credit. */ }
    }
    return {intent:id,payer:d.payer,to:this.policy.wallet,amount:d.amount,memo:`poadomains:${id}`,status,txid:tx,createdAt:d.createdAt??null,seenAt,finalAt:d.tx?(s.credited[d.tx]?.ts??0)*1000:null,...(mismatch?{mismatch}:{})};
  }
  private async fresh(): Promise<Status> {
    let status:Status;
    try { status=await this.network.status(); }
    catch { throw new Error("ESCROW_NETWORK_HELD"); }
    return this.verifyFresh(status);
  }
  /** Classify raw transport/subrequest/parse errors from external node reads as retryable network holds
   * instead of unclassified storage failures that would abort the Durable Object. */
  private async networkRead<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (error) {
      if (error instanceof Fault || (error instanceof Error && /^ESCROW_[A-Z_]+$/.test(error.message))) throw error;
      throw new Error("ESCROW_NETWORK_HELD");
    }
  }
  private verifyFresh(status: Status): Status {
    need(status.chain===CHAIN,"ESCROW_CHAIN");
    need(status.stale===false && Number.isSafeInteger(status.asOf) && status.asOf<=this.now()+5000 && this.now()-status.asOf<=this.policy.maxAgeMs,"ESCROW_STALE");
    need(status.fee==="0.000000","ESCROW_FEE_POLICY"); integer(status.height); need(/^[0-9a-f]{64}$/.test(status.root),"ESCROW_CHECKPOINT");
    return status;
  }
  private final(o:Observation,id:string): void {
    need(o.id===id && o.chain===CHAIN && txid(o.body)===id,"ESCROW_TX_BINDING"); verifyTransfer(o.body);
    integer(o.attestations);
    need(o.valid===true && (o.attestations>=5 || (o.checkpoint?.anchored===true && o.checkpoint.quorum===5 &&
      Number.isSafeInteger(o.checkpoint.height) && /^[0-9a-f]{64}$/.test(o.checkpoint.root))),"ESCROW_NOT_FINAL");
  }
  /** No automatic reset of a mismatch halt: repair/review is separate from unpausing. */
  reconcile(): Promise<State> { return this.serial(async()=>{
    need(this.enabled(),"ESCROW_DISABLED"); const status=await this.fresh(); await this.reconcileAt(status); return this.state();
  }); }
  /** Credit any finalized incoming transfer that exactly matches an open deposit intent while escrow is open.
   * Never runs while paused or halted, never clears a halt, and never credits unsolicited or mismatched transfers. */
  private async sweepPendingDeposits(): Promise<void> {
    if(!this.network.incoming)return;
    const s0=this.state();
    if(!this.enabled()||s0.paused||pendingPauses.has(this.journal)||s0.halt)return;
    const open=Object.entries(s0.deposits).filter(([,d])=>!d.tx);
    if(!open.length)return;
    const byMemo=new Map(open.map(([intent,d])=>[`poadomains:${intent}`,{intent,d}]));
    let txids:string[];
    try { txids=await this.network.incoming(this.policy.wallet); }
    catch { return; }
    for(const id of txids) {
      const cur=this.state();
      if(!this.enabled()||cur.paused||pendingPauses.has(this.journal)||cur.halt)return;
      if(!/^[0-9a-f]{64}$/.test(id)||cur.credited[id]||cur.uncredited?.[id])continue;
      let o:Observation|null;
      try { o=await this.network.lookup(id); } catch { continue; }
      if(!o)continue;
      try { this.final(o,id); } catch { continue; }
      const match=byMemo.get(o.body.memo);
      if(!match)continue;
      const {intent,d}=match;
      if(o.body.to!==this.policy.wallet||o.body.from!==d.payer||o.body.amount!==d.amount)continue;
      if(cur.deposits[intent]?.tx)continue;
      const allCur=[...Object.values(cur.credited),...Object.values(cur.uncredited??{})];
      if(allCur.some(b=>b.from===o.body.from&&b.nonce===o.body.nonce)||Object.values(cur.credited).some(b=>b.memo===o.body.memo)||this.hasArchivedDepositConflict(id,o.body,true))continue;
      this.journal.append("deposit",{auto:true,intent,id},next=>{
        need(this.enabled(),"ESCROW_DISABLED");need(!next.paused,"ESCROW_PAUSED");need(!next.halt,"ESCROW_HALTED");
        const target=next.deposits[intent];
        need(!!target&&!target.tx&&!next.credited[id]&&!next.uncredited?.[id],"ESCROW_DEPOSIT_DUPLICATE");
        const allNext=[...Object.values(next.credited),...Object.values(next.uncredited??{})];
        need(!allNext.some(b=>b.from===o.body.from&&b.nonce===o.body.nonce)&&!Object.values(next.credited).some(b=>b.memo===o.body.memo)&&!this.hasArchivedDepositConflict(id,o.body,true),"ESCROW_DEPOSIT_DUPLICATE");
        target.tx=id;target.auto=true;next.credited[id]=o.body;
        next.assets=String(BigInt(next.assets)+micros(target.amount));
        next.available[target.payer]=String(BigInt(next.available[target.payer]??"0")+micros(target.amount));
      });
      this.acknowledgeSurplus(o,micros(d.amount));
      byMemo.delete(o.body.memo);
      if(!byMemo.size)break;
    }
  }
  private activePaymentTxids(s:State,status:Status): string[] {
    return Object.values(s.payments).flatMap(p=>{
      if(!p.txid)return [];
      // SIGNED payouts are provably pre-I/O (never transmitted); UNKNOWN payouts signed strictly
      // after this checkpoint's cutoff cannot be baked into checkpoint `status.height` and may
      // not yet be indexed by minepoa.com's read node (which returns 503 origin busy on misses).
      if(p.status==="SIGNED")return [];
      if(p.status==="UNKNOWN"&&status.cutoff!==undefined&&p.body&&p.body.ts>status.cutoff)return [];
      return [p.txid];
    });
  }
  private async reconcileAt(status:Status): Promise<void> {
    await this.sweepPendingDeposits();
    const s=this.state();
    const ids=[...Object.keys(s.credited),...Object.keys(s.uncredited??{}),...this.activePaymentTxids(s,status)];
    const cut=await this.networkRead(()=>this.network.cut(this.policy.wallet,ids,status));
    need(cut.chain===CHAIN && cut.height===status.height && cut.root===status.root,"ESCROW_UNALIGNED_CUT");
    if(s.folded)need(cut.height>=s.folded.height,"ESCROW_UNALIGNED_CUT");
    need(new Set(cut.covered).size===cut.covered.length && cut.covered.every(id=>ids.includes(id)),"ESCROW_CUT");
    let expected=s.folded?BigInt(s.folded.netMicros):0n;
    for(const [id,b] of Object.entries(s.credited)) if(cut.covered.includes(id)) expected+=micros(b.amount);
    for(const [id,b] of Object.entries(s.uncredited??{})) if(cut.covered.includes(id)) expected+=micros(b.amount);
    for(const p of Object.values(s.payments)) if(p.txid && cut.covered.includes(p.txid)) expected-=BigInt(p.amount);
    const observed=micros(cut.balance), unexplained=observed-expected;
    const prev=this.readSurplus(), prevFloor=prev?BigInt(prev.unexplainedMicros):0n;
    // Halt strictly on deficit OR any unexplained drop in previously observed surplus (prevents surplus masking theft/outflow).
    // New surplus (e.g., unsolicited dust or mistaken third-party deposits) is tracked outside the journal without halting escrow.
    if(unexplained<0n || (prev!==null && cut.height>=prev.height && unexplained<prevFloor)) {
      this.journal.append("reconciliation-quarantine",{height:cut.height,root:cut.root},s=>{
        s.halt="ASSET_LIABILITY_MISMATCH";s.quarantine[`${cut.height}:${cut.root}`]={observed:cut.balance,expectedMicros:String(expected)};
      });
      throw new Error("ESCROW_RECONCILIATION_MISMATCH");
    }
    if(unexplained>prevFloor){
      console.error(JSON.stringify({event:"escrow-unexplained-surplus",wallet:this.policy.wallet,height:cut.height,unexplainedMicros:String(unexplained),deltaMicros:String(unexplained-prevFloor)}));
    }
    if(!prev || cut.height>=prev.height){
      this.writeSurplus({height:cut.height,root:cut.root,unexplainedMicros:String(unexplained),...(status.cutoff!==undefined?{cutoff:status.cutoff}:{}),observedAt:this.now()});
    }
    invariant(s);
    if(!s.paused&&!s.halt&&this.journal.archive){
      this.foldCoveredHistory(cut,false);
    }
  }
  /** Fold checkpoint-covered finalized payments/deposits and old idempotency records out of live State
   * into indexed SQLite archive tables atomically so live State stays bounded well under DO SQLite's 2 MB row ceiling. */
  private foldCoveredHistory(cut: Cut, force = false): boolean {
    const archive = this.journal.archive;
    if (!archive) return false;
    const s0 = this.state();
    if (s0.paused || s0.halt) return false;
    const coveredSet = new Set(cut.covered);
    const today = new Date(this.now()).toISOString().slice(0, 10);

    // 1. Contiguous nonce prefix of covered FINAL payments (excluding active settlements and newest STATE_KEEP_PAYMENTS).
    const activeSettlementPayIds = new Set(
      Object.values(s0.settlements).filter(st => st.status !== "COMPLETE").flatMap(st => st.payments),
    );
    const allWithBody = Object.values(s0.payments).filter(p => Boolean(p.body));
    const minNonFinalNonce = allWithBody
      .filter(p => p.status !== "FINAL")
      .reduce((min, p) => Math.min(min, p.body!.nonce), Infinity);
    const finalPayments = allWithBody
      .filter(p => p.status === "FINAL" && Boolean(p.txid))
      .sort((a, b) => a.body!.nonce - b.body!.nonce);
    const maxFoldablePayCount = Math.max(0, finalPayments.length - (force ? 1 : STATE_KEEP_PAYMENTS));
    const foldPayments: Payment[] = [];
    for (let i = 0; i < maxFoldablePayCount; i++) {
      const p = finalPayments[i]!;
      if (p.body!.nonce >= minNonFinalNonce) break;
      if (!coveredSet.has(p.txid!) || activeSettlementPayIds.has(p.id)) break;
      foldPayments.push(p);
    }

    // 2. Covered credited deposits beyond newest STATE_KEEP_DEPOSITS.
    const creditedDeposits = Object.entries(s0.deposits)
      .filter(([, d]) => Boolean(d.tx && s0.credited[d.tx]));
    const maxFoldableDepCount = Math.max(0, creditedDeposits.length - (force ? 0 : STATE_KEEP_DEPOSITS));
    const foldDeposits: { intent: string; dep: Deposit; body: Transfer }[] = [];
    for (let i = 0; i < maxFoldableDepCount; i++) {
      const [intent, dep] = creditedDeposits[i]!;
      if (dep.tx && coveredSet.has(dep.tx) && s0.credited[dep.tx]) {
        foldDeposits.push({ intent, dep, body: s0.credited[dep.tx]! });
      }
    }

    // 3. Old idempotency requests beyond newest STATE_KEEP_REQUESTS.
    const reqKeys = Object.keys(s0.requests);
    const keepReqs = force ? 0 : STATE_KEEP_REQUESTS;
    const foldReqKeys = reqKeys.length > keepReqs ? reqKeys.slice(0, reqKeys.length - keepReqs) : [];

    // 4. Stale COMPLETE settlement packets and terminal auctions beyond STATE_KEEP_TERMINAL_AUCTIONS.
    const stripPackets = Object.values(s0.settlements).some(st => st.status === "COMPLETE" && st.packet !== null);
    const terminalAuctions = Object.values(s0.auctions).filter(a => a.status === "COMPLETE" || a.status === "CANCELLED");
    const pruneAuctionIds = terminalAuctions.length > STATE_KEEP_TERMINAL_AUCTIONS
      ? terminalAuctions.slice(0, terminalAuctions.length - STATE_KEEP_TERMINAL_AUCTIONS).map(a => a.id)
      : [];
    const zeroAvailableKeys = Object.entries(s0.available).filter(([, v]) => v === "0").map(([k]) => k);

    const hasMeaningfulWork = force
      ? (foldPayments.length > 0 || foldDeposits.length > 0 || foldReqKeys.length > 0 || stripPackets || pruneAuctionIds.length > 0 || zeroAvailableKeys.length > 0)
      : (foldPayments.length >= FOLD_MIN_ITEMS || foldDeposits.length >= FOLD_MIN_ITEMS || foldReqKeys.length >= FOLD_MIN_REQUESTS || pruneAuctionIds.length > 0 || stripPackets);
    if (!hasMeaningfulWork) return false;

    const batch: EscrowArchivedData = {
      requests: foldReqKeys.map(rk => ({ rk, fingerprint: s0.requests[rk]!.fingerprint, result: s0.requests[rk]!.result })),
      txs: [
        ...foldDeposits.map(({ dep, body }) => ({
          txid: dep.tx!,
          kind: "credited" as const,
          senderNonce: `${body.from}:${body.nonce}`,
          memo: body.memo,
          amount: String(micros(body.amount)),
          height: cut.height,
        })),
        ...foldPayments.map(p => ({
          txid: p.txid!,
          kind: "payment" as const,
          senderNonce: `${p.body!.from}:${p.body!.nonce}`,
          memo: p.body!.memo,
          amount: p.amount,
          height: cut.height,
        })),
      ],
      deposits: foldDeposits.map(({ intent, dep, body }) => ({
        intent,
        payer: dep.payer,
        amount: dep.amount,
        tx: dep.tx!,
        createdAt: dep.createdAt ?? null,
        finalAt: body.ts > 0 ? body.ts * 1000 : null,
      })),
      refunds: foldPayments
        .filter(p => p.kind === "refund")
        .map(p => ({
          id: p.id,
          payer: p.to,
          amount: p.amount,
          status: p.status,
          txid: p.txid,
          day: p.day,
          seq: p.body!.nonce,
        })),
    };

    const payIds = new Set(foldPayments.map(p => p.id));
    const depIntents = new Set(foldDeposits.map(d => d.intent));
    const depTxids = new Set(foldDeposits.map(d => d.dep.tx!));
    const reqSet = new Set(foldReqKeys);
    const pruneAucSet = new Set(pruneAuctionIds);

    this.journal.append(
      "compact-state",
      { height: cut.height, foldedPayments: foldPayments.length, foldedDeposits: foldDeposits.length, archivedRequests: foldReqKeys.length, prunedAuctions: pruneAuctionIds.length },
      (next) => {
        need(!next.paused, "ESCROW_PAUSED");
        need(!next.halt, "ESCROW_HALTED");
        let delta = 0n;
        let maxOutNonce = next.folded?.maxOutNonce ?? 0;
        let dayUsed = next.folded?.day === today ? BigInt(next.folded.dayUsedMicros ?? "0") : 0n;
        let payFolded = 0, depFolded = 0;

        for (const id of payIds) {
          const p = next.payments[id];
          if (!p || p.status !== "FINAL" || !p.body) continue;
          delta -= BigInt(p.amount);
          if (p.body.nonce > maxOutNonce) maxOutNonce = p.body.nonce;
          if (p.day === today) dayUsed += BigInt(p.amount);
          delete next.payments[id];
          payFolded++;
        }
        for (const intent of depIntents) {
          const d = next.deposits[intent];
          if (!d || !d.tx || !depTxids.has(d.tx)) continue;
          const b = next.credited[d.tx];
          if (!b) continue;
          delta += micros(b.amount);
          delete next.credited[d.tx];
          delete next.deposits[intent];
          depFolded++;
        }
        for (const rk of reqSet) delete next.requests[rk];
        for (const st of Object.values(next.settlements)) {
          if (st.status === "COMPLETE") st.packet = null;
        }
        for (const aid of pruneAucSet) {
          delete next.auctions[aid];
          if (next.settlements[aid]?.status === "COMPLETE") delete next.settlements[aid];
        }
        for (const k of zeroAvailableKeys) {
          if (next.available[k] === "0") delete next.available[k];
        }
        if (payFolded > 0 || depFolded > 0 || next.folded) {
          const prev = next.folded;
          next.folded = {
            height: Math.max(prev?.height ?? 0, cut.height),
            netMicros: String((prev ? BigInt(prev.netMicros) : 0n) + delta),
            maxOutNonce,
            creditedCount: (prev?.creditedCount ?? 0) + depFolded,
            uncreditedCount: prev?.uncreditedCount ?? 0,
            paymentCount: (prev?.paymentCount ?? 0) + payFolded,
            ...(dayUsed > 0n ? { day: today, dayUsedMicros: String(dayUsed) } : {}),
          };
        }
      },
      () => {
        archive.writeBatch(batch);
      },
    );
    return true;
  }
  /** Explicitly fold checkpoint-covered history right after a verified reconciliation cut (primarily for maintenance/tests). */
  compactState(): Promise<boolean> {
    return this.serial(async () => {
      this.gate();
      const status = await this.fresh();
      this.gate();
      await this.reconcileAt(status);
      const s = this.state();
      const ids = [...Object.keys(s.credited), ...Object.keys(s.uncredited ?? {}), ...this.activePaymentTxids(s, status)];
      const cut = await this.networkRead(() => this.network.cut(this.policy.wallet, ids, status));
      need(cut.chain === CHAIN && cut.height === status.height && cut.root === status.root, "ESCROW_UNALIGNED_CUT");
      return this.foldCoveredHistory(cut, true);
    });
  }
  /** Owner-reviewed one-shot credit, then clear the matching halt only if the wallet now reconciles exactly.
   * Fails closed (no journal write) on any mismatch: halt code, intent, txid, sender, amount, memo,
   * finality, cut alignment or balance. Pause state is never changed. */
  creditReviewed(r: ReviewedCredit): Promise<State> { return this.serial(async()=>{
    need(this.enabled(),"ESCROW_DISABLED");
    exact(r,["id","txid","from","amount","intent","halt"]); text(r.id,80);
    need(/^[0-9a-f]{64}$/.test(r.txid) && /^[0-9a-f]{64}$/.test(r.intent) && micros(r.amount)>0n && /^[A-Z_]+$/.test(r.halt),"ESCROW_REVIEW");
    need(address(r.from)!==this.policy.wallet,"ESCROW_SELF_DEPOSIT");
    const check=(s:State)=>{
      need(!s.reviews?.[r.id],"ESCROW_REVIEW_USED");
      need(s.halt===r.halt,"ESCROW_REVIEW_STATE");
      const dep=s.deposits[r.intent];
      need(!!dep && dep.payer===r.from && dep.amount===r.amount && !dep.tx,"ESCROW_REVIEW_INTENT");
      need(!s.credited[r.txid] && !s.uncredited?.[r.txid],"ESCROW_DEPOSIT_DUPLICATE");
    };
    check(this.state());
    const status=await this.fresh();
    const o=await this.networkRead(()=>this.network.lookup(r.txid)); need(o,"ESCROW_UNKNOWN_DEPOSIT"); this.final(o,r.txid);
    need(o.body.to===this.policy.wallet && o.body.from===r.from && o.body.amount===r.amount && o.body.memo===`poadomains:${r.intent}`,"ESCROW_DEPOSIT_BINDING");
    const s=this.state(); check(s);
    const allIn=[...Object.values(s.credited),...Object.values(s.uncredited??{})];
    need(!allIn.some(b=>b.from===o.body.from&&b.nonce===o.body.nonce)&&!Object.values(s.credited).some(b=>b.memo===o.body.memo)&&!this.hasArchivedDepositConflict(r.txid,o.body,true),"ESCROW_DEPOSIT_DUPLICATE");
    // Reconcile as if this one deposit were credited. Anything else unexplained keeps the halt.
    const ids=[...Object.keys(s.credited),...Object.keys(s.uncredited??{}),r.txid,...Object.values(s.payments).flatMap(p=>p.txid?[p.txid]:[])];
    const cut=await this.networkRead(()=>this.network.cut(this.policy.wallet,ids,status));
    need(cut.chain===CHAIN && cut.height===status.height && cut.root===status.root,"ESCROW_UNALIGNED_CUT");
    if(s.folded)need(cut.height>=s.folded.height,"ESCROW_UNALIGNED_CUT");
    need(new Set(cut.covered).size===cut.covered.length && cut.covered.every(id=>ids.includes(id)) && cut.covered.includes(r.txid),"ESCROW_CUT");
    let expected=(s.folded?BigInt(s.folded.netMicros):0n)+micros(r.amount);
    for(const [id,b] of Object.entries(s.credited)) if(cut.covered.includes(id)) expected+=micros(b.amount);
    for(const [id,b] of Object.entries(s.uncredited??{})) if(cut.covered.includes(id)) expected+=micros(b.amount);
    for(const p of Object.values(s.payments)) if(p.txid && cut.covered.includes(p.txid)) expected-=BigInt(p.amount);
    need(expected===micros(cut.balance),"ESCROW_RECONCILIATION_MISMATCH");
    this.journal.append("reviewed-credit",{review:r.id,txid:r.txid,intent:r.intent,height:cut.height,root:cut.root,observed:cut.balance},next=>{
      need(this.enabled(),"ESCROW_DISABLED"); check(next);
      const d=next.deposits[r.intent]!; d.tx=r.txid; next.credited[r.txid]=o.body;
      next.assets=String(BigInt(next.assets)+micros(r.amount));
      next.available[r.from]=String(BigInt(next.available[r.from]??"0")+micros(r.amount));
      (next.reviews??={})[r.id]={txid:r.txid,intent:r.intent,height:cut.height,root:cut.root,observed:cut.balance,at:this.now()};
      next.halt=null;
    });
    this.writeSurplus({height:cut.height,root:cut.root,unexplainedMicros:"0",...(status.cutoff!==undefined?{cutoff:status.cutoff}:{}),observedAt:this.now()});
    return this.state();
  }); }
  /** Operator bounce-back for a finalized uncredited/mismatched incoming transfer.
   * Strictly sender-bound: takes only txid (never destination or amount); returns funds solely to o.body.from
   * through the Worker's managed nonce lane, never credits spendable escrow balance, and clears
   * ASSET_LIABILITY_MISMATCH only if this transfer is covered and post-admission reconciliation succeeds. */
  refundUncredited(id: string): Promise<State> { return this.serial(async()=>{
    need(this.enabled(),"ESCROW_DISABLED");
    const tx=text(id,64); need(/^[0-9a-f]{64}$/.test(tx),"ESCROW_TXID");
    const checkState=(s:State)=>{
      need(s.halt===null || s.halt==="ASSET_LIABILITY_MISMATCH","ESCROW_HALTED");
      need(!s.credited[tx] && !s.uncredited?.[tx],"ESCROW_DEPOSIT_DUPLICATE");
    };
    checkState(this.state());
    const status=await this.fresh();
    const o=await this.networkRead(()=>this.network.lookup(tx)); need(o,"ESCROW_UNKNOWN_DEPOSIT"); this.final(o,tx);
    need(o.body.to===this.policy.wallet,"ESCROW_DEPOSIT_BINDING");
    need(o.body.from!==this.policy.wallet,"ESCROW_SELF_DEPOSIT");
    const total=micros(o.body.amount), cap=micros(this.policy.perTx);
    const chunks:bigint[]=[];
    for(let rem=total;rem>0n;){const part=rem>cap?cap:rem;chunks.push(part);rem-=part;}
    const checkWithBody=(s:State)=>{
      checkState(s);
      const matchesOpen=Object.entries(s.deposits).some(([intent,d])=>!d.tx && d.payer===o.body.from && d.amount===o.body.amount && o.body.memo===`poadomains:${intent}`);
      need(!matchesOpen,"ESCROW_DEPOSIT_MATCHES_INTENT");
      const allIn=[...Object.values(s.credited),...Object.values(s.uncredited??{})];
      need(!allIn.some(b=>b.from===o.body.from&&b.nonce===o.body.nonce)&&!this.hasArchivedDepositConflict(tx,o.body,false),"ESCROW_DEPOSIT_DUPLICATE");
      for(let i=0;i<chunks.length;i++){
        const pid=chunks.length===1?`bounce-${tx}`:`bounce-${tx}-${i}`;
        need(!s.payments[pid],"ESCROW_REFUND_DUPLICATE");
      }
    };
    const s=this.state(); checkWithBody(s);
    const ids=[...Object.keys(s.credited),...Object.keys(s.uncredited??{}),tx,...this.activePaymentTxids(s,status)];
    const cut=await this.networkRead(()=>this.network.cut(this.policy.wallet,ids,status));
    need(cut.chain===CHAIN && cut.height===status.height && cut.root===status.root,"ESCROW_UNALIGNED_CUT");
    if(s.folded)need(cut.height>=s.folded.height,"ESCROW_UNALIGNED_CUT");
    need(new Set(cut.covered).size===cut.covered.length && cut.covered.every(x=>ids.includes(x)),"ESCROW_CUT");
    const txCovered=cut.covered.includes(tx);
    let expected=(s.folded?BigInt(s.folded.netMicros):0n)+(txCovered?total:0n);
    for(const [cid,b] of Object.entries(s.credited)) if(cut.covered.includes(cid)) expected+=micros(b.amount);
    for(const [uid,b] of Object.entries(s.uncredited??{})) if(cut.covered.includes(uid)) expected+=micros(b.amount);
    for(const p of Object.values(s.payments)) if(p.txid && cut.covered.includes(p.txid)) expected-=BigInt(p.amount);
    const observed=micros(cut.balance), unexplained=observed-expected;
    need(unexplained>=0n,"ESCROW_RECONCILIATION_MISMATCH");
    const prev=this.readSurplus();
    if(prev!==null && cut.height>=prev.height){
      const wasInPrev=txCovered && ((o.checkpoint!==null && o.checkpoint.height<=prev.height) || (prev.cutoff!==undefined && o.body.ts<prev.cutoff) || cut.height===prev.height);
      const prevAmt=BigInt(prev.unexplainedMicros);
      const floor=wasInPrev?(prevAmt>total?prevAmt-total:0n):prevAmt;
      need(unexplained>=floor,"ESCROW_RECONCILIATION_MISMATCH");
    }
    this.journal.append("uncredited-refund",{txid:tx,from:o.body.from,amount:o.body.amount,chunks:chunks.length,covered:txCovered,height:cut.height,root:cut.root},next=>{
      need(this.enabled(),"ESCROW_DISABLED"); checkWithBody(next);
      (next.uncredited??={})[tx]=o.body;
      next.assets=String(BigInt(next.assets)+total);
      for(let i=0;i<chunks.length;i++){
        const pid=chunks.length===1?`bounce-${tx}`:`bounce-${tx}-${i}`;
        this.refund(next,pid,o.body.from,String(chunks[i]!));
      }
      if(next.halt==="ASSET_LIABILITY_MISMATCH" && txCovered) next.halt=null;
    });
    if(!prev || cut.height>=prev.height){
      this.writeSurplus({height:cut.height,root:cut.root,unexplainedMicros:String(unexplained),...(status.cutoff!==undefined?{cutoff:status.cutoff}:{}),observedAt:this.now()});
    }
    return this.state();
  }); }
  /** Read-only operator inspection of recent incoming wallet transfers not yet booked in s.credited or s.uncredited. */
  async uncreditedIncoming(): Promise<unknown> {
    need(this.enabled(),"ESCROW_DISABLED");
    const s=this.state();
    let txids:string[]=[];
    if(this.network.incoming){
      try{ txids=await this.network.incoming(this.policy.wallet); }
      catch{ txids=[]; }
    }
    const candidates=txids.filter(id=>/^[0-9a-f]{64}$/.test(id) && !s.credited[id] && !s.uncredited?.[id]).slice(0,25);
    const incoming:unknown[]=[];
    for(const id of candidates){
      let o:Observation|null=null;
      try{ o=await this.network.lookup(id); }catch{ continue; }
      if(!o || o.body.to!==this.policy.wallet) continue;
      if(this.hasArchivedDepositConflict(id,o.body,false)) continue;
      let isFinal=false;
      try{ this.final(o,id); isFinal=true; }catch{}
      let reason="no_intent", intentId:string|null=null;
      const m=/^poadomains:([0-9a-f]{64})$/.exec(o.body.memo);
      if(m){
        intentId=m[1]!;
        const d=s.deposits[intentId];
        if(d){
          if(d.tx) reason="intent_already_used";
          else if(o.body.from!==d.payer) reason="wrong_sender";
          else if(o.body.amount!==d.amount) reason="wrong_amount";
          else reason="matches_open_intent";
        }
      }
      incoming.push({txid:id,from:o.body.from,amount:o.body.amount,memo:o.body.memo,ts:o.body.ts,valid:o.valid,final:isFinal,attestations:o.attestations,checkpointed:Boolean(o.checkpoint),intent:intentId,reason});
    }
    return {
      wallet:this.policy.wallet,
      halt:s.halt,
      paused:s.paused,
      surplus:this.readSurplus(),
      trackedUncredited:Object.keys(s.uncredited??{}),
      incoming,
    };
  }
  private validateCommand(c:Command): void {
    const p=obj(c.params);
    switch(c.action){
      case "intent": case "withdraw": exact(p,["amount"]); need(micros(p.amount)>0n,"ESCROW_AMOUNT"); break;
      case "detect": exact(p,["intent","txid"]); text(p.intent,80); need(/^[0-9a-f]{64}$/.test(text(p.txid,64)),"ESCROW_TXID"); break;
      case "list": exact(p,["name","price"]); text(p.name,256); need(micros(p.price)>0n && micros(p.price)<=micros(this.policy.perTx),"ESCROW_AMOUNT"); break;
      case "open": exact(p,["name","reserve"]); text(p.name,256); need(micros(p.reserve)>0n,"ESCROW_RESERVE"); break;
      case "buy": case "bid": exact(p,["auction","amount"]); text(p.auction,64); need(micros(p.amount)>0n,"ESCROW_AMOUNT"); break;
      case "cancel": case "expire": exact(p,["auction"]); text(p.auction,64); break;
      case "issue": {
        need(this.newNames(),"ESCROW_NEW_NAMES_OFF");
        exact(p,["name","amount","registration"]); text(p.name,256);
        need(micros(p.amount)>0n && micros(p.amount)<=micros(this.policy.perTx),"ESCROW_AMOUNT");
        const packet=authenticate(p.registration), nowSec=Math.floor(this.now()/1000);
        need(integer(packet.body.notBefore)<=nowSec && integer(packet.body.deadline)>=nowSec+600,"ESCROW_CONSENT_EXPIRING");
        break;
      }
      case "list-sub": {
        need(this.subnames(),"ESCROW_SUBNAMES_OFF");
        exact(p,["parent","price"]); text(p.parent,256); need(micros(p.price)>0n && micros(p.price)<=micros(this.policy.perTx),"ESCROW_AMOUNT"); break;
      }
      case "cancel-sub": exact(p,["listing"]); text(p.listing,64); break;
      case "buy-sub": {
        need(this.subnames(),"ESCROW_SUBNAMES_OFF");
        exact(p,["listing","name","amount","registration"]); text(p.listing,64); text(p.name,256);
        need(micros(p.amount)>0n && micros(p.amount)<=micros(this.policy.perTx),"ESCROW_AMOUNT");
        const packet=authenticate(p.registration), nowSec=Math.floor(this.now()/1000);
        need(integer(packet.body.notBefore)<=nowSec && integer(packet.body.deadline)>=nowSec+600,"ESCROW_CONSENT_EXPIRING");
        break;
      }
      case "settle": case "repair-title": {
        exact(p,["auction","transfer"]); text(p.auction,64);
        const packet=authenticate(p.transfer), nowSec=Math.floor(this.now()/1000);
        need(integer(packet.body.notBefore)<=nowSec && integer(packet.body.deadline)>=nowSec+600,"ESCROW_CONSENT_EXPIRING");
        break;
      }
      default: need(false,"ESCROW_ACTION");
    }
  }
  command(c:Command): Promise<unknown> { return this.serial(async()=>{
    need(this.enabled(),"ESCROW_DISABLED");
    need(address(c.actor)!==this.policy.wallet,"ESCROW_SELF_DEPOSIT");
    const rk=c.actor+":"+c.key, fingerprint=digest(c), old=this.state().requests[rk]??this.journal.archive?.getRequest(rk);
    if(old) {need(old.fingerprint===fingerprint,"ESCROW_IDEMPOTENCY_CONFLICT"); return structuredClone(old.result);}
    this.validateCommand(c);
    // Cancel/expiry only reclassify obligations; no money leaves during pause/holds.
    const local=c.action==="cancel"||c.action==="expire"||c.action==="cancel-sub";
    let status:Status|undefined;
    if(!local) { this.gate(); status=await this.fresh(); this.gate(); }
    const p=c.params; let result:unknown={ok:true};
    if(c.action==="detect") {
      exact(p,["intent","txid"]); const id=text(p.txid,64); need(/^[0-9a-f]{64}$/.test(id),"ESCROW_TXID");
      const s=this.state(),dep=s.deposits[text(p.intent,80)]; need(dep && dep.payer===c.actor,"ESCROW_DEPOSIT_INTENT");
      if(dep.tx===id && dep.auto===true && s.credited[id]) return {ok:true,alreadyCredited:true};
      need(!dep.tx && !s.credited[id] && !s.uncredited?.[id],"ESCROW_DEPOSIT_DUPLICATE");
      const o=await this.networkRead(()=>this.network.lookup(id)); need(o,"ESCROW_UNKNOWN_DEPOSIT"); this.final(o,id);
      need(o.body.to===this.policy.wallet && o.body.from===dep.payer && o.body.amount===dep.amount && o.body.memo===`poadomains:${p.intent}`,"ESCROW_DEPOSIT_BINDING");
      const allS=[...Object.values(s.credited),...Object.values(s.uncredited??{})];
      need(!allS.some(b=>b.from===o.body.from&&b.nonce===o.body.nonce)&&!Object.values(s.credited).some(b=>b.memo===o.body.memo)&&!this.hasArchivedDepositConflict(id,o.body,true),"ESCROW_DEPOSIT_DUPLICATE");
      this.gate(); await this.fresh(); this.gate();
      this.journal.append("deposit",{rk,fingerprint,id},s=>{
        need(this.enabled(),"ESCROW_DISABLED"); need(!s.paused,"ESCROW_PAUSED"); need(!s.halt,"ESCROW_HALTED");
        need(!s.requests[rk]&&!this.hasArchivedRequest(rk),"ESCROW_IDEMPOTENCY_CONFLICT");
        need(!s.credited[id] && !s.uncredited?.[id] && !s.deposits[String(p.intent)]!.tx,"ESCROW_DEPOSIT_DUPLICATE");
        const allNext=[...Object.values(s.credited),...Object.values(s.uncredited??{})];
        need(!allNext.some(b=>b.from===o.body.from&&b.nonce===o.body.nonce)&&!Object.values(s.credited).some(b=>b.memo===o.body.memo)&&!this.hasArchivedDepositConflict(id,o.body,true),"ESCROW_DEPOSIT_DUPLICATE");
        const d=s.deposits[String(p.intent)]!; d.tx=id;s.credited[id]=o.body;s.assets=String(BigInt(s.assets)+micros(d.amount));
        s.available[c.actor]=String(BigInt(s.available[c.actor]??"0")+micros(d.amount));
        s.requests[rk]={fingerprint,result};
      });
      this.acknowledgeSurplus(o,micros(dep.amount));
      return result;
    }
    if(!local) { await this.reconcileAt(status!); this.gate(); }
    this.journal.append(c.action,{rk,fingerprint,params:p},s=>{
      need(this.enabled(),"ESCROW_DISABLED");
      if(!local) { need(!s.paused,"ESCROW_PAUSED"); need(!s.halt,"ESCROW_HALTED"); }
      need(!s.requests[rk]&&!this.hasArchivedRequest(rk),"ESCROW_IDEMPOTENCY_CONFLICT");
      const w=this.journalWindow(s);
      switch(c.action) {
        case "intent": {
          need(w.retained<w.admissionLimit,"ESCROW_JOURNAL_CAPACITY");
          exact(p,["amount"]); need(micros(p.amount)>0n,"ESCROW_AMOUNT");
          const id=digest([rk,c]); s.deposits[id]={payer:c.actor,amount:String(p.amount),tx:null,createdAt:this.now()}; result={intent:id,memo:`poadomains:${id}`,to:this.policy.wallet,payer:c.actor}; break;
        }
        case "list": case "open": {
          need(w.retained<w.admissionLimit,"ESCROW_JOURNAL_CAPACITY");
          const fixed=c.action==="list";exact(p,fixed?["name","price"]:["name","reserve"]); const reserve=String(fixed?p.price:p.reserve);const name=text(p.name,256), terms=this.titles.terms(name,c.actor);
          need(micros(reserve)>=micros(terms.reserve) && micros(reserve)<=micros(this.policy.perTx),"ESCROW_RESERVE");
          need(!Object.values(s.auctions).some(a=>a.name===name&&(a.status==="OPEN"||a.status==="SETTLING")),"ESCROW_TITLE_RESERVED");
          need(!Object.values(s.subListings??{}).some(l=>l.parent===name&&l.status==="OPEN"),"ESCROW_ENCUMBERED_TITLE");
          const id=digest([rk,c]), pin={...(terms.deedId?{deedId:terms.deedId}:{}),...(terms.ownerVersion!==undefined?{ownerVersion:terms.ownerVersion}:{}),...(this.canAutoSettle()?{autoSettle:true}:{})};
          s.auctions[id]=fixed
            ? {id,name,seller:c.actor,reserve:String(micros(reserve)),kind:"fixed",createdAt:this.now(),...pin,history:[{event:"Listed for POA",at:this.now()}],
              closes:0,quiet:terms.quiet,high:null,status:"OPEN"}
            : {id,name,seller:c.actor,reserve:String(micros(reserve)),kind:"auction",createdAt:this.now(),window:terms.window,startedAt:null,...pin,
              history:[{event:"Auction queued; timer starts on first bid",at:this.now()}],
              closes:0,quiet:terms.quiet,high:null,status:"OPEN"};
          result={auction:id};break;
        }
        case "buy": case "bid": {
          need(w.retained<w.hardLimit-32,"ESCROW_JOURNAL_CAPACITY");
          exact(p,["auction","amount"]);const a=s.auctions[text(p.auction,64)];
          const awaitingFirstBid=Boolean(a&&a.kind!=="fixed"&&a.closes===0&&a.high===null);
          const openFixed=Boolean(a&&a.kind==="fixed"&&a.high===null);
          need(a&&a.status==="OPEN"&&(openFixed||awaitingFirstBid||this.now()<a.closes),"ESCROW_AUCTION_CLOSED");
          need(c.action==="buy"?a.kind==="fixed"&&a.high===null:a.kind!=="fixed","ESCROW_MARKET_KIND");
          const n=micros(p.amount);if(c.action==="buy")need(n===BigInt(a.reserve),"ESCROW_PRICE");need(n<=micros(this.policy.perTx),"ESCROW_PAYOUT_LIMIT");need(c.actor!==a.seller,"ESCROW_SELF_SALE");need(a.high?.payer!==c.actor,"ESCROW_SELF_RAISE");
          // Existing strict >10% rule, in integer micros (not rounded decimal floats).
          need(n>=BigInt(a.reserve)&&(!a.high||n*10n>BigInt(a.high.amount)*11n),"ESCROW_BID_INCREMENT");
          const bidderAvail=BigInt(s.available[c.actor]??"0");
          need(bidderAvail>=n,"ESCROW_INSUFFICIENT_FUNDS");
          const autoFixed=c.action==="buy"&&this.canAutoSettle();
          if(autoFixed)this.titles.validateAutoSettle!(a.name,a.seller,c.actor,a.id,String(n),a.deedId,a.ownerVersion);
          const prevHigh=a.high;
          // Debit new high bidder first, then credit displaced bidder back to available escrow balance
          // for instant re-bidding or signed withdrawal back to their original wallet (never redirected).
          this.setAvailable(s,c.actor,bidderAvail-n);
          if(prevHigh){
            need(prevHigh.payer!==c.actor,"ESCROW_SELF_RAISE");
            s.available[prevHigh.payer]=String(BigInt(s.available[prevHigh.payer]??"0")+BigInt(prevHigh.amount));
          }
          a.high={payer:c.actor,amount:String(n)};
          const now=this.now();
          if(c.action==="buy"){
            a.closes=now;
            if(autoFixed){
              const fee=a.seller===this.policy.treasury?0n:n*BigInt(this.policy.feeBps)/10000n;
              const net=n-fee;
              const payments:string[]=[];
              for(const [kind,to,v] of [["seller",a.seller,net],["fee",this.policy.treasury,fee]] as const) if(v>0n){
                const pid=`${kind}-${a.id}`;need(!s.payments[pid],"ESCROW_DUPLICATE");
                s.payments[pid]={id:pid,kind,to,amount:String(v),status:"READY",day:null,body:null,txid:null};payments.push(pid);
              }
              a.status="SETTLING";a.autoSettle=true;
              s.settlements[a.id]={auction:a.id,packet:null,auto:true,payments,status:"PAYING"};
              (a.history??=[]).push({event:"Purchase paid; automatic settlement queued",at:now,amount:String(n),payer:c.actor});
            } else {
              (a.history??=[]).push({event:"Purchase reserved; seller handover needed",at:now,amount:String(n),payer:c.actor});
            }
          } else if(!prevHigh){
            a.startedAt=now;
            let effWindow=a.window??a.quiet,effQuiet=a.quiet;
            if(awaitingFirstBid){
              try{
                const freshTerms=this.titles.terms(a.name,a.seller);
                if(freshTerms.window>effWindow)effWindow=freshTerms.window;
                if(freshTerms.quiet>effQuiet)effQuiet=freshTerms.quiet;
                a.window=effWindow;a.quiet=effQuiet;
              }catch{/* keep recorded auction terms if mocked title store rejects */}
            }
            a.closes=awaitingFirstBid?now+effWindow:Math.max(a.closes,now+effQuiet);
            (a.history??=[]).push({event:"Auction started (first bid)",at:now,amount:String(n),payer:c.actor});
          } else {
            a.closes=Math.max(a.closes,now+a.quiet);
            (a.history??=[]).push({event:"Bid placed",at:now,amount:String(n),payer:c.actor});
          }
          a.history=a.history!.slice(-100);break;
        }
        case "cancel": case "expire": {
          exact(p,["auction"]);const a=s.auctions[text(p.auction,64)];need(a&&a.status==="OPEN","ESCROW_AUCTION_CLOSED");
          const unboughtFixed=a.kind==="fixed"&&a.high===null;
          const sellerBusy=a.high!==null&&Object.values(s.auctions).some(other=>other.status==="SETTLING"&&other.seller===a.seller&&!s.settlements[other.id]?.auto);
          const expireAt=a.handoverUntil??(a.high!==null?a.closes+a.quiet:a.closes);
          const wonAuto=a.high!==null&&a.closes>0&&this.now()>=a.closes&&this.canAutoSettle();
          const autoReady=wonAuto&&!s.paused&&!s.halt&&(()=>{try{this.titles.validateAutoSettle!(a.name,a.seller,a.high!.payer,a.id,a.high!.amount,a.deedId,a.ownerVersion);return true;}catch{return false;}})();
          need(c.action==="cancel"?a.seller===c.actor&&!wonAuto:!unboughtFixed&&a.closes>0&&this.now()>=expireAt&&!sellerBusy&&!autoReady,"ESCROW_CANCEL_NOT_ALLOWED");
          // Expiry without a title consent is a failure refund, never silently pays a seller.
          if(a.high)this.refund(s,`cancel-${a.id}`,a.high.payer,a.high.amount);a.status="CANCELLED";(a.history??=[]).push({event:"Cancelled; original payer refund due",at:this.now()});break;
        }
        case "withdraw": {
          exact(p,["amount"]);const n=micros(p.amount);need(n<=micros(this.policy.perTx),"ESCROW_PAYOUT_LIMIT");need(n>0n&&BigInt(s.available[c.actor]??"0")>=n,"ESCROW_INSUFFICIENT_FUNDS");
          this.setAvailable(s,c.actor,BigInt(s.available[c.actor]??"0")-n);this.refund(s,`withdraw-${rk}`,c.actor,String(n));break;
        }
        case "settle": {
          exact(p,["auction","transfer"]);const a=s.auctions[text(p.auction,64)];
          need(a&&a.status==="OPEN"&&a.high&&a.closes>0&&this.now()>=a.closes&&c.actor===a.seller,"ESCROW_SETTLE_NOT_ALLOWED");
          // Prevent one seller from pinning two concurrent legacy handovers on the same registry nonce.
          need(!Object.values(s.auctions).some(other=>other.status==="SETTLING"&&other.seller===c.actor&&!s.settlements[other.id]?.auto),"ESCROW_TITLE_RESERVED");
          const packet=authenticate(p.transfer);this.titles.validate(packet,a.name,a.seller,a.high.payer);
          // Avoid splitting a Treasury-owned sale into two separate payouts to the same treasury wallet.
          const fee=a.seller===this.policy.treasury?0n:BigInt(a.high.amount)*BigInt(this.policy.feeBps)/10000n;
          const net=BigInt(a.high.amount)-fee;
          const payments:string[]=[];
          for(const [kind,to,n] of [["seller",a.seller,net],["fee",this.policy.treasury,fee]] as const) if(n>0n){
            const id=`${kind}-${a.id}`;s.payments[id]={id,kind,to,amount:String(n),status:"READY",day:null,body:null,txid:null};payments.push(id);
          }
          (a.history??=[]).push({event:"Seller handover signed; settling",at:this.now()});a.status="SETTLING";s.settlements[a.id]={auction:a.id,packet,payments,status:"PAYING"};break;
        }
        case "issue": {
          // deposit -> credit -> issue: buyer's credited POA buys a brand-new name from the treasury.
          need(this.newNames(),"ESCROW_NEW_NAMES_OFF");
          need(this.titles.issueTerms&&this.titles.validateIssue&&this.titles.issue,"ESCROW_NEW_NAMES_OFF");
          need(w.retained<w.hardLimit-32,"ESCROW_JOURNAL_CAPACITY");
          exact(p,["name","amount","registration"]);
          const name=text(p.name,256),n=micros(p.amount),terms=this.titles.issueTerms!(name);
          need(n===BigInt(terms.price),"ESCROW_PRICE");need(n<=micros(this.policy.perTx),"ESCROW_PAYOUT_LIMIT");
          need(c.actor!==this.policy.treasury,"ESCROW_SELF_SALE");
          need(BigInt(s.available[c.actor]??"0")>=n,"ESCROW_INSUFFICIENT_FUNDS");
          need(!Object.values(s.auctions).some(a=>(a.name===name&&(a.status==="OPEN"||a.status==="SETTLING"))||(a.status==="SETTLING"&&a.seller===c.actor&&!s.settlements[a.id]?.auto)),"ESCROW_TITLE_RESERVED");
          const packet=authenticate(p.registration);this.titles.validateIssue!(packet,name,c.actor,String(n));
          const id=`issue-${digest([rk,c])}`;need(!s.payments[id],"ESCROW_DUPLICATE");
          this.setAvailable(s,c.actor,BigInt(s.available[c.actor]??"0")-n);
          s.payments[id]={id,kind:"seller",to:this.policy.treasury,amount:String(n),status:"READY",day:null,body:null,txid:null};
          // Fail BEFORE the registry write if this entry could not be admitted (invariant + drain budget).
          invariant(s);need(BigInt(w.retained+1)+recoveryReserve(s,this.policy)<=BigInt(w.hardLimit),"ESCROW_JOURNAL_CAPACITY");
          this.titles.issue!(packet);
          result={issued:name,price:decimal(n),payment:id};break;
        }
        case "list-sub": {
          // The parent holder sets one fixed POA price for new subnames under a root they hold.
          need(this.subnames()&&this.titles.subTerms&&this.titles.validateSub&&this.titles.issueSub,"ESCROW_SUBNAMES_OFF");
          need(w.retained<w.admissionLimit,"ESCROW_JOURNAL_CAPACITY");
          exact(p,["parent","price"]);const parent=text(p.parent,256),t=this.titles.subTerms!(parent,c.actor);
          need(!Object.values(s.auctions).some(a=>a.name===parent&&(a.status==="OPEN"||a.status==="SETTLING")),"ESCROW_TITLE_RESERVED");
          const listings=(s.subListings??={});
          need(!Object.values(listings).some(l=>l.parent===parent&&l.status==="OPEN"),"ESCROW_SUB_LISTED");
          const id=digest([rk,c]);
          listings[id]={id,parent,parentDeedId:t.parentDeedId,ownerVersion:t.ownerVersion,seller:c.actor,price:String(micros(p.price)),status:"OPEN",createdAt:this.now(),sold:[]};
          result={listing:id};break;
        }
        case "cancel-sub": {
          exact(p,["listing"]);const l=s.subListings?.[text(p.listing,64)];
          need(l&&l.status==="OPEN","ESCROW_SUB_CLOSED");need(l.seller===c.actor,"ESCROW_CANCEL_NOT_ALLOWED");
          l.status="CANCELLED";break;
        }
        case "buy-sub": {
          // deposit -> credit -> buy: the buyer's credited POA buys label.parent at the holder's price.
          need(this.subnames()&&this.titles.subTerms&&this.titles.validateSub&&this.titles.issueSub,"ESCROW_SUBNAMES_OFF");
          need(w.retained<w.hardLimit-32,"ESCROW_JOURNAL_CAPACITY");
          exact(p,["listing","name","amount","registration"]);
          const l=s.subListings?.[text(p.listing,64)];need(l&&l.status==="OPEN","ESCROW_SUB_CLOSED");
          const name=text(p.name,256),n=micros(p.amount);
          need(name.endsWith("."+l.parent)&&name.length>l.parent.length+1,"ESCROW_SUB_NAME");
          need(n===BigInt(l.price),"ESCROW_PRICE");need(n<=micros(this.policy.perTx),"ESCROW_PAYOUT_LIMIT");
          need(c.actor!==l.seller,"ESCROW_SELF_SALE");
          need(!Object.values(s.auctions).some(a=>(a.name===l.parent&&(a.status==="OPEN"||a.status==="SETTLING"))||(a.status==="SETTLING"&&a.seller===c.actor&&!s.settlements[a.id]?.auto)),"ESCROW_TITLE_RESERVED");
          // The seller must still hold the same root, unchanged since listing (same rule as child offers).
          const t=this.titles.subTerms!(l.parent,l.seller);
          need(t.parentDeedId===l.parentDeedId&&t.ownerVersion===l.ownerVersion,"ESCROW_SUB_STALE");
          need(BigInt(s.available[c.actor]??"0")>=n,"ESCROW_INSUFFICIENT_FUNDS");
          const packet=authenticate(p.registration);this.titles.validateSub!(packet,name,c.actor,String(n),l);
          const fee=n*BigInt(this.policy.feeBps)/10000n, net=n-fee, payments:string[]=[];
          this.setAvailable(s,c.actor,BigInt(s.available[c.actor]??"0")-n);
          // Proceeds wait in escrow as READY payouts until the payout sender runs.
          for(const [kind,to,v] of [["seller",l.seller,net],["fee",this.policy.treasury,fee]] as const) if(v>0n){
            const id=`sub-${kind}-${digest([rk,c])}`;need(!s.payments[id],"ESCROW_DUPLICATE");
            s.payments[id]={id,kind,to,amount:String(v),status:"READY",day:null,body:null,txid:null};payments.push(id);
          }
          l.sold.push({name,buyer:c.actor,at:this.now(),payments});l.sold=l.sold.slice(-100);
          invariant(s);need(BigInt(w.retained+1)+recoveryReserve(s,this.policy)<=BigInt(w.hardLimit),"ESCROW_JOURNAL_CAPACITY");
          this.titles.issueSub!(packet);
          result={issued:name,price:decimal(n),payments};break;
        }
        case "repair-title": {
          exact(p,["auction","transfer"]);const a=s.auctions[text(p.auction,64)], st=s.settlements[String(p.auction)];
          need(a&&st&&a.status==="SETTLING"&&c.actor===a.seller,"ESCROW_TITLE_NOT_PENDING");
          const packet=authenticate(p.transfer);this.titles.validate(packet,a.name,a.seller,a.high!.payer);
          st.packet=packet;st.auto=false;
          if(st.payments.every(id=>s.payments[id]!.status==="FINAL")){
            this.titles.commit(packet);st.status="COMPLETE";st.packet=null;a.status="COMPLETE";(a.history??=[]).push({event:"Title repaired; handover complete",at:this.now()});
            this.extendBlockedHandovers(s,a.seller);
          } else {
            st.status="PAYING";
          }
          break;
        }
        default: need(false,"ESCROW_ACTION");
      }
      s.requests[rk]={fingerprint,result};
    }); return result;
  }); }
  private refund(s:State,id:string,to:string,n:string): void {
    need(!s.payments[id],"ESCROW_REFUND_DUPLICATE"); s.payments[id]={id,kind:"refund",to,amount:n,status:"READY",day:null,body:null,txid:null};
  }
  /** Grant any other closed won auctions by the same seller a fresh handover grace window when their active settlement finishes. */
  private extendBlockedHandovers(s:State,seller:string): void {
    const now=this.now();
    for(const other of Object.values(s.auctions)){
      if(other.status==="OPEN"&&other.seller===seller&&other.high!==null&&other.closes>0&&now>=other.closes){
        other.handoverUntil=Math.max(other.handoverUntil??(other.closes+other.quiet),now+other.quiet);
      }
    }
  }
  /** One sender lane. Automatic UNKNOWN recovery is lookup-only; explicit rebroadcast retains exact bytes. */
  tick(): Promise<State> { return this.serial(async()=>{
    this.gate();const status=await this.fresh();this.gate();
    for(const a of Object.values(this.state().auctions)){
      const s0=this.state();
      // Zero-handover automatic settlement for any closed funded auction (or legacy bought fixed listing).
      if(a.status==="OPEN"&&a.high!==null&&a.closes>0&&this.now()>=a.closes&&this.canAutoSettle()){
        let canSettle=false;
        try{
          this.titles.validateAutoSettle!(a.name,a.seller,a.high.payer,a.id,a.high.amount,a.deedId,a.ownerVersion);
          canSettle=true;
        }catch{canSettle=false;}
        if(canSettle){
          this.journal.append("auto-settle",{auction:a.id},s=>{
            need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
            const cur=s.auctions[a.id];if(!cur||cur.status!=="OPEN"||!cur.high||cur.closes<=0||this.now()<cur.closes)return;
            this.titles.validateAutoSettle!(cur.name,cur.seller,cur.high.payer,cur.id,cur.high.amount,cur.deedId,cur.ownerVersion);
            const fee=cur.seller===this.policy.treasury?0n:BigInt(cur.high.amount)*BigInt(this.policy.feeBps)/10000n;
            const net=BigInt(cur.high.amount)-fee;
            const payments:string[]=[];
            for(const [kind,to,v] of [["seller",cur.seller,net],["fee",this.policy.treasury,fee]] as const) if(v>0n){
              const pid=`${kind}-${cur.id}`;need(!s.payments[pid],"ESCROW_DUPLICATE");
              s.payments[pid]={id:pid,kind,to,amount:String(v),status:"READY",day:null,body:null,txid:null};payments.push(pid);
            }
            cur.status="SETTLING";cur.autoSettle=true;
            (cur.history??=[]).push({event:cur.kind==="fixed"?"Purchase paid; automatic settlement queued":"Auction won; automatic settlement queued",at:this.now()});
            cur.history=cur.history.slice(-100);
            s.settlements[cur.id]={auction:cur.id,packet:null,auto:true,payments,status:"PAYING"};
          });
          continue;
        }
      }
      // Never auto-expire a seller's closed won auction while escrow itself blocks them via another legacy SETTLING handover.
      const sellerBusy=a.high!==null&&Object.values(s0.auctions).some(other=>other.status==="SETTLING"&&other.seller===a.seller&&!s0.settlements[other.id]?.auto);
      const handoverDeadline=a.handoverUntil??(a.closes+a.quiet);
      if(a.status==="OPEN"&&a.closes>0&&((a.high===null&&a.kind!=="fixed"&&this.now()>=a.closes)||(a.high!==null&&!sellerBusy&&this.now()>=handoverDeadline))){
        this.journal.append("auto-expire",{auction:a.id},s=>{
          need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
          const cur=s.auctions[a.id];if(!cur||cur.status!=="OPEN")return;
          if(cur.high&&Object.values(s.auctions).some(other=>other.status==="SETTLING"&&other.seller===cur.seller&&!s.settlements[other.id]?.auto))return;
          if(cur.high)this.refund(s,`cancel-${cur.id}`,cur.high.payer,cur.high.amount);
          cur.status="CANCELLED";(cur.history??=[]).push({event:"Expired; original payer refund due",at:this.now()});
        });
      }
    }
    for(const p of Object.values(this.state().payments).filter(p=>p.status==="SIGNED"||p.status==="UNKNOWN")){
      let o:Observation|null;
      try{o=await this.network.lookup(p.txid!);}catch{throw new Error("ESCROW_LOOKUP_HELD");}
      if(!o) {
        if(p.status==="SIGNED") {
          // SIGNED is provably pre-I/O: UNKNOWN is durably committed before the first submit.
          // Recovery sends the retained bytes once, never a new tx/nonce.
          await this.reconcileAt(status);await this.fresh();this.gate();
          this.journal.append("outgoing-unknown",{id:p.id},s=>{
            need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
            s.payments[p.id]!.status="UNKNOWN";
          });
          try{await this.network.submit(p.body!);}catch{}
        }
        return this.state();
      }
      try{this.final(o,p.txid!);}catch(error){
        if(error instanceof Error && error.message!=="ESCROW_NOT_FINAL") this.halt("INCONSISTENT_FINALITY");
        return this.state();
      }
      need(canonical(o.body)===canonical(p.body),"ESCROW_OUTBOX_PROOF");this.gate();
      this.journal.append("payment-final",{id:p.id,txid:p.txid},s=>{
        need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
        const current=s.payments[p.id]!;need(current.status!=="FINAL","ESCROW_DUPLICATE_PAYMENT");current.status="FINAL";
        s.assets=String(BigInt(s.assets)-BigInt(p.amount));
      });this.crash("after-payout");
    }
    await this.reconcileAt(status);await this.fresh();this.gate();
    // Local title commit + settlement journal are one SQLite transaction in the production adapter.
    // Only transition PAYING -> TITLE_PENDING once; never spam journal records or block READY payments.
    for(const st of Object.values(this.state().settlements)) if(st.status==="PAYING"&&st.payments.every(id=>this.state().payments[id]!.status==="FINAL")){
      const a=this.state().auctions[st.auction]!;this.crash("before-title");
      let valid=false;
      try {
        if(st.auto&&this.canAutoSettle()){
          this.titles.validateAutoSettle!(a.name,a.seller,a.high!.payer,a.id,a.high!.amount,a.deedId,a.ownerVersion);
        } else {
          need(st.packet!==null,"ESCROW_TITLE_NOT_READY");
          this.titles.validate(st.packet,a.name,a.seller,a.high!.payer);
        }
        valid=true;
      }
      catch {
        this.journal.append("title-pending",{auction:a.id},s=>{
          need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
          s.settlements[a.id]!.status="TITLE_PENDING";
        });
      }
      if(valid){
        this.journal.append("title-complete",{auction:a.id},s=>{
          need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
          if(st.auto&&this.canAutoSettle()){
            this.titles.commitAutoSettle!(a.name,a.seller,a.high!.payer,a.id,a.high!.amount,a.deedId,a.ownerVersion);
          } else {
            this.titles.commit(st.packet!);
          }
          s.settlements[a.id]!.status="COMPLETE";s.settlements[a.id]!.packet=null;s.auctions[a.id]!.status="COMPLETE";(s.auctions[a.id]!.history??=[]).push({event:"Payment and title complete",at:this.now()});
          s.auctions[a.id]!.history=s.auctions[a.id]!.history!.slice(-100);
          this.extendBlockedHandovers(s,a.seller);
        });
      }
    }
    if(Object.values(this.state().payments).some(p=>p.status==="SIGNED"||p.status==="UNKNOWN"))return this.state();
    // Drain active SETTLING auction payouts ahead of already-delivered issue/subname payouts and refunds
    // so title transfers complete promptly and never stall other waiting handovers by the same seller.
    const settlingPayIds=new Set(Object.values(this.state().settlements).filter(st=>st.status==="PAYING").flatMap(st=>st.payments));
    const kindRank={seller:0,fee:1,refund:2};
    const rank=(x:Payment)=>(settlingPayIds.has(x.id)?0:10)+kindRank[x.kind];
    const p=Object.values(this.state().payments).filter(p=>p.status==="READY").sort((a,b)=>rank(a)-rank(b)||a.id.localeCompare(b.id))[0];
    if(!p)return this.state();
    const day=new Date(this.now()).toISOString().slice(0,10);
    const lastOut=Object.values(this.state().payments).filter(x=>x.status==="FINAL"&&x.txid&&x.body).sort((a,b)=>b.body!.nonce-a.body!.nonce)[0]?.txid??undefined;
    const ctx=await this.networkRead(()=>this.network.context(this.policy.wallet,lastOut));this.gate();await this.fresh();this.gate();
    integer(ctx.nextNonce,1);integer(ctx.cutoff);need(ctx.parents.length===2 && new Set(ctx.parents).size===2,"ESCROW_PARENTS");
    const state=this.state();need(state.nonce===null||state.nonce===ctx.nextNonce,"ESCROW_NONCE_GAP");
    // All unresolved payments, even reserved on an earlier day, count against today's cap (plus any folded same-day payouts).
    const foldedUsed=state.folded?.day===day?BigInt(state.folded.dayUsedMicros??"0"):0n;
    const used=foldedUsed+Object.values(state.payments).filter(x=>x.day!==null&&(x.day===day||x.status!=="FINAL")).reduce((n,x)=>n+BigInt(x.amount),0n);
    need(BigInt(p.amount)<=micros(this.policy.perTx)&&used+BigInt(p.amount)<=micros(this.policy.daily),"ESCROW_PAYOUT_LIMIT");
    const unsigned:Transfer={type:"transfer",cid:CHAIN,from:this.policy.wallet,to:p.to,amount:decimal(BigInt(p.amount)),memo:`poadomains:${digest(p.id)}`,
      nonce:ctx.nextNonce,parents:ctx.parents,ts:Math.max(Math.floor(this.now()/1000),ctx.cutoff+1)};
    const body=this.signer.transfer(unsigned);verifyTransfer(body);const id=txid(body);
    this.gate();this.journal.append("outgoing-intent",{id:p.id,txid:id},s=>{
      need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
      need(s.nonce===null||s.nonce===ctx.nextNonce,"ESCROW_NONCE_GAP");
      const currentFoldedUsed=s.folded?.day===day?BigInt(s.folded.dayUsedMicros??"0"):0n;
      const currentUsed=currentFoldedUsed+Object.values(s.payments).filter(x=>x.day!==null&&(x.day===day||x.status!=="FINAL")).reduce((n,x)=>n+BigInt(x.amount),0n);
      const target=s.payments[p.id]!;need(target.status==="READY","ESCROW_OUTBOX_STATE");
      need(BigInt(target.amount)<=micros(this.policy.perTx)&&currentUsed+BigInt(target.amount)<=micros(this.policy.daily),"ESCROW_PAYOUT_LIMIT");
      Object.assign(target,{status:"SIGNED",body,txid:id,day});s.nonce=ctx.nextNonce+1;
    });this.crash("before-submit");
    // Persist UNKNOWN BEFORE external I/O, including known queued/202 responses.
    this.gate();this.journal.append("outgoing-unknown",{id:p.id},s=>{
      need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
      s.payments[p.id]!.status="UNKNOWN";
    });
    try{await this.network.submit(body);}catch{ /* lookup only; never regenerate or resubmit */ }
    this.crash("after-submit");return this.state();
  }); }
  /** Explicit admin recovery: re-transmits exact retained signed bytes only if unseen on-chain and nonce is still current. */
  rebroadcast(): Promise<State> { return this.serial(async()=>{
    this.gate();const status=await this.fresh();this.gate();
    const p=Object.values(this.state().payments).find(x=>x.status==="SIGNED"||x.status==="UNKNOWN");
    if(!p||!p.body||!p.txid)return this.state();
    let o:Observation|null;
    try{o=await this.network.lookup(p.txid);}catch{throw new Error("ESCROW_LOOKUP_HELD");}
    if(o)return this.state();
    const lastOut=Object.values(this.state().payments).filter(x=>x.status==="FINAL"&&x.txid&&x.body).sort((a,b)=>b.body!.nonce-a.body!.nonce)[0]?.txid??undefined;
    const ctx=await this.networkRead(()=>this.network.context(this.policy.wallet,lastOut));this.gate();await this.fresh();this.gate();
    need(ctx.nextNonce===p.body.nonce,"ESCROW_NONCE_GAP");
    await this.reconcileAt(status);await this.fresh();this.gate();
    if(p.status==="SIGNED")this.journal.append("outgoing-unknown",{id:p.id},s=>{
      need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
      s.payments[p.id]!.status="UNKNOWN";
    });
    try{await this.network.submit(p.body);}catch{}
    return this.state();
  }); }
}

export interface EscrowArchive {
  policy: Policy;
  checkpoint?: EscrowCheckpoint;
  rows: Entry[];
  archived?: EscrowArchivedData;
}
/** Financial rows go inside the encrypted backup envelope, not the public registry journal. */
export function exportEscrow(storage: DurableObjectStorage): EscrowArchive | undefined {
  const sql=storage.sql;
  if(!sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='escrow_policy'").toArray().length)return undefined;
  const saved=sql.exec<{value:string}>("SELECT value FROM escrow_policy WHERE id=1").toArray()[0];if(!saved)return undefined;
  const policy=JSON.parse(saved.value) as Policy;
  const j=new SQLiteEscrowJournal(storage,policy);
  // Compact before export so backups never materialize thousands of redundant full-state rows in Worker RAM.
  j.compact();
  const checkpoint=j.readCheckpoint()??undefined;
  const rows=j.rows();
  replay(rows,policy,checkpoint);
  const archivedAll=j.archive.exportAll();
  const hasArchived=archivedAll.requests.length>0||archivedAll.txs.length>0||archivedAll.deposits.length>0||archivedAll.refunds.length>0;
  const archive:EscrowArchive={
    policy,
    ...(checkpoint?{checkpoint}:{}),
    rows,
    ...(hasArchived?{archived:archivedAll}:{}),
  };
  need(!/PRIVATE KEY|POA_ESCROW_KEY/.test(canonical(archive)),"ESCROW_SECRET_LEAK");
  return archive;
}
/** Caller must restrict this to an isolated local restore target. No key is present in this archive. */
export function restoreEscrow(storage: DurableObjectStorage, archive?: EscrowArchive): void {
  if(archive){
    const raw=obj(archive);
    const allowed=new Set(["policy","rows","checkpoint","archived"]);
    need(Object.keys(raw).every(k=>allowed.has(k))&&"policy" in raw&&"rows" in raw,"ESCROW_JOURNAL_CORRUPT");
    need(Array.isArray(raw.rows),"ESCROW_JOURNAL_CORRUPT");
    replay(raw.rows as Entry[],raw.policy as Policy,raw.checkpoint as EscrowCheckpoint|undefined);
  }
  storage.transactionSync(()=>{
    storage.sql.exec(
      "DROP TABLE IF EXISTS escrow_journal; DROP TABLE IF EXISTS escrow_policy; DROP TABLE IF EXISTS escrow_verified_head; " +
      "DROP TABLE IF EXISTS escrow_checkpoint; DROP TABLE IF EXISTS escrow_request_archive; " +
      "DROP TABLE IF EXISTS escrow_archived_txs; DROP TABLE IF EXISTS escrow_archived_deposits; DROP TABLE IF EXISTS escrow_archived_refunds",
    );
    if(archive){
      const j=new SQLiteEscrowJournal(storage,archive.policy);
      if(archive.checkpoint){
        storage.sql.exec("INSERT OR REPLACE INTO escrow_checkpoint(id,sequence,record) VALUES (1,?,?)",archive.checkpoint.sequence,canonical(archive.checkpoint));
      }
      for(const row of archive.rows)storage.sql.exec("INSERT INTO escrow_journal(sequence,record) VALUES(?,?)",row.sequence,canonical(row));
      if(archive.archived)j.archive.writeBatch(archive.archived);
      j.append("restore-paused",{},s=>{s.paused=true;s.halt="RESTORED_ARCHIVE_READ_ONLY";});
    }
  });
}
