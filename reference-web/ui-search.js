import { copyText } from "./ui-copy.js?v=03149c4be992";
import { publicNameUnavailable } from "./shared.js?v=03149c4be992";
import { registryUnit, poaOnlyMode, poaNewNamePrice, poaAmount, poaToMicros, poaShort, poaMinimumNextBid, isPoaAuctionAwaitingFirstBid, findOpenPoaAuctionByName, poaAuctionOutbidStatus, buildSubnamePurchasePrompt } from "./shared.js?v=03149c4be992";
import { ui } from "./ui-state.js?v=03149c4be992";
import { nameLink, navigateDomain, openManageDomain, ownerLink, writeViewURL } from "./ui-router.js?v=03149c4be992";
import { add, appendPrincipal, el, endpointBase, json, person, variantOwner } from "./ui-core.js?v=03149c4be992";
import { compactAmount, formatClock, formatDuration, inspectName, minimumNextBid, nameErrorReason, rootAuctionPolicy } from "./shared.js?v=03149c4be992";
import { addToCart } from "./ui-cart.js?v=03149c4be992";
import { suggestNames } from "./ideas-generator.js?v=03149c4be992";
import { logSubmittedSearch } from "./ui-search-log.js?v=03149c4be992";

let activeSuggestionIdx = -1;
let currentSuggestions = [];
let currentCompletion = "";

function isAvailableCandidate(name) {
    if (!ui.cap || !ui.latestState)
        return false;
    const entry = ui.latestState.names?.[name];
    if (publicNameUnavailable(name, ui.cap))
        return false;
    if (ui.reservedSet.has(name))
        return false;
    if (variantOwner(name))
        return false;
    if (entry?.activeId || entry?.auctionId)
        return false;
    if (Object.values(ui.latestState.auctions ?? {}).some((a) => a.name === name && a.status === "live"))
        return false;
    if (findOpenPoaAuctionByName(ui.escrowMarket, name, ui.escrowMarketServerTime || Date.now()))
        return false;
    return true;
}

function suggestionPriceLabel(item) {
    if (!ui.cap)
        return "";
    try {
        if (poaOnlyMode(ui.cap))
            return `${poaShort(poaNewNamePrice(ui.cap, item))} POA`;
        return `${compactAmount(rootAuctionPolicy(ui.cap, item).reserve)} units`;
    }
    catch {
        return "";
    }
}

export function closeSearchSuggestions() {
    const list = el("searchSuggestions");
    const input = el("searchInput");
    const ghost = el("searchAutofill");
    activeSuggestionIdx = -1;
    currentSuggestions = [];
    currentCompletion = "";
    if (list) {
        list.hidden = true;
        list.replaceChildren();
    }
    if (ghost) {
        ghost.hidden = true;
        ghost.textContent = "";
    }
    if (input) {
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
    }
}

function highlightSuggestion(idx) {
    const list = el("searchSuggestions");
    const input = el("searchInput");
    if (!list || !currentSuggestions.length)
        return;
    activeSuggestionIdx = idx;
    const opts = [...list.querySelectorAll('[role="option"]')];
    opts.forEach((node, i) => {
        const selected = i === activeSuggestionIdx;
        node.setAttribute("aria-selected", String(selected));
        node.classList.toggle("is-active", selected);
    });
    if (input) {
        if (activeSuggestionIdx >= 0 && opts[activeSuggestionIdx])
            input.setAttribute("aria-activedescendant", opts[activeSuggestionIdx].id);
        else
            input.removeAttribute("aria-activedescendant");
    }
}

export function selectSearchSuggestion(name) {
    const input = el("searchInput");
    if (input)
        input.value = name;
    closeSearchSuggestions();
    runSearch(name, true, { autoAdd: true, fromSuggestion: true });
    logSubmittedSearch(name);
}

