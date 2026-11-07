import { generateKeyPairSync } from "node:crypto";
import { Engine } from "../src/engine.js";
import { ManualClock } from "../src/clock.js";
import { Body, DOMAIN, publicPrincipal, signBody } from "../src/auth.js";
import { fixtureConfig } from "../src/config.js";
import { capabilities, prepare } from "../src/interface.js";
import { NORMALIZATION_HASH } from "../src/names.js";
import { cidFor } from "../src/metadata.js";
import { rightsHash, Rights } from "../src/model.js";
import { need } from "../src/core.js";

// Uses only newly generated unfunded fixture keys held in memory. No env,
// secret store, key file, external account, network request or upload is read.
export function publicDemoFixture() {
  const people = Object.fromEntries(
    ["issuer", "treasury", "alice", "bob", "carol"].map((role) => {
      const key = generateKeyPairSync("ed25519").privateKey;
      return [role, { id: publicPrincipal(key), key }];
    }),
  );
  const roles = Object.fromEntries(
    Object.entries(people).map(([role, p]) => [role, p.id]),
  );
  const config = fixtureConfig(roles.issuer!, roles.treasury!, [
    roles.alice!,
    roles.bob!,
    roles.carol!,
  ]);
  const clock = new ManualClock(1000000),
    e = new Engine(config, clock);
  let counter = 0;
  const witness = (
    name: string,
    r: Rights = { kind: "permanent" },
    parentId: string | null = null,
    description = "Synthetic fixture only — no live title or funds",
  ) => {
    const document = {
      schema: "poa-domains.metadata.v1",
      name,
      rightsHash: rightsHash(r, parentId),
      description,
    };
    return { cid: cidFor(document), document };
  };
  const send = (action: string, params: any, role = "alice") => {
    const who = people[role]!;
    const body: Body = {
      domain: DOMAIN,
      revision: config.revision,
      chainId: config.chainId,
      genesisHash: config.genesisHash,
      registryId: e.registryId,
      policyHash: e.policyHash,
      normalizationHash: NORMALIZATION_HASH,
      signer: who.id,
      coSigners: [],
      requestId: "fixture-" + ++counter,
      nonce: e.nextNonce(who.id),
      notBefore: 0,
      deadline: clock.now() + 1000000,
      maxTotal: "1000000000",
      maxNetworkFee: "0",
      action,
      params,
    };
    const r = e.submit(signBody(body, [who.key]));
    need(r.status === "succeeded", r.code);
    return r.result;
  };
  const announce = (name: string) =>
    send(
      "announceAuction",
      {
        name,
        asset: "POA",
        reserve: "100",
        openAt: clock.now() + 86400,
        expectedDeedId: null,
        expectedVersion: 0,
        metadata: witness(name),
      },
      "issuer",
    ).auctionId as string;
  const vp = (name: string) => {
    const s = e.snapshot(),
      d = s.deeds[s.names[name]!.activeId!]!;
    return { name, expectedDeedId: d.id, expectedVersion: d.version };
  };
  const alpha = announce("alpha");
  clock.advance(86400);
  send("bid", {
    auctionId: alpha,
    expectedVersion: 1,
    asset: "POA",
    amount: "100",
    beneficiary: roles.alice,
  });
  clock.advance(3600);
  send("finalize", { auctionId: alpha, expectedVersion: 2 }, "carol");
  const root = e.snapshot().deeds[e.snapshot().names.alpha!.activeId!]!;
  const grant = (label: string, r: Rights, buyer: string) => {
    const offerId = send("createChildOffer", {
      parent: "alpha",
      parentDeedId: root.id,
      expectedOwnerVersion: root.ownerVersion,
      asset: "POA",
      price: "200",
      validUntil: clock.now() + 3600,
      rights: r,
      labels: [label],
      maxUses: 1,
    }).offerId;
    send(
      "fillChildOffer",
      {
        offerId,
        expectedVersion: 1,
        expectedGeneration: 1,
        label,
        asset: "POA",
        amount: "200",
        metadata: witness(label + ".alpha", r, root.id),
      },
      buyer,
    );
  };
  grant("agent", { kind: "permanent" }, "bob");
  const lease: Rights = {
    kind: "lease",
    settlementAsset: "POA",
    expiresAt: clock.now() + 604800,
    graceSeconds: 86400,
    resolveDuringGrace: true,
    manageDuringGrace: false,
    renewal: {
      kind: "guaranteed",
      price: "50",
      termSeconds: 604800,
      windowSeconds: 86400,
      maxRenewals: 2,
      optionUntil: clock.now() + 691200,
    },
  };
  grant("rental", lease, "carol");
  send(
    "setRecords",
    {
      ...vp("agent.alpha"),
      records: [
        { type: "service", url: "https://example.invalid/synthetic-agent" },
        {
          type: "ipfs",
          cid: e.snapshot().deeds[vp("agent.alpha").expectedDeedId]!
            .metadata[0]!.cid,
        },
      ],
    },
    "bob",
  );
  const openOffer = send("createChildOffer", {
    parent: "alpha",
    parentDeedId: root.id,
    expectedOwnerVersion: root.ownerVersion,
    asset: "POA",
    price: "200",
    validUntil: clock.now() + 1000000,
    rights: { kind: "permanent" },
    labels: null,
    maxUses: 100,
  }).offerId;
  const orbit = announce("orbit"),
    vacant = announce("vacant");
  clock.advance(86400);
  send("bid", {
    auctionId: orbit,
    expectedVersion: 1,
    asset: "POA",
    amount: "100",
    beneficiary: roles.alice,
  });
  send(
    "bid",
    {
      auctionId: orbit,
      expectedVersion: 2,
      asset: "POA",
      amount: "111",
      beneficiary: roles.bob,
    },
    "bob",
  );
  const future = announce("future");
  const resale = send("sellFixed", {
    ...vp("alpha"),
    asset: "POA",
    price: "500",
    validUntil: clock.now() + 86400,
  }).offerId;
  const state = e.snapshot(),
    cap = capabilities(e);
  e.assertInvariants();
  const genericOffer = (id: string) => ({
    offerId: id,
    expectedVersion: state.offers[id]!.version,
  });
  const auction = (id: string) => ({
    auctionId: id,
    expectedVersion: state.auctions[id]!.version,
  });
  const examples: Record<string, { role: string; params: any }> = {
    announceAuction: {
      role: "issuer",
      params: {
        name: "stellar",
        asset: "POA",
        reserve: "100",
        openAt: clock.now() + 86400,
        expectedDeedId: null,
        expectedVersion: 0,
        metadata: witness("stellar"),
      },
    },
    bid: {
      role: "carol",
      params: {
        ...auction(orbit),
        asset: "POA",
        amount: "123",
        beneficiary: roles.carol,
      },
    },
    finalize: { role: "carol", params: auction(orbit) },
    closeNoBid: { role: "carol", params: auction(vacant) },
    cancelAuction: { role: "issuer", params: auction(future) },
    withdrawRefund: {
      role: "alice",
      params: {
        auctionId: orbit,
        asset: "POA",
        expectedVersion: 1,
        amount: "100",
      },
    },
    createChildOffer: {
      role: "alice",
      params: {
        parent: "alpha",
        parentDeedId: root.id,
        expectedOwnerVersion: root.ownerVersion,
        asset: "POA",
        price: "200",
        validUntil: clock.now() + 86400,
        rights: { kind: "permanent" },
        labels: ["newagent"],
        maxUses: 1,
      },
    },
    fillChildOffer: {
      role: "carol",
      params: {
        ...genericOffer(openOffer),
        expectedGeneration: 1,
        label: "newagent",
        asset: "POA",
        amount: "200",
        metadata: witness("newagent.alpha", { kind: "permanent" }, root.id),
      },
    },
    cancelOffer: { role: "alice", params: genericOffer(openOffer) },
    sellFixed: {
      role: "bob",
      params: {
        ...vp("agent.alpha"),
        asset: "POA",
        price: "300",
        validUntil: clock.now() + 86400,
      },
    },
    buyFixed: {
      role: "carol",
      params: { ...genericOffer(resale), asset: "POA", amount: "500" },
    },
    transfer: {
      role: "bob",
      params: { ...vp("agent.alpha"), recipient: roles.carol },
    },
    setRecords: {
      role: "bob",
      params: {
        ...vp("agent.alpha"),
        records: [
          { type: "service", url: "https://example.invalid/synthetic-agent" },
        ],
      },
    },
    setMetadata: {
      role: "alice",
      params: {
        ...vp("alpha"),
        metadata: witness(
          "alpha",
          { kind: "permanent" },
          null,
          "Synthetic replacement metadata example",
        ),
      },
    },
    renewLease: {
      role: "carol",
      params: {
        ...vp("rental.alpha"),
        asset: "POA",
        amount: "50",
        termSeconds: 604800,
      },
    },
    expireLease: { role: "bob", params: vp("rental.alpha") },
    revokeChild: {
      role: "bob",
      params: { ...vp("agent.alpha"), parentOwnerVersion: root.ownerVersion },
    },
  };
  const inputs = Object.fromEntries(
    Object.entries(examples).map(([action, x]) => {
      const input = {
        signer: roles[x.role]!,
        coSigners: action === "revokeChild" ? [roles.alice!] : [],
        requestId: "demo-handoff-" + action,
        nonce: e.nextNonce(roles[x.role]!),
        notBefore: 0,
        deadline: clock.now() + 86400,
        maxTotal: ["bid", "fillChildOffer", "buyFixed", "renewLease"].includes(
          action,
        )
          ? String(x.params.amount)
          : "0",
        maxNetworkFee: "0",
        action,
        params: x.params,
      };
      prepare(input, cap);
      return [action, input];
    }),
  );
  // Only public state/capabilities/inert example inputs escape. Keys die with this scope.
  const result = {
    state: {
      state,
      stateHash: e.stateHash(),
      observedServerTime: null,
      finality: "synthetic-snapshot-not-chain-finality",
      durability: "public-static-fixture",
    },
    capabilities: {
      ...cap,
      mode: "static-synthetic-demo",
      durability: "public-static-fixture",
    },
    examples: inputs,
    details: {
      mode: "static-synthetic-demo",
      generatedAt: new Date().toISOString(),
      roles,
      fixtureTime: clock.now(),
      keysDiscarded: true,
      livePoA: false,
      apiEndpoint: null,
    },
  };
  e.close();
  return result;
}
