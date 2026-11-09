import { readFileSync } from "node:fs";
import { hash, need, text } from "./core.js";
export interface Alias {
  input: string;
  canonical: string;
  token: string;
}
export type NormalizationMode = "reference-subset" | "emoji17-full";
export type Emoji17TestRow = [
  hex: string,
  status: string,
  shortName: string,
  emojiVersion: string,
  group: string,
  subgroup: string,
  fullyQualifiedHex: string,
  line: number,
];
export interface Emoji17DataInfo {
  unicodeVersion: string;
  emojiVersion: string;
  uts51Revision: number;
  statusCounts: Record<string, number>;
  totalTestEntries: number;
  nonComponentListedForms: number;
  rgiIncludingComponents: number;
  rgiNameRepresentatives: number;
  sourceSha256: Record<string, string>;
}
export const manifest = JSON.parse(
  readFileSync(
    new URL("../../vendor/unicode/manifest.json", import.meta.url),
    "utf8",
  ),
) as { version: string; aliases: Alias[]; sourceSha256: string };
export const NORMALIZATION_HASH = hash("normalization-manifest/v1", manifest);

const emoji17DataSource = readFileSync(
  new URL("../../web/emoji17-data.mjs", import.meta.url),
  "utf8",
);
function extractFrozenJson<T>(source: string, exportName: string): T {
  const prefix = `export const ${exportName} = freeze(`;
  const start = source.indexOf(prefix);
  need(start >= 0, "EMOJI17_DATA_CORRUPT");
  const jsonStart = start + prefix.length;
  const lineEnd = source.indexOf("\n", jsonStart);
  const rawLine = (
    lineEnd >= 0 ? source.slice(jsonStart, lineEnd) : source.slice(jsonStart)
  ).replace(/\r$/, "");
  need(rawLine.endsWith(");"), "EMOJI17_DATA_CORRUPT");
  return JSON.parse(rawLine.slice(0, -2)) as T;
}
const fromHex = (hex: string): string =>
  String.fromCodePoint(...hex.split(" ").map((x) => parseInt(x, 16)));
const toToken = (sequence: string): string =>
  "u" + [...sequence].map((x) => x.codePointAt(0)!.toString(16)).join("-");

export const EMOJI17_DATA_INFO = extractFrozenJson<Emoji17DataInfo>(
  emoji17DataSource,
  "DATA_INFO",
);
export const EMOJI17_TEST_ROWS = extractFrozenJson<Emoji17TestRow[]>(
  emoji17DataSource,
  "TEST_ROWS",
);
export const EMOJI17_ALIASES: Alias[] = EMOJI17_TEST_ROWS.filter(
  (row) => row[1] !== "component",
).map(([hex, , , , , , fullyQualifiedHex]) => {
  const input = fromHex(hex);
  const canonical = fromHex(fullyQualifiedHex);
  return { input, canonical, token: toToken(canonical) };
});
export const EMOJI17_RECORD_COUNT = EMOJI17_ALIASES.length;
export const emoji17Manifest = {
  version: "unicode-emoji-17.0-full-v1",
  unicodeVersion: EMOJI17_DATA_INFO.unicodeVersion,
  emojiVersion: EMOJI17_DATA_INFO.emojiVersion,
  sourceSha256: EMOJI17_DATA_INFO.sourceSha256["emoji-test.txt"]!,
  aliases: manifest.aliases,
  sequences: Object.fromEntries(
    EMOJI17_ALIASES.map((a) => [a.input, a.canonical]),
  ),
};
export const EMOJI17_NORMALIZATION_HASH = hash("normalization-manifest/v1", {
  version: emoji17Manifest.version,
  unicodeVersion: emoji17Manifest.unicodeVersion,
  emojiVersion: emoji17Manifest.emojiVersion,
  sourceSha256: emoji17Manifest.sourceSha256,
  recordCount: EMOJI17_RECORD_COUNT,
});
export function normalizationHashFor(
  mode: NormalizationMode = "reference-subset",
): string {
  need(
    mode === "reference-subset" || mode === "emoji17-full",
    "NORMALIZATION_MODE",
  );
  return mode === "emoji17-full"
    ? EMOJI17_NORMALIZATION_HASH
    : NORMALIZATION_HASH;
}
export function normalizationModeForHash(
  normalizationHash: string,
): NormalizationMode {
  if (normalizationHash === NORMALIZATION_HASH) return "reference-subset";
  if (normalizationHash === EMOJI17_NORMALIZATION_HASH) return "emoji17-full";
  need(false, "NORMALIZATION_HASH");
}

interface TrieNode {
  next: Map<string, TrieNode>;
  alias: Alias | null;
}
function buildAliasTrie(list: readonly Alias[]): TrieNode {
  const root: TrieNode = { next: new Map(), alias: null };
  for (const a of list) {
    let node = root;
    for (const ch of a.input) {
      let child = node.next.get(ch);
      if (!child) {
        child = { next: new Map(), alias: null };
        node.next.set(ch, child);
      }
      node = child;
    }
    node.alias = a;
  }
  return root;
}
function matchAliasAt(
  root: TrieNode,
  s: string,
  start: number,
): { alias: Alias; end: number } | null {
  let node: TrieNode | undefined = root;
  let j = start;
  let matched: { alias: Alias; end: number } | null = null;
  while (j < s.length && node) {
    const cp = s.codePointAt(j)!;
    const ch = String.fromCodePoint(cp);
    node = node.next.get(ch);
    if (!node) break;
    j += ch.length;
    if (node.alias) matched = { alias: node.alias, end: j };
  }
  return matched;
}
const tries: Record<NormalizationMode, TrieNode> = {
  "reference-subset": buildAliasTrie(manifest.aliases),
  "emoji17-full": buildAliasTrie(EMOJI17_ALIASES),
};

export function normalizeLabel(
  value: unknown,
  mode: NormalizationMode = "reference-subset",
): {
  canonical: string;
  tokens: string[];
} {
  need(
    mode === "reference-subset" || mode === "emoji17-full",
    "NORMALIZATION_MODE",
  );
  const s = text(value, 4096);
  need(Buffer.byteLength(s) <= 4096, "NAME_SIZE");
  const trie = tries[mode];
  const tokens: string[] = [];
  let out = "",
    i = 0;
  while (i < s.length) {
    const match = matchAliasAt(trie, s, i);
    if (match) {
      tokens.push(match.alias.token);
      out += match.alias.canonical;
      i = match.end;
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
export function normalizeName(
  value: unknown,
  mode: NormalizationMode = "reference-subset",
): {
  canonical: string;
  labels: ReturnType<typeof normalizeLabel>[];
  tier: "standard" | "premium";
} {
  let s = text(value, 8192);
  if (s.startsWith("poa:")) s = s.slice(4);
  const parts = s.split(".");
  need(parts.length >= 1 && parts.length <= 2, "NAME_DEPTH");
  const labels = parts.map((part) => normalizeLabel(part, mode));
  return {
    canonical: labels.map((l) => l.canonical).join("."),
    labels,
    tier:
      labels[labels.length - 1]!.tokens.length <= 3 ? "premium" : "standard",
  };
}
export function canonicalName(
  value: unknown,
  mode: NormalizationMode = "reference-subset",
): ReturnType<typeof normalizeName> {
  const n = normalizeName(value, mode);
  need(n.canonical === value, "NON_CANONICAL_NAME");
  return n;
}
export const nameKey = (
  registryId: string,
  name: string,
  mode: NormalizationMode = "reference-subset",
) =>
  hash("name-id/v1", [
    registryId,
    canonicalName(name, mode).labels.map((x) => x.tokens),
  ]);
