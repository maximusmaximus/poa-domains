import { publicNameUnavailable } from "./shared.js?v=9fe77daffcb5";
import { createInlineInfo, installHelp } from "./ui-help.js?v=9fe77daffcb5";
import { renderManagement } from "./ui-manage.js?v=9fe77daffcb5";
import { actionLabel } from "./ui-copy.js?v=9fe77daffcb5";
import { poaOnlyMode, poaNewNamePrice, poaShort, cartMinimum, cartSummary, formatDuration, isNetworkBannerDismissed, isPoaAddress, networkBannerColor, networkBannerCopy, recheckCartItem, registryViewState, rootAuctionPolicy, shortenPoaAddress, shouldHoldTransactions, updatedAge } from "./shared.js?v=9fe77daffcb5";
import { ui } from "./ui-state.js?v=9fe77daffcb5";
import { el, endpointBase, enhancePoaAddressesIn, json, staticURL } from "./ui-core.js?v=9fe77daffcb5";
import { createPoaCopyButton } from "./ui-copy.js?v=9fe77daffcb5";
import { persistCart, renderCart, renderCartEscrowStatus, updateHandoffAge, updateCartCopyState, updatePromptText } from "./ui-cart.js?v=9fe77daffcb5";
import { render, updateTabDots } from "./ui-render.js?v=9fe77daffcb5";
import { runSearch } from "./ui-search.js?v=9fe77daffcb5";
import { renderIdeas } from "./ui-ideas.js?v=9fe77daffcb5";
import { mountEscrow } from "./escrow.js?v=9fe77daffcb5";
import { applyRoute, navigateHome, setSectionTab } from "./ui-router.js?v=9fe77daffcb5";

export function updateFreshness() {
    updateHandoffAge();
    const text = updatedAge(ui.lastLoadedAt);
    for (const node of document.querySelectorAll(".tab-age"))
        node.textContent = text;
    el("registryAge").textContent = "Registry data " + text + " · POA payments refresh separately.";
}

function enhanceEscrowSignedRequestUx(root) {
    if (!root || root.dataset.escrowUxEnhanced === "1")
        return;
    const signed = root.querySelector("#escrowSignedPacket");
    const submit = root.querySelector("#escrowSubmit");
    const prompt = root.querySelector("#escrowPrompt");
    const grid = root.querySelector(".escrow-grid");
    const limits = root.querySelector("#escrowLimits");
    const message = root.querySelector("#escrowMessage");
    const deposit = root.querySelector("#escrowDeposit");
    if (!signed || !submit || !prompt || !grid)
        return;
    const signedLabel = signed.closest("label");
    const content = signedLabel?.parentElement;
    if (!content)
        return;
    const actionRow = grid.parentElement === content ? content.querySelector(":scope > .button-row") : null;
    const copyBtn = prompt.nextElementSibling?.tagName === "BUTTON" ? prompt.nextElementSibling : null;
    root.dataset.escrowUxEnhanced = "1";

    const makeStep = (num, title, infoId, infoLabel, infoText) => {
        const box = document.createElement("div");
        box.className = "escrow-step";
        box.dataset.step = String(num);
        const head = document.createElement("div");
        head.className = "escrow-step-head";
        const h3 = document.createElement("h3");
        h3.textContent = `${num}. ${title}`;
        head.append(h3, createInlineInfo(infoId, infoLabel, infoText));
        box.append(head);
        return box;
    };

    const step1 = makeStep(
        1,
        "Pick an action",
        "escrow-step-1",
        "About Step 1: Pick an action",
        "Enter your public poa1… address (plus a name or exact POA amount when needed), then tap an action button. Nothing is sent or paid yet — this only drafts a prompt for your agent.",
    );
    const step2 = makeStep(
        2,
        "Copy the prompt to your agent",
        "escrow-step-2",
        "About Step 2: Copy prompt to your agent",
        "Paste the drafted prompt to your AI agent or wallet CLI. Your agent verifies the amount, chain, and live escrow hold status, then signs the public command locally in your wallet. Your private key never touches this page.",
    );
    const step3 = makeStep(
        3,
        "Paste & submit your agent's signed JSON",
        "escrow-step-3",
        "About Step 3: Signed JSON response",
        'Only needed if your agent hands back a signed JSON block instead of submitting it directly. It contains two public fields — "command" (what you approved) and "signature" (proof from your wallet). Never paste a private key, seed phrase, or admin token.',
    );

    const lead2 = document.createElement("p");
    lead2.className = "muted escrow-step-lead";
    lead2.textContent = "Choose an action above to generate instructions for your agent, then copy them below.";
    step2.append(lead2);

    const lead3 = document.createElement("p");
    lead3.className = "muted escrow-step-lead";
    lead3.textContent = "Skip this step if your agent submits directly via API/MCP. Otherwise paste the signed JSON it returns:";
    step3.append(lead3);

    const labelTextNode = [...signedLabel.childNodes].find((n) => n.nodeType === 3 && n.nodeValue?.trim());
    if (labelTextNode)
        labelTextNode.nodeValue = "Signed JSON from your agent ";
    signed.placeholder = 'Paste {"command": { ... }, "signature": "..."} returned by your agent';
    submit.textContent = "✅ Submit signed response";

    const fieldHead = document.createElement("div");
    fieldHead.className = "escrow-field-head";
    const fieldHint = document.createElement("span");
    fieldHint.className = "muted";
    fieldHint.textContent = "Public command + signature only — never keys";
    fieldHead.append(
        fieldHint,
        createInlineInfo(
            "escrow-signed-json",
            "About the signed JSON format",
            'Your agent signs the canonical command JSON with Ed25519 and returns {"command":{...},"signature":"<base58>"}. This page submits that public packet to /v1/escrow/* with no credentials or private keys.',
        ),
    );

    step1.append(grid);
    if (limits)
        step1.append(limits);
    if (actionRow)
        step1.append(actionRow);

    if (message)
        step2.append(message);
    step2.append(prompt);
    if (copyBtn)
        step2.append(copyBtn);

    step3.append(fieldHead, signedLabel, submit);

    if (deposit) {
        content.insertBefore(step1, deposit);
        content.insertBefore(step2, deposit);
        content.insertBefore(step3, deposit);
    } else {
        content.append(step1, step2, step3);
    }
}

