import test from 'node:test';
import assert from 'node:assert/strict';
import { profileEngine, SIGNER } from './fixtures/ui-harness.mjs';
import { capabilities } from '../dist/src/interface.js';
import { updatedAge, readViewQuery, viewPath, nameErrorReason, cartReview, recheckCartItem, acknowledgeCartItem, editCartAmount, registryViewState } from '../reference-web/shared.js';
import { auctionState, offerState } from './fixtures/ui-state.mjs';
const cap = capabilities(profileEngine());
const state = () => profileEngine().snapshot();
const root = () => ({name:'alpha',tier:'standard',isRoot:true,action:'announceAuction+bid',asset:'POA',amount:'250',minimumAmount:'100',params:{name:'alpha',asset:'POA',reserve:'100',maxBid:'250',expectedVersion:0,expectedDeedId:null}});
const bid = () => ({...root(),action:'bid',amount:'2000',minimumAmount:'1101',params:{auctionId:'a'.repeat(64),expectedVersion:1,asset:'POA',amount:'2000'}});
const purchase = () => ({...root(),action:'buyFixed',amount:'1000',params:{offerId:'b'.repeat(64),expectedVersion:1,asset:'POA',amount:'1000'}});
test('data age uses minutes/hours, including initial state and clock skew, never seconds',()=>{
 assert.equal(updatedAge(null),'not loaded yet'); assert.equal(updatedAge(0,59999),'updated 0m ago'); assert.equal(updatedAge(0,120000),'updated 2m ago');
 assert.equal(updatedAge(0,4500000),'updated 1h 15m ago'); assert.equal(updatedAge(200,0),'updated 0m ago');
});
test('shareable queries and tabs are bounded, encoded and whitelisted',()=>{
 for(const tab of ['find','auctions','market','explore','escrow','handoff']) assert.deepEqual(readViewQuery(viewPath('/', '🚀 a',tab).split('?')[1]),{query:'🚀 a',tab});
 assert.deepEqual(readViewQuery('?q=alpha&tab=not-real'),{query:'alpha',tab:'find'}); assert.equal(readViewQuery('?q='+ 'a'.repeat(3000)).query.length,2048);
 assert.equal(viewPath('/d/alpha','','nope'),'/d/alpha');
});
test('invalid names explain the supported shape and characters in simple English',()=>{
 for(const message of ['Only roots and direct children','Unsupported name','Too long','Empty label','other']) assert.match(nameErrorReason(Error(message)),/⚠️ Invalid name\./);
 assert.match(nameErrorReason(Error('Unsupported name')),/Spaces, hyphens/);
});
test('cart review stays sticky across reload and explicit acknowledgement never raises a cap',()=>{
 const s=auctionState(); let item=recheckCartItem(bid(),cap,s); assert.equal(item.needsReview,false);
 s.auctions[item.params.auctionId].version=2; s.auctions[item.params.auctionId].high.amount='1500';
 item=recheckCartItem(item,cap,s); assert.equal(item.needsReview,true); assert.equal(item.amount,'2000'); assert.equal(item.params.expectedVersion,1);
 item=recheckCartItem(JSON.parse(JSON.stringify(item)),cap,s); assert.equal(item.needsReview,true);
 item=acknowledgeCartItem(item,cap,s); assert.equal(item.needsReview,false); assert.equal(item.params.expectedVersion,2); assert.equal(item.minimumAmount,'1651'); assert.equal(item.amount,'2000');
 s.auctions[item.params.auctionId].version=3; s.auctions[item.params.auctionId].high.amount='3000';
 item=recheckCartItem(item,cap,s); assert.throws(()=>acknowledgeCartItem(item,cap,s),/cap was not raised/); assert.equal(item.amount,'2000');
 item=editCartAmount(item,'4000',cap,s); assert.equal(item.needsReview,true); item=acknowledgeCartItem(item,cap,s); assert.equal(item.params.expectedVersion,3); assert.equal(item.amount,'4000');
 for(const change of [a=>a.status='ended',a=>a.openAt=s.time+10,a=>a.asset='OTHER',a=>a.high.at=s.time-10000]) {
  const next=structuredClone(s); change(next.auctions['a'.repeat(64)]); if(next.auctions['a'.repeat(64)].high.at===s.time-10000) next.time+=10000;
  assert.equal(cartReview(item,cap,next).canAcknowledge,false);
 }
 assert.equal(cartReview(item,cap,state()).canAcknowledge,false);
});
test('owned roots, missing/changed offers and child generation changes require review without auto spending',()=>{
 const s=state(); let item=recheckCartItem(root(),cap,s); assert.equal(item.needsReview,false);
 s.names.alpha={activeId:'deed'}; assert.equal(cartReview(item,cap,s).canAcknowledge,false);
 assert.equal(cartReview({...root(),action:'unknown'},cap,state()).canAcknowledge,false); assert.equal(cartReview(root(),cap,null).canAcknowledge,false);
 const o=offerState(); item=recheckCartItem(purchase(),cap,o); assert.equal(item.needsReview,false);
 o.offers['b'.repeat(64)].version=2; item=recheckCartItem(item,cap,o); assert.equal(item.needsReview,true); item=acknowledgeCartItem(item,cap,o); assert.equal(item.params.expectedVersion,2);
 o.offers['b'.repeat(64)].price='2000'; assert.equal(cartReview(item,cap,o).canAcknowledge,false); assert.equal(item.amount,'1000');
 delete o.offers['b'.repeat(64)]; assert.equal(cartReview(item,cap,o).canAcknowledge,false);
 const c=offerState(), offer=c.offers['b'.repeat(64)]; offer.kind='child'; offer.labels=['shop'];
 const child={...purchase(),name:'shop.alpha',action:'fillChildOffer',params:{...purchase().params,label:'shop',expectedGeneration:1}};
 c.names['shop.alpha']={activeId:null,generation:1}; const review=cartReview(child,cap,c); assert.equal(review.params.expectedGeneration,2); assert.ok(review.issues.length);
 assert.equal(acknowledgeCartItem(child,cap,c).params.expectedGeneration,2); offer.labels=['other']; assert.equal(cartReview(child,cap,c).canAcknowledge,false);
});

test('poll uses authoritative observed time for expiry without changing the hashed snapshot',()=>{
 const payload={state:auctionState(),observedServerTime:2000000}; const before=JSON.stringify(payload.state), view=registryViewState(payload);
 assert.equal(view.time,2000000); assert.equal(JSON.stringify(payload.state),before); assert.equal(cartReview(bid(),cap,view).canAcknowledge,false);
 assert.throws(()=>registryViewState({...payload,observedServerTime:-1})); assert.throws(()=>registryViewState({state:{}}));
 assert.equal(registryViewState({state:state()}).time,0);
});
