// GET-only loopback regression test for POA-mode cart copy, clipboard fallbacks, and modal navigation.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { uiHarness } from "./fixtures/ui-harness.mjs";
import { auditedEngine, get } from "./fixtures/audited-engine.mjs";

const browser = await chromium.launch({ headless: true });
const h = await uiHarness("mainnet");
const poaEng = auditedEngine();
h.cap = get(poaEng, "/v1/capabilities", { include: "emoji" }).data;
h.payload = get(poaEng, "/v1/state").data;

try {
  // 1. Granted real browser clipboard permissions in POA-only mode (matches poadomains.grok.me)
  const ctxGranted = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctxGranted.grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.url });
  const page = await ctxGranted.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://**", (r) => r.abort());
  await page.goto(h.url + "/?q=freshpoaname");
  await page.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await page.locator("#addToCartBtn").click();
  await expect(page.locator("#copyCartPrompt")).toBeEnabled();
  const expectedPrompt = await page.locator("#cartPrompt").textContent();
  assert.match(expectedPrompt, /poa-domains\.poa-checkout\.v1/);

  await page.locator("#copyCartPrompt").click();
  await expect(page.locator("#cartStatus")).toHaveText("✅ Copied");
  await expect(page.locator("#copyCartPrompt")).toHaveText("✅");
  const clipInline = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clipInline, expectedPrompt);

  // Open floating cart modal (visible off the Find tab), copy checkout prompt, verify clipboard, then click a link inside modal
  await page.locator("#tabHandoff").click();
  await page.locator("#floatingCartBtn").click();
  await expect(page.locator("#floatingCartPanel")).toBeVisible();
  await page.locator("#copyCheckoutBtn").click();
  await expect(page.locator("#floatingCartStatus")).toHaveText("✅ Request copied — nothing sent");
  const clipFloating = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clipFloating, expectedPrompt);

  // Clicking domain link inside floating modal closes the modal & un-inerts main content
  await page.locator('#floatingCartList a[href="/d/freshpoaname"]').click();
  await expect(page.locator("#floatingCartPanel")).toBeHidden();
  assert.equal(await page.evaluate(() => document.getElementById("domainMain").inert), false);
  await page.locator("#domainHomeLink").click();

  // Clearing cart clears stale floatingCartStatus
  await page.locator("#tabHandoff").click();
  await page.locator("#floatingCartBtn").click();
  await page.locator("#floatingCartClear").click();
  await expect(page.locator("#floatingCartStatus")).toHaveText("");
  await page.locator("#floatingCartClose").click();

  // Advanced handoff copy button gives visible feedback
  await page.locator("#tabHandoff").click();
  await page.locator("#advancedHandoff > summary").click();
  await page.locator("#action").selectOption("transfer");
  await page.locator("#signer").fill("poa1" + "1".repeat(32));
  await page.locator("#requestId").fill("req-copy-test-1");
  await page.locator("#nonce").fill("1");
  await page.locator("#notBefore").fill("0");
  await page.locator("#deadline").fill("9999999999");
  await page.locator("#maxTotal").fill("0");
  await page.locator("#maxNetworkFee").fill("0");
  await page.locator("#params").fill(JSON.stringify({ name: "freshpoaname", expectedDeedId: "a".repeat(64), expectedVersion: 1, recipient: "poa1" + "2".repeat(32) }));
  await page.locator('#handoff button[type="submit"]').click();
  await expect(page.locator("#copy")).toBeEnabled();
  await page.locator("#copy").click();
  await expect(page.locator("#handoffCopyStatus")).toHaveText("✅ Copied");

  assert.deepEqual(errors, []);
  await ctxGranted.close();

  // 2. Fallback when navigator.clipboard is undefined (non-HTTPS / restricted context) -> execCommand fallback
  const ctxNoClip = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageNoClip = await ctxNoClip.newPage();
  const errorsNoClip = [];
  pageNoClip.on("pageerror", (e) => errorsNoClip.push(e.message));
  await pageNoClip.route("https://**", (r) => r.abort());
  await pageNoClip.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const origExec = document.execCommand.bind(document);
    window.__execCopies = [];
    document.execCommand = (cmd, ...rest) => {
      if (cmd === "copy" && document.activeElement && "value" in document.activeElement) {
        window.__execCopies.push(document.activeElement.value);
        return true;
      }
      return origExec(cmd, ...rest);
    };
  });
  await pageNoClip.goto(h.url + "/?q=freshpoaname");
  await pageNoClip.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await pageNoClip.locator("#addToCartBtn").click();
  await expect(pageNoClip.locator("#copyCartPrompt")).toBeEnabled();
  const fallbackPrompt = await pageNoClip.locator("#cartPrompt").textContent();
  await pageNoClip.locator("#copyCartPrompt").click();
  await expect(pageNoClip.locator("#cartStatus")).toHaveText("✅ Copied");
  await pageNoClip.locator("#tabHandoff").click();
  await pageNoClip.locator("#floatingCartBtn").click();
  await pageNoClip.locator("#copyCheckoutBtn").click();
  await expect(pageNoClip.locator("#floatingCartStatus")).toHaveText("✅ Request copied — nothing sent");
  assert.deepEqual(await pageNoClip.evaluate(() => window.__execCopies), [fallbackPrompt, fallbackPrompt]);
  assert.deepEqual(errorsNoClip, []);
  await ctxNoClip.close();

  // 3. Manual-select fallback when both navigator.clipboard and execCommand fail
  const ctxManual = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageManual = await ctxManual.newPage();
  const errorsManual = [];
  pageManual.on("pageerror", (e) => errorsManual.push(e.message));
  await pageManual.route("https://**", (r) => r.abort());
  await pageManual.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => { throw new Error("blocked"); } },
      configurable: true,
    });
    document.execCommand = () => false;
  });
  await pageManual.goto(h.url + "/?q=freshpoaname");
  await pageManual.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await pageManual.locator("#addToCartBtn").click();
  await expect(pageManual.locator("#copyCartPrompt")).toBeEnabled();
  await pageManual.locator("#copyCartPrompt").click();
  await expect(pageManual.locator("#cartStatus")).toHaveText("📋 Press Ctrl/Cmd+C to copy the selected prompt.");
  assert.equal(
    (await pageManual.evaluate(() => window.getSelection().toString())).trim(),
    (await pageManual.locator("#cartPrompt").textContent()).trim(),
  );
  await pageManual.locator("#tabHandoff").click();
  await pageManual.locator("#floatingCartBtn").click();
  await pageManual.locator("#copyCheckoutBtn").click();
  await expect(pageManual.locator("#floatingCartPrompt")).toBeVisible();
  await expect(pageManual.locator("#floatingCartStatus")).toHaveText("📋 Press Ctrl/Cmd+C to copy the selected request.");
  assert.equal(
    (await pageManual.evaluate(() => window.getSelection().toString())).trim(),
    (await pageManual.locator("#floatingCartPrompt").textContent()).trim(),
  );
  assert.deepEqual(errorsManual, []);
  await ctxManual.close();

  console.log("PASS Cart copy regression: POA-only clipboard, execCommand fallback, manual selection, modal link navigation, handoff feedback");
} finally {
  await h.close();
  await browser.close();
}
