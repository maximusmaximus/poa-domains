import test from "node:test";
import assert from "node:assert/strict";
import { sign, verify, createPublicKey, createPrivateKey } from "node:crypto";
import { base58 } from "../../src/native-crypto.js";
import { canonical } from "../../src/core.js";
import { Escrow, PILOT_ADMISSION_LIMIT, PILOT_JOURNAL_LIMIT, invariant, nextEntry, replay } from "../escrow.js";
import { CHAIN, WorkerSecretSigner, micros, decimal, txid, verifyCommand, verifyTransfer } from "../escrow-codec.js";
import { PoaHttpNetwork, MAINNET_ENGINE_SHA256, MAINNET_PARAMS_SHA256, PILOT_PER_TX, PILOT_DAILY } from "../escrow-network.js";
import { MockNetwork, MemoryJournal, policy, who, key, seed, signer, command, depositBody, root, parents } from "./escrow-fixture.js";
function fixture(crash=(point:string)=>{}, p=policy){
  const journal=new MemoryJournal(p),net=new MockNetwork();let enabled=true;
  let owner=who(2),transferCount=0;
  const titles={terms:()=>({reserve:"1.000000",window:1000,quiet:1000}),
    validate:(_p:any,_n:string,s:string,_b:string)=>assert.equal(owner,s),commit:(p:any)=>{owner=p.body.params.recipient;transferCount++;}};
  const make=()=>new Escrow(journal,net,signer(),titles,p,()=>net.now,()=>enabled,crash);
  const e=make();e.pause(false);
  return {e,journal,net,make,owner:()=>owner,count:()=>transferCount,disable:()=>{enabled=false;}};
}
async function fund(f:ReturnType<typeof fixture>,n=3,amount="10.000000",tag="a"){
  const r=await f.e.command(command(who(n),`intent-${tag}`,"intent",{amount})) as any;
  const id=f.net.add(depositBody(n,policy.wallet,amount,r.intent));
  await f.e.command(command(who(n),`detect-${tag}`,"detect",{intent:r.intent,txid:id}));return{id,intent:r.intent};
}
async function auction(f:ReturnType<typeof fixture>,amount="2.000000"){
  await fund(f);
  const r=await f.e.command(command(who(2),"open","open",{name:"test",reserve:"1.000000"})) as any;
  await f.e.command(command(who(3),"bid","bid",{auction:r.auction,amount}));return r.auction as string;
}
// Packet validation is exercised against the real engine in the runtime suite.
// Use a real authenticated reference packet shape for the service boundary (mock title store only).
import { Engine } from "../../src/engine.js";
import { mainnetConfig } from "../../src/config.js";
import { signBody } from "../../src/auth.js";
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
test("bid holds, strict increment, outbid original payer refund, cancel and double refund",async()=>{
 const f=fixture(),a=await auction(f);await fund(f,4,"10.000000","b");
 await assert.rejects(f.e.command(command(who(3),"raise","bid",{auction:a,amount:"3.000000"})),/SELF_RAISE/);
 await assert.rejects(f.e.command(command(who(4),"low","bid",{auction:a,amount:"2.200000"})),/INCREMENT/);
 await f.e.command(command(who(4),"high","bid",{auction:a,amount:"2.200001"}));
 assert.equal(Object.values(f.e.state().payments)[0]!.to,who(3));
 await f.e.command(command(who(2),"cancel","cancel",{auction:a}));
 await assert.rejects(f.e.command(command(who(2),"again","cancel",{auction:a})),/CLOSED/);assert.equal(Object.keys(f.e.state().payments).length,2);invariant(f.e.state());
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
 const g=fixture(()=>{},{...policy,perTx:"1.000000"}),b=await auction(g);await settle(g,b);
 await assert.rejects(g.e.tick(),/LIMIT/);assert.equal(g.net.calls,0);
});
test("simultaneous bid/cancel/ticks cannot overdraw or double refund/payout",async()=>{
 const f=fixture(),a=await auction(f);await fund(f,4,"10.000000","b");
 await Promise.allSettled(Array.from({length:20},(_,i)=>f.e.command(command(who(4),`race-${i}`,"bid",{auction:a,amount:"3.000000"}))));
 assert.equal(Object.keys(f.e.state().payments).length,1);await f.e.command(command(who(2),"cancel","cancel",{auction:a}));
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
 const n=new PoaHttpNetwork(()=>false,request,{engine:root,params:root}),s=await n.status(),o=await n.lookup(id);assert.equal(o?.checkpoint?.height,10);
 const cut=await n.cut(policy.wallet,[id],s);assert.deepEqual(cut.covered,[id]);assert.equal(cut.balance,"1.000000");assert.ok(paths.length>=8);
});

test("native adapter supports post-8:59-PST /chain/poa-mainnet-1/api/status schema, network-facts, cutoff context, and rollback tripwire",async()=>{
 const body=depositBody(3,policy.wallet,"5.000000","live-schema"),id=txid(body);
 const ownTx=depositBody(1,who(2),"1.000000","prev-out"),ownId=txid(ownTx);
 const p1="b".repeat(64),p2="c".repeat(64);
 let cpHeight=593855,cutoffTs=1794228787,nowMs=1794250522000;
 const request=(async(input:any)=>{const u=new URL(input);
  if(u.pathname==="/chain/poa-mainnet-1/api/status")return Response.json({checkpoint:{height:cpHeight,cutoff_ts:cutoffTs},network:"PoA prototype",K:5,open_ballots:0,chain_id:CHAIN,supply:"26020127390.293810",txs:13078,final:13007,invalid:0,agents_joined:9959,epochs_closed:63,holders:4968});
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

test("abandoned OPEN auctions auto-expire in tick and release title lock + refund bidder",async()=>{
 const f=fixture();await fund(f,3,"10.000000","a");
 const o1=await f.e.command(command(who(2),"open1","open",{name:"empty",reserve:"1.000000"})) as any;
 assert.equal(f.e.titleLocked(),true);
 f.net.now+=1001;
 await f.e.tick();
 assert.equal(f.e.state().auctions[o1.auction]!.status,"CANCELLED");
 assert.equal(f.e.titleLocked(),false);
 // Now test with a high bid abandoned past closes + quiet
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
  f.journal.rows.push(nextEntry(prev.state,prev.checksum,"noop",{},()=>{}));
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
