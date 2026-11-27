import {
 activePoaFixedListings,
 activeResaleOffers,
 collectPreviousDomainFields,
 domainPath,
 extractDomainProfile,
 findDomainSalesAndAuctions,
 formatClock,
 formatCountdown,
 formatDuration,
 isOwnDomainOrListing,
 isPoaAddress,
 isPoaAuctionAwaitingFirstBid,
 minimumNextBid,
 partitionPoaAuctions,
 poaAmount,
 poaAuctionOutbidStatus,
 poaMinimumNextBid,
 poaOnlyMode,
 poaShort,
 poaToMicros,
 primaryNameForOwner,
 publicNameUnavailable,
 registryUnit,
 resolveDomainView,
 resolveOwnerInput,
 unavailableKey,
} from "./shared.js?v=6392e78aa9c6";
import { actionLabel, copyText, createPoaCopyButton, flashCopied } from "./ui-copy.js?v=6392e78aa9c6";
import { createInlineInfo } from "./ui-help.js?v=6392e78aa9c6";
import { ui } from "./ui-state.js?v=6392e78aa9c6";
import { add, appendPoaAddress, appendPrincipal, appendTextWithPoaAddress, el, namedText, ownershipView, person, statusLabel } from "./ui-core.js?v=6392e78aa9c6";
import { activeUserAddress, domainHeader, nameLink, openManageDomain, openPoa, ownerLink, renderSelfBidNotice } from "./ui-router.js?v=6392e78aa9c6";
import { addDetailToCart, addToCart, setFloatingCartOpen } from "./ui-cart.js?v=6392e78aa9c6";

function appendCopyableValue(parent, value, ariaLabel, { shorten = true } = {}) {
 const wrap = document.createElement("span");
 wrap.className = "poa-addr-inline";
 const code = document.createElement("code");
 code.className = "poa-addr-text";
 code.textContent = shorten && value.length > 18 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
 code.title = value;
 wrap.append(code, createPoaCopyButton(value, { ariaLabel }));
 parent.append(wrap);
}

function appendRecordRow(parent, rec, name, { ownerPageId = null } = {}) {
 if (!rec || typeof rec !== "object") return;
 if (rec.type === "wallet") {
  const row = add(parent, "p", `Wallet (${rec.chain}): `, "record");
  const addr = String(rec.address ?? "");
  if (isPoaAddress(addr)) {
   appendPoaAddress(row, addr, {
    code: true,
    ariaLabel: `Copy ${rec.chain} wallet record for ${name}`,
    linkPoascan: Boolean(ownerPageId && addr === ownerPageId),
   });
  } else {
   appendCopyableValue(row, addr, `Copy ${rec.chain} wallet record for ${name}`);
  }
 } else if (rec.type === "service") {
  const row = add(parent, "p", "Service: ", "record");
  appendCopyableValue(row, String(rec.url ?? ""), `Copy service record for ${name}`, { shorten: false });
 } else if (rec.type === "ipfs") {
  const row = add(parent, "p", "IPFS: ", "record");
  appendCopyableValue(row, String(rec.cid ?? ""), `Copy IPFS record for ${name}`);
 }
}

function appendActivityDetails(parent, history) {
 if (!Array.isArray(history) || !history.length) return;
 const det = document.createElement("details");
 add(det, "summary", `📜 Activity (${history.length})`);
 for (const h of [...history].reverse()) {
  const row = add(
   det,
   "p",
   `${h.event}${h.amount ? ` · ${poaShort(h.amount)} POA` : ""}${h.at ? ` · ${formatClock(Math.floor(h.at / 1000))}` : ""}`,
   "muted",
  );
  if (h.payer) {
   row.append(" · ");
   appendPrincipal(row, h.payer);
  }
 }
 parent.append(det);
}

