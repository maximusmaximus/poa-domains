import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPrivateKey } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";
import type { BrowserType, Page } from "@playwright/test";
import { startRegistryApp } from "../src/app.js";
import { intentId, signBody } from "../src/auth.js";
import { capabilities, prepare } from "../src/interface.js";
import { buildReferenceBundle } from "./reference-pages-build.js";
import { witness } from "./helpers.js";

interface ViewportSpec {
  name: string;
  width: number;
  height: number;
}

const VIEWPORTS: readonly ViewportSpec[] = [
  { name: "mobile-xs", width: 320, height: 568 },
  { name: "mobile", width: 375, height: 812 },
  { name: "mobile-landscape", width: 667, height: 375 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "ultrawide", width: 1920, height: 1080 },
] as const;

const BROWSERS: readonly { name: string; launcher: BrowserType }[] = [
  { name: "chromium", launcher: chromium },
  { name: "firefox", launcher: firefox },
  { name: "webkit", launcher: webkit },
] as const;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

async function startStaticDirServer(
  directory: string,
  prefix = "/poa-domains/",
) {
  const server = createServer((req, res) => {
    if (req.method !== "GET" || !req.url?.startsWith(prefix)) {
      res.writeHead(404);
      return res.end();
    }
    let filePath: string;
    try {
      filePath = resolve(
        directory,
        decodeURIComponent(
          new URL(req.url, "http://127.0.0.1").pathname.slice(prefix.length),
        ) || "index.html",
      );
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (
      !filePath.startsWith(directory + sep) ||
      !existsSync(filePath) ||
      !statSync(filePath).isFile()
    ) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader(
      "content-type",
      MIME_TYPES[extname(filePath)] ?? "text/plain",
    );
    res.setHeader("cache-control", "no-store");
    res.end(readFileSync(filePath));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("LISTEN");
  return {
    url: `http://127.0.0.1:${address.port}${prefix}`,
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((res, rej) => {
        server.close((e) => (e ? rej(e) : res()));
        server.closeIdleConnections();
      }),
  };
}

// The offline reference app intentionally has no Worker node-monitor route.
// Supply only that exact loopback GET; monitor behavior is tested separately.
async function syntheticNetworkStatus(page:Page,appUrl:string){
  const u=new URL("/v1/network-status",appUrl);assert.equal(u.hostname,"127.0.0.1");
  await page.route(u.href,async route=>{
    assert.equal(route.request().method(),"GET");
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      level:"online",hold:false,message:"Synthetic UI-only network fixture",chainId:"poa-mainnet-1",
      livePoA:false,source:"synthetic-ui-only",checkedAt:Date.now(),failures:0,latencyMs:0,detail:null})});
  });
}

async function assertResponsiveGeometry(
  page: Page,
  vp: ViewportSpec,
  selectorIds: readonly string[],
  contextLabel: string,
) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  // Allow layout reflow
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => r(true))),
  );
  // Mobile navigation intentionally hides inactive sections. Measure each
  // requested box only after selecting its real tab, never by forcing CSS.
  const boxes=[];
  let clientWidth=vp.width,scrollWidth=0;
  for(const id of selectorIds){
    const tab=await page.evaluate(id=>document.getElementById(id)?.closest("[data-section]")?.getAttribute("data-section"),id);
    if(tab&&await page.locator(`.section-tab[data-tab="${tab}"]`).count()){
      await page.locator(`.section-tab[data-tab="${tab}"]`).click();
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r(true))));
    }
    const metric=await page.evaluate(id=>{
      const node=document.getElementById(id),rect=node?.getBoundingClientRect(),doc=document.documentElement;
      return {box:{id,missing:!node,width:Math.round(rect?.width??0),height:Math.round(rect?.height??0),
        left:Math.round(rect?.left??0),right:Math.round(rect?.right??0)},clientWidth:doc.clientWidth,scrollWidth:doc.scrollWidth};
    },id);
    boxes.push(metric.box);clientWidth=metric.clientWidth;scrollWidth=Math.max(scrollWidth,metric.scrollWidth);
  }
  const metrics={boxes,clientWidth,scrollWidth};
  const find=page.locator('.section-tab[data-tab="find"]');if(await find.count())await find.click();

  assert.ok(
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `${contextLabel} [${vp.name} ${vp.width}x${vp.height}]: horizontal overflow detected (scrollWidth=${metrics.scrollWidth}, clientWidth=${metrics.clientWidth})`,
  );
  for (const box of metrics.boxes) {
    assert.equal(
      box.missing,
      false,
      `${contextLabel} [${vp.name}]: missing #${box.id}`,
    );
    assert.ok(
      box.width > 0 && box.height > 0,
      `${contextLabel} [${vp.name}]: #${box.id} has zero dimensions (${box.width}x${box.height})`,
    );
    assert.ok(
      box.left >= -2 && box.right <= metrics.clientWidth + 2,
      `${contextLabel} [${vp.name}]: #${box.id} overflows viewport horizontally (left=${box.left}, right=${box.right}, clientWidth=${metrics.clientWidth})`,
    );
  }
}

