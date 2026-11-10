import { autoScroll } from "./ui-motion.js?v=5c1f8083f451";
import { shapeLiveActions } from "./shared.js?v=5c1f8083f451";
import { actionLabel } from "./ui-copy.js?v=5c1f8083f451";
export function recentActions(state){const items=shapeLiveActions(state,Number.MAX_SAFE_INTEGER),seen=new Set(items.map(x=>x.id));for(const r of Object.values(state?.receipts??{})){const id="receipt:"+(r.intentId??r.sequence);if(!seen.has(id))items.push({id,name:r.result?.name??"",sequence:r.sequence??0,label:(r.result?.name?r.result.name+" · ":"")+"Registry action #"+r.sequence+" · "+r.status});}return items.sort((a,b)=>b.sequence-a.sequence);}
let signature="";
export function drawTicker(state){const strip=document.getElementById("liveTicker"),track=document.getElementById("liveTickerTrack"),items=recentActions(state),key=JSON.stringify(items);if(!strip||!track||key===signature||track.contains(document.activeElement))return;signature=key;track.replaceChildren();
 if(!items.length){const empty=document.createElement("span");empty.className="ticker-empty muted";empty.textContent="No recent registry actions";track.append(empty);return;}
 for(const item of items){const chip=document.createElement(item.name?"a":"span");chip.className="ticker-chip";chip.dataset.actionId=item.id;const label=String(item.label).replace(/settled/g,"recorded").replace(/ · live · /g," · registry auction · ");if(item.name){chip.href="/d/"+encodeURIComponent(item.name);const at=label.indexOf(item.name);chip.append(document.createTextNode(at<0?"":label.slice(0,at)));const name=document.createElement("span");name.className="domain-name";name.textContent=item.name;chip.append(name,document.createTextNode(at<0?" · "+label:label.slice(at+item.name.length)));}else chip.textContent=label;track.append(chip);}
 autoScroll(strip,{speed:18});
}
