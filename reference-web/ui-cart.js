import { ui } from "./ui-state.js?v=6f6694bf7a62";
import { acknowledgeCartItem, buildAgentCartPrompt, buildCartItem, cartReview, editCartAmount, inspectName, minimumNextBid, rootAuctionPolicy, saveCart, shouldHoldTransactions } from "./shared.js?v=6f6694bf7a62";
import { add, el, endpointBase } from "./ui-core.js?v=6f6694bf7a62";
import { nameLink } from "./ui-router.js?v=6f6694bf7a62";

export function cartCopyBlocked() {
    return ui.refreshing || ui.lastLoadedAt === null || ui.registryReadFailed || ui.cart.some(item => item.validationError || item.needsReview) || shouldHoldTransactions(ui.networkStatus.level) || !!ui.networkStatus.hold;
}

export function updateCartCopyState() {
    for (const id of ["copyCartPrompt", "copyCheckoutBtn"])
        el(id).disabled = !ui.cart.length || cartCopyBlocked();
}

export function persistCart() {
    saveCart(globalThis.localStorage, ui.cart);
}

export function addToCart(item) {
    item = buildCartItem(item, ui.cap, ui.latestState);
    const existingIdx = ui.cart.findIndex((x) => x.name === item.name && x.action === item.action);
    if (existingIdx >= 0)
        ui.cart[existingIdx] = item;
    else
        ui.cart.push(item);
    persistCart();
    renderCart();
}

export function removeCartAt(index) {
    ui.cart.splice(index, 1);
    persistCart();
    renderCart();
}

export function clearAllCart() {
    ui.cart = [];
    persistCart();
    renderCart();
}

export function updatePromptText() {
    if (!ui.cart.length || !ui.cap) {
        if (!ui.cart.length) {
            el("cartPrompt").textContent =
                "Add one or more domains from availability search, live auctions, or standing offers to generate your agent prompt.";
        }
        return;
    }
    if (cartCopyBlocked()) {
        el("cartPrompt").textContent = ui.refreshing ? "⏳ Checking registry data before copying…" : ui.registryReadFailed ? "⚠️ Refresh registry data before copying." : "⚠️ Review changed cart items and fix any amount before copying.";
        return;
    }
    el("cartPrompt").textContent = buildAgentCartPrompt(ui.cart, ui.cap, "", endpointBase(), ui.configMode);
}

export function renderFloatingCart() {
    const badge = el("floatingCartBadge");
    const list = el("floatingCartList");
    const clearBtn = el("floatingCartClear");
    const copyBtn = el("copyCheckoutBtn");
    badge.textContent = String(ui.cart.length);
    badge.hidden = ui.cart.length === 0;
    el("floatingCartBtn").setAttribute("aria-label", ui.cart.length ? `Open cart, ${ui.cart.length} items` : "Open cart");
    clearBtn.disabled = ui.cart.length === 0;
    const held = shouldHoldTransactions(ui.networkStatus.level) || !!ui.networkStatus.hold;
    copyBtn.disabled = ui.cart.length === 0 || cartCopyBlocked();
    if (held)
        copyBtn.classList.add("action-held");
    else
        copyBtn.classList.remove("action-held");
    list.replaceChildren();
    if (!ui.cart.length) {
        add(list, "p", "Cart empty", "muted");
        return;
    }
    ui.cart.forEach((item, index) => {
        const card = add(list, "div", "", "card");
        const h = add(card, "h4", "");
        nameLink(h, item.name);
        add(card, "p", `${item.action} · ${item.amount} ${item.asset}`, "badge");
        add(card, "p", item.summary);
        if (item.needsReview)
            add(card, "p", "⚠️ " + item.reviewMessage + " Open Find to review your cart.", "badge-warn");
        const btn = add(card, "button", "Remove", "secondary small");
        btn.type = "button";
        btn.addEventListener("click", () => removeCartAt(index));
    });
}

