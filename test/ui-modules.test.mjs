import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {transformSync} from 'esbuild';
import {buildCartItem,editCartAmount} from '../reference-web/shared.js';
import {capabilities} from '../dist/src/interface.js';
import {profileEngine} from './fixtures/ui-harness.mjs';
import {auctionState,offerState} from './fixtures/ui-state.mjs';
import {stampAssets} from '../scripts/stamp-assets.mjs';

test('one cart factory derives root, bid, resale and child params from current capabilities/state',()=>{
 for(const profile of ['fixture','mainnet']) {
  const e=profileEngine(profile),cap=capabilities(e),state=e.snapshot();
  for(const name of ['alpha','🚀','🚀🚀']){
   const item=buildCartItem({name,action:'announceAuction+bid'},cap,state);
   assert.equal(item.params.reserve,cap.assets.POA[item.tier==='premium'?'premiumReserve':'standardReserve']);
   assert.equal(item.params.maxBid,item.amount);assert.equal(item.needsReview,false);
   const edited=editCartAmount(item,(BigInt(item.amount)*2n).toString(),cap,state);
   assert.equal(edited.params.reserve,item.params.reserve);assert.equal(edited.params.maxBid,edited.amount);
  }
 }
 const cap=capabilities(profileEngine()),auctions=auctionState(),a=Object.values(auctions.auctions)[0];
 const bid=buildCartItem({name:'alpha',action:'bid',auctionId:a.id},cap,auctions);
 assert.deepEqual(bid.params,{auctionId:a.id,expectedVersion:a.version,asset:'POA',amount:'1101'});
 assert.equal(bid.needsReview,false);
 const resale=offerState(),o=Object.values(resale.offers)[0];
 const buy=buildCartItem({name:'alpha',action:'buyFixed',offerId:o.id},cap,resale);
 assert.deepEqual(buy.params,{offerId:o.id,expectedVersion:o.version,asset:'POA',amount:o.price});assert.equal(buy.needsReview,false);
 o.kind='child';o.labels=['shop'];resale.names['shop.alpha']={generation:2,activeId:null,auctionId:null};
 const child=buildCartItem({name:'shop.alpha',action:'fillChildOffer',offerId:o.id},cap,resale);
 assert.equal(child.params.expectedGeneration,3);assert.equal(child.params.label,'shop');assert.equal(child.params.metadata.document.name,'shop.alpha');assert.equal(child.needsReview,false);
 assert.throws(()=>buildCartItem({name:'alpha',action:'bid',auctionId:'missing'},cap,auctions),/current auction/);
 assert.throws(()=>buildCartItem({name:'alpha',action:'buyFixed',offerId:'missing'},cap,resale),/current offer/);
});

test('UI responsibilities are separate modules, callers cannot duplicate cart params, and graph stamps are stable',()=>{
 const modules=readdirSync('reference-web').filter(n=>n.startsWith('ui-')&&n.endsWith('.js'));
 for(const part of ['router','render','cart','poll','handoff','state'])assert.ok(modules.includes(`ui-${part}.js`));
 const bootstrap=readFileSync('reference-web/app.js','utf8');assert.ok(bootstrap.split('\n').length<250);
 for(const file of modules.filter(n=>n!=='ui-state.js')) {
  const source=readFileSync('reference-web/'+file,'utf8');
  assert.doesNotMatch(source,/addToCart\(\{[^}]*\bparams\s*:/s,file);
  for(const [,target,revision]of source.matchAll(/from\s*["']\.\/([a-z-]+\.js)\?v=([a-f0-9]{12})["']/g)) {
   assert.ok(readdirSync('reference-web').includes(target));
   assert.ok(readFileSync('reference-web/index.html','utf8').includes(`/app.js?v=${revision}`));
  }
 }
 assert.equal(stampAssets().changed,false,'a second stamp must not alter files or cycle hashes');
});

test('escrow unminification preserves the exact reviewed executable program',()=>{
 const source=readFileSync('reference-web/escrow.js','utf8').replace(/\?v=[0-9a-f]{12}/g,'');
 const code=transformSync(source,{loader:'js',minify:true,legalComments:'none'}).code;
 assert.equal(createHash('sha256').update(code).digest('hex'),readFileSync('test/fixtures/escrow-executable.sha256','utf8').trim());
});

test('all UI modules load without booting a browser, and shared copy guards remain fail closed',async()=>{
 const revision=/app\.js\?v=([a-f0-9]{12})/.exec(readFileSync('reference-web/index.html','utf8'))[1];
 const modules={};for(const file of readdirSync('reference-web').filter(n=>n.startsWith('ui-')&&n.endsWith('.js')))modules[file]=await import(`../reference-web/${file}?v=${revision}`);
 const {ui}=modules['ui-state.js'],cart=modules['ui-cart.js'],core=modules['ui-core.js'];
 const previous={...ui};
 try {
  assert.equal(cart.cartCopyBlocked(),true);
  Object.assign(ui,{refreshing:false,lastLoadedAt:1000000,registryReadFailed:false,cart:[],networkStatus:{level:'online',hold:false}});
  assert.equal(cart.cartCopyBlocked(),false);
  for(const item of [{validationError:'invalid'},{needsReview:true}]){ui.cart=[item];assert.equal(cart.cartCopyBlocked(),true);}
  ui.cart=[];ui.networkStatus.hold=true;assert.equal(cart.cartCopyBlocked(),true);
  assert.match(core.statusLabel('available'),/🟢/);assert.equal(core.statusLabel('custom'),'custom');
  ui.details={roles:{buyer:'fixture-public-id'}};assert.equal(core.person('fixture-public-id'),'Demo buyer');assert.match(core.person('other-public-identity'),/…$/);
  ui.demo=true;assert.equal(core.endpointBase(),'http://127.0.0.1:8787');ui.demo=false;ui.base='https://poadomains.grok.me';assert.equal(core.endpointBase(),ui.base);
 }finally{Object.assign(ui,previous);}
});
