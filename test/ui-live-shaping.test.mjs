import test from "node:test";
import assert from "node:assert/strict";
import {
  pickSiteTitle,
  TITLE_STYLES,
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

test("emoji site title stylizations cover poadomains letters", () => {
  assert.ok(TITLE_STYLES.length >= 5);
  const seen = new Set();
  for (let i = 0; i < TITLE_STYLES.length; i++) {
    const title = pickSiteTitle(() => i / TITLE_STYLES.length);
    assert.equal(typeof title, "string");
    assert.ok(title.length > 0);
    seen.add(title);
  }
  assert.equal(seen.size, TITLE_STYLES.length);
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

test("buildAgentCheckoutHandoff is unsigned machine-readable without secrets", () => {
  const text = buildAgentCheckoutHandoff(
    [
      {
        name: "quantum",
        action: "announceAuction+bid",
        tier: "standard",
        isRoot: true,
        asset: "POA",
        amount: "1000",
        summary: "announce",
        params: { name: "quantum", asset: "POA", reserve: "1000", maxBid: "1000" },
      },
    ],
    {
      chainId: "poa-mainnet-1",
      registryId: "reg",
      policyHash: "abc",
      revision: "poa-mainnet-v1",
    },
    "",
    "https://example.test",
  );
  assert.match(text, /POA DOMAINS AGENT CHECKOUT/);
  assert.match(text, /poa-domains\.agent-checkout\.v1/);
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


test("every title stylization uses only vetted safe code points", () => {
  for (let i = 0; i < TITLE_STYLES.length; i++) {
    const title = pickSiteTitle(() => i / TITLE_STYLES.length);
    assert.equal(titleCodePointsOk(title), true, title);
    assert.match(title, /poa|POA|domains|DOMAINS|P · O · A/i);
    // No regional-indicator A–Z range
    for (const ch of title) {
      const cp = ch.codePointAt(0);
      assert.ok(cp < 0x1f1e6 || cp > 0x1f1ff, `regional ${cp.toString(16)}`);
    }
  }
  assert.ok(TITLE_SAFE_CODEPOINTS.has("p".codePointAt(0)));
  assert.ok(TITLE_SAFE_CODEPOINTS.has(0x1f680));
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
