import { shortenPoaAddress } from "./shared.js?v=967395abc779";

// Human labels only. Machine action enums and signed payloads remain unchanged.
const labels = {poaCheckout:"🪙 Buy",poaBid:"🏷️ Bid",poaBuy:"🛍️ Buy","announceAuction+bid":"Start auction + place bid",announceAuction:"Start an auction",bid:"Place a bid",finalize:"Finish auction",closeNoBid:"Close auction with no bids",cancelAuction:"Cancel auction",withdrawRefund:"Claim bid refund",createChildOffer:"Offer subdomains",fillChildOffer:"Buy a subdomain",cancelOffer:"Remove listing",sellFixed:"List for sale",buyFixed:"Buy at listed price",transfer:"Transfer a name",setRecords:"Update records",setMetadata:"Update description",setPrimaryName:"Set main domain",revokeChild:"Retire a subdomain"};
export function actionLabel(value) { return labels[value] ?? String(value ?? "").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[+_-]/g," "); }

// Simple controls use visible emoji, never an emoji-only accessible name.
// Signing/payment operations deliberately keep their technical wording.
const icons = new Map([
 ["Check","🔍"],["Add to cart","🛒"],["Open page","🔗"],["Clear","🗑️"],
 ["Copy prompt","📋"],["Copy checkout for agent","📋"],["📥 Download JSON","📥"],
 ["Refresh","🔄"],["🔄 Refresh","🔄"],["Close","❌"],["✕","❌"],
 ["View names","🔍"],["Current","📍"],["Upcoming","⏳"],["Past","📜"],
 ["Copy listing prompt","📋🏷️"],["Copy change-price prompt","📋💰"],["Copy unlist prompt","📋🚫"],
 ["Review changed item","🔎"],["✅ Review changed item","🔎"],["History","📜"],["🟢 Start auction (add to cart)","🏁🛒"],
]);
export function buttonIcon(label) { return icons.get(String(label).trim()) ?? null; }
export function decorateEmojiButton(button) {
 const label=button.textContent.trim(),icon=buttonIcon(label);
 if(!icon||button.closest("#escrowPayments,#escrowDomain"))return;
 if(!button.hasAttribute("aria-label"))button.setAttribute("aria-label",label==="✕"?"Close network and site status":label);
 if(!button.hasAttribute("title"))button.title=button.getAttribute("aria-label");
 button.textContent=icon;button.classList.add("emoji-control");
}

export function selectElementText(node) {
 if (!node || typeof window === "undefined" || typeof document === "undefined") return false;
 try {
  const selection = window.getSelection?.();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
 } catch { return false; }
}
export async function copyText(text, fallbackNode = null) {
 const value = String(text ?? "");
 if (!value) return { ok: false, method: "empty", selected: false };
 if (globalThis.navigator?.clipboard?.writeText) {
  try { await globalThis.navigator.clipboard.writeText(value); return { ok: true, method: "clipboard", selected: false }; } catch {}
 }
 if (typeof document !== "undefined" && document.body) {
  let area;
  try {
   area = document.createElement("textarea");
   area.value = value;
   area.setAttribute("readonly", "");
   area.setAttribute("aria-hidden", "true");
   area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;";
   const active = document.activeElement;
   const container = active?.closest?.("dialog, [role='dialog']") || document.body;
   container.append(area);
   area.focus({ preventScroll: true });
   area.select();
   area.setSelectionRange?.(0, value.length);
   const copied = document.execCommand?.("copy") === true;
   area.remove();
   if (active && active.isConnected && typeof active.focus === "function") active.focus({ preventScroll: true });
   if (copied) return { ok: true, method: "execCommand", selected: false };
  } catch { area?.remove(); }
 }
 return { ok: false, method: "manual", selected: selectElementText(fallbackNode) };
}
const copyFlashTimers = new WeakMap();
export function flashCopied(button) {
 if (!button) return;
 const timer = copyFlashTimers.get(button);
 if (timer) clearTimeout(timer);
 if (!button.dataset.copyIdleText) button.dataset.copyIdleText = button.textContent;
 if (!button.dataset.copyIdleTitle && button.title) button.dataset.copyIdleTitle = button.title;
 button.textContent = "✅";
 button.title = "Copied";
 copyFlashTimers.set(button, setTimeout(() => {
  button.textContent = button.dataset.copyIdleText;
  if (button.dataset.copyIdleTitle) button.title = button.dataset.copyIdleTitle;
  copyFlashTimers.delete(button);
 }, 1600));
}
const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
 const node = document.createElementNS(SVG_NS, tag);
 for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
 return node;
}
export function createCopyIconSvg(copied = false) {
 const svg = svgEl("svg", {
  viewBox: "0 0 16 16",
  width: "14",
  height: "14",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.6",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
  focusable: "false",
  class: "poa-copy-icon",
 });
 if (copied) {
  svg.append(svgEl("path", { d: "M3 8.5l3.2 3.2L13 4.5" }));
 } else {
  svg.append(
   svgEl("rect", { x: "5.5", y: "5.5", width: "8", height: "8", rx: "1.5" }),
   svgEl("path", { d: "M3.5 10.5H3a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5" }),
  );
 }
 return svg;
}
const poaCopyTimers = new WeakMap();
export function createPoaCopyButton(address, { ariaLabel, onCopy } = {}) {
 const value = String(address ?? "");
 const short = shortenPoaAddress(value);
 const btn = document.createElement("button");
 btn.type = "button";
 btn.className = "poa-copy-btn";
 btn.setAttribute("aria-label", ariaLabel || `Copy address ${short}`);
 btn.title = "Copy full address";
 btn.dataset.copyAddress = value;
 btn.append(createCopyIconSvg(false));
 btn.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  const res = await copyText(value);
  if (res.ok) {
   const prev = poaCopyTimers.get(btn);
   if (prev) clearTimeout(prev);
   btn.classList.add("is-copied");
   btn.title = "Copied";
   btn.replaceChildren(createCopyIconSvg(true));
   poaCopyTimers.set(btn, setTimeout(() => {
    btn.classList.remove("is-copied");
    btn.title = "Copy full address";
    btn.replaceChildren(createCopyIconSvg(false));
    poaCopyTimers.delete(btn);
   }, 1600));
  }
  onCopy?.(res);
 });
 return btn;
}
