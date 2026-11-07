import { readFileSync } from "node:fs";
import { hash, need, text } from "./core.js";
export interface Alias {
  input: string;
  canonical: string;
  token: string;
}
export const manifest = JSON.parse(
  readFileSync(
    new URL("../../vendor/unicode/manifest.json", import.meta.url),
    "utf8",
  ),
) as { version: string; aliases: Alias[]; sourceSha256: string };
export const NORMALIZATION_HASH = hash("normalization-manifest/v1", manifest);
const aliases = [...manifest.aliases].sort(
  (a, b) => b.input.length - a.input.length || (a.input < b.input ? -1 : 1),
);
export function normalizeLabel(value: unknown): {
  canonical: string;
  tokens: string[];
} {
  const s = text(value, 4096);
  need(Buffer.byteLength(s) <= 4096, "NAME_SIZE");
  const tokens: string[] = [];
  let out = "",
    i = 0;
  while (i < s.length) {
    const alias = aliases.find((a) => s.startsWith(a.input, i));
    if (alias) {
      tokens.push(alias.token);
      out += alias.canonical;
      i += alias.input.length;
    } else {
      const c = s[i++]!;
      need(/^[a-zA-Z0-9]$/.test(c), "UNSUPPORTED_NAME");
      const folded = c.toLowerCase();
      tokens.push("a" + folded);
      out += folded;
    }
    need(tokens.length <= 32, "NAME_LENGTH");
  }
  need(tokens.length >= 1, "NAME_LENGTH");
  return { canonical: out, tokens };
}
export function normalizeName(value: unknown): {
  canonical: string;
  labels: ReturnType<typeof normalizeLabel>[];
  tier: "standard" | "premium";
} {
  let s = text(value, 8192);
  if (s.startsWith("poa:")) s = s.slice(4);
  const parts = s.split(".");
  need(parts.length >= 1 && parts.length <= 2, "NAME_DEPTH");
  const labels = parts.map(normalizeLabel);
  return {
    canonical: labels.map((l) => l.canonical).join("."),
    labels,
    tier:
      labels[labels.length - 1]!.tokens.length <= 3 ? "premium" : "standard",
  };
}
export function canonicalName(
  value: unknown,
): ReturnType<typeof normalizeName> {
  const n = normalizeName(value);
  need(n.canonical === value, "NON_CANONICAL_NAME");
  return n;
}
export const nameKey = (registryId: string, name: string) =>
  hash("name-id/v1", [
    registryId,
    canonicalName(name).labels.map((x) => x.tokens),
  ]);
