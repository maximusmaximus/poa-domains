import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { suites, coverageMatrix, commandsFor } from "./ci.mjs";
import { relocateCoverage } from "./ci-paths.mjs";
const local = process.argv.includes("--local");
const expected = local ? Object.keys(suites).map(suite => [suite, process.versions.node.split(".")[0]]) : coverageMatrix;
const merged = resolve(".coverage/merged");
rmSync(merged, { recursive: true, force: true }); mkdirSync(merged, { recursive: true });
for (const [suite, node] of expected) {
  const dir = resolve(".coverage", `${suite}-${node}`);
  const manifest = JSON.parse(readFileSync(resolve(dir, "completed.json"), "utf8"));
  if (!manifest.completed || manifest.suite !== suite || manifest.node.split(".")[0] !== node ||
      !manifest.root || JSON.stringify(manifest.commands) !== JSON.stringify(commandsFor(suite, node))) throw Error(`Incomplete coverage suite: ${suite}/${node}`);
  const raw = resolve(dir, "raw"), files = readdirSync(raw).filter(n => n.endsWith(".json"));
  if (!files.length) throw Error(`Missing V8 coverage: ${suite}/${node}`);
  for (const file of files) {
    const target = resolve(merged, `${suite}-${node}-${file}`);
    if (resolve(manifest.root) === process.cwd()) copyFileSync(resolve(raw, file), target);
    else writeFileSync(target, JSON.stringify(relocateCoverage(JSON.parse(readFileSync(resolve(raw, file), "utf8")), manifest.root, process.cwd())));
  }
}
const result = spawnSync(process.execPath, ["node_modules/c8/bin/c8.js", "report"], { stdio: "inherit" });
if (existsSync("coverage/coverage-summary.json")) {
  const summary = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));
  const config = JSON.parse(readFileSync(".c8rc.json", "utf8"));
  // Guard source-map regressions: these must have measured, non-zero source coverage.
  for (const name of ["src/engine.ts", "cloudflare/escrow.ts", "web/live-network.js", "web/emoji-format-checker.mjs"])
    if (!summary[resolve(name)]?.lines.covered) throw Error(`Missing source coverage: ${name}`);
  const text = `## Combined test coverage\n\n| Metric | Covered | Total | Percent | Minimum |\n|---|---:|---:|---:|---:|\n` +
    ["lines", "branches"].map(k => `| ${k} | ${summary.total[k].covered} | ${summary.total[k].total} | ${summary.total[k].pct}% | ${config[k]}% |`).join("\n") +
    `\n\n${expected.length} suite/version manifests verified; .mjs and cloudflare/test commands included.\n` +
    `Unloaded production modules count as zero. Generated Unicode data and tests are excluded from the denominator. ` +
    `V8 measures Node execution (including escrow source-mapped units), not code inside workerd or browser engines; those integration suites still run and gate check.\n`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}
process.exit(result.status ?? 1);
