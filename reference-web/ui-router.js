import { domainPath, parseDomainPath, parseOwnerPath, readViewQuery, saveTabSeen, tabWatermarks, viewPath } from "./shared.js?v=5c150edb6e15";
import { ui } from "./ui-state.js?v=5c150edb6e15";
import { add, el } from "./ui-core.js?v=5c150edb6e15";
import { runSearch } from "./ui-search.js?v=5c150edb6e15";
import { renderDomainPage, renderOwnerPage } from "./ui-domain.js?v=5c150edb6e15";
import { updateTabDots } from "./ui-render.js?v=5c150edb6e15";

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

export function nameLink(parent, name, css = "domain-link") {
    if (!name)
        return add(parent, "span", "—", css);
    const a = document.createElement("a");
    a.href = domainPath(name);
    a.className = css;
    a.textContent = name;
    a.addEventListener("click", (event) => {
        event.preventDefault();
        navigateDomain(name);
    });
    parent.append(a);
    return a;
}

export function ownerLink(parent, ownerId, label) {
    const a = document.createElement("a");
    a.href = "/p/" + encodeURIComponent(ownerId);
    a.className = "domain-link";
    a.textContent = label || ownerId.slice(0, 18) + "…";
    a.addEventListener("click", (event) => {
        event.preventDefault();
        navigateOwner(ownerId);
    });
    parent.append(a);
    return a;
}

export function navigateHome() {
    ui.route = { kind: "home" };
    ui.currentDomainName = null;
    ui.currentOwnerId = null;
    writeViewURL("/");
    applyRoute();
}

export function navigateDomain(name) {
    ui.route = { kind: "domain", name };
    ui.currentDomainName = name;
    ui.currentOwnerId = null;
    writeViewURL(domainPath(name));
    applyRoute();
}

export function navigateOwner(ownerId) {
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
    if (markSeen && ui.latestState) {
        const marks = tabWatermarks(ui.latestState);
        ui.tabSeen = { ...ui.tabSeen, [tabId]: marks[tabId] ?? ui.latestState.sequence ?? 0 };
        saveTabSeen(globalThis.localStorage, ui.tabSeen);
        updateTabDots(ui.latestState);
    }
}
