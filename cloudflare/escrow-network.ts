/** Fixed-origin native transport. Public node data is explicitly trusted, not a consensus verifier. */
import { integer, need } from "../src/core.js";
import { CHAIN, Transfer, address, verifyTransfer } from "./escrow-codec.js";
import { Context, Cut, Network, Observation, Status } from "./escrow.js";
export class PoaHttpNetwork implements Network {
  constructor(private writesAllowed:()=>boolean, private request:typeof fetch=fetch, private pins?:{engine:string;params:string}) {}
  private async get(path:string, limit=2000000):Promise<any> {
    const r=await this.request(`https://minepoa.com${path}`,{signal:AbortSignal.timeout(12000),redirect:"error",headers:{Accept:"application/json"}});
    if(r.status===404)return null;need(r.ok,"ESCROW_NODE_HTTP");
    const reader=r.body!.getReader();let size=0;const chunks:Uint8Array[]=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>limit){await reader.cancel();throw new Error("ESCROW_NODE_RESPONSE_LIMIT");}chunks.push(value);}}
    finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  }
  async status():Promise<Status> {
    const [s,f]=await Promise.all([this.get("/api/status"),this.get("/api/network/facts")]);
    need(f?.chain_id===CHAIN&&s?.K===5&&(s.chain_id===undefined||s.chain_id===CHAIN),"ESCROW_NODE_CHAIN");
    need(this.pins && /^[0-9a-f]{64}$/.test(this.pins.engine) && /^[0-9a-f]{64}$/.test(this.pins.params),"ESCROW_PROTOCOL_UNPINNED");
    need(f.engine_sha256===this.pins.engine && f.params_sha256===this.pins.params,"ESCROW_PROTOCOL_CHANGED");
    return {chain:f.chain_id,asOf:Date.parse(s.as_of),stale:s.stale,height:s.checkpoint_height,root:s.state_root,
      // Native transfers are documented fee-free; if exposed, a contrary node fee fails closed.
      fee:s.transfer_fee ?? "0.000000"};
  }
  async lookup(id:string):Promise<Observation|null> {
    need(/^[0-9a-f]{64}$/.test(id),"ESCROW_TXID");
    const [t,r]=await Promise.all([this.get(`/api/explorer/tx/${id}`),this.get(`/api/receipt/${id}`)]);
    if(!t||!r)return null;need(t.id===id&&r.txid===id,"ESCROW_TX_BINDING");verifyTransfer(t.body);
    need(r.from===t.body.from&&r.type==="transfer","ESCROW_RECEIPT_BINDING");
    let checkpoint:Observation["checkpoint"]=null;
    if(r.checkpoint_covered===true){
      // Explicit node-trust mode: receipt coverage + a matching current checkpoint cut.
      // This is not independent quorum/anchor proof verification and must not be called that.
      const s=await this.status(),height=t.finality?.height??t.checkpoint_height;
      if(height===s.height&&!s.stale)checkpoint={height,root:s.root,anchored:true,quorum:5};
    }
    return {id,body:t.body,chain:t.body.cid,valid:r.status==="included"&&(r.valid_in_open_window===true||r.checkpoint_covered===true),
      attestations:integer(t.atts),checkpoint};
  }
  async cut(wallet:string,ids:string[],status:Status):Promise<Cut> {
    address(wallet);const b=await this.get(`/api/explorer/address/${wallet}`);
    need(b?.address===wallet&&b.balance_as_of?.checkpoint_height===status.height,"ESCROW_UNALIGNED_CUT");
    const covered:string[]=[];
    for(const id of ids){
      const o=await this.lookup(id);
      if(o?.checkpoint){need(o.checkpoint.height<=status.height,"ESCROW_UNALIGNED_CUT");covered.push(id);}
      else if(o&&o.attestations>=5){
        // Peer-final open-window money is deliberately excluded from checkpoint-only reconciliation.
        const r=await this.get(`/api/receipt/${id}`);need(r.checkpoint_covered===false,"ESCROW_CHECKPOINT_DETAILS_REQUIRED");
      }
    }
    const after=await this.status();need(after.height===status.height&&after.root===status.root&&!after.stale,"ESCROW_UNALIGNED_CUT");
    return {chain:CHAIN,height:status.height,root:status.root,balance:b.balance,covered};
  }
  async context(wallet:string):Promise<Context> {
    address(wallet);
    // Bounded snapshot is used only for the checkpoint cutoff; the public engine is never imported/executed.
    // Large/unsupported snapshots fail closed rather than guessing a cutoff or nonce.
    const snap=await this.get("/api/snapshot",8000000);
    need(snap?.params?.chain_id===CHAIN&&snap.checkpoint,"ESCROW_CONTEXT_UNAVAILABLE");
    const cutoff=integer(snap.checkpoint.cutoff?.ts);
    const own=await this.get(`/api/explorer/address/${wallet}`);
    const last=own?.txs?.find((t:any)=>t.from_addr===wallet);
    need(last&&/^[0-9a-f]{64}$/.test(last.id),"ESCROW_ENROLLED_SENDER_REQUIRED");
    const r=await this.get(`/api/receipt/${last.id}`);
    need(r?.status==="included"&&r.from===wallet&&(r.valid_in_open_window===true||r.checkpoint_covered===true),"ESCROW_NONCE_CONTEXT");
    const list=await this.get("/api/explorer/txs");need(Array.isArray(list),"ESCROW_PARENTS");const parents:string[]=[];
    for(const t of list.slice(0,8)){
      if(!/^[0-9a-f]{64}$/.test(t.id))continue;
      const receipt=await this.get(`/api/receipt/${t.id}`);
      if(receipt?.txid===t.id&&receipt.status==="included"&&(receipt.valid_in_open_window===true||receipt.checkpoint_covered===true))parents.push(t.id);
      if(parents.length===2)break;
    }
    need(parents.length===2,"ESCROW_PARENTS");return {nextNonce:integer(r.next_nonce,1),parents,cutoff};
  }
  async submit(body:Transfer):Promise<void> {
    need(this.writesAllowed(),"ESCROW_NETWORK_WRITES_DISABLED");verifyTransfer(body);
    const r=await this.request("https://minepoa.com/api/submit",{method:"POST",redirect:"error",signal:AbortSignal.timeout(12000),
      headers:{"content-type":"application/json"},body:JSON.stringify({kind:"tx",body})});
    // The service always resolves submission by tx lookup, including 202 and 4xx. No retries here.
    await r.body?.cancel();
  }
}
