import { bindTabKeys } from "./ui-a11y.js?v=5c150edb6e15";
import { applySiteTitle, closeDetail, renderAuctions } from "./ui-render.js?v=5c150edb6e15";
import { ui } from "./ui-state.js?v=5c150edb6e15";
import { renderAgentCartHandoff, canonical, digest, dismissNetworkBanner, instructions, loadCart, loadTabSeen, makeBody, parsePublicJSON, shouldHoldTransactions } from "./shared.js?v=5c150edb6e15";
import { navigateHome, restoreViewFromURL, setSectionTab } from "./ui-router.js?v=5c150edb6e15";
import { el, endpointBase } from "./ui-core.js?v=5c150edb6e15";
import { clearHandoff, copyDomainListingPrompt } from "./ui-handoff.js?v=5c150edb6e15";
import { loadRegistry, pageStatus, refreshRegistry, renderNetworkStatus, updateFreshness } from "./ui-poll.js?v=5c150edb6e15";
import { runSearch } from "./ui-search.js?v=5c150edb6e15";
import { renderIdeas, toggleIdeasMotion } from "./ui-ideas.js?v=5c150edb6e15";
import { cartCopyBlocked, downloadCartJSON, clearAllCart, setFloatingCartOpen } from "./ui-cart.js?v=5c150edb6e15";

