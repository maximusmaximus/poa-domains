import { publicNameUnavailable } from "./shared.js?v=d434aec15419";
import { createInlineInfo, installHelp } from "./ui-help.js?v=d434aec15419";
import { renderManagement } from "./ui-manage.js?v=d434aec15419";
import { actionLabel } from "./ui-copy.js?v=d434aec15419";
import { poaOnlyMode, poaNewNamePrice, poaAmount, poaToMicros, poaShort, cartMinimum, cartSummary, formatCountdown, formatDuration, isNetworkBannerDismissed, isPoaAddress, networkBannerColor, networkBannerCopy, recheckCartItem, registryViewState, rootAuctionPolicy, SALE_FIELDS_WARNING, shortenPoaAddress, shouldHoldTransactions, updatedAge } from "./shared.js?v=d434aec15419";
import { ui } from "./ui-state.js?v=d434aec15419";
import { el, endpointBase, enhancePoaAddressesIn, json, staticURL } from "./ui-core.js?v=d434aec15419";
import { createPoaCopyButton } from "./ui-copy.js?v=d434aec15419";
import { persistCart, renderCart, renderCartEscrowStatus, updateHandoffAge, updateCartCopyState, updatePromptText } from "./ui-cart.js?v=d434aec15419";
import { render, renderAuctions, renderMarketplace, renderTicker, updateLiveAuctionsBadge, updateTabDots } from "./ui-render.js?v=d434aec15419";
import { renderDomainPage } from "./ui-domain.js?v=d434aec15419";
import { runSearch, updateSearchSuggestions } from "./ui-search.js?v=d434aec15419";
import { renderIdeas } from "./ui-ideas.js?v=d434aec15419";
import { mountEscrow } from "./escrow.js?v=d434aec15419";
import { applyRoute, createDomainAvatar, isRegisteredDomain, nameLink, navigateHome, setSectionTab, syncEscrowPayerAddress } from "./ui-router.js?v=d434aec15419";

