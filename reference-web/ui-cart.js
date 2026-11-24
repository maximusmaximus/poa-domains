import { publicNameUnavailable } from "./shared.js?v=03149c4be992";
import { registryUnit } from "./shared.js?v=03149c4be992";
import { actionLabel } from "./ui-copy.js?v=03149c4be992";
import { trapDialog } from "./ui-a11y.js?v=03149c4be992";
import { ui } from "./ui-state.js?v=03149c4be992";
import { acknowledgeCartItem, buildAgentCartHandoff, renderAgentCartHandoff, buildPoaCheckoutHandoff, renderPoaCheckoutHandoff, poaOnlyMode, poaShort, poaMinimumNextBid, findOpenPoaAuctionByName, updatedAge, buildCartItem, cartReview, editCartAmount, inspectName, minimumNextBid, rootAuctionPolicy, saveCart, shouldHoldTransactions, validPrincipal } from "./shared.js?v=03149c4be992";
import { add, el, endpointBase } from "./ui-core.js?v=03149c4be992";
import { nameLink, openManageDomain } from "./ui-router.js?v=03149c4be992";

export function cartCopyBlocked() {
    return ui.refreshing || ui.lastLoadedAt === null || ui.registryReadFailed || ui.cart.some(item => item.validationError || item.needsReview) || (ui.networkStatus.lastKnown !== true && shouldHoldTransactions(ui.networkStatus.lastKnown === true ? "checking" : ui.networkStatus.level)) || !!ui.networkStatus.hold;
}

export function updateCartCopyState() {
    for (const id of ["copyCartPrompt", "copyCheckoutBtn", "downloadCartJSON"])
        el(id).disabled = !ui.cart.length || cartCopyBlocked() || ui.handoffPending || !ui.handoffData;
}

export function persistCart() {
    saveCart(globalThis.localStorage, ui.cart);
}

function resetCopyFeedback() {
    const cs = el("cartStatus"), fs = el("floatingCartStatus"), fp = el("floatingCartPrompt");
    if (cs) delete cs.dataset.copiedFor;
    if (fs) fs.textContent = "";
    if (fp) { fp.hidden = true; fp.textContent = ""; }
}

export function addToCart(item) {
    item = buildCartItem(item, ui.cap, ui.latestState, ui.escrowMarket, ui.bidderAddress, ui.escrowMarketServerTime || Date.now());
    const existingIdx = ui.cart.findIndex((x) => x.name === item.name && x.action === item.action);
    if (existingIdx >= 0)
        ui.cart[existingIdx] = item;
    else
        ui.cart.push(item);
    resetCopyFeedback();
    persistCart();
    renderCart();
}

export function removeCartAt(index) {
    ui.cart.splice(index, 1);
    resetCopyFeedback();
    persistCart();
    renderCart();
}

export function clearAllCart() {
    ui.cart = [];
    resetCopyFeedback();
    persistCart();
    renderCart();
}

let handoffGeneration=0;
export function updateHandoffAge(){
    const label=poaOnlyMode(ui.cap)?"🧾 POA checkout · ":"🧾 Agent Cart Handoff v2 · ";
    const text=ui.handoffData?label+updatedAge(ui.handoffData.generatedAt).replace("updated","generated"):label+(ui.handoffPending?"building…":ui.handoffError?"not ready: "+ui.handoffError:"not ready");
    for(const id of ["cartHandoffMeta","floatingHandoffMeta"])if(el(id))el(id).textContent=text;
}
export function renderCurrentCartHandoff() {
    if (!ui.handoffData || !ui.cap)
        return "";
    return poaOnlyMode(ui.cap)
        ? renderPoaCheckoutHandoff(ui.handoffData)
        : renderAgentCartHandoff(ui.handoffData);
}

