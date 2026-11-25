import { autoScroll } from "./ui-motion.js?v=7db21850d21a";
import { isPoaAuctionAwaitingFirstBid, poaShort, shapeLiveActions } from "./shared.js?v=7db21850d21a";
import { actionLabel } from "./ui-copy.js?v=7db21850d21a";
export function recentActions(state, escrowMarket = []) {
  const items = shapeLiveActions(state, Number.MAX_SAFE_INTEGER);
  const seen = new Set(items.map((x) => x.id));
  for (const r of Object.values(state?.receipts ?? {})) {
    const id = "receipt:" + (r.intentId ?? r.sequence);
    if (!seen.has(id)) {
      items.push({
        id,
        name: r.result?.name ?? "",
        sequence: r.sequence ?? 0,
        at: r.time ?? 0,
        label: (r.result?.name ? r.result.name + " · " : "") + "Registry action #" + r.sequence + " · " + r.status,
      });
    }
  }
  const escrowItems = [];
  for (const a of Array.isArray(escrowMarket) ? escrowMarket : []) {
    if (!a || a.kind === "fixed" || !a.name) continue;
    // Unbid inventory auctions have NOT started yet — do not announce them on the top scroll bar.
    if (isPoaAuctionAwaitingFirstBid(a)) continue;
    if (a.status === "OPEN" && a.high) {
      const startHist = (a.history ?? []).find((h) => h && h.amount && /first bid|started/i.test(String(h.event ?? ""))) ?? (a.history ?? []).find((h) => h && h.amount);
      const startAt = Number(a.startedAt || startHist?.at || a.createdAt || 0);
      const startAmt = startHist?.amount || a.high.amount;
      const latestHist = [...(a.history ?? [])].reverse().find((h) => h && h.amount);
      const latestAt = Number(latestHist?.at || startAt);
      if (latestHist && startAmt !== a.high.amount) {
        escrowItems.push({
          id: `escrow-bid:${a.id}:${a.high.amount}`,
          kind: "escrow-bid",
          name: a.name,
          sequence: Number.MAX_SAFE_INTEGER,
          at: latestAt,
          label: `🏷️ High bid · ${a.name} · ${poaShort(a.high.amount)} POA`,
        });
      }
      escrowItems.push({
        id: `escrow-started:${a.id}`,
        kind: "escrow-auction-started",
        name: a.name,
        sequence: Number.MAX_SAFE_INTEGER,
        at: startAt,
        label: `🔥 Auction started · ${a.name} · ${poaShort(startAmt)} POA`,
      });
    } else if (a.status === "COMPLETE" && a.high) {
      const doneAt = Number(a.history?.at(-1)?.at || a.closes || a.createdAt || 0);
      escrowItems.push({
        id: `escrow-complete:${a.id}`,
        kind: "escrow-auction-complete",
        name: a.name,
        sequence: Number.MAX_SAFE_INTEGER,
        at: doneAt,
        label: `✅ Auction won · ${a.name} · ${poaShort(a.high.amount)} POA`,
      });
    }
  }
  escrowItems.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  items.sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0));
  return [...escrowItems, ...items];
}
let signature = "";
export function drawTicker(state, escrowMarket = []) {
  const strip = document.getElementById("liveTicker"),
    track = document.getElementById("liveTickerTrack"),
    items = recentActions(state, escrowMarket),
    key = JSON.stringify(items);
  if (!strip || !track || key === signature || track.contains(document.activeElement)) return;
  signature = key;
  track.replaceChildren();
  document.getElementById("recentActions").classList.toggle("is-empty", !items.length);
  if (!items.length) {
    const empty = document.createElement("span");
    empty.className = "ticker-empty muted";
    empty.textContent = "No recent registry actions";
    track.append(empty);
    return;
  }
  for (const item of items) {
    const chip = document.createElement(item.name ? "a" : "span");
    chip.className = item.kind?.startsWith("escrow-") ? "ticker-chip ticker-chip-auction" : "ticker-chip";
    chip.dataset.actionId = item.id;
    const label = String(item.label).replace(/settled/g, "recorded").replace(/ · live · /g, " · registry auction · ");
    if (item.name) {
      chip.href = "/d/" + encodeURIComponent(item.name);
      const at = label.indexOf(item.name);
      chip.append(document.createTextNode(at < 0 ? "" : label.slice(0, at)));
      const name = document.createElement("span");
      const activeId = state?.names?.[item.name]?.activeId;
      const isReg = Boolean(activeId && state?.deeds?.[activeId] && !state.deeds[activeId].retired);
      name.className = isReg ? "domain-name domain-tile-inline is-registered" : "domain-name";
      name.textContent = item.name;
      chip.append(name, document.createTextNode(at < 0 ? " · " + label : label.slice(at + item.name.length)));
    } else chip.textContent = label;
    track.append(chip);
  }
  autoScroll(strip, { speed: 18 });
}
