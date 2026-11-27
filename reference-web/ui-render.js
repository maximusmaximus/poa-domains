import { isOwnDomainOrListing, isPoaAddress, registryUnit, poaOnlyMode, poaAmount, poaShort, poaToMicros, poaMinimumNextBid, isPoaAuctionAwaitingFirstBid, partitionPoaAuctions, resolveDefaultAuctionTab, activePoaFixedListings, countLiveAuctions, countOwnedDomains, poaAuctionOutbidStatus, resolveOwnerInput, validPrincipal } from "./shared.js?v=bc6ae7df7f28";
import { drawTicker } from "./ui-ticker.js?v=bc6ae7df7f28";
import { actionLabel } from "./ui-copy.js?v=bc6ae7df7f28";
import { returnFocus } from "./ui-a11y.js?v=bc6ae7df7f28";
import { activeResaleOffers, buildCreativeSiteTitle, buildSiteTitle, formatClock, formatCountdown, formatDuration, formatEmojiCounter, historyForTarget, minimumNextBid, partitionAuctions, registryViewState, shapeLiveActions, tabHasNew, tabWatermarks } from "./shared.js?v=bc6ae7df7f28";
import { ui } from "./ui-state.js?v=bc6ae7df7f28";
import { add, appendPoaAddress, appendPrincipal, appendTextWithPoaAddress, el, person, namedText } from "./ui-core.js?v=bc6ae7df7f28";
import { activeUserAddress, domainHeader, nameLink, navigateDomain, openManageDomain, ownerLink, openPoa, renderSelfBidNotice } from "./ui-router.js?v=bc6ae7df7f28";
import { addDetailToCart, addToCart } from "./ui-cart.js?v=bc6ae7df7f28";
import { renderDomainPage, renderOwnerPage } from "./ui-domain.js?v=bc6ae7df7f28";

export function updateLiveAuctionsBadge(state = ui.latestState) {
 const badge = el("liveAuctionsBadge");
 const sr = el("liveAuctionsSr");
 if (!badge)
  return;
 const nowMs = ui.escrowMarketServerTime || Date.now();
 const count = countLiveAuctions({
  cap: ui.cap,
  state,
  escrowMarket: ui.escrowMarket ?? [],
  nowMs,
 });
 badge.hidden = count <= 0;
 badge.textContent = count > 0 ? `🔥${count}` : "0";
 badge.title = count > 0 ? `${count} live ${count === 1 ? "auction" : "auctions"}` : "";
 if (sr)
  sr.textContent = count > 0 ? ` (${count} live)` : "";
}

export function updateManagedDomainsBadge(state = ui.latestState) {
 const badge = el("managedDomainsBadge");
 const sr = el("managedDomainsSr");
 if (!badge)
  return;
 const inputOwner = el("manageOwner")?.value.trim() ?? "";
 const resolvedInput = inputOwner ? resolveOwnerInput(state, inputOwner, ui.cap)?.owner : "";
 const owner = resolvedInput
  ? resolvedInput
  : (validPrincipal(ui.knownOwner) ? ui.knownOwner : "");
 const count = owner && state ? countOwnedDomains(state, owner) : 0;
 badge.hidden = count <= 0;
 badge.textContent = count > 0 ? `🌱${count}` : "0";
 badge.title = count > 0 ? `${count} ${count === 1 ? "domain" : "domains"} to manage` : "";
 if (sr)
  sr.textContent = count > 0 ? ` (${count} to manage)` : "";
}

export function updateTabDots(state) {
 const marks = tabWatermarks(state);
 for (const btn of document.querySelectorAll(".section-tab")) {
  const id = btn.getAttribute("data-tab");
  const dot = btn.querySelector(".tab-dot");
  if (!dot)
   continue;
  const show = tabHasNew(id, marks, ui.tabSeen);
  // This dot is registry-read status, not a payment/native-naming readiness signal.
  dot.hidden = false;
  const status = document.body.dataset.registryStatus || "loading";
  dot.title = `Registry snapshot ${status}; POA payments are checked separately`;
  dot.setAttribute("aria-hidden", "true");
  const sr = btn.querySelector(".tab-new-text");
  if (sr)
   sr.hidden = !show;
  btn.classList.toggle("has-new", show);
 }
}

