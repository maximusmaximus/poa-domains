import test from "node:test";
import assert from "node:assert/strict";
import { auditedEngine, get } from "./fixtures/audited-engine.mjs";
import {
  acknowledgeCartItem,
  activePoaFixedListings,
  buildCartItem,
  buildPoaCheckoutHandoff,
  cartReview,
  countLiveAuctions,
  editCartAmount,
  formatCountdown,
  isPoaAuctionAwaitingFirstBid,
  isPoaAuctionLive,
  loadBidderAddress,
  partitionPoaAuctions,
  poaAuctionOutbidStatus,
  poaMinimumNextBid,
  recheckCartItem,
  renderPoaCheckoutHandoff,
  saveBidderAddress,
} from "../reference-web/shared.js";
import { recentActions } from "../reference-web/ui-ticker.js";

const SELLER = "poa1GHppB8pYZ43gK8yBzR1RJhzfWjzrJn29q96ykwngUP7N";
const BIDDER_A = "poa1An2SNaVU6NYV7RBCFKnpjXra91BzPs8qm45qh2u8EeSL";
const BIDDER_B = "poa1BMrTXjLwLQoxzPQGK3nfdLD9RnVsHdLHU4ikFdyYW1pb";
const AUC_QUEUED = "a".repeat(64);
const AUC_LIVE = "b".repeat(64);

function sampleMarket(nowMs) {
  return [
    {
      id: AUC_QUEUED,
      name: "moon",
      seller: SELLER,
      kind: "auction",
      price: "100.000000",
      minimumNextBid: "100.000000",
      status: "OPEN",
      closes: 0,
      window: 3600000,
      quiet: 3600000,
      createdAt: nowMs - 60000,
      startedAt: null,
      awaitingFirstBid: true,
      high: null,
      bidders: [],
      settlement: null,
      history: [{ event: "Auction queued; timer starts on first bid", at: nowMs - 60000 }],
    },
    {
      id: AUC_LIVE,
      name: "star",
      seller: SELLER,
      kind: "auction",
      price: "100.000000",
      minimumNextBid: "220.000001",
      status: "OPEN",
      closes: nowMs + 3600000,
      window: 3600000,
      quiet: 3600000,
      createdAt: nowMs - 120000,
      startedAt: nowMs - 30000,
      awaitingFirstBid: false,
      high: { payer: BIDDER_A, amount: "200.000000" },
      bidders: [BIDDER_A],
      settlement: null,
      history: [
        { event: "Auction queued; timer starts on first bid", at: nowMs - 120000 },
        { event: "Auction started (first bid)", at: nowMs - 30000, amount: "200.000000", payer: BIDDER_A },
      ],
    },
  ];
}

test("first-bid-starts-timer classification, live auction count, and top scroll bar ticker", () => {
  const e = auditedEngine();
  const cap = get(e, "/v1/capabilities", { include: "emoji" }).data;
  const payload = get(e, "/v1/state").data;
  const state = { ...payload.state, time: payload.observedServerTime };
  const nowMs = 1_800_000_000_000;
  const market = sampleMarket(nowMs);

  assert.equal(poaMinimumNextBid(market[0]), "100.000000");
  assert.equal(poaMinimumNextBid(market[1]), "220.000001");
  assert.equal(formatCountdown(0), "Closing now");
  assert.equal(formatCountdown(30000), "<1m left");
  assert.equal(formatCountdown(14 * 60000), "14m left");
  assert.equal(formatCountdown((5 * 60 + 12) * 60000), "5h 12m left");
  assert.equal(formatCountdown((2 * 24 + 3) * 3600000), "2d 3h left");
  assert.equal(isPoaAuctionAwaitingFirstBid(market[0]), true);
  assert.equal(isPoaAuctionAwaitingFirstBid(market[1]), false);
  assert.equal(isPoaAuctionLive(market[0], nowMs), false);
  assert.equal(isPoaAuctionLive(market[1], nowMs), true);

  // Only started live auctions count toward the top badge; queued inventory items do not.
  assert.equal(countLiveAuctions({ cap, state, escrowMarket: market, nowMs }), 1);
  const parts = partitionPoaAuctions(market, nowMs);
  assert.deepEqual(parts.current.map((x) => x.name), ["star"]);
  assert.deepEqual(parts.upcoming.map((x) => x.name), ["moon"]);
  assert.deepEqual(parts.past, []);

  // Top scroll bar announces started auctions and does NOT announce unbid queued items.
  const ticker = recentActions(state, market);
  assert.ok(ticker.some((x) => x.name === "star" && /Auction started.*200 POA/.test(x.label)));
  assert.ok(!ticker.some((x) => x.name === "moon"));

  // Once the first bid lands on moon, live count rises to 2 and ticker announces moon started.
  market[0].awaitingFirstBid = false;
  market[0].startedAt = nowMs;
  market[0].closes = nowMs + 3600000;
  market[0].high = { payer: BIDDER_B, amount: "100.000000" };
  market[0].bidders = [BIDDER_B];
  market[0].history.push({ event: "Auction started (first bid)", at: nowMs, amount: "100.000000", payer: BIDDER_B });
  assert.equal(countLiveAuctions({ cap, state, escrowMarket: market, nowMs }), 2);
  const ticker2 = recentActions(state, market);
  assert.ok(ticker2.some((x) => x.name === "moon" && /Auction started.*100 POA/.test(x.label)));
});

