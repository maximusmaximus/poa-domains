import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindTabKeys } from "../reference-web/ui-a11y.js";
import { suites, coverageMatrix } from "../scripts/ci.mjs";
test("every main and auction tab has a unique explicit panel, labelled panel and initial roving tab stop", () => {
  const html = readFileSync("reference-web/index.html", "utf8"),
    ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((x) => x[1]);
  assert.equal(new Set(ids).size, ids.length);
  const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map(
    (x) => x[0],
  );
  assert.equal(tabs.length, 9);
  assert.equal(tabs.filter((x) => x.includes('tabindex="0"')).length, 2);
  for (const tab of tabs) {
    const panel = /aria-controls="([^"]+)"/.exec(tab)?.[1],
      id = /\bid="([^"]+)"/.exec(tab)?.[1];
    assert.ok(panel && id);
    const element = new RegExp(
      `<[^>]+id="${panel}"[^>]+role="tabpanel"[^>]*>`,
    ).exec(html)?.[0];
    assert.ok(element, panel);
    if (!id.startsWith("auctionTab"))
      assert.ok(element.includes(`aria-labelledby="${id}"`));
  }
  assert.ok(
    html.includes(
      'id="cartStatus" class="muted" role="status" aria-live="polite"',
    ),
  );
  assert.ok(html.includes('id="searchResultStatus"'));
  assert.ok(html.includes('id="ideasPause"'));
  assert.ok(html.includes('id="siteFooter"'));
  assert.ok(html.includes('class="tab-dot"'));
});
test("APG arrows wrap, Home/End jump, modifier keys and ordinary Tab retain native behavior", () => {
  let listener;
  const tabs = Array.from({ length: 3 }, () => ({
      focus() {
        this.focused = true;
      },
      scrollIntoView() {},
    })),
    list = {
      querySelectorAll: () => tabs,
      addEventListener: (type, fn) => {
        assert.equal(type, "keydown");
        listener = fn;
      },
    };
  let selected;
  bindTabKeys(list, (t) => (selected = t));
  for (const [index, key, expected] of [
    [0, "ArrowLeft", 2],
    [2, "ArrowRight", 0],
    [1, "Home", 0],
    [1, "End", 2],
  ]) {
    let prevented = false;
    listener({
      target: tabs[index],
      key,
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(selected, tabs[expected]);
    assert.equal(prevented, true);
    assert.equal(tabs[expected].focused, true);
  }
  for (const extra of [
    { key: "Tab" },
    { key: "ArrowRight", ctrlKey: true },
    { key: "ArrowLeft", altKey: true },
    { key: "Home", metaKey: true },
  ]) {
    let prevented = false;
    selected = null;
    listener({
      target: tabs[0],
      ...extra,
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(selected, null);
    assert.equal(prevented, false);
  }
  bindTabKeys(null, () => assert.fail("absent list"));
});
test("Pages has one coordinated refresh live region, a keyboard skip target, and hidden decorative emoji", () => {
  const html = readFileSync("web/index.html", "utf8");
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.equal((html.match(/role="alert"/g) ?? []).length, 0);
  assert.match(html, /<a class="skip-link" href="#pagesMain">/);
  assert.match(html, /<main id="pagesMain" tabindex="-1">/);
  for (const emoji of ["🌐", "⛏️", "📡", "🔎", "✅", "🪙", "⛔", "🔤", "📚", "❤️"])
    assert.ok(html.includes(`<span aria-hidden="true">${emoji}</span>`));
  const css = readFileSync("reference-web/style.css", "utf8");
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /input:focus-visible/);
  assert.ok(
    !suites["browser-escrow"].some((c) =>
      c.includes("test/ui-a11y-browser.mjs"),
    ),
  );
});
test("new axe/keyboard lane is parallel and fully included in coverage; no existing escrow suite replaced", () => {
  assert.deepEqual(suites["browser-a11y"], [
    ["node", "test/ui-a11y-browser.mjs"],
    ["node", "test/ui-perf-browser.mjs"],
  ]);
  assert.ok(
    coverageMatrix.some(
      ([suite, node]) => suite === "browser-a11y" && node === "24",
    ),
  );
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /- browser-a11y/);
  assert.match(ci, /- browser-escrow/);
  assert.match(ci, /test-results\/a11y-results.json/);
});

test("the a11y helper uses the same cache revision as the complete UI module graph", async () => {
  const { stampAssets } = await import("../scripts/stamp-assets.mjs");
  assert.equal(stampAssets().changed, false);
  const revision = /app\.js\?v=([a-f0-9]{12})/.exec(readFileSync("reference-web/index.html", "utf8"))[1];
  for (const file of ["app.js", "ui-cart.js", "ui-render.js"])
    assert.ok(readFileSync(`reference-web/${file}`, "utf8").includes(`./ui-a11y.js?v=${revision}`), file);
});
