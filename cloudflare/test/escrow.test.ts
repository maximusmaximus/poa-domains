import test from "node:test";
import assert from "node:assert/strict";
import { sign, verify, createPublicKey, createPrivateKey } from "node:crypto";
import { base58 } from "../../src/native-crypto.js";
import { canonical } from "../../src/core.js";
import { Escrow, PILOT_ADMISSION_LIMIT, PILOT_JOURNAL_LIMIT, REVIEWED_CREDITS, invariant, nextEntry, recoveryReserve, replay, reviewedCredit } from "../escrow.js";
import { CHAIN, WorkerSecretSigner, digest, micros, decimal, txid, verifyCommand, verifyTransfer } from "../escrow-codec.js";
import { PoaHttpNetwork, MAINNET_ENGINE_SHA256, MAINNET_PARAMS_SHA256, PILOT_PER_TX, PILOT_DAILY } from "../escrow-network.js";
import { MockNetwork, MemoryJournal, policy, who, key, seed, signer, command, depositBody, root, parents } from "./escrow-fixture.js";
import type { Status } from "../escrow.js";
function fixture(crash=(point:string)=>{}, p=policy){
  const journal=new MemoryJournal(p),net=new MockNetwork();let enabled=true;
  let owner=who(2),transferCount=0;
  const titles={terms:()=>({reserve:"1.000000",window:1000,quiet:1000}),
    validate:(_p:any,_n:string,s:string,_b:string)=>assert.equal(owner,s),commit:(p:any)=>{owner=p.body.params.recipient;transferCount++;}};
  const make=()=>new Escrow(journal,net,signer(),titles,p,()=>net.now,()=>enabled,crash);
  const e=make();e.pause(false);
  return {e,journal,net,make,owner:()=>owner,count:()=>transferCount,disable:()=>{enabled=false;}};
}
async function fund(f:ReturnType<typeof fixture>,n=3,amount="10.000000",tag="a",nonce=1){
  const r=await f.e.command(command(who(n),`intent-${tag}`,"intent",{amount})) as any;
  const id=f.net.add(depositBody(n,policy.wallet,amount,r.intent,nonce));
  await f.e.command(command(who(n),`detect-${tag}`,"detect",{intent:r.intent,txid:id}));return{id,intent:r.intent};
}
async function auction(f:ReturnType<typeof fixture>,amount="2.000000"){
  await fund(f);
  const r=await f.e.command(command(who(2),"open","open",{name:"test",reserve:"1.000000"})) as any;
  await f.e.command(command(who(3),"bid","bid",{auction:r.auction,amount}));return r.auction as string;
}
// Capacity tests pad thousands of checksum-valid rows. Avoid O(n^2) fixture
// replay while padding; each test independently replays the full history at end.
function capacityJournal(j:MemoryJournal){
 j.load=()=>structuredClone(j.rows.at(-1)!.state);
}
// Packet validation is exercised against the real engine in the runtime suite.
// Use a real authenticated reference packet shape for the service boundary (mock title store only).
import { Engine } from "../../src/engine.js";
import { mainnetConfig } from "../../src/config.js";
import { signBody } from "../../src/auth.js";
import { buildMetadataWitness } from "../../src/interface.js";
import { poaNewNamePriceMicros } from "../../src/new-name-prices.js";
function consent(f:ReturnType<typeof fixture>):any{
 const e=new Engine(mainnetConfig(who(6),who(5),[who(2),who(3),who(4)]),{now:()=>Math.floor(f.net.now/1000)});
 const b={domain:"poa-domains.local.intent.v1",revision:e.config.revision,chainId:CHAIN,genesisHash:e.config.genesisHash,registryId:e.registryId,policyHash:e.policyHash,normalizationHash:e.config.normalizationHash,
 signer:who(2),coSigners:[],requestId:"consent",nonce:0,notBefore:0,deadline:2000000000,maxTotal:"0",maxNetworkFee:"0",action:"transfer",params:{name:"test",expectedDeedId:"0".repeat(64),expectedVersion:1,recipient:who(3)}};
 return signBody(b,[key(2)]);
}
async function settle(f:ReturnType<typeof fixture>,a:string){f.net.now+=1001;await f.e.command(command(who(2),"settle","settle",{auction:a,transfer:consent(f)}));}

