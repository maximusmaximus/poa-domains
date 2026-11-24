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

  // 6. Search autofill/dropdown + auto-add, clean cart items, cart-owned prefill,
  //    Manage this domain button, Profile v1 editor + avatar upload + /d/<name> view,
  //    and reorganized Escrow Signed Request steps + ℹ️ help icons.
  const ctxUx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctxUx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.url });
  const pageUx = await ctxUx.newPage();
  const errorsUx = [];
  pageUx.on("pageerror", (e) => errorsUx.push(e.message));
  await pageUx.route("https://**", (r) => r.abort());
  const samplePng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  ]);
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
  await pageUx.locator("#tabHandoff").click();
  await pageUx.locator("#floatingCartBtn").click();
  const floatCartText = await pageUx.locator("#floatingCartList").innerText();
  assert.ok(floatCartText.includes("🪙 100 POA · Standard root"), floatCartText);
  assert.equal(floatCartText.includes("Buy with POA"), false, floatCartText);
  await pageUx.locator("#floatingCartClose").click();

  // (c) All cart items turn unavailable -> prefill Manage domains owner address
  const buyerOwner = "poa1Buyer9mN3pQ7rS2tU5vW8xY4zA6bC1dE3fG5hJ7kL9mN";
  const agentDeedId = "d".repeat(64);
  const lunarDeedId = "e".repeat(64);
  const rightsHash = "f".repeat(64);
  h.payload.state.names.agent = { name: "agent", generation: 1, activeId: agentDeedId, auctionId: null, version: 1 };
  h.payload.state.names.lunar = { name: "lunar", generation: 1, activeId: lunarDeedId, auctionId: null, version: 1 };
  h.payload.state.deeds[agentDeedId] = {
    id: agentDeedId, name: "agent", parentId: null, generation: 1, owner: buyerOwner,
    version: 1, ownerVersion: 1, rights: { kind: "permanent" }, rightsHash, records: [],
    metadata: [{ cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" }],
  };
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
  await expect(agentCard.locator(".profile-public-notice")).toContainText("publicly");
  await expect(agentCard.locator(".profile-public-notice")).toContainText("IPFS");

  // (e) Profile v1 editor: EIP-55 checksum fix, BTC mainnet, bio, image upload & agent prompt copy
  await agentCard.locator('input[data-profile-field="btc"]').fill("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
  await agentCard.locator('input[data-profile-field="eth"]').fill("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed");
  await expect(agentCard.locator(".profile-eth-fix")).toBeVisible();
  await agentCard.locator(".profile-eth-fix button").click();
  assert.equal(
    await agentCard.locator('input[data-profile-field="eth"]').inputValue(),
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  );
  await agentCard.locator('textarea[data-profile-field="description"]').fill("Agent bio https://minepoa.com <script>alert(1)</script>");
  await agentCard.locator('input[type="file"]').setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: samplePng,
  });
  await expect(agentCard.locator(".profile-upload-row")).toContainText("Pinned to IPFS & backed up to R2");
  assert.equal(await agentCard.locator('input[data-profile-field="image"]').inputValue(), `ipfs://${mockAvatarCid}`);
  await agentCard.getByRole("button", { name: /Copy profile prompt for my agent/ }).click();
  const profilePrompt = await pageUx.locator("#managePrompt").textContent();
  assert.match(profilePrompt, /poa-domains\.profile\.v1/);
  assert.match(profilePrompt, /setMetadata/);
  assert.match(profilePrompt, /0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed/);
  assert.match(profilePrompt, /bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4/);
  assert.equal((await pageUx.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), profilePrompt);

  // (f) Reorganized Escrow Signed Request workflow with steps + ℹ️ popovers
  await expect(pageUx.locator('#escrowPayments .escrow-step[data-step="1"] h3')).toContainText("1. Pick an action");
  await expect(pageUx.locator('#escrowPayments .escrow-step[data-step="2"] h3')).toContainText("2. Copy the prompt to your agent");
  await expect(pageUx.locator('#escrowPayments .escrow-step[data-step="3"] h3')).toContainText("3. Paste & submit");
  assert.equal((await pageUx.locator("#escrowPayments").innerText()).includes("Signed request — public command and signature only"), false);
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
  await pageUx.goto(h.url + "/d/agent");
  await pageUx.waitForFunction(() => document.body.dataset.registryStatus === "ready");
  await expect(pageUx.locator("#domainProfile")).toBeVisible();
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

  console.log("PASS Cart copy regression: POA-only clipboard, execCommand fallback, manual selection, modal link navigation, handoff feedback, checkout expectations, escrow readiness banner, shortened PoA address copy, search autofill/dropdown, clean cart cards, cart-owned prefill, Manage this domain, Profile v1 editor & reorganized escrow signed request");
} finally {
  await h.close();
  await browser.close();
}
