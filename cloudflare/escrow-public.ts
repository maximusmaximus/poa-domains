/** Sanitized public views and payer-authenticated commands. Never exports a journal or signing material. */
import { Auction, Escrow, State } from "./escrow.js";
import { verifyCommand, address, decimal, micros } from "./escrow-codec.js";
import { exact, Fault, need, parseJSON } from "../src/core.js";
const PUBLIC_ACTIONS=new Set(["intent","detect","withdraw","open","list","bid","buy","cancel","expire","settle","repair-title","issue","list-sub","cancel-sub","buy-sub","view"]);
export const MARKET_QUERY_KEYS = [
  "name", "status", "kind", "phase",
  "sort", "order", "minPrice", "maxPrice",
  "closesBefore", "tier", "limit", "cursor", "since",
] as const;
const MARKET_QUERY_KEY_SET = new Set<string>(MARKET_QUERY_KEYS);
const STATUS_VALUES = new Set(["OPEN", "SETTLING", "COMPLETE", "CANCELLED"]);
const KIND_VALUES = new Set(["auction", "fixed"]);
const PHASE_VALUES = new Set(["live", "queued", "closed", "all"]);
const SORT_VALUES = new Set(["closes", "price", "created"]);
const ORDER_VALUES = new Set(["asc", "desc"]);
const TIER_VALUES = new Set(["standard", "premium"]);
const PREMIUM_WINDOW_MS = 86400000;
const MAX_CLOSES_BEFORE_SEC = 999999999999;

export type MarketSort = "closes" | "price" | "created";
export type MarketOrder = "asc" | "desc";
export type MarketTier = "standard" | "premium";
interface MarketCursorTuple { bucket: 0 | 1; key: bigint; id: string; }
export interface ParsedMarketQuery {
  name?: string;
  status?: "OPEN" | "SETTLING" | "COMPLETE" | "CANCELLED";
  kind?: "auction" | "fixed";
  phase?: "live" | "queued" | "closed" | "all";
  sort: MarketSort;
  order: MarketOrder;
  minPriceMicros?: bigint;
  maxPriceMicros?: bigint;
  closesBefore?: number;
  tier?: MarketTier;
  limit: number;
  cursorTuple?: MarketCursorTuple;
  since?: number;
}

function parsePoaDecimalMicros(value: unknown): bigint {
  need(typeof value === "string" && /^(0|[1-9][0-9]{0,12})(?:\.([0-9]{1,6}))?$/.test(value), "ESCROW_AMOUNT");
  const dot = value.indexOf(".");
  if (dot < 0) return BigInt(value) * 1000000n;
  return BigInt(value.slice(0, dot)) * 1000000n + BigInt(value.slice(dot + 1).padEnd(6, "0"));
}

function parseNonNegInt(value: unknown, max: number, code: string): number {
  need(typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value), code);
  const n = Number(value);
  need(Number.isSafeInteger(n) && n >= 0 && n <= max, code);
  return n;
}

