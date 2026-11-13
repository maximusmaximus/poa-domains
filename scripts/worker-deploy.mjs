// Production deployment plumbing only: never read/write a PoA key or call escrow admin routes.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parse } from "jsonc-parser";

export const ACCOUNT = "b1c96174cb665cac086ca06434ded1f2";
export const WORKER = "poadomains-registry";
export const REPO = "maximusmaximus/poa-domains";
export const ADDRESS = "poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf";
export const POLICY = ["POA_ESCROW_ENABLED", "POA_ESCROW_NETWORK_WRITES", "POA_ESCROW_NEW_NAMES", "POA_ESCROW_ADDRESS",
  "POA_ESCROW_PER_TX", "POA_ESCROW_DAILY", "POA_ESCROW_ENGINE_SHA256", "POA_ESCROW_PARAMS_SHA256"];
const fail = code => { throw Error(code); };
export function parseConfig(source) {
  const errors = [];
  const config = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== "object" || Array.isArray(config)) fail("INVALID_WRANGLER_JSONC");
  return config;
}
export function productionConfig(config) {
  assert.equal(config.name, WORKER); assert.equal(config.account_id, ACCOUNT);
  assert.equal(config.main, "cloudflare/worker.ts"); assert.equal(config.env, undefined);
  assert.deepEqual(config.durable_objects.bindings, [{ name: "REGISTRY", class_name: "PoaRegistry" }]);
  assert.deepEqual(config.migrations, [{ tag: "v1-sqlite", new_sqlite_classes: ["PoaRegistry"] }]);
  assert.equal(config.vars.POA_ESCROW_ENABLED, "false");
  assert.equal(config.vars.POA_ESCROW_NETWORK_WRITES, "false");
  assert.equal(config.vars.POA_ESCROW_NEW_NAMES, "false");
  // --keep-vars becomes API keep_bindings:[plain_text,json]. Omitting ALL escrow vars
  // means the server retains them, rather than re-writing an earlier observed value.
  // Secrets are retained by Wrangler's normal deployment; no secret value is fetched.
  return { ...structuredClone(config), keep_vars: true,
    vars: Object.fromEntries(Object.entries(config.vars).filter(([key]) => !key.startsWith("POA_ESCROW_"))) };
}
export function expectedPolicy(env) {
  const policy = Object.fromEntries(POLICY.map(key => {
    if (!env[key]) fail("MISSING_PRODUCTION_POLICY:" + key);
    return [key, env[key]];
  }));
  if (policy.POA_ESCROW_ENABLED !== "true" || policy.POA_ESCROW_NETWORK_WRITES !== "approved-v1" ||
      policy.POA_ESCROW_NEW_NAMES !== "approved-v1" || policy.POA_ESCROW_ADDRESS !== ADDRESS)
    fail("UNSAFE_PRODUCTION_POLICY");
  for (const key of ["POA_ESCROW_PER_TX", "POA_ESCROW_DAILY"])
    if (!/^[1-9][0-9]*\.[0-9]{6}$/.test(policy[key])) fail("INVALID_PRODUCTION_LIMIT");
  for (const key of ["POA_ESCROW_ENGINE_SHA256", "POA_ESCROW_PARAMS_SHA256"])
    if (!/^[0-9a-f]{64}$/.test(policy[key])) fail("INVALID_PRODUCTION_PIN");
  return policy;
}
export const NETWORK_FACTS = "https://minepoa.com/chain/poa-mainnet-1/api/network-facts";
export const NETWORK_CLIENT = "https://minepoa.com/chain/poa-mainnet-1/client/poa.mjs";
// Max-approved pin transition (t108s1102). Both repin vars set => this deploy writes ONLY the two
// pin bindings; every other escrow binding and secret is kept server-side by --keep-vars.
export function repinPlan(env, expected) {
  const engine = env.POA_ESCROW_REPIN_ENGINE_SHA256 || "", params = env.POA_ESCROW_REPIN_PARAMS_SHA256 || "";
  if (!engine && !params) return null;
  if (!/^[0-9a-f]{64}$/.test(engine) || !/^[0-9a-f]{64}$/.test(params)) fail("INVALID_REPIN");
  if (expected && engine === expected.POA_ESCROW_ENGINE_SHA256 && params === expected.POA_ESCROW_PARAMS_SHA256) fail("REPIN_NOOP");
  return { POA_ESCROW_ENGINE_SHA256: engine, POA_ESCROW_PARAMS_SHA256: params };
}
// Max-approved POA new-name checkout (t136u, 3:20 PM PT Nov 13 2026). Write the binding only
// when live does not yet have it; --keep-vars then preserves it on later deploys. A wrong live
// value is refused by the exact precheck, not overwritten here.
export function checkoutPlan(expected, liveBindings) {
  if (expected.POA_ESCROW_NEW_NAMES !== "approved-v1") fail("UNSAFE_PRODUCTION_POLICY");
  if (!Array.isArray(liveBindings)) fail("MISSING_LIVE_BINDINGS");
  return liveBindings.some(b => b.name === "POA_ESCROW_NEW_NAMES") ? null : { POA_ESCROW_NEW_NAMES: "approved-v1" };
}
// Refuse a repin unless the official network advertises exactly these pins AND the served client hashes to the engine pin.
// Full 381,139-byte download of client/poa.mjs (Last-Modified 2026-11-12T02:30:51Z) hashed on the box
// at ~7:16 PM PST Nov 11 2026; recorded in PR #73.
export const REPIN_CLIENT_EVIDENCE = Object.freeze({ "e01abd959dd0439dd89af8e8c187d1bed3897deb2a855a615e7dfa2d0222f1fb": true });
export async function assertAdvertised(pins, fetchImpl) {
  // minepoa.com serves the ~380 KB client slowly (20-60 s seen on Nov 11). Bound each whole read
  // (headers + body) and retry; any failure still fails closed before anything is deployed.
  const read = async (url, body) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(90000) });
        if (!r.ok) throw Error("HTTP");
        return await body(r);
      } catch (e) { if (attempt >= (url === NETWORK_CLIENT ? 1 : 3)) return null; }
    }
  };
  const f = await read(NETWORK_FACTS, r => r.json());
  if (!f) fail("REPIN_FACTS_UNAVAILABLE");
  if (f.chain_id !== "poa-mainnet-1" || f.engine_sha256 !== pins.POA_ESCROW_ENGINE_SHA256 ||
      f.params_sha256 !== pins.POA_ESCROW_PARAMS_SHA256) fail("REPIN_NOT_ADVERTISED");
  const bytes = await read(NETWORK_CLIENT, r => r.arrayBuffer());
  if (bytes) {
    const digest = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
    if (digest !== pins.POA_ESCROW_ENGINE_SHA256) fail("REPIN_CLIENT_HASH_MISMATCH");
    return "client-hash-verified";
  }
  // GitHub runners could not download the client in 3x120 s (runs 43148501656, 43149822257). Accept only
  // a reviewed, committed full-download hash for exactly this engine pin; any other pin still fails closed.
  if (REPIN_CLIENT_EVIDENCE[pins.POA_ESCROW_ENGINE_SHA256] !== true) fail("REPIN_CLIENT_UNAVAILABLE");
  return "client-hash-from-reviewed-evidence";
}
export function assertBindings(bindings, expected, options = {}) {
  if (!Array.isArray(bindings)) fail("MISSING_LIVE_BINDINGS");
  const allowMissing = options.allowMissing ?? [];
  const map = new Map();
  for (const b of bindings) {
    if (map.has(b.name)) fail("DUPLICATE_LIVE_BINDING");
    map.set(b.name, b);
    if (b.name?.startsWith("POA_ESCROW_") && !POLICY.includes(b.name) && b.name !== "POA_ESCROW_KEY")
      fail("UNREVIEWED_ESCROW_BINDING");
  }
  for (const key of POLICY) {
    const binding = map.get(key);
    if (!binding && allowMissing.includes(key)) continue;
    if (binding?.type !== "plain_text" || binding.text !== expected[key]) fail("LIVE_POLICY_MISMATCH:" + key);
  }
  for (const key of ["POA_ESCROW_KEY", "ESCROW_ADMIN_TOKEN"])
    if (map.get(key)?.type !== "secret_text") fail("MISSING_LIVE_SECRET_BINDING");
}
export function assertProductionEnvironment(data) {
  const reviewers = data.protection_rules?.find(rule => rule.type === "required_reviewers")?.reviewers;
  if (data.name !== "production" || data.can_admins_bypass !== false || reviewers?.length !== 1 ||
      reviewers[0].type !== "User" || reviewers[0].reviewer?.id !== 15719015 ||
      reviewers[0].reviewer?.login !== "maximusmaximus" || data.deployment_branch_policy?.protected_branches !== true)
    fail("PRODUCTION_REQUIRES_MAX_REVIEW");
}
async function get(url, token, fetchImpl) {
  const response = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!response.ok) fail("READ_ONLY_PREFLIGHT_HTTP_ERROR");
  return response.json(); // Never print provider responses, credentials or secret values.
}
export async function assertGitHub(env, fetchImpl) {
  if (env.WORKER_DEPLOY_ENABLED !== "true" || env.GITHUB_ACTIONS !== "true" ||
      env.GITHUB_EVENT_NAME !== "workflow_run" || env.GITHUB_REPOSITORY !== REPO ||
      !/^[0-9a-f]{40}$/.test(env.DEPLOY_SHA ?? "") || !/^\d+$/.test(env.CI_RUN_ID ?? "") ||
      !env.GITHUB_TOKEN) fail("DEPLOY_REQUIRES_APPROVED_MAIN_WORKFLOW");
  const base = `https://api.github.com/repos/${REPO}`;
  const [environment, main, run] = await Promise.all([
    get(`${base}/environments/production`, env.GITHUB_TOKEN, fetchImpl),
    get(`${base}/git/ref/heads/main`, env.GITHUB_TOKEN, fetchImpl),
    get(`${base}/actions/runs/${env.CI_RUN_ID}`, env.GITHUB_TOKEN, fetchImpl),
  ]);
  assertProductionEnvironment(environment);
  if (main.object?.sha !== env.DEPLOY_SHA || run.head_sha !== env.DEPLOY_SHA || run.event !== "push" ||
      run.head_branch !== "main" || run.name !== "native-and-reference-checks" ||
      run.repository?.full_name !== REPO || run.status !== "completed" || run.conclusion !== "success")
    fail("DEPLOY_REQUIRES_CURRENT_GREEN_MAIN");
}
export async function inspectLive(token, fetchImpl) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${WORKER}`;
  const cf = async path => {
    const response = await get(base + path, token, fetchImpl);
    if (response.success !== true || !response.result) fail("CLOUDFLARE_PREFLIGHT_FAILED");
    return response.result;
  };
  const [deployments, settings] = await Promise.all([cf("/deployments"), cf("/settings")]);
  const active = deployments.deployments?.[0];
  if (!active?.id || active.versions?.length !== 1 || active.versions[0].percentage !== 100 ||
      !/^[0-9a-f-]{36}$/.test(active.versions[0].version_id)) fail("AMBIGUOUS_LIVE_VERSION");
  const version = await cf(`/versions/${active.versions[0].version_id}`);
  if (version.id !== active.versions[0].version_id) fail("LIVE_VERSION_MISMATCH");
  return { id: `${active.id}:${version.id}`, bindings: settings.bindings, versionBindings: version.resources?.bindings };
}
export async function liveSnapshot(expected, token, fetchImpl, options) {
  const live = await inspectLive(token, fetchImpl);
  assertBindings(live.bindings, expected, options); assertBindings(live.versionBindings, expected, options);
  return live.id;
}
export function wranglerArgs(configPath, dryRun) {
  return ["node_modules/wrangler/bin/wrangler.js", "deploy", "--config", configPath, "--keep-vars", "--strict",
    ...(dryRun ? ["--dry-run", "--outdir", "./.deploy-dry-run"] : [])];
}
export async function runDeployment({ dryRun, env = process.env, fetchImpl = fetch, run = spawnSync, root = process.cwd() }) {
  const config = productionConfig(parseConfig(readFileSync(resolve(root, "wrangler.jsonc"), "utf8")));
  let expected, before, repin = null;
  if (!dryRun) {
    expected = expectedPolicy(env);
    repin = repinPlan(env, expected);
    if (!env.CLOUDFLARE_API_TOKEN) fail("MISSING_CLOUDFLARE_API_TOKEN");
    await assertGitHub(env, fetchImpl);
    const pre = await inspectLive(env.CLOUDFLARE_API_TOKEN, fetchImpl);
    // Precheck keeps current policy exact, but allows the checkout binding to be absent so this
    // deploy can introduce POA_ESCROW_NEW_NAMES=approved-v1. A wrong present value still fails.
    assertBindings(pre.bindings, expected, { allowMissing: ["POA_ESCROW_NEW_NAMES"] });
    assertBindings(pre.versionBindings, expected, { allowMissing: ["POA_ESCROW_NEW_NAMES"] });
    before = pre.id;
    const checkout = checkoutPlan(expected, pre.bindings);
    if (checkout) config.vars = { ...config.vars, ...checkout };
    if (repin) { console.log("REPIN advertised by network-facts; " + await assertAdvertised(repin, fetchImpl)); config.vars = { ...config.vars, ...repin }; }
  }
  const path = resolve(root, `.wrangler-production-${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  try {
    const childEnv = { ...env, WRANGLER_SEND_METRICS: "false" };
    // No PoA private key, policy override, GitHub token, or named Wrangler environment
    // can leak into the child. GitHub environment production is NOT Wrangler --env.
    for (const key of Object.keys(childEnv))
      if (key.startsWith("POA_ESCROW_") || ["GITHUB_TOKEN", "WRANGLER_ENV"].includes(key)) delete childEnv[key];
    const execute = isDry => {
      const result = run(process.execPath, wranglerArgs(path, isDry), { cwd: root, env: childEnv, stdio: "inherit" });
      if (result.error || result.status !== 0) fail("WRANGLER_COMMAND_FAILED");
    };
    execute(true);
    if (!dryRun) {
      // Approval applies to this exact green SHA. Refuse drift during the local dry-run.
      await assertGitHub(env, fetchImpl);
      if (await liveSnapshot(expected, env.CLOUDFLARE_API_TOKEN, fetchImpl, { allowMissing: ["POA_ESCROW_NEW_NAMES"] }) !== before) fail("LIVE_VERSION_CHANGED");
      execute(false);
      // Post-check: the new live version carries exactly the expected policy (new pins after a repin).
      const after = { ...expected, ...(repin ?? {}) };
      for (let attempt = 1; ; attempt++) {
        try { await liveSnapshot(after, env.CLOUDFLARE_API_TOKEN, fetchImpl); break; }
        catch (e) { if (attempt >= 6) throw e; await new Promise(r => setTimeout(r, env.DEPLOY_POSTCHECK_DELAY_MS === "0" ? 0 : 5000)); }
      }
    }
  } finally { unlinkSync(path); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !["--dry-run", "--deploy"].includes(mode)) fail("USE_DRY_RUN_OR_DEPLOY");
  await runDeployment({ dryRun: mode === "--dry-run" });
}