export async function updatePromptText() {
    const generation=++handoffGeneration;
    el("cartAnchor").classList.toggle("cart-empty",!ui.cart.length);
    ui.handoffData=null;ui.handoffPending=false;ui.handoffError="";
    if(!ui.cart.length||!ui.cap){
        if(!ui.cart.length)el("cartPrompt").textContent="🛒 Your cart is empty. Add a name from Find, Auctions or For sale.";
        updateHandoffAge();updateCartCopyState();return;
    }
    if(cartCopyBlocked()){
        el("cartPrompt").textContent=ui.refreshing?"⏳ Checking the registry…":ui.registryReadFailed||ui.lastLoadedAt===null?"🔄 Refresh registry data first.":shouldHoldTransactions(ui.networkStatus.lastKnown === true ? "checking" : ui.networkStatus.level)||ui.networkStatus.hold?"⏸️ Handoff paused while the PoA network is down. Nothing was sent.":"✏️ Fix the cart items marked for review.";
        updateHandoffAge();updateCartCopyState();return;
    }
    ui.handoffPending=true;updateHandoffAge();updateCartCopyState();
    el("cartPrompt").textContent="🧾 Building your handoff…";
    try{
        const poa=poaOnlyMode(ui.cap);
        const data=poa?buildPoaCheckoutHandoff(structuredClone(ui.cart),ui.cap,endpointBase(),structuredClone(ui.rawSnapshot))
            :await buildAgentCartHandoff(structuredClone(ui.cart),ui.cap,"",endpointBase(),ui.configMode,structuredClone(ui.rawSnapshot));
        if(generation!==handoffGeneration||cartCopyBlocked())return;
        ui.handoffData=data;el("cartPrompt").textContent=renderCurrentCartHandoff();
    }catch(error){
        if(generation===handoffGeneration){ui.handoffError=String(error?.message||error).slice(0,200);el("cartPrompt").textContent="😕 Couldn't build your handoff. Tap 🔄 Refresh and try again. Nothing was sent.";}
    }finally{
        if(generation===handoffGeneration){ui.handoffPending=false;updateHandoffAge();updateCartCopyState();}
    }
}
export function downloadCartJSON(){
    if(!ui.handoffData||ui.handoffPending||cartCopyBlocked())return;
    const blob=new Blob([JSON.stringify(ui.handoffData,null,2)+"\n"],{type:"application/json"}),url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download=poaOnlyMode(ui.cap)?"poa-domains-poa-checkout.json":"poa-domains-cart-v2.json";document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    el("cartStatus").textContent="📥 JSON downloaded — unsigned, nothing submitted.";
}

// Find already contains the inline cart. Hide the shortcut while that area is
// visible so it cannot cover the counter, suggestion, search or cart controls.
let cartAreaVisible = false, cartAreaObserver;
function syncCartShortcut() {
    const btn = el("floatingCartBtn"), anchor = el("cartAnchor");
    const hide = cartAreaVisible && !anchor.closest("[hidden]") && el("floatingCartPanel").hidden;
    if (hide && document.activeElement === btn) {
        anchor.tabIndex = -1;
        anchor.focus({ preventScroll: true });
    }
    btn.hidden = hide;
}
// Tab and route changes update the shortcut synchronously instead of waiting for the observer callback.
export function syncCartShortcutNow() {
    const area = el("searchSection");
    if (!area || !el("floatingCartBtn"))
        return;
    const r = area.getBoundingClientRect();
    cartAreaVisible = !area.closest("[hidden]") && area.getClientRects().length > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    syncCartShortcut();
}
function observeCartArea() {
    if (!cartAreaObserver && globalThis.IntersectionObserver) {
        cartAreaObserver = new IntersectionObserver(([entry]) => {
            cartAreaVisible = entry.isIntersecting;
            syncCartShortcut();
        });
        cartAreaObserver.observe(el("searchSection"));
    }
    syncCartShortcut();
}

