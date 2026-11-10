import { profileEngine, SIGNER } from './ui-harness.mjs';
const state = () => ({ ...profileEngine().snapshot(), time: 1000000 });
export function auctionState() {
 const s=state(), id='a'.repeat(64);
 s.names.alpha={name:'alpha',activeId:null,auctionId:id,generation:0};
 s.auctions[id]={id,name:'alpha',seller:'ed25519:'+'2'.repeat(64),status:'live',version:1,asset:'POA',reserve:'1000',openAt:s.time-100,window:3600,quiet:3600,high:{amount:'1000',payer:SIGNER,beneficiary:SIGNER,at:s.time-1}};
 return s;
}
export function offerState() {
 const s=state(), id='b'.repeat(64), deed='d'.repeat(64);
 s.names.alpha={name:'alpha',activeId:deed,auctionId:null,generation:1};
 s.deeds[deed]={id:deed,name:'alpha',owner:SIGNER,version:1,ownerVersion:1,generation:1,parentId:null,retired:false,rights:{kind:'permanent'},records:[],metadata:[{cid:'fixture-cid'}]};
 s.offers[id]={id,kind:'resale',parentId:deed,owner:SIGNER,version:1,price:'1000',asset:'POA',uses:0,maxUses:1,validUntil:s.time+86400,cancelled:false};
 return s;
}
