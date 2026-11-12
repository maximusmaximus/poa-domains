// REAL production gateway/DO/SQLite display-only test. Outbound reads are local synthetic replies.
// One synthetic local pause-race fixture; no signatures, financial commands, payments or production targets.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from "miniflare";
import { resolve } from "node:path";
import {setTimeout as delay} from 'node:timers/promises';
const root=resolve(import.meta.dirname,'../..');
const bundle=await build({entryPoints:[resolve(root,'cloudflare/worker.ts')],bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','node:*'],alias:{'#poa-unicode-data':resolve(root,'cloudflare/unicode-data.ts')},loader:{'.txt':'text'}});
let reads=0,denied=0;
const admin='local-display-test-only'.padEnd(32,'x');
const wallet='poa1'+'1'.repeat(32),engine='e01abd959dd0439dd89af8e8c187d1bed3897deb2a855a615e7dfa2d0222f1fb',params='6a5451ccd3109bb861e12dc31788fe368e0f974f89c41b1e4c8bfab178101101';
const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.ERROR),telemetry:{enabled:false},workers:[{name:'display-readiness-local',rootPath:root,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],bindings:{ESCROW_ADMIN_TOKEN:admin,POA_ESCROW_ENABLED:'true',POA_ESCROW_NETWORK_WRITES:'false',POA_ESCROW_PER_TX:'250000.000000',POA_ESCROW_DAILY:'1000000.000000',POA_ESCROW_ADDRESS:wallet,PUBLIC_EXPLORER_URL:'https://app.example',BACKEND_HOST:'backend.example'},durableObjects:{REGISTRY:{className:'PoaRegistry',useSQLite:true}},outboundService:async req=>{
 const url=new URL(req.url);if(req.method!=='GET'||url.origin!=='https://minepoa.com'||!['/chain/poa-mainnet-1/api/status','/chain/poa-mainnet-1/api/network-facts'].includes(url.pathname)){denied++;throw Error('OUTBOUND_FORBIDDEN');}reads++;
 if(url.pathname.endsWith('/api/status')){await delay(11000);return Response.json({chain_id:'poa-mainnet-1',K:5,checkpoint:{height:10,cutoff_ts:Math.floor(Date.now()/1000)-60},as_of:new Date().toISOString(),stale:false,state_root:'a'.repeat(64)});}
 return Response.json({chain_id:'poa-mainnet-1',engine_sha256:engine,params_sha256:params});
}}]}));
const get=async()=>{const response=await mf.dispatchFetch('https://app.example/v1/escrow/capabilities');assert.equal(response.status,200);return response.json();};
try{
 const pending=get();await delay(10200);assert.equal(reads,2);const overlapping=get();
 const changed=await mf.dispatchFetch('https://app.example/v1/admin/escrow',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+admin},body:JSON.stringify({action:'pause',paused:false})});assert.equal(changed.status,200);assert.equal((await changed.json()).paused,false);
 const [a,b]=await Promise.all([pending,overlapping]);assert.deepEqual(a.freshness,b.freshness);assert.equal(reads,2,'one shared pair, even after old start-based TTL would expire');
 for(const value of [a,b]){assert.equal(value.enabled,true);assert.equal(value.paused,false);assert.equal(value.held,true);assert.equal(value.address,wallet);assert.deepEqual(value.limits,{perTransaction:'250000.000000',daily:'1000000.000000'});assert.equal(value.freshness.held,false);assert.equal(value.freshness.code,null);assert.equal(value.freshness.reason,null);assert.equal(value.freshness.slow,true);assert.ok(value.freshness.durationMs>=10000);assert.ok(value.freshness.timing.statusMs>=10000);assert.ok(value.freshness.timing.factsMs<10000);assert.ok(value.freshness.timing.totalMs>=10000);}
 const cached=await get();assert.deepEqual(cached.freshness,a.freshness);assert.equal(reads,2,'cache lifetime starts after the slow read settles');assert.equal(denied,0);
 console.log('PASS real DO display RPC: 11s successful read, overlapping requests after 10s share one pair, settlement-based cache, additive safe telemetry, current pause snapshot after a slow read and unchanged operator safety hold; no external I/O');
}finally{await mf.dispose();}