export function updateSearchSuggestions() {
    const input = el("searchInput");
    const list = el("searchSuggestions");
    const ghost = el("searchAutofill");
    if (!input || !list || !ui.cap || !ui.latestState)
        return;
    const q = input.value.trim();
    if (!q) {
        closeSearchSuggestions();
        return;
    }
    const { completion, items } = suggestNames(q, {
        manifest: ui.cap.emojiManifest,
        accept: isAvailableCandidate,
        limit: 8,
    });
    currentSuggestions = items;
    currentCompletion = completion;
    activeSuggestionIdx = -1;
    input.removeAttribute("aria-activedescendant");
    if (ghost) {
        if (completion && completion !== q.toLowerCase()) {
            ghost.textContent = `${completion} ⇥`;
            ghost.hidden = false;
        }
        else {
            ghost.textContent = "";
            ghost.hidden = true;
        }
    }
    list.replaceChildren();
    if (!items.length) {
        list.hidden = true;
        input.setAttribute("aria-expanded", "false");
        return;
    }
    items.forEach((item, index) => {
        const li = document.createElement("li");
        li.id = `search-opt-${index}`;
        li.className = "search-suggestion-item";
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        const nameSpan = document.createElement("span");
        nameSpan.className = "domain-name search-suggestion-name";
        nameSpan.textContent = item.name;
        const metaSpan = document.createElement("span");
        metaSpan.className = "search-suggestion-meta";
        const price = suggestionPriceLabel(item);
        metaSpan.textContent = (price ? `🟢 ${price}` : "🟢 Available") + " · + Cart";
        li.append(nameSpan, metaSpan);
        li.addEventListener("mousedown", (e) => {
            e.preventDefault();
            selectSearchSuggestion(item.name);
        });
        list.append(li);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
}

export function submitSearchQuery() {
    const input = el("searchInput");
    if (!input)
        return;
    const raw = input.value.trim();
    let chosen = raw;
    let fromSuggestion = false;
    if (activeSuggestionIdx >= 0 && currentSuggestions[activeSuggestionIdx]) {
        chosen = currentSuggestions[activeSuggestionIdx].name;
        input.value = chosen;
        fromSuggestion = true;
    }
    closeSearchSuggestions();
    runSearch(chosen, true, { autoAdd: true, fromSuggestion });
    logSubmittedSearch(chosen);
}

export function wireSearchAutocomplete() {
    const input = el("searchInput");
    if (!input || input.dataset.acWired === "1")
        return;
    input.dataset.acWired = "1";
    input.addEventListener("input", () => updateSearchSuggestions());
    input.addEventListener("focus", () => {
        if (input.value.trim())
            updateSearchSuggestions();
    });
    input.addEventListener("blur", () => {
        setTimeout(() => {
            if (document.activeElement !== input)
                closeSearchSuggestions();
        }, 120);
    });
    input.addEventListener("keydown", (event) => {
        const list = el("searchSuggestions");
        const open = Boolean(list && !list.hidden && currentSuggestions.length);
        if (event.key === "ArrowDown" && open) {
            event.preventDefault();
            highlightSuggestion((activeSuggestionIdx + 1) % currentSuggestions.length);
            return;
        }
        if (event.key === "ArrowUp" && open) {
            event.preventDefault();
            highlightSuggestion(activeSuggestionIdx <= 0 ? currentSuggestions.length - 1 : activeSuggestionIdx - 1);
            return;
        }
        if (event.key === "Escape" && open) {
            event.preventDefault();
            closeSearchSuggestions();
            return;
        }
        if (event.key === "Tab" && !event.shiftKey && currentCompletion && open) {
            event.preventDefault();
            selectSearchSuggestion(currentCompletion);
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            submitSearchQuery();
        }
    });
}

function appendSuggestedAlternatives(card, rawQuery) {
    if (!ui.cap || !ui.latestState)
        return;
    const { items } = suggestNames(rawQuery, {
        manifest: ui.cap.emojiManifest,
        accept: isAvailableCandidate,
        limit: 4,
    });
    if (!items.length)
        return;
    const row = add(card, "div", "", "search-alt-row");
    add(row, "span", "Available suggestions:", "muted");
    for (const item of items) {
        const btn = add(row, "button", `${item.name} (${suggestionPriceLabel(item) || "Available"})`, "secondary small domain-name");
        btn.type = "button";
        btn.addEventListener("click", () => selectSearchSuggestion(item.name));
    }
}

export function runSearch(rawQuery, remember = true, { autoAdd = false, fromSuggestion = false } = {}) {
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
        appendSuggestedAlternatives(card, name);
        return;
    }
    const sameEmoji = variantOwner(name);
    if (sameEmoji) {
        add(card, "p", "🔒 Taken — same emoji as another name", "badge-warn");
        const p = add(card, "p", "Owned or in auction as ");
        nameLink(p, sameEmoji);
        add(card, "p", "One owner per emoji, whatever the skin tone or style.").setAttribute("data-info-description", "");
        appendSuggestedAlternatives(card, name);
        return;
    }
    const entry = s.names[name];
    const poa = poaOnlyMode(ui.cap);
    const poaAuction = poa ? findOpenPoaAuctionByName(ui.escrowMarket, name, ui.escrowMarketServerTime || Date.now()) : null;
    if (poaAuction) {
        const awaiting = isPoaAuctionAwaitingFirstBid(poaAuction);
        const minNext = poaMinimumNextBid(poaAuction);
        const cartItem = ui.cart.find((x) => x.action === "poaBid" && x.params?.auctionId === poaAuction.id) ?? null;
        const outbidInfo = poaAuctionOutbidStatus(poaAuction, { bidderAddress: ui.bidderAddress, cartItem });
        add(card, "p", awaiting ? "⏳ POA Auction queued — starts on first bid" : "🔥 Live POA Auction", awaiting ? "badge" : "badge-ok");
        if (outbidInfo.status === "leading")
            add(card, "p", outbidInfo.message, "auction-leading-badge");
        else if (outbidInfo.status === "outbid" || outbidInfo.status === "outbid-covered")
            add(card, "p", outbidInfo.message, "auction-outbid-badge");
        const auctionInfo = add(card, "p", `Reserve ${poaShort(poaAuction.price)} POA · `);
        if (poaAuction.high) {
            auctionInfo.append(`Current high bid ${poaShort(poaAuction.high.amount)} POA by `);
            appendPrincipal(auctionInfo, poaAuction.high.payer);
        } else {
            auctionInfo.append("No bids yet — first bid starts the countdown timer.");
        }
        add(card, "p", `Minimum ${awaiting ? "opening" : "next"} bid: ${poaShort(minNext)} POA`, "badge-ok");
        const controls = add(card, "div", "", "inline-controls");
        const bidInput = document.createElement("input");
        bidInput.value = cartItem ? poaShort(cartItem.amount) : poaShort(minNext);
        bidInput.setAttribute("inputmode", "decimal");
        bidInput.setAttribute("aria-label", "Highest bid in POA for " + name);
        const amountLabel = add(controls, "label", "Your highest bid (POA)", "amount-label");
        const unitBox = add(amountLabel, "span", "", "amount-unit");
        unitBox.append(bidInput);
        add(unitBox, "span", "POA", "input-unit");
        bidInput.placeholder = poaShort(minNext);
        add(amountLabel, "small", awaiting ? "Starts the auction timer when your agent places the first bid. Nothing is paid here." : "Ceiling for your agent (never exceeded). Nothing is paid here.", "muted");
        const btn = add(controls, "button", cartItem ? "Update cart bid" : "Add to cart", "small");
        btn.id = "addToCartBtn";
        btn.type = "button";
        const inputError = add(card, "p", "", "badge-warn");
        inputError.setAttribute("role", "alert");
        btn.addEventListener("click", () => {
            try {
                const exact = poaAmount(bidInput.value);
                if (poaToMicros(exact) < poaToMicros(minNext))
                    throw Error(`⚠️ Enter at least ${poaShort(minNext)} POA.`);
                inputError.textContent = "";
                bidInput.removeAttribute("aria-invalid");
                addToCart({
                    name,
                    action: "poaBid",
                    amount: exact,
                    auctionId: poaAuction.id,
                });
                btn.textContent = "✅ Added to cart";
            } catch (e) {
                inputError.textContent = e?.message || `⚠️ Enter at least ${poaShort(minNext)} POA.`;
                bidInput.setAttribute("aria-invalid", "true");
            }
        });
        return;
    }
    const liveAuction = entry?.auctionId && s.auctions[entry.auctionId]?.status === "live"
        ? s.auctions[entry.auctionId]
        : Object.values(s.auctions).find((a) => a.name === name && a.status === "live");
    if (liveAuction && poa) {
        add(card, "p", "⏳ Not available right now", "badge");
        return;
    }
    if (liveAuction) {
        const minBid = liveAuction.high
            ? minimumNextBid(liveAuction.high.amount, ui.cap.increment)
            : liveAuction.reserve;
        add(card, "p", "🏷️ In auction now", "badge");
        const auctionInfo = add(card, "p", `Auction ID: ${liveAuction.id.slice(0, 18)}… · Version ${liveAuction.version} · Reserve: ${liveAuction.reserve} ${registryUnit(liveAuction.asset)} · `);
        if (liveAuction.high) {
            auctionInfo.append(`Current high bid: ${liveAuction.high.amount} by `);
            appendPrincipal(auctionInfo, liveAuction.high.payer);
        }
        else {
            auctionInfo.append("No bids yet");
        }
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
        const ownerInfo = add(card, "p", "Owner: ");
        ownerLink(ownerInfo, d.owner, person(d.owner));
        ownerInfo.append(` · Generation ${d.generation} · Owner version ${d.ownerVersion} · Deed version ${d.version}`);
        const manageBtn = add(card, "button", "⚙️ Manage this domain", "secondary small");
        manageBtn.type = "button";
        manageBtn.setAttribute("aria-label", `Manage ${name}`);
        manageBtn.addEventListener("click", () => openManageDomain(name, d.owner));
        const resaleOffer = Object.values(s.offers).find((o) => o.kind === "resale" &&
            o.parentId === d.id &&
            !o.cancelled &&
            o.uses < o.maxUses &&
            s.time < o.validUntil);
        if (resaleOffer && !poa) {
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
        appendSuggestedAlternatives(card, name);
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
        if (poa) {
            poaSubnameCard(card, name, info.parent, parentDeed);
            return;
        }
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
    if (poa) {
        let price;
        try { price = poaNewNamePrice(ui.cap, info); }
        catch (error) { add(card, "p", error.message, "badge-warn"); return; }
        add(card, "p", "🟢 Available", "badge-ok");
        add(card, "p", `🪙 ${poaShort(price)} POA`, "badge-ok");
        add(card, "p", `Permanent name for ${poaShort(price)} POA. Add to cart to copy your agent checkout plan — once your agent’s POA transfer reaches finality and runs issue, ownership mints to your address right away.`, "muted poa-search-expect");
        add(card, "p", `Yours forever for ${poaShort(price)} POA. After your agent sends POA and it reaches PoA finality (K=5 attestations or checkpoint), escrow credits your balance and your agent mints the name permanently in one step. Unused POA stays refundable only to your original address. Nothing is paid here.`).setAttribute("data-info-description", "");
        if (autoAdd)
            addToCart({ name, action: "poaCheckout" });
        const inCart = ui.cart.some((x) => x.name === name && x.action === "poaCheckout");
        const btn = add(card, "button", inCart ? "✅ Added to cart" : "Add to cart", "small");
        btn.id = "addToCartBtn";
        btn.type = "button";
        btn.setAttribute("aria-label", `Add ${name} to cart for ${poaShort(price)} POA`);
        btn.addEventListener("click", () => {
            addToCart({ name, action: "poaCheckout" });
            btn.textContent = "✅ Added to cart";
        });
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
    if (autoAdd && fromSuggestion) {
        addToCart({
            name,
            action: "announceAuction+bid",
            amount: reserve
        });
    }
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

/** POA subname: shows the parent holder's open escrow price, if any, and copies an agent request. */
function poaSubnameCard(card, name, parent, parentDeed) {
    const status = add(card, "p", "⏳ Checking subname price…", "badge");
    if (!parentDeed) { status.textContent = "⚪ Subnames aren't for sale right now"; return; }
    const base = endpointBase();
    json(`${base}/v1/escrow/subnames?parent=${encodeURIComponent(parent)}`).then((r) => {
        const l = (Array.isArray(r?.items) ? r.items : []).find((x) => x && x.status === "OPEN" && x.parent === parent &&
            x.seller === parentDeed.owner && typeof x.price === "string" && /^[0-9]+\.[0-9]{6}$/.test(x.price) && /^[0-9a-f]{64}$/.test(x.id));
        if (!l) { status.textContent = "⚪ Subnames aren't for sale right now"; return; }
        status.textContent = "🟢 Available"; status.className = "badge-ok";
        add(card, "p", `🪙 ${poaShort(l.price)} POA`, "badge-ok");
        add(card, "p", `Price set by the holder of ${parent}. Your agent pays with POA checkout after you approve, and the holder is paid from escrow. Nothing is paid here.`).setAttribute("data-info-description", "");
        const btn = add(card, "button", "🤖 Copy agent request", "small");
        btn.id = "copySubnameRequestBtn"; btn.type = "button";
        btn.setAttribute("aria-label", `Copy agent request to buy ${name} for ${poaShort(l.price)} POA`);
        const box = add(card, "pre", "", "prompt-box"); box.hidden = true;
        const note = add(card, "p", "", "muted"); note.setAttribute("role", "status");
        btn.addEventListener("click", async () => {
            const text = buildSubnamePurchasePrompt({ name, listing: l.id, price: l.price, endpointUrl: base });
            box.textContent = text; box.hidden = false;
            const res = await copyText(text, box);
            note.textContent = res.ok ? "✅ Copied" : "📋 Press Ctrl/Cmd+C to copy from the box.";
        });
    }).catch(() => { status.textContent = "⚪ Subnames aren't for sale right now"; });
}
