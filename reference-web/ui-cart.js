import { publicNameUnavailable } from "./shared.js?v=69895dc026c0";
import { registryUnit } from "./shared.js?v=69895dc026c0";
import { actionLabel } from "./ui-copy.js?v=69895dc026c0";
import { createInlineInfo } from "./ui-help.js?v=69895dc026c0";
import { trapDialog } from "./ui-a11y.js?v=69895dc026c0";
import { ui } from "./ui-state.js?v=69895dc026c0";
import { acknowledgeCartItem, buildAgentCartHandoff, renderAgentCartHandoff, buildPoaCheckoutHandoff, renderPoaCheckoutHandoff, poaOnlyMode, poaShort, poaMinimumNextBid, findOpenPoaAuctionByName, updatedAge, buildCartItem, cartReview, editCartAmount, inspectName, minimumNextBid, rootAuctionPolicy, saveCart, saveKnownOwner, shouldHoldTransactions, validPrincipal } from "./shared.js?v=69895dc026c0";
import { add, el, endpointBase } from "./ui-core.js?v=69895dc026c0";
import { domainHeader, openManageDomain, syncEscrowPayerAddress } from "./ui-router.js?v=69895dc026c0";
import { updateManagedDomainsBadge } from "./ui-render.js?v=69895dc026c0";

export function cartCopyBlocked() {
    return ui.refreshing || ui.lastLoadedAt === null || ui.registryReadFailed || ui.cart.some(item => item.validationError || item.needsReview) || (ui.networkStatus.lastKnown !== true && shouldHoldTransactions(ui.networkStatus.lastKnown === true ? "checking" : ui.networkStatus.level)) || !!ui.networkStatus.hold;
}

