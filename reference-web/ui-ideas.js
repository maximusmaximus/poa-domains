import { publicNameUnavailable } from "./shared.js?v=e822e8d11185";
import { ui } from "./ui-state.js?v=e822e8d11185";
import { inspectName } from "./shared.js?v=e822e8d11185";
import { createIdeaGenerator } from "./ideas-generator.js?v=e822e8d11185";
import { autoScroll } from "./ui-motion.js?v=e822e8d11185";
import { add, el, variantOwner } from "./ui-core.js?v=e822e8d11185";
import { runSearch } from "./ui-search.js?v=e822e8d11185";
import { logSubmittedSearch } from "./ui-search-log.js?v=e822e8d11185";
export function ideaAccepted(q) {
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
 const column=()=>{const col=add(row,"div","","idea-column idea-offset-"+(columnNumber%4));const lanes=["words","double","single"];for(let i=0;i<3;i++)idea(col,lanes[(i+columnNumber)%3]);columnNumber++;if(!col.children.length){col.remove();return false;}return true;};
 for(let i=0;i<12;i++)if(!column())break;
 if(!row.children.length)add(row,"span","No matching available ideas in the current registry view.","muted");
 const stepWidth=first=>{const next=first.nextElementSibling;return next?next.getBoundingClientRect().left-first.getBoundingClientRect().left:first.getBoundingClientRect().width+12;};
 const recycle=(node,position,maxSteps=1)=>{
  if(node.contains(document.activeElement))return position;
  for(let step=0;step<maxSteps;step++){
   const first=node.firstElementChild;
   if(!first?.classList.contains("idea-column"))break;
   const width=stepWidth(first);
   if(!(width>0)||position<=width)break;
   if(!column())break;
   first.remove();
   position-=width;
   node.scrollLeft=position;
  }
  return position;
 };
 autoScroll(row,{
  speed:12,
  advance(node,position){
   position=recycle(node,position,2);
   return position>=node.scrollWidth-node.clientWidth&&node.scrollWidth>node.clientWidth?(node.scrollLeft=0):position;
  },
  onScrollSettle(node,position){
   const remaining=node.scrollWidth-(position+node.clientWidth);
   if(remaining<Math.max(260,node.clientWidth*0.75))return recycle(node,position,4);
   return position;
  },
 });
 el("ideasContext").textContent=generator.related?"Related ideas use your text and local word patterns. Emoji ideas follow known topics or the local catalogue. Availability can change.":"Browse a local word and emoji catalogue. Availability can change.";
}
export function pickIdea(link,q){el("searchInput").value=q;runSearch(q);logSubmittedSearch(q);const status=el("ideasStatus"),addButton=el("searchResult").querySelector("#addToCartBtn");status.replaceChildren();const a=add(status,"a",q,"domain-name");a.href="/d/"+encodeURIComponent(q);
 if(!addButton){status.append(" is not open in the current registry view. Nothing added.");return;}
 const already=ui.cart.some(x=>x.name===q);addButton.click();link.classList.add("is-added");status.append(already?" is already in your cart.":" added to your planning cart. No payment or registration was sent.");
}
