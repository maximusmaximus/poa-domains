// Real workerd/SQLite HTTP admin boundary. Synthetic credentials, fully mocked chain, no external I/O.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from "miniflare";
import { resolve } from "node:path";
const root=resolve(import.meta.dirname,"../.."),token="local-test-admin-".padEnd(32,"x");
const wallet="poa1"+"1".repeat(32),cutoff=Math.floor(Date.now()/1000)-60;
const engine="4e1f5c41dda9fda8939d92ffd6e9c2f05b66b4b8f1c5ff271960ea18b7bc6aa5",params="82f994768b0bd7d430226147bfe90aad5aff1d4a50eae0400e8a950cb4416348";
const bundle=await build({entryPoints:[resolve(root,"cloudflare/worker.ts")],bundle:true,write:false,format:"esm",platform:"node",target:"es2022",external:["cloudflare:workers","node:*"],alias:{"#poa-unicode-data":resolve(root,"cloudflare/unicode-data.ts")},loader:{".txt":"text"}});
let passed=0,mockReads=0,denied=0,redirect=false,stale=false;
async function outbound(req){
 const u=new URL(req.url);if(req.method!=="GET"||u.origin!=="https://minepoa.com"){denied++;throw Error("LOCAL_TEST_DENIED_OUTBOUND");}mockReads++;
 if(redirect)return new Response(null,{status:302,headers:{location:"https://not-allowed.invalid/"}});
 let body;
 if(u.pathname.endsWith("/api/status"))body={K:5,chain_id:"poa-mainnet-1",checkpoint_height:17,checkpoint:{height:17,cutoff_ts:cutoff},as_of:new Date(Date.now()-(stale?86400000:0)).toISOString(),stale:false,state_root:"a".repeat(64)};
 else if(u.pathname.endsWith("/api/network-facts"))body={chain_id:"poa-mainnet-1",engine_sha256:engine,params_sha256:params};
 else if(u.pathname.endsWith("/api/explorer/address/"+wallet))body={address:wallet,balance:"0.000000",balance_as_of:{checkpoint_height:17},txs:[]};
 else{denied++;throw Error("LOCAL_TEST_DENIED_OUTBOUND");}
 return Response.json(body);
}
function runtime(extra={}){
 const bindings={POA_ESCROW_ENABLED:"true",POA_ESCROW_NETWORK_WRITES:"false",POA_ESCROW_PER_TX:"250000.000000",POA_ESCROW_DAILY:"1000000.000000",POA_ESCROW_ADDRESS:wallet,PUBLIC_EXPLORER_URL:"https://app.example",BACKEND_HOST:"backend.example",ESCROW_ADMIN_TOKEN:token,...extra};
 for(const k of Object.keys(bindings))if(bindings[k]===undefined)delete bindings[k];
 return new Miniflare(convertV4MiniflareOptions({host:"127.0.0.1",port:0,cf:false,log:new Log(LogLevel.ERROR),telemetry:{enabled:false},workers:[{name:"escrow-admin-test",rootPath:root,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:"2026-11-08",compatibilityFlags:["nodejs_compat"],bindings,durableObjects:{REGISTRY:{className:"PoaRegistry",useSQLite:true}},outboundService:outbound}]}));
}
async function call(mf,name,init={},status=200,code,path="/v1/admin/escrow"){
 const headers={"content-type":"application/json",authorization:"Bearer "+token,...init.headers};for(const k of Object.keys(headers))if(headers[k]===undefined)delete headers[k];
 const r=await mf.dispatchFetch("http://127.0.0.1"+path,{method:"POST",body:'{"action":"status"}',...init,headers});const b=await r.json();
 assert.equal(r.status,status,name+": "+JSON.stringify(b));if(code)assert.equal(b.code,code,name);passed++;console.log("PASS admin runtime:",name);return b;
}
const mf=runtime();
try{
 const before=await(await mf.dispatchFetch("http://127.0.0.1/v1/state")).json();
 assert.equal((await call(mf,"status crosses strict-parser-to-real-DO RPC")).paused,true);
 await call(mf,"reconcile uses native workerd fetch with a fresh mocked checkpoint",{body:'{"action":"reconcile"}'});
 assert.equal((await call(mf,"unpause RPC",{body:'{"action":"pause","paused":false}'})).paused,false);
 assert.equal((await call(mf,"pause RPC",{body:'{"action":"pause","paused":true}'})).paused,true);
 await call(mf,"missing bearer stays hidden",{headers:{authorization:undefined}},404,"NOT_FOUND");
 await call(mf,"wrong bearer stays hidden",{headers:{authorization:"Bearer "+"x".repeat(32)}},404,"NOT_FOUND");
 await call(mf,"wrong header name stays hidden",{headers:{authorization:undefined,"x-api-key":token}},404,"NOT_FOUND");
 await call(mf,"Basic is not Bearer",{headers:{authorization:"Basic dGVzdA=="}},404,"NOT_FOUND");
 await call(mf,"header names are case-insensitive",{headers:{authorization:undefined,Authorization:"Bearer "+token}});
 await call(mf,"status is not GET",{method:"GET",body:undefined},405,"METHOD_NOT_ALLOWED");
 for(const suffix of ["/status","/reconcile","/"])await call(mf,"wrong route suffix "+suffix,{},404,"NOT_FOUND","/v1/admin/escrow"+suffix);
 await call(mf,"action query is forbidden",{},400,"QUERY_NOT_ALLOWED","/v1/admin/escrow?action=status");
 await call(mf,"content type remains exact",{headers:{"content-type":"application/json; charset=utf-8"}},400,"CONTENT_TYPE");
 await call(mf,"browser Origin remains blocked",{headers:{origin:"https://app.example"}},400,"BROWSER_WRITES_DISABLED");
 await call(mf,"browser fetch metadata remains blocked",{headers:{"sec-fetch-site":"same-origin"}},400,"BROWSER_WRITES_DISABLED");
 await call(mf,"top-level duplicate key rejected before serialization",{body:'{"action":"status","action":"reconcile"}'},400,"DUPLICATE_KEY");
 await call(mf,"nested duplicate key rejected before serialization",{body:'{"action":"command","packet":{"command":{"action":"x","action":"y"},"signature":"1"}}'},400,"DUPLICATE_KEY");
 await call(mf,"invalid action reaches DO validation, not 404",{body:'{"action":"invalid"}'},409,"ESCROW_ACTION");
 stale=true;await call(mf,"24-hour-old source still holds reconcile",{body:'{"action":"reconcile"}'},409,"ESCROW_NETWORK_HELD");stale=false;
 redirect=true;await call(mf,"redirect is held, never followed",{body:'{"action":"reconcile"}'},409,"ESCROW_NETWORK_HELD");redirect=false;
 await call(mf,"fresh reconcile recovers without clearing or bypassing a hold",{body:'{"action":"reconcile"}'});
 const after=await(await mf.dispatchFetch("http://127.0.0.1/v1/state")).json();assert.equal(before.stateHash,after.stateHash);assert.equal(before.state.sequence,after.state.sequence);passed++;console.log("PASS admin runtime: registry state unchanged by admin escrow operations");
}finally{await mf.dispose();}
for(const[name,extra]of [["OFF flag",{POA_ESCROW_ENABLED:"false"}],["missing binding",{ESCROW_ADMIN_TOKEN:undefined}],["short test binding",{ESCROW_ADMIN_TOKEN:"short"}]]){const x=runtime(extra);try{await call(x,name,{},404,"NOT_FOUND");}finally{await x.dispose();}}
assert.ok(mockReads>0);assert.equal(denied,0);console.log("Escrow admin workerd/SQLite checks passed:",passed,"(external network requests: 0)");
