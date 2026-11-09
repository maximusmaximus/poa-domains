import {
  makeBody,
  digest,
  instructions,
  canonical,
  parsePublicJSON,
  safeObject,
  inspectName,
  minimumNextBid,
  buildAgentCartPrompt,
  buildAgentCheckoutHandoff,
  pickSiteTitle,
  partitionAuctions,
  shapeLiveActions,
  historyForTarget,
  loadCart,
  saveCart,
  domainPath,
  parseDomainPath,
  parseOwnerPath,
  resolveDomainView,
  activeResaleOffers,
  offerIsActive,
  buildListingPrompt,
  loadTabSeen,
  saveTabSeen,
  tabWatermarks,
  tabHasNew,
  shouldHoldTransactions,
  networkBannerCopy,
  networkBannerColor,
  isNetworkBannerDismissed,
  dismissNetworkBanner,
} from "./shared.js";

const el = (id) => document.getElementById(id);
let cap,
  base = "",
  copy = "",
  demo = false,
  configMode = "local-reference-only",
  examples = {},
  details = {},
  latestState = null,
  reservedSet = new Set(),
  cart = [],
  auctionTab = "current",
  tickerTimer = null,
  detailTarget = null;
let generation = 0;
let activeSectionTab = "find";
let tabSeen = {};
let route = { kind: "home" };
let currentDomainName = null;
let currentOwnerId = null;
let networkStatus = { level: "checking", hold: false, message: "⚪ Checking PoA network…" };
let networkTimer = null;

const TICKER_MS = 12000;
const NETWORK_MS = 20000;

function clearHandoff() {
  generation++;
  copy = "";
  for (const id of ["body", "instructions", "digest"]) el(id).textContent = "";
  el("copy").disabled = true;
}

async function json(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw Error("Read failed");
  const result = await response.json();
  safeObject(result);
  return result;
}

function staticURL(path) {
  if (typeof path !== "string" || !/^\.\/demo\/[a-z-]+\.json$/.test(path))
    throw Error("Static path");
  const url = new URL(path, location.href),
    root = new URL("./", location.href);
  if (
    url.origin !== location.origin ||
    !url.pathname.startsWith(root.pathname) ||
    url.search ||
    url.hash
  )
    throw Error("Static origin");
  return url.href;
}

function add(parent, tag, text, css) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (css) node.className = css;
  parent.append(node);
  return node;
}


function nameLink(parent, name, css = "domain-link") {
  if (!name) return add(parent, "span", "—", css);
  const a = document.createElement("a");
  a.href = domainPath(name);
  a.className = css;
  a.textContent = name;
  a.addEventListener("click", (event) => {
    event.preventDefault();
    navigateDomain(name);
  });
  parent.append(a);
  return a;
}

function ownerLink(parent, ownerId, label) {
  const a = document.createElement("a");
  a.href = "/p/" + encodeURIComponent(ownerId);
  a.className = "domain-link";
  a.textContent = label || ownerId.slice(0, 18) + "…";
  a.addEventListener("click", (event) => {
    event.preventDefault();
    navigateOwner(ownerId);
  });
  parent.append(a);
  return a;
}

function navigateHome() {
  route = { kind: "home" };
  currentDomainName = null;
  currentOwnerId = null;
  history.pushState(route, "", "/");
  applyRoute();
}

function navigateDomain(name) {
  route = { kind: "domain", name };
  currentDomainName = name;
  currentOwnerId = null;
  history.pushState(route, "", domainPath(name));
  applyRoute();
}

