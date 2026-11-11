import {profileEngine} from "./fixtures/ui-harness.mjs";
import {capabilities} from "../dist/src/interface.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  pickSiteTitle,
  buildSiteTitle,
  TITLE_LETTER_OPTIONS,
  buildIdeas,
  randomIdea,
  IDEA_EMOJI,
  masonryRows,
  inspectName,
  classifyAuction,
  partitionAuctions,
  shapeLiveActions,
  historyForTarget,
  buildAgentCheckoutHandoff,
  loadCart,
  saveCart,
  CART_STORAGE_KEY,
  titleCodePointsOk,
  TITLE_SAFE_CODEPOINTS,
  domainPath,
  parseDomainPath,
  parseOwnerPath,
  resolveDomainView,
  activeResaleOffers,
  buildListingPrompt,
  tabWatermarks,
  tabHasNew,
  loadTabSeen,
  saveTabSeen,
  TAB_SEEN_KEY,
} from "../reference-web/shared.js";

function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("emoji site title spells poadomains consistently without info/alert/currency substitutions", () => {
  const seen = new Set();
  for (let k = 0; k < 40; k++) {
    const t = buildSiteTitle();
    assert.equal(t.spelled, "poadomains");
    assert.equal(t.glyphs.length, 10);
    seen.add(t.text + t.theme + t.tile);
  }
  assert.equal(seen.size, 1, "stable title across reloads");
  assert.equal(buildSiteTitle().text, "🅿️🅾️🅰️D🅾️Ⓜ️🅰️INS");
  assert.deepEqual(buildSiteTitle(() => 0), buildSiteTitle(() => .99));
  assert.ok(!/[ℹ❗💲]/u.test(buildSiteTitle().text));
  assert.equal(buildSiteTitle().theme, "flat");
  assert.equal(buildSiteTitle().tile, "blue");
});

test("partitionAuctions splits past current upcoming from real shapes", () => {
  const time = 1000;
  const auctions = [
    { id: "a1", name: "past", status: "finalized", openAt: 100, window: 10, quiet: 10 },
    { id: "a2", name: "live", status: "live", openAt: 900, window: 3600, quiet: 3600, reserve: "1000", asset: "POA" },
    { id: "a3", name: "soon", status: "live", openAt: 2000, window: 3600, quiet: 3600, reserve: "1000", asset: "POA" },
  ];
  assert.equal(classifyAuction(auctions[0], time), "past");
  assert.equal(classifyAuction(auctions[1], time), "current");
  assert.equal(classifyAuction(auctions[2], time), "upcoming");
  const parts = partitionAuctions(auctions, time);
  assert.deepEqual(parts.past.map((a) => a.name), ["past"]);
  assert.deepEqual(parts.current.map((a) => a.name), ["live"]);
  assert.deepEqual(parts.upcoming.map((a) => a.name), ["soon"]);
});

test("shapeLiveActions uses committed state only and stays empty without data", () => {
  assert.deepEqual(shapeLiveActions(null), []);
  assert.deepEqual(shapeLiveActions({}), []);
  const items = shapeLiveActions({
    time: 1000,
    auctions: {
      a: {
        id: "a",
        name: "orbit",
        status: "live",
        openAt: 900,
        window: 3600,
        quiet: 3600,
        reserve: "1000",
        asset: "POA",
        sequence: 3,
        high: { amount: "1100", at: 950, payer: "poa1x" },
      },
    },
    bids: {
      b: {
        id: "b",
        auctionId: "a",
        amount: "1100",
        status: "high",
        sequence: 4,
        at: 950,
      },
    },
    receipts: {},
    offers: {},
    deeds: {},
  });
  assert.ok(items.length >= 2);
  assert.ok(items.some((x) => x.kind === "auction-live" && x.name === "orbit"));
  assert.ok(items.some((x) => x.kind === "bid" && x.name === "orbit"));
});

