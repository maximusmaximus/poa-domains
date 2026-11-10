import { ui } from "./ui-state.js?v=5c150edb6e15";
import { buildIdeas, inspectName, masonryRows } from "./shared.js?v=5c150edb6e15";
import { add, el, variantOwner } from "./ui-core.js?v=5c150edb6e15";
import { runSearch } from "./ui-search.js?v=5c150edb6e15";

export function ideaAccepted(q) {
    if (!ui.cap || !ui.latestState)
        return false;
    const info = inspectName(q, ui.cap.emojiManifest);
    if (!info.isRoot || info.isSingleEmoji)
        return false;
    const name = info.canonical;
    if (ui.reservedSet.has(name))
        return false;
    if (variantOwner(name))
        return false;
    const entry = ui.latestState.names?.[name];
    if (entry?.activeId || entry?.auctionId)
        return false;
    if (Object.values(ui.latestState.auctions ?? {}).some((a) => a.name === name && a.status === "live"))
        return false;
    return true;
}

let ideasPaused = false;
function updateIdeasMotion(){const button=el("ideasPause");if(!button)return;const reduced=globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;button.disabled=!!reduced;button.setAttribute("aria-pressed",String(!ui.ideasAutoScroll));button.textContent=reduced?"⏸️ Ideas paused (reduced motion)":ui.ideasAutoScroll?"⏸️ Pause ideas":"▶️ Play ideas";}
export function toggleIdeasMotion(){if(ui.ideasAutoScroll){ideasPaused=true;stopIdeasAutoScroll();}else{ideasPaused=false;startIdeasAutoScroll();}}
export function stopIdeasAutoScroll() {
    ui.ideasAutoScroll = false;
    updateIdeasMotion();
    if (ui.ideasRaf) {
        cancelAnimationFrame(ui.ideasRaf);
        ui.ideasRaf = 0;
    }
}

export function startIdeasAutoScroll() {
    const strip = el("ideasStrip");
    if (!strip)
        return;
    const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    stopIdeasAutoScroll();
    if (reduce || ideasPaused || strip.contains(document.activeElement)) return;
    ui.ideasAutoScroll = true;
    updateIdeasMotion();
    let last = performance.now();
    const tick = (now) => {
        if (!ui.ideasAutoScroll)
            return;
        const dt = Math.min(48, now - last);
        last = now;
        strip.scrollLeft += (dt / 1000) * 28;
        const max = strip.scrollWidth - strip.clientWidth;
        if (max > 4 && strip.scrollLeft >= max - 1)
            strip.scrollLeft = 0;
        ui.ideasRaf = requestAnimationFrame(tick);
    };
    ui.ideasRaf = requestAnimationFrame(tick);
}

export function wireIdeasScrollStop() {
    const strip = el("ideasStrip");
    if (!strip || strip.dataset.scrollWired)
        return;
    strip.dataset.scrollWired = "1";
    const stop = () => { ideasPaused = true; stopIdeasAutoScroll(); };
    strip.addEventListener("focusin", stop);
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.addEventListener("change",()=>{if(globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches)stop();else updateIdeasMotion();});
    strip.addEventListener("wheel", stop, { passive: true });
    strip.addEventListener("touchstart", stop, { passive: true });
    strip.addEventListener("pointerdown", stop);
}

export function renderIdeas() {
    const strip = el("ideasStrip");
    if (!strip)
        return;
    strip.replaceChildren();
    const ideas = buildIdeas({ count: 24, accept: ideaAccepted });
    const inCart = new Set(ui.cart.map((x) => x.name));
    for (const row of masonryRows(ideas, 3)) {
        const line = add(strip, "div", "", "ideas-row");
        for (const q of row) {
            const btn = add(line, "button", "", "idea");
            btn.type = "button";
            btn.dataset.query = q;
            // varied brick widths for the masonry look
            btn.dataset.size = String(Math.floor(Math.random() * 3));
            add(btn, "span", q, "idea-text");
            const mark = add(btn, "span", "", "idea-mark");
            mark.setAttribute("aria-hidden", "true");
            if (inCart.has(q))
                btn.classList.add("is-added");
            btn.addEventListener("click", () => pickIdea(btn, q));
        }
    }
    wireIdeasScrollStop();
    startIdeasAutoScroll();
}

export function pickIdea(btn, q) {
    el("searchInput").value = q;
    runSearch(q);
    const status = el("ideasStatus");
    const addBtn = el("searchResult").querySelector("#addToCartBtn");
    if (!addBtn) {
        status.textContent = "👀 " + q + " is not open right now. Try another idea.";
        status.dataset.tone = "warn";
        return;
    }
    const already = ui.cart.some((x) => x.name === q);
    addBtn.click();
    btn.classList.add("is-added");
    status.textContent = already
        ? "✅ " + q + " is already in your cart."
        : "🛒 Added " + q + " to your cart. Tap the 🛒 button to check out.";
    status.dataset.tone = "ok";
    const badge = el("floatingCartBtn");
    badge?.classList.remove("bump");
    void badge?.offsetWidth;
    badge?.classList.add("bump");
}
