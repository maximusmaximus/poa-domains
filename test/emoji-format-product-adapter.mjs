// ORIGINAL portable TEST adapter. Serves only explicit already-built public artifacts.
// Synthetic node responses test transport/UI only: never consensus, ownership or native activation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
export const PRODUCT_CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://minepoa.com/chain/poa-mainnet-1/api/status https://minepoa.com/chain/poa-mainnet-1/api/network-facts; img-src 'self'; base-uri 'none'; form-action 'none'";
export const OFFICIAL_READ_URLS=Object.freeze(['https://minepoa.com/chain/poa-mainnet-1/api/status','https://minepoa.com/chain/poa-mainnet-1/api/network-facts']);
export const BUILD_FILES=Object.freeze(['.nojekyll','LICENSE-UNICODE.txt','PUBLIC-PROVENANCE.json','app.js','config.json','emoji-format-checker.css','emoji-format-checker.mjs','emoji17-data.mjs','emoji17.mjs','icon.svg','index.html','live-network.js','network-schema.js','llms.txt','.well-known/agent.json','openapi.json','schemas/signed-packet.json','schemas/mcp-tools.json','status.json','style.css','terms.html','terms.css','robots.txt','sitemap.xml']);
export const PUBLIC_PINS=Object.freeze({
 'emoji-format-checker.mjs':'f7c6e412c63951c6a617ff79e59ddd7b36cceba2be39b57c882a131a4783869b',
 'emoji-format-checker.css':'32d2c62e558ee2997b0c37d7a42f104fd334240e16afb5b772868f88737bb120',
 'emoji17.mjs':'1a937b91d2e54b1c68af66a8ac0c780980f2b9ddeb7e48e90a74274ada142d0c',
 'emoji17-data.mjs':'5e511ed00485deeff7e9f382dd9722807c031cc67f92d8ad7f550c436251296c',
 'LICENSE-UNICODE.txt':'e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96',
 'PUBLIC-PROVENANCE.json':'5b8ffbe6a6a4caf49770fd4dfb972743209a7c5b4f7f9c2550fc3fc80db287f5',
});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export function loadBuiltArtifact(buildDir=process.env.POA_FORMAT_BUILD_DIR??path.resolve(process.cwd(),'_site')){
 const root=fs.realpathSync(path.resolve(buildDir)),names=[];for(const entry of fs.readdirSync(root,{recursive:true})){const stat=fs.lstatSync(path.join(root,entry));assert.ok(!stat.isSymbolicLink(),'No linked artifacts');if(stat.isDirectory())assert.ok(['.well-known','schemas'].includes(entry),'Only explicit discovery directories');else names.push(entry);}assert.deepEqual(names.sort(),[...BUILD_FILES].sort(),'The build must contain exactly the explicit public files');
 const files=new Map(),hashes={};
 for(const name of BUILD_FILES){const file=path.join(root,name),stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'No directories or linked file targets');assert.equal(fs.realpathSync(file),path.resolve(root,name));const body=fs.readFileSync(file),digest=sha(body);if(Object.hasOwn(PUBLIC_PINS,name))assert.equal(digest,PUBLIC_PINS[name],'Reviewed public artifact changed: '+name);files.set(name,body);hashes[name]={bytes:body.length,sha256:digest};}
 return {files,hashes};
}
const mime=name=>name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')||name.endsWith('.mjs')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.json')?'application/json; charset=utf-8':name.endsWith('.svg')?'image/svg+xml':'text/plain; charset=utf-8';
export async function startBuiltSite({fault='normal',buildDir,pathPrefix='/poa-domains/'}={}){
 assert.ok(['normal','runtime404','css404','data404'].includes(fault));assert.match(pathPrefix,/^\/[a-zA-Z0-9_/-]*\/$/);
 const artifact=loadBuiltArtifact(buildDir),routes=new Map(BUILD_FILES.map(name=>[pathPrefix+name,{name,body:artifact.files.get(name)}]));routes.set(pathPrefix,{name:'index.html',body:artifact.files.get('index.html')});
 const missing={runtime404:'emoji17.mjs',css404:'emoji-format-checker.css',data404:'emoji17-data.mjs'}[fault],requests=[];
 const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1'),entry=routes.get(u.pathname),hasCredentials=!!(req.headers.cookie||req.headers.authorization||req.headers['proxy-authorization']);let status=req.method==='GET'&&!u.search&&!hasCredentials&&entry?200:404;if(entry?.name===missing)status=404;
  requests.push({method:req.method,url:req.url,status,hasCredentials});
  // Preserve the real built document's meta CSP; deliberately DO NOT add a header policy.
  res.writeHead(status,{'Content-Type':status===200?mime(entry.name):'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(status===200?entry.body:Buffer.from('No allowlisted built asset at this exact path.\n'));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;
 return {origin,url:origin+pathPrefix,pathPrefix,allowedPaths:[...routes.keys()],requests,artifact,close:()=>new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();})};
}
export function createSyntheticBaselineResponder(){
 // One fixed cutoff PER CONTEXT, reused on refresh to avoid fabricating checkpoint drift.
 const cutoffTs=Math.floor(Date.now()/1000)-3600,calls=[];
 const status={chain_id:'poa-mainnet-1',checkpoint:{height:12345,cutoff_ts:cutoffTs},epochs_closed:57,agents_joined:77,txs:42,final:40,K:5};
 const facts={chain_id:'poa-mainnet-1',open_epoch:57,engine_sha256:'a'.repeat(64),params_sha256:'b'.repeat(64),economics:{K:5}};
 const respond=async route=>{const req=route.request(),u=new URL(req.url()),headers=await req.allHeaders();assert.ok(OFFICIAL_READ_URLS.includes(req.url()));assert.equal(req.method(),'GET');assert.equal(u.search,'');assert.equal(u.username+u.password,'');assert.equal(req.postDataBuffer(),null);assert.ok(!headers.cookie&&!headers.authorization&&!headers['proxy-authorization']);
  calls.push({url:req.url(),method:req.method(),synthetic:true,cutoffTs});
  await route.fulfill({status:200,headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'no-store','X-Test-Only-Synthetic-Node-Response':'true'},body:JSON.stringify(req.url()===OFFICIAL_READ_URLS[0]?status:facts)});
 };
 return {respond,calls,cutoffTs,status,facts};
}
export async function installIsolatedTransportGuard(context,server,synthetic){
 const observations=[],responses=[],blocked=[],allowedPaths=new Set(server.allowedPaths),pending=[];
 context.on('request',req=>{const work=(async()=>{const headers=await req.allHeaders(),u=new URL(req.url());observations.push({url:req.url(),method:req.method(),resourceType:req.resourceType(),hasBody:(req.postDataBuffer()?.byteLength??0)>0,hasCredentials:!!(headers.cookie||headers.authorization||headers['proxy-authorization']||u.username||u.password),query:u.search});})();pending.push(work);});
 context.on('response',response=>{const work=(async()=>responses.push({url:response.url(),status:response.status(),headers:await response.allHeaders()}))();pending.push(work);});
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()),headers=await req.allHeaders(),baseline=OFFICIAL_READ_URLS.includes(req.url()),clean=req.method()==='GET'&&!u.search&&!u.username&&!u.password&&!headers.cookie&&!headers.authorization&&!headers['proxy-authorization']&&!req.postDataBuffer();
  if(!clean||!(baseline||(u.origin===server.origin&&allowedPaths.has(u.pathname)))){blocked.push({url:req.url(),method:req.method()});await route.abort('blockedbyclient');return;}
  if(baseline){await synthetic.respond(route);return;}
  await route.continue();
 });
 return {observations,responses,blocked,settle:async()=>{await Promise.all(pending);}};
}
export async function installFetchMetadataProbe(page){
 await page.addInitScript(()=>{const original=window.fetch,rows=[];window.fetch=function(input,init){const request=new Request(input,init);rows.push({url:request.url,method:request.method,credentials:request.credentials,redirect:request.redirect,cache:request.cache,bodyIsNull:request.body===null});return Reflect.apply(original,this,[input,init]);};Object.defineProperty(window,'__POA_PRODUCT_TRANSPORT_TEST__',{value:Object.freeze({snapshot:()=>rows.map(x=>({...x}))})});});
}
export async function waitForIntegratedChecker(page){
 await page.waitForFunction(()=>{const root=window.__POA_FORMAT_REVIEW__?.root(),input=root?.querySelector('textarea'),status=root?.querySelector('[role="status"]')?.textContent;return !!input&&(!input.matches(':disabled')||/could not initialize/.test(status));},{},{timeout:8000});
 const ready=await page.evaluate(()=>!window.__POA_FORMAT_REVIEW__.root().querySelector('textarea').matches(':disabled'));
 await page.waitForFunction(()=>document.getElementById('status')?.textContent==='Verified application guard: this page is read-only. Native registry unavailable.'&&document.getElementById('network-status')?.textContent.includes('(unverified)')&&document.getElementById('refresh')?.disabled===false,{},{timeout:8000});
 return ready;
}
export async function readNativeGuard(page){return page.evaluate(()=>({availability:document.getElementById('availability').textContent,operations:document.getElementById('operations').textContent,status:document.getElementById('status').textContent,error:document.getElementById('error').textContent,refreshDisabled:document.getElementById('refresh').disabled,explanation:document.getElementById('explanation').textContent,source:document.getElementById('source').textContent}));}
