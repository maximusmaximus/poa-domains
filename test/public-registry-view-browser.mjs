// Both responsive layouts and browser engines; only GETs to loopback, no financial actions.
import assert from 'node:assert/strict';
import {chromium,firefox,webkit,expect} from '@playwright/test';
import {uiHarness} from './fixtures/ui-harness.mjs';
import {auditedEngine,get,original} from './fixtures/audited-engine.mjs';
import {HIDDEN} from '../dist/public-registry-view.mjs';
import {mkdirSync} from 'node:fs';
for(const [name,launcher]of [['chromium',chromium],['firefox',firefox],['webkit',webkit]].filter(([n])=>!process.env.UI_IDEAS_BROWSER||process.env.UI_IDEAS_BROWSER===n)){
 const h=await uiHarness('mainnet'),engine=auditedEngine();h.cap=get(engine,'/v1/capabilities',{include:'emoji'}).data;h.payload=get(engine,'/v1/state').data;
 const browser=await launcher.launch();try{for(const width of [390,1440]){const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===h.url?r.continue():r.abort());
 await page.goto(h.url);await page.waitForFunction(()=>document.body.dataset.registryStatus==='ready');await expect(page.locator('#registryUnitsNotice')).toContainText('not POA or wallet money');
 // Non-critical notes are in the window's ℹ️ popover, immediately left of its ❌; only one short status line stays visible.
 const visibleText=await page.locator('body').innerText();for(const note of ['Test records are hidden','internal registry units, not POA','POA payments refresh separately','Hosted registry data','Local registry data'])assert.ok(!visibleText.includes(note),note);
 assert.equal((await page.locator('#networkStatusText').innerText()).split('\n').length,1);
 await expect(page.locator('#networkStatusIcon')).toBeHidden();assert.equal([...(await page.locator('#networkStatusBar .status-network').innerText()).matchAll(/[⚪🟢🟡🔴●]/gu)].length,1);
 const corner=await page.locator('#networkStatusBar').evaluate(n=>{const a=n.querySelector('#help-networkStatusBar').getBoundingClientRect(),b=n.querySelector('#networkStatusDismiss').getBoundingClientRect();return{gap:b.left-a.right,dy:Math.abs(a.top-b.top)};});assert.ok(corner.gap>=0&&corner.gap<12&&corner.dy<2,JSON.stringify(corner));
 await page.locator('#help-networkStatusBar').click();await expect(page.locator('#info-networkStatusBar')).toContainText('Test records are hidden, not deleted');await expect(page.locator('#info-networkStatusBar')).toContainText('internal registry units');await page.keyboard.press('Escape');
 const text=await page.locator('body').innerText();for(const n of [...HIDDEN.names,...HIDDEN.accounts,...HIDDEN.auctions,...HIDDEN.offers,...HIDDEN.receipts])assert.ok(!text.includes(n),n);
 assert.ok(!await page.locator('#recentActions a.domain-link').count());assert.ok(await page.locator('#recentActions').innerText());
 await page.evaluate(()=>document.fonts.ready);
 await expect(page.locator('.section-tab .tab-dot:not([hidden])')).toHaveCount(6);
 await expect(page.locator('#tabEscrow .tab-dot')).toHaveAttribute('title',/Registry snapshot ready; POA payments are checked separately/);
 await expect(page.locator('#tabHandoff .tab-dot')).toBeVisible();
 assert.equal(await page.locator('#siteTitle').textContent(),'🅿️🅾️🅰️D🅾️Ⓜ️🅰️INS');
 const measure=()=>page.evaluate(()=>{
  const rect=n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};
  const tabs=document.querySelector('#sectionTabs'),row=document.querySelector('.ideas-masonry'),help=document.querySelector('#ideasHeading > .module-info');
  const visible=[...row.querySelectorAll('.idea')].filter(n=>getComputedStyle(n).visibility==='visible').map(rect);
  const color=getComputedStyle(document.querySelector('#tabFind .tab-age')).color;
  const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number),lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  return{width:innerWidth,tabs:rect(tabs),tabOverflow:tabs.scrollWidth>tabs.clientWidth+1,buttons:[...tabs.querySelectorAll('.section-tab')].map(rect),row:rect(row),help:rect(help),visible,ticker:rect(document.querySelector('#recentActions')),header:rect(document.querySelector('header')),empty:rect(document.querySelector('.ticker-empty')),tickerHelp:rect(document.querySelector('#recentActions > .module-info')),contrast:(lum([79,191,149])+.05)/(lum(rgb)+.05)};
 });
 await expect.poll(async()=>{const m=await measure();return m.visible.length>0&&m.visible.every(r=>r.left>=m.row.left-.5&&r.right<=m.row.right+.5);}).toBe(true);
 const m=await measure();assert.ok(!m.tabOverflow&&m.buttons.every(r=>r.left>=m.tabs.left-.5&&r.right<=m.tabs.right+.5),JSON.stringify(m));
 assert.ok(m.row.left>=0&&m.row.right<=width+.5&&m.visible.every(r=>r.top>=m.help.bottom+3),JSON.stringify(m));
 assert.ok(m.ticker.left>=m.header.left-.5&&m.ticker.right<=m.header.right+.5&&m.empty.left>=m.ticker.left&&m.empty.right<=m.tickerHelp.left,JSON.stringify(m));
 assert.ok(m.tickerHelp.left-m.empty.right<=12,'Empty ticker help stays beside its label, not alone at the far right');
 assert.ok(m.contrast>=4.5,'Active Find freshness text contrast '+m.contrast);
 // The whole-chip boundary rule must hold during motion, not just at initial scrollLeft=0.
 await page.emulateMedia({reducedMotion:'no-preference'});await page.mouse.move(0,0);
 await expect(page.locator('.ideas-masonry')).toHaveAttribute('data-motion','running');
 const before=await page.locator('.ideas-masonry').evaluate(n=>n.scrollLeft);
 await page.waitForFunction(x=>document.querySelector('.ideas-masonry').scrollLeft>x+6,before);
 await expect.poll(async()=>{const m=await measure();return m.visible.length>0&&m.visible.every(r=>r.left>=m.row.left-.5&&r.right<=m.row.right+.5);}).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});

 await page.locator('#cartAnchor').scrollIntoViewIfNeeded();await expect(page.locator('#floatingCartBtn')).toBeHidden();
 assert.ok(await page.locator('#cartStatus').evaluate(n=>{const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.left+20,r.top+r.height/2);return hit===n||n.contains(hit);}), 'Inline cart counter is not covered');
 await page.locator('#tabHandoff').click();await expect(page.locator('#floatingCartBtn')).toBeVisible();await page.locator('#floatingCartBtn').click();await expect(page.locator('#floatingCartPanel')).toBeVisible();await page.locator('#floatingCartClose').click();
 await page.locator('#tabFind').click();await page.evaluate(()=>scrollTo(0,0));

 for(const [tab,box]of [['#tabAuctions','#auctions'],['#tabMarket','#market'],['#tabExplore','#balances']]){const t=page.locator(tab);if(await t.count()){await t.click();if(await page.locator(box).count())assert.equal(await page.locator(box+' .card').count(),0);}}
 // Domain and Find must not manufacture a free title after projection hides it.
 await page.goto(h.url+'/d/'+encodeURIComponent('nexus'));await page.waitForFunction(()=>document.body.dataset.registryStatus==='ready');await expect(page.locator('#domainStatus')).toContainText('not free to register');await expect(page.locator('#domainOwner')).toHaveText('No public ownership record.');assert.equal(await page.locator('#domainActions button').count(),0);await expect(page.locator('#domainOwnerTools')).toBeHidden();await expect(page.locator('#domainHistory')).toHaveText('No public history.');
 await page.goto(h.url+'/?q=nexus');await page.waitForFunction(()=>document.body.dataset.registryStatus==='ready');await page.locator('#searchInput').fill('👩🏿‍🦰');await page.locator('#searchBtn').click();await expect(page.locator('#searchResult')).toContainText('not free to register');assert.equal(await page.locator('#addToCartBtn').count(),0);
 await page.locator('#searchInput').fill('newpublicname');await page.locator('#searchBtn').click();await expect(page.locator('#searchResult')).toContainText('registry units');await expect(page.getByLabel('Maximum bid in registry units for newpublicname',{exact:true})).toBeVisible();
 await page.goto(h.url);await page.waitForFunction(()=>document.body.dataset.registryStatus==='ready');await expect(page.locator('#floatingCartBtn')).toBeHidden();if(process.env.PUBLIC_VIEW_SCREENSHOTS&&name==='chromium'){mkdirSync(process.env.PUBLIC_VIEW_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.PUBLIC_VIEW_SCREENSHOTS+'/clean-'+(width===390?'mobile':'desktop')+'.png',fullPage:true});}
 assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.close();}
 assert.deepEqual(h.writes,[]);assert.equal(engine.stateHash(),original.stateHash);console.log('PASS',name,'bounded 390/1440 tabs/chips/help/ticker, contrast>=4.5, stable title, six read-status dots, cart shortcut suppression; clean public view, empty ticker/collections, reserved hidden aliases, internal units, unchanged state, zero writes');
 }finally{await browser.close();await h.close();}
}
