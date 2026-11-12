import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  AGENT_CART_SCHEMA,
  buildAgentCartHandoff,
  buildAgentCartPrompt,
  buildAgentCheckoutHandoff,
  renderAgentCartHandoff,
  validateAgentCartHandoff,
} from "../reference-web/agent-cart.js";
import {
  buildCartItem,
  editCartAmount,
  canonical,
} from "../reference-web/shared.js";
import { profileEngine, SIGNER } from "./fixtures/ui-harness.mjs";
import { capabilities } from "../dist/src/interface.js";
import { hash } from "../dist/src/core.js";
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const schema = ajv.compile(AGENT_CART_SCHEMA);
function setup(profile = "fixture") {
  const e = profileEngine(profile),
    cap = capabilities(e),
    snapshot = {
      state: e.snapshot(),
      stateHash: e.stateHash(),
      observedServerTime: 1000000,
    };
  const items = ["alpha", "bravo"].map((name) =>
    buildCartItem({ name, action: "announceAuction+bid" }, cap, snapshot.state),
  );
  items[0] = editCartAmount(
    items[0],
    (BigInt(items[0].amount) * 3n).toString(),
    cap,
    snapshot.state,
  );
  return {
    cap,
    snapshot,
    items,
    args: [
      items,
      cap,
      SIGNER,
      "http://127.0.0.1:8787",
      "local-reference-only",
      snapshot,
      1000000000,
    ],
  };
}
const payloadFrom = (text) =>
  JSON.parse(text.split("```json\n")[1].split("\n```")[0]);
