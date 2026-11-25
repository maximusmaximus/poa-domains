// GET-only loopback regression test for POA-mode cart copy, clipboard fallbacks, and modal navigation.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { uiHarness } from "./fixtures/ui-harness.mjs";
import { auditedEngine, get } from "./fixtures/audited-engine.mjs";
import { nativePrincipal } from "../dist/src/auth.js";
import { rightsHash as computeRightsHash } from "../dist/src/model.js";
import { buildProfileWitness } from "../dist/src/profile.js";
import { TERMS_DOMAIN, TERMS_HASH, TERMS_VERSION, signTermsAgreement } from "../dist/src/terms.js";

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
  await page.locator("#termsAgreeBtn").click();
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
  await page.locator("#advancedLink").click();
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
  // Clicking the footer Advanced link from a domain page opens Advanced Handoff at /?tab=handoff
  await page.locator("#advancedLink").click();
  await expect(page.locator("#handoffSection")).toBeVisible();
  await expect(page.locator("#domainMain")).toBeHidden();
  await expect(page.locator("#advancedLink")).toHaveAttribute("aria-current", "page");
  const advUrl = new URL(page.url());
  assert.equal(advUrl.pathname, "/");
  assert.equal(advUrl.searchParams.get("tab"), "handoff");
  await page.locator("#floatingCartBtn").click();
  await page.locator("#floatingCartClear").click();
  await expect(page.locator("#floatingCartStatus")).toHaveText("");
  await page.locator("#floatingCartClose").click();

  // Advanced handoff copy button gives visible feedback
  await page.locator("#advancedLink").click();
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
  await pageNoClip.locator("#termsAgreeBtn").click();
  await pageNoClip.locator("#addToCartBtn").click();
  await expect(pageNoClip.locator("#copyCartPrompt")).toBeEnabled();
  const fallbackPrompt = await pageNoClip.locator("#cartPrompt").textContent();
  await pageNoClip.locator("#copyCartPrompt").click();
  await expect(pageNoClip.locator("#cartStatus")).toHaveText("✅ Copied");
  await pageNoClip.locator("#advancedLink").click();
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
  await pageManual.locator("#termsAgreeBtn").click();
  await pageManual.locator("#addToCartBtn").click();
  await expect(pageManual.locator("#copyCartPrompt")).toBeEnabled();
  await pageManual.locator("#copyCartPrompt").click();
  await expect(pageManual.locator("#cartStatus")).toHaveText("📋 Press Ctrl/Cmd+C to copy the selected prompt.");
  assert.equal(
    (await pageManual.evaluate(() => window.getSelection().toString())).trim(),
    (await pageManual.locator("#cartPrompt").textContent()).trim(),
  );
  await pageManual.locator("#advancedLink").click();
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
  await pageEscrow.locator("#termsAgreeBtn").click();
  await expect(pageEscrow.locator("#cartEscrowStatus")).toBeVisible();
  await expect(pageEscrow.locator("#cartEscrowStatus")).toContainText("POA checkout paused");
  await expect(pageEscrow.locator("#cartEscrowStatus")).toContainText("Reconciliation hold awaiting operator review");
  await expect(pageEscrow.locator("#cartEscrowStatus")).toContainText("Public PoA network read timed out");
  await expect(pageEscrow.locator("#cartEscrowStatus")).not.toContainText("Network freshness or verification is held");
  await pageEscrow.locator("#addToCartBtn").click();
  await pageEscrow.locator("#advancedLink").click();
  await pageEscrow.locator("#floatingCartBtn").click();
  await expect(pageEscrow.locator("#floatingCartEscrowStatus")).toBeVisible();
  await expect(pageEscrow.locator("#floatingCartEscrowStatus")).toContainText("wait to send POA until checkout reopens");
  await pageEscrow.locator("#floatingCartClose").click();

  // Verbose freshness hold boilerplate is collapsed to one crisp reason with no duplication
  h.escrowCap = {
    ...h.escrowCap,
    held: true,
    holdReason: "Network freshness or verification is held. The network reading is stale or inconsistent. Payments stay held.",
    freshness: {
      held: true,
      code: "ESCROW_STALE",
      reason: "Network freshness or verification is held. The network reading is stale or inconsistent. Payments stay held.",
    },
  };
  await pageEscrow.reload();
  await pageEscrow.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageEscrow.locator("#cartEscrowStatus .cart-escrow-title")).toHaveText("⏸️ POA checkout paused");
  await expect(pageEscrow.locator("#cartEscrowStatus .cart-escrow-reason")).toHaveText("PoA network status is stale.");
  await expect(pageEscrow.locator("#cartEscrowStatus")).not.toContainText("Network freshness or verification is held");
  await expect(pageEscrow.locator("#cartEscrowStatus")).not.toContainText("Payments stay held");

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
  await pageAddr.locator("#termsAgreeBtn").click();

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

  // 6. Search autofill/dropdown + auto-add, clean cart items, cart-owned prefill,
  //    Manage this domain button, Profile v1 editor + avatar upload + /d/<name> view,
  //    and reorganized Escrow Signed Request steps + ℹ️ help icons.
  const ctxUx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctxUx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.url });
  const pageUx = await ctxUx.newPage();
  const errorsUx = [];
  pageUx.on("pageerror", (e) => errorsUx.push(e.message));
  await pageUx.route("https://**", (r) => r.abort());
  const samplePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAIklEQVR4nGNg+M/A8J+BgYGBkYGBgYmBgYGBiYGBgQEAQhgBA9N0j98AAAAASUVORK5CYII=",
    "base64",
  );
  const mockAvatarCid = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
  await pageUx.route("**/v1/media/upload", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cid: mockAvatarCid,
        uri: `ipfs://${mockAvatarCid}`,
        mediaUrl: `/v1/media/${mockAvatarCid}`,
        contentType: "image/png",
        bytes: samplePng.length,
        r2Stored: true,
        ipfsPinned: true,
      }),
    });
  });
  await pageUx.route(`**/v1/media/${mockAvatarCid}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: samplePng });
  });

  await pageUx.goto(h.url + "/");
  await pageUx.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await pageUx.locator("#termsAgreeBtn").click();

  // (a) Autofill + dropdown + click auto-adds to cart
  await pageUx.locator("#searchInput").fill("agen");
  await expect(pageUx.locator("#searchAutofill")).toHaveText("agent ⇥");
  await expect(pageUx.locator("#searchSuggestions")).toBeVisible();
  await pageUx.locator("#searchSuggestions [role='option']", { hasText: "agent" }).first().click();
  await expect(pageUx.locator("#cartCount")).toHaveText("1");
  await expect(pageUx.locator("#cartList")).toContainText("agent");

  // (b) Clean POA cart item copy (no "Buy with POA · standard root", no "Buy \"agent\" for 100 POA with POA checkout.")
  const inlineCartText = await pageUx.locator("#cartList").innerText();
  assert.ok(inlineCartText.includes("🪙 100 POA · Standard root"), inlineCartText);
  assert.equal(inlineCartText.includes("Buy with POA"), false, inlineCartText);
  assert.equal(inlineCartText.includes("with POA checkout."), false, inlineCartText);

  // Check button also auto-adds in POA-only mode
  await pageUx.locator("#searchInput").fill("lunar");
  await pageUx.locator("#searchBtn").click();
  await expect(pageUx.locator("#cartCount")).toHaveText("2");

  // Floating cart also uses clean price + type copy
  await pageUx.locator("#advancedLink").click();
  await pageUx.locator("#floatingCartBtn").click();
  const floatCartText = await pageUx.locator("#floatingCartList").innerText();
  assert.ok(floatCartText.includes("🪙 100 POA · Standard root"), floatCartText);
  assert.equal(floatCartText.includes("Buy with POA"), false, floatCartText);
  await pageUx.locator("#floatingCartClose").click();

  // (c) Settled cart items identify owner, prefill Manage domains, and drive the live
  //     Manage domains inventory badge (increases on acquisition, decreases on sale/transfer).
  await expect(pageUx.locator("#managedDomainsBadge")).toBeHidden();
  const buyerOwner = "poa1Buyer9mN3pQ7rS2tU5vW8xY4zA6bC1dE3fG5hJ7kL9mN";
  const otherOwner = "poa1Other2aB4cD6eF8gH1jK3mN5pQ7rS9tU2vW4xY6zA8b";
  const agentDeedId = "d".repeat(64);
  const lunarDeedId = "e".repeat(64);
  const solarDeedId = "9".repeat(64);
  const rightsHash = "f".repeat(64);
  // Partial settlement first (1 of 2 cart items settled) -> badge lights up with 🌱1
  h.payload.state.names.agent = { name: "agent", generation: 1, activeId: agentDeedId, auctionId: null, version: 1 };
  h.payload.state.deeds[agentDeedId] = {
    id: agentDeedId, name: "agent", parentId: null, generation: 1, owner: buyerOwner,
    version: 1, ownerVersion: 1, rights: { kind: "permanent" }, rightsHash, records: [],
    metadata: [{ cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" }],
  };
  await pageUx.reload();
  await pageUx.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageUx.locator("#managedDomainsBadge")).toBeVisible();
  await expect(pageUx.locator("#managedDomainsBadge")).toHaveText("🌱1");

  // Full settlement (both cart items settled) -> badge ticks up to 🌱2 and shows all-registered banner
  h.payload.state.names.lunar = { name: "lunar", generation: 1, activeId: lunarDeedId, auctionId: null, version: 1 };
  h.payload.state.deeds[lunarDeedId] = {
    id: lunarDeedId, name: "lunar", parentId: null, generation: 1, owner: buyerOwner,
    version: 1, ownerVersion: 1, rights: { kind: "permanent" }, rightsHash, records: [],
    metadata: [{ cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" }],
  };
  await pageUx.reload();
  await pageUx.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await pageUx.locator("#tabFind").click();
  await expect(pageUx.locator("#cartOwnedNotice")).toBeVisible();
  await expect(pageUx.locator("#cartOwnedNotice")).toContainText("All names in your cart are now registered");
  assert.equal(await pageUx.locator("#manageOwner").inputValue(), buyerOwner);
  await expect(pageUx.locator("#managedDomainsBadge")).toHaveText("🌱2");

  // Acquiring a 3rd domain increases the badge to 🌱3; losing domains decreases it to 🌱1 and hides at 0
  h.payload.state.names.solar = { name: "solar", generation: 1, activeId: solarDeedId, auctionId: null, version: 1 };
  h.payload.state.deeds[solarDeedId] = {
    id: solarDeedId, name: "solar", parentId: null, generation: 1, owner: buyerOwner,
    version: 1, ownerVersion: 1, rights: { kind: "permanent" }, rightsHash, records: [],
    metadata: [{ cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" }],
  };
  await pageUx.reload();
  await pageUx.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageUx.locator("#managedDomainsBadge")).toHaveText("🌱3");

  // Transfer 2 domains away -> badge decreases to 🌱1
  h.payload.state.deeds[solarDeedId].owner = otherOwner;
  h.payload.state.deeds[lunarDeedId].owner = otherOwner;
  await pageUx.reload();
  await pageUx.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageUx.locator("#managedDomainsBadge")).toHaveText("🌱1");

  // Transfer final domain away -> badge hides (0 owned), then restore buyerOwner for remaining checks
  h.payload.state.deeds[agentDeedId].owner = otherOwner;
  await pageUx.reload();
  await pageUx.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageUx.locator("#managedDomainsBadge")).toBeHidden();

  delete h.payload.state.names.solar;
  delete h.payload.state.deeds[solarDeedId];
  h.payload.state.deeds[agentDeedId].owner = buyerOwner;
  h.payload.state.deeds[lunarDeedId].owner = buyerOwner;
  await pageUx.reload();
  await pageUx.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await pageUx.locator("#tabFind").click();
  await expect(pageUx.locator("#managedDomainsBadge")).toHaveText("🌱2");

  // (d) "Manage this domain" button on sold search result navigates to Manage domains & opens profile editor
  await pageUx.locator("#searchInput").fill("agent");
  await pageUx.locator("#searchBtn").click();
  await expect(pageUx.locator("#searchResult")).toContainText("Manage this domain");
  await pageUx.locator('#searchResult button[aria-label="Manage agent"]').click();
  await expect(pageUx.locator("#escrowSection")).toBeVisible();
  await expect(pageUx.locator("#manageOwnerNotice")).toBeVisible();
  const agentCard = pageUx.locator('#manageNames article[data-domain-name="agent"]');
  await expect(agentCard).toBeVisible();
  await expect(agentCard.locator("details.profile-editor")).toHaveAttribute("open", "");
  await expect(agentCard.locator("details.profile-editor summary")).toHaveText("🪪 Public profile");
  await expect(agentCard.locator(".profile-public-notice")).toContainText("public");
  assert.equal(/(IPFS|R2)/.test(await agentCard.locator(".profile-public-notice").innerText()), false);
  await expect(agentCard.locator(".profile-upload-row button")).toHaveText("📤 Upload");

  // (e) Profile v1 editor: EIP-55 checksum fix, BTC mainnet, bio, image upload,
  //     square header avatar live update, and live Agent prompt window with familiar buttons
  await expect(pageUx.locator("#managePromptPanel")).toBeVisible();
  const initialHeaderAvatarBox = await agentCard.locator("h3 .domain-header-avatar").boundingBox();
  assert.ok(initialHeaderAvatarBox && Math.abs(initialHeaderAvatarBox.width - initialHeaderAvatarBox.height) < 1, "Manage header avatar must be square");
  assert.equal(await pageUx.locator("#escrowPayer").inputValue(), buyerOwner);
  await expect(agentCard.locator('button[aria-label="Sell for POA: agent"]')).toBeVisible();
  await expect(agentCard.locator('button[aria-label="Auction for POA: agent"]')).toBeVisible();
  await agentCard.locator('input[data-profile-field="btc"]').fill("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
  await agentCard.locator('input[data-profile-field="eth"]').fill("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed");
  await expect(agentCard.locator(".profile-eth-fix")).toBeVisible();
  await agentCard.locator(".profile-eth-fix button").click();
  assert.equal(
    await agentCard.locator('input[data-profile-field="eth"]').inputValue(),
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  );
  await agentCard.locator('textarea[data-profile-field="description"]').fill("Agent bio https://minepoa.com <script>alert(1)</script>");
  // Live Agent Prompt window updates automatically from fields interacted with above (before clicking Copy!)
  await expect(pageUx.locator("#managePrompt")).toContainText("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
  await expect(pageUx.locator("#managePrompt")).toContainText("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
  await expect(pageUx.locator("#copyManagePrompt")).toBeEnabled();
  await expect(pageUx.locator("#downloadManageJSON")).toBeEnabled();
  await expect(pageUx.locator("#clearManagePrompt")).toBeEnabled();
  await agentCard.locator('input[type="file"]').setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: samplePng,
  });
  await expect(agentCard.locator(".profile-upload-row")).toContainText("Image uploaded");
  assert.equal(await agentCard.locator('input[data-profile-field="image"]').inputValue(), `ipfs://${mockAvatarCid}`);
  await expect(agentCard.locator("h3 .domain-header-avatar img")).toHaveAttribute("src", `/v1/media/${mockAvatarCid}`);
  await expect(pageUx.locator("#managePrompt")).toContainText(`ipfs://${mockAvatarCid}`);
  await agentCard.getByRole("button", { name: /Copy profile prompt for my agent/ }).click();
  const profilePrompt = await pageUx.locator("#managePrompt").textContent();
  assert.match(profilePrompt, /poa-domains\.profile\.v1/);
  assert.match(profilePrompt, /setMetadata/);
  assert.match(profilePrompt, /0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed/);
  assert.match(profilePrompt, /bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4/);
  assert.equal((await pageUx.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), profilePrompt);

  // Familiar Clear button clears the preview window & disables Copy/Download
  await pageUx.locator("#clearManagePrompt").click();
  await expect(pageUx.locator("#copyManagePrompt")).toBeDisabled();
  await expect(pageUx.locator("#downloadManageJSON")).toBeDisabled();

  // Clicking "Auction for POA" on an available held domain populates My POA with auto-filled POA address,
  // domain name, active "open" auction command, and live updates when amount changes!
  await pageUx.locator('#manageNames button[aria-label="Auction for POA: lunar"]').click();
  assert.equal(await pageUx.locator("#escrowPayer").inputValue(), buyerOwner);
  assert.equal(await pageUx.locator("#escrowName").inputValue(), "lunar");
  await expect(pageUx.locator("#escrowPrompt")).toContainText('"action": "open"');
  await expect(pageUx.locator("#escrowPrompt")).toContainText('"name": "lunar"');
  await expect(pageUx.locator("#escrowPrompt")).toContainText("Sale & auction notice");
  await expect(pageUx.locator("#downloadEscrowJSON")).toBeEnabled();
  await expect(pageUx.locator("#clearEscrowPrompt")).toBeEnabled();
  await pageUx.locator("#escrowAmount").fill("325");
  await expect(pageUx.locator("#escrowPrompt")).toContainText('"reserve": "325.000000"');
  await pageUx.locator("#clearEscrowPrompt").click();
  await expect(pageUx.locator("#downloadEscrowJSON")).toBeDisabled();
  await expect(pageUx.locator("#clearEscrowPrompt")).toBeDisabled();

  // (f) Reorganized Escrow Signed Request workflow with steps + ℹ️ popovers & clean Manage domains (no inline parentheses)
  await expect(pageUx.locator('#escrowPayments .escrow-step[data-step="1"] h3')).toContainText("1. Pick an action");
  await expect(pageUx.locator('#escrowPayments .escrow-step[data-step="2"] h3')).toContainText("2. Copy the prompt to your agent");
  await expect(pageUx.locator('#escrowPayments .escrow-step[data-step="3"] h3')).toContainText("3. Paste & submit");
  assert.equal((await pageUx.locator("#escrowPayments").innerText()).includes("Signed request — public command and signature only"), false);
  for (const sel of [
    "#manageOwnerLabelRow label",
    "#manageOwnerNotice > span:first-child",
    '#manageNames article[data-domain-name="agent"] .profile-form label',
    '#manageNames article[data-domain-name="agent"] .sale-fields-warning > span:first-child',
    "#escrowPayments .escrow-grid label",
    "#escrowBalanceNote > span:first-child",
    "#escrowListingFieldWarning > span:first-child",
  ]) {
    const texts = await pageUx.locator(sel).allInnerTexts();
    assert.ok(texts.length > 0, `Expected visible elements for ${sel}`);
    for (const t of texts) {
      assert.equal(/[()]/.test(t), false, `Parenthetical text should live in ℹ️ popover, not ${sel}: ${t}`);
    }
  }
  await pageUx.locator("#help-manage-owner-field").click();
  await expect(pageUx.locator("#info-manage-owner-field")).toBeVisible();
  await pageUx.keyboard.press("Escape");
  await pageUx.locator("#help-escrow-name-field").click();
  await expect(pageUx.locator("#info-escrow-name-field")).toBeVisible();
  await expect(pageUx.locator("#info-escrow-name-field")).toContainText("POA listing");
  await pageUx.keyboard.press("Escape");
  await pageUx.locator("#help-escrow-balance-info").click();
  await expect(pageUx.locator("#info-escrow-balance-info")).toBeVisible();
  await pageUx.keyboard.press("Escape");
  await pageUx.locator("#help-escrow-step-3").click();
  await expect(pageUx.locator("#info-escrow-step-3")).toBeVisible();
  await pageUx.keyboard.press("Escape");

  // (g) Committed profile v1 renders safely on /d/agent (avatar + bio as plain text + Manage button)
  const committedDoc = {
    schema: "poa-domains.profile.v1",
    version: 1,
    name: "agent",
    rightsHash,
    poa: buyerOwner,
    btc: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    eth: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    description: "Agent bio https://minepoa.com <script>alert(1)</script>",
    image: `ipfs://${mockAvatarCid}`,
  };
  h.payload.state.deeds[agentDeedId].metadata = [{ cid: mockAvatarCid, document: committedDoc }];
  await pageUx.goto(h.url + "/d/agent?q=agent");
  await pageUx.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageUx.locator("#domainOwner")).not.toContainText("Permanent registry rights");
  await expect(pageUx.locator("#domainOwner")).not.toContainText("not proof of native-chain ownership");
  await expect(pageUx.locator("#domainCopyLink")).toBeVisible();
  await pageUx.locator("#domainCopyLink").click();
  assert.equal(await pageUx.evaluate(() => navigator.clipboard.readText()), `${h.url}/d/agent`);
  await expect(pageUx.locator("#domainProfile")).toBeVisible();
  await expect(pageUx.locator("#domainProfile")).not.toContainText("Public profile");
  await expect(pageUx.locator("#domainTitle .domain-header-avatar img")).toHaveAttribute("src", `/v1/media/${mockAvatarCid}`);
  const domainHeaderAvatarBox = await pageUx.locator("#domainTitle .domain-header-avatar").boundingBox();
  assert.ok(domainHeaderAvatarBox && Math.abs(domainHeaderAvatarBox.width - domainHeaderAvatarBox.height) < 1, "/d/<name> header avatar must be square");
  await expect(pageUx.locator("#domainProfile img.domain-avatar")).toHaveAttribute("src", `/v1/media/${mockAvatarCid}`);
  await expect(pageUx.locator("#domainProfile .domain-profile-bio")).toHaveText("Agent bio https://minepoa.com <script>alert(1)</script>");
  assert.equal(await pageUx.locator("#domainProfile script").count(), 0);
  await expect(pageUx.locator("#domainProfile")).toContainText("0x5aAe...eAed");
  await expect(pageUx.locator("#domainProfile")).toContainText("bc1qw5...f3t4");
  await pageUx.locator('#domainProfile button[aria-label="Copy ETH address for agent"]').click();
  assert.equal(await pageUx.evaluate(() => navigator.clipboard.readText()), "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
  await pageUx.locator('#domainProfile button[aria-label="Copy BTC address for agent"]').click();
  assert.equal(await pageUx.evaluate(() => navigator.clipboard.readText()), "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
  await expect(pageUx.locator('#domainActions button[aria-label="Manage agent"]')).toBeVisible();

  assert.deepEqual(errorsUx, []);
  await ctxUx.close();

  // 7. Footer Domains Treasury balance + direct wallet links + registered protocol domains
  //    ("escrow" & "treasury") tiled buttons + management profile fields,
  //    and Bug/Feature popup form with prefilled POA address + CAPTCHA + PoW submission.
  const escrowWallet = "poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf";
  const treasuryWallet = "poa1GHppB8pYZ43gK8yBzR1RJhzfWjzrJn29q96ykwngUP7N";
  const rootRights = computeRightsHash({ kind: "permanent" }, null);
  const addProtocolDeed = (name, poa, description, deedId) => {
    const meta = buildProfileWitness({ name, rightsHash: rootRights, poa, description });
    h.payload.state.names[name] = { name, key: deedId, generation: 1, activeId: deedId, auctionId: null };
    h.payload.state.deeds[deedId] = {
      id: deedId,
      name,
      generation: 1,
      owner: treasuryWallet,
      ownerVersion: 1,
      version: 1,
      parentId: null,
      rights: { kind: "permanent" },
      rightsHash: rootRights,
      expiry: null,
      renewals: 0,
      retired: false,
      metadata: [meta],
      records: [],
      recordsVersion: 0,
      lock: null,
      encumbranceVersion: 0,
    };
  };
  addProtocolDeed(
    "treasury",
    treasuryWallet,
    "Official PoA Domains Treasury wallet. Holds protocol fee revenue and reserved PoA Domains owned by the registry treasury.",
    "e1".repeat(32),
  );
  addProtocolDeed(
    "escrow",
    escrowWallet,
    "Official PoA Domains Escrow wallet. Holds buyer deposits, active POA auction bids, and checkout payouts for PoA Domains.",
    "e2".repeat(32),
  );
  h.treasury = {
    total: "201.000000",
    escrow: { address: escrowWallet, balance: "201.000000", poascanUrl: `https://poascan.io/address/${escrowWallet}` },
    treasury: { address: treasuryWallet, balance: "0.000000", poascanUrl: `https://poascan.io/address/${treasuryWallet}` },
    poascanHomeUrl: "https://poascan.io/",
    checkedAt: Date.now(),
    stale: false,
  };
  const ctxFooter = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctxFooter.grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.url });
  const pageFooter = await ctxFooter.newPage();
  const errorsFooter = [];
  pageFooter.on("pageerror", (e) => errorsFooter.push(e.message));
  await pageFooter.route("https://**", (r) => r.abort());

  const submittedFeedback = [];
  const mockChallengeId = "a".repeat(32);
  await pageFooter.route("**/v1/feedback/challenge", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        challengeId: mockChallengeId,
        captchaUrl: `/v1/feedback/captcha/${mockChallengeId}`,
        powSalt: "test-salt-1234",
        powBits: 4,
        minDwellMs: 0,
        expiresAt: Date.now() + 600_000,
        enabled: true,
      }),
    });
  });
  await pageFooter.route(`**/v1/feedback/captcha/${mockChallengeId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="56"><rect width="180" height="56" fill="#09131a"/><text x="20" y="36" fill="#9cffe0">K7M4P</text></svg>',
    });
  });
  await pageFooter.route("**/v1/feedback", async (route) => {
    const body = route.request().postDataJSON();
    submittedFeedback.push(body);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        id: "fb123456",
        kind: body.kind,
        issueNumber: 114,
        issueUrl: "https://github.com/maximusmaximus/poa-domains/issues/114",
      }),
    });
  });

  await pageFooter.goto(h.url + "/");
  await pageFooter.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await pageFooter.locator("#termsAgreeBtn").click();
  await expect(pageFooter.locator("#domainsServedFooter")).toContainText("Number of Domains Served:");
  await expect(pageFooter.locator("#domainsServedCount")).toHaveText("0️⃣0️⃣0️⃣0️⃣0️⃣5️⃣");
  await expect(pageFooter.locator("#domainsServedSr")).toHaveText("5");
  await expect(pageFooter.locator("#treasuryTotal")).toHaveText("🪙 201 POA");
  await expect(pageFooter.locator("#poascanHomeLink")).toHaveCount(0);
  await expect(pageFooter.locator('#treasuryFooter a[href="https://poascan.io/"]')).toHaveCount(0);
  await expect(pageFooter.locator("#treasuryWallets")).toBeVisible();
  const footerEscrowTile = pageFooter.locator('#treasuryWallets a.domain-tile.is-registered[href="/d/escrow"]');
  const footerTreasuryTile = pageFooter.locator('#treasuryWallets a.domain-tile.is-registered[href="/d/treasury"]');
  await expect(footerEscrowTile).toHaveText("escrow");
  await expect(footerTreasuryTile).toHaveText("treasury");
  const escrowLink = pageFooter.locator(`#treasuryWallets a[href="https://poascan.io/address/${escrowWallet}"]`);
  const treasuryLink = pageFooter.locator(`#treasuryWallets a[href="https://poascan.io/address/${treasuryWallet}"]`);
  await expect(escrowLink).toHaveText("poa1...piRf");
  await expect(treasuryLink).toHaveText("poa1...UP7N");
  await pageFooter.locator("#treasuryWallets .poa-copy-btn").first().click();
  assert.equal(await pageFooter.evaluate(() => navigator.clipboard.readText()), escrowWallet);

  // Registered domain tiled buttons & owned reserved protocol domain resolution:
  // Unregistered available name is NOT styled as a registered tile; owned "escrow" IS a tile.
  await pageFooter.locator("#searchInput").fill("freshavailableword");
  await pageFooter.locator("#searchBtn").click();
  await expect(pageFooter.locator('#searchResult a.domain-link[href="/d/freshavailableword"]')).toBeVisible();
  await expect(pageFooter.locator('#searchResult a.domain-tile[href="/d/freshavailableword"]')).toHaveCount(0);
  await pageFooter.locator("#clearCart").click();
  await pageFooter.locator("#searchInput").fill("google");
  await pageFooter.locator("#searchBtn").click();
  await expect(pageFooter.locator("#searchResult")).toContainText("Reserved — not for sale");
  await expect(pageFooter.locator('#searchResult a.domain-tile[href="/d/google"]')).toHaveCount(0);
  await pageFooter.locator("#searchInput").fill("escrow");
  await pageFooter.locator("#searchBtn").click();
  await expect(pageFooter.locator("#searchResult")).toContainText("Owned (permanent)");
  await expect(pageFooter.locator('#searchResult a.domain-tile.is-registered[href="/d/escrow"]')).toHaveText("escrow");

  // Click the footer [escrow] tiled button -> /d/escrow shows treasury owner, escrow POA address, and description
  await footerEscrowTile.click();
  await expect(pageFooter.locator('#domainTitle a.domain-tile.is-registered[href="/d/escrow"]')).toHaveText("escrow");
  await expect(pageFooter.locator("#domainOwner")).toContainText("poa1...UP7N");
  await expect(pageFooter.locator("#domainProfile")).toContainText("Official PoA Domains Escrow wallet");
  await expect(pageFooter.locator("#domainProfile")).toContainText("poa1...piRf");
  await pageFooter.getByRole("button", { name: "Manage escrow" }).click();
  await expect(pageFooter.locator("#manageOwner")).toHaveValue(treasuryWallet);
  await expect(pageFooter.locator('#manageNames a.domain-tile.is-registered[href="/d/escrow"]')).toHaveText("escrow");
  await expect(pageFooter.locator('#manageNames a.domain-tile.is-registered[href="/d/treasury"]')).toHaveText("treasury");
  const escrowManageCard = pageFooter.locator('#manageNames article.card[data-domain-name="escrow"]');
  await expect(escrowManageCard.locator('textarea[data-profile-field="description"]')).toHaveValue(/Official PoA Domains Escrow wallet/);
  await expect(escrowManageCard.locator('input[data-profile-field="poa"]')).toHaveValue(escrowWallet);
  const treasuryManageCard = pageFooter.locator('#manageNames article.card[data-domain-name="treasury"]');
  await treasuryManageCard.locator("details.profile-editor summary").click();
  await expect(treasuryManageCard.locator('textarea[data-profile-field="description"]')).toHaveValue(/Official PoA Domains Treasury wallet/);
  await expect(treasuryManageCard.locator('input[data-profile-field="poa"]')).toHaveValue(treasuryWallet);

  // Set user's POA address in Manage domains, then open Bug/Feature modal -> prefilled automatically
  await pageFooter.locator("#tabEscrow").click();
  await pageFooter.locator("#manageOwner").fill(buyerOwner);
  await pageFooter.locator("#openFeedbackBtn").click();
  await expect(pageFooter.locator("#feedbackModal")).toBeVisible();
  assert.equal(await pageFooter.locator("#feedbackPoa").inputValue(), buyerOwner);
  await expect(pageFooter.locator("#feedbackCaptchaImg")).toBeVisible();
  await pageFooter.locator('label[for="feedbackKindFeature"]').click();
  await pageFooter.locator("#feedbackTitle").fill("Add bulk export to CSV");
  await pageFooter.locator("#feedbackDetails").fill("Would love a one-click CSV export of my managed domains.");
  await pageFooter.locator("#feedbackCaptchaAnswer").fill("K7M4P");
  await pageFooter.locator("#feedbackSubmit").click();
  await expect(pageFooter.locator("#feedbackStatus")).toContainText("Submitted to the repository for review");
  await expect(pageFooter.locator('#feedbackStatus a[href="https://github.com/maximusmaximus/poa-domains/issues/114"]')).toBeVisible();
  assert.equal(submittedFeedback.length, 1);
  assert.equal(submittedFeedback[0].kind, "feature");
  assert.equal(submittedFeedback[0].poaAddress, buyerOwner);
  assert.equal(submittedFeedback[0].captchaAnswer, "K7M4P");
  assert.match(submittedFeedback[0].powNonce, /^[0-9]+$/);
  await pageFooter.locator("#feedbackClose").click();
  await expect(pageFooter.locator("#feedbackModal")).toBeHidden();

  assert.deepEqual(errorsFooter, []);
  await ctxFooter.close();

  // 8. First-visit non-dismissible Terms modal + localStorage persistence + signed agent agreement
  const hTerms = await uiHarness("mainnet", { allowTermsAgree: true });
  hTerms.cap = h.cap;
  hTerms.payload = h.payload;
  try {
    const ctxGate = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctxGate.grantPermissions(["clipboard-read", "clipboard-write"], { origin: hTerms.url });
    const pageGate = await ctxGate.newPage();
    const errorsGate = [];
    pageGate.on("pageerror", (e) => errorsGate.push(e.message));
    await pageGate.route("https://**", (r) => r.abort());
    await pageGate.goto(hTerms.url + "/");
    await pageGate.waitForFunction(() => document.body.dataset.registryStatus === "ready");

    // Modal is open, contains summary, key warning, Terms link, and NO close button
    await expect(pageGate.locator("#termsGateModal")).toBeVisible();
    await expect(pageGate.locator("#termsGateSummary")).toContainText("application registry");
    await expect(pageGate.locator("#termsGateWarning")).toContainText("Never enter private keys");
    await expect(pageGate.locator("#termsGateLink")).toHaveAttribute("href", "/terms");
    await expect(pageGate.locator("#termsGateLink")).toHaveAttribute("target", "_blank");
    assert.equal(await pageGate.locator("#termsGateModal button", { hasText: /close|dismiss/i }).count(), 0);
    assert.equal(await pageGate.locator("#homeMain").evaluate((n) => n.inert), true);

    // Pressing Escape or clicking backdrop MUST NOT dismiss the modal
    await pageGate.keyboard.press("Escape");
    await expect(pageGate.locator("#termsGateModal")).toBeVisible();
    await pageGate.locator("#termsGateBackdrop").click({ position: { x: 8, y: 8 }, force: true });
    await expect(pageGate.locator("#termsGateModal")).toBeVisible();

    // Clicking I Agree dismisses modal, un-inerts page, and persists across reload
    await pageGate.locator("#termsAgreeBtn").click();
    await expect(pageGate.locator("#termsGateModal")).toBeHidden();
    assert.equal(await pageGate.locator("#homeMain").evaluate((n) => n.inert), false);
    await pageGate.reload();
    await pageGate.waitForFunction(() => document.body.dataset.registryStatus === "ready");
    await expect(pageGate.locator("#termsGateModal")).toBeHidden();

    // Fresh visit: agent signs Terms attestation with Ed25519 and unlocks the modal via POST /v1/terms/agree
    await pageGate.evaluate(() => localStorage.clear());
    await pageGate.reload();
    await pageGate.waitForFunction(() => document.body.dataset.registryStatus === "ready");
    await expect(pageGate.locator("#termsGateModal")).toBeVisible();

    const { privateKey: agentKey } = generateKeyPairSync("ed25519");
    const agentActor = nativePrincipal(agentKey);
    await pageGate.locator("#termsAgentDetails summary").click();
    await pageGate.locator("#termsAgentActor").fill(agentActor);
    await pageGate.locator("#termsAgentCopyBtn").click();
    const copiedTermsPrompt = await pageGate.evaluate(() => navigator.clipboard.readText());
    assert.ok(copiedTermsPrompt.includes(TERMS_VERSION) && copiedTermsPrompt.includes(TERMS_HASH) && copiedTermsPrompt.includes(agentActor));

    const signedPacket = signTermsAgreement(
      {
        domain: TERMS_DOMAIN,
        chainId: "poa-mainnet-1",
        actor: agentActor,
        termsVersion: TERMS_VERSION,
        termsHash: TERMS_HASH,
        agreed: true,
        agreedAt: Math.floor(Date.now() / 1000),
      },
      agentKey,
    );
    await pageGate.locator("#termsAgentPacket").fill(JSON.stringify(signedPacket));
    await pageGate.locator("#termsAgentSubmitBtn").click();
    await expect(pageGate.locator("#termsGateModal")).toBeHidden();
    const statusCheck = await (await fetch(`${hTerms.url}/v1/terms/status?actor=${encodeURIComponent(agentActor)}`)).json();
    assert.equal(statusCheck.agreed, true);
    assert.deepEqual(errorsGate, []);
    await ctxGate.close();
  } finally {
    await hTerms.close();
  }

  // 9. POA Auctions: first-bid starts timer, live auctions icon count badge, top scroll bar "Auction started",
  //    cart highest-bid ceiling, outbid indicators in cart & auctions page, and nuanced auction copy prompt.
  const aucQueuedId = "1".repeat(64);
  const aucLiveId = "2".repeat(64);
  const sellerAddr = "poa1GHppB8pYZ43gK8yBzR1RJhzfWjzrJn29q96ykwngUP7N";
  const bidder1 = "poa1An2SNaVU6NYV7RBCFKnpjXra91BzPs8qm45qh2u8EeSL";
  const bidder2 = "poa1BMrTXjLwLQoxzPQGK3nfdLD9RnVsHdLHU4ikFdyYW1pb";
  const nowAuctionMs = Date.now();
  h.cap = { ...h.cap, escrow: { enabled: true } };
  h.escrowCap = { enabled: true, paused: false, held: false, address: escrowWallet, limits: { perTransaction: "250000.000000", daily: "1000000.000000" }, serverTime: nowAuctionMs };
  h.escrowMarket = {
    serverTime: nowAuctionMs,
    items: [
      {
        id: aucQueuedId, name: "vault", seller: sellerAddr, kind: "auction",
        price: "100.000000", minimumNextBid: "100.000000", status: "OPEN",
        closes: 0, window: 3600000, quiet: 3600000, createdAt: nowAuctionMs - 60000,
        startedAt: null, awaitingFirstBid: true, high: null, bidders: [], settlement: null,
        history: [{ event: "Auction queued; timer starts on first bid", at: nowAuctionMs - 60000 }],
      },
      {
        id: aucLiveId, name: "comet", seller: sellerAddr, kind: "auction",
        price: "100.000000", minimumNextBid: "220.000001", status: "OPEN",
        closes: nowAuctionMs + 3600000, window: 3600000, quiet: 3600000, createdAt: nowAuctionMs - 120000,
        startedAt: nowAuctionMs - 30000, awaitingFirstBid: false,
        high: { payer: bidder1, amount: "200.000000" }, bidders: [bidder1], settlement: null,
        history: [
          { event: "Auction queued; timer starts on first bid", at: nowAuctionMs - 120000 },
          { event: "Auction started (first bid)", at: nowAuctionMs - 30000, amount: "200.000000", payer: bidder1 },
        ],
      },
    ],
  };
  const ctxAuc = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctxAuc.grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.url });
  const pageAuc = await ctxAuc.newPage();
  const errorsAuc = [];
  pageAuc.on("pageerror", (e) => errorsAuc.push(e.message));
  await pageAuc.route("https://**", (r) => r.abort());
  await pageAuc.goto(h.url);
  await pageAuc.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await pageAuc.locator("#termsAgreeBtn").click();

  // Top auction icon shows 1 live auction (NOT the queued unbid item "vault")
  await expect(pageAuc.locator("#liveAuctionsBadge")).toBeVisible();
  await expect(pageAuc.locator("#liveAuctionsBadge")).toHaveText("🔥1");
  // Top scroll bar announces "comet" started and does NOT announce queued "vault"
  const tickerInitial = await pageAuc.locator("#liveTickerTrack").innerText();
  assert.ok(tickerInitial.includes("Auction started") && tickerInitial.includes("comet"), tickerInitial);
  assert.equal(tickerInitial.includes("vault"), false, tickerInitial);

  // Search for a POA auction domain ("comet") -> auto-adds to cart, clearly warns it's For Auction,
  // and explains all auction nuances inside both the Search card ℹ️ icon and Cart item ℹ️ icon!
  await pageAuc.locator("#searchInput").fill("comet");
  await pageAuc.locator("#searchBtn").click();
  await expect(pageAuc.locator("#searchResult")).toContainText("For Auction — live POA auction");
  await expect(pageAuc.locator("#searchResult")).toContainText("not a fixed-price buy");
  await expect(pageAuc.locator("#searchResult")).toContainText("Added to your cart as a POA auction bid");
  await expect(pageAuc.locator("#cartCount")).toHaveText("1");
  await expect(pageAuc.locator('#cartList input[aria-label="Highest bid in POA for comet"]')).toHaveValue("220.000001");
  await pageAuc.locator("#help-searchResult").click();
  await expect(pageAuc.locator("#info-searchResult")).toBeVisible();
  await expect(pageAuc.locator("#info-searchResult")).toContainText("First-bid start");
  await expect(pageAuc.locator("#info-searchResult")).toContainText("Strict >10% increment");
  await expect(pageAuc.locator("#info-searchResult")).toContainText("Anti-sniping extension");
  await expect(pageAuc.locator("#info-searchResult")).toContainText("available escrow balance");
  await expect(pageAuc.locator("#info-searchResult")).toContainText("original sending wallet");
  await pageAuc.keyboard.press("Escape");
  await pageAuc.locator("#cartList .cart-item .module-info").click();
  await expect(pageAuc.locator("#cartList .cart-item .info-popover")).toContainText("unsigned POA auction bid");
  await expect(pageAuc.locator("#cartList .cart-item .info-popover")).toContainText("anti-sniping quiet window");
  await pageAuc.keyboard.press("Escape");
  // Raise bid via search card and confirm re-searching "comet" preserves the higher custom cap
  await pageAuc.locator('#searchResult input[aria-label="Highest bid in POA for comet"]').fill("260");
  await pageAuc.locator("#addToCartBtn").click();
  await expect(pageAuc.locator('#cartList input[aria-label="Highest bid in POA for comet"]')).toHaveValue("260");
  await pageAuc.locator("#searchBtn").click();
  await expect(pageAuc.locator('#cartList input[aria-label="Highest bid in POA for comet"]')).toHaveValue("260");
  await pageAuc.locator("#clearCart").click();
  await expect(pageAuc.locator("#cartCount")).toHaveText("0");

  // Auctions tab: Current shows live "comet" with countdown timer, Upcoming shows queued "vault" ("Starts on first bid")
  await pageAuc.locator("#tabAuctions").click();
  await expect(pageAuc.locator("#auctionsStartNote")).toBeVisible();
  await expect(pageAuc.locator("#auctionsStartNote")).toContainText("An auction starts with the first bid");
  await expect(pageAuc.locator("#auctionTabCurrent")).toHaveAttribute("aria-selected", "true");
  await expect(pageAuc.locator(`#auctions article[data-auction-id="${aucLiveId}"]`)).toBeVisible();
  await expect(pageAuc.locator(`#auctions article[data-auction-id="${aucLiveId}"]`)).toContainText("Live POA auction");
  await expect(pageAuc.locator(`#auctions article[data-auction-id="${aucLiveId}"] .auction-countdown`)).toContainText("left");
  await pageAuc.locator("#auctionTabUpcoming").click();
  const vaultCard = pageAuc.locator(`#auctions article[data-auction-id="${aucQueuedId}"]`);
  await expect(vaultCard).toBeVisible();
  await expect(vaultCard).toContainText("Starts on first bid");
  await vaultCard.locator("input").fill("150");
  await vaultCard.getByRole("button", { name: /Add vault auction bid to cart/ }).click();

  // Back to Current tab: add "comet" with highest bid 300 POA
  await pageAuc.locator("#auctionTabCurrent").click();
  const cometCard = pageAuc.locator(`#auctions article[data-auction-id="${aucLiveId}"]`);
  await cometCard.locator("input").fill("300");
  await cometCard.getByRole("button", { name: /Add comet auction bid to cart/ }).click();

  // Switch to Find/Cart: verify highest bid inputs, ceiling total, auction expectations & copied prompt nuances
  await pageAuc.locator("#tabFind").click();
  await expect(pageAuc.locator("#cartCount")).toHaveText("2");
  await expect(pageAuc.locator("#cartExpectations")).toContainText("First bid starts the timer");
  await expect(pageAuc.locator("#copyCartPrompt")).toBeEnabled();
  await pageAuc.locator("#copyCartPrompt").click();
  const auctionPrompt = await pageAuc.evaluate(() => navigator.clipboard.readText());
  assert.match(auctionPrompt, /Whole-cart ceiling 450\.000000 POA/);
  assert.match(auctionPrompt, /First-bid timer nuance/);
  assert.match(auctionPrompt, /Outbid & refund nuance/);
  assert.match(auctionPrompt, /credited instantly back to my available escrow balance/);
  assert.match(auctionPrompt, /ESCROW_SELF_RAISE/);
  assert.match(auctionPrompt, /Settlement handover nuance/);

  // Simulate: another user places first bid on "vault" (starting its timer!) AND outbids "comet" to 350 POA (> user's 300 max bid)
  h.escrowMarket = {
    serverTime: nowAuctionMs + 10000,
    items: [
      {
        ...h.escrowMarket.items[0],
        awaitingFirstBid: false,
        startedAt: nowAuctionMs + 5000,
        closes: nowAuctionMs + 5000 + 3600000,
        minimumNextBid: "110.000001",
        high: { payer: bidder2, amount: "100.000000" },
        bidders: [bidder2],
        history: [
          ...h.escrowMarket.items[0].history,
          { event: "Auction started (first bid)", at: nowAuctionMs + 5000, amount: "100.000000", payer: bidder2 },
        ],
      },
      {
        ...h.escrowMarket.items[1],
        minimumNextBid: "385.000001",
        high: { payer: bidder2, amount: "350.000000" },
        bidders: [bidder1, bidder2],
        history: [
          ...h.escrowMarket.items[1].history,
          { event: "Bid placed", at: nowAuctionMs + 6000, amount: "350.000000", payer: bidder2 },
        ],
      },
    ],
  };
  await pageAuc.reload();
  await pageAuc.waitForFunction(() => document.body.dataset.registryStatus === "ready");

  // Top badge now shows 2 live auctions, and top scroll bar announces "vault" auction started!
  await expect(pageAuc.locator("#liveAuctionsBadge")).toHaveText("🔥2");
  const tickerUpdated = await pageAuc.locator("#liveTickerTrack").innerText();
  assert.ok(tickerUpdated.includes("Auction started") && tickerUpdated.includes("vault"), tickerUpdated);

  // Cart shows Outbid warning on "comet", blocks Copy prompt, and NEVER auto-raises the 300 POA cap
  await expect(pageAuc.locator("#cartList")).toContainText("Outbid!");
  await expect(pageAuc.locator("#copyCartPrompt")).toBeDisabled();
  assert.equal(await pageAuc.locator('#cartList input[aria-label="Highest bid in POA for comet"]').inputValue(), "300");

  // Auctions page ALSO shows Outbid badge on "comet" (both via cart and via tracked bidder1 address!)
  await pageAuc.locator("#tabAuctions").click();
  await expect(pageAuc.locator(`#auctions article[data-auction-id="${aucLiveId}"] .auction-outbid-badge`)).toBeVisible();
  await pageAuc.locator("#auctionsBidderInput").fill(bidder1);
  await expect(pageAuc.locator(`#auctions article[data-auction-id="${aucLiveId}"] .auction-outbid-badge`)).toContainText("You were outbid");

  // Explicit user action in Cart raises "comet" max bid and acknowledges "vault" -> unlocks Copy prompt
  await pageAuc.locator("#tabFind").click();
  await pageAuc.getByRole("button", { name: /Raise max bid to 385\.000001 POA/ }).click();
  await pageAuc.locator("#cartList").getByRole("button", { name: /Review changed item/ }).click();
  await expect(pageAuc.locator("#copyCartPrompt")).toBeEnabled();

  // 9b. Exact search dropdown ALWAYS shows the searched term first with its live status:
  //     - Queued POA auction ("Agentic") -> gold "For auction · 100 POA · + Cart" -> click auto-adds to cart
  //     - Partial prefix ("agen") -> surfaces open POA auction ("agentic") as "For auction"
  //     - Taken/owned ("escrow") -> red "Not available" -> click goes straight to /d/escrow without adding to cart
  //     - Reserved ("google") -> red "Reserved · Not available" -> click goes straight to /d/google without adding to cart
  const aucAgenticId = "a".repeat(64);
  h.escrowMarket = {
    serverTime: nowAuctionMs + 12000,
    items: [
      ...h.escrowMarket.items,
      {
        id: aucAgenticId, name: "agentic", seller: sellerAddr, kind: "auction",
        price: "100.000000", minimumNextBid: "100.000000", status: "OPEN",
        closes: 0, window: 3600000, quiet: 3600000, createdAt: nowAuctionMs - 60000,
        startedAt: null, awaitingFirstBid: true, high: null, bidders: [], settlement: null,
        history: [{ event: "Auction queued; timer starts on first bid", at: nowAuctionMs - 60000 }],
      },
    ],
  };
  await pageAuc.reload();
  await pageAuc.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await pageAuc.locator("#tabFind").click();
  await pageAuc.locator("#clearCart").click();
  await expect(pageAuc.locator("#cartCount")).toHaveText("0");

  // Exact typed auction word ("Agentic") appears FIRST as For auction and clicking auto-adds it to cart
  await pageAuc.locator("#searchInput").fill("Agentic");
  await expect(pageAuc.locator("#searchSuggestions")).toBeVisible();
  const optAgentic = pageAuc.locator("#search-opt-0");
  await expect(optAgentic).toContainText("agentic");
  await expect(optAgentic).toContainText("For auction");
  await expect(optAgentic).toContainText("100 POA");
  await expect(optAgentic).toHaveAttribute("data-status", "auction");
  await expect(optAgentic).toHaveAttribute("data-can-add-to-cart", "true");
  assert.ok((await optAgentic.getAttribute("class")).includes("is-auction"));
  await optAgentic.click();
  await expect(pageAuc.locator("#cartCount")).toHaveText("1");
  await expect(pageAuc.locator("#cartList")).toContainText("agentic");
  await expect(pageAuc.locator("#searchResult")).toContainText("For Auction");

  // Partial prefix ("agen") surfaces open POA auction "agentic" marked For auction
  await pageAuc.locator("#searchInput").fill("agen");
  await expect(pageAuc.locator("#searchSuggestions")).toBeVisible();
  const prefixAgentic = pageAuc.locator("#searchSuggestions [role='option']", { hasText: "agentic" }).first();
  await expect(prefixAgentic).toContainText("For auction");

  // Taken/owned domain ("escrow") appears FIRST in RED as Not available; clicking opens /d/escrow without adding to cart
  await pageAuc.locator("#searchInput").fill("escrow");
  await expect(pageAuc.locator("#searchSuggestions")).toBeVisible();
  const optTaken = pageAuc.locator("#search-opt-0");
  await expect(optTaken).toContainText("escrow");
  await expect(optTaken).toContainText("Not available");
  await expect(optTaken).toHaveAttribute("data-status", "taken");
  await expect(optTaken).toHaveAttribute("data-can-add-to-cart", "false");
  assert.ok((await optTaken.getAttribute("class")).includes("is-unavailable"));
  await optTaken.click();
  await expect(pageAuc.locator("#domainMain")).toBeVisible();
  assert.equal(new URL(pageAuc.url()).pathname, "/d/escrow", pageAuc.url());
  await expect(pageAuc.locator("#domainTitle")).toContainText("escrow");
  await expect(pageAuc.locator("#cartCount")).toHaveText("1");

  // Reserved domain ("google") appears FIRST in RED as Reserved · Not available; clicking opens /d/google without adding to cart
  await pageAuc.locator("#domainHomeLink").click();
  await expect(pageAuc.locator("#homeMain")).toBeVisible();
  await pageAuc.locator("#searchInput").fill("google");
  await expect(pageAuc.locator("#searchSuggestions")).toBeVisible();
  const optReserved = pageAuc.locator("#search-opt-0");
  await expect(optReserved).toContainText("google");
  await expect(optReserved).toContainText("Reserved");
  await expect(optReserved).toContainText("Not available");
  await expect(optReserved).toHaveAttribute("data-status", "reserved");
  await expect(optReserved).toHaveAttribute("data-can-add-to-cart", "false");
  assert.ok((await optReserved.getAttribute("class")).includes("is-unavailable"));
  await optReserved.click();
  await expect(pageAuc.locator("#domainMain")).toBeVisible();
  assert.equal(new URL(pageAuc.url()).pathname, "/d/google", pageAuc.url());
  await expect(pageAuc.locator("#domainTitle")).toContainText("google");
  await expect(pageAuc.locator("#domainStatus")).toContainText("Reserved");
  await expect(pageAuc.locator("#cartCount")).toHaveText("1");

  // 9c. When there are 0 current (live) auctions and >=1 upcoming auction, Auctions defaults to Upcoming
  //     and shows a clear note that an auction starts with the first bid; manual tab click is respected.
  h.escrowMarket = {
    serverTime: nowAuctionMs + 15000,
    items: [
      {
        id: aucAgenticId, name: "agentic", seller: sellerAddr, kind: "auction",
        price: "100.000000", minimumNextBid: "100.000000", status: "OPEN",
        closes: 0, window: 3600000, quiet: 3600000, createdAt: nowAuctionMs - 60000,
        startedAt: null, awaitingFirstBid: true, high: null, bidders: [], settlement: null,
        history: [{ event: "Auction queued; timer starts on first bid", at: nowAuctionMs - 60000 }],
      },
    ],
  };
  await pageAuc.goto(`${h.url}/?tab=auctions`);
  await pageAuc.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageAuc.locator("#auctionsSection")).toBeVisible();
  await expect(pageAuc.locator("#auctionTabUpcoming")).toHaveAttribute("aria-selected", "true");
  await expect(pageAuc.locator("#auctionTabCurrent")).toHaveAttribute("aria-selected", "false");
  await expect(pageAuc.locator("#auctions")).toHaveAttribute("aria-labelledby", "auctionTabUpcoming");
  await expect(pageAuc.locator("#auctionsStartNote")).toBeVisible();
  await expect(pageAuc.locator("#auctionsStartNote")).toContainText("An auction starts with the first bid");
  await expect(pageAuc.locator(`#auctions article[data-auction-id="${aucAgenticId}"]`)).toBeVisible();
  // Manual click on Current stays on Current across refreshes (does not snap back to Upcoming)
  await pageAuc.locator("#auctionTabCurrent").click();
  await expect(pageAuc.locator("#auctionTabCurrent")).toHaveAttribute("aria-selected", "true");
  await expect(pageAuc.locator("#auctions")).toContainText("No live auctions running yet");
  await pageAuc.evaluate(async () => {
    const q = new URL(document.querySelector('script[src*="app.js"]').src).search;
    const { refreshEscrowMarket } = await import("/ui-poll.js" + q);
    await refreshEscrowMarket();
  });
  await expect(pageAuc.locator("#auctionTabCurrent")).toHaveAttribute("aria-selected", "true");
  await expect(pageAuc.locator("#auctions")).toHaveAttribute("aria-labelledby", "auctionTabCurrent");

  assert.deepEqual(errorsAuc, []);
  await ctxAuc.close();

  // 10. Sale & auction field-drop warnings, paused fields while listed, clear sales/auctions on /d/<name>,
  //     and post-transfer clean slate + archived previous fields as records on /d/<name>.
  const ownedAgentDeed = h.payload.state.deeds[agentDeedId];
  const prevOwner = ownedAgentDeed.owner;
  const newOwner = bidder2;
  const agentSaleAucId = "3".repeat(64);
  const agentFixedId = "4".repeat(64);
  const sampleIpfsCid = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
  const agentAttachedRecords = [
    { type: "wallet", chain: "poa", address: prevOwner },
    { type: "service", url: "https://agent.example/endpoint" },
    { type: "ipfs", cid: sampleIpfsCid },
  ];
  const agentProfileMeta = ownedAgentDeed.metadata[ownedAgentDeed.metadata.length - 1];
  const nowFieldMs = Date.now();

  // 10a. Unlisted domain: owner tools + Manage domains + My POA all show clear field-drop warnings
  h.payload.state.deeds[agentDeedId] = { ...ownedAgentDeed, records: agentAttachedRecords };
  h.escrowMarket = { serverTime: nowFieldMs, items: [] };
  const ctxFields = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctxFields.grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.url });
  const pageFields = await ctxFields.newPage();
  const errorsFields = [];
  pageFields.on("pageerror", (e) => errorsFields.push(e.message));
  await pageFields.route("https://**", (r) => r.abort());
  await pageFields.goto(`${h.url}/d/agent`);
  await pageFields.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await pageFields.locator("#termsAgreeBtn").click();

  // Unlisted domain shows active profile + attached records + warning in owner sell tools
  await expect(pageFields.locator("#domainProfile")).toBeVisible();
  await expect(pageFields.locator("#domainProfile")).toContainText("Attached domain records");
  await expect(pageFields.locator("#domainProfile")).toContainText("https://agent.example/endpoint");
  await expect(pageFields.locator("#poaSellTools .sale-fields-warning")).toBeVisible();
  await expect(pageFields.locator("#poaSellTools .sale-fields-warning")).toContainText("will be dropped");

  // Manage domains + My POA show clear field-drop warnings AND held-balance/withdrawal guidance
  await pageFields.locator('#domainActions button[aria-label="Manage agent"]').click();
  await expect(pageFields.locator('#manageNames article[data-domain-name="agent"] .sale-fields-warning')).toBeVisible();
  await expect(pageFields.locator("#escrowBalanceNote")).toBeVisible();
  await expect(pageFields.locator("#escrowBalanceNote")).toContainText("available escrow balance");
  await expect(pageFields.locator("#escrowListingFieldWarning")).toBeVisible();
  await expect(pageFields.locator("#escrowListingFieldWarning")).toContainText("paused while listed");
  await pageFields.locator("#escrowPayer").fill(prevOwner);
  await pageFields.locator("#escrowName").fill("agent");
  await pageFields.locator("#escrowAmount").fill("250.000000");
  await pageFields.getByRole("button", { name: "🏷️ List my name for POA", exact: true }).click();
  await expect(pageFields.locator("#escrowPrompt")).toContainText("Sale & auction notice");
  await expect(pageFields.locator("#escrowMessage")).toContainText("paused while listed");

  // 10b. Listed in live POA auction: /d/agent shows auction card + pauses active fields + shows paused fields as records
  h.escrowMarket = {
    serverTime: nowFieldMs,
    items: [
      {
        id: agentSaleAucId, name: "agent", seller: prevOwner, kind: "auction",
        price: "100.000000", minimumNextBid: "220.000001", status: "OPEN",
        closes: nowFieldMs + 3600000, window: 3600000, quiet: 3600000,
        createdAt: nowFieldMs - 120000, startedAt: nowFieldMs - 30000, awaitingFirstBid: false,
        high: { payer: bidder1, amount: "200.000000" }, bidders: [bidder1], settlement: null,
        history: [{ event: "Auction started (first bid)", at: nowFieldMs - 30000, amount: "200.000000", payer: bidder1 }],
      },
    ],
  };
  await pageFields.goto(`${h.url}/d/agent`);
  await pageFields.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageFields.locator("#domainStatus")).toContainText("In live POA auction");
  await expect(pageFields.locator("#domainListing")).toBeVisible();
  await expect(pageFields.locator("#domainListing")).toContainText("Auctions & Sales");
  await expect(pageFields.locator(`#domainListing article[data-auction-id="${agentSaleAucId}"]`)).toContainText("High bid 200 POA");
  await expect(pageFields.locator(`#domainListing article[data-auction-id="${agentSaleAucId}"] .auction-countdown`)).toContainText("left");
  await expect(pageFields.locator("#domainListing .sale-fields-warning")).toBeVisible();
  await expect(pageFields.locator("#domainProfile")).toContainText("paused while listed");
  assert.equal(await pageFields.locator("#domainProfile img.domain-avatar").count(), 0);
  assert.equal(await pageFields.locator("#domainTitle .domain-header-avatar img").count(), 0);
  await expect(pageFields.locator("#domainTitle .domain-header-avatar")).toBeVisible();
  // While listed/in auction, "Auction for POA" is hidden in Manage domains for that domain
  await pageFields.locator('#domainActions button[aria-label="Manage agent"]').click();
  await expect(pageFields.locator('#manageNames button[aria-label="Auction for POA: agent"]')).toHaveCount(0);
  await expect(pageFields.locator('#manageNames button[aria-label="Open in My POA: agent"]')).toBeVisible();
  await pageFields.goto(`${h.url}/d/agent`);
  await pageFields.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageFields.locator("#domainPreviousFields")).toBeVisible();
  await expect(pageFields.locator('#domainPreviousFields article[data-record-status="paused"]')).toContainText("Paused while listed");
  await expect(pageFields.locator("#domainPreviousFields")).toContainText("https://agent.example/endpoint");
  await expect(pageFields.locator("#domainPreviousFields")).toContainText("0x5aAe...eAed");
  assert.equal(await pageFields.locator("#domainPreviousFields script").count(), 0);

  // 10c. Listed for fixed-price POA sale: /d/agent clearly shows fixed sale + buy button
  h.escrowMarket = {
    serverTime: nowFieldMs,
    items: [
      {
        id: agentFixedId, name: "agent", seller: prevOwner, kind: "fixed",
        price: "250.000000", minimumNextBid: "250.000000", status: "OPEN",
        closes: nowFieldMs + 7200000, window: 7200000, quiet: 0,
        createdAt: nowFieldMs - 60000, startedAt: nowFieldMs - 60000, awaitingFirstBid: false,
        high: null, bidders: [], settlement: null,
        history: [{ event: "Fixed-price listing created", at: nowFieldMs - 60000, amount: "250.000000" }],
      },
    ],
  };
  await pageFields.reload();
  await pageFields.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageFields.locator("#domainStatus")).toContainText("For sale (POA)");
  await expect(pageFields.locator(`#domainListing article[data-sale-id="${agentFixedId}"]`)).toContainText("250 POA (Fixed price)");
  await expect(pageFields.locator("#domainListing").getByRole("button", { name: /Open My POA to buy/ })).toBeVisible();

  // 10d. After transfer to new holder: clean slate in #domainProfile, past completed auction in #domainListing,
  //      and all previous holder's dropped fields & records preserved in #domainPreviousFields!
  h.payload.state.deeds[agentDeedId] = {
    ...ownedAgentDeed,
    owner: newOwner,
    ownerVersion: 2,
    version: ownedAgentDeed.version + 1,
    records: [],
    recordsVersion: (ownedAgentDeed.recordsVersion ?? 0) + 1,
    profileResetAt: ownedAgentDeed.metadata.length,
    previousFields: [
      {
        owner: prevOwner,
        ownerVersion: 1,
        transferredAt: Math.floor(nowFieldMs / 1000),
        records: agentAttachedRecords,
        profile: agentProfileMeta,
      },
    ],
  };
  h.escrowMarket = {
    serverTime: nowFieldMs + 5000,
    items: [
      {
        id: agentSaleAucId, name: "agent", seller: prevOwner, kind: "auction",
        price: "100.000000", minimumNextBid: "275.000001", status: "COMPLETE",
        closes: nowFieldMs, window: 3600000, quiet: 3600000,
        createdAt: nowFieldMs - 120000, startedAt: nowFieldMs - 60000, awaitingFirstBid: false,
        high: { payer: newOwner, amount: "250.000000" }, bidders: [bidder1, newOwner], settlement: "COMPLETE",
        history: [
          { event: "Auction started (first bid)", at: nowFieldMs - 60000, amount: "200.000000", payer: bidder1 },
          { event: "Bid placed", at: nowFieldMs - 30000, amount: "250.000000", payer: newOwner },
          { event: "Handover settled", at: nowFieldMs, amount: "250.000000", payer: newOwner },
        ],
      },
    ],
  };
  await pageFields.reload();
  await pageFields.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageFields.locator("#domainOwner")).toContainText(`${newOwner.slice(0, 4)}...${newOwner.slice(-4)}`);
  await expect(pageFields.locator("#domainProfile")).toContainText("Clean slate for current holder");
  assert.equal(await pageFields.locator("#domainProfile img.domain-avatar").count(), 0);
  await expect(pageFields.locator("#domainProfile")).not.toContainText("0x5aAe...eAed");
  await expect(pageFields.locator("#domainListing")).toBeVisible();
  await expect(pageFields.locator(`#domainListing article[data-past-sale-id="${agentSaleAucId}"]`)).toContainText("Past POA Auction · ✅ Complete");
  await expect(pageFields.locator(`#domainListing article[data-past-sale-id="${agentSaleAucId}"]`)).toContainText("Final: 250 POA");
  await expect(pageFields.locator("#domainPreviousFields")).toBeVisible();
  const droppedCard = pageFields.locator('#domainPreviousFields article[data-record-status="dropped"]');
  await expect(droppedCard).toBeVisible();
  await expect(droppedCard).toContainText("Dropped on ownership transfer");
  await expect(droppedCard).toContainText("0x5aAe...eAed");
  await expect(droppedCard).toContainText("bc1qw5...f3t4");
  await expect(droppedCard).toContainText("https://agent.example/endpoint");
  await expect(droppedCard).toContainText("Agent bio https://minepoa.com <script>alert(1)</script>");
  assert.equal(await pageFields.locator("#domainPreviousFields script").count(), 0);
  assert.deepEqual(errorsFields, []);
  await ctxFields.close();

  console.log("PASS Cart copy regression: POA-only clipboard, execCommand fallback, manual selection, modal link navigation, handoff feedback, checkout expectations, escrow readiness banner, shortened PoA address copy, search autofill/dropdown, clean cart cards, cart-owned prefill, Manage this domain, Profile v1 editor, reorganized escrow signed request, treasury footer, domains served counter, bug/feature feedback modal, non-dismissible Terms gate, POA first-bid auctions/outbid cart & sale/auction field-drop warnings + archived previous fields");
} finally {
  await h.close();
  await browser.close();
}
