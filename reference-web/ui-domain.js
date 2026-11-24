import { extractDomainProfile, profileImageMediaPath, publicNameUnavailable, unavailableKey } from "./shared.js?v=9fe77daffcb5";
import { registryUnit, poaOnlyMode } from "./shared.js?v=9fe77daffcb5";
import { actionLabel, createPoaCopyButton } from "./ui-copy.js?v=9fe77daffcb5";
import { ui } from "./ui-state.js?v=9fe77daffcb5";
import { activeResaleOffers, formatClock, minimumNextBid, resolveDomainView } from "./shared.js?v=9fe77daffcb5";
import { add, appendPoaAddress, el, ownershipView, person, statusLabel, namedText } from "./ui-core.js?v=9fe77daffcb5";
import { nameLink, openManageDomain, ownerLink } from "./ui-router.js?v=9fe77daffcb5";
import { addDetailToCart, addToCart, setFloatingCartOpen } from "./ui-cart.js?v=9fe77daffcb5";

function appendCopyableValue(parent, value, ariaLabel) {
    const wrap = document.createElement("span");
    wrap.className = "poa-addr-inline";
    const code = document.createElement("code");
    code.className = "poa-addr-text";
    code.textContent = value.length > 18 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
    code.title = value;
    wrap.append(code, createPoaCopyButton(value, { ariaLabel }));
    parent.append(wrap);
}

function renderDomainProfileCard(deed) {
    const box = el("domainProfile");
    if (!box)
        return;
    box.replaceChildren();
    if (!deed) {
        box.hidden = true;
        return;
    }
    const extracted = extractDomainProfile(deed);
    if (!extracted || extracted.isDefault) {
        box.hidden = true;
        return;
    }
    const p = extracted.profile;
    box.hidden = false;
    const head = add(box, "div", "", "domain-profile-head");
    const mediaPath = profileImageMediaPath(p.image);
    if (mediaPath) {
        const img = document.createElement("img");
        img.className = "domain-avatar";
        img.src = mediaPath;
        img.alt = `Avatar for ${deed.name}`;
        img.addEventListener("error", () => { img.hidden = true; });
        head.append(img);
    }
    const meta = add(head, "div", "", "domain-profile-meta");
    add(meta, "h3", `🪪 Public profile (v${p.version} · #${extracted.metadataVersion})`);
    if (p.description)
        add(meta, "p", p.description, "domain-profile-bio");
    if (p.image && !mediaPath) {
        const linkLine = add(meta, "p", "🖼️ Avatar: ", "muted");
        if (p.image.startsWith("https://")) {
            const a = document.createElement("a");
            a.href = p.image;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = p.image;
            linkLine.append(a);
        }
        else {
            add(linkLine, "code", p.image);
        }
    }
    const fields = add(box, "div", "", "domain-profile-fields");
    const poaRow = add(fields, "p", "POA: ", "record");
    appendPoaAddress(poaRow, p.poa, { code: true });
    if (p.btc) {
        const btcRow = add(fields, "p", "BTC: ", "record");
        appendCopyableValue(btcRow, p.btc, `Copy BTC address for ${deed.name}`);
    }
    if (p.eth) {
        const ethRow = add(fields, "p", "ETH / Base: ", "record");
        appendCopyableValue(ethRow, p.eth, `Copy ETH address for ${deed.name}`);
    }
    if (extracted.cid) {
        const cidRow = add(box, "p", "IPFS / R2 CID: ", "muted");
        add(cidRow, "code", extracted.cid);
    }
}

