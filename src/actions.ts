// Required payload keys; exact execution validation lives in engine.ts.
export const ACTIONS = {
  announceAuction: [
    "name",
    "asset",
    "reserve",
    "openAt",
    "expectedVersion",
    "expectedDeedId",
    "metadata",
  ],
  bid: ["auctionId", "expectedVersion", "asset", "amount", "beneficiary"],
  finalize: ["auctionId", "expectedVersion"],
  closeNoBid: ["auctionId", "expectedVersion"],
  cancelAuction: ["auctionId", "expectedVersion"],
  withdrawRefund: ["auctionId", "asset", "expectedVersion", "amount"],
  createChildOffer: [
    "parent",
    "parentDeedId",
    "expectedOwnerVersion",
    "asset",
    "price",
    "validUntil",
    "rights",
    "labels",
    "maxUses",
  ],
  fillChildOffer: [
    "offerId",
    "expectedVersion",
    "expectedGeneration",
    "label",
    "asset",
    "amount",
    "metadata",
  ],
  cancelOffer: ["offerId", "expectedVersion"],
  sellFixed: [
    "name",
    "expectedDeedId",
    "expectedVersion",
    "asset",
    "price",
    "validUntil",
  ],
  buyFixed: ["offerId", "expectedVersion", "asset", "amount"],
  transfer: ["name", "expectedDeedId", "expectedVersion", "recipient"],
  setRecords: ["name", "expectedDeedId", "expectedVersion", "records"],
  setMetadata: ["name", "expectedDeedId", "expectedVersion", "metadata"],
  renewLease: [
    "name",
    "expectedDeedId",
    "expectedVersion",
    "asset",
    "amount",
    "termSeconds",
  ],
  expireLease: ["name", "expectedDeedId", "expectedVersion"],
  revokeChild: [
    "name",
    "expectedDeedId",
    "expectedVersion",
    "parentOwnerVersion",
  ],
} as const;
export type Action = keyof typeof ACTIONS;
// Escrow-only primary issuance paid in POA through the escrow ledger. NOT a public action: absent from
// discovery/quotes/prepare; public submit and preview refuse it (ESCROW_ONLY).
export const ESCROW_ONLY_ACTIONS = {
  issueFromTreasury: ["name", "asset", "price", "expectedVersion", "expectedDeedId", "metadata"],
} as const;