function observeEscrowAddresses(root) {
    if (!root || typeof MutationObserver === "undefined" || root.dataset.poaAddrObserved === "1")
        return;
    root.dataset.poaAddrObserved = "1";
    let busy = false;
    const onCopy = (res) => {
        const msg = el("escrowMessage");
        if (msg)
            msg.textContent = res.ok ? "Copied ✅" : "Select the text to copy it.";
    };
    const apply = () => {
        if (busy)
            return;
        busy = true;
        try {
            enhancePoaAddressesIn(root, { onCopy });
        }
        finally {
            busy = false;
        }
    };
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    apply();
}

export function pageStatus(error = "", loading = false) {
    el("registryError").hidden = !error;
    el("registryErrorText").textContent = error;
    el("registryLoading").hidden = !loading || !!ui.latestState;
    document.body.dataset.registryStatus = error ? "error" : loading ? "loading" : "ready";
    updateTabDots(ui.latestState);
    el("refresh").disabled = loading;
    el("registryRetry").disabled = loading;
    updateCartCopyState();
    renderNetworkStatus();
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
            renderManagement();
            installHelp();
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
            // Never let one stuck status read keep the window on "Checking" across refreshes.
            signal: globalThis.AbortSignal?.timeout ? AbortSignal.timeout(15000) : undefined,
        });
        if (!response.ok)
            throw Error("status");
        const body = await response.json();
        if (!body || typeof body.level !== "string")
            throw Error("shape");
        ui.networkStatus = body;
        // A last-known value is display-only: recheck soon so the fresh check replaces it.
        if (body.lastKnown === true && (ui.networkRecheck ?? 0) < 3) {
            ui.networkRecheck = (ui.networkRecheck ?? 0) + 1;
            setTimeout(() => { refreshNetworkStatus().then(renderNetworkStatus, () => {}); }, 4000);
        }
        else if (body.lastKnown !== true)
            ui.networkRecheck = 0;
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

export async function refreshEscrowCaps() {
    if (ui.demo || !ui.cap || !poaOnlyMode(ui.cap) || !ui.cap.escrow?.enabled)
        return;
    try {
        const response = await fetch(endpointBase() + "/v1/escrow/capabilities", {
            method: "GET",
            credentials: "omit",
            cache: "no-store",
            signal: globalThis.AbortSignal?.timeout ? AbortSignal.timeout(17000) : undefined,
        });
        if (!response.ok)
            throw Error("escrow-status");
        const body = await response.json();
        if (body && typeof body.enabled === "boolean")
            ui.escrowCaps = body;
    }
    catch {
        if (!ui.escrowCaps)
            ui.escrowCaps = { enabled: true, held: true, holdReason: "Could not check live POA checkout status" };
    }
    renderCartEscrowStatus();
}

