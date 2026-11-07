import { Metadata } from "./metadata.js";
import {
  hash,
  exact,
  integer,
  need,
  amount,
  flag,
  Obj,
  text,
  obj,
  Fault,
} from "./core.js";
import { canonicalName } from "./names.js";
export type Renewal =
  | { kind: "negotiated" }
  | {
      kind: "guaranteed";
      price: string;
      termSeconds: number;
      windowSeconds: number;
      maxRenewals: number;
      optionUntil: number;
    };
export type Rights =
  | { kind: "permanent" }
  | {
      kind: "lease";
      settlementAsset: string;
      expiresAt: number;
      graceSeconds: number;
      resolveDuringGrace: boolean;
      manageDuringGrace: boolean;
      renewal: Renewal;
    };
export const rightsHash = (rights: Rights, parentId: string | null) =>
  hash("rights/v1", [parentId, rights]);
export function rights(v: unknown, now: number): Rights {
  const r = ObjRights(v);
  if (r.kind === "permanent") return r as Rights;
  need(/^[A-Z][A-Z0-9_]{0,15}$/.test(text(r.settlementAsset, 16)), "ASSET");
  integer(r.expiresAt, now + 1);
  integer(r.graceSeconds, 0, 31536000);
  integer(r.expiresAt + r.graceSeconds);
  flag(r.resolveDuringGrace);
  flag(r.manageDuringGrace);
  const renewal = obj(r.renewal);
  if (renewal.kind === "negotiated") exact(renewal, ["kind"]);
  else {
    exact(renewal, [
      "kind",
      "price",
      "termSeconds",
      "windowSeconds",
      "maxRenewals",
      "optionUntil",
    ]);
    need(renewal.kind === "guaranteed", "RIGHTS");
    amount(renewal.price, true);
    integer(renewal.termSeconds, 1, 315360000);
    integer(renewal.windowSeconds, 1, 315360000);
    integer(renewal.maxRenewals, 1, 100000);
    integer(renewal.optionUntil, r.expiresAt);
  }
  return structuredClone(r) as Rights;
}
function ObjRights(v: unknown): Obj {
  const o = exact(
    v,
    ["kind"],
    [
      "settlementAsset",
      "expiresAt",
      "graceSeconds",
      "resolveDuringGrace",
      "manageDuringGrace",
      "renewal",
    ],
  );
  if (o.kind === "permanent") return exact(o, ["kind"]);
  need(o.kind === "lease", "RIGHTS");
  return exact(o, [
    "kind",
    "settlementAsset",
    "expiresAt",
    "graceSeconds",
    "resolveDuringGrace",
    "manageDuringGrace",
    "renewal",
  ]);
}
export interface NameEntry {
  name: string;
  key: string;
  generation: number;
  activeId: string | null;
  auctionId: string | null;
}
export interface Deed {
  id: string;
  name: string;
  generation: number;
  owner: string;
  ownerVersion: number;
  version: number;
  parentId: string | null;
  rights: Rights;
  rightsHash: string;
  expiry: number | null;
  renewals: number;
  retired: boolean;
  metadata: Metadata[];
  records: RecordValue[];
  recordsVersion: number;
  lock: string | null;
  encumbranceVersion: number;
}
export type RecordValue =
  | { type: "service"; url: string }
  | { type: "wallet"; chain: string; address: string }
  | { type: "ipfs"; cid: string };
export interface Auction {
  id: string;
  name: string;
  deedId: string | null;
  seller: string;
  asset: string;
  reserve: string;
  openAt: number;
  announcedAt: number;
  window: number;
  quiet: number;
  version: number;
  metadata: Metadata;
  encumbranceVersion: number;
  high: {
    payer: string;
    beneficiary: string;
    amount: string;
    at: number;
    bidId: string;
  } | null;
  status: "live" | "finalized" | "no-bid" | "cancelled";
}
export interface Offer {
  id: string;
  kind: "child" | "resale";
  parentId: string;
  owner: string;
  ownerVersion: number;
  deedVersion: number;
  encumbranceVersion: number;
  asset: string;
  price: string;
  validUntil: number;
  version: number;
  rights: Rights | null;
  labels: string[] | null;
  maxUses: number;
  uses: number;
  cancelled: boolean;
}
export interface Receipt {
  intentId: string;
  requestId: string;
  signer: string;
  sequence: number;
  time: number;
  status: "succeeded" | "rejected";
  code: string;
  result: any;
}
export interface State {
  revision: string;
  configHash: string;
  sequence: number;
  time: number;
  names: Record<string, NameEntry>;
  deeds: Record<string, Deed>;
  auctions: Record<string, Auction>;
  offers: Record<string, Offer>;
  balances: Record<string, Record<string, string>>;
  credits: Record<
    string,
    {
      auctionId: string;
      asset: string;
      payer: string;
      amount: string;
      version: number;
    }
  >;
  nonces: Record<string, number>;
  receipts: Record<string, Receipt>;
  requests: Record<string, string>;
  bids: Record<string, any>;
}
export function leaseEnd(d: Deed): number {
  if (d.rights.kind === "permanent") return Number.MAX_SAFE_INTEGER;
  const r = d.rights;
  return Math.max(
    d.expiry! + r.graceSeconds,
    r.renewal.kind === "guaranteed" && d.renewals < r.renewal.maxRenewals
      ? r.renewal.optionUntil
      : 0,
  );
}
export function canManage(d: Deed, time: number): boolean {
  return (
    !d.retired &&
    (d.rights.kind === "permanent" ||
      time < d.expiry! ||
      (d.rights.manageDuringGrace && time < d.expiry! + d.rights.graceSeconds))
  );
}
export function records(v: unknown): RecordValue[] {
  need(Array.isArray(v) && v.length <= 16, "RECORDS");
  for (const value of v) {
    const r = obj(value);
    if (r.type === "service") {
      exact(r, ["type", "url"]);
      let url: URL;
      try {
        url = new URL(text(r.url));
      } catch {
        throw new Fault("SERVICE_URL");
      }
      need(
        url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          ![...url.searchParams.keys()].some((k) =>
            /^(token|api.?key|password|secret|authorization)$/i.test(k),
          ),
        "SERVICE_URL",
      );
    } else if (r.type === "wallet") {
      exact(r, ["type", "chain", "address"]);
      text(r.chain, 64);
      text(r.address, 256);
    } else if (r.type === "ipfs") exact(r, ["type", "cid"]);
    else need(false, "RECORDS");
  }
  return structuredClone(v);
}
