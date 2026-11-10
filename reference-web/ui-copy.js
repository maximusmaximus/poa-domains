// Human labels only. Machine action enums and signed payloads remain unchanged.
const labels = {"announceAuction+bid":"Start auction + place bid",announceAuction:"Start an auction",bid:"Place a bid",finalize:"Finish auction",closeNoBid:"Close auction with no bids",cancelAuction:"Cancel auction",withdrawRefund:"Claim bid refund",createChildOffer:"Offer subdomains",fillChildOffer:"Buy a subdomain",cancelOffer:"Remove listing",sellFixed:"List for sale",buyFixed:"Buy at listed price",transfer:"Transfer a name",setRecords:"Update records",setMetadata:"Update description",revokeChild:"Retire a subdomain"};
export function actionLabel(value) { return labels[value] ?? String(value ?? "").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[+_-]/g," "); }

// Simple controls use visible emoji, never an emoji-only accessible name.
// Signing/payment operations deliberately keep their technical wording.
const icons = new Map([
 ["Check","🔍"],["Add to cart","🛒"],["Open page","🔗"],["Clear","🗑️"],
 ["Copy prompt","📋"],["Copy checkout for agent","📋"],["📥 Download JSON","📥"],
 ["Refresh","🔄"],["🔄 Refresh","🔄"],["Close","❌"],["✕","❌"],
 ["View names","🔍"],["Current","📍"],["Upcoming","⏳"],["Past","📜"],
 ["Copy listing prompt","📋🏷️"],["Copy change-price prompt","📋💰"],["Copy unlist prompt","📋🚫"],
 ["Review changed item","🔎"],
]);
export function buttonIcon(label) { return icons.get(String(label).trim()) ?? null; }
export function decorateEmojiButton(button) {
 const label=button.textContent.trim(),icon=buttonIcon(label);
 if(!icon||button.closest("#escrowPayments,#escrowDomain"))return;
 if(!button.hasAttribute("aria-label"))button.setAttribute("aria-label",label==="✕"?"Close network and site status":label);
 if(!button.hasAttribute("title"))button.title=button.getAttribute("aria-label");
 button.textContent=icon;button.classList.add("emoji-control");
}
