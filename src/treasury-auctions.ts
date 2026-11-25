import { sign, type KeyObject } from "node:crypto";
import { Body, DOMAIN, Packet, signBody } from "./auth.js";
import { canonical, need } from "./core.js";
import { Engine } from "./engine.js";
import { cidFor } from "./metadata.js";
import { Receipt, rightsHash } from "./model.js";
import { normalizeName } from "./names.js";
import { base58 } from "./native-crypto.js";
import { POA_NEW_NAME_PRICES } from "./new-name-prices.js";
import { BootableSystemClock } from "./seed.js";

/** Opening reserve for Treasury-released Crypto & AI root auctions: 100 POA (standard) or 1,000 POA (premium 2-3 char). */
export const TREASURY_AUCTION_RESERVE_POA = POA_NEW_NAME_PRICES.standard;
export function treasuryAuctionReservePoa(name: string): string {
  return normalizeName(name).tier === "premium" ? POA_NEW_NAME_PRICES.premium : POA_NEW_NAME_PRICES.standard;
}

/** Top 50 popular AI single-word root names (all verified outside DEFAULT_RESERVED_NAMES). */
export const TREASURY_AI_AUCTION_NAMES: readonly string[] = Object.freeze([
  "ai",
  "agi",
  "asi",
  "genai",
  "llm",
  "agent",
  "agents",
  "agentic",
  "model",
  "models",
  "neural",
  "prompt",
  "prompts",
  "inference",
  "training",
  "weights",
  "tensor",
  "transformer",
  "attention",
  "embedding",
  "vector",
  "rag",
  "finetune",
  "rlhf",
  "lora",
  "alignment",
  "reasoning",
  "context",
  "diffusion",
  "multimodal",
  "vision",
  "voice",
  "robotics",
  "robot",
  "bot",
  "bots",
  "swarm",
  "autonomous",
  "autonomy",
  "compute",
  "gpu",
  "tpu",
  "npu",
  "cluster",
  "synthetic",
  "dataset",
  "benchmark",
  "evals",
  "chatbot",
  "singularity",
]);

/** Top 50 popular Crypto & Web3 single-word root names (all verified outside DEFAULT_RESERVED_NAMES). */
export const TREASURY_CRYPTO_AUCTION_NAMES: readonly string[] = Object.freeze([
  "defi",
  "web3",
  "blockchain",
  "dapp",
  "token",
  "tokens",
  "coin",
  "coins",
  "altcoin",
  "stablecoin",
  "memecoin",
  "nft",
  "nfts",
  "dao",
  "dex",
  "cex",
  "amm",
  "tvl",
  "apr",
  "apy",
  "yield",
  "staking",
  "stake",
  "restaking",
  "liquidity",
  "bridge",
  "rollup",
  "layer2",
  "l2",
  "zk",
  "zkp",
  "mev",
  "gas",
  "mempool",
  "ledger",
  "consensus",
  "hash",
  "hashrate",
  "merkle",
  "halving",
  "perps",
  "rwa",
  "depin",
  "onchain",
  "mint",
  "mining",
  "multisig",
  "hodl",
  "degen",
  "whale",
]);

/** Complete 100-name Treasury Crypto & AI auction release catalog. */
export const TREASURY_CRYPTO_AI_AUCTION_NAMES: readonly string[] = Object.freeze([
  ...TREASURY_AI_AUCTION_NAMES,
  ...TREASURY_CRYPTO_AUCTION_NAMES,
]);

export interface ProvisionedTreasuryDomain {
  name: string;
  packet: Packet;
  receipt: Receipt;
}

export function treasuryInventoryRequestId(name: string): string {
  return `treasury-inventory-${name}-v1`;
}

/**
 * Idempotently acquire each unclaimed, non-reserved Crypto & AI domain under the registry's
 * treasury principal so it can be immediately listed for first-bid POA auction.
 * Safely skips any name already owned (including previously sold domains), reserved, or in auction.
 */
export function provisionTreasuryAuctionDomains(
  engine: Engine,
  clock: BootableSystemClock,
  treasuryKey: KeyObject,
  names: readonly string[] = TREASURY_CRYPTO_AI_AUCTION_NAMES,
): ProvisionedTreasuryDomain[] {
  const treasury = engine.config.treasury;
  const reservedSet = new Set(engine.config.reserved);
  const rootRightsHash = rightsHash({ kind: "permanent" }, null);
  const provisioned: ProvisionedTreasuryDomain[] = [];
  const prevOverride = clock.overrideTime;
  try {
    for (const name of names) {
      if (reservedSet.has(name)) continue;
      const snap = engine.snapshot();
      const requestId = treasuryInventoryRequestId(name);
      if (snap.requests[`${treasury}:${requestId}`]) continue;
      if (snap.names[name]?.activeId || snap.names[name]?.auctionId) continue;
      if (engine.ownershipConflict(name) !== null) continue;
      const nowSec = Math.max(Math.floor(Date.now() / 1000), snap.time);
      clock.overrideTime = nowSec;
      const doc = {
        schema: "poa-domains.metadata.v1",
        name,
        rightsHash: rootRightsHash,
        description: `PoA Domains Treasury auction inventory for ${name}.`,
      };
      const body: Body = {
        domain: DOMAIN,
        revision: engine.config.revision,
        chainId: engine.config.chainId,
        genesisHash: engine.config.genesisHash,
        registryId: engine.registryId,
        policyHash: engine.policyHash,
        normalizationHash: engine.config.normalizationHash,
        signer: treasury,
        coSigners: [],
        requestId,
        nonce: engine.nextNonce(treasury),
        notBefore: 0,
        deadline: nowSec + 600,
        maxTotal: "0",
        maxNetworkFee: "0",
        action: "issueTreasuryInventory",
        params: {
          name,
          expectedVersion: 0,
          expectedDeedId: null,
          metadata: { cid: cidFor(doc), document: doc },
        },
      };
      const packet = signBody(body, [treasuryKey]);
      const receipt = engine.submit(packet);
      need(receipt.status === "succeeded", receipt.code);
      provisioned.push({ name, packet, receipt });
    }
  } finally {
    clock.overrideTime = prevOverride;
  }
  return provisioned;
}

