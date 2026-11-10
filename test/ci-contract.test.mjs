import {publicArtifactFiles} from '../dist/src/pages-build.js';
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { suites, coverageMatrix, commandsFor } from "../scripts/ci.mjs";
import { relocateCoverage } from "../scripts/ci-paths.mjs";
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
      assert.deepEqual(job.strategy.matrix.node, name === "unit" ? ["22.15.0", "24"] : name === "escrow-unit" ? ["22.15.0"] : ["24"]);
      if (["browser", "cloudflare"].includes(name)) {
        assert.equal(job.needs, undefined, "container pulls overlap compilation");
        assert.equal(job.permissions.actions, "read");
        const wait = job.steps.find(s => s.name === "Wait for this run's build artifact");
        assert.match(wait.uses, /^actions\/github-script@[0-9a-f]{40}$/);
        assert.match(wait.with.script, /run_id: context.runId/);
        assert.match(wait.with.script, /Build failed; no test artifact/);
        assert.match(wait.with.script, /Timed out waiting/);
      } else assert.equal(job.needs, "build");
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
    const version = JSON.parse(readFileSync("package.json", "utf8")).devDependencies["@playwright/test"];
    assert.ok(jobs[name].container.image.startsWith(`mcr.microsoft.com/playwright:v${version}-noble@sha256:`));
    assert.match(jobs[name].container.image, /@sha256:[0-9a-f]{64}$/);
    assert.ok(steps.every(s => !s.run?.includes("playwright install") && !s.run?.includes("apt")));
    assert.ok(steps.some(s => s.run?.includes("PLAYWRIGHT_BROWSERS_PATH=/ms-playwright") && s.run.includes("HOME=/root")), "Firefox HOME must match the container user");
  }
});

test("Pages CLI build is byte-identical with all network transports forbidden", () => {
  const build = () => {
    const result = spawnSync(process.execPath, ["--import", "./test/fixtures/ci-no-network.mjs", "dist/src/pages-build.js"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return Object.fromEntries(publicArtifactFiles("_site").map(name => [name, createHash("sha256").update(readFileSync(join("_site", name))).digest("hex")]));
  };
  assert.deepEqual(build(), build());
  assert.equal(existsSync("_site/network.json"),false);
  assert.equal(JSON.parse(readFileSync("_site/.well-known/agent.json","utf8")).surface.status.livePoA,false);
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

test("coverage matrix matches every configured suite/version; Node 22 includes escrow unit coverage", () => {
  const actual = Object.values(workflow.jobs).filter(j => j.strategy).flatMap(j =>
    j.strategy.matrix.suite.flatMap(suite => j.strategy.matrix.node.map(node => [suite, node.split(".")[0]])));
  const key = x => x.join(":");
  assert.deepEqual(actual.map(key).sort(), coverageMatrix.map(key).sort());
  assert.equal(actual.length, 11);
  assert.deepEqual(commandsFor("escrow-unit", "22").at(-1), ["node", "--test", "dist/escrow-tests/unit.mjs", "dist/escrow-tests/public.mjs"]);
});

test("container coverage relocation preserves counters, source contents, and root boundaries", () => {
  const old = "/__w/repo/repo", next = "/home/runner/work/repo/repo";
  const input = { result: [{ url: `file://${old}/dist/src/core.js`, functions: [{ ranges: [{ startOffset: 1, endOffset: 4, count: 3 }] }] },
    { url: `file://${old}-other/unrelated.js`, functions: [] }], "source-map-cache": {
      [`file://${old}/dist/src/core.js`]: { url: `${old}/dist/src/core.js.map`, data: { sources: ["../../src/core.ts"], sourcesContent: ["export const value = 3;\n", `${old}/source text must not change`] } }
    } };
  const out = relocateCoverage(input, old, next);
  assert.equal(out.result[0].url, `file://${next}/dist/src/core.js`);
  assert.deepEqual(out.result[0].functions, input.result[0].functions);
  assert.equal(out.result[1].url, input.result[1].url);
  assert.equal(out["source-map-cache"][`file://${next}/dist/src/core.js`].url, `${next}/dist/src/core.js.map`);
  assert.deepEqual(out["source-map-cache"][`file://${next}/dist/src/core.js`].data, input["source-map-cache"][`file://${old}/dist/src/core.js`].data);
  assert.equal(input.result[0].url, `file://${old}/dist/src/core.js`, "never mutate input coverage");
});

test("coverage preload excludes only Wrangler subprocess profiling, not tests or fixture environment", () => {
  const dir = mkdtempSync(join(tmpdir(), "poa-ci-profile-"));
  try {
    const wrangler = join(dir, "wrangler/bin/wrangler.js"), ordinary = join(dir, "ordinary.mjs");
    mkdirSync(join(dir, "wrangler/bin"), { recursive: true });
    const probe = 'console.log(JSON.stringify({covered:!!process.env.NODE_V8_COVERAGE, fixture:process.env.ESCROW_FIXTURE_MODULE === "test-fixture"}));';
    writeFileSync(wrangler, probe); writeFileSync(ordinary, probe);
    const driver = join(dir, "driver.mjs");
    writeFileSync(driver, `import {spawn,execFileSync} from "node:child_process";
import {once} from "node:events";
const w=${JSON.stringify(wrangler)}, normal=${JSON.stringify(ordinary)};
const sync=JSON.parse(execFileSync(process.execPath,[w],{encoding:"utf8"}));
const app=JSON.parse(execFileSync(process.execPath,[normal],{encoding:"utf8"}));
const p=spawn(process.execPath,[w],{stdio:["ignore","pipe","inherit"]});
let text="";p.stdout.on("data",x=>text+=x);const [code]=await once(p,"exit");
if(code!==0)process.exit(code);console.log(JSON.stringify({sync,app,async:JSON.parse(text)}));
`);
    const result = spawnSync(process.execPath, ["--import", resolve("scripts/ci-coverage-preload.mjs"), driver], { encoding: "utf8",
      env: { ...process.env, NODE_V8_COVERAGE: join(dir, "raw"), ESCROW_FIXTURE_MODULE: "test-fixture" } });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.deepEqual(out, {sync:{covered:false,fixture:true}, app:{covered:true,fixture:true}, async:{covered:false,fixture:true}});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
