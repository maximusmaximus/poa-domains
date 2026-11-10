// Synthetic local state only; all browser requests must be loopback GETs.
import assert from 'node:assert/strict';
import {chromium,firefox,webkit,expect} from '@playwright/test';
import {uiHarness} from './fixtures/ui-harness.mjs';
import {safeObject} from '../reference-web/shared.js';
for(const [name,launcher] of [['chromium',chromium],['firefox',firefox],['webkit',webkit]]){
 const h=await uiHarness('mainnet'),browser=await launcher.launch(),context=await browser.newContext({viewport:{width:390,height:844}}),errors=[],requests=[];
 const state=h.payload.state,owner='poa1'+'1'.repeat(32),parent='a'.repeat(64),child='b'.repeat(64),auction='c'.repeat(64),receipt='d'.repeat(64);
 state.time=1000000; // Match the fixture clock; auction opening times must never be negative.
 for(const [id,domain,parentId] of [[parent,'nexus',null],[child,'seed.nexus',parent]]){state.names[domain]={name:domain,generation:1,activeId:id,auctionId:null,version:1};state.deeds[id]={id,name:domain,parentId,generation:1,owner,version:1,ownerVersion:1,rights:{kind:'permanent'},records:[],metadata:[{cid:'synthetic-local-metadata'}]};}
 state.auctions[auction]={id:auction,name:'nexus',status:'cancelled',reserve:'1000',asset:'POA',openAt:state.time-100,window:60,quiet:60,high:null,version:1};
 state.credits.local={amount:'10',payer:owner,auctionId:auction,asset:'POA',version:1};state.receipts[receipt]={intentId:receipt,requestId:'local-link-regression',sequence:1,time:state.time,status:'succeeded',signer:owner,result:{name:'seed.nexus',deedId:child}};state.sequence=1;safeObject(h.payload);
 try{
  await context.route('**/*',r=>{const q=r.request();requests.push(q.method()+' '+q.url());return new URL(q.url()).origin===h.url&&q.method()==='GET'?r.continue():r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(h.url);await page.waitForFunction(()=>['ready','error'].includes(document.body.dataset.registryStatus));assert.equal(await page.locator('body').getAttribute('data-registry-status'),'ready');
  await expect(page.locator('#history h4 a[href="/d/seed.nexus"]')).toHaveCount(1);await expect(page.locator('#balances .badge-ok a[href="/d/nexus"]')).toHaveCount(1);
  await page.locator('#searchInput').fill('new.nexus');await page.locator('#searchBtn').click();await expect(page.locator('#searchResult p a[href="/d/nexus"]')).toHaveCount(1);
  await page.locator('#searchResult p a[href="/d/nexus"]').click();await expect(page.locator('#domainMain')).toBeVisible();assert.ok(await page.locator('#domainHistory a[href="/d/nexus"]').count());
  assert.deepEqual(errors,[]);assert.deepEqual(h.writes,[]);assert.ok(requests.every(r=>r.startsWith('GET '+h.url)));
  console.log('PASS',name,'390px actual rendered parent/history/receipt/refund domain links; no browser errors or writes');
 }catch(error){const pages=context.pages();const cause=pages.length?await pages[0].evaluate(async payload=>{try{const steps=[["ui-render.js","render",[payload]],["ui-cart.js","renderCart",[]],["ui-manage.js","renderManagement",[]],["ui-help.js","installHelp",[]],["ui-ideas.js","renderIdeas",[]]];for(const [file,fn,args]of steps){try{(await import("/"+file))[fn](...args);}catch(error){return file+" "+error.stack;}}return "all draw steps succeeded";}catch(e){return e.stack;}},h.payload):"closed";console.error(JSON.stringify({browser:name,errors,cause,body:pages.length?await pages[0].locator("body").innerText():"closed"},null,2));throw error;}finally{await context.close();await browser.close();await h.close();}
}
