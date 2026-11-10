import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {actor} from "./helpers.js";
import {Engine} from "../src/engine.js";
import {nativePrincipal,signBody} from "../src/auth.js";
import {mainnetConfig} from "../src/config.js";
import {ManualClock} from "../src/clock.js";
import {capabilities,prepare} from "../src/interface.js";
import {registryRoute} from "../src/registry-routes.js";
import {quote} from "../src/registry-reads.js";

test("CLI compound act re-quotes current bid version after a competing bid; never downloads state",async()=>{
  const issuer=actor(),treasury=actor(),buyer=actor(),who=nativePrincipal(issuer.key),other=nativePrincipal(buyer.key);
  const clock=new ManualClock(1000000),e=new Engine(mainnetConfig(who,nativePrincipal(treasury.key),[other]),clock);
  const dir=mkdtempSync(join(tmpdir(),"poa-quote-cli-")),key=join(dir,"fixture.pem");
  writeFileSync(key,issuer.key.export({type:"pkcs8",format:"pem"}),{mode:0o600});
  const reads:string[]=[],packets:any[]=[];
  const server=createServer(async(req,res)=>{
    try {
      const u=new URL(req.url!,"http://127.0.0.1");let raw="";for await(const chunk of req)raw+=chunk;
      if(req.method==="GET") {reads.push(u.pathname+u.search);assert.notEqual(u.pathname,"/v1/state");}
      if(req.method==="POST")packets.push(JSON.parse(raw));
      const result=registryRoute(e,{method:req.method!,path:u.pathname,query:Object.fromEntries(u.searchParams),packet:raw});
      if(packets.length===1&&req.method==="POST") {
        const auctionId=JSON.parse(result.jsonText).result.auctionId;
        const plan=quote(e,{name:"cliquote",action:"bid",auctionId,signer:other});
        const body=prepare({signer:other,coSigners:[],requestId:"competing-fixture-bid",nonce:0,notBefore:0,deadline:clock.now()+3600,maxTotal:plan.requiredMaxTotal,maxNetworkFee:"0",action:"bid",params:plan.params},capabilities(e));
        assert.equal(e.submit(signBody(body,[buyer.key])).status,"succeeded");
      }
      res.writeHead(result.status,{"content-type":"application/json"});res.end(result.jsonText);
    } catch(error) {res.writeHead(400,{"content-type":"application/json"});res.end(JSON.stringify({code:String(error)}));}
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const port=(server.address() as {port:number}).port;
    const {stdout}=await promisify(execFile)(process.execPath,["dist/src/reference-cli.js","act","--url",`http://127.0.0.1:${port}`,"--key-file",key,"--action","announceAuction+bid","--params",JSON.stringify({name:"cliquote",reserve:"999999",maxBid:"2500"}),"--max-total","2500"],{timeout:15000});
    assert.equal(JSON.parse(stdout).status,"succeeded");assert.equal(packets.length,2);
    assert.equal(packets[0].body.params.reserve,e.config.assets.POA!.standardReserve);
    assert.equal(packets[1].body.params.expectedVersion,2);assert.equal(packets[1].body.params.amount,"2500");
    assert.equal(packets[1].body.maxTotal,"2500");assert.ok(reads.includes("/v1/time"));
    assert.equal(reads.filter(p=>p.startsWith("/v1/quote?")).length,2);assert.ok(reads.some(p=>p.startsWith("/v1/auctions/")));
  } finally {await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});rmSync(dir,{recursive:true,force:true});}
});

test("emoji alias ownership conflicts are returned explicitly without a misleading price or template",()=>{
  const a=actor(),b=actor(),who=nativePrincipal(a.key),clock=new ManualClock(1000000);
  const e=new Engine(mainnetConfig(who,nativePrincipal(b.key)),clock);
  const plan=quote(e,{name:"👍",action:"announceAuction",signer:who});
  const body=prepare({signer:who,coSigners:[],requestId:"ownership-fixture",nonce:0,notBefore:0,deadline:clock.now()+3600,maxTotal:"0",maxNetworkFee:"0",action:"announceAuction",params:plan.params},capabilities(e));
  assert.equal(e.submit(signBody(body,[a.key])).status,"succeeded");
  const conflict=quote(e,{name:"👍🏻",action:"announceAuction"});assert.equal(conflict.available,false);
  assert.equal(conflict.ownershipConflict,"👍");assert.equal(conflict.blockedBy,"OWNERSHIP_CLASS_TAKEN");
  assert.equal(conflict.params,null);assert.equal(conflict.requiredMaxTotal,null);
});
