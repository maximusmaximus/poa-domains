// Production HTTP/MCP adapter -> real local DO RPC/SQLite -> production public projection.
// Fixture uses ONLY structural public-ID data. No keys/signing, network or production writes.
import assert from 'node:assert/strict';import {build} from 'esbuild';import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';import {resolve} from 'node:path';import {readFileSync} from 'node:fs';
import {HIDDEN} from '../../dist/public-registry-view.mjs';
const snapshot=JSON.parse(readFileSync('test/fixtures/public-view-state.json'));
const bundle=await build({entryPoints:['cloudflare/test/public-view-worker.ts'],bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','node:*'],alias:{'#poa-unicode-data':resolve('cloudflare/unicode-data.ts')},loader:{'.txt':'text'}});
let outbound=0,id=0,calls=0;const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.ERROR),telemetry:{enabled:false},workers:[{name:'public-view-test',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],bindings:{POA_ESCROW_ENABLED:'false',PUBLIC_EXPLORER_URL:'https://poadomains.grok.me',BACKEND_HOST:'poadomains-registry.maxinfeld-artshow.workers.dev'},durableObjects:{REGISTRY:{className:'PublicViewFixture',useSQLite:true}},ratelimits:{MCP_RATE_LIMITER:{namespace_id:'93',simple:{limit:1000,period:60}}},outboundService:()=>{outbound++;throw Error('OUTBOUND_FORBIDDEN');}}]}));
async function rpc(host,method,params={}){calls++;const r=await mf.dispatchFetch('https://'+host+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});assert.equal(r.status,200);return r.json();}
async function tool(host,name,args={},code){const r=await rpc(host,'tools/call',{name,arguments:args});assert.ok(!r.error,JSON.stringify(r));const d=r.result.structuredContent;if(code){assert.equal(r.result.isError,true);assert.equal(d.code,code);assert.ok(!d.name&&!d.deed&&!d.owner&&!d.intentId);}else assert.equal(r.result.isError,false,JSON.stringify(r));return d;}
try{for(const host of ['poadomains.grok.me','poadomains-registry.maxinfeld-artshow.workers.dev']){
 const cap=await tool(host,'read_capabilities');assert.equal(cap.livePoA,false);assert.equal(cap.registryUnits,undefined);assert.equal(cap.poaOnly.status,'on');assert.equal(cap.pricing.currency,'POA');assert.ok(!('announceAuction' in cap.actions));
 assert.equal((await rpc(host,'tools/list')).result.tools.length,9);
 const state=await tool(host,'read_state');assert.equal(state.stateHash,snapshot.stateHash);assert.equal(state.state.sequence,16);for(const k of ['names','deeds','auctions','offers','bids','balances','credits','receipts','requests','nonces'])assert.deepEqual(state.state[k],{});
 for(const name of [...HIDDEN.names,'👩🏿‍🦰','child.nexus']){
  await tool(host,'resolve_domain',{name},'PUBLIC_RECORD_WITHHELD');await tool(host,'quote_domain',{name,action:'announceAuction'},'PUBLIC_RECORD_WITHHELD');await tool(host,'build_metadata_witness',{name},'PUBLIC_RECORD_WITHHELD');
 }
 for(const key of HIDDEN.receipts)await tool(host,'get_receipt',{id:key},'PUBLIC_RECORD_WITHHELD');
 for(const signer of HIDDEN.accounts)await tool(host,'get_nonce',{signer},'PUBLIC_RECORD_WITHHELD');
 for(const [method,params]of [['resources/read',{uri:'poa://names/nexus'}],['resources/read',{uri:'poa://receipts/'+HIDDEN.receipts[0]}],['prompts/get',{name:'buy_a_domain',arguments:{name:'nexus'}}]]){const r=await rpc(host,method,params);assert.ok(r.error);assert.ok(!JSON.stringify(r).includes(HIDDEN.deeds[0]));}
 const q=await tool(host,'quote_domain',{name:'newpublicname',action:'announceAuction'});assert.equal(q.poaPrice,'100.000000');assert.equal(q.blockedBy,'POA_ONLY');assert.equal(q.params,null);assert.ok((await tool(host,'build_metadata_witness',{name:'newpublicname'})).cid);
 // No signature is manufactured: malformed signed-tool inputs fail before dispatch.
 for(const name of ['simulate_intent','submit_intent']){const r=await rpc(host,'tools/call',{name,arguments:{}});assert.equal(r.error.code,-32602);}
 const after=await tool(host,'read_state');assert.equal(after.stateHash,snapshot.stateHash);
 }assert.equal(outbound,0);console.log('PASS',calls,'both-host local DO/SQLite public-view HTTP MCP calls: all tools guarded, inventory/aliases/ancestry hidden, no signing or external I/O, unchanged hash');}finally{await mf.dispose();}
