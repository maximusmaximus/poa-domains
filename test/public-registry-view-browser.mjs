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
 const text=await page.locator('body').innerText();for(const n of [...HIDDEN.names,...HIDDEN.accounts,...HIDDEN.auctions,...HIDDEN.offers,...HIDDEN.receipts])assert.ok(!text.includes(n),n);
 assert.ok(!await page.locator('#recentActions a.domain-link').count());assert.ok(await page.locator('#recentActions').innerText());
 for(const [tab,box]of [['#tabAuctions','#auctions'],['#tabMarket','#market'],['#tabExplore','#balances']]){const t=page.locator(tab);if(await t.count()){await t.click();if(await page.locator(box).count())assert.equal(await page.locator(box+' .card').count(),0);}}
 // Domain and Find must not manufacture a free title after projection hides it.
 await page.goto(h.url+'/d/'+encodeURIComponent('nexus'));await page.waitForFunction(()=>document.body.dataset.registryStatus==='ready');await expect(page.locator('#domainStatus')).toContainText('not free to register');await expect(page.locator('#domainOwner')).toHaveText('No public ownership record.');assert.equal(await page.locator('#domainActions button').count(),0);await expect(page.locator('#domainOwnerTools')).toBeHidden();await expect(page.locator('#domainHistory')).toHaveText('No public history.');
 await page.goto(h.url+'/?q=nexus');await page.waitForFunction(()=>document.body.dataset.registryStatus==='ready');await page.locator('#searchInput').fill('👩🏿‍🦰');await page.locator('#searchBtn').click();await expect(page.locator('#searchResult')).toContainText('not free to register');assert.equal(await page.locator('#addToCartBtn').count(),0);
 await page.locator('#searchInput').fill('newpublicname');await page.locator('#searchBtn').click();await expect(page.locator('#searchResult')).toContainText('registry units');await expect(page.getByLabel('Maximum bid in registry units for newpublicname',{exact:true})).toBeVisible();
 await page.goto(h.url);await page.waitForFunction(()=>document.body.dataset.registryStatus==='ready');if(process.env.PUBLIC_VIEW_SCREENSHOTS&&name==='chromium'){mkdirSync(process.env.PUBLIC_VIEW_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.PUBLIC_VIEW_SCREENSHOTS+'/clean-'+(width===390?'mobile':'desktop')+'.png',fullPage:true});}
 assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.close();}
 assert.deepEqual(h.writes,[]);assert.equal(engine.stateHash(),original.stateHash);console.log('PASS',name,'clean 390/1440 public view, empty ticker/collections, reserved hidden aliases, internal units, unchanged state, zero writes');
 }finally{await browser.close();await h.close();}
}
