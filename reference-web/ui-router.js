import { domainPath, isPoaAddress, parseDomainPath, parseOwnerPath, readViewQuery, saveTabSeen, shortenPoaAddress, tabWatermarks, viewPath } from "./shared.js?v=9e213075b5f0";
import { ui } from "./ui-state.js?v=9e213075b5f0";
import { createPoaCopyButton } from "./ui-copy.js?v=9e213075b5f0";
import { add, el } from "./ui-core.js?v=9e213075b5f0";
import { runSearch } from "./ui-search.js?v=9e213075b5f0";
import { renderDomainPage, renderOwnerPage } from "./ui-domain.js?v=9e213075b5f0";
import { updateTabDots } from "./ui-render.js?v=9e213075b5f0";
import { syncCartShortcutNow } from "./ui-cart.js?v=9e213075b5f0";
import { renderManagement } from "./ui-manage.js?v=9e213075b5f0";

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
    ui.focusedManageDomain = typeof name === "string" && name ? name : null;
    renderManagement({ focusDomain: ui.focusedManageDomain });
    const target = ui.focusedManageDomain
        ? [...document.querySelectorAll("#manageNames article.card")].find((c) => c.dataset.domainName === ui.focusedManageDomain)
        : el("manageDomains");
    target?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

/** Open 🪙 My POA; with a name, prefill it for a POA listing or auction. Your agent signs; nothing is sent here. */
export function openPoa(name) {
    navigateHome();
    setSectionTab("escrow");
    if (typeof name === "string" && name) {
        const field = el("escrowName"), amount = el("escrowAmount"), message = el("escrowMessage");
        if (field) field.value = name;
        if (amount) amount.focus?.();
        if (message) message.textContent = "🏷️ Enter your POA price, then tap List my name for POA or Open my POA auction.";
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
}

export function setSectionTab(tabId, markSeen = true) {
    ui.activeSectionTab = tabId;
    if (markSeen)
        writeViewURL();
    for (const btn of document.querySelectorAll(".section-tab")) {
        const on = btn.getAttribute("data-tab") === tabId;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
        btn.tabIndex = on ? 0 : -1;
    }
    for (const section of document.querySelectorAll("main#homeMain > section[data-section]")) {
        const on = section.getAttribute("data-section") === tabId;
        section.classList.toggle("is-active-section", on);
        section.hidden = !on;
    }
    if (tabId === "escrow") {
        const ownerField = el("manageOwner");
        if (ownerField && !ownerField.value.trim() && ui.knownOwner) {
            ownerField.value = ui.knownOwner;
            renderManagement();
        }
    }
    syncCartShortcutNow();
    if (markSeen && ui.latestState) {
        const marks = tabWatermarks(ui.latestState);
        ui.tabSeen = { ...ui.tabSeen, [tabId]: marks[tabId] ?? ui.latestState.sequence ?? 0 };
        saveTabSeen(globalThis.localStorage, ui.tabSeen);
        updateTabDots(ui.latestState);
    }
}