async function refreshNetworkStatus() {
  try {
    const response = await fetch(endpointBase() + "/v1/network-status", {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) throw Error("status");
    const body = await response.json();
    if (!body || typeof body.level !== "string") throw Error("shape");
    networkStatus = body;
  } catch {
    // Conservative: one client miss does not flip to Down; Worker owns the 2-failure rule.
    if (!networkStatus || networkStatus.level === "checking") {
      networkStatus = {
        level: "checking",
        hold: false,
        message: "⚪ Checking PoA network…",
      };
    }
  }
  renderNetworkStatus();
  applyNetworkHold();
}

function renderNetworkStatus() {
  const bar = el("networkStatusBar");
  if (!bar) return;
  const level = networkStatus.level || "checking";
  const text = networkStatus.message || networkBannerCopy(level);
  bar.dataset.level = level;
  bar.dataset.color = networkBannerColor(level);
  const icon = el("networkStatusIcon");
  const label = el("networkStatusText");
  if (icon) icon.textContent = networkStatus.emoji || text.slice(0, 2);
  if (label) label.textContent = text;
  const dismissed = isNetworkBannerDismissed(globalThis.sessionStorage, level);
  bar.hidden = !!dismissed;
}

function applyNetworkHold() {
  const hold = shouldHoldTransactions(networkStatus.level) || !!networkStatus.hold;
  const heldIds = [
    "copyCheckoutBtn",
    "copyCartPrompt",
    "copyListPromptBtn",
    "copyChangePromptBtn",
    "copyUnlistPromptBtn",
    "copy",
  ];
  for (const id of heldIds) {
    const node = el(id);
    if (!node) continue;
    if (hold) {
      node.disabled = true;
      node.classList.add("action-held");
      node.title = "Held ⏸️ until the PoA network is back";
    } else {
      node.classList.remove("action-held");
      node.removeAttribute("title");
      // Re-enable based on existing cart/copy rules on next renderCart / route.
    }
  }
  // Re-run cart enablement when not held.
  if (!hold) renderCart();
  let note = el("networkHoldNote");
  if (hold) {
    if (!note) {
      note = document.createElement("p");
      note.id = "networkHoldNote";
      note.className = "hold-note";
      note.setAttribute("role", "status");
      const panel = el("floatingCartPanel");
      if (panel) panel.appendChild(note);
    }
    note.textContent = "⏸️ Held until the PoA network is back. Reads still work; this registry is local-reference (not live PoA).";
    note.hidden = false;
  } else if (note) {
    note.hidden = true;
  }
  document.querySelectorAll("[data-requires-network]").forEach((node) => {
    if (hold) {
      node.disabled = true;
      node.classList.add("action-held");
    } else {
      node.classList.remove("action-held");
    }
  });
}

function navigateOwner(ownerId) {
  route = { kind: "owner", ownerId };
  currentOwnerId = ownerId;
  currentDomainName = null;
  history.pushState(route, "", "/p/" + encodeURIComponent(ownerId));
  applyRoute();
}

function applyRoute() {
  const home = el("homeMain");
  const domain = el("domainMain");
  const owner = el("ownerMain");
  const tabs = el("sectionTabs");
  if (route.kind === "domain") {
    home.hidden = true;
    domain.hidden = false;
    owner.hidden = true;
    if (tabs) tabs.hidden = true;
    if (latestState) renderDomainPage(currentDomainName);
  } else if (route.kind === "owner") {
    home.hidden = true;
    domain.hidden = true;
    owner.hidden = false;
    if (tabs) tabs.hidden = true;
    if (latestState) renderOwnerPage(currentOwnerId);
  } else {
    home.hidden = false;
    domain.hidden = true;
    owner.hidden = true;
    if (tabs) tabs.hidden = false;
  }
}

function setSectionTab(tabId, markSeen = true) {
  activeSectionTab = tabId;
  for (const btn of document.querySelectorAll(".section-tab")) {
    const on = btn.getAttribute("data-tab") === tabId;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  }
  for (const section of document.querySelectorAll("main#homeMain > section[data-section]")) {
    const on = section.getAttribute("data-section") === tabId;
    section.classList.toggle("is-active-section", on);
  }
  if (markSeen && latestState) {
    const marks = tabWatermarks(latestState);
    tabSeen = { ...tabSeen, [tabId]: marks[tabId] ?? latestState.sequence ?? 0 };
    saveTabSeen(globalThis.localStorage, tabSeen);
    updateTabDots(latestState);
  }
}

function updateTabDots(state) {
  const marks = tabWatermarks(state);
  for (const btn of document.querySelectorAll(".section-tab")) {
    const id = btn.getAttribute("data-tab");
    const dot = btn.querySelector(".tab-dot");
    if (!dot) continue;
    const show = tabHasNew(id, marks, tabSeen);
    dot.hidden = !show;
  }
}

function person(id) {
  const role = Object.keys(details.roles ?? {}).find(
    (x) => details.roles[x] === id,
  );
  return role ? "Fixture " + role : id.slice(0, 18) + "…";
}

function endpointBase() {
  return demo ? "http://127.0.0.1:8787" : base || location.origin;
}

function persistCart() {
  saveCart(globalThis.localStorage, cart);
}

function addToCart(item) {
  const existingIdx = cart.findIndex(
    (x) => x.name === item.name && x.action === item.action,
  );
  if (existingIdx >= 0) cart[existingIdx] = item;
  else cart.push(item);
  persistCart();
  renderCart();
}

function removeCartAt(index) {
  cart.splice(index, 1);
  persistCart();
  renderCart();
}

function clearAllCart() {
  cart = [];
  persistCart();
  renderCart();
}

function updatePromptText() {
  if (!cart.length || !cap) {
    if (!cart.length) {
      el("cartPrompt").textContent =
        "Add one or more domains from availability search, live auctions, or standing offers to generate your agent prompt.";
    }
    return;
  }
  el("cartPrompt").textContent = buildAgentCartPrompt(
    cart,
    cap,
    el("cartSigner").value.trim(),
    endpointBase(),
    configMode,
  );
}

function renderFloatingCart() {
  const badge = el("floatingCartBadge");
  const list = el("floatingCartList");
  const clearBtn = el("floatingCartClear");
  const copyBtn = el("copyCheckoutBtn");
  badge.textContent = String(cart.length);
  badge.hidden = cart.length === 0;
  el("floatingCartBtn").setAttribute(
    "aria-label",
    cart.length ? `Open cart, ${cart.length} items` : "Open cart",
  );
  clearBtn.disabled = cart.length === 0;
  const held = shouldHoldTransactions(networkStatus.level) || !!networkStatus.hold;
  copyBtn.disabled = cart.length === 0 || held;
  if (held) copyBtn.classList.add("action-held");
  else copyBtn.classList.remove("action-held");
  list.replaceChildren();
  if (!cart.length) {
    add(list, "p", "Cart empty", "muted");
    return;
  }
  cart.forEach((item, index) => {
    const card = add(list, "div", "", "card");
    const h = add(card, "h4", "");
    nameLink(h, item.name);
    add(card, "p", `${item.action} · ${item.amount} ${item.asset}`, "badge");
    add(card, "p", item.summary);
    const btn = add(card, "button", "Remove", "secondary small");
    btn.type = "button";
    btn.addEventListener("click", () => removeCartAt(index));
  });
}

function renderCart() {
  el("cartCount").textContent = String(cart.length);
  el("clearCart").disabled = cart.length === 0;
  {
    const held = shouldHoldTransactions(networkStatus.level) || !!networkStatus.hold;
    el("copyCartPrompt").disabled = cart.length === 0 || held;
    if (held) el("copyCartPrompt").classList.add("action-held");
    else el("copyCartPrompt").classList.remove("action-held");
  }
  el("cartStatus").textContent = "";
  const listNode = el("cartList");
  listNode.replaceChildren();
  if (!cart.length) {
    updatePromptText();
    renderFloatingCart();
    return;
  }
  cart.forEach((item, index) => {
    const card = add(listNode, "div", "", "card");
    const h = add(card, "h4", "");
    nameLink(h, item.name);
    add(
      card,
      "p",
      `${item.action} · ${item.tier} ${item.isRoot ? "root" : "child"}`,
      "badge",
    );
    add(card, "p", item.summary);
    const controls = add(card, "div", "", "inline-controls");
    const amountInput = document.createElement("input");
    amountInput.value = item.amount;
    amountInput.setAttribute("inputmode", "numeric");
    amountInput.setAttribute(
      "aria-label",
      "Amount or max bid for " + item.name,
    );
    amountInput.addEventListener("input", () => {
      if (/^(0|[1-9][0-9]{0,38})$/.test(amountInput.value.trim())) {
        item.amount = amountInput.value.trim();
        if (Object.hasOwn(item.params, "amount"))
          item.params.amount = item.amount;
        if (Object.hasOwn(item.params, "reserve"))
          item.params.reserve = item.amount;
        persistCart();
        updatePromptText();
        renderFloatingCart();
      }
    });
    const removeBtn = add(controls, "button", "Remove", "secondary small");
    removeBtn.type = "button";
    removeBtn.addEventListener("click", () => removeCartAt(index));
    controls.prepend(amountInput);
  });
  updatePromptText();
  renderFloatingCart();
}

function setFloatingCartOpen(open) {
  const panel = el("floatingCartPanel");
  const backdrop = el("floatingCartBackdrop");
  const btn = el("floatingCartBtn");
  panel.hidden = !open;
  backdrop.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    renderFloatingCart();
    el("floatingCartClose").focus();
  } else {
    btn.focus();
  }
}

function applySiteTitle() {
  const title = pickSiteTitle();
  el("siteTitle").textContent = title;
  document.title = "PoA domains";
}

function renderTicker(state) {
  const track = el("liveTickerTrack");
  track.replaceChildren();
  const items = shapeLiveActions(state);
  if (!items.length) {
    add(track, "span", "No live actions", "ticker-empty muted");
    return;
  }
  for (const item of items) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ticker-chip";
    chip.textContent = item.label;
    chip.setAttribute("aria-label", `Open ${item.label}`);
    chip.addEventListener("click", () => {
      if (item.name) navigateDomain(item.name);
      else openDetail(item);
    });
    track.append(chip);
  }
}