test("six-decimal amounts are exact integer micros and reject coercion",()=>{
 for(const v of ["0.000001","9007199254740.000001","1.123456","0.000000"])assert.equal(decimal(micros(v)),v);
 for(const v of ["1","01.000000","-1.000000","1.0000001",1,NaN])assert.throws(()=>micros(v));
});
test("Ed25519 canonical signing matches independent primitive and RFC8032 vector",()=>{
 const body=depositBody(3,policy.wallet,"1.000000","test");verifyTransfer(body);
 const {sig,...raw}=body;const independent=base58(sign(null,Buffer.from(canonical(raw)),key(3)));assert.equal(sig,independent);
 assert.equal(txid(body),txid({...raw,sig:"irrelevant"}));
 // Independently computed with Python sorted JSON + cryptography Ed25519, not this codec.
 assert.equal(txid(body),"c1921c67550f0089f0d9a2ae06bf60ce9d9af76a9cfc7c9eb9be5224f35bc413");
 assert.equal(sig,"3xWCjASS52n4hJyJLYmPSLAcWro8eNsq9XXHViWoWgWtQDRew9jvFNDH3taKt4HeerqfRukn23To3UeZ7ufG6omW");
 assert.throws(()=>verifyTransfer({...body,amount:"2.000000"}));
 const rfc=Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60","hex");
 const k=createPrivateKey({format:"der",type:"pkcs8",key:Buffer.concat([Buffer.from("302e020100300506032b657004220420","hex"),rfc])});
 assert.equal(sign(null,Buffer.alloc(0),k).toString("hex"),"e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
});
test("signer gates precede secret access; wrong/missing key fails safely",()=>{
 let reads=0;const s=new WorkerSecretSigner(who(1),()=>{reads++;return base58(seed(1));},()=>false);
 const b=depositBody(3,policy.wallet,"1.000000","test");const{sig,...raw}=b;
 assert.throws(()=>s.transfer({...raw,from:who(1)}),/DISABLED/);assert.equal(reads,0);
 assert.throws(()=>new WorkerSecretSigner(who(1),()=>base58(seed(2)),()=>true).transfer({...raw,from:who(1)}),/INVALID/);
});
test("signed commands bind actor, registry, chain, deadline and exact body",()=>{
 const c=command(who(3),"a","intent",{amount:"1.000000"});const v={command:c,signature:base58(sign(null,Buffer.from(canonical(c)),key(3)))};
 assert.deepEqual(verifyCommand(v,"test-registry",100),c);
 for(const changed of [{...c,registryId:"other"},{...c,actor:who(4)},{...c,expires:0},{...c,chainId:"other"}])assert.throws(()=>verifyCommand({...v,command:changed},"test-registry",100));
});
test("deposit exact binding, duplicate tx/intent and malicious claimant cannot credit",async()=>{
 const f=fixture(),d=await fund(f);assert.equal(f.e.state().available[who(3)],"10000000");
 await assert.rejects(f.e.command(command(who(4),"steal","detect",{intent:d.intent,txid:d.id})),/INTENT/);
 await assert.rejects(f.e.command(command(who(3),"double","detect",{intent:d.intent,txid:d.id})),/DUPLICATE/);
 invariant(f.e.state());
});
test("forged self-reported final, wrong recipient/memo/amount/sender, non-final/reorg denied",async()=>{
 for(const variant of ["recipient","memo","amount","sender","pending","invalid","chain","sig"]){
 const f=fixture();const r=await f.e.command(command(who(3),"i","intent",{amount:"1.000000"})) as any;
 let b=depositBody(variant==="sender"?4:3,variant==="recipient"?who(4):policy.wallet,variant==="amount"?"2.000000":"1.000000",variant==="memo"?"wrong":r.intent);
 const id=f.net.add(b,variant==="pending"?4:5,variant!=="pending");
 if(variant==="invalid")f.net.txs[id]!.valid=false;if(variant==="chain")f.net.txs[id]!.chain="wrong";if(variant==="sig")f.net.txs[id]!.body.sig="1";
 await assert.rejects(f.e.command(command(who(3),"d","detect",{intent:r.intent,txid:id,final:true})),/SCHEMA/);
 await assert.rejects(f.e.command(command(who(3),"d2","detect",{intent:r.intent,txid:id})));
 assert.equal(f.e.state().assets,"0");}
});
test("five attestations OR anchored 5/5 checkpoint; neither alone is insufficient",async()=>{
 for(const [atts,covered] of [[5,false],[0,true]] as const){const f=fixture();const r=await f.e.command(command(who(3),"i","intent",{amount:"1.000000"}))as any;
 const id=f.net.add(depositBody(3,policy.wallet,"1.000000",r.intent),atts,covered);
 await f.e.command(command(who(3),"d","detect",{intent:r.intent,txid:id}));assert.equal(f.e.state().assets,"1000000");}
});
test("idempotency binds complete payload and survives replay",async()=>{
 const f=fixture(),c=command(who(3),"same","intent",{amount:"1.000000"});const a=await f.e.command(c);
 assert.deepEqual(await f.make().command(c),a);await assert.rejects(f.e.command({...c,params:{amount:"2.000000"}}),/CONFLICT/);
 const rows=structuredClone(f.journal.rows);rows[0]!.state.assets="1";assert.throws(()=>replay(rows,policy),/CORRUPT/);
});
test("bid holds, strict increment, outbid credits available balance for instant re-bid/withdraw, cancel and double refund",async()=>{
 const f=fixture(),a=await auction(f);await fund(f,4,"10.000000","b");
 assert.equal(f.e.state().available[who(3)],"8000000");
 await assert.rejects(f.e.command(command(who(3),"raise","bid",{auction:a,amount:"3.000000"})),/SELF_RAISE/);
 await assert.rejects(f.e.command(command(who(4),"low","bid",{auction:a,amount:"2.200000"})),/INCREMENT/);
 await f.e.command(command(who(4),"high","bid",{auction:a,amount:"2.200001"}));
 // Outbid funds credit back to original bidder's available balance immediately (no on-chain refund wait).
 assert.equal(f.e.state().available[who(3)],"10000000");
 assert.equal(f.e.state().available[who(4)],"7799999");
 assert.equal(Object.keys(f.e.state().payments).length,0);
 await f.e.command(command(who(2),"cancel","cancel",{auction:a}));
 await assert.rejects(f.e.command(command(who(2),"again","cancel",{auction:a})),/CLOSED/);
 assert.equal(Object.keys(f.e.state().payments).length,1);
 assert.equal(Object.values(f.e.state().payments)[0]!.to,who(4));
 // Displaced bidder can withdraw their full returned balance cleanly to their own address.
 await f.e.command(command(who(3),"w-back","withdraw",{amount:"10.000000"}));
 assert.equal(f.e.state().available[who(3)],"0");
 assert.equal(Object.keys(f.e.state().payments).length,2);
 invariant(f.e.state());
});
test("expiry/failure reclassifies refund liability even while admin paused",async()=>{
 const f=fixture(),a=await auction(f);f.e.pause(true);f.net.now+=1001;
 await f.e.command(command(who(4),"expire","expire",{auction:a}));assert.equal(Object.values(f.e.state().payments)[0]!.to,who(3));invariant(f.e.state());
});
test("stale/down/wrong chain/fee change, paused/off flags hold without losing liabilities",async()=>{
 for(const mode of ["stale","down","chain","fee","paused","off"]){const f=fixture();await fund(f);
 if(mode==="stale")f.net.stale=true;if(mode==="down")f.net.down=true;if(mode==="chain")f.net.chain="wrong";if(mode==="fee")f.net.fee="0.010000";if(mode==="paused")f.e.pause(true);if(mode==="off")f.disable();
 await assert.rejects(f.e.tick());assert.equal(f.e.state().assets,"10000000");assert.equal(f.net.calls,0);}
});
test("reconciliation mismatch persists halt, unaligned cut holds, open funds not mixed with checkpoint assets",async()=>{
 const f=fixture();await fund(f);f.net.mismatch=1n;await assert.rejects(f.e.reconcile(),/MISMATCH/);assert.equal(f.make().state().halt,"ASSET_LIABILITY_MISMATCH");f.e.pause(false);await assert.rejects(f.e.tick(),/HALTED/);
 const g=fixture();await fund(g);g.net.badCut=true;await assert.rejects(g.e.reconcile(),/UNALIGNED/);
 const h=fixture();h.net.covered=false;await fund(h);await h.e.reconcile();assert.equal(h.e.state().assets,"10000000");
});
test("uncertain submit after accepted resolves by lookup with exactly one payment",async()=>{
 const f=fixture(),a=await auction(f);await settle(f,a);f.net.mode="after-timeout";
 for(let i=0;i<5;i++)await f.e.tick();assert.equal(f.owner(),who(3));assert.equal(f.count(),1);assert.equal(f.net.calls,2);assert.equal(new Set(f.net.submitted.map(txid)).size,2);invariant(f.e.state());
});
test("timeout before accepted, rejected and delayed txs remain reserved; never blind retry",async()=>{
 for(const mode of ["before-timeout","reject","delay"] as const){const f=fixture(),a=await auction(f);await settle(f,a);f.net.mode=mode;
 for(let i=0;i<5;i++)await f.e.tick();assert.equal(f.net.calls,1);assert.equal(f.count(),0);assert.equal(f.e.state().assets,"10000000");assert.equal(Object.values(f.e.state().payments)[0]!.status,"UNKNOWN");}
});
test("crash before submit reuses retained signed bytes once; crash after submit resolves by lookup",async()=>{
 for(const point of ["before-submit","after-submit","after-payout","before-title"]){let armed=true;const f=fixture(p=>{if(armed&&p===point){armed=false;throw Error("TEST_CRASH");}}),a=await auction(f);await settle(f,a);
 let crashed=false;for(let i=0;i<8;i++){try{await f.e.tick();}catch(e){assert.match(String(e),/TEST_CRASH/);crashed=true;break;}}
 assert.equal(crashed,true,point);const resumed=f.make();for(let i=0;i<8;i++)await resumed.tick();
 assert.equal(f.owner(),who(3),point);assert.equal(f.count(),1);assert.equal(f.net.calls,2);invariant(resumed.state());}
});
test("nonce gap and per-transaction limits hold before signing/submitting",async()=>{
 const f=fixture(),a=await auction(f);await settle(f,a);f.journal.append("test-nonce",{},s=>{s.nonce=4;});await assert.rejects(f.e.tick(),/NONCE_GAP/);assert.equal(f.net.calls,0);
 const g=fixture(()=>{},{...policy,perTx:"1.000000"});
 await assert.rejects(auction(g),/LIMIT/);assert.equal(g.net.calls,0);
 await assert.rejects(g.e.command(command(who(3),"oversize-withdraw","withdraw",{amount:"2.000000"})),/LIMIT/);
});
test("simultaneous bid/cancel/ticks cannot overdraw or double refund/payout",async()=>{
 const f=fixture(),a=await auction(f);await fund(f,4,"10.000000","b");
 await Promise.allSettled(Array.from({length:20},(_,i)=>f.e.command(command(who(4),`race-${i}`,"bid",{auction:a,amount:"3.000000"}))));
 // Exactly one outbid succeeded: who(3) credited ONCE (10 POA), who(4) debited ONCE (7 POA), 0 payments yet.
 assert.equal(f.e.state().available[who(3)],"10000000");
 assert.equal(f.e.state().available[who(4)],"7000000");
 assert.equal(Object.keys(f.e.state().payments).length,0);
 await f.e.command(command(who(2),"cancel","cancel",{auction:a}));
 await f.e.command(command(who(3),"withdraw-all","withdraw",{amount:"10.000000"}));
 await Promise.all(Array.from({length:20},()=>f.e.tick()));assert.equal(f.net.calls,2);invariant(f.e.state());
});
test("deterministic model/property sequences preserve assets = liabilities across replay",async()=>{
 let assertions=0;
 for(let run=0;run<40;run++){const f=fixture();await fund(f,3,"10.000000");let free=10000000n;let rng=run+1;
 for(let i=0;i<30;i++){rng=(rng*1664525+1013904223)>>>0;const n=BigInt(rng%500000+1);
 const c=command(who(3),`w-${i}`,"withdraw",{amount:decimal(n)});if(free>=n){await f.e.command(c);free-=n;await f.e.command(c);}else await assert.rejects(f.e.command(c));
 invariant(f.make().state());assert.equal(f.e.state().available[who(3)],String(free));assertions++;}
 }assert.equal(assertions,1200);
});
test("native transport write gate forbids even constructing a fetch submission by default",async()=>{
 let calls=0;const n=new PoaHttpNetwork(()=>false,(async()=>{calls++;throw Error("unexpected");}) as typeof fetch);
 await assert.rejects(n.submit(depositBody(3,policy.wallet,"1.000000","test")),/DISABLED/);assert.equal(calls,0);
});

test("daily cap includes completed and outstanding reservations across UTC date boundary",async()=>{
 const f=fixture(()=>{},{...policy,perTx:"3.000000",daily:"3.000000"}),a=await auction(f);await settle(f,a);
 await f.e.command(command(who(3),"refund-more","withdraw",{amount:"2.000000"}));
 await f.e.tick();await f.e.tick();await assert.rejects(f.e.tick(),/LIMIT/); // seller and fee finalized, 2 POA spent today
 await assert.rejects(f.e.tick(),/LIMIT/);assert.equal(f.net.calls,2);
 f.net.now+=86400000;await f.e.tick();await f.e.tick();assert.equal(f.net.calls,3);invariant(f.e.state());
});

test("admin pause during awaited nonce/context read prevents signing and submission",async()=>{
 const f=fixture(),a=await auction(f);await settle(f,a);let release:(x:any)=>void=()=>{};let entered:()=>void=()=>{};
 const waiting=new Promise<void>(r=>{entered=r;});f.net.context=async()=>{entered();return await new Promise(r=>{release=r;});};
 const tick=f.e.tick();await waiting;f.e.pause(true);release({nextNonce:1,parents,cutoff:Math.floor(f.net.now/1000)-1});
 await assert.rejects(tick,/PAUSED/);assert.equal(f.net.calls,0);assert.equal(Object.values(f.e.state().payments)[0]!.body,null);
});
test("UNKNOWN submission reservations survive date changes and restart without another submit",async()=>{
 const f=fixture(),a=await auction(f);await settle(f,a);f.net.mode="before-timeout";await f.e.tick();const before=f.e.state();
 f.net.now+=86400000;for(let i=0;i<5;i++)await f.make().tick();
 assert.equal(f.net.calls,1);assert.deepEqual(f.e.state().payments,before.payments);invariant(f.e.state());
});
test("missing Worker key is not read or persisted anywhere except ephemeral signer input",()=>{
 const b=depositBody(3,policy.wallet,"1.000000","test"),{sig,...raw}=b;
 assert.throws(()=>new WorkerSecretSigner(who(1),()=>undefined,()=>true).transfer({...raw,from:who(1)}));
});
test("fixed-origin native adapter validates receipt/body bindings and checkpoint cuts",async()=>{
 const body=depositBody(3,policy.wallet,"1.000000","native-fixture"),id=txid(body),paths:string[]=[];
 const request=(async(input:any,init:any)=>{const u=new URL(input);assert.equal(u.origin,"https://minepoa.com");assert.ok(!init?.method||init.method==="GET");paths.push(u.pathname);
 let b:any=null;
 if(u.pathname==="/api/status")b={K:5,as_of:new Date(1800000000000).toISOString(),stale:false,checkpoint_height:10,state_root:root};
 if(u.pathname==="/api/network/facts")b={chain_id:CHAIN,engine_sha256:root,params_sha256:root};
 if(u.pathname===`/api/explorer/tx/${id}`)b={id,body,atts:0,checkpoint_height:10};
 if(u.pathname===`/api/receipt/${id}`)b={txid:id,status:"included",from:body.from,type:"transfer",valid_in_open_window:false,checkpoint_covered:true};
 if(u.pathname===`/api/explorer/address/${policy.wallet}`)b={address:policy.wallet,balance:"1.000000",balance_as_of:{checkpoint_height:10}};
 return Response.json(b,{status:b?200:404});})as typeof fetch;
 const n=new PoaHttpNetwork(()=>false,request,{engine:root,params:root},()=>1800000000000),s=await n.status(),o=await n.lookup(id);assert.equal(o?.checkpoint?.height,10);
 const cut=await n.cut(policy.wallet,[id],s);assert.deepEqual(cut.covered,[id]);assert.equal(cut.balance,"1.000000");assert.ok(paths.length>=8);
});

test("native adapter binds sender/type/finality from the explorer when PoA's receipt is {txid,ts,status,height}",async()=>{
 const body=depositBody(3,policy.wallet,"1.000000","receipt-v2"),id=txid(body);
 const explorer=(o:any={})=>({id,type:"transfer",from_addr:body.from,to_addr:body.to,amount:body.amount,ts:body.ts,memo:body.memo,atts:5,final:1,
  body,as_of:new Date(1800000000000).toISOString(),checkpoint_height:10,source:"index",...o});
 const receiptV2=(o:any={})=>({txid:id,ts:body.ts,status:"included",height:806,...o});
 const net=(t:any,r:any,extra:(p:string)=>any=()=>undefined)=>{
  const request=(async(input:any,init:any)=>{const u=new URL(input);assert.equal(u.origin,"https://minepoa.com");assert.ok(!init?.method||init.method==="GET");
   let b:any=extra(u.pathname)??null;
   if(u.pathname===`/api/explorer/tx/${id}`)b=t;
   if(u.pathname===`/api/receipt/${id}`)b=r;
   if(u.pathname===`/chain/poa-mainnet-1/api/explorer/tx/${id}`||u.pathname===`/chain/poa-mainnet-1/api/receipt/${id}`)return Response.json({error:"paused"},{status:503});
   return Response.json(b,{status:b?200:404});}) as typeof fetch;
  return new PoaHttpNetwork(()=>false,request,{engine:root,params:root},()=>1800000000000);
 };
 // New receipt shape + final explorer record => valid, peer-final (no invented checkpoint).
 const ok=await net(explorer(),receiptV2()).lookup(id);
 assert.equal(ok?.valid,true);assert.equal(ok?.attestations,5);assert.equal(ok?.checkpoint,null);assert.deepEqual(ok?.body,body);
 // Explorer final as boolean is accepted too.
 assert.equal((await net(explorer({final:true}),receiptV2()).lookup(id))?.valid,true);
 // Mismatched or missing sender/type/to/amount/memo/id are rejected outright.
 for(const bad of [{from_addr:who(4)},{from_addr:undefined},{type:"stake"},{type:undefined},{to_addr:who(4)},{amount:"2.000000"},{amount:"bogus"},{memo:"poadomains:other"},{id:"f".repeat(64)}])
  await assert.rejects(net(explorer(bad),receiptV2()).lookup(id),/ESCROW_(RECEIPT|TX)_BINDING|ESCROW_AMOUNT/,JSON.stringify(bad));
 // Tampered signed body (to/amount/memo) fails signature verification.
 for(const field of ["to","amount","memo"] as const){
  const tampered={...body,[field]:field==="to"?who(4):field==="amount"?"2.000000":"poadomains:other"};
  await assert.rejects(net(explorer({body:tampered,to_addr:tampered.to,amount:tampered.amount,memo:tampered.memo}),receiptV2()).lookup(id),/ESCROW_SIGNATURE/);
 }
 // Receipt bound to another txid, or not included, never counts.
 await assert.rejects(net(explorer(),receiptV2({txid:"f".repeat(64)})).lookup(id),/ESCROW_TX_BINDING/);
 assert.equal((await net(explorer(),receiptV2({status:"pending"})).lookup(id))?.valid,false);
 await assert.rejects(net(explorer(),receiptV2({height:-1})).lookup(id));
 // Non-final or low-attestation explorer records are not valid.
 assert.equal((await net(explorer({final:0}),receiptV2()).lookup(id))?.valid,false);
 assert.equal((await net(explorer({final:undefined}),receiptV2()).lookup(id))?.valid,false);
 assert.equal((await net(explorer({atts:4}),receiptV2()).lookup(id))?.valid,false);
 assert.equal((await net(explorer({final:"1"}),receiptV2()).lookup(id))?.valid,false);
 await assert.rejects(net(explorer({atts:undefined}),receiptV2()).lookup(id));
 // Missing explorer record or receipt (404 + paused chain mirror) => held, never an observation.
 await assert.rejects(net(null,receiptV2()).lookup(id),/ESCROW_NODE_HTTP/);
 await assert.rejects(net(explorer(),null).lookup(id),/ESCROW_NODE_HTTP/);
 // Old receipt shape still works, and its sender/type must still match.
 const legacy={txid:id,status:"included",from:body.from,type:"transfer",valid_in_open_window:true,checkpoint_covered:false};
 const old=await net({id,body,atts:2},legacy).lookup(id);assert.equal(old?.valid,true);assert.equal(old?.attestations,2);
 await assert.rejects(net({id,body,atts:5},{...legacy,from:who(4)}).lookup(id),/ESCROW_RECEIPT_BINDING/);
 await assert.rejects(net({id,body,atts:5},{...legacy,type:"stake"}).lookup(id),/ESCROW_RECEIPT_BINDING/);
 await assert.rejects(net({id,body,atts:5},{txid:id,status:"included",from:body.from}).lookup(id),/ESCROW_RECEIPT_BINDING/);
 // Legacy receipt + explorer fields that disagree with the body is still rejected.
 await assert.rejects(net(explorer({from_addr:who(4)}),legacy).lookup(id),/ESCROW_RECEIPT_BINDING/);
 // Reconciliation cut: new shape omits checkpoint_covered, so peer-final money holds instead of being guessed.
 const cutNet=net(explorer(),receiptV2(),p=>p==="/api/status"?{K:5,as_of:new Date(1800000000000).toISOString(),stale:false,checkpoint_height:10,state_root:root}:
  p==="/api/network/facts"?{chain_id:CHAIN,engine_sha256:root,params_sha256:root}:
  p===`/api/explorer/address/${policy.wallet}`?{address:policy.wallet,balance:"1.000000",balance_as_of:{checkpoint_height:10}}:undefined);
 const s=await cutNet.status();await assert.rejects(cutNet.cut(policy.wallet,[id],s),/ESCROW_CHECKPOINT_DETAILS_REQUIRED/);
 // Legacy explicit checkpoint_covered:false still reconciles with the peer-final transfer excluded.
 const cutOld=net(explorer(),legacy,p=>p==="/api/status"?{K:5,as_of:new Date(1800000000000).toISOString(),stale:false,checkpoint_height:10,state_root:root}:
  p==="/api/network/facts"?{chain_id:CHAIN,engine_sha256:root,params_sha256:root}:
  p===`/api/explorer/address/${policy.wallet}`?{address:policy.wallet,balance:"0.000000",balance_as_of:{checkpoint_height:10}}:undefined);
 assert.deepEqual((await cutOld.cut(policy.wallet,[id],await cutOld.status())).covered,[]);
});

// ---- PoA's current receipt shape {txid,ts,status,height}: payouts (nonce/parents) and reconciliation cuts ----
const NOW_V2=1800000000000,CUTOFF_V2=1799999000;
function signedV2(n:number,to:string,amount:string,memo:string,nonce:number,ts:number){
 return signer(n).transfer({type:"transfer",cid:CHAIN,from:who(n),to,amount,memo,nonce,parents,ts});
}
function explorerV2(body:any,o:any={}){return {id:txid(body),type:body.type,from_addr:body.from,to_addr:body.to,amount:body.amount,ts:body.ts,memo:body.memo,
 atts:5,final:1,body,as_of:new Date(NOW_V2).toISOString(),checkpoint_height:10,source:"index",...o};}
const receiptV2=(id:string,o:any={})=>({txid:id,ts:1,status:"included",height:806,...o});
function v2Net(routes:Record<string,any>){
 const request=(async(input:any,init:any)=>{const u=new URL(input);assert.equal(u.origin,"https://minepoa.com");assert.ok(!init?.method||init.method==="GET");
  if(u.pathname.startsWith("/chain/poa-mainnet-1/api/")&&!u.pathname.endsWith("/status")&&!u.pathname.endsWith("/network-facts"))return Response.json({error:"paused"},{status:503});
  const b=routes[u.pathname];return Response.json(b??null,{status:b?200:404});}) as typeof fetch;
 return new PoaHttpNetwork(()=>false,request,{engine:root,params:root},()=>NOW_V2);
}
const statusV2=(cutoff:number|null=CUTOFF_V2)=>({K:5,as_of:new Date(NOW_V2).toISOString(),stale:false,checkpoint_height:10,state_root:root,...(cutoff!==null?{checkpoint:{height:10,cutoff_ts:cutoff}}:{})});
const factsV2={chain_id:CHAIN,engine_sha256:root,params_sha256:root};

test("payout context on the current receipt shape: nonce from the journal-bound explorer view, parents from final listing",async()=>{
 const W=policy.wallet;
 const out=signedV2(1,who(3),"2.000000","poadomains:refund-a",6,CUTOFF_V2+50),outId=txid(out);
 const older=signedV2(1,who(4),"1.000000","poadomains:refund-0",5,CUTOFF_V2+10),olderId=txid(older);
 const incoming=signedV2(3,W,"3.000000","poadomains:dep",2,CUTOFF_V2+80);
 const p1="b".repeat(64),p0="d".repeat(64),p2="c".repeat(64);
 const row=(b:any,o:any={})=>({id:txid(b),type:b.type,from_addr:b.from,to_addr:b.to,amount:b.amount,epoch:null,ts:b.ts,atts:5,final:1,...o});
 const build=(o:{addr?:any,tx?:any,receipt?:any,list?:any,extra?:Record<string,any>}={})=>v2Net({
  "/api/status":statusV2(),"/api/network/facts":factsV2,
  [`/api/explorer/address/${W}`]:o.addr??{address:W,balance:"9.000000",balance_as_of:{checkpoint_height:10},txs:[row(incoming),row(out),row(older)]},
  [`/api/explorer/tx/${outId}`]:o.tx??explorerV2(out),
  [`/api/receipt/${outId}`]:o.receipt??receiptV2(outId),
  "/api/explorer/txs":o.list??[{id:p1,final:1,atts:5},{id:p0,final:0,atts:1},{id:p2,final:1,atts:6}],
  [`/api/receipt/${p1}`]:receiptV2(p1),[`/api/receipt/${p0}`]:receiptV2(p0),[`/api/receipt/${p2}`]:receiptV2(p2),
  ...(o.extra??{})});
 // Happy path: first payout (no journal tx yet) and journal-bound payout agree on nonce 7.
 const ctx=await build().context(W);assert.equal(ctx.nextNonce,7);assert.deepEqual(ctx.parents,[p1,p2]);assert.equal(ctx.cutoff,CUTOFF_V2);
 assert.equal((await build().context(W,outId)).nextNonce,7);
 // Journal and explorer disagree on the latest outgoing tx (stale journal or a foreign spend) => hold.
 await assert.rejects(build().context(W,olderId),/ESCROW_NONCE_CONTEXT/);
 await assert.rejects(build().context(W,"e".repeat(64)),/ESCROW_NONCE_CONTEXT/);
 // Latest outgoing must be included, peer-final, and bound to its id/sender.
 for(const [label,o] of [
  ["not final",{tx:explorerV2(out,{final:0})}],["low atts",{tx:explorerV2(out,{atts:4})}],["final string",{tx:explorerV2(out,{final:"1"})}],
  ["atts missing",{tx:explorerV2(out,{atts:undefined})}],
  ["pending receipt",{receipt:receiptV2(outId,{status:"pending"})}],["receipt other txid",{receipt:receiptV2("f".repeat(64))}],
  ["explorer other id",{tx:explorerV2(out,{id:"f".repeat(64)})}],["from_addr mismatch",{tx:explorerV2(out,{from_addr:who(4)})}],
  ["type mismatch",{tx:explorerV2(out,{type:"stake"})}],["body nonce tampered",{tx:explorerV2(out,{body:{...out,nonce:60}})}],
  ["body from another wallet",{tx:explorerV2(out,{body:signedV2(2,who(3),"2.000000","poadomains:refund-a",6,CUTOFF_V2+50)})}],
  ["body missing",{tx:explorerV2(out,{body:undefined})}],
  ["address view for another wallet",{addr:{address:who(2),txs:[row(out)]}}],["address view without txs",{addr:{address:W}}],
  ["unordered listing",{addr:{address:W,txs:[row(older),row(out)]}}],["listing row without ts",{addr:{address:W,txs:[row(incoming,{ts:undefined}),row(out)]}}],
 ] as const) await assert.rejects(build(o as any).context(W),/ESCROW_NONCE_CONTEXT|ESCROW_SIGNATURE|INTEGER/,label);
 // Explorer record or receipt missing (404 + paused chain mirror) => held.
 await assert.rejects(build({extra:{[`/api/explorer/tx/${outId}`]:undefined}}).context(W));
 await assert.rejects(build({extra:{[`/api/receipt/${outId}`]:undefined}}).context(W));
 // No outgoing tx visible at all: funded, aligned, untruncated strictly-incoming wallet starts at nonce 1;
 // anything missing balance/alignment, empty, truncated (>=100 rows), or malformed still holds fail-closed.
 const firstPayoutAddr={address:W,balance:"9.000000",balance_as_of:{checkpoint_height:10},txs:[row(incoming)]};
 const firstCtx=await build({addr:firstPayoutAddr}).context(W);
 assert.equal(firstCtx.nextNonce,1);assert.deepEqual(firstCtx.parents,[p1,p2]);
 for(const [label,addr] of [
  ["missing balance/cut",{address:W,txs:[row(incoming)]}],
  ["zero balance",{...firstPayoutAddr,balance:"0.000000"}],
  ["unaligned checkpoint",{...firstPayoutAddr,balance_as_of:{checkpoint_height:9}}],
  ["empty txs",{...firstPayoutAddr,txs:[]}],
  ["truncated 100 txs",{...firstPayoutAddr,txs:Array.from({length:100},(_,i)=>row(incoming,{ts:CUTOFF_V2+100-i}))}],
  ["row missing from_addr",{...firstPayoutAddr,txs:[row(incoming,{from_addr:undefined})]}],
 ] as const) await assert.rejects(build({addr}).context(W),/ESCROW_ENROLLED_SENDER_REQUIRED/,label);
 // If the journal already knows a prior outgoing tx, missing it in explorer must never fall back to nonce 1.
 await assert.rejects(build({addr:firstPayoutAddr}).context(W,outId),/ESCROW_ENROLLED_SENDER_REQUIRED|ESCROW_NONCE_CONTEXT/);
 // Parents must be final in the listing and included in their receipt.
 await assert.rejects(build({list:[{id:p1,final:1},{id:p0,final:0},{id:p2,final:0}]}).context(W),/ESCROW_PARENTS/);
 await assert.rejects(build({list:[{id:p1,final:1},{id:p1,final:1}]}).context(W),/ESCROW_PARENTS/);
 await assert.rejects(build({list:[{id:p1,final:1},{id:p2,final:1}],extra:{[`/api/receipt/${p2}`]:receiptV2(p2,{status:"rejected"})}}).context(W),/ESCROW_PARENTS/);
 await assert.rejects(build({list:{}}).context(W),/ESCROW_PARENTS/);
});

test("reconciliation cut on the current receipt shape uses the pinned engine's ts<cutoff coverage and holds on anything ambiguous",async()=>{
 const W=policy.wallet;
 const dep=(tag:string,ts:number)=>signedV2(3,W,"1.000000",`poadomains:${tag}`,1,ts);
 const before=dep("before",CUTOFF_V2-5),after=dep("after",CUTOFF_V2+5),tie=dep("tie",CUTOFF_V2);
 const make=(txs:{body:any,o?:any}[],balance:string,cutoff:number|null=CUTOFF_V2)=>{
  const routes:Record<string,any>={"/api/status":statusV2(cutoff),"/api/network/facts":factsV2,
   [`/api/explorer/address/${W}`]:{address:W,balance,balance_as_of:{checkpoint_height:10},txs:[]}};
  for(const {body,o} of txs){const id=txid(body);routes[`/api/explorer/tx/${id}`]=explorerV2(body,o);routes[`/api/receipt/${id}`]=receiptV2(id);}
  return v2Net(routes);
 };
 // Peer-final under the cutoff is baked into the checkpoint balance; after the cutoff it is not.
 let n=make([{body:before},{body:after}],"1.000000");let s:Status=await n.status();
 const cut=await n.cut(W,[txid(before),txid(after)],s);assert.deepEqual(cut.covered,[txid(before)]);assert.equal(cut.balance,"1.000000");
 // Above the cutoff, even a not-yet-final tx is simply not covered.
 n=make([{body:after,o:{final:0,atts:1}}],"0.000000");s=await n.status();assert.deepEqual((await n.cut(W,[txid(after)],s)).covered,[]);
 // Same-second tie, or under the cutoff without peer finality => hold.
 for(const [label,txs] of [["tie",[{body:tie}]],["not final",[{body:before,o:{final:0}}]],["low atts",[{body:before,o:{atts:4}}]]] as const){
  n=make(txs as any,"1.000000");s=await n.status();await assert.rejects(n.cut(W,[txid((txs as any)[0].body)],s),/ESCROW_CHECKPOINT_DETAILS_REQUIRED/,label);
 }
 // PoA's explicit per-tx `checkpointed:{height}` at or below the balance's checkpoint => covered, even without a cutoff.
 const cp={height:10,note:"covered by a 5/5-signed, chain-anchored checkpoint"};
 n=make([{body:tie,o:{checkpointed:cp}}],"1.000000");s=await n.status();assert.deepEqual((await n.cut(W,[txid(tie)],s)).covered,[txid(tie)]);
 n=make([{body:before,o:{checkpointed:cp}}],"1.000000",null);s=await n.status();assert.deepEqual((await n.cut(W,[txid(before)],s)).covered,[txid(before)]);
 // Checkpointed at a newer checkpoint than the balance, and after its cutoff => not in this balance.
 n=make([{body:after,o:{checkpointed:{height:11}}}],"0.000000");s=await n.status();assert.deepEqual((await n.cut(W,[txid(after)],s)).covered,[]);
 // Contradictions, non-final covered money, and malformed coverage hold.
 for(const [label,txs,cutoff] of [
  ["checkpointed but after cutoff",[{body:after,o:{checkpointed:cp}}],CUTOFF_V2],
  ["checkpointed not final",[{body:before,o:{checkpointed:cp,final:0}}],null],
  ["checkpointed low atts",[{body:before,o:{checkpointed:cp,atts:3}}],null],
  ["checkpointed newer, no cutoff",[{body:before,o:{checkpointed:{height:11}}}],null],
  ["checkpointed bad height",[{body:before,o:{checkpointed:{height:"10"}}}],CUTOFF_V2],
  ["checkpointed without height",[{body:before,o:{checkpointed:{note:"x"}}}],CUTOFF_V2],
 ] as const){n=make(txs as any,"1.000000",cutoff as any);s=await n.status();await assert.rejects(n.cut(W,[txid((txs as any)[0].body)],s),/ESCROW_CHECKPOINT_DETAILS_REQUIRED|INTEGER/,label);}
 // Status without a checkpoint cutoff and no explicit coverage => hold.
 n=make([{body:before}],"1.000000",null);s=await n.status();await assert.rejects(n.cut(W,[txid(before)],s),/ESCROW_CHECKPOINT_DETAILS_REQUIRED/);
 // Address balance not as-of this checkpoint => unaligned.
 n=v2Net({"/api/status":statusV2(),"/api/network/facts":factsV2,[`/api/explorer/address/${W}`]:{address:W,balance:"1.000000",balance_as_of:{checkpoint_height:9},txs:[]}});
 s=await n.status();await assert.rejects(n.cut(W,[txid(before)],s),/ESCROW_UNALIGNED_CUT/);
});

test("native adapter supports post-8:59-PST /chain/poa-mainnet-1/api/status schema, network-facts, cutoff context, and rollback tripwire",async()=>{
 const body=depositBody(3,policy.wallet,"5.000000","live-schema"),id=txid(body);
 const ownTx=depositBody(1,who(2),"1.000000","prev-out"),ownId=txid(ownTx);
 const p1="b".repeat(64),p2="c".repeat(64);
 let cpHeight=593855,cutoffTs=1794228787,nowMs=1794250522000;
 const request=(async(input:any)=>{const u=new URL(input);
  if(u.pathname==="/chain/poa-mainnet-1/api/status")return Response.json({checkpoint:{height:cpHeight,cutoff_ts:cutoffTs},stale:false,as_of:new Date(nowMs).toISOString(),network:"PoA prototype",K:5,open_ballots:0,chain_id:CHAIN,supply:"26020127390.293810",txs:13078,final:13007,invalid:0,agents_joined:9959,epochs_closed:63,holders:4968});
  if(u.pathname==="/chain/poa-mainnet-1/api/network-facts")return Response.json({chain_id:CHAIN,open_epoch:63,engine_sha256:MAINNET_ENGINE_SHA256,params_sha256:MAINNET_PARAMS_SHA256,economics:{K:5}});
  if(u.pathname===`/chain/poa-mainnet-1/api/explorer/tx/${id}`)return Response.json({id,body,atts:3,checkpointed:{height:593800},checkpoint_height:cpHeight});
  if(u.pathname===`/chain/poa-mainnet-1/api/receipt/${id}`)return Response.json({txid:id,status:"included",from:body.from,type:"transfer",valid_in_open_window:false,checkpoint_covered:true,next_nonce:2});
  if(u.pathname===`/chain/poa-mainnet-1/api/explorer/address/${policy.wallet}`)return Response.json({address:policy.wallet,balance:"5.000000",balance_as_of:{checkpoint_height:cpHeight},txs:[]});
  if(u.pathname===`/chain/poa-mainnet-1/api/receipt/${ownId}`)return Response.json({txid:ownId,status:"included",from:policy.wallet,type:"transfer",valid_in_open_window:false,checkpoint_covered:true,next_nonce:7});
  if(u.pathname==="/chain/poa-mainnet-1/api/explorer/txs")return Response.json([{id:p1},{id:p2}]);
  if(u.pathname===`/chain/poa-mainnet-1/api/receipt/${p1}`||u.pathname===`/chain/poa-mainnet-1/api/receipt/${p2}`)return Response.json({txid:u.pathname.split("/").pop(),status:"included",from:who(2),type:"transfer",valid_in_open_window:true,checkpoint_covered:false});
  return Response.json(null,{status:404});
 }) as typeof fetch;
 const n=new PoaHttpNetwork(()=>false,request,{engine:MAINNET_ENGINE_SHA256,params:MAINNET_PARAMS_SHA256},()=>nowMs);
 const s=await n.status();
 assert.equal(s.height,593855);assert.equal(s.cutoff,1794228787);assert.equal(s.stale,false);assert.match(s.root,/^[0-9a-f]{64}$/);
 const o=await n.lookup(id);assert.equal(o?.checkpoint?.height,593855);assert.equal(o?.checkpoint?.root,s.root);
 const cut=await n.cut(policy.wallet,[id],s);assert.deepEqual(cut.covered,[id]);
 const ctx=await n.context(policy.wallet,ownId);assert.equal(ctx.nextNonce,7);assert.equal(ctx.cutoff,1794228787);assert.deepEqual(ctx.parents,[p1,p2]);
 cpHeight=593854;await assert.rejects(n.status(),/ROLLBACK/);
 assert.equal(PILOT_PER_TX,"250000.000000");assert.equal(PILOT_DAILY,"1000000.000000");
});

test("rebroadcast recovers pre-acceptance timeout with identical signed bytes and nonce, never double-paying",async()=>{
 const f=fixture(),a=await auction(f);await settle(f,a);
 f.net.mode="before-timeout";await f.e.tick();
 const stuck=Object.values(f.e.state().payments).find(p=>p.status==="UNKNOWN")!;
 assert.ok(stuck&&stuck.body);assert.equal(f.net.submitted.length,0);
 f.net.mode="normal";
 await f.e.rebroadcast();
 for(let i=0;i<5;i++)await f.e.tick();
 assert.equal(f.owner(),who(3));assert.equal(f.count(),1);
 assert.equal(f.net.submitted.length,2);
 assert.deepEqual(f.net.submitted.map(b=>b.nonce),[1,2]);
 assert.equal(f.net.submitted[0]!.sig,stuck.body.sig);
 invariant(f.e.state());
});

test("duplicate sender nonce across deposit intents is rejected",async()=>{
 const f=fixture();
 const i1=await f.e.command(command(who(3),"i1","intent",{amount:"1.000000"})) as any;
 const i2=await f.e.command(command(who(3),"i2","intent",{amount:"1.000000"})) as any;
 const t1=f.net.add(depositBody(3,policy.wallet,"1.000000",i1.intent,1));
 const t2=f.net.add(depositBody(3,policy.wallet,"1.000000",i2.intent,1));
 await f.e.command(command(who(3),"d1","detect",{intent:i1.intent,txid:t1}));
 await assert.rejects(f.e.command(command(who(3),"d2","detect",{intent:i2.intent,txid:t2})),/DUPLICATE/);
 assert.equal(f.e.state().assets,"1000000");
});

test("TITLE_PENDING does not spam journal or block READY refunds, and repair-title completes handover",async()=>{
 let failTitle=false;
 const journal=new MemoryJournal(policy),net=new MockNetwork();
 let owner=who(2),transferCount=0;
 const titles={
  terms:()=>({reserve:"1.000000",window:1000,quiet:1000}),
  validate:(_p:any,_n:string,s:string,_b:string)=>{if(failTitle)throw Error("ESCROW_TITLE_NOT_READY");assert.equal(owner,s);},
  commit:(p:any)=>{owner=p.body.params.recipient;transferCount++;}
 };
 const e=new Escrow(journal,net,signer(),titles,policy,()=>net.now,()=>true);e.pause(false);
 const f={e,journal,net,make:()=>new Escrow(journal,net,signer(),titles,policy,()=>net.now,()=>true),owner:()=>owner,count:()=>transferCount,disable:()=>{}};
 await fund(f,3,"10.000000","a");
 const openRes=await e.command(command(who(2),"open","open",{name:"test",reserve:"1.000000"})) as any;
 const a=openRes.auction as string;
 await e.command(command(who(3),"bid","bid",{auction:a,amount:"2.000000"}));
 await settle(f,a);
 await e.command(command(who(3),"w1","withdraw",{amount:"1.000000"}));
 failTitle=true;
 // Pay seller and fee; title validation fails once -> TITLE_PENDING
 await e.tick();await e.tick();await e.tick();
 assert.equal(e.state().settlements[a]!.status,"TITLE_PENDING");
 const seqAtPending=e.state().sequence;
 // Subsequent ticks do not spam title-pending and still pay the READY withdrawal refund
 await e.tick();await e.tick();
 assert.equal(e.state().payments["withdraw-" + who(3) + ":w1"]!.status,"FINAL");
 const seqAfterRefund=e.state().sequence;
 await e.tick();await e.tick();
 assert.equal(e.state().sequence,seqAfterRefund);
 assert.ok(seqAtPending<seqAfterRefund);
 // Repair title immediately completes handover when payments are already FINAL
 failTitle=false;
 await e.command(command(who(2),"repair","repair-title",{auction:a,transfer:consent(f)}));
 assert.equal(e.state().settlements[a]!.status,"COMPLETE");
 assert.equal(e.state().auctions[a]!.status,"COMPLETE");
 assert.equal(owner,who(3));assert.equal(transferCount,1);
 invariant(e.state());
});

test("short-deadline seller consent is rejected before payout begins",async()=>{
 const f=fixture(),a=await auction(f);f.net.now+=1001;
 const c=consent(f);
 c.body.deadline=Math.floor(f.net.now/1000)+60; // < 600s required window
 const resigned=signBody(c.body,[key(2)]);
 await assert.rejects(f.e.command(command(who(2),"settle-short","settle",{auction:a,transfer:resigned})),/CONSENT_EXPIRING/);
 assert.equal(f.e.state().auctions[a]!.status,"OPEN");
});

test("queued auctions wait for first bid to start timer; abandoned fixed listings and bid-started auctions auto-expire in tick",async()=>{
 const f=fixture();await fund(f,3,"10.000000","a");await fund(f,4,"10.000000","b");
 // Queued auction: closes === 0 and startedAt === null until first bid lands.
 const o1=await f.e.command(command(who(2),"open1","open",{name:"queued",reserve:"1.000000"})) as any;
 assert.equal(f.e.state().auctions[o1.auction]!.closes,0);
 assert.equal(f.e.state().auctions[o1.auction]!.startedAt,null);
 assert.equal(f.e.titleLocked(),true);
 // Waiting past the nominal window does NOT expire an unbid auction or allow outsider expire.
 f.net.now+=5000;
 await f.e.tick();
 assert.equal(f.e.state().auctions[o1.auction]!.status,"OPEN");
 await assert.rejects(f.e.command(command(who(4),"early-exp","expire",{auction:o1.auction})),/CANCEL_NOT_ALLOWED/);
 // First bid starts the countdown timer (closes = now + window) and records startedAt + history.
 const startAt=f.net.now;
 await f.e.command(command(who(3),"first-bid","bid",{auction:o1.auction,amount:"1.000000"}));
 assert.equal(f.e.state().auctions[o1.auction]!.startedAt,startAt);
 assert.equal(f.e.state().auctions[o1.auction]!.closes,startAt+1000);
 assert.equal(f.e.state().auctions[o1.auction]!.history?.at(-1)?.event,"Auction started (first bid)");
 // Outbid by another bidder updates high, records both bidders, extends quiet, and credits original bidder's available balance immediately.
 f.net.now+=500;
 await f.e.command(command(who(4),"outbid","bid",{auction:o1.auction,amount:"1.500000"}));
 assert.equal(f.e.state().auctions[o1.auction]!.closes,f.net.now+1000);
 assert.equal(f.e.state().available[who(3)],"10000000");
 assert.equal(Object.keys(f.e.state().payments).length,0);
 // Original bidder can immediately re-bid using their returned available balance with zero on-chain wait.
 await f.e.command(command(who(3),"rebid","bid",{auction:o1.auction,amount:"1.700000"}));
 assert.equal(f.e.state().available[who(3)],"8300000");
 assert.equal(f.e.state().available[who(4)],"10000000");
 // Seller can still cancel and release title lock + refund high bidder.
 await f.e.command(command(who(2),"cancel1","cancel",{auction:o1.auction}));
 assert.equal(f.e.state().auctions[o1.auction]!.status,"CANCELLED");
 assert.equal(f.e.titleLocked(),false);
 // Abandoned fixed-price listing still auto-expires after closes.
 const l1=await f.e.command(command(who(2),"list1","list",{name:"fixed-empty",price:"1.000000"})) as any;
 f.net.now+=1001;
 await f.e.tick();
 assert.equal(f.e.state().auctions[l1.auction]!.status,"CANCELLED");
 assert.equal(f.e.titleLocked(),false);
 // Bid-started auction abandoned past closes + quiet auto-expires and refunds high bidder.
 const o2=await f.e.command(command(who(2),"open2","open",{name:"bid-abandoned",reserve:"1.000000"})) as any;
 await f.e.command(command(who(3),"bid2","bid",{auction:o2.auction,amount:"2.000000"}));
 f.net.now+=1001; // past closes, within quiet grace window -> still OPEN so seller can settle
 await f.e.tick();
 assert.equal(f.e.state().auctions[o2.auction]!.status,"OPEN");
 f.net.now+=1000; // past closes + quiet -> auto-expired and refunded
 await f.e.tick();
 assert.equal(f.e.state().auctions[o2.auction]!.status,"CANCELLED");
 assert.equal(f.e.titleLocked(),false);
 assert.ok(f.e.state().payments[`cancel-${o2.auction}`]);
 invariant(f.e.state());
});

test("two Escrow instances sharing a Journal serialize requests and recovery without double refund",async()=>{
 const f=fixture(),a=await auction(f),recovery=f.make();
 f.net.now+=1001;
 await Promise.allSettled([
  f.e.command(command(who(2),"cancel","cancel",{auction:a})),
  recovery.command(command(who(4),"expire","expire",{auction:a})),
  f.e.tick(),
  recovery.tick(),
 ]);
 await f.e.tick();await recovery.tick();
 assert.equal(Object.keys(f.e.state().payments).length,1);
 assert.equal(f.net.calls,1);
 invariant(f.e.state());
});

test("pilot journal admission cap reserves headroom for settlement and recovery",async()=>{
 const f=fixture(),a=await auction(f);
 while(f.journal.rows.length<PILOT_ADMISSION_LIMIT){
  const prev=f.journal.rows.at(-1)!;
  f.journal.rows.push(nextEntry(prev.state,prev.checksum,"noop",{},()=>{},policy));
 }
 await assert.rejects(f.e.command(command(who(3),"new-intent","intent",{amount:"1.000000"})),/CAPACITY/);
 await assert.rejects(f.e.command(command(who(2),"new-open","open",{name:"other",reserve:"1.000000"})),/CAPACITY/);
 // In-flight auction can still settle and complete title handover within reserved headroom
 await settle(f,a);
 for(let i=0;i<5;i++)await f.e.tick();
 assert.equal(f.owner(),who(3));
 assert.ok(f.e.state().sequence<PILOT_JOURNAL_LIMIT);
 invariant(f.e.state());
});

test("malformed Worker secret never leaks in error message",()=>{
 const b=depositBody(3,policy.wallet,"1.000000","test"),{sig,...raw}=b;
 const s=new WorkerSecretSigner(who(1),()=>"not-valid-base58-secret!!!",()=>true);
 assert.throws(()=>s.transfer({...raw,from:who(1)}),(err:any)=>err instanceof Error&&err.message==="ESCROW_KEY_OR_TRANSFER_INVALID"&&!err.message.includes("not-valid"));
});


test("native freshness fails closed for a 24-hour-old checkpoint without source freshness",async()=>{
 const now=1800000000000;
 const base={K:5,chain_id:CHAIN,checkpoint:{height:10,cutoff_ts:now/1000-86400}};
 const facts={chain_id:CHAIN,engine_sha256:MAINNET_ENGINE_SHA256,params_sha256:MAINNET_PARAMS_SHA256};
 for(const fields of [{},{stale:false},{as_of:new Date(now).toISOString()},
   {stale:false,as_of:new Date(now-86400000).toISOString()},
   {stale:false,as_of:"invalid"},{stale:true,as_of:new Date(now).toISOString()},
   {stale:false,as_of:new Date(now+6000).toISOString()},
   {stale:false,as_of:new Date(now).toISOString(),stale_age_s:121}]){
   const fetcher=(async(input:any)=>Response.json(String(input).endsWith("/status")?{...base,...fields}:facts)) as typeof fetch;
   await assert.rejects(new PoaHttpNetwork(()=>false,fetcher,undefined,()=>now).status(),/ESCROW_STALE/);
 }
 const fetcher=(async(input:any)=>Response.json(String(input).endsWith("/status")?{...base,stale:false,as_of:new Date(now-1000).toISOString()}:facts)) as typeof fetch;
 assert.equal((await new PoaHttpNetwork(()=>false,fetcher,undefined,()=>now).status()).asOf,now-1000);
});

test("proportional reservations refuse new work before spending recovery headroom",async()=>{
 const f=fixture();await fund(f,3,"100.000000");capacityJournal(f.journal);
 for(let i=0;i<12;i++)await f.e.command(command(who(3),`w${i}`,"withdraw",{amount:"1.000000"}));
 while(BigInt(f.journal.rows.length)+recoveryReserve(f.e.state(),policy)<BigInt(PILOT_JOURNAL_LIMIT)){
  f.journal.append("noop",{},()=>{});
 }
 assert.throws(()=>f.journal.append("noop",{},()=>{}),/CAPACITY/);
 await assert.rejects(f.e.command(command(who(3),"more-work","withdraw",{amount:"1.000000"})),/CAPACITY/);
 for(let i=0;i<14;i++)await f.e.tick();
 assert.equal(Object.values(f.e.state().payments).filter(p=>p.status==="FINAL").length,12);
 await f.e.command(command(who(3),"drain","withdraw",{amount:"88.000000"}));
 await f.e.tick();await f.e.tick();assert.equal(f.e.state().assets,"0");
 assert.ok(f.e.state().sequence<=PILOT_JOURNAL_LIMIT);
 assert.deepEqual(replay(f.journal.rows,policy),f.e.state());
});

test("legacy 12-withdrawals-at-1968 backlog fully drains even across the old cap",async()=>{
 const f=fixture();await fund(f,3,"100.000000");capacityJournal(f.journal);
 for(let i=0;i<12;i++)await f.e.command(command(who(3),`w${i}`,"withdraw",{amount:"1.000000"}));
 // Recreate a checksum-valid pre-fix journal; old admission ignored obligations.
 while(f.journal.rows.length<1968){
  const prev=f.journal.rows.at(-1)!,state=structuredClone(prev.state);state.sequence++;
  const v={sequence:state.sequence,previous:prev.checksum,event:"noop",payload:{},state};
  f.journal.rows.push({...v,checksum:digest(v)});
 }
 assert.throws(()=>f.journal.append("noop",{},()=>{}),/CAPACITY/);
 for(let i=0;i<14;i++)await f.e.tick();
 assert.equal(Object.values(f.e.state().payments).filter(p=>p.status==="FINAL").length,12);
 await f.e.command(command(who(3),"drain","withdraw",{amount:"88.000000"}));
 await f.e.tick();await f.e.tick();assert.equal(f.e.state().assets,"0");
 assert.equal(f.net.calls,13);assert.ok(f.e.state().sequence>PILOT_JOURNAL_LIMIT);
 assert.deepEqual(replay(f.journal.rows,policy),f.e.state());
 await assert.rejects(f.e.command(command(who(3),"new","intent",{amount:"1.000000"})),/CAPACITY/);
 for(let i=0;i<34;i++){await f.e.pause(true);await f.e.pause(false);}
 assert.ok(f.e.state().sequence>2032);await f.e.pause(true);assert.equal(f.e.state().paused,true);
 invariant(f.e.state());
});

test("queued pause is shared across instances and persisted after in-flight I/O",async()=>{
 const f=fixture(),other=f.make();await fund(f);
 await Promise.all([f.e.pause(true),other.pause(false)]);assert.equal(f.e.state().paused,false);
 await other.pause(true);await assert.rejects(f.e.tick(),/PAUSED/);assert.equal(f.e.state().paused,true);
});


test("pending intents reserve detection and all capped withdrawal chunks",async()=>{
 const f=fixture(()=>{},{...policy,perTx:"1.000000"});
 const r=await f.e.command(command(who(3),"i","intent",{amount:"3.000000"})) as any;capacityJournal(f.journal);
 while(BigInt(f.e.state().sequence)+recoveryReserve(f.e.state(),f.e.policy)<BigInt(PILOT_JOURNAL_LIMIT))f.journal.append("noop",{},()=>{});
 const id=f.net.add(depositBody(3,policy.wallet,"3.000000",r.intent));
 await f.e.command(command(who(3),"d","detect",{intent:r.intent,txid:id}));
 for(let i=0;i<3;i++){
  await f.e.command(command(who(3),`w${i}`,"withdraw",{amount:"1.000000"}));await f.e.tick();await f.e.tick();
 }
 assert.equal(f.e.state().assets,"0");assert.equal(f.net.calls,3);
 assert.equal(f.e.state().sequence,PILOT_JOURNAL_LIMIT);
 assert.deepEqual(replay(f.journal.rows,f.e.policy),f.e.state());
});

test("native adapter binds fetch's global receiver and rejects redirects without following",async()=>{
 let calls=0;
 const request=(async function(this:typeof globalThis,input:any,init:any){
  assert.equal(this,globalThis);assert.equal(new URL(input).origin,"https://minepoa.com");assert.equal(init.redirect,"manual");calls++;
  return new Response(null,{status:302,headers:{location:"https://not-allowed.invalid/"}});
 }) as typeof fetch;
 await assert.rejects(new PoaHttpNetwork(()=>false,request).status(),/ESCROW_NODE_REDIRECT/);assert.equal(calls,2);
});
test("native submission retains write gate and never follows a redirect",async()=>{
 let calls=0;const body=depositBody(3,policy.wallet,"1.000000","redirect-fixture");
 const request=(async function(this:typeof globalThis,input:any,init:any){
  assert.equal(this,globalThis);assert.equal(new URL(input).origin,"https://minepoa.com");assert.equal(init.method,"POST");assert.equal(init.redirect,"manual");calls++;
  return new Response(null,{status:307,headers:{location:"https://not-allowed.invalid/"}});
 }) as typeof fetch;
 await assert.rejects(new PoaHttpNetwork(()=>false,request).submit(body),/ESCROW_NETWORK_WRITES_DISABLED/);assert.equal(calls,0);
 await assert.rejects(new PoaHttpNetwork(()=>true,request).submit(body),/ESCROW_NODE_REDIRECT/);assert.equal(calls,1);
});

// Display-only regressions: do not loosen or cache the financial safety lane.
test("slow successful display reads keep pins/freshness while financial status retains its exact 12s gate", async()=>{
 for(const latency of [3000,11000,12001]){
  let now=1800000000000;const cutoff=Math.floor(now/1000)-60;
  const request=(async(url:any)=>{const status=String(url).endsWith('/api/status');if(status)now+=latency;
   return Response.json(status?{K:5,chain_id:CHAIN,checkpoint:{height:10,cutoff_ts:cutoff},as_of:new Date(now).toISOString(),stale:false,state_root:root}:{chain_id:CHAIN,engine_sha256:MAINNET_ENGINE_SHA256,params_sha256:MAINNET_PARAMS_SHA256});}) as typeof fetch;
  const n=new PoaHttpNetwork(()=>false,request,undefined,()=>now);
  if(latency>12000)await assert.rejects(n.status(),/ESCROW_STALE/);else assert.equal((await n.status()).stale,false);
  const shown=await n.displayStatus();assert.equal(shown.stale,false);assert.equal(shown.readTiming?.totalMs,latency);
 }
});
test("display and financial reads share protocol/checkpoint rollback pins, not cached authorizations",async()=>{
 let height=11,changed=false;const now=1800000000000;
 const request=(async(url:any)=>Response.json(String(url).endsWith('/api/status')?{K:5,chain_id:CHAIN,checkpoint:{height,cutoff_ts:Math.floor(now/1000)-60},as_of:new Date(now).toISOString(),stale:false,state_root:root}:{chain_id:CHAIN,engine_sha256:changed?'0'.repeat(64):MAINNET_ENGINE_SHA256,params_sha256:MAINNET_PARAMS_SHA256})) as typeof fetch;
 const n=new PoaHttpNetwork(()=>false,request,undefined,()=>now);await n.displayStatus();height=10;
 await assert.rejects(n.status(),/ESCROW_CHECKPOINT_ROLLBACK/);await assert.rejects(n.displayStatus(),/ESCROW_CHECKPOINT_ROLLBACK/);
 height=11;changed=true;await assert.rejects(n.status(),/ESCROW_PROTOCOL_CHANGED/);await assert.rejects(n.displayStatus(),/ESCROW_PROTOCOL_CHANGED/);
});
test("display pairs settle both siblings and share one deadline across aliases; no orphan probe behind the cache",async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),signals:AbortSignal[]=[];let done=false;
 const request=(async(url:any,init:any)=>{signals.push(init.signal);if(String(url).endsWith('/api/status'))throw new DOMException('synthetic','TimeoutError');await gate;return Response.json({chain_id:CHAIN,engine_sha256:MAINNET_ENGINE_SHA256,params_sha256:MAINNET_PARAMS_SHA256});}) as typeof fetch;
 const n=new PoaHttpNetwork(()=>false,request);const pending=n.displayStatus().finally(()=>{done=true;});
 await new Promise(r=>setImmediate(r));assert.equal(done,false);release();await assert.rejects(pending,/ESCROW_NODE_TIMEOUT/);assert.equal(new Set(signals).size,1);
});

