import test from "node:test";
import assert from "node:assert/strict";
import { buildOwnershipIndex, ownershipKeyOf, ownershipConflict, resolveDomainView } from "../reference-web/shared.js";
import { emoji17Manifest } from "../dist/src/names.js";
import { ownershipInfo, ownershipKey } from "../dist/src/emoji-ownership.js";

const info = ownershipInfo();
const index = buildOwnershipIndex(info);
const own = { manifest: emoji17Manifest, index };
const state = (names) => ({ time: 10, names: Object.fromEntries(names.map(([n, e]) => [n, { name: n, ...e }])), deeds: {}, auctions: {}, offers: {}, receipts: {} });

test("UI ownership keys match the registry's keys for every class member", () => {
  assert.equal(index.size, info.counts.multiMemberForms);
  const keys = new Map();
  for (const [rep, members] of info.multiMemberClasses) {
    for (const m of members) {
      const s = String.fromCodePoint(...m.split(" ").map((x) => parseInt(x, 16)));
      const ui = ownershipKeyOf(s + "a", emoji17Manifest, index);
      const reg = ownershipKey(s + "a", "emoji17-full");
      if (keys.has(reg)) assert.equal(keys.get(reg), ui); else keys.set(reg, ui);
    }
  }
  assert.equal(keys.size, info.multiMemberClasses.length);
});

test("domain view shows a variant spelling as taken, links the holder, and leaves other emoji available", () => {
  const s = state([["🏃", { activeId: "d1", auctionId: null }], ["😀", { activeId: null, auctionId: null }]]);
  assert.equal(ownershipConflict(s, "🏃🏽", emoji17Manifest, index), "🏃");
  const v = resolveDomainView(s, "🏃🏽", new Set(), own);
  assert.equal(v.status, "variant-taken"); assert.equal(v.variantOf, "🏃");
  assert.equal(resolveDomainView(s, "😀", new Set(), own).status, "available");
  assert.equal(resolveDomainView(s, "🏃🏽", new Set()).status, "available", "no ownership data -> unchanged behaviour");
});

test("UI shows no renewal or expiry wording for permanent names", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const app = readdirSync(new URL("../reference-web/", import.meta.url)).filter(name => name.endsWith(".js")).map(name => readFileSync(new URL("../reference-web/" + name, import.meta.url), "utf8")).join("\n");
  assert.match(app, /Owned forever/);
  assert.doesNotMatch(app, /Expiry \$\{d\.expiry\}/);
  assert.doesNotMatch(app, /renewLease/);
});
