// Reuse the single build artifact. Every test command inherits V8 coverage,
// including .mjs tests, bundled escrow units and the Node side of workerd tests.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const suites = {
  unit: [
    ["node", "--test", ...readdirSync("dist/test").filter(n => n.endsWith(".test.js")).map(n => `dist/test/${n}`),
      "test/ui-live-shaping.test.mjs", "test/ui-ownership.test.mjs", "test/onboarding-grant-cutoff.test.mjs", "test/live-network.test.mjs",
      "test/emoji-format-checker.test.mjs", "test/ci-contract.test.mjs", "test/worker-deploy.test.mjs", "test/ui-cart-correctness.test.mjs", "test/ui-freshness.test.mjs", "test/ui-modules.test.mjs", "test/ui-domain-links.test.mjs", "test/public-registry-view.test.mjs", "test/network-schema.test.mjs", "test/errors.test.mjs", "test/mcp-core.test.mjs", "test/mcp-deploy.test.mjs", "test/agent-cart-v2.test.mjs", "test/discovery.test.mjs", "test/ui-a11y.test.mjs", "test/ui-policy.test.mjs", "test/ui-ideas-feature.test.mjs", "test/search-log.test.mjs", "test/backup-tamper.test.mjs"],
    ["node", "--experimental-strip-types", "--test", "test/network-status-worker.test.mjs", "test/backup-codec.test.mjs"],
  ],
  "browser-smoke": [["node", "dist/test/production-smoke.js"], ["node", "dist/test/smoke.js"],
    ["node", "dist/test/reference-pages-smoke.js"], ["node", "dist/test/pages-smoke.js"],
    ["node", "node_modules/@playwright/test/cli.js", "test", "--config=test/playwright.emoji-format.config.mjs"]],
  "browser-e2e": [["node", "dist/test/ui-ux-e2e-smoke.js"], ["node", "test/ui-ideas-feature-browser.mjs"], ["node", "test/ui-layout-browser.mjs"], ["node", "test/public-registry-view-browser.mjs"], ["node", "test/ui-domain-links-browser.mjs"], ["node", "test/ui-cart-browser.mjs"], ["node", "test/ui-freshness-browser.mjs"], ["node", "test/ui-agent-cart-browser.mjs"], ["node", "cloudflare/test/agent-journey.mjs"]],
  "browser-a11y": [["node", "test/ui-a11y-browser.mjs"], ["node", "test/ui-perf-browser.mjs"]],
  "browser-escrow": [["node", "cloudflare/test/escrow-ui.mjs"]],
  "cloudflare-registry": [["node", "cloudflare/test/integration.mjs"], ["node", "cloudflare/test/routes-contract.mjs"], ["node", "cloudflare/test/error-contract.mjs"], ["node", "cloudflare/test/mcp-http.mjs"], ["node", "cloudflare/test/mcp-real-do.mjs"], ["node", "cloudflare/test/public-view-runtime.mjs"], ["node", "cloudflare/test/display-freshness-runtime.mjs"], ["node", "cloudflare/test/network-status-shared-runtime.mjs"], ["node", "cloudflare/test/discovery.mjs"], ["node", "cloudflare/test/ui-policy.mjs"], ["node", "cloudflare/test/terms-assets.mjs"], ["node", "cloudflare/test/search-log.mjs"]],
  "cloudflare-recovery": [["node", "--experimental-strip-types", "cloudflare/test/backup-restore.mjs"]],
  "escrow-unit": [["node", "--test", "dist/escrow-tests/unit.mjs", "dist/escrow-tests/public.mjs"]],
  "escrow-local": [["node", "--test", "dist/escrow-tests/unit.mjs", "dist/escrow-tests/public.mjs"],
    ["node", "cloudflare/test/escrow-runtime.mjs"], ["node", "cloudflare/test/escrow-admin-runtime.mjs"]],
  security: [["npm", "run", "unicode:audit"], ["npm", "run", "security"], ["npm", "run", "metadata:check"]],
};

export const coverageMatrix = Object.keys(suites).flatMap(suite => suite === "escrow-unit" ? [[suite, "22"]] :
  suite === "unit" ? [[suite, "22"], [suite, "24"]] : [[suite, "24"]]);
export function commandsFor(suite, node) { return suites[suite]; }
function run(suite, coverage = true) {
  if (!suites[suite]) throw Error(`Unknown suite: ${suite}`);
  const dir = resolve(".coverage", `${suite}-${process.versions.node.split(".")[0]}`);
  if (coverage) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
  const commands = commandsFor(suite, process.versions.node.split(".")[0]);
  for (const [command, ...args] of commands) {
    const result = spawnSync(command, args, { stdio: "inherit", env: {
      ...process.env, ESCROW_FIXTURE_MODULE: pathToFileURL(resolve("dist/escrow-tests/fixture.mjs")).href, WRANGLER_SEND_METRICS: "false", CF_EXPECT_FRESH: "1",
      ...(coverage ? { NODE_V8_COVERAGE: resolve(dir, "raw"), NODE_OPTIONS: `--enable-source-maps --import=${pathToFileURL(resolve("scripts/ci-coverage-preload.mjs")).href}` } : {}),
    }});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  if (coverage) writeFileSync(resolve(dir, "completed.json"), JSON.stringify({ suite, node: process.versions.node,
    commands, root: process.cwd(), completed: true }) + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const mode = process.argv[2];
  if (mode === "check") {
    for (const suite of ["unit", "browser-smoke", "security"]) run(suite, false);
  } else if (mode === "coverage-local") {
    for (const suite of Object.keys(suites)) run(suite);
    const result = spawnSync(process.execPath, ["scripts/ci-coverage.mjs", "--local"], { stdio: "inherit" });
    process.exit(result.status ?? 1);
  } else run(mode);
}