function formatEscrowHoldReason(caps) {
    const map = {
        ASSET_LIABILITY_MISMATCH: "reconciliation hold awaiting operator review",
        ESCROW_NODE_TIMEOUT: "public PoA network read timed out",
        ESCROW_NODE_AUTH: "PoA ledger is temporarily locked",
        ESCROW_STALE: "PoA network status is stale",
    };
    const parts = [];
    const primary = typeof caps.holdReason === "string" && caps.holdReason.trim() ? caps.holdReason.trim() : "";
    if (primary)
        parts.push(map[primary] ?? primary);
    else if (caps.paused)
        parts.push("POA payments paused");
    const fCode = typeof caps.freshness?.code === "string" ? caps.freshness.code : "";
    const fText = fCode ? (map[fCode] ?? caps.freshness?.reason ?? fCode) : (caps.freshness?.held && typeof caps.freshness?.reason === "string" ? caps.freshness.reason : "");
    if (fText && !parts.some((p) => p.toLowerCase().includes(fText.toLowerCase())))
        parts.push(fText);
    return parts.join("; ") || "temporarily paused";
}

export function renderCartEscrowStatus() {
    const show = Boolean(ui.cap && poaOnlyMode(ui.cap) && ui.escrowCaps?.enabled);
    const caps = ui.escrowCaps;
    const isHeld = Boolean(caps && (caps.held || caps.paused || caps.freshness?.held));
    const text = show
        ? (isHeld
            ? `⏸️ POA checkout is currently on hold (${formatEscrowHoldReason(caps)}). You can plan your cart now, but wait before sending POA — your agent will stop at step 0 and send nothing until checkout reopens.`
            : "🟢 POA checkout open — ready when you approve your agent.")
        : "";
    for (const id of ["cartEscrowStatus", "floatingCartEscrowStatus"]) {
        const node = el(id);
        if (!node)
            continue;
        node.hidden = !show;
        node.textContent = text;
        node.className = "cart-escrow-status " + (isHeld ? "badge-warn" : "badge-ok");
    }
}

function poaCartTotalShort(items) {
    let total = 0n;
    for (const item of items) {
        const m = /^([0-9]{1,12})\.([0-9]{6})$/.exec(item?.amount ?? "");
        if (!m)
            return null;
        total += BigInt(m[1]) * 1000000n + BigInt(m[2]);
    }
    const whole = total / 1000000n;
    const frac = (total % 1000000n).toString().padStart(6, "0");
    return poaShort(`${whole}.${frac}`);
}

export function renderCartExpectations() {
    const show = Boolean(ui.cap && poaOnlyMode(ui.cap) && ui.cart.length > 0);
    const inlineBox = el("cartExpectations");
    const floatingBox = el("floatingCartExpectations");
    if (inlineBox)
        inlineBox.hidden = !show;
    if (floatingBox)
        floatingBox.hidden = !show;
    const lead = el("cartExpectLead");
    const list = el("cartExpectList");
    if (show) {
        const total = poaCartTotalShort(ui.cart);
        const bidCount = ui.cart.filter((x) => x.action === "poaBid").length;
        const newCount = ui.cart.length - bidCount;
        const count = `${ui.cart.length} ${ui.cart.length === 1 ? "item" : "items"}`;
        if (lead) {
            lead.textContent = bidCount > 0
                ? (total
                    ? `For ${count} (ceiling ${total} POA across ${bidCount} ${bidCount === 1 ? "auction bid" : "auction bids"}${newCount ? ` + ${newCount} new` : ""}) — nothing is paid or bid until you approve your agent.`
                    : `For ${count} — nothing is paid or bid until you approve your agent.`)
                : (total
                    ? `For ${ui.cart.length} ${ui.cart.length === 1 ? "name" : "names"} (${total} POA total) — nothing is paid or minted until you approve your agent.`
                    : `For ${ui.cart.length} ${ui.cart.length === 1 ? "name" : "names"} — nothing is paid or minted until you approve your agent.`);
        }
        if (list) {
            const mode = bidCount > 0 ? (newCount > 0 ? "mixed" : "auction") : "new";
            if (list.dataset.expectMode !== mode) {
                list.dataset.expectMode = mode;
                list.replaceChildren();
                const steps = bidCount > 0
                    ? [
                        ["Finality first: ", "Your agent checks existing available escrow POA, creates an intent only for any shortfall, sends exact POA with the unique memo, and waits for PoA finality (K=5 attestations or checkpoint — seen is not credited yet)."],
                        ["First bid starts the timer: ", "Queued inventory auctions have no ticking timer until the first bid lands. Your agent bids the minimum valid amount (>10% above any live high bid) up to your highest bid cap — never above it."],
                        ["Outbid refunds & quiet extensions: ", "Late bids extend the close time by the quiet window. If another user outbids you, escrow automatically queues an on-chain refund of your outbid POA back to your original wallet (not back to available credit)."],
                        ["Seller handover after close: ", newCount > 0
                            ? "New names mint immediately via issue. Winning an auction waits for the seller's signed settle handover (seller/fee paid before title commits); if unsettled past close + quiet, escrow auto-expires and refunds the winner."
                            : "Winning a POA auction waits for the seller's signed settle handover after close (seller + fee are paid on-chain before title commits). If unsettled past close + quiet, escrow auto-expires and refunds the winner to the original payer."],
                    ]
                    : [
                        ["Finality first: ", "Your agent creates an escrow intent and sends the exact POA total with the unique memo. PoA network finality (K=5 attestations or checkpoint) is required — seen is not credited yet."],
                        ["Instant permanent mint: ", "Once final, escrow credits your balance and your agent submits issue for each name. Each domain is minted permanently to your address immediately in that step — no auction or wait for treasury payout."],
                        ["Verify ownership right away: ", "Open each name’s /d/<name> page or the Manage domains tab with your public poa1… address to see Owned (permanent)."],
                        ["Safety & unused POA: ", "If a name is taken first or checkout is held, nothing is minted for it. Any unused POA credit stays in your escrow balance and can be withdrawn back only to your original sending address."],
                    ];
                for (const [strongText, bodyText] of steps) {
                    const li = document.createElement("li");
                    const st = document.createElement("strong");
                    st.textContent = strongText;
                    li.append(st, document.createTextNode(bodyText));
                    list.append(li);
                }
            }
        }
    }
}

