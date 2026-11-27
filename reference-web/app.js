import { installHelp } from "./ui-help.js?v=1faf16f1702c";
import { wireManagement } from "./ui-manage.js?v=1faf16f1702c";
import { bindTabKeys } from "./ui-a11y.js?v=1faf16f1702c";
import { applySiteTitle, closeDetail, renderAuctions, setAuctionTab, wireExploreTabs } from "./ui-render.js?v=1faf16f1702c";
import { ui } from "./ui-state.js?v=1faf16f1702c";
import { canonical, digest, dismissNetworkBanner, instructions, isPoaAddress, loadBidderAddress, loadCart, loadKnownOwner, loadTabSeen, makeBody, parsePublicJSON, recheckCartItem, resolveOwnerInput, saveBidderAddress, shouldHoldTransactions } from "./shared.js?v=1faf16f1702c";
import { activeUserAddress, navigateHome, notifyOwnerChanged, openAdvanced, openPoa, restoreViewFromURL, setSectionTab, syncEscrowPayerAddress } from "./ui-router.js?v=1faf16f1702c";
import { el, endpointBase } from "./ui-core.js?v=1faf16f1702c";
import { clearHandoff, copyDomainListingPrompt, copySubnameListing, isTermsGateOpen, setFeedbackModalOpen, wireFeedbackModal, wireTermsGate } from "./ui-handoff.js?v=1faf16f1702c";
import { loadRegistry, pageStatus, refreshRegistry, renderNetworkStatus, updateFreshness } from "./ui-poll.js?v=1faf16f1702c";
import { submitSearchQuery, wireSearchAutocomplete } from "./ui-search.js?v=1faf16f1702c";
import { renderIdeas, updateIdeaContext } from "./ui-ideas.js?v=1faf16f1702c";
import { copyText, flashCopied, selectElementText } from "./ui-copy.js?v=1faf16f1702c";
import { cartCopyBlocked, downloadCartJSON, clearAllCart, persistCart, renderCart, renderCurrentCartHandoff, setFloatingCartOpen } from "./ui-cart.js?v=1faf16f1702c";
try {
 ui.statusPanelDismissed = false; // New page visits show status; closing lasts for this page only.
 applySiteTitle();
 installHelp();
 wireManagement();
 wireSearchAutocomplete();
 wireFeedbackModal();
 wireTermsGate();
 el("searchInput").addEventListener("input", updateIdeaContext);
 ui.cart = loadCart(globalThis.localStorage);
 ui.tabSeen = loadTabSeen(globalThis.localStorage);
 ui.bidderAddress = loadBidderAddress(globalThis.localStorage);
 ui.knownOwner = loadKnownOwner(globalThis.localStorage);
 const bidderInput = el("auctionsBidderInput");
 if (bidderInput) {
 bidderInput.value = ui.bidderAddress;
 const onBidderChange = () => {
 const v = bidderInput.value.trim();
 const resolved = isPoaAddress(v)
 ? v
 : (ui.latestState ? resolveOwnerInput(ui.latestState, v, ui.cap)?.owner : "");
 ui.bidderAddress = isPoaAddress(resolved) ? resolved : "";
 saveBidderAddress(globalThis.localStorage, ui.bidderAddress);
 if (ui.bidderAddress) syncEscrowPayerAddress(ui.bidderAddress);
 notifyOwnerChanged();
 };
 bidderInput.addEventListener("input", onBidderChange);
 bidderInput.addEventListener("change", onBidderChange);
 }
 restoreViewFromURL();
 const keys = () => {
 el("keys").textContent = JSON.stringify(ui.cap?.actions?.[el("action").value] ?? {});
 };
 el("action").addEventListener("change", keys);
 el("handoff").addEventListener("input", clearHandoff);
 el("handoff").addEventListener("change", clearHandoff);
 keys();
 for (const id of ["refresh", "registryRetry"])
 el(id).addEventListener("click", () => ui.readState ? refreshRegistry() : loadRegistry());
 bindTabKeys(el("sectionTabs"), tab => tab.click());
 bindTabKeys(document.querySelector(".auction-tabs"), tab => tab.click());
 wireExploreTabs();
 for (const btn of document.querySelectorAll(".section-tab")) {
 btn.addEventListener("click", () => {
 const id = btn.getAttribute("data-tab") || "find";
 setSectionTab(id, true);
 btn.scrollIntoView({ block: "nearest", inline: "nearest" });
 });
 }
 const siteHeader = el("siteTitle")?.closest("header") || el("siteTitle");
 siteHeader?.addEventListener("click", (event) => {
 if (event.button !== undefined && event.button !== 0) return;
 navigateHome();
 if (ui.activeSectionTab !== "find") setSectionTab("find", true, "/");
 applySiteTitle({ creative: true });
 });
 el("advancedLink")?.addEventListener("click", (event) => {
 if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
 event.preventDefault();
 openAdvanced();
 });
 el("poaSellBtn")?.addEventListener("click", () => openPoa(ui.currentDomainName, { mode: "sell" }));
 el("poaAuctionBtn")?.addEventListener("click", () => openPoa(ui.currentDomainName, { mode: "auction" }));
 el("poaSubnameBtn")?.addEventListener("click", copySubnameListing);
 el("copyListPromptBtn")?.addEventListener("click", () => copyDomainListingPrompt("list"));
 el("copyChangePromptBtn")?.addEventListener("click", () => copyDomainListingPrompt("change"));
 el("copyUnlistPromptBtn")?.addEventListener("click", () => copyDomainListingPrompt("unlist"));
 window.addEventListener("popstate", restoreViewFromURL);
 window.addEventListener("pageshow", (event) => { if (event.persisted) applySiteTitle({ creative: true }); });
 el("searchBtn").addEventListener("click", () => submitSearchQuery());
 el("clearCart").addEventListener("click", clearAllCart);
 el("downloadCartJSON").addEventListener("click", downloadCartJSON);
 el("copyCartPrompt").addEventListener("click", async () => {
 if (shouldHoldTransactions(ui.networkStatus.lastKnown === true ? "checking" : ui.networkStatus.level) || ui.networkStatus.hold) {
 el("cartStatus").textContent = "Held ⏸️ until the PoA network is back";
 return;
 }
 if (!ui.cart.length || cartCopyBlocked() || ui.handoffPending || !ui.handoffData)
 return;
 const text = renderCurrentCartHandoff();
 if (!text) return;
 const res = await copyText(text, el("cartPrompt"));
 if (res.ok) {
 flashCopied(el("copyCartPrompt"));
 el("cartStatus").textContent = "✅ Copied";
 el("cartStatus").dataset.copiedFor = String(ui.cart.length);
 } else {
 el("cartStatus").textContent = res.selected ? "📋 Press Ctrl/Cmd+C to copy the selected prompt." : "📋 Copy from the prompt box above.";
 }
 });
 for (const tab of document.querySelectorAll(".auction-tab")) {
 tab.addEventListener("click", () => {
 setAuctionTab(tab.getAttribute("data-auction-tab") || "current", { user: true, render: true });
 });
 }
 el("detailClose").addEventListener("click", closeDetail);
 el("floatingCartBtn").addEventListener("click", () => setFloatingCartOpen(true));
 el("floatingCartClose").addEventListener("click", () => setFloatingCartOpen(false));
 el("floatingCartBackdrop").addEventListener("click", () => setFloatingCartOpen(false));
 el("floatingCartClear").addEventListener("click", clearAllCart);
 el("floatingDownloadCartJSON")?.addEventListener("click", downloadCartJSON);
 el("copyCheckoutBtn").addEventListener("click", async () => {
 if (shouldHoldTransactions(ui.networkStatus.lastKnown === true ? "checking" : ui.networkStatus.level) || ui.networkStatus.hold) {
 el("floatingCartStatus").textContent = "Held ⏸️ until the PoA network is back";
 return;
 }
 if (!ui.cart.length || !ui.cap || cartCopyBlocked() || ui.handoffPending || !ui.handoffData)
 return;
 const text = renderCurrentCartHandoff();
 if (!text) return;
 const fp = el("floatingCartPrompt"), res = await copyText(text);
 if (fp) { fp.textContent = text; fp.hidden = false; }
 if (res.ok) {
 flashCopied(el("copyCheckoutBtn"));
 el("floatingCartStatus").textContent = "✅ Request copied — nothing sent";
 } else {
 if (fp) selectElementText(fp);
 el("floatingCartStatus").textContent = "📋 Press Ctrl/Cmd+C to copy the selected request.";
 }
 });
 document.addEventListener("keydown", (event) => {
 if (event.key !== "Escape")
 return;
 if (isTermsGateOpen()) {
 event.preventDefault();
 return;
 }
 if (document.querySelector(".info-popover:popover-open")) return;
 if (!el("feedbackModal")?.hidden)
 setFeedbackModalOpen(false);
 else if (!el("floatingCartPanel").hidden)
 setFloatingCartOpen(false);
 else if (!el("detailView").hidden)
 closeDetail();
 });
 const dismissBtn = el("networkStatusDismiss");
 if (dismissBtn) {
 dismissBtn.addEventListener("click", () => {
 ui.statusPanelDismissed = true;
 renderNetworkStatus();
 });
 }
 el("example").addEventListener("click", () => {
 const x = ui.examples[el("action").value];
 if (!x)
 return;
 for (const key of [
 "signer",
 "requestId",
 "nonce",
 "notBefore",
 "deadline",
 "maxTotal",
 "maxNetworkFee",
 ])
 el(key).value = String(x[key]);
 el("coSigners").value = JSON.stringify(x.coSigners);
 el("params").value = JSON.stringify(x.params, null, 2);
 el("body").textContent = "";
 el("instructions").textContent = "";
 el("digest").textContent = "";
 clearHandoff();
 });
 el("handoff").addEventListener("submit", async (event) => {
 event.preventDefault();
 el("error").textContent = "";
 clearHandoff();
 const selectedGeneration = ui.generation;
 try {
 const input = {};
 for (const id of [
 "signer",
 "requestId",
 "maxTotal",
 "maxNetworkFee",
 "action",
 ])
 input[id] = el(id).value;
 for (const id of ["nonce", "notBefore", "deadline"]) {
 if (!/^(0|[1-9][0-9]*)$/.test(el(id).value))
 throw Error("Integer");
 input[id] = Number(el(id).value);
 }
 input.coSigners = parsePublicJSON(el("coSigners").value);
 input.params = parsePublicJSON(el("params").value);
 const body = makeBody(input, ui.cap), id = await digest(body), note = instructions(body, id, ui.configMode);
 if (selectedGeneration !== ui.generation)
 return;
 el("copy").disabled = false;
 el("body").textContent = canonical(body);
 el("digest").textContent = id;
 el("instructions").textContent = note;
 ui.copy = note + "\n" + canonical(body);
 }
 catch {
 el("error").textContent =
 "Invalid public input. Check exact schema, canonical fields, principals, versions, caps and validity. No request was sent.";
 }
 });
 el("copy").addEventListener("click", async () => {
 if (ui.copy && !ui.registryReadFailed && !shouldHoldTransactions(ui.networkStatus.lastKnown === true ? "checking" : ui.networkStatus.level) && !ui.networkStatus.hold) {
 const res = await copyText(ui.copy, el("body"));
 const note = el("handoffCopyStatus");
 if (res.ok) {
 flashCopied(el("copy"));
 if (note) note.textContent = "✅ Copied";
 } else {
 selectElementText(el("instructions"));
 if (note) note.textContent = "📋 Copy the unsigned text manually.";
 else el("error").textContent = "Clipboard unavailable; copy the inert text manually.";
 }
 }
 });
 setInterval(updateFreshness, 60000);
 await loadRegistry();
}
catch {
 pageStatus("📡 Couldn't load registry data. Tap 🔄 Refresh.");
}
