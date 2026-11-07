import { generateKeyPairSync, KeyObject } from "node:crypto";
import { Engine } from "../src/engine.js";
import {
  Body,
  Packet,
  publicPrincipal,
  signBody,
  DOMAIN,
} from "../src/auth.js";
import { fixtureConfig, Config } from "../src/config.js";
import { ManualClock } from "../src/clock.js";
import { NORMALIZATION_HASH, normalizeName } from "../src/names.js";
import { cidFor, Metadata } from "../src/metadata.js";
import { rightsHash, Rights, Deed } from "../src/model.js";
export function actor(): { id: string; key: KeyObject } {
  const key = generateKeyPairSync("ed25519").privateKey;
  return { id: publicPrincipal(key), key };
}
export function witness(
  name: string,
  r: Rights = { kind: "permanent" },
  parentId: string | null = null,
  description = "Synthetic local test metadata",
): Metadata {
  const document = {
    schema: "poa-domains.metadata.v1",
    name,
    rightsHash: rightsHash(r, parentId),
    description,
  };
  return { cid: cidFor(document), document };
}
export function setup(change?: (c: Config) => void) {
  const issuer = actor(),
    treasury = actor(),
    alice = actor(),
    bob = actor(),
    carol = actor();
  const config = fixtureConfig(issuer.id, treasury.id, [
    alice.id,
    bob.id,
    carol.id,
  ]);
  change?.(config);
  const clock = new ManualClock(1000000);
  const e = new Engine(config, clock);
  let counter = 0;
  const packet = (
    action: string,
    params: any,
    who = alice,
    override: Partial<Body> = {},
    co: ReturnType<typeof actor>[] = [],
  ): Packet => {
    const body: Body = {
      domain: DOMAIN,
      revision: config.revision,
      chainId: config.chainId,
      genesisHash: config.genesisHash,
      registryId: e.registryId,
      policyHash: e.policyHash,
      normalizationHash: NORMALIZATION_HASH,
      signer: who.id,
      coSigners: co.map((x) => x.id).sort(),
      requestId: "test-" + ++counter,
      nonce: e.nextNonce(who.id),
      notBefore: 0,
      deadline: clock.now() + 1000000,
      maxTotal: "1000000000000",
      maxNetworkFee: "0",
      action,
      params,
      ...override,
    };
    return signBody(body, [who.key, ...co.map((x) => x.key)]);
  };
  const send = (...args: Parameters<typeof packet>) =>
    e.submit(packet(...args));
  const deed = (name: string): Deed => {
    const state = e.snapshot();
    return state.deeds[state.names[name]!.activeId!]!;
  };
  const vp = (name: string) => {
    const d = deed(name);
    return { name, expectedDeedId: d.id, expectedVersion: d.version };
  };
  const announce = (name = "alpha") => {
    const n = normalizeName(name);
    const result = send(
      "announceAuction",
      {
        name: n.canonical,
        asset: "POA",
        reserve: n.tier === "premium" ? "1000" : "100",
        openAt: clock.now() + 86400,
        expectedDeedId: null,
        expectedVersion: 0,
        metadata: witness(n.canonical),
      },
      issuer,
    );
    if (result.status !== "succeeded") throw Error(result.code);
    return result.result.auctionId as string;
  };
  const win = (name = "alpha", who = alice) => {
    const id = announce(name);
    clock.set(e.snapshot().auctions[id]!.openAt);
    let a = e.snapshot().auctions[id]!;
    let r = send(
      "bid",
      {
        auctionId: id,
        expectedVersion: a.version,
        asset: "POA",
        amount: a.reserve,
        beneficiary: who.id,
      },
      who,
    );
    if (r.status !== "succeeded") throw Error(r.code);
    a = e.snapshot().auctions[id]!;
    clock.set(e.closeEligible(a));
    r = send("finalize", { auctionId: id, expectedVersion: a.version }, bob);
    if (r.status !== "succeeded") throw Error(r.code);
    return deed(name);
  };
  const offer = (
    r: Rights = { kind: "permanent" },
    labels: string[] | null = ["agent"],
    parent = "alpha",
    who = alice,
  ) => {
    const d = deed(parent);
    const res = send(
      "createChildOffer",
      {
        parent,
        parentDeedId: d.id,
        expectedOwnerVersion: d.ownerVersion,
        asset: "POA",
        price: "200",
        validUntil: r.kind === "lease" ? r.expiresAt : clock.now() + 86400,
        rights: r,
        labels,
        maxUses: 100,
      },
      who,
    );
    if (res.status !== "succeeded") throw Error(res.code);
    return res.result.offerId as string;
  };
  const fill = (offerId: string, label = "agent", who = bob) => {
    const s = e.snapshot(),
      o = s.offers[offerId]!,
      root = s.deeds[o.parentId]!,
      name = label + "." + root.name;
    return send(
      "fillChildOffer",
      {
        offerId,
        expectedVersion: o.version,
        expectedGeneration: (s.names[name]?.generation ?? 0) + 1,
        label,
        asset: o.asset,
        amount: o.price,
        metadata: witness(name, o.rights!, root.id),
      },
      who,
    );
  };
  return {
    e,
    clock,
    config,
    issuer,
    treasury,
    alice,
    bob,
    carol,
    packet,
    send,
    deed,
    vp,
    announce,
    win,
    offer,
    fill,
  };
}
export function lease(
  now: number,
  overrides: Partial<Extract<Rights, { kind: "lease" }>> = {},
): Extract<Rights, { kind: "lease" }> {
  return {
    kind: "lease",
    settlementAsset: "POA",
    expiresAt: now + 3600,
    graceSeconds: 100,
    resolveDuringGrace: false,
    manageDuringGrace: false,
    renewal: {
      kind: "guaranteed",
      price: "50",
      termSeconds: 3600,
      windowSeconds: 1000,
      maxRenewals: 2,
      optionUntil: now + 7200,
    },
    ...overrides,
  };
}
