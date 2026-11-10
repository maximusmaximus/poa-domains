// All traffic is loopback GET-only fixture data; no accounts or PoA actions.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { uiHarness } from './fixtures/ui-harness.mjs';
import { auctionState, offerState } from './fixtures/ui-state.mjs';
const browser=await chromium.launch({headless:true});
async function scenario(name, run, setup=()=>{}) {
 const h=await uiHarness(), page=await browser.newPage({viewport:{width:390,height:844}}), errors=[];
 page.on('pageerror',e=>errors.push(e.message)); await page.route('https://**',r=>r.abort()); await page.emulateMedia({reducedMotion:'reduce'});
 try { setup(h); await page.clock.install(); await run(h,page); assert.deepEqual(errors,[]); assert.deepEqual(h.writes,[]); console.log('PASS '+name); }
 finally { await page.close(); await h.close(); }
}
const ready=p=>p.waitForFunction(()=>document.body.dataset.registryStatus==='ready');
async function poll(h,p) {
 const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/v1/state');
 await p.clock.fastForward(12000); await response;
 await p.waitForFunction(()=>document.body.dataset.registryStatus!=='loading');
}
async function check(p,name) { await p.locator('#searchInput').fill(name); await p.locator('#searchBtn').click(); }
try {
 await scenario('listeners and escrow mount before slow initial state; submitted search survives loading',async(h,p)=>{
  await p.goto(h.url,{waitUntil:'commit'}); await p.locator('#action option').first().waitFor({state:'attached'});
  await expect(p.locator('#registryLoading')).toBeVisible();
  await p.locator('#tabEscrow').click(); await expect(p.locator('#tabEscrow')).toHaveAttribute('aria-selected','true');
  await expect(p.locator('#escrowSection h2')).toHaveText('🪙 My POA');
  await p.locator('#tabFind').click(); await check(p,'alpha');
  await expect(p.locator('#searchResult')).toContainText('Loading registry data');
  await ready(p); await expect(p.locator('#searchResult')).toContainText('Available');
 },h=>h.stateDelay=1200);
 await scenario('initial 500 has a page-wide error, working tabs/escrow and retry recovery',async(h,p)=>{
  await p.goto(h.url); await expect(p.locator('#registryError')).toBeVisible();
  await p.locator('#tabEscrow').click(); await expect(p.locator('#registryError')).toBeVisible();
  await expect(p.locator('#escrowSection h2')).toHaveText('🪙 My POA');
  h.stateStatus=200; await p.locator('#registryRetry').click(); await ready(p);
  await expect(p.locator('#registryError')).toBeHidden(); await expect(p.locator('#registryAge')).toContainText('Registry data updated 0m ago');
 },h=>h.stateStatus=500);
 await scenario('q/tab links, history, fresh search and age on every mobile tab',async(h,p)=>{
  await p.goto(h.url+'/?q=alpha&tab=market'); await ready(p);
  await expect(p.locator('#tabMarket')).toHaveAttribute('aria-selected','true'); await expect(p.locator('#searchInput')).toHaveValue('alpha');
  await p.locator('#tabFind').click(); await expect(p.locator('#searchResult')).toContainText('Available');
  await check(p,'bravo'); await p.locator('#tabExplore').click(); assert.match(p.url(),/q=bravo&tab=explore/);
  await p.goBack(); await expect(p.locator('#tabFind')).toHaveAttribute('aria-selected','true');
  await p.goBack(); await expect(p.locator('#searchInput')).toHaveValue('alpha');
  h.payload.state=auctionState(); await poll(h,p); await expect(p.locator('#searchResult')).toContainText('In auction now');
  h.stateStatus=500; await p.clock.fastForward(120000); await expect(p.locator('#registryError')).toBeVisible();
  for(const age of await p.locator('.tab-age').allTextContents()) assert.equal(age,'updated 2m ago');
  assert.equal(await p.locator('.tab-age').count(),6); assert.equal(await p.locator('.tab-dot').count(),6); assert.equal(await p.locator('#siteFooter').count(),1);
  assert.ok(!/xero\s*emoji/i.test(await p.locator('body').innerText()));
 });
 await scenario('outbid review persists across reload, caps never auto-rise and copies stay blocked until acknowledgement',async(h,p)=>{
  await p.goto(h.url+'/?q=alpha'); await ready(p); await p.locator('#addToCartBtn').click();
  const amount=p.getByLabel('Amount or max bid for alpha',{exact:true}); await amount.fill('2000');
  const a=h.payload.state.auctions['a'.repeat(64)]; a.version=2; a.high.amount='1500'; h.payload.state.sequence++;
  await poll(h,p); await expect(p.locator('#searchResult')).toContainText('1651'); await expect(amount).toHaveValue('2000');
  await expect(p.locator('#copyCartPrompt')).toBeDisabled(); await expect(p.locator('#cartList')).toContainText('outbid'); await expect(p.locator('#tabAuctions .tab-dot')).toBeVisible();
  await p.reload(); await ready(p); await expect(p.locator('#copyCartPrompt')).toBeDisabled();
  await p.getByRole('button',{name:'Review changed item'}).click(); await expect(p.locator('#copyCartPrompt')).toBeEnabled();
  assert.match(await p.locator('#cartPrompt').innerText(),/"expectedVersion":\s*2/);
  a.version=3; a.high.amount='3000'; await poll(h,p); await expect(amount).toHaveValue('2000');
  await expect(p.getByRole('button',{name:'Review changed item'})).toBeDisabled(); await amount.fill('4000');
  await expect(p.locator('#copyCartPrompt')).toBeDisabled(); await p.getByRole('button',{name:'Review changed item'}).click();
  await expect(p.locator('#copyCartPrompt')).toBeEnabled(); assert.match(await p.locator('#cartPrompt').innerText(),/"expectedVersion":\s*3/);
  h.stateStatus=500; await poll(h,p); await expect(p.locator('#registryError')).toBeVisible(); await expect(p.locator('#copyCartPrompt')).toBeDisabled();
  await p.locator('#floatingCartBtn').click(); await expect(p.locator('#copyCheckoutBtn')).toBeDisabled(); await p.locator('#floatingCartClose').click();
  h.stateStatus=200; await p.locator('#registryRetry').click(); await ready(p); await expect(p.locator('#copyCartPrompt')).toBeEnabled();
 },h=>h.payload.state=auctionState());
 await scenario('typing/focus/caret survive registry and network polls, including unsubmitted cart/search drafts',async(h,p)=>{
  await p.goto(h.url+'/?q=alpha'); await ready(p); await p.locator('#addToCartBtn').click();
  const input=p.getByLabel('Amount or max bid for alpha',{exact:true}); await input.fill('275');
  await input.evaluate(n=>{n.focus();n.setSelectionRange(1,2);}); await poll(h,p);
  assert.deepEqual(await input.evaluate(n=>[n.value,document.activeElement===n,n.selectionStart,n.selectionEnd]),['275',true,1,2]);
  await p.clock.fastForward(20000); await expect(input).toBeFocused(); await expect(input).toHaveValue('275');
  const search=p.getByLabel('Max bid for alpha',{exact:true}); await search.fill('333'); await search.focus(); await poll(h,p); await expect(search).toBeFocused(); await expect(search).toHaveValue('333');
  await p.locator('#searchInput').fill('unfinished draft'); await poll(h,p); await expect(p.locator('#searchInput')).toHaveValue('unfinished draft');
  await check(p,'bad-name'); await expect(p.locator('#searchResult')).toContainText('Spaces, hyphens');
  await check(p,'alpha'); await p.locator('#searchResult a[href="/d/alpha"]').click(); assert.match(new URL(p.url()).pathname,/\/d\/alpha/);
  await expect(p.locator('#registryAge')).toBeVisible();
 });
 await scenario('domain listing edits and focus survive polling; stale listing copy is held',async(h,p)=>{
  await p.goto(h.url+'/d/alpha'); await ready(p);
  const price=p.locator('#listPriceInput'); await price.fill('4321'); await price.focus(); await poll(h,p);
  await expect(price).toHaveValue('4321'); await expect(price).toBeFocused();
  h.stateStatus=500; await poll(h,p); await expect(p.locator('#registryError')).toBeVisible();
  await p.locator('#copyChangePromptBtn').click(); await expect(p.locator('#listingPromptStatus')).toContainText('Refresh registry data');
 },h=>h.payload.state=offerState());
 await scenario('expired offer is flagged using server time without a new commit; last view survives failure',async(h,p)=>{
  await p.goto(h.url+'/?q=alpha'); await ready(p); await p.locator('#addToCartBtn').click();
  h.payload.observedServerTime=h.payload.state.time+90000; await poll(h,p); await expect(p.locator('#cartList')).toContainText('offer is gone');
  await expect(p.locator('#copyCartPrompt')).toBeDisabled(); await expect(p.locator('#searchResult #addToCartBtn')).toHaveCount(0);
  h.stateStatus=500; await poll(h,p); await expect(p.locator('#registryError')).toBeVisible(); await expect(p.locator('#searchResult')).toContainText('Owned');
 },h=>h.payload.state=offerState());
} finally { await browser.close(); }