async function runFullUiUxFlowsOnRegistryApp(
  page: Page,
  browserName: string,
  appUrl: string,
  carolPrincipal: string,
) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") {
      // WebKit on Windows logs a benign UA shadow-root style-src notice when interacting with native <select> popups under strict style-src 'self'
      if (
        browserName === "webkit" &&
        m.text().includes("Refused to apply a stylesheet") &&
        m.text().includes("style-src")
      ) {
        return;
      }
      consoleErrors.push(`${m.text()} @ ${JSON.stringify(m.location())}`);
    }
  });

  await syntheticNetworkStatus(page,appUrl);
  await page.goto(appUrl);
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#action option").length === 17 &&
      document.querySelectorAll("#stats > div").length === 8 &&
      document.querySelectorAll("#names article").length >= 3,
  );
  assert.equal(
    await page.locator("#error").textContent(),
    "",
    `${browserName}: clean initial load without error`,
  );

  // 1. Check all 7 responsive viewports on the live full-stack registry app
  for (const vp of VIEWPORTS) {
    await assertResponsiveGeometry(
      page,
      vp,
      [
        "stats",
        "searchSection",
        "searchInput",
        "searchBtn",
        "cartPrompt",
        "names",
        "auctions",
        "offers",
        "history",
        "balances",
        "handoff",
      ],
      `${browserName}:live-registry-app`,
    );
  }

  // Restore desktop viewport for interactive UX sequence
  await page.setViewportSize({ width: 1440, height: 900 });

  // Verify Xero Emoji web font is registered and active in the browser
  const xeroFontReady = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts).some((f) =>
      f.family.replace(/['"]/g, "").includes("Xero"),
    );
  });
  assert.equal(xeroFontReady, true, `${browserName}: Xero Emoji font loaded`);

  // Verify ecosystem navigation & poadomains.grok.me links are rendered
  assert.ok(
    (await page
      .locator('#siteFooter a[href="https://github.com/maximusmaximus/poa-domains"]')
      .count()) >= 1,
    `${browserName}: GitHub repo link present in footer`,
  );
  assert.ok(
    (await page
      .locator(
        '#resourcesSection a[href="https://maximusmaximus.github.io/poa-domains/"]',
      )
      .count()) >= 1,
    `${browserName}: GitHub Pages mirror link present in resources section`,
  );

  // 2. Idea strip UX: 3-row masonry, tap fills search + adds to cart
  await page.waitForFunction(
    () => document.querySelectorAll("#ideasStrip .ideas-row").length === 3,
  );
  const firstIdea = page.locator("#ideasStrip .idea").first();
  const ideaQuery = (await firstIdea.getAttribute("data-query")) ?? "";
  await firstIdea.click();
  assert.equal(await page.locator("#searchInput").inputValue(), ideaQuery);
  assert.ok(
    (await page.locator("#searchResult").innerText()).length > 10,
    `${browserName}: idea ${ideaQuery} rendered non-empty search result`,
  );
  if (await page.locator("#clearCart").isEnabled())
    await page.locator("#clearCart").click();

  // 3. Verify all availability classification & pricing states via search bar & Enter key
  // (a) Invalid domain syntax via Enter key
  await page.locator("#searchInput").fill("bad--domain");
  await page.locator("#searchInput").press("Enter");
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Invalid name.*Use letters, numbers or supported emoji/,
  );

  // (b) Reserved root domain
  await page.locator("#searchInput").fill("google");
  await page.locator("#searchBtn").click();
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Reserved|RESERVED ROOT DOMAIN \(PROTECTED\)/,
  );
  assert.match(await page.locator("#searchResult").innerText(), /655-name/);
  assert.equal(await page.locator("#addToCartBtn").count(), 0);

  // (c) Available single-emoji root via poa: prefix (100k POA minimum bid)
  await page.locator("#searchInput").fill("poa:🚀");
  await page.locator("#searchInput").press("Enter");
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Available|AVAILABLE ROOT DOMAIN/,
  );
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Root · PREMIUM/,
  );
  assert.match(
    await page.locator("#searchResult").innerText(),
    /100k POA single-emoji minimum bid/,
  );
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Opening auction reserve: 100000 POA/,
  );

  // (c2) Available multi-emoji root (more than 1 emoji -> 1k POA minimum bid)
  await page.locator("#searchInput").fill("🔥🔥");
  await page.locator("#searchInput").press("Enter");
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Available|AVAILABLE ROOT DOMAIN/,
  );
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Root · STANDARD/,
  );
  assert.match(
    await page.locator("#searchResult").innerText(),
    /1k POA multi-emoji minimum bid/,
  );
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Opening auction reserve: 1000 POA/,
  );

  // (d) Available standard ASCII root -> add to cart from search result
  await page.locator("#searchInput").fill("quantum");
  await page.locator("#searchBtn").click();
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Available|AVAILABLE ROOT DOMAIN/,
  );
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Root · STANDARD/,
  );
  await page.locator("#addToCartBtn").click();
  assert.equal(await page.locator("#cartCount").innerText(), "1");

  // (e) Live ascending auction via search result
  await page.locator("#searchInput").fill("🌐");
  await page.locator("#searchBtn").click();
  assert.match(
    await page.locator("#searchResult").innerText(),
    /In auction|IN LIVE ASCENDING AUCTION/,
  );
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Minimum next valid bid: 110001 POA/,
  );

  // (f) Available child domain via standing parent offer
  await page.locator("#searchInput").fill("builder.nexus");
  await page.locator("#searchBtn").click();
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Child offer open|AVAILABLE VIA STANDING CHILD OFFER/,
  );

  // (g) Owned child domain with active fixed-price resale offer
  await page.locator("#searchInput").fill("🫪.👩‍🦰");
  await page.locator("#searchBtn").click();
  assert.match(
    await page.locator("#searchResult").innerText(),
    /OWNED \(PERMANENT DEED\)/,
  );
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Active fixed-price resale listing: 2500 POA/,
  );

  // 4. Add items to cart directly from #auctions and #offers cards
  await page.locator("#auctions article button").first().click();
  assert.equal(await page.locator("#cartCount").innerText(), "2");

  const offerButtons = page.locator("#offers .card button");
  assert.equal(await offerButtons.count(), 2);
  await offerButtons.nth(0).click();
  await offerButtons.nth(1).click();
  assert.equal(await page.locator("#cartCount").innerText(), "4");

  // 5. Edit bid amount inside cart item and verify prompt updates live
  const firstCartInput = page.locator("#cartList .card input").first();
  await firstCartInput.fill("25000");
  await firstCartInput.dispatchEvent("input");
  assert.match(await page.locator("#cartPrompt").innerText(), /25000/);

  // 6. Cart has no signer field; prompt uses a placeholder for the agent to fill
  assert.equal(await page.locator("#cartSigner").count(), 0);
  assert.ok(
    (await page.locator("#cartPrompt").innerText()).includes(
      "Authorized Signer Principal: <YOUR_POA1_OR_ED25519_PRINCIPAL>",
    ),
  );

  // 7. Remove one cart item and check count updates to 3
  await page.locator("#cartList .card button").first().click();
  assert.equal(await page.locator("#cartCount").innerText(), "3");

  // 8. Click Copy Agent Prompt button and verify status feedback
  await page.locator("#copyCartPrompt").click();
  await page.waitForFunction(
    () => document.querySelector("#cartStatus")!.textContent!.length > 0,
  );

  // 9. Clear cart and verify reset state
  await page.locator("#clearCart").click();
  assert.equal(await page.locator("#cartCount").innerText(), "0");
  assert.equal(await page.locator("#clearCart").isDisabled(), true);
  assert.equal(await page.locator("#copyCartPrompt").isDisabled(), true);
  assert.match(
    await page.locator("#cartPrompt").innerText(),
    /Add one or more domains/,
  );

  // 10. Test mobile viewport (375x812) with populated 3-item cart to ensure cart cards don't overflow
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('.section-tab[data-tab="auctions"]').click();
  await page.locator("#auctions article button").first().click();
  await page.locator('.section-tab[data-tab="explore"]').click();
  await offerButtons.nth(0).click();
  await assertResponsiveGeometry(
    page,
    { name: "mobile-with-cart", width: 375, height: 812 },
    ["searchSection", "cartList", "cartPrompt"],
    `${browserName}:mobile-populated-cart`,
  );
  await page.locator("#clearCart").click();
  await page.setViewportSize({ width: 1440, height: 900 });

  // 11. Verify Handoff Builder digest parity in this browser engine
  const stateResp = await page.evaluate(async () => {
    const r = await fetch("/v1/state");
    return r.json();
  });
  const s = stateResp.state;
  const nexusDeed = s.deeds[s.names.nexus.activeId];
  const setRecordsParams = {
    name: "poa:NEXUS",
    expectedDeedId: nexusDeed.id,
    expectedVersion: nexusDeed.version,
    records: [{ type: "service", url: "https://nexus.poa.domains/v2" }],
  };
  await page.locator("#signer").fill(carolPrincipal);
  await page.locator("#requestId").fill(`e2e-${browserName}-1`);
  await page.locator("#nonce").fill("0");
  await page.locator("#notBefore").fill("0");
  await page.locator("#deadline").fill(String(s.time + 60000));
  await page.locator("#maxTotal").fill("0");
  await page.locator("#maxNetworkFee").fill("0");
  await page.locator("#action").selectOption("setRecords");
  await page.locator("#params").fill(JSON.stringify(setRecordsParams));
  await page.locator("button[type=submit]").click();
  await page.waitForFunction(
    () => document.querySelector("#digest")!.textContent!.length === 64,
  );
  const builtBody = JSON.parse(await page.locator("#body").innerText());
  assert.equal(await page.locator("#digest").innerText(), intentId(builtBody));
  assert.equal(builtBody.params.name, "nexus");

  assert.equal(await page.locator("img").count(), 0);
  assert.deepEqual(pageErrors, [], `${browserName}: zero page errors`);
  assert.deepEqual(consoleErrors, [], `${browserName}: zero console errors`);
}

