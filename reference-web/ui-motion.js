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
  const noHoverMedia = globalThis.matchMedia?.("(hover: none)");
  let hovered = false,
    touching = false,
    focusFromTouch = false,
    lastTouchAt = -Infinity,
    until = 0,
    settleTimer = null,
    last = performance.now(),
    position = node.scrollLeft,
    expectedScroll = node.scrollLeft;
  const hasKeyboardFocus = () => node.contains(document.activeElement) && !focusFromTouch;
  const state = {
    speed,
    advance,
    onScrollSettle,
    interacting: () =>
      hovered ||
      touching ||
      hasKeyboardFocus() ||
      performance.now() < until,
    paused: () =>
      state.interacting() ||
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
  const beginTouch = () => {
    touching = true;
    hovered = false;
    focusFromTouch = true;
    lastTouchAt = performance.now();
    clearTimeout(settleTimer);
    pause();
  };
  const endTouch = () => {
    if (!touching) return;
    touching = false;
    hovered = false;
    lastTouchAt = performance.now();
    pause();
    scheduleSettle();
  };
  const onGlobalTouchEnd = (e) => {
    if (e.type === "touchend" && (e.touches?.length ?? 0) > 0) return;
    endTouch();
  };
  const onGlobalPointerEnd = (e) => {
    if (e.pointerType && e.pointerType !== "touch") return;
    endTouch();
  };
  const onGlobalKeyDown = () => {
    focusFromTouch = false;
  };
  const onGlobalReset = () => {
    endTouch();
  };
  node.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse" || performance.now() - lastTouchAt < 1200 || noHoverMedia?.matches) return;
    hovered = true;
  });
  node.addEventListener("pointerleave", (e) => {
    if (hovered) {
      hovered = false;
      pause();
    } else if (e.pointerType === "mouse") {
      hovered = false;
    }
  });
  node.addEventListener("touchstart", beginTouch, { passive: true });
  node.addEventListener("touchmove", beginTouch, { passive: true });
  node.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") beginTouch();
    else pause();
  }, { passive: true });
  for (const type of ["touchend", "touchcancel"]) {
    globalThis.addEventListener?.(type, onGlobalTouchEnd, { passive: true });
  }
  for (const type of ["pointerup", "pointercancel"]) {
    globalThis.addEventListener?.(type, onGlobalPointerEnd, { passive: true });
  }
  globalThis.addEventListener?.("keydown", onGlobalKeyDown, { passive: true });
  globalThis.addEventListener?.("blur", onGlobalReset, { passive: true });
  document.addEventListener?.("visibilitychange", onGlobalReset, { passive: true });
  for (const type of ["wheel", "keydown", "focusout"]) {
    node.addEventListener(type, () => {
      if (type === "focusout" && !node.contains(document.activeElement)) focusFromTouch = false;
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
      for (const type of ["touchend", "touchcancel"]) globalThis.removeEventListener?.(type, onGlobalTouchEnd);
      for (const type of ["pointerup", "pointercancel"]) globalThis.removeEventListener?.(type, onGlobalPointerEnd);
      globalThis.removeEventListener?.("keydown", onGlobalKeyDown);
      globalThis.removeEventListener?.("blur", onGlobalReset);
      document.removeEventListener?.("visibilitychange", onGlobalReset);
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
