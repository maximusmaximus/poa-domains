// Real local workerd, no external I/O, no funds, no secret bindings, no stateful PoA actions.
import assert from 'node:assert/strict';import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';import{resolve}from'node:path';
const root=resolve(import.meta.dirname,'../..'),wallet='poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf';
const bundle=await build({entryPoints:[resolve(root,'cloudflare/test/error-contract-worker.ts')],bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','node:*'],alias:{'#poa-unicode-data':resolve(root,'cloudflare/unicode-data.ts')},loader:{'.txt':'text'}});
const token='local-test-admin-'.padEnd(32,'x');let assertions=0;
const schema=b=>{for(const key of ['code','message','docs','requestId'])assert.equal(typeof b[key],'string');assert.equal(typeof b.retryable,'boolean');assert.ok([false,true,'unknown'].includes(b.accepted));assert.equal(b.requestId,'gateway-contract');assertions++;};
function runtime(enabled){return new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.ERROR),telemetry:{enabled:false},workers:[{name:'error-contract-local',rootPath:root,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],bindings:{POA_ESCROW_ENABLED:enabled,PUBLIC_EXPLORER_URL:'https://poadomains.grok.me',ESCROW_ADMIN_TOKEN:token},outboundService:()=>{throw Error('OUTBOUND_FORBIDDEN');}}]}));}
const init={headers:{'x-request-id':'gateway-contract'}};
async function call(mf,path,extra={}){const r=await mf.dispatchFetch('http://127.0.0.1'+path,{...extra,headers:{...init.headers,...extra.headers}});return {status:r.status,text:await r.text(),headers:r.headers};}
for(const enabled of ['true','false']){
 const mf=runtime(enabled);
 try {
  for(const path of ['/v1/escrow/capabilities','/v1/escrow/market','/v1/escrow/domain?name=alpha','/v1/escrow/intent?id='+'a'.repeat(64)]){
   const current=await call(mf,path),legacy=await call(mf,'/__legacy'+path);
   if(enabled==='true'||path.endsWith('/capabilities')){assert.equal(current.status,legacy.status);assert.equal(current.text,legacy.text,'success bytes changed: '+path);if(enabled==='true'&&path.endsWith('capabilities')){const b=JSON.parse(current.text);assert.equal(b.address,wallet);assert.equal(b.enabled,true);assert.equal(b.paused,false);}}
   else{const b=JSON.parse(current.text);assert.equal(current.status,503);assert.equal(b.code,'ESCROW_DISABLED');assert.equal(b.accepted,false);schema(b);}
   assertions++;
  }
  for(const endpoint of ['intent','withdraw','command','account']){
   const packet={command:{domain:'poa-domains.escrow.v1',chainId:'poa-mainnet-1',registryId:'local-test',actor:wallet,key:'fixture-request',expires:2000000000,action:endpoint,params:{}},signature:'fixture-public-signature'};
   const extra={method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1','sec-fetch-site':'same-origin'},body:JSON.stringify(packet)};
   const current=await call(mf,'/v1/escrow/'+endpoint,extra),legacy=await call(mf,'/__legacy/v1/escrow/'+endpoint,extra);
   if(enabled==='true'){assert.equal(current.status,200);assert.equal(current.text,legacy.text,'signed request forwarding changed: '+endpoint);assert.equal(JSON.parse(current.text).packet,JSON.stringify(packet));}
   else{const b=JSON.parse(current.text);assert.equal(current.status,503);assert.equal(b.code,'ESCROW_DISABLED');schema(b);}
   assertions++;
  }
  if(enabled==='false')assert.equal(JSON.parse((await call(mf,'/__audit')).text).dispatches,0,'off mode initialized RPC');
  else {
   for(const [fault,status,accepted]of [['ESCROW_PAUSED',409,false],['ESCROW_UNAVAILABLE',503,'unknown']]){
    const r=await call(mf,'/v1/escrow/command',{method:'POST',headers:{'content-type':'application/json','x-fixture-fault':fault},body:'{"command":{},"signature":"local"}'}),b=JSON.parse(r.text);assert.equal(r.status,status);assert.equal(b.code,fault);assert.equal(b.accepted,accepted);schema(b);
   }
   const bad=await call(mf,'/v1/escrow/command',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'});assert.equal(bad.status,400);schema(JSON.parse(bad.text));
   const admin=await call(mf,'/v1/admin/escrow',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{"action":"status"}'});assert.equal(admin.status,200);assert.deepEqual(JSON.parse(admin.text),{paused:false,address:wallet,packet:'{"action":"status"}'});assertions++;
  }
  if(enabled==='true') {
   await call(mf,'/__hold');const held=await call(mf,'/v1/intents',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),b=JSON.parse(held.text);
   assert.equal(held.status,503);assert.equal(b.code,'NETWORK_HELD');assert.equal(b.accepted,false);assert.equal(held.headers.get('retry-after'),'30');schema(b);
  }
  const hidden=await call(mf,'/v1/admin/escrow',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(hidden.status,404);schema(JSON.parse(hidden.text));
  const unknown=await call(mf,'/v1/does-not-exist');assert.equal(unknown.status,404);schema(JSON.parse(unknown.text));
 }finally{await mf.dispose();}
}
console.log(`PASS ${assertions} production-gateway error/escrow on/off contracts: every existing live success endpoint and request byte preserved, enabled/unpaused wallet unchanged; no external I/O`);
