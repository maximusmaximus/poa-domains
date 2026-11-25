import { createPoaCopyButton, decorateEmojiButton } from "./ui-copy.js?v=29e98441152b";
import { buildOwnershipIndex, isPoaAddress, ownershipConflict, safeObject, shortenPoaAddress } from "./shared.js?v=29e98441152b";
import { ui } from "./ui-state.js?v=29e98441152b";

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
    if (role)
        return "Demo " + role;
    return isPoaAddress(id) ? shortenPoaAddress(id) : id.slice(0, 18) + "…";
}

export function appendPoaAddress(parent, value, { code = false, ariaLabel, onCopy } = {}) {
    if (!isPoaAddress(value)) {
        if (code)
            add(parent, "code", String(value ?? ""));
        else
            parent.append(String(value ?? ""));
        return parent;
    }
    const wrap = document.createElement("span");
    wrap.className = "poa-addr-inline";
    const text = document.createElement(code ? "code" : "span");
    text.className = "poa-addr-text";
    text.textContent = shortenPoaAddress(value);
    text.title = value;
    wrap.append(text, createPoaCopyButton(value, { ariaLabel, onCopy }));
    parent.append(wrap);
    return wrap;
}

export function appendPrincipal(parent, id, opts = {}) {
    const role = Object.keys(ui.details.roles ?? {}).find((x) => ui.details.roles[x] === id);
    if (role) {
        parent.append("Demo " + role);
        return parent;
    }
    if (isPoaAddress(id))
        return appendPoaAddress(parent, id, opts);
    parent.append(String(id ?? "").slice(0, 18) + "…");
    return parent;
}

const POA_ADDR_IN_TEXT = /\bpoa1[1-9A-HJ-NP-Za-km-z]{20,60}\b/g;
const SKIP_ADDR_TAGS = new Set(["PRE", "INPUT", "TEXTAREA", "BUTTON", "SCRIPT", "STYLE"]);

export function enhancePoaAddressesIn(root, { onCopy } = {}) {
    if (!root || typeof document === "undefined")
        return;
    for (const codeNode of [...root.querySelectorAll("code")]) {
        if (codeNode.closest(".poa-addr-inline, pre, button"))
            continue;
        const raw = codeNode.textContent?.trim() ?? "";
        if (!isPoaAddress(raw))
            continue;
        const wrap = document.createElement("span");
        wrap.className = "poa-addr-inline poa-addr-row";
        codeNode.textContent = shortenPoaAddress(raw);
        codeNode.title = raw;
        codeNode.classList.add("poa-addr-text");
        const next = codeNode.nextElementSibling;
        if (next && next.tagName === "BUTTON" && next.textContent?.trim() === "📋 Copy to")
            next.remove();
        codeNode.replaceWith(wrap);
        wrap.append(codeNode, createPoaCopyButton(raw, { onCopy }));
    }
    const walker = document.createTreeWalker(root, 4);
    const matches = [];
    let textNode;
    while ((textNode = walker.nextNode())) {
        const parent = textNode.parentElement;
        if (!parent || SKIP_ADDR_TAGS.has(parent.tagName) || parent.closest(".poa-addr-inline, pre, button, input, textarea"))
            continue;
        const val = textNode.nodeValue ?? "";
        if (!val.includes("poa1"))
            continue;
        POA_ADDR_IN_TEXT.lastIndex = 0;
        if (POA_ADDR_IN_TEXT.test(val))
            matches.push(textNode);
    }
    for (const node of matches) {
        const val = node.nodeValue ?? "";
        POA_ADDR_IN_TEXT.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0, m;
        while ((m = POA_ADDR_IN_TEXT.exec(val))) {
            if (m.index > last)
                frag.append(val.slice(last, m.index));
            appendPoaAddress(frag, m[0], { onCopy });
            last = m.index + m[0].length;
        }
        if (last < val.length)
            frag.append(val.slice(last));
        node.replaceWith(frag);
    }
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