test("filtered public view builds with its complete-stored-state hash; unscoped mismatches still fail", async () => {
  const t = setup(),
    stored = "a".repeat(64),
    view = { filtered: true, policy: "audited-test-records-v1", stateHashScope: "complete-stored-state", sequenceScope: "complete-stored-state" },
    snapshot = { ...t.snapshot, stateHash: stored, publicView: view },
    args = (s) => [t.items, t.cap, SIGNER, "http://127.0.0.1:8787", "live-registry", s, 1000000000],
    data = await buildAgentCartHandoff(...args(snapshot));
  assert.equal(data.stateHash, stored);
  assert.equal(data.livePoA, false);
  assert.equal(data.unsigned, true);
  assert.ok(schema(data), ajv.errorsText(schema.errors));
  assert.equal(await validateAgentCartHandoff(data), true);
  await assert.rejects(buildAgentCartHandoff(...args({ ...t.snapshot, stateHash: stored })), /state hash mismatch/);
  await assert.rejects(buildAgentCartHandoff(...args({ ...snapshot, publicView: { ...view, stateHashScope: "public-view" } })), /state hash mismatch/);
  await assert.rejects(buildAgentCartHandoff(...args({ ...snapshot, stateHash: "bad" })), /Refresh registry state/);
});
test("single source schemas, golden v2, exact identity/snapshot and one text/JSON contract under both profiles", async () => {
  for (const file of [
    "docs/schemas/agent-cart-v2.schema.json",
    "reference-web/agent-cart-v2.schema.json",
  ])
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), AGENT_CART_SCHEMA);
  for (const profile of ["fixture", "mainnet"]) {
    const t = setup(profile),
      data = await buildAgentCartHandoff(...t.args);
    assert.ok(schema(data), ajv.errorsText(schema.errors));
    assert.equal(await validateAgentCartHandoff(data), true);
    assert.equal(data.stateHash, t.snapshot.stateHash);
    assert.equal(data.sequence, t.snapshot.state.sequence);
    assert.equal(data.genesisHash, t.cap.genesisHash);
    assert.equal(data.observedServerTime, 1000000);
    assert.equal(data.items[0].params.reserve, t.items[0].params.reserve);
    assert.equal(data.items[0].maxTotal, t.items[0].amount);
    assert.equal(data.items[0].operations[0].maxTotal, "0");
    assert.equal(data.items[0].operations[1].maxTotal, t.items[0].amount);
    assert.notEqual(
      data.items[0].operations[0].requestId,
      data.items[0].operations[1].requestId,
    );
    const prompt = await buildAgentCartPrompt(...t.args),
      checkout = await buildAgentCheckoutHandoff(...t.args);
    assert.equal(prompt, checkout);
    assert.deepEqual(payloadFrom(prompt), data);
    assert.equal(prompt, renderAgentCartHandoff(data));
    assert.ok(
      prompt.indexOf("Remote MCP first:") < prompt.indexOf("CLI second:"),
    );
    if (profile === "fixture")
      assert.equal(
        prompt,
        readFileSync("test/fixtures/agent-cart-v2.txt", "utf8"),
      );
    for (const item of data.items) {
      assert.equal(item.steps.length, 4);
      assert.match(
        item.steps.join(" "),
        /UNKNOWN.*exact same packet.*never a new requestId/,
      );
    }
  }
});
test("SHA-256 request IDs ignore generation time, unrelated state commits and cart ordering but bind semantic caps/versions/identity", async () => {
  const t = setup(),
    first = await buildAgentCartHandoff(...t.args),
    again = await buildAgentCartHandoff(...t.args.slice(0, 6), 1000060000);
  assert.deepEqual(
    first.items.map((x) => x.requestId),
    again.items.map((x) => x.requestId),
  );
  const state = structuredClone(t.snapshot.state);
  state.sequence++;
  const changedSnapshot = { state, stateHash: hash("local-state/v1", state) };
  const next = await buildAgentCartHandoff(
    t.items,
    t.cap,
    SIGNER,
    t.args[3],
    t.args[4],
    changedSnapshot,
    1000060000,
  );
  assert.deepEqual(
    first.items.map((x) => x.requestId),
    next.items.map((x) => x.requestId),
  );
  assert.notEqual(first.stateHash, next.stateHash);
  const reordered = await buildAgentCartHandoff(
    [...t.items].reverse(),
    ...t.args.slice(1),
  );
  assert.equal(reordered.items[1].requestId, first.items[0].requestId);
  const item = first.items[0],
    stable = {
      name: item.name,
      action: item.action,
      asset: item.asset,
      amount: item.amount,
      maxTotal: item.maxTotal,
      maxNetworkFee: item.maxNetworkFee,
      tier: item.tier,
      isRoot: item.isRoot,
      params: item.params,
    };
  const identity = Object.fromEntries(
    [
      "chainId",
      "revision",
      "genesisHash",
      "registryId",
      "policyHash",
      "normalizationHash",
    ].map((k) => [k, t.cap[k]]),
  );
  assert.equal(
    item.requestId,
    createHash("sha256")
      .update(
        canonical([
          "poa-domains.agent-cart.item.v2",
          { ...identity, signerPrincipal: SIGNER, ...stable },
        ]),
      )
      .digest("hex"),
  );
  const edited = [
    editCartAmount(t.items[0], "400", t.cap, t.snapshot.state),
    t.items[1],
  ];
  assert.notEqual(
    (await buildAgentCartHandoff(edited, ...t.args.slice(1))).items[0]
      .requestId,
    item.requestId,
  );
  const changedCap = { ...t.cap, policyHash: "a".repeat(64) };
  assert.notEqual(
    (await buildAgentCartHandoff(t.items, changedCap, ...t.args.slice(2)))
      .items[0].requestId,
    item.requestId,
  );
});
test("each asset has an exact independent aggregate cap; unknown operations remain budget-reserved; fees are included, never guessed", async () => {
  const t = setup();
  const bid = {
    name: "charlie",
    action: "bid",
    asset: "TEST",
    amount: "42",
    tier: "standard",
    isRoot: true,
    summary: "Test asset bid",
    params: {
      auctionId: "a".repeat(64),
      expectedVersion: 4,
      asset: "TEST",
      amount: "42",
    },
  };
  const data = await buildAgentCartHandoff(
    [...t.items, bid],
    ...t.args.slice(1),
  );
  assert.deepEqual(data.spendingCapByAsset, { POA: "400", TEST: "42" });
  assert.equal(data.items[2].operations.length, 1);
  assert.equal(data.items[2].params.beneficiary, SIGNER);
  assert.ok(schema(data), ajv.errorsText(schema.errors));
  assert.equal(await validateAgentCartHandoff(data), true);
  assert.match(data.rules.budget, /committed and unknown/);
  const altered = structuredClone(data);
  altered.spendingCapByAsset.POA = "399";
  await assert.rejects(() => validateAgentCartHandoff(altered), /Whole-cart/);
  const big = (2n ** 127n - 1n).toString(),
    items = t.items.map((i) => ({
      ...i,
      amount: big,
      params: { ...i.params, maxBid: big },
    }));
  await assert.rejects(
    () => buildAgentCartHandoff(items, ...t.args.slice(1)),
    /cap/,
  );
});
test("corrupt or contradictory plans cannot relax caps, operation identity/dependency or receipt retry rules", async () => {
  const original = await buildAgentCartHandoff(...setup().args);
  for (const mutate of [
    (d) => (d.schema = "old"),
    (d) => (d.stateHash = "bad"),
    (d) => (d.items[0].requestId = "f".repeat(64)),
    (d) => (d.items[0].maxTotal = "301"),
    (d) => (d.items[0].operations[0].maxTotal = "1"),
    (d) => (d.items[0].operations[1].expectedVersion = 2),
    (d) => (d.items[0].operations[1].auctionIdFrom = null),
    (d) => (d.rules.retry = "new requestId"),
    (d) => (d.mcp.url = "https://evil.invalid/mcp"),
    (d) => (d.signerPrincipal = "placeholder"),
    (d) => (d.generatedAt = -1),
    (d) => d.items.push({ ...d.items[0], index: 3 }),
    (d) => (d.privateKey = "synthetic-not-a-key"),
  ]) {
    const data = structuredClone(original);
    mutate(data);
    await assert.rejects(() => validateAgentCartHandoff(data));
  }
  const extra = structuredClone(original);
  extra.signatures = {};
  assert.equal(schema(extra), false);
  const lower = structuredClone(original);
  lower.items[0].operations[1].maxTotal = "1";
  await assert.rejects(() => validateAgentCartHandoff(lower));
});
test("missing/corrupt public facts and unsafe URLs/fields fail closed; empty and synthetic-demo output stay inert", async () => {
  const t = setup();
  assert.equal(await buildAgentCartHandoff([], t.cap, null, t.args[3]), null);
  assert.equal(await buildAgentCartPrompt([], t.cap, null, t.args[3]), "");
  for (const snapshot of [
    null,
    { state: { sequence: -1, time: 0 } },
    { ...t.snapshot, stateHash: "f".repeat(64) },
    { ...t.snapshot, observedServerTime: -1 },
  ])
    await assert.rejects(() =>
      buildAgentCartHandoff(...t.args.slice(0, 5), snapshot, 1000000000),
    );
  for (const url of [
    "https://user:pass@example.test",
    "http://example.test",
    "https://example.test/?q=x",
    "https://example.test/path",
  ])
    await assert.rejects(() =>
      buildAgentCartHandoff(t.items, t.cap, SIGNER, url, ...t.args.slice(4)),
    );
  for (const change of [
    (i) => (i.amount = "1.5"),
    (i) => (i.amount = "0"),
    (i) => (i.asset = "UNKNOWN"),
    (i) => (i.params.asset = "TEST"),
    (i) => (i.params.maxBid = "999"),
    (i) => (i.params.expectedVersion = "0"),
    (i) => (i.params.privateKey = "no"),
    (i) => (i.tier = "bad"),
    (i) => (i.needsReview = true),
    (i) => (i.validationError = "bad"),
    (i) => (i.action = "renewLease"),
  ]) {
    const items = structuredClone(t.items);
    change(items[0]);
    await assert.rejects(() =>
      buildAgentCartHandoff(items, ...t.args.slice(1)),
    );
  }
  await assert.rejects(
    () => buildAgentCartHandoff([t.items[0], t.items[0]], ...t.args.slice(1)),
    /Duplicate/,
  );
  await assert.rejects(
    () =>
      buildAgentCartHandoff(
        t.items,
        { ...t.cap, genesisHash: null },
        ...t.args.slice(2),
      ),
    /identity/,
  );
  const data = await buildAgentCartHandoff(
    t.items,
    t.cap,
    null,
    t.args[3],
    "static-synthetic-demo",
    t.snapshot,
    1000000000,
  );
  assert.equal(data.signerPrincipal, null);
  assert.match(renderAgentCartHandoff(data), /^⚠️ STATIC SYNTHETIC DEMO/);
  assert.ok(schema(data), ajv.errorsText(schema.errors));
});

