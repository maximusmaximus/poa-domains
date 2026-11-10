/** Read-only plans and bounded views. These never submit, reserve a nonce or sign. */
import { Engine } from "./engine.js";
import { ACTIONS } from "./actions.js";
import { principal } from "./auth.js";
import { amount, hash, need } from "./core.js";
import { minimumNext } from "./config.js";
import { normalizeName } from "./names.js";
import { buildMetadataWitness } from "./interface.js";
import { Auction, Offer, canManage } from "./model.js";

export function readContext(e: Engine) {
  const state=e.snapshot();
  return { observedServerTime:e.observedTime(), registryTime:state.time,
    sequence:state.sequence, stateHash:e.stateHash(), finality:"registry-committed" };
}
export function resourceId(value: string | undefined): string {
  need(typeof value==="string" && /^[a-f0-9]{64}$/.test(value),"RESOURCE_ID"); return value;
}
export function readName(e: Engine, raw: string) {
  let decoded:string; try { decoded=decodeURIComponent(raw); } catch { need(false,"NAME"); }
  const name=normalizeName(decoded!,e.normalizationMode).canonical,s=e.snapshot(),entry=s.names[name];
  need(entry,"NOT_FOUND");
  return {name,entry,deed:entry.activeId?s.deeds[entry.activeId]:null,
    auction:entry.auctionId?s.auctions[entry.auctionId]:null,ownershipConflict:e.ownershipConflict(name),...readContext(e)};
}
export function readAuction(e: Engine, raw: string) {
  const auction=e.snapshot().auctions[resourceId(raw)]; need(auction,"RESOURCE_NOT_FOUND");
  return {auction,closeEligible:e.closeEligible(auction),...readContext(e)};
}
export function readOffer(e: Engine, raw: string) {
  const s=e.snapshot(),offer=s.offers[resourceId(raw)]; need(offer,"RESOURCE_NOT_FOUND");
  return {offer,parentDeed:s.deeds[offer.parentId],...readContext(e)};
}
/** Cursors bind collection, sequence AND hash; no duplicates across concurrent writes. */
export function readPage(e: Engine, kind:"auctions"|"offers", q:Record<string,string>) {
  need(Object.keys(q).every(k=>k==="limit"||k==="cursor"),"QUERY_NOT_ALLOWED");
  const limitText=q.limit??"50";
  need(/^[1-9][0-9]{0,2}$/.test(limitText)&&Number(limitText)<=100,"PAGE_LIMIT");
  const limit=Number(limitText),s=e.snapshot(),stateHash=e.stateHash();
  const values=Object.values(s[kind]).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  let start=0;
  if(q.cursor!==undefined) {
    const parts=q.cursor.split(":");
    need(parts.length===5&&parts[0]==="v1"&&parts[1]===kind&&/^(0|[1-9][0-9]*)$/.test(parts[2]!)&&/^[a-f0-9]{64}$/.test(parts[3]!)&&/^[a-f0-9]{64}$/.test(parts[4]!),"PAGE_CURSOR");
    need(parts[2]===String(s.sequence)&&parts[3]===stateHash,"STALE_CURSOR");
    const at=values.findIndex(x=>x.id===parts[4]); need(at>=0,"PAGE_CURSOR"); start=at+1;
  }
  const items=values.slice(start,start+limit);
  const nextCursor=start+limit<values.length?`v1:${kind}:${s.sequence}:${stateHash}:${items.at(-1)!.id}`:null;
  return {items,nextCursor,limit,...readContext(e)};
}

