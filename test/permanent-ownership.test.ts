import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setup, lease } from "./helpers.js";
import { Commit, Engine, LEGACY_LEASE_POLICY, PRACTICE_POLICY } from "../src/engine.js";
import { Fault } from "../src/core.js";
import { EMOJI17_ALIASES, EMOJI17_NORMALIZATION_HASH } from "../src/names.js";
import {
  EMOJI_OWNERSHIP_COUNTS, EMOJI_OWNERSHIP_MANIFEST_SHA256, EMOJI_OWNERSHIP_MULTI, EMOJI_OWNERSHIP_TABLE_SHA256,
  OWNERSHIP_TOKEN, ownershipKey, canonicalizeEmojiOwnership,
} from "../src/emoji-ownership.js";
import { capabilities } from "../src/interface.js";

const refused = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof Fault && e.code === code);
const emoji = (c: { normalizationHash: string }) => { c.normalizationHash = EMOJI17_NORMALIZATION_HASH; };

test("practice registry: ownership is permanent; renewals, lease expiry and lease child rights are refused", () => {
  const t = setup(undefined, PRACTICE_POLICY);
  t.win("alpha");
  const nonce = t.e.nextNonce(t.alice.id), seq = t.e.snapshot().sequence;
  refused(() => t.send("renewLease", { ...t.vp("alpha"), asset: "POA", amount: "50", termSeconds: 3600 }), "PERMANENT_OWNERSHIP_ONLY");
  refused(() => t.send("expireLease", t.vp("alpha")), "PERMANENT_OWNERSHIP_ONLY");
  refused(() => t.offer(lease(t.clock.now())), "PERMANENT_OWNERSHIP_ONLY");
  assert.equal(t.e.nextNonce(t.alice.id), nonce, "refusal consumes no nonce");
  assert.equal(t.e.snapshot().sequence, seq, "refusal writes nothing");
  const offerId = t.offer({ kind: "permanent" });
  assert.equal(t.fill(offerId).status, "succeeded");
  const r = t.send("transfer", { ...t.vp("alpha"), recipient: t.bob.id });
  assert.equal(r.status, "succeeded");
  const d = t.deed("alpha");
  assert.equal(d.rights.kind, "permanent"); assert.equal(d.expiry, null); assert.equal(d.owner, t.bob.id);
  const cap = capabilities(t.e);
  assert.equal(cap.ownership.model, "permanent"); assert.equal(cap.ownership.renewals, false);
  assert.deepEqual(cap.ownership.changesHandsBy, ["resale", "transfer"]);
  assert.deepEqual(cap.ownership.disabledActions, ["renewLease", "expireLease"]);
});

test("history recorded with leases and renewals still replays under the practice policy", () => {
  const t = setup();
  const commits: Commit[] = [];
  t.e.attach({ append: (c: Commit) => { commits.push(structuredClone(c)); }, close() {} });
  t.win("alpha");
  const offerId = t.offer(lease(t.clock.now()));
  assert.equal(t.fill(offerId).status, "succeeded");
  const child = t.deed("agent.alpha");
  t.clock.set(child.expiry! - 500);
  const renewed = t.send("renewLease", { ...t.vp("agent.alpha"), asset: "POA", amount: "50", termSeconds: 3600 }, t.bob);
  assert.equal(renewed.status, "succeeded");
  const fresh = new Engine(t.config, t.clock, PRACTICE_POLICY);
  for (const c of commits) fresh.replay(c);
  assert.equal(fresh.stateHash(), t.e.stateHash());
  assert.equal(fresh.snapshot().deeds[child.id]!.renewals, 1);
});

test("emoji ownership classes: a second spelling in the same class collides; other classes do not", () => {
  const t = setup(emoji, PRACTICE_POLICY);
  t.announce("🏃");
  for (const variant of ["🏃🏽", "🏃‍♀️", "🏃🏻‍♂️‍➡️"]) {
    refused(() => t.announce(variant), "OWNERSHIP_CLASS_TAKEN");
    assert.equal(t.e.resolve(variant).ownershipConflict, "🏃");
  }
  assert.equal(t.e.resolve("😀").ownershipConflict, null);
  t.announce("😀");
  t.announce("🏃a");
  refused(() => t.announce("🏃🏿a"), "OWNERSHIP_CLASS_TAKEN");
  // Re-announcing the exact same name is decided by normal execution, not the class check.
  const before = t.e.snapshot().sequence;
  assert.throws(() => t.announce("🏃"));
  assert.equal(t.e.snapshot().sequence, before + 1, "exact-name duplicate is a normal rejected receipt");
});

