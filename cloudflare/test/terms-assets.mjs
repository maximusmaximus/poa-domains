// Real Workers Static Assets clean-URL resolution in local workerd. No production bindings.
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.ERROR),telemetry:{enabled:false},workers:[{name:'terms-assets-local',modules:true,script:'export default { fetch(r,e) { return e.ASSETS.fetch(r); } };',compatibilityDate:'2026-11-08',assets:{directory:resolve('reference-web'),binding:'ASSETS'},outboundService:()=>{throw Error('OUTBOUND_FORBIDDEN');}}]}));
try{for(const host of ['poadomains.grok.me','poadomains-registry.maxinfeld-artshow.workers.dev']){
 const r=await mf.dispatchFetch('https://'+host+'/terms');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/html/);assert.equal(await r.text(),readFileSync('reference-web/terms.html','utf8'));
 const cssPath=/href="(\.\/terms\.css\?v=[a-f0-9]+)"/.exec(readFileSync('reference-web/terms.html','utf8'))[1];const css=await mf.dispatchFetch(new URL(cssPath,'https://'+host+'/terms'));assert.equal(css.status,200);assert.equal(await css.text(),readFileSync('reference-web/terms.css','utf8'));
 const head=await mf.dispatchFetch('https://'+host+'/terms',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 const canonical=await mf.dispatchFetch('https://'+host+'/terms.html',{redirect:'manual'});assert.equal(canonical.status,307);assert.equal(new URL(canonical.headers.get('location'),'https://'+host).pathname,'/terms');
}}finally{await mf.dispose();}
console.log('PASS local workerd clean /terms GET/HEAD, exact scriptless HTML/stamped CSS and canonical redirect on both hosts; no upstream or production bindings');
