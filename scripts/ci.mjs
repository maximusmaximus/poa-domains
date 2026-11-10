// Reuse the single build artifact. Every test command inherits V8 coverage,
// including .mjs tests, bundled escrow units and the Node side of workerd tests.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const suites = {
  unit: [
    ["node", "--test", ...readdirSync("dist/test").filter(n => n.endsWith(".test.js")).map(n => `dist/test/${n}`),
      "test/ui-live-shaping.test.mjs", "test/ui-ownership.test.mjs", "test/live-network.test.mjs",
      "test/emoji-format-checker.test.mjs", "test/ci-contract.test.mjs"],
    ["node", "--experimental-strip-types", "--test", "test/network-status-worker.test.mjs", "test/backup-codec.test.mjs"],
  ],
  "browser-smoke": [["node", "dist/test/production-smoke.js"], ["node", "dist/test/smoke.js"],
    ["node", "dist/test/reference-pages-smoke.js"], ["node", "dist/test/pages-smoke.js"],
    ["node", "node_modules/@playwright/test/cli.js", "test", "--config=test/playwright.emoji-format.config.mjs"]],
  "browser-e2e": [["node", "dist/test/ui-ux-e2e-smoke.js"]],
  "browser-escrow": [["node", "cloudflare/test/escrow-ui.mjs"]],
  "cloudflare-registry": [["node", "cloudflare/test/integration.mjs"]],
  "cloudflare-recovery": [["node", "--experimental-strip-types", "cloudflare/test/backup-restore.mjs"]],
  "escrow-local": [["node", "scripts/test-escrow.mjs", "--no-build"]],
  security: [["npm", "run", "unicode:audit"], ["npm", "run", "security"], ["npm", "run", "metadata:check"]],
};

function run(suite, coverage = true) {
  if (!suites[suite]) throw Error(`Unknown suite: ${suite}`);
  const dir = resolve(".coverage", `${suite}-${process.versions.node.split(".")[0]}`);
  if (coverage) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
  for (const [command, ...args] of suites[suite]) {
    const result = spawnSync(command, args, { stdio: "inherit", env: {
      ...process.env, WRANGLER_SEND_METRICS: "false", CF_EXPECT_FRESH: "1",
      ...(coverage ? { NODE_V8_COVERAGE: resolve(dir, "raw"), NODE_OPTIONS: "--enable-source-maps" } : {}),
    }});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  if (coverage) writeFileSync(resolve(dir, "completed.json"), JSON.stringify({ suite, node: process.versions.node,
    commands: suites[suite], completed: true }) + "\n");
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