function encodeMarketCursor(sort: MarketSort, order: MarketOrder, t: MarketCursorTuple): string {
  const raw = `v1|${sort}|${order}|${t.bucket}|${t.key.toString()}|${t.id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

function decodeMarketCursor(token: unknown, expectedSort: MarketSort, expectedOrder: MarketOrder): MarketCursorTuple {
  need(typeof token === "string" && token.length >= 16 && token.length <= 256 && /^[A-Za-z0-9_-]+$/.test(token), "PAGE_CURSOR");
  let decoded: string;
  try {
    const bytes = Buffer.from(token, "base64url");
    need(bytes.toString("base64url") === token, "PAGE_CURSOR");
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (e) {
    if (e instanceof Fault) throw e;
    throw new Fault("PAGE_CURSOR");
  }
  const parts = decoded.split("|");
  need(parts.length === 6 && parts[0] === "v1" && parts[1] === expectedSort && parts[2] === expectedOrder, "PAGE_CURSOR");
  need(parts[3] === "0" || parts[3] === "1", "PAGE_CURSOR");
  const bucket: 0 | 1 = parts[3] === "1" ? 1 : 0;
  need(/^(0|[1-9][0-9]{0,20})$/.test(parts[4]!), "PAGE_CURSOR");
  if (expectedSort === "closes") {
    need(bucket === 1 ? parts[4] === "0" : parts[4] !== "0", "PAGE_CURSOR");
  } else {
    need(bucket === 0, "PAGE_CURSOR");
  }
  need(/^[0-9a-f]{64}$/.test(parts[5]!), "PAGE_CURSOR");
  return { bucket, key: BigInt(parts[4]!), id: parts[5]! };
}

export function parseMarketQuery(query: Record<string, string> = {}): ParsedMarketQuery {
  for (const key of Object.keys(query)) {
    need(MARKET_QUERY_KEY_SET.has(key), "QUERY_NOT_ALLOWED");
  }
  const out: ParsedMarketQuery = { sort: "closes", order: "asc", limit: 50 };
  if (query.name !== undefined) {
    need(typeof query.name === "string" && query.name.length > 0 && query.name.length <= 256, "ESCROW_NAME");
    out.name = query.name;
  }
  if (query.status !== undefined) {
    need(STATUS_VALUES.has(query.status), "INVALID_REQUEST");
    out.status = query.status as ParsedMarketQuery["status"];
  }
  if (query.kind !== undefined) {
    need(KIND_VALUES.has(query.kind), "ESCROW_MARKET_KIND");
    out.kind = query.kind as ParsedMarketQuery["kind"];
  }
  if (query.phase !== undefined) {
    need(PHASE_VALUES.has(query.phase), "INVALID_REQUEST");
    out.phase = query.phase as ParsedMarketQuery["phase"];
  }
  if (query.sort !== undefined) {
    need(SORT_VALUES.has(query.sort), "INVALID_REQUEST");
    out.sort = query.sort as MarketSort;
  }
  if (query.order !== undefined) {
    need(ORDER_VALUES.has(query.order), "INVALID_REQUEST");
    out.order = query.order as MarketOrder;
  }
  if (query.minPrice !== undefined) out.minPriceMicros = parsePoaDecimalMicros(query.minPrice);
  if (query.maxPrice !== undefined) out.maxPriceMicros = parsePoaDecimalMicros(query.maxPrice);
  if (out.minPriceMicros !== undefined && out.maxPriceMicros !== undefined) {
    need(out.minPriceMicros <= out.maxPriceMicros, "ESCROW_AMOUNT");
  }
  if (query.closesBefore !== undefined) out.closesBefore = parseNonNegInt(query.closesBefore, MAX_CLOSES_BEFORE_SEC, "INTEGER");
  if (query.tier !== undefined) {
    need(TIER_VALUES.has(query.tier), "INVALID_REQUEST");
    out.tier = query.tier as MarketTier;
  }
  if (query.limit !== undefined) {
    need(typeof query.limit === "string" && /^[1-9][0-9]{0,2}$/.test(query.limit) && Number(query.limit) <= 100, "PAGE_LIMIT");
    out.limit = Number(query.limit);
  }
  if (query.since !== undefined) out.since = parseNonNegInt(query.since, Number.MAX_SAFE_INTEGER, "INTEGER");
  if (query.cursor !== undefined) out.cursorTuple = decodeMarketCursor(query.cursor, out.sort, out.order);
  return out;
}

function isAwaitingFirstBid(a: Auction): boolean {
  return a.status === "OPEN" && (a.kind ?? "auction") !== "fixed" && a.high === null && a.closes === 0;
}
function auctionPhase(a: Auction, nowMs: number): "live" | "queued" | "closed" {
  if (a.status !== "OPEN") return "closed";
  if (isAwaitingFirstBid(a)) return "queued";
  if (a.closes > 0 && nowMs >= a.closes) return "closed";
  return "live";
}
function auctionTier(a: Auction): MarketTier {
  return (a.window ?? a.quiet) >= PREMIUM_WINDOW_MS ? "premium" : "standard";
}
function effectivePriceMicros(a: Auction): bigint {
  return a.high ? BigInt(a.high.amount) : BigInt(a.reserve);
}
function updatedSequenceOf(a: Auction, stateSeq: number): number {
  return typeof a.updatedSequence === "number" ? a.updatedSequence : (stateSeq > 0 ? 1 : 0);
}
function tupleOf(a: Auction, sort: MarketSort): MarketCursorTuple {
  if (sort === "closes") {
    const closes = a.closes > 0 ? a.closes : 0;
    return { bucket: closes > 0 ? 0 : 1, key: BigInt(closes), id: a.id };
  }
  if (sort === "price") {
    return { bucket: 0, key: effectivePriceMicros(a), id: a.id };
  }
  return { bucket: 0, key: BigInt(a.createdAt && a.createdAt > 0 ? a.createdAt : 0), id: a.id };
}
function compareMarketTuple(a: MarketCursorTuple, b: MarketCursorTuple, order: MarketOrder): number {
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;
  if (a.key !== b.key) {
    const diff = a.key < b.key ? -1 : 1;
    return order === "asc" ? diff : -diff;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function projectMarketItem(s: State, a: Auction) {
  const reserveMicros = BigInt(a.reserve);
  const highMicros = a.high ? BigInt(a.high.amount) : null;
  const minNext = highMicros === null ? reserveMicros : (highMicros * 11n) / 10n + 1n;
  const effectiveMin = minNext > reserveMicros ? minNext : reserveMicros;
  const kind = a.kind ?? "auction";
  const awaitingFirstBid = isAwaitingFirstBid(a);
  const bidders = [...new Set((a.history ?? []).map(h => h.payer).filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (a.high?.payer && !bidders.includes(a.high.payer)) bidders.push(a.high.payer);
  const startedAt = a.startedAt ?? (kind !== "fixed" && a.high !== null ? (a.history?.find(h => h.amount)?.at ?? a.createdAt ?? null) : null);
  return {
    id: a.id, name: a.name, seller: a.seller, kind, price: decimal(reserveMicros),
    minimumNextBid: decimal(effectiveMin),
    status: a.status, closes: a.closes, window: a.window ?? a.quiet, quiet: a.quiet,
    createdAt: a.createdAt ?? null, startedAt, awaitingFirstBid,
    high: a.high ? { payer: a.high.payer, amount: decimal(highMicros!) } : null,
    bidders,
    settlement: s.settlements[a.id]?.status ?? null,
    history: (a.history ?? [{ event: a.status, at: a.createdAt ?? 0 }]).slice(-100).map(h => ({ ...h, ...(h.amount ? { amount: decimal(BigInt(h.amount)) } : {}) })),
  };
}

export function marketView(s: State, name?: string) {
  return Object.values(s.auctions)
    .filter(a => name === undefined || a.name === name)
    .map(a => projectMarketItem(s, a));
}

export function marketPage(s: State, query: Record<string, string> = {}, nowMs = Date.now()) {
  const q = parseMarketQuery(query);
  const all = Object.values(s.auctions);
  let live = 0, queued = 0, closed = 0, fixed = 0;
  for (const a of all) {
    if ((a.kind ?? "auction") === "fixed") {
      if (a.status === "OPEN") fixed++;
      else closed++;
    } else {
      const ph = auctionPhase(a, nowMs);
      if (ph === "live") live++;
      else if (ph === "queued") queued++;
      else closed++;
    }
  }
  const matched = all.filter(a => {
    const kind = a.kind ?? "auction";
    if (q.name !== undefined && a.name !== q.name) return false;
    if (q.status !== undefined && a.status !== q.status) return false;
    if (q.kind !== undefined && kind !== q.kind) return false;
    if (q.phase !== undefined && q.phase !== "all" && auctionPhase(a, nowMs) !== q.phase) return false;
    if (q.tier !== undefined && auctionTier(a) !== q.tier) return false;
    if (q.minPriceMicros !== undefined || q.maxPriceMicros !== undefined) {
      const eff = effectivePriceMicros(a);
      if (q.minPriceMicros !== undefined && eff < q.minPriceMicros) return false;
      if (q.maxPriceMicros !== undefined && eff > q.maxPriceMicros) return false;
    }
    if (q.closesBefore !== undefined) {
      if (kind === "fixed") return false;
      if (auctionPhase(a, nowMs) !== "live") return false;
      if (!(a.closes > 0 && a.closes < q.closesBefore * 1000)) return false;
    }
    if (q.since !== undefined && updatedSequenceOf(a, s.sequence) <= q.since) return false;
    return true;
  });
  const total = matched.length;
  const decorated = matched.map(a => ({ a, tuple: tupleOf(a, q.sort) }));
  decorated.sort((x, y) => compareMarketTuple(x.tuple, y.tuple, q.order));
  const afterCursor = q.cursorTuple
    ? decorated.filter(x => compareMarketTuple(x.tuple, q.cursorTuple!, q.order) > 0)
    : decorated;
  const hasMore = afterCursor.length > q.limit;
  const slice = afterCursor.slice(0, q.limit);
  const nextCursor = hasMore ? encodeMarketCursor(q.sort, q.order, slice[slice.length - 1]!.tuple) : null;
  return {
    items: slice.map(x => projectMarketItem(s, x.a)),
    total,
    counts: { live, queued, closed, fixed },
    nextCursor,
    hasMore,
    sequence: s.sequence,
    serverTime: nowMs,
  };
}
export function subnameView(s: State, parent?: string) {
  return Object.values(s.subListings??{}).filter(l=>parent===undefined||l.parent===parent).slice(-100).map(l=>({
    id:l.id,parent:l.parent,seller:l.seller,price:decimal(BigInt(l.price)),status:l.status,createdAt:l.createdAt,
    sold:l.sold.slice(-100).map(x=>({name:x.name,buyer:x.buyer,at:x.at})),
  }));
}
export function accountView(s:State,payer:string){address(payer);
  const lockedMicros=Object.values(s.auctions).reduce((sum,a)=>a.status==="OPEN"&&a.high?.payer===payer?sum+BigInt(a.high.amount):sum,0n);
  return {
    payer,available:decimal(BigInt(s.available[payer]??"0")),lockedInAuctions:decimal(lockedMicros),
    deposits:Object.entries(s.deposits).filter(([,d])=>d.payer===payer).slice(-100).map(([id,d])=>({intent:id,amount:d.amount,status:d.tx?"final":"waiting",txid:d.tx,createdAt:d.createdAt??null})),
    refunds:Object.values(s.payments).filter(p=>p.kind==="refund"&&p.to===payer).slice(-100).map(p=>({id:p.id,amount:decimal(BigInt(p.amount)),status:p.status,txid:p.txid,day:p.day})),
  };
}
export async function publicCommand(getEscrow:()=>Escrow,packetText:string,registryId:string,endpoint:string,now=Date.now(),operational=true){
  need(["intent","withdraw","account","command"].includes(endpoint),"ESCROW_ROUTE");
  const packet=parseJSON(packetText),c=verifyCommand(packet,registryId,Math.floor(now/1000));
  need(c.expires<=Math.floor(now/1000)+3600,"ESCROW_COMMAND_EXPIRY");need(PUBLIC_ACTIONS.has(c.action),"ESCROW_ACTION");
  const expected:Record<string,string>={intent:"intent",withdraw:"withdraw",account:"view"};
  if(expected[endpoint])need(c.action===expected[endpoint],"ESCROW_ENDPOINT_ACTION");
  const escrow=getEscrow();
  if(c.action==="view"){exact(c.params,[]);return {action:c.action,account:accountView(escrow.state(),c.actor)};}
  need(operational,"ESCROW_OPERATOR_SETUP_HELD");
  if(c.action==="intent")need(micros(c.params.amount)<=micros(escrow.policy.perTx),"ESCROW_PAYOUT_LIMIT");
  const result=await escrow.command(c);
  return {action:c.action,result,account:accountView(escrow.state(),c.actor)};
}
