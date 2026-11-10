import { cartMinimum, cartSummary, formatDuration, isNetworkBannerDismissed, networkBannerColor, networkBannerCopy, recheckCartItem, registryViewState, rootAuctionPolicy, shouldHoldTransactions, updatedAge } from "./shared.js?v=e7a77f3f3644";
import { ui } from "./ui-state.js?v=e7a77f3f3644";
import { el, endpointBase, json, staticURL } from "./ui-core.js?v=e7a77f3f3644";
import { persistCart, renderCart, updateHandoffAge, updateCartCopyState, updatePromptText } from "./ui-cart.js?v=e7a77f3f3644";
import { render } from "./ui-render.js?v=e7a77f3f3644";
import { runSearch } from "./ui-search.js?v=e7a77f3f3644";
import { renderIdeas } from "./ui-ideas.js?v=e7a77f3f3644";
import { mountEscrow } from "./escrow.js?v=e7a77f3f3644";
import { applyRoute, navigateHome, setSectionTab } from "./ui-router.js?v=e7a77f3f3644";

export function updateFreshness() {
    updateHandoffAge();
    const text = updatedAge(ui.lastLoadedAt);
    for (const node of document.querySelectorAll(".tab-age"))
        node.textContent = text;
    el("registryAge").textContent = "Registry data " + text + " · My POA refreshes separately.";
}

export function pageStatus(error = "", loading = false) {
    el("registryError").hidden = !error;
    el("registryErrorText").textContent = error;
    el("registryLoading").hidden = !loading || !!ui.latestState;
    document.body.dataset.registryStatus = error ? "error" : loading ? "loading" : "ready";
    el("refresh").disabled = loading;
    el("registryRetry").disabled = loading;
    updateCartCopyState();
}

// Capture immediately before synchronous redraw, so typing during the fetch is kept too.
export function preserveInputs(draw) {
    const fields = () => [...document.querySelectorAll("input, textarea, select")].filter(n => !n.closest("#escrowSection, #escrowDomain"));
    const key = n => n.id || n.dataset.fieldKey || n.getAttribute("aria-label");
    const active = document.activeElement;
    const saved = fields().filter(key).map(n => ({ key: key(n), value: n.value, checked: n.checked, focus: n === active, start: n.selectionStart, end: n.selectionEnd }));
    draw();
    const current = new Map(fields().map(n => [key(n), n]));
    for (const old of saved) {
        const n = current.get(old.key);
        if (!n)
            continue;
        n.value = old.value;
        if (typeof old.checked === "boolean")
            n.checked = old.checked;
        if (old.focus) {
            if (!active.isConnected)
                n.focus({ preventScroll: true });
            if (old.start !== null && old.start !== undefined && n.setSelectionRange)
                n.setSelectionRange(old.start, old.end);
        }
    }
}

export async function refreshRegistry() {
    if (ui.refreshing || !ui.readState)
        return;
    ui.refreshing = true;
    pageStatus("", true);
    try {
        const payload = await ui.readState();
        const viewState = registryViewState(payload);
        ui.registryReadFailed = false;
        ui.lastLoadedAt = Date.now();
        preserveInputs(() => {
            ui.cart = ui.cart.map(item => recheckCartItem(item, ui.cap, viewState));
            persistCart();
            render(payload);
            renderCart();
            runSearch(ui.lastSearch, false);
            if (!el("ideasStrip").children.length)
                renderIdeas();
        });
        updateFreshness();
        pageStatus();
    }
    catch {
        ui.registryReadFailed = true;
        pageStatus("⚠️ Could not update registry data. Your last view is kept. Tap Refresh to try again; cart copying is paused.");
        updatePromptText();
    }
    finally {
        ui.refreshing = false;
        el("refresh").disabled = false;
        el("registryRetry").disabled = false;
        updateCartCopyState();
        updatePromptText();
    }
}

export async function refreshNetworkStatus() {
    try {
        const response = await fetch(endpointBase() + "/v1/network-status", {
            method: "GET",
            credentials: "omit",
            cache: "no-store",
        });
        if (!response.ok)
            throw Error("status");
        const body = await response.json();
        if (!body || typeof body.level !== "string")
            throw Error("shape");
        ui.networkStatus = body;
    }
    catch {
        // Conservative: one client miss does not flip to Down; Worker owns the 2-failure rule.
        if (!ui.networkStatus || ui.networkStatus.level === "checking") {
            ui.networkStatus = {
                level: "checking",
                hold: false,
                message: "⚪ Checking PoA network…",
            };
        }
    }
    renderNetworkStatus();
    applyNetworkHold();
}

export function renderNetworkStatus() {
    const bar = el("networkStatusBar");
    if (!bar)
        return;
    const level = ui.networkStatus.level || "checking";
    const text = ui.networkStatus.message || networkBannerCopy(level);
    bar.dataset.level = level;
    bar.dataset.color = networkBannerColor(level);
    const icon = el("networkStatusIcon");
    const label = el("networkStatusText");
    if (icon)
        icon.textContent = "";
    if (label)
        label.textContent = text;
    const dismissed = isNetworkBannerDismissed(globalThis.sessionStorage, level);
    bar.hidden = !!dismissed;
}