test("historyForTarget returns auction and bid rows", () => {
  const state = {
    time: 1000,
    auctions: {
      a: {
        id: "a",
        name: "orbit",
        status: "live",
        openAt: 900,
        window: 10,
        quiet: 10,
        reserve: "1",
        asset: "POA",
        sequence: 1,
      },
    },
    bids: {
      b: {
        id: "b",
        auctionId: "a",
        amount: "2",
        status: "high",
        sequence: 2,
        at: 910,
      },
    },
    receipts: {},
    deeds: {},
  };
  const rows = historyForTarget(state, { name: "orbit", auctionId: "a" });
  assert.ok(rows.some((r) => r.kind === "auction"));
  assert.ok(rows.some((r) => r.kind === "bid"));
});

test("buildAgentCheckoutHandoff is unsigned machine-readable without secrets", async () => {
  const engine=profileEngine();
  const text = await buildAgentCheckoutHandoff(
    [
      {
        name: "quantum",
        action: "announceAuction+bid",
        tier: "standard",
        isRoot: true,
        asset: "POA",
        amount: "1000",
        summary: "announce",
        params: { name: "quantum", asset: "POA", reserve: "100", maxBid: "1000", expectedDeedId:null, expectedVersion:0 },
      },
    ],
    capabilities(engine),
    "",
    "http://127.0.0.1:8787",
    "local-reference-only",
    {state:engine.snapshot(),stateHash:engine.stateHash()},
    1000000000,
  );
  assert.match(text, /POA DOMAINS REGISTRY CART/);
  assert.match(text, /poa-domains\.agent-cart\.v2/);
  assert.match(text, /\/v1\/intents/);
  assert.match(text, /submit_intent/);
  assert.match(text, /quantum/);
  assert.doesNotMatch(text, /BEGIN .*PRIVATE KEY/);
  assert.doesNotMatch(text, /"signatures"/);
  assert.doesNotMatch(text, /secret/i);
});

test("cart localStorage helpers round-trip and reject junk", () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  };
  saveCart(storage, [{ name: "a", action: "bid" }]);
  assert.equal(loadCart(storage)[0].name, "a");
  mem.set(CART_STORAGE_KEY, "{bad");
  assert.deepEqual(loadCart(storage), []);
});


test("every title option uses only vetted code points, never regional indicators", () => {
  for (const [letter, opts] of Object.entries(TITLE_LETTER_OPTIONS)) {
    for (const o of opts) {
      if (o === null) continue;
      assert.equal(titleCodePointsOk(o), true, letter + " " + o);
      for (const ch of o) {
        const cp = ch.codePointAt(0);
        assert.ok(cp < 0x1f1e6 || cp > 0x1f1ff, `regional ${cp.toString(16)}`);
      }
    }
  }
  for (let k = 0; k < 50; k++) assert.equal(titleCodePointsOk(pickSiteTitle()), true);
  for (let k = 0; k < 6; k++) {
    const t = pickSiteTitle(seq([k / 7, 0.99, 0.1, 0.5]));
    assert.equal(titleCodePointsOk(t), true, t);
  }
  assert.ok(TITLE_SAFE_CODEPOINTS.has(0x1f17f));
  assert.equal(TITLE_SAFE_CODEPOINTS.has(0x1f1f5), false);
});

