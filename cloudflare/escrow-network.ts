/** Fixed-origin native transport. Public node data is explicitly trusted, not a consensus verifier. */
import { DisplayReadError, type ReadTiming } from "./display-freshness.js";
import { integer, need } from "../src/core.js";
import { CHAIN, Transfer, address, digest, micros, txid, verifyTransfer } from "./escrow-codec.js";
import { Context, Cut, Network, Observation, Status } from "./escrow.js";
export const MAINNET_ENGINE_SHA256 = "e01abd959dd0439dd89af8e8c187d1bed3897deb2a855a615e7dfa2d0222f1fb";
export const MAINNET_PARAMS_SHA256 = "6a5451ccd3109bb861e12dc31788fe368e0f974f89c41b1e4c8bfab178101101";
export const PILOT_PER_TX = "250000.000000";
export const PILOT_DAILY = "1000000.000000";
/** K=5 peer attestations: the same threshold Escrow.final() requires for open-window money. */
const PEER_FINAL_ATTESTATIONS = 5;
export class PoaHttpNetwork implements Network {
  private lastHeight?: number;
  private lastCutoff?: number;
  constructor(private writesAllowed:()=>boolean, private request:typeof fetch=fetch,
    private pins:{engine:string;params:string}={engine:MAINNET_ENGINE_SHA256,params:MAINNET_PARAMS_SHA256},
    private clock:()=>number=Date.now, private apiToken?:string) {
    // Native workerd fetch requires its global receiver, not this network adapter.
    // Arrow-function mocks and already-bound injected clients retain their behavior.
    this.request=request.bind(globalThis);
  }
  /** PoA now requires an account token on most chain routes. Sent only as a header to the fixed
   * minepoa.com origin (never in a URL, never on redirects), and only when a token is configured. */
  private headers(base:Record<string,string>):Record<string,string> {
    const t=this.apiToken?.trim();return t?{...base,Authorization:`Bearer ${t}`}:base;
  }
  private async get(path:string, limit=2000000, displaySignal?:AbortSignal):Promise<any> {
    const r=await this.request(`https://minepoa.com${path}`,{signal:displaySignal ?? AbortSignal.timeout(12000),redirect:"manual",headers:this.headers({Accept:"application/json"})});
    // workerd supports manual, not error. Never follow a redirected node URL.
    if(r.status>=300&&r.status<400){await r.body?.cancel();throw new Error("ESCROW_NODE_REDIRECT");}
    if(r.status===404)return null;
    if(r.status===401||r.status===403){await r.body?.cancel();throw new Error("ESCROW_NODE_AUTH");}
    need(r.ok,"ESCROW_NODE_HTTP");
    const age=r.headers.get("age");if(age!==null)need(/^\d+$/.test(age)&&Number(age)<=120,"ESCROW_STALE");
    const reader=r.body!.getReader();let size=0;const chunks:Uint8Array[]=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>limit){await reader.cancel();throw new Error("ESCROW_NODE_RESPONSE_LIMIT");}chunks.push(value);}}
    finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  }
  private async getFirst(paths:string[], limit=2000000, displaySignal?:AbortSignal):Promise<any> {
    return (await this.getFirstTracked(paths,limit,displaySignal)).value;
  }
  /** Same as getFirst, but also reports whether an earlier path was refused (401/403) before a fallback answered. */
  private async getFirstTracked(paths:string[], limit=2000000, displaySignal?:AbortSignal):Promise<{value:any;refused:boolean}> {
    let lastErr:unknown;let refused=false;
    for(const path of paths){
      try{const v=await this.get(path,limit,displaySignal);if(v!==null)return {value:v,refused};}
      catch(e){
        if(e instanceof Error&&e.message==="ESCROW_NODE_AUTH"){refused=true;lastErr=e;continue;}
        if(e instanceof Error&&e.message==="ESCROW_NODE_HTTP"){lastErr=e;continue;}
        throw e;
      }
    }
    if(lastErr)throw lastErr;
    return {value:null,refused};
  }
  async status():Promise<Status> { return this.readStatus(false); }
  /** Read-only observation using the SAME protocol and rollback checks.
   * A little transport/processing grace avoids labelling slow successful reads stale.
   * The uncached financial path retains its exact 12s deadline and every pin/age check. */
  displayStatus():Promise<Status> {
    return this.readStatus(true);
  }
  private async readStatus(display:boolean):Promise<Status> {
    const started=integer(this.clock());
    const timing:ReadTiming={statusMs:null,factsMs:null,totalMs:0};
    const displaySignal=display?AbortSignal.timeout(15000):undefined;
    const read=async(paths:string[],kind:"statusMs"|"factsMs")=>{
      try{return await this.getFirst(paths,2000000,displaySignal);}
      finally{if(display)timing[kind]=Math.max(0,this.clock()-started);}
    };
    try {
      // If PoA refuses the chain status route, its public summary is not a substitute: it is a
      // stale digest without a chain id. Hold honestly as "ledger locked" (ESCROW_NODE_AUTH)
      // instead of reporting a misleading network-identity mismatch.
      const statusRead=(async()=>{
        try{
          const r=await this.getFirstTracked([`/chain/${CHAIN}/api/status`,"/api/status"],2000000,displaySignal);
          if(r.refused&&!(r.value&&typeof r.value==="object"&&r.value.chain_id===CHAIN))throw new Error("ESCROW_NODE_AUTH");
          return r.value;
        }finally{if(display)timing.statusMs=Math.max(0,this.clock()-started);}
      })();
      const pending=[statusRead,
        read([`/chain/${CHAIN}/api/network-facts`,"/api/network-facts","/api/network/facts"],"factsMs")];
      let s:any,f:any;
      if(display){
        // Wait for BOTH reads to settle, including a failed sibling. A completed
        // display probe must not leave an old upstream request behind the cache.
        const settled=await Promise.allSettled(pending);
        const failure=settled.find(v=>v.status==="rejected");
        if(failure?.status==="rejected")throw failure.reason;
        [s,f]=settled.map(v=>(v as PromiseFulfilledResult<any>).value);
      }else [s,f]=await Promise.all(pending);
      const observedAt=integer(this.clock());
      need(observedAt>=started && (display || observedAt-started<=12000),"ESCROW_STALE");
    need(f?.chain_id===CHAIN&&s?.K===5&&(s.chain_id===undefined||s.chain_id===CHAIN),"ESCROW_NODE_CHAIN");
    if(f.economics?.K!==undefined)need(integer(f.economics.K)===5,"ESCROW_NODE_CHAIN");
    if(s.epochs_closed!==undefined&&f.open_epoch!==undefined)need(integer(s.epochs_closed)===integer(f.open_epoch),"ESCROW_UNALIGNED_CUT");
    if(s.txs!==undefined&&s.final!==undefined)need(integer(s.final)<=integer(s.txs),"ESCROW_NODE_CHAIN");
    need(this.pins && /^[0-9a-f]{64}$/.test(this.pins.engine) && /^[0-9a-f]{64}$/.test(this.pins.params),"ESCROW_PROTOCOL_UNPINNED");
    need(f.engine_sha256===this.pins.engine && f.params_sha256===this.pins.params,"ESCROW_PROTOCOL_CHANGED");
    const cpHeight=s.checkpoint&&typeof s.checkpoint==="object"&&s.checkpoint.height!==undefined?integer(s.checkpoint.height):undefined;
    const topHeight=s.checkpoint_height!==undefined?integer(s.checkpoint_height):undefined;
    if(cpHeight!==undefined&&topHeight!==undefined)need(cpHeight===topHeight,"ESCROW_CHECKPOINT");
    const height=integer(cpHeight??topHeight);
    const cutoff=s.checkpoint&&typeof s.checkpoint==="object"&&s.checkpoint.cutoff_ts!==undefined?integer(s.checkpoint.cutoff_ts):undefined;
    if(cutoff!==undefined)need(cutoff*1000<=observedAt+300000,"ESCROW_FUTURE_CHECKPOINT");
    if(this.lastHeight!==undefined)need(height>=this.lastHeight,"ESCROW_CHECKPOINT_ROLLBACK");
    if(cutoff!==undefined&&this.lastCutoff!==undefined)need(cutoff>=this.lastCutoff&&(height!==this.lastHeight||cutoff===this.lastCutoff),"ESCROW_CHECKPOINT_ROLLBACK");
    const age=s.stale_age_s;
    const ageInvalid=age!==undefined&&(!Number.isSafeInteger(age)||age<0||age>120);
    const hasExplicitFreshness=s.as_of!==undefined||s.stale!==undefined;
    const asOf=typeof s.as_of==="string"?Date.parse(s.as_of):(!hasExplicitFreshness&&cutoff!==undefined&&observedAt-cutoff*1000<=43200000?observedAt:Number.NaN);
    const stale=(hasExplicitFreshness?s.stale!==false:false) || !Number.isSafeInteger(asOf) ||
      asOf>observedAt+5000 || observedAt-asOf>120000 || ageInvalid;
    need(!stale,"ESCROW_STALE");
    this.lastHeight=height;if(cutoff!==undefined)this.lastCutoff=cutoff;
    const root=typeof s.state_root==="string"&&/^[0-9a-f]{64}$/.test(s.state_root)?s.state_root:(cutoff!==undefined?digest(["poa-checkpoint-cut/v1",CHAIN,height,cutoff]):"");
    return {chain:f.chain_id,asOf,stale,height,root, ...(cutoff!==undefined?{cutoff}:{}),
      // Native transfers are documented fee-free; if exposed, a contrary node fee fails closed.
      fee:s.transfer_fee ?? "0.000000", ...(display?{readTiming:{...timing,totalMs:Math.max(0,this.clock()-started)}}:{})};
    } catch(error) {
      if(display)throw new DisplayReadError(error,{...timing,totalMs:Math.max(0,this.clock()-started)});
      throw error;
    }
  }
  async lookup(id:string):Promise<Observation|null> { return (await this.observe(id))?.o??null; }
  /** Lookup plus which receipt shape answered (legacy carries from/type and validity flags). */
  private async observe(id:string):Promise<{o:Observation;legacy:boolean;receipt:any}|null> {
    need(/^[0-9a-f]{64}$/.test(id),"ESCROW_TXID");
    const [t,r]=await Promise.all([
      this.getFirst([`/api/explorer/tx/${id}`,`/chain/${CHAIN}/api/explorer/tx/${id}`]),
      this.getFirst([`/chain/${CHAIN}/api/receipt/${id}`,`/api/receipt/${id}`]),
    ]);
    if(!t||!r)return null;
    need(typeof t==="object"&&typeof r==="object","ESCROW_TX_BINDING");
    need(t.id===id&&r.txid===id,"ESCROW_TX_BINDING");verifyTransfer(t.body);
    if(r.height!==undefined)integer(r.height);
    // PoA's receipt now carries only {txid, ts, status, height}. Sender/type/finality are bound
    // from the explorer record; legacy receipt fields, when present, must still agree exactly.
    const legacy=r.from!==undefined||r.type!==undefined;
    if(legacy)need(r.from===t.body.from&&r.type==="transfer","ESCROW_RECEIPT_BINDING");
    else need(t.type==="transfer"&&t.from_addr===t.body.from,"ESCROW_RECEIPT_BINDING");
    if(t.type!==undefined)need(t.type==="transfer"&&t.body.type==="transfer","ESCROW_RECEIPT_BINDING");
    if(t.from_addr!==undefined)need(t.from_addr===t.body.from,"ESCROW_RECEIPT_BINDING");
    if(t.to_addr!==undefined)need(t.to_addr===t.body.to,"ESCROW_RECEIPT_BINDING");
    if(t.amount!==undefined)need(typeof t.amount==="string"&&micros(t.amount)===micros(t.body.amount),"ESCROW_RECEIPT_BINDING");
    if(t.memo!==undefined)need(t.memo===t.body.memo,"ESCROW_RECEIPT_BINDING");
    const attestations=integer(t.atts);
    let checkpoint:Observation["checkpoint"]=null;
    if(r.checkpoint_covered===true){
      // Explicit node-trust mode: receipt coverage + a matching current checkpoint cut.
      // This is not independent quorum/anchor proof verification and must not be called that.
      const s=await this.status(),height=t.finality?.height??t.checkpointed?.height??t.checkpoint_height;
      if(Number.isSafeInteger(height)&&height>=0&&height<=s.height&&!s.stale)checkpoint={height:s.height,root:s.root,anchored:true,quorum:5};
    }
    const legacyValid=r.valid_in_open_window===true||r.checkpoint_covered===true;
    // New receipt shape: only an explorer-final record with peer-final attestations counts.
    const explorerFinal=(t.final===1||t.final===true)&&attestations>=PEER_FINAL_ATTESTATIONS;
    return {o:{id,body:t.body,chain:t.body.cid,valid:r.status==="included"&&(legacyValid||explorerFinal),
      attestations,checkpoint},legacy,receipt:r};
  }
  async cut(wallet:string,ids:string[],status:Status):Promise<Cut> {
    address(wallet);const b=await this.getFirst([`/api/explorer/address/${wallet}`,`/chain/${CHAIN}/api/explorer/address/${wallet}`]);
    need(b?.address===wallet&&b.balance_as_of?.checkpoint_height===status.height,"ESCROW_UNALIGNED_CUT");
    const covered:string[]=[];
    for(const id of ids){
      const seen=await this.observe(id),o=seen?.o;
      if(o?.checkpoint){need(o.checkpoint.height<=status.height,"ESCROW_UNALIGNED_CUT");covered.push(id);}
      else if(seen&&!seen.legacy){
        // Current receipt shape (no checkpoint_covered). Coverage is the pinned engine's own
        // predicate for the checkpoint this balance is "as of": a tx is baked into checkpoint state
        // iff body.ts < cutoff.ts (same-second ties need the cutoff tx's txCmp order, which we do
        // not have, so they hold). Only peer-final (K=5 attested) money counts as baked; anything
        // under the cutoff that is not peer-final is ambiguous and holds.
        need(status.cutoff!==undefined,"ESCROW_CHECKPOINT_DETAILS_REQUIRED");
        const cutoff=integer(status.cutoff),ts=integer(o!.body.ts,1);
        if(ts>cutoff)continue;
        need(ts<cutoff&&o!.valid===true&&o!.attestations>=PEER_FINAL_ATTESTATIONS,"ESCROW_CHECKPOINT_DETAILS_REQUIRED");
        covered.push(id);
      }
      else if(o&&o.attestations>=PEER_FINAL_ATTESTATIONS){
        // Legacy receipt: peer-final open-window money is excluded from checkpoint-only
        // reconciliation only on an explicit checkpoint_covered:false.
        const r=await this.getFirst([`/chain/${CHAIN}/api/receipt/${id}`,`/api/receipt/${id}`]);
        need(r?.txid===id&&r.status==="included","ESCROW_TX_BINDING");
        need(r.checkpoint_covered===false,"ESCROW_CHECKPOINT_DETAILS_REQUIRED");
      }
    }
    const after=await this.status();need(after.height===status.height&&after.root===status.root&&!after.stale,"ESCROW_UNALIGNED_CUT");
    return {chain:CHAIN,height:status.height,root:status.root,balance:b.balance,covered};
  }
  async context(wallet:string, knownTxid?:string):Promise<Context> {
    address(wallet);
    const s=await this.status();
    let cutoff=s.cutoff;
    if(cutoff===undefined){
      // Bounded snapshot fallback when status does not include checkpoint.cutoff_ts.
      const snap=await this.getFirst([`/chain/${CHAIN}/api/snapshot`,"/api/snapshot"],8000000);
      need(snap?.params?.chain_id===CHAIN&&snap.checkpoint,"ESCROW_CONTEXT_UNAVAILABLE");
      cutoff=integer(snap.checkpoint.cutoff?.ts);
    }
    const own=await this.getFirst([`/api/explorer/address/${wallet}`,`/chain/${CHAIN}/api/explorer/address/${wallet}`]);
    need(own?.address===wallet&&Array.isArray(own.txs),"ESCROW_NONCE_CONTEXT");
    // "Most recent outgoing tx" is only meaningful on a newest-first listing; anything else holds.
    for(let i=1;i<own.txs.length;i++)need(Number.isSafeInteger(own.txs[i]?.ts)&&Number.isSafeInteger(own.txs[i-1]?.ts)&&own.txs[i].ts<=own.txs[i-1].ts,"ESCROW_NONCE_CONTEXT");
    const explorerTxId=own.txs.find((t:any)=>t?.from_addr===wallet)?.id;
    const candidateIds=[explorerTxId,knownTxid].filter((x):x is string=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x));
    need(candidateIds.length>0,"ESCROW_ENROLLED_SENDER_REQUIRED");
    const first=await this.getFirst([`/chain/${CHAIN}/api/receipt/${candidateIds[0]}`,`/api/receipt/${candidateIds[0]}`]);
    const legacy=first!==null&&typeof first==="object"&&(first.from!==undefined||first.next_nonce!==undefined);
    const nextNonce=legacy?await this.legacyNonce(wallet,candidateIds):await this.explorerNonce(wallet,own.txs,knownTxid);
    const list=await this.getFirst(["/api/explorer/txs",`/chain/${CHAIN}/api/explorer/txs`]);
    need(Array.isArray(list),"ESCROW_PARENTS");const parents:string[]=[];
    for(const t of list.slice(0,8)){
      if(!t||typeof t!=="object"||typeof t.id!=="string"||!/^[0-9a-f]{64}$/.test(t.id)||parents.includes(t.id))continue;
      const receipt=await this.getFirst([`/chain/${CHAIN}/api/receipt/${t.id}`,`/api/receipt/${t.id}`]);
      if(!(receipt?.txid===t.id&&receipt.status==="included"))continue;
      const legacyOk=receipt.valid_in_open_window===true||receipt.checkpoint_covered===true;
      // Current receipt shape: the explorer listing must show the parent final.
      const explorerOk=receipt.from===undefined&&receipt.valid_in_open_window===undefined&&receipt.checkpoint_covered===undefined&&(t.final===1||t.final===true);
      if(legacyOk||explorerOk)parents.push(t.id);
      if(parents.length===2)break;
    }
    need(parents.length===2,"ESCROW_PARENTS");return {nextNonce,parents,cutoff};
  }
  /** Legacy receipts: the node's next_nonce for the wallet's own included txs. */
  private async legacyNonce(wallet:string,candidateIds:string[]):Promise<number> {
    let nextNonce=0;
    for(const txId of new Set(candidateIds)){
      const r=await this.getFirst([`/chain/${CHAIN}/api/receipt/${txId}`,`/api/receipt/${txId}`]);
      need(r?.status==="included"&&r.from===wallet&&(r.valid_in_open_window===true||r.checkpoint_covered===true),"ESCROW_NONCE_CONTEXT");
      nextNonce=Math.max(nextNonce,integer(r.next_nonce,1));
    }
    return nextNonce;
  }
  /** Current receipts carry no next_nonce. The pinned engine/client build a tx with
   * nonce = (sender's last consumed nonce) + 1, so take the wallet's most recent outgoing tx from
   * the explorer address view and require it to be (a) the same tx our journal last finalized,
   * when we have one, (b) bound to its id by body hash and to this wallet, (c) included and
   * peer-final, so its nonce was consumed. Any gap, reorder, foreign spend or pending tx holds. */
  private async explorerNonce(wallet:string,txs:any[],knownTxid?:string):Promise<number> {
    const latest=txs.find((t:any)=>t?.from_addr===wallet);
    need(latest&&typeof latest.id==="string"&&/^[0-9a-f]{64}$/.test(latest.id),"ESCROW_ENROLLED_SENDER_REQUIRED");
    if(knownTxid!==undefined)need(latest.id===knownTxid,"ESCROW_NONCE_CONTEXT");
    const id=latest.id;
    const [t,r]=await Promise.all([
      this.getFirst([`/api/explorer/tx/${id}`,`/chain/${CHAIN}/api/explorer/tx/${id}`]),
      this.getFirst([`/chain/${CHAIN}/api/receipt/${id}`,`/api/receipt/${id}`]),
    ]);
    need(t&&typeof t==="object"&&r&&typeof r==="object","ESCROW_NONCE_CONTEXT");
    need(r.txid===id&&r.status==="included"&&r.from===undefined&&r.next_nonce===undefined,"ESCROW_NONCE_CONTEXT");
    const body=t.body;
    need(t.id===id&&body&&typeof body==="object"&&!Array.isArray(body)&&txid(body)===id,"ESCROW_NONCE_CONTEXT");
    need(body.from===wallet&&t.from_addr===wallet&&body.cid===CHAIN&&typeof body.type==="string"&&t.type===body.type,"ESCROW_NONCE_CONTEXT");
    if(body.type==="transfer")verifyTransfer(body);
    need((t.final===1||t.final===true)&&integer(t.atts)>=PEER_FINAL_ATTESTATIONS,"ESCROW_NONCE_CONTEXT");
    return integer(body.nonce,1)+1;
  }
  async submit(body:Transfer):Promise<void> {
    need(this.writesAllowed(),"ESCROW_NETWORK_WRITES_DISABLED");verifyTransfer(body);
    const r=await this.request(`https://minepoa.com/chain/${CHAIN}/api/submit`,{method:"POST",redirect:"manual",signal:AbortSignal.timeout(12000),
      headers:this.headers({"content-type":"application/json"}),body:JSON.stringify({kind:"tx",body})});
    // The service always resolves submission by tx lookup, including 202 and 4xx. No retries here.
    await r.body?.cancel();
    need(r.status<300||r.status>=400,"ESCROW_NODE_REDIRECT");
  }
}
