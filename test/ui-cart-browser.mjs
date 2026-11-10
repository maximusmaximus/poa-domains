import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { uiHarness } from "./fixtures/ui-harness.mjs";
import { inspectName } from "../reference-web/shared.js";
const browser = await chromium.launch({ headless: true });
try {
  for (const profile of ["fixture", "mainnet"]) {
    const h = await uiHarness(profile), page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("https://**", route => route.abort());
    try {
      await page.goto(h.url); await page.locator("#stats strong").first().waitFor();
      for (const name of ["🚀", "🚀🚀"]) {
        await page.locator("#searchInput").fill(name); await page.locator("#searchBtn").click();
        const tier = inspectName(name, h.cap.emojiManifest).tier;
        const reserve = h.cap.assets.POA[tier === "premium" ? "premiumReserve" : "standardReserve"];
        const input = page.getByLabel("Max bid for " + name, { exact: true });
        assert.equal(await input.inputValue(), reserve);
        await input.fill("bad"); await page.locator("#addToCartBtn").click();
        assert.match(await page.locator("#searchResult").innerText(), /at least/);
        await input.fill((BigInt(reserve) - 1n).toString()); await page.locator("#addToCartBtn").click();
        assert.equal(await page.locator("#cartCount").innerText(), "0");
        await input.fill(reserve); await page.locator("#addToCartBtn").click();
        const edited = (BigInt(reserve) * 3n).toString();
        const cartInput = page.getByLabel("Amount or max bid for " + name, { exact: true });
        await cartInput.fill(edited);
        await page.waitForFunction(()=>!document.querySelector("#copyCartPrompt").disabled);
        const prompt = await page.locator("#cartPrompt").innerText();
        const payload=JSON.parse(prompt.split("```json\n")[1].split("\n```")[0]);
        assert.equal(payload.items[0].params.reserve,reserve);assert.equal(payload.items[0].params.maxBid,edited);
        assert.ok(prompt.includes(`maxTotal=${edited}`));
        assert.ok((await page.locator("#cartList").innerText()).includes(`reserve=${reserve}`));
        await cartInput.fill("bad"); assert.equal(await page.locator("#copyCartPrompt").isDisabled(), true);
        assert.match(await page.locator("#cartList").innerText(), /positive whole-number/);
        await cartInput.fill(edited); await page.waitForFunction(()=>!document.querySelector("#copyCartPrompt").disabled); assert.equal(await page.locator("#copyCartPrompt").isEnabled(), true);
        // Reload a cart saved by the buggy PR #40: repair reserve without raising its cap.
        await page.evaluate(() => { const key = "poadomains.cart.v1"; const saved = JSON.parse(localStorage.getItem(key)); saved[0].params.reserve = saved[0].amount; localStorage.setItem(key, JSON.stringify(saved)); });
        await page.reload(); await page.locator("#stats strong").first().waitFor();
        await page.waitForFunction(()=>!document.querySelector("#copyCartPrompt").disabled);
        const repaired = await page.locator("#cartPrompt").innerText();
        const restored=JSON.parse(repaired.split("```json\n")[1].split("\n```")[0]);
        assert.equal(restored.items[0].params.reserve,reserve);assert.equal(restored.items[0].params.maxBid,edited);
        assert.equal(await page.getByLabel("Amount or max bid for " + name, { exact: true }).inputValue(), edited);
        await page.locator("#clearCart").click();
      }
      // Capability timing is not a presentation constant: use a deliberately different read-only fixture.
      h.cap.auctionWindows = { premium: { window: 7200, quiet: 5400 }, standard: { window: 1800, quiet: 900 } };
      await page.reload(); await page.locator("#stats strong").first().waitFor();
      await page.locator("#searchInput").fill("🚀"); await page.locator("#searchBtn").click();
      assert.match(await page.locator("#searchResult").innerText(), /2h minimum window \+ 1h 30m quiet/);
      assert.ok(await page.locator('#searchResult a[href="/d/%F0%9F%9A%80"]').count());
      assert.equal(await page.locator("#siteFooter").count(), 1);
      assert.ok(await page.locator("#sectionTabs .tab-dot").count() >= 6);
      assert.ok(!/xero\s*emoji/i.test(await page.locator("body").innerText()));
      assert.deepEqual(errors, []); assert.deepEqual(h.writes, []);
      console.log(`PASS ${profile}: capability price/window parity, invalid amounts, coherent cart edit, preserved UI`);
    } finally { await page.close(); await h.close(); }
  }
} finally { await browser.close(); }
