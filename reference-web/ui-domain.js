import { ui } from "./ui-state.js?v=6f6694bf7a62";
import { activeResaleOffers, formatClock, minimumNextBid, resolveDomainView } from "./shared.js?v=6f6694bf7a62";
import { add, el, ownershipView, person, statusLabel } from "./ui-core.js?v=6f6694bf7a62";
import { nameLink, ownerLink } from "./ui-router.js?v=6f6694bf7a62";
import { addDetailToCart, addToCart, setFloatingCartOpen } from "./ui-cart.js?v=6f6694bf7a62";

export function renderDomainPage(name) {
    if (!ui.latestState || !name)
        return;
    const view = resolveDomainView(ui.latestState, name, ui.reservedSet, ownershipView());
    el("domainTitle").textContent = "";
    nameLink(el("domainTitle"), name);
    el("domainStatus").textContent = statusLabel(view.status);
    const ownerNode = el("domainOwner");
    ownerNode.replaceChildren();
    if (view.owner) {
        ownerNode.append("Owner: ");
        ownerLink(ownerNode, view.owner, person(view.owner));
        ownerNode.append(" · ♾️ Owned forever · resale or transfer only");
    }
    else if (view.variantOf) {
        ownerNode.append("🔒 Same emoji as ");
        nameLink(ownerNode, view.variantOf);
        ownerNode.append(" · one owner per emoji");
    }
    else {
        ownerNode.textContent = "No owner yet";
    }
    const listingBox = el("domainListing");
    listingBox.hidden = !view.listing;
    listingBox.replaceChildren();
    if (view.listing) {
        add(listingBox, "p", `💰 Listed for ${view.listing.price} ${view.listing.asset}`, "badge-ok");
        add(listingBox, "p", `Until ${formatClock(view.listing.validUntil)} · offer ${view.listing.id.slice(0, 18)}…`);
    }
    const actions = el("domainActions");
    actions.replaceChildren();
    if (view.auction && view.auction.status === "live" && view.auctionBucket === "current") {
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
                auctionId: view.auction.id
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
                action: "buyFixed",
                amount: view.listing.price,
                offerId: view.listing.id
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
    if (view.listing?.price)
        el("listPriceInput").value = view.listing.price;
    const hist = el("domainHistory");
    hist.replaceChildren();
    if (!view.history.length)
        add(hist, "p", "No history yet", "muted");
    for (const row of view.history) {
        const card = add(hist, "div", "", "card");
        add(card, "p", row.text);
        add(card, "p", `#${row.sequence} · ${row.kind}`, "badge");
    }
}

export function renderOwnerPage(ownerId) {
    if (!ui.latestState || !ownerId)
        return;
    el("ownerTitle").textContent = "👤 Owner profile";
    el("ownerPrincipal").textContent = ownerId;
    const namesBox = el("ownerNames");
    const listBox = el("ownerListings");
    namesBox.replaceChildren();
    listBox.replaceChildren();
    const owned = Object.values(ui.latestState.names ?? {}).filter((n) => n.activeId && ui.latestState.deeds[n.activeId]?.owner === ownerId);
    if (!owned.length)
        add(namesBox, "p", "No names", "muted");
    for (const n of owned) {
        const d = ui.latestState.deeds[n.activeId];
        const card = add(namesBox, "article", "", "card");
        const h = add(card, "h4", "");
        nameLink(h, n.name);
        add(card, "p", d.rights.kind, "badge");
    }
    const listings = activeResaleOffers(ui.latestState).filter((x) => x.offer.owner === ownerId && x.asset === "POA");
    if (!listings.length)
        add(listBox, "p", "No active listings", "muted");
    for (const row of listings) {
        const card = add(listBox, "article", "", "card");
        const h = add(card, "h4", "");
        nameLink(h, row.name);
        add(card, "p", `💰 ${row.price} POA`, "badge-ok");
    }
}
