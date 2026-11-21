import { copyText } from "./ui-copy.js?v=4e6b6590ba50";
import { ui } from "./ui-state.js?v=4e6b6590ba50";
import { el, endpointBase, ownershipView } from "./ui-core.js?v=4e6b6590ba50";
import { buildListingPrompt, buildSubnameListingPrompt, resolveDomainView, shouldHoldTransactions } from "./shared.js?v=4e6b6590ba50";

export function clearHandoff() {
    ui.generation++;
    if (el("handoffCopyStatus")) el("handoffCopyStatus").textContent = "";
    ui.copy = "";
    for (const id of ["body", "instructions", "digest"])
        el(id).textContent = "";
    el("copy").disabled = true;
}

export async function copyDomainListingPrompt(kind) {
    if (ui.registryReadFailed) {
        el("listingPromptStatus").textContent = "🔄 Refresh registry data first.";
        return;
    }
    if (shouldHoldTransactions(ui.networkStatus.lastKnown === true ? "checking" : ui.networkStatus.level) || ui.networkStatus.hold) {
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
            el("listingPromptStatus").textContent = "Enter a registry-unit price greater than 0";
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
    const box = el("listingPromptBox");
    box.textContent = text;
    const res = await copyText(text, box);
    el("listingPromptStatus").textContent = res.ok ? "✅ Copied" : "📋 Press Ctrl/Cmd+C to copy from the box.";
}

/** Owner-side POA subname listing: copies an unsigned agent request; nothing submits here. */
export async function copySubnameListing() {
    const box = el("subnamePromptBox"), status = el("subnamePromptStatus");
    let text;
    try { text = buildSubnameListingPrompt({ parent: ui.currentDomainName, price: el("subnamePriceInput").value, endpointUrl: endpointBase() }); }
    catch (error) { status.textContent = error.message; el("subnamePriceInput").setAttribute("aria-invalid", "true"); return; }
    el("subnamePriceInput").removeAttribute("aria-invalid");
    box.textContent = text; box.hidden = false;
    const res = await copyText(text, box);
    status.textContent = res.ok ? "✅ Copied" : "📋 Press Ctrl/Cmd+C to copy from the box.";
}
