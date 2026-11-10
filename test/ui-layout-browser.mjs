// Real renders use isolated GET-only loopback state. No upstream or financial actions.
import assert from 'node:assert/strict';
import {chromium,firefox,webkit,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {uiHarness} from './fixtures/ui-harness.mjs';
const output=process.env.UI_IDEAS_SCREENSHOTS;if(output)mkdirSync(output,{recursive:true});
for(const [name,launcher]of [['chromium',chromium],['firefox',firefox],['webkit',webkit]].filter(([n])=>!process.env.UI_IDEAS_BROWSER||process.env.UI_IDEAS_BROWSER===n)){
 const h=await uiHarness('mainnet'),browser=await launcher.launch(),errors=[],requests=[],measurements=[];
 for(let i=0;i<24;i++)h.payload.state.receipts['local-'+i]={intentId:'local-'+i,sequence:i+1,status:'succeeded',result:{name:'garden'},time:h.payload.state.time};
 const shot=async(suffix,p)=>{if(output&&name==='chromium')await p.screenshot({path:output+'/v5-'+suffix+'.png',fullPage:true});};
 try{
  for(const width of [360,390,414,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
 context.on('request',r=>requests.push({url:r.url(),method:r.method()}));
 await context.route('**/*',r=>new URL(r.request().url()).origin===h.url?r.continue():r.abort());
   try{await page.goto(h.url);await page.waitForFunction(()=>document.body.dataset.registryStatus==='ready');await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>scrollTo(0,0));
   const geometry=await page.evaluate(()=>{const r=s=>{const b=document.querySelector(s).getBoundingClientRect();return{top:b.top,bottom:b.bottom,height:b.height};};
    const b=Object.fromEntries(['header','#networkStatusBar','#recentActions','.section-navigation','#sectionTabs','#searchSection','.ideas','.ideas-masonry','.search-label','#searchInput','.search-bar','#cartAnchor','#siteFooter'].map(s=>[s,r(s)]));
    return{width:innerWidth,body:document.body.scrollWidth,doc:document.documentElement.scrollWidth,space:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-space')),tight:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-tight')),gaps:{headerStatus:b['#networkStatusBar'].top-b.header.bottom,statusTicker:b['#recentActions'].top-b['#networkStatusBar'].bottom,tickerTabs:b['.section-navigation'].top-b['#recentActions'].bottom,tabsIdeas:b['.ideas'].top-b['#sectionTabs'].bottom,ideasField:b['.search-label'].top-Math.max(...[...document.querySelectorAll('.idea')].map(n=>n.getBoundingClientRect().bottom)),visibleIdeasField:b['.search-label'].top-Math.max(...[...document.querySelectorAll('.idea')].filter(n=>{const r=n.getBoundingClientRect();return r.right>0&&r.left<innerWidth;}).map(n=>n.getBoundingClientRect().bottom)),labelInput:b['#searchInput'].top-b['.search-label'].bottom,searchCart:b['#cartAnchor'].top-b['.search-bar'].bottom,sectionFooter:b['#siteFooter'].top-b['#searchSection'].bottom}};
   });measurements.push(geometry);
   assert.ok(geometry.doc<=width+1&&geometry.body<=width+1,JSON.stringify(geometry));
   for(const key of ['headerStatus','statusTicker','tickerTabs','tabsIdeas','searchCart','sectionFooter'])assert.ok(Math.abs(geometry.gaps[key]-geometry.space)<1,key+' '+JSON.stringify(geometry));
   for(const key of ['ideasField','labelInput'])assert.ok(Math.abs(geometry.gaps[key]-geometry.tight)<1,key+' '+JSON.stringify(geometry));
   assert.ok(geometry.gaps.visibleIdeasField>=7&&geometry.gaps.visibleIdeasField<=22,JSON.stringify(geometry));
   await expect(page.locator('#searchResult')).toBeHidden();await expect(page.locator('#searchResult .module-info')).toHaveCount(0);await expect(page.locator('#ideasStatus')).toBeHidden();await expect(page.locator('#siteTerms')).toHaveCount(0);
   const title=await page.locator('#siteTitle').boundingBox();if(width<600)assert.ok(Math.abs(title.width-width)<2&&Math.abs(title.x)<2);
   await shot(width===1440?'desktop-find':'mobile-'+width+'-find',page);
   await page.locator('#searchInput').focus();const position=await page.locator('#searchInput').boundingBox(),tabs=await page.locator('.section-navigation').boundingBox();assert.ok(position.y>=tabs.y+tabs.height-1,'Focused check input must not sit behind sticky tabs');
   await page.locator('#tabEscrow').click();await page.evaluate(()=>scrollTo(0,0));
   await expect(page.locator('#manageDomains')).toBeVisible();await expect(page.locator('#manageNames')).toBeHidden();await expect(page.locator('#managePrompt')).toBeHidden();
   const manage=await page.evaluate(()=>{const n=document.querySelector('#escrowSection'),a=n.getBoundingClientRect(),b=document.querySelector('.section-navigation').getBoundingClientRect(),m=document.querySelector('#manageDomains').getBoundingClientRect(),footer=document.querySelector('#siteFooter').getBoundingClientRect();return{view:innerWidth,body:document.body.scrollWidth,doc:document.documentElement.scrollWidth,gap:a.top-b.bottom,heading:document.querySelector('#manageDomains h2').getBoundingClientRect().top-m.top,footerGap:footer.top-a.bottom};});
   assert.ok(manage.body<=width+1&&manage.doc<=width+1,JSON.stringify(manage));assert.ok(Math.abs(manage.gap-12)<1&&Math.abs(manage.footerGap-12)<1,JSON.stringify(manage));assert.ok(manage.heading>=0&&manage.heading<=13,JSON.stringify(manage));
   await shot(width===1440?'desktop-manage':'mobile-'+width+'-manage',page);
   await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
   for(const a of await page.locator('#siteFooter a').all()){assert.ok(await a.evaluate(n=>{const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return n===hit||n.contains(hit);}), 'Footer link must not be covered by the floating cart');}

   // Opening the real footer link creates a clean, scriptless document without app tabs.
   const popupPromise=context.waitForEvent('page');await page.getByRole('link',{name:'📜 Terms',exact:true}).click();const terms=await popupPromise;await terms.waitForLoadState('load');
   assert.equal(terms.url(),h.url+'/terms');await expect(terms.locator('h2')).toHaveCount(8);await expect(terms.locator('body')).toContainText('original payer');await expect(terms.locator('body')).toContainText('Query text is saved');await expect(terms.locator('script,form,#sectionTabs')).toHaveCount(0);
   const layout=await terms.evaluate(()=>{const sections=[...document.querySelectorAll('main h2')];return{body:document.body.scrollWidth,doc:document.documentElement.scrollWidth,view:innerWidth,overlaps:sections.some(n=>n.getBoundingClientRect().top<n.previousElementSibling.getBoundingClientRect().bottom),padded:parseFloat(getComputedStyle(document.body).paddingLeft)};});assert.ok(layout.body<=width+1&&layout.doc<=width+1&&!layout.overlaps&&layout.padded>=12,JSON.stringify(layout));
   assert.equal(await terms.locator('.footer-credit').innerText(),'made with ❤️ in SF by Tesselate Army | maxi.grok.me');await shot(width===1440?'desktop-terms':'mobile-'+width+'-terms',terms);
   assert.equal(await terms.evaluate(()=>innerWidth),width,'New-window Terms inherits the actual mobile viewport');
   await terms.getByRole('link',{name:'← Back to the site',exact:true}).click();await terms.waitForFunction(()=>document.body.dataset.registryStatus==='ready');assert.equal(terms.url(),h.url+'/');await terms.close();
   await page.goto(h.url+'/d/garden');await expect(page.locator('#domainMain')).toBeVisible();await expect(page.locator('#homeMain')).toBeHidden();await expect(page.locator('.section-navigation')).toBeHidden();
   }finally{await context.close();}
  }
  assert.deepEqual(errors,[]);assert.deepEqual(h.writes,[]);assert.ok(requests.every(r=>new URL(r.url).origin===h.url&&r.method==='GET'));
  if(output&&name==='chromium')writeFileSync(output+'/v5-tested-gaps.json',JSON.stringify(measurements,null,2)+'\n');console.log('PASS',name,'360/390/414/1440: equal 12px outer gaps, 8px ideas/field gaps, no phantom results/overlap/overflow, Manage domains, separate Terms with back link, deep-link hidden home, zero writes');
 }finally{await browser.close();await h.close();}
}