test("display fallback aliases use one overall read deadline, not a new deadline per request",async()=>{
 const now=1800000000000,signals=new Set<AbortSignal>();let requests=0;
 const request=(async(url:any,init:any)=>{requests++;signals.add(init.signal);const path=new URL(String(url)).pathname;
  if(path==='/api/status')return Response.json({K:5,chain_id:CHAIN,checkpoint:{height:10,cutoff_ts:Math.floor(now/1000)-60},as_of:new Date(now).toISOString(),stale:false,state_root:root});
  if(path==='/api/network/facts')return Response.json({chain_id:CHAIN,engine_sha256:MAINNET_ENGINE_SHA256,params_sha256:MAINNET_PARAMS_SHA256});
  return new Response(null,{status:404});}) as typeof fetch;
 const shown=await new PoaHttpNetwork(()=>false,request,undefined,()=>now).displayStatus();assert.equal(shown.stale,false);assert.equal(requests,5);assert.equal(signals.size,1);
});

// ---- POA new-name checkout (escrow "issue"), mock title store; the real Engine path is in escrow-runtime.mjs ----
function issueFixture(on=true){
 const journal=new MemoryJournal(policy),net=new MockNetwork();let newNames=on;const issued:Record<string,string>={};let failCommit=false,commits=0;
 const titles={terms:()=>({reserve:"1.000000",window:1000,quiet:1000}),validate:()=>{},commit:()=>{},
  issueTerms:(name:string)=>{assert.ok(!issued[name],"taken");return {price:"2000000"};},
  validateIssue:(p:any,name:string,buyer:string,price:string)=>{assert.equal(p.body.signer,buyer);assert.equal(p.body.params.name,name);assert.equal(p.body.params.price,price);},
  issue:(p:any)=>{if(failCommit)throw Error("ESCROW_ISSUE_COMMIT");issued[p.body.params.name]=p.body.signer;commits++;}};
 const e=new Escrow(journal,net,signer(),titles,policy,()=>net.now,()=>true,()=>{},()=>newNames);e.pause(false);
 return {e,net,issued,setOn:(v:boolean)=>{newNames=v;},failNext:(v:boolean)=>{failCommit=v;},commits:()=>commits};
}
function registration(buyer:number,name:string,price="2000000"):any{
 const e=new Engine(mainnetConfig(who(6),who(5),[who(2),who(3),who(4)]),{now:()=>1});
 const b={domain:"poa-domains.local.intent.v1",revision:e.config.revision,chainId:CHAIN,genesisHash:e.config.genesisHash,registryId:e.registryId,policyHash:e.policyHash,normalizationHash:e.config.normalizationHash,
  signer:who(buyer),coSigners:[],requestId:"issue-"+name,nonce:0,notBefore:0,deadline:2000000000,maxTotal:"0",maxNetworkFee:"0",action:"issueFromTreasury",
  params:{name,asset:"POA",price,expectedDeedId:null,expectedVersion:0,metadata:buildMetadataWitness(name)}};
 return signBody(b,[key(buyer)]);
}
test("checkout OFF: issue is refused before reading state, network or titles",async()=>{
 const f=issueFixture(false);await fund(f as any);const before=f.e.state();
 await assert.rejects(f.e.command(command(who(3),"i","issue",{name:"fresh",amount:"2.000000",registration:registration(3,"fresh")})),/ESCROW_NEW_NAMES_OFF/);
 assert.deepEqual(f.e.state(),before);assert.equal(f.commits(),0);
});
test("checkout ON: exact price, credited funds, treasury payout, idempotent, no double issue",async()=>{
 const f=issueFixture();await fund(f as any,3,"3.000000");
 await assert.rejects(f.e.command(command(who(3),"w","issue",{name:"fresh",amount:"1.000000",registration:registration(3,"fresh")})),/ESCROW_PRICE/);
 await assert.rejects(f.e.command(command(who(4),"x","issue",{name:"fresh",amount:"2.000000",registration:registration(4,"fresh")})),/ESCROW_INSUFFICIENT_FUNDS/);
 const r=await f.e.command(command(who(3),"ok","issue",{name:"fresh",amount:"2.000000",registration:registration(3,"fresh")})) as any;
 const s=f.e.state();assert.equal(s.available[who(3)],"1000000");assert.equal(f.issued.fresh,who(3));
 assert.deepEqual({to:s.payments[r.payment]!.to,amount:s.payments[r.payment]!.amount,kind:s.payments[r.payment]!.kind,status:s.payments[r.payment]!.status},{to:policy.treasury,amount:"2000000",kind:"seller",status:"READY"});
 invariant(s);
 assert.deepEqual(await f.e.command(command(who(3),"ok","issue",{name:"fresh",amount:"2.000000",registration:registration(3,"fresh")})),r);assert.equal(f.commits(),1);
 await assert.rejects(f.e.command(command(who(3),"ok2","issue",{name:"fresh",amount:"2.000000",registration:registration(3,"fresh")})));
 assert.equal(f.e.state().available[who(3)],"1000000","no second debit");
});
test("checkout: a failed registry issue leaves no debit and no payout (atomic)",async()=>{
 const f=issueFixture();await fund(f as any,3,"3.000000");const before=f.e.state();f.failNext(true);
 await assert.rejects(f.e.command(command(who(3),"fail","issue",{name:"fresh",amount:"2.000000",registration:registration(3,"fresh")})),/ESCROW_ISSUE_COMMIT/);
 assert.deepEqual(f.e.state(),before);
});
test("checkout: network hold, pause and per-transaction limit still apply",async()=>{
 const f=issueFixture();await fund(f as any,3,"3.000000");
 f.net.stale=true;await assert.rejects(f.e.command(command(who(3),"h","issue",{name:"fresh",amount:"2.000000",registration:registration(3,"fresh")})),/ESCROW_STALE|ESCROW_NETWORK_HELD/);f.net.stale=false;
 await f.e.pause(true);await assert.rejects(f.e.command(command(who(3),"p","issue",{name:"fresh",amount:"2.000000",registration:registration(3,"fresh")})),/ESCROW_PAUSED/);await f.e.pause(false);
 await assert.rejects(f.e.command(command(who(3),"l","issue",{name:"fresh",amount:"999999999.000000",registration:registration(3,"fresh")})),/ESCROW_AMOUNT/);
 assert.equal(f.commits(),0);
});
test("engine: issueFromTreasury is escrow-only, mints at the schedule price, cap 0; audited history hash unchanged",()=>{
 const e=new Engine(mainnetConfig(who(6),who(5),[who(2),who(3),who(4)]),{now:()=>1});
 const price=poaNewNamePriceMicros("standard"),reg=registration(3,"fresh",price);
 assert.throws(()=>e.submit(reg),/ESCROW_ONLY/);
 assert.throws(()=>e.preview(reg),/ESCROW_ONLY/);
 assert.equal(e.previewEscrowIssue(reg).status,"succeeded");
 const r=e.submitEscrowIssue(reg);assert.equal(r.status,"succeeded");const s=e.snapshot();assert.equal(s.deeds[s.names.fresh!.activeId!]!.owner,who(3));
 assert.deepEqual(e.submitEscrowIssue(registration(3,"fresh",price)),r,"same signed request is idempotent");
 assert.equal(e.submitEscrowIssue(registration(4,"fresh",price)).status,"rejected","an issued name cannot be issued twice");
 assert.equal(e.previewEscrowIssue(registration(2,"other","999999999")).status,"rejected","price must equal schedule");
 assert.throws(()=>e.submitEscrowIssue(consent({net:{now:1000}} as any)),/ESCROW_ISSUE_ACTION/);
});
test("PoA API token is sent only as a header, never in the URL, and auth failures fail closed",async()=>{
 const seen:{url:string;auth:string|null}[]=[];const token="test-token-not-real";
 const request=(async function(this:typeof globalThis,input:any,init:any){
  const h=new Headers(init.headers);seen.push({url:String(input),auth:h.get("authorization")});
  assert.equal(new URL(input).origin,"https://minepoa.com");assert.equal(init.redirect,"manual");
  return new Response(JSON.stringify({error:"Unauthorized"}),{status:401});
 }) as typeof fetch;
 const n=new PoaHttpNetwork(()=>true,request,undefined,Date.now,token);
 await assert.rejects(n.status(),/ESCROW_NODE_AUTH/);
 assert.ok(seen.length>=2,"falls through every candidate path on 401");
 for(const s of seen){assert.equal(s.auth,`Bearer ${token}`);assert.ok(!s.url.includes(token));}
 const body=depositBody(3,policy.wallet,"1.000000","auth-fixture");seen.length=0;
 await n.submit(body);assert.equal(seen[0]!.auth,`Bearer ${token}`);assert.ok(!seen[0]!.url.includes(token));
 seen.length=0;await assert.rejects(new PoaHttpNetwork(()=>false,request).status(),/ESCROW_NODE_AUTH/);
 for(const s of seen)assert.equal(s.auth,null);
});
test("locked PoA chain status holds as ESCROW_NODE_AUTH, not a misleading identity mismatch",async()=>{
 const request=(async(url:any)=>{const p=new URL(String(url)).pathname;
  if(p===`/chain/${CHAIN}/api/status`)return new Response(JSON.stringify({error:"Unauthorized"}),{status:401});
  if(p==="/api/status")return Response.json({network:"PoA prototype",K:5,supply:"1",txs:1907,final:9064,invalid:0,epochs_closed:75,as_of:new Date().toISOString(),checkpoint_height:811925,state_root:"a".repeat(64),stale:true,stale_age_s:793});
  return Response.json({chain_id:CHAIN,open_epoch:75,engine_sha256:MAINNET_ENGINE_SHA256,params_sha256:MAINNET_PARAMS_SHA256});
 }) as typeof fetch;
 await assert.rejects(new PoaHttpNetwork(()=>false,request).status(),/ESCROW_NODE_AUTH/);
 await assert.rejects(new PoaHttpNetwork(()=>false,request).displayStatus(),/ESCROW_NODE_AUTH/);
});

