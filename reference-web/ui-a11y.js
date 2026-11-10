// Browser interaction only: no signing, service calls or financial state.
export function bindTabKeys(list, activate) {
  list?.addEventListener("keydown", (event) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')],
      index = tabs.indexOf(event.target);
    if (index < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const next = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    activate(tabs[next]);
    tabs[next].focus();
    tabs[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}
export function returnFocus(target, fallback) {
  for (const node of [target, fallback]) {
    if (
      !node?.isConnected ||
      node.closest("[hidden], [inert]") ||
      !node.getClientRects().length
    )
      continue;
    node.focus();
    if (document.activeElement === node) return;
  }
}
export function trapDialog(panel, backdrop, fallback) {
  const opener = document.activeElement;
  const previous = [...document.body.children]
    .filter((n) => n !== panel && n !== backdrop)
    .map((n) => [n, n.inert]);
  for (const [node] of previous) node.inert = true;
  const focusable = () =>
    [
      ...panel.querySelectorAll(
        "a[href],button,input,select,textarea,[tabindex]",
      ),
    ].filter(
      (n) =>
        n.tabIndex >= 0 &&
        !n.disabled &&
        !n.closest("[hidden], [inert]") &&
        n.getClientRects().length,
    );
  const first = () => (focusable()[0] ?? panel).focus();
  const keydown = (event) => {
    if (event.key !== "Tab") return;
    const nodes = focusable(),
      firstNode = nodes[0],
      lastNode = nodes.at(-1),
      active = document.activeElement;
    if (
      !nodes.length ||
      !panel.contains(active) ||
      (event.shiftKey && active === firstNode) ||
      (!event.shiftKey && active === lastNode)
    ) {
      event.preventDefault();
      (event.shiftKey ? (lastNode ?? panel) : (firstNode ?? panel)).focus();
    }
  };
  const focusin = (event) => {
    if (!panel.contains(event.target)) first();
  };
  document.addEventListener("keydown", keydown);
  document.addEventListener("focusin", focusin);
  first();
  return () => {
    document.removeEventListener("keydown", keydown);
    document.removeEventListener("focusin", focusin);
    for (const [node, inert] of previous) node.inert = inert;
    returnFocus(opener, fallback);
  };
}