async function runAgentRoundtripVerification(
  page: Page,
  dataDir: string,
  app: Awaited<ReturnType<typeof startRegistryApp>>,
) {
  await syntheticNetworkStatus(page,app.url);
  await page.goto(app.url);
  await page.waitForFunction(
    () => document.querySelectorAll("#names article").length >= 3,
  );

  // Human searches for "builder.nexus" and adds the child domain purchase to the cart
  await page.locator("#searchInput").fill("builder.nexus");
  await page.locator("#searchBtn").click();
  assert.match(
    await page.locator("#searchResult").innerText(),
    /Child offer open|AVAILABLE VIA STANDING CHILD OFFER/,
  );
  await page.locator("#addToCartBtn").click();

  // Human also searches for live auction "🌐" and queues a 125000 POA bid
  await page.locator("#searchInput").fill("🌐");
  await page.locator("#searchBtn").click();
  await page.locator("#searchResult input").fill("125000");
  await page.locator("#addToCartBtn").click();
  assert.equal(await page.locator("#cartCount").innerText(), "2");

  const promptText = await page.locator("#cartPrompt").innerText();
  assert.match(promptText, /builder\.nexus/);
  assert.match(promptText, /fillChildOffer/);
  assert.match(promptText, /125000/);

  // Now the simulated AI Agent executes both intents against POST /v1/intents
  const cap = capabilities(app.engine);
  const snapBefore = app.engine.snapshot();
  const childOffer = Object.values(snapBefore.offers).find(
    (o) => o.kind === "child",
  )!;
  const liveAuction = snapBefore.auctions[snapBefore.names["🌐"]!.auctionId!]!;

  const carolKey = createPrivateKey(
    readFileSync(join(dataDir, "keys", "carol.pem")),
  );
  const bobKey = createPrivateKey(
    readFileSync(join(dataDir, "keys", "bob.pem")),
  );
  const now = app.engine.observedTime();

  // Agent Intent 1: carol mints "builder.nexus" via fillChildOffer
  const fillBody = prepare(
    {
      signer: app.principals.carol!,
      coSigners: [],
      requestId: "agent-e2e-fill-builder-nexus",
      nonce: app.engine.nextNonce(app.principals.carol!),
      notBefore: 0,
      deadline: now + 60000,
      maxTotal: childOffer.price,
      maxNetworkFee: "0",
      action: "fillChildOffer",
      params: {
        offerId: childOffer.id,
        expectedVersion: childOffer.version,
        expectedGeneration: 1,
        label: "builder",
        asset: childOffer.asset,
        amount: childOffer.price,
        metadata: witness(
          "builder.nexus",
          childOffer.rights!,
          childOffer.parentId,
          "Agent minted child domain builder.nexus",
        ),
      },
    },
    cap,
  );
  const fillRes = await fetch(app.url + "/v1/intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signBody(fillBody, [carolKey])),
  });
  assert.equal(fillRes.status, 200);
  const fillReceipt: any = await fillRes.json();
  assert.equal(fillReceipt.status, "succeeded");

  // Agent Intent 2: bob places a 125000 POA bid on "🌐", displacing carol's 100000 bid
  const bidBody = prepare(
    {
      signer: app.principals.bob!,
      coSigners: [],
      requestId: "agent-e2e-bid-globe",
      nonce: app.engine.nextNonce(app.principals.bob!),
      notBefore: 0,
      deadline: now + 60000,
      maxTotal: "125000",
      maxNetworkFee: "0",
      action: "bid",
      params: {
        auctionId: liveAuction.id,
        expectedVersion: liveAuction.version,
        asset: liveAuction.asset,
        amount: "125000",
        beneficiary: app.principals.bob!,
      },
    },
    cap,
  );
  const bidRes = await fetch(app.url + "/v1/intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signBody(bidBody, [bobKey])),
  });
  assert.equal(bidRes.status, 200);
  const bidReceipt: any = await bidRes.json();
  assert.equal(bidReceipt.status, "succeeded");

  // Human clicks #refresh in the Web UI and verifies all sections reflect the agent's execution
  await page.locator("#refresh").click();
  await page.waitForFunction(() =>
    document.querySelector("#names")?.textContent?.includes("builder.nexus"),
  );

  // Verify #names now includes builder.nexus
  assert.match(await page.locator("#names").innerText(), /builder\.nexus/);

  // Verify searching builder.nexus now reports OWNED (PERMANENT DEED)
  await page.locator("#searchInput").fill("builder.nexus");
  await page.locator("#searchBtn").click();
  assert.match(
    await page.locator("#searchResult").innerText(),
    /OWNED \(PERMANENT DEED\)/,
  );

  // Verify #auctions reflects bob's 125000 high bid and new 137501 minimum next bid
  const auctionsText = await page.locator("#auctions").innerText();
  assert.match(auctionsText, /High bid 125000 by/);
  assert.match(auctionsText, /137501 POA/);

  // Verify #history shows the new child purchase and carol's displaced bid as OUTBID
  const historyText = await page.locator("#history").innerText();
  assert.match(historyText, /Child purchase: builder\.nexus/);
  assert.match(historyText, /agent-e2e-fill-builder-nexus/);
  assert.match(historyText, /OUTBID/);

  // Verify #balances now shows carol's 100000 POA withdrawable outbid escrow refund
  const balancesText = await page.locator("#balances").innerText();
  assert.match(balancesText, /Refund: 100000 POA/);
  const refund=page.locator("#balances .card").filter({has:page.getByRole("heading",{name:"Refund: 100000 POA",exact:true})});
  assert.equal(await refund.count(),1);
  assert.ok((await refund.innerText()).includes(app.principals.carol!.slice(0,18)),"refund belongs to displaced payer");
  assert.match(await refund.innerText(),/🌐 · v1/);
}

