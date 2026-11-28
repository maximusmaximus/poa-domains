/** Sanitized public views and payer-authenticated commands. Never exports a journal or signing material. */
import { Escrow, State } from "./escrow.js";
import { verifyCommand, address, decimal, micros } from "./escrow-codec.js";
import { exact, need, parseJSON } from "../src/core.js";
const PUBLIC_ACTIONS=new Set(["intent","detect","withdraw","open","list","bid","buy","cancel","expire","settle","repair-title","issue","list-sub","cancel-sub","buy-sub","view"]);
const WAIT_TIME_WINDOW_PER_TYPE = 50;
const MAX_PURCHASE_SESSION_MS = 24 * 60 * 60 * 1000;
const MAX_BATCH_REUSE_MS = 30 * 60 * 1000;
const MAX_SALE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export interface WaitTimeTelemetry {
  averageMs: number | null;
  averageMinutes: number | null;
  purchaseAverageMs: number | null;
  purchaseAverageMinutes: number | null;
  purchaseSamples: number;
  saleAverageMs: number | null;
  saleAverageMinutes: number | null;
  saleSamples: number;
  totalSamples: number;
  windowPerType: number;
}
export interface WaitTimeRegistryInput {
  treasury?: string;
  receipts?: Record<string, { signer?: string; time?: number; status?: string; result?: Record<string, unknown> }>;
}
/** Aggregate purchase & sale completion timing telemetry (sanitized counts & averages only). */
export function waitTimeTelemetry(s: State, registry?: WaitTimeRegistryInput): WaitTimeTelemetry {
  type DepositEntry = { txMs: number | null; intentMs: number | null; sortMs: number; usedCount: number };
  const depositsByPayer = new Map<string, DepositEntry[]>();
  for (const dep of Object.values(s.deposits ?? {})) {
    if (!dep || !dep.tx || typeof dep.payer !== "string" || !dep.payer) continue;
    const tx = s.credited?.[dep.tx];
    const txMs = tx && typeof tx.ts === "number" && Number.isFinite(tx.ts) && tx.ts > 0 ? tx.ts * 1000 : null;
    const intentMs = typeof dep.createdAt === "number" && Number.isFinite(dep.createdAt) && dep.createdAt > 0 ? dep.createdAt : null;
    // A valid deposit transfer embeds the server-created intent hash in its memo, so it cannot precede intentMs.
    const clampedTxMs = txMs !== null && intentMs !== null ? Math.max(txMs, intentMs) : txMs;
    const sortMs = clampedTxMs ?? intentMs;
    if (sortMs === null) continue;
    let list = depositsByPayer.get(dep.payer);
    if (!list) {
      list = [];
      depositsByPayer.set(dep.payer, list);
    }
    list.push({ txMs: clampedTxMs, intentMs, sortMs, usedCount: 0 });
  }
  for (const list of depositsByPayer.values()) list.sort((a, b) => a.sortMs - b.sortMs);

  const purchases: { buyer: string; completedAtMs: number }[] = [];
  const treasury = typeof registry?.treasury === "string" ? registry.treasury : "";
  for (const r of Object.values(registry?.receipts ?? {})) {
    if (!r || r.status !== "succeeded" || !r.result || typeof r.result !== "object") continue;
    if (typeof r.result.deedId !== "string" || typeof r.result.owner !== "string") continue;
    if (r.result.name !== undefined || r.result.auctionId !== undefined) continue;
    if (typeof r.signer !== "string" || r.signer !== r.result.owner) continue;
    if (treasury && r.signer === treasury) continue;
    if (typeof r.time !== "number" || !Number.isFinite(r.time) || r.time <= 0) continue;
    purchases.push({ buyer: r.signer, completedAtMs: r.time * 1000 });
  }
  for (const listing of Object.values(s.subListings ?? {})) {
    for (const sold of listing?.sold ?? []) {
      if (typeof sold?.buyer === "string" && typeof sold.at === "number" && Number.isFinite(sold.at) && sold.at > 0) {
        purchases.push({ buyer: sold.buyer, completedAtMs: sold.at });
      }
    }
  }
  purchases.sort((a, b) => a.completedAtMs - b.completedAtMs);

  const purchaseDurations: number[] = [];
  for (const p of purchases) {
    const list = depositsByPayer.get(p.buyer);
    if (!list || !list.length) continue;
    let matched: { entry: DepositEntry; startMs: number } | null = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i]!;
      const startMs =
        entry.txMs !== null && entry.txMs <= p.completedAtMs
          ? entry.txMs
          : entry.intentMs !== null && entry.intentMs <= p.completedAtMs
            ? entry.intentMs
            : null;
      if (startMs !== null) {
        matched = { entry, startMs };
        break;
      }
    }
    if (!matched) continue;
    const deltaMs = p.completedAtMs - matched.startMs;
    const limitMs = matched.entry.usedCount === 0 ? MAX_PURCHASE_SESSION_MS : MAX_BATCH_REUSE_MS;
    if (deltaMs >= 0 && deltaMs <= limitMs) {
      purchaseDurations.push(deltaMs);
    }
    matched.entry.usedCount++;
  }
  const recentPurchases = purchaseDurations.slice(-WAIT_TIME_WINDOW_PER_TYPE);

  const saleRows: { doneMs: number; durationMs: number }[] = [];
  for (const a of Object.values(s.auctions ?? {})) {
    if (!a || a.status !== "COMPLETE") continue;
    const history = Array.isArray(a.history) ? a.history : [];
    let doneMs: number | null = null;
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h && typeof h.event === "string" && /complete/i.test(h.event) && typeof h.at === "number" && Number.isFinite(h.at) && h.at > 0) {
        doneMs = h.at;
        break;
      }
    }
    if (doneMs === null) continue;
    let startMs: number | null = null;
    if (a.kind === "fixed") {
      const buyEvent = history.find(
        (h) => h && typeof h.event === "string" && /Purchase paid|Purchase reserved/i.test(h.event) && typeof h.at === "number" && Number.isFinite(h.at) && h.at > 0,
      );
      startMs = buyEvent?.at ?? (typeof a.closes === "number" && Number.isFinite(a.closes) && a.closes > 0 ? a.closes : null);
    } else {
      startMs = typeof a.closes === "number" && Number.isFinite(a.closes) && a.closes > 0 ? a.closes : null;
    }
    if (startMs === null || doneMs < startMs) continue;
    const durationMs = doneMs - startMs;
    if (durationMs <= MAX_SALE_DURATION_MS) saleRows.push({ doneMs, durationMs });
  }
  saleRows.sort((a, b) => a.doneMs - b.doneMs);
  const recentSales = saleRows.slice(-WAIT_TIME_WINDOW_PER_TYPE).map((r) => r.durationMs);

  const meanMs = (arr: number[]): number | null =>
    arr.length ? Math.round(arr.reduce((sum, v) => sum + v, 0) / arr.length) : null;
  const toMinutes = (ms: number | null): number | null =>
    ms === null ? null : Math.round((ms / 60000) * 10) / 10;

  const combined = [...recentPurchases, ...recentSales];
  const averageMs = meanMs(combined);
  const purchaseAverageMs = meanMs(recentPurchases);
  const saleAverageMs = meanMs(recentSales);

  return {
    averageMs,
    averageMinutes: toMinutes(averageMs),
    purchaseAverageMs,
    purchaseAverageMinutes: toMinutes(purchaseAverageMs),
    purchaseSamples: recentPurchases.length,
    saleAverageMs,
    saleAverageMinutes: toMinutes(saleAverageMs),
    saleSamples: recentSales.length,
    totalSamples: combined.length,
    windowPerType: WAIT_TIME_WINDOW_PER_TYPE,
  };
}
export function marketView(s: State, name?: string, autoSettleDefault = false) {
  return Object.values(s.auctions).filter(a=>name===undefined||a.name===name).slice(-500).map(a=>{
    const reserveMicros=BigInt(a.reserve);
    const highMicros=a.high?BigInt(a.high.amount):null;
    const minNext=highMicros===null?reserveMicros:(highMicros*11n)/10n+1n;
    const effectiveMin=minNext>reserveMicros?minNext:reserveMicros;
    const kind=a.kind??"auction";
    const awaitingFirstBid=a.status==="OPEN"&&kind!=="fixed"&&a.high===null&&a.closes===0;
    const openFixed=a.status==="OPEN"&&kind==="fixed"&&a.high===null;
    const bidders=[...new Set((a.history??[]).map(h=>h.payer).filter((x):x is string=>typeof x==="string"&&x.length>0))];
    if(a.high?.payer&&!bidders.includes(a.high.payer))bidders.push(a.high.payer);
    const startedAt=a.startedAt??(kind!=="fixed"&&a.high!==null?(a.history?.find(h=>h.amount)?.at??a.createdAt??null):null);
    const st=s.settlements[a.id];
    const autoSettle=Boolean(a.autoSettle||st?.auto||(autoSettleDefault&&a.status==="OPEN"));
    return {
      id:a.id,name:a.name,seller:a.seller,kind,price:decimal(reserveMicros),
      minimumNextBid:decimal(effectiveMin),
      status:a.status,closes:openFixed?0:a.closes,window:a.window??a.quiet,quiet:a.quiet,
      createdAt:a.createdAt??null,startedAt,awaitingFirstBid,autoSettle,
      high:a.high?{payer:a.high.payer,amount:decimal(highMicros!)}:null,
      bidders,
      settlement:st?.status??null,
      history:(a.history??[{event:a.status,at:a.createdAt??0}]).slice(-100).map(h=>({...h,...(h.amount?{amount:decimal(BigInt(h.amount))}:{})})),
    };
  });
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
