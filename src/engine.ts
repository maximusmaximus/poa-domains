import {
  Body,
  Packet,
  authenticate,
  intentId,
  principal,
  DOMAIN,
} from "./auth.js";
import { ACTIONS, Action } from "./actions.js";
import {
  Config,
  validateConfig,
  policyHash,
  registryId,
  minimumNext,
} from "./config.js";
import {
  amount,
  bounded,
  canonical,
  exact,
  Fault,
  hash,
  integer,
  need,
  Obj,
  text,
} from "./core.js";
import { Clock } from "./clock.js";
import {
  canonicalName,
  nameKey,
  normalizeLabel,
  NormalizationMode,
  normalizationModeForHash,
} from "./names.js";
import { Metadata, metadata, validCid } from "./metadata.js";
import {
  State,
  Deed,
  Auction,
  Offer,
  Receipt,
  Rights,
  rights,
  rightsHash,
  canManage,
  leaseEnd,
  records,
} from "./model.js";

export interface Commit {
  packet: Packet;
  time: number;
  sequence: number;
  stateHash: string;
}
export interface Persistence {
  append(commit: Commit): void;
  close(): void;
}
export class Engine {
  readonly config: Config;
  readonly policyHash: string;
  readonly registryId: string;
  readonly normalizationMode: NormalizationMode;
  private readonly reservedSet: Set<string>;
  private state: State;
  private storage?: Persistence;
  private stopped = false;
  constructor(
    config: unknown,
    private clock: Clock,
  ) {
    this.config = validateConfig(config);
    freeze(this.config);
    this.normalizationMode = normalizationModeForHash(
      this.config.normalizationHash,
    );
    this.reservedSet = new Set(this.config.reserved);
    this.policyHash = policyHash(this.config);
    this.registryId = registryId(this.config);
    this.state = {
      revision: this.config.revision,
      configHash: this.policyHash,
      sequence: 0,
      time: 0,
      names: {},
      deeds: {},
      auctions: {},
      offers: {},
      balances: structuredClone(this.config.balances),
      credits: {},
      nonces: {},
      receipts: {},
      requests: {},
      bids: {},
    };
    this.assertInvariants(this.state);
  }
  attach(storage: Persistence): void {
    need(!this.storage && !this.stopped, "STORAGE");
    this.storage = storage;
  }
  close(): void {
    this.storage?.close();
    this.stopped = true;
  }
  snapshot(): State {
    return structuredClone(this.state);
  }
  stateHash(): string {
    return hash("local-state/v1", this.state);
  }
  durability(): string {
    return this.storage ? "fsynced-journal" : "volatile-memory";
  }
  observedTime(): number {
    return integer(this.clock.now());
  }
  receipt(id: string): Receipt | null {
    return structuredClone(this.state.receipts[id] ?? null);
  }
  nextNonce(id: string): number {
    principal(id);
    return this.state.nonces[id] ?? 0;
  }
  // Replay checks the same signatures/guards/economics, using recorded authoritative time.
  replay(commit: Commit): void {
    need(!this.storage, "STORAGE");
    need(
      commit.sequence === this.state.sequence + 1 &&
        commit.time >= this.state.time,
      "REPLAY_ORDER",
    );
    const r = this.execute(commit.packet, integer(commit.time));
    need(
      r.sequence === commit.sequence && this.stateHash() === commit.stateHash,
      "REPLAY_MISMATCH",
    );
  }
  submit(packet: unknown): Receipt {
    return this.execute(packet, integer(this.clock.now()));
  }
  private execute(value: unknown, time: number): Receipt {
    need(!this.stopped, "ENGINE_STOPPED");
    const packet = structuredClone(authenticate(value));
    const b = packet.body;
    need(
      b.domain === DOMAIN &&
        b.revision === this.config.revision &&
        b.chainId === this.config.chainId &&
        b.genesisHash === this.config.genesisHash &&
        b.registryId === this.registryId &&
        b.policyHash === this.policyHash &&
        b.normalizationHash === this.config.normalizationHash,
      "DOMAIN",
    );
    const id = intentId(b),
      requestKey = b.signer + ":" + b.requestId;
    const previous = this.state.requests[requestKey];
    if (previous) {
      need(previous === id, "IDEMPOTENCY_CONFLICT");
      return structuredClone(this.state.receipts[previous]!);
    }
    need(b.nonce === this.nextNonce(b.signer), "NONCE");
    need(b.nonce < Number.MAX_SAFE_INTEGER, "NONCE_OVERFLOW");
    need(time >= this.state.time, "CLOCK_BACKWARD");
    need(this.state.sequence < Number.MAX_SAFE_INTEGER, "SEQUENCE_OVERFLOW");
    let next = structuredClone(this.state);
    next.time = time;
    let result: any = null,
      code = "OK",
      status: Receipt["status"] = "succeeded";
    try {
      amount(b.maxTotal);
      need(b.maxNetworkFee === "0", "NETWORK_FEE_POLICY");
      need(time >= b.notBefore && time < b.deadline, "INTENT_EXPIRED");
      need(Object.hasOwn(ACTIONS, b.action), "UNSUPPORTED_ACTION");
      exact(b.params, [...ACTIONS[b.action as Action]]);
      result = this.apply(next, b, id, time);
      this.assertInvariants(next);
    } catch (e) {
      if (!(e instanceof Fault)) throw e;
      // Business rejections consume only replay bookkeeping. Economic state rolls back.
      code = e.code;
      result = null;
      status = "rejected";
      next = structuredClone(this.state);
      next.time = time;
    }
    next.sequence++;
    next.nonces[b.signer] = b.nonce + 1;
    const receipt: Receipt = {
      intentId: id,
      requestId: b.requestId,
      signer: b.signer,
      sequence: next.sequence,
      time,
      status,
      code,
      result,
    };
    next.receipts[id] = receipt;
    next.requests[requestKey] = id;
    this.assertInvariants(next);
    try {
      this.storage?.append({
        packet,
        time,
        sequence: next.sequence,
        stateHash: hash("local-state/v1", next),
      });
    } catch {
      this.stopped = true;
      throw new Fault("DURABILITY_UNKNOWN_RESTART_AND_QUERY");
    }
    this.state = next;
    return structuredClone(receipt);
  }
  private asset(id: unknown): string {
    const s = text(id, 16);
    need(Object.hasOwn(this.config.assets, s), "UNSUPPORTED_ASSET");
    return s;
  }
  private wallet(s: State, p: string, a: string): bigint {
    return amount(s.balances[p]?.[a] ?? "0");
  }
  private credit(s: State, p: string, a: string, n: bigint): void {
    (s.balances[p] ??= {})[a] = bounded(this.wallet(s, p, a) + n);
  }
  private debit(s: State, b: Body, a: string, n: bigint): void {
    need(n <= amount(b.maxTotal), "AMOUNT_CAP");
    need(this.wallet(s, b.signer, a) >= n, "INSUFFICIENT_FUNDS");
    this.credit(s, b.signer, a, -n);
  }
  private sale(s: State, b: Body, a: string, n: bigint, payee: string): void {
    this.debit(s, b, a, n);
    this.distribute(s, a, n, payee);
  }
  private distribute(s: State, a: string, n: bigint, payee: string): void {
    const fee = (n * BigInt(this.config.feeBps)) / 10000n;
    this.credit(s, payee, a, n - fee);
    this.credit(s, this.config.treasury, a, fee);
  }
  private entry(s: State, name: unknown) {
    const n = canonicalName(name, this.normalizationMode);
    need(!this.reservedSet.has(n.canonical), "RESERVED_NAME");
    return { n, e: s.names[n.canonical] };
  }
  private deed(s: State, p: Obj): Deed {
    const { e } = this.entry(s, p.name);
    need(e?.activeId, "NOT_FOUND");
    const d = s.deeds[e.activeId]!;
    need(p.expectedDeedId === d.id, "DEED_GENERATION");
    need(integer(p.expectedVersion) === d.version, "STALE_VERSION");
    return d;
  }
  private owner(d: Deed, b: Body, time: number, unlocked = true): void {
    need(d.owner === b.signer, "NOT_OWNER");
    need(canManage(d, time), "LEASE_INACTIVE");
    if (unlocked) need(!d.lock, "TITLE_LOCKED");
  }
  private co(b: Body, p: string): void {
    need(b.coSigners.includes(p), "CONSENT_REQUIRED");
  }
  private auction(s: State, p: Obj): Auction {
    const a = s.auctions[text(p.auctionId, 64)];
    need(a, "AUCTION_NOT_FOUND");
    need(integer(p.expectedVersion) === a.version, "STALE_VERSION");
    need(a.status === "live", "AUCTION_TERMINAL");
    return a;
  }
  private offer(s: State, p: Obj): Offer {
    const o = s.offers[text(p.offerId, 64)];
    need(o, "OFFER_NOT_FOUND");
    need(integer(p.expectedVersion) === o.version, "STALE_VERSION");
    need(!o.cancelled && o.uses < o.maxUses, "OFFER_CLOSED");
    return o;
  }
  private transferDeed(d: Deed, to: string): void {
    d.owner = principal(to);
    d.ownerVersion = integer(d.ownerVersion + 1);
    d.version = integer(d.version + 1);
  }
  private mint(
    s: State,
    name: string,
    to: string,
    r: Rights,
    parentId: string | null,
    m: Metadata,
    time: number,
    expectedGeneration?: number,
  ): Deed {
    const n = canonicalName(name, this.normalizationMode);
    const e = (s.names[name] ??= {
      name,
      key: nameKey(this.registryId, name, this.normalizationMode),
      generation: 0,
      activeId: null,
      auctionId: null,
    });
    need(!e.activeId, "NAME_TAKEN");
    need(!e.auctionId, "NAME_RESERVED");
    const generation = integer(e.generation + 1);
    if (expectedGeneration !== undefined)
      need(generation === integer(expectedGeneration, 1), "DEED_GENERATION");
    const id = hash("deed-id/v1", [e.key, generation]);
    const rh = rightsHash(r, parentId);
    metadata(m, name, rh);
    const d: Deed = {
      id,
      name,
      generation,
      owner: principal(to),
      ownerVersion: 1,
      version: 1,
      parentId,
      rights: structuredClone(r),
      rightsHash: rh,
      expiry: r.kind === "lease" ? r.expiresAt : null,
      renewals: 0,
      retired: false,
      metadata: [structuredClone(m)],
      records: [],
      recordsVersion: 0,
      lock: null,
      encumbranceVersion: 0,
    };
    e.generation = generation;
    e.activeId = id;
    s.deeds[id] = d;
    return d;
  }
  closeEligible(a: Auction): number {
    return a.high
      ? integer(
          Math.max(integer(a.openAt + a.window), integer(a.high.at + a.quiet)),
        )
      : integer(a.openAt + a.window);
  }
  private apply(s: State, b: Body, id: string, time: number): any {
    if (
      this.config.revision === "poa-mainnet-v1" &&
      !Object.hasOwn(s.balances, b.signer) &&
      b.signer !== this.config.issuer &&
      b.signer !== this.config.treasury &&
      this.wallet(s, this.config.issuer, "POA") >= 10000000n
    ) {
      this.credit(s, this.config.issuer, "POA", -10000000n);
      this.credit(s, b.signer, "POA", 10000000n);
    }
    const p = b.params;
    switch (b.action as Action) {
      case "announceAuction": {
        const { n, e } = this.entry(s, p.name);
        need(n.labels.length === 1, "ROOT_ONLY");
        const asset = this.asset(p.asset);
        const reserve = amount(p.reserve, true);
        const minOpenAt =
          this.config.revision === "poa-mainnet-v1" ? time : time + 86400;
        const openAt = integer(p.openAt, minOpenAt);
        integer(openAt + (n.tier === "premium" ? 86400 : 3600));
        need(!e?.auctionId, "NAME_RESERVED");
        let d: Deed | null = null;
        if (e?.activeId) {
          d = this.deed(s, p);
          this.owner(d, b, time);
          need(d.parentId === null && !d.retired, "ROOT_ONLY");
        } else {
          if (this.config.revision === "local-reference-v1") {
            need(b.signer === this.config.issuer, "NOT_ISSUER");
          } else {
            need(b.signer !== this.config.treasury, "SELLER_SELF_BID");
          }
          need(
            p.expectedDeedId === null && p.expectedVersion === 0,
            "STALE_VERSION",
          );
          const a = this.config.assets[asset]!;
          need(
            reserve ===
              amount(
                n.tier === "premium" ? a.premiumReserve : a.standardReserve,
              ),
            "RESERVE_POLICY",
          );
        }
        const rh = d?.rightsHash ?? rightsHash({ kind: "permanent" }, null);
        const m = metadata(p.metadata, n.canonical, rh);
        if (d)
          need(
            canonical(m) === canonical(d.metadata[d.metadata.length - 1]),
            "METADATA_VERSION",
          );
        const auctionId = hash("auction-id/v1", [
          this.registryId,
          n.canonical,
          id,
        ]);
        s.auctions[auctionId] = {
          id: auctionId,
          name: n.canonical,
          deedId: d?.id ?? null,
          seller: d?.owner ?? this.config.treasury,
          asset,
          reserve: reserve.toString(),
          openAt,
          announcedAt: time,
          window: n.tier === "premium" ? 86400 : 3600,
          quiet: n.tier === "premium" ? 86400 : 3600,
          version: 1,
          metadata: m,
          encumbranceVersion: d?.encumbranceVersion ?? 0,
          high: null,
          status: "live",
        };
        const row =
          e ??
          (s.names[n.canonical] = {
            name: n.canonical,
            key: nameKey(this.registryId, n.canonical, this.normalizationMode),
            generation: 0,
            activeId: null,
            auctionId: null,
          });
        row.auctionId = auctionId;
        if (d) d.lock = auctionId;
        return { auctionId };
      }
      case "bid": {
        const a = this.auction(s, p);
        need(this.asset(p.asset) === a.asset, "AUCTION_ASSET");
        const n = amount(p.amount, true);
        const beneficiary = principal(p.beneficiary);
        need(
          time >= a.openAt && time < this.closeEligible(a),
          "AUCTION_CLOSED",
        );
        need(
          b.signer !== a.seller && beneficiary !== a.seller,
          "SELLER_SELF_BID",
        );
        if (a.high) {
          need(a.high.payer !== b.signer, "HIGH_SELF_RAISE");
          need(
            n >= minimumNext(amount(a.high.amount), this.config.increment),
            "MIN_RAISE",
          );
        } else need(n >= amount(a.reserve), "RESERVE");
        this.debit(s, b, a.asset, n);
        if (a.high) {
          const old = a.high;
          const key = hash("refund-key/v1", [a.id, a.asset, old.payer]);
          const c = (s.credits[key] ??= {
            auctionId: a.id,
            asset: a.asset,
            payer: old.payer,
            amount: "0",
            version: 0,
          });
          c.amount = bounded(amount(c.amount) + amount(old.amount));
          c.version++;
          s.bids[old.bidId].status = "outbid";
        }
        const bidId = hash("bid-id/v1", [a.id, id]);
        a.high = {
          payer: b.signer,
          beneficiary,
          amount: n.toString(),
          at: time,
          bidId,
        };
        a.version++;
        s.bids[bidId] = {
          ...a.high,
          auctionId: a.id,
          sequence: s.sequence + 1,
          status: "high",
        };
        return { bidId, closeEligible: this.closeEligible(a) };
      }
      case "withdrawRefund": {
        const a = s.auctions[text(p.auctionId, 64)];
        need(a, "AUCTION_NOT_FOUND");
        need(this.asset(p.asset) === a.asset, "AUCTION_ASSET");
        const key = hash("refund-key/v1", [a.id, a.asset, b.signer]);
        const c = s.credits[key];
        need(c, "NO_REFUND");
        need(integer(p.expectedVersion) === c.version, "STALE_VERSION");
        const n = amount(p.amount, true);
        need(n <= amount(c.amount), "REFUND_EXCEEDED");
        c.amount = bounded(amount(c.amount) - n);
        c.version++;
        this.credit(s, b.signer, a.asset, n);
        return { amount: n.toString(), asset: a.asset };
      }
      case "finalize": {
        const a = this.auction(s, p);
        need(a.high, "NO_BID");
        need(time >= this.closeEligible(a), "QUIET_PERIOD");
        const high = a.high;
        const e = s.names[a.name]!;
        need(e.auctionId === a.id, "TITLE_LOCKED");
        let d: Deed;
        if (a.deedId) {
          d = s.deeds[a.deedId]!;
          need(
            d.lock === a.id &&
              d.owner === a.seller &&
              d.encumbranceVersion === a.encumbranceVersion,
            "TITLE_LOCKED",
          );
          d.lock = null;
          this.transferDeed(d, high.beneficiary);
        } else {
          e.auctionId = null;
          d = this.mint(
            s,
            a.name,
            high.beneficiary,
            { kind: "permanent" },
            null,
            a.metadata,
            time,
          );
        }
        e.auctionId = null;
        this.distribute(s, a.asset, amount(high.amount), a.seller);
        s.bids[high.bidId].status = "won";
        a.status = "finalized";
        a.version++;
        a.high = null;
        return { deedId: d.id, owner: d.owner };
      }
      case "closeNoBid":
      case "cancelAuction": {
        const a = this.auction(s, p);
        need(!a.high, "HAS_BIDS");
        if (b.action === "closeNoBid")
          need(time >= this.closeEligible(a), "QUIET_PERIOD");
        else {
          need(time < a.openAt, "CANCEL_WINDOW");
          need(
            b.signer === (a.deedId ? a.seller : this.config.issuer),
            "NOT_SELLER",
          );
        }
        a.status = b.action === "closeNoBid" ? "no-bid" : "cancelled";
        a.version++;
        s.names[a.name]!.auctionId = null;
        if (a.deedId) s.deeds[a.deedId]!.lock = null;
        return { status: a.status };
      }
      case "createChildOffer": {
        const { n, e } = this.entry(s, p.parent);
        need(n.labels.length === 1 && e?.activeId, "ROOT_ONLY");
        const d = s.deeds[e.activeId]!;
        this.owner(d, b, time);
        need(
          p.parentDeedId === d.id &&
            integer(p.expectedOwnerVersion) === d.ownerVersion,
          "STALE_VERSION",
        );
        const asset = this.asset(p.asset);
        const price = amount(p.price, true).toString();
        const r = rights(p.rights, time);
        const validUntil = integer(p.validUntil, time + 1);
        if (r.kind === "lease") {
          need(validUntil <= r.expiresAt, "OFFER_EXPIRY");
          need(r.settlementAsset === asset, "LEASE_ASSET");
        }
        need(
          p.labels === null ||
            (Array.isArray(p.labels) &&
              p.labels.length > 0 &&
              p.labels.length <= 256),
          "LABELS",
        );
        const labels =
          p.labels === null
            ? null
            : (p.labels as any[]).map((x: unknown) => {
                const label = normalizeLabel(
                  x,
                  this.normalizationMode,
                ).canonical;
                need(label === x, "NON_CANONICAL_NAME");
                return label;
              });
        if (labels) need(new Set(labels).size === labels.length, "LABELS");
        const maxUses = integer(p.maxUses, 1, 1000000);
        const offerId = hash("offer-id/v1", [d.id, id]);
        s.offers[offerId] = {
          id: offerId,
          kind: "child",
          parentId: d.id,
          owner: d.owner,
          ownerVersion: d.ownerVersion,
          deedVersion: d.version,
          encumbranceVersion: d.encumbranceVersion,
          asset,
          price,
          validUntil,
          version: 1,
          rights: r,
          labels,
          maxUses,
          uses: 0,
          cancelled: false,
        };
        return { offerId, rightsHash: rightsHash(r, d.id) };
      }
      case "fillChildOffer": {
        const o = this.offer(s, p);
        need(o.kind === "child", "OFFER_TYPE");
        need(time < o.validUntil, "OFFER_EXPIRED");
        const root = s.deeds[o.parentId]!;
        need(
          root.owner === o.owner && root.ownerVersion === o.ownerVersion,
          "STALE_OFFER",
        );
        need(!root.lock, "TITLE_LOCKED");
        const label = normalizeLabel(p.label, this.normalizationMode).canonical;
        need(
          label === p.label && (o.labels === null || o.labels.includes(label)),
          "LABELS",
        );
        const name = label + "." + root.name;
        this.entry(s, name);
        need(
          this.asset(p.asset) === o.asset &&
            amount(p.amount, true) === amount(o.price),
          "OFFER_PRICE",
        );
        const m = metadata(p.metadata, name, rightsHash(o.rights!, root.id));
        const d = this.mint(
          s,
          name,
          b.signer,
          o.rights!,
          root.id,
          m,
          time,
          integer(p.expectedGeneration, 1),
        );
        this.sale(s, b, o.asset, amount(o.price), o.owner);
        root.encumbranceVersion++;
        root.version++;
        o.uses++;
        o.version++;
        return { deedId: d.id, name };
      }
      case "sellFixed": {
        const d = this.deed(s, p);
        this.owner(d, b, time);
        const asset = this.asset(p.asset);
        const offerId = hash("offer-id/v1", [d.id, id]);
        s.offers[offerId] = {
          id: offerId,
          kind: "resale",
          parentId: d.id,
          owner: d.owner,
          ownerVersion: d.ownerVersion,
          deedVersion: d.version,
          encumbranceVersion: d.encumbranceVersion,
          asset,
          price: amount(p.price, true).toString(),
          validUntil: integer(p.validUntil, time + 1),
          version: 1,
          rights: null,
          labels: null,
          maxUses: 1,
          uses: 0,
          cancelled: false,
        };
        return { offerId };
      }
      case "buyFixed": {
        const o = this.offer(s, p);
        need(o.kind === "resale", "OFFER_TYPE");
        need(time < o.validUntil, "OFFER_EXPIRED");
        const d = s.deeds[o.parentId]!;
        need(
          s.names[d.name]?.activeId === d.id &&
            d.owner === o.owner &&
            d.ownerVersion === o.ownerVersion &&
            d.version === o.deedVersion &&
            d.encumbranceVersion === o.encumbranceVersion,
          "STALE_OFFER",
        );
        need(canManage(d, time), "LEASE_INACTIVE");
        need(!d.lock, "TITLE_LOCKED");
        need(
          this.asset(p.asset) === o.asset &&
            amount(p.amount, true) === amount(o.price),
          "OFFER_PRICE",
        );
        need(b.signer !== d.owner, "SELF_SALE");
        this.sale(s, b, o.asset, amount(o.price), o.owner);
        this.transferDeed(d, b.signer);
        o.uses++;
        o.version++;
        return { deedId: d.id };
      }
      case "cancelOffer": {
        const o = this.offer(s, p);
        need(b.signer === o.owner, "NOT_SELLER");
        o.cancelled = true;
        o.version++;
        return { cancelled: true };
      }
      case "transfer": {
        const d = this.deed(s, p);
        this.owner(d, b, time);
        this.transferDeed(d, principal(p.recipient));
        return { deedId: d.id, owner: d.owner };
      }
      case "setRecords": {
        const d = this.deed(s, p);
        this.owner(d, b, time);
        const values = records(p.records);
        for (const r of values) if (r.type === "ipfs") validCid(r.cid);
        d.records = values;
        d.recordsVersion++;
        d.version++;
        return { recordsVersion: d.recordsVersion };
      }
      case "setMetadata": {
        const d = this.deed(s, p);
        this.owner(d, b, time);
        const m = metadata(p.metadata, d.name, d.rightsHash);
        d.metadata.push(m);
        d.version++;
        return { metadataVersion: d.metadata.length };
      }
      case "renewLease": {
        const d = this.deed(s, p);
        need(
          d.owner === b.signer && !d.retired && d.rights.kind === "lease",
          "NOT_LEASE_HOLDER",
        );
        const r = d.rights;
        const root = s.deeds[d.parentId!]!;
        const asset = this.asset(p.asset);
        const n = amount(p.amount, true);
        const term = integer(p.termSeconds, 1, 315360000);
        const renewal = r.renewal;
        need(asset === r.settlementAsset, "LEASE_ASSET");
        if (renewal.kind === "guaranteed") {
          need(
            d.renewals < renewal.maxRenewals &&
              time >= d.expiry! - renewal.windowSeconds &&
              time < renewal.optionUntil,
            "RENEWAL_WINDOW",
          );
          need(
            n === amount(renewal.price) && term === renewal.termSeconds,
            "RENEWAL_TERMS",
          );
        } else {
          need(time < d.expiry! + r.graceSeconds, "RENEWAL_WINDOW");
          need(!root.lock, "TITLE_LOCKED");
          this.co(b, root.owner);
        }
        this.sale(s, b, asset, n, root.owner);
        d.expiry = integer(Math.max(d.expiry!, time) + term);
        d.renewals++;
        d.version++;
        if (renewal.kind === "negotiated") {
          root.encumbranceVersion++;
          root.version++;
        }
        return { expiry: d.expiry };
      }
      case "expireLease": {
        const d = this.deed(s, p);
        need(d.rights.kind === "lease", "PERMANENT_DEED");
        need(time >= leaseEnd(d), "LEASE_OBLIGATION");
        s.names[d.name]!.activeId = null;
        d.retired = true;
        d.version++;
        return { expired: true };
      }
      case "revokeChild": {
        const d = this.deed(s, p);
        need(
          d.parentId && d.owner === b.signer && !d.retired,
          "NOT_CHILD_HOLDER",
        );
        const root = s.deeds[d.parentId]!;
        need(
          integer(p.parentOwnerVersion) === root.ownerVersion,
          "STALE_VERSION",
        );
        need(!root.lock, "TITLE_LOCKED");
        this.co(b, root.owner);
        d.retired = true;
        d.version++;
        root.encumbranceVersion++;
        root.version++;
        return { retired: true, pathReserved: d.rights.kind === "permanent" };
      }
    }
  }
  resolve(value: unknown): any {
    const { canonical: name } = canonicalName(value, this.normalizationMode);
    const e = this.state.names[name];
    const d = e?.activeId ? this.state.deeds[e.activeId] : null;
    const t = this.state.time;
    const active =
      d &&
      !d.retired &&
      (d.rights.kind === "permanent" ||
        t < d.expiry! ||
        (d.rights.resolveDuringGrace && t < d.expiry! + d.rights.graceSeconds));
    return {
      mode: "local-committed-not-chain-finality",
      asOf: t,
      sequence: this.state.sequence,
      stateHash: this.stateHash(),
      name,
      deed: active ? structuredClone(d) : null,
    };
  }
  assertInvariants(s: State = this.state): void {
    const totals: Record<string, bigint> = {};
    const add = (asset: string, n: bigint) => {
      need(Object.hasOwn(this.config.assets, asset), "INVARIANT_ASSET");
      totals[asset] = (totals[asset] ?? 0n) + n;
    };
    for (const wallet of Object.values(s.balances))
      for (const [a, n] of Object.entries(wallet)) add(a, amount(n));
    for (const c of Object.values(s.credits)) {
      amount(c.amount);
      need(s.auctions[c.auctionId]?.asset === c.asset, "INVARIANT_CREDIT");
      add(c.asset, amount(c.amount));
    }
    for (const a of Object.values(s.auctions)) {
      if (a.high) {
        need(
          a.status === "live" && s.bids[a.high.bidId]?.status === "high",
          "INVARIANT_ESCROW",
        );
        add(a.asset, amount(a.high.amount));
      }
      if (a.status === "live") {
        const e = s.names[a.name];
        need(e?.auctionId === a.id, "INVARIANT_LOCK");
        if (a.deedId) need(s.deeds[a.deedId]?.lock === a.id, "INVARIANT_LOCK");
      }
    }
    for (const a of Object.keys(this.config.assets)) {
      let initial = 0n;
      for (const w of Object.values(this.config.balances))
        initial += amount(w[a] ?? "0");
      need((totals[a] ?? 0n) === initial, "INVARIANT_CONSERVATION");
    }
    const active = new Set<string>();
    for (const e of Object.values(s.names))
      if (e.activeId) {
        const d = s.deeds[e.activeId];
        need(
          d &&
            d.name === e.name &&
            d.generation === e.generation &&
            !active.has(d.id),
          "INVARIANT_TITLE",
        );
        active.add(d.id);
      }
    for (const d of Object.values(s.deeds)) {
      principal(d.owner);
      need(
        d.rightsHash === rightsHash(d.rights, d.parentId),
        "INVARIANT_RIGHTS",
      );
      need(d.metadata.length > 0, "INVARIANT_METADATA");
      for (const m of d.metadata) metadata(m, d.name, d.rightsHash);
      if (d.parentId)
        need(s.deeds[d.parentId]?.parentId === null, "INVARIANT_DEPTH");
    }
  }
}

function freeze(value: any): void {
  if (value && typeof value === "object") {
    for (const x of Object.values(value)) freeze(x);
    Object.freeze(value);
  }
}
