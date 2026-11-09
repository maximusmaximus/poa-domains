// Public deterministic test vectors only. Never provision or fund these identities.
import { createPrivateKey, createPublicKey } from "node:crypto";
import { base58 } from "../../src/native-crypto.js";
import { CHAIN, Command, Transfer, WorkerSecretSigner, digest, micros, decimal, txid, verifyTransfer } from "../escrow-codec.js";
import { Policy, Network, Status, Observation, State, Entry, Journal, initial, nextEntry, replay } from "../escrow.js";
export const seed=(n:number)=>Buffer.alloc(32,n);
export const key=(n:number)=>createPrivateKey({format:"der",type:"pkcs8",key:Buffer.concat([Buffer.from("302e020100300506032b657004220420","hex"),seed(n)])});
export const who=(n:number)=>"poa1"+base58(createPublicKey(key(n)).export({format:"der",type:"spki"}).subarray(12));
export const policy:Policy={wallet:who(1),treasury:who(5),perTx:"10000.000000",daily:"50000.000000",feeBps:250,maxAgeMs:90000};
export const signer=(n=1)=>new WorkerSecretSigner(who(n),()=>base58(seed(n)),()=>true);
export const root="a".repeat(64), parents=["b".repeat(64),"c".repeat(64)];
export const command=(actor:string,k:string,action:string,params:Record<string,unknown>):Command=>({domain:"poa-domains.escrow.v1",chainId:CHAIN,registryId:"test-registry",actor,key:k,expires:2000000000,action,params});
export class MemoryJournal implements Journal {
  rows:Entry[]=[];
  constructor(readonly policy:Policy){}
  load():State{return replay(this.rows,this.policy);}
  append(event:string,payload:unknown,change:(s:State)=>void):State {
    const s=this.load(),e=nextEntry(s,this.rows.at(-1)?.checksum??digest(["escrow-genesis/v1",s.policy]),event,payload,change);
    this.rows.push(e);return structuredClone(e.state);
  }
}
export class MockNetwork implements Network {
  now=1800000000000; stale=false; down=false; fee="0.000000"; nonce=1;
  chain=CHAIN; mismatch=0n; height=10; covered=true; badCut=false;
  mode:"normal"|"before-timeout"|"after-timeout"|"delay"|"reject"="normal";
  txs:Record<string,Observation>={}; submitted:Transfer[]=[]; calls=0;
  async status():Promise<Status>{if(this.down)throw Error("offline");return{chain:this.chain,asOf:this.now,stale:this.stale,height:this.height,root,fee:this.fee};}
  async lookup(id:string):Promise<Observation|null>{if(this.down)throw Error("offline");return this.txs[id]??null;}
  async context(){return{nextNonce:this.nonce,parents,cutoff:Math.floor(this.now/1000)-1};}
  async cut(wallet:string,ids:string[],status:Status){
    let balance=this.mismatch;const covered:string[]=[];
    for(const [id,o] of Object.entries(this.txs)) if(o.checkpoint&&o.valid){
      if(o.body.to===wallet)balance+=micros(o.body.amount);if(o.body.from===wallet)balance-=micros(o.body.amount);
      if(ids.includes(id))covered.push(id);
    }
    return{chain:this.chain,height:this.badCut?status.height+1:status.height,root,balance:decimal(balance),covered};
  }
  add(body:Transfer,attestations=5,covered=this.covered){verifyTransfer(body);const id=txid(body);
    this.txs[id]={id,body,chain:CHAIN,valid:true,attestations,checkpoint:covered?{height:this.height,root,anchored:true,quorum:5}:null};return id;}
  async submit(body:Transfer){
    this.calls++;verifyTransfer(body);if(this.mode==="before-timeout")throw Error("timeout");
    this.submitted.push(body);if(this.mode==="reject")return;
    if(body.nonce!==this.nonce)throw Error("bad_nonce");this.nonce++;
    this.add(body,this.mode==="delay"?0:5,this.mode!=="delay");
    if(this.mode==="after-timeout")throw Error("response lost");
  }
}
export function depositBody(payer:number,to:string,amount:string,intent:string,nonce=1):Transfer {
  return signer(payer).transfer({type:"transfer",cid:CHAIN,from:who(payer),to,amount,memo:`poadomains:${intent}`,nonce,parents,ts:1800000000});
}