function closeDetail() {
  detailTarget = null;
  el("detailView").hidden = true;
}

function openDetail(item) {
  if (!latestState) return;
  detailTarget = item;
  const view = el("detailView");
  view.hidden = false;
  el("detailTitle").textContent = item.name || item.label || "Detail";
  el("detailSummary").textContent = item.label || item.kind || "";
  const hist = el("detailHistory");
  hist.replaceChildren();
  const rows = historyForTarget(latestState, {
    name: item.name || null,
    auctionId: item.auctionId || null,
  });
  if (!rows.length) add(hist, "p", "No history", "muted");
  for (const row of rows) {
    const card = add(hist, "div", "", "card");
    add(card, "p", row.text);
    add(card, "p", `#${row.sequence} · ${row.kind}`, "badge");
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

function addDetailToCart(item) {
  const s = latestState;
  if (!s || !cap) return;
  const name = item.name;
  if (!name) return;
  let info;
  try {
    info = inspectName(name, cap.emojiManifest);
  } catch {
    return;
  }
  const liveAuction =
    (item.auctionId && s.auctions[item.auctionId]?.status === "live"
      ? s.auctions[item.auctionId]
      : null) ||
    Object.values(s.auctions).find(
      (a) => a.name === name && a.status === "live",
    );
  if (liveAuction) {
    const minBid = liveAuction.high
      ? minimumNextBid(liveAuction.high.amount, cap.increment)
      : liveAuction.reserve;
    addToCart({
      name,
      tier: info.tier,
      isRoot: info.isRoot,
      action: "bid",
      asset: liveAuction.asset,
      amount: minBid,
      summary: `Place ascending bid of ${minBid} ${liveAuction.asset} on live auction ${liveAuction.id.slice(0, 16)}… (expectedVersion=${liveAuction.version}, minValidBid=${minBid}).`,
      params: {
        auctionId: liveAuction.id,
        expectedVersion: liveAuction.version,
        asset: liveAuction.asset,
        amount: minBid,
        beneficiary:
          el("cartSigner").value.trim() || "<YOUR_BENEFICIARY_PRINCIPAL>",
      },
    });
    return;
  }
  if (info.isRoot && !s.names[name]?.activeId && !reservedSet.has(name)) {
    const poaPolicy = cap.assets?.POA ?? {
      premiumReserve: "100000",
      standardReserve: "1000",
    };
    const reserve = info.isSingleEmoji
      ? "100000"
      : info.isMultiEmoji
        ? "1000"
        : info.tier === "premium"
          ? poaPolicy.premiumReserve
          : poaPolicy.standardReserve;
    addToCart({
      name,
      tier: info.tier,
      isRoot: true,
      action: "announceAuction+bid",
      asset: "POA",
      amount: reserve,
      summary: `Request root auction announcement for "${name}" (reserve=${reserve} POA) and place opening bid up to maxTotal=${reserve} POA.`,
      params: {
        name,
        asset: "POA",
        reserve,
        maxBid: reserve,
        expectedDeedId: null,
        expectedVersion: 0,
      },
    });
  }
}

function runSearch(rawQuery) {
  const container = el("searchResult");
  container.replaceChildren();
  const q = (rawQuery ?? "").trim();
  if (!q || !cap || !latestState) return;
  let info;
  try {
    info = inspectName(q, cap.emojiManifest);
  } catch {
    const card = add(container, "div", "", "card");
    add(card, "h4", q);
    add(card, "p", "INVALID DOMAIN FORMAT", "badge-warn");
    return;
  }
  const s = latestState;
  const name = info.canonical;
  const card = add(container, "div", "", "card");
  const title = add(card, "h4", "");
  nameLink(title, name);
  const openPage = add(card, "button", "Open page", "secondary small");
  openPage.type = "button";
  openPage.addEventListener("click", () => navigateDomain(name));
  add(
    card,
    "p",
    `${info.isRoot ? "Root" : "Child of " + info.parent} · ${info.tier.toUpperCase()}`,
  );

  if (info.isRoot && reservedSet.has(name)) {
    add(card, "p", "🔒 Reserved — not for sale", "badge-warn");
    add(card, "p", `${reservedSet.size}-name reservation catalog`);
    return;
  }

  const entry = s.names[name];
  const liveAuction =
    entry?.auctionId && s.auctions[entry.auctionId]?.status === "live"
      ? s.auctions[entry.auctionId]
      : Object.values(s.auctions).find(
          (a) => a.name === name && a.status === "live",
        );

  if (liveAuction) {
    const minBid = liveAuction.high
      ? minimumNextBid(liveAuction.high.amount, cap.increment)
      : liveAuction.reserve;
    add(card, "p", "🏷️ In auction now", "badge");
    add(
      card,
      "p",
      `Auction ID: ${liveAuction.id.slice(0, 18)}… · Version ${liveAuction.version} · Reserve: ${liveAuction.reserve} ${liveAuction.asset} · ${liveAuction.high ? "Current high bid: " + liveAuction.high.amount + " by " + person(liveAuction.high.payer) : "No bids yet"}`,
    );
    add(
      card,
      "p",
      `Minimum next valid bid: ${minBid} ${liveAuction.asset} base units.`,
      "badge-ok",
    );
    const controls = add(card, "div", "", "inline-controls");
    const bidInput = document.createElement("input");
    bidInput.value = minBid;
    bidInput.setAttribute("inputmode", "numeric");
    bidInput.setAttribute("aria-label", "Bid amount for " + name);
    controls.append(bidInput);
    const btn = add(controls, "button", "Add to cart", "small");
    btn.id = "addToCartBtn";
    btn.type = "button";
    btn.addEventListener("click", () => {
      const chosen = /^(0|[1-9][0-9]{0,38})$/.test(bidInput.value.trim())
        ? bidInput.value.trim()
        : minBid;
      addToCart({
        name,
        tier: info.tier,
        isRoot: info.isRoot,
        action: "bid",
        asset: liveAuction.asset,
        amount: chosen,
        summary: `Place ascending bid of ${chosen} ${liveAuction.asset} on live auction ${liveAuction.id.slice(0, 16)}… (expectedVersion=${liveAuction.version}, minValidBid=${minBid}).`,
        params: {
          auctionId: liveAuction.id,
          expectedVersion: liveAuction.version,
          asset: liveAuction.asset,
          amount: chosen,
          beneficiary:
            el("cartSigner").value.trim() || "<YOUR_BENEFICIARY_PRINCIPAL>",
        },
      });
    });
    return;
  }

  if (entry?.activeId && s.deeds[entry.activeId]) {
    const d = s.deeds[entry.activeId];
    add(card, "p", `✅ Owned (${d.rights.kind}) — OWNED (${d.rights.kind.toUpperCase()} DEED)`, "badge");
    add(
      card,
      "p",
      `Owner: ${person(d.owner)} · Generation ${d.generation} · Owner version ${d.ownerVersion} · Deed version ${d.version}`,
    );
    const resaleOffer = Object.values(s.offers).find(
      (o) =>
        o.kind === "resale" &&
        o.parentId === d.id &&
        !o.cancelled &&
        o.uses < o.maxUses &&
        s.time < o.validUntil,
    );
    if (resaleOffer) {
      add(
        card,
        "p",
        `💰 For sale: ${resaleOffer.price} ${resaleOffer.asset} (until ${resaleOffer.validUntil}) — Active fixed-price resale listing: ${resaleOffer.price} ${resaleOffer.asset}`,
        "badge-ok",
      );
      const btn = add(card, "button", "Add to cart", "small");
      btn.id = "addToCartBtn";
      btn.type = "button";
      btn.addEventListener("click", () => {
        addToCart({
          name,
          tier: info.tier,
          isRoot: info.isRoot,
          action: "buyFixed",
          asset: resaleOffer.asset,
          amount: resaleOffer.price,
          summary: `Buy ${name} at fixed resale price ${resaleOffer.price} ${resaleOffer.asset} via offer ${resaleOffer.id.slice(0, 16)}… (expectedVersion=${resaleOffer.version}).`,
          params: {
            offerId: resaleOffer.id,
            expectedVersion: resaleOffer.version,
            asset: resaleOffer.asset,
            amount: resaleOffer.price,
          },
        });
      });
    }
    return;
  }

  if (!info.isRoot) {
    const parentEntry = s.names[info.parent];
    const parentDeed = parentEntry?.activeId
      ? s.deeds[parentEntry.activeId]
      : null;
    const childOffer = parentDeed
      ? Object.values(s.offers).find(
          (o) =>
            o.kind === "child" &&
            o.parentId === parentDeed.id &&
            !o.cancelled &&
            o.uses < o.maxUses &&
            s.time < o.validUntil &&
            (o.labels === null || o.labels.includes(info.childLabel)),
        )
      : null;
    if (childOffer) {
      const nextGen = (entry?.generation ?? 0) + 1;
      add(
        card,
        "p",
        `🟢 Child offer open (${childOffer.price} ${childOffer.asset})`,
        "badge-ok",
      );
      const btn = add(card, "button", "Add to cart", "small");
      btn.id = "addToCartBtn";
      btn.type = "button";
      btn.addEventListener("click", () => {
        addToCart({
          name,
          tier: info.tier,
          isRoot: false,
          action: "fillChildOffer",
          asset: childOffer.asset,
          amount: childOffer.price,
          summary: `Mint child domain ${name} via standing parent offer ${childOffer.id.slice(0, 16)}… for ${childOffer.price} ${childOffer.asset} (expectedGeneration=${nextGen}).`,
          params: {
            offerId: childOffer.id,
            expectedVersion: childOffer.version,
            expectedGeneration: nextGen,
            label: info.childLabel,
            asset: childOffer.asset,
            amount: childOffer.price,
            metadata: {
              cid: "<COMPUTED_CIDV1_SHA256>",
              document: {
                schema: "poa-domains.metadata.v1",
                name,
                rightsHash: "<PARENT_OFFER_RIGHTS_HASH>",
                description: `Child domain ${name}`,
              },
            },
          },
        });
      });
    } else {
      add(card, "p", "⚪ Child not minted — no open offer", "badge");
    }
    return;
  }

  const poaPolicy = cap.assets?.POA ?? {
    premiumReserve: "100000",
    standardReserve: "1000",
  };
  const reserve = info.isSingleEmoji
    ? "100000"
    : info.isMultiEmoji
      ? "1000"
      : info.tier === "premium"
        ? poaPolicy.premiumReserve
        : poaPolicy.standardReserve;
  const tierNote = info.isSingleEmoji
    ? "100k POA single-emoji minimum bid"
    : info.isMultiEmoji
      ? "1k POA multi-emoji minimum bid"
      : `${reserve} POA minimum bid`;
  const windowSec = info.tier === "premium" ? 86400 : 3600;
  add(card, "p", "🟢 Available", "badge-ok");
  add(
    card,
    "p",
    `Unclaimed ${info.tier} root domain (${tierNote}). Opening auction reserve: ${reserve} POA (${windowSec}s minimum window + ${windowSec}s quiet period).`,
  );
  const controls = add(card, "div", "", "inline-controls");
  const maxBidInput = document.createElement("input");
  maxBidInput.value = reserve;
  maxBidInput.setAttribute("inputmode", "numeric");
  maxBidInput.setAttribute("aria-label", "Max bid for " + name);
  controls.append(maxBidInput);
  const btn = add(controls, "button", "Add to cart", "small");
  btn.id = "addToCartBtn";
  btn.type = "button";
  btn.addEventListener("click", () => {
    const chosen = /^(0|[1-9][0-9]{0,38})$/.test(maxBidInput.value.trim())
      ? maxBidInput.value.trim()
      : reserve;
    addToCart({
      name,
      tier: info.tier,
      isRoot: true,
      action: "announceAuction+bid",
      asset: "POA",
      amount: chosen,
      summary: `Request root auction announcement for "${name}" (reserve=${reserve} POA) and place opening bid up to maxTotal=${chosen} POA.`,
      params: {
        name,
        asset: "POA",
        reserve,
        maxBid: chosen,
        expectedDeedId: null,
        expectedVersion: 0,
      },
    });
  });
}

function renderAuctions(s) {
  const groups = partitionAuctions(Object.values(s.auctions ?? {}), s.time);
  const list = groups[auctionTab] ?? [];
  el("auctions").replaceChildren();
  if (!list.length) {
    add(el("auctions"), "p", `No ${auctionTab} auctions`, "muted");
    return;
  }
  for (const a of list) {
    const card = add(el("auctions"), "article", "", "card");
    const close = a.high
      ? Math.max(a.openAt + a.window, a.high.at + a.quiet)
      : a.openAt + a.window;
    const phase =
      a.status !== "live"
        ? a.status
        : s.time < a.openAt
          ? "announced"
          : s.time < close
            ? a.high
              ? "open / funded"
              : "open / no bids"
            : "eligible to close";
    const ah = add(card, "h4", "");
    nameLink(ah, a.name);
    add(card, "p", phase, "badge");
    add(
      card,
      "p",
      `Reserve ${a.reserve} ${a.asset}. ${a.high ? "High bid " + a.high.amount + " by " + person(a.high.payer) : "No active high bid."}`,
    );
    add(card, "p", `Window ${a.window}s + quiet ${a.quiet}s · close ${close}`);
    if (a.status === "live" && !(typeof s.time === "number" && s.time < a.openAt)) {
      const nextMin = a.high
        ? minimumNextBid(a.high.amount, cap.increment)
        : a.reserve;
      add(
        card,
        "p",
        `Minimum next bid: ${nextMin} ${a.asset} (version ${a.version})`,
        "badge-ok",
      );
      const btn = add(card, "button", `Add to cart`, "small");
      btn.type = "button";
      btn.addEventListener("click", () => {
        addToCart({
          name: a.name,
          tier: a.window === 86400 ? "premium" : "standard",
          isRoot: true,
          action: "bid",
          asset: a.asset,
          amount: nextMin,
          summary: `Place ascending bid of ${nextMin} ${a.asset} on auction ${a.id.slice(0, 16)}… for "${a.name}" (expectedVersion=${a.version}).`,
          params: {
            auctionId: a.id,
            expectedVersion: a.version,
            asset: a.asset,
            amount: nextMin,
            beneficiary:
              el("cartSigner").value.trim() || "<YOUR_BENEFICIARY_PRINCIPAL>",
          },
        });
      });
    }
    const openBtn = add(card, "button", "History", "secondary small");
    openBtn.type = "button";
    openBtn.addEventListener("click", () =>
      openDetail({
        id: `auction:${a.id}`,
        kind: "auction",
        label: `${a.name} · ${phase}`,
        name: a.name,
        auctionId: a.id,
      }),
    );
  }
}


function statusLabel(status) {
  const map = {
    available: "🟢 Available",
    reserved: "🔒 Reserved",
    owned: "✅ Owned",
    listed: "💰 For sale",
    leased: "📅 Leased",
    "listed-lease": "💰 For sale (lease)",
    "lease-grace": "⚠️ Lease grace",
    "lease-expired": "⌛ Lease expired",
    "auction-current": "🏷️ Auction open",
    "auction-upcoming": "🗓️ Auction upcoming",
    "auction-past": "📜 Auction ended",
    "child-offer": "🟢 Child offer open",
    "unminted-child": "⚪ Child not minted",
    unknown: "❓ Unknown",
  };
  return map[status] || status;
}

function renderMarketplace(s) {
  const box = el("marketplace");
  if (!box) return;
  box.replaceChildren();
  const listings = activeResaleOffers(s).filter((x) => x.asset === "POA");
  if (!listings.length) {
    add(box, "p", "No POA listings right now", "muted");
    return;
  }
  for (const row of listings) {
    const card = add(box, "article", "", "card");
    const h = add(card, "h4", "");
    nameLink(h, row.name);
    add(card, "p", `💰 ${row.price} POA`, "badge-ok");
    const ownerLine = add(card, "p", "Seller: ");
    if (row.offer?.owner) ownerLink(ownerLine, row.offer.owner, person(row.offer.owner));
    add(card, "p", `Until ${row.offer.validUntil}`);
    const btn = add(card, "button", "Add to cart", "small");
    btn.type = "button";
    btn.addEventListener("click", () => {
      addToCart({
        name: row.name,
        tier: "standard",
        isRoot: !String(row.name).includes("."),
        action: "buyFixed",
        asset: "POA",
        amount: row.price,
        summary: `Buy "${row.name}" at ${row.price} POA via offer ${row.offer.id.slice(0, 16)}…`,
        params: {
          offerId: row.offer.id,
          expectedVersion: row.offer.version,
          asset: "POA",
          amount: row.price,
        },
      });
    });
  }
}

function renderDomainPage(name) {
  if (!latestState || !name) return;
  const view = resolveDomainView(latestState, name, reservedSet);
  el("domainTitle").textContent = "";
  nameLink(el("domainTitle"), name);
  el("domainStatus").textContent = statusLabel(view.status);
  const ownerNode = el("domainOwner");
  ownerNode.replaceChildren();
  if (view.owner) {
    ownerNode.append("Owner: ");
    ownerLink(ownerNode, view.owner, person(view.owner));
  } else {
    ownerNode.textContent = "No owner yet";
  }

  const listingBox = el("domainListing");
  listingBox.hidden = !view.listing;
  listingBox.replaceChildren();
  if (view.listing) {
    add(listingBox, "p", `💰 Listed for ${view.listing.price} ${view.listing.asset}`, "badge-ok");
    add(listingBox, "p", `Until ${view.listing.validUntil} · offer ${view.listing.id.slice(0, 18)}…`);
  }

  const actions = el("domainActions");
  actions.replaceChildren();
  if (view.auction && view.auction.status === "live" && view.auctionBucket === "current") {
    const minBid = view.auction.high
      ? minimumNextBid(view.auction.high.amount, cap.increment)
      : view.auction.reserve;
    const bidBtn = add(actions, "button", `🏷️ Bid from ${minBid}`);
    bidBtn.type = "button";
    bidBtn.addEventListener("click", () => {
      addToCart({
        name,
        tier: view.auction.window === 86400 ? "premium" : "standard",
        isRoot: true,
        action: "bid",
        asset: view.auction.asset,
        amount: minBid,
        summary: `Bid ${minBid} ${view.auction.asset} on ${name}`,
        params: {
          auctionId: view.auction.id,
          expectedVersion: view.auction.version,
          asset: view.auction.asset,
          amount: minBid,
          beneficiary: el("cartSigner").value.trim() || "<YOUR_BENEFICIARY_PRINCIPAL>",
        },
      });
      setFloatingCartOpen(true);
    });
  }
  if (view.listing && view.listing.asset === "POA") {
    const buyBtn = add(actions, "button", `🛒 Buy ${view.listing.price} POA`);
    buyBtn.type = "button";
    buyBtn.addEventListener("click", () => {
      addToCart({
        name,
        tier: "standard",
        isRoot: !name.includes("."),
        action: "buyFixed",
        asset: "POA",
        amount: view.listing.price,
        summary: `Buy ${name} for ${view.listing.price} POA`,
        params: {
          offerId: view.listing.id,
          expectedVersion: view.listing.version,
          asset: "POA",
          amount: view.listing.price,
        },
      });
      setFloatingCartOpen(true);
    });
  }
  if (view.status === "available") {
    const startBtn = add(actions, "button", "🟢 Start auction (add to cart)");
    startBtn.type = "button";
    startBtn.addEventListener("click", () => {
      addDetailToCart({ name, kind: "available" });
      setFloatingCartOpen(true);
    });
  }

  const tools = el("domainOwnerTools");
  tools.hidden = !view.deed;
  el("listingPromptStatus").textContent = "";
  if (view.listing?.price) el("listPriceInput").value = view.listing.price;

  const hist = el("domainHistory");
  hist.replaceChildren();
  if (!view.history.length) add(hist, "p", "No history yet", "muted");
  for (const row of view.history) {
    const card = add(hist, "div", "", "card");
    add(card, "p", row.text);
    add(card, "p", `#${row.sequence} · ${row.kind}`, "badge");
  }
}

function renderOwnerPage(ownerId) {
  if (!latestState || !ownerId) return;
  el("ownerTitle").textContent = "👤 Owner profile";
  el("ownerPrincipal").textContent = ownerId;
  const namesBox = el("ownerNames");
  const listBox = el("ownerListings");
  namesBox.replaceChildren();
  listBox.replaceChildren();
  const owned = Object.values(latestState.names ?? {}).filter(
    (n) => n.activeId && latestState.deeds[n.activeId]?.owner === ownerId,
  );
  if (!owned.length) add(namesBox, "p", "No names", "muted");
  for (const n of owned) {
    const d = latestState.deeds[n.activeId];
    const card = add(namesBox, "article", "", "card");
    const h = add(card, "h4", "");
    nameLink(h, n.name);
    add(card, "p", d.rights.kind, "badge");
  }
  const listings = activeResaleOffers(latestState).filter(
    (x) => x.offer.owner === ownerId && x.asset === "POA",
  );
  if (!listings.length) add(listBox, "p", "No active listings", "muted");
  for (const row of listings) {
    const card = add(listBox, "article", "", "card");
    const h = add(card, "h4", "");
    nameLink(h, row.name);
    add(card, "p", `💰 ${row.price} POA`, "badge-ok");
  }
}

function copyDomainListingPrompt(kind) {
  if (shouldHoldTransactions(networkStatus.level) || networkStatus.hold) {
    el("listingPromptStatus").textContent = "Held ⏸️ until the PoA network is back";
    return;
  }
  if (!latestState || !currentDomainName || !cap) return;
  const view = resolveDomainView(latestState, currentDomainName, reservedSet);
  if (!view.deed) {
    el("listingPromptStatus").textContent = "Only the owner can list";
    return;
  }
  const priceRaw = el("listPriceInput").value.trim();
  const secsRaw = el("listValidSeconds").value.trim() || "604800";
  if (kind !== "unlist") {
    if (!/^(0|[1-9][0-9]{0,38})$/.test(priceRaw) || priceRaw === "0") {
      el("listingPromptStatus").textContent = "Enter a POA price greater than 0";
      return;
    }
  }
  if (kind === "unlist" && !view.listing) {
    el("listingPromptStatus").textContent = "Nothing listed";
    return;
  }
  if (kind === "change" && !view.listing) {
    el("listingPromptStatus").textContent = "List first, then change price";
    return;
  }
  if (!/^[1-9][0-9]{0,8}$/.test(secsRaw)) {
    el("listingPromptStatus").textContent = "Valid-for seconds required";
    return;
  }
  const validUntil = latestState.time + Number(secsRaw);
  const text = buildListingPrompt({
    kind,
    name: currentDomainName,
    deed: view.deed,
    offer: view.listing,
    price: priceRaw,
    validUntil,
    endpointUrl: endpointBase(),
  });
  el("listingPromptBox").textContent = text;
  navigator.clipboard.writeText(text).then(
    () => {
      el("listingPromptStatus").textContent = "Copied";
    },
    () => {
      el("listingPromptStatus").textContent = "Clipboard unavailable — copy from the box";
    },
  );
}

function render(payload) {
  const s = payload.state;
  latestState = s;
  el("state").textContent = JSON.stringify(payload, null, 2);
  el("freshness").textContent =
    (demo ? "STATIC SYNTHETIC DEMO · " : "LOCAL COMMITTED STATE · ") +
    `second ${s.time}, sequence ${s.sequence}. ${payload.finality}.`;
  if (demo && details.generatedAt)
    el("freshness").textContent +=
      " Built " +
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(details.generatedAt)) +
      " Pacific time.";

  const names = Object.values(s.names).filter((n) => n.activeId),
    auctions = Object.values(s.auctions),
    offers = Object.values(s.offers ?? {}),
    bids = Object.values(s.bids ?? {}),
    receipts = Object.values(s.receipts ?? {});

  const rootDeeds = names.filter((n) => !s.deeds[n.activeId].parentId).length;
  const childDeeds = names.length - rootDeeds;
  const activeOffers = offers.filter(
    (o) => !o.cancelled && o.uses < o.maxUses && s.time < o.validUntil,
  );
  let settledVolume = 0n;
  for (const b of bids) {
    if (b.status === "won" || b.status === "high")
      settledVolume += BigInt(b.amount);
  }
  for (const o of offers) {
    if (o.uses > 0) settledVolume += BigInt(o.price) * BigInt(o.uses);
  }

  el("stats").replaceChildren();
  for (const [value, label] of [
    [names.length, "owned fixture names"],
    [
      auctions.filter((a) => a.status === "live").length,
      "unsettled fixture auctions",
    ],
    [Object.keys(cap.actions).length, "implemented handoff actions"],
    [`${rootDeeds} / ${childDeeds}`, "root / child active deeds"],
    [
      `${activeOffers.length} / ${offers.length}`,
      "active / total standing offers",
    ],
    [
      `${bids.length} / ${receipts.length}`,
      "recorded bids / committed receipts",
    ],
    [settledVolume.toString(), "POA base units settled & bid"],
    [
      `${cap.emojiAliases ?? 140} / ${reservedSet.size || (cap.reservedCount ?? 655)}`,
      "emoji sequences / reserved roots",
    ],
  ]) {
    const box = add(el("stats"), "div", "");
    add(box, "strong", String(value));
    add(box, "span", label);
  }

  el("names").replaceChildren();
  for (const n of names) {
    const d = s.deeds[n.activeId],
      card = add(el("names"), "article", "", "card");
    const nh = add(card, "h4", "");
    nameLink(nh, n.name);
    const ownerLine = add(card, "p", "", "badge");
    ownerLine.append((demo ? "Synthetic " : "") + d.rights.kind + " deed · ");
    ownerLink(ownerLine, d.owner, person(d.owner));
    add(
      card,
      "p",
      `Generation ${d.generation} · owner version ${d.ownerVersion} · deed version ${d.version}`,
    );
    if (d.parentId)
      add(
        card,
        "p",
        "Protected child of " +
          s.deeds[d.parentId].name +
          "; parent transfer does not remove these rights.",
      );
    if (d.rights.kind === "lease")
      add(
        card,
        "p",
        `Expiry ${d.expiry}; grace ${d.rights.graceSeconds}s; resolveDuringGrace ${d.rights.resolveDuringGrace}; renewal ${d.rights.renewal.kind}.`,
      );
    for (const r of d.records)
      add(card, "p", r.type + ": " + (r.url ?? r.address ?? r.cid), "record");
    add(card, "code", d.metadata[d.metadata.length - 1].cid);
  }
  if (!names.length) add(el("names"), "p", "No owned names");

  renderAuctions(s);
  renderTicker(s);
  renderMarketplace(s);
  updateTabDots(s);
  if (route.kind === "domain" && currentDomainName) renderDomainPage(currentDomainName);
  if (route.kind === "owner" && currentOwnerId) renderOwnerPage(currentOwnerId);

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
    if (o.kind === "child") {
      oh.append("Child offer on .");
      nameLink(oh, targetName);
    } else {
      oh.append("Resale of ");
      nameLink(oh, targetName);
    }
    add(
      card,
      "p",
      `${o.kind} offer · ${statusText} · price ${o.price} ${o.asset}`,
      active ? "badge-ok" : "badge",
    );
    add(
      card,
      "p",
      `Seller: ${person(o.owner)} · Uses: ${o.uses}/${o.maxUses} · Until ${o.validUntil}`,
    );
    if (o.kind === "child" && o.rights) {
      add(
        card,
        "p",
        `Rights: ${o.rights.kind} · Labels: ${o.labels ? o.labels.join(", ") : "any"}`,
      );
    }
    if (active) {
      const sampleLabel =
        o.kind === "child"
          ? o.labels && o.labels.length
            ? o.labels[0]
            : "sub"
          : null;
      const fullTarget =
        o.kind === "child" ? `${sampleLabel}.${targetName}` : targetName;
      const btn = add(card, "button", `Add to cart`, "small");
      btn.type = "button";
      btn.addEventListener("click", () => {
        addToCart({
          name: fullTarget,
          tier: "standard",
          isRoot: o.kind !== "child",
          action: o.kind === "child" ? "fillChildOffer" : "buyFixed",
          asset: o.asset,
          amount: o.price,
          summary:
            o.kind === "child"
              ? `Fill standing child offer ${o.id.slice(0, 16)}… to mint "${fullTarget}" for ${o.price} ${o.asset}.`
              : `Buy "${fullTarget}" at fixed resale price ${o.price} ${o.asset} via offer ${o.id.slice(0, 16)}….`,
          params:
            o.kind === "child"
              ? {
                  offerId: o.id,
                  expectedVersion: o.version,
                  expectedGeneration:
                    (s.names[fullTarget]?.generation ?? 0) + 1,
                  label: sampleLabel,
                  asset: o.asset,
                  amount: o.price,
                }
              : {
                  offerId: o.id,
                  expectedVersion: o.version,
                  asset: o.asset,
                  amount: o.price,
                },
        });
      });
    }
  }
  if (!offers.length) add(el("offers"), "p", "No offers");

  el("history").replaceChildren();
  const sortedBids = [...bids].sort((a, b) => b.sequence - a.sequence);
  for (const b of sortedBids) {
    const a = s.auctions[b.auctionId];
    const domainName = a ? a.name : b.auctionId.slice(0, 14);
    const card = add(el("history"), "div", "", "card");
    const hh = add(card, "h4", "");
    nameLink(hh, domainName);
    hh.append(` — ${b.amount} ${a ? a.asset : "POA"}`);
    add(
      card,
      "p",
      `Bid status: ${b.status.toUpperCase()} · Sequence #${b.sequence} · Second ${b.at}`,
      b.status === "won" || b.status === "high" ? "badge-ok" : "badge",
    );
    add(
      card,
      "p",
      `Payer: ${person(b.payer)} · Beneficiary: ${person(b.beneficiary)}`,
    );
  }
  const purchaseReceipts = [...receipts]
    .filter(
      (r) =>
        r.status === "succeeded" &&
        r.result &&
        (r.result.deedId || r.result.offerId || r.result.recordsVersion),
    )
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
    add(card, "h4", label);
    add(
      card,
      "p",
      `Receipt #${r.sequence} · Second ${r.time} · Status: ${r.status}`,
      "badge",
    );
    add(card, "p", `Signer: ${person(r.signer)} · Request: ${r.requestId}`);
    add(card, "code", `intentId: ${r.intentId.slice(0, 24)}…`);
  }
  if (!sortedBids.length && !purchaseReceipts.length)
    add(el("history"), "p", "No history");

  el("balances").replaceChildren();
  for (const c of Object.values(s.credits ?? {})) {
    if (c.amount === "0") continue;
    const card = add(el("balances"), "div", "", "card");
    const a = s.auctions[c.auctionId];
    add(card, "h4", `Refund: ${c.amount} ${c.asset}`);
    add(
      card,
      "p",
      `${person(c.payer)} · ${a ? a.name : c.auctionId.slice(0, 12)} · v${c.version}`,
      "badge-ok",
    );
  }
  for (const [who, wallet] of Object.entries(s.balances ?? {})) {
    const card = add(el("balances"), "div", "", "card");
    add(card, "h4", person(who));
    const entries = Object.entries(wallet)
      .map(([asset, amt]) => `${amt} ${asset}`)
      .join(" · ");
    add(card, "p", entries, "record");
    add(card, "code", who);
  }
}