test("POA auction cart supports highest bid ceiling, outbid detection without auto-raising caps, and nuanced copy prompt", () => {
  const e = auditedEngine();
  const cap = get(e, "/v1/capabilities", { include: "emoji" }).data;
  const payload = get(e, "/v1/state").data;
  const state = { ...payload.state, time: payload.observedServerTime };
  const nowMs = 1_800_000_000_000;
  const market = sampleMarket(nowMs);

  // User adds live auction "star" with highest bid 300 POA and queued auction "moon" with 150 POA + new name "freshpoa"
  let starItem = buildCartItem({ name: "star", action: "poaBid", auctionId: AUC_LIVE, amount: "300" }, cap, state, market, "", nowMs);
  const moonItem = buildCartItem({ name: "moon", action: "poaBid", auctionId: AUC_QUEUED, amount: "150" }, cap, state, market, "", nowMs);
  const newItem = buildCartItem({ name: "freshpoa", action: "poaCheckout" }, cap, state, market, "", nowMs);
  assert.equal(starItem.amount, "300.000000");
  assert.equal(starItem.needsReview, false);
  assert.equal(moonItem.params.awaitingFirstBid, true);

  // Copy cart prompt for mixed cart includes exact ceilings and ALL auction nuances
  const handoff = buildPoaCheckoutHandoff([starItem, moonItem, newItem], cap, "https://poadomains.link", payload, nowMs);
  assert.equal(handoff.totalPrice, "550.000000");
  assert.equal(handoff.escrow.market, "https://poadomains.link/v1/escrow/market");
  assert.equal(handoff.items[0].kind, "auctionBid");
  assert.equal(handoff.items[0].maxBid, "300.000000");
  assert.equal(handoff.items[1].awaitingFirstBid, true);
  assert.equal(handoff.items[2].price, "100.000000");

  const prompt = renderPoaCheckoutHandoff(handoff);
  assert.match(prompt, /Whole-cart ceiling 550\.000000 POA/);
  assert.match(prompt, /ESCROW_SELF_RAISE/);
  assert.match(prompt, /floor\(highMicros \* 11 \/ 10\) \+ 1/);
  assert.match(prompt, /First-bid timer nuance/);
  assert.match(prompt, /Anti-snipe quiet period/);
  assert.match(prompt, /Outbid & refund nuance/);
  assert.match(prompt, /credited instantly back to my available escrow balance/);
  assert.match(prompt, /Safety & withdrawals/);
  assert.match(prompt, /Settlement handover nuance/);
  assert.match(prompt, /issueFromTreasury/);

  // Another user bids 250 POA on "star" -> min next 275.000001 POA (still <= 300 max bid)
  market[1].high = { payer: BIDDER_B, amount: "250.000000" };
  market[1].minimumNextBid = "275.000001";
  market[1].bidders = [BIDDER_A, BIDDER_B];
  const outbidByAddr = poaAuctionOutbidStatus(market[1], { bidderAddress: BIDDER_A });
  assert.equal(outbidByAddr.status, "outbid");
  assert.equal(poaAuctionOutbidStatus(market[1], { bidderAddress: BIDDER_B }).status, "leading");

  const covered = recheckCartItem(starItem, cap, state, market, "", nowMs);
  assert.equal(covered.outbid, true);
  assert.equal(covered.needsReview, true);
  assert.equal(covered.amount, "300.000000", "cap never auto-rises");
  assert.equal(cartReview(covered, cap, state, market, "", nowMs).canAcknowledge, true);
  starItem = acknowledgeCartItem(covered, cap, state, market, "", nowMs);
  assert.equal(starItem.needsReview, false);
  assert.equal(starItem.outbid, false);
  assert.equal(starItem.amount, "300.000000");

  // Another user bids 350 POA -> min next 385.000001 POA (> 300 max bid): blocked, cap NOT raised
  market[1].high = { payer: BIDDER_A, amount: "350.000000" };
  market[1].minimumNextBid = "385.000001";
  const exceeded = recheckCartItem(starItem, cap, state, market, "", nowMs);
  assert.equal(exceeded.outbid, true);
  assert.equal(exceeded.needsReview, true);
  assert.equal(exceeded.amount, "300.000000");
  assert.equal(cartReview(exceeded, cap, state, market, "", nowMs).canAcknowledge, false);
  assert.throws(() => buildPoaCheckoutHandoff([exceeded], cap, "https://poadomains.link", payload, nowMs), /Review the cart/);

  // Leading bidder cannot queue a self-raise
  assert.equal(cartReview(exceeded, cap, state, market, BIDDER_A, nowMs).canAcknowledge, false);

  // User consciously raises highest bid to 400 POA and acknowledges
  const raised = editCartAmount(exceeded, "400", cap, state, market);
  const confirmed = acknowledgeCartItem(raised, cap, state, market, "", nowMs);
  assert.equal(confirmed.amount, "400.000000");
  assert.equal(confirmed.needsReview, false);
  assert.equal(confirmed.outbid, false);

  // Auction-only prompt (no new-name items) + sub-hour window formatting + multi-bid & COMPLETE ticker chips
  const shortConfirmed = { ...confirmed, params: { ...confirmed.params, window: 2700000, quiet: 5400000 } };
  const aucOnly = buildPoaCheckoutHandoff([shortConfirmed], cap, "https://poadomains.link", payload, nowMs);
  const aucOnlyText = renderPoaCheckoutHandoff(aucOnly);
  assert.match(aucOnlyText, /POA Auction Bids/);
  assert.doesNotMatch(aucOnlyText, /issueFromTreasury/);
  assert.match(aucOnlyText, /quiet \+1h 30m/);

  market[1].history.push({ event: "Bid placed", at: nowMs + 500, amount: "350.000000", payer: BIDDER_A });
  const doneAuc = {
    ...market[0],
    id: "c".repeat(64),
    name: "done",
    status: "COMPLETE",
    awaitingFirstBid: false,
    closes: nowMs - 1000,
    high: { payer: BIDDER_B, amount: "120.000000" },
    history: [{ event: "Payment and title complete", at: nowMs - 500, amount: "120.000000" }],
  };
  const fixedListing = {
    id: "d".repeat(64),
    name: "fixedname",
    seller: SELLER,
    kind: "fixed",
    price: "250.000000",
    status: "OPEN",
    closes: 0,
    high: null,
  };
  assert.deepEqual(activePoaFixedListings([...market, doneAuc, fixedListing], nowMs).map((x) => x.name), ["fixedname"]);
  assert.deepEqual(activePoaFixedListings([{ ...fixedListing, closes: nowMs - 60000 }], nowMs).map((x) => x.name), ["fixedname"]);
  assert.deepEqual(partitionPoaAuctions([...market, doneAuc, fixedListing], nowMs).past.map((x) => x.name), ["done"]);
  const multiTicker = recentActions(state, [...market, doneAuc, fixedListing]);
  assert.ok(multiTicker.some((x) => x.name === "star" && /High bid.*350 POA/.test(x.label)));
  assert.ok(multiTicker.some((x) => x.name === "done" && /Auction won.*120 POA/.test(x.label)));

  // Fixed-price resale buy (poaBuy) + multi-item Use deposit funding modes (all-deposit & mixed)
  const fullMarket = [...market, doneAuc, fixedListing];
  const buyDeposit = buildCartItem({ name: "fixedname", action: "poaBuy", auctionId: fixedListing.id, useDeposit: true }, cap, state, fullMarket, "", nowMs);
  assert.equal(buyDeposit.amount, "250.000000");
  assert.equal(buyDeposit.useDeposit, true);
  assert.equal(buyDeposit.needsReview, false);
  const bidDeposit = buildCartItem({ name: "moon", action: "poaBid", auctionId: AUC_QUEUED, amount: "150", useDeposit: true }, cap, state, fullMarket, "", nowMs);
  const allDepositHandoff = buildPoaCheckoutHandoff([bidDeposit, buyDeposit], cap, "https://poadomains.link", payload, nowMs);
  assert.equal(allDepositHandoff.useDepositCount, 2);
  assert.equal(allDepositHandoff.depositOnlyTotal, "400.000000");
  assert.equal(allDepositHandoff.newFundingTotal, "0.000000");
  const allDepositPrompt = renderPoaCheckoutHandoff(allDepositHandoff);
  assert.match(allDepositPrompt, /\[AUCTION BID · USE DEPOSIT\] moon/);
  assert.match(allDepositPrompt, /\[BUY LISTING · USE DEPOSIT\] fixedname/);
  assert.match(allDepositPrompt, /USE EXISTING DEPOSIT ONLY/);
  assert.match(allDepositPrompt, /sign escrow buy/);

  const mixedDepositHandoff = buildPoaCheckoutHandoff([bidDeposit, buyDeposit, newItem], cap, "https://poadomains.link", payload, nowMs);
  assert.equal(mixedDepositHandoff.useDepositCount, 2);
  assert.equal(mixedDepositHandoff.depositOnlyTotal, "400.000000");
  assert.equal(mixedDepositHandoff.newFundingTotal, "100.000000");
  const mixedDepositPrompt = renderPoaCheckoutHandoff(mixedDepositHandoff);
  assert.match(mixedDepositPrompt, /MIXED — existing deposit \+ new POA/);
  assert.match(mixedDepositPrompt, /\[NEW NAME\] freshpoa/);
  assert.match(mixedDepositPrompt, /issueFromTreasury/);
  // Closed fixed listing is flagged on review
  const soldFixed = [{ ...fixedListing, high: { payer: BIDDER_A, amount: "250.000000" } }];
  assert.equal(cartReview(buyDeposit, cap, state, soldFixed, "", nowMs).canAcknowledge, false);

  // Seller cannot bid on or buy their own domain (blocked in buildCartItem, cartReview, and handoff prompt)
  assert.throws(
    () => buildCartItem({ name: "moon", action: "poaBid", auctionId: AUC_QUEUED, amount: "150" }, cap, state, fullMarket, SELLER, nowMs),
    /can't bid on your own domain.*Public owner address/i,
  );
  assert.throws(
    () => buildCartItem({ name: "fixedname", action: "poaBuy", auctionId: fixedListing.id }, cap, state, fullMarket, SELLER, nowMs),
    /can't buy your own domain.*Public owner address/i,
  );
  const selfReview = cartReview(bidDeposit, cap, state, fullMarket, SELLER, nowMs);
  assert.equal(selfReview.canAcknowledge, false);
  assert.ok(selfReview.issues.some((m) => /Public owner address/i.test(m)));
  assert.match(allDepositPrompt, /ESCROW_SELF_SALE/);

  // Bidder address storage helper round-trips valid poa1 addresses and clears empty values
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  saveBidderAddress(storage, BIDDER_A);
  assert.equal(loadBidderAddress(storage), BIDDER_A);
  saveBidderAddress(storage, "");
  assert.equal(loadBidderAddress(storage), "");
});