function poaPurchaseTypeLabel(item) {
    if (item.tier === "premium")
        return "Premium single emoji";
    return item.isRoot === false ? "Subdomain" : "Standard root";
}

export function inferOwnerFromPurchasedCart(state) {
    if (!state || !ui.cap || !ui.cart.length)
        return null;
    if (ui.cart.some((x) => x.action === "poaBid"))
        return null;
    const owners = [];
    for (const item of ui.cart) {
        const review = cartReview(item, ui.cap, state, ui.escrowMarket, ui.bidderAddress, ui.escrowMarketServerTime || Date.now());
        if (review.canAcknowledge || !review.issues.length)
            return null;
        const entry = state.names?.[item.name];
        const deed = entry?.activeId ? state.deeds?.[entry.activeId] : null;
        if (!deed || deed.retired)
            return null;
        if (validPrincipal(deed.owner))
            owners.push(deed.owner);
    }
    if (!owners.length)
        return null;
    const counts = new Map();
    for (const o of owners)
        counts.set(o, (counts.get(o) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function maybePrefillOwnerFromPurchasedCart(state) {
    const inferred = inferOwnerFromPurchasedCart(state);
    const notice = el("cartOwnedNotice");
    if (!inferred) {
        if (notice) {
            notice.hidden = true;
            notice.replaceChildren();
        }
        return null;
    }
    const ownerInput = el("manageOwner");
    const manageNotice = el("manageOwnerNotice");
    if (ownerInput && (!ownerInput.value.trim() || ownerInput.value.trim() === ui.inferredCartOwner)) {
        ownerInput.value = inferred;
        ui.inferredCartOwner = inferred;
        if (manageNotice) {
            manageNotice.textContent = "🎉 Prefilled from your recently registered cart names (view-only until your agent signs an update).";
            manageNotice.hidden = false;
        }
    }
    if (notice) {
        notice.hidden = false;
        notice.replaceChildren();
        add(notice, "span", "🎉 All names in your cart are now registered! We prefilled their owner address in Manage domains. ");
        const btn = add(notice, "button", "⚙️ Manage these domains", "secondary small");
        btn.type = "button";
        btn.addEventListener("click", () => openManageDomain(ui.cart[0]?.name ?? "", inferred));
    }
    return inferred;
}

export function renderFloatingCart() {
    observeCartArea();
    renderCartEscrowStatus();
    renderCartExpectations();
    const badge = el("floatingCartBadge");
    const list = el("floatingCartList");
    const clearBtn = el("floatingCartClear");
    const copyBtn = el("copyCheckoutBtn");
    badge.textContent = String(ui.cart.length);
    badge.hidden = ui.cart.length === 0;
    el("floatingCartBtn").setAttribute("aria-label", ui.cart.length ? `Open cart, ${ui.cart.length} items` : "Open cart");
    clearBtn.disabled = ui.cart.length === 0;
    const held = shouldHoldTransactions(ui.networkStatus.lastKnown === true ? "checking" : ui.networkStatus.level) || !!ui.networkStatus.hold;
    copyBtn.disabled = ui.cart.length === 0 || cartCopyBlocked() || ui.handoffPending || !ui.handoffData;
    if (held)
        copyBtn.classList.add("action-held");
    else
        copyBtn.classList.remove("action-held");
    const restoreListFocus = !el("floatingCartPanel").hidden && list.contains(document.activeElement);
    list.replaceChildren();
    if(restoreListFocus)el("floatingCartClose").focus();
    if (!ui.cart.length) {
        add(list, "p", "Cart empty", "muted");
        return;
    }
    ui.cart.forEach((item, index) => {
        const card = add(list, "div", "", "card cart-item");
        const h = add(card, "h3", "");
        nameLink(h, item.name);
        if (item.action === "poaCheckout") {
            add(card, "p", `🪙 ${poaShort(item.amount)} POA · ${poaPurchaseTypeLabel(item)}`, "badge-ok");
        }
        else if (item.action === "poaBid") {
            const p = item.params ?? {};
            add(card, "p", `${p.awaitingFirstBid ? "⏳ Starts auction" : "🔥 POA auction"} · Max ${poaShort(item.amount)} POA`, "badge-ok");
            if (item.outbid)
                add(card, "p", "⚠️ Outbid — open Cart to review or raise your highest bid.", "auction-outbid-badge");
        }
        else {
            add(card, "p", `${actionLabel(item.action)} · ${item.amount} ${registryUnit(item.asset)}`, "badge");
            add(card, "p", item.summary);
        }
        if (item.needsReview && !(item.action === "poaBid" && item.outbid))
            add(card, "p", "⚠️ " + item.reviewMessage + " Open Find to review your cart.", "badge-warn");
        const btn = add(card, "button", "✖️", "secondary small cart-remove");
        btn.setAttribute("aria-label", "Remove " + item.name + " from cart");
        btn.type = "button";
        btn.addEventListener("click", () => removeCartAt(index));
    });
}

export function renderCart() {
    if(!ui.cap)return;
    syncIdeaMarks();
    renderCartEscrowStatus();
    renderCartExpectations();
    maybePrefillOwnerFromPurchasedCart(ui.latestState);
    el("cartCount").textContent = String(ui.cart.length);
    el("clearCart").disabled = ui.cart.length === 0;
    {
        const held = shouldHoldTransactions(ui.networkStatus.lastKnown === true ? "checking" : ui.networkStatus.level) || !!ui.networkStatus.hold;
        el("copyCartPrompt").disabled = ui.cart.length === 0 || cartCopyBlocked() || ui.handoffPending || !ui.handoffData;
        if (held)
            el("copyCartPrompt").classList.add("action-held");
        else
            el("copyCartPrompt").classList.remove("action-held");
    }
    if (el("cartStatus").dataset.copiedFor !== String(ui.cart.length) || !ui.cart.length) {
        delete el("cartStatus").dataset.copiedFor;
        el("cartStatus").textContent = `🛒 Cart: ${ui.cart.length} ${ui.cart.length === 1 ? "item" : "items"}.`;
    }
    const listNode = el("cartList");
    listNode.replaceChildren();
    if (!ui.cart.length) {
        updatePromptText();
        renderFloatingCart();
        return;
    }
    ui.cart.forEach((item, index) => {
        const card = add(listNode, "div", "", "card cart-item");
        const h = add(card, "h4", "");
        nameLink(h, item.name);
        if (item.action === "poaCheckout") {
            add(card, "p", `🪙 ${poaShort(item.amount)} POA · ${poaPurchaseTypeLabel(item)}`, "badge-ok");
            if (item.needsReview)
                add(card, "p", "⚠️ " + item.reviewMessage, "badge-warn");
            const errorNode = add(card, "p", item.validationError || "", "badge-warn");
            errorNode.setAttribute("role", "alert");
            const removePoa = add(card, "button", "✖️", "secondary small cart-remove");
            removePoa.setAttribute("aria-label", "Remove " + item.name + " from cart");
            removePoa.type = "button";
            removePoa.addEventListener("click", () => removeCartAt(index));
            return;
        }
        if (item.action === "poaBid") {
            const p = item.params ?? {};
            const nowMs = ui.escrowMarketServerTime || Date.now();
            const review = cartReview(item, ui.cap, ui.latestState, ui.escrowMarket, ui.bidderAddress, nowMs);
            const liveMin = review.minimum ?? item.latestMinimum ?? item.minimumAmount ?? item.amount;
            add(card, "p", `${p.awaitingFirstBid ? "⏳ Starts auction on 1st bid" : "🔥 Live POA auction"} · Min ${poaShort(liveMin)} POA`, "badge-ok");
            if (item.needsReview || item.outbid)
                add(card, "p", "⚠️ " + (item.reviewMessage || "Auction changed — review your highest bid."), item.outbid ? "auction-outbid-badge" : "badge-warn");
            const actionBtns = add(card, "div", "", "button-row");
            const reviewBtn = item.needsReview ? add(actionBtns, "button", "✅ Review changed item", "secondary small") : null;
            if (reviewBtn) {
                reviewBtn.type = "button";
                reviewBtn.disabled = ui.registryReadFailed || !review.canAcknowledge;
                reviewBtn.addEventListener("click", () => {
                    if (ui.registryReadFailed)
                        return;
                    try {
                        ui.cart[index] = acknowledgeCartItem(item, ui.cap, ui.latestState, ui.escrowMarket, ui.bidderAddress, ui.escrowMarketServerTime || Date.now());
                        persistCart();
                        renderCart();
                    } catch {
                        el("cartStatus").textContent = "✏️ Fix the amount or remove this item.";
                    }
                });
            }
            if (item.outbid && !review.canAcknowledge && liveMin && liveMin !== item.amount) {
                const raiseBtn = add(actionBtns, "button", `⬆️ Raise max bid to ${poaShort(liveMin)} POA`, "secondary small");
                raiseBtn.type = "button";
                raiseBtn.addEventListener("click", () => {
                    try {
                        const raised = editCartAmount(item, liveMin, ui.cap, ui.latestState, ui.escrowMarket);
                        ui.cart[index] = acknowledgeCartItem(raised, ui.cap, ui.latestState, ui.escrowMarket, ui.bidderAddress, ui.escrowMarketServerTime || Date.now());
                        resetCopyFeedback();
                        persistCart();
                        renderCart();
                    } catch (err) {
                        el("cartStatus").textContent = err?.message || "✏️ Raise your highest bid or remove this item.";
                    }
                });
            }
            const errorNode = add(card, "p", item.validationError || "", "badge-warn");
            errorNode.setAttribute("role", "alert");
            const controls = add(card, "div", "", "inline-controls");
            const bidInput = document.createElement("input");
            bidInput.value = poaShort(item.amount);
            bidInput.dataset.fieldKey = `poaBidCart:${p.auctionId || item.name}`;
            bidInput.setAttribute("inputmode", "decimal");
            bidInput.setAttribute("aria-label", "Highest bid in POA for " + item.name);
            bidInput.placeholder = poaShort(liveMin);
            bidInput.addEventListener("input", () => {
                try {
                    Object.assign(item, editCartAmount(item, bidInput.value, ui.cap, ui.latestState, ui.escrowMarket));
                    delete item.validationError;
                    persistCart();
                } catch (error) {
                    item.validationError = error.message;
                }
                errorNode.textContent = item.validationError || "";
                bidInput.setAttribute("aria-invalid", item.validationError ? "true" : "false");
                resetCopyFeedback();
                persistCart();
                if (reviewBtn)
                    reviewBtn.disabled = ui.registryReadFailed || !cartReview(item, ui.cap, ui.latestState, ui.escrowMarket, ui.bidderAddress, ui.escrowMarketServerTime || Date.now()).canAcknowledge;
                updateCartCopyState();
                updatePromptText();
                renderFloatingCart();
            });
            const removeBid = add(card, "button", "✖️", "secondary small cart-remove");
            removeBid.setAttribute("aria-label", "Remove " + item.name + " from cart");
            removeBid.type = "button";
            removeBid.addEventListener("click", () => removeCartAt(index));
            const bidLabel = add(controls, "label", "Your highest bid (POA)", "amount-label");
            const unitBox = add(bidLabel, "span", "", "amount-unit");
            unitBox.append(bidInput);
            add(unitBox, "span", "POA", "input-unit");
            add(bidLabel, "small", "Ceiling for your agent (never exceeded). Editing it does not send POA.", "muted");
            return;
        }
        add(card, "p", `${actionLabel(item.action)} · ${item.tier} ${item.isRoot ? "root" : "child"}`, "badge");
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
                    el("cartStatus").textContent = "✏️ Fix the amount or remove this item.";
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
        amountInput.setAttribute("aria-label", "Bid or price amount in registry units for " + item.name);
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
            resetCopyFeedback();
            persistCart();
            updateCartCopyState();
            if (reviewBtn)
                reviewBtn.disabled = ui.registryReadFailed || !cartReview(item, ui.cap, ui.latestState).canAcknowledge;
            updatePromptText();
            renderFloatingCart();
        });
        const removeBtn = add(card, "button", "✖️", "secondary small cart-remove");
        removeBtn.setAttribute("aria-label", "Remove " + item.name + " from cart");
        removeBtn.type = "button";
        removeBtn.addEventListener("click", () => removeCartAt(index));
        const amountLabel = add(controls, "label", amountInput.readOnly ? "Listed price (registry units)" : "Bid amount (registry units)", "amount-label");
        const unitBox=add(amountLabel,"span","","amount-unit");unitBox.append(amountInput);add(unitBox,"span","units","input-unit");
        amountInput.placeholder="Whole-number registry units";
        add(amountLabel,"small",amountInput.readOnly?"The current listing price; not an editable bid.":"Maximum bid for this name. Editing it does not change the auction reserve.","muted");
    });
    updatePromptText();
    renderFloatingCart();
}

let releaseCartFocus = null;
export function setFloatingCartOpen(open) {
    const panel = el("floatingCartPanel"), backdrop = el("floatingCartBackdrop"), btn = el("floatingCartBtn"), wasOpen = !panel.hidden;
    if(open === wasOpen) return;
    panel.hidden = !open;
    backdrop.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if(open){renderFloatingCart();releaseCartFocus=trapDialog(panel,backdrop,btn);}
    else{const fp=el("floatingCartPrompt");if(fp){fp.hidden=true;fp.textContent="";}releaseCartFocus?.();releaseCartFocus=null;}
    syncCartShortcut();
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
    if (poaOnlyMode(ui.cap)) {
        const poaAuction = findOpenPoaAuctionByName(ui.escrowMarket, name, ui.escrowMarketServerTime || Date.now());
        if (poaAuction) {
            try { addToCart({ name, action: "poaBid", auctionId: poaAuction.id, amount: poaMinimumNextBid(poaAuction) }); } catch (error) { el("ideasStatus").textContent = error.message; }
            return;
        }
        if (info.isRoot && !s.names[name]?.activeId && !s.names[name]?.auctionId && !ui.reservedSet.has(name))
            try { addToCart({ name, action: "poaCheckout" }); } catch (error) { el("ideasStatus").textContent = error.message; }
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
