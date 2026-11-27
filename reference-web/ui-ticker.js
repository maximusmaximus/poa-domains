import { autoScroll } from "./ui-motion.js?v=2ca7cef90cec";
import { isPoaAuctionAwaitingFirstBid, poaShort, shapeLiveActions } from "./shared.js?v=2ca7cef90cec";

export const MAX_RECENT_ACTIONS = 100;

function toActionTimestampMs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

function receiptActionLabel(r, name) {
  const res = r?.result;
  if (r?.status === "succeeded" && res && typeof res === "object") {
    if (typeof res.primaryName === "string" && res.primaryName)
      return `⭐ Main domain · ${res.primaryName}`;
    if (Object.prototype.hasOwnProperty.call(res, "primaryName") && res.primaryName === null)
      return `Main domain cleared · #${r.sequence}`;
    if (res.metadataVersion != null)
      return `🪪 Profile updated · #${r.sequence}`;
    if (res.recordsVersion != null)
      return `🗂️ Records updated · #${r.sequence}`;
  }
  return (name ? name + " · " : "") + "Registry action #" + r.sequence + " · " + r.status;
}

export function recentActions(state, escrowMarket = [], limit = MAX_RECENT_ACTIONS) {
  const receiptById = new Map();
  const seqTime = new Map();
  for (const r of Object.values(state?.receipts ?? {})) {
    const id = "receipt:" + (r.intentId ?? r.sequence);
    receiptById.set(id, r);
    if (r?.sequence != null && Number(r.time) > 0) seqTime.set(r.sequence, Number(r.time));
  }
  const shaped = shapeLiveActions(state, Number.MAX_SAFE_INTEGER);
  const seen = new Set();
  const registryItems = [];
  for (const raw of shaped) {
    seen.add(raw.id);
    const r = receiptById.get(raw.id);
    let item = raw;
    if (r?.status === "succeeded" && typeof r.result?.primaryName === "string" && r.result.primaryName) {
      item = { ...raw, name: r.result.primaryName, label: `⭐ Main domain · ${r.result.primaryName}` };
    }
    const rawAt =
      item.kind === "offer" || item.kind === "offer-active" || item.kind === "auction-upcoming"
        ? (seqTime.get(item.sequence) ?? 0)
        : (item.at || seqTime.get(item.sequence) || 0);
    registryItems.push({ ...item, atMs: toActionTimestampMs(rawAt) });
  }
  for (const [id, r] of receiptById) {
    if (seen.has(id)) continue;
    const name =
      r.result?.name ??
      (typeof r.result?.primaryName === "string" ? r.result.primaryName : "") ??
      (r.result?.deedId && state?.deeds?.[r.result.deedId]?.name) ??
      "";
    const at = r.time ?? 0;
    registryItems.push({
      id,
      name: name || "",
      sequence: r.sequence ?? 0,
      at,
      atMs: toActionTimestampMs(at),
      label: receiptActionLabel(r, name || ""),
    });
  }
  const escrowItems = [];
  for (const a of Array.isArray(escrowMarket) ? escrowMarket : []) {
    if (!a || !a.name) continue;
    if (a.kind === "fixed") {
      if (a.status === "COMPLETE" && a.high) {
        const doneAt = Number(a.history?.at(-1)?.at || a.closes || a.createdAt || 0);
        escrowItems.push({
          id: `escrow-sold:${a.id}`,
          kind: "escrow-sold",
          name: a.name,
          sequence: 0,
          at: doneAt,
          atMs: toActionTimestampMs(doneAt),
          label: `✅ Sold · ${a.name} · ${poaShort(a.high.amount)} POA`,
        });
      } else if (a.status === "OPEN") {
        const listedAt = Number(a.history?.find((h) => h && h.at)?.at || a.createdAt || 0);
        if (listedAt > 0) {
          escrowItems.push({
            id: `escrow-listed:${a.id}`,
            kind: "escrow-listed",
            name: a.name,
            sequence: 0,
            at: listedAt,
            atMs: toActionTimestampMs(listedAt),
            label: `🏷️ Listed · ${a.name} · ${poaShort(a.price)} POA`,
          });
        }
      }
      continue;
    }
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
          sequence: 0,
          at: latestAt,
          atMs: toActionTimestampMs(latestAt),
          label: `🏷️ High bid · ${a.name} · ${poaShort(a.high.amount)} POA`,
        });
      }
      escrowItems.push({
        id: `escrow-started:${a.id}`,
        kind: "escrow-auction-started",
        name: a.name,
        sequence: 0,
        at: startAt,
        atMs: toActionTimestampMs(startAt),
        label: `🔥 Auction started · ${a.name} · ${poaShort(startAmt)} POA`,
      });
    } else if (a.status === "COMPLETE" && a.high) {
      const doneAt = Number(a.history?.at(-1)?.at || a.closes || a.createdAt || 0);
      escrowItems.push({
        id: `escrow-complete:${a.id}`,
        kind: "escrow-auction-complete",
        name: a.name,
        sequence: 0,
        at: doneAt,
        atMs: toActionTimestampMs(doneAt),
        label: `✅ Auction won · ${a.name} · ${poaShort(a.high.amount)} POA`,
      });
    }
  }
  const merged = [...escrowItems, ...registryItems];
  merged.sort(
    (a, b) =>
      (b.atMs - a.atMs) ||
      ((b.sequence ?? 0) - (a.sequence ?? 0)) ||
      String(b.id).localeCompare(String(a.id)),
  );
  const cap = Number.isInteger(limit) && limit > 0 ? limit : MAX_RECENT_ACTIONS;
  return merged.slice(0, cap).map(({ atMs: _atMs, ...rest }) => rest);
}
let signature = "";
let topActionId = "";
export function drawTicker(state, escrowMarket = []) {
  const strip = document.getElementById("liveTicker"),
    track = document.getElementById("liveTickerTrack"),
    items = recentActions(state, escrowMarket),
    key = JSON.stringify(items);
  const active = document.activeElement;
  const keyboardFocusedInTrack = Boolean(active && track?.contains(active) && active.matches?.(":focus-visible"));
  if (!strip || !track || key === signature || keyboardFocusedInTrack) return;
  const nextTopId = items[0]?.id ?? "";
  const hasNewTop = Boolean(topActionId && nextTopId && nextTopId !== topActionId);
  signature = key;
  topActionId = nextTopId;
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
      const sep = label.indexOf(" · " + item.name);
      const at = sep >= 0 ? sep + 3 : label.indexOf(item.name);
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
  const ctrl = autoScroll(strip, { speed: 18 });
  if (hasNewTop && ctrl && !(ctrl.interacting ? ctrl.interacting() : ctrl.paused())) ctrl.reset(0);
}
