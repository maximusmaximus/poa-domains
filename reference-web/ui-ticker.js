import { autoScroll, itemStep } from "./ui-motion.js?v=cb83c6d2a3e0";
import { isPoaAuctionAwaitingFirstBid, poaShort, shapeLiveActions } from "./shared.js?v=cb83c6d2a3e0";
export const MAX_RECENT_ACTIONS=100;
export const MAX_EXPLORE_ACTIONS=500;
const toMs=ts=>{const n=Number(ts);return!Number.isFinite(n)||n<=0?0:n<1e12?n*1000:n;};
const actionCategory=kind=>!kind?"other":/^escrow-|auction|offer/.test(kind)?"market":"domain";
function receiptActionLabel(r,name){
 const res=r?.result;
 if(r?.status==="succeeded"&&res&&typeof res==="object"){
  if(typeof res.primaryName==="string"&&res.primaryName)return`⭐ Main domain · ${res.primaryName}`;
  if(Object.prototype.hasOwnProperty.call(res,"primaryName")&&res.primaryName===null)return`Main domain cleared · #${r.sequence}`;
  if(res.metadataVersion!=null)return`🪪 Profile updated · #${r.sequence}`;
  if(res.recordsVersion!=null)return`🗂️ Records updated · #${r.sequence}`;
 }
 return(name?name+" · ":"")+"Registry action #"+r.sequence+" · "+r.status;
}
export function recentActions(state,escrowMarket=[],limit=MAX_RECENT_ACTIONS){
 const receiptById=new Map(),seqTime=new Map();
 for(const r of Object.values(state?.receipts??{})){const id="receipt:"+(r.intentId??r.sequence);receiptById.set(id,r);if(r?.sequence!=null&&Number(r.time)>0)seqTime.set(r.sequence,Number(r.time));}
 const shaped=shapeLiveActions(state,Number.MAX_SAFE_INTEGER),seen=new Set(),reg=[];
 for(const raw of shaped){
  seen.add(raw.id);const r=receiptById.get(raw.id);let item=raw;
  if(r?.status==="succeeded"&&typeof r.result?.primaryName==="string"&&r.result.primaryName)item={...raw,name:r.result.primaryName,label:`⭐ Main domain · ${r.result.primaryName}`};
  const rawAt=item.kind==="offer"||item.kind==="offer-active"||item.kind==="auction-upcoming"?(seqTime.get(item.sequence)??0):(item.at||seqTime.get(item.sequence)||0);
  const actor=r?.signer||r?.result?.owner||(r?.result?.deedId&&state?.deeds?.[r.result.deedId]?.owner)||"";
  reg.push({...item,actor,category:actionCategory(item.kind),atMs:toMs(rawAt)});
 }
 for(const[id,r]of receiptById){
  if(seen.has(id))continue;
  const name=r.result?.name??(typeof r.result?.primaryName==="string"?r.result.primaryName:"")??(r.result?.deedId&&state?.deeds?.[r.result.deedId]?.name)??"",at=r.time??0;
  const actor=r.signer||r.result?.owner||(r.result?.deedId&&state?.deeds?.[r.result.deedId]?.owner)||"";
  const cat=r.result&&(r.result.primaryName!==undefined||r.result.metadataVersion!=null||r.result.recordsVersion!=null||r.result.deedId)?"domain":"other";
  reg.push({id,name:name||"",sequence:r.sequence??0,at,actor,category:cat,atMs:toMs(at),label:receiptActionLabel(r,name||"")});
 }
 const esc=[];
 for(const a of Array.isArray(escrowMarket)?escrowMarket:[]){
  if(!a||!a.name)continue;
  if(a.kind==="fixed"){
   if(a.status==="COMPLETE"&&a.high){const t=Number(a.history?.at(-1)?.at||a.closes||a.createdAt||0);esc.push({id:`escrow-sold:${a.id}`,kind:"escrow-sold",name:a.name,sequence:0,at:t,actor:a.high.payer||a.seller||"",category:"market",atMs:toMs(t),label:`✅ Sold · ${a.name} · ${poaShort(a.high.amount)} POA`});}
   else if(a.status==="OPEN"){const t=Number(a.history?.find(h=>h&&h.at)?.at||a.createdAt||0);if(t>0)esc.push({id:`escrow-listed:${a.id}`,kind:"escrow-listed",name:a.name,sequence:0,at:t,actor:a.seller||"",category:"market",atMs:toMs(t),label:`🏷️ Listed · ${a.name} · ${poaShort(a.price)} POA`});}
   continue;
  }
  if(isPoaAuctionAwaitingFirstBid(a))continue;
  if(a.status==="OPEN"&&a.high){
   const sh=(a.history??[]).find(h=>h&&h.amount&&/first bid|started/i.test(String(h.event??"")))??(a.history??[]).find(h=>h&&h.amount),st=Number(a.startedAt||sh?.at||a.createdAt||0),sa=sh?.amount||a.high.amount,lh=[...(a.history??[])].reverse().find(h=>h&&h.amount),lt=Number(lh?.at||st);
   if(lh&&sa!==a.high.amount)esc.push({id:`escrow-bid:${a.id}:${a.high.amount}`,kind:"escrow-bid",name:a.name,sequence:0,at:lt,actor:a.high.payer||"",category:"market",atMs:toMs(lt),label:`🏷️ High bid · ${a.name} · ${poaShort(a.high.amount)} POA`});
   esc.push({id:`escrow-started:${a.id}`,kind:"escrow-auction-started",name:a.name,sequence:0,at:st,actor:sh?.payer||a.high.payer||a.seller||"",category:"market",atMs:toMs(st),label:`🔥 Auction started · ${a.name} · ${poaShort(sa)} POA`});
  }else if(a.status==="COMPLETE"&&a.high){const t=Number(a.history?.at(-1)?.at||a.closes||a.createdAt||0);esc.push({id:`escrow-complete:${a.id}`,kind:"escrow-auction-complete",name:a.name,sequence:0,at:t,actor:a.high.payer||"",category:"market",atMs:toMs(t),label:`✅ Auction won · ${a.name} · ${poaShort(a.high.amount)} POA`});}
 }
 const merged=[...esc,...reg].sort((a,b)=>(b.atMs-a.atMs)||((b.sequence??0)-(a.sequence??0))||String(b.id).localeCompare(String(a.id)));
 const cap=Number.isInteger(limit)&&limit>0?limit:MAX_RECENT_ACTIONS;
 return merged.slice(0,cap);
}
let signature="",topActionId="",scrollCount=0,openAllHandler=null;
const wiredStrips=new WeakSet();
export function drawTicker(state,escrowMarket=[],onOpenAll=null){
 const strip=document.getElementById("liveTicker"),track=document.getElementById("liveTickerTrack"),items=recentActions(state,escrowMarket),key=JSON.stringify(items),active=document.activeElement;
 if(onOpenAll)openAllHandler=onOpenAll;
 if(strip&&!wiredStrips.has(strip)){
  wiredStrips.add(strip);
  strip.addEventListener("click",e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();scrollCount=0;openAllHandler?.();});
  strip.addEventListener("keydown",e=>{if(e.target===strip&&(e.key==="Enter"||e.key===" ")){e.preventDefault();scrollCount=0;openAllHandler?.();}});
 }
 if(!strip||!track||key===signature||Boolean(active&&track?.contains(active)&&active.matches?.(":focus-visible")))return;
 const nextTopId=items[0]?.id??"",hasNewTop=Boolean(topActionId&&nextTopId&&nextTopId!==topActionId);
 signature=key;topActionId=nextTopId;track.replaceChildren();
 document.getElementById("recentActions").classList.toggle("is-empty",!items.length);
 if(!items.length){const e=document.createElement("span");e.className="ticker-empty muted";e.textContent="No recent registry actions";track.append(e);return;}
 for(const item of items){
  const chip=document.createElement(item.name?"a":"span");
  chip.className=item.kind?.startsWith("escrow-")?"ticker-chip ticker-chip-auction":"ticker-chip";
  chip.dataset.actionId=item.id;chip.draggable=false;
  const label=String(item.label).replace(/settled/g,"recorded").replace(/ · live · /g," · registry auction · ");
  if(item.name){
   chip.href="/d/"+encodeURIComponent(item.name);
   const sep=label.indexOf(" · "+item.name),at=sep>=0?sep+3:label.indexOf(item.name);
   chip.append(document.createTextNode(at<0?"":label.slice(0,at)));
   const name=document.createElement("span"),activeId=state?.names?.[item.name]?.activeId;
   name.className=activeId&&state?.deeds?.[activeId]&&!state.deeds[activeId].retired?"domain-name domain-tile-inline is-registered":"domain-name";
   name.textContent=item.name;
   chip.append(name,document.createTextNode(at<0?" · "+label:label.slice(at+item.name.length)));
  }else chip.textContent=label;
  track.append(chip);
 }
 const locked=n=>Boolean(n.contains(document.activeElement)&&document.activeElement?.matches?.(":focus-visible"));
 const fwd=(n,pos,steps=2)=>{if(locked(n))return pos;for(let i=0;i<steps;i++){const f=track.firstElementChild;if(!f?.classList.contains("ticker-chip")||track.children.length<2)break;const max=n.scrollWidth-n.clientWidth,w=itemStep(f,9);if(!(w>0)||max<w||pos<w)break;track.append(f);pos-=w;n.scrollLeft=pos;}return pos;};
 const bwd=(n,pos,steps=2)=>{if(locked(n))return pos;for(let i=0;i<steps;i++){const l=track.lastElementChild;if(!l?.classList.contains("ticker-chip")||track.children.length<2)break;const max=n.scrollWidth-n.clientWidth,w=itemStep(l,9),th=Math.min(48,Math.max(12,max-w-4));if(!(w>0)||max<w+4||pos>th)break;track.prepend(l);pos+=itemStep(l,9);n.scrollLeft=pos;}return pos;};
 const ctrl=autoScroll(strip,{
  speed:18,direction:1,
  advance(n,pos){pos=fwd(n,pos,2);const max=n.scrollWidth-n.clientWidth;return max>0&&pos>=max?0:pos;},
  onScroll(n,pos,dir){return dir>0?fwd(n,pos,6):dir<0?bwd(n,pos,6):pos;},
  onScrollSettle(n,pos){const max=n.scrollWidth-n.clientWidth;if(max<=4)return pos;if(max-pos<Math.max(240,n.clientWidth*0.5))return fwd(n,pos,6);if(pos<48)return bwd(n,pos,4);return pos;},
  onUserScroll(){scrollCount++;if(scrollCount>3){scrollCount=0;openAllHandler?.();}},
 });
 if(hasNewTop&&ctrl&&!(ctrl.interacting?ctrl.interacting():ctrl.paused()))ctrl.reset(0);
}
