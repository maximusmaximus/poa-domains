import { DisplayReadError, displayCode, displayReason, type DisplayReadiness, type ReadTiming } from "./display-freshness.js";
import { canonical, exact, integer, need, obj, text } from "../src/core.js";
import { Packet, authenticate } from "../src/auth.js";
import { CHAIN, Command, Signer, Transfer, address, decimal, digest, micros, txid, verifyTransfer } from "./escrow-codec.js";

export const PILOT_JOURNAL_LIMIT = 2000;
export const PILOT_ADMISSION_LIMIT = 1900;
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
  lookup(id: string): Promise<Observation | null>;
  context(wallet: string, knownTxid?: string): Promise<Context>; cut(wallet: string, ids: string[], status: Status): Promise<Cut>;
  submit(body: Transfer): Promise<void>;
}
export interface TitleStore {
  terms(name: string, seller: string): { reserve: string; window: number; quiet: number };
  validate(packet: Packet, name: string, seller: string, buyer: string): void;
  commit(packet: Packet): void;
}
export interface Policy { wallet: string; treasury: string; perTx: string; daily: string; feeBps: number; maxAgeMs: number; }
type PayStatus = "READY" | "SIGNED" | "UNKNOWN" | "FINAL";
export interface Payment {
  id: string; kind: "refund" | "seller" | "fee"; to: string; amount: string; status: PayStatus;
  day: string | null; body: Transfer | null; txid: string | null;
}
interface Deposit { payer: string; amount: string; tx: string | null; createdAt?: number; }
interface Auction {
  id: string; name: string; seller: string; reserve: string; closes: number; quiet: number; kind?: "auction" | "fixed"; createdAt?: number; history?: {event:string;at:number;amount?:string}[];
  high: { payer: string; amount: string } | null; status: "OPEN" | "CANCELLED" | "SETTLING" | "COMPLETE";
}
interface Settlement { auction: string; packet: Packet; payments: string[]; status: "PAYING" | "TITLE_PENDING" | "COMPLETE"; }
export interface State {
  sequence: number; policy: string; paused: boolean; halt: string | null; assets: string; nonce: number | null;
  quarantine: Record<string,{observed:string;expectedMicros:string}>;
  available: Record<string,string>; deposits: Record<string,Deposit>; credited: Record<string,Transfer>;
  auctions: Record<string,Auction>; payments: Record<string,Payment>; settlements: Record<string,Settlement>;
  requests: Record<string,{ fingerprint: string; result: unknown }>;
}
export interface Entry { sequence: number; previous: string; event: string; payload: unknown; state: State; checksum: string; }
export interface Journal { load(): State; append(event: string, payload: unknown, change: (s: State) => void): State; }
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
  const nonces = Object.values(s.payments).filter(p=>p.body).map(p=>p.body!.nonce);
  need(new Set(nonces).size === nonces.length,"ESCROW_NONCE_REUSE");
  const depNonces = Object.values(s.credited).map(b=>`${b.from}:${b.nonce}`);
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
const DRAIN_EVENTS=new Set(["deposit","withdraw","cancel","expire","auto-expire","settle","repair-title",
  "outgoing-intent","outgoing-unknown","payment-final","title-pending","title-complete"]);
