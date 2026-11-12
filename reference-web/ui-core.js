import { decorateEmojiButton } from "./ui-copy.js?v=1178313f1e36";
import { buildOwnershipIndex, ownershipConflict, safeObject } from "./shared.js?v=1178313f1e36";
import { ui } from "./ui-state.js?v=1178313f1e36";

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
    if (tag === "button") decorateEmojiButton(node);
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

/** Link known names in human prose only; machine JSON remains inert and unchanged. */
export function namedText(node, text, names = Object.keys(ui.latestState?.names ?? {})) {
    let rest = String(text ?? "");
    const list = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length);
    // A short name must not become a link inside another word, child name, or emoji name.
    const tail = /[\p{L}\p{N}\p{M}_\-\u200d\p{Extended_Pictographic}\p{Regional_Indicator}]$/u;
    const head = /^[\p{L}\p{N}\p{M}_\-\u200d\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
    while (rest) {
        let at = -1, match = "";
        for (const name of list) {
            let i = rest.indexOf(name);
            while (i >= 0) {
                const before = rest.slice(0, i), after = rest.slice(i + name.length);
                const left = tail.test(before) || (before.endsWith(".") && tail.test(before.slice(0, -1)));
                const right = head.test(after) || (after.startsWith(".") && head.test(after.slice(1)));
                if (!left && !right) { if (at < 0 || i < at) { at = i; match = name; } break; }
                i = rest.indexOf(name, i + name.length);
            }
        }
        if (at < 0) { node.append(rest); break; }
        node.append(rest.slice(0, at));
        const a = document.createElement("a");
        a.className = "domain-name"; a.href = "/d/" + encodeURIComponent(match); a.textContent = match;
        node.append(a); rest = rest.slice(at + match.length);
    }
    return node;
}
