/** Fixed-origin native transport. Public node data is explicitly trusted, not a consensus verifier. */
import { integer, need } from "../src/core.js";
import { CHAIN, Transfer, address, digest, verifyTransfer } from "./escrow-codec.js";
import { Context, Cut, Network, Observation, Status } from "./escrow.js";
export const MAINNET_ENGINE_SHA256 = "4e1f5c41dda9fda8939d92ffd6e9c2f05b66b4b8f1c5ff271960ea18b7bc6aa5";
export const MAINNET_PARAMS_SHA256 = "82f994768b0bd7d430226147bfe90aad5aff1d4a50eae0400e8a950cb4416348";
export const PILOT_PER_TX = "250000.000000";
export const PILOT_DAILY = "1000000.000000";
export class PoaHttpNetwork implements Network {
  private lastHeight?: number;
  private lastCutoff?: number;
  constructor(private writesAllowed:()=>boolean, private request:typeof fetch=fetch,
    private pins:{engine:string;params:string}={engine:MAINNET_ENGINE_SHA256,params:MAINNET_PARAMS_SHA256},
    private clock:()=>number=Date.now) {
    // Native workerd fetch requires its global receiver, not this network adapter.
    // Arrow-function mocks and already-bound injected clients retain their behavior.
    this.request=request.bind(globalThis);
  }
  private async get(path:string, limit=2000000):Promise<any> {
    const r=await this.request(`https://minepoa.com${path}`,{signal:AbortSignal.timeout(12000),redirect:"manual",headers:{Accept:"application/json"}});
    // workerd supports manual, not error. Never follow a redirected node URL.
    if(r.status>=300&&r.status<400){await r.body?.cancel();throw new Error("ESCROW_NODE_REDIRECT");}
    if(r.status===404)return null;need(r.ok,"ESCROW_NODE_HTTP");
    const age=r.headers.get("age");if(age!==null)need(/^\d+$/.test(age)&&Number(age)<=120,"ESCROW_STALE");
    const reader=r.body!.getReader();let size=0;const chunks:Uint8Array[]=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>limit){await reader.cancel();throw new Error("ESCROW_NODE_RESPONSE_LIMIT");}chunks.push(value);}}
    finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  }
  private async getFirst(paths:string[], limit=2000000):Promise<any> {
    for(const path of paths){const v=await this.get(path,limit);if(v!==null)return v;}
    return null;
  }
  async status():Promise<Status> {
    const started=integer(this.clock());
    const [s,f]=await Promise.all([
      this.getFirst([`/chain/${CHAIN}/api/status`,"/api/status"]),
      this.getFirst([`/chain/${CHAIN}/api/network-facts`,"/api/network-facts","/api/network/facts"]),
    ]);
    const observedAt=integer(this.clock());
    need(observedAt>=started && observedAt-started<=12000,"ESCROW_STALE");
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
    // A fetched checkpoint is not evidence of a fresh source snapshot. Never
    // manufacture source time from our clock (including when Age is absent).
    const asOf=typeof s.as_of==="string"?Date.parse(s.as_of):Number.NaN;
    const age=s.stale_age_s;
    const stale=s.stale!==false || !Number.isSafeInteger(asOf) ||
      asOf>observedAt+5000 || observedAt-asOf>120000 ||
      (age!==undefined&&(!Number.isSafeInteger(age)||age<0||age>120));
    need(!stale,"ESCROW_STALE");
    this.lastHeight=height;if(cutoff!==undefined)this.lastCutoff=cutoff;
    const root=typeof s.state_root==="string"&&/^[0-9a-f]{64}$/.test(s.state_root)?s.state_root:(cutoff!==undefined?digest(["poa-checkpoint-cut/v1",CHAIN,height,cutoff]):"");
    return {chain:f.chain_id,asOf,stale,height,root, ...(cutoff!==undefined?{cutoff}:{}),
      // Native transfers are documented fee-free; if exposed, a contrary node fee fails closed.
      fee:s.transfer_fee ?? "0.000000"};
  }
  async lookup(id:string):Promise<Observation|null> {
    need(/^[0-9a-f]{64}$/.test(id),"ESCROW_TXID");
    const [t,r]=await Promise.all([
      this.getFirst([`/chain/${CHAIN}/api/explorer/tx/${id}`,`/api/explorer/tx/${id}`]),
      this.getFirst([`/chain/${CHAIN}/api/receipt/${id}`,`/api/receipt/${id}`]),
    ]);
    if(!t||!r)return null;need(t.id===id&&r.txid===id,"ESCROW_TX_BINDING");verifyTransfer(t.body);
    need(r.from===t.body.from&&r.type==="transfer","ESCROW_RECEIPT_BINDING");
    let checkpoint:Observation["checkpoint"]=null;
    if(r.checkpoint_covered===true){
      // Explicit node-trust mode: receipt coverage + a matching current checkpoint cut.
      // This is not independent quorum/anchor proof verification and must not be called that.
      const s=await this.status(),height=t.finality?.height??t.checkpointed?.height??t.checkpoint_height;
      if(Number.isSafeInteger(height)&&height>=0&&height<=s.height&&!s.stale)checkpoint={height:s.height,root:s.root,anchored:true,quorum:5};
    }
    return {id,body:t.body,chain:t.body.cid,valid:r.status==="included"&&(r.valid_in_open_window===true||r.checkpoint_covered===true),
      attestations:integer(t.atts),checkpoint};
  }
  async cut(wallet:string,ids:string[],status:Status):Promise<Cut> {
    address(wallet);const b=await this.getFirst([`/chain/${CHAIN}/api/explorer/address/${wallet}`,`/api/explorer/address/${wallet}`]);
    need(b?.address===wallet&&b.balance_as_of?.checkpoint_height===status.height,"ESCROW_UNALIGNED_CUT");
    const covered:string[]=[];
    for(const id of ids){
      const o=await this.lookup(id);
      if(o?.checkpoint){need(o.checkpoint.height<=status.height,"ESCROW_UNALIGNED_CUT");covered.push(id);}
      else if(o&&o.attestations>=5){
        // Peer-final open-window money is deliberately excluded from checkpoint-only reconciliation.
        const r=await this.getFirst([`/chain/${CHAIN}/api/receipt/${id}`,`/api/receipt/${id}`]);
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
    const own=await this.getFirst([`/chain/${CHAIN}/api/explorer/address/${wallet}`,`/api/explorer/address/${wallet}`]);
    const explorerTxId=own?.txs?.find((t:any)=>t.from_addr===wallet)?.id;
    const candidateIds=[explorerTxId,knownTxid].filter((x):x is string=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x));
    need(candidateIds.length>0,"ESCROW_ENROLLED_SENDER_REQUIRED");
    let nextNonce=0;
    for(const txId of new Set(candidateIds)){
      const r=await this.getFirst([`/chain/${CHAIN}/api/receipt/${txId}`,`/api/receipt/${txId}`]);
      need(r?.status==="included"&&r.from===wallet&&(r.valid_in_open_window===true||r.checkpoint_covered===true),"ESCROW_NONCE_CONTEXT");
      nextNonce=Math.max(nextNonce,integer(r.next_nonce,1));
    }
    const list=await this.getFirst([`/chain/${CHAIN}/api/explorer/txs`,"/api/explorer/txs"]);
    need(Array.isArray(list),"ESCROW_PARENTS");const parents:string[]=[];
    for(const t of list.slice(0,8)){
      if(!/^[0-9a-f]{64}$/.test(t.id))continue;
      const receipt=await this.getFirst([`/chain/${CHAIN}/api/receipt/${t.id}`,`/api/receipt/${t.id}`]);
      if(receipt?.txid===t.id&&receipt.status==="included"&&(receipt.valid_in_open_window===true||receipt.checkpoint_covered===true))parents.push(t.id);
      if(parents.length===2)break;
    }
    need(parents.length===2,"ESCROW_PARENTS");return {nextNonce,parents,cutoff};
  }
  async submit(body:Transfer):Promise<void> {
    need(this.writesAllowed(),"ESCROW_NETWORK_WRITES_DISABLED");verifyTransfer(body);
    const r=await this.request(`https://minepoa.com/chain/${CHAIN}/api/submit`,{method:"POST",redirect:"manual",signal:AbortSignal.timeout(12000),
      headers:{"content-type":"application/json"},body:JSON.stringify({kind:"tx",body})});
    // The service always resolves submission by tx lookup, including 202 and 4xx. No retries here.
    await r.body?.cancel();
    need(r.status<300||r.status>=400,"ESCROW_NODE_REDIRECT");
  }
}
