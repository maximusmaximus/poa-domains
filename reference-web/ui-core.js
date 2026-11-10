import { buildOwnershipIndex, ownershipConflict, safeObject } from "./shared.js?v=e7a77f3f3644";
import { ui } from "./ui-state.js?v=e7a77f3f3644";

export const el = (id) => document.getElementById(id);

export async function json(url) {
    const response = await fetch(url, {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
    });
    if (!response.ok)
        throw Error("Read failed");
    const result = await response.json();
    safeObject(result);
    return result;
}

export function staticURL(path) {
    if (typeof path !== "string" || !/^\.\/demo\/[a-z-]+\.json$/.test(path))
        throw Error("Static path");
    const url = new URL(path, location.href), root = new URL("./", location.href);
    if (url.origin !== location.origin ||
        !url.pathname.startsWith(root.pathname) ||
        url.search ||
        url.hash)
        throw Error("Static origin");
    return url.href;
}

export function add(parent, tag, text, css) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (css)
        node.className = css;
    parent.append(node);
    return node;
}

export function person(id) {
    const role = Object.keys(ui.details.roles ?? {}).find((x) => ui.details.roles[x] === id);
    return role ? "Demo " + role : id.slice(0, 18) + "…";
}

export function endpointBase() {
    return ui.demo ? "http://127.0.0.1:8787" : ui.base || location.origin;
}

/* ---------- 💡 Name ideas (3-row masonry strip) ---------- */
export function ownershipView() {
    const index = buildOwnershipIndex(ui.cap?.emojiOwnership);
    return index ? { manifest: ui.cap.emojiManifest, index } : null;
}

export function variantOwner(name) {
    const o = ownershipView();
    return o ? ownershipConflict(ui.latestState, name, o.manifest, o.index) : null;
}

export function statusLabel(status) {
    const map = {
        available: "🟢 Available",
        reserved: "🔒 Reserved",
        owned: "♾️ Owned forever",
        listed: "💰 For sale (resale)",
        // Legacy lease records only; new leases and renewals are off.
        leased: "📜 Legacy lease record",
        "listed-lease": "📜 Legacy lease record",
        "lease-grace": "📜 Legacy lease record",
        "lease-expired": "📜 Legacy lease record",
        "variant-taken": "🔒 Taken (same emoji)",
        "auction-current": "🏷️ Auction open",
        "auction-upcoming": "🗓️ Auction upcoming",
        "auction-past": "📜 Auction ended",
        "child-offer": "🟢 Child offer open",
        "unminted-child": "⚪ Child not minted",
        unknown: "❓ Unknown",
    };
    return map[status] || status;
}
