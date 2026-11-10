// GET-only loopback fixtures; clipboard/download are local browser artifacts, never PoA writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  AGENT_CART_SCHEMA,
  validateAgentCartHandoff,
} from "../reference-web/agent-cart.js";
import { uiHarness } from "./fixtures/ui-harness.mjs";
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validate = ajv.compile(AGENT_CART_SCHEMA);
const browser = await chromium.launch({ headless: true }),
  h = await uiHarness(),
  page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
  }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("https://**", (r) => r.abort());
await page.addInitScript(() => {
  window.__copied = [];
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async (text) => window.__copied.push(text) },
  });
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  window.__digestQueue = [];
  crypto.subtle.digest = async (...args) => {
    if (window.__holdDigests)
      await new Promise((resolve) => window.__digestQueue.push(resolve));
    if (window.__failDigests) throw Error("fixture digest unavailable");
    return digest(...args);
  };
});
const ready = () => expect(page.locator("#copyCartPrompt")).toBeEnabled();
const payload = async () =>
  JSON.parse(
    (await page.locator("#cartPrompt").innerText())
      .split("```json\n")[1]
      .split("\n```")[0],
  );
async function blocked() {
  for (const id of ["copyCartPrompt", "copyCheckoutBtn", "downloadCartJSON"])
    await expect(page.locator("#" + id)).toBeDisabled();
}
try {
  await page.clock.install();
  await page.goto(h.url + "/?q=alpha");
  await page.waitForFunction(
    () => document.body.dataset.registryStatus === "ready",
  );
  await page.locator("#addToCartBtn").click();
  await ready();
  const data = await payload();
  assert.ok(validate(data), ajv.errorsText(validate.errors));
  assert.equal(await validateAgentCartHandoff(data), true);
  assert.equal(data.signerPrincipal, null);
  await expect(page.locator("#cartHandoffMeta")).toHaveText(
    "🧾 Agent Cart Handoff v2 · generated 0m ago",
  );
  await page.locator("#copyCartPrompt").click();
  await page.locator("#floatingCartBtn").click();
  await page.locator("#copyCheckoutBtn").click();
  assert.deepEqual(await page.evaluate(() => window.__copied), [
    await page.locator("#cartPrompt").innerText(),
    await page.locator("#cartPrompt").innerText(),
  ]);
  await expect(page.locator("#floatingHandoffMeta")).toHaveText(
    await page.locator("#cartHandoffMeta").innerText(),
  );
  await page.locator("#floatingCartClose").click();
  const pending = page.waitForEvent("download");
  await page.locator("#downloadCartJSON").click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), "poa-domains-cart-v2.json");
  assert.deepEqual(
    JSON.parse(readFileSync(await download.path(), "utf8")),
    data,
  );
  // Advance wall time, not interval timers, then run the actual module's minute/hour renderer.
  for (const [delta, label] of [
    [120000, "2m"],
    [7200000, "2h 0m"],
  ]) {
    await page.clock.setSystemTime(data.generatedAt + delta);
    await page.evaluate(async () => {
      const query = new URL(document.querySelector('script[src*="app.js"]').src)
        .search;
      const { updateFreshness } = await import("/ui-poll.js" + query);
      updateFreshness();
    });
    await expect(page.locator("#cartHandoffMeta")).toContainText(
      "generated " + label + " ago",
    );
  }
  const input = page.getByLabel("Bid or price amount in POA for alpha", { exact: true });
  await page.evaluate(() => (window.__holdDigests = true));
  await input.fill("300");
  await blocked();
  await input.fill("400");
  await page.waitForFunction(() => window.__digestQueue.length >= 2);
  await page.evaluate(() => {
    window.__holdDigests = false;
    window.__digestQueue.splice(0).forEach((resolve) => resolve());
  });
  await ready();
  const edited = await payload();
  assert.equal(edited.items[0].maxTotal, "400");
  assert.equal(edited.items[0].params.reserve, data.items[0].params.reserve);
  assert.notEqual(edited.items[0].requestId, data.items[0].requestId);
  assert.ok(validate(edited), ajv.errorsText(validate.errors));
  // A late completion after clear must not restore a stale downloadable/spendable plan.
  await page.evaluate(() => (window.__holdDigests = true));
  await input.fill("500");
  await page.waitForFunction(() => window.__digestQueue.length > 0);
  await page.locator("#clearCart").click();
  await page.evaluate(() => {
    window.__holdDigests = false;
    window.__digestQueue.splice(0).forEach((resolve) => resolve());
  });
  await blocked();
  await expect(page.locator("#cartPrompt")).toContainText(
    "Add one or more domains",
  );
  await page.locator("#addToCartBtn").click();
  await ready();
  await page.evaluate(() => (window.__failDigests = true));
  await page
    .getByLabel("Bid or price amount in POA for alpha", { exact: true })
    .fill("600");
  await expect(page.locator("#cartPrompt")).toContainText("Could not build");
  await blocked();
  await page.evaluate(() => (window.__failDigests = false));
  await page
    .getByLabel("Bid or price amount in POA for alpha", { exact: true })
    .fill("700");
  await ready();
  h.stateStatus = 500;
  await page.evaluate(async () => {
    const query = new URL(document.querySelector('script[src*="app.js"]').src)
      .search;
    const { refreshRegistry } = await import("/ui-poll.js" + query);
    await refreshRegistry();
  });
  await expect(page.locator("#registryError")).toBeVisible();
  await blocked();
  h.stateStatus = 200;
  await page.locator("#registryRetry").click();
  await ready();
  // Exercise the same network-hold predicate as the poller, without changing any live setting.
  await page.evaluate(async () => {
    const query = new URL(document.querySelector('script[src*="app.js"]').src)
      .search;
    const { ui } = await import("/ui-state.js" + query),
      { updatePromptText } = await import("/ui-cart.js" + query);
    ui.networkStatus = { level: "down", hold: true };
    await updatePromptText();
  });
  await blocked();
  await page.locator("#tabEscrow").click();
  await expect(page.locator("#escrowSection h2")).toHaveText("🪙 My POA");
  assert.equal(await page.locator("#siteFooter").count(), 1);
  assert.equal(await page.locator(".tab-dot").count(), 6);
  assert.deepEqual(errors, []);
  assert.deepEqual(h.writes, []);
  console.log(
    "PASS Cart v2: schema, identical copies/JSON download, minute/hour age, caps/reserve, async race/clear/failure, read/network guards, escrow mount",
  );
} finally {
  await page.close();
  await h.close();
  await browser.close();
}