export function updateFreshness() {
    updateHandoffAge();
    const text = updatedAge(ui.lastLoadedAt);
    for (const node of document.querySelectorAll(".tab-age"))
        node.textContent = text;
    el("registryAge").textContent = "Registry data " + text + " · POA payments refresh separately.";
    const nowMs = Date.now();
    for (const cd of document.querySelectorAll(".auction-countdown[data-closes-ms]")) {
        const closes = Number(cd.dataset.closesMs);
        if (Number.isFinite(closes) && closes > 0)
            cd.textContent = `⏳ ${formatCountdown(closes - nowMs)}`;
    }
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
    lead2.id = "escrowPromptMeta";
    lead2.className = "muted escrow-step-lead";
    lead2.textContent = "Choose an action above to preview the code generated for your agent, then copy or download it below.";
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

    const payerInput = root.querySelector("#escrowPayer");
    const nameInput = root.querySelector("#escrowName");
    const amountInput = root.querySelector("#escrowAmount");
    const step1Buttons = actionRow ? [...actionRow.querySelectorAll("button")] : [];
    const buttonActionName = (btn) => {
        const label = btn?.textContent ?? "";
        if (/Open my POA auction/.test(label)) return "open";
        if (/List my name for POA/.test(label)) return "list";
        if (/Add POA/.test(label)) return "intent";
        if (/Read my escrow/.test(label)) return "view";
        if (/Request my refund/.test(label)) return "withdraw";
        return "";
    };
    let lastActionBtn = null;
    let lastActionName = "";
    let liveRegenTimer = null;
    let regenerating = false;

    const clearSelectedAction = () => {
        clearTimeout(liveRegenTimer);
        lastActionBtn = null;
        lastActionName = "";
        delete root.dataset.selectedAction;
        for (const b of step1Buttons) b.classList.remove("is-selected-action");
    };

    const extractEscrowCommand = () => {
        const text = prompt.textContent ?? "";
        const match = text.match(/\n(\{[\s\S]*?\})\nSubmit/);
        if (!match) return null;
        try { return JSON.parse(match[1]); } catch { return null; }
    };

    prompt.classList.add("prompt-box");
    const promptActions = document.createElement("div");
    promptActions.id = "escrowPromptActions";
    promptActions.className = "button-row";
    if (copyBtn) {
        copyBtn.className = "small";
        promptActions.append(copyBtn);
    }
    const downloadEscrowBtn = document.createElement("button");
    downloadEscrowBtn.id = "downloadEscrowJSON";
    downloadEscrowBtn.type = "button";
    downloadEscrowBtn.className = "secondary small";
    downloadEscrowBtn.textContent = "📥 Download JSON";
    downloadEscrowBtn.disabled = true;
    const clearEscrowBtn = document.createElement("button");
    clearEscrowBtn.id = "clearEscrowPrompt";
    clearEscrowBtn.type = "button";
    clearEscrowBtn.className = "secondary small";
    clearEscrowBtn.textContent = "🗑️ Clear";
    clearEscrowBtn.disabled = true;
    promptActions.append(downloadEscrowBtn, clearEscrowBtn);

    const syncEscrowPromptUi = () => {
        const text = (prompt.textContent ?? "").trim();
        const cmd = extractEscrowCommand();
        if (copyBtn) copyBtn.disabled = !text;
        downloadEscrowBtn.disabled = !cmd;
        clearEscrowBtn.disabled = !text;
        if (!text) {
            lead2.textContent = "Choose an action above to preview the code generated for your agent, then copy or download it below.";
            return;
        }
        if (cmd?.action) {
            const target = cmd.params?.name ? ` for "${cmd.params.name}"` : "";
            const amt = cmd.params?.reserve || cmd.params?.price || cmd.params?.amount;
            const amtLabel = typeof amt === "string" ? ` (${poaShort(amt)} POA)` : "";
            const actName = {
                open: "Open POA auction",
                list: "List name for POA",
                intent: "Add POA deposit intent",
                view: "Read escrow account",
                withdraw: "Request POA refund",
                detect: "Check deposit",
                buy: "Buy with credited POA",
                bid: "Bid with credited POA",
            }[cmd.action] || cmd.action;
            lead2.textContent = `Live preview · ${actName}${target}${amtLabel}`;
        } else {
            lead2.textContent = "Generated instructions for your agent — review before approving.";
        }
    };

    downloadEscrowBtn.addEventListener("click", () => {
        const cmd = extractEscrowCommand();
        if (!cmd) return;
        const blob = new Blob([JSON.stringify({ command: cmd }, null, 2) + "\n"], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `poa-domains-escrow-${cmd.action || "command"}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (message) message.textContent = "📥 JSON downloaded — unsigned, nothing submitted.";
    });

    clearEscrowBtn.addEventListener("click", () => {
        clearSelectedAction();
        prompt.textContent = "";
        if (message) message.textContent = "";
        syncEscrowPromptUi();
    });

    const canAutoRegenerate = (btn) => {
        if (!btn || btn.disabled || !lastActionName) return false;
        const cmd = extractEscrowCommand();
        if (!cmd || cmd.action !== lastActionName) return false;
        const payerVal = payerInput?.value.trim() ?? "";
        if (!isPoaAddress(payerVal)) return false;
        const nameVal = nameInput?.value.trim() ?? "";
        if (lastActionName === "view") {
            return cmd.actor !== payerVal;
        }
        let exactAmt;
        try { exactAmt = poaAmount(amountInput?.value.trim() ?? ""); } catch { return false; }
        if (lastActionName === "list") {
            return Boolean(nameVal) && (cmd.actor !== payerVal || cmd.params?.name !== nameVal || cmd.params?.price !== exactAmt);
        }
        if (lastActionName === "open") {
            return Boolean(nameVal) && (cmd.actor !== payerVal || cmd.params?.name !== nameVal || cmd.params?.reserve !== exactAmt);
        }
        return cmd.actor !== payerVal || cmd.params?.amount !== exactAmt;
    };

    const scheduleLiveRegen = () => {
        if (regenerating || !lastActionBtn || signed.value.trim() || !canAutoRegenerate(lastActionBtn)) return;
        clearTimeout(liveRegenTimer);
        liveRegenTimer = setTimeout(() => {
            if (regenerating || !lastActionBtn || signed.value.trim() || !canAutoRegenerate(lastActionBtn)) return;
            regenerating = true;
            try { lastActionBtn.click(); } finally { regenerating = false; }
        }, 120);
    };

    for (const input of [payerInput, nameInput, amountInput]) {
        input?.addEventListener("input", scheduleLiveRegen);
    }
    signed.addEventListener("input", () => clearTimeout(liveRegenTimer));
    root.addEventListener("click", (ev) => {
        const clickedBtn = ev.target?.closest?.("button");
        if (!clickedBtn) return;
        clearTimeout(liveRegenTimer);
        if (!step1Buttons.includes(clickedBtn) && !promptActions.contains(clickedBtn)) {
            clearSelectedAction();
        }
    }, true);

    step1.append(grid);
    if (limits)
        step1.append(limits);
    if (actionRow) {
        step1.append(actionRow);
        const balanceNote = document.createElement("p");
        balanceNote.id = "escrowBalanceNote";
        balanceNote.className = "escrow-balance-note";
        balanceNote.setAttribute("role", "note");
        balanceNote.textContent =
            "💡 Held balance & withdrawals: Deposited POA and outbid auction funds return immediately to your available escrow balance so you can re-bid right away — tap ↩️ Request my refund anytime to withdraw back to your original wallet (up to the per-tx limit per request; funds locked in an active leading bid unlock if outbid, cancelled, or expired).";
        step1.append(balanceNote);
        const sellWarning = document.createElement("p");
        sellWarning.id = "escrowListingFieldWarning";
        sellWarning.className = "sale-fields-warning";
        sellWarning.setAttribute("role", "note");
        sellWarning.textContent = SALE_FIELDS_WARNING;
        step1.append(sellWarning);
        for (const btn of step1Buttons) {
            const label = btn.textContent ?? "";
            btn.addEventListener("click", () => {
                clearTimeout(liveRegenTimer);
                lastActionBtn = btn;
                lastActionName = buttonActionName(btn);
                for (const other of step1Buttons) other.classList.toggle("is-selected-action", other === btn);
                if (/List my name for POA|Open my POA auction/.test(label)) {
                    const txt = prompt.textContent ?? "";
                    if (/"action":\s*"(?:list|open)"/.test(txt) && !txt.includes("Sale & auction notice")) {
                        prompt.textContent = txt.trimEnd() + "\n" + SALE_FIELDS_WARNING;
                        if (message && !message.textContent.includes("paused while listed")) {
                            message.textContent =
                                (message.textContent ? message.textContent + " " : "") +
                                "⚠️ Attached domain fields & profile are paused while listed and dropped on transfer.";
                        }
                    }
                }
                syncEscrowPromptUi();
            });
        }
    }

    if (message)
        step2.append(message);
    step2.append(prompt, promptActions);

    step3.append(fieldHead, signedLabel, submit);

    if (deposit) {
        content.insertBefore(step1, deposit);
        content.insertBefore(step2, deposit);
        content.insertBefore(step3, deposit);
    } else {
        content.append(step1, step2, step3);
    }
    if (typeof MutationObserver !== "undefined") {
        new MutationObserver(syncEscrowPromptUi).observe(prompt, { childList: true, characterData: true, subtree: true });
    }
    syncEscrowPromptUi();
    syncEscrowPayerAddress();
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
            const domainHeaders = root.id === "escrowDomain"
                ? root.querySelectorAll("article.card > h3")
                : root.querySelectorAll("#escrowMarket article.card > h3");
            for (const h3 of domainHeaders) {
                if (h3.dataset.avatarDecorated === "1") continue;
                const domainName = h3.textContent?.trim();
                if (!domainName) continue;
                h3.dataset.avatarDecorated = "1";
                h3.classList.add("domain-heading");
                h3.prepend(createDomainAvatar(domainName, { size: "sm" }));
            }
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

async function fetchEscrowMarketData() {
    if (ui.demo || !ui.cap || !ui.cap.escrow?.enabled)
        return false;
    try {
        const response = await fetch(endpointBase() + "/v1/escrow/market", {
            method: "GET",
            credentials: "omit",
            cache: "no-store",
            signal: globalThis.AbortSignal?.timeout ? AbortSignal.timeout(15000) : undefined,
        });
        if (!response.ok)
            return false;
        const body = await response.json();
        if (!body || !Array.isArray(body.items))
            return false;
        ui.escrowMarket = body.items;
        ui.escrowMarketServerTime = Number.isSafeInteger(body.serverTime) ? body.serverTime : Date.now();
        return true;
    }
    catch {
        return false;
    }
}

export async function refreshRegistry() {
    if (ui.refreshing || !ui.readState)
        return;
    ui.refreshing = true;
    pageStatus("", true);
    try {
        const [payload] = await Promise.all([ui.readState(), fetchEscrowMarketData()]);
        const viewState = registryViewState(payload);
        ui.registryReadFailed = false;
        ui.lastLoadedAt = Date.now();
        preserveInputs(() => {
            ui.cart = ui.cart.map(item => recheckCartItem(item, ui.cap, viewState, ui.escrowMarket, ui.bidderAddress, ui.escrowMarketServerTime || Date.now()));
            persistCart();
            render(payload);
            renderTreasuryFooter();
            renderCart();
            runSearch(ui.lastSearch, false);
            if (!el("searchSuggestions")?.hidden)
                updateSearchSuggestions();
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

export async function refreshEscrowMarket() {
    if (!(await fetchEscrowMarketData()))
        return;
    if (ui.latestState) {
        preserveInputs(() => {
            ui.cart = ui.cart.map((item) =>
                recheckCartItem(item, ui.cap, ui.latestState, ui.escrowMarket, ui.bidderAddress, ui.escrowMarketServerTime),
            );
            persistCart();
            renderAuctions(ui.latestState);
            renderMarketplace(ui.latestState);
            renderTicker(ui.latestState);
            updateLiveAuctionsBadge(ui.latestState);
            renderCart();
            if (ui.lastSearch)
                runSearch(ui.lastSearch, false);
            if (!el("searchSuggestions")?.hidden)
                updateSearchSuggestions();
            renderManagement();
            if (ui.route.kind === "domain" && ui.currentDomainName)
                renderDomainPage(ui.currentDomainName);
        });
    } else {
        updateLiveAuctionsBadge(null);
    }
}

export function renderTreasuryFooter() {
    const totalEl = el("treasuryTotal");
    const walletsEl = el("treasuryWallets");
    if (!totalEl || !walletsEl)
        return;
    const data = ui.treasury;
    if (!data) {
        totalEl.textContent = "—";
        walletsEl.hidden = true;
        walletsEl.replaceChildren();
        return;
    }
    if (typeof data.total === "string" && /^[0-9]+\.[0-9]{6}$/.test(data.total)) {
        totalEl.textContent = `🪙 ${poaShort(data.total)} POA${data.stale ? " · 🕰️" : ""}`;
    } else {
        totalEl.textContent = "—";
    }
    const entries = [
        ["escrow", "Escrow", data.escrow],
        ["treasury", "Treasury", data.treasury],
    ].filter(([, , w]) => w && isPoaAddress(w.address) && typeof w.poascanUrl === "string" && w.poascanUrl.startsWith("https://poascan.io/"));
    walletsEl.replaceChildren();
    if (!entries.length) {
        walletsEl.hidden = true;
        return;
    }
    for (const [domainName, label, wallet] of entries) {
        const item = document.createElement("span");
        item.className = "treasury-item";
        if (isRegisteredDomain(domainName)) {
            nameLink(item, domainName);
        } else {
            const tag = document.createElement("span");
            tag.className = "muted";
            tag.textContent = `${label}: `;
            item.append(tag);
        }
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
        item.append(wrap);
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

let treasuryAbort = null;
if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("pagehide", () => {
        treasuryAbort?.abort();
        treasuryAbort = null;
    });
}

export async function refreshTreasury() {
    if (ui.demo)
        return;
    treasuryAbort?.abort();
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    treasuryAbort = ctrl;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
    try {
        const response = await fetch(endpointBase() + "/v1/treasury", {
            method: "GET",
            credentials: "omit",
            cache: "no-store",
            signal: ctrl?.signal,
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
    finally {
        if (timer)
            clearTimeout(timer);
        if (treasuryAbort === ctrl)
            treasuryAbort = null;
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
        "poaAuctionBtn",
        "poaSubnameBtn",
        "copyCheckoutBtn",
        "copyCartPrompt",
        "downloadCartJSON",
        "floatingDownloadCartJSON",
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
            void refreshTreasury();
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
        ui.cart=ui.cart.filter(item=>poaOnlyMode(ui.cap)?(item.action==="poaCheckout"||item.action==="poaBid"):(item.action!=="poaCheckout"&&item.action!=="poaBid"));
        for (const item of ui.cart) {
            if (item.action === "poaCheckout") {
                try { item.minimumAmount = cartMinimum(item, ui.cap, null); item.summary = cartSummary(item);
                    if (item.minimumAmount !== item.amount) throw Error("⚠️ The POA price changed. Remove it and add it again."); }
                catch (error) { item.validationError = error.message; }
                continue;
            }
            if (item.action === "poaBid") {
                try {
                    if (!item.params || !/^[0-9a-f]{64}$/.test(item.params.auctionId ?? ""))
                        throw Error("⚠️ Remove this invalid saved auction bid.");
                    item.amount = poaAmount(item.amount);
                    item.minimumAmount = cartMinimum(item, ui.cap, null, ui.escrowMarket);
                    if (poaToMicros(item.amount) < poaToMicros(item.minimumAmount))
                        throw Error(`⚠️ Minimum bid is ${poaShort(item.minimumAmount)} POA.`);
                    item.summary = cartSummary(item);
                } catch (error) { item.validationError = error.message; }
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
        if (!ui.demo && !ui.tickerTimer) {
            ui.tickerTimer = setInterval(refreshRegistry, ui.TICKER_MS);
            refreshNetworkStatus();
            refreshEscrowCaps();
            ui.networkTimer = setInterval(() => { refreshNetworkStatus(); refreshEscrowCaps(); refreshEscrowMarket(); refreshTreasury(); }, ui.NETWORK_MS);
        }
        else if (ui.demo)
            renderNetworkStatus();
        await refreshRegistry();
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
