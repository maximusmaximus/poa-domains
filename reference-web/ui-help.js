import { decorateEmojiButton } from "./ui-copy.js?v=62eb7aeeb6c0";
// Native nonmodal popovers provide touch/keyboard dismissal and do not trap page focus.
const watched=new WeakSet();
export function decoratePoaFields(){
 for(const input of document.querySelectorAll("input")){const label=input.getAttribute("aria-label")??"",id=input.id;if(!["escrowAmount","listPriceInput","maxTotal","maxNetworkFee"].includes(id)&&!/(?:bid|amount|price).*(?:POA|registry)|(?:POA|registry).*(?:bid|amount|price)/i.test(label))continue;if(input.closest(".amount-unit"))continue;const wrap=document.createElement("span"),unit=document.createElement("span");wrap.className="amount-unit";unit.className="input-unit";unit.textContent=id==="escrowAmount"?"POA":"units";unit.setAttribute("aria-hidden","true");input.before(wrap);wrap.append(input,unit);}
}
export function installHelp(){
 decoratePoaFields();
 const field=document.getElementById("searchInput");
 if(field&&!watched.has(field)){watched.add(field);let quiet;field.addEventListener("input",()=>{field.dataset.typing="true";clearTimeout(quiet);quiet=setTimeout(()=>{delete field.dataset.typing;},1600);});}
 for(const id of ["escrowPayments","escrowDomain","searchResult","cartList","floatingCartList","manageNames","domainOwnerTools","handoff"]){const n=document.getElementById(id);if(n&&!watched.has(n)&&typeof MutationObserver!=="undefined"){watched.add(n);new MutationObserver(()=>queueMicrotask(installHelp)).observe(n,{childList:true,subtree:true});}}
 const descriptions={advancedHandoff:"Build an unsigned public request. This does not sign or submit anything. Review current prices and permissions with your agent before approving a transaction.",searchResult:"This is the last name you checked, not the current unsubmitted text. Availability is not guaranteed: this is an application-registry snapshot, not native-chain ownership. Re-check the name and price before signing. Cart actions are unsigned planning only; no POA is sent.",escrowDomain:"These are separate live POA payment listings for this name. Viewing them does not pay, buy or transfer it. The escrow enabled, paused and held checks still apply; any signed payment needs your separate approval.",detailView:"This panel shows recorded application-registry history and planning links. Adding a name to the cart sends no payment or signed action.",resourcesSection:"These are live public API and agent documents, not permission to send transactions. The project and landing-page links are in the footer.",networkStatusBar:"This checks upstream PoA read health. It is not a wallet balance or a guarantee that a transaction will succeed. Escrow can separately hold payments when reads are stale.",floatingCartPanel:"This is the same unsigned planning cart, not a payment checkout. Copying a request does not register or buy a name. Review and approve any signed action separately.",domainOwnerTools:"These controls prepare unsigned listing requests for the current owner. They do not sign, sell, or change a price now.",searchSection:"Check a name or emoji in the latest application-registry snapshot. Availability is not guaranteed. Adding to the cart creates an unsigned plan, not a payment or registration. Submitted name queries are saved anonymously without IP or account identifiers; the query text itself is stored. Do not enter personal information, wallet addresses or keys.",ideasHeading:"Ideas come from a local catalogue, not AI or other users. Hover, touch or focus the suggestions to pause it; move away to resume. Selecting an idea adds a planning item only. Reduced-motion settings stop the animation.",cartAnchor:"Add names from Find, Auctions or For sale to prepare your agent request. This is a planning cart, not a payment checkout. Amounts are internal registry units, not POA or wallet money. Copy the request to your agent, review it, and approve any signed action separately.",auctionsSection:"These are application-registry auctions. A closing time means an auction is eligible to close, not that someone has finished it. Check current state before signing.",marketSection:"Listings come from registry state. Prices and availability can change. Adding one to your cart does not buy it.",explorerSection:"Counts, deeds, history and balances are application-registry records, not proof of native PoA ownership or money. Legacy actions may be disabled.",handoffSection:"Give your agent the copied cart request. The advanced builder prepares unsigned public data only. Never paste a private key, password or recovery phrase.",manageDomains:"Look up a public owner address to view its registry names and subdomains. It is not a wallet connection or proof that you own the address. Management buttons prepare text for an owner’s agent; they do not submit.",escrowPayments:"POA escrow is a separate live service. Its own enabled, paused and held checks decide payment availability. Read them before any separately approved payment.",domainSection:"This domain page shows application-registry history and planning controls. Only an authorized owner can sign a management action.",ownerSection:"Public registry profile only. Viewing an address does not connect a wallet or prove identity.",recentActions:"Recent actions are public application-registry records. Hidden records are excluded. They repeat as the strip scrolls; repetition is not a new action. Hover, touch or focus to pause; scroll manually. No native-chain finality is implied."};
 for(const button of document.querySelectorAll("button:not(.section-tab)"))decorateEmojiButton(button);
 for(const tab of document.querySelectorAll(".section-tab")){const label=tab.querySelector(".tab-label")?.textContent;if(label){tab.title=label;}}
 for(const [id,message]of Object.entries(descriptions)){
  const module=document.getElementById(id);
  if(!module||(id==="searchResult"&&!module.querySelector(".card"))||(["escrowPayments","escrowDomain"].includes(id)&&!module.querySelector("h2,h3")))continue;
  const selector=id==="searchSection"?"#searchHelpText,#searchPrivacy,#searchLogStatus,#searchLastChecked":id==="searchResult"?"[data-info-description],.amount-label > small":id==="advancedHandoff"?":scope > [data-info-description]":id==="ideasHeading"?".ideas-hint,#ideasContext":id==="manageDomains"?":scope > p":id==="handoffSection"?":scope > .howto,:scope > .handoff-steps,:scope > p":id==="networkStatusBar"?":scope > [data-info-description]":id==="cartAnchor"?":scope > .howto,[data-info-description]":":scope > .howto";
  const source=id==="ideasHeading"?module.closest(".ideas"):module;
  const extra=[...source.querySelectorAll(selector)].filter(n=>!n.closest(".info-popover"));
  const existing=module.querySelector(`[data-help-for="${id}"]`);
  if(existing){const popover=document.getElementById("info-"+id);for(const node of extra)popover.insertBefore(node,popover.querySelector(".info-close"));}
  else addHelp(module,id,message,extra);
 }
 for(const container of document.querySelectorAll("#cartList,#floatingCartList")){
  for(const [i,card]of [...container.querySelectorAll(".cart-item")].entries()){
   if(card.querySelector(":scope > .module-info"))continue;
   addHelp(card,container.id+"-item-"+i,"This is one unsigned planning item, not a purchase. Edit its maximum registry-unit amount to update the request and totals. Remove it with ✖️; no signed action or payment is sent.",[...card.querySelectorAll(".amount-label > small")]);
  }
 }
}
function addHelp(module,id,message,extra){
 const b=document.createElement("button"),p=document.createElement("div"),text=document.createElement("p"),close=document.createElement("button");
 const heading=id==="searchSection"?"Check Availability":module.querySelector("h2,h3,h4")?.textContent??module.getAttribute("aria-label")??id;
 b.type="button";b.className="module-info";b.dataset.helpFor=id;b.id="help-"+id;b.textContent="ℹ️";b.setAttribute("aria-label","About "+heading.slice(0,60));b.title=b.getAttribute("aria-label");b.setAttribute("aria-haspopup","dialog");b.setAttribute("aria-expanded","false");
 p.id="info-"+id;p.className="info-popover";p.setAttribute("popover","auto");p.setAttribute("role","dialog");p.setAttribute("aria-label","Module information");text.textContent=message;
 close.type="button";close.textContent="❌";close.className="info-close";close.setAttribute("aria-label","Close information");close.title="Close information";close.addEventListener("click",()=>{p.hidePopover();b.focus();});
 p.append(text,...extra,close);b.setAttribute("popovertarget",p.id);b.setAttribute("aria-controls",p.id);p.addEventListener("toggle",e=>b.setAttribute("aria-expanded",String(e.newState==="open")));
 const dismiss=module.querySelector("#networkStatusDismiss,#detailClose,#floatingCartClose,:scope > .cart-remove");
 module.classList.add("help-box");
 if(id==="searchSection")document.getElementById("searchHelp").append(b);
 else if(dismiss){module.classList.add("has-close");dismiss.classList.add("box-close");dismiss.after(b);}
 else module.prepend(b);
 // Keep help inside its owning box: modal focus containment and removed-card cleanup stay correct.
 module.append(p);
}
