// Shared reference-showcase initialization. No filesystem or network dependencies.
import { KeyObject } from "node:crypto";
import { Clock } from "./clock.js";
import { signBody } from "./auth.js";
import { Engine } from "./engine.js";
import { capabilities, prepare } from "./interface.js";
import { cidFor } from "./metadata.js";
import { Rights, rightsHash } from "./model.js";
import { need } from "./core.js";
const ROLES = ["issuer", "treasury", "alice", "bob", "carol"] as const;
export class BootableSystemClock implements Clock {
  overrideTime: number | null = null;
  now(): number {
    return this.overrideTime ?? Math.floor(Date.now() / 1000);
  }
}

function makeWitness(
  name: string,
  r: Rights = { kind: "permanent" },
  parentId: string | null = null,
  description = "PoA Domains Registry title metadata",
) {
  const document = {
    schema: "poa-domains.metadata.v1",
    name,
    rightsHash: rightsHash(r, parentId),
    description,
  };
  return { cid: cidFor(document), document };
}

export function seedRegistry(engine: Engine, clock: BootableSystemClock, principals: Record<string,string>, keys: Record<string,KeyObject>, seed = true): void {
  try {
    if (
      seed &&
      engine.snapshot().sequence === 0 &&
      keys.issuer &&
      keys.alice &&
      keys.bob &&
      keys.carol
    ) {
      const cap = capabilities(engine);
      let reqCounter = 0;
      const submitAs = (
        role: (typeof ROLES)[number],
        action: string,
        params: Record<string, any>,
      ) => {
        const signer = principals[role]!;
        const key = keys[role]!;
        const t = clock.now();
        const body = prepare(
          {
            signer,
            coSigners: [],
            requestId: `seed-${++reqCounter}`,
            nonce: engine.nextNonce(signer),
            notBefore: 0,
            deadline: t + 600000,
            maxTotal: "10000000000",
            maxNetworkFee: "0",
            action,
            params,
          },
          cap,
        );
        const receipt = engine.submit(signBody(body, [key]));
        need(receipt.status === "succeeded", receipt.code);
        return receipt.result;
      };

      const baseNow = Math.max(1000000, Math.floor(Date.now() / 1000) - 200000);
      clock.overrideTime = baseNow;

      const emojiRoot = "👩‍🦰";
      const emojiAuction = submitAs("issuer", "announceAuction", {
        name: emojiRoot,
        asset: "POA",
        reserve: "100000",
        openAt: baseNow + 86400,
        expectedDeedId: null,
        expectedVersion: 0,
        metadata: makeWitness(emojiRoot),
      }).auctionId as string;

      const asciiRoot = "nexus";
      const asciiAuction = submitAs("issuer", "announceAuction", {
        name: asciiRoot,
        asset: "POA",
        reserve: "1000",
        openAt: baseNow + 86400,
        expectedDeedId: null,
        expectedVersion: 0,
        metadata: makeWitness(asciiRoot),
      }).auctionId as string;

      const liveAuction = submitAs("issuer", "announceAuction", {
        name: "🌐",
        asset: "POA",
        reserve: "100000",
        openAt: baseNow + 172800,
        expectedDeedId: null,
        expectedVersion: 0,
        metadata: makeWitness("🌐"),
      }).auctionId as string;

      const multiEmojiAuction = submitAs("issuer", "announceAuction", {
        name: "🚀🚀",
        asset: "POA",
        reserve: "1000",
        openAt: baseNow + 172800,
        expectedDeedId: null,
        expectedVersion: 0,
        metadata: makeWitness("🚀🚀"),
      }).auctionId as string;

      clock.overrideTime = baseNow + 86400;
      submitAs("alice", "bid", {
        auctionId: emojiAuction,
        expectedVersion: 1,
        asset: "POA",
        amount: "100000",
        beneficiary: principals.alice!,
      });
      submitAs("alice", "bid", {
        auctionId: asciiAuction,
        expectedVersion: 1,
        asset: "POA",
        amount: "1000",
        beneficiary: principals.alice!,
      });

      clock.overrideTime = baseNow + 172800;
      const emojiDeedId = submitAs("bob", "finalize", {
        auctionId: emojiAuction,
        expectedVersion: 2,
      }).deedId as string;
      const asciiDeedId = submitAs("bob", "finalize", {
        auctionId: asciiAuction,
        expectedVersion: 2,
      }).deedId as string;

      clock.overrideTime = baseNow + 172850;
      submitAs("carol", "bid", {
        auctionId: liveAuction,
        expectedVersion: 1,
        asset: "POA",
        amount: "100000",
        beneficiary: principals.carol!,
      });
      submitAs("bob", "bid", {
        auctionId: multiEmojiAuction,
        expectedVersion: 1,
        asset: "POA",
        amount: "1000",
        beneficiary: principals.bob!,
      });

      clock.overrideTime = baseNow + 172900;
      submitAs("alice", "setRecords", {
        name: asciiRoot,
        expectedDeedId: asciiDeedId,
        expectedVersion: 1,
        records: [
          { type: "service", url: "https://nexus.poa.domains/agent" },
          {
            type: "wallet",
            chain: "poa-mainnet-1",
            address: principals.alice!,
          },
        ],
      });

      submitAs("alice", "createChildOffer", {
        parent: asciiRoot,
        parentDeedId: asciiDeedId,
        expectedOwnerVersion: 1,
        asset: "POA",
        price: "250",
        validUntil: baseNow + 800000,
        rights: { kind: "permanent" },
        labels: null,
        maxUses: 10,
      });

      const childOfferId = submitAs("alice", "createChildOffer", {
        parent: emojiRoot,
        parentDeedId: emojiDeedId,
        expectedOwnerVersion: 1,
        asset: "POA",
        price: "500",
        validUntil: baseNow + 500000,
        rights: { kind: "permanent" },
        labels: ["🫪"],
        maxUses: 1,
      }).offerId as string;

      const childName = `🫪.${emojiRoot}`;
      const childDeedId = submitAs("bob", "fillChildOffer", {
        offerId: childOfferId,
        expectedVersion: 1,
        expectedGeneration: 1,
        label: "🫪",
        asset: "POA",
        amount: "500",
        metadata: makeWitness(childName, { kind: "permanent" }, emojiDeedId),
      }).deedId as string;

      submitAs("bob", "sellFixed", {
        name: childName,
        expectedDeedId: childDeedId,
        expectedVersion: 1,
        asset: "POA",
        price: "2500",
        validUntil: baseNow + 800000,
      });
    }
  } catch (err) {
    engine.close();
    throw err;
  } finally {
    clock.overrideTime = null;
  }

}