export function quote(e: Engine, q:Record<string,string>) {
  need(Object.keys(q).every(k=>["name","action","signer","asset","auctionId","offerId"].includes(k)),"QUERY_NOT_ALLOWED");
  const normalized=normalizeName(q.name,e.normalizationMode),name=normalized.canonical,action=q.action;
  need(typeof action==="string"&&Object.hasOwn(ACTIONS,action),"UNSUPPORTED_ACTION");
  need(!e.admission.permanentOnly||!["renewLease","expireLease"].includes(action),"PERMANENT_OWNERSHIP_ONLY");
  const signer=q.signer===undefined?null:principal(q.signer),s=e.snapshot(),now=e.observedTime();
  const entry=s.names[name],deed=entry?.activeId?s.deeds[entry.activeId]:null;
  const conflict=e.ownershipConflict(name),requiredInputs:string[]=[];
  const required=(key:string)=>{requiredInputs.push(key);return null;};
  if(conflict&&["announceAuction","fillChildOffer"].includes(action)) return {
    name,action,asset:q.asset??"POA",available:false,ownershipConflict:conflict,
    owner:null,reserve:null,minimumNextBid:null,price:null,fee:null,feeBps:e.config.feeBps,
    feeIncludedInPrice:true,feeChargedNow:false,requiredMaxTotal:null,expectedVersion:null,
    params:null,requiredInputs,blockedBy:"OWNERSHIP_CLASS_TAKEN",requiresSignedPreview:true,...readContext(e)};

  let asset=q.asset??"POA",price:string|null=null,reserve:string|null=null,minimumNextBid:string|null=null;
  let requiredMaxTotal:string|null="0",feeBase="0",feeChargedNow=false;
  let expectedVersion:number|null=null,params:Record<string,any>={};
  const activeDeed=()=>{need(deed&&!deed.retired,"DEED_NOT_FOUND");return deed;};
  const identity=()=>{const d=activeDeed();expectedVersion=d.version;return {name,expectedDeedId:d.id,expectedVersion:d.version};};
  const auction=():Auction=>{
    const a=s.auctions[q.auctionId===undefined?entry?.auctionId??"":resourceId(q.auctionId)];
    need(a&&a.name===name,"AUCTION_NOT_FOUND"); need(a.status==="live"||action==="withdrawRefund","AUCTION_CLOSED");
    asset=a.asset;expectedVersion=a.version;return a;
  };
  const offer=():Offer=>{
    let candidates=Object.values(s.offers).filter(o=>{
      const d=s.deeds[o.parentId]; if(!d)return false;
      const matches=action==="fillChildOffer"?o.kind==="child"&&name.includes(".")&&name.slice(name.indexOf(".")+1)===d.name:d.name===name;
      return matches && (action!=="buyFixed"||o.kind==="resale");
    });
    if(q.offerId!==undefined)candidates=candidates.filter(o=>o.id===resourceId(q.offerId));
    else candidates=candidates.filter(o=>!o.cancelled&&o.uses<o.maxUses&&now<o.validUntil);
    need(candidates.length>0,"OFFER_NOT_FOUND");need(candidates.length===1,"QUOTE_AMBIGUOUS");
    const o=candidates[0]!;need(!o.cancelled&&o.uses<o.maxUses,"OFFER_CLOSED");
    if(action!=="cancelOffer") {
      need(now<o.validUntil,"OFFER_EXPIRED");const d=s.deeds[o.parentId]!;
      need(s.names[d.name]?.activeId===d.id&&d.owner===o.owner&&d.ownerVersion===o.ownerVersion&&d.encumbranceVersion===o.encumbranceVersion&&(o.kind==="child"||d.version===o.deedVersion),"STALE_OFFER");
      need(canManage(d,now),"LEASE_INACTIVE");need(!d.lock,"TITLE_LOCKED");
    }
    asset=o.asset;expectedVersion=o.version;return o;
  };
  switch(action) {
    case "announceAuction": {
      need(!name.includes("."),"ROOT_ONLY");need(!conflict,"OWNERSHIP_CLASS_TAKEN");
      need(!e.config.reserved.includes(name),"RESERVED_NAME");need(!entry?.auctionId,"NAME_RESERVED");
      const policy=e.config.assets[asset];need(policy,"ASSET");
      if(deed) {params=identity();reserve=required("reserve");}
      else {expectedVersion=0;reserve=normalized.tier==="premium"?policy.premiumReserve:policy.standardReserve;params={name,expectedDeedId:null,expectedVersion:0};}
      params={...params,asset,reserve,openAt:0,metadata:deed?deed.metadata.at(-1):buildMetadataWitness(name)};
      break;
    }
    case "bid": {
      const a=auction();reserve=a.reserve;minimumNextBid=a.high?minimumNext(amount(a.high.amount),e.config.increment).toString():a.reserve;
      requiredMaxTotal=minimumNextBid;feeBase=minimumNextBid;
      params={auctionId:a.id,expectedVersion:a.version,asset,amount:minimumNextBid,beneficiary:signer??required("beneficiary")};break;
    }
    case "finalize": case "closeNoBid": case "cancelAuction": {
      const a=auction();params={auctionId:a.id,expectedVersion:a.version};
      if(action==="finalize") {feeBase=a.high?.amount??"0";feeChargedNow=true;}break;
    }
    case "withdrawRefund": {
      const a=auction();const c=signer?s.credits[hash("refund-key/v1",[a.id,asset,signer])]:undefined;
      need(c&&amount(c.amount)>0n,"NO_REFUND");expectedVersion=c.version;
      params={auctionId:a.id,asset,expectedVersion:c.version,amount:c.amount};break;
    }
    case "createChildOffer": {
      const d=activeDeed();need(!d.parentId,"ROOT_ONLY");expectedVersion=d.ownerVersion;
      params={parent:name,parentDeedId:d.id,expectedOwnerVersion:d.ownerVersion,asset,price:required("price"),validUntil:required("validUntil"),rights:{kind:"permanent"},labels:required("labels"),maxUses:required("maxUses")};break;
    }
    case "fillChildOffer": {
      const o=offer(),label=name.split(".")[0]!;need(!deed&&!entry?.auctionId,"NAME_TAKEN");need(!conflict,"OWNERSHIP_CLASS_TAKEN");
      need(!o.labels||o.labels.includes(label),"LABEL_NOT_OFFERED");
      need(!e.admission.permanentOnly||o.rights?.kind==="permanent","PERMANENT_OWNERSHIP_ONLY");
      price=o.price;requiredMaxTotal=price;feeBase=price;feeChargedNow=true;
      params={offerId:o.id,expectedVersion:o.version,expectedGeneration:(entry?.generation??0)+1,label,asset,amount:price,metadata:buildMetadataWitness(name,o.rights!,o.parentId)};break;
    }
    case "buyFixed": {
      const o=offer();price=o.price;requiredMaxTotal=price;feeBase=price;feeChargedNow=true;
      params={offerId:o.id,expectedVersion:o.version,asset,amount:price};break;
    }
    case "cancelOffer": {const o=offer();params={offerId:o.id,expectedVersion:o.version};break;}
    case "sellFixed":params={...identity(),asset:"POA",price:required("price"),validUntil:required("validUntil")};asset="POA";break;
    case "transfer":params={...identity(),recipient:required("recipient")};break;
    case "setRecords":params={...identity(),records:required("records")};break;
    case "setMetadata":params={...identity(),metadata:required("metadata")};break;
    case "revokeChild": {
      params=identity();need(deed!.parentId,"NOT_CHILD_HOLDER");params.parentOwnerVersion=s.deeds[deed!.parentId]!.ownerVersion;break;
    }
    // Only legacy replay/test engines admit lease actions. Production remains permanent-only.
    case "renewLease": {
      params=identity();need(deed!.rights.kind==="lease","PERMANENT_DEED");const r=deed!.rights;asset=r.settlementAsset;
      const fixed=r.renewal.kind==="guaranteed"?r.renewal:null;
      price=fixed?.price??null;requiredMaxTotal=price;feeBase=price??"0";feeChargedNow=true;
      params={...params,asset,amount:price??required("amount"),termSeconds:fixed?.termSeconds??required("termSeconds")};break;
    }
    case "expireLease":params=identity();break;
  }
  need(e.config.assets[asset],"ASSET");
  need(q.asset===undefined||q.asset===asset,"ASSET");
  const fee=requiredMaxTotal===null?null:(amount(feeBase)*BigInt(e.config.feeBps)/10000n).toString();
  return {name,action,asset,available:!deed&&!entry?.auctionId&&!conflict&&!e.config.reserved.includes(name),
    ownershipConflict:conflict,owner:deed?.owner??null,reserve,minimumNextBid,price,fee,
    feeBps:e.config.feeBps,feeIncludedInPrice:true,feeChargedNow,requiredMaxTotal,expectedVersion,params,requiredInputs,blockedBy:null,
    // A quote is a plan, not permission: balance, signatures, time and co-signers still need preview.
    requiresSignedPreview:true,...readContext(e)};
}
