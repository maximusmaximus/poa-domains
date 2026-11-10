// Real production gateway in isolated workerd; all RPC/assets synthetic, no outbound I/O.
import assert from 'node:assert/strict';import{build}from'esbuild';import{Miniflare,convertV4MiniflareOptions,Log,LogLevel}from'miniflare';import{resolve}from'node:path';import{UI_SECURITY,DOMAIN_FONT_FILE,IMMUTABLE_FONT_CACHE}from'../../dist/src/ui-policy.js';
const root=resolve(import.meta.dirname,'../..');
const bundle=await build({entryPoints:[resolve(root,'cloudflare/test/ui-policy-worker.ts')],bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers','node:*'],alias:{'#poa-unicode-data':resolve(root,'cloudflare/unicode-data.ts')},loader:{'.txt':'text'}});
let checks=0;const headers=r=>{for(const[k,v]of Object.entries(UI_SECURITY))assert.equal(r.headers.get(k),v,k);checks++;};
for(const enabled of ['true','false']){
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.ERROR),telemetry:{enabled:false},workers:[{name:'ui-policy-local',rootPath:root,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],bindings:{POA_ESCROW_ENABLED:enabled,PUBLIC_EXPLORER_URL:'https://poadomains.grok.me',BACKEND_HOST:'poadomains-registry.maxinfeld-artshow.workers.dev',ESCROW_ADMIN_TOKEN:'local-fixture-only'.padEnd(32,'x')},serviceBindings:{ASSETS:async request=>{const font=new URL(request.url).pathname==='/'+DOMAIN_FONT_FILE;return new Response(font?'fixture font':'<html>unchanged shell</html>',{headers:{'content-type':font?'font/woff2':'text/html','access-control-allow-origin':'*','cache-control':'no-store'}});}},outboundService:()=>{throw Error('OUTBOUND_FORBIDDEN');}}]}));
 try{
  for(const host of ['poadomains.grok.me','poadomains-registry.maxinfeld-artshow.workers.dev']){
   for(const path of ['/','/d/alpha','/p/public-fixture']){const r=await mf.dispatchFetch('https://'+host+path);assert.equal(r.status,200);headers(r);assert.equal(r.headers.get('access-control-allow-origin'),null);assert.equal(await r.text(),'<html>unchanged shell</html>');}
   const f=await mf.dispatchFetch('https://'+host+'/'+DOMAIN_FONT_FILE);headers(f);assert.equal(f.headers.get('cache-control'),IMMUTABLE_FONT_CACHE);
   const cap=await mf.dispatchFetch('https://'+host+'/v1/escrow/capabilities');headers(cap);assert.equal((await cap.json()).enabled,enabled==='true');
   const off=await mf.dispatchFetch('https://'+host+'/v1/escrow/market');headers(off);assert.equal(off.status,enabled==='true'?200:503);
   const packet='{"command":{},"signature":"public-test-only"}';const signed=await mf.dispatchFetch('https://'+host+'/v1/escrow/account',{method:'POST',headers:{origin:'https://'+host,'sec-fetch-site':'same-origin','content-type':'application/json'},body:packet});headers(signed);assert.equal(signed.status,enabled==='true'?200:503);if(enabled==='true')assert.equal((await signed.json()).packet,packet);
   for(const [extra,status]of [[{},200],[{origin:'https://'+host},403],[{accept:'application/json'},406]]){
    const r=await mf.dispatchFetch('https://'+host+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25',...extra},body:JSON.stringify({jsonrpc:'2.0',id:'policy-ping',method:'ping'})});headers(r);assert.equal(r.status,status);if(status===200)assert.equal((await r.json()).id,'policy-ping');
   }
  }
 }finally{await mf.dispose();}
}
console.log('PASS',checks,'real gateway header contracts: both hosts, escrow on/off and exact request bytes, MCP POST/Accept/Origin, deep links, immutable font; no external I/O');
