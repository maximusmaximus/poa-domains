// Anonymous loopback fixtures only. The front-door proxy models origin rewriting;
// production proxy/header behavior is verified again after the protected release.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {once} from 'node:events';
import {chromium,firefox,webkit,expect} from '@playwright/test';
import {uiHarness} from './fixtures/ui-harness.mjs';
import {UI_SECURITY,DOMAIN_FONT_FILE,IMMUTABLE_FONT_CACHE} from '../dist/src/ui-policy.js';
const h=await uiHarness(),report=[];
let fontServes=0;
const probe='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Font budget probe</title><link rel="stylesheet" href="/style.css"></head><body><h1 class="site-title">✅ 🪙 → ✕</h1><button>Updated 2m ago · 123 POA → ✕</button><a href="/p/public123">public123</a><label>Action <select id="action"><option>announceAuction</option></select></label><p class="domain-name" id="probeName">→ ✕</p><section id="escrowSection" class="escrow-screen"><article class="card" id="escrowAccount"><h3>↩️ My escrow &amp; refunds</h3></article><article class="card escrow-deposit" id="escrowDeposit"><h3>📥 Deposit: pending</h3></article><div id="escrowMarket"><article class="card"><h3 id="probeMarketName">→ ✕</h3></article></div></section><section id="escrowDomain" class="escrow-screen"><article class="card"><h3 id="probeDomainName">→ ✕</h3></article></section></body></html>';
const front=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/__font_probe'){res.writeHead(200,{'content-type':'text/html',...UI_SECURITY,'cache-control':'no-store'});return res.end(probe);}
  const r=await fetch(h.url+req.url,{redirect:'manual'}),headers=Object.fromEntries(r.headers);
  delete headers['transfer-encoding'];delete headers.connection;
  Object.assign(headers,UI_SECURITY);
  if((headers['content-type']??'').startsWith('text/html'))delete headers['access-control-allow-origin'];
  if(url.pathname==='/'+DOMAIN_FONT_FILE){headers['cache-control']=IMMUTABLE_FONT_CACHE;fontServes++;}
  res.writeHead(r.status,headers);res.end(new Uint8Array(await r.arrayBuffer()));
 }catch(e){res.writeHead(500);res.end('Local fixture failure');}
});
front.listen(0,'127.0.0.1');await once(front,'listening');const base='http://127.0.0.1:'+front.address().port;
const bytes=page=>page.evaluate(()=>performance.getEntriesByType('resource').reduce((sum,r)=>sum+r.decodedBodySize,0));
let browser;
try{
 for(const[name,launcher]of [['chromium',chromium],['firefox',firefox],['webkit',webkit]]){
  browser=await launcher.launch();const context=await browser.newContext({viewport:{width:1280,height:900},...(name==='chromium'?{permissions:['clipboard-read','clipboard-write']}:{})}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.addInitScript(()=>{window.__policyViolations=[];document.addEventListener('securitypolicyviolation',e=>window.__policyViolations.push({directive:e.violatedDirective,blocked:e.blockedURI,target:e.target?.tagName,id:e.target?.id}));});
  try{
   // Cold, real stylesheet + visible branding/controls + ordinary glyphs even in
   // a domain span. This must never download the full bundled font.
   const navigation=await page.goto(base+'/__font_probe');assert.equal(navigation.headers()['access-control-allow-origin'],undefined);
   await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(100);
   // Exercise actual immutable escrow element types/classes, not a synthetic
   // selector-only assertion: non-domain emoji headings must use system fonts.
   for(const id of ['escrowAccount','escrowDeposit']){
    const heading=page.locator('#'+id+' > h3');await expect(heading).toBeVisible();
    assert.doesNotMatch(await heading.evaluate(e=>getComputedStyle(e).fontFamily),/Xero|Emoji Local/,name+' '+id+' must use system fonts');
   }
   for(const id of ['probeMarketName','probeDomainName'])assert.match(await page.locator('#'+id).evaluate(e=>getComputedStyle(e).fontFamily),/Xero/,name+' listing title must keep domain glyphs');
   assert.equal(requests.filter(x=>x.url.includes('.woff2')).length,0,name+' ordinary glyphs caused a font download');
   const shellBytes=await bytes(page);assert.ok(shellBytes<65000,name+' shell byte budget '+shellBytes);
   await page.evaluate(()=>{document.querySelector('#probeName').textContent='👩‍🦰';});
   await page.waitForFunction(()=>[...document.fonts].some(f=>f.family.replaceAll('"','')==='Xero Emoji'&&f.status==='loaded'));
   await page.evaluate(()=>document.fonts.ready);
   const fonts=requests.filter(x=>x.url.includes('.woff2'));assert.equal(fonts.length,1);assert.ok(fonts[0].url.endsWith('/'+DOMAIN_FONT_FILE));
   const response=await page.request.get(base+'/'+DOMAIN_FONT_FILE);assert.equal(response.headers()['cache-control'],IMMUTABLE_FONT_CACHE);
   // A fresh document in the same ordinary browser context reuses immutable bytes.
   const fontServesBefore=fontServes;
   await page.reload();await page.evaluate(()=>{document.querySelector('#probeName').textContent='👩‍🦰';});await page.waitForFunction(()=>[...document.fonts].some(f=>f.family.replaceAll('"','')==='Xero Emoji'&&f.status==='loaded'));await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(100);
   const cached=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.woff2')).map(r=>({transfer:r.transferSize,decoded:r.decodedBodySize})));
   assert.equal(fontServes,fontServesBefore,name+' repeat font bytes reached the server');
   // Firefox can reuse its native font cache without a ResourceTiming entry.
   assert.ok(cached.length<=1&&cached.every(r=>r.transfer===0),name+' font cache '+JSON.stringify(cached));
   const nativeSelect=await page.evaluate(()=>window.__policyViolations);
   // WebKit emits this for a native SELECT even in the no-script probe above.
   // Match that precise baseline, not a general style/CSP exception.
   assert.deepEqual(nativeSelect,name==='webkit'?[{directive:'style-src-attr',blocked:'inline',target:'SELECT',id:'action'}]:[]);
   await context.close();
   const appContext=await browser.newContext({...(name==='chromium'?{permissions:['clipboard-read','clipboard-write']}:{})}),app=await appContext.newPage(),appErrors=[],appRequests=[];
   app.on('pageerror',e=>appErrors.push(e.message));app.on('request',r=>appRequests.push({url:r.url(),method:r.method()}));
   await app.addInitScript(()=>{window.__policyViolations=[];document.addEventListener('securitypolicyviolation',e=>window.__policyViolations.push({directive:e.violatedDirective,blocked:e.blockedURI,source:e.sourceFile,line:e.lineNumber,sample:e.sample,target:e.target?.tagName,id:e.target?.id}));});
   try{
    await app.goto(base+'/?tab=handoff');await app.waitForFunction(()=>document.body.dataset.registryStatus==='ready');await app.evaluate(()=>document.fonts.ready);
    assert.equal(appRequests.filter(r=>r.url.endsWith('.woff2')).length,0,name+' font loaded without visible domain names');
    const handoffBytes=await bytes(app);assert.ok(handoffBytes<750000,name+' handoff byte budget '+handoffBytes);
    await app.locator('#tabFind').click();await app.locator('#searchInput').fill('alpha');await app.locator('#searchBtn').click();await app.locator('#addToCartBtn').click();await expect(app.locator('#copyCartPrompt')).toBeEnabled();
    await app.evaluate(()=>document.fonts.ready);const findBytes=await bytes(app);assert.ok(findBytes<2600000,name+' full cold resource budget '+findBytes);
    if(name==='chromium'){
      await app.locator('#copyCartPrompt').click();assert.match(await app.evaluate(()=>navigator.clipboard.readText()),/poa-domains\.agent-cart\.v2/);
      // A real blocked CSP fetch proves there is no arbitrary HTTPS escape hatch.
      const blocked=await app.evaluate(async()=>{try{await fetch('https://example.invalid/forbidden');return false;}catch{return true;}});assert.equal(blocked,true);
      assert.ok((await app.evaluate(()=>window.__policyViolations)).some(e=>e.directive==='connect-src'));
      assert.ok((await app.evaluate(()=>window.__policyViolations)).every(e=>e.directive==='connect-src')); 
    }else {
      const violations=await app.evaluate(()=>window.__policyViolations.map(({directive,blocked,target,id})=>({directive,blocked,target,id})));
      assert.deepEqual(violations,nativeSelect,'only the no-script native SELECT baseline is permitted');
    }
    await app.locator('#tabEscrow').click();await expect(app.locator('#manageDomains > h2')).toHaveText('🌱 Manage domains and subdomains');await expect(app.locator('#escrowPayments h2')).toHaveText('🪙 My POA');
    assert.deepEqual(appErrors,[]);assert.ok(appRequests.every(r=>new URL(r.url).origin===base&&r.method==='GET'));
    report.push({browser:name,shellBytes,handoffBytes,findBytes,fontBytes:1856988,fontRequests:fonts.length,cache:cached,proxy:'same-origin origin-rewrite fixture',nativeSelectCspBaseline:nativeSelect,clipboard:name==='chromium'?'real copy verified':'covered by existing keyboard tests'});
    console.log('PASS',name,'font bytes/cache/budgets and real app through strict-header proxy',JSON.stringify(report.at(-1)));
   }finally{await appContext.close();}
   assert.deepEqual(errors,[]);
  }finally{if(!context.isClosed?.())await context.close();await browser.close();browser=null;}
 }
 assert.deepEqual(h.writes,[]);mkdirSync('test-results',{recursive:true});writeFileSync('test-results/ui-perf-results.json',JSON.stringify(report,null,2)+'\n');
}finally{if(browser)await browser.close();front.closeAllConnections();await new Promise(resolve=>front.close(resolve));await h.close();}