try {
  applySiteTitle();
  cart = loadCart(globalThis.localStorage);
  tabSeen = loadTabSeen(globalThis.localStorage);

  const pathDomain = parseDomainPath(location.pathname);
  const pathOwner = parseOwnerPath(location.pathname);
  if (pathDomain) {
    route = { kind: "domain", name: pathDomain };
    currentDomainName = pathDomain;
  } else if (pathOwner) {
    route = { kind: "owner", ownerId: pathOwner };
    currentOwnerId = pathOwner;
  } else {
    route = { kind: "home" };
  }

  const config = await json(new URL("config.json", import.meta.url));
  configMode = config.mode;
  demo = config.mode === "static-synthetic-demo";
  let read;
  if (demo) {
    if (config.publicApiBase !== null) throw Error("Demo has no backend");
    const files = config.files;
    [cap, details, examples] = await Promise.all([
      json(staticURL(files.capabilities)),
      json(staticURL(files.details)),
      json(staticURL(files.examples)),
    ]);
    read = () => json(staticURL(files.state));
    el("mode").textContent =
      "TEST-ONLY SYNTHETIC DEMO · Temporary reference fixture. Not live PoA ownership, assets or transactions. No backend, wallet connection, signing or browser writes. All balances and principals are throwaway fixtures; signing keys were discarded.";
    el("example").hidden = false;
    el("exampleNotice").textContent =
      "Synthetic examples only. Do not sign or submit.";
  } else {
    if (config.mode !== "local-reference-only") throw Error("Unknown mode");
    if (config.publicApiBase) {
      const u = new URL(config.publicApiBase);
      if (
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        (u.protocol !== "https:" &&
          !(u.protocol === "http:" && u.hostname === "127.0.0.1"))
      )
        throw Error("Public endpoint only");
      base = u.origin;
    }
    cap = await json(base + "/v1/capabilities");
    read = () => json(base + "/v1/state");
  }
  if (cap.livePoA !== false)
    throw Error("Only local reference profile is supported");
  if (typeof cap.reservedCatalog === "string" && cap.reservedCatalog.length) {
    reservedSet = new Set(cap.reservedCatalog.split(",").filter(Boolean));
  }
  for (const action of Object.keys(cap.actions)) {
    const option = document.createElement("option");
    option.value = action;
    option.textContent = action;
    el("action").append(option);
  }
  const keys = () => {
    el("keys").textContent = JSON.stringify(cap.actions[el("action").value]);
  };
  el("action").addEventListener("change", keys);
  el("handoff").addEventListener("input", clearHandoff);
  el("handoff").addEventListener("change", clearHandoff);
  keys();
  const refresh = async () => render(await read());
  el("refresh").addEventListener("click", () =>
    refresh().catch(() => {
      el("error").textContent = "Read failed";
    }),
  );
  await refresh();
  renderCart();
  applyRoute();
  setSectionTab(activeSectionTab, false);
  updateTabDots(latestState);

  for (const btn of document.querySelectorAll(".section-tab")) {
    btn.addEventListener("click", () => {
      setSectionTab(btn.getAttribute("data-tab") || "find", true);
    });
  }
  el("domainHomeLink")?.addEventListener("click", (event) => {
    event.preventDefault();
    navigateHome();
  });
  el("ownerHomeLink")?.addEventListener("click", (event) => {
    event.preventDefault();
    navigateHome();
  });
  el("copyListPromptBtn")?.addEventListener("click", () => copyDomainListingPrompt("list"));
  el("copyChangePromptBtn")?.addEventListener("click", () => copyDomainListingPrompt("change"));
  el("copyUnlistPromptBtn")?.addEventListener("click", () => copyDomainListingPrompt("unlist"));
  window.addEventListener("popstate", () => {
    const d = parseDomainPath(location.pathname);
    const o = parseOwnerPath(location.pathname);
    if (d) {
      route = { kind: "domain", name: d };
      currentDomainName = d;
      currentOwnerId = null;
    } else if (o) {
      route = { kind: "owner", ownerId: o };
      currentOwnerId = o;
      currentDomainName = null;
    } else {
      route = { kind: "home" };
      currentDomainName = null;
      currentOwnerId = null;
    }
    applyRoute();
  });

  el("searchBtn").addEventListener("click", () =>
    runSearch(el("searchInput").value),
  );
  el("searchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch(el("searchInput").value);
    }
  });
  for (const pill of document.querySelectorAll(".pill")) {
    pill.addEventListener("click", () => {
      const q = pill.getAttribute("data-query") ?? "";
      el("searchInput").value = q;
      runSearch(q);
    });
  }
  el("cartSigner").addEventListener("input", () => {
    updatePromptText();
  });
  el("clearCart").addEventListener("click", clearAllCart);
  el("copyCartPrompt").addEventListener("click", async () => {
    if (shouldHoldTransactions(networkStatus.level) || networkStatus.hold) {
      el("cartStatus").textContent = "Held ⏸️ until the PoA network is back";
      return;
    }
    const text = el("cartPrompt").textContent;
    if (!text || !cart.length) return;
    try {
      await navigator.clipboard.writeText(text);
      el("cartStatus").textContent = "Copied";
    } catch {
      el("cartStatus").textContent = "Clipboard unavailable";
    }
  });

  for (const tab of document.querySelectorAll(".auction-tab")) {
    tab.addEventListener("click", () => {
      auctionTab = tab.getAttribute("data-auction-tab") || "current";
      for (const t of document.querySelectorAll(".auction-tab")) {
        const on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      }
      if (latestState) renderAuctions(latestState);
    });
  }

  el("detailClose").addEventListener("click", closeDetail);
  el("floatingCartBtn").addEventListener("click", () =>
    setFloatingCartOpen(true),
  );
  el("floatingCartClose").addEventListener("click", () =>
    setFloatingCartOpen(false),
  );
  el("floatingCartBackdrop").addEventListener("click", () =>
    setFloatingCartOpen(false),
  );
  el("floatingCartClear").addEventListener("click", clearAllCart);
  el("copyCheckoutBtn").addEventListener("click", async () => {
    if (shouldHoldTransactions(networkStatus.level) || networkStatus.hold) {
      el("floatingCartStatus").textContent = "Held ⏸️ until the PoA network is back";
      return;
    }
    if (!cart.length || !cap) return;
    const text = buildAgentCheckoutHandoff(
      cart,
      cap,
      el("cartSigner").value.trim(),
      endpointBase(),
      configMode,
    );
    try {
      await navigator.clipboard.writeText(text);
      el("floatingCartStatus").textContent = "Checkout copied";
    } catch {
      el("floatingCartStatus").textContent = "Clipboard unavailable";
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!el("floatingCartPanel").hidden) setFloatingCartOpen(false);
    else if (!el("detailView").hidden) closeDetail();
  });

  const dismissBtn = el("networkStatusDismiss");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      const level = networkStatus.level || "checking";
      dismissNetworkBanner(globalThis.sessionStorage, level);
      renderNetworkStatus();
    });
  }

  if (!demo) {
    tickerTimer = setInterval(() => {
      refresh().catch(() => {});
    }, TICKER_MS);
    refreshNetworkStatus().catch(() => {});
    networkTimer = setInterval(() => {
      refreshNetworkStatus().catch(() => {});
    }, NETWORK_MS);
  } else {
    renderNetworkStatus();
  }

  el("example").addEventListener("click", () => {
    const x = examples[el("action").value];
    if (!x) return;
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
    const selectedGeneration = generation;
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
        if (!/^(0|[1-9][0-9]*)$/.test(el(id).value)) throw Error("Integer");
        input[id] = Number(el(id).value);
      }
      input.coSigners = parsePublicJSON(el("coSigners").value);
      input.params = parsePublicJSON(el("params").value);
      const body = makeBody(input, cap),
        id = await digest(body),
        note = instructions(body, id, config.mode);
      if (selectedGeneration !== generation) return;
      el("copy").disabled = false;
      el("body").textContent = canonical(body);
      el("digest").textContent = id;
      el("instructions").textContent = note;
      copy = note + "\n" + canonical(body);
    } catch {
      el("error").textContent =
        "Invalid public input. Check exact schema, canonical fields, principals, versions, caps and validity. No request was sent.";
    }
  });
  el("copy").addEventListener("click", async () => {
    if (copy)
      try {
        await navigator.clipboard.writeText(copy);
      } catch {
        el("error").textContent =
          "Clipboard unavailable; copy the inert text manually.";
      }
  });
} catch {
  el("error").textContent =
    "Reference data unavailable or unsupported. Nothing can be submitted here.";
}
