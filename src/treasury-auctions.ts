import type { KeyObject } from "node:crypto";
import { Body, DOMAIN, Packet, signBody } from "./auth.js";
import { need } from "./core.js";
import { Engine } from "./engine.js";
import { cidFor } from "./metadata.js";
import { Receipt, rightsHash } from "./model.js";
import { normalizeName } from "./names.js";
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