export function renderDomainPage(name) {
    if (!ui.latestState || !name)
        return;
    if(publicNameUnavailable(name,ui.cap)) {
      el("domainTitle").textContent="Name unavailable";el("domainStatus").textContent="🔒 Stored record withheld — not free to register";el("domainOwner").textContent="No public ownership record.";
      if(el("domainProfile")){el("domainProfile").hidden=true;el("domainProfile").replaceChildren();}
      el("domainListing").hidden=true;el("domainListing").replaceChildren();el("domainActions").replaceChildren();el("domainHistory").replaceChildren();add(el("domainHistory"),"p","No public history.");el("domainOwnerTools").hidden=true;return;
    }
    const view = resolveDomainView(ui.latestState, name, ui.reservedSet, ownershipView());
    el("domainTitle").textContent = "";
    nameLink(el("domainTitle"), name);
    el("domainStatus").textContent = statusLabel(view.status);
    const ownerNode = el("domainOwner");
    ownerNode.replaceChildren();
    if (view.owner) {
        ownerNode.append("Owner: ");
        ownerLink(ownerNode, view.owner, person(view.owner));
        ownerNode.append(" · ♾️ Permanent registry rights · not proof of native-chain ownership");
    }
    else if (view.variantOf) {
        ownerNode.append("🔒 Same emoji as ");
        nameLink(ownerNode, view.variantOf);
        ownerNode.append(" · one owner per emoji");
    }
    else {
        ownerNode.textContent = "No owner yet";
    }
    renderDomainProfileCard(view.deed);
    const poa = poaOnlyMode(ui.cap);
    const listingBox = el("domainListing");
    listingBox.hidden = !view.listing || poa;
    listingBox.replaceChildren();
    if (view.listing && !poa) {
        add(listingBox, "p", `💰 Listed for ${view.listing.price} ${registryUnit(view.listing.asset)}`, "badge-ok");
        add(listingBox, "p", `Until ${formatClock(view.listing.validUntil)} · offer ${view.listing.id.slice(0, 18)}…`);
    }
    const actions = el("domainActions");
    actions.replaceChildren();
    if (view.deed && !view.deed.retired) {
        const manageBtn = add(actions, "button", "⚙️ Manage this domain", "secondary");
        manageBtn.type = "button";
        manageBtn.setAttribute("aria-label", `Manage ${name}`);
        manageBtn.addEventListener("click", () => openManageDomain(name, view.deed.owner));
    }
    if (!poa && view.auction && view.auction.status === "live" && view.auctionBucket === "current") {
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
    if (!poa && view.listing && view.listing.asset === "POA") {
        const buyBtn = add(actions, "button", `🛒 Buy ${view.listing.price} registry units`);
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
        const startBtn = add(actions, "button", poa ? "🛒 Add to cart" : "🟢 Start auction (add to cart)");
        startBtn.type = "button";
        startBtn.addEventListener("click", () => {
            addDetailToCart({ name, kind: "available" });
            setFloatingCartOpen(true);
        });
    }
    const tools = el("domainOwnerTools");
    tools.hidden = !view.deed;
    if (el("poaSellTools")) el("poaSellTools").hidden = !poa;
    if (el("poaSubnameTools")) el("poaSubnameTools").hidden = !poa || String(ui.currentDomainName ?? "").includes(".");
    if (el("unitSellTools")) el("unitSellTools").hidden = poa;
    el("listingPromptStatus").textContent = "";
    if (view.listing?.price)
        el("listPriceInput").value = view.listing.price;
    const hist = el("domainHistory");
    hist.replaceChildren();
    if (!view.history.length)
        add(hist, "p", "No history yet", "muted");
    for (const row of view.history) {
        const card = add(hist, "div", "", "card");
        namedText(add(card,"p",""),row.text);
        add(card, "p", `#${row.sequence} · ${actionLabel(row.kind)}`, "badge");
    }
}

export function renderOwnerPage(ownerId) {
    if (!ui.latestState || !ownerId)
        return;
    if(ui.cap?.publicView?.unavailableAccountKeys?.includes(unavailableKey(ownerId))){
      el("ownerTitle").textContent="No public owner profile";el("ownerPrincipal").textContent="";el("ownerNames").replaceChildren();el("ownerListings").replaceChildren();add(el("ownerNames"),"p","No public registry names or subdomains.");add(el("ownerListings"),"p","No public listings.");return;
    }
    el("ownerTitle").textContent = "👤 Owner profile";
    const principalNode = el("ownerPrincipal");
    principalNode.replaceChildren();
    appendPoaAddress(principalNode, ownerId, { code: true });
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
        const manageBtn = add(card, "button", "⚙️ Manage this domain", "secondary small");
        manageBtn.type = "button";
        manageBtn.setAttribute("aria-label", `Manage ${n.name}`);
        manageBtn.addEventListener("click", () => openManageDomain(n.name, d.owner));
    }
    const listings = poaOnlyMode(ui.cap) ? [] : activeResaleOffers(ui.latestState).filter((x) => x.offer.owner === ownerId && x.asset === "POA");
    if (!listings.length)
        add(listBox, "p", "No active listings", "muted");
    for (const row of listings) {
        const card = add(listBox, "article", "", "card");
        const h = add(card, "h4", "");
        nameLink(h, row.name);
        add(card, "p", `💰 ${row.price} registry units`, "badge-ok");
    }
}