export function renderTreasuryFooter() {
    const totalEl = el("treasuryTotal");
    const walletsEl = el("treasuryWallets");
    const scanHome = el("poascanHomeLink");
    if (!totalEl || !walletsEl)
        return;
    const data = ui.treasury;
    if (scanHome && typeof data?.poascanHomeUrl === "string" && data.poascanHomeUrl.startsWith("https://poascan.io/"))
        scanHome.href = data.poascanHomeUrl;
    if (!data) {
        totalEl.textContent = "—";
        walletsEl.hidden = true;
        walletsEl.replaceChildren();
        return;
    }
    if (typeof data.total === "string" && /^[0-9]+\.[0-9]{6}$/.test(data.total)) {
        totalEl.textContent = `🪙 ${poaShort(data.total)} POA${data.stale ? " · 🕰️" : ""}`;
    } else {
        totalEl.textContent = "View on POAScan";
    }
    const entries = [
        ["Escrow", data.escrow],
        ["Treasury", data.treasury],
    ].filter(([, w]) => w && isPoaAddress(w.address) && typeof w.poascanUrl === "string" && w.poascanUrl.startsWith("https://poascan.io/"));
    walletsEl.replaceChildren();
    if (!entries.length) {
        walletsEl.hidden = true;
        return;
    }
    for (const [label, wallet] of entries) {
        const item = document.createElement("span");
        item.className = "treasury-item";
        const tag = document.createElement("span");
        tag.className = "muted";
        tag.textContent = `${label}: `;
        const wrap = document.createElement("span");
        wrap.className = "poa-addr-inline";
        const link = document.createElement("a");
        link.className = "poa-addr-text treasury-addr-link";
        link.href = wallet.poascanUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = shortenPoaAddress(wallet.address);
        link.title = `Inspect ${wallet.address} on POAScan`;
        link.setAttribute("aria-label", `${label} address ${shortenPoaAddress(wallet.address)} on POAScan`);
        wrap.append(link, createPoaCopyButton(wallet.address));
        item.append(tag, wrap);
        if (typeof wallet.balance === "string" && /^[0-9]+\.[0-9]{6}$/.test(wallet.balance)) {
            const bal = document.createElement("span");
            bal.className = "treasury-bal muted";
            bal.textContent = ` (${poaShort(wallet.balance)} POA)`;
            item.append(bal);
        }
        walletsEl.append(item);
    }
    walletsEl.hidden = false;
}

export async function refreshTreasury() {
    if (ui.demo)
        return;
    try {
        const response = await fetch(endpointBase() + "/v1/treasury", {
            method: "GET",
            credentials: "omit",
            cache: "no-store",
            signal: globalThis.AbortSignal?.timeout ? AbortSignal.timeout(10000) : undefined,
        });
        if (!response.ok)
            return;
        const body = await response.json();
        if (body && typeof body === "object") {
            ui.treasury = body;
            renderTreasuryFooter();
        }
    }
    catch {
        /* keep last known treasury snapshot */
    }
}

// Keep critical holds visible in a few words; explanations belong in the window's ℹ️ popover.
function shortNetworkLine(level) {
    return { online: "🟢 PoA network Online", degraded: "🟡 PoA network Slow", down: "🔴 PoA network Down · actions held" }[level] ?? "⚪ Checking PoA network…";
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
    const lastKnown = ui.networkStatus.lastKnown === true, stale = lastKnown && ui.networkStatus.stale === true;
    bar.dataset.stale = stale ? "true" : "false";
    if (label)
        label.textContent = shortNetworkLine(level) + (stale ? " · 🕰️" : "");
    const detail = el("networkStatusDetail");
    if (detail)
        detail.textContent = text + (stale ? ` Last checked ${Math.max(1, Math.round((ui.networkStatus.ageMs || 0) / 60000))} min ago; rechecking now.` : "");
    bar.hidden = !!ui.statusPanelDismissed;
    const serviceError=document.body.dataset.registryStatus==="error",slow=level==="degraded"||document.body.dataset.registryStatus==="loading";
    bar.dataset.color=serviceError?"red":slow?"yellow":bar.dataset.color;
}