// Owner-reviewed one-shot credit (Max t140s1299): a deposit that arrived while held, then clear the halt.
async function heldDeposit(attestations=5,covered=true){
 const f=fixture();await fund(f);
 const r=await f.e.command(command(who(4),"intent-held","intent",{amount:"1.000000"})) as any;
 const id=f.net.add(depositBody(4,policy.wallet,"1.000000",r.intent),attestations,covered);
 // The wallet holds 1 POA nobody credited: reconcile quarantines with ASSET_LIABILITY_MISMATCH.
 f.net.mismatch=micros("1.000000");await assert.rejects(f.e.reconcile(),/MISMATCH/);f.net.mismatch=0n;
 assert.equal(f.e.state().halt,"ASSET_LIABILITY_MISMATCH");
 return {f,review:{id:"held-1",txid:id,from:who(4),amount:"1.000000",intent:r.intent,halt:"ASSET_LIABILITY_MISMATCH"}};
}
test("reviewed credit: credits the exact held deposit, clears the halt, keeps pause, and cannot be reused",async()=>{
 const {f,review}=await heldDeposit();const before=f.e.state();
 const s=await f.e.creditReviewed(review);
 assert.equal(s.halt,null);assert.equal(s.paused,before.paused);
 assert.equal(s.deposits[review.intent]!.tx,review.txid);assert.ok(s.credited[review.txid]);
 assert.equal(s.available[who(4)],"1000000");assert.equal(BigInt(s.assets),BigInt(before.assets)+1000000n);
 assert.equal(s.reviews![review.id]!.txid,review.txid);
 assert.deepEqual(Object.keys(s.quarantine),Object.keys(before.quarantine),"the quarantine record stays as history");
 assert.equal(f.journal.rows.at(-1)!.event,"reviewed-credit");
 await assert.rejects(f.e.creditReviewed(review),/ESCROW_REVIEW_USED/);
 await assert.rejects(f.e.creditReviewed({...review,id:"held-2"}),/ESCROW_REVIEW_STATE/,"a second id cannot run once the halt is gone");
 await f.e.reconcile();assert.equal(f.e.state().halt,null,"the wallet now reconciles");
 replay(f.journal.rows,policy);
});
test("reviewed credit fails closed on any fact that does not match, with no journal write",async()=>{
 const {f,review}=await heldDeposit();const rows=f.journal.rows.length;
 const other=f.net.add(depositBody(3,policy.wallet,"1.000000","x".repeat(64),9));
 for(const [bad,code] of [
  [{amount:"2.000000"},/ESCROW_REVIEW_INTENT/],[{from:who(3)},/ESCROW_REVIEW_INTENT/],[{intent:"0".repeat(64)},/ESCROW_REVIEW_INTENT/],
  [{txid:other},/ESCROW_DEPOSIT_BINDING/],[{txid:"f".repeat(64)},/ESCROW_UNKNOWN_DEPOSIT/],[{halt:"ESCROW_OTHER"},/ESCROW_REVIEW_STATE/],
  [{txid:"nothex"},/ESCROW_REVIEW/],[{extra:1},/./]] as const)
  await assert.rejects(f.e.creditReviewed({...review,...bad} as any),code,JSON.stringify(bad));
 f.net.mismatch=micros("0.500000");await assert.rejects(f.e.creditReviewed(review),/ESCROW_RECONCILIATION_MISMATCH/,"other unexplained funds keep the halt");f.net.mismatch=0n;
 f.net.badCut=true;await assert.rejects(f.e.creditReviewed(review),/ESCROW_UNALIGNED_CUT/);f.net.badCut=false;
 assert.equal(f.journal.rows.length,rows);assert.equal(f.e.state().halt,"ASSET_LIABILITY_MISMATCH");
 f.disable();await assert.rejects(f.e.creditReviewed(review),/ESCROW_DISABLED/);
});
test("reviewed credit needs PoA finality and a fresh network read",async()=>{
 { const {f,review}=await heldDeposit(1,false);const rows=f.journal.rows.length;
   await assert.rejects(f.e.creditReviewed(review),/ESCROW_NOT_FINAL/);assert.equal(f.journal.rows.length,rows); }
 const {f,review}=await heldDeposit();const rows=f.journal.rows.length;
 f.net.stale=true;await assert.rejects(f.e.creditReviewed(review),/ESCROW_(STALE|NETWORK_HELD)/);f.net.stale=false;
 f.net.down=true;await assert.rejects(f.e.creditReviewed(review),/ESCROW_NETWORK_HELD/);f.net.down=false;
 assert.equal(f.journal.rows.length,rows);
 await f.e.creditReviewed(review);assert.equal(f.e.state().halt,null);
});
test("committed reviewed credit is exactly DT1's 1 POA deposit to its own intent",()=>{
 assert.deepEqual(Object.keys(REVIEWED_CREDITS),["dt1-deposit-2026-11-13"]);
 const r=reviewedCredit("dt1-deposit-2026-11-13");
 assert.equal(r.txid,"e0c05f6b24f5bcd85abacb078ada23367fc5b98eeec35088b73d2d6f84585123");
 assert.equal(r.from,"poa15kUYz7V59rd1zY12bp1Kvnx5HWjYhTeS6o74uu9KUXCC");
 assert.equal(r.amount,"1.000000");assert.equal(r.intent,"659ff32af83914966fa9f16edf23a21857aafca06b50a16d8d4e092f55d0a9fc");
 assert.equal(r.halt,"ASSET_LIABILITY_MISMATCH");assert.ok(Object.isFrozen(r)&&Object.isFrozen(REVIEWED_CREDITS));
 for(const id of ["__proto__","constructor","toString","",1])assert.throws(()=>reviewedCredit(id),/ESCROW_REVIEW|./);
});
// ---- POA subname sales: parent holder lists, buyer pays through escrow, proceeds wait as READY payouts ----
import { escrowPacketBlocked, registryTitles } from "../escrow-titles.js";
function subRegistration(e:Engine,buyer:number,name:string,price:string,overrides:Record<string,unknown>={},tag="sub"):any{
 const s=e.snapshot(),root=s.deeds[s.names[name.split(".").at(-1)!]!.activeId!]!;
 const b={domain:"poa-domains.local.intent.v1",revision:e.config.revision,chainId:CHAIN,genesisHash:e.config.genesisHash,registryId:e.registryId,policyHash:e.policyHash,normalizationHash:e.config.normalizationHash,
  signer:who(buyer),coSigners:[],requestId:(tag+"-"+name+"-"+buyer).replace(/[^a-zA-Z0-9_-]/g,"_"),nonce:e.nextNonce(who(buyer)),notBefore:0,deadline:2000000000,maxTotal:"0",maxNetworkFee:"0",action:"issueSubname",
  params:{name,parentDeedId:root.id,parentOwnerVersion:root.ownerVersion,asset:"POA",price,expectedGeneration:1,metadata:buildMetadataWitness(name,{kind:"permanent"},root.id)},...overrides};
 return signBody(b,[key(buyer)]);
}
function subFixture(on=true){
 const journal=new MemoryJournal(policy),net=new MockNetwork();let subnames=on;
 const engine=new Engine(mainnetConfig(who(6),who(5),[who(2),who(3),who(4)]),{now:()=>Math.floor(net.now/1000)});
 assert.equal(engine.submitEscrowIssue(registration(2,"parent",poaNewNamePriceMicros("standard"))).status,"succeeded");
 const e=new Escrow(journal,net,signer(),registryTitles(engine),policy,()=>net.now,()=>true,()=>{},()=>false,()=>subnames);e.pause(false);
 return {e,net,engine,journal,setOn:(v:boolean)=>{subnames=v;}};
}
const owner=(e:Engine,name:string)=>{const s=e.snapshot(),id=s.names[name]?.activeId;return id?s.deeds[id]!.owner:null;};
test("subnames OFF: list and buy are refused before any state, network or title read",async()=>{
 const f=subFixture(false);await f.e.pause(false);const before=f.e.state();
 await assert.rejects(f.e.command(command(who(2),"l","list-sub",{parent:"parent",price:"5.000000"})),/ESCROW_SUBNAMES_OFF/);
 await assert.rejects(f.e.command(command(who(3),"b","buy-sub",{listing:"0".repeat(64),name:"shop.parent",amount:"5.000000",registration:subRegistration(f.engine,3,"shop.parent","5000000")})),/ESCROW_SUBNAMES_OFF/);
 assert.deepEqual(f.e.state(),before);
});
test("subnames: only the parent holder lists; buyer pays the exact price; child minted; proceeds held as READY payouts",async()=>{
 const f=subFixture();await fund(f as any,3,"20.000000");
 await assert.rejects(f.e.command(command(who(3),"x","list-sub",{parent:"parent",price:"5.000000"})),/ESCROW_TITLE/,"non-holder cannot list");
 await assert.rejects(f.e.command(command(who(2),"y","list-sub",{parent:"missing",price:"5.000000"})),/ESCROW_TITLE/);
 const {listing}=await f.e.command(command(who(2),"l","list-sub",{parent:"parent",price:"5.000000"})) as any;
 await assert.rejects(f.e.command(command(who(2),"l2","list-sub",{parent:"parent",price:"6.000000"})),/ESCROW_SUB_LISTED/);
 const reg=subRegistration(f.engine,3,"shop.parent","5000000");
 await assert.rejects(f.e.command(command(who(3),"p","buy-sub",{listing,name:"shop.parent",amount:"4.000000",registration:reg})),/ESCROW_PRICE/);
 await assert.rejects(f.e.command(command(who(3),"n","buy-sub",{listing,name:"shop.other",amount:"5.000000",registration:reg})),/ESCROW_SUB_NAME/);
 await assert.rejects(f.e.command(command(who(3),"c","buy-sub",{listing,name:"shop.parent",amount:"5.000000",registration:subRegistration(f.engine,3,"shop.parent","5000000",{maxTotal:"1"})})),/ESCROW_SUB_CONSENT/);
 await assert.rejects(f.e.command(command(who(2),"s","buy-sub",{listing,name:"own.parent",amount:"5.000000",registration:subRegistration(f.engine,2,"own.parent","5000000")})),/ESCROW_SELF_SALE/);
 assert.equal(f.e.state().available[who(3)],"20000000","no failed attempt moved POA");
 const r=await f.e.command(command(who(3),"ok","buy-sub",{listing,name:"shop.parent",amount:"5.000000",registration:reg})) as any;
 assert.equal(owner(f.engine,"shop.parent"),who(3));assert.equal(r.issued,"shop.parent");
 const s=f.e.state();assert.equal(s.available[who(3)],"15000000");invariant(s);
 const pays=r.payments.map((id:string)=>s.payments[id]!);
 assert.deepEqual(pays.map((p:any)=>[p.kind,p.to,p.amount,p.status]),[["seller",who(2),"4875000","READY"],["fee",policy.treasury,"125000","READY"]]);
 assert.deepEqual(s.subListings![listing]!.sold.map(x=>x.name),["shop.parent"]);
 const child=f.engine.snapshot().deeds[f.engine.snapshot().names["shop.parent"]!.activeId!]!;
 assert.equal(child.rights.kind,"permanent");assert.equal(child.parentId,f.engine.snapshot().names.parent!.activeId);
 await assert.rejects(f.e.command(command(who(4),"dup","buy-sub",{listing,name:"shop.parent",amount:"5.000000",registration:subRegistration(f.engine,4,"shop.parent","5000000")})),/ESCROW_SUB_NOT_READY|ESCROW_INSUFFICIENT_FUNDS/);
 assert.deepEqual(await f.e.command(command(who(3),"ok","buy-sub",{listing,name:"shop.parent",amount:"5.000000",registration:reg})),r,"same signed request is idempotent");
 assert.equal(f.e.state().available[who(3)],"15000000","no second debit");
});
test("subnames: a parent that changed hands voids the listing; the holder can cancel; nothing moves",async()=>{
 const f=subFixture();await fund(f as any,3,"20.000000");
 const {listing}=await f.e.command(command(who(2),"l","list-sub",{parent:"parent",price:"5.000000"})) as any;
 await assert.rejects(f.e.command(command(who(4),"c","cancel-sub",{listing})),/ESCROW_CANCEL_NOT_ALLOWED/);
 // Parent holder transfers the root to who(4): ownerVersion changes, so the old listing no longer applies.
 const s0=f.engine.snapshot(),root=s0.deeds[s0.names.parent!.activeId!]!;
 const t={domain:"poa-domains.local.intent.v1",revision:f.engine.config.revision,chainId:CHAIN,genesisHash:f.engine.config.genesisHash,registryId:f.engine.registryId,policyHash:f.engine.policyHash,normalizationHash:f.engine.config.normalizationHash,
  signer:who(2),coSigners:[],requestId:"move-parent",nonce:f.engine.nextNonce(who(2)),notBefore:0,deadline:2000000000,maxTotal:"0",maxNetworkFee:"0",action:"transfer",params:{name:"parent",expectedDeedId:root.id,expectedVersion:root.version,recipient:who(4)}};
 assert.equal(f.engine.submit(signBody(t,[key(2)])).status,"succeeded");
 await assert.rejects(f.e.command(command(who(3),"b","buy-sub",{listing,name:"shop.parent",amount:"5.000000",registration:subRegistration(f.engine,3,"shop.parent","5000000")})),/ESCROW_TITLE|ESCROW_SUB_STALE/);
 assert.equal(f.e.state().available[who(3)],"20000000");assert.equal(owner(f.engine,"shop.parent"),null);
 await f.e.command(command(who(2),"c2","cancel-sub",{listing}));assert.equal(f.e.state().subListings![listing]!.status,"CANCELLED");
 await assert.rejects(f.e.command(command(who(3),"b2","buy-sub",{listing,name:"shop.parent",amount:"5.000000",registration:subRegistration(f.engine,3,"shop.parent","5000000",{},"b2")})),/ESCROW_SUB_CLOSED/);
});
test("subnames: network hold and pause apply to buying; a failed registry write moves no POA",async()=>{
 const f=subFixture();await fund(f as any,3,"20.000000");
 const {listing}=await f.e.command(command(who(2),"l","list-sub",{parent:"parent",price:"5.000000"})) as any;
 f.net.stale=true;await assert.rejects(f.e.command(command(who(3),"h","buy-sub",{listing,name:"shop.parent",amount:"5.000000",registration:subRegistration(f.engine,3,"shop.parent","5000000")})),/ESCROW_STALE|ESCROW_NETWORK_HELD/);f.net.stale=false;
 await f.e.pause(true);await assert.rejects(f.e.command(command(who(3),"p","buy-sub",{listing,name:"shop.parent",amount:"5.000000",registration:subRegistration(f.engine,3,"shop.parent","5000000")})),/ESCROW_PAUSED/);await f.e.pause(false);
 const before=f.e.state();
 await assert.rejects(f.e.command(command(who(3),"g","buy-sub",{listing,name:"shop.parent",amount:"5.000000",registration:subRegistration(f.engine,3,"shop.parent","5000000",{params:{...subRegistration(f.engine,3,"shop.parent","5000000").body.params,expectedGeneration:2}})})),/ESCROW_SUB_NOT_READY/);
 assert.deepEqual(f.e.state(),before);
});
test("engine: issueSubname is escrow-only, permanent, cap 0, and keeps child rules (revoke needs the parent)",()=>{
 const e=new Engine(mainnetConfig(who(6),who(5),[who(2),who(3),who(4)]),{now:()=>1});
 assert.equal(e.submitEscrowIssue(registration(2,"parent",poaNewNamePriceMicros("standard"))).status,"succeeded");
 const reg=subRegistration(e,3,"shop.parent","5000000");
 assert.throws(()=>e.submit(reg),/ESCROW_ONLY/);assert.throws(()=>e.preview(reg),/ESCROW_ONLY/);
 assert.equal(e.previewEscrowIssue(subRegistration(e,2,"own.parent","5000000")).status,"rejected","the parent holder cannot buy from themself");
 assert.equal(e.previewEscrowIssue(subRegistration(e,3,"deep.shop.parent","5000000")).status,"rejected","one level only");
 assert.equal(e.previewEscrowIssue(subRegistration(e,3,"shop.parent","5000000",{maxTotal:"5"})).status,"rejected");
 { const rr=e.submitEscrowIssue(reg);assert.equal(rr.status,"succeeded",JSON.stringify(rr)); }
 assert.equal(e.submitEscrowIssue(subRegistration(e,4,"shop.parent","5000000")).status,"rejected","a sold subname cannot be sold twice");
 const s=e.snapshot(),child=s.deeds[s.names["shop.parent"]!.activeId!]!,root=s.deeds[s.names.parent!.activeId!]!;
 const revoke=(co:string[])=>signBody({domain:"poa-domains.local.intent.v1",revision:e.config.revision,chainId:CHAIN,genesisHash:e.config.genesisHash,registryId:e.registryId,policyHash:e.policyHash,normalizationHash:e.config.normalizationHash,
  signer:who(3),coSigners:co,requestId:"revoke-"+co.length,nonce:e.nextNonce(who(3)),notBefore:0,deadline:2000000000,maxTotal:"0",maxNetworkFee:"0",action:"revokeChild",
  params:{name:"shop.parent",expectedDeedId:child.id,expectedVersion:child.version,parentOwnerVersion:root.ownerVersion}},co.length?[key(3),key(2)]:[key(3)]);
 assert.equal(e.preview(revoke([])).status,"rejected","the child holder alone cannot revoke");
 assert.equal(e.preview(revoke([who(2)])).status,"succeeded","child holder plus parent holder can revoke, as before");
});