export function applyNetworkHold() {
    const hold = shouldHoldTransactions(ui.networkStatus.level) || !!ui.networkStatus.hold;
    const heldIds = [
        "copyCheckoutBtn",
        "copyCartPrompt",
        "downloadCartJSON",
        "copyListPromptBtn",
        "copyChangePromptBtn",
        "copyUnlistPromptBtn",
        "copy",
    ];
    for (const id of heldIds) {
        const node = el(id);
        if (!node)
            continue;
        if (hold) {
            node.disabled = true;
            node.classList.add("action-held");
            node.title = "Held ⏸️ until the PoA network is back";
        }
        else {
            node.classList.remove("action-held");
            node.removeAttribute("title");
            // Re-enable based on existing cart/copy rules on next renderCart / route.
        }
    }
    // Re-run cart enablement when not held.
    updateCartCopyState();
    let note = el("networkHoldNote");
    if (hold) {
        if (!note) {
            note = document.createElement("p");
            note.id = "networkHoldNote";
            note.className = "hold-note";
            note.setAttribute("role", "status");
            const panel = el("floatingCartPanel");
            if (panel)
                panel.appendChild(note);
        }
        note.textContent = "⏸️ Held until the PoA network is back. Reads still work.";
        note.hidden = false;
    }
    else if (note) {
        note.hidden = true;
    }
    document.querySelectorAll("[data-requires-network]").forEach((node) => {
        if (hold) {
            node.disabled = true;
            node.classList.add("action-held");
        }
        else {
            node.classList.remove("action-held");
        }
    });
}

export async function loadRegistry() {
    if (ui.starting)
        return;
    ui.starting = true;
    pageStatus("", true);
    try {
        const config = await json(new URL("config.json", import.meta.url));
        ui.configMode = config.mode;
        ui.demo = config.mode === "static-synthetic-demo";
        if (ui.demo) {
            if (config.publicApiBase !== null)
                throw Error("Demo has no backend");
            const files = config.files;
            [ui.cap, ui.details, ui.examples] = await Promise.all([
                json(staticURL(files.capabilities)),
                json(staticURL(files.details)),
                json(staticURL(files.examples)),
            ]);
            ui.readState = () => json(staticURL(files.state));
            el("mode").textContent =
                "🧪 SYNTHETIC DEMO · No backend, wallet connection, signing or browser writes. Names, balances and principals are test data, not native PoA ownership or assets; fixture signing keys were discarded.";
            el("example").hidden = false;
            el("exampleNotice").textContent =
                "Synthetic examples only. Do not sign or submit.";
        }
        else {
            if (config.mode !== "local-reference-only" && config.mode !== "live-registry")
                throw Error("Unknown mode");
            el("mode").textContent = ui.configMode === "live-registry" ? "🟢 Hosted registry data · Native naming is not enabled." : "🧪 Local registry data · Not native PoA ownership.";
            if (config.publicApiBase) {
                const u = new URL(config.publicApiBase);
                if (u.username ||
                    u.password ||
                    u.search ||
                    u.hash ||
                    (u.protocol !== "https:" &&
                        !(u.protocol === "http:" && u.hostname === "127.0.0.1")))
                    throw Error("Public endpoint only");
                ui.base = u.origin;
            }
            ui.cap = await json(ui.base + "/v1/capabilities?include=emoji");
            ui.readState = () => json(ui.base + "/v1/state");
        }
        for (const [id, tier, label] of [["premiumPolicy", "premium", "Single emoji"], ["standardPolicy", "standard", "Standard roots"]]) {
            try {
                const policy = rootAuctionPolicy(ui.cap, { tier });
                el(id).textContent = `${label}: ${policy.reserve} POA · ${formatDuration(policy.window)} + ${formatDuration(policy.quiet)} quiet`;
            }
            catch {
                el(id).textContent = "⚠️ Prices unavailable. Refresh to check.";
            }
        }
        for (const item of ui.cart) {
            // Repair old saved carts affected by the amount/maxBid mismatch, without raising any cap.
            try {
                if (!item.params || typeof item.params !== "object")
                    throw Error("⚠️ Remove this invalid saved item and check Find again.");
                if (item.action === "announceAuction+bid")
                    item.params.maxBid = item.amount;
                item.minimumAmount = cartMinimum(item, ui.cap, null);
                if (item.action === "announceAuction+bid")
                    item.params.reserve = item.minimumAmount;
                if (BigInt(item.amount) < BigInt(item.minimumAmount) ||
                    (item.params.reserve && BigInt(item.params.reserve) > BigInt(item.amount)))
                    throw Error("⚠️ Review this cart amount before copying.");
                item.summary = cartSummary(item);
            }
            catch (error) {
                item.validationError = error.message;
            }
        }
        if (ui.cap.livePoA !== false)
            throw Error("Only local reference profile is supported");
        if (typeof ui.cap.reservedCatalog === "string" && ui.cap.reservedCatalog.length) {
            ui.reservedSet = new Set(ui.cap.reservedCatalog.split(",").filter(Boolean));
        }
        el("action").replaceChildren();
        for (const action of Object.keys(ui.cap.actions)) {
            const option = document.createElement("option");
            option.value = action;
            option.textContent = action;
            el("action").append(option);
        }
        el("keys").textContent = JSON.stringify(ui.cap.actions[el("action").value]);
        if (!ui.escrowUI)
            ui.escrowUI = mountEscrow({ base: ui.base, capability: ui.cap.escrow, registryId: ui.cap.registryId,
                section: el("escrowSection"), domain: el("escrowDomain"), selectTab: () => { navigateHome(); setSectionTab("escrow"); } });
        applyRoute();
        renderCart();
        if (!ui.demo && !ui.tickerTimer) {
            ui.tickerTimer = setInterval(refreshRegistry, ui.TICKER_MS);
            refreshNetworkStatus();
            ui.networkTimer = setInterval(refreshNetworkStatus, ui.NETWORK_MS);
        }
        else if (ui.demo)
            renderNetworkStatus();
        await refreshRegistry();
    }
    catch {
        ui.readState = null;
        ui.registryReadFailed = true;
        pageStatus("⚠️ Registry data could not load. Tap Refresh to try again. Nothing was submitted.");
    }
    finally {
        ui.starting = false;
        el("refresh").disabled = false;
        el("registryRetry").disabled = false;
    }
}
