import { createPoaCopyButton, decorateEmojiButton } from "./ui-copy.js?v=633111790deb";
import { buildOwnershipIndex, domainPath, hasPoaSiteActions, isPoaAddress, ownershipConflict, poascanAddressUrl, primaryNameForOwner, safeObject, shortenPoaAddress } from "./shared.js?v=633111790deb";
import { ui } from "./ui-state.js?v=633111790deb";
let addressNav = null;
export function registerAddressNav(nav) { addressNav = nav; }
export const el = (id) => document.getElementById(id);
export async function json(url, { timeoutMs = 20000 } = {}) {
 const response = await fetch(url, {
 method: "GET",
 credentials: "omit",
 redirect: "error",
 cache: "no-store",
 signal: timeoutMs > 0 && globalThis.AbortSignal?.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
 });
 if (!response.ok) throw Error("Read failed");
 const result = await response.json();
 safeObject(result);
 return result;
}
export function staticURL(path) {
 if (typeof path !== "string" || !/^\.\/demo\/[a-z-]+\.json$/.test(path)) throw Error("Static path");
 const url = new URL(path, location.href), root = new URL("./", location.href);
 if (url.origin !== location.origin || !url.pathname.startsWith(root.pathname) || url.search || url.hash)
 throw Error("Static origin");
 return url.href;
}
export function add(parent, tag, text, css) {
 const node = document.createElement(tag);
 node.textContent = text;
 if (css) node.className = css;
 parent.append(node);
 if (tag === "button") decorateEmojiButton(node);
 return node;
}
export function person(id) {
 const role = Object.keys(ui.details.roles ?? {}).find((x) => ui.details.roles[x] === id);
 if (role) return "Demo " + role;
 return isPoaAddress(id) ? shortenPoaAddress(id) : id.slice(0, 18) + "…";
}
function createPrimaryDomainLink(primary) {
 const domLink = document.createElement("a");
 domLink.href = domainPath(primary);
 domLink.className = "domain-link owner-primary-link";
 domLink.title = `Open ${primary} domain page`;
 if (addressNav?.createDomainAvatar) domLink.append(addressNav.createDomainAvatar(primary, { size: "xs" }));
 const nameSpan = document.createElement("span");
 nameSpan.className = "domain-name domain-tile is-registered";
 nameSpan.textContent = primary;
 domLink.append(nameSpan);
 domLink.addEventListener("click", (event) => {
 if (addressNav?.navigateDomain) {
 event.preventDefault();
 addressNav.navigateDomain(primary);
 }
 });
 return domLink;
}
export function createPoaAddressLink(value, { primary = null, linkPoascan = false } = {}) {
 const short = shortenPoaAddress(value);
 const toPoascan = linkPoascan || !hasPoaSiteActions(ui.latestState, value, ui.escrowMarket);
 const addrLink = document.createElement("a");
 addrLink.className = "domain-link poa-addr-text" + (primary ? " owner-addr-link" : "");
 addrLink.textContent = short;
 if (toPoascan) {
 addrLink.href = poascanAddressUrl(value);
 addrLink.target = "_blank";
 addrLink.rel = "noopener noreferrer";
 addrLink.title = `Inspect ${value} on POAScan`;
 addrLink.setAttribute("aria-label", `Inspect ${short} on POAScan`);
 } else {
 const target = primary || value;
 addrLink.href = "/p/" + encodeURIComponent(target);
 addrLink.title = primary ? `Owner profile (${value})` : value;
 addrLink.setAttribute("aria-label", primary ? `Owner profile for ${primary} (${short})` : `Owner profile ${short}`);
 addrLink.addEventListener("click", (event) => {
 if (addressNav?.navigateOwner) {
 event.preventDefault();
 addressNav.navigateOwner(target);
 }
 });
 }
 return addrLink;
}
export function appendTextWithPoaAddress(parent, text, address, opts = {}) {
 const str = String(text ?? "");
 if (!isPoaAddress(address)) { parent.append(str); return parent; }
 const short = shortenPoaAddress(address), at = str.indexOf(short);
 if (at < 0) { parent.append(str); return parent; }
 if (at > 0) parent.append(str.slice(0, at));
 const primary = opts.primary === undefined ? primaryNameForOwner(ui.latestState, address) : opts.primary;
 parent.append(createPoaAddressLink(address, { primary, linkPoascan: Boolean(opts.linkPoascan) }));
 if (at + short.length < str.length) parent.append(str.slice(at + short.length));
 return parent;
}
function populatePoaAddressWrap(wrap, value, { code = false, ariaLabel, onCopy, resolvePrimary = true, linkOwner = true, linkPoascan = false, row = false } = {}) {
 const short = shortenPoaAddress(value);
 const primary = resolvePrimary ? primaryNameForOwner(ui.latestState, value) : null;
 const toPoascan = linkPoascan || (linkOwner && !hasPoaSiteActions(ui.latestState, value, ui.escrowMarket));
 wrap.replaceChildren();
 wrap.dataset.poaAddr = value;
 wrap.dataset.poaPrimary = primary || "";
 wrap.dataset.poaCode = code ? "1" : "0";
 wrap.dataset.poaRow = row ? "1" : "0";
 wrap.dataset.poaResolve = resolvePrimary ? "1" : "0";
 wrap.dataset.poaLink = linkOwner ? "1" : "0";
 wrap.dataset.poaPoascan = linkPoascan ? "1" : "0";
 wrap.dataset.poaMode = linkPoascan || linkOwner ? (toPoascan ? "scan" : "owner") : "plain";
 wrap.className = "poa-addr-inline" + (primary ? " owner-primary-inline" : "") + (row ? " poa-addr-row" : "");
 if (primary) wrap.append(createPrimaryDomainLink(primary));
 if (linkPoascan || linkOwner) {
 wrap.append(createPoaAddressLink(value, { primary, linkPoascan: toPoascan }));
 } else {
 const text = document.createElement(code ? "code" : "span");
 text.className = "poa-addr-text";
 text.textContent = short;
 text.title = value;
 wrap.append(text);
 }
 wrap.append(createPoaCopyButton(value, { ariaLabel, onCopy }));
 return wrap;
}
export function appendPoaAddress(parent, value, opts = {}) {
 if (!isPoaAddress(value)) {
 if (opts.code) add(parent, "code", String(value ?? ""));
 else parent.append(String(value ?? ""));
 return parent;
 }
 const wrap = document.createElement("span");
 populatePoaAddressWrap(wrap, value, opts);
 parent.append(wrap);
 return wrap;
}
export function appendPrincipal(parent, id, opts = {}) {
 const role = Object.keys(ui.details.roles ?? {}).find((x) => ui.details.roles[x] === id);
 if (role) { parent.append("Demo " + role); return parent; }
 if (isPoaAddress(id)) return appendPoaAddress(parent, id, opts);
 const primary = opts.resolvePrimary !== false ? primaryNameForOwner(ui.latestState, id) : null;
 if (primary) {
 const wrap = document.createElement("span");
 wrap.className = "poa-addr-inline owner-primary-inline";
 const addrLink = document.createElement("a");
 addrLink.href = "/p/" + encodeURIComponent(primary);
 addrLink.className = "domain-link poa-addr-text owner-addr-link";
 addrLink.textContent = String(id ?? "").slice(0, 18) + "…";
 addrLink.title = `Owner profile (${id})`;
 addrLink.addEventListener("click", (event) => {
 if (addressNav?.navigateOwner) {
 event.preventDefault();
 addressNav.navigateOwner(primary);
 }
 });
 wrap.append(createPrimaryDomainLink(primary), addrLink);
 parent.append(wrap);
 return wrap;
 }
 parent.append(String(id ?? "").slice(0, 18) + "…");
 return parent;
}
const POA_ADDR_IN_TEXT = /\bpoa1[1-9A-HJ-NP-Za-km-z]{20,60}\b/g;
const SKIP_ADDR_TAGS = new Set(["PRE", "INPUT", "TEXTAREA", "BUTTON", "SCRIPT", "STYLE"]);
export function enhancePoaAddressesIn(root, { onCopy } = {}) {
 if (!root || typeof document === "undefined") return;
 for (const wrap of [...root.querySelectorAll(".poa-addr-inline[data-poa-addr]")]) {
 const raw = wrap.dataset.poaAddr;
 if (!isPoaAddress(raw)) continue;
 const resolvePrimary = wrap.dataset.poaResolve !== "0";
 const linkOwner = wrap.dataset.poaLink !== "0";
 const linkPoascan = wrap.dataset.poaPoascan === "1";
 const nextPrimary = resolvePrimary ? (primaryNameForOwner(ui.latestState, raw) || "") : "";
 const nextMode = linkPoascan || linkOwner
 ? (linkPoascan || !hasPoaSiteActions(ui.latestState, raw, ui.escrowMarket) ? "scan" : "owner")
 : "plain";
 if (wrap.dataset.poaPrimary !== nextPrimary || wrap.dataset.poaMode !== nextMode) {
 populatePoaAddressWrap(wrap, raw, {
 code: wrap.dataset.poaCode === "1",
 row: wrap.dataset.poaRow === "1",
 resolvePrimary,
 linkOwner,
 linkPoascan,
 onCopy,
 });
 }
 }
 for (const codeNode of [...root.querySelectorAll("code")]) {
 if (codeNode.closest(".poa-addr-inline, pre, button")) continue;
 const raw = codeNode.textContent?.trim() ?? "";
 if (!isPoaAddress(raw)) continue;
 const next = codeNode.nextElementSibling;
 if (next && next.tagName === "BUTTON" && next.textContent?.trim() === "📋 Copy to") next.remove();
 const wrap = document.createElement("span");
 populatePoaAddressWrap(wrap, raw, { code: true, row: true, onCopy });
 codeNode.replaceWith(wrap);
 }
 const walker = document.createTreeWalker(root, 4);
 const matches = [];
 let textNode;
 while ((textNode = walker.nextNode())) {
 const parent = textNode.parentElement;
 if (!parent || SKIP_ADDR_TAGS.has(parent.tagName) || parent.closest(".poa-addr-inline, pre, button, input, textarea")) continue;
 const val = textNode.nodeValue ?? "";
 if (!val.includes("poa1")) continue;
 POA_ADDR_IN_TEXT.lastIndex = 0;
 if (POA_ADDR_IN_TEXT.test(val)) matches.push(textNode);
 }
 for (const node of matches) {
 const val = node.nodeValue ?? "";
 POA_ADDR_IN_TEXT.lastIndex = 0;
 const frag = document.createDocumentFragment();
 let last = 0, m;
 while ((m = POA_ADDR_IN_TEXT.exec(val))) {
 if (m.index > last) frag.append(val.slice(last, m.index));
 appendPoaAddress(frag, m[0], { onCopy });
 last = m.index + m[0].length;
 }
 if (last < val.length) frag.append(val.slice(last));
 node.replaceWith(frag);
 }
}
export function endpointBase() {
 return ui.demo ? "http://127.0.0.1:8787" : ui.base || location.origin;
}
export function ownershipView() {
 const index = buildOwnershipIndex(ui.cap?.emojiOwnership);
 return index ? { manifest: ui.cap.emojiManifest, index } : null;
}
export function variantOwner(name) {
 const o = ownershipView();
 return o ? ownershipConflict(ui.latestState, name, o.manifest, o.index) : null;
}
export function statusLabel(status) {
 const map = {
 available: "🟢 Available",
 reserved: "🔴 Reserved",
 owned: "Owned",
 listed: "💰 For sale",
 leased: "📜 Legacy lease",
 "listed-lease": "📜 Legacy lease",
 "lease-grace": "📜 Legacy lease",
 "lease-expired": "📜 Legacy lease",
 "variant-taken": "🔴 Unavailable",
 "auction-current": "🔥 Live auction",
 "auction-upcoming": "⏳ Upcoming auction",
 "auction-past": "📜 Auction ended",
 "child-offer": "🟢 Available",
 "unminted-child": "🔴 Unavailable",
 unknown: "❓ Unknown",
 };
 return map[status] || status;
}
/** Link known names in human prose only; machine JSON remains inert and unchanged. */
export function namedText(node, text, names = Object.keys(ui.latestState?.names ?? {})) {
 let rest = String(text ?? "");
 const list = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length);
 const tail = /[\p{L}\p{N}\p{M}_\-\u200d\p{Extended_Pictographic}\p{Regional_Indicator}]$/u;
 const head = /^[\p{L}\p{N}\p{M}_\-\u200d\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
 while (rest) {
 let at = -1, match = "";
 for (const name of list) {
 let i = rest.indexOf(name);
 while (i >= 0) {
 const before = rest.slice(0, i), after = rest.slice(i + name.length);
 const left = tail.test(before) || (before.endsWith(".") && tail.test(before.slice(0, -1)));
 const right = head.test(after) || (after.startsWith(".") && head.test(after.slice(1)));
 if (!left && !right) { if (at < 0 || i < at) { at = i; match = name; } break; }
 i = rest.indexOf(name, i + name.length);
 }
 }
 if (at < 0) { node.append(rest); break; }
 node.append(rest.slice(0, at));
 const a = document.createElement("a");
 const entry = ui.latestState?.names?.[match];
 const isReg = Boolean(entry?.activeId && ui.latestState?.deeds?.[entry.activeId] && !ui.latestState.deeds[entry.activeId].retired);
 a.className = isReg ? "domain-name domain-link domain-tile is-registered" : "domain-name";
 a.href = "/d/" + encodeURIComponent(match); a.textContent = match;
 node.append(a); rest = rest.slice(at + match.length);
 }
 return node;
}
