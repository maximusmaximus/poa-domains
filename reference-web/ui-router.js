import { domainPath, extractDomainProfile, findDomainSalesAndAuctions, isPoaAddress, parseDomainPath, parseOwnerPath, profileImageMediaPath, readViewQuery, saveTabSeen, shortenPoaAddress, tabWatermarks, viewPath } from "./shared.js?v=e24f44d20e2d";
import { ui } from "./ui-state.js?v=e24f44d20e2d";
import { createPoaCopyButton } from "./ui-copy.js?v=e24f44d20e2d";
import { add, el } from "./ui-core.js?v=e24f44d20e2d";
import { runSearch } from "./ui-search.js?v=e24f44d20e2d";
import { renderDomainPage, renderOwnerPage } from "./ui-domain.js?v=e24f44d20e2d";
import { updateTabDots } from "./ui-render.js?v=e24f44d20e2d";
import { syncCartShortcutNow } from "./ui-cart.js?v=e24f44d20e2d";
import { renderManagement } from "./ui-manage.js?v=e24f44d20e2d";

const LAST_POA_KEY = "poadomains.lastPoaAddress.v1";

export function resolveKnownPoaAddress(preferred = "") {
    const candidates = [
        preferred,
        el("manageOwner")?.value,
        ui.knownOwner,
        ui.inferredCartOwner,
        ui.bidderAddress,
    ];
    try {
        candidates.push(globalThis.localStorage?.getItem?.(LAST_POA_KEY));
    } catch {}
    for (const raw of candidates) {
        const s = typeof raw === "string" ? raw.trim() : "";
        if (isPoaAddress(s)) return s;
    }
    return "";
}