export function applySiteTitle({ creative = false, random } = {}) {
 const h1 = el("siteTitle");
 if (!h1) return null;
 const previous = h1.dataset.titleSig || "";
 const title = creative ? buildCreativeSiteTitle({ previous, random }) : buildSiteTitle(random);
 h1.replaceChildren();
 h1.dataset.theme = title.theme;
 h1.dataset.tile = title.tile;
 h1.dataset.titleSig = title.signature || `${title.text}|${title.theme}|${title.tile}`;
 h1.setAttribute("aria-label", "poadomains");
 title.glyphs.forEach((g) => {
  const span = document.createElement("span");
  span.className = g.kind === "tile" ? "title-glyph title-tile" : "title-glyph";
  if (g.kind === "tile" && g.tone) span.dataset.tone = g.tone;
  span.setAttribute("aria-hidden", "true");
  span.textContent = g.text;
  h1.append(span);
 });
 const host = h1.parentNode;
 if (host && typeof host.append === "function") {
  let btn = el("siteHomeBtn");
  if (!btn || btn.parentNode !== host) {
   btn = document.createElement("button");
   btn.type = "button";
   btn.id = "siteHomeBtn";
   btn.className = "site-home-btn";
   btn.setAttribute("aria-label", "poadomains — Go home");
   btn.title = "Go home & remix header icons";
   host.append(btn);
  }
 }
 document.title = "PoA domains";
 return title;
}

export function renderTicker(state) { drawTicker(state, ui.escrowMarket ?? []); }

let detailOpener = null;
export function closeDetail() {
 const wasOpen = !el("detailView").hidden;
 ui.detailTarget = null;
 el("detailView").hidden = true;
 if(wasOpen) returnFocus(detailOpener,document.querySelector(".section-tab[aria-selected=true]")||document.querySelector(".section-tab"));
 detailOpener = null;
}

export function openDetail(item) {
 if (!ui.latestState)
  return;
 if(el("detailView").hidden) detailOpener=document.activeElement;
 ui.detailTarget = item;
 const view = el("detailView");
 view.hidden = false;
 el("detailTitle").replaceChildren();
 el("detailTitle").classList.remove("domain-heading");
 if(item.name)domainHeader(el("detailTitle"),item.name,{size:"lg"});else el("detailTitle").textContent=actionLabel(item.label||"Detail");
 el("detailTitle").classList.toggle("domain-name", !!item.name);
 el("detailSummary").replaceChildren();namedText(el("detailSummary"),actionLabel(item.label || item.kind || ""));
 const hist = el("detailHistory");
 hist.replaceChildren();
 const rows = historyForTarget(ui.latestState, {
  name: item.name || null,
  auctionId: item.auctionId || null,
 });
 if (!rows.length)
  add(hist, "p", "No history", "muted");
 for (const row of rows) {
  const card = add(hist, "div", "", "card");
  namedText(add(card, "p", ""), row.text);
  add(card, "p", `#${row.sequence} · ${actionLabel(row.kind)}`, "badge");
 }
 const actions = el("detailActions");
 actions.replaceChildren();
 if (item.name) {
  const openBtn = add(actions, "button", "Open page", "secondary");
  openBtn.type = "button";
  openBtn.addEventListener("click", () => {
   closeDetail();
   navigateDomain(item.name);
  });
 }
 const cartBtn = add(actions, "button", "Add to cart");
 cartBtn.type = "button";
 cartBtn.id = "detailAddToCart";
 cartBtn.addEventListener("click", () => addDetailToCart(item));
 el("detailClose").focus();
}

export function setAuctionTab(tabId, { user = false, render = false } = {}) {
 const next = tabId === "upcoming" || tabId === "past" ? tabId : "current";
 ui.auctionTab = next;
 if (user)
  ui.auctionTabChosen = true;
 let activeBtn = null;
 for (const t of document.querySelectorAll(".auction-tab")) {
  const on = t.getAttribute("data-auction-tab") === next;
  if (on)
   activeBtn = t;
  t.classList.toggle("is-active", on);
  t.setAttribute("aria-selected", on ? "true" : "false");
  t.tabIndex = on ? 0 : -1;
 }
 const panel = el("auctions");
 if (panel && activeBtn?.id)
  panel.setAttribute("aria-labelledby", activeBtn.id);
 if (render && ui.latestState)
  renderAuctions(ui.latestState);
}