test("emoji ownership classes also apply to child labels under one parent", () => {
  const t = setup(emoji, PRACTICE_POLICY);
  t.win("alpha");
  const offerId = t.offer({ kind: "permanent" }, null);
  assert.equal(t.fill(offerId, "🎅").status, "succeeded");
  refused(() => t.fill(offerId, "🎅🏾"), "OWNERSHIP_CLASS_TAKEN");
  assert.equal(t.fill(offerId, "🤶").status, "succeeded");
});

test("ownership table is the pinned approved mapping and covers only engine spellings", () => {
  assert.equal(EMOJI_OWNERSHIP_MANIFEST_SHA256, "ac09d59266426b0b50b854e7eee304f9503ea9487929902c3c50822131f30a89");
  assert.equal(createHash("sha256").update(JSON.stringify(EMOJI_OWNERSHIP_MULTI)).digest("hex"), EMOJI_OWNERSHIP_TABLE_SHA256);
  assert.equal(EMOJI_OWNERSHIP_MULTI.length, 155);
  assert.equal(EMOJI_OWNERSHIP_MULTI.reduce((n, c) => n + c[1].length, 0), EMOJI_OWNERSHIP_COUNTS.multiMemberForms);
  assert.equal(EMOJI17_ALIASES.length, EMOJI_OWNERSHIP_COUNTS.spellings);
  const fq = new Set(EMOJI17_ALIASES.map((a) => a.token));
  assert.equal(fq.size, EMOJI_OWNERSHIP_COUNTS.fullyQualified);
  const classes = new Set(EMOJI17_ALIASES.map((a) => OWNERSHIP_TOKEN.get(a.token) ?? a.token));
  assert.equal(classes.size, EMOJI_OWNERSHIP_COUNTS.classes);
  for (const [member, rep] of OWNERSHIP_TOKEN) { assert.ok(fq.has(member)); assert.ok(fq.has(rep)); assert.equal(OWNERSHIP_TOKEN.get(rep), rep); }
  // 1..32 tokens per label; 33 is refused.
  assert.equal(canonicalizeEmojiOwnership("😀".repeat(32)).classIds.length, 32);
  assert.throws(() => ownershipKey("😀".repeat(33), "emoji17-full"));
});

// Optional full cross-check against the private approved mapping (not in the repo).
const dir = process.env.POA_EMOJI_OWNERSHIP_DIR;
test("all 5216 approved spellings map to their approved class (private map cross-check)", { skip: !dir || !existsSync(join(dir ?? "", "selected-spelling-map.json")) }, () => {
  const manifest = readFileSync(join(dir!, "selected-full-map-manifest.json"));
  assert.equal(createHash("sha256").update(manifest).digest("hex"), EMOJI_OWNERSHIP_MANIFEST_SHA256);
  const rows = JSON.parse(readFileSync(join(dir!, "selected-spelling-map.json"), "utf8")) as { inputSpelling: string; classId: string; proposedRepresentativeHex: string }[];
  assert.equal(rows.length, 5216);
  const keyToClass = new Map<string, string>(), classToKey = new Map<string, string>();
  for (const r of rows) {
    const canonical = EMOJI17_ALIASES.find((a) => a.input === r.inputSpelling)!.canonical;
    const result = canonicalizeEmojiOwnership(r.inputSpelling);
    assert.deepEqual(canonicalizeEmojiOwnership(r.inputSpelling.repeat(32)).classIds, Array(32).fill(r.classId));
    assert.throws(() => canonicalizeEmojiOwnership(r.inputSpelling.repeat(33)));
    assert.equal(result.classIds[0], r.classId);
    assert.equal(result.canonicalLabelKey, JSON.stringify(["poa-name-ownership-PROPOSED-v1", [r.classId]]));
    assert.equal([...result.representativeLabel].map(c => c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")).join(" "), r.proposedRepresentativeHex);
    const k = ownershipKey(canonical, "emoji17-full");
    assert.equal(keyToClass.get(k) ?? r.classId, r.classId); keyToClass.set(k, r.classId);
    assert.equal(classToKey.get(r.classId) ?? k, k); classToKey.set(r.classId, k);
  }
  assert.equal(classToKey.size, 1704);
});

test("legacy policy keeps lease semantics available for historical engines only", () => {
  assert.equal(LEGACY_LEASE_POLICY.permanentOnly, false);
  assert.equal(PRACTICE_POLICY.permanentOnly, true);
  assert.equal(PRACTICE_POLICY.emojiOwnership, true);
});
