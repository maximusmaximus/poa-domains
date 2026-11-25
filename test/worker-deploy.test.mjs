import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { endpoint } from "../dist/src/client.js";
import { ACCOUNT, WORKER, REPO, ADDRESS, POLICY, parseConfig, productionConfig, expectedPolicy,
  assertBindings, assertProductionEnvironment, assertGitHub, assertLiveEscrowFresh, hasReviewedClientEvidence, committedPins, resolvePinTransition, liveSnapshot, wranglerArgs, runDeployment, repinPlan, checkoutPlan, assertAdvertised, expectedSwitches, switchesPlan, assertSwitches, OPTIONAL_SWITCHES, NETWORK_FACTS, NETWORK_CLIENT } from "../scripts/worker-deploy.mjs";
const config = parseConfig(readFileSync("wrangler.jsonc", "utf8"));
const expected = { ...Object.fromEntries(POLICY.map(k => [k, config.vars[k]])),
  POA_ESCROW_ENABLED: "true", POA_ESCROW_NETWORK_WRITES: "approved-v1", POA_ESCROW_NEW_NAMES: "approved-v1", POA_ESCROW_ADDRESS: ADDRESS };
const bindings = [...POLICY.map(name => ({ name, type: "plain_text", text: expected[name] })),
  ...["POA_ESCROW_KEY", "ESCROW_ADMIN_TOKEN"].map(name => ({ name, type: "secret_text" }))];
const sha = "a".repeat(40), version = "46459dd0-989d-46dc-ad79-c8b24a867595";
const environment = { name: "production", can_admins_bypass: false,
  deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
  protection_rules: [{ type: "branch_policy" }] };
const env = { ...expected, WORKER_DEPLOY_ENABLED: "true", GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_run",
  GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: "not-a-credential", CLOUDFLARE_API_TOKEN: "not-a-credential", DEPLOY_SHA: sha, CI_RUN_ID: "123" };
