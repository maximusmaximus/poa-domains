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
