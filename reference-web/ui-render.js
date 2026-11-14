import { registryUnit, poaOnlyMode } from "./shared.js?v=f6b94cbcb2f0";
import { drawTicker } from "./ui-ticker.js?v=f6b94cbcb2f0";
import { actionLabel } from "./ui-copy.js?v=f6b94cbcb2f0";
import { returnFocus } from "./ui-a11y.js?v=f6b94cbcb2f0";
import { activeResaleOffers, buildSiteTitle, formatClock, formatDuration, historyForTarget, minimumNextBid, partitionAuctions, registryViewState, shapeLiveActions, tabHasNew, tabWatermarks } from "./shared.js?v=f6b94cbcb2f0";
import { ui } from "./ui-state.js?v=f6b94cbcb2f0";
import { add, el, person, namedText } from "./ui-core.js?v=f6b94cbcb2f0";
import { nameLink, navigateDomain, ownerLink, openPoa } from "./ui-router.js?v=f6b94cbcb2f0";
import { addDetailToCart, addToCart } from "./ui-cart.js?v=f6b94cbcb2f0";
import { renderDomainPage, renderOwnerPage } from "./ui-domain.js?v=f6b94cbcb2f0";

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

export function applySiteTitle() {
    const title = buildSiteTitle();
    const h1 = el("siteTitle");
    h1.replaceChildren();
    h1.dataset.theme = title.theme;
    h1.dataset.tile = title.tile;
    h1.setAttribute("aria-label", "poadomains");
    title.glyphs.forEach((g, i) => {
        const span = document.createElement("span");
        span.className = g.kind === "tile" ? "title-glyph title-tile" : "title-glyph";
        span.setAttribute("aria-hidden", "true");
        span.textContent = g.text;
        h1.append(span);
    });
    document.title = "PoA domains";
}

export function renderTicker(state) { drawTicker(state); }