function provider(overrides = {}) {
  const replies = {
    "/environments/production": environment,
    "/git/ref/heads/main": { object: { sha } },
    "/actions/runs/123": { head_sha: sha, event: "push", head_branch: "main", name: "native-and-reference-checks",
      repository: { full_name: REPO }, status: "completed", conclusion: "success" },
    "/deployments": { success: true, result: { deployments: [{ id: "deployment-one", versions: [{ version_id: version, percentage: 100 }] }] } },
    "/settings": { success: true, result: { bindings } },
    [`/versions/${version}`]: { success: true, result: { id: version, resources: { bindings } } },
    "/v1/escrow/capabilities": { freshness: { held: false, code: null } },
    ...overrides,
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url); assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    assert.ok(url.startsWith(`https://api.github.com/repos/${REPO}/`) ||
      url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${WORKER}/`) ||
      url.startsWith("https://poadomains.grok.me/"));
    const key = Object.keys(replies).find(k => url.endsWith(k)); assert.ok(key, url);
    return { ok: true, json: async () => structuredClone(replies[key]) };
  };
  return { fetchImpl, calls };
}

test("deploy plan omits every escrow override, preserves server bindings and never mutates committed defaults", () => {
  const plan = productionConfig(config);
  assert.equal(plan.keep_vars, true);
  assert.ok(Object.keys(plan.vars).every(k => !k.startsWith("POA_ESCROW_")));
  assert.equal(config.vars.POA_ESCROW_ENABLED, "false"); assert.equal(config.vars.POA_ESCROW_NETWORK_WRITES, "false");
  assert.equal(config.vars.POA_ESCROW_NEW_NAMES, "false");
  assert.deepEqual(plan.durable_objects, config.durable_objects); assert.deepEqual(plan.migrations, config.migrations);
  assert.ok(!plan.routes?.some(r => r.custom_domain), "grok.me is not a zone in this account");
  for (const flag of [true, false]) {
    const args = wranglerArgs("plan.json", flag);
    assert.ok(args.includes("--strict")); assert.ok(args.includes("--keep-vars"));
    assert.equal(args.includes("--dry-run"), flag);
    for (const forbidden of ["--env", "--name", "--var", "--secrets-file"]) assert.ok(!args.includes(forbidden));
  }
  for (const changed of [{ name: "another-worker" }, { account_id: "other-account" }, { env: {} },
    { durable_objects: { bindings: [] } }, { migrations: [] }, { vars: { ...config.vars, POA_ESCROW_ENABLED: "true" } }])
    assert.throws(() => productionConfig({ ...config, ...changed }));
  assert.throws(() => parseConfig("{ invalid }"), /INVALID_WRANGLER_JSONC/);
});

test("all public production policy is mandatory and must match both settings and active version exactly", () => {
  assert.deepEqual(expectedPolicy(expected), expected); assertBindings(bindings, expected);
  for (const key of POLICY) {
    assert.throws(() => expectedPolicy({ ...expected, [key]: "" }), /MISSING_PRODUCTION_POLICY/);
    assert.throws(() => assertBindings(bindings.map(b => b.name === key ? { ...b, text: "different" } : b), expected), /LIVE_POLICY_MISMATCH/);
    assert.throws(() => assertBindings(bindings.filter(b => b.name !== key), expected), /LIVE_POLICY_MISMATCH/);
  }
  for (const [key, value] of [["POA_ESCROW_ENABLED", "false"], ["POA_ESCROW_NETWORK_WRITES", "false"],
    ["POA_ESCROW_NEW_NAMES", "false"], ["POA_ESCROW_ADDRESS", "different"], ["POA_ESCROW_PER_TX", "0"], ["POA_ESCROW_ENGINE_SHA256", "not-a-pin"]])
    assert.throws(() => expectedPolicy({ ...expected, [key]: value }));
  assert.throws(() => assertBindings(undefined, expected), /MISSING_LIVE_BINDINGS/);
  assert.throws(() => assertBindings([...bindings, bindings[0]], expected), /DUPLICATE_LIVE_BINDING/);
  assert.throws(() => assertBindings([...bindings, { name: "POA_ESCROW_NEW_SETTING" }], expected), /UNREVIEWED_ESCROW_BINDING/);
  assert.throws(() => assertBindings(bindings.filter(b => b.name !== "POA_ESCROW_KEY"), expected), /MISSING_LIVE_SECRET_BINDING/);
});

test("production environment restricts to protected main without admin bypass; stale/failed/foreign main refuse deployment", async () => {
  assertProductionEnvironment(environment);
  for (const change of [{ can_admins_bypass: true }, { deployment_branch_policy: null }, { deployment_branch_policy: { protected_branches: true, custom_branch_policies: true } }, { name: "staging" }])
    assert.throws(() => assertProductionEnvironment({ ...environment, ...change }), /PRODUCTION_REQUIRES_PROTECTED_MAIN/);
  for (const change of [{ GITHUB_EVENT_NAME: "pull_request" }, { WORKER_DEPLOY_ENABLED: "" }, { GITHUB_ACTIONS: "" },
    { DEPLOY_SHA: "short" }, { GITHUB_REPOSITORY: "other/repo" }, { GITHUB_TOKEN: "" }])
    await assert.rejects(assertGitHub({ ...env, ...change }, async () => assert.fail("no request permitted")), /DEPLOY_REQUIRES_APPROVED_MAIN_WORKFLOW/);
  await assertGitHub(env, provider().fetchImpl);
  await assert.rejects(assertGitHub(env, provider({ "/git/ref/heads/main": { object: { sha: "b".repeat(40) } } }).fetchImpl), /CURRENT_GREEN_MAIN/);
  await assert.rejects(assertGitHub(env, provider({ "/actions/runs/123": { conclusion: "failure" } }).fetchImpl), /CURRENT_GREEN_MAIN/);
});

test("live policy preflight rejects API errors, split rollout, missing secrets or version mismatch", async () => {
  assert.equal(await liveSnapshot(expected, "not-a-credential", provider().fetchImpl), `deployment-one:${version}`);
  await assert.rejects(liveSnapshot(expected, "not-a-credential", async () => ({ ok: false })), /HTTP_ERROR/);
  await assert.rejects(liveSnapshot(expected, "not-a-credential", provider({ "/settings": { success: false } }).fetchImpl), /PREFLIGHT_FAILED/);
  await assert.rejects(liveSnapshot(expected, "not-a-credential", provider({ "/deployments": { success: true, result: {
    deployments: [{ id: "one", versions: [{ version_id: version, percentage: 50 }] }] } } }).fetchImpl), /AMBIGUOUS_LIVE_VERSION/);
  await assert.rejects(liveSnapshot(expected, "not-a-credential", provider({ [`/versions/${version}`]: {
    success: true, result: { id: "other-version" } } }).fetchImpl), /LIVE_VERSION_MISMATCH/);
});

test("actual runner dry-run needs no credentials/network; approved deployment dry-runs first and rechecks live drift", async () => {
  const calls = [], paths = [];
  const run = (_exe, args, options) => {
    const path = args[args.indexOf("--config") + 1]; paths.push(path);
    const plan = JSON.parse(readFileSync(path, "utf8")); assert.equal(plan.keep_vars, true);
    assert.ok(Object.keys(plan.vars).every(k => !k.startsWith("POA_ESCROW_")));
    assert.ok(Object.keys(options.env).every(k => !k.startsWith("POA_ESCROW_")));
    assert.equal(options.env.GITHUB_TOKEN, undefined); calls.push(args); return { status: 0 };
  };
  await runDeployment({ dryRun: true, env: {}, fetchImpl: async () => assert.fail("offline"), run });
  assert.equal(calls.length, 1); assert.ok(calls[0].includes("--dry-run"));
  calls.length = 0;
  await runDeployment({ dryRun: false, env: { ...env, DEPLOY_POSTCHECK_DELAY_MS: "0" }, fetchImpl: provider().fetchImpl, run });
  assert.equal(calls.length, 2); assert.ok(calls[0].includes("--dry-run")); assert.ok(!calls[1].includes("--dry-run"));
  assert.ok(paths.every(p => !existsSync(p)));
  await assert.rejects(runDeployment({ dryRun: false, env: { ...env, CLOUDFLARE_API_TOKEN: "" }, run }), /MISSING_CLOUDFLARE_API_TOKEN/);
  await assert.rejects(runDeployment({ dryRun: true, env: {}, run: () => ({ status: 1 }) }), /WRANGLER_COMMAND_FAILED/);
  const p = provider(); let deployments = 0, executed = 0;
  const drift = async (url, opts) => {
    const reply = await p.fetchImpl(url, opts);
    if (url.endsWith("/deployments") && ++deployments === 2) {
      const body = await reply.json(); body.result.deployments[0].id = "deployment-two";
      return { ok: true, json: async () => body };
    }
    return reply;
  };
  await assert.rejects(runDeployment({ dryRun: false, env, fetchImpl: drift, run: () => { executed++; return { status: 0 }; } }), /LIVE_VERSION_CHANGED/);
  assert.equal(executed, 1, "only the local dry-run ran, never deployment");
});

test("workflow is credential-free on PRs; main deploy is disarmed, current-CI gated and environment reviewed", () => {
  const w = parse(readFileSync(".github/workflows/deploy-worker.yml", "utf8"));
  assert.ok("pull_request" in w.on); assert.equal(w.on.push, undefined);
  assert.deepEqual(w.on.workflow_run.workflows, ["native-and-reference-checks"]);
  assert.deepEqual(w.on.workflow_run.branches, ["main"]);
  assert.equal(w.permissions.contents, "read"); assert.equal(w.jobs.deploy.environment, "production");
  assert.equal(w.jobs.deploy.needs, "dry-run"); assert.equal(w.jobs.deploy.concurrency["cancel-in-progress"], false);
  assert.match(w.jobs.deploy.if, /WORKER_DEPLOY_ENABLED == 'true'/);
  assert.match(w.jobs.deploy.if, /conclusion == 'success'/); assert.match(w.jobs.deploy.if, /head_branch == 'main'/);
  assert.match(w.jobs.deploy.if, /head_repository.full_name == github.repository/);
  assert.ok(w.jobs["dry-run"].steps.some(s => s.run === "npm run cf:dry-run"));
  assert.ok(!JSON.stringify(w.jobs["dry-run"]).includes("secrets."));
  for (const job of Object.values(w.jobs)) for (const step of job.steps.filter(s => s.uses?.startsWith("actions/checkout@")))
    assert.equal(step.with["persist-credentials"], false);
  const deploy = w.jobs.deploy.steps.find(s => s.run === "node scripts/worker-deploy.mjs --deploy");
  for (const key of POLICY) assert.equal(deploy.env[key], '${{ vars.' + key + ' }}');
  assert.equal(deploy.env.POA_ESCROW_KEY, undefined);
});

test("production host is allowlisted; discovery paths run Worker first; all error logs are sampled", () => {
  assert.equal(endpoint("https://poadomains.grok.me"), "https://poadomains.grok.me");
  assert.throws(() => endpoint("https://unrelated.example")); assert.throws(() => endpoint("http://poadomains.grok.me"));
  for (const path of ["/mcp", "/.well-known/*", "/llms.txt", "/d/*", "/p/*", "/v1/*"])
    assert.ok(config.assets.run_worker_first.includes(path));
  assert.equal(config.observability.logs.head_sampling_rate, 1);
  assert.ok(readFileSync("cloudflare/test/integration.mjs", "utf8").includes('"--local-upstream", "poadomains.grok.me"'));
  const coverage = JSON.parse(readFileSync(".c8rc.json", "utf8"));
  assert.ok(coverage.src.includes("scripts")); assert.ok(coverage.include.includes("scripts/worker-deploy.mjs"));
});

test("checkout enable (Max t136u): missing live binding is written once; already-on is kept; a wrong value is refused", async () => {
  assert.deepEqual(checkoutPlan(expected, bindings.filter(b => b.name !== "POA_ESCROW_NEW_NAMES")), { POA_ESCROW_NEW_NAMES: "approved-v1" });
  assert.equal(checkoutPlan(expected, bindings), null);
  assert.throws(() => checkoutPlan({ ...expected, POA_ESCROW_NEW_NAMES: "false" }, []), /UNSAFE_PRODUCTION_POLICY/);
  assertBindings(bindings.filter(b => b.name !== "POA_ESCROW_NEW_NAMES"), expected, { allowMissing: ["POA_ESCROW_NEW_NAMES"] });
  assert.throws(() => assertBindings(bindings.filter(b => b.name !== "POA_ESCROW_NEW_NAMES"), expected), /LIVE_POLICY_MISMATCH/);
  assert.throws(() => assertBindings(bindings.map(b => b.name === "POA_ESCROW_NEW_NAMES" ? { ...b, text: "false" } : b), expected, { allowMissing: ["POA_ESCROW_NEW_NAMES"] }), /LIVE_POLICY_MISMATCH/);
  const without = bindings.filter(b => b.name !== "POA_ESCROW_NEW_NAMES");
  const p = provider({ "/settings": { success: true, result: { bindings: without } },
    [`/versions/${version}`]: { success: true, result: { id: version, resources: { bindings: without } } } });
  const plans = []; let deployed = false;
  const newBindings = [...without, { name: "POA_ESCROW_NEW_NAMES", type: "plain_text", text: "approved-v1" }];
  const fetchImpl = async (url, o) => {
    const r = await p.fetchImpl(url, o);
    if (!deployed || !(url.endsWith("/settings") || url.includes("/versions/"))) return r;
    const body = await r.json(); if (body.result.bindings) body.result.bindings = newBindings; else body.result.resources.bindings = newBindings;
    return { ok: true, json: async () => body };
  };
  const run = (_exe, args) => { const plan = JSON.parse(readFileSync(args[args.indexOf("--config") + 1], "utf8"));
    plans.push(Object.keys(plan.vars).filter(k => k.startsWith("POA_ESCROW_")).sort()); if (!args.includes("--dry-run")) deployed = true; return { status: 0 }; };
  await runDeployment({ dryRun: false, env: { ...env, DEPLOY_POSTCHECK_DELAY_MS: "0" }, fetchImpl, run });
  assert.deepEqual(plans, [["POA_ESCROW_NEW_NAMES"], ["POA_ESCROW_NEW_NAMES"]]);
  // A later deploy, when the live binding is already approved-v1, writes no escrow overrides.
  plans.length = 0; deployed = false;
  await runDeployment({ dryRun: false, env: { ...env, DEPLOY_POSTCHECK_DELAY_MS: "0" }, fetchImpl: provider().fetchImpl, run });
  assert.deepEqual(plans, [[], []]);
});

test("repin (Max t108s1102): validated, advertised + client-hash verified, writes only the two pins, post-checks new pins", async () => {
  const { createHash } = await import("node:crypto");
  const client = new TextEncoder().encode("official client bytes");
  const engine = createHash("sha256").update(client).digest("hex"), params = "b".repeat(64);
  assert.equal(repinPlan({}, expected), null);
  assert.equal(repinPlan({ POA_ESCROW_REPIN_ENGINE_SHA256: "", POA_ESCROW_REPIN_PARAMS_SHA256: "" }, expected), null);
  assert.throws(() => repinPlan({ POA_ESCROW_REPIN_ENGINE_SHA256: engine }, expected), /INVALID_REPIN/);
  assert.throws(() => repinPlan({ POA_ESCROW_REPIN_ENGINE_SHA256: expected.POA_ESCROW_ENGINE_SHA256, POA_ESCROW_REPIN_PARAMS_SHA256: expected.POA_ESCROW_PARAMS_SHA256 }, expected), /REPIN_NOOP/);
  const pins = repinPlan({ POA_ESCROW_REPIN_ENGINE_SHA256: engine, POA_ESCROW_REPIN_PARAMS_SHA256: params }, expected);
  const network = (facts, bytes = client) => async url => url === NETWORK_FACTS ? { ok: true, json: async () => facts }
    : url === NETWORK_CLIENT ? { ok: true, arrayBuffer: async () => bytes.buffer.slice(0) } : assert.fail(url);
  await assertAdvertised(pins, network({ chain_id: "poa-mainnet-1", engine_sha256: engine, params_sha256: params }));
  { const flaky = network({ chain_id: "poa-mainnet-1", engine_sha256: engine, params_sha256: params });
    const slow = async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return flaky(u); };
    await assert.rejects(assertAdvertised(pins, slow), /REPIN_CLIENT_UNAVAILABLE/, "unreviewed pin with no download fails closed");
    const E = "e01abd959dd0439dd89af8e8c187d1bed3897deb2a855a615e7dfa2d0222f1fb", P = "6a5451ccd3109bb861e12dc31788fe368e0f974f89c41b1e4c8bfab178101101";
    const reviewed = { POA_ESCROW_ENGINE_SHA256: E, POA_ESCROW_PARAMS_SHA256: P };
    const adv = network({ chain_id: "poa-mainnet-1", engine_sha256: E, params_sha256: P });
    assert.equal(await assertAdvertised(reviewed, async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return adv(u); }), "client-hash-from-reviewed-evidence");
    await assert.rejects(assertAdvertised(reviewed, adv), /REPIN_CLIENT_HASH_MISMATCH/, "a downloaded client that does not hash to the pin always fails");
    await assert.rejects(assertAdvertised(reviewed, network({ chain_id: "poa-mainnet-1", engine_sha256: engine, params_sha256: P })), /REPIN_NOT_ADVERTISED/); }
  { // Nov 14 2026 repin evidence: exactly the reviewed engine pin, only with network-facts advertising both new pins.
    const E2 = "92658c61bc75d24572b8eef6182af27436a4f00019854718dcf0de3c6d2b54f6", P2 = "bc823648e0efa9343e62b153a61d74180a32dca8581f1856376616c1e8e0a15f";
    const next = { POA_ESCROW_ENGINE_SHA256: E2, POA_ESCROW_PARAMS_SHA256: P2 }, adv2 = network({ chain_id: "poa-mainnet-1", engine_sha256: E2, params_sha256: P2 });
    const noClient = async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return adv2(u); };
    assert.equal(await assertAdvertised(next, noClient), "client-hash-from-reviewed-evidence");
    await assert.rejects(assertAdvertised(next, adv2), /REPIN_CLIENT_HASH_MISMATCH/, "served bytes must still hash to the pin");
    await assert.rejects(assertAdvertised({ ...next, POA_ESCROW_PARAMS_SHA256: "6a5451ccd3109bb861e12dc31788fe368e0f974f89c41b1e4c8bfab178101101" }, noClient), /REPIN_NOT_ADVERTISED/);
    await assert.rejects(assertAdvertised({ POA_ESCROW_ENGINE_SHA256: "203790bf45866b0155501309eb3e4da6e2bc30db0fc2d11df704e6f93df09147", POA_ESCROW_PARAMS_SHA256: P2 },
      async u => u === NETWORK_FACTS ? { ok: true, json: async () => ({ chain_id: "poa-mainnet-1", engine_sha256: "203790bf45866b0155501309eb3e4da6e2bc30db0fc2d11df704e6f93df09147", params_sha256: P2 }) } : noClient(u)),
      /REPIN_CLIENT_UNAVAILABLE/, "an unreviewed engine pin is never accepted without a download"); }
  { // Nov 19 2026 repin evidence: the newly reviewed engine pin, params unchanged.
    const E3 = "ed86480cd46a8c2df2dbf395f75838f9939120b930cc821c777adf91f5d3d67d", P3 = "bc823648e0efa9343e62b153a61d74180a32dca8581f1856376616c1e8e0a15f";
    const next3 = { POA_ESCROW_ENGINE_SHA256: E3, POA_ESCROW_PARAMS_SHA256: P3 }, adv3 = network({ chain_id: "poa-mainnet-1", engine_sha256: E3, params_sha256: P3 });
    const noClient3 = async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return adv3(u); };
    assert.equal(await assertAdvertised(next3, noClient3), "client-hash-from-reviewed-evidence");
    await assert.rejects(assertAdvertised(next3, adv3), /REPIN_CLIENT_HASH_MISMATCH/, "served bytes must still hash to the pin"); }
  { // Nov 20 2026 repin evidence: engine 39ea914d with new params a4c1e8ce.
    const E4 = "39ea914d92f3049e2e7a37accf1a998d263f280d4d37b075abdc463eda157d88", P4 = "a4c1e8ce83f28fed9a16cad024023c79fc01f6110812521df931bf3c7044659d";
    const next4 = { POA_ESCROW_ENGINE_SHA256: E4, POA_ESCROW_PARAMS_SHA256: P4 }, adv4 = network({ chain_id: "poa-mainnet-1", engine_sha256: E4, params_sha256: P4 });
    const noClient4 = async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return adv4(u); };
    assert.equal(await assertAdvertised(next4, noClient4), "client-hash-from-reviewed-evidence");
    await assert.rejects(assertAdvertised(next4, adv4), /REPIN_CLIENT_HASH_MISMATCH/, "served bytes must still hash to the pin"); }
  { // Nov 22 2026 repin evidence: engine a5feae08, params unchanged (a4c1e8ce).
    const E5 = "a5feae08cbd1fabf38f15637ca113a03ffa2b5b9ce3107dca7cbc84cb8c229a2", P5 = "a4c1e8ce83f28fed9a16cad024023c79fc01f6110812521df931bf3c7044659d";
    const next5 = { POA_ESCROW_ENGINE_SHA256: E5, POA_ESCROW_PARAMS_SHA256: P5 }, adv5 = network({ chain_id: "poa-mainnet-1", engine_sha256: E5, params_sha256: P5 });
    const noClient5 = async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return adv5(u); };
    assert.equal(await assertAdvertised(next5, noClient5), "client-hash-from-reviewed-evidence");
    await assert.rejects(assertAdvertised(next5, adv5), /REPIN_CLIENT_HASH_MISMATCH/, "served bytes must still hash to the pin"); }
  { // Nov 23 2026 repin evidence: engine 1560caea, params unchanged (3491bd26).
    const E6 = "1560caead346fe3d66d0ce1a796c273c069dd7e6cdbcc73200428ed5f58997e5", P6 = "3491bd2694213e2cdd092f3b0e3e4053e3c4634ba3e531f6a175e9cac67d1623";
    const next6 = { POA_ESCROW_ENGINE_SHA256: E6, POA_ESCROW_PARAMS_SHA256: P6 }, adv6 = network({ chain_id: "poa-mainnet-1", engine_sha256: E6, params_sha256: P6 });
    const noClient6 = async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return adv6(u); };
    assert.equal(await assertAdvertised(next6, noClient6), "client-hash-from-reviewed-evidence");
    await assert.rejects(assertAdvertised(next6, adv6), /REPIN_CLIENT_HASH_MISMATCH/, "served bytes must still hash to the pin"); }
  { // Nov 23 2026 repin: engine a5feae08 unchanged, params 3491bd26 (adds att_log_from_epoch).
    const E6 = "a5feae08cbd1fabf38f15637ca113a03ffa2b5b9ce3107dca7cbc84cb8c229a2", P6 = "3491bd2694213e2cdd092f3b0e3e4053e3c4634ba3e531f6a175e9cac67d1623";
    const next6 = { POA_ESCROW_ENGINE_SHA256: E6, POA_ESCROW_PARAMS_SHA256: P6 }, adv6 = network({ chain_id: "poa-mainnet-1", engine_sha256: E6, params_sha256: P6 });
    const noClient6 = async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return adv6(u); };
    assert.equal(await assertAdvertised(next6, noClient6), "client-hash-from-reviewed-evidence"); }
  { // Nov 23 2026 repin evidence: engine d6c58f54, params 34345309 (v0.130-f2c).
    const E7 = "d6c58f54d698965bc7473403e417bb2963a0e4d1b9fc04099164317cce3f2cfe", P7 = "34345309000008c583a918944472a337928d043ffc299152285ee962a4f78cd1";
    const next7 = { POA_ESCROW_ENGINE_SHA256: E7, POA_ESCROW_PARAMS_SHA256: P7 }, adv7 = network({ chain_id: "poa-mainnet-1", engine_sha256: E7, params_sha256: P7 });
    const noClient7 = async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return adv7(u); };
    assert.equal(await assertAdvertised(next7, noClient7), "client-hash-from-reviewed-evidence");
    await assert.rejects(assertAdvertised(next7, adv7), /REPIN_CLIENT_HASH_MISMATCH/, "served bytes must still hash to the pin"); }
  { // Nov 23 2026 repin evidence: engine ba3d0902, params unchanged (34345309, v0.131-cows-bm).
    const E8 = "ba3d09028751868abe095249e0dc29dc7bf8444fffbba81355314b8f73b80339", P8 = "34345309000008c583a918944472a337928d043ffc299152285ee962a4f78cd1";
    const next8 = { POA_ESCROW_ENGINE_SHA256: E8, POA_ESCROW_PARAMS_SHA256: P8 }, adv8 = network({ chain_id: "poa-mainnet-1", engine_sha256: E8, params_sha256: P8 });
    const noClient8 = async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return adv8(u); };
    assert.equal(await assertAdvertised(next8, noClient8), "client-hash-from-reviewed-evidence");
    await assert.rejects(assertAdvertised(next8, adv8), /REPIN_CLIENT_HASH_MISMATCH/, "served bytes must still hash to the pin"); }
  { // Nov 24 2026 repin evidence: engine 46e9c868, params 347fba7f (v0.132-s5a-f2-e123).
    const E9 = "46e9c86827563268cad6a40ddb3f646f0ad17d06fb2857c9c4c19058b8579a19", P9 = "347fba7fc7a2c9a8a93c235d1645e4a98327456d8ba56afa2a94ae1fa26f9826";
    const next9 = { POA_ESCROW_ENGINE_SHA256: E9, POA_ESCROW_PARAMS_SHA256: P9 }, adv9 = network({ chain_id: "poa-mainnet-1", engine_sha256: E9, params_sha256: P9 });
    const noClient9 = async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return adv9(u); };
    assert.equal(await assertAdvertised(next9, noClient9), "client-hash-from-reviewed-evidence");
    await assert.rejects(assertAdvertised(next9, adv9), /REPIN_CLIENT_HASH_MISMATCH/, "served bytes must still hash to the pin"); }
  { // Nov 24 2026 repin evidence: engine a221f58a, params 8274922e (v0.133-t1-k124).
    const E10 = "a221f58ad128b804a0e6e0e1882685dc136cfe9536f2f9a955722578675cdc25", P10 = "8274922eacea7ff7dc301e85f9dfbf74d1419a1868eda2b8a9303f16aa4ca99d";
    const next10 = { POA_ESCROW_ENGINE_SHA256: E10, POA_ESCROW_PARAMS_SHA256: P10 }, adv10 = network({ chain_id: "poa-mainnet-1", engine_sha256: E10, params_sha256: P10 });
    const noClient10 = async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return adv10(u); };
    assert.equal(await assertAdvertised(next10, noClient10), "client-hash-from-reviewed-evidence");
    await assert.rejects(assertAdvertised(next10, adv10), /REPIN_CLIENT_HASH_MISMATCH/, "served bytes must still hash to the pin"); }
  { // Nov 25 2026 repin evidence: engine 50464775, params 806fc3a0 (release manifest had not yet advertised a new version).
    const E11 = "50464775560a94f49bbe4dae92b932c8fa7cf2c9239f2abdd31020d24c107511", P11 = "806fc3a0303e42a19a11d44be036739142d9c06dc9280e505c8815084eed1fd5";
    const next11 = { POA_ESCROW_ENGINE_SHA256: E11, POA_ESCROW_PARAMS_SHA256: P11 }, adv11 = network({ chain_id: "poa-mainnet-1", engine_sha256: E11, params_sha256: P11 });
    const noClient11 = async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return adv11(u); };
    assert.equal(await assertAdvertised(next11, noClient11), "client-hash-from-reviewed-evidence");
    await assert.rejects(assertAdvertised(next11, adv11), /REPIN_CLIENT_HASH_MISMATCH/, "served bytes must still hash to the pin"); }
  await assert.rejects(assertAdvertised(pins, network({ chain_id: "poa-mainnet-1", engine_sha256: engine, params_sha256: "c".repeat(64) })), /REPIN_NOT_ADVERTISED/);
  await assert.rejects(assertAdvertised(pins, network({ chain_id: "poa-mainnet-1", engine_sha256: engine, params_sha256: params }, new TextEncoder().encode("truncated"))), /REPIN_CLIENT_HASH_MISMATCH/);
  // Full deploy: precheck old pins, deploy plan carries ONLY the two new pin vars, post-check sees new pins.
  let deployed = false; const plans = [];
  const newBindings = bindings.map(b => b.name in pins ? { ...b, text: pins[b.name] } : b);
  const p = provider(); const upstream = network({ chain_id: "poa-mainnet-1", engine_sha256: engine, params_sha256: params });
  const fetchImpl = async (url, o) => {
    if (url === NETWORK_FACTS || url === NETWORK_CLIENT) return upstream(url);
    const r = await p.fetchImpl(url, o);
    if (!deployed || !(url.endsWith("/settings") || url.includes("/versions/"))) return r;
    const body = await r.json(); if (body.result.bindings) body.result.bindings = newBindings; else body.result.resources.bindings = newBindings;
    return { ok: true, json: async () => body };
  };
  const run = (_exe, args) => { const plan = JSON.parse(readFileSync(args[args.indexOf("--config") + 1], "utf8"));
    plans.push(Object.keys(plan.vars).filter(k => k.startsWith("POA_ESCROW_")).sort()); if (!args.includes("--dry-run")) deployed = true; return { status: 0 }; };
  const repinEnv = { ...env, POA_ESCROW_REPIN_ENGINE_SHA256: engine, POA_ESCROW_REPIN_PARAMS_SHA256: params, DEPLOY_POSTCHECK_DELAY_MS: "0" };
  await runDeployment({ dryRun: false, env: repinEnv, fetchImpl, run });
  assert.deepEqual(plans, [["POA_ESCROW_ENGINE_SHA256", "POA_ESCROW_PARAMS_SHA256"], ["POA_ESCROW_ENGINE_SHA256", "POA_ESCROW_PARAMS_SHA256"]]);
  // A deploy whose live version did not take the new pins fails its post-check (operator then rolls back).
  deployed = false; let real = 0;
  await assert.rejects(runDeployment({ dryRun: false, env: repinEnv, fetchImpl: async (u, o) => (u === NETWORK_FACTS || u === NETWORK_CLIENT) ? upstream(u) : p.fetchImpl(u, o),
    run: (_e, args) => { if (!args.includes("--dry-run")) real++; return { status: 0 }; } }), /LIVE_POLICY_MISMATCH/);
  assert.equal(real, 1);
  // Not advertised => no deployment at all.
  real = 0;
  await assert.rejects(runDeployment({ dryRun: false, env: { ...repinEnv, POA_ESCROW_REPIN_PARAMS_SHA256: "d".repeat(64) }, fetchImpl, run: (_e, args) => { if (!args.includes("--dry-run")) real++; return { status: 0 }; } }), /REPIN_NOT_ADVERTISED/);
  assert.equal(real, 0);
});

test("subname switch (Max t140s1306): off unless approved-v1; written once when turned on; never silently kept or dropped", async () => {
  assert.deepEqual(OPTIONAL_SWITCHES, ["POA_ESCROW_SUBNAMES"]);
  assert.equal(config.vars.POA_ESCROW_SUBNAMES, "false", "committed default stays off");
  assert.ok(!Object.keys(productionConfig(config).vars).some(k => k.startsWith("POA_ESCROW_")), "deploy plan never sends the committed default");
  assert.deepEqual(expectedSwitches({}), { POA_ESCROW_SUBNAMES: null });
  assert.deepEqual(expectedSwitches({ POA_ESCROW_SUBNAMES: "approved-v1" }), { POA_ESCROW_SUBNAMES: "approved-v1" });
  for (const bad of ["true", "false", "on", "approved-v2"]) assert.throws(() => expectedSwitches({ POA_ESCROW_SUBNAMES: bad }), /INVALID_PRODUCTION_SWITCH/);
  const on = { POA_ESCROW_SUBNAMES: "approved-v1" }, off = { POA_ESCROW_SUBNAMES: null };
  const live = [...bindings, { name: "POA_ESCROW_SUBNAMES", type: "plain_text", text: "approved-v1" }];
  assert.deepEqual(switchesPlan(on, bindings), on); assert.equal(switchesPlan(on, live), null); assert.equal(switchesPlan(off, bindings), null);
  assertBindings(live, expected); assert.throws(() => assertBindings([...bindings, { name: "POA_ESCROW_OTHER", type: "plain_text", text: "x" }], expected), /UNREVIEWED_ESCROW_BINDING/);
  assertSwitches(bindings, off); assertSwitches(live, on); assertSwitches(bindings, on, { allowMissingOn: true });
  assert.throws(() => assertSwitches(bindings, on), /LIVE_SWITCH_MISMATCH/, "post-check needs the switch live");
  assert.throws(() => assertSwitches(live, off), /LIVE_SWITCH_MISMATCH/, "a live switch without the environment value is refused");
  assert.throws(() => assertSwitches(live.map(b => b.name === "POA_ESCROW_SUBNAMES" ? { ...b, text: "true" } : b), on), /LIVE_SWITCH_MISMATCH/);
  // Default deploy (switch unset): no escrow overrides, exactly as before.
  const plans = [];
  const run = (_exe, args) => { const plan = JSON.parse(readFileSync(args[args.indexOf("--config") + 1], "utf8"));
    plans.push(Object.keys(plan.vars).filter(k => k.startsWith("POA_ESCROW_")).sort()); if (!args.includes("--dry-run")) deployed = true; return { status: 0 }; };
  let deployed = false;
  await runDeployment({ dryRun: false, env: { ...env, DEPLOY_POSTCHECK_DELAY_MS: "0" }, fetchImpl: provider().fetchImpl, run });
  assert.deepEqual(plans, [[], []]);
  // Turned on: the plan writes only the switch, and the post-check sees it live.
  plans.length = 0; deployed = false;
  const p = provider();
  const fetchImpl = async (url, o) => {
    const r = await p.fetchImpl(url, o);
    if (!deployed || !(url.endsWith("/settings") || url.includes("/versions/"))) return r;
    const body = await r.json(); if (body.result.bindings) body.result.bindings = live; else body.result.resources.bindings = live;
    return { ok: true, json: async () => body };
  };
  await runDeployment({ dryRun: false, env: { ...env, ...on, DEPLOY_POSTCHECK_DELAY_MS: "0" }, fetchImpl, run });
  assert.deepEqual(plans, [["POA_ESCROW_SUBNAMES"], ["POA_ESCROW_SUBNAMES"]]);
  // Live has it but the environment does not: refused before any deploy.
  plans.length = 0;
  const q = provider({ "/settings": { success: true, result: { bindings: live } }, [`/versions/${version}`]: { success: true, result: { id: version, resources: { bindings: live } } } });
  await assert.rejects(runDeployment({ dryRun: false, env: { ...env, DEPLOY_POSTCHECK_DELAY_MS: "0" }, fetchImpl: q.fetchImpl, run }), /LIVE_SWITCH_MISMATCH/);
  assert.deepEqual(plans, []);
});

test("compat self-verified evidence, automatic pin sync from wrangler.jsonc, and live ESCROW_PROTOCOL_CHANGED post-check", async () => {
  const { createHash } = await import("node:crypto");
  const dir = mkdtempSync(join(tmpdir(), "poa-deploy-compat-"));
  try {
    const client = new TextEncoder().encode("new verified client bytes");
    const newEngine = createHash("sha256").update(client).digest("hex");
    const newParams = "e".repeat(64);
    assert.equal(hasReviewedClientEvidence(newEngine, dir), false);
    mkdirSync(join(dir, ".poa-compat"), { recursive: true });
    writeFileSync(join(dir, ".poa-compat/evidence.json"), "not json");
    assert.equal(hasReviewedClientEvidence(newEngine, dir), false);
    // Reject mismatched client/engine or breaking surface or foreign source.
    writeFileSync(join(dir, ".poa-compat/evidence.json"), JSON.stringify({ entries: [
      { to: { engine: newEngine, client: "0".repeat(64), clientSize: 25 }, sources: { facts: NETWORK_FACTS, client: NETWORK_CLIENT }, surface: { counts: { breaking: 0 } } },
      { to: { engine: newEngine, client: newEngine, clientSize: 25 }, sources: { facts: NETWORK_FACTS, client: NETWORK_CLIENT }, surface: { counts: { breaking: 1 } } },
      { to: { engine: newEngine, client: newEngine, clientSize: 25 }, sources: { facts: "https://evil.example/facts", client: NETWORK_CLIENT }, surface: { counts: { breaking: 0 } } },
    ] }));
    assert.equal(hasReviewedClientEvidence(newEngine, dir), false);
    // Accept valid self-verified evidence entry.
    writeFileSync(join(dir, ".poa-compat/evidence.json"), JSON.stringify({ entries: [
      { to: { engine: newEngine, client: newEngine, clientSize: client.length }, sources: { facts: NETWORK_FACTS, client: NETWORK_CLIENT }, surface: { counts: { breaking: 0 } } },
    ] }));
    assert.equal(hasReviewedClientEvidence(newEngine, dir), true);
    const slow = async u => {
      if (u === NETWORK_FACTS) return { ok: true, json: async () => ({ chain_id: "poa-mainnet-1", engine_sha256: newEngine, params_sha256: newParams }) };
      throw new DOMException("slow", "TimeoutError");
    };
    assert.equal(await assertAdvertised({ POA_ESCROW_ENGINE_SHA256: newEngine, POA_ESCROW_PARAMS_SHA256: newParams }, slow, dir), "client-hash-from-reviewed-evidence");

    // committedPins validation + automatic repin from wrangler.jsonc without POA_ESCROW_REPIN_*.
    assert.throws(() => committedPins({ vars: { POA_ESCROW_ENGINE_SHA256: "bad", POA_ESCROW_PARAMS_SHA256: newParams } }), /INVALID_COMMITTED_PIN/);
    const updatedConfig = structuredClone(config);
    updatedConfig.vars.POA_ESCROW_ENGINE_SHA256 = newEngine;
    updatedConfig.vars.POA_ESCROW_PARAMS_SHA256 = newParams;
    writeFileSync(join(dir, "wrangler.jsonc"), JSON.stringify(updatedConfig, null, 2));
    const trans = resolvePinTransition(env, expected, updatedConfig, bindings, dir);
    assert.deepEqual(trans.repin, { POA_ESCROW_ENGINE_SHA256: newEngine, POA_ESCROW_PARAMS_SHA256: newParams });
    // Unreviewed/tampered live pin is rejected.
    const badBindings = bindings.map(b => b.name === "POA_ESCROW_ENGINE_SHA256" ? { ...b, text: "f".repeat(64) } : b);
    assert.throws(() => assertBindings(badBindings, resolvePinTransition(env, expected, updatedConfig, badBindings, dir).preExpected), /LIVE_POLICY_MISMATCH/);

    // Full automatic deploy with wrangler.jsonc pins ahead of live bindings: writes only the 2 pins and checks live freshness.
    let deployed = false; const plans = [];
    const newBindings = bindings.map(b => b.name === "POA_ESCROW_ENGINE_SHA256" ? { ...b, text: newEngine } : b.name === "POA_ESCROW_PARAMS_SHA256" ? { ...b, text: newParams } : b);
    const p = provider();
    const fetchImpl = async (url, o) => {
      if (url === NETWORK_FACTS) return { ok: true, json: async () => ({ chain_id: "poa-mainnet-1", engine_sha256: newEngine, params_sha256: newParams }) };
      if (url === NETWORK_CLIENT) return { ok: true, arrayBuffer: async () => client.buffer.slice(0) };
      const r = await p.fetchImpl(url, o);
      if (!deployed || !(url.endsWith("/settings") || url.includes("/versions/"))) return r;
      const body = await r.json(); if (body.result.bindings) body.result.bindings = newBindings; else body.result.resources.bindings = newBindings;
      return { ok: true, json: async () => body };
    };
    const run = (_exe, args) => { const plan = JSON.parse(readFileSync(args[args.indexOf("--config") + 1], "utf8"));
      plans.push(Object.keys(plan.vars).filter(k => k.startsWith("POA_ESCROW_")).sort()); if (!args.includes("--dry-run")) deployed = true; return { status: 0 }; };
    await runDeployment({ dryRun: false, env: { ...env, DEPLOY_POSTCHECK_DELAY_MS: "0" }, fetchImpl, run, root: dir });
    assert.deepEqual(plans, [["POA_ESCROW_ENGINE_SHA256", "POA_ESCROW_PARAMS_SHA256"], ["POA_ESCROW_ENGINE_SHA256", "POA_ESCROW_PARAMS_SHA256"]]);

    // Subsequent deploy when live already matches wrangler.jsonc (even if GitHub env vars still have old pins): no repin, succeeds.
    plans.length = 0; deployed = false;
    const syncedP = provider({
      "/settings": { success: true, result: { bindings: newBindings } },
      [`/versions/${version}`]: { success: true, result: { id: version, resources: { bindings: newBindings } } },
    });
    await runDeployment({ dryRun: false, env: { ...env, DEPLOY_POSTCHECK_DELAY_MS: "0" }, fetchImpl: syncedP.fetchImpl, run, root: dir });
    assert.deepEqual(plans, [[], []]);

    // Post-deploy check fails when live escrow reports ESCROW_PROTOCOL_CHANGED, HTTP error, or network error.
    await assert.rejects(assertLiveEscrowFresh("https://poadomains.grok.me", async () => ({ ok: true, json: async () => ({ freshness: { code: "ESCROW_PROTOCOL_CHANGED" } }) }), 0), /ESCROW_PROTOCOL_CHANGED/);
    await assert.rejects(assertLiveEscrowFresh("https://poadomains.grok.me", async () => ({ ok: false, status: 502 }), 0), /ESCROW_CAPABILITIES_HTTP_ERROR/);
    await assert.rejects(assertLiveEscrowFresh("https://poadomains.grok.me", async () => { throw new Error("down"); }, 0), /ESCROW_CAPABILITIES_UNAVAILABLE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