function poaPointer(box, text) {
 const wrap = add(box, "div", "", "cards-empty");
 add(wrap, "p", text, "muted");
 const go = add(wrap, "button", "🪙 Open My POA", "secondary small");
 go.type = "button";
 go.addEventListener("click", () => openPoa());
}
function renderPoaAuctions(box) {
 const nowMs = ui.escrowMarketServerTime || Date.now();
 const market = Array.isArray(ui.escrowMarket) ? ui.escrowMarket : [];
 const groups = partitionPoaAuctions(market, nowMs);
 const nextTab = resolveDefaultAuctionTab(groups, {
  currentTab: ui.auctionTab,
  userSelected: ui.auctionTabChosen,
  keepActiveTab: ui.activeSectionTab === "auctions",
 });
 if (nextTab !== ui.auctionTab)
  setAuctionTab(nextTab);
 const totalAuctions = groups.current.length + groups.upcoming.length + groups.past.length;
 const bidderBar = el("auctionsBidderBar");
 if (bidderBar)
  bidderBar.hidden = !totalAuctions && !ui.cap?.escrow?.enabled;
 box.replaceChildren();
 if (!totalAuctions) {
  poaPointer(box, "🪙 Auctions are in POA. Open My POA to bid or start one.");
  return;
 }
 const list = groups[ui.auctionTab] ?? [];
 if (!list.length) {
  if (ui.auctionTab === "current" && groups.upcoming.length > 0) {
   const wrap = add(box, "div", "", "cards-empty");
   add(wrap, "p", `No live auctions yet. ${groups.upcoming.length} queued in Upcoming — first bid starts the timer.`, "muted");
   const jump = add(wrap, "button", `⏳ View Upcoming (${groups.upcoming.length})`, "secondary small");
   jump.type = "button";
   jump.addEventListener("click", () => el("auctionTabUpcoming")?.click());
   return;
  }
  add(box, "p", ui.auctionTab === "upcoming"
   ? "No upcoming auctions queued right now."
   : ui.auctionTab === "past"
    ? "No past POA auctions yet."
    : "No live POA auctions right now.", "muted");
  return;
 }
 const userAddr = activeUserAddress();
 for (const a of list) {
  const card = add(box, "article", "", "card");
  card.dataset.auctionId = a.id;
  const awaiting = isPoaAuctionAwaitingFirstBid(a);
  const closed = !awaiting && a.closes > 0 && nowMs >= a.closes;
  const minNext = poaMinimumNextBid(a);
  const cartItem = ui.cart.find((x) => x.action === "poaBid" && x.params?.auctionId === a.id) ?? null;
  const isOwn = isOwnDomainOrListing({ name: a.name, seller: a.seller, state: ui.latestState, userAddress: userAddr });
  const outbidInfo = poaAuctionOutbidStatus(a, { bidderAddress: ui.bidderAddress || userAddr, cartItem, state: ui.latestState });
  const ah = add(card, "h4", "");
  domainHeader(ah, a.name);
  if (a.status !== "OPEN") {
   add(card, "p", a.status === "COMPLETE" ? "✅ Complete" : a.status === "SETTLING" ? "⏳ Settling" : "✖️ Cancelled", a.status === "COMPLETE" ? "badge-ok" : "badge");
  } else if (awaiting) {
   add(card, "p", "⏳ Starts on first bid", "badge");
  } else if (closed) {
   add(card, "p", "⏰ Awaiting handover", "badge");
  } else {
   add(card, "p", "🔥 Live auction", "badge-ok");
  }
  if (outbidInfo.status === "leading") {
   add(card, "p", outbidInfo.message, "auction-leading-badge");
  } else if (outbidInfo.status === "outbid" || outbidInfo.status === "outbid-covered") {
   appendTextWithPoaAddress(add(card, "p", "", "auction-outbid-badge"), outbidInfo.message, outbidInfo.currentHighPayer);
  }
  const bidLine = add(card, "p", `Reserve ${poaShort(a.price)} POA · `);
  if (a.high) {
   bidLine.append(`High bid ${poaShort(a.high.amount)} POA by `);
   ownerLink(bidLine, a.high.payer, person(a.high.payer));
  } else {
   bidLine.append("No bids yet.");
  }
  const windowSec = Math.round((a.window ?? a.quiet ?? 3600000) / 1000);
  if (awaiting) {
   add(card, "p", `⏱️ ${formatDuration(windowSec)} timer · starts on first bid`, "muted");
  } else if (a.closes > 0) {
   const closeRow = add(card, "p", "");
   if (a.status === "OPEN" && !closed) {
    const cd = add(closeRow, "span", `⏳ ${formatCountdown(a.closes - nowMs)}`, "auction-countdown");
    cd.dataset.closesMs = String(a.closes);
    closeRow.append(" · ");
   }
   closeRow.append(`Closes ${formatClock(Math.floor(a.closes / 1000))}`);
  }
  if (a.status === "OPEN" && (awaiting || !closed)) {
   add(card, "p", `Minimum ${awaiting ? "opening" : "next"} bid: ${poaShort(minNext)} POA`, "badge-ok");
   if (isOwn) {
    renderSelfBidNotice(card, { kind: "auction" });
   } else {
    if (cartItem) {
     add(card, "p", `🛒 In cart · highest bid cap ${poaShort(cartItem.amount)} POA`, "muted");
    }
    const controls = add(card, "div", "", "auction-bid-controls");
    const bidLabel = add(controls, "label", "Your highest bid (POA)");
    const bidInput = document.createElement("input");
    bidInput.type = "text";
    bidInput.inputMode = "decimal";
    bidInput.dataset.fieldKey = `poaBid:${a.id}`;
    bidInput.value = cartItem ? poaShort(cartItem.amount) : poaShort(minNext);
    bidInput.placeholder = poaShort(minNext);
    bidInput.setAttribute("aria-label", `Your highest bid in POA for ${a.name}`);
    bidLabel.append(bidInput);
    const btn = add(controls, "button", cartItem ? "Update cart bid" : "Add to cart", "small");
    btn.type = "button";
    btn.setAttribute("aria-label", `Add ${a.name} auction bid to cart`);
    const err = add(card, "p", "", "badge-warn");
    err.setAttribute("role", "alert");
    btn.addEventListener("click", () => {
     try {
      const exact = poaAmount(bidInput.value);
      if (poaToMicros(exact) < poaToMicros(minNext))
       throw Error(`⚠️ Enter at least ${poaShort(minNext)} POA.`);
      err.textContent = "";
      bidInput.removeAttribute("aria-invalid");
      addToCart({
       name: a.name,
       action: "poaBid",
       amount: exact,
       auctionId: a.id,
      });
      renderAuctions(ui.latestState);
     } catch (e) {
      err.textContent = e?.message || `⚠️ Enter at least ${poaShort(minNext)} POA.`;
      bidInput.setAttribute("aria-invalid", "true");
     }
    });
   }
  }
  if (Array.isArray(a.history) && a.history.length) {
   const det = document.createElement("details");
   add(det, "summary", `📜 Activity (${a.history.length})`);
   for (const h of [...a.history].reverse()) {
    const row = add(det, "p", `${h.event}${h.amount ? ` · ${poaShort(h.amount)} POA` : ""}${h.at ? ` · ${formatClock(Math.floor(h.at / 1000))}` : ""}`, "muted");
    if (h.payer) {
     row.append(" · ");
     appendPrincipal(row, h.payer);
    }
   }
   card.append(det);
  }
 }
}
export function renderAuctions(s) {
 const box = el("auctions");
 if (!box)
  return;
 if (poaOnlyMode(ui.cap)) {
  renderPoaAuctions(box);
  return;
 }
 const bidderBar = el("auctionsBidderBar");
 if (bidderBar)
  bidderBar.hidden = true;
 const groups = partitionAuctions(Object.values(s.auctions ?? {}), s.time);
 const nextTab = resolveDefaultAuctionTab(groups, {
  currentTab: ui.auctionTab,
  userSelected: ui.auctionTabChosen,
  keepActiveTab: ui.activeSectionTab === "auctions",
 });
 if (nextTab !== ui.auctionTab)
  setAuctionTab(nextTab);
 const list = groups[ui.auctionTab] ?? [];
 box.replaceChildren();
 if (!list.length) {
  add(box, "p", `No ${ui.auctionTab} auctions`, "muted");
  return;
 }
 for (const a of list) {
  const card = add(box, "article", "", "card");
  const close = a.high
   ? Math.max(a.openAt + a.window, a.high.at + a.quiet)
   : a.openAt + a.window;
  const phase = a.status !== "live"
   ? a.status
   : s.time < a.openAt
    ? "announced"
    : s.time < close
     ? a.high
      ? "open / funded"
      : "open / no bids"
     : "eligible to close";
  const ah = add(card, "h4", "");
  domainHeader(ah, a.name);
  add(card, "p", phase, "badge");
  const cartBid = ui.cart.find((x) => x.action === "bid" && x.params?.auctionId === a.id);
  if (cartBid && (cartBid.outbid || cartBid.needsReview)) {
   add(card, "p", "⚠️ Outbid or auction changed — review your cart bid.", "auction-outbid-badge");
  }
  const bidLine = add(card, "p", `Reserve ${a.reserve} ${registryUnit(a.asset)}. `);
  if (a.high) {
   bidLine.append(`High bid ${a.high.amount} by `);
   appendPrincipal(bidLine, a.high.payer);
  }
  else {
   bidLine.append("No active high bid.");
  }
  add(card, "p", `Window ${formatDuration(a.window)} + quiet ${formatDuration(a.quiet)} · closes ${formatClock(close)}`);
  const actions = add(card, "div", "", "button-row");
  if (a.status === "live" && !(typeof s.time === "number" && s.time < a.openAt)) {
   const nextMin = a.high
    ? minimumNextBid(a.high.amount, ui.cap.increment)
    : a.reserve;
   add(card, "p", `Minimum next bid: ${nextMin} ${registryUnit(a.asset)} (version ${a.version})`, "badge-ok");
   if (isOwnDomainOrListing({ name: a.name, seller: a.seller, state: s, userAddress: activeUserAddress() })) {
    renderSelfBidNotice(card, { kind: "auction" });
    card.append(actions);
   } else {
    card.append(actions);
    const btn = add(actions, "button", `Add to cart`, "small");
    btn.type = "button";
    btn.addEventListener("click", () => {
     addToCart({
      name: a.name,
      action: "bid",
      amount: nextMin,
      auctionId: a.id
     });
    });
   }
  }
  const openBtn = add(actions, "button", "History", "secondary small");
  openBtn.type = "button";
  openBtn.addEventListener("click", () => openDetail({
   id: `auction:${a.id}`,
   kind: "auction",
   label: `${a.name} · ${phase}`,
   name: a.name,
   auctionId: a.id,
  }));
 }
}