function renderProfileInto(box, deed, { listedForSale = false, showCleanSlate = true, ownerPageId = null } = {}) {
 if (!box) return;
 box.replaceChildren();
 if (!deed) {
  box.hidden = true;
  return;
 }
 const extracted = extractDomainProfile(deed);
 const activeRecords = Array.isArray(deed.records) ? deed.records : [];
 const hasActiveProfile = Boolean(extracted && !extracted.isDefault);
 const wasReset = Number(deed.profileResetAt) > 0;

 if (listedForSale) {
  box.hidden = true;
  return;
 }

 if (!hasActiveProfile && !activeRecords.length) {
  if (showCleanSlate && wasReset) {
   box.hidden = false;
   add(
    box,
    "p",
    "✨ Clean slate for current holder — previous fields are archived below.",
    "domain-clean-slate",
   );
   return;
  }
  box.hidden = true;
  return;
 }

 box.hidden = false;
 let imageUri = null;
 let contentCid = null;
 if (hasActiveProfile) {
  const p = extracted.profile;
  imageUri = p.image || null;
  contentCid = extracted.cid || null;
  if (p.description) add(box, "p", p.description, "domain-profile-bio");
  const fields = add(box, "div", "", "domain-profile-fields");
  const poaRow = add(fields, "p", "POA: ", "record");
  appendPoaAddress(poaRow, p.poa, { code: true, linkPoascan: Boolean(ownerPageId && p.poa === ownerPageId) });
  if (p.btc) {
   const btcRow = add(fields, "p", "BTC: ", "record");
   appendCopyableValue(btcRow, p.btc, `Copy BTC address for ${deed.name}`);
  }
  if (p.eth) {
   const ethRow = add(fields, "p", "ETH / Base: ", "record");
   appendCopyableValue(ethRow, p.eth, `Copy ETH address for ${deed.name}`);
  }
 }
 if (imageUri || contentCid || activeRecords.length) {
  const more = document.createElement("details");
  more.className = "domain-more";
  add(more, "summary", "More");
  if (imageUri) {
   const linkLine = add(more, "p", "Avatar: ", "muted");
   if (imageUri.startsWith("https://")) {
    const a = document.createElement("a");
    a.href = imageUri;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = imageUri;
    linkLine.append(a);
   } else {
    add(linkLine, "code", imageUri);
   }
  }
  if (contentCid) {
   const cidRow = add(more, "p", "Content ID: ", "muted");
   add(cidRow, "code", contentCid);
  }
  if (activeRecords.length) {
   const recBox = add(more, "div", "", "domain-records-list");
   add(recBox, "h4", "Attached domain records");
   for (const rec of activeRecords) appendRecordRow(recBox, rec, deed.name, { ownerPageId });
  }
  box.append(more);
 }
}

function renderDomainProfileCard(deed, { listedForSale = false } = {}) {
 renderProfileInto(el("domainProfile"), deed, { listedForSale, showCleanSlate: true });
}

