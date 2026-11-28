import { autoScroll, itemStep } from "./ui-motion.js?v=718d654ae15a";
import { isPoaAuctionAwaitingFirstBid, poaShort, primaryNameForOwner, shapeLiveActions } from "./shared.js?v=718d654ae15a";
export const MAX_RECENT_ACTIONS=100;
export const MAX_EXPLORE_ACTIONS=500;
const toMs=ts=>{const n=Number(ts);return!Number.isFinite(n)||n<=0?0:n<1e12?n*1000:n;};
const actionCategory=kind=>!kind?"other":/^escrow-|auction|offer/.test(kind)?"market":"domain";
function receiptActionLabel(r,name){
 const res=r?.result;
 if(r?.status==="succeeded"&&res&&typeof res==="object"){
  if(typeof res.primaryName==="string"&&res.primaryName)return`⭐ Main domain · ${res.primaryName}`;
  if(Object.prototype.hasOwnProperty.call(res,"primaryName")&&res.primaryName===null)return name?`⭐ Main domain cleared · ${name}`:`Main domain cleared · #${r.sequence}`;
  if(res.metadataVersion!=null)return name?`🪪 Profile updated · ${name}`:`🪪 Profile updated · #${r.sequence}`;
  if(res.recordsVersion!=null)return name?`🗂️ Records updated · ${name}`:`🗂️ Records updated · #${r.sequence}`;
 }
 return(name?name+" · ":"")+"Registry action #"+r.sequence+" · "+r.status;
}
export function receiptDisplay(r,state,fb="",h=null){
 const res=r?.result,req=String(r?.requestId||""),hName=h?.name||fb||"";
 if(r?.status==="succeeded"&&res&&typeof res==="object"){
  if(typeof res.primaryName==="string"&&res.primaryName)return{icon:"⭐",verb:"Main domain",name:res.primaryName,actor:res.signer||r.signer||"",recipient:"",detail:h?.replacedPrimary?`Replaced ${h.replacedPrimary}`:""};
  if(Object.prototype.hasOwnProperty.call(res,"primaryName")&&res.primaryName===null)return{icon:"⭐",verb:"Main domain cleared",name:hName,actor:r.signer||"",recipient:"",detail:""};
  if(res.metadataVersion!=null){const fields=Array.isArray(h?.profileFields)&&h.profileFields.length?h.profileFields.join(", "):"";return{icon:"🪪",verb:"Profile updated",name:hName,actor:r.signer||"",recipient:"",detail:fields?`Updated ${fields} (v${res.metadataVersion})`:`v${res.metadataVersion}`};}
  if(res.recordsVersion!=null){const cnt=typeof h?.recordsCount==="number"?h.recordsCount:null;return{icon:"🗂️",verb:"Records updated",name:hName,actor:r.signer||"",recipient:"",detail:cnt===0?`Cleared (v${res.recordsVersion})`:cnt!==null?`${cnt} ${cnt===1?"record":"records"} (v${res.recordsVersion})`:`v${res.recordsVersion}`};}
  if(res.offerId)return{icon:"🤝",verb:"Offer published",name:hName,actor:r.signer||"",recipient:"",detail:""};
  if(res.deedId){
   const d=state?.deeds?.[res.deedId],name=res.name??d?.name??hName??"",owner=res.owner||d?.owner||"";
   if(req.startsWith("treasury-inventory-"))return{icon:"🏛️",verb:"Treasury minted",name,actor:owner||r.signer||"",recipient:"",detail:""};
   if(req.startsWith("protocol-domain-"))return{icon:"🏛️",verb:"Protocol minted",name,actor:owner||r.signer||"",recipient:"",detail:""};
   const from=h?.action==="escrowSettle"?(h.actor||res.seller||r.signer||""):(res.seller||r.signer||"");
   if(from&&owner&&from!==owner)return{icon:"🤝",verb:/^(?:treasury-(?:settle|repair)-|escrow-settle-)/.test(req)||res.seller||h?.action==="escrowSettle"?"Handover":"Transferred",name,actor:from,recipient:owner,detail:""};
   if(res.name&&(d?.parentId||String(res.name).includes(".")))return{icon:"🌱",verb:"Child purchase",name,actor:owner||r.signer||"",recipient:"",detail:""};
   return{icon:"🎉",verb:"Registered",name,actor:owner||r.signer||"",recipient:"",detail:""};
  }
  if(res.auctionId)return{icon:"🔨",verb:"Auction announced",name:hName,actor:r.signer||"",recipient:"",detail:""};
 }
 return{icon:r?.status==="rejected"?"⚠️":"🧾",verb:r?.status==="rejected"?"Rejected":"Registry action",name:hName,actor:r?.signer||"",recipient:"",detail:""};
}
export function recentActions(state,escrowMarket=[],limit=MAX_RECENT_ACTIONS,history=[]){
 const receiptById=new Map(),seqTime=new Map(),histBySeq=new Map();
 for(const h of Array.isArray(history)?history:[]){if(h&&h.sequence>0)histBySeq.set(h.sequence,h);}
 for(const r of Object.values(state?.receipts??{})){const id="receipt:"+(r.intentId??r.sequence);receiptById.set(id,r);if(r?.sequence!=null&&Number(r.time)>0)seqTime.set(r.sequence,Number(r.time));}
 const shaped=shapeLiveActions(state,Number.MAX_SAFE_INTEGER),seen=new Set(),reg=[];
 for(const raw of shaped){
  seen.add(raw.id);const r=receiptById.get(raw.id),h=r?.sequence?histBySeq.get(r.sequence):null;let item=raw;
  if(r?.status==="succeeded"&&typeof r.result?.primaryName==="string"&&r.result.primaryName)item={...raw,name:r.result.primaryName,label:`⭐ Main domain · ${r.result.primaryName}`};
  const rawAt=item.kind==="offer"||item.kind==="offer-active"||item.kind==="auction-upcoming"?(seqTime.get(item.sequence)??0):(item.at||seqTime.get(item.sequence)||0);
  const m=r?receiptDisplay(r,state,item.name||"",h):(item.kind==="bid"?{icon:"🏷️",verb:"Bid"}:item.kind?.startsWith("auction")?{icon:"🔨",verb:item.kind==="auction-final"?"Auction closed":item.kind==="auction-upcoming"?"Auction scheduled":"Auction live"}:item.kind?.startsWith("offer")?{icon:"🤝",verb:"Offer"}:{icon:"🧾",verb:"Activity"});
  const actor=m.actor||r?.signer||r?.result?.owner||(r?.result?.deedId&&state?.deeds?.[r.result.deedId]?.owner)||"";
  reg.push({...item,name:m.name||item.name||"",icon:m.icon,verb:m.verb,amount:"",recipient:m.recipient||"",actor,category:actionCategory(item.kind),atMs:toMs(rawAt)});
 }
 for(const[id,r]of receiptById){
  if(seen.has(id))continue;
  const h=r?.sequence?histBySeq.get(r.sequence):null;
  const fb=h?.name??r.result?.name??(typeof r.result?.primaryName==="string"?r.result.primaryName:"")??(r.result?.deedId&&state?.deeds?.[r.result.deedId]?.name)??"",at=r.time??0,m=receiptDisplay(r,state,fb||"",h);
  const cat=r.result&&(r.result.primaryName!==undefined||r.result.metadataVersion!=null||r.result.recordsVersion!=null||r.result.deedId)?"domain":"other";
  reg.push({id,name:m.name||"",sequence:r.sequence??0,at,icon:m.icon,verb:m.verb,amount:"",recipient:m.recipient||"",actor:m.actor||"",category:cat,atMs:toMs(at),label:receiptActionLabel(r,m.name||"")});
 }
 const esc=[],mk=(id,kind,name,at,icon,verb,rawAmt,actor)=>{const amt=`${poaShort(rawAmt)} POA`;esc.push({id,kind,name,sequence:0,at,icon,verb,amount:amt,recipient:"",actor:actor||"",category:"market",atMs:toMs(at),label:`${icon} ${verb} · ${name} · ${amt}`});};
 for(const a of Array.isArray(escrowMarket)?escrowMarket:[]){
  if(!a||!a.name)continue;
  if(a.kind==="fixed"){
   if(a.status==="COMPLETE"&&a.high)mk(`escrow-sold:${a.id}`,"escrow-sold",a.name,Number(a.history?.at(-1)?.at||a.closes||a.createdAt||0),"✅","Sold",a.high.amount,a.high.payer||a.seller);
   else if(a.status==="OPEN"){const t=Number(a.history?.find(h=>h&&h.at)?.at||a.createdAt||0);if(t>0)mk(`escrow-listed:${a.id}`,"escrow-listed",a.name,t,"🏷️","Listed",a.price,a.seller);}
   continue;
  }
  if(isPoaAuctionAwaitingFirstBid(a))continue;
  if(a.status==="OPEN"&&a.high){
   const sh=(a.history??[]).find(h=>h&&h.amount&&/first bid|started/i.test(String(h.event??"")))??(a.history??[]).find(h=>h&&h.amount),st=Number(a.startedAt||sh?.at||a.createdAt||0),sa=sh?.amount||a.high.amount,lh=[...(a.history??[])].reverse().find(h=>h&&h.amount),lt=Number(lh?.at||st);
   if(lh&&sa!==a.high.amount)mk(`escrow-bid:${a.id}:${a.high.amount}`,"escrow-bid",a.name,lt,"🏷️","High bid",a.high.amount,a.high.payer);
   mk(`escrow-started:${a.id}`,"escrow-auction-started",a.name,st,"🔥","Auction started",sa,sh?.payer||a.high.payer||a.seller);
  }else if(a.status==="COMPLETE"&&a.high)mk(`escrow-complete:${a.id}`,"escrow-auction-complete",a.name,Number(a.history?.at(-1)?.at||a.closes||a.createdAt||0),"✅","Auction won",a.high.amount,a.high.payer);
 }
 const merged=[...esc,...reg].sort((a,b)=>(b.atMs-a.atMs)||((b.sequence??0)-(a.sequence??0))||String(b.id).localeCompare(String(a.id)));
 const cap=Number.isInteger(limit)&&limit>0?limit:MAX_RECENT_ACTIONS;
 return merged.slice(0,cap);
}
let signature="",topActionId="",scrollCount=0,openAllHandler=null,targetHandler=null;
const wiredStrips=new WeakSet();
export function drawTicker(state,escrowMarket=[],onOpenAll=null,onSelectTarget=null,history=[]){
 const strip=document.getElementById("liveTicker"),track=document.getElementById("liveTickerTrack"),items=recentActions(state,escrowMarket,MAX_RECENT_ACTIONS,history),key=JSON.stringify(items),active=document.activeElement;
 if(onOpenAll)openAllHandler=onOpenAll;
 if(onSelectTarget)targetHandler=onSelectTarget;
 if(strip&&!wiredStrips.has(strip)){
  wiredStrips.add(strip);
  strip.addEventListener("click",e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const chip=e.target?.closest?.(".ticker-chip[data-target-kind]");e.preventDefault();scrollCount=0;if(chip&&targetHandler){targetHandler({kind:chip.dataset.targetKind,value:chip.dataset.targetValue});return;}openAllHandler?.();});
  strip.addEventListener("keydown",e=>{if(e.target===strip&&(e.key==="Enter"||e.key===" ")){e.preventDefault();scrollCount=0;openAllHandler?.();}});
 }
 if(!strip||!track||key===signature||Boolean(active&&track?.contains(active)&&active.matches?.(":focus-visible")))return;
 const nextTopId=items[0]?.id??"",hasNewTop=Boolean(topActionId&&nextTopId&&nextTopId!==topActionId);
 signature=key;topActionId=nextTopId;track.replaceChildren();
 document.getElementById("recentActions").classList.toggle("is-empty",!items.length);
 if(!items.length){const e=document.createElement("span");e.className="ticker-empty muted";e.textContent="No recent registry actions";track.append(e);return;}
 for(const item of items){
  const targetOwner=!item.name?(item.actor||item.recipient||""):"";
  const chip=document.createElement(item.name||targetOwner?"a":"span");
  chip.className=item.kind?.startsWith("escrow-")?"ticker-chip ticker-chip-auction":"ticker-chip";
  chip.dataset.actionId=item.id;chip.draggable=false;
  const label=String(item.label).replace(/settled/g,"recorded").replace(/ · live · /g," · registry auction · ");
  if(item.name){
   chip.href="/d/"+encodeURIComponent(item.name);
   chip.dataset.targetKind="domain";chip.dataset.targetValue=item.name;
   const sep=label.indexOf(" · "+item.name),at=sep>=0?sep+3:label.indexOf(item.name);
   chip.append(document.createTextNode(at<0?"":label.slice(0,at)));
   const name=document.createElement("span"),activeId=state?.names?.[item.name]?.activeId;
   name.className=activeId&&state?.deeds?.[activeId]&&!state.deeds[activeId].retired?"domain-name domain-tile-inline is-registered":"domain-name";
   name.textContent=item.name;
   chip.append(name,document.createTextNode(at<0?" · "+label:label.slice(at+item.name.length)));
  }else if(targetOwner){
   const slug=primaryNameForOwner(state,targetOwner)||targetOwner;
   chip.href="/p/"+encodeURIComponent(slug);
   chip.dataset.targetKind="owner";chip.dataset.targetValue=slug;
   chip.textContent=label;
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