test("ideas are one word plus 1–3 emoji and only include accepted names", () => {
  const empty = buildIdeas({
    count: 30,
    accept: (q) => {
      const info = inspectName(q, { sequences: {} });
      return info.isRoot && !info.isSingleEmoji;
    },
  });
  // Empty emoji manifest rejects word+emoji ideas, so none survive.
  assert.deepEqual(empty, []);
  const blocked = buildIdeas({ count: 10, accept: () => false });
  assert.deepEqual(blocked, []);
  const throwing = buildIdeas({ count: 10, accept: () => { throw Error("bad"); } });
  assert.deepEqual(throwing, []);
  const manifest = { sequences: Object.fromEntries(IDEA_EMOJI.map((e) => [e, e])) };
  const mixed = buildIdeas({ count: 40, accept: (q) => { const i = inspectName(q, manifest); return i.isRoot && !i.isSingleEmoji; } });
  assert.equal(mixed.length, 40);
  assert.equal(new Set(mixed).size, mixed.length);
  for (const q of mixed) {
    assert.ok(/[a-z]/.test(q), q);
    assert.ok(/[^\x00-\x7f]/.test(q), q);
  }
  let withEmoji = 0;
  let oneToThree = 0;
  for (let k = 0; k < 200; k++) {
    const q = randomIdea();
    if (/[^\x00-\x7f]/.test(q)) withEmoji++;
    const emojis = [...q].filter((ch) => ch.codePointAt(0) > 0x7f);
    // rough: each IDEA_EMOJI is one visible emoji (some may be multi-codepoint — count via IDEA_EMOJI membership)
    let count = 0;
    let rest = q;
    for (const e of IDEA_EMOJI) {
      while (rest.includes(e)) { count++; rest = rest.replace(e, ""); }
    }
    if (count >= 1 && count <= 3 && /[a-z]/.test(rest)) oneToThree++;
  }
  assert.equal(withEmoji, 200, "every idea carries emoji");
  assert.ok(oneToThree > 150, "ideas are one word + 1–3 emoji");
});

test("formatDuration and formatClock are human hours/minutes", async () => {
  const { formatDuration, formatClock } = await import("../reference-web/shared.js");
  assert.equal(formatDuration(45), "0m");
  assert.equal(formatDuration(60), "1m");
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(4500), "1h 15m");
  assert.equal(formatDuration(86400), "24h");
  const clock = formatClock(1_700_000_000);
  assert.match(clock, /[A-Za-z]{3} \d/);
  assert.ok(!/second/i.test(clock));
});

test("masonryRows makes exactly 3 balanced rows", () => {
  const ideas = ["a", "bbbbbbbb", "cc", "ddddd", "e", "ffffffffff", "gg", "hhh", "iiii"];
  const rows = masonryRows(ideas, 3);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.flat().sort(), [...ideas].sort());
  const widths = rows.map((r) => r.reduce((n, q) => n + q.length + 3, 0));
  assert.ok(Math.max(...widths) - Math.min(...widths) <= 10, widths.join(","));
});

test("asset URLs carry current content stamps (no stale cached JS/CSS)", async () => {
  const { stampAssets } = await import("../scripts/stamp-assets.mjs");
  assert.equal(stampAssets().changed, false, "run node scripts/stamp-assets.mjs");
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../reference-web/index.html", import.meta.url), "utf8");
  assert.match(html, /href="\/style\.css\?v=[0-9a-f]{12}"/);
  assert.match(html, /src="\/app\.js\?v=[0-9a-f]{12}"/);
  const headers = readFileSync(new URL("../reference-web/_headers", import.meta.url), "utf8");
  assert.match(headers, /Cache-Control: no-cache, must-revalidate/);
});

test("home HTML: skip link first, one-row tabs, ideas strip, footer links, no top chips", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../reference-web/index.html", import.meta.url), "utf8");
  const body = html.slice(html.indexOf("<body>"));
  assert.ok(body.indexOf('class="skip-link"') < body.indexOf("<header>"));
  assert.ok(!html.includes("resource-nav"));
  assert.ok(!html.includes("quick-pills"));
  assert.ok(html.includes('id="ideasStrip"'));
  assert.equal((html.match(/class="section-tab[ "]/g) ?? []).length, 6);
  assert.match(html, /data-tab="escrow"/);
  assert.match(html, /id="escrowSection" data-section="escrow"/);
  const footer = html.slice(html.indexOf('id="siteFooter"'));
  assert.ok(footer.includes("https://github.com/maximusmaximus/poa-domains"));
  assert.ok(footer.includes("https://maximusmaximus.github.io/poa-domains/"));
  assert.ok(footer.includes("Tesselate Army"));
  const header = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
  assert.ok(!header.includes("<a "), "no links in header");
  assert.equal(/xero[\s-]?emoji/i.test(html), false);
  assert.match(html, /Loading registry data/);
  assert.ok(!html.includes("cartSigner"));
  assert.ok(!html.includes("listValidSeconds"));
  assert.ok(html.includes("listValidHours"));
  assert.ok(!/local-committed-only/i.test(html));
  const css = readFileSync(new URL("../reference-web/style.css", import.meta.url), "utf8");
  assert.match(css, /mask-image:[^;]*transparent/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.ok(!/text-align:\s*justify/.test(css));
  assert.match(css, /\.skip-link:focus/);
});