test("real Node static allowlist serves the v2 module/schema and rejects arbitrary files", async () => {
  const { startReferenceServer } =
    await import("../dist/src/reference-server.js");
  const h = await startReferenceServer(profileEngine());
  try {
    const module = await fetch(h.url + "/agent-cart.js");
    assert.equal(module.status, 200);
    assert.match(module.headers.get("content-type"), /javascript/);
    const schema = await fetch(h.url + "/agent-cart-v2.schema.json");
    assert.equal(schema.status, 200);
    assert.deepEqual(await schema.json(), AGENT_CART_SCHEMA);
    assert.equal((await fetch(h.url + "/agent-cart-private.json")).status, 404);
  } finally {
    await h.close();
  }
});

test("all single-action plans validate, and version/deed/generation changes bind distinct IDs", async () => {
  const { auctionState, offerState } = await import("./fixtures/ui-state.mjs");
  const cap = capabilities(profileEngine());
  const auction = auctionState(),
    a = Object.values(auction.auctions)[0],
    resale = offerState(),
    o = Object.values(resale.offers)[0];
  const cases = [
    {
      state: auction,
      input: { name: "alpha", action: "bid", auctionId: a.id },
    },
    {
      state: resale,
      input: { name: "alpha", action: "buyFixed", offerId: o.id },
    },
  ];
  const child = structuredClone(resale);
  child.offers[o.id].kind = "child";
  child.offers[o.id].labels = ["shop"];
  child.names["shop.alpha"] = {
    generation: 2,
    activeId: null,
    auctionId: null,
  };
  cases.push({
    state: child,
    input: { name: "shop.alpha", action: "fillChildOffer", offerId: o.id },
  });
  for (const { state, input } of cases) {
    const item = buildCartItem(input, cap, state),
      args = [
        cap,
        SIGNER,
        "http://127.0.0.1:8787",
        "local-reference-only",
        { state },
        1000000000,
      ];
    const data = await buildAgentCartHandoff([item], ...args);
    assert.ok(schema(data), ajv.errorsText(schema.errors));
    assert.equal(await validateAgentCartHandoff(data), true);
    assert.equal(
      data.items[0].operations[0].expectedVersion,
      item.params.expectedVersion,
    );
    const changed = structuredClone(item);
    changed.params.expectedVersion++;
    assert.notEqual(
      (await buildAgentCartHandoff([changed], ...args)).items[0].requestId,
      data.items[0].requestId,
    );
    if (input.action === "fillChildOffer") {
      changed.params.expectedGeneration++;
      assert.notEqual(
        (await buildAgentCartHandoff([changed], ...args)).items[0].requestId,
        data.items[0].requestId,
      );
    }
  }
});

// Nov 11: a production handoff must say exactly what is real and never present simulate_intent as a test network.
test("handoff and MCP prompt state real vs not-live honestly; preflight is not a simulation environment", async () => {
  const t = setup(), text = renderAgentCartHandoff(await buildAgentCartHandoff(...t.args));
  assert.match(text, /✅ What is real now: this production registry\./);
  assert.match(text, /⛔ Not live yet: POA payments \(escrow is held\), native on-chain naming \(livePoA:false\)/);
  assert.match(text, /Nothing here moves POA or wallet funds; never send POA for this plan\./);
  assert.match(text, /🔎 simulate_intent is a no-change preflight check .* not a test network or simulation\./);
  assert.doesNotMatch(text, /→ simulate →/);
  const { MCP_INSTRUCTIONS } = await import("../dist/src/mcp-core.js");
  assert.match(MCP_INSTRUCTIONS, /Not live yet: POA payments/);
  assert.match(MCP_INSTRUCTIONS, /not a test network or simulation/);
});