export function updateCartCopyState() {
    for (const id of ["copyCartPrompt", "copyCheckoutBtn", "downloadCartJSON", "floatingDownloadCartJSON"]) {
        const btn = el(id);
        if (btn) btn.disabled = !ui.cart.length || cartCopyBlocked() || ui.handoffPending || !ui.handoffData;
    }
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

function syncFloatingPrompt(text) {
    const fp = el("floatingCartPrompt");
    if (!fp) return;
    if (!ui.cart.length || !text) {
        fp.hidden = true;
        fp.textContent = "";
    } else {
        fp.textContent = text;
        fp.hidden = false;
    }
}

export async function updatePromptText() {
    const generation=++handoffGeneration;
    el("cartAnchor").classList.toggle("cart-empty",!ui.cart.length);
    ui.handoffData=null;ui.handoffPending=false;ui.handoffError="";
    if(!ui.cart.length||!ui.cap){
        if(!ui.cart.length)el("cartPrompt").textContent="🛒 Your cart is empty. Add a name from Find, Auctions or For sale.";
        syncFloatingPrompt("");
        updateHandoffAge();updateCartCopyState();return;
    }
    if(cartCopyBlocked()){
        const blockedText=ui.refreshing?"⏳ Checking the registry…":ui.registryReadFailed||ui.lastLoadedAt===null?"🔄 Refresh registry data first.":shouldHoldTransactions(ui.networkStatus.lastKnown === true ? "checking" : ui.networkStatus.level)||ui.networkStatus.hold?"⏸️ Handoff paused while the PoA network is down. Nothing was sent.":"✏️ Fix the cart items marked for review.";
        el("cartPrompt").textContent=blockedText;
        syncFloatingPrompt(blockedText);
        updateHandoffAge();updateCartCopyState();return;
    }
    ui.handoffPending=true;updateHandoffAge();updateCartCopyState();
    el("cartPrompt").textContent="🧾 Building your handoff…";
    syncFloatingPrompt("🧾 Building your handoff…");
    try{
        const poa=poaOnlyMode(ui.cap);
        const data=poa?buildPoaCheckoutHandoff(structuredClone(ui.cart),ui.cap,endpointBase(),structuredClone(ui.rawSnapshot))
            :await buildAgentCartHandoff(structuredClone(ui.cart),ui.cap,"",endpointBase(),ui.configMode,structuredClone(ui.rawSnapshot));
        if(generation!==handoffGeneration||cartCopyBlocked())return;
        ui.handoffData=data;
        const rendered=renderCurrentCartHandoff();
        el("cartPrompt").textContent=rendered;
        syncFloatingPrompt(rendered);
    }catch(error){
        if(generation===handoffGeneration){ui.handoffError=String(error?.message||error).slice(0,200);const errText="😕 Couldn't build your handoff. Tap 🔄 Refresh and try again. Nothing was sent.";el("cartPrompt").textContent=errText;syncFloatingPrompt(errText);}
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

function cleanHoldText(raw) {
    return String(raw ?? "")
        .replace(/^Network freshness or verification is held\.?\s*/i, "")
        .replace(/\s*Payments stay held\.?$/i, "")
        .replace(/\.+$/, "")
        .trim();
}

function formatEscrowHoldReason(caps) {
    const map = {
        ASSET_LIABILITY_MISMATCH: "Reconciliation hold awaiting operator review",
        ESCROW_NODE_TIMEOUT: "Public PoA network read timed out",
        ESCROW_NODE_UNAVAILABLE: "PoA network temporarily unreachable",
        ESCROW_NODE_AUTH: "PoA ledger is temporarily locked",
        ESCROW_NODE_HTTP: "PoA node returned an error",
        ESCROW_NODE_REDIRECT: "PoA node redirected a safety check",
        ESCROW_NODE_RESPONSE_LIMIT: "PoA node response exceeded limit",
        ESCROW_NODE_INVALID_RESPONSE: "PoA node response could not be verified",
        ESCROW_NODE_CHAIN: "PoA network identity mismatch",
        ESCROW_CHAIN: "PoA network identity mismatch",
        ESCROW_STALE: "PoA network status is stale",
        ESCROW_PROTOCOL_UNPINNED: "PoA protocol update pending review",
        ESCROW_PROTOCOL_CHANGED: "PoA protocol update pending review",
        ESCROW_UNALIGNED_CUT: "Waiting for PoA checkpoint sync",
        ESCROW_CHECKPOINT: "Waiting for PoA checkpoint sync",
        ESCROW_FUTURE_CHECKPOINT: "Waiting for PoA checkpoint sync",
        ESCROW_CHECKPOINT_ROLLBACK: "Waiting for PoA checkpoint sync",
        ESCROW_FEE_POLICY: "PoA fee policy update pending",
    };
    const parts = [];
    const pushUnique = (text) => {
        const cleaned = cleanHoldText(text);
        if (!cleaned)
            return;
        const low = cleaned.toLowerCase();
        if (!parts.some((p) => p.toLowerCase().includes(low) || low.includes(p.toLowerCase())))
            parts.push(cleaned);
    };
    const fCode = typeof caps.freshness?.code === "string" ? caps.freshness.code.trim() : "";
    const fReason = typeof caps.freshness?.reason === "string" ? caps.freshness.reason.trim() : "";
    const primary = typeof caps.holdReason === "string" ? caps.holdReason.trim() : "";
    const primaryIsFreshness = Boolean(primary && ((fReason && primary === fReason) || /^Network freshness or verification is held/i.test(primary)));
    if (primary && !primaryIsFreshness)
        pushUnique(map[primary] ?? primary);
    else if (!primary && caps.paused)
        pushUnique("POA payments paused");
    if (fCode)
        pushUnique(map[fCode] ?? fReason ?? fCode);
    else if (caps.freshness?.held && fReason)
        pushUnique(fReason);
    else if (primaryIsFreshness)
        pushUnique(primary);
    const out = parts.join(" · ") || "Temporarily paused";
    return /[.!?]$/.test(out) ? out : out + ".";
}

export function renderCartEscrowStatus() {
    const escrowKnown = Boolean(ui.escrowCaps);
    const show = Boolean(ui.cap && poaOnlyMode(ui.cap) && (escrowKnown ? ui.escrowCaps.enabled : ui.cap.escrow?.enabled));
    const caps = ui.escrowCaps;
    const isHeld = Boolean(caps && (caps.held || caps.paused || caps.freshness?.held));
    const reason = show && isHeld ? formatEscrowHoldReason(caps) : "";
    for (const id of ["cartEscrowStatus", "floatingCartEscrowStatus"]) {
        const node = el(id);
        if (!node)
            continue;
        node.hidden = !show;
        node.className = "cart-escrow-status " + (!escrowKnown ? "badge" : isHeld ? "is-held badge-warn" : "badge-ok");
        node.replaceChildren();
        if (!show)
            continue;
        const title = document.createElement("strong");
        title.className = "cart-escrow-title";
        title.setAttribute("role", "status");
        title.setAttribute("aria-live", "polite");
        if (!escrowKnown) {
            title.textContent = "⚪ Checking POA checkout…";
            node.append(title);
        } else if (isHeld) {
            title.textContent = "⏸️ POA checkout paused";
            const info = createInlineInfo(id + "-info", "Why POA checkout is paused", "");
            const firstP = info.querySelector(".info-popover p");
            if (firstP) {
                firstP.replaceChildren();
                const detail = document.createElement("span");
                detail.className = "cart-escrow-reason";
                detail.textContent = reason;
                const hint = document.createElement("span");
                hint.className = "cart-escrow-hint";
                hint.textContent = "Plan your cart now — wait to send POA until checkout reopens.";
                firstP.append(detail, hint);
            }
            node.append(title, info);
        } else {
            title.textContent = "🟢 POA checkout open";
            node.append(title);
        }
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
                        ["Instant outbid credit & easy withdraw: ", "Late bids extend the close time by the quiet window. If another user outbids you, your outbid POA credits instantly back to your available escrow balance so you can re-bid right away — or withdraw it back to your original wallet anytime in My POA."],
                        ["Seller handover after close: ", newCount > 0
                            ? "New names mint immediately via issue. Winning an auction waits for the seller's signed settle handover (seller/fee paid before title commits); if unsettled past close + quiet, escrow auto-expires and refunds the winner."
                            : "Winning a POA auction waits for the seller's signed settle handover after close (seller + fee are paid on-chain before title commits). If unsettled past close + quiet, escrow auto-expires and refunds the winner to the original payer."],
                    ]
                    : [
                        ["Finality first: ", "Your agent creates an escrow intent and sends the exact POA total with the unique memo. PoA network finality (K=5 attestations or checkpoint) is required — seen is not credited yet."],
                        ["Instant permanent mint: ", "Once final, escrow credits your balance and your agent submits issue for each name. Each domain is minted permanently to your address immediately in that step — no auction or wait for treasury payout."],
                        ["Verify ownership right away: ", "Open each name’s /d/<name> page or Manage domains with your public poa1… address to see your name."],
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

export function inferAnySettledCartOwner(state) {
    if (!state || !ui.cap || !ui.cart.length)
        return null;
    const owners = [];
    for (const item of ui.cart) {
        const entry = state.names?.[item.name];
        const deed = entry?.activeId ? state.deeds?.[entry.activeId] : null;
        if (!deed || deed.retired || !validPrincipal(deed.owner))
            continue;
        if (item.action === "poaCheckout" || item.action === "announceAuction+bid") {
            owners.push(deed.owner);
            continue;
        }
        if (item.action === "poaBid") {
            const auction = Array.isArray(ui.escrowMarket)
                ? ui.escrowMarket.find((a) => a && a.id === item.params?.auctionId)
                : null;
            if (auction && auction.status === "COMPLETE" && auction.high?.payer && auction.high.payer === deed.owner) {
                owners.push(deed.owner);
            }
        }
    }
    if (!owners.length)
        return null;
    const counts = new Map();
    for (const o of owners)
        counts.set(o, (counts.get(o) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function maybePrefillOwnerFromPurchasedCart(state) {
    const allInferred = inferOwnerFromPurchasedCart(state);
    const settledOwner = allInferred || inferAnySettledCartOwner(state);
    const notice = el("cartOwnedNotice");
    if (settledOwner) {
        const ownerToUse = validPrincipal(ui.knownOwner) ? ui.knownOwner : settledOwner;
        if (!validPrincipal(ui.knownOwner)) {
            ui.knownOwner = ownerToUse;
            saveKnownOwner(globalThis.localStorage, ownerToUse);
        }
        syncEscrowPayerAddress(ownerToUse);
        const ownerInput = el("manageOwner");
        const manageNotice = el("manageOwnerNotice");
        if (ownerInput && (!ownerInput.value.trim() || ownerInput.value.trim() === ui.inferredCartOwner)) {
            ownerInput.value = ownerToUse;
            ui.inferredCartOwner = ownerToUse;
            if (manageNotice) {
                manageNotice.replaceChildren();
                add(
                    manageNotice,
                    "span",
                    allInferred
                        ? "🎉 Prefilled from your recently registered cart names."
                        : "🎉 Prefilled from a settled name in your cart.",
                );
                manageNotice.append(
                    createInlineInfo(
                        "manage-owner-notice",
                        "About prefilled owner address",
                        "View-only until your agent signs an update. Nothing is submitted from this page.",
                    ),
                );
                manageNotice.hidden = false;
            }
        }
    }
    updateManagedDomainsBadge(state);
    if (!allInferred) {
        if (notice) {
            notice.hidden = true;
            notice.replaceChildren();
        }
        return settledOwner;
    }
    const targetOwner = validPrincipal(ui.knownOwner) ? ui.knownOwner : allInferred;
    if (notice) {
        notice.hidden = false;
        notice.replaceChildren();
        add(notice, "span", "🎉 All names in your cart are now registered! We prefilled their owner address in Manage domains. ");
        const btn = add(notice, "button", "⚙️ Manage these domains", "secondary small");
        btn.type = "button";
        btn.addEventListener("click", () => openManageDomain(ui.cart[0]?.name ?? "", targetOwner));
    }
    return targetOwner;
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
        card.dataset.cartAction = item.action;
        const h = add(card, "h3", "");
        domainHeader(h, item.name);
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
        card.dataset.cartAction = item.action;
        const h = add(card, "h4", "");
        domainHeader(h, item.name);
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
            add(card, "p", `${p.awaitingFirstBid ? "⏳ Starts on 1st bid" : "🔥 Live auction"} · Min ${poaShort(liveMin)} POA`, "badge-ok");
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
    if(open){renderFloatingCart();syncFloatingPrompt(ui.cart.length?el("cartPrompt")?.textContent:"");releaseCartFocus=trapDialog(panel,backdrop,btn);}
    else{releaseCartFocus?.();releaseCartFocus=null;}
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