function renderDomainPreviousFields(deed, { listedForSale = false } = {}) {
 const box = el("domainPreviousFields");
 if (!box) return;
 box.replaceChildren();
 const entries = collectPreviousDomainFields(deed, { listedForSale });
 if (!entries.length) {
  box.hidden = true;
  return;
 }
 box.hidden = false;
 add(box, "h3", `📚 Previous fields & records (${entries.length})`);
 add(box, "p", "Read-only archive of inactive fields and records.", "muted");
 for (const entry of entries) {
  const item = add(box, "article", "", "domain-prev-entry");
  item.dataset.recordStatus = entry.status;
  add(item, "p", entry.label, entry.status === "paused" ? "badge-warn" : "badge");
  if (entry.owner || entry.transferredAt || entry.metadataVersion) {
   const meta = add(item, "p", "", "muted");
   let first = true;
   if (entry.owner) {
    meta.append("Holder: ");
    appendPrincipal(meta, entry.owner);
    first = false;
   }
   if (entry.ownerVersion) {
    meta.append(`${first ? "" : " · "}owner v${entry.ownerVersion}`);
    first = false;
   }
   if (entry.transferredAt) {
    meta.append(`${first ? "" : " · "}transferred ${formatClock(entry.transferredAt)}`);
    first = false;
   }
   if (entry.metadataVersion) {
    meta.append(`${first ? "" : " · "}metadata #${entry.metadataVersion}`);
   }
  }
  if (entry.profile) {
   const p = entry.profile;
   if (p.description) add(item, "p", `Bio: ${p.description}`, "domain-profile-bio");
   const poaRow = add(item, "p", "POA: ", "record");
   appendPoaAddress(poaRow, p.poa, { code: true });
   if (p.btc) {
    const btcRow = add(item, "p", "BTC: ", "record");
    appendCopyableValue(btcRow, p.btc, `Copy previous BTC address for ${deed.name}`);
   }
   if (p.eth) {
    const ethRow = add(item, "p", "ETH / Base: ", "record");
    appendCopyableValue(ethRow, p.eth, `Copy previous ETH address for ${deed.name}`);
   }
   if (p.image) {
    const imgRow = add(item, "p", "Avatar URI: ", "muted");
    add(imgRow, "code", p.image);
   }
  } else if (entry.description) {
   add(item, "p", `Description: ${entry.description}`, "domain-profile-bio");
  }
  if (entry.records?.length) {
   for (const rec of entry.records) appendRecordRow(item, rec, deed.name);
  }
  if (entry.cid) {
   const cidRow = add(item, "p", "CID: ", "muted");
   add(cidRow, "code", entry.cid);
  }
 }
}