try {
    applySiteTitle();
    ui.cart = loadCart(globalThis.localStorage);
    ui.tabSeen = loadTabSeen(globalThis.localStorage);
    restoreViewFromURL();
    const keys = () => {
        el("keys").textContent = JSON.stringify(ui.cap?.actions?.[el("action").value] ?? {});
    };
    el("action").addEventListener("change", keys);
    el("handoff").addEventListener("input", clearHandoff);
    el("handoff").addEventListener("change", clearHandoff);
    keys();
    for (const id of ["refresh", "registryRetry"])
        el(id).addEventListener("click", () => ui.readState ? refreshRegistry() : loadRegistry());
    bindTabKeys(el("sectionTabs"), tab => tab.click());
    bindTabKeys(document.querySelector(".auction-tabs"), tab => tab.click());
    el("ideasPause")?.addEventListener("click", toggleIdeasMotion);
    for (const btn of document.querySelectorAll(".section-tab")) {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-tab") || "find";
            setSectionTab(id, true);
            btn.scrollIntoView({ block: "nearest", inline: "nearest" });

        });
    }
    el("domainHomeLink")?.addEventListener("click", (event) => {
        event.preventDefault();
        navigateHome();
    });
    el("ownerHomeLink")?.addEventListener("click", (event) => {
        event.preventDefault();
        navigateHome();
    });
    el("copyListPromptBtn")?.addEventListener("click", () => copyDomainListingPrompt("list"));
    el("copyChangePromptBtn")?.addEventListener("click", () => copyDomainListingPrompt("change"));
    el("copyUnlistPromptBtn")?.addEventListener("click", () => copyDomainListingPrompt("unlist"));
    window.addEventListener("popstate", restoreViewFromURL);
    el("searchBtn").addEventListener("click", () => runSearch(el("searchInput").value));
    el("searchInput").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            runSearch(el("searchInput").value);
        }
    });
    el("ideasShuffle")?.addEventListener("click", () => {
        renderIdeas();
        el("ideasStatus").textContent = "🔀 Fresh ideas";
        el("ideasStatus").dataset.tone = "";
        el("ideasStrip").scrollLeft = 0;
    });
    el("clearCart").addEventListener("click", clearAllCart);
    el("downloadCartJSON").addEventListener("click", downloadCartJSON);
    el("copyCartPrompt").addEventListener("click", async () => {
        if (shouldHoldTransactions(ui.networkStatus.level) || ui.networkStatus.hold) {
            el("cartStatus").textContent = "Held ⏸️ until the PoA network is back";
            return;
        }
        const text = renderAgentCartHandoff(ui.handoffData);
        if (!text || !ui.cart.length || cartCopyBlocked() || ui.handoffPending || !ui.handoffData)
            return;
        try {
            await navigator.clipboard.writeText(text);
            el("cartStatus").textContent = "Copied";
        }
        catch {
            el("cartStatus").textContent = "Clipboard unavailable";
        }
    });
    for (const tab of document.querySelectorAll(".auction-tab")) {
        tab.addEventListener("click", () => {
            ui.auctionTab = tab.getAttribute("data-auction-tab") || "current";
            for (const t of document.querySelectorAll(".auction-tab")) {
                const on = t === tab;
                t.classList.toggle("is-active", on);
                t.setAttribute("aria-selected", on ? "true" : "false");
                t.tabIndex = on ? 0 : -1;
            }
            el("auctions").setAttribute("aria-labelledby", tab.id);
            if (ui.latestState)
                renderAuctions(ui.latestState);
        });
    }
    el("detailClose").addEventListener("click", closeDetail);
    el("floatingCartBtn").addEventListener("click", () => setFloatingCartOpen(true));
    el("floatingCartClose").addEventListener("click", () => setFloatingCartOpen(false));
    el("floatingCartBackdrop").addEventListener("click", () => setFloatingCartOpen(false));
    el("floatingCartClear").addEventListener("click", clearAllCart);
    el("copyCheckoutBtn").addEventListener("click", async () => {
        if (shouldHoldTransactions(ui.networkStatus.level) || ui.networkStatus.hold) {
            el("floatingCartStatus").textContent = "Held ⏸️ until the PoA network is back";
            return;
        }
        if (!ui.cart.length || !ui.cap || cartCopyBlocked() || ui.handoffPending || !ui.handoffData)
            return;
        const text = renderAgentCartHandoff(ui.handoffData);
        try {
            await navigator.clipboard.writeText(text);
            el("floatingCartStatus").textContent = "Checkout copied";
        }
        catch {
            el("floatingCartStatus").textContent = "Clipboard unavailable";
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape")
            return;
        if (!el("floatingCartPanel").hidden)
            setFloatingCartOpen(false);
        else if (!el("detailView").hidden)
            closeDetail();
    });
    const dismissBtn = el("networkStatusDismiss");
    if (dismissBtn) {
        dismissBtn.addEventListener("click", () => {
            const level = ui.networkStatus.level || "checking";
            dismissNetworkBanner(globalThis.sessionStorage, level);
            renderNetworkStatus();
        });
    }
    el("example").addEventListener("click", () => {
        const x = ui.examples[el("action").value];
        if (!x)
            return;
        for (const key of [
            "signer",
            "requestId",
            "nonce",
            "notBefore",
            "deadline",
            "maxTotal",
            "maxNetworkFee",
        ])
            el(key).value = String(x[key]);
        el("coSigners").value = JSON.stringify(x.coSigners);
        el("params").value = JSON.stringify(x.params, null, 2);
        el("body").textContent = "";
        el("instructions").textContent = "";
        el("digest").textContent = "";
        clearHandoff();
    });
    el("handoff").addEventListener("submit", async (event) => {
        event.preventDefault();
        el("error").textContent = "";
        clearHandoff();
        const selectedGeneration = ui.generation;
        try {
            const input = {};
            for (const id of [
                "signer",
                "requestId",
                "maxTotal",
                "maxNetworkFee",
                "action",
            ])
                input[id] = el(id).value;
            for (const id of ["nonce", "notBefore", "deadline"]) {
                if (!/^(0|[1-9][0-9]*)$/.test(el(id).value))
                    throw Error("Integer");
                input[id] = Number(el(id).value);
            }
            input.coSigners = parsePublicJSON(el("coSigners").value);
            input.params = parsePublicJSON(el("params").value);
            const body = makeBody(input, ui.cap), id = await digest(body), note = instructions(body, id, ui.configMode);
            if (selectedGeneration !== ui.generation)
                return;
            el("copy").disabled = false;
            el("body").textContent = canonical(body);
            el("digest").textContent = id;
            el("instructions").textContent = note;
            ui.copy = note + "\n" + canonical(body);
        }
        catch {
            el("error").textContent =
                "Invalid public input. Check exact schema, canonical fields, principals, versions, caps and validity. No request was sent.";
        }
    });
    el("copy").addEventListener("click", async () => {
        if (ui.copy && !ui.registryReadFailed && !shouldHoldTransactions(ui.networkStatus.level) && !ui.networkStatus.hold)
            try {
                await navigator.clipboard.writeText(ui.copy);
            }
            catch {
                el("error").textContent =
                    "Clipboard unavailable; copy the inert text manually.";
            }
    });
    setInterval(updateFreshness, 60000);
    await loadRegistry();
}
catch {
    pageStatus("⚠️ Registry data unavailable. Tap Refresh to try again. Nothing was submitted.");
}