async function runStaticReferenceMultiBrowserSmoke(staticUrl: string) {
  for (const { name, launcher } of BROWSERS) {
    const browser = await launcher.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") {
          if (
            name === "webkit" &&
            m.text().includes("Refused to apply a stylesheet") &&
            m.text().includes("style-src")
          ) {
            return;
          }
          errors.push(m.text());
        }
      });
      await page.goto(staticUrl);
      await page.waitForFunction(
        () => document.querySelectorAll("#names article").length === 3,
      );
      for (const vp of VIEWPORTS) {
        await assertResponsiveGeometry(
          page,
          vp,
          [
            "stats",
            "searchSection",
            "names",
            "auctions",
            "offers",
            "history",
            "balances",
            "handoff",
          ],
          `${name}:static-reference-snapshot`,
        );
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator("#searchInput").fill("orbit");
      await page.locator("#searchBtn").click();
      assert.match(
        await page.locator("#searchResult").innerText(),
        /In auction|IN LIVE ASCENDING AUCTION/,
      );
      await page.locator("#addToCartBtn").click();
      assert.match(
        await page.locator("#cartPrompt").innerText(),
        /STATIC SYNTHETIC DEMO CART/,
      );
      assert.deepEqual(
        errors,
        [],
        `${name}: static reference page zero errors`,
      );
    } finally {
      await browser.close();
    }
  }
}