function renderDomainSalesAndAuctions(name, view, salesInfo, poa, nowMs) {
 const listingBox = el("domainListing");
 if (!listingBox) return;
 listingBox.replaceChildren();
 const showRegListing = Boolean(!poa && view.listing);
 const showRegAuction = Boolean(!poa && view.auction);
 const showAny =
  salesInfo.activePoaAuctions.length > 0 ||
  salesInfo.activePoaSales.length > 0 ||
  salesInfo.pastPoaItems.length > 0 ||
  showRegListing ||
  showRegAuction;
 listingBox.hidden = !showAny;
 if (!showAny) return;

 add(listingBox, "h3", "🏷️ Auctions & Sales");
 const list = add(listingBox, "div", "", "domain-sales-list");

 const userAddr = activeUserAddress();
 for (const a of salesInfo.activePoaAuctions) {
  const item = add(list, "article", "", "domain-sale-item is-active");
  item.dataset.auctionId = a.id;
  const awaiting = isPoaAuctionAwaitingFirstBid(a);
  const closed = !awaiting && a.closes > 0 && nowMs >= a.closes;
  const minNext = poaMinimumNextBid(a);
  const cartItem = ui.cart.find((x) => x.action === "poaBid" && x.params?.auctionId === a.id) ?? null;
  const isOwn = isOwnDomainOrListing({ name, seller: a.seller, deed: view.deed, state: ui.latestState, userAddress: userAddr });
  const outbidInfo = poaAuctionOutbidStatus(a, { bidderAddress: ui.bidderAddress || userAddr, cartItem, state: ui.latestState });

  if (a.status === "SETTLING") {
   add(item, "p", "⏳ Settling", "badge");
  } else if (awaiting) {
   add(item, "p", "⏳ Starts on first bid", "badge");
  } else if (closed) {
   add(item, "p", "⏰ Awaiting handover", "badge");
  } else {
   add(item, "p", `🔥 Live auction · High bid ${poaShort(a.high?.amount ?? a.price)} POA`, "badge-ok");
  }

  if (outbidInfo.status === "leading") add(item, "p", outbidInfo.message, "auction-leading-badge");
  else if (outbidInfo.status === "outbid" || outbidInfo.status === "outbid-covered")
   appendTextWithPoaAddress(add(item, "p", "", "auction-outbid-badge"), outbidInfo.message, outbidInfo.currentHighPayer);

  const bidLine = add(item, "p", `Reserve ${poaShort(a.price)} POA · `);
  if (a.high) {
   bidLine.append(`High bid ${poaShort(a.high.amount)} POA by `);
   ownerLink(bidLine, a.high.payer, person(a.high.payer));
  } else {
   bidLine.append("No bids yet.");
  }
  const sellerLine = add(item, "p", "Seller: ", "muted");
  ownerLink(sellerLine, a.seller, person(a.seller));

  const windowSec = Math.round((a.window ?? a.quiet ?? 3600000) / 1000);
  if (awaiting) {
   add(item, "p", `⏱️ ${formatDuration(windowSec)} timer · starts on first bid`, "muted");
  } else if (a.closes > 0) {
   const closeRow = add(item, "p", "");
   if (a.status === "OPEN" && !closed) {
    const cd = add(closeRow, "span", `⏳ ${formatCountdown(a.closes - nowMs)}`, "auction-countdown");
    cd.dataset.closesMs = String(a.closes);
    closeRow.append(" · ");
   }
   closeRow.append(`Closes ${formatClock(Math.floor(a.closes / 1000))}`);
  }

  if (a.status === "OPEN" && (awaiting || !closed)) {
   add(item, "p", `Minimum ${awaiting ? "opening" : "next"} bid: ${poaShort(minNext)} POA`, "badge-ok");
   if (isOwn) {
    renderSelfBidNotice(item, { kind: "auction" });
   } else {
    if (cartItem) add(item, "p", `🛒 In cart · highest bid cap ${poaShort(cartItem.amount)} POA`, "muted");
    const controls = add(item, "div", "", "auction-bid-controls");
    const bidLabel = add(controls, "label", "Your highest bid (POA)");
    const bidInput = document.createElement("input");
    bidInput.type = "text";
    bidInput.inputMode = "decimal";
    bidInput.dataset.fieldKey = `domainPoaBid:${a.id}`;
    bidInput.value = cartItem ? poaShort(cartItem.amount) : poaShort(minNext);
    bidInput.placeholder = poaShort(minNext);
    bidInput.setAttribute("aria-label", `Your highest bid in POA for ${name}`);
    bidLabel.append(bidInput);
    const btn = add(controls, "button", cartItem ? "Update cart bid" : "Add to cart", "small");
    btn.type = "button";
    btn.setAttribute("aria-label", `Add ${name} auction bid to cart`);
    const err = add(item, "p", "", "badge-warn");
    err.setAttribute("role", "alert");
    btn.addEventListener("click", () => {
     try {
      const exact = poaAmount(bidInput.value);
      if (poaToMicros(exact) < poaToMicros(minNext))
       throw Error(`⚠️ Enter at least ${poaShort(minNext)} POA.`);
      err.textContent = "";
      bidInput.removeAttribute("aria-invalid");
      addToCart({ name, action: "poaBid", amount: exact, auctionId: a.id });
      setFloatingCartOpen(true);
      renderDomainPage(name);
     } catch (e) {
      err.textContent = e?.message || `⚠️ Enter at least ${poaShort(minNext)} POA.`;
      bidInput.setAttribute("aria-invalid", "true");
     }
    });
   }
  }
  appendActivityDetails(item, a.history);
 }

 for (const s of salesInfo.activePoaSales) {
  const item = add(list, "article", "", "domain-sale-item is-active");
  item.dataset.saleId = s.id;
  add(
   item,
   "p",
   s.status === "SETTLING"
    ? "⏳ Settling"
    : s.high
     ? "⏳ Awaiting handover"
     : `💰 For sale · ${poaShort(s.price)} POA`,
   s.high || s.status === "SETTLING" ? "badge" : "badge-ok",
  );
  const sellerLine = add(item, "p", "Seller: ", "muted");
  ownerLink(sellerLine, s.seller, person(s.seller));
  if (s.high) {
   const buyerLine = add(item, "p", `Reserved at ${poaShort(s.high.amount)} POA by `);
   ownerLink(buyerLine, s.high.payer, person(s.high.payer));
  }
  if (s.closes > 0) add(item, "p", `Until ${formatClock(Math.floor(s.closes / 1000))}`, "muted");
  if (s.status === "OPEN" && !s.high) {
   const buyBtn = add(item, "button", "🪙 Open My POA to buy", "small");
   buyBtn.type = "button";
   buyBtn.addEventListener("click", () => openPoa(name));
  }
  appendActivityDetails(item, s.history);
 }

 if (showRegListing) {
  const item = add(list, "article", "", "domain-sale-item is-active");
  add(item, "p", `💰 Listed for ${view.listing.price} ${registryUnit(view.listing.asset)}`, "badge-ok");
  add(item, "p", `Until ${formatClock(view.listing.validUntil)} · offer ${view.listing.id.slice(0, 18)}…`);
 }

 if (showRegAuction) {
  const a = view.auction;
  const item = add(list, "article", "", a.status === "live" ? "domain-sale-item is-active" : "domain-sale-item");
  add(item, "p", `🏷️ Registry auction · ${a.status}${view.auctionBucket ? ` (${view.auctionBucket})` : ""}`, a.status === "live" ? "badge-ok" : "badge");
  const bidLine = add(item, "p", `Reserve ${a.reserve} ${registryUnit(a.asset)} · `);
  if (a.high) {
   bidLine.append(`High bid ${a.high.amount} by `);
   appendPrincipal(bidLine, a.high.payer);
  } else {
   bidLine.append("No active bids.");
  }
 }

 for (const p of salesInfo.pastPoaItems) {
  const item = add(list, "article", "", "domain-sale-item");
  item.dataset.pastSaleId = p.id;
  const kindLabel = p.kind === "fixed" ? "💰 Past POA Sale" : "🏷️ Past POA Auction";
  const statusText = p.status === "COMPLETE" ? "✅ Complete" : p.status === "CANCELLED" ? "✖️ Cancelled" : p.status;
  add(item, "p", `${kindLabel} · ${statusText}`, p.status === "COMPLETE" ? "badge-ok" : "badge");
  const priceLine = add(
   item,
   "p",
   p.high
    ? `Final: ${poaShort(p.high.amount)} POA (${p.kind === "fixed" ? "Ask" : "Reserve"} ${poaShort(p.price)} POA)`
    : `${p.kind === "fixed" ? "Ask" : "Reserve"}: ${poaShort(p.price)} POA · No bids`,
  );
  if (p.high?.payer) {
   priceLine.append(" · Buyer: ");
   ownerLink(priceLine, p.high.payer, person(p.high.payer));
  }
  const sellerLine = add(item, "p", "Seller: ", "muted");
  ownerLink(sellerLine, p.seller, person(p.seller));
  appendActivityDetails(item, p.history);
 }
}

