import { publicNameUnavailable } from "./shared.js?v=193b1cfcba90";
import { ui } from "./ui-state.js?v=193b1cfcba90";
import { inspectName } from "./shared.js?v=193b1cfcba90";
import { createIdeaGenerator } from "./ideas-generator.js?v=193b1cfcba90";
import { autoScroll } from "./ui-motion.js?v=193b1cfcba90";
import { add, el, variantOwner } from "./ui-core.js?v=193b1cfcba90";
import { runSearch } from "./ui-search.js?v=193b1cfcba90";
import { logSubmittedSearch } from "./ui-search-log.js?v=193b1cfcba90";
export function ideaAccepted(q) {
 if(!ui.cap||!ui.latestState)return false;
 try{const n=inspectName(q,ui.cap.emojiManifest),entry=ui.latestState.names?.[n.canonical];return !publicNameUnavailable(n.canonical,ui.cap)&&n.isRoot&&!ui.reservedSet.has(n.canonical)&&!variantOwner(n.canonical)&&!entry?.activeId&&!entry?.auctionId&&!ui.cart.some(x=>x.name===n.canonical)&&!Object.values(ui.latestState.auctions??{}).some(a=>a.name===n.canonical&&a.status==="live");}catch{return false;}
}
let generator,context="",timer,edgeObserver;
// Keep the continuous catalogue, but never paint half a chip at a scroll boundary.
// Visibility (not layout) is changed, so column sizes and motion remain stable.
function observeIdeaEdges(row) {
 edgeObserver?.disconnect();
 if (!globalThis.IntersectionObserver) return;
 edgeObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
   const clipped = !entry.isIntersecting || entry.intersectionRatio < 0.999;
   // Never blur a keyboard user when focus scrolling crosses the boundary.
   if (clipped && entry.target === document.activeElement) {
    entry.target.classList.remove("is-clipped");
    entry.target.scrollIntoView({block: "nearest", inline: "nearest"});
   } else entry.target.classList.toggle("is-clipped", clipped);
  }
 }, {root: row, threshold: [0, 1]});
 for (const link of row.querySelectorAll(".idea")) edgeObserver.observe(link);
}
export function updateIdeaContext(){clearTimeout(timer);timer=setTimeout(()=>renderIdeas(true),200);}
function idea(line,lane){const q=generator.next(lane);if(!q)return false;const link=add(line,"a",q,"idea domain-name");edgeObserver?.observe(link);link.href="/d/"+encodeURIComponent(q);link.dataset.query=q;link.dataset.lane=lane;link.setAttribute("aria-label",q+" — "+({words:"word idea",double:"two-emoji idea",single:"single-emoji idea"}[lane]));link.addEventListener("click",e=>{e.preventDefault();pickIdea(link,q);if(e.detail)link.blur();});return true;}
export function renderIdeas(force=false){const strip=el("ideasStrip");if(!strip||!ui.cap||!ui.latestState)return;
 const query=el("searchInput").value.trim();if(!force&&strip.children.length&&context===query)return;context=query;
 edgeObserver?.disconnect();edgeObserver=null;
 generator=createIdeaGenerator({query,manifest:ui.cap.emojiManifest,accept:ideaAccepted});strip.replaceChildren();
 const row=add(strip,"div","","ideas-row ideas-masonry");row.setAttribute("role","group");row.setAttribute("aria-label","Scrolling word and emoji ideas");row.tabIndex=0;let columnNumber=0;
 const column=()=>{const col=add(row,"div","","idea-column idea-offset-"+(columnNumber%4));const lanes=["words","double","single"];for(let i=0;i<3;i++)idea(col,lanes[(i+columnNumber)%3]);columnNumber++;if(!col.children.length){col.remove();return false;}return true;};
 for(let i=0;i<12;i++)if(!column())break;
 if(!row.children.length)add(row,"span","No matching available ideas in the current registry view.","muted");
 observeIdeaEdges(row);
 autoScroll(row,{speed:18,advance(node,position){const first=node.firstElementChild;if(first?.classList.contains("idea-column")&&position>first.offsetWidth+12&&!node.contains(document.activeElement)){const width=first.offsetWidth+12;if(column()){for(const link of first.querySelectorAll(".idea"))edgeObserver?.unobserve(link);first.remove();position-=width;node.scrollLeft=position;}}return position>=node.scrollWidth-node.clientWidth&&node.scrollWidth>node.clientWidth?(node.scrollLeft=0):position;}});
 el("ideasContext").textContent=generator.related?"Related ideas use your text and local word patterns. Emoji ideas follow known topics or the local catalogue. Availability can change.":"Browse a local word and emoji catalogue. Availability can change.";
}
export function pickIdea(link,q){el("searchInput").value=q;runSearch(q);logSubmittedSearch(q);const status=el("ideasStatus"),addButton=el("searchResult").querySelector("#addToCartBtn");status.replaceChildren();const a=add(status,"a",q,"domain-name");a.href="/d/"+encodeURIComponent(q);
 if(!addButton){status.append(" is not open in the current registry view. Nothing added.");return;}
 const already=ui.cart.some(x=>x.name===q);addButton.click();link.classList.add("is-added");status.append(already?" is already in your cart.":" added to your planning cart. No payment or registration was sent.");
}
