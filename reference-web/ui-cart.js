import { publicNameUnavailable } from "./shared.js?v=193b1cfcba90";
import { registryUnit } from "./shared.js?v=193b1cfcba90";
import { actionLabel } from "./ui-copy.js?v=193b1cfcba90";
import { trapDialog } from "./ui-a11y.js?v=193b1cfcba90";
import { ui } from "./ui-state.js?v=193b1cfcba90";
import { acknowledgeCartItem, buildAgentCartHandoff, renderAgentCartHandoff, updatedAge, buildCartItem, cartReview, editCartAmount, inspectName, minimumNextBid, rootAuctionPolicy, saveCart, shouldHoldTransactions } from "./shared.js?v=193b1cfcba90";
import { add, el, endpointBase } from "./ui-core.js?v=193b1cfcba90";
import { nameLink } from "./ui-router.js?v=193b1cfcba90";

export function cartCopyBlocked() {
    return ui.refreshing || ui.lastLoadedAt === null || ui.registryReadFailed || ui.cart.some(item => item.validationError || item.needsReview) || shouldHoldTransactions(ui.networkStatus.level) || !!ui.networkStatus.hold;
}

export function updateCartCopyState() {
    for (const id of ["copyCartPrompt", "copyCheckoutBtn", "downloadCartJSON"])
        el(id).disabled = !ui.cart.length || cartCopyBlocked() || ui.handoffPending || !ui.handoffData;
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

let handoffGeneration=0;
export function updateHandoffAge(){
    const text=ui.handoffData?"🧾 Agent Cart Handoff v2 · "+updatedAge(ui.handoffData.generatedAt).replace("updated","generated"):"🧾 Agent Cart Handoff v2 · "+(ui.handoffPending?"building…":ui.handoffError?"not ready: "+ui.handoffError:"not ready");
    for(const id of ["cartHandoffMeta","floatingHandoffMeta"])if(el(id))el(id).textContent=text;
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
        el("cartPrompt").textContent=ui.refreshing?"⏳ Checking the registry…":ui.registryReadFailed||ui.lastLoadedAt===null?"🔄 Refresh registry data first.":shouldHoldTransactions(ui.networkStatus.level)||ui.networkStatus.hold?"⏸️ Handoff paused while the PoA network is down. Nothing was sent.":"✏️ Fix the cart items marked for review.";
        updateHandoffAge();updateCartCopyState();return;
    }
    ui.handoffPending=true;updateHandoffAge();updateCartCopyState();
    el("cartPrompt").textContent="🧾 Building your handoff…";
    try{
        const data=await buildAgentCartHandoff(structuredClone(ui.cart),ui.cap,"",endpointBase(),ui.configMode,structuredClone(ui.rawSnapshot));
        if(generation!==handoffGeneration||cartCopyBlocked())return;
        ui.handoffData=data;el("cartPrompt").textContent=renderAgentCartHandoff(data);
    }catch(error){
        if(generation===handoffGeneration){ui.handoffError=String(error?.message||error).slice(0,200);el("cartPrompt").textContent="😕 Couldn't build your handoff. Tap 🔄 Refresh and try again. Nothing was sent.";}
    }finally{
        if(generation===handoffGeneration){ui.handoffPending=false;updateHandoffAge();updateCartCopyState();}
    }
}
export function downloadCartJSON(){
    if(!ui.handoffData||ui.handoffPending||cartCopyBlocked())return;
    const blob=new Blob([JSON.stringify(ui.handoffData,null,2)+"\n"],{type:"application/json"}),url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download="poa-domains-cart-v2.json";document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
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

export function renderFloatingCart() {
    observeCartArea();
    const badge = el("floatingCartBadge");
    const list = el("floatingCartList");
    const clearBtn = el("floatingCartClear");
    const copyBtn = el("copyCheckoutBtn");
    badge.textContent = String(ui.cart.length);
    badge.hidden = ui.cart.length === 0;
    el("floatingCartBtn").setAttribute("aria-label", ui.cart.length ? `Open cart, ${ui.cart.length} items` : "Open cart");
    clearBtn.disabled = ui.cart.length === 0;
    const held = shouldHoldTransactions(ui.networkStatus.level) || !!ui.networkStatus.hold;
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
        add(card, "p", `${actionLabel(item.action)} · ${item.amount} ${registryUnit(item.asset)}`, "badge");
        add(card, "p", item.summary);
        if (item.needsReview)
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
    el("cartCount").textContent = String(ui.cart.length);
    el("clearCart").disabled = ui.cart.length === 0;
    {
        const held = shouldHoldTransactions(ui.networkStatus.level) || !!ui.networkStatus.hold;
        el("copyCartPrompt").disabled = ui.cart.length === 0 || cartCopyBlocked() || ui.handoffPending || !ui.handoffData;
        if (held)
            el("copyCartPrompt").classList.add("action-held");
        else
            el("copyCartPrompt").classList.remove("action-held");
    }
    el("cartStatus").textContent = `🛒 Cart: ${ui.cart.length} ${ui.cart.length === 1 ? "item" : "items"}.`;
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
