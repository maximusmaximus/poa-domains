// Full production HTTP MCP gateway -> REAL PoaRegistry Durable Object RPC -> local SQLite.
// No getByName/REGISTRY JavaScript mock, no external I/O, no production data or keys.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import {resolve} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {nativePrincipal,signBody} from '../../dist/src/auth.js';
import {prepare} from '../../dist/src/interface.js';
const root=resolve(import.meta.dirname,'../..');
const bundle=await build({entryPoints:[resolve(root,'cloudflare/worker.ts')],bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','node:*'],alias:{'#poa-unicode-data':resolve(root,'cloudflare/unicode-data.ts')},loader:{'.txt':'text'}});
let outbound=0,counter=0,calls=0;
const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.ERROR),telemetry:{enabled:false},workers:[{name:'mcp-real-do-local',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],bindings:{POA_ESCROW_ENABLED:'false',PUBLIC_EXPLORER_URL:'https://poadomains.grok.me',BACKEND_HOST:'poadomains-registry.maxinfeld-artshow.workers.dev'},durableObjects:{REGISTRY:{className:'PoaRegistry',useSQLite:true}},ratelimits:{MCP_RATE_LIMITER:{namespace_id:'92',simple:{limit:1000,period:60}}},outboundService:()=>{outbound++;throw Error('OUTBOUND_FORBIDDEN');}}]}));
const key=generateKeyPairSync('ed25519').privateKey,signer=nativePrincipal(key);
async function rpc(host,method,params={},invalid=false){calls++;const r=await mf.dispatchFetch('https://'+host+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:++counter,method,params})});assert.equal(r.status,200);const d=await r.json();if(invalid){assert.equal(d.error.code,-32602);assert.ok(!JSON.stringify(d).includes('synthetic-never-a-key'));return d.error;}assert.ok(!d.error,JSON.stringify(d));return d.result;}
async function tool(host,name,args={}){const r=await rpc(host,'tools/call',{name,arguments:args});assert.notEqual(r.isError,true,name+': '+JSON.stringify(r));return r.structuredContent;}
try{
 const before=await(await mf.dispatchFetch('https://poadomains.grok.me/v1/state')).json();assert.equal(before.state.sequence,15);const receipt=Object.keys(before.state.receipts)[0];
 for(const host of ['poadomains.grok.me','poadomains-registry.maxinfeld-artshow.workers.dev']){
  assert.equal((await rpc(host,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'local-real-do-regression',version:'1'}})).protocolVersion,'2025-11-25');
  assert.equal((await rpc(host,'tools/list')).tools.length,9);
  const state=await tool(host,'read_state');assert.equal(state.stateHash,before.stateHash);
  const cap=await tool(host,'read_capabilities');assert.equal(cap.livePoA,false);
  assert.equal((await tool(host,'resolve_domain',{name:'nexus'})).name,'nexus');
  assert.ok((await tool(host,'build_metadata_witness',{name:'mcpboundarytest'})).cid);
  for(const name of ['mcpboundarytest','🚀']){
   const quote=await tool(host,'quote_domain',{name,action:'announceAuction',signer});assert.equal(quote.name,name);assert.match(quote.reserve,/^[0-9]+$/);assert.equal(quote.params.reserve,quote.reserve);assert.ok(quote.params);
   const rest=await(await mf.dispatchFetch('https://'+host+'/v1/quote?'+new URLSearchParams({name,action:'announceAuction',signer}))).json();assert.deepEqual(quote,rest,'MCP quote must equal REST across real DO RPC');
  }
  assert.equal((await tool(host,'get_nonce',{signer})).nonce,0);
  assert.equal((await tool(host,'get_receipt',{id:receipt})).intentId,receipt);
  const q=await tool(host,'quote_domain',{name:'mcpboundarypreview',action:'announceAuction',signer}),now=before.observedServerTime;
  const body=prepare({signer,coSigners:[],requestId:'local-real-do-preview',nonce:0,notBefore:now,deadline:now+300,maxTotal:q.requiredMaxTotal,maxNetworkFee:'0',action:'announceAuction',params:q.params},cap);
  const preview=await tool(host,'simulate_intent',signBody(body,[key]));assert.equal(preview.previewOnly,true);assert.equal(preview.accepted,false);assert.equal(preview.committed,false);assert.equal(preview.wouldSucceed,true);
  // Public parser/schema protections remain before the plain-record RPC boundary.
  for(const args of [{name:'x',action:'announceAuction',privateKey:'synthetic-never-a-key'},{name:'x',action:'announceAuction',__proto__:null,extra:{nested:true}}]){
   await rpc(host,'tools/call',{name:'quote_domain',arguments:args},true);
  }
 }
 const after=await(await mf.dispatchFetch('https://poadomains.grok.me/v1/state')).json();assert.equal(after.stateHash,before.stateHash);assert.deepEqual(after.state,before.state);assert.equal(outbound,0);
 console.log('PASS',calls,'production HTTP MCP calls across real local DO RPC/SQLite: all eight read-only tools, ASCII/emoji quote=REST, signed preview without state changes, both hosts; no external I/O');
}finally{await mf.dispose();}
