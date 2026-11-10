// Public GET-only loopback fixtures. No financial actions, keys, signatures or upstream I/O.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, firefox, webkit, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { uiHarness } from "./fixtures/ui-harness.mjs";
import {
  startBuiltSite,
  createSyntheticBaselineResponder,
  installIsolatedTransportGuard,
} from "./emoji-format-product-adapter.mjs";
const report = { scans: [], keyboard: [], writes: [], upstreamRequests: [] };
const save = () => {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/a11y-results.json",
    JSON.stringify(report, null, 2) + "\n",
  );
};
async function scan(page, label) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((x) =>
    ["serious", "critical"].includes(x.impact),
  );
  report.scans.push({
    label,
    serious: serious.length,
    violations: results.violations.map((x) => ({
      id: x.id,
      impact: x.impact,
      nodes: x.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
    incomplete: results.incomplete.map((x) => x.id),
  });
  save();
  if(label.startsWith("explorer"))assert.equal(results.violations.some(v=>v.id==="heading-order"),false,label+" heading hierarchy");
  assert.deepEqual(
    serious.map((x) => ({
      id: x.id,
      nodes: x.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
    [],
    label,
  );
}
async function tabTo(page, id) {
  for (let i = 0; i < 160; i++) {
    if (await page.evaluate((id) => document.activeElement?.id === id, id))
      return;
    await page.keyboard.press("Tab");
  }
  throw Error("Not keyboard reachable: " + id);
}
const h = await uiHarness();
let browser;
async function setup(page) {
  await page.route("https://**", (r) => {
    report.upstreamRequests.push(r.request().url());
    return r.abort();
  });
  await page.addInitScript(() => {
    window.__a11yCopied = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text) => window.__a11yCopied.push(text) },
    });
  });
  await page.goto(h.url);
  await page.waitForFunction(
    () => document.body.dataset.registryStatus === "ready",
  );
}
try {
  browser = await chromium.launch();
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
        viewport: { width, height: 900 },
      }),
      page = await context.newPage();
    await setup(page);
    // Public enabled/unpaused escrow UI, no signed account request and no financial button activation.
    await page.route("**/v1/escrow/**", async (r) => {
      assert.equal(r.request().method(), "GET");
      const path = new URL(r.request().url()).pathname;
      await r.fulfill({
        json: path.endsWith("/capabilities")
          ? {
              enabled: true,
              paused: false,
              held: false,
              address: "poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf",
              limits: {
                perTransaction: "250000.000000",
                daily: "1000000.000000",
              },
              serverTime: Date.now(),
            }
          : { items: [] },
      });
    });
    await page.reload();
    await page.waitForFunction(
      () => document.body.dataset.registryStatus === "ready",
    );
    for (const id of [
      "tabFind",
      "tabAuctions",
      "tabMarket",
      "tabExplore",
      "tabHandoff",
      "tabEscrow",
    ]) {
      await page.locator("#" + id).click();
      await scan(page, `explorer ${width} ${id}`);
      assert.equal(
        await page.locator("#homeMain > [role=tabpanel]:visible").count(),
        1,
      );
    }
    await page.locator("#tabFind").click();
    await page.locator("#searchInput").fill("a11yalpha");
    await page.locator("#searchInput").press("Enter");
    await expect(page.locator("#searchResultStatus")).toContainText(
      "a11yalpha",
    );
    await page.locator("#addToCartBtn").click();
    await expect(page.locator("#copyCartPrompt")).toBeEnabled();
    await page.locator("#floatingCartBtn").click();
    await scan(page, `cart dialog ${width}`);
    await page.keyboard.press("Escape");
    // Motion is controlled by interaction, not refresh/play buttons. Focus and reduced motion stop it.
    assert.equal(await page.locator("#ideasPause,#ideasShuffle").count(),0);
    const row=page.locator('#ideasStrip .ideas-row').first();await row.focus();
    await expect(row).toHaveAttribute('data-motion','paused');
    const before=await row.evaluate(n=>n.scrollLeft);await page.waitForTimeout(100);
    assert.equal(await row.evaluate(n=>n.scrollLeft),before);
    await page.emulateMedia({reducedMotion:'reduce'});await expect(row).toHaveAttribute('data-motion','reduced');
    await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('#searchInput').focus();await page.mouse.move(0,0);
    await expect(row).toHaveAttribute('data-motion','running',{timeout:4000});
    await context.close();
  }
  await browser.close();
  browser = null;
  for (const [name, kind] of Object.entries({ chromium, firefox, webkit })) {
    browser = await kind.launch();
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await setup(page);
    // No .focus(), click() or mouse operations in this search → add → copy journey.
    await tabTo(page, "searchInput");
    await page.keyboard.type("keyboardalpha");
    await page.keyboard.press("Enter");
    await tabTo(page, "addToCartBtn");
    await page.keyboard.press("Enter");
    await expect(page.locator("#copyCartPrompt")).toBeEnabled();
    await tabTo(page, "copyCartPrompt");
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => window.__a11yCopied.length), 1);
    assert.match(
      await page.evaluate(() => window.__a11yCopied[0]),
      /poa-domains.agent-cart.v2/,
    );
    await tabTo(page, "floatingCartBtn");
    await page.keyboard.press("Enter");
    await expect(page.locator("#floatingCartClose")).toBeFocused();
    await expect(page.locator("#homeMain")).toHaveAttribute("inert", "");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#copyCheckoutBtn")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#floatingCartClose")).toBeFocused();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      assert.ok(
        await page.evaluate(() =>
          document
            .getElementById("floatingCartPanel")
            .contains(document.activeElement),
        ),
      );
    }
    await page.locator("#floatingCartList button").first().focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#floatingCartClose")).toBeFocused();
    await expect(page.locator("#copyCheckoutBtn")).toBeDisabled();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#help-floatingCartPanel")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#floatingCartClose")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#floatingCartBtn")).toBeFocused();
    assert.equal(await page.locator("#homeMain").getAttribute("inert"), null);
    // Component setup may focus a tab: actual selection uses only APG keyboard keys.
    await page.locator("#tabFind").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tabAuctions")).toBeFocused();
    await expect(page.locator("#auctionsSection")).toBeVisible();
    await page.keyboard.press("End");
    await expect(page.locator("#tabHandoff")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tabFind")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#tabHandoff")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.locator("#tabFind")).toBeFocused();
    assert.equal(await page.locator('.section-tab[tabindex="0"]').count(), 1);
    await page.locator("#tabAuctions").click();
    await page.locator("#auctionTabCurrent").focus();
    await page.keyboard.press("End");
    await expect(page.locator("#auctionTabPast")).toBeFocused();
    await expect(page.locator("#auctions")).toHaveAttribute(
      "aria-labelledby",
      "auctionTabPast",
    );
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#auctionTabCurrent")).toBeFocused();
    assert.equal(await page.locator('.auction-tab[tabindex="0"]').count(), 1);
    // Real detail handler, return focus to opener, and a stable fallback if a poll removed it.
    await page.locator("#tabFind").click();
    await page.locator("#searchBtn").focus();
    await page.evaluate(async () => {
      const q = new URL(document.querySelector('script[src*="app.js"]').src)
        .search;
      const { openDetail } = await import("/ui-render.js" + q);
      openDetail({ label: "Read-only history", kind: "event" });
    });
    await expect(page.locator("#detailClose")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#searchBtn")).toBeFocused();
    await page.evaluate(async () => {
      const q = new URL(document.querySelector('script[src*="app.js"]').src)
        .search;
      const { openDetail } = await import("/ui-render.js" + q);
      const b = document.createElement("button");
      b.id = "temporary-opener";
      document.body.append(b);
      b.focus();
      openDetail({ label: "Read-only history", kind: "event" });
      b.remove();
    });
    await page.keyboard.press("Escape");
    await expect(page.locator("#tabFind")).toBeFocused();
    report.keyboard.push({
      browser: name,
      searchAddCopy: "keyboard-only",
      tabKeys: "wrap/Home/End/roving/panel relationship",
      cart: "forward/backward trap/Escape/restore/inert cleanup",
      detail: "Escape/opener return/removed-opener fallback",
    });
    save();
    await browser.close();
    browser = null;
  }
  const site = await startBuiltSite();
  try {
    browser = await chromium.launch();
    for (const width of [390, 1440]) {
      const context = await browser.newContext({
          viewport: { width, height: 900 },
        }),
        synthetic = createSyntheticBaselineResponder();
      const transport = await installIsolatedTransportGuard(
          context,
          site,
          synthetic,
        ),
        page = await context.newPage();
      await page.goto(site.url);
      await expect(page.locator("#refresh")).toBeEnabled();
      await expect(page.locator("#refreshAnnouncement")).toContainText(
        "Official-node observation",
      );
      await scan(page, `Pages ${width}`);
      assert.equal(
        await page
          .locator("#status[role],#error[role],#network-status[role]")
          .count(),
        0,
      );
      assert.equal(await page.locator("[role=status]").count(), 1);
      await page.keyboard.press("Tab");
      await expect(page.locator(".skip-link")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("#pagesMain")).toBeFocused();
      assert.equal(
        await page.locator(".hero-cta [aria-hidden=true]").count(),
        1,
      );
      await page.locator("#refresh").click();
      await expect(page.locator("#refresh")).toBeEnabled();
      await transport.settle();
      assert.deepEqual(transport.blocked, []);
      assert.ok(
        transport.observations.every(
          (x) => x.method === "GET" && !x.hasBody && !x.hasCredentials,
        ),
      );
      await context.close();
    }
    await browser.close();
    browser = null;
  } finally {
    await site.close();
  }
  assert.deepEqual(h.writes, []);
  assert.deepEqual(report.upstreamRequests, []);
  report.result =
    "PASS: zero serious/critical axe violations; all keyboard, motion, live-region and GET-only guards pass";
  save();
  console.log(
    report.result,
    JSON.stringify({
      scans: report.scans.length,
      keyboards: report.keyboard.length,
    }),
  );
} finally {
  await browser?.close();
  await h.close();
  save();
}