export interface TreasuryHandoverAuctionView {
  id: string;
  name: string;
  seller: string;
  status: "OPEN" | "CANCELLED" | "SETTLING" | "COMPLETE";
  closes: number;
  high: { payer: string; amount: string } | null;
}

export interface TreasuryHandoverSettlementView {
  status: "PAYING" | "TITLE_PENDING" | "COMPLETE";
  packet?: { body?: { deadline?: number } } | null;
}

export interface TreasuryHandoverCommand {
  action: "settle" | "repair-title";
  auctionId: string;
  name: string;
  packet: {
    command: {
      domain: "poa-domains.escrow.v1";
      chainId: string;
      registryId: string;
      actor: string;
      key: string;
      expires: number;
      action: "settle" | "repair-title";
      params: { auction: string; transfer: Packet };
    };
    signature: string;
  };
}

/**
 * Pick the next Treasury auction handover to submit (auto-repairing TITLE_PENDING or
 * expiring PAYING consents first, otherwise settling the earliest closed won auction)
 * and build the locally signed escrow command + 7-day registry transfer packet.
 */
export function buildTreasuryAutoHandover(input: {
  engine: Engine;
  treasuryKey: KeyObject;
  auctions: Record<string, TreasuryHandoverAuctionView>;
  settlements: Record<string, TreasuryHandoverSettlementView>;
  nowMs: number;
  chainId?: string;
}): TreasuryHandoverCommand | null {
  const { engine, treasuryKey, auctions, settlements, nowMs, chainId = "poa-mainnet-1" } = input;
  const treasury = engine.config.treasury;
  const snap = engine.snapshot();
  const nowSec = Math.max(Math.floor(nowMs / 1000), snap.time);

  let target: { id: string; name: string; high: { payer: string; amount: string } } | null = null;
  let action: "settle" | "repair-title" = "settle";

  const settling = Object.values(auctions).find((a) => a.status === "SETTLING" && a.seller === treasury);
  if (settling) {
    const st = settlements[settling.id];
    const deadline = st?.packet?.body?.deadline;
    const needsRepair =
      Boolean(st && settling.high) &&
      (st!.status === "TITLE_PENDING" ||
        (st!.status === "PAYING" && (typeof deadline !== "number" || deadline <= nowSec + 600)));
    if (!needsRepair || !settling.high) return null;
    target = { id: settling.id, name: settling.name, high: settling.high };
    action = "repair-title";
  } else {
    const ready = Object.values(auctions)
      .filter((a) => a.status === "OPEN" && a.seller === treasury && a.high !== null && a.closes > 0 && nowMs >= a.closes)
      .sort((a, b) => a.closes - b.closes || a.id.localeCompare(b.id))[0];
    if (!ready || !ready.high) return null;
    target = { id: ready.id, name: ready.name, high: ready.high };
    action = "settle";
  }

  const deedId = snap.names[target.name]?.activeId;
  const deed = deedId ? snap.deeds[deedId] : null;
  if (!deed || deed.owner !== treasury || deed.retired) return null;

  const requestId =
    action === "repair-title"
      ? `treasury-repair-${target.id.slice(0, 24)}-${nowSec}`
      : `treasury-settle-${target.id.slice(0, 32)}`;
  const key =
    action === "repair-title"
      ? `treasury_repair_${target.id.slice(0, 24)}_${nowSec}`
      : `treasury_settle_${target.id.slice(0, 44)}`;
  const transfer = signBody(
    {
      domain: DOMAIN,
      revision: engine.config.revision,
      chainId: engine.config.chainId,
      genesisHash: engine.config.genesisHash,
      registryId: engine.registryId,
      policyHash: engine.policyHash,
      normalizationHash: engine.config.normalizationHash,
      signer: treasury,
      coSigners: [],
      requestId,
      nonce: engine.nextNonce(treasury),
      notBefore: 0,
      deadline: nowSec + 7 * 86400,
      maxTotal: "0",
      maxNetworkFee: "0",
      action: "transfer",
      params: {
        name: target.name,
        expectedDeedId: deed.id,
        expectedVersion: deed.version,
        recipient: target.high.payer,
      },
    },
    [treasuryKey],
  );
  const command = {
    domain: "poa-domains.escrow.v1" as const,
    chainId,
    registryId: engine.registryId,
    actor: treasury,
    key,
    expires: nowSec + 600,
    action,
    params: { auction: target.id, transfer },
  };
  const signature = base58(sign(null, Buffer.from(canonical(command)), treasuryKey));
  return { action, auctionId: target.id, name: target.name, packet: { command, signature } };
}
