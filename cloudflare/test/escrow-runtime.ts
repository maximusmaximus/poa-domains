// LOCAL TEST ENTRYPOINT ONLY. Not imported by the production Worker. Synthetic, never-funded identities.
import { DurableObject } from "cloudflare:workers";
import { Engine } from "../../src/engine.js";
import { mainnetConfig } from "../../src/config.js";
import { BootableSystemClock, seedRegistry } from "../../src/seed.js";
import { signBody } from "../../src/auth.js";
import { capabilities, prepare } from "../../src/interface.js";
import { SQLiteJournal } from "../sqlite-journal.js";
import { Escrow, SQLiteEscrowJournal, invariant, exportEscrow, restoreEscrow } from "../escrow.js";
import { registryTitles } from "../escrow-titles.js";
import { verifyCommand } from "../escrow-codec.js";
import { canonical, need } from "../../src/core.js";
import { sign } from "node:crypto";
import { base58 } from "../../src/native-crypto.js";
import { MockNetwork, policy, signer, who, key, command, depositBody } from "./escrow-fixture.js";
interface TestEnv { TEST:DurableObjectNamespace<EscrowHarness>; }
export class EscrowHarness extends DurableObject<TestEnv> {
  private engine!:Engine;private escrow!:Escrow;private net!:MockNetwork;private clock=new BootableSystemClock();private armed="";
  constructor(ctx:DurableObjectState,env:TestEnv){super(ctx,env);ctx.blockConcurrencyWhile(async()=>{
    const sql=ctx.storage.sql;sql.exec("CREATE TABLE IF NOT EXISTS journal(sequence INTEGER PRIMARY KEY,record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS test_network(id INTEGER PRIMARY KEY,value TEXT NOT NULL)");
    this.net=new MockNetwork();const saved=sql.exec<{value:string}>("SELECT value FROM test_network WHERE id=1").toArray()[0];if(saved){Object.assign(this.net,JSON.parse(saved.value));this.net.mismatch=BigInt(this.net.mismatch);}
    const save=()=>sql.exec("INSERT OR REPLACE INTO test_network(id,value) VALUES (1,?)",JSON.stringify(this.net,(_k,v)=>typeof v==="bigint"?String(v):v));
    const submit=this.net.submit.bind(this.net);this.net.submit=async body=>{try{await submit(body);}finally{save();}};
    this.engine=new Engine(mainnetConfig(who(6),who(5),[who(2),who(3),who(4)]),this.clock);
    this.engine.attach(new SQLiteJournal(ctx.storage,this.engine));
    if(this.engine.snapshot().sequence===0)seedRegistry(this.engine,this.clock,
      {issuer:who(6),treasury:who(5),alice:who(2),bob:who(3),carol:who(4)},
      {issuer:key(6),treasury:key(5),alice:key(2),bob:key(3),carol:key(4)});
    this.clock.overrideTime=Math.floor(this.net.now/1000);
    const p={...policy,perTx:"200000.000000",daily:"500000.000000",feeBps:this.engine.config.feeBps};
    this.escrow=new Escrow(new SQLiteEscrowJournal(ctx.storage,p),this.net,signer(),registryTitles(this.engine),p,()=>this.net.now,()=>true,
      point=>{if(this.armed===point){this.armed="";throw Error("TEST_CRASH");}});
    save();
  });}
  async run(v:any):Promise<unknown>{
    try{
      if(v.op==="unpause")await this.escrow.pause(false);
      if(v.op==="pause")await this.escrow.pause(true);
      if(v.op==="advance"){this.net.now+=v.ms;this.clock.overrideTime=Math.floor(this.net.now/1000);}
      if(v.op==="mode")this.net.mode=v.mode;
      if(v.op==="stale")this.net.stale=v.value;
      if(v.op==="arm")this.armed=v.point;
      if(v.op==="fund")this.net.add(depositBody(v.actor,policy.wallet,v.amount,v.intent,v.nonce??1));
      if(v.op==="command"){
        const c=command(who(v.actor),v.key,v.action,v.params);c.registryId=this.engine.registryId;c.expires=Math.floor(this.net.now/1000)+600000;
        const packet={command:c,signature:base58(sign(null,Buffer.from(canonical(c)),key(v.actor)))};
        return {result:await this.escrow.command(verifyCommand(packet,this.engine.registryId,Math.floor(this.net.now/1000))),...this.result()};
      }
      if(v.op==="consent"){
        const s=this.engine.snapshot(),name="👩‍🦰",d=s.deeds[s.names[name]!.activeId!]!;
        const body=prepare({signer:who(2),coSigners:[],requestId:"escrow-runtime-consent",nonce:this.engine.nextNonce(who(2)),notBefore:0,deadline:Math.floor(this.net.now/1000)+600000,
          maxTotal:"0",maxNetworkFee:"0",action:"transfer",params:{name,expectedDeedId:d.id,expectedVersion:d.version,recipient:who(3)}},capabilities(this.engine));
        return {packet:signBody(body,[key(2)]),...this.result()};
      }
      if(v.op==="archive")return {archive:exportEscrow(this.ctx.storage),...this.result()};
      if(v.op==="restore-archive")restoreEscrow(this.ctx.storage,v.archive);
      if(v.op==="tick")await this.escrow.tick();
      if(v.op==="reconcile")await this.escrow.reconcile();
      if(v.op==="normal-write"){need(!this.escrow.titleLocked(),"ESCROW_TITLE_RESERVED");this.engine.submit(v.packet);}
      return this.result();
    }finally{
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO test_network(id,value) VALUES(1,?)",JSON.stringify(this.net,(_k,v)=>typeof v==="bigint"?String(v):v));
    }
  }
  private result(){const state=this.escrow.state();invariant(state);const snapshot=this.engine.snapshot();return{state,owner:snapshot.deeds[snapshot.names["👩‍🦰"]!.activeId!]!.owner,
    engineSequence:snapshot.sequence,submissions:this.net.submitted.map(b=>({nonce:b.nonce,to:b.to,amount:b.amount})),calls:this.net.calls};}
}
export default{async fetch(r:Request,env:TestEnv){
  if(new URL(r.url).hostname!=="127.0.0.1")return new Response("local only",{status:403});
  try{return Response.json(await env.TEST.getByName(new URL(r.url).searchParams.get("instance") ?? "isolated-escrow-runtime").run(await r.json()));}
  catch(e){return Response.json({code:e instanceof Error?e.message:"TEST_ERROR"},{status:409});}
}};
