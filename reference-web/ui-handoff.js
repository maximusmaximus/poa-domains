import { ui } from "./ui-state.js?v=5c1f8083f451";
import { el, endpointBase, ownershipView } from "./ui-core.js?v=5c1f8083f451";
import { buildListingPrompt, resolveDomainView, shouldHoldTransactions } from "./shared.js?v=5c1f8083f451";

export function clearHandoff() {
    ui.generation++;
    ui.copy = "";
    for (const id of ["body", "instructions", "digest"])
        el(id).textContent = "";
    el("copy").disabled = true;
}

export function copyDomainListingPrompt(kind) {
    if (ui.registryReadFailed) {
        el("listingPromptStatus").textContent = "⚠️ Refresh registry data before copying.";
        return;
    }
    if (shouldHoldTransactions(ui.networkStatus.level) || ui.networkStatus.hold) {
        el("listingPromptStatus").textContent = "Held ⏸️ until the PoA network is back";
        return;
    }
    if (!ui.latestState || !ui.currentDomainName || !ui.cap)
        return;
    const view = resolveDomainView(ui.latestState, ui.currentDomainName, ui.reservedSet, ownershipView());
    if (!view.deed) {
        el("listingPromptStatus").textContent = "Only the owner can list";
        return;
    }
    const priceRaw = el("listPriceInput").value.trim();
    const hoursRaw = el("listValidHours").value.trim() || "168";
    if (kind !== "unlist") {
        if (!/^(0|[1-9][0-9]{0,38})$/.test(priceRaw) || priceRaw === "0") {
            el("listingPromptStatus").textContent = "Enter a POA price greater than 0";
            return;
        }
    }
    if (kind === "unlist" && !view.listing) {
        el("listingPromptStatus").textContent = "Nothing listed";
        return;
    }
    if (kind === "change" && !view.listing) {
        el("listingPromptStatus").textContent = "List first, then change price";
        return;
    }
    if (!/^[1-9][0-9]{0,5}$/.test(hoursRaw)) {
        el("listingPromptStatus").textContent = "Valid-for hours required";
        return;
    }
    const validUntil = ui.latestState.time + Number(hoursRaw) * 3600;
    const text = buildListingPrompt({
        kind,
        name: ui.currentDomainName,
        deed: view.deed,
        offer: view.listing,
        price: priceRaw,
        validUntil,
        endpointUrl: endpointBase(),
    });
    el("listingPromptBox").textContent = text;
    navigator.clipboard.writeText(text).then(() => {
        el("listingPromptStatus").textContent = "Copied";
    }, () => {
        el("listingPromptStatus").textContent = "Clipboard unavailable — copy from the box";
    });
}