export function applyNetworkHold() {
    const hold = shouldHoldTransactions(ui.networkStatus.lastKnown === true ? "checking" : ui.networkStatus.level) || !!ui.networkStatus.hold;
    const heldIds = [
        "poaSellBtn",
        "poaSubnameBtn",
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
            if(node.classList.contains("emoji-control"))node.title=node.getAttribute("aria-label");
            else node.removeAttribute("title");
            // Re-enable based on existing cart/copy rules on next renderCart / route.
        }
    }
    // Re-run cart enablement when not held.
    updateCartCopyState();
    // A down-state refresh clears the unsigned handoff. Rebuild it after recovery, not only on the next poll.
    if(!hold&&ui.cart.length&&!ui.handoffData&&!ui.handoffPending&&!ui.refreshing&&!ui.registryReadFailed)void updatePromptText();
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
        ui.demo = config.mode === "static-synthetic-illustration" || config.mode === "static-synthetic-demo";
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
            el("mode").textContent = ui.configMode === "live-registry" ? "🏠 Hosted registry data. Native naming is not enabled." : "🧪 Local registry data. Not native PoA ownership.";
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
                if (poaOnlyMode(ui.cap)) {
                    el(id).textContent = `${label}: ${poaShort(poaNewNamePrice(ui.cap, { tier }))} POA`;
                    el(id).title = "Price for a new name, paid in POA with POA checkout. Live status is checked before any payment.";
                    continue;
                }
                const policy = rootAuctionPolicy(ui.cap, { tier });
                const poa = ui.cap?.poaNewNamePrices?.[tier];
                const poaLabel = typeof poa === "string" ? poa.replace(/\.0+$/, "") + " POA starting price" : null;
                el(id).textContent = poaLabel
                    ? `${label}: ${poaLabel} · ${formatDuration(policy.window)} + ${formatDuration(policy.quiet)} quiet`
                    : `${label}: ${policy.reserve} registry units · ${formatDuration(policy.window)} + ${formatDuration(policy.quiet)} quiet`;
                el(id).title = "Starting POA checkout price for a new name. Registry-unit auction reserves are unchanged in the stored policy. Read live escrow status before any payment.";
            }
            catch {
                el(id).textContent = "🤷 Prices unavailable. Tap 🔄 Refresh.";
            }
        }
        // Keep stored cart data; omit withheld entries from this public session.
        ui.cart=ui.cart.filter(item=>!publicNameUnavailable(item.name,ui.cap));
        // Production is POA-only: saved registry-unit plans can't be completed there, so they are left out.
        ui.cart=ui.cart.filter(item=>poaOnlyMode(ui.cap)?item.action==="poaCheckout":item.action!=="poaCheckout");
        for (const item of ui.cart) {
            if (item.action === "poaCheckout") {
                try { item.minimumAmount = cartMinimum(item, ui.cap, null); item.summary = cartSummary(item);
                    if (item.minimumAmount !== item.amount) throw Error("⚠️ The POA price changed. Remove it and add it again."); }
                catch (error) { item.validationError = error.message; }
                continue;
            }
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
            option.textContent = actionLabel(action);
            option.disabled = ui.configMode === "live-registry" && (ui.cap.ownership?.disabledActions?.includes(action) ?? false);
            el("action").append(option);
        }
        el("keys").textContent = JSON.stringify(ui.cap.actions[el("action").value]);
        if (!ui.escrowUI) {
            ui.escrowUI = mountEscrow({ base: ui.base, capability: ui.cap.escrow, registryId: ui.cap.registryId,
                section: el("escrowPayments"), domain: el("escrowDomain"), selectTab: () => { navigateHome(); setSectionTab("escrow"); } });
            enhanceEscrowSignedRequestUx(el("escrowPayments"));
            observeEscrowAddresses(el("escrowPayments"));
            observeEscrowAddresses(el("escrowDomain"));
        }
        applyRoute();
        renderCart();
        let startedTimers = false;
        if (!ui.demo && !ui.tickerTimer) {
            startedTimers = true;
            ui.tickerTimer = setInterval(refreshRegistry, ui.TICKER_MS);
            refreshNetworkStatus();
            refreshEscrowCaps();
            ui.networkTimer = setInterval(() => { refreshNetworkStatus(); refreshEscrowCaps(); refreshTreasury(); }, ui.NETWORK_MS);
        }
        else if (ui.demo)
            renderNetworkStatus();
        await refreshRegistry();
        if (startedTimers)
            refreshTreasury();
    }
    catch {
        ui.readState = null;
        ui.registryReadFailed = true;
        pageStatus("📡 Couldn't load registry data. Tap 🔄 Refresh.");
    }
    finally {
        ui.starting = false;
        el("refresh").disabled = false;
        el("registryRetry").disabled = false;
    }
}
