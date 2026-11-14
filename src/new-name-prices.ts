/** POA new-name checkout prices. Separate from the immutable registry auction reserve policy. */
export const POA_NEW_NAME_PRICE_MICROS = Object.freeze({
  standard: 100_000_000n, // 100.000000 POA
  premium: 1_000_000_000n, // 1000.000000 POA
});

export function poaNewNamePriceMicros(tier: "premium" | "standard"): string {
  return (tier === "premium" ? POA_NEW_NAME_PRICE_MICROS.premium : POA_NEW_NAME_PRICE_MICROS.standard).toString();
}

export function poaNewNamePriceDecimal(tier: "premium" | "standard"): string {
  const n = tier === "premium" ? POA_NEW_NAME_PRICE_MICROS.premium : POA_NEW_NAME_PRICE_MICROS.standard;
  return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0")}`;
}

export const POA_NEW_NAME_PRICES = Object.freeze({
  standard: poaNewNamePriceDecimal("standard"),
  premium: poaNewNamePriceDecimal("premium"),
  micros: {
    standard: poaNewNamePriceMicros("standard"),
    premium: poaNewNamePriceMicros("premium"),
  },
});

export const POA_NEW_NAME_PRICE_RULE =
  "Starting POA checkout prices: 100.000000 POA for common/standard names, 1000.000000 POA for premium names";

/** Agent-facing POA checkout steps, shared by MCP, llms.txt and the agent card. */
export const POA_CHECKOUT_STEPS =
  "🪙 Everything here is priced and paid in POA. New names: 100 POA (common) or 1000 POA (premium). " +
  "Buy with POA checkout: 1) sign escrow intent {amount}, send exactly that POA with memo poadomains:<intent> to the escrow address it returns, then sign detect {intent, txid}; " +
  "2) sign a registry packet issueFromTreasury {name, asset:\"POA\", price:<micros>, expectedDeedId:null, expectedVersion:0, metadata from build_metadata_witness} with maxTotal \"0\", maxNetworkFee \"0\" and a deadline at least 10 minutes ahead (do not submit it to /v1/intents); " +
  "3) sign escrow issue {name, amount, registration:<that packet>} and POST {command,signature} to /v1/escrow/command. " +
  "Sell or auction a name you own with escrow list/open; buy or bid with buy/bid; take unused POA back with withdraw (paid only to the original payer). " +
  "Registry auctions, bids and offers are closed and return POA_ONLY. Read /v1/escrow/capabilities first; if it is held or paused, wait.";
