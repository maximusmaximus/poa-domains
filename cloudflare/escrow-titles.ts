import type { KeyObject } from "node:crypto";
import { Engine } from "../src/engine.js";
import { DOMAIN, Packet, signBody } from "../src/auth.js";
import { ACTIONS } from "../src/actions.js";
import { ownershipKey } from "../src/emoji-ownership.js";
import { normalizeName } from "../src/names.js";
import { need } from "../src/core.js";
import { State, TitleStore } from "./escrow.js";
import { poaNewNamePriceMicros } from "../src/new-name-prices.js";

/**
 * Scope escrow title locks to ONLY the specific domains (plus their emoji ownership classes,
 * active deeds, offers, and parent-mutating child actions) currently OPEN or SETTLING in escrow,
 * plus any seller with a SETTLING handover whose pre-signed transfer nonce must remain unspent.
 * Fails closed on malformed/untyped packets while any escrow reservation exists.
 */
export function escrowPacketBlocked(escrowState: State, engine: Engine, packet: unknown): boolean {
  const reserved = Object.values(escrowState.auctions).filter(
    (a) => a.status === "OPEN" || a.status === "SETTLING",
  );
  if (!reserved.length) return false;
  if (!packet || typeof packet !== "object") return true;
  const body = (packet as { body?: unknown }).body;
  if (!body || typeof body !== "object") return true;
  const b = body as { action?: unknown; signer?: unknown; coSigners?: unknown; params?: unknown };
  if (typeof b.action !== "string" || !Object.hasOwn(ACTIONS, b.action)) return true;
  if (typeof b.signer !== "string" || !b.signer) return true;
  const coSigners = Array.isArray(b.coSigners) ? b.coSigners : null;
  if (!coSigners || coSigners.some((x) => typeof x !== "string")) return true;
  const params = b.params;
  if (!params || typeof params !== "object") return true;
  const p = params as Record<string, unknown>;

  // Protect settling sellers with legacy seller-signed transfer packets so no concurrent write
  // burns their handover nonce. Auto-settled sales sign with treasury at commit time (no seller nonce pin).
  const settlingSigners = new Set<string>();
  for (const a of reserved) {
    if (a.status !== "SETTLING") continue;
    const st = escrowState.settlements[a.id];
    if (st?.auto) continue;
    settlingSigners.add(a.seller);
    if (st?.packet?.body?.signer) settlingSigners.add(st.packet.body.signer);
    for (const cs of st?.packet?.body?.coSigners ?? []) settlingSigners.add(cs);
  }
  if (settlingSigners.has(b.signer) || coSigners.some((cs) => settlingSigners.has(cs))) {
    return true;
  }

  const snap = engine.snapshot();
  const reservedNames = new Set<string>();
  const reservedKeys = new Set<string>();
  const reservedDeedIds = new Set<string>();
  for (const a of reserved) {
    reservedNames.add(a.name);
    try {
      reservedKeys.add(ownershipKey(a.name, engine.normalizationMode));
    } catch {
      /* ignore non-normalizable fixture names */
    }
    const activeId = snap.names[a.name]?.activeId;
    if (activeId) reservedDeedIds.add(activeId);
  }

  const isLockedName = (raw: unknown): boolean => {
    if (typeof raw !== "string" || !raw) return true;
    let canonicalName: string;
    try {
      canonicalName = normalizeName(raw, engine.normalizationMode).canonical;
    } catch {
      return true;
    }
    if (reservedNames.has(canonicalName)) return true;
    try {
      if (reservedKeys.has(ownershipKey(canonicalName, engine.normalizationMode))) return true;
    } catch {
      return true;
    }
    return false;
  };
  const isLockedDeedId = (raw: unknown): boolean =>
    typeof raw === "string" && reservedDeedIds.has(raw);

  switch (b.action) {
    case "announceAuction":
    case "issueReserved":
    case "sellFixed":
    case "transfer":
    case "setRecords":
    case "setMetadata":
      return isLockedName(p.name) || isLockedDeedId(p.expectedDeedId);
    case "setPrimaryName":
      if (p.name === null && p.expectedDeedId === null) return false;
      return isLockedName(p.name) || isLockedDeedId(p.expectedDeedId);
    case "revokeChild":
    case "renewLease":
    case "expireLease": {
      if (isLockedName(p.name) || isLockedDeedId(p.expectedDeedId)) return true;
      const nameStr = typeof p.name === "string" ? p.name : "";
      const dot = nameStr.indexOf(".");
      if (dot > 0 && isLockedName(nameStr.slice(dot + 1))) return true;
      const deed = typeof p.expectedDeedId === "string" ? snap.deeds[p.expectedDeedId] : null;
      if (deed?.parentId && isLockedDeedId(deed.parentId)) return true;
      return false;
    }
    case "createChildOffer":
      return isLockedName(p.parent) || isLockedDeedId(p.parentDeedId);
    case "fillChildOffer":
    case "cancelOffer":
    case "buyFixed": {
      if (typeof p.offerId !== "string") return true;
      const offer = snap.offers[p.offerId];
      if (!offer) return false;
      if (isLockedDeedId(offer.parentId)) return true;
      const parentName = snap.deeds[offer.parentId]?.name;
      if (parentName && isLockedName(parentName)) return true;
      if (b.action === "fillChildOffer" && parentName && typeof p.label === "string") {
        if (isLockedName(`${p.label}.${parentName}`)) return true;
      }
      return false;
    }
    case "bid":
    case "finalize":
    case "closeNoBid":
    case "cancelAuction":
    case "withdrawRefund": {
      if (typeof p.auctionId !== "string") return true;
      const auc = snap.auctions[p.auctionId];
      if (!auc) return false;
      return isLockedName(auc.name) || isLockedDeedId(auc.deedId);
    }
    default:
      return true;
  }
}
export function registryTitles(e: Engine, treasuryKey?: KeyObject): TitleStore {
  need(e.config.increment.kind === "eosStrict10", "ESCROW_INCREMENT_POLICY");
  const buildAutoSettlePacket = (
    name: string,
    seller: string,
    buyer: string,
    auctionId: string,
    priceMicros: string,
    deedId?: string,
    ownerVersion?: number,
  ): Packet => {
    need(Boolean(treasuryKey), "ESCROW_TITLE_NOT_READY");
    const s = e.snapshot();
    const d = s.deeds[s.names[name]?.activeId ?? ""];
    need(d && d.owner === seller && !d.lock && d.rights.kind === "permanent" && !d.retired, "ESCROW_TITLE_NOT_READY");
    if (deedId !== undefined) need(d.id === deedId, "ESCROW_TITLE_NOT_READY");
    if (ownerVersion !== undefined) need(d.ownerVersion === ownerVersion, "ESCROW_TITLE_NOT_READY");
    need(!Object.values(s.offers).some(o => o.parentId === d.id && !o.cancelled && o.uses < o.maxUses), "ESCROW_ENCUMBERED_TITLE");
    const nowSec = Math.max(e.observedTime(), s.time);
    const body = {
      domain: DOMAIN,
      revision: e.config.revision,
      chainId: e.config.chainId,
      genesisHash: e.config.genesisHash,
      registryId: e.registryId,
      policyHash: e.policyHash,
      normalizationHash: e.config.normalizationHash,
      signer: e.config.treasury,
      coSigners: [],
      requestId: `escrow-settle-${auctionId.slice(0, 32)}`,
      nonce: e.nextNonce(e.config.treasury),
      notBefore: 0,
      deadline: nowSec + 3600,
      maxTotal: "0",
      maxNetworkFee: "0",
      action: "escrowSettle",
      params: {
        name: d.name,
        expectedDeedId: d.id,
        expectedVersion: d.version,
        expectedOwnerVersion: d.ownerVersion,
        seller,
        recipient: buyer,
        auctionId,
        price: priceMicros,
      },
    };
    return signBody(body as any, [treasuryKey!]);
  };
  return {
      terms: (name, seller) => {
        const s = e.snapshot(), d = s.deeds[s.names[name]?.activeId ?? ""];
        need(d && d.owner === seller && !d.lock && d.rights.kind === "permanent" && !d.retired, "ESCROW_TITLE");
        need(!Object.values(s.offers).some(o => o.parentId === d.id && !o.cancelled && o.uses < o.maxUses), "ESCROW_ENCUMBERED_TITLE");
        const premium = normalizeName(name, e.normalizationMode).tier === "premium";
        return { reserve: "0.000001", window: premium ? 86400000 : 3600000, quiet: premium ? 86400000 : 3600000, deedId: d.id, ownerVersion: d.ownerVersion };
      },
      validate: (packet: Packet, name, seller, buyer) => {
        need(packet.body.action === "transfer" && packet.body.signer === seller && packet.body.params.name === name &&
          packet.body.params.recipient === buyer && packet.body.maxTotal === "0" && packet.body.maxNetworkFee === "0", "ESCROW_TITLE_CONSENT");
        need(e.preview(packet).status === "succeeded", "ESCROW_TITLE_NOT_READY");
      },
      commit: (packet: Packet) => { need(e.submit(packet).status === "succeeded", "ESCROW_TITLE_COMMIT"); },
      ...(treasuryKey ? {
        validateAutoSettle: (name: string, seller: string, buyer: string, auctionId: string, priceMicros: string, deedId?: string, ownerVersion?: number) => {
          const packet = buildAutoSettlePacket(name, seller, buyer, auctionId, priceMicros, deedId, ownerVersion);
          need(e.previewEscrowIssue(packet).status === "succeeded", "ESCROW_TITLE_NOT_READY");
        },
        commitAutoSettle: (name: string, seller: string, buyer: string, auctionId: string, priceMicros: string, deedId?: string, ownerVersion?: number) => {
          const packet = buildAutoSettlePacket(name, seller, buyer, auctionId, priceMicros, deedId, ownerVersion);
          need(e.submitEscrowIssue(packet).status === "succeeded", "ESCROW_TITLE_COMMIT");
        },
      } : {}),
      // POA new-name checkout. Explicit schedule, not the immutable registry auction reserve:
      // standard/common 100.000000 POA, premium 1000.000000 POA (1 POA = 1,000,000 micros).
      issueTerms: (name) => {
        const s = e.snapshot(), row = s.names[name];
        need(!row?.activeId && !row?.auctionId, "ESCROW_NAME_TAKEN");
        const n = normalizeName(name, e.normalizationMode), a = e.config.assets.POA;
        need(a && n.labels.length === 1, "ESCROW_ISSUE_NAME");
        return { price: poaNewNamePriceMicros(n.tier === "premium" ? "premium" : "standard") };
      },
      validateIssue: (packet: Packet, name, buyer, price) => {
        const b = packet.body, q = b.params as Record<string, unknown>;
        need(b.action === "issueFromTreasury" && b.signer === buyer && q.name === name && q.asset === "POA" &&
          q.price === price && q.expectedDeedId === null && q.expectedVersion === 0 &&
          b.maxTotal === "0" && b.maxNetworkFee === "0" && b.coSigners.length === 0, "ESCROW_ISSUE_CONSENT");
        need(e.previewEscrowIssue(packet).status === "succeeded", "ESCROW_ISSUE_NOT_READY");
      },
      issue: (packet: Packet) => { need(e.submitEscrowIssue(packet).status === "succeeded", "ESCROW_ISSUE_COMMIT"); },
      // POA subname sales: only the current holder of a permanent, unlocked, unretired root may sell.
      subTerms: (parent, seller) => {
        const s = e.snapshot(), d = s.deeds[s.names[parent]?.activeId ?? ""];
        need(d && d.owner === seller && !d.parentId && !d.lock && d.rights.kind === "permanent" && !d.retired, "ESCROW_TITLE");
        need(normalizeName(parent, e.normalizationMode).labels.length === 1, "ESCROW_TITLE");
        return { parentDeedId: d.id, ownerVersion: d.ownerVersion };
      },
      validateSub: (packet: Packet, name, buyer, price, listing) => {
        const b = packet.body, q = b.params as Record<string, unknown>;
        need(b.action === "issueSubname" && b.signer === buyer && q.name === name && q.asset === "POA" && q.price === price &&
          q.parentDeedId === listing.parentDeedId && q.parentOwnerVersion === listing.ownerVersion &&
          b.maxTotal === "0" && b.maxNetworkFee === "0" && b.coSigners.length === 0, "ESCROW_SUB_CONSENT");
        need(e.previewEscrowIssue(packet).status === "succeeded", "ESCROW_SUB_NOT_READY");
      },
      issueSub: (packet: Packet) => { need(e.submitEscrowIssue(packet).status === "succeeded", "ESCROW_SUB_COMMIT"); },
  };
}
