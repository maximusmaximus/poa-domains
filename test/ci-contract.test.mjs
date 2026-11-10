import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { suites } from "../scripts/ci.mjs";
const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8"));

test("only main pushes and PRs run CI; superseded runs cancel; exact required check gates all lanes", () => {
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.ok("pull_request" in workflow.on);
  assert.equal(workflow.concurrency["cancel-in-progress"], true);
  assert.match(workflow.concurrency.group, /pull_request.number.*github.ref/);
  const jobs = workflow.jobs;
  assert.equal(jobs.check.if, "always()");
  assert.deepEqual(jobs.check.needs.sort(), Object.keys(jobs).filter(n => n !== "check").sort());
  assert.ok(jobs.check.steps.some(s => s.run?.includes('s!=="success"')));
  assert.ok(jobs.check.steps.some(s => s.run?.includes("npm run ci:coverage")));
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of job.steps.filter(s => s.uses?.startsWith("actions/checkout@")))
      assert.equal(step.with["persist-credentials"], false, name);
    if (!["build", "check"].includes(name)) {
      assert.deepEqual(job.strategy.matrix.node, ["22.15.0", "24"]);
      assert.equal(job.needs, "build");
      assert.ok(job.steps.some(s => s.uses?.startsWith("actions/download-artifact@") && s.with.name === "compiled"));
      assert.ok(!job.steps.some(s => /npm run (build|check|pages:build|cf:test)/.test(s.run ?? "")), name);
      assert.ok(job.steps.some(s => s.with?.["include-hidden-files"] === true));
    }
  }
  const artifact = jobs.build.steps.find(s => s.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(artifact.with["include-hidden-files"], true, "retain _site/.nojekyll");
  for (const dir of ["dist/", "_site/", "cloudflare/generated/"]) assert.ok(artifact.with.path.includes(dir));
  for (const name of ["browser", "cloudflare"]) {
    const steps = jobs[name].steps;
    assert.ok(steps.some(s => s.uses?.startsWith("actions/cache@") && s.with.path.includes("ms-playwright")));
    assert.ok(steps.some(s => s.run?.includes("playwright install-deps") && !s.if));
  }
});

test("Pages CLI build is byte-identical with all network transports forbidden", () => {
  const build = () => {
    const result = spawnSync(process.execPath, ["--import", "./test/fixtures/ci-no-network.mjs", "dist/src/pages-build.js"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return Object.fromEntries(readdirSync("_site").sort().map(name => [name, createHash("sha256").update(readFileSync(join("_site", name))).digest("hex")]));
  };
  assert.deepEqual(build(), build());
  assert.deepEqual(JSON.parse(readFileSync("_site/network.json", "utf8")), {
    kind: "native-network-unavailable", code: "NOT_OBSERVED", registryReady: false, finalityVerified: false,
  });
});

test("coverage gate actually rejects an uncovered branch and low line coverage", () => {
  const dir = mkdtempSync(join(tmpdir(), "poa-ci-coverage-"));
  try {
    writeFileSync(join(dir, "sample.mjs"), 'function choose(x) {\n if(x) {\n  return 1;\n } else {\n  return 2;\n }\n}\nchoose(true);\n');
    writeFileSync(join(dir, "config.json"), JSON.stringify({ all: true, src: ["."], include: ["*.mjs"], extension: [".mjs"], exclude: [],
      reporter: ["json-summary"], "reports-dir": "report", "temp-directory": "raw",
      "check-coverage": true, lines: 100, branches: 100 }));
    const env = { ...process.env }; delete env.NODE_V8_COVERAGE;
    const result = spawnSync(process.execPath, [resolve("node_modules/c8/bin/c8.js"), "--config", "config.json", process.execPath, "sample.mjs"], { cwd: dir, env, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    const summary = JSON.parse(readFileSync(join(dir, "report/coverage-summary.json"), "utf8")).total;
    assert.ok(summary.lines.pct < 100); assert.ok(summary.branches.pct < 100);
    assert.match(result.stderr, /Coverage for lines/); assert.match(result.stderr, /Coverage for branches/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CI escrow wiring retains the complete unchanged unit, public, runtime and admin suites", () => {
  const old = readFileSync("scripts/test-escrow.mjs", "utf8"), bundles = readFileSync("scripts/ci-bundles.mjs", "utf8");
  for (const source of ["escrow.test.ts", "escrow-public.test.ts", "escrow-runtime-fixture.ts"])
    { assert.ok(old.includes(source)); assert.ok(bundles.includes(source)); }
  assert.deepEqual(suites["escrow-local"], [
    ["node", "--test", "dist/escrow-tests/unit.mjs", "dist/escrow-tests/public.mjs"],
    ["node", "cloudflare/test/escrow-runtime.mjs"], ["node", "cloudflare/test/escrow-admin-runtime.mjs"],
  ]);
  assert.deepEqual(suites["browser-escrow"], [["node", "cloudflare/test/escrow-ui.mjs"]]);
});
