import test from "node:test";
import assert from "node:assert/strict";
import {
  pickSiteTitle,
  TITLE_STYLES,
  classifyAuction,
  partitionAuctions,
  shapeLiveActions,
  historyForTarget,
  buildAgentCheckoutHandoff,
  loadCart,
  saveCart,
  CART_STORAGE_KEY,
} from "../reference-web/shared.js";

test("emoji site title stylizations cover poadomains letters", () => {
  assert.ok(TITLE_STYLES.length >= 5);
  const seen = new Set();
  for (let i = 0; i < TITLE_STYLES.length; i++) {
    const title = pickSiteTitle(() => i / TITLE_STYLES.length);
    assert.equal(typeof title, "string");
    assert.ok(title.length > 0);
    seen.add(title);
  }
  assert.equal(seen.size, TITLE_STYLES.length);
});

test("partitionAuctions splits past current upcoming from real shapes", () => {
  const time = 1000;
  const auctions = [
    { id: "a1", name: "past", status: "finalized", openAt: 100, window: 10, quiet: 10 },
    { id: "a2", name: "live", status: "live", openAt: 900, window: 3600, quiet: 3600, reserve: "1000", asset: "POA" },
    { id: "a3", name: "soon", status: "live", openAt: 2000, window: 3600, quiet: 3600, reserve: "1000", asset: "POA" },
  ];
  assert.equal(classifyAuction(auctions[0], time), "past");
  assert.equal(classifyAuction(auctions[1], time), "current");
  assert.equal(classifyAuction(auctions[2], time), "upcoming");
  const parts = partitionAuctions(auctions, time);
  assert.deepEqual(parts.past.map((a) => a.name), ["past"]);
  assert.deepEqual(parts.current.map((a) => a.name), ["live"]);
  assert.deepEqual(parts.upcoming.map((a) => a.name), ["soon"]);
});

test("shapeLiveActions uses committed state only and stays empty without data", () => {
  assert.deepEqual(shapeLiveActions(null), []);
  assert.deepEqual(shapeLiveActions({}), []);
  const items = shapeLiveActions({
    time: 1000,
    auctions: {
      a: {
        id: "a",
        name: "orbit",
        status: "live",
        openAt: 900,
        window: 3600,
        quiet: 3600,
        reserve: "1000",
        asset: "POA",
        sequence: 3,
        high: { amount: "1100", at: 950, payer: "poa1x" },
      },
    },
    bids: {
      b: {
        id: "b",
        auctionId: "a",
        amount: "1100",
        status: "high",
        sequence: 4,
        at: 950,
      },
    },
    receipts: {},
    offers: {},
    deeds: {},
  });
  assert.ok(items.length >= 2);
  assert.ok(items.some((x) => x.kind === "auction-live" && x.name === "orbit"));
  assert.ok(items.some((x) => x.kind === "bid" && x.name === "orbit"));
});

test("historyForTarget returns auction and bid rows", () => {
  const state = {
    time: 1000,
    auctions: {
      a: {
        id: "a",
        name: "orbit",
        status: "live",
        openAt: 900,
        window: 10,
        quiet: 10,
        reserve: "1",
        asset: "POA",
        sequence: 1,
      },
    },
    bids: {
      b: {
        id: "b",
        auctionId: "a",
        amount: "2",
        status: "high",
        sequence: 2,
        at: 910,
      },
    },
    receipts: {},
    deeds: {},
  };
  const rows = historyForTarget(state, { name: "orbit", auctionId: "a" });
  assert.ok(rows.some((r) => r.kind === "auction"));
  assert.ok(rows.some((r) => r.kind === "bid"));
});

test("buildAgentCheckoutHandoff is unsigned machine-readable without secrets", () => {
  const text = buildAgentCheckoutHandoff(
    [
      {
        name: "quantum",
        action: "announceAuction+bid",
        tier: "standard",
        isRoot: true,
        asset: "POA",
        amount: "1000",
        summary: "announce",
        params: { name: "quantum", asset: "POA", reserve: "1000", maxBid: "1000" },
      },
    ],
    {
      chainId: "poa-mainnet-1",
      registryId: "reg",
      policyHash: "abc",
      revision: "poa-mainnet-v1",
    },
    "",
    "https://example.test",
  );
  assert.match(text, /POA DOMAINS AGENT CHECKOUT/);
  assert.match(text, /poa-domains\.agent-checkout\.v1/);
  assert.match(text, /\/v1\/intents/);
  assert.match(text, /submit_intent/);
  assert.match(text, /quantum/);
  assert.doesNotMatch(text, /BEGIN .*PRIVATE KEY/);
  assert.doesNotMatch(text, /"signatures"/);
  assert.doesNotMatch(text, /secret/i);
});

test("cart localStorage helpers round-trip and reject junk", () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  };
  saveCart(storage, [{ name: "a", action: "bid" }]);
  assert.equal(loadCart(storage)[0].name, "a");
  mem.set(CART_STORAGE_KEY, "{bad");
  assert.deepEqual(loadCart(storage), []);
});