export function nextEntry(s: State, previous: string, event: string, payload: unknown, change: (s: State)=>void, policy: Policy): Entry {
  const emergency=event==="pause"||event==="halt"||event==="reconciliation-quarantine"||event==="restore-paused";
  // Emergency controls must remain available after a legacy drain crosses the
  // old cap; they never admit financial obligations. Repeated controls dedupe.
  const next = structuredClone(s); change(next); next.sequence++; invariant(next);
  if(!emergency){
    const remaining=recoveryReserve(next,policy);
    // New work must reserve its entire drain budget atomically. Legacy journals
    // (or emergency entries) may already exceed that budget: permit only a
    // strictly decreasing, finite recovery lane, never new admissions/noops.
    const drains=DRAIN_EVENTS.has(event)&&remaining<recoveryReserve(s,policy);
    need(BigInt(next.sequence)+remaining<=BigInt(PILOT_JOURNAL_LIMIT)||drains,"ESCROW_JOURNAL_CAPACITY");
  }
  const v = { sequence:next.sequence,previous,event,payload,state:next }; return {...v,checksum:digest(v)};
}
export function replay(rows: Entry[], policy: Policy): State {
  let s=initial(policy), previous=digest(["escrow-genesis/v1",s.policy]);
  for(const row of rows) {
    const {checksum,...v}=row;
    need(row.sequence===s.sequence+1 && row.previous===previous && checksum===digest(v) && row.state.policy===s.policy,"ESCROW_JOURNAL_CORRUPT");
    invariant(row.state); s=row.state; previous=checksum;
  }
  return structuredClone(s);
}
export class SQLiteEscrowJournal implements Journal {
  constructor(private storage: DurableObjectStorage, private policy: Policy) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS escrow_journal (sequence INTEGER PRIMARY KEY, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS escrow_policy (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)");
    const saved = storage.sql.exec<{value:string}>("SELECT value FROM escrow_policy WHERE id=1").toArray()[0];
    const hasLedger = storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM escrow_journal").one().n > 0;
    if(saved && hasLedger) need(saved.value === canonical(policy),"ESCROW_POLICY_CHANGED");
    else storage.sql.exec("INSERT OR REPLACE INTO escrow_policy(id,value) VALUES (1,?)",canonical(policy));
  }
  rows(): Entry[] { return this.storage.sql.exec<{record:string}>("SELECT record FROM escrow_journal ORDER BY sequence").toArray().map(r=>JSON.parse(r.record) as Entry); }
  load(): State { return replay(this.rows(),this.policy); }
  append(event:string,payload:unknown,change:(s:State)=>void): State {
    return this.storage.transactionSync(()=>{
      const rows=this.rows(),s=replay(rows,this.policy);
      // Admission budgets include recovery; legacy financial drains may exceed the old cap.
      const e=nextEntry(s,rows.at(-1)?.checksum ?? digest(["escrow-genesis/v1",s.policy]),event,payload,change,this.policy);
      this.storage.sql.exec("INSERT INTO escrow_journal(sequence,record) VALUES (?,?)",e.sequence,canonical(e)); return e.state;
    });
  }
}
export class Escrow {
  constructor(readonly journal: Journal, private network: Network, private signer: Signer,
    private titles: TitleStore, readonly policy: Policy, private now=()=>Date.now(), private enabled=()=>false,
    private crash: (point:string)=>void=()=>{}) {
    need(journal.load().policy===digest(policy) && signer.address===policy.wallet,"ESCROW_POLICY_CHANGED");
  }
  private serial<T>(fn:()=>Promise<T>): Promise<T> {
    const prev=journalQueues.get(this.journal) ?? Promise.resolve();
    const result=prev.then(fn); journalQueues.set(this.journal,result.catch(()=>{})); return result;
  }
  state(): State { return this.journal.load(); }
  titleLocked(): boolean { return Object.values(this.state().auctions).some(a=>a.status==="OPEN"||a.status==="SETTLING"); }
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
      this.publicFresh = { until: Math.min(this.now() + 10000,
        value.asOf === null ? Infinity : value.asOf + this.policy.maxAgeMs), value };
      return value;
    }).finally(() => { this.publicInflight = undefined; });
    return this.publicInflight;
  }
  /** Read-only receipt preview: never credits funds or signs/sends a transaction. */
  async depositView(id: string, candidate?: string): Promise<unknown> {
    need(/^[0-9a-f]{64}$/.test(id),"ESCROW_DEPOSIT_INTENT");
    const s=this.state(),d=s.deposits[id];need(d,"ESCROW_DEPOSIT_INTENT");
    let status="waiting",seenAt:number|null=null;
    const tx=d.tx??candidate??null;
    if(d.tx) status="final";
    else if(tx){
      need(/^[0-9a-f]{64}$/.test(tx),"ESCROW_TXID");
      try { const o=await this.network.lookup(tx);
        if(o && o.id===tx && o.chain===CHAIN && o.valid===true){
          verifyTransfer(o.body);need(txid(o.body)===tx && o.body.to===this.policy.wallet && o.body.from===d.payer && o.body.amount===d.amount && o.body.memo===`poadomains:${id}`,"ESCROW_DEPOSIT_BINDING");
          status="seen";seenAt=o.body.ts*1000;
        }
      }catch { /* Unknown or invalid observations never imply a credit. */ }
    }
    return {intent:id,payer:d.payer,to:this.policy.wallet,amount:d.amount,memo:`poadomains:${id}`,status,txid:tx,createdAt:d.createdAt??null,seenAt,finalAt:d.tx?(s.credited[d.tx]?.ts??0)*1000:null};
  }
  private async fresh(): Promise<Status> {
    let status:Status;
    try { status=await this.network.status(); }
    catch { throw new Error("ESCROW_NETWORK_HELD"); }
    return this.verifyFresh(status);
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
  private async reconcileAt(status:Status): Promise<void> {
    const s=this.state(), ids=[...Object.keys(s.credited),...Object.values(s.payments).flatMap(p=>p.txid?[p.txid]:[])];
    const cut=await this.network.cut(this.policy.wallet,ids,status);
    need(cut.chain===CHAIN && cut.height===status.height && cut.root===status.root,"ESCROW_UNALIGNED_CUT");
    need(new Set(cut.covered).size===cut.covered.length && cut.covered.every(id=>ids.includes(id)),"ESCROW_CUT");
    let expected=0n;
    for(const [id,b] of Object.entries(s.credited)) if(cut.covered.includes(id)) expected+=micros(b.amount);
    for(const p of Object.values(s.payments)) if(p.txid && cut.covered.includes(p.txid)) expected-=BigInt(p.amount);
    if(expected!==micros(cut.balance)) {
      this.journal.append("reconciliation-quarantine",{height:cut.height,root:cut.root},s=>{
        s.halt="ASSET_LIABILITY_MISMATCH";s.quarantine[`${cut.height}:${cut.root}`]={observed:cut.balance,expectedMicros:String(expected)};
      });
      throw new Error("ESCROW_RECONCILIATION_MISMATCH");
    }
    invariant(s);
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
    const rk=c.actor+":"+c.key, fingerprint=digest(c), old=this.state().requests[rk];
    if(old) {need(old.fingerprint===fingerprint,"ESCROW_IDEMPOTENCY_CONFLICT"); return structuredClone(old.result);}
    this.validateCommand(c);
    // Cancel/expiry only reclassify obligations; no money leaves during pause/holds.
    const local=c.action==="cancel"||c.action==="expire";
    if(!local) { this.gate(); await this.fresh(); this.gate(); }
    const p=c.params; let result:unknown={ok:true};
    if(c.action==="detect") {
      exact(p,["intent","txid"]); const id=text(p.txid,64); need(/^[0-9a-f]{64}$/.test(id),"ESCROW_TXID");
      const s=this.state(),dep=s.deposits[text(p.intent,80)]; need(dep && dep.payer===c.actor,"ESCROW_DEPOSIT_INTENT");
      need(!dep.tx && !s.credited[id],"ESCROW_DEPOSIT_DUPLICATE");
      const o=await this.network.lookup(id); need(o,"ESCROW_UNKNOWN_DEPOSIT"); this.final(o,id);
      need(o.body.to===this.policy.wallet && o.body.from===dep.payer && o.body.amount===dep.amount && o.body.memo===`poadomains:${p.intent}`,"ESCROW_DEPOSIT_BINDING");
      need(!Object.values(s.credited).some(b=>(b.from===o.body.from&&b.nonce===o.body.nonce)||b.memo===o.body.memo),"ESCROW_DEPOSIT_DUPLICATE");
      this.gate(); await this.fresh(); this.gate();
      this.journal.append("deposit",{rk,fingerprint,id},s=>{
        need(this.enabled(),"ESCROW_DISABLED"); need(!s.paused,"ESCROW_PAUSED"); need(!s.halt,"ESCROW_HALTED");
        need(!s.requests[rk],"ESCROW_IDEMPOTENCY_CONFLICT");
        need(!s.credited[id] && !s.deposits[String(p.intent)]!.tx,"ESCROW_DEPOSIT_DUPLICATE");
        need(!Object.values(s.credited).some(b=>(b.from===o.body.from&&b.nonce===o.body.nonce)||b.memo===o.body.memo),"ESCROW_DEPOSIT_DUPLICATE");
        const d=s.deposits[String(p.intent)]!; d.tx=id;s.credited[id]=o.body;s.assets=String(BigInt(s.assets)+micros(d.amount));
        s.available[c.actor]=String(BigInt(s.available[c.actor]??"0")+micros(d.amount));
        s.requests[rk]={fingerprint,result};
      }); return result;
    }
    if(!local) { await this.reconcileAt(await this.fresh()); this.gate(); }
    this.journal.append(c.action,{rk,fingerprint,params:p},s=>{
      need(this.enabled(),"ESCROW_DISABLED");
      if(!local) { need(!s.paused,"ESCROW_PAUSED"); need(!s.halt,"ESCROW_HALTED"); }
      need(!s.requests[rk],"ESCROW_IDEMPOTENCY_CONFLICT");
      switch(c.action) {
        case "intent": {
          need(s.sequence<PILOT_ADMISSION_LIMIT,"ESCROW_JOURNAL_CAPACITY");
          exact(p,["amount"]); need(micros(p.amount)>0n,"ESCROW_AMOUNT");
          const id=digest([rk,c]); s.deposits[id]={payer:c.actor,amount:String(p.amount),tx:null,createdAt:this.now()}; result={intent:id,memo:`poadomains:${id}`,to:this.policy.wallet}; break;
        }
        case "list": case "open": {
          need(s.sequence<PILOT_ADMISSION_LIMIT,"ESCROW_JOURNAL_CAPACITY");
          const fixed=c.action==="list";exact(p,fixed?["name","price"]:["name","reserve"]); const reserve=String(fixed?p.price:p.reserve);const name=text(p.name,256), terms=this.titles.terms(name,c.actor);
          need(micros(reserve)>=micros(terms.reserve) && micros(reserve)<=micros(this.policy.perTx),"ESCROW_RESERVE");
          need(!Object.values(s.auctions).some(a=>a.name===name&&(a.status==="OPEN"||a.status==="SETTLING")),"ESCROW_TITLE_RESERVED");
          const id=digest([rk,c]); s.auctions[id]={id,name,seller:c.actor,reserve:String(micros(reserve)),kind:fixed?"fixed":"auction",createdAt:this.now(),history:[{event:fixed?"Listed for POA":"Auction opened",at:this.now()}],
            closes:this.now()+terms.window,quiet:terms.quiet,high:null,status:"OPEN"};result={auction:id};break;
        }
        case "buy": case "bid": {
          need(s.sequence<PILOT_JOURNAL_LIMIT-32,"ESCROW_JOURNAL_CAPACITY");
          exact(p,["auction","amount"]);const a=s.auctions[text(p.auction,64)]; need(a&&a.status==="OPEN"&&this.now()<a.closes,"ESCROW_AUCTION_CLOSED");
          need(c.action==="buy"?a.kind==="fixed"&&a.high===null:a.kind!=="fixed","ESCROW_MARKET_KIND");
          const n=micros(p.amount);if(c.action==="buy")need(n===BigInt(a.reserve),"ESCROW_PRICE");need(n<=micros(this.policy.perTx),"ESCROW_PAYOUT_LIMIT");need(c.actor!==a.seller,"ESCROW_SELF_SALE");need(a.high?.payer!==c.actor,"ESCROW_SELF_RAISE");
          // Existing strict >10% rule, in integer micros (not rounded decimal floats).
          need(n>=BigInt(a.reserve)&&(!a.high||n*10n>BigInt(a.high.amount)*11n),"ESCROW_BID_INCREMENT");
          need(BigInt(s.available[c.actor]??"0")>=n,"ESCROW_INSUFFICIENT_FUNDS");
          if(a.high) this.refund(s,`outbid-${a.id}-${rk}`,a.high.payer,a.high.amount);
          s.available[c.actor]=String(BigInt(s.available[c.actor]??"0")-n);a.high={payer:c.actor,amount:String(n)};
          (a.history??=[]).push({event:c.action==="buy"?"Purchase reserved; seller handover needed":"Bid placed",at:this.now(),amount:String(n)});a.history=a.history.slice(-100);
          a.closes=c.action==="buy"?this.now():Math.max(a.closes,this.now()+a.quiet);break;
        }
        case "cancel": case "expire": {
          exact(p,["auction"]);const a=s.auctions[text(p.auction,64)];need(a&&a.status==="OPEN","ESCROW_AUCTION_CLOSED");
          need(c.action==="cancel"?a.seller===c.actor:this.now()>=a.closes,"ESCROW_CANCEL_NOT_ALLOWED");
          // Expiry without a title consent is a failure refund, never silently pays a seller.
          if(a.high)this.refund(s,`cancel-${a.id}`,a.high.payer,a.high.amount);a.status="CANCELLED";(a.history??=[]).push({event:"Cancelled; original payer refund due",at:this.now()});break;
        }
        case "withdraw": {
          exact(p,["amount"]);const n=micros(p.amount);need(n<=micros(this.policy.perTx),"ESCROW_PAYOUT_LIMIT");need(n>0n&&BigInt(s.available[c.actor]??"0")>=n,"ESCROW_INSUFFICIENT_FUNDS");
          s.available[c.actor]=String(BigInt(s.available[c.actor]??"0")-n);this.refund(s,`withdraw-${rk}`,c.actor,String(n));break;
        }
        case "settle": {
          exact(p,["auction","transfer"]);const a=s.auctions[text(p.auction,64)];
          need(a&&a.status==="OPEN"&&a.high&&this.now()>=a.closes&&c.actor===a.seller,"ESCROW_SETTLE_NOT_ALLOWED");
          const packet=authenticate(p.transfer);this.titles.validate(packet,a.name,a.seller,a.high.payer);
          const fee=BigInt(a.high.amount)*BigInt(this.policy.feeBps)/10000n, net=BigInt(a.high.amount)-fee;
          const payments:string[]=[];
          for(const [kind,to,n] of [["seller",a.seller,net],["fee",this.policy.treasury,fee]] as const) if(n>0n){
            const id=`${kind}-${a.id}`;s.payments[id]={id,kind,to,amount:String(n),status:"READY",day:null,body:null,txid:null};payments.push(id);
          }
          (a.history??=[]).push({event:"Seller handover signed; settling",at:this.now()});a.status="SETTLING";s.settlements[a.id]={auction:a.id,packet,payments,status:"PAYING"};break;
        }
        case "repair-title": {
          exact(p,["auction","transfer"]);const a=s.auctions[text(p.auction,64)], st=s.settlements[String(p.auction)];
          need(a&&st&&a.status==="SETTLING"&&c.actor===a.seller,"ESCROW_TITLE_NOT_PENDING");
          const packet=authenticate(p.transfer);this.titles.validate(packet,a.name,a.seller,a.high!.payer);
          st.packet=packet;
          if(st.payments.every(id=>s.payments[id]!.status==="FINAL")){
            this.titles.commit(packet);st.status="COMPLETE";a.status="COMPLETE";(a.history??=[]).push({event:"Title repaired; handover complete",at:this.now()});
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
  /** One sender lane. Automatic UNKNOWN recovery is lookup-only; explicit rebroadcast retains exact bytes. */
  tick(): Promise<State> { return this.serial(async()=>{
    this.gate();const status=await this.fresh();this.gate();
    for(const a of Object.values(this.state().auctions)){
      if(a.status==="OPEN"&&((a.high===null&&this.now()>=a.closes)||(a.high!==null&&this.now()>=a.closes+a.quiet))){
        this.journal.append("auto-expire",{auction:a.id},s=>{
          need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
          const cur=s.auctions[a.id];if(!cur||cur.status!=="OPEN")return;
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
      try { this.titles.validate(st.packet,a.name,a.seller,a.high!.payer); valid=true; }
      catch {
        this.journal.append("title-pending",{auction:a.id},s=>{
          need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
          s.settlements[a.id]!.status="TITLE_PENDING";
        });
      }
      if(valid){
        this.journal.append("title-complete",{auction:a.id},s=>{
          need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
          this.titles.commit(st.packet);s.settlements[a.id]!.status="COMPLETE";s.auctions[a.id]!.status="COMPLETE";(s.auctions[a.id]!.history??=[]).push({event:"Payment and title complete",at:this.now()});
        });
      }
    }
    if(Object.values(this.state().payments).some(p=>p.status==="SIGNED"||p.status==="UNKNOWN"))return this.state();
    const rank={seller:0,fee:1,refund:2};
    const p=Object.values(this.state().payments).filter(p=>p.status==="READY").sort((a,b)=>rank[a.kind]-rank[b.kind]||a.id.localeCompare(b.id))[0];
    if(!p)return this.state();
    const day=new Date(this.now()).toISOString().slice(0,10);
    const lastOut=Object.values(this.state().payments).filter(x=>x.status==="FINAL"&&x.txid&&x.body).sort((a,b)=>b.body!.nonce-a.body!.nonce)[0]?.txid??undefined;
    const ctx=await this.network.context(this.policy.wallet,lastOut);this.gate();await this.fresh();this.gate();
    integer(ctx.nextNonce,1);integer(ctx.cutoff);need(ctx.parents.length===2 && new Set(ctx.parents).size===2,"ESCROW_PARENTS");
    const state=this.state();need(state.nonce===null||state.nonce===ctx.nextNonce,"ESCROW_NONCE_GAP");
    // All unresolved payments, even reserved on an earlier day, count against today's cap.
    const used=Object.values(state.payments).filter(x=>x.day!==null&&(x.day===day||x.status!=="FINAL")).reduce((n,x)=>n+BigInt(x.amount),0n);
    need(BigInt(p.amount)<=micros(this.policy.perTx)&&used+BigInt(p.amount)<=micros(this.policy.daily),"ESCROW_PAYOUT_LIMIT");
    const unsigned:Transfer={type:"transfer",cid:CHAIN,from:this.policy.wallet,to:p.to,amount:decimal(BigInt(p.amount)),memo:`poadomains:${digest(p.id)}`,
      nonce:ctx.nextNonce,parents:ctx.parents,ts:Math.max(Math.floor(this.now()/1000),ctx.cutoff+1)};
    const body=this.signer.transfer(unsigned);verifyTransfer(body);const id=txid(body);
    this.gate();this.journal.append("outgoing-intent",{id:p.id,txid:id},s=>{
      need(this.enabled(),"ESCROW_DISABLED");need(!s.paused,"ESCROW_PAUSED");need(!s.halt,"ESCROW_HALTED");
      need(s.nonce===null||s.nonce===ctx.nextNonce,"ESCROW_NONCE_GAP");
      const currentUsed=Object.values(s.payments).filter(x=>x.day!==null&&(x.day===day||x.status!=="FINAL")).reduce((n,x)=>n+BigInt(x.amount),0n);
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
    const ctx=await this.network.context(this.policy.wallet,lastOut);this.gate();await this.fresh();this.gate();
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

export interface EscrowArchive { policy: Policy; rows: Entry[]; }
/** Financial rows go inside the encrypted backup envelope, not the public registry journal. */
export function exportEscrow(storage: DurableObjectStorage): EscrowArchive | undefined {
  const sql=storage.sql;
  if(!sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='escrow_policy'").toArray().length)return undefined;
  const saved=sql.exec<{value:string}>("SELECT value FROM escrow_policy WHERE id=1").toArray()[0];if(!saved)return undefined;
  const policy=JSON.parse(saved.value) as Policy,rows=new SQLiteEscrowJournal(storage,policy).rows();replay(rows,policy);
  const archive:EscrowArchive={policy,rows};
  need(!/PRIVATE KEY|POA_ESCROW_KEY/.test(canonical(archive)),"ESCROW_SECRET_LEAK");
  return archive;
}
/** Caller must restrict this to an isolated local restore target. No key is present in this archive. */
export function restoreEscrow(storage: DurableObjectStorage, archive?: EscrowArchive): void {
  if(archive){
    const a=exact(archive,["policy","rows"]);
    need(Array.isArray(a.rows),"ESCROW_JOURNAL_CORRUPT");
    replay(a.rows as Entry[],a.policy as Policy);
  }
  storage.transactionSync(()=>{
    storage.sql.exec("DROP TABLE IF EXISTS escrow_journal; DROP TABLE IF EXISTS escrow_policy");
    if(archive){const j=new SQLiteEscrowJournal(storage,archive.policy);
      for(const row of archive.rows)storage.sql.exec("INSERT INTO escrow_journal(sequence,record) VALUES(?,?)",row.sequence,canonical(row));
      j.append("restore-paused",{},s=>{s.paused=true;s.halt="RESTORED_ARCHIVE_READ_ONLY";});
    }
  });
}