test("primary status timeout falls back to live /api/status shape and snapshot cutoff; stale and 401 still fail closed",async()=>{
 const now=NOW_V2;
 const liveFresh={network:"PoA prototype",K:5,txs:5664,final:5349,invalid:0,epochs_closed:111,as_of:new Date(now-5000).toISOString(),checkpoint_height:1445570,state_root:root};
 const facts={chain_id:CHAIN,open_epoch:111,engine_sha256:MAINNET_ENGINE_SHA256,params_sha256:MAINNET_PARAMS_SHA256,economics:{K:5}};
 const afterTx=signedV2(3,policy.wallet,"1.000000","poadomains:open-window",1,CUTOFF_V2+30),afterId=txid(afterTx);
 const paths:string[]=[];
 const request=(async(input:any)=>{
  const p=new URL(String(input)).pathname;paths.push(p);
  if(p===`/chain/${CHAIN}/api/status`)throw new DOMException("primary hung","TimeoutError");
  if(p==="/api/status")return Response.json(liveFresh);
  if(p===`/chain/${CHAIN}/api/network-facts`)return Response.json(facts);
  if(p===`/api/explorer/address/${policy.wallet}`)return Response.json({address:policy.wallet,balance:"0.000000",balance_as_of:{checkpoint_height:1445570},
   txs:[{id:afterId,type:"transfer",from_addr:who(3),to_addr:policy.wallet,amount:"1.000000",ts:afterTx.ts},{id:afterId,type:"transfer",from_addr:who(3),to_addr:policy.wallet,amount:"1.000000",ts:afterTx.ts},{id:"f".repeat(64),type:"transfer",from_addr:policy.wallet,to_addr:who(4),amount:"1.000000",ts:afterTx.ts}]});
  if(p===`/api/explorer/tx/${afterId}`)return Response.json(explorerV2(afterTx,{checkpoint_height:1445570}));
  if(p===`/api/receipt/${afterId}`)return Response.json(receiptV2(afterId));
  if(p==="/api/snapshot")return Response.json({params:{chain_id:CHAIN},checkpoint:{height:1445570,cutoff:{ts:CUTOFF_V2}}});
  return new Response(null,{status:404});
 }) as typeof fetch;
 const net=new PoaHttpNetwork(()=>false,request,undefined,()=>now);
 const d=await net.displayStatus();assert.equal(d.stale,false);assert.equal(d.height,1445570);assert.equal(d.root,root);
 const s=await net.status();assert.equal(s.stale,false);assert.equal(s.height,1445570);assert.equal(s.root,root);
 assert.deepEqual(await net.incoming(policy.wallet),[afterId],"deduplicates explorer address rows and filters to incoming transfers");
 const cut=await net.cut(policy.wallet,[afterId],s);
 assert.deepEqual(cut.covered,[],"post-cutoff open-window tx resolved via snapshot cutoff without halting");
 assert.ok(paths.includes("/api/snapshot"));
 // Stale /api/status (explicit stale:true, old as_of, or non-boolean stale) still fails closed.
 for(const bad of [{...liveFresh,stale:true,stale_age_s:222},{...liveFresh,as_of:new Date(now-150000).toISOString()},{...liveFresh,stale:"no"}]){
  const staleReq=(async(input:any)=>{const p=new URL(String(input)).pathname;
   if(p===`/chain/${CHAIN}/api/status`)throw new DOMException("primary hung","TimeoutError");
   if(p==="/api/status")return Response.json(bad);
   return Response.json(facts);}) as typeof fetch;
  await assert.rejects(new PoaHttpNetwork(()=>false,staleReq,undefined,()=>now).status(),/ESCROW_STALE/);
 }
 // 401 on primary chain status STILL fails closed as ESCROW_NODE_AUTH even if /api/status is fresh.
 const authReq=(async(input:any)=>{const p=new URL(String(input)).pathname;
  if(p===`/chain/${CHAIN}/api/status`)return new Response(JSON.stringify({error:"Unauthorized"}),{status:401});
  if(p==="/api/status")return Response.json(liveFresh);
  return Response.json(facts);}) as typeof fetch;
 await assert.rejects(new PoaHttpNetwork(()=>false,authReq,undefined,()=>now).status(),/ESCROW_NODE_AUTH/);
 await assert.rejects(new PoaHttpNetwork(()=>false,authReq,undefined,()=>now).displayStatus(),/ESCROW_NODE_AUTH/);
});