export function renderMarketplace(s) {
 const box = el("marketplace");
 if (!box)
  return;
 box.replaceChildren();
 if (poaOnlyMode(ui.cap)) {
  const fixed = activePoaFixedListings(ui.escrowMarket ?? [], ui.escrowMarketServerTime || Date.now());
  if (!fixed.length) {
   poaPointer(box, "🪙 Names for sale are priced in POA. Open My POA to buy or list one.");
   return;
  }
  for (const item of fixed) {
   const card = add(box, "article", "", "card");
   const h = add(card, "h4", "");
   domainHeader(h, item.name);
   add(card, "p", `🪙 ${poaShort(item.price)} POA`, "badge-ok");
   const sellerLine = add(card, "p", "Seller: ");
   ownerLink(sellerLine, item.seller, person(item.seller));
   if (item.closes > 0)
    add(card, "p", `Until ${formatClock(Math.floor(item.closes / 1000))}`);
   const go = add(card, "button", "🪙 Open My POA", "secondary small");
   go.type = "button";
   go.addEventListener("click", () => openPoa());
  }
  return;
 }
 const listings = activeResaleOffers(s).filter((x) => x.asset === "POA");
 if (!listings.length) {
  add(box, "p", "No public listings right now", "muted");
  return;
 }
 for (const row of listings) {
  const card = add(box, "article", "", "card");
  const h = add(card, "h4", "");
  domainHeader(h, row.name);
  add(card, "p", `💰 ${row.price} registry units`, "badge-ok");
  const ownerLine = add(card, "p", "Seller: ");
  if (row.offer?.owner)
   ownerLink(ownerLine, row.offer.owner, person(row.offer.owner));
  add(card, "p", `Until ${row.offer.validUntil}`);
  const btn = add(card, "button", "Add to cart", "small");
  btn.type = "button";
  btn.addEventListener("click", () => {
   addToCart({
    name: row.name,
    action: "buyFixed",
    amount: row.price,
    offerId: row.offer.id
   });
  });
 }
}

