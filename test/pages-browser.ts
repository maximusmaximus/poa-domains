import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

export async function verifyStaticPage(url: string, screenshot?: string) {
  const expected = new URL(url),
    browser = await chromium.launch({ headless: true });
  const checks: string[] = [],
    violations: string[] = [],
    errors: string[] = [],
    requests: string[] = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push("HTTP " + response.status());
    });
    const allowed = new Set([
      expected.pathname,
      ...["app.js", "style.css", "icon.svg", "config.json", "status.json", "network.json"].map(
        (file) => expected.pathname + file,
      ),
    ]);
    await page.route("**/*", (route) => {
      const request = route.request(),
        path = new URL(request.url());
      requests.push(path.pathname);
      if (
        request.method() !== "GET" ||
        path.origin !== expected.origin ||
        !allowed.has(path.pathname) ||
        path.search
      ) {
        violations.push(request.method() + " " + path.pathname);
        return route.abort();
      }
      return route.continue();
    });
    const start = performance.now(),
      response = await page.goto(url);
    assert.equal(response?.status(), 200);
    await page.waitForFunction(() =>
      document
        .querySelector("#status")
        ?.textContent?.includes("Verified application guard"),
    );
    const renderMs = Math.round(performance.now() - start);
    assert.match(await page.locator("h1").innerText(), /PoA domains/);
    assert.match(
      await page.locator("#availability").innerText(),
      /Native registry unavailable/,
    );
    assert.match(
      await page.locator("body").innerText(),
      /not production-ready naming/,
    );
    checks.push(
      "HTTP 200, production-only unavailable state, no claim of native readiness",
    );
    assert.equal(await page.locator("form,input,select,textarea").count(), 0);
    assert.equal(
      await page
        .locator("#names,#auctions,#state,#handoff,#digest,#copy")
        .count(),
      0,
    );
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /agent\.alpha|rental\.alpha|Fixture alice|open \/ funded|transaction succeeded/,
    );
    checks.push(
      "no ownership, balance, auction, receipt, unsigned body or signing/handoff surface",
    );
    await page.locator("#refresh").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#status")
        ?.textContent?.includes("Verified application guard"),
    );
    checks.push(
      "refresh reads only fixed same-origin availability documents, never a backend",
    );
    const observedAt = Date.now();
    const observation = { kind: "native-network-observation", source: "https://minepoa.com", chainId: "poa-mainnet-1", observedAt, expiresAt: observedAt + 900000, verification: "node-reported-unverified", finalityVerified: false, registryReady: false, checkpoint: { height: 50, cutoffTs: Math.floor(observedAt / 1000) - 1 }, epochsClosed: 1, agentsJoined: 2, transactions: 3, reportedFinalTransactions: 2, attestationThreshold: 5, engineSha256: "a".repeat(64), paramsSha256: "b".repeat(64) };
    // Browser-only controlled responses: never emitted by the production build.
    await page.route("**/network.json", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(observation) }));
    await page.locator("#refresh").click();
    await page.waitForFunction(() => document.querySelector("#network-status")?.textContent?.includes("Official-node observation"));
    assert.match(await page.locator("#network-details").innerText(), /Network: poa-mainnet-1/);
    assert.match(await page.locator("#network-status").innerText(), /unverified/);
    checks.push("node observation is explicitly unverified and never changes naming readiness");
    for (const value of [{ ...observation, observedAt: observedAt - 900001, expiresAt: observedAt - 1 }, { ...observation, registryReady: true }, { ...observation, chainId: '<img src=x onerror="window.pwned=true">' }, { kind: "native-network-unavailable" }]) {
      await page.route("**/network.json", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(value) }));
      await page.locator("#refresh").click();
      await page.waitForFunction(() => document.querySelector("#network-status")?.textContent?.includes("no current network state"));
      assert.equal(await page.locator("#network-details").innerText(), "");
      assert.equal(await page.locator("img").count(), 0);
    }
    await page.unroute("**/network.json");
    checks.push("stale, absent, forged-ready or injected observations show no network values and no synthetic fallback");
    await page.route("**/status.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          mode: "production-only",
          operational: true,
          nativeNamingVerified: true,
          backend: "http://127.0.0.1:1",
          state: { balances: { fake: "100" } },
          message: '<img src=x onerror="window.pwned=true">',
        }),
      }),
    );
    await page.locator("#refresh").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#error")
        ?.textContent?.includes("could not be validated"),
    );
    assert.match(await page.locator("#status").innerText(), /Fail-closed/);
    assert.equal(await page.locator("img").count(), 0);
    assert.equal(
      await page.evaluate(() => Boolean((window as any).pwned)),
      false,
    );
    checks.push(
      "forged ready/native flags, synthetic state and injection payloads cannot enable or render a registry",
    );
    await page.route("**/config.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          mode: "static-synthetic-demo",
          publicApiBase: "http://127.0.0.1:1",
          statusFile: "./demo/state.json",
        }),
      }),
    );
    await page.locator("#refresh").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#error")
        ?.textContent?.includes("could not be validated"),
    );
    assert.match(await page.locator("#status").innerText(), /Fail-closed/);
    checks.push(
      "reference/demo mode and endpoint overrides fail closed with no fallback",
    );
    await page.unroute("**/config.json");
    await page.unroute("**/status.json");
    await page.locator("#refresh").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#status")
        ?.textContent?.includes("Verified application guard"),
    );
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    assert.ok(requests.every((path) => !/\/v1\/|\/demo\//.test(path)));
    checks.push(
      "zero network mutations, live/API/localhost requests, remote assets or console errors",
    );
    const bytes = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .reduce(
          (total, entry) =>
            total + (entry as PerformanceResourceTiming).decodedBodySize,
          0,
        ),
    );
    assert.ok(bytes < 100000);
    if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
    return {
      status: "passed",
      assertionGroups: checks.length,
      checks,
      operational: false,
      fixtureData: false,
      requests: requests.length,
      resourceBytes: bytes,
      initialRenderMs: renderMs,
      mutations: 0,
      backendRequests: 0,
      consoleErrors: 0,
    };
  } finally {
    await browser.close();
  }
}