let detailOpener = null;
export function closeDetail() {
    const wasOpen = !el("detailView").hidden;
    ui.detailTarget = null;
    el("detailView").hidden = true;
    if(wasOpen) returnFocus(detailOpener,document.querySelector(".section-tab[aria-selected=true]"));
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
    if(item.name)nameLink(el("detailTitle"),item.name);else el("detailTitle").textContent=actionLabel(item.label||"Detail");
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

function poaPointer(box, text) {
    add(box, "p", text, "muted");
    const go = add(box, "button", "🪙 Open My POA", "secondary small");
    go.type = "button";
    go.addEventListener("click", () => openPoa());
}
export function renderAuctions(s) {
    if (poaOnlyMode(ui.cap)) {
        el("auctions").replaceChildren();
        poaPointer(el("auctions"), "🪙 Auctions are in POA. Open My POA to bid or start one.");
        return;
    }
    const groups = partitionAuctions(Object.values(s.auctions ?? {}), s.time);
    const list = groups[ui.auctionTab] ?? [];
    el("auctions").replaceChildren();
    if (!list.length) {
        add(el("auctions"), "p", `No ${ui.auctionTab} auctions`, "muted");
        return;
    }
    for (const a of list) {
        const card = add(el("auctions"), "article", "", "card");
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
        nameLink(ah, a.name);
        add(card, "p", phase, "badge");
        add(card, "p", `Reserve ${a.reserve} ${registryUnit(a.asset)}. ${a.high ? "High bid " + a.high.amount + " by " + person(a.high.payer) : "No active high bid."}`);
        add(card, "p", `Window ${formatDuration(a.window)} + quiet ${formatDuration(a.quiet)} · closes ${formatClock(close)}`);
        if (a.status === "live" && !(typeof s.time === "number" && s.time < a.openAt)) {
            const nextMin = a.high
                ? minimumNextBid(a.high.amount, ui.cap.increment)
                : a.reserve;
            add(card, "p", `Minimum next bid: ${nextMin} ${registryUnit(a.asset)} (version ${a.version})`, "badge-ok");
            const btn = add(card, "button", `Add to cart`, "small");
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
        const openBtn = add(card, "button", "History", "secondary small");
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
        poaPointer(box, "🪙 Names for sale are priced in POA. Open My POA to buy or list one.");
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
        nameLink(h, row.name);
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

export function render(payload) {
    ui.rawSnapshot = payload;
    const s = registryViewState(payload);
    ui.latestState = s;
    el("state").textContent = JSON.stringify(payload, null, 2);
    el("freshness").textContent =
        (ui.demo ? "SYNTHETIC DEMO · " : ui.configMode === "live-registry" ? "HOSTED REGISTRY DATA · " : "LOCAL REGISTRY DATA · ") +
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
        ...(poaOnlyMode(ui.cap) ? [] : [[settledVolume.toString(), "Registry bids + filled offers (local registry units, not on-chain volume)"]]),
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
        const d = s.deeds[n.activeId], card = add(el("names"), "article", "", "card");
        const nh = add(card, "h4", "");
        nameLink(nh, n.name);
        const ownerLine = add(card, "p", "", "badge");
        ownerLine.append((ui.demo ? "Synthetic " : "") + d.rights.kind + " deed · ");
        ownerLink(ownerLine, d.owner, person(d.owner));
        add(card, "p", `Generation ${d.generation} · owner version ${d.ownerVersion} · deed version ${d.version}`);
        if (d.parentId)
            namedText(add(card,"p",""),"Protected child of "+s.deeds[d.parentId].name+"; parent transfer does not remove these registry rights.");
        add(card, "p", d.rights.kind === "lease"
            ? "📜 Legacy lease record · renewals are off"
            : "♾️ Owned forever · resale or transfer only", "badge-ok");
        for (const r of d.records)
            add(card, "p", r.type + ": " + (r.url ?? r.address ?? r.cid), "record");
        add(card, "code", d.metadata[d.metadata.length - 1].cid);
    }
    if (!names.length)
        add(el("names"), "p", "No owned names");
    renderAuctions(s);
    renderTicker(s);
    renderMarketplace(s);
    updateTabDots(s);
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
        if (o.kind === "child") {
            oh.append("Child offer on .");
            nameLink(oh, targetName);
        }
        else {
            oh.append("Resale of ");
            nameLink(oh, targetName);
        }
        add(card, "p", `${o.kind} offer · ${statusText} · price ${o.price} ${registryUnit(o.asset)}`, active ? "badge-ok" : "badge");
        add(card, "p", `Seller: ${person(o.owner)} · Uses: ${o.uses}/${o.maxUses} · Until ${formatClock(o.validUntil)}`);
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
        nameLink(hh, domainName);
        hh.append(` — ${b.amount} ${registryUnit(a ? a.asset : "POA")}`);
        add(card, "p", `Bid status: ${b.status.toUpperCase()} · Sequence #${b.sequence} · ${formatClock(b.at)}`, b.status === "won" || b.status === "high" ? "badge-ok" : "badge");
        add(card, "p", `Payer: ${person(b.payer)} · Beneficiary: ${person(b.beneficiary)}`);
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
        add(card, "p", `Signer: ${person(r.signer)} · Request: ${r.requestId}`);
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
        const refundLine = add(card, "p", `${person(c.payer)} · `, "badge-ok");
        if (a) nameLink(refundLine, a.name); else refundLine.append(c.auctionId.slice(0, 12));
        refundLine.append(` · v${c.version}`);
    }
    if (!Object.keys(s.balances ?? {}).length && !Object.keys(s.credits ?? {}).length) add(el("balances"), "p", "No public registry-unit balances or refunds. These are not POA or wallet balances.", "muted");
    for (const [who, wallet] of Object.entries(s.balances ?? {})) {
        const card = add(el("balances"), "div", "", "card");
        add(card, "h4", person(who));
        const entries = Object.entries(wallet)
            .map(([asset, amt]) => `${amt} ${registryUnit(asset)}`)
            .join(" · ");
        add(card, "p", entries, "record");
        add(card, "code", who);
    }
}