test("hung chain receipt falls back to /api/receipt; mismatched fallback binding still fails closed",async()=>{
 const now=NOW_V2;
 const body=signedV2(3,policy.wallet,"1.000000","poadomains:receipt-fallback",1,CUTOFF_V2+30),id=txid(body);
 const paths:string[]=[];
 const request=(receipt:any,primary:"timeout"|"auth"|"http")=>(async(input:any)=>{
  const p=new URL(String(input)).pathname;paths.push(p);
  if(p===`/chain/${CHAIN}/api/receipt/${id}`){
   if(primary==="auth")return new Response(JSON.stringify({error:"Unauthorized"}),{status:401});
   if(primary==="http")return new Response(JSON.stringify({error:"paused"}),{status:503});
   throw new DOMException("primary hung","TimeoutError");
  }
  if(p===`/api/receipt/${id}`)return Response.json(receipt);
  if(p===`/api/explorer/tx/${id}`)return Response.json(explorerV2(body));
  return new Response(null,{status:404});
 }) as typeof fetch;
 const net=(receipt:any,primary:"timeout"|"auth"|"http"="timeout")=>
  new PoaHttpNetwork(()=>false,request(receipt,primary),{engine:root,params:root},()=>now);
 // Hung /chain/.../api/receipt falls back to a bound /api/receipt.
 const ok=await net(receiptV2(id)).lookup(id);
 assert.equal(ok?.valid,true);assert.equal(ok?.attestations,5);assert.deepEqual(ok?.body,body);
 assert.ok(paths.includes(`/chain/${CHAIN}/api/receipt/${id}`));
 assert.ok(paths.includes(`/api/receipt/${id}`));
 // Fallback receipt with a mismatched txid still fails closed.
 paths.length=0;
 await assert.rejects(net(receiptV2(id,{txid:"f".repeat(64)})).lookup(id),/ESCROW_TX_BINDING/);
 assert.ok(paths.includes(`/api/receipt/${id}`));
 // Fallback receipt with a mismatched legacy sender still fails closed.
 await assert.rejects(net(receiptV2(id,{from:who(4),type:"transfer",checkpoint_covered:true})).lookup(id),/ESCROW_RECEIPT_BINDING/);
 // 401 and 503 on the primary chain receipt still fall through to /api/receipt.
 paths.length=0;
 assert.equal((await net(receiptV2(id),"auth").lookup(id))?.valid,true);
 assert.ok(paths.includes(`/api/receipt/${id}`));
 paths.length=0;
 assert.equal((await net(receiptV2(id),"http").lookup(id))?.valid,true);
 assert.ok(paths.includes(`/api/receipt/${id}`));
});

test("auto-sweep credits finalized matching open intents before reconciliation without halting; unsolicited funds still halt",async()=>{
 const f=issueFixture();f.net.autoDiscover=true;
 const r=await f.e.command(command(who(3),"auto-intent","intent",{amount:"2.000000"})) as any;
 const depId=f.net.add(depositBody(3,policy.wallet,"2.000000",r.intent),5,true);
 // Checkpoint closes before buyer calls detect: tick/reconcile sweeps the exact open intent instead of halting.
 await f.e.tick();
 assert.equal(f.e.state().halt,null);
 assert.equal(f.e.state().available[who(3)],"2000000");
 assert.equal(f.e.state().deposits[r.intent]!.tx,depId);
 // Buyer's subsequent detect confirms cleanly without double-crediting.
 const det=await f.e.command(command(who(3),"auto-detect","detect",{intent:r.intent,txid:depId})) as any;
 assert.deepEqual(det,{ok:true,alreadyCredited:true});
 assert.equal(f.e.state().available[who(3)],"2000000");
 assert.equal(f.e.state().assets,"2000000");
 // Buyer can immediately issue a domain using the auto-credited funds.
 const issued=await f.e.command(command(who(3),"auto-issue","issue",{name:"sweptname",amount:"2.000000",registration:registration(3,"sweptname")})) as any;
 assert.equal(issued.issued,"sweptname");assert.equal(f.issued.sweptname,who(3));
 // Paused escrow never auto-sweeps open intents.
 const rPaused=await f.e.command(command(who(4),"paused-intent","intent",{amount:"1.000000"})) as any;
 await f.e.pause(true);
 f.net.add(depositBody(4,policy.wallet,"1.000000",rPaused.intent),5,true);
 await assert.rejects(f.e.reconcile(),/MISMATCH/);
 assert.equal(f.e.state().halt,"ASSET_LIABILITY_MISMATCH");
 assert.equal(f.e.state().deposits[rPaused.intent]!.tx,null,"paused deposit is not auto-credited");
 // Unsolicited deposit (wrong memo / no open intent) on open escrow still quarantines with ASSET_LIABILITY_MISMATCH.
 const g=fixture();g.net.autoDiscover=true;
 g.net.add(depositBody(4,policy.wallet,"1.000000","0".repeat(64)),5,true);
 await assert.rejects(g.e.reconcile(),/MISMATCH/);
 assert.equal(g.e.state().halt,"ASSET_LIABILITY_MISMATCH");
});

