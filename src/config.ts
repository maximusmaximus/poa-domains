import {
  amount,
  canonical,
  exact,
  flag,
  hash,
  integer,
  need,
  obj,
  text,
} from "./core.js";
import { principal } from "./auth.js";
import { canonicalName, NORMALIZATION_HASH } from "./names.js";
import { DEFAULT_RESERVED_NAMES } from "./reserved.js";
export {
  SINGLE_LETTER_RESERVED,
  PROTOCOL_AND_SYSTEM_RESERVED,
  TOP_BRAND_AND_PRODUCT_RESERVED,
  DEFAULT_RESERVED_NAMES,
} from "./reserved.js";
export interface Config {
  revision: "local-reference-v1";
  chainId: string;
  genesisHash: string;
  instance: string;
  normalizationHash: string;
  signingMode: "local-ed25519-fixture";
  clockPolicy: "single-writer-local";
  issuer: string;
  treasury: string;
  feeBps: number;
  highestSelfRaise: "reject";
  increment:
    | { kind: "eosStrict10" }
    | { kind: "strictBps"; bps: number; minUnits: string };
  assets: Record<
    string,
    {
      decimals: number;
      kind: "local-fixture";
      premiumReserve: string;
      standardReserve: string;
    }
  >;
  balances: Record<string, Record<string, string>>;
  reserved: string[];
}
export function validateConfig(value: unknown): Config {
  const c = exact(value, [
    "revision",
    "chainId",
    "genesisHash",
    "instance",
    "normalizationHash",
    "signingMode",
    "clockPolicy",
    "issuer",
    "treasury",
    "feeBps",
    "highestSelfRaise",
    "increment",
    "assets",
    "balances",
    "reserved",
  ]);
  need(
    c.revision === "local-reference-v1" &&
      c.signingMode === "local-ed25519-fixture" &&
      c.clockPolicy === "single-writer-local",
    "POLICY_UNSET",
  );
  need(
    text(c.chainId, 128).startsWith("local:") &&
      /^[0-9a-f]{64}$/.test(text(c.genesisHash, 64)) &&
      /^[a-z0-9-]{1,64}$/.test(text(c.instance, 64)),
    "CONFIG",
  );
  need(c.normalizationHash === NORMALIZATION_HASH, "NORMALIZATION_POLICY");
  principal(c.issuer);
  principal(c.treasury);
  integer(c.feeBps, 0, 10000);
  need(c.highestSelfRaise === "reject", "POLICY_UNSET");
  const rule = obj(c.increment);
  if (rule.kind === "eosStrict10") exact(rule, ["kind"]);
  else {
    exact(rule, ["kind", "bps", "minUnits"]);
    need(rule.kind === "strictBps", "POLICY_UNSET");
    integer(rule.bps, 1, 10000);
    amount(rule.minUnits, true);
  }
  const assets = obj(c.assets);
  need(
    Object.keys(assets).length >= 1 && Object.keys(assets).length <= 16,
    "ASSET",
  );
  for (const [id, a] of Object.entries(assets)) {
    need(/^[A-Z][A-Z0-9_]{0,15}$/.test(id), "ASSET");
    exact(a, ["decimals", "kind", "premiumReserve", "standardReserve"]);
    integer(a.decimals, 0, 18);
    need(a.kind === "local-fixture", "ASSET");
    amount(a.premiumReserve, true);
    amount(a.standardReserve, true);
  }
  const balances = obj(c.balances);
  const sums: Record<string, bigint> = {};
  for (const [who, wallet] of Object.entries(balances)) {
    principal(who);
    obj(wallet);
    for (const [asset, n] of Object.entries(wallet)) {
      need(Object.hasOwn(assets, asset), "UNSUPPORTED_ASSET");
      sums[asset] = (sums[asset] ?? 0n) + amount(n);
      amount(sums[asset]!.toString());
    }
  }
  need(
    Array.isArray(c.reserved) &&
      c.reserved.length <= 4096 &&
      new Set(c.reserved).size === c.reserved.length,
    "CONFIG",
  );
  for (const name of c.reserved) canonicalName(name);
  return structuredClone(c) as Config;
}
export const policyHash = (c: Config) => hash("local-config-policy/v1", c);
export const registryId = (c: Config) =>
  hash("local-registry/v1", [c.chainId, c.genesisHash, c.instance]);
export function minimumNext(high: bigint, rule: Config["increment"]): bigint {
  return (
    high +
    (rule.kind === "eosStrict10"
      ? high / 10n + 1n
      : (high * BigInt(rule.bps)) / 10000n + 1n > BigInt(rule.minUnits)
        ? (high * BigInt(rule.bps)) / 10000n + 1n
        : BigInt(rule.minUnits))
  );
}
// Deliberately named fixture: these are NOT approved production prices, fees or assets.
export function fixtureConfig(
  issuer: string,
  treasury: string,
  buyers: string[],
): Config {
  const balances: Config["balances"] = {};
  for (const p of [...new Set([issuer, treasury, ...buyers])])
    balances[p] = { POA: "1000000000000", TEST: "1000000000000" };
  return validateConfig({
    revision: "local-reference-v1",
    chainId: "local:poa-domains",
    genesisHash: hash("local-fixture-genesis", [issuer, treasury, buyers]),
    instance: "offline-fixture",
    normalizationHash: NORMALIZATION_HASH,
    signingMode: "local-ed25519-fixture",
    clockPolicy: "single-writer-local",
    issuer,
    treasury,
    feeBps: 100,
    highestSelfRaise: "reject",
    increment: { kind: "eosStrict10" },
    assets: {
      POA: {
        decimals: 6,
        kind: "local-fixture",
        premiumReserve: "1000",
        standardReserve: "100",
      },
      TEST: {
        decimals: 6,
        kind: "local-fixture",
        premiumReserve: "1000",
        standardReserve: "100",
      },
    },
    balances,
    reserved: [...DEFAULT_RESERVED_NAMES],
  });
}