test("domain and owner path helpers round-trip", () => {
  assert.equal(domainPath("nexus"), "/d/nexus");
  assert.equal(domainPath("🚀🚀"), "/d/" + encodeURIComponent("🚀🚀"));
  assert.equal(parseDomainPath("/d/nexus"), "nexus");
  assert.equal(parseDomainPath("/d/" + encodeURIComponent("🧍‍♀️.👩‍🦰")), "🧍‍♀️.👩‍🦰");
  assert.equal(parseDomainPath("/x"), null);
  assert.equal(parseOwnerPath("/p/poa1abc"), "poa1abc");
  assert.equal(parseOwnerPath("/d/nexus"), null);
});

test("resolveDomainView covers available owned listed auction states", () => {
  const state = {
    time: 1000,
    names: {
      owned: { activeId: "d1", name: "owned" },
      listed: { activeId: "d2", name: "listed" },
    },
    deeds: {
      d1: { id: "d1", name: "owned", owner: "poa1a", version: 1, rights: { kind: "permanent" } },
      d2: { id: "d2", name: "listed", owner: "poa1b", version: 2, rights: { kind: "permanent" } },
    },
    auctions: {
      a: { id: "a", name: "live", status: "live", openAt: 900, window: 3600, quiet: 3600, reserve: "1", asset: "POA", sequence: 3 },
    },
    offers: {
      o: {
        id: "o",
        kind: "resale",
        parentId: "d2",
        owner: "poa1b",
        price: "2500",
        asset: "POA",
        cancelled: false,
        uses: 0,
        maxUses: 1,
        validUntil: 5000,
        version: 1,
        sequence: 9,
      },
    },
    bids: {},
    receipts: {},
  };
  assert.equal(resolveDomainView(state, "fresh").status, "available");
  assert.equal(resolveDomainView(state, "owned").status, "owned");
  assert.equal(resolveDomainView(state, "listed").status, "listed");
  assert.equal(resolveDomainView(state, "live").status, "auction-current");
  assert.equal(resolveDomainView(state, "google", new Set(["google"])).status, "reserved");
  const listings = activeResaleOffers(state);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].name, "listed");
});

test("listing prompts are POA-only and unsigned", () => {
  const list = buildListingPrompt({
    kind: "list",
    name: "nexus",
    deed: { id: "deed1", version: 2 },
    price: "2500",
    validUntil: 12345,
    endpointUrl: "https://example.test",
  });
  assert.match(list, /sellFixed/);
  assert.match(list, /"asset":"POA"/);
  assert.match(list, /\/d\/nexus/);
  assert.doesNotMatch(list, /PRIVATE KEY/);
  const change = buildListingPrompt({
    kind: "change",
    name: "nexus",
    deed: { id: "deed1", version: 2 },
    offer: { id: "off1", version: 1 },
    price: "3000",
    validUntil: 999,
    endpointUrl: "https://example.test",
  });
  assert.match(change, /cancelOffer/);
  assert.match(change, /sellFixed/);
  const unlist = buildListingPrompt({
    kind: "unlist",
    name: "nexus",
    deed: { id: "deed1", version: 2 },
    offer: { id: "off1", version: 1 },
    endpointUrl: "https://example.test",
  });
  assert.match(unlist, /cancelOffer/);
});

test("tab new-dots use watermarks and clear after seen", () => {
  const state = {
    sequence: 20,
    auctions: { a: { sequence: 12 } },
    bids: { b: { sequence: 18 } },
    offers: { o: { kind: "resale", sequence: 15, version: 1 } },
  };
  const marks = tabWatermarks(state);
  assert.ok(marks.auctions >= 18);
  assert.ok(marks.market >= 15);
  assert.equal(tabHasNew("auctions", marks, {}), true);
  assert.equal(tabHasNew("auctions", marks, { auctions: marks.auctions }), false);
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  };
  saveTabSeen(storage, { find: 5 });
  assert.equal(loadTabSeen(storage).find, 5);
  assert.equal(TAB_SEEN_KEY, "poadomains.tabSeen.v1");
});