function syncDomainCopyLink(name, visible) {
 const btn = el("domainCopyLink");
 if (!btn) return;
 if (!visible || !name) {
  btn.hidden = true;
  delete btn.dataset.copyUrl;
  return;
 }
 const slugUrl = new URL(domainPath(name), location.origin).href;
 btn.hidden = false;
 btn.dataset.copyUrl = slugUrl;
 btn.title = slugUrl;
 delete btn.dataset.copyIdleTitle;
 btn.setAttribute("aria-label", `Copy link for ${name}`);
 if (btn.dataset.wired !== "1") {
  btn.dataset.wired = "1";
  btn.addEventListener("click", async () => {
   const url = btn.dataset.copyUrl;
   if (!url) return;
   const res = await copyText(url);
   if (res.ok) flashCopied(btn);
  });
 }
}

export function renderDomainPage(name) {
 if (!ui.latestState || !name) return;
 if (publicNameUnavailable(name, ui.cap)) {
  syncDomainCopyLink(name, false);
  el("domainTitle").classList.remove("domain-heading");
  el("domainTitle").textContent = "Unavailable";
  el("domainStatus").hidden = false;
  el("domainStatus").textContent = "🔴 Unavailable";
  el("domainOwner").textContent = "No public ownership record.";
  for (const id of ["domainProfile", "domainListing", "domainPreviousFields"]) {
   const node = el(id);
   if (node) {
    node.hidden = true;
    node.replaceChildren();
   }
  }
  el("domainActions").replaceChildren();
  el("domainHistory").replaceChildren();
  add(el("domainHistory"), "p", "No public history.");
  el("domainOwnerTools").hidden = true;
  return;
 }
 syncDomainCopyLink(name, true);
 const view = resolveDomainView(ui.latestState, name, ui.reservedSet, ownershipView());
 const poa = poaOnlyMode(ui.cap);
 const nowMs = ui.escrowMarketServerTime || Date.now();
 const salesInfo = findDomainSalesAndAuctions({
  name,
  view,
  state: ui.latestState,
  escrowMarket: ui.escrowMarket,
  nowMs,
 });

 el("domainTitle").replaceChildren();
 domainHeader(el("domainTitle"), name, { size: "lg" });
 const statusEl = el("domainStatus");
 if (salesInfo.activePoaAuctions.length) {
  const first = salesInfo.activePoaAuctions[0];
  statusEl.hidden = false;
  statusEl.textContent = isPoaAuctionAwaitingFirstBid(first)
   ? "⏳ Starts on first bid"
   : "🔥 Live auction";
 } else if (salesInfo.activePoaSales.length) {
  statusEl.hidden = false;
  statusEl.textContent = "💰 For sale";
 } else if (view.status === "owned") {
  statusEl.hidden = true;
  statusEl.textContent = "";
 } else {
  statusEl.hidden = false;
  statusEl.textContent = statusLabel(view.status);
 }

 const ownerNode = el("domainOwner");
 ownerNode.replaceChildren();
 if (view.owner) {
  ownerNode.append("Owner: ");
  ownerLink(ownerNode, view.owner, person(view.owner));
 } else if (view.variantOf) {
  ownerNode.append("🔒 Same emoji as ");
  nameLink(ownerNode, view.variantOf);
 } else {
  ownerNode.textContent = "No owner yet";
 }

 renderDomainProfileCard(view.deed, { listedForSale: salesInfo.listedForSale });
 renderDomainSalesAndAuctions(name, view, salesInfo, poa, nowMs);

 const actions = el("domainActions");
 actions.replaceChildren();
 if (view.deed && !view.deed.retired) {
  const manageBtn = add(actions, "button", "⚙️", "secondary small manage-domain-gear");
  manageBtn.type = "button";
  manageBtn.setAttribute("aria-label", `Manage ${name}`);
  manageBtn.title = `Manage ${name}`;
  manageBtn.addEventListener("click", () => openManageDomain(name, view.deed.owner));
 }
 if (!poa && view.auction && view.auction.status === "live" && view.auctionBucket === "current" &&
   !isOwnDomainOrListing({ name, seller: view.auction.seller, deed: view.deed, state: ui.latestState, userAddress: activeUserAddress() })) {
  const minBid = view.auction.high
   ? minimumNextBid(view.auction.high.amount, ui.cap.increment)
   : view.auction.reserve;
  const bidBtn = add(actions, "button", `🏷️ Bid from ${minBid}`);
  bidBtn.type = "button";
  bidBtn.addEventListener("click", () => {
   addToCart({
    name,
    action: "bid",
    amount: minBid,
    auctionId: view.auction.id,
   });
   setFloatingCartOpen(true);
  });
 }
 if (!poa && view.listing && view.listing.asset === "POA") {
  const buyBtn = add(actions, "button", `🛒 Buy ${view.listing.price} registry units`);
  buyBtn.type = "button";
  buyBtn.addEventListener("click", () => {
   addToCart({
    name,
    action: "buyFixed",
    amount: view.listing.price,
    offerId: view.listing.id,
   });
   setFloatingCartOpen(true);
  });
 }
 if (view.status === "available" && !salesInfo.activePoaAuctions.length && !salesInfo.activePoaSales.length) {
  const startBtn = add(actions, "button", poa ? "🛒 Add to cart" : "🟢 Start auction (add to cart)");
  startBtn.type = "button";
  startBtn.addEventListener("click", () => {
   addDetailToCart({ name, kind: "available" });
   setFloatingCartOpen(true);
  });
 }

 const tools = el("domainOwnerTools");
 tools.hidden = !view.deed;
 const availableToList = Boolean(view.deed && !view.deed.retired && !salesInfo.listedForSale && !view.deed.lock);
 if (el("poaSellTools")) el("poaSellTools").hidden = !poa;
 if (el("poaSellBtn")) el("poaSellBtn").hidden = !availableToList;
 if (el("poaAuctionBtn")) el("poaAuctionBtn").hidden = !availableToList;
 const poaSellActions = el("poaSellActions");
 if (poaSellActions) {
  let sellInfo = el("poaSellSaleWarn");
  if (!sellInfo) {
   sellInfo = createInlineInfo(
    "domain-sale-warn",
    "About profile fields when selling or auctioning",
    "Listing or auctioning pauses profile fields and drops them on transfer (archived as read-only history on the domain page).",
   );
   sellInfo.id = "poaSellSaleWarn";
   poaSellActions.append(sellInfo);
  }
  poaSellActions.hidden = !availableToList;
  sellInfo.hidden = !availableToList;
 }
 if (el("poaSubnameTools")) el("poaSubnameTools").hidden = !poa || String(ui.currentDomainName ?? "").includes(".");
 if (el("unitSellTools")) el("unitSellTools").hidden = poa;
 el("listingPromptStatus").textContent = "";
 if (view.listing?.price) el("listPriceInput").value = view.listing.price;

 renderDomainPreviousFields(view.deed, { listedForSale: salesInfo.listedForSale });

 const hist = el("domainHistory");
 hist.replaceChildren();
 if (!view.history.length) add(hist, "p", "No history yet", "muted");
 for (const row of view.history) {
  const card = add(hist, "div", "", "card");
  namedText(add(card,"p",""),row.text);
  add(card, "p", `#${row.sequence} · ${actionLabel(row.kind)}`, "badge");
 }
}