async function runPublicProductionPagesMultiBrowserSmoke(prodUrl: string) {
  const OFFICIAL_STATUS = "https://minepoa.com/chain/poa-mainnet-1/api/status";
  const OFFICIAL_FACTS =
    "https://minepoa.com/chain/poa-mainnet-1/api/network-facts";
  const cutoff = Math.floor(Date.now() / 1000) - 3600;

  for (const { name, launcher } of BROWSERS) {
    const browser = await launcher.launch({ headless: true });
    try {
      const context = await browser.newContext({ serviceWorkers: "block" });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") {
          if (
            name === "webkit" &&
            m.text().includes("Refused to apply a stylesheet") &&
            m.text().includes("style-src")
          ) {
            return;
          }
          errors.push(m.text());
        }
      });
      await context.route("**/*", async (route) => {
        const href = route.request().url();
        if (href === OFFICIAL_STATUS) {
          return route.fulfill({
            status: 200,
            headers: {
              "content-type": "application/json",
              "access-control-allow-origin": "*",
            },
            body: JSON.stringify({
              chain_id: "poa-mainnet-1",
              checkpoint: { height: 12345, cutoff_ts: cutoff },
              epochs_closed: 57,
              agents_joined: 77,
              txs: 42,
              final: 40,
              K: 5,
            }),
          });
        }
        if (href === OFFICIAL_FACTS) {
          return route.fulfill({
            status: 200,
            headers: {
              "content-type": "application/json",
              "access-control-allow-origin": "*",
            },
            body: JSON.stringify({
              chain_id: "poa-mainnet-1",
              open_epoch: 57,
              engine_sha256: "a".repeat(64),
              params_sha256: "b".repeat(64),
              economics: { K: 5 },
            }),
          });
        }
        return route.continue();
      });

      await page.addInitScript(() => {
        const orig = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (init) {
          const sr = orig.call(this, init);
          if (this.getAttribute("data-component") === "emoji-format-checker") {
            (window as any).__e2eShadowRoot = sr;
          }
          return sr;
        };
      });

      await page.goto(prodUrl);
      await page.waitForFunction(
        () =>
          document
            .getElementById("network-details")
            ?.textContent?.includes("Reported checkpoint: 12345") &&
          Boolean((window as any).__e2eShadowRoot) &&
          !(window as any).__e2eShadowRoot
            .querySelector("textarea")
            ?.matches(":disabled"),
      );

      for (const vp of VIEWPORTS) {
        await assertResponsiveGeometry(
          page,
          vp,
          [
            "explorer-mirror-title",
            "availability",
            "operations",
            "status",
            "refresh",
            "emoji-format-checker",
            "network-status",
            "network-details",
          ],
          `${name}:public-pages`,
        );
      }

      // Ubuntu's system-ui resolves to wider metrics than this box's default.
      // Reproduce the original 356px overflow from the unbreakable explorer URL.
      await page.evaluate(()=>{document.documentElement.style.fontFamily='"DejaVu Sans", monospace';});
      await assertResponsiveGeometry(page,{name:"mobile-xs-wide-font",width:320,height:568},
        ["explorer-mirror-title","availability","operations","status","emoji-format-checker","network-details"],
        `${name}:public-pages-wide-font`);
      assert.ok(await page.locator(".resource-panel").evaluate(el=>el.scrollWidth<=el.clientWidth+1),
        `${name}: long explorer URLs stay within their panel, without clipping`);
      await page.evaluate(()=>{document.documentElement.style.removeProperty("font-family");});

      // Test the Shadow-DOM Unicode 17 emoji format checker across Chromium, Firefox, and WebKit
      const emojiCheckResult = await page.evaluate(async () => {
        const sr = (window as any).__e2eShadowRoot as ShadowRoot | undefined;
        if (!sr) return { ok: false, reason: "missing-shadow-root" };
        const input = sr.querySelector(
          "textarea",
        ) as HTMLTextAreaElement | null;
        const btn = sr.querySelector("button") as HTMLButtonElement | null;
        if (!input || !btn) return { ok: false, reason: "missing-controls" };
        input.value = "👩‍🦰🫪🌐";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        btn.click();
        return {
          ok: true,
          text: sr.querySelector('[role="status"]')?.textContent ?? "",
        };
      });
      assert.equal(
        emojiCheckResult.ok,
        true,
        `${name}: shadow DOM emoji checker ready`,
      );
      assert.match(
        emojiCheckResult.text ?? "",
        /3/,
        `${name}: shadow DOM emoji checker counted 3 Unicode 17 emoji sequences`,
      );
      assert.ok(
        (await page
          .locator('a.hero-cta[href="https://poadomains.grok.me"]')
          .count()) >= 1,
        `${name}: public GitHub Pages mirror links to poadomains.grok.me`,
      );
      assert.deepEqual(errors, [], `${name}: public pages zero errors`);
    } finally {
      await browser.close();
    }
  }
}

