// One controller per strip. Fractional position is retained: slow motion must not round to zero each frame.
const controllers = new WeakMap();
export function autoScroll(node, { speed = 20, advance, onScrollSettle } = {}) {
  if (!node) return;
  const prior = controllers.get(node);
  if (prior) {
    prior.speed = speed;
    prior.advance = advance;
    prior.onScrollSettle = onScrollSettle;
    return prior;
  }
  const media = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  let hovered = false,
    touching = false,
    until = 0,
    settleTimer = null,
    last = performance.now(),
    position = node.scrollLeft,
    expectedScroll = node.scrollLeft;
  const state = {
    speed,
    advance,
    onScrollSettle,
    paused: () =>
      hovered ||
      touching ||
      node.contains(document.activeElement) ||
      performance.now() < until ||
      !!media?.matches ||
      document.hidden,
    reset(next = 0) {
      const target = typeof next === "number" && Number.isFinite(next) ? Math.max(0, next) : 0;
      position = expectedScroll = node.scrollLeft = target;
    },
  };
  const pause = () => {
    until = performance.now() + 1800;
    position = expectedScroll = node.scrollLeft;
  };
  const scheduleSettle = () => {
    clearTimeout(settleTimer);
    if (!state.onScrollSettle) return;
    settleTimer = setTimeout(() => {
      if (!node.isConnected || touching) return;
      const next = state.onScrollSettle(node, node.scrollLeft);
      if (typeof next === "number" && Number.isFinite(next)) {
        if (Math.abs(next - node.scrollLeft) > 0.5) node.scrollLeft = next;
        position = expectedScroll = node.scrollLeft;
      }
    }, 140);
  };
  node.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "touch") hovered = true;
  });
  node.addEventListener("pointerleave", () => {
    hovered = false;
    pause();
  });
  node.addEventListener("touchstart", () => {
    touching = true;
    clearTimeout(settleTimer);
    pause();
  }, { passive: true });
  node.addEventListener("touchmove", () => {
    touching = true;
    pause();
  }, { passive: true });
  for (const type of ["touchend", "touchcancel"]) {
    node.addEventListener(type, () => {
      touching = false;
      pause();
      scheduleSettle();
    }, { passive: true });
  }
  node.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") touching = true;
    pause();
  }, { passive: true });
  for (const type of ["pointerup", "pointercancel"]) {
    node.addEventListener(type, (e) => {
      if (e.pointerType === "touch") touching = false;
      pause();
      scheduleSettle();
    }, { passive: true });
  }
  for (const type of ["wheel", "keydown", "focusout"]) {
    node.addEventListener(type, () => {
      pause();
      if (type === "wheel") scheduleSettle();
    }, { passive: true });
  }
  node.addEventListener("scroll", () => {
    if (Math.abs(node.scrollLeft - expectedScroll) > 2) {
      pause();
      if (!touching) scheduleSettle();
    }
  }, { passive: true });
  const tick = (now) => {
    if (!node.isConnected) {
      clearTimeout(settleTimer);
      controllers.delete(node);
      return;
    }
    const dt = Math.min(64, now - last);
    last = now;
    if (state.paused() || !node.getClientRects().length) {
      position = expectedScroll = node.scrollLeft;
      node.dataset.motion = media?.matches ? "reduced" : "paused";
    } else {
      node.dataset.motion = "running";
      position += (dt * state.speed) / 1000;
      node.scrollLeft = position;
      if (state.advance) position = state.advance(node, position);
      else if (node.scrollWidth > node.clientWidth && position >= node.scrollWidth - node.clientWidth)
        position = node.scrollLeft = 0;
      expectedScroll = node.scrollLeft;
    }
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
  controllers.set(node, state);
  return state;
}