export function renderOwnerPage(rawOwnerId) {
 if (!ui.latestState || !rawOwnerId) return;
 const titleEl = el("ownerTitle");
 const principalNode = el("ownerPrincipal");
 const profileBox = el("ownerProfile");
 const namesBox = el("ownerNames");
 const listBox = el("ownerListings");
 const resolved = resolveOwnerInput(ui.latestState, rawOwnerId, ui.cap);
 const ownerId = resolved?.owner ?? rawOwnerId;
 if (ui.cap?.publicView?.unavailableAccountKeys?.includes(unavailableKey(ownerId))) {
  titleEl.classList.remove("domain-heading");
  titleEl.textContent = "No public owner profile";
  principalNode.textContent = "";
  if (profileBox) {
   profileBox.hidden = true;
   profileBox.replaceChildren();
  }
  namesBox.replaceChildren();
  listBox.replaceChildren();
  add(namesBox, "p", "No public registry names or subdomains.");
  add(listBox, "p", "No public listings.");
  return;
 }
 const primary = primaryNameForOwner(ui.latestState, ownerId);
 const primaryEntry = primary ? ui.latestState.names?.[primary] : null;
 const primaryDeed = primaryEntry?.activeId ? ui.latestState.deeds?.[primaryEntry.activeId] : null;
 titleEl.replaceChildren();
 if (primary && primaryDeed) {
  domainHeader(titleEl, primary, { size: "lg" });
  add(titleEl, "span", "⭐ Main domain", "badge-ok owner-primary-badge");
 } else {
  titleEl.classList.remove("domain-heading");
  titleEl.textContent = "👤 Owner profile";
 }
 principalNode.replaceChildren();
 if (resolved?.viaDomain && resolved.viaDomain !== primary) {
  principalNode.append("Owner of ");
  nameLink(principalNode, resolved.viaDomain);
  principalNode.append(" · ");
 }
 appendPoaAddress(principalNode, ownerId, { code: true, resolvePrimary: false, linkPoascan: true });

 const nowMs = ui.escrowMarketServerTime || Date.now();
 if (profileBox) {
  if (primaryDeed) {
   const primarySale = findDomainSalesAndAuctions({
    name: primary,
    deed: primaryDeed,
    state: ui.latestState,
    escrowMarket: ui.escrowMarket,
    nowMs,
   });
   renderProfileInto(profileBox, primaryDeed, {
    listedForSale: primarySale.listedForSale,
    showCleanSlate: false,
    ownerPageId: ownerId,
   });
  } else {
   profileBox.hidden = true;
   profileBox.replaceChildren();
  }
 }

 namesBox.replaceChildren();
 listBox.replaceChildren();
 const ownedRaw = Object.values(ui.latestState.names ?? {}).filter(
  (n) => n.activeId && ui.latestState.deeds[n.activeId]?.owner === ownerId,
 );
 const owned = primary
  ? [...ownedRaw.filter((n) => n.name === primary), ...ownedRaw.filter((n) => n.name !== primary)]
  : ownedRaw;
 if (!owned.length) add(namesBox, "p", "No names", "muted");
 for (const n of owned) {
  const d = ui.latestState.deeds[n.activeId];
  const card = add(namesBox, "article", "", "card has-manage-gear");
  const h = add(card, "h4", "");
  domainHeader(h, n.name);
  if (primary && n.name === primary) add(card, "p", "⭐ Main domain", "badge-ok");
  if (d.rights.kind === "lease") add(card, "p", "📜 Legacy lease", "badge");
  const manageBtn = add(card, "button", "⚙️", "secondary small manage-domain-gear");
  manageBtn.type = "button";
  manageBtn.setAttribute("aria-label", `Manage ${n.name}`);
  manageBtn.title = `Manage ${n.name}`;
  manageBtn.addEventListener("click", () => openManageDomain(n.name, d.owner));
 }
 if (poaOnlyMode(ui.cap)) {
  const fixed = activePoaFixedListings(ui.escrowMarket ?? [], nowMs).filter((x) => x.seller === ownerId);
  const poaGroups = partitionPoaAuctions(ui.escrowMarket ?? [], nowMs);
  const auctions = [...poaGroups.current, ...poaGroups.upcoming].filter((x) => x.seller === ownerId);
  if (!fixed.length && !auctions.length) {
   add(listBox, "p", "No active listings", "muted");
  } else {
   for (const item of fixed) {
    const card = add(listBox, "article", "", "card");
    const h = add(card, "h4", "");
    domainHeader(h, item.name);
    add(card, "p", `💰 ${poaShort(item.price)} POA`, "badge-ok");
   }
   for (const item of auctions) {
    const card = add(listBox, "article", "", "card");
    const h = add(card, "h4", "");
    domainHeader(h, item.name);
    add(card, "p", `🔥 Auction · ${poaShort(item.high?.amount ?? item.price)} POA`, "badge-ok");
   }
  }
 } else {
  const listings = activeResaleOffers(ui.latestState).filter((x) => x.offer.owner === ownerId && x.asset === "POA");
  if (!listings.length) add(listBox, "p", "No active listings", "muted");
  for (const row of listings) {
   const card = add(listBox, "article", "", "card");
   const h = add(card, "h4", "");
   domainHeader(h, row.name);
   add(card, "p", `💰 ${row.price} registry units`, "badge-ok");
  }
 }
}