export function syncEscrowPayerAddress(preferred = "", { force = false } = {}) {
    const addr = resolveKnownPoaAddress(preferred);
    if (!addr) return "";
    try {
        globalThis.localStorage?.setItem?.(LAST_POA_KEY, addr);
    } catch {}
    const payer = el("escrowPayer");
    if (!payer) return addr;
    const cur = payer.value.trim();
    if (force || !cur || cur === payer.dataset.autofilledPoa) {
        payer.value = addr;
        payer.dataset.autofilledPoa = addr;
        if (cur !== addr) payer.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return addr;
}

/** Open Manage domains tab, prefill the owner address, and focus a specific domain card. */
export function openManageDomain(name, ownerId) {
    const resolvedOwner = ownerId || (() => {
        const entry = ui.latestState?.names?.[name];
        return entry?.activeId ? ui.latestState?.deeds?.[entry.activeId]?.owner : "";
    })();
    navigateHome();
    setSectionTab("escrow");
    const ownerField = el("manageOwner");
    if (ownerField && typeof resolvedOwner === "string" && resolvedOwner)
        ownerField.value = resolvedOwner;
    syncEscrowPayerAddress(resolvedOwner);
    ui.focusedManageDomain = typeof name === "string" && name ? name : null;
    renderManagement({ focusDomain: ui.focusedManageDomain });
    const target = ui.focusedManageDomain
        ? [...document.querySelectorAll("#manageNames article.card")].find((c) => c.dataset.domainName === ui.focusedManageDomain)
        : el("manageDomains");
    target?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

/** Open 🪙 My POA; with a name, prefill it for a POA listing or auction. Your agent signs; nothing is sent here. */
export function openPoa(name, opts = {}) {
    const mode = opts?.mode === "auction" ? "auction" : "sell";
    const deedOwner = typeof name === "string" && name
        ? (() => {
            const entry = ui.latestState?.names?.[name];
            return entry?.activeId ? ui.latestState?.deeds?.[entry.activeId]?.owner : "";
        })()
        : "";
    const resolvedOwner = isPoaAddress(opts?.owner) ? opts.owner : (isPoaAddress(deedOwner) ? deedOwner : "");
    navigateHome();
    setSectionTab("escrow");
    syncEscrowPayerAddress(resolvedOwner, { force: Boolean(resolvedOwner) });
    if (typeof name === "string" && name) {
        const field = el("escrowName"), amount = el("escrowAmount"), message = el("escrowMessage");
        const root = el("escrowPayments");
        if (field) field.value = name;
        const buttons = root ? [...root.querySelectorAll('.escrow-step[data-step="1"] .button-row button, .button-row button')] : [];
        const targetBtn = buttons.find((b) => (mode === "auction" ? /Open my POA auction/ : /List my name for POA/).test(b.textContent ?? ""));
        if (root) {
            root.dataset.selectedAction = mode === "auction" ? "open" : "list";
            for (const b of buttons) b.classList.toggle("is-selected-action", b === targetBtn);
        }
        const payerAddr = el("escrowPayer")?.value.trim() ?? "";
        if (targetBtn && !targetBtn.disabled && isPoaAddress(payerAddr)) {
            targetBtn.click();
            if (message) {
                message.textContent = mode === "auction"
                    ? `🔨 Auction ready for ${name} — adjust the reserve POA amount if needed; code updates live below. ⚠️ Profile fields pause while listed and drop on transfer.`
                    : `🏷️ Sale listing ready for ${name} — adjust the POA price if needed; code updates live below. ⚠️ Profile fields pause while listed and drop on transfer.`;
            }
        } else if (message) {
            message.textContent = mode === "auction"
                ? `🔨 Auction for ${name}: enter your reserve POA amount, then tap ⏱️ Open my POA auction.`
                : `🏷️ Sell ${name}: enter your POA price, then tap 🏷️ List my name for POA.`;
        }
        root?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
        if (amount) amount.focus?.({ preventScroll: true });
    }
}

export function writeViewURL(path = location.pathname) {
    const next = viewPath(path, ui.lastSearch, ui.activeSectionTab);
    if (next !== location.pathname + location.search)
        history.pushState(ui.route, "", next);
}

export function restoreViewFromURL() {
    const view = readViewQuery(location.search), d = parseDomainPath(location.pathname), o = parseOwnerPath(location.pathname);
    ui.lastSearch = view.query;
    el("searchInput").value = view.query;
    ui.route = d ? { kind: "domain", name: d } : o ? { kind: "owner", ownerId: o } : { kind: "home" };
    ui.currentDomainName = d || null;
    ui.currentOwnerId = o || null;
    setSectionTab(view.tab, false);
    applyRoute();
    runSearch(ui.lastSearch, false);
}

export function isRegisteredDomain(name) {
    if (!name || typeof name !== "string")
        return false;
    const entry = ui.latestState?.names?.[name];
    if (!entry?.activeId)
        return false;
    const deed = ui.latestState?.deeds?.[entry.activeId];
    return Boolean(deed && !deed.retired);
}

function firstGrapheme(name) {
    const raw = String(name ?? "").trim();
    if (!raw) return "?";
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
        const seg = new Intl.Segmenter("en", { granularity: "grapheme" }).segment(raw)[Symbol.iterator]().next().value?.segment;
        if (seg) return /^[a-z]$/i.test(seg) ? seg.toUpperCase() : seg;
    }
    const ch = [...raw][0] || "?";
    return /^[a-z]$/i.test(ch) ? ch.toUpperCase() : ch;
}

function avatarTone(name) {
    let h = 0;
    const s = String(name ?? "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return String(h % 6);
}

export function domainAvatarMediaPath(name) {
    if (!name || typeof name !== "string") return null;
    const entry = ui.latestState?.names?.[name];
    const deed = entry?.activeId ? ui.latestState?.deeds?.[entry.activeId] : null;
    if (!deed || deed.retired) return null;
    const saleInfo = findDomainSalesAndAuctions({
        name,
        deed,
        state: ui.latestState,
        escrowMarket: ui.escrowMarket,
        nowMs: ui.escrowMarketServerTime || Date.now(),
    });
    if (saleInfo.listedForSale) return null;
    const extracted = extractDomainProfile(deed);
    if (!extracted || extracted.isDefault) return null;
    return profileImageMediaPath(extracted.profile?.image);
}

export function updateDomainAvatarElement(avatarEl, name, mediaPath) {
    if (!avatarEl) return;
    const glyph = firstGrapheme(name);
    const isEmoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(glyph);
    avatarEl.dataset.avatarDomain = String(name ?? "");
    avatarEl.dataset.avatarTone = avatarTone(name);
    avatarEl.replaceChildren();
    const fallback = document.createElement("span");
    fallback.className = isEmoji ? "domain-avatar-glyph domain-name" : "domain-avatar-glyph";
    fallback.textContent = glyph;
    avatarEl.append(fallback);
    const resolved = mediaPath === undefined ? domainAvatarMediaPath(name) : mediaPath;
    if (resolved) {
        const img = document.createElement("img");
        img.className = "domain-avatar-img";
        img.src = resolved;
        img.alt = "";
        img.addEventListener("error", () => {
            avatarEl.classList.remove("has-image");
            img.remove();
        });
        avatarEl.classList.add("has-image");
        avatarEl.append(img);
    } else {
        avatarEl.classList.remove("has-image");
    }
}

export function createDomainAvatar(name, { size = "sm", mediaPath } = {}) {
    const box = document.createElement("span");
    box.className = `domain-header-avatar domain-header-avatar-${size}`;
    box.setAttribute("aria-hidden", "true");
    updateDomainAvatarElement(box, name, mediaPath);
    return box;
}

export function domainHeader(parent, name, { size = "sm", registered, prefix = "", suffix = "", mediaPath } = {}) {
    if (!parent) return { avatar: null, link: null };
    parent.classList.add("domain-heading");
    const avatar = createDomainAvatar(name, { size, mediaPath });
    parent.append(avatar);
    if (prefix) parent.append(prefix);
    const link = nameLink(parent, name, "domain-link", { registered });
    if (suffix) parent.append(suffix);
    return { avatar, link };
}

export function nameLink(parent, name, css = "domain-link", opts = {}) {
    if (!name)
        return add(parent, "span", "—", css);
    const a = document.createElement("a");
    a.href = domainPath(name);
    const registered = typeof opts?.registered === "boolean" ? opts.registered : isRegisteredDomain(name);
    a.className = css + " domain-name" + (registered ? " domain-tile is-registered" : "");
    a.textContent = name;
    a.addEventListener("click", (event) => {
        event.preventDefault();
        navigateDomain(name);
    });
    parent.append(a);
    return a;
}

export function ownerLink(parent, ownerId, label) {
    const short = isPoaAddress(ownerId) ? shortenPoaAddress(ownerId) : null;
    const display = label && !isPoaAddress(label) ? label : (short ?? (ownerId.slice(0, 18) + "…"));
    const showCopy = Boolean(short && display === short);
    const a = document.createElement("a");
    a.href = "/p/" + encodeURIComponent(ownerId);
    a.className = showCopy ? "domain-link poa-addr-text" : "domain-link";
    a.textContent = display;
    if (short)
        a.title = ownerId;
    a.addEventListener("click", (event) => {
        event.preventDefault();
        navigateOwner(ownerId);
    });
    if (showCopy) {
        const wrap = document.createElement("span");
        wrap.className = "poa-addr-inline";
        wrap.append(a, createPoaCopyButton(ownerId));
        parent.append(wrap);
    }
    else {
        parent.append(a);
    }
    return a;
}

function closeOverlaysBeforeNavigate() {
    if (el("floatingCartPanel") && !el("floatingCartPanel").hidden) el("floatingCartClose")?.click();
    if (el("detailView") && !el("detailView").hidden) el("detailClose")?.click();
}

export function navigateHome() {
    closeOverlaysBeforeNavigate();
    ui.route = { kind: "home" };
    ui.currentDomainName = null;
    ui.currentOwnerId = null;
    writeViewURL("/");
    applyRoute();
}

export function navigateDomain(name) {
    closeOverlaysBeforeNavigate();
    ui.route = { kind: "domain", name };
    ui.currentDomainName = name;
    ui.currentOwnerId = null;
    writeViewURL(domainPath(name));
    applyRoute();
}

export function navigateOwner(ownerId) {
    closeOverlaysBeforeNavigate();
    ui.route = { kind: "owner", ownerId };
    ui.currentOwnerId = ownerId;
    ui.currentDomainName = null;
    writeViewURL("/p/" + encodeURIComponent(ownerId));
    applyRoute();
}

function syncAdvancedLink() {
    const link = el("advancedLink");
    if (!link) return;
    const on = ui.route.kind === "home" && ui.activeSectionTab === "handoff";
    link.classList.toggle("is-active", on);
    if (on) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
}

export function openAdvanced() {
    const fromSubpage = ui.route.kind !== "home";
    if (fromSubpage) {
        closeOverlaysBeforeNavigate();
        ui.route = { kind: "home" };
        ui.currentDomainName = null;
        ui.currentOwnerId = null;
        applyRoute();
    }
    setSectionTab("handoff", true, fromSubpage ? "/" : undefined);
    const section = el("handoffSection");
    section?.scrollIntoView?.({ block: "start" });
    section?.focus?.({ preventScroll: true });
}

export function applyRoute() {
    const home = el("homeMain");
    const domain = el("domainMain");
    const owner = el("ownerMain");
    const tabs = el("sectionTabs");
    if (ui.route.kind === "domain") {
        home.hidden = true;
        domain.hidden = false;
        owner.hidden = true;
        if (tabs)
            tabs.hidden = true;
        if (ui.latestState)
            renderDomainPage(ui.currentDomainName);
        ui.escrowUI?.domain(ui.currentDomainName);
    }
    else if (ui.route.kind === "owner") {
        home.hidden = true;
        domain.hidden = true;
        owner.hidden = false;
        if (tabs)
            tabs.hidden = true;
        if (ui.latestState)
            renderOwnerPage(ui.currentOwnerId);
    }
    else {
        home.hidden = false;
        domain.hidden = true;
        owner.hidden = true;
        if (tabs)
            tabs.hidden = false;
    }
    syncAdvancedLink();
}

export function setSectionTab(tabId, markSeen = true, path = location.pathname) {
    ui.activeSectionTab = tabId;
    if (markSeen)
        writeViewURL(path);
    const tabBtns = [...document.querySelectorAll(".section-tab")];
    const hasActiveTab = tabBtns.some((b) => b.getAttribute("data-tab") === tabId);
    tabBtns.forEach((btn, idx) => {
        const on = btn.getAttribute("data-tab") === tabId;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
        btn.tabIndex = on || (!hasActiveTab && idx === 0) ? 0 : -1;
    });
    for (const section of document.querySelectorAll("main#homeMain > section[data-section]")) {
        const on = section.getAttribute("data-section") === tabId;
        section.classList.toggle("is-active-section", on);
        section.hidden = !on;
    }
    syncAdvancedLink();
    if (tabId === "escrow") {
        const ownerField = el("manageOwner");
        if (ownerField && !ownerField.value.trim() && ui.knownOwner) {
            ownerField.value = ui.knownOwner;
            renderManagement();
        }
        syncEscrowPayerAddress();
    }
    syncCartShortcutNow();
    if (markSeen && ui.latestState) {
        const marks = tabWatermarks(ui.latestState);
        ui.tabSeen = { ...ui.tabSeen, [tabId]: marks[tabId] ?? ui.latestState.sequence ?? 0 };
        saveTabSeen(globalThis.localStorage, ui.tabSeen);
        updateTabDots(ui.latestState);
    }
}
