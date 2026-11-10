import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { profileEngine, SIGNER } from "./fixtures/ui-harness.mjs";
import { capabilities, prepare } from "../dist/src/interface.js";
import { AUCTION_WINDOWS } from "../dist/src/engine.js";
import { rootAuctionPolicy, editCartAmount, cartParamsForSigner, buildAgentCartPrompt,
  buildAgentCheckoutHandoff, inspectName, makeBody } from "../reference-web/shared.js";
export const cap = capabilities(profileEngine());
export const item = { name: "alpha", tier: "standard", isRoot: true, action: "announceAuction+bid", asset: "POA",
  amount: "100", summary: "Old amount", params: { name: "alpha", asset: "POA", reserve: "100", maxBid: "100", expectedDeedId: null, expectedVersion: 0 } };

test("root reserves and both bidding windows match capabilities under both profiles, including multi emoji", () => {
  for (const profile of ["fixture", "mainnet"]) {
    const c = capabilities(profileEngine(profile));
    assert.deepEqual(c.auctionWindows, AUCTION_WINDOWS);
    for (const name of ["🚀", "🚀🚀", "alpha"]) {
      const info = inspectName(name, c.emojiManifest), policy = rootAuctionPolicy(c, info);
      assert.equal(policy.reserve, c.assets.POA[info.tier === "premium" ? "premiumReserve" : "standardReserve"]);
      assert.equal(policy.window, c.auctionWindows[info.tier].window);
      assert.equal(policy.quiet, c.auctionWindows[info.tier].quiet);
    }
  }
  assert.throws(() => rootAuctionPolicy({ assets: cap.assets }, { tier: "standard" }), /Prices unavailable/);
});
test("edited prompt snapshot keeps amount, reserve, maxBid, summary, CLI cap and checkout consistent", () => {
  const edited = editCartAmount(item, "250", cap);
  assert.deepEqual([edited.amount, edited.params.reserve, edited.params.maxBid], ["250", "250", "250"]);
  assert.match(edited.summary, /reserve=250 POA.*maxTotal=250 POA/);
  assert.equal(item.amount, "100", "pure edit does not mutate prior state");
  const prompt = buildAgentCartPrompt([edited], cap, SIGNER, "http://127.0.0.1:8787");
  assert.equal(prompt, readFileSync("test/fixtures/cart-edited-prompt.txt", "utf8"));
  const checkout = buildAgentCheckoutHandoff([edited], cap, SIGNER, "http://127.0.0.1:8787");
  const payload = JSON.parse(checkout.slice(checkout.indexOf("{\n")));
  assert.equal(payload.items[0].amount, "250"); assert.equal(payload.items[0].params.maxBid, "250");
});
test("bad, zero, decimal and below-minimum amounts never silently replace the user's choice", () => {
  for (const amount of ["bad", "0", "-1", "1.5", "99", "", "01"]) assert.throws(() => editCartAmount(item, amount, cap));
  const bid = { ...item, action: "bid", amount: "1000", params: { auctionId: "a".repeat(64), expectedVersion: 1, asset: "POA", amount: "1000" } };
  const state = { auctions: { [bid.params.auctionId]: { reserve: "1000", high: { amount: "1000" } } } };
  assert.throws(() => editCartAmount(bid, "1100", cap, state), /1101/);
  const updated = editCartAmount(bid, "1200", cap, state);
  assert.equal(updated.params.amount, "1200"); assert.match(updated.summary, /1200.*minValidBid=1101/);
  assert.throws(() => editCartAmount({ ...bid, action: "buyFixed" }, "1200", cap), /Fixed price/);
});
test("both handoffs and Node/browser preparation default bid beneficiary to the real signer", () => {
  const bid = { ...item, action: "bid", amount: "1000", params: { auctionId: "a".repeat(64), expectedVersion: 1, asset: "POA", amount: "1000", beneficiary: "<YOUR_BENEFICIARY_PRINCIPAL>" } };
  assert.equal(cartParamsForSigner(bid, SIGNER).beneficiary, SIGNER);
  const params = cartParamsForSigner(bid, null); assert.ok(!Object.hasOwn(params, "beneficiary"));
  for (const build of [buildAgentCartPrompt, buildAgentCheckoutHandoff]) {
    assert.ok(!build([bid], cap, null, "http://127.0.0.1:8787").includes("<YOUR_BENEFICIARY_PRINCIPAL>"));
    assert.ok(build([bid], cap, SIGNER, "http://127.0.0.1:8787").includes(SIGNER));
  }
  const input = { signer: SIGNER, coSigners: [], requestId: "beneficiary-default", nonce: 1, notBefore: 0, deadline: 2000000,
    maxTotal: "1000", maxNetworkFee: "0", action: "bid", params };
  assert.equal(prepare(input, cap).params.beneficiary, SIGNER);
  assert.equal(makeBody(input, cap).params.beneficiary, SIGNER);
});
