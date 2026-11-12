import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";
import { endpoint } from "../dist/src/client.js";
import { ACCOUNT, WORKER, REPO, ADDRESS, POLICY, parseConfig, productionConfig, expectedPolicy,
  assertBindings, assertProductionEnvironment, assertGitHub, liveSnapshot, wranglerArgs, runDeployment, repinPlan, assertAdvertised, NETWORK_FACTS, NETWORK_CLIENT } from "../scripts/worker-deploy.mjs";
const config = parseConfig(readFileSync("wrangler.jsonc", "utf8"));
const expected = { ...Object.fromEntries(POLICY.map(k => [k, config.vars[k]])),
  POA_ESCROW_ENABLED: "true", POA_ESCROW_NETWORK_WRITES: "approved-v1", POA_ESCROW_ADDRESS: ADDRESS };
const bindings = [...POLICY.map(name => ({ name, type: "plain_text", text: expected[name] })),
  ...["POA_ESCROW_KEY", "ESCROW_ADMIN_TOKEN"].map(name => ({ name, type: "secret_text" }))];
const sha = "a".repeat(40), version = "46459dd0-989d-46dc-ad79-c8b24a867595";
const environment = { name: "production", can_admins_bypass: false, deployment_branch_policy: { protected_branches: true },
  protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { id: 15719015, login: "maximusmaximus" } }] }] };
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
    ...overrides,
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url); assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    assert.ok(url.startsWith(`https://api.github.com/repos/${REPO}/`) ||
      url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${WORKER}/`));
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
    ["POA_ESCROW_ADDRESS", "different"], ["POA_ESCROW_PER_TX", "0"], ["POA_ESCROW_ENGINE_SHA256", "not-a-pin"]])
    assert.throws(() => expectedPolicy({ ...expected, [key]: value }));
  assert.throws(() => assertBindings(undefined, expected), /MISSING_LIVE_BINDINGS/);
  assert.throws(() => assertBindings([...bindings, bindings[0]], expected), /DUPLICATE_LIVE_BINDING/);
  assert.throws(() => assertBindings([...bindings, { name: "POA_ESCROW_NEW_SETTING" }], expected), /UNREVIEWED_ESCROW_BINDING/);
  assert.throws(() => assertBindings(bindings.filter(b => b.name !== "POA_ESCROW_KEY"), expected), /MISSING_LIVE_SECRET_BINDING/);
});

test("Max is the sole required reviewer; admin bypass, absent gate or stale/failed/foreign main refuse deployment", async () => {
  assertProductionEnvironment(environment);
  for (const change of [{ can_admins_bypass: true }, { protection_rules: [] }, { deployment_branch_policy: null }])
    assert.throws(() => assertProductionEnvironment({ ...environment, ...change }), /PRODUCTION_REQUIRES_MAX_REVIEW/);
  const extra = structuredClone(environment); extra.protection_rules[0].reviewers.push({ type: "User", reviewer: { login: "other" } });
  assert.throws(() => assertProductionEnvironment(extra), /PRODUCTION_REQUIRES_MAX_REVIEW/);
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
  await runDeployment({ dryRun: false, env, fetchImpl: provider().fetchImpl, run });
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
  { let n = 0; const flaky = network({ chain_id: "poa-mainnet-1", engine_sha256: engine, params_sha256: params });
    await assertAdvertised(pins, async u => { if (u === NETWORK_CLIENT && ++n < 3) throw new DOMException("slow", "TimeoutError"); return flaky(u); }); assert.equal(n, 3);
    await assert.rejects(assertAdvertised(pins, async u => { if (u === NETWORK_CLIENT) throw new DOMException("slow", "TimeoutError"); return flaky(u); }), /REPIN_CLIENT_UNAVAILABLE/); }
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
