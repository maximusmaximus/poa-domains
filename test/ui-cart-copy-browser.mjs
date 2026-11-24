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
  await expect(page.locator("#cartExpectations")).toBeHidden();
  await expect(page.locator("#searchResult")).toContainText("reaches finality and runs issue");
  await page.locator("#addToCartBtn").click();
  await expect(page.locator("#copyCartPrompt")).toBeEnabled();
  await expect(page.locator("#cartExpectations")).toBeVisible();
  await expect(page.locator("#cartExpectLead")).toContainText("1 name (100 POA total)");
  await expect(page.locator("#cartExpectations")).toContainText("Instant permanent mint");
  await expect(page.locator("#cartExpectations")).toContainText("Verify ownership right away");
  const expectedPrompt = await page.locator("#cartPrompt").textContent();
  assert.match(expectedPrompt, /poa-domains\.poa-checkout\.v1/);

  await page.locator("#copyCartPrompt").click();
  await expect(page.locator("#cartStatus")).toHaveText("✅ Copied");
  await expect(page.locator("#copyCartPrompt")).toHaveText("✅");
  const clipInline = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clipInline.replace(/\r\n/g, "\n"), expectedPrompt);

  // Open floating cart modal (visible off the Find tab), copy checkout prompt, verify clipboard, then click a link inside modal
  await page.locator("#tabHandoff").click();
  await page.locator("#floatingCartBtn").click();
  await expect(page.locator("#floatingCartPanel")).toBeVisible();
  await expect(page.locator("#floatingCartExpectations")).toBeVisible();
  await expect(page.locator("#floatingCartExpectations")).toContainText("mints permanently to your address immediately");
  await page.locator("#copyCheckoutBtn").click();
  await expect(page.locator("#floatingCartStatus")).toHaveText("✅ Request copied — nothing sent");
  const clipFloating = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clipFloating.replace(/\r\n/g, "\n"), expectedPrompt);

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

  // 4. Live POA checkout escrow readiness banner in cart & floating cart (held vs open)
  h.cap = { ...h.cap, escrow: { enabled: true, capabilities: "/v1/escrow/capabilities" } };
  h.escrowCap = {
    enabled: true,
    paused: false,
    held: true,
    holdReason: "ASSET_LIABILITY_MISMATCH",
    freshness: { held: true, code: "ESCROW_NODE_TIMEOUT", reason: "The public network read timed out." },
    address: "poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf",
    limits: { perTransaction: "250000.000000", daily: "1000000.000000" },
    serverTime: Date.now(),
  };
  const ctxEscrow = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageEscrow = await ctxEscrow.newPage();
  const errorsEscrow = [];
  pageEscrow.on("pageerror", (e) => errorsEscrow.push(e.message));
  await pageEscrow.route("https://**", (r) => r.abort());
  await pageEscrow.goto(h.url + "/?q=freshpoaname");
  await pageEscrow.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageEscrow.locator("#cartEscrowStatus")).toBeVisible();
  await expect(pageEscrow.locator("#cartEscrowStatus")).toContainText("currently on hold");
  await expect(pageEscrow.locator("#cartEscrowStatus")).toContainText("reconciliation hold");
  await expect(pageEscrow.locator("#cartEscrowStatus")).toContainText("public PoA network read timed out");
  await pageEscrow.locator("#addToCartBtn").click();
  await pageEscrow.locator("#tabHandoff").click();
  await pageEscrow.locator("#floatingCartBtn").click();
  await expect(pageEscrow.locator("#floatingCartEscrowStatus")).toBeVisible();
  await expect(pageEscrow.locator("#floatingCartEscrowStatus")).toContainText("stop at step 0");
  await pageEscrow.locator("#floatingCartClose").click();

  h.escrowCap = {
    ...h.escrowCap,
    held: false,
    holdReason: null,
    freshness: { held: false, code: null, reason: null },
  };
  await pageEscrow.reload();
  await pageEscrow.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageEscrow.locator("#cartEscrowStatus")).toContainText("🟢 POA checkout open");
  assert.deepEqual(errorsEscrow, []);
  await ctxEscrow.close();

  // 5. Shortened PoA address display (first 4 + "..." + last 4) + copy icon across views & escrow
  const sampleOwner = "poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf";
  const sampleEscrow = "poa1K9mN3pQ7rS2tU5vW8xY4zA6bC1dE3fG5hJ7kL9mN2p";
  const sampleDeedId = "a".repeat(64);
  const sampleReceiptId = "b".repeat(64);
  const sampleAuctionId = "c".repeat(64);
  h.payload.state.names.addrcheck = { name: "addrcheck", generation: 1, activeId: sampleDeedId, auctionId: null, version: 1 };
  h.payload.state.deeds[sampleDeedId] = {
    id: sampleDeedId,
    name: "addrcheck",
    parentId: null,
    generation: 1,
    owner: sampleOwner,
    version: 1,
    ownerVersion: 1,
    rights: { kind: "permanent" },
    records: [{ type: "poa", address: sampleOwner }],
    metadata: [{ cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" }],
  };
  h.payload.state.balances[sampleOwner] = { POA: "500" };
  h.payload.state.receipts[sampleReceiptId] = {
    intentId: sampleReceiptId,
    requestId: "req-addr-check",
    sequence: 99,
    time: h.payload.state.time,
    status: "succeeded",
    signer: sampleOwner,
    result: { deedId: sampleDeedId },
  };
  h.payload.state.auctions[sampleAuctionId] = {
    id: sampleAuctionId,
    name: "addrcheck",
    status: "cancelled",
    reserve: "100",
    asset: "POA",
    openAt: h.payload.state.time - 100,
    window: 60,
    quiet: 60,
    high: null,
    version: 1,
  };
  h.payload.state.credits.addrcheck = { amount: "25", payer: sampleOwner, auctionId: sampleAuctionId, asset: "POA", version: 1 };
  h.escrowCap = { ...h.escrowCap, address: sampleEscrow };

  const ctxAddr = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctxAddr.grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.url });
  const pageAddr = await ctxAddr.newPage();
  const errorsAddr = [];
  pageAddr.on("pageerror", (e) => errorsAddr.push(e.message));
  await pageAddr.route("https://**", (r) => r.abort());
  await pageAddr.goto(h.url + "/?q=addrcheck");
  await pageAddr.waitForFunction(() => document.body.dataset.registryStatus === "ready");

  // Search result shows shortened owner + copy icon that copies full owner address
  await expect(pageAddr.locator("#searchResult .poa-addr-text")).toHaveText("poa1...piRf");
  assert.equal((await pageAddr.locator("#searchResult").innerText()).includes(sampleOwner), false);
  await pageAddr.locator("#searchResult .poa-copy-btn").click();
  assert.equal(await pageAddr.evaluate(() => navigator.clipboard.readText()), sampleOwner);
  await expect(pageAddr.locator("#searchResult .poa-copy-btn")).toHaveClass(/is-copied/);

  // Explore tab: Names, Record, History, Balances all shorten & copy full address
  await pageAddr.locator("#tabExplore").click();
  for (const sel of ["#names", "#history", "#balances"]) {
    const text = await pageAddr.locator(sel).innerText();
    assert.equal(text.includes(sampleOwner), false, `${sel} must not show unshortened PoA address`);
    assert.ok(text.includes("poa1...piRf"), `${sel} must show shortened PoA address`);
    const btn = pageAddr.locator(`${sel} .poa-copy-btn`).first();
    await btn.click();
    assert.equal(await pageAddr.evaluate(() => navigator.clipboard.readText()), sampleOwner);
  }

  // Escrow tab: #escrowLimits shortens escrow address + copies full address
  await pageAddr.locator("#tabEscrow").click();
  await expect(pageAddr.locator("#escrowLimits .poa-addr-text")).toHaveText("poa1...mN2p");
  assert.equal((await pageAddr.locator("#escrowLimits").innerText()).includes(sampleEscrow), false);
  await pageAddr.locator("#escrowLimits .poa-copy-btn").click();
  assert.equal(await pageAddr.evaluate(() => navigator.clipboard.readText()), sampleEscrow);

  // Domain page -> Owner profile page shorten & copy full address
  await pageAddr.goto(h.url + "/d/addrcheck");
  await pageAddr.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageAddr.locator("#domainOwner .poa-addr-text")).toHaveText("poa1...piRf");
  await pageAddr.locator("#domainOwner .poa-copy-btn").click();
  assert.equal(await pageAddr.evaluate(() => navigator.clipboard.readText()), sampleOwner);
  await pageAddr.locator("#domainOwner a.poa-addr-text").click();
  await expect(pageAddr.locator("#ownerMain")).toBeVisible();
  await expect(pageAddr.locator("#ownerPrincipal .poa-addr-text")).toHaveText("poa1...piRf");
  assert.equal((await pageAddr.locator("#ownerPrincipal").innerText()).includes(sampleOwner), false);
  await pageAddr.locator("#ownerPrincipal .poa-copy-btn").click();
  assert.equal(await pageAddr.evaluate(() => navigator.clipboard.readText()), sampleOwner);

  assert.deepEqual(errorsAddr, []);
  await ctxAddr.close();

  console.log("PASS Cart copy regression: POA-only clipboard, execCommand fallback, manual selection, modal link navigation, handoff feedback, checkout expectations, escrow readiness banner & shortened PoA address copy");
} finally {
  await h.close();
  await browser.close();
}
