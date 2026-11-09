// Emoji ownership classes: spellings in the same class are one name for ownership.
// Applied to new registrations only (see Engine.submit); recorded commits replay unchanged.
import {
  EMOJI_OWNERSHIP_MULTI,
  EMOJI_OWNERSHIP_VERSION,
  EMOJI_OWNERSHIP_MANIFEST_SHA256,
  EMOJI_OWNERSHIP_TABLE_SHA256,
  EMOJI_OWNERSHIP_COUNTS,
} from "./emoji-ownership-data.js";
import { normalizeName, NormalizationMode, EMOJI17_ALIASES } from "./names.js";
import { createHash } from "node:crypto";
import { need } from "./core.js";

export {
  EMOJI_OWNERSHIP_MULTI,
  EMOJI_OWNERSHIP_VERSION,
  EMOJI_OWNERSHIP_MANIFEST_SHA256,
  EMOJI_OWNERSHIP_TABLE_SHA256,
  EMOJI_OWNERSHIP_COUNTS,
};

const fromHex = (hex: string): string =>
  String.fromCodePoint(...hex.split(" ").map((x) => parseInt(x, 16)));
const toToken = (sequence: string): string =>
  "u" + [...sequence].map((x) => x.codePointAt(0)!.toString(16)).join("-");

/** member token -> representative token, for multi-member classes only. */
export const OWNERSHIP_TOKEN: ReadonlyMap<string, string> = new Map(
  EMOJI_OWNERSHIP_MULTI.flatMap(([rep, members]) =>
    members.map((m) => [toToken(fromHex(m)), toToken(fromHex(rep))] as const),
  ),
);

const CLASS_DOMAIN = "poa-emoji-ownership-proposal-v1";
const LABEL_DOMAIN = "poa-name-ownership-PROPOSED-v1"; // Frozen approved literal; not a roadmap label.
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const fqHex = (s: string) => [...s].map((c) => c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")).join(" ");
const classId = (members: readonly string[]) => CLASS_DOMAIN + ":" + digest(CLASS_DOMAIN + "\0unicode=17.0\0" + [...members].sort().join("|"));
const CLASS_IDS = new Map<string, string>();
for (const [, members] of EMOJI_OWNERSHIP_MULTI) {
  const id = classId(members);
  for (const member of members) CLASS_IDS.set(toToken(fromHex(member)), id);
}
for (const a of EMOJI17_ALIASES)
  if (!CLASS_IDS.has(a.token)) CLASS_IDS.set(a.token, classId([fqHex(a.canonical)]));
const REPRESENTATIVES = new Map(EMOJI17_ALIASES.map((a) => [a.token, a.canonical]));

/** Exact approved ordered 1–32-token convention, preserving legacy name bytes in storage. */
export function canonicalizeEmojiOwnership(label: string) {
  const n = normalizeName(label, "emoji17-full");
  need(n.labels.length === 1 && n.labels[0]!.tokens.every((t) => t.startsWith("u")), "EMOJI_ONLY_LABEL");
  const tokens = n.labels[0]!.tokens;
  const classIds = tokens.map((t) => CLASS_IDS.get(t)!);
  return {
    classIds,
    canonicalLabelKey: JSON.stringify([LABEL_DOMAIN, classIds]),
    representativeLabel: tokens.map((t) => REPRESENTATIVES.get(OWNERSHIP_TOKEN.get(t) ?? t)!).join(""),
    emojiCount: tokens.length,
    mappingVersion: EMOJI_OWNERSHIP_VERSION,
    manifestSha256: EMOJI_OWNERSHIP_MANIFEST_SHA256,
  };
}

/** Classes govern collision checks without reminting legacy names, deed IDs or policy hashes. */
export function ownershipKey(name: string, mode: NormalizationMode): string {
  const n = normalizeName(name, mode);
  const labels = n.labels.map((l) => {
    const tokens = l.tokens.map((t) => mode === "emoji17-full" && t.startsWith("u") ? CLASS_IDS.get(t)! : t);
    return JSON.stringify([LABEL_DOMAIN, tokens]);
  });
  return JSON.stringify(labels);
}

export function ownershipInfo() {
  return {
    version: EMOJI_OWNERSHIP_VERSION,
    manifestSha256: EMOJI_OWNERSHIP_MANIFEST_SHA256,
    tableSha256: EMOJI_OWNERSHIP_TABLE_SHA256,
    counts: EMOJI_OWNERSHIP_COUNTS,
    multiMemberClasses: EMOJI_OWNERSHIP_MULTI,
  };
}