const appDir = mkdtempSync(join(tmpdir(), "poa-ui-ux-e2e-app-"));
const staticRefDir = buildReferenceBundle(
  mkdtempSync(join(tmpdir(), "poa-reference-pages-test-")),
);

const app = await startRegistryApp({ dataDir: appDir, port: 0 });
const staticRefServer = await startStaticDirServer(staticRefDir);
const prodSiteServer = await startStaticDirServer(resolve("_site"));

const summary: {
  status: string;
  browsersTested: string[];
  viewportsTested: string[];
  surfacesTested: string[];
  browserResults: Record<string, string>;
  agentRoundtripVerified: boolean;
} = {
  status: "passed",
  browsersTested: BROWSERS.map((b) => b.name),
  viewportsTested: VIEWPORTS.map((v) => `${v.name} (${v.width}x${v.height})`),
  surfacesTested: [
    "full-stack-registry-app (poa-mainnet-v1, 5216 emoji17 sequences, 655 reserved roots)",
    "static-reference-snapshot (/poa-domains/ demo bundle)",
    "public-production-pages (_site/ 15-file read-only guard + Shadow-DOM emoji checker)",
  ],
  browserResults: {},
  agentRoundtripVerified: false,
};

try {
  // 1. Test full-stack registry app UI & UX across Chromium, Firefox, and WebKit and all 7 viewports
  for (const { name, launcher } of BROWSERS) {
    const browser = await launcher.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await runFullUiUxFlowsOnRegistryApp(
        page,
        name,
        app.url,
        app.principals.carol!,
      );
      summary.browserResults[name] =
        "passed all 7 viewports, quick-pills, 7 search states, 4-source Agent Cart, live prompt updates, and 17-action digest parity";
    } finally {
      await browser.close();
    }
  }

  // 2. Test full Human-to-Agent Roundtrip (Cart -> Signed POST /v1/intents -> UI #refresh -> Owned Deed + Outbid Refund + History)
  {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      await runAgentRoundtripVerification(page, appDir, app);
      summary.agentRoundtripVerified = true;
    } finally {
      await browser.close();
    }
  }

  // 3. Test Static Reference Snapshot across Chromium, Firefox, and WebKit
  await runStaticReferenceMultiBrowserSmoke(staticRefServer.url);

  // 4. Test Public Production Pages & Shadow-DOM Emoji 17 Checker across Chromium, Firefox, and WebKit
  await runPublicProductionPagesMultiBrowserSmoke(prodSiteServer.url);

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await prodSiteServer.close();
  await staticRefServer.close();
  await app.close();
  rmSync(staticRefDir, { recursive: true, force: true });
  rmSync(appDir, { recursive: true, force: true });
}
