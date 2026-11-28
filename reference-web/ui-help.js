import { decorateEmojiButton } from "./ui-copy.js?v=41d7adc244c5";
// Native nonmodal popovers provide touch/keyboard dismissal and do not trap page focus.
const watched=new WeakSet();
export function decoratePoaFields(){
 for(const input of document.querySelectorAll("input")){const label=input.getAttribute("aria-label")??"",id=input.id;if(!["escrowAmount","listPriceInput"].includes(id)&&!/(?:bid|amount|price).*(?:POA|registry)|(?:POA|registry).*(?:bid|amount|price)/i.test(label))continue;if(input.closest(".amount-unit"))continue;const wrap=document.createElement("span"),unit=document.createElement("span");wrap.className="amount-unit";unit.className="input-unit";unit.textContent=(id==="escrowAmount"||(/POA/i.test(label)&&!/registry/i.test(label)))?"POA":"units";unit.setAttribute("aria-hidden","true");input.before(wrap);wrap.append(input,unit);}
}
export function installHelp(){
 decoratePoaFields();
 const field=document.getElementById("searchInput");
 if(field&&!watched.has(field)){watched.add(field);let quiet;field.addEventListener("input",()=>{field.dataset.typing="true";clearTimeout(quiet);quiet=setTimeout(()=>{delete field.dataset.typing;},1600);});}
 for(const id of ["escrowPayments","escrowDomain","searchResult","cartList","floatingCartList","manageNames","domainOwnerTools","handoff"]){const n=document.getElementById(id);if(n&&!watched.has(n)&&typeof MutationObserver!=="undefined"){watched.add(n);new MutationObserver(()=>queueMicrotask(installHelp)).observe(n,{childList:true,subtree:true});}}
 const descriptions={
  advancedHandoff:"🛠️ Build an unsigned public request — this does not sign or submit anything.\n🤖 Review current prices and permissions with your agent before approving a transaction.",
  searchResult:"🔎 This is the last name you checked, not the current unsubmitted text.\n📜 Owned names are permanent registry deeds with no renewal or expiry; transfer or resale only.\n⚠️ Availability is not guaranteed — re-check the name and price before signing.\n🛒 Cart actions are unsigned planning only; no POA is sent.",
  escrowDomain:"🪙 These are separate live POA payment listings for this name — viewing them does not pay, buy or transfer it.\n⚡ Automatic settlement: escrow pays seller + fee on-chain and commits title once funded or closed (zero seller handover step).\n🚦 The escrow enabled, paused and held checks still apply; any signed payment needs your separate approval.",
  detailView:"📜 This panel shows recorded history and planning links.\n🛒 Adding a name to the cart sends no payment or signed action.",
  resourcesSection:"📚 These are live public API and agent documents, not permission to send transactions.\n🔗 The project and landing-page links are in the footer.",
  networkStatusBar:"📡 This checks upstream PoA read health — it is not a wallet balance or a guarantee that a transaction will succeed.\n⏸️ Escrow can separately hold payments when reads are stale.",
  floatingCartPanel:"🛒 This is the same unsigned planning cart, not a payment checkout.\n🤖 Copying a request does not register or buy a name — review and approve any signed action separately.",
  domainOwnerTools:"⚙️ These controls prepare unsigned listing requests for the current owner.\n⏸️ Listing or auctioning pauses profile fields and drops them on transfer (archived on this page).\n⚡ Automatic settlement: escrow pays seller + fee on-chain and commits title once funded or closed (zero seller handover step).\n🛡️ They do not sign, sell, or change a price now.",
  searchSection:"🔍 Check a name or emoji in the latest registry snapshot — Availability is not guaranteed.\n🛒 Adding to the cart creates an unsigned plan, not a payment or registration.\n🔒 Submitted name searches are saved anonymously without IP or account identifiers; the query text itself is stored. Do not enter personal information, wallet addresses or keys.",
  cartAnchor:"🛒 Add names from Find to prepare your agent request.\n🪙 Prices are in POA; your agent pays with POA checkout only after your approval.\n🤖 This is a planning cart, not a payment — copy the request to your agent and review it first.",
  auctionsSection:"⏱️ POA auctions start their 3h countdown timer (24h for premium) when the first valid bid lands.\n📈 Each new bid must beat the current high bid by strictly more than 10%; late bids extend closing by the anti-sniping quiet window.\n↩️ Outbid POA immediately credits back to your available escrow balance so you can re-bid right away or withdraw back only to your original sending wallet.\n⚡ Automatic settlement: escrow pays seller + fee on-chain and commits title once funded or closed (zero seller handover step).\n👤 Optional bid tracking takes a public poa1… address or a registered domain name — never a private key. Adding to cart is an unsigned bid ceiling only; nothing is paid here.",
  marketSection:"🪙 Listings come from live POA escrow or registry state — prices and availability can change.\n⚡ Automatic settlement: escrow pays seller + fee on-chain and commits title once funded or closed (zero seller handover step).\n🛒 Adding one to your cart does not buy it.",
  explorerSection:"🧭 Counts, deeds, history and balances reflect current registry records.\n📜 Owned names are permanent deeds with no renewal or expiry.\n🚫 Legacy lease actions are disabled.",
  handoffSection:"🤖 Give your agent the copied cart request.\n🛠️ The advanced builder prepares unsigned public data only — never paste a private key, password or recovery phrase.",
  manageDomains:"🌱 Look up a public owner address or registered domain name to manage its domains, listings, and subdomains.\n⭐ Set any held domain as your default/main domain address (bound to your public key across your Owner Profile and site links), edit public profiles, or transfer a domain.\n⏸️ Listing or auctioning pauses profile fields and drops them on transfer (transferring also resets attached profile fields and records).\n⚡ Automatic settlement: escrow pays seller + fee on-chain and commits title once funded or closed (zero seller handover step).\n🔒 Viewing an address does not connect a wallet; buttons prepare prompts for your agent and never submit here.",
  escrowPayments:"🪙 POA escrow is a separate live service for fixed-price sales, auctions, new names, and subdomains.\n⚡ Automatic settlement: escrow pays seller + fee on-chain and commits title once funded or closed (zero seller handover step).\n⏸️ Listing or auctioning pauses profile fields and drops them on transfer (archived as read-only history on the domain page).\n🚦 Its own enabled, paused and held checks decide payment availability; read live status before any separately approved payment.",
  domainSection:"🔎 This domain page shows domain history and planning controls.\n📜 Owned names are permanent registry deeds with no renewal or expiry; one owner per emoji regardless of skin tone or style.\n🔒 Withheld names are not free to register — only an authorized owner can sign a management action.",
  ownerSection:"👤 Public owner profile.\n⭐ If the owner has set a default/main domain address, their domain name, avatar icon, and profile fields appear at the top above all names they hold.\n🔒 Viewing an address does not connect a wallet or prove identity."
 };
 for(const button of document.querySelectorAll("button:not(.section-tab):not(.explore-tab):not(.action-filter):not(.escrow-market-tab):not(.escrow-expand-btn):not(.field-clear-btn):not(.manage-tab):not(.manage-listed-subtab)"))decorateEmojiButton(button);
 for(const tab of document.querySelectorAll(".section-tab")){const label=tab.querySelector(".tab-label")?.textContent;if(label){tab.title=label;}}
 for(const [id,message]of Object.entries(descriptions)){
  const module=document.getElementById(id);
  if(!module||(id==="searchResult"&&!module.querySelector(".card"))||(["escrowPayments","escrowDomain"].includes(id)&&!module.querySelector("h2,h3")))continue;
  const selector=id==="searchSection"?"#searchHelpText,#searchPrivacy,#searchLogStatus,#searchLastChecked,.ideas-hint,#ideasContext":id==="searchResult"?"[data-info-description],.amount-label > small":id==="advancedHandoff"||id==="manageDomains"||id==="networkStatusBar"?":scope > [data-info-description]":id==="domainOwnerTools"?"[data-info-description],:scope > .howto":id==="handoffSection"?":scope > .howto,:scope > .handoff-steps,:scope > p":id==="cartAnchor"?":scope > .howto,[data-info-description]":id==="explorerSection"||id==="floatingCartPanel"?":scope > .howto,:scope > [data-info-description]":":scope > .howto";
  const extra=[...module.querySelectorAll(selector)].filter(n=>!n.closest(".info-popover"));
  const existing=module.querySelector(`[data-help-for="${id}"]`);
  if(existing){const popover=document.getElementById("info-"+id);for(const node of extra)popover.insertBefore(node,popover.querySelector(".info-close"));}
  else addHelp(module,id,message,extra);
 }
 for(const container of document.querySelectorAll("#cartList,#floatingCartList")){
  for(const [i,card]of [...container.querySelectorAll(".cart-item")].entries()){
   if(card.querySelector(":scope > .module-info"))continue;
   const action=card.dataset.cartAction||"";
   const isPoaBid=action==="poaBid";
   const isPoaBuy=action==="poaBuy";
   const isPoaItem=!isPoaBid&&!isPoaBuy&&(action==="poaCheckout"||!card.querySelector(".amount-label"));
   const helpText=isPoaBid?"🔨 This is an unsigned POA auction bid (not a fixed-price buy and not a payment).\n💳 Check Use deposit to fund strictly from your existing credited escrow balance.\n⏱️ Queued auctions start their 3h timer (24h premium) on the first bid; each higher bid must exceed the current high bid by >10%; late bids extend closing by the anti-sniping quiet window.\n↩️ Outbid POA immediately credits back to your available escrow balance for instant re-bidding or withdrawal back only to your original wallet.\n⚡ Automatic settlement: escrow pays seller + fee on-chain and commits title once funded or closed (zero seller handover step).\n✏️ Adjust your highest-bid ceiling anytime or remove with ✖️.":isPoaBuy?"🛍️ This is an unsigned fixed-price POA resale purchase (not a payment).\n💳 Check Use deposit to fund strictly from your existing credited escrow balance.\n⚡ Your agent verifies the live listing price and status and submits buy — Automatic settlement: escrow pays seller + fee on-chain and commits title once funded or closed (zero seller handover step).\n✖️ Remove it anytime with ✖️.":isPoaItem?"🪙 This is one unsigned POA checkout item, not a payment.\n💳 Check Use deposit to fund from your existing credited escrow balance.\n🤖 Your agent checks live escrow status, pays the exact POA total after your approval, waits for PoA finality, and mints the permanent name to your address.\n✖️ Remove it with ✖️.":"🛒 This is one unsigned planning item, not a purchase.\n✏️ Edit its maximum registry-unit amount to update the request and totals.\n✖️ Remove it with ✖️; no signed action or payment is sent.";
   addHelp(card,container.id+"-item-"+i,helpText,[...card.querySelectorAll(".amount-label > small")]);
  }
 }
}
 function textParagraphs(message){
  const lines=String(message??"").split("\n").filter(Boolean);
  return (lines.length?lines:[""]).map(line=>{const p=document.createElement("p");p.textContent=line;return p;});
 }
 export function createInlineInfo(id,label,message){
  const wrap=document.createElement("span"),b=document.createElement("button"),p=document.createElement("div"),close=document.createElement("button");
  wrap.className="inline-info-wrap";
  b.type="button";b.className="inline-info";b.id="help-"+id;b.dataset.helpFor=id;b.textContent="ℹ️";b.setAttribute("aria-label",label);b.title=label;b.setAttribute("aria-haspopup","dialog");b.setAttribute("aria-expanded","false");
  p.id="info-"+id;p.className="info-popover";p.setAttribute("popover","auto");p.setAttribute("role","dialog");p.setAttribute("aria-label",label);
  close.type="button";close.textContent="❌";close.className="info-close";close.setAttribute("aria-label","Close information");close.title="Close information";close.addEventListener("click",()=>{p.hidePopover();b.focus();});
  p.append(...textParagraphs(message),close);b.setAttribute("popovertarget",p.id);b.setAttribute("aria-controls",p.id);p.addEventListener("toggle",e=>b.setAttribute("aria-expanded",String(e.newState==="open")));
  wrap.append(b,p);
  return wrap;
 }
 function addHelp(module,id,message,extra){
 const b=document.createElement("button"),p=document.createElement("div"),close=document.createElement("button");
 const heading=id==="searchSection"?"Check Availability":module.querySelector("h2,h3,h4")?.textContent??module.getAttribute("aria-label")??id;
 b.type="button";b.className="module-info";b.dataset.helpFor=id;b.id="help-"+id;b.textContent="ℹ️";b.setAttribute("aria-label","About "+heading.slice(0,60));b.title=b.getAttribute("aria-label");b.setAttribute("aria-haspopup","dialog");b.setAttribute("aria-expanded","false");
 p.id="info-"+id;p.className="info-popover";p.setAttribute("popover","auto");p.setAttribute("role","dialog");p.setAttribute("aria-label","Module information");
 close.type="button";close.textContent="❌";close.className="info-close";close.setAttribute("aria-label","Close information");close.title="Close information";close.addEventListener("click",()=>{p.hidePopover();b.focus();});
 p.append(...textParagraphs(message),...extra,close);b.setAttribute("popovertarget",p.id);b.setAttribute("aria-controls",p.id);p.addEventListener("toggle",e=>b.setAttribute("aria-expanded",String(e.newState==="open")));
 const dismiss=module.querySelector("#networkStatusDismiss,#detailClose,#floatingCartClose,:scope > .cart-remove");
 const copy=id==="domainSection"?module.querySelector(":scope > #domainCopyLink"):null;
 module.classList.add("help-box");
 if(id==="searchSection")document.getElementById("searchHelp").append(b);
 else if(dismiss){module.classList.add("has-close");dismiss.classList.add("box-close");dismiss.after(b);}
 else if(copy)copy.after(b);
 else module.prepend(b);
 // Keep help inside its owning box: modal focus containment and removed-card cleanup stay correct.
 module.append(p);
}