export function renderCart() {
    syncIdeaMarks();
    el("cartCount").textContent = String(ui.cart.length);
    el("clearCart").disabled = ui.cart.length === 0;
    {
        const held = shouldHoldTransactions(ui.networkStatus.level) || !!ui.networkStatus.hold;
        el("copyCartPrompt").disabled = ui.cart.length === 0 || cartCopyBlocked();
        if (held)
            el("copyCartPrompt").classList.add("action-held");
        else
            el("copyCartPrompt").classList.remove("action-held");
    }
    el("cartStatus").textContent = "";
    const listNode = el("cartList");
    listNode.replaceChildren();
    if (!ui.cart.length) {
        updatePromptText();
        renderFloatingCart();
        return;
    }
    ui.cart.forEach((item, index) => {
        const card = add(listNode, "div", "", "card");
        const h = add(card, "h4", "");
        nameLink(h, item.name);
        add(card, "p", `${item.action} · ${item.tier} ${item.isRoot ? "root" : "child"}`, "badge");
        const summaryNode = add(card, "p", item.summary);
        if (item.needsReview)
            add(card, "p", "⚠️ " + item.reviewMessage, "badge-warn");
        const reviewBtn = item.needsReview ? add(card, "button", "✅ Review changed item", "secondary small") : null;
        if (reviewBtn) {
            reviewBtn.type = "button";
            reviewBtn.disabled = ui.registryReadFailed || !cartReview(item, ui.cap, ui.latestState).canAcknowledge;
            reviewBtn.addEventListener("click", () => {
                if (ui.registryReadFailed)
                    return;
                try {
                    ui.cart[index] = acknowledgeCartItem(item, ui.cap, ui.latestState);
                    persistCart();
                    renderCart();
                }
                catch {
                    el("cartStatus").textContent = "⚠️ Fix the amount or remove this item, then check Find again.";
                }
            });
        }
        const errorNode = add(card, "p", item.validationError || "", "badge-warn");
        errorNode.setAttribute("role", "alert");
        const controls = add(card, "div", "", "inline-controls");
        const amountInput = document.createElement("input");
        amountInput.value = item.amount;
        amountInput.dataset.fieldKey = item.action + ":" + item.name;
        amountInput.setAttribute("inputmode", "numeric");
        amountInput.setAttribute("aria-label", "Amount or max bid for " + item.name);
        amountInput.readOnly = !["bid", "announceAuction+bid"].includes(item.action);
        amountInput.addEventListener("input", () => {
            try {
                Object.assign(item, editCartAmount(item, amountInput.value, ui.cap, ui.latestState));
                delete item.validationError;
                summaryNode.textContent = item.summary;
                persistCart();
            }
            catch (error) {
                item.validationError = error.message;
            }
            errorNode.textContent = item.validationError || "";
            amountInput.setAttribute("aria-invalid", item.validationError ? "true" : "false");
            persistCart();
            updateCartCopyState();
            if (reviewBtn)
                reviewBtn.disabled = ui.registryReadFailed || !cartReview(item, ui.cap, ui.latestState).canAcknowledge;
            updatePromptText();
            renderFloatingCart();
        });
        const removeBtn = add(controls, "button", "Remove", "secondary small");
        removeBtn.type = "button";
        removeBtn.addEventListener("click", () => removeCartAt(index));
        controls.prepend(amountInput);
    });
    updatePromptText();
    renderFloatingCart();
}

export function setFloatingCartOpen(open) {
    const panel = el("floatingCartPanel");
    const backdrop = el("floatingCartBackdrop");
    const btn = el("floatingCartBtn");
    panel.hidden = !open;
    backdrop.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
        renderFloatingCart();
        el("floatingCartClose").focus();
    }
    else {
        btn.focus();
    }
}

export function syncIdeaMarks() {
    const inCart = new Set(ui.cart.map((x) => x.name));
    for (const b of document.querySelectorAll("#ideasStrip .idea"))
        b.classList.toggle("is-added", inCart.has(b.dataset.query));
}

export function addDetailToCart(item) {
    const s = ui.latestState;
    if (!s || !ui.cap)
        return;
    const name = item.name;
    if (!name)
        return;
    let info;
    try {
        info = inspectName(name, ui.cap.emojiManifest);
    }
    catch {
        return;
    }
    const liveAuction = (item.auctionId && s.auctions[item.auctionId]?.status === "live"
        ? s.auctions[item.auctionId]
        : null) ||
        Object.values(s.auctions).find((a) => a.name === name && a.status === "live");
    if (liveAuction) {
        const minBid = liveAuction.high
            ? minimumNextBid(liveAuction.high.amount, ui.cap.increment)
            : liveAuction.reserve;
        addToCart({
            name,
            action: "bid",
            amount: minBid,
            auctionId: liveAuction.id
        });
        return;
    }
    if (info.isRoot && !s.names[name]?.activeId && !ui.reservedSet.has(name)) {
        let reserve;
        try {
            ({ reserve } = rootAuctionPolicy(ui.cap, info));
        }
        catch (error) {
            el("ideasStatus").textContent = error.message;
            return;
        }
        addToCart({
            name,
            action: "announceAuction+bid",
            amount: reserve
        });
    }
}