import {
  classifyNetworkProbe,
  shouldHoldTransactions,
  networkBannerCopy,
  networkBannerColor,
  isNetworkBannerDismissed,
  dismissNetworkBanner,
  clearNetworkBannerDismiss,
  htmlHasVisibleXeroEmoji,
  NETWORK_BANNER_DISMISS_KEY,
} from "../reference-web/shared.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("classifyNetworkProbe: online / degraded / 2-failure down", () => {
  assert.equal(
    classifyNetworkProbe({ ok: true, latencyMs: 1200, consecutiveFailures: 0, everSucceeded: true }),
    "online",
  );
  assert.equal(
    classifyNetworkProbe({ ok: true, latencyMs: 5000, consecutiveFailures: 0, everSucceeded: true }),
    "degraded",
  );
  assert.equal(
    classifyNetworkProbe({ ok: true, latencyMs: 800, stale: true, consecutiveFailures: 0, everSucceeded: true }),
    "degraded",
  );
  assert.equal(
    classifyNetworkProbe({ ok: false, consecutiveFailures: 1, everSucceeded: false }),
    "checking",
  );
  assert.equal(
    classifyNetworkProbe({ ok: false, consecutiveFailures: 1, everSucceeded: true }),
    "degraded",
  );
  assert.equal(
    classifyNetworkProbe({ ok: false, consecutiveFailures: 2, everSucceeded: false }),
    "down",
  );
  assert.equal(
    classifyNetworkProbe({ ok: false, consecutiveFailures: 2, everSucceeded: true }),
    "down",
  );
});

test("shouldHoldTransactions only when down", () => {
  assert.equal(shouldHoldTransactions("online"), false);
  assert.equal(shouldHoldTransactions("degraded"), false);
  assert.equal(shouldHoldTransactions("checking"), false);
  assert.equal(shouldHoldTransactions("down"), true);
});

test("network banner copy/color and dismiss until level changes", () => {
  assert.match(networkBannerCopy("online"), /Online/);
  assert.match(networkBannerCopy("down"), /held/i);
  assert.equal(networkBannerColor("down"), "red");
  assert.equal(networkBannerColor("online"), "green");
  assert.equal(networkBannerColor("degraded"), "amber");
  assert.equal(networkBannerColor("checking"), "grey");
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  assert.equal(isNetworkBannerDismissed(storage, "online"), false);
  dismissNetworkBanner(storage, "online");
  assert.equal(store.get(NETWORK_BANNER_DISMISS_KEY), "online");
  assert.equal(isNetworkBannerDismissed(storage, "online"), true);
  assert.equal(isNetworkBannerDismissed(storage, "down"), false);
  clearNetworkBannerDismiss(storage);
  assert.equal(isNetworkBannerDismissed(storage, "online"), false);
});

test("served UI HTML has no visible xero emoji phrasing", () => {
  const html = readFileSync(resolve(root, "reference-web/index.html"), "utf8");
  assert.equal(htmlHasVisibleXeroEmoji(html), false);
  assert.equal(htmlHasVisibleXeroEmoji('<a href="#">🎨 xeroemoji</a>'), true);
  assert.equal(htmlHasVisibleXeroEmoji("<h3>Xero Emoji · bids</h3>"), true);
  assert.equal(
    htmlHasVisibleXeroEmoji("<style>@font-face{font-family:'Xero Emoji'}</style><p>ok</p>"),
    false,
  );
  assert.match(html, /maxi\.grok\.me/);
  assert.match(html, /Tesselate Army/);
  assert.match(html, /networkStatusBar/);
  assert.ok(!html.includes("view-tabs"));
  assert.ok(html.includes('id="sectionTabs"'));
  assert.ok(html.includes("skip-link"));
  assert.ok(html.includes("siteFooter"));
});
