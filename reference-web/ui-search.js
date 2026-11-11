import { publicNameUnavailable } from "./shared.js?v=16e74e99de64";
import { registryUnit } from "./shared.js?v=16e74e99de64";
import { ui } from "./ui-state.js?v=16e74e99de64";
import { nameLink, navigateDomain, writeViewURL } from "./ui-router.js?v=16e74e99de64";
import { add, el, person, variantOwner } from "./ui-core.js?v=16e74e99de64";
import { compactAmount, formatClock, formatDuration, inspectName, minimumNextBid, nameErrorReason, rootAuctionPolicy } from "./shared.js?v=16e74e99de64";
import { addToCart } from "./ui-cart.js?v=16e74e99de64";

export function runSearch(rawQuery, remember = true) {
    if (remember) {
        ui.lastSearch = (rawQuery ?? "").trim().slice(0, 2048);
        writeViewURL();
    }
    const container = el("searchResult"), q = (rawQuery ?? "").trim();
    try {
    container.replaceChildren();
    if (!q)
        return;
    if (!ui.cap || !ui.latestState) {
        add(container, "p", "⏳ Loading registry data. Your search will run when it is ready.");
        return;
    }
    let info;
    try {
        info = inspectName(q, ui.cap.emojiManifest);
    }
    catch (error) {
        const card = add(container, "div", "", "card");
        add(card, "h4", q);
        add(card, "p", nameErrorReason(error), "badge-warn");
        return;
    }
    if(publicNameUnavailable(info.canonical,ui.cap)){add(container,"p","🔒 Name unavailable. Stored records are withheld from public view; this name is not free to register.","badge-warn");return;}
    const s = ui.latestState;
    const name = info.canonical;
    const card = add(container, "div", "", "card");
    const title = add(card, "h4", "");
    nameLink(title, name);
    const openPage = add(card, "button", "Open page", "secondary small");
    openPage.type = "button";
    openPage.addEventListener("click", () => navigateDomain(name));
    const kind=add(card,"p",info.isRoot?"Root":"Child of ");if(!info.isRoot)nameLink(kind,info.parent);kind.append(" · "+info.tier.toUpperCase());
    if (info.isRoot && ui.reservedSet.has(name)) {
        add(card, "p", "🔒 Reserved — not for sale", "badge-warn");
        add(card, "p", `${ui.reservedSet.size}-name reservation catalog`);
        return;
    }
    const sameEmoji = variantOwner(name);
    if (sameEmoji) {
        add(card, "p", "🔒 Taken — same emoji as another name", "badge-warn");
        const p = add(card, "p", "Owned or in auction as ");
        nameLink(p, sameEmoji);
        add(card, "p", "One owner per emoji, whatever the skin tone or style.").setAttribute("data-info-description", "");
        return;
    }
    const entry = s.names[name];
    const liveAuction = entry?.auctionId && s.auctions[entry.auctionId]?.status === "live"
        ? s.auctions[entry.auctionId]
        : Object.values(s.auctions).find((a) => a.name === name && a.status === "live");
    if (liveAuction) {
        const minBid = liveAuction.high
            ? minimumNextBid(liveAuction.high.amount, ui.cap.increment)
            : liveAuction.reserve;
        add(card, "p", "🏷️ In auction now", "badge");
        add(card, "p", `Auction ID: ${liveAuction.id.slice(0, 18)}… · Version ${liveAuction.version} · Reserve: ${liveAuction.reserve} ${registryUnit(liveAuction.asset)} · ${liveAuction.high ? "Current high bid: " + liveAuction.high.amount + " by " + person(liveAuction.high.payer) : "No bids yet"}`);
        add(card, "p", `Minimum next valid bid: ${minBid} ${registryUnit(liveAuction.asset)} base units.`, "badge-ok");
        const controls = add(card, "div", "", "inline-controls");
        const bidInput = document.createElement("input");
        bidInput.value = minBid;
        bidInput.setAttribute("inputmode", "numeric");
        bidInput.setAttribute("aria-label", "Bid amount in registry units for " + name);
        const amountLabel=add(controls,"label","Bid amount (registry units)","amount-label"),unitBox=add(amountLabel,"span","","amount-unit");unitBox.append(bidInput);add(unitBox,"span","units","input-unit");bidInput.placeholder="Whole-number registry units";add(amountLabel,"small","Your bid for this name, at least the current minimum. Nothing is paid here.","muted");
        const btn = add(controls, "button", "Add to cart", "small");
        btn.id = "addToCartBtn";
        btn.type = "button";
        const inputError = add(card, "p", "", "badge-warn");
        inputError.setAttribute("role", "alert");
        btn.addEventListener("click", () => {
            const chosen = bidInput.value.trim();
            if (!/^[1-9][0-9]{0,38}$/.test(chosen) || BigInt(chosen) < BigInt(minBid)) {
                inputError.textContent = `⚠️ Enter a whole-number bid of at least ${minBid} ${registryUnit(liveAuction.asset)}.`;
                bidInput.setAttribute("aria-invalid", "true");
                return;
            }
            inputError.textContent = "";
            bidInput.removeAttribute("aria-invalid");
            addToCart({
                name,
                action: "bid",
                amount: chosen,
                auctionId: liveAuction.id
            });
        });
        return;
    }
    if (entry?.activeId && s.deeds[entry.activeId]) {
        const d = s.deeds[entry.activeId];
        add(card, "p", `✅ Owned (${d.rights.kind}) — OWNED (${d.rights.kind.toUpperCase()} DEED)`, "badge");
        add(card, "p", `Owner: ${person(d.owner)} · Generation ${d.generation} · Owner version ${d.ownerVersion} · Deed version ${d.version}`);
        const resaleOffer = Object.values(s.offers).find((o) => o.kind === "resale" &&
            o.parentId === d.id &&
            !o.cancelled &&
            o.uses < o.maxUses &&
            s.time < o.validUntil);
        if (resaleOffer) {
            add(card, "p", `💰 For sale: ${resaleOffer.price} ${registryUnit(resaleOffer.asset)} (until ${formatClock(resaleOffer.validUntil)}) — Active fixed-price resale listing: ${resaleOffer.price} ${registryUnit(resaleOffer.asset)}`, "badge-ok");
            const btn = add(card, "button", "Add to cart", "small");
            btn.id = "addToCartBtn";
            btn.type = "button";
            btn.addEventListener("click", () => {
                addToCart({
                    name,
                    action: "buyFixed",
                    amount: resaleOffer.price,
                    offerId: resaleOffer.id
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
            ? Object.values(s.offers).find((o) => o.kind === "child" &&
                o.parentId === parentDeed.id &&
                !o.cancelled &&
                o.uses < o.maxUses &&
                s.time < o.validUntil &&
                (o.labels === null || o.labels.includes(info.childLabel)))
            : null;
        if (childOffer) {
            const nextGen = (entry?.generation ?? 0) + 1;
            add(card, "p", `🟢 Child offer open (${childOffer.price} ${registryUnit(childOffer.asset)})`, "badge-ok");
            const btn = add(card, "button", "Add to cart", "small");
            btn.id = "addToCartBtn";
            btn.type = "button";
            btn.addEventListener("click", () => {
                addToCart({
                    name,
                    action: "fillChildOffer",
                    amount: childOffer.price,
                    offerId: childOffer.id
                });
            });
        }
        else {
            add(card, "p", "⚪ Child not minted — no open offer", "badge");
        }
        return;
    }
    let pricing;
    try {
        pricing = rootAuctionPolicy(ui.cap, info);
    }
    catch (error) {
        add(card, "p", error.message, "badge-warn");
        return;
    }
    const { reserve } = pricing;
    const tierNote = `${compactAmount(reserve)} registry units ${info.isSingleEmoji ? "single-emoji" : info.isMultiEmoji ? "multi-emoji" : "root"} minimum bid`;
    add(card, "p", "🟢 Available in the registry snapshot", "badge-ok");
    add(card, "p", `Unclaimed ${info.tier} root domain (${tierNote}). Opening auction reserve: ${reserve} registry units (${formatDuration(pricing.window)} minimum window + ${formatDuration(pricing.quiet)} quiet period).`).setAttribute("data-info-description", "");
    const controls = add(card, "div", "", "inline-controls");
    const maxBidInput = document.createElement("input");
    maxBidInput.value = reserve;
    maxBidInput.setAttribute("inputmode", "numeric");
    maxBidInput.setAttribute("aria-label", "Maximum bid in registry units for " + name);
    const amountLabel=add(controls,"label","Maximum opening bid (registry units)","amount-label"),unitBox=add(amountLabel,"span","","amount-unit");unitBox.append(maxBidInput);add(unitBox,"span","units","input-unit");maxBidInput.placeholder="Whole-number registry units";add(amountLabel,"small","Bid cap for this name. The capability reserve stays fixed. Adding to cart sends no POA.","muted");
    const btn = add(controls, "button", "Add to cart", "small");
    btn.id = "addToCartBtn";
    btn.type = "button";
    const inputError = add(card, "p", "", "badge-warn");
    inputError.setAttribute("role", "alert");
    btn.addEventListener("click", () => {
        const chosen = maxBidInput.value.trim();
        if (!/^[1-9][0-9]{0,38}$/.test(chosen) || BigInt(chosen) < BigInt(reserve)) {
            inputError.textContent = `⚠️ Enter a whole-number bid of at least ${reserve} registry units.`;
            maxBidInput.setAttribute("aria-invalid", "true");
            return;
        }
        inputError.textContent = "";
        maxBidInput.removeAttribute("aria-invalid");
        addToCart({
            name,
            action: "announceAuction+bid",
            amount: chosen
        });
    });
    } finally {
        const status=el("searchResultStatus"),line=container.querySelector(".badge-ok,.badge-warn")??container.querySelector("p");
        const text=q&&line?`${q}: ${line.textContent}`:"";
        if(status && status.textContent!==text)status.textContent=text;
    }
}