test("outbid instant available credit, multi-auction holding, chunked withdrawal & adversarial theft/abuse guards",async()=>{
 // Tight perTx (6 POA) proves balances > perTx after outbid still reserve full chunked withdrawal capacity.
 const tight={...policy,perTx:"6.000000",daily:"100.000000"};
 const f=fixture(()=>{},tight);
 await fund(f,3,"6.000000","a1",1);
 await fund(f,3,"4.000000","a2",2); // who(3) holds 10 POA (> perTx 6 POA)
 await fund(f,4,"6.000000","b1");
 await fund(f,5,"6.000000","c1");
 const o1=await f.e.command(command(who(2),"open-a","open",{name:"alpha",reserve:"1.000000"})) as any;
 const o2=await f.e.command(command(who(2),"open-b","open",{name:"beta",reserve:"1.000000"})) as any;

 // Alice bids 4 POA on alpha and 4 POA on beta -> 2 POA available, 8 POA locked.
 await f.e.command(command(who(3),"bid-a1","bid",{auction:o1.auction,amount:"4.000000"}));
 await f.e.command(command(who(3),"bid-b1","bid",{auction:o2.auction,amount:"4.000000"}));
 assert.equal(f.e.state().available[who(3)],"2000000");

 // Adversarial checks while leading:
 // 1. Cannot withdraw locked bid funds.
 await assert.rejects(f.e.command(command(who(3),"steal-locked","withdraw",{amount:"2.000001"})),/ESCROW_INSUFFICIENT_FUNDS/);
 // 2. Cannot withdraw > perTx in one chunk.
 await assert.rejects(f.e.command(command(who(3),"over-pertx","withdraw",{amount:"6.000001"})),/ESCROW_PAYOUT_LIMIT/);
 // 3. Cannot redirect withdrawal to another address.
 await assert.rejects(f.e.command(command(who(3),"redir","withdraw",{amount:"1.000000",to:who(4)})),/SCHEMA/);
 // 4. Cannot self-raise or self-bid to manufacture available balance.
 await assert.rejects(f.e.command(command(who(3),"self-raise","bid",{auction:o1.auction,amount:"5.000000"})),/ESCROW_SELF_RAISE/);
 await assert.rejects(f.e.command(command(who(2),"self-bid","bid",{auction:o1.auction,amount:"5.000000"})),/ESCROW_SELF_SALE/);
 // 5. Zero/negative/invalid amounts rejected.
 for(const bad of ["0.000000","-1.000000","1.0000001"])
  await assert.rejects(f.e.command(command(who(3),"bad-"+bad,"withdraw",{amount:bad})));

 // Bob outbids Alice on alpha (5 POA) -> Alice immediately gets 4 POA back (2 -> 6 POA available) with 0 payouts.
 await f.e.command(command(who(4),"bid-a2","bid",{auction:o1.auction,amount:"5.000000"}));
 assert.equal(f.e.state().available[who(3)],"6000000");
 assert.equal(f.e.state().available[who(4)],"1000000");
 assert.equal(Object.keys(f.e.state().payments).length,0);

 // Alice instantly re-bids 6 POA on alpha using returned balance -> Bob immediately gets 5 POA back (1 -> 6 POA available).
 await f.e.command(command(who(3),"bid-a3","bid",{auction:o1.auction,amount:"6.000000"}));
 assert.equal(f.e.state().available[who(3)],"0");
 assert.equal(f.e.state().available[who(4)],"6000000");

 // Carol outbids Alice on beta (5 POA) -> Alice immediately gets 4 POA back.
 await f.e.command(command(who(5),"bid-b2","bid",{auction:o2.auction,amount:"5.000000"}));
 assert.equal(f.e.state().available[who(3)],"4000000");

 // Cancel both auctions and let everyone withdraw every remaining micro cleanly to assets === "0".
 await f.e.command(command(who(2),"c1","cancel",{auction:o1.auction})); // refunds Alice's 6 POA on alpha
 await f.e.command(command(who(2),"c2","cancel",{auction:o2.auction})); // refunds Carol's 5 POA on beta
 await f.e.command(command(who(3),"w-alice","withdraw",{amount:"4.000000"}));
 await f.e.command(command(who(4),"w-bob","withdraw",{amount:"6.000000"}));
 await f.e.command(command(who(5),"w-carol","withdraw",{amount:"1.000000"}));
 for(let i=0;i<15;i++)await f.e.tick();
 assert.equal(f.e.state().assets,"0");
 assert.equal(f.e.state().available[who(3)],"0");
 assert.equal(f.e.state().available[who(4)],"0");
 assert.equal(f.e.state().available[who(5)],"0");
 // Every outgoing transfer paid ONLY the exact original depositor.
 const paidByAddr=new Map<string,bigint>();
 for(const tx of f.net.submitted)paidByAddr.set(tx.to,(paidByAddr.get(tx.to)??0n)+micros(tx.amount));
 assert.equal(paidByAddr.get(who(3)),10000000n);
 assert.equal(paidByAddr.get(who(4)),6000000n);
 assert.equal(paidByAddr.get(who(5)),6000000n);
 assert.deepEqual(replay(f.journal.rows,tight),f.e.state());
 invariant(f.e.state());
});

test("randomized multi-bidder multi-auction property test: deposits, outbids, instant re-bids & withdrawals conserve assets = liabilities",async()=>{
 const actors=[3,4,5] as const;
 let ops=0;
 for(let run=0;run<12;run++){
  const f=fixture();
  const avail=new Map<string,bigint>([[who(3),0n],[who(4),0n],[who(5),0n]]);
  let totalAssets=0n;
  for(const n of actors){
   await fund(f,n,"20.000000",`init-${n}`);
   avail.set(who(n),20000000n);
   totalAssets+=20000000n;
  }
  const o1=await f.e.command(command(who(2),"o1","open",{name:"n1",reserve:"1.000000"})) as any;
  const o2=await f.e.command(command(who(2),"o2","open",{name:"n2",reserve:"1.000000"})) as any;
  const high=new Map<string,{payer:string;amount:bigint}|null>([[o1.auction,null],[o2.auction,null]]);
  let rng=(run+1)*2654435761>>>0;
  const nextRand=()=>{rng=(rng*1664525+1013904223)>>>0;return rng;};
  for(let step=0;step<25;step++){
   const actorIdx=actors[nextRand()%actors.length]!;
   const actor=who(actorIdx);
   const mode=nextRand()%3;
   if(mode<2){
    const aucId=mode===0?o1.auction:o2.auction;
    const cur=high.get(aucId);
    const minBid=cur?(cur.amount*11n)/10n+1n:1000000n;
    const bidAmt=minBid+BigInt(nextRand()%200000);
    const canBid=cur?.payer!==actor&&avail.get(actor)!>=bidAmt&&bidAmt<=micros(policy.perTx);
    const cmd=command(actor,`b-${step}`,"bid",{auction:aucId,amount:decimal(bidAmt)});
    if(canBid){
     await f.e.command(cmd);
     avail.set(actor,avail.get(actor)!-bidAmt);
     if(cur)avail.set(cur.payer,avail.get(cur.payer)!+cur.amount);
     high.set(aucId,{payer:actor,amount:bidAmt});
     // Idempotent replay of exact same bid must not double-debit or double-credit.
     await f.e.command(cmd);
    } else {
     await assert.rejects(f.e.command(cmd));
    }
   } else {
    const amt=BigInt((nextRand()%3000000)+1);
    const cmd=command(actor,`w-${step}`,"withdraw",{amount:decimal(amt)});
    if(avail.get(actor)!>=amt){
     await f.e.command(cmd);
     avail.set(actor,avail.get(actor)!-amt);
     await f.e.command(cmd); // idempotent replay
    } else {
     await assert.rejects(f.e.command(cmd));
    }
   }
   const st=f.e.state();
   invariant(st);
   for(const n of actors)assert.equal(BigInt(st.available[who(n)]??"0"),avail.get(who(n))!);
   assert.equal(BigInt(st.assets),totalAssets);
   ops++;
  }
  await f.e.command(command(who(2),"cancel-1","cancel",{auction:o1.auction}));
  await f.e.command(command(who(2),"cancel-2","cancel",{auction:o2.auction}));
  for(const n of actors){
   const rem=avail.get(who(n))!;
   if(rem>0n)await f.e.command(command(who(n),`drain-${n}`,"withdraw",{amount:decimal(rem)}));
  }
  for(let i=0;i<80;i++){if(f.e.state().assets==="0")break;await f.e.tick();}
  assert.equal(f.e.state().assets,"0");
  assert.deepEqual(replay(f.journal.rows,policy),f.e.state());
 }
 assert.equal(ops,300);
});

test("per-domain escrowPacketBlocked scopes locks to reserved domains & emoji classes, allows unrelated domains, and protects settling seller nonces",async()=>{
 const journal=new MemoryJournal(policy),net=new MockNetwork();
 const engine=new Engine(mainnetConfig(who(6),who(5),[who(2),who(3),who(4)]),{now:()=>Math.floor(net.now/1000)});
 // Mint three root domains: who(2) owns "👩‍🦰" and "star"; who(3) owns "other".
 const issueFor=(ownerIdx:number,name:string,price:string,tag:string)=>{
  const b={domain:"poa-domains.local.intent.v1",revision:engine.config.revision,chainId:CHAIN,genesisHash:engine.config.genesisHash,registryId:engine.registryId,policyHash:engine.policyHash,normalizationHash:engine.config.normalizationHash,
   signer:who(ownerIdx),coSigners:[],requestId:`issue-${tag}`,nonce:engine.nextNonce(who(ownerIdx)),notBefore:0,deadline:2000000000,maxTotal:"0",maxNetworkFee:"0",action:"issueFromTreasury",
   params:{name,asset:"POA",price,expectedDeedId:null,expectedVersion:0,metadata:buildMetadataWitness(name)}};
  return signBody(b,[key(ownerIdx)]);
 };
 for(const [ownerIdx,name,price,tag] of [[2,"👩‍🦰",poaNewNamePriceMicros("premium"),"emoji"],[2,"star",poaNewNamePriceMicros("standard"),"star"],[3,"other",poaNewNamePriceMicros("standard"),"other"]] as const)
  assert.equal(engine.submitEscrowIssue(issueFor(ownerIdx,name,price,tag)).status,"succeeded");
 // who(3) also owns a child "sub.👩‍🦰" under who(2)'s "👩‍🦰" (via subname issuance).
 assert.equal(engine.submitEscrowIssue(subRegistration(engine,3,"sub.👩‍🦰","1000000",{requestId:"sub-emoji-child"})).status,"succeeded");
 const e=new Escrow(journal,net,signer(),registryTitles(engine),policy,()=>net.now,()=>true,()=>{},()=>true,()=>true);
 await e.pause(false);
 await fund({e,net} as any,3,"5.000000","b3");
 await fund({e,net} as any,4,"5.000000","b4");

 const signAction=(actorIdx:number,action:string,params:Record<string,unknown>,co:number[]=[],req="req")=>{
  const b={domain:"poa-domains.local.intent.v1",revision:engine.config.revision,chainId:CHAIN,genesisHash:engine.config.genesisHash,registryId:engine.registryId,policyHash:engine.policyHash,normalizationHash:engine.config.normalizationHash,
   signer:who(actorIdx),coSigners:co.map(x=>who(x)).sort(),requestId:`${req}-${actorIdx}-${action}`,nonce:engine.nextNonce(who(actorIdx)),notBefore:0,deadline:2000000000,maxTotal:"0",maxNetworkFee:"0",action,params};
  return signBody(b,[key(actorIdx),...co.map(x=>key(x))]);
 };
 const deedOf=(name:string)=>engine.snapshot().deeds[engine.snapshot().names[name]!.activeId!]!;

 // Nothing in escrow yet -> nothing blocked.
 assert.equal(escrowPacketBlocked(e.state(),engine,{}),false);

 // who(2) opens POA auction for "👩‍🦰" (OPEN).
 const opened=await e.command(command(who(2),"open-emoji","open",{name:"👩‍🦰",reserve:"1.000000"})) as any;
 const dEmoji=deedOf("👩‍🦰"),dStar=deedOf("star"),dOther=deedOf("other"),dSub=deedOf("sub.👩‍🦰");

 // 1. Unrelated domains stay 100% UNBLOCKED while "👩‍🦰" is OPEN!
 const metaOther=signAction(3,"setMetadata",{name:"other",expectedDeedId:dOther.id,expectedVersion:dOther.version,metadata:buildMetadataWitness("other",{kind:"permanent"},null,"Updated other")});
 const metaStar=signAction(2,"setMetadata",{name:"star",expectedDeedId:dStar.id,expectedVersion:dStar.version,metadata:buildMetadataWitness("star",{kind:"permanent"},null,"Updated star")});
 const metaSub=signAction(3,"setMetadata",{name:"sub.👩‍🦰",expectedDeedId:dSub.id,expectedVersion:dSub.version,metadata:buildMetadataWitness("sub.👩‍🦰",{kind:"permanent"},dEmoji.id,"Updated sub")});
 assert.equal(escrowPacketBlocked(e.state(),engine,metaOther),false);
 assert.equal(escrowPacketBlocked(e.state(),engine,metaStar),false);
 assert.equal(escrowPacketBlocked(e.state(),engine,metaSub),false);
 assert.equal(engine.submit(metaOther).status,"succeeded");
 assert.equal(engine.submit(metaStar).status,"succeeded");

 // 2. Reserved domain "👩‍🦰", prefixed "poa:👩‍🦰", skin-tone variant "👩🏿‍🦰", deedId, createChildOffer, and parent-mutating revokeChild are ALL BLOCKED!
 assert.equal(escrowPacketBlocked(e.state(),engine,signAction(2,"setMetadata",{name:"👩‍🦰",expectedDeedId:dEmoji.id,expectedVersion:dEmoji.version,metadata:buildMetadataWitness("👩‍🦰")})),true);
 assert.equal(escrowPacketBlocked(e.state(),engine,signAction(2,"transfer",{name:"poa:👩‍🦰",expectedDeedId:dEmoji.id,expectedVersion:dEmoji.version,recipient:who(4)})),true);
 assert.equal(escrowPacketBlocked(e.state(),engine,signAction(4,"announceAuction",{name:"👩🏿‍🦰",asset:"POA",reserve:"1000",openAt:0,expectedDeedId:null,expectedVersion:0,metadata:buildMetadataWitness("👩🏿‍🦰")})),true);
 assert.equal(escrowPacketBlocked(e.state(),engine,signAction(2,"createChildOffer",{parent:"👩‍🦰",parentDeedId:dEmoji.id,expectedOwnerVersion:dEmoji.ownerVersion,asset:"POA",price:"10",validUntil:2000000000,rights:{kind:"permanent"},labels:null,maxUses:1})),true);
 assert.equal(escrowPacketBlocked(e.state(),engine,signAction(3,"revokeChild",{name:"sub.👩‍🦰",expectedDeedId:dSub.id,expectedVersion:dSub.version,parentOwnerVersion:dEmoji.ownerVersion},[2])),true);
 // Malformed / empty packets fail closed while any auction is reserved.
 assert.equal(escrowPacketBlocked(e.state(),engine,{}),true);
 assert.equal(escrowPacketBlocked(e.state(),engine,null),true);
 // Escrow list-sub on the auctioned root is also refused.
 await assert.rejects(e.command(command(who(2),"sub-on-open","list-sub",{parent:"👩‍🦰",price:"1.000000"})),/ESCROW_TITLE_RESERVED/);

 // 3. Bid, close, and enter SETTLING -> seller who(2)'s nonce is now pinned, so ALL writes by who(2) (even on "star"!) are BLOCKED,
 //    while unrelated holder who(3) writing to "other" remains UNBLOCKED!
 await e.command(command(who(3),"bid-emoji","bid",{auction:opened.auction,amount:"1.000000"}));
 net.now+=86400001;
 const transferPacket=signAction(2,"transfer",{name:"👩‍🦰",expectedDeedId:dEmoji.id,expectedVersion:dEmoji.version,recipient:who(3)},[],"handover");
 await e.command(command(who(2),"settle-emoji","settle",{auction:opened.auction,transfer:transferPacket}));
 assert.equal(e.state().auctions[opened.auction]!.status,"SETTLING");

 const dStar2=deedOf("star"),dOther2=deedOf("other");
 const sellerStarWrite=signAction(2,"setMetadata",{name:"star",expectedDeedId:dStar2.id,expectedVersion:dStar2.version,metadata:buildMetadataWitness("star",{kind:"permanent"},null,"Nonce attack")},[],"settle-star");
 const otherWrite=signAction(3,"setMetadata",{name:"other",expectedDeedId:dOther2.id,expectedVersion:dOther2.version,metadata:buildMetadataWitness("other",{kind:"permanent"},null,"Unrelated during settle")},[],"settle-other");
 assert.equal(escrowPacketBlocked(e.state(),engine,sellerStarWrite),true,"settling seller cannot burn handover nonce via unrelated domain");
 assert.equal(escrowPacketBlocked(e.state(),engine,otherWrite),false,"unrelated holder remains unblocked during another seller's settlement");
 assert.equal(engine.submit(otherWrite).status,"succeeded");
 // Settling seller also cannot open a second concurrent settle or escrow issue that would burn their registry nonce.
 await fund({e,net} as any,2,"100.000000","b2");
 await assert.rejects(e.command(command(who(2),"issue-during-settle","issue",{name:"nonceburn",amount:"100.000000",registration:issueFor(2,"nonceburn",poaNewNamePriceMicros("standard"),"nonceburn")})),/ESCROW_TITLE_RESERVED/);

 // 4. Finish payout ticks -> handover commits cleanly (nonce intact!) and all locks release.
 for(let i=0;i<6;i++)await e.tick();
 assert.equal(e.state().auctions[opened.auction]!.status,"COMPLETE");
 assert.equal(owner(engine,"👩‍🦰"),who(3));
 assert.equal(escrowPacketBlocked(e.state(),engine,sellerStarWrite),false);
});

