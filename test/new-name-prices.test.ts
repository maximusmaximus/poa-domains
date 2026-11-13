import test from "node:test";
import assert from "node:assert/strict";
import {
  POA_NEW_NAME_PRICES,
  poaNewNamePriceDecimal,
  poaNewNamePriceMicros,
} from "../src/new-name-prices.js";

test("POA checkout prices are 100 standard and 1000 premium", () => {
  assert.equal(poaNewNamePriceDecimal("standard"), "100.000000");
  assert.equal(poaNewNamePriceDecimal("premium"), "1000.000000");
  assert.equal(poaNewNamePriceMicros("standard"), "100000000");
  assert.equal(poaNewNamePriceMicros("premium"), "1000000000");
  assert.equal(POA_NEW_NAME_PRICES.standard, "100.000000");
  assert.equal(POA_NEW_NAME_PRICES.premium, "1000.000000");
  // 1000 POA is within the unchanged 250,000 per-transaction escrow limit.
  assert.ok(BigInt(poaNewNamePriceMicros("premium")) < 250_000_000_000n);
});