export function renderFooterCredit() {
 const slot = el("footerCreditOwner");
 if (!slot) return;
 const addr = slot.dataset.poaAddr || slot.textContent?.trim() || "";
 if (!isPoaAddress(addr)) return;
 slot.dataset.poaAddr = addr;
 slot.replaceChildren();
 ownerLink(slot, addr);
}

export function render(payload) {
 ui.rawSnapshot = payload;
 const s = registryViewState(payload);
 ui.latestState = s;
 el("state").textContent = JSON.stringify(payload, null, 2);
 el("freshness").textContent =
  (ui.demo ? "SYNTHETIC DEMO · " : ui.configMode === "live-registry" ? "LIVE REGISTRY DATA · " : "LOCAL REGISTRY DATA · ") +
   `as of ${formatClock(s.time)}, sequence ${s.sequence}. ${payload.finality}.`;
 if(payload.publicView?.filtered) el("freshness").textContent += " Public view only; sequence and hash include stored hidden records.";
 if (ui.demo && ui.details.generatedAt)
  el("freshness").textContent +=
   " Built " +
    new Intl.DateTimeFormat("en-US", {
     timeZone: "America/Los_Angeles",
     dateStyle: "medium",
     timeStyle: "short",
    }).format(new Date(ui.details.generatedAt)) +
    " Pacific time.";
 const names = Object.values(s.names).filter((n) => n.activeId), auctions = Object.values(s.auctions), offers = Object.values(s.offers ?? {}), bids = Object.values(s.bids ?? {}), receipts = Object.values(s.receipts ?? {});
 const servedCountEl = el("domainsServedCount");
 if (servedCountEl)
  servedCountEl.textContent = formatEmojiCounter(names.length, 6);
 const servedSrEl = el("domainsServedSr");
 if (servedSrEl)
  servedSrEl.textContent = String(names.length);
 renderFooterCredit();
 const rootDeeds = names.filter((n) => !s.deeds[n.activeId].parentId).length;
 const childDeeds = names.length - rootDeeds;
 const activeOffers = offers.filter((o) => !o.cancelled && o.uses < o.maxUses && s.time < o.validUntil);
 let settledVolume = 0n;
 for (const b of bids) {
  if (b.status === "won" || b.status === "high")
   settledVolume += BigInt(b.amount);
 }
 for (const o of offers) {
  if (o.uses > 0)
   settledVolume += BigInt(o.price) * BigInt(o.uses);
 }
 el("stats").replaceChildren();
 for (const [value, label] of [
  [names.length, "owned names"],
  [
   auctions.filter((a) => a.status === "live").length,
   "unsettled auctions",
  ],
  [Object.keys(ui.cap.actions).filter(a=>!ui.cap.ownership?.disabledActions?.includes(a)).length, "enabled registry actions"],
  [`${rootDeeds} / ${childDeeds}`, "root / child active deeds"],
  [
   `${activeOffers.length} / ${offers.length}`,
   "active / total standing offers",
  ],
  [
   `${bids.length} / ${receipts.length}`,
   "recorded bids / committed receipts",
  ],
  ...(poaOnlyMode(ui.cap) ? [] : [[settledVolume.toString(), "registry volume"]]),
  [
   `${ui.cap.emojiAliases ?? "unknown"} / ${ui.reservedSet.size || (ui.cap.reservedCount ?? "unknown")}`,
   "emoji sequences / reserved roots",
  ],
 ]) {
  const box = add(el("stats"), "div", "");
  add(box, "strong", String(value));
  add(box, "span", label);
 }
 el("names").replaceChildren();
 for (const n of names) {
  const d = s.deeds[n.activeId], card = add(el("names"), "article", "", "card has-manage-gear");
  const nh = add(card, "h4", "");
  domainHeader(nh, n.name);
  const ownerLine = add(card, "p", ui.demo ? "Synthetic · Owner: " : "Owner: ", "muted");
  ownerLink(ownerLine, d.owner, person(d.owner));
  if (d.parentId)
   namedText(add(card,"p",""),"Protected child of "+s.deeds[d.parentId].name+"; parent transfer does not remove these registry rights.");
  if (d.rights.kind === "lease")
   add(card, "p", "📜 Legacy lease", "badge");
  for (const r of d.records) {
   const value = r.url ?? r.address ?? r.cid;
   const recLine = add(card, "p", r.type + ": ", "record");
   if (isPoaAddress(value))
    appendPoaAddress(recLine, value);
   else
    recLine.append(String(value ?? ""));
  }
  const lastCid = d.metadata?.[d.metadata.length - 1]?.cid;
  const more = document.createElement("details");
  more.className = "domain-more";
  add(more, "summary", "More");
  add(more, "p", `Gen ${d.generation} · owner v${d.ownerVersion} · deed v${d.version}`, "muted");
  if (lastCid) {
   const cidRow = add(more, "p", "Content ID: ", "muted");
   add(cidRow, "code", lastCid);
  }
  card.append(more);
  const manageBtn = add(card, "button", "⚙️", "secondary small manage-domain-gear");
  manageBtn.type = "button";
  manageBtn.setAttribute("aria-label", `Manage ${n.name}`);
  manageBtn.title = `Manage ${n.name}`;
  manageBtn.addEventListener("click", () => openManageDomain(n.name, d.owner));
 }
 if (!names.length)
  add(el("names"), "p", "No owned names");
 renderAuctions(s);
 renderTicker(s);
 renderMarketplace(s);
 updateTabDots(s);
 updateLiveAuctionsBadge(s);
 updateManagedDomainsBadge(s);
 if (ui.route.kind === "domain" && ui.currentDomainName)
  renderDomainPage(ui.currentDomainName);
 if (ui.route.kind === "owner" && ui.currentOwnerId)
  renderOwnerPage(ui.currentOwnerId);
 el("offers").replaceChildren();
 for (const o of offers) {
  const card = add(el("offers"), "div", "", "card");
  const targetDeed = s.deeds[o.parentId];
  const targetName = targetDeed ? targetDeed.name : o.parentId.slice(0, 14);
  const active = !o.cancelled && o.uses < o.maxUses && s.time < o.validUntil;
  const statusText = o.cancelled
   ? "cancelled"
   : o.uses >= o.maxUses
    ? "filled"
    : s.time >= o.validUntil
     ? "expired"
     : "active";
  const oh = add(card, "h4", "");
  domainHeader(oh, targetName, { prefix: o.kind === "child" ? "Child offer on ." : "Resale of " });
  add(card, "p", `${o.kind} offer · ${statusText} · price ${o.price} ${registryUnit(o.asset)}`, active ? "badge-ok" : "badge");
  const sellerLine = add(card, "p", "Seller: ");
  ownerLink(sellerLine, o.owner, person(o.owner));
  sellerLine.append(` · Uses: ${o.uses}/${o.maxUses} · Until ${formatClock(o.validUntil)}`);
  if (o.kind === "child" && o.rights) {
   add(card, "p", `Rights: ${o.rights.kind} · Labels: ${o.labels ? o.labels.join(", ") : "any"}`);
  }
  if (active) {
   const sampleLabel = o.kind === "child"
    ? o.labels && o.labels.length
     ? o.labels[0]
     : "sub"
    : null;
   const fullTarget = o.kind === "child" ? `${sampleLabel}.${targetName}` : targetName;
   const btn = add(card, "button", `Add to cart`, "small");
   btn.type = "button";
   btn.addEventListener("click", () => {
    addToCart({
     name: fullTarget,
     action: o.kind === "child" ? "fillChildOffer" : "buyFixed",
     amount: o.price,
     offerId: o.kind === "child" ? o.id : o.id
    });
   });
  }
 }
 if (!offers.length)
  add(el("offers"), "p", "No offers");
 el("history").replaceChildren();
 const sortedBids = [...bids].sort((a, b) => b.sequence - a.sequence);
 for (const b of sortedBids) {
  const a = s.auctions[b.auctionId];
  const domainName = a ? a.name : b.auctionId.slice(0, 14);
  const card = add(el("history"), "div", "", "card");
  const hh = add(card, "h4", "");
  domainHeader(hh, domainName, { suffix: ` — ${b.amount} ${registryUnit(a ? a.asset : "POA")}` });
  add(card, "p", `Bid status: ${b.status.toUpperCase()} · Sequence #${b.sequence} · ${formatClock(b.at)}`, b.status === "won" || b.status === "high" ? "badge-ok" : "badge");
  const partyLine = add(card, "p", "Payer: ");
  appendPrincipal(partyLine, b.payer);
  partyLine.append(" · Beneficiary: ");
  appendPrincipal(partyLine, b.beneficiary);
 }
 const purchaseReceipts = [...receipts]
  .filter((r) => r.status === "succeeded" &&
  r.result &&
  (r.result.deedId || r.result.offerId || r.result.recordsVersion))
  .sort((a, b) => b.sequence - a.sequence);
 for (const r of purchaseReceipts) {
  const deed = r.result.deedId ? s.deeds[r.result.deedId] : null;
  const label = r.result.name
   ? `Child purchase: ${r.result.name}`
   : deed
    ? `Deed settled: ${deed.name}`
    : r.result.offerId
     ? `Offer published`
     : `Records updated`;
  const card = add(el("history"), "div", "", "card");
  namedText(add(card, "h4", ""), label);
  add(card, "p", `Receipt #${r.sequence} · ${formatClock(r.time)} · Status: ${r.status}`, "badge");
  const signerLine = add(card, "p", "Signer: ");
  appendPrincipal(signerLine, r.signer);
  signerLine.append(` · Request: ${r.requestId}`);
  add(card, "code", `intentId: ${r.intentId.slice(0, 24)}…`);
 }
 if (!sortedBids.length && !purchaseReceipts.length)
  add(el("history"), "p", "No history");
 el("balances").replaceChildren();
 for (const c of Object.values(s.credits ?? {})) {
  if (c.amount === "0")
   continue;
  const card = add(el("balances"), "div", "", "card");
  const a = s.auctions[c.auctionId];
  add(card, "h4", `Refund: ${c.amount} ${registryUnit(c.asset)}`);
  const refundLine = add(card, "p", "", "badge-ok");
  appendPrincipal(refundLine, c.payer);
  refundLine.append(" · ");
  if (a) nameLink(refundLine, a.name); else refundLine.append(c.auctionId.slice(0, 12));
  refundLine.append(` · v${c.version}`);
 }
 if (!Object.keys(s.balances ?? {}).length && !Object.keys(s.credits ?? {}).length) add(el("balances"), "p", "No public registry-unit balances or refunds. These are not POA or wallet balances.", "muted");
 for (const [who, wallet] of Object.entries(s.balances ?? {})) {
  const card = add(el("balances"), "div", "", "card");
  const wh = add(card, "h4", "");
  ownerLink(wh, who, person(who));
  const entries = Object.entries(wallet)
   .map(([asset, amt]) => `${amt} ${registryUnit(asset)}`)
   .join(" · ");
  add(card, "p", entries, "record");
  if (!isPoaAddress(who))
   add(card, "code", who);
 }
}
