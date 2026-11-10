import { ui } from "./ui-state.js?v=cd436ac0ca0a";
import { inspectName } from "./shared.js?v=cd436ac0ca0a";
import { createIdeaGenerator } from "./ideas-generator.js?v=cd436ac0ca0a";
import { autoScroll } from "./ui-motion.js?v=cd436ac0ca0a";
import { add, el, variantOwner } from "./ui-core.js?v=cd436ac0ca0a";
import { runSearch } from "./ui-search.js?v=cd436ac0ca0a";
import { logSubmittedSearch } from "./ui-search-log.js?v=cd436ac0ca0a";
export function ideaAccepted(q) {
 if(!ui.cap||!ui.latestState)return false;
 try{const n=inspectName(q,ui.cap.emojiManifest),entry=ui.latestState.names?.[n.canonical];return n.isRoot&&!ui.reservedSet.has(n.canonical)&&!variantOwner(n.canonical)&&!entry?.activeId&&!entry?.auctionId&&!ui.cart.some(x=>x.name===n.canonical)&&!Object.values(ui.latestState.auctions??{}).some(a=>a.name===n.canonical&&a.status==="live");}catch{return false;}
}
let generator,context="",timer;
export function updateIdeaContext(){clearTimeout(timer);timer=setTimeout(()=>renderIdeas(true),200);}
function idea(line,lane){const q=generator.next(lane);if(!q)return false;const link=add(line,"a",q,"idea domain-name");link.href="/d/"+encodeURIComponent(q);link.dataset.query=q;link.addEventListener("click",e=>{e.preventDefault();pickIdea(link,q);if(e.detail)link.blur();});return true;}
export function renderIdeas(force=false){const strip=el("ideasStrip");if(!strip||!ui.cap||!ui.latestState)return;
 const query=el("searchInput").value.trim();if(!force&&strip.children.length&&context===query)return;context=query;
 generator=createIdeaGenerator({query,manifest:ui.cap.emojiManifest,accept:ideaAccepted});strip.replaceChildren();
 for(const [lane,label]of [["words","Single words"],["double","Double emoji"],["single","Single emoji"]]){
  const group=add(strip,"div","","idea-lane"),heading=add(group,"h4",label);heading.id="ideas-"+lane;
  const row=add(group,"div","","ideas-row");row.dataset.lane=lane;row.setAttribute("role","group");row.setAttribute("aria-labelledby",heading.id);row.tabIndex=0;
  for(let i=0;i<16;i++)if(!idea(row,lane))break;
  if(!row.children.length)add(row,"span","No matching available ideas in the current registry view.","muted");
  autoScroll(row,{speed:lane==="double"?22:18,advance(node,position){const first=node.firstElementChild;if(first?.classList.contains("idea")&&position>first.offsetWidth+12&&!node.contains(document.activeElement)){const width=first.offsetWidth+12;if(idea(node,lane)){first.remove();position-=width;node.scrollLeft=position;}}return position>=node.scrollWidth-node.clientWidth&&node.scrollWidth>node.clientWidth?(node.scrollLeft=0):position;}});
 }
 el("ideasContext").textContent=generator.related?"Related ideas use your text and local word patterns. Emoji rows follow known topics or the local catalogue. Availability can change.":"Browse a local word and emoji catalogue. Availability can change.";
}
export function pickIdea(link,q){el("searchInput").value=q;runSearch(q);logSubmittedSearch(q);const status=el("ideasStatus"),addButton=el("searchResult").querySelector("#addToCartBtn");status.replaceChildren();const a=add(status,"a",q,"domain-name");a.href="/d/"+encodeURIComponent(q);
 if(!addButton){status.append(" is not open in the current registry view. Nothing added.");return;}
 const already=ui.cart.some(x=>x.name===q);addButton.click();link.classList.add("is-added");status.append(already?" is already in your cart.":" added to your planning cart. No payment or registration was sent.");
}
