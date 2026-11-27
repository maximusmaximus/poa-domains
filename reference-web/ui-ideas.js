import { publicNameUnavailable, inspectName } from "./shared.js?v=df469fa578f4";
import { ui } from "./ui-state.js?v=df469fa578f4";
import { createIdeaGenerator } from "./ideas-generator.js?v=df469fa578f4";
import { autoScroll, itemStep } from "./ui-motion.js?v=df469fa578f4";
import { add, el, variantOwner } from "./ui-core.js?v=df469fa578f4";
import { runSearch } from "./ui-search.js?v=df469fa578f4";
import { logSubmittedSearch } from "./ui-search-log.js?v=df469fa578f4";
export function ideaAccepted(q){
 if(!ui.cap||!ui.latestState)return false;
 try{const n=inspectName(q,ui.cap.emojiManifest),entry=ui.latestState.names?.[n.canonical];return !publicNameUnavailable(n.canonical,ui.cap)&&n.isRoot&&!ui.reservedSet.has(n.canonical)&&!variantOwner(n.canonical)&&!entry?.activeId&&!entry?.auctionId&&!ui.cart.some(x=>x.name===n.canonical)&&!Object.values(ui.latestState.auctions??{}).some(a=>a.name===n.canonical&&a.status==="live");}catch{return false;}
}
let generator,context="",timer;
export function updateIdeaContext(){clearTimeout(timer);timer=setTimeout(()=>renderIdeas(true),200);}
function idea(line,lane){const q=generator.next(lane);if(!q)return false;const link=add(line,"a",q,"idea domain-name");link.href="/d/"+encodeURIComponent(q);link.draggable=false;link.dataset.query=q;link.dataset.lane=lane;link.setAttribute("aria-label",q+" — "+({words:"word idea",double:"two-emoji idea",single:"single-emoji idea"}[lane]));link.addEventListener("click",e=>{e.preventDefault();pickIdea(link,q);if(e.detail)link.blur();});return true;}
export function renderIdeas(force=false){const strip=el("ideasStrip");if(!strip||!ui.cap||!ui.latestState)return;
 const query=el("searchInput").value.trim();if(!force&&strip.children.length&&context===query)return;context=query;
 generator=createIdeaGenerator({query,manifest:ui.cap.emojiManifest,accept:ideaAccepted});strip.replaceChildren();
 const row=add(strip,"div","","ideas-row ideas-masonry");row.setAttribute("role","group");row.setAttribute("aria-label","Scrolling word and emoji ideas");row.tabIndex=0;let columnNumber=0;
 const makeCol=()=>{const col=document.createElement("div");col.className="idea-column idea-offset-"+(columnNumber%4);const lanes=["words","double","single"];for(let i=0;i<3;i++)idea(col,lanes[(i+columnNumber)%3]);columnNumber++;return col.children.length?col:null;};
 for(let i=0;i<12;i++){const c=makeCol();if(!c)break;row.append(c);}
 if(!row.children.length)add(row,"span","No matching available ideas in the current registry view.","muted");
 const locked=n=>Boolean(n.contains(document.activeElement)&&document.activeElement?.matches?.(":focus-visible"));
 const recL=(n,pos,steps=1)=>{if(locked(n))return pos;for(let s=0;s<steps;s++){const f=n.firstElementChild,l=n.lastElementChild;if(!f?.classList.contains("idea-column")||f===l)break;const max=n.scrollWidth-n.clientWidth;if(max<=4)break;if(pos>Math.min(36,Math.max(12,max-itemStep(l)-4)))break;const c=makeCol();if(!c)break;n.prepend(c);pos+=itemStep(c);n.scrollLeft=pos;if(n.children.length>12)l.remove();}return pos;};
 const recR=(n,pos,steps=1)=>{if(locked(n))return pos;for(let s=0;s<steps;s++){const f=n.firstElementChild;if(!f?.classList.contains("idea-column"))break;const max=n.scrollWidth-n.clientWidth;if(max<=4)break;const fw=itemStep(f);if(max-pos>Math.min(36,Math.max(12,max-fw-4))||pos<=fw)break;const c=makeCol();if(!c)break;n.append(c);f.remove();pos-=fw;n.scrollLeft=pos;}return pos;};
 let init=false;const initStart=n=>{if(init)return false;const max=n.scrollWidth-n.clientWidth;if(max<=4)return false;init=true;n.scrollLeft=Math.round(max*0.6);return true;};
 initStart(row);
 autoScroll(row,{
  speed:12,direction:-1,
  advance(n,pos){if(!init&&initStart(n))return n.scrollLeft;pos=recL(n,pos,2);const max=n.scrollWidth-n.clientWidth;return max>0&&pos<=0?max:pos;},
  onScroll(n,pos,dir){return dir<0?recL(n,pos,4):dir>0?recR(n,pos,4):pos;},
  onScrollSettle(n,pos){const max=n.scrollWidth-n.clientWidth;if(max<=4)return pos;if(pos<36)return recL(n,pos,4);if(max-pos<36)return recR(n,pos,4);return pos;},
 });
 el("ideasContext").textContent=generator.related?"Related ideas use your text and local word patterns. Emoji ideas follow known topics or the local catalogue. Availability can change.":"Browse a local word and emoji catalogue. Availability can change.";
}
export function pickIdea(link,q){el("searchInput").value=q;runSearch(q);logSubmittedSearch(q);const status=el("ideasStatus"),addButton=el("searchResult").querySelector("#addToCartBtn");status.replaceChildren();const a=add(status,"a",q,"domain-name");a.href="/d/"+encodeURIComponent(q);
 if(!addButton){status.append(" is not open in the current registry view. Nothing added.");return;}
 const already=ui.cart.some(x=>x.name===q);addButton.click();link.classList.add("is-added");status.append(already?" is already in your cart.":" added to your planning cart. No payment or registration was sent.");
}