test("multi-auction seller handover protection, active-settlement payout priority, and single-payout Treasury settle",async()=>{
 const journal=new MemoryJournal(policy),net=new MockNetwork();
 const refEngine=new Engine(mainnetConfig(who(6),who(5),[who(2),who(3),who(4)]),{now:()=>Math.floor(net.now/1000)});
 const owners:Record<string,string>={a1:who(2),a2:who(2),a3:who(2),t1:who(5)};
 let failTitleFor:string|null=null;
 const titles={
  terms:(name:string,seller:string)=>{if(owners[name]!==seller)throw Error("ESCROW_TITLE");return {reserve:"1.000000",window:1000,quiet:1000};},
  validate:(p:any,name:string,seller:string,buyer:string)=>{
   if(failTitleFor===name)throw Error("ESCROW_TITLE_NOT_READY");
   if(!(p.body.params.name===name&&p.body.signer===seller&&p.body.params.recipient===buyer&&owners[name]===seller))throw Error("ESCROW_TITLE_NOT_READY");
  },
  commit:(p:any)=>{owners[p.body.params.name]=p.body.params.recipient;},
  issueTerms:()=>({price:"100000000"}),
  validateIssue:()=>{},
  issue:()=>{},
 };
 const e=new Escrow(journal,net,signer(),titles,policy,()=>net.now,()=>true,undefined,()=>true);
 await e.pause(false);
 const f={e,journal,net};
 await fund(f as any,3,"300.000000","b3");
 await fund(f as any,4,"50.000000","b4");
 const xfer=(sellerIdx:number,name:string,buyerIdx:number,reqId:string)=>signBody({
  domain:"poa-domains.local.intent.v1",revision:refEngine.config.revision,chainId:CHAIN,genesisHash:refEngine.config.genesisHash,
  registryId:refEngine.registryId,policyHash:refEngine.policyHash,normalizationHash:refEngine.config.normalizationHash,
  signer:who(sellerIdx),coSigners:[],requestId:reqId,nonce:0,notBefore:0,deadline:2000000000,
  maxTotal:"0",maxNetworkFee:"0",action:"transfer",params:{name,expectedDeedId:"0".repeat(64),expectedVersion:1,recipient:who(buyerIdx)},
 },[key(sellerIdx)]);

 // Queue an already-delivered issue payout ("issue-..." sorts alphabetically before "seller-...").
 const reg=signBody({
  domain:"poa-domains.local.intent.v1",revision:refEngine.config.revision,chainId:CHAIN,genesisHash:refEngine.config.genesisHash,
  registryId:refEngine.registryId,policyHash:refEngine.policyHash,normalizationHash:refEngine.config.normalizationHash,
  signer:who(3),coSigners:[],requestId:"issue-fresh",nonce:0,notBefore:0,deadline:2000000000,
  maxTotal:"0",maxNetworkFee:"0",action:"issueFromTreasury",
  params:{name:"fresh1",asset:"POA",price:"100000000",expectedDeedId:null,expectedVersion:0,metadata:buildMetadataWitness("fresh1",{kind:"permanent"},null,"Fresh")},
 },[key(3)]);
 const issued=await e.command(command(who(3),"issue-1","issue",{name:"fresh1",amount:"100.000000",registration:reg})) as any;

 // Seller who(2) opens three auctions (a1, a2, a3) that all get bids and close together.
 const o1=await e.command(command(who(2),"o1","open",{name:"a1",reserve:"1.000000"})) as any;
 const o2=await e.command(command(who(2),"o2","open",{name:"a2",reserve:"1.000000"})) as any;
 const o3=await e.command(command(who(2),"o3","open",{name:"a3",reserve:"1.000000"})) as any;
 await e.command(command(who(3),"bid-a1","bid",{auction:o1.auction,amount:"10.000000"}));
 await e.command(command(who(3),"bid-a2","bid",{auction:o2.auction,amount:"10.000000"}));
 await e.command(command(who(4),"bid-a3","bid",{auction:o3.auction,amount:"10.000000"}));
 net.now+=1001; // all three closed

 // Seller starts settling a1; cannot settle a2 concurrently, and a2/a3 must NOT expire while a1 is SETTLING.
 await e.command(command(who(2),"settle-a1","settle",{auction:o1.auction,transfer:xfer(2,"a1",3,"x-a1")}));
 await assert.rejects(e.command(command(who(2),"settle-a2-early","settle",{auction:o2.auction,transfer:xfer(2,"a2",3,"x-a2")})),/ESCROW_TITLE_RESERVED/);
 net.now+=2500; // well past original closes + quiet for a2 and a3
 await assert.rejects(e.command(command(who(4),"snipe-a2","expire",{auction:o2.auction})),/ESCROW_CANCEL_NOT_ALLOWED/);

 // First tick must prioritize a1's active SETTLING seller payout ahead of the earlier "issue-..." payout,
 // AND must NOT auto-expire a2 or a3 while a1 is SETTLING.
 await e.tick();
 assert.equal(e.state().auctions[o2.auction]!.status,"OPEN");
 assert.equal(e.state().auctions[o3.auction]!.status,"OPEN");
 assert.equal(e.state().payments[`seller-${o1.auction}`]!.status,"UNKNOWN");
 assert.equal(e.state().payments[issued.payment]!.status,"READY","issue payout waits behind active SETTLING handover");

 // Finish a1 -> title commits AND a2/a3 receive a fresh handoverUntil grace window so an immediate tick/expire never cancels them!
 await e.tick(); // seller final + fee unknown
 await e.tick(); // fee final + a1 COMPLETE + extends a2/a3 handoverUntil
 assert.equal(e.state().auctions[o1.auction]!.status,"COMPLETE");
 assert.equal(owners.a1,who(3));
 assert.equal(e.state().auctions[o2.auction]!.status,"OPEN");
 assert.equal(e.state().auctions[o3.auction]!.status,"OPEN");
 assert.ok((e.state().auctions[o2.auction]!.handoverUntil??0)>=net.now+1000);
 await assert.rejects(e.command(command(who(4),"snipe-a2-after","expire",{auction:o2.auction})),/ESCROW_CANCEL_NOT_ALLOWED/);

 // Seller settles a2 via repair-title path (simulate expired consent -> TITLE_PENDING -> repair-title -> COMPLETE),
 // verifying repair-title also extends a3's handoverUntil!
 await e.command(command(who(2),"settle-a2","settle",{auction:o2.auction,transfer:xfer(2,"a2",3,"x-a2")}));
 failTitleFor="a2";
 for(let i=0;i<5;i++)await e.tick();
 assert.equal(e.state().settlements[o2.auction]!.status,"TITLE_PENDING");
 net.now+=2500;
 await e.tick(); // a3 still protected while a2 is SETTLING (TITLE_PENDING)
 assert.equal(e.state().auctions[o3.auction]!.status,"OPEN");
 failTitleFor=null;
 await e.command(command(who(2),"repair-a2","repair-title",{auction:o2.auction,transfer:xfer(2,"a2",3,"x-a2-repair")}));
 assert.equal(e.state().auctions[o2.auction]!.status,"COMPLETE");
 assert.equal(owners.a2,who(3));
 assert.ok((e.state().auctions[o3.auction]!.handoverUntil??0)>=net.now+1000);

 // If seller genuinely abandons a3 past its extended handoverUntil with no SETTLING auction, a3 auto-expires cleanly.
 net.now+=1500;
 await e.tick();
 assert.equal(e.state().auctions[o3.auction]!.status,"CANCELLED");
 assert.ok(e.state().payments[`cancel-${o3.auction}`]);

 // Treasury-owned auction (seller === policy.treasury) collapses seller + fee into ONE single treasury payout.
 const ot=await e.command(command(who(5),"ot1","open",{name:"t1",reserve:"5.000000"})) as any;
 await e.command(command(who(3),"bid-t1","bid",{auction:ot.auction,amount:"20.000000"}));
 net.now+=1001;
 assert.equal(e.hasActiveWork(who(5)),true);
 await e.command(command(who(5),"settle-t1","settle",{auction:ot.auction,transfer:xfer(5,"t1",3,"x-t1")}));
 const tSettlement=e.state().settlements[ot.auction]!;
 assert.deepEqual(tSettlement.payments,[`seller-${ot.auction}`]);
 assert.equal(e.state().payments[`seller-${ot.auction}`]!.amount,"20000000");
 assert.equal(e.state().payments[`fee-${ot.auction}`],undefined);
 assert.equal(e.hasActiveWork(who(5)),true);
 for(let i=0;i<5;i++)await e.tick();
 assert.equal(e.state().auctions[ot.auction]!.status,"COMPLETE");
 assert.equal(owners.t1,who(3));
 assert.equal(e.hasActiveWork(who(5)),false);
 await e.pause(true);
 assert.equal(e.hasActiveWork(who(5)),false);
 invariant(e.state());
});

test("cut() reuses cut status and receipt, batches uncached txs, caches verified checkpoint coverage, and clears cache on rollback",async()=>{
 let now=NOW_V2,height=20;
 const W=policy.wallet;
 const coveredBodies=Array.from({length:12},(_,i)=>signedV2(3,W,"1.000000",`poadomains:hist-${i}`,i+1,CUTOFF_V2-100-i));
 const openBody=signedV2(3,W,"2.000000","poadomains:open-win",99,CUTOFF_V2+30);
 const allIds=[...coveredBodies.map(txid),txid(openBody)];
 const bodyMap=new Map<string,any>([...coveredBodies,openBody].map(b=>[txid(b),b]));
 const counts={status:0,tx:0,receipt:0};
 const persisted=new Map<string,number>();
 const cacheStore={
  get:(wallet:string,ids:readonly string[])=>{const m=new Map<string,number>();for(const id of ids){const v=persisted.get(`${wallet}:${id}`);if(v!==undefined)m.set(id,v);}return m;},
  set:(wallet:string,entries:readonly [string,number][])=>{for(const [id,h] of entries)persisted.set(`${wallet}:${id}`,h);},
  clear:()=>{persisted.clear();},
 };
 const request=(async(input:any)=>{
  const p=new URL(String(input)).pathname;
  if(p===`/chain/${CHAIN}/api/status`){counts.status++;return Response.json({K:5,chain_id:CHAIN,checkpoint:{height,cutoff_ts:CUTOFF_V2},as_of:new Date(now).toISOString(),stale:false,state_root:root});}
  if(p===`/chain/${CHAIN}/api/network-facts`)return Response.json({chain_id:CHAIN,engine_sha256:MAINNET_ENGINE_SHA256,params_sha256:MAINNET_PARAMS_SHA256});
  if(p===`/api/explorer/address/${W}`)return Response.json({address:W,balance:"12.000000",balance_as_of:{checkpoint_height:height},txs:[]});
  if(p.startsWith("/api/explorer/tx/")){
   counts.tx++;const id=p.slice("/api/explorer/tx/".length);const b=bodyMap.get(id);
   return Response.json({id,type:"transfer",from_addr:b.from,to_addr:b.to,amount:b.amount,ts:b.ts,memo:b.memo,atts:5,final:1,body:b,checkpoint_height:height});
  }
  if(p.startsWith(`/chain/${CHAIN}/api/receipt/`)){
   counts.receipt++;const id=p.slice(`/chain/${CHAIN}/api/receipt/`.length);const b=bodyMap.get(id);
   const isOpen=id===txid(openBody);
   return Response.json({txid:id,status:"included",from:b.from,type:"transfer",valid_in_open_window:isOpen,checkpoint_covered:!isOpen});
  }
  return Response.json(null,{status:404});
 }) as typeof fetch;

 const n1=new PoaHttpNetwork(()=>false,request,undefined,()=>now,undefined,cacheStore);
 const s1=await n1.status();
 counts.status=0;counts.tx=0;counts.receipt=0;
 const cut1=await n1.cut(W,allIds,s1);
 assert.equal(cut1.covered.length,12);
 assert.equal(counts.status,1,"cut() must not call status() inside per-tx observe() loop");
 assert.equal(counts.tx,13,"first cut observes all 13 txs once");
 assert.equal(counts.receipt,13,"open-window legacy tx must reuse seen.receipt, not re-fetch receipt");
 assert.equal(persisted.size,12,"all 12 checkpoint-covered txs persisted to cache");

 // Cold-restarted network instance backed by the same SQLite cache skips all 12 covered txs.
 const n2=new PoaHttpNetwork(()=>false,request,undefined,()=>now,undefined,cacheStore);
 height=21;
 const s2=await n2.status();
 counts.status=0;counts.tx=0;counts.receipt=0;
 const cut2=await n2.cut(W,allIds,s2);
 assert.equal(cut2.covered.length,12);
 assert.equal(counts.tx,1,"warm cut only fetches the 1 open-window tx");
 assert.equal(counts.receipt,1,"warm cut only fetches receipt for the 1 open-window tx");
 assert.equal(counts.status,1);

 // Checkpoint rollback clears the coverage cache and fails closed.
 height=19;
 await assert.rejects(n2.status(),/ESCROW_CHECKPOINT_ROLLBACK/);
 assert.equal(persisted.size,0,"checkpoint rollback clears persisted coverage cache");
});

test("primary status timeout skips hung primary during cooldown and re-probes after expiry",async()=>{
 let now=NOW_V2,primaryHung=true;
 const primaryHits:number[]=[],fallbackHits:number[]=[];
 const liveFresh=()=>({network:"PoA prototype",K:5,txs:5600,final:4800,invalid:0,epochs_closed:128,as_of:new Date(now-1000).toISOString(),checkpoint_height:100,state_root:root});
 const facts={chain_id:CHAIN,open_epoch:128,engine_sha256:MAINNET_ENGINE_SHA256,params_sha256:MAINNET_PARAMS_SHA256,economics:{K:5}};
 const request=(async(input:any)=>{
  const p=new URL(String(input)).pathname;
  if(p===`/chain/${CHAIN}/api/status`){primaryHits.push(now);if(primaryHung)throw new DOMException("hung","TimeoutError");return Response.json({...liveFresh(),chain_id:CHAIN});}
  if(p==="/api/status"){fallbackHits.push(now);return Response.json(liveFresh());}
  return Response.json(facts);
 }) as typeof fetch;

 const net=new PoaHttpNetwork(()=>false,request,undefined,()=>now);
 // 1st call probes primary (times out), falls back to /api/status, enters 5-minute cooldown.
 await net.status();
 assert.equal(primaryHits.length,1);assert.equal(fallbackHits.length,1);
 // Subsequent calls within cooldown skip hung primary completely.
 now+=30_000;await net.status();
 now+=60_000;await net.status();
 assert.equal(primaryHits.length,1,"hung primary is skipped during cooldown");
 assert.equal(fallbackHits.length,3);
 // After 5-minute cooldown expires, primary is probed again and recovers cleanly.
 primaryHung=false;now+=300_000;
 await net.status();
 assert.equal(primaryHits.length,2,"primary re-probed after cooldown");
 now+=10_000;await net.status();
 assert.equal(primaryHits.length,3,"recovered primary stays active");
});

test("transport failures in cut/lookup/context map cleanly to ESCROW_NETWORK_HELD and bid only fetches status once before reconcile",async()=>{
 const f=fixture();await fund(f,3,"10.000000");
 const o=await f.e.command(command(who(2),"open-net","open",{name:"nettest",reserve:"1.000000"})) as any;

 // Count status() calls on a single bid: only 1 status() read before reconcileAt().
 let statusCalls=0;
 const origStatus=f.net.status.bind(f.net);
 f.net.status=async()=>{statusCalls++;return origStatus();};
 await f.e.command(command(who(3),"bid-once","bid",{auction:o.auction,amount:"2.000000"}));
 assert.equal(statusCalls,1,"bid must not run redundant duplicate fresh() calls before reconcileAt()");

 // Raw TimeoutError / TypeError / SyntaxError from cut() map to ESCROW_NETWORK_HELD (never unclassified DO abort).
 const origCut=f.net.cut.bind(f.net);
 for(const rawErr of [new DOMException("timeout","TimeoutError"),new TypeError("fetch failed"),new SyntaxError("Unexpected token <")]){
  f.net.cut=async()=>{throw rawErr;};
  await assert.rejects(f.e.command(command(who(4),"bid-fail","bid",{auction:o.auction,amount:"3.000000"})),/^Error: ESCROW_NETWORK_HELD$/);
 }
 f.net.cut=origCut;

 // Raw transport error from lookup() in detect maps to ESCROW_NETWORK_HELD.
 const r=await f.e.command(command(who(4),"i-net","intent",{amount:"1.000000"})) as any;
 const origLookup=f.net.lookup.bind(f.net);
 f.net.lookup=async()=>{throw new DOMException("timeout","TimeoutError");};
 await assert.rejects(f.e.command(command(who(4),"d-net","detect",{intent:r.intent,txid:"a".repeat(64)})),/^Error: ESCROW_NETWORK_HELD$/);
 f.net.lookup=origLookup;

 // Raw transport error from context() in tick() maps to ESCROW_NETWORK_HELD.
 await f.e.command(command(who(3),"w-net","withdraw",{amount:"1.000000"}));
 const origContext=f.net.context.bind(f.net);
 f.net.context=async()=>{throw new TypeError("socket hang up");};
 await assert.rejects(f.e.tick(),/^Error: ESCROW_NETWORK_HELD$/);
 f.net.context=origContext;
});
