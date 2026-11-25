// Production deployment plumbing only: never read/write a PoA key or call escrow admin routes.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
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
// Optional reviewed escrow switches: absent means OFF. When present live, the value must equal the
// production environment variable exactly, so a later deploy never silently keeps or drops it.
export const OPTIONAL_SWITCHES = ["POA_ESCROW_SUBNAMES"];
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
  assert.equal(config.vars.POA_ESCROW_SUBNAMES, "false");
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
/** Optional switches from the production environment: unset => OFF; the only ON value is approved-v1. */
export function expectedSwitches(env) {
  return Object.fromEntries(OPTIONAL_SWITCHES.map(key => {
    const v = env[key] ?? "";
    if (v !== "" && v !== "approved-v1") fail("INVALID_PRODUCTION_SWITCH:" + key);
    return [key, v || null];
  }));
}
// POA subname sales (Max t140s1306): write the switch only when the environment turns it on and live
// does not have it yet. Turning it off again is a separate reviewed change, so a live switch without the
// matching environment value is refused by assertSwitches instead of being dropped here.
export function switchesPlan(switches, liveBindings) {
  if (!Array.isArray(liveBindings)) fail("MISSING_LIVE_BINDINGS");
  const plan = {};
  for (const [key, value] of Object.entries(switches))
    if (value && !liveBindings.some(b => b.name === key)) plan[key] = value;
  return Object.keys(plan).length ? plan : null;
}
export function assertSwitches(bindings, switches, options = {}) {
  if (!Array.isArray(bindings)) fail("MISSING_LIVE_BINDINGS");
  for (const key of OPTIONAL_SWITCHES) {
    const live = bindings.find(b => b.name === key), want = switches[key] ?? null;
    if (!live) { if (want && !options.allowMissingOn) fail("LIVE_SWITCH_MISMATCH:" + key); continue; }
    if (live.type !== "plain_text" || live.text !== want) fail("LIVE_SWITCH_MISMATCH:" + key);
  }
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
// Full 398,883-byte download of client/poa.mjs (Last-Modified 2026-11-14T09:04:49Z) hashed on the box at ~9:07 PM PST Nov 14 2026, while
// network-facts advertised engine 92658c61… / params bc823648…; re-downloaded and re-hashed at ~11:05 PM PST.
// Reviewed against e01abd95… in the repin PR.
// Full 429,830-byte download of client/poa.mjs hashed on the box on Nov 19 2026 while network-facts advertised
// engine ed86480c… (params unchanged, bc823648…). Reviewed against 92658c61…: transfer body, txid, signing and receipt code is unchanged.
// Full 431,221-byte download of client/poa.mjs hashed on the box on Nov 20 2026 while network-facts advertised
// engine 39ea914d… / params a4c1e8ce…. Reviewed against 92658c61…: canonical encoding, signBody/verifyBody, txidOf, transfer body and receipt code is unchanged.
// Full 433,752-byte download of client/poa.mjs (Last-Modified 2026-11-22T12:05:05Z) hashed on the box on Nov 22 2026 while
// network-facts advertised engine a5feae08… / params a4c1e8ce… (unchanged). Structural diff against the 39ea914d surface snapshot: 0 breaking;
// canonical encoding, signBody/verifyBody, txidOf, transfer body and receipt code unchanged; one new export (_mergeExtrasBS, ledger replay internals).
// Full 440,103-byte download of client/poa.mjs (Last-Modified 2026-11-23T19:17:07Z) hashed on the box on Nov 23 2026 while
// network-facts advertised engine 1560caea… / params 3491bd26… (unchanged). Structural diff against the a5feae08 surface snapshot: 0 breaking;
// canonical encoding, signBody/verifyBody, txidOf, transfer body and receipt code unchanged; one info-level addition (params.att_packs_from_epoch).
// Full 441,067-byte download of client/poa.mjs (Last-Modified 2026-11-24T00:18:25Z) hashed on the box on Nov 23 2026 while
// network-facts advertised engine d6c58f54… / params 34345309…. Structural diff against the 1560caea surface snapshot: 0 breaking;
// canonical encoding, signBody/verifyBody, txidOf, transfer body and receipt code unchanged; snapshot records a bodyHash change on epochClose only.
// Full 443,598-byte download of client/poa.mjs (Last-Modified 2026-11-24T05:27:34Z) hashed on the box on Nov 23 2026 while
// network-facts advertised engine ba3d0902… / params 34345309… (unchanged). Structural diff against the d6c58f54 surface snapshot: 0 breaking, 0 review, 4 informational
// (_CowSet, _baseMergeBS, _cloneWalkState, _cowSetClone). Canonical encoding, signBody/verifyBody, txidOf, transfer body and receipt code unchanged.
// Full 445,454-byte download of client/poa.mjs (Last-Modified 2026-11-24T12:20:01Z) hashed on the box on Nov 24 2026 while
// network-facts advertised engine 46e9c868… / params 347fba7f…. Structural diff against the ba3d0902 surface snapshot: 0 breaking, 0 review, 0 informational.
// Canonical encoding, signBody/verifyBody, txidOf, transfer body and receipt code unchanged; snapshot records a bodyHash change on replay only.
// Full 459,404-byte download of client/poa.mjs (Last-Modified 2026-11-25T00:40:57Z) hashed on the box on Nov 24 2026 while
// network-facts advertised engine a221f58a… / params 8274922e…. Structural diff against the 46e9c868 surface snapshot: 0 breaking, 0 review, 21 informational
// (state-blob exports/constant and additional non-transfer body fields). Canonical encoding, signBody/verifyBody, txidOf, transfer body and receipt code unchanged.
// Full 481,748-byte download of client/poa.mjs (Last-Modified 2026-11-25T13:57:57Z) hashed on the box on Nov 25 2026 while
// network-facts advertised engine 50464775… / params 806fc3a0…. The official release manifest current still listed v0.133-t1-k124 / a221f58a… / 8274922e….
// Structural diff against the a221f58a surface snapshot: 0 breaking, 1 review (blobFor gained an optional trailing parameter; this project does not use blobFor), 19 informational
// (additional state-blob/sig helper exports and non-transfer body/params fields). Canonical encoding, signBody/verifyBody, txidOf, transfer body and receipt code unchanged.
// Same 481,748-byte client (Last-Modified 2026-11-25T13:57:57Z) re-hashed on the box on Nov 25 2026 while network-facts advertised
// engine 50464775… (unchanged) / params 552ccbdd…. Release current is v0.134.1-s5b-e127. Client surface unchanged; engine remains in this allowlist.
export const REPIN_CLIENT_EVIDENCE = Object.freeze({
  "e01abd959dd0439dd89af8e8c187d1bed3897deb2a855a615e7dfa2d0222f1fb": true,
  "92658c61bc75d24572b8eef6182af27436a4f00019854718dcf0de3c6d2b54f6": true,
  "ed86480cd46a8c2df2dbf395f75838f9939120b930cc821c777adf91f5d3d67d": true,
  "39ea914d92f3049e2e7a37accf1a998d263f280d4d37b075abdc463eda157d88": true,
  "a5feae08cbd1fabf38f15637ca113a03ffa2b5b9ce3107dca7cbc84cb8c229a2": true,
  "1560caead346fe3d66d0ce1a796c273c069dd7e6cdbcc73200428ed5f58997e5": true,
  "d6c58f54d698965bc7473403e417bb2963a0e4d1b9fc04099164317cce3f2cfe": true,
  "ba3d09028751868abe095249e0dc29dc7bf8444fffbba81355314b8f73b80339": true,
  "46e9c86827563268cad6a40ddb3f646f0ad17d06fb2857c9c4c19058b8579a19": true,
  "a221f58ad128b804a0e6e0e1882685dc136cfe9536f2f9a955722578675cdc25": true,
  "50464775560a94f49bbe4dae92b932c8fa7cf2c9239f2abdd31020d24c107511": true,
});
export function hasReviewedClientEvidence(engineSha256, root = process.cwd()) {
  if (REPIN_CLIENT_EVIDENCE[engineSha256] === true) return true;
  const path = resolve(root, ".poa-compat/evidence.json");
  if (!existsSync(path)) return false;
  try {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(doc?.entries) && doc.entries.some(e =>
      e?.to?.engine === engineSha256 &&
      e?.to?.client === engineSha256 &&
      typeof e?.to?.clientSize === "number" && e.to.clientSize > 0 &&
      (e?.sources?.facts === NETWORK_FACTS || e?.sources?.facts === "https://minepoa.com/api/network-facts") &&
      (e?.sources?.client === NETWORK_CLIENT || e?.sources?.client === "https://minepoa.com/client/poa.mjs") &&
      (e?.surface?.counts ? e.surface.counts.breaking === 0 : typeof e?.surface?.state === "string" && !e.surface.state.startsWith("unknown"))
    );
  } catch {
    return false;
  }
}
export function committedPins(rawConfig) {
  const engine = rawConfig?.vars?.POA_ESCROW_ENGINE_SHA256 ?? "";
  const params = rawConfig?.vars?.POA_ESCROW_PARAMS_SHA256 ?? "";
  if (!/^[0-9a-f]{64}$/.test(engine) || !/^[0-9a-f]{64}$/.test(params)) fail("INVALID_COMMITTED_PIN");
  return { POA_ESCROW_ENGINE_SHA256: engine, POA_ESCROW_PARAMS_SHA256: params };
}
export function resolvePinTransition(env, expected, rawConfig, preBindings, root = process.cwd()) {
  const explicit = repinPlan(env, expected);
  if (explicit) return { repin: explicit, preExpected: expected, postExpected: { ...expected, ...explicit } };
  const target = committedPins(rawConfig);
  const liveEngine = preBindings?.find(b => b.name === "POA_ESCROW_ENGINE_SHA256")?.text ?? "";
  const liveParams = preBindings?.find(b => b.name === "POA_ESCROW_PARAMS_SHA256")?.text ?? "";
  const validLive = /^[0-9a-f]{64}$/.test(liveEngine) && /^[0-9a-f]{64}$/.test(liveParams);
  const knownLive = validLive && (
    (liveEngine === expected.POA_ESCROW_ENGINE_SHA256 && liveParams === expected.POA_ESCROW_PARAMS_SHA256) ||
    (liveEngine === target.POA_ESCROW_ENGINE_SHA256 && liveParams === target.POA_ESCROW_PARAMS_SHA256) ||
    hasReviewedClientEvidence(liveEngine, root)
  );
  const preExpected = knownLive
    ? { ...expected, POA_ESCROW_ENGINE_SHA256: liveEngine, POA_ESCROW_PARAMS_SHA256: liveParams }
    : expected;
  const changed = knownLive && (liveEngine !== target.POA_ESCROW_ENGINE_SHA256 || liveParams !== target.POA_ESCROW_PARAMS_SHA256);
  const repin = changed ? target : null;
  const postExpected = { ...expected, ...(repin ?? (knownLive ? target : {})) };
  return { repin, preExpected, postExpected };
}
export async function assertAdvertised(pins, fetchImpl, root = process.cwd()) {
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
  if (!hasReviewedClientEvidence(pins.POA_ESCROW_ENGINE_SHA256, root)) fail("REPIN_CLIENT_UNAVAILABLE");
  return "client-hash-from-reviewed-evidence";
}
export function assertBindings(bindings, expected, options = {}) {
  if (!Array.isArray(bindings)) fail("MISSING_LIVE_BINDINGS");
  const allowMissing = options.allowMissing ?? [];
  const map = new Map();
  for (const b of bindings) {
    if (map.has(b.name)) fail("DUPLICATE_LIVE_BINDING");
    map.set(b.name, b);
    if (b.name?.startsWith("POA_ESCROW_") && !POLICY.includes(b.name) && !OPTIONAL_SWITCHES.includes(b.name) && b.name !== "POA_ESCROW_KEY")
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
  if (data.name !== "production" || data.can_admins_bypass !== false ||
      data.deployment_branch_policy?.protected_branches !== true ||
      data.deployment_branch_policy?.custom_branch_policies !== false)
    fail("PRODUCTION_REQUIRES_PROTECTED_MAIN");
}
export async function assertLiveEscrowFresh(publicUrl, fetchImpl = fetch, delayMs = 2000) {
  const url = `${String(publicUrl).replace(/\/+$/, "")}/v1/escrow/capabilities`;
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json" } });
    } catch {
      if (attempt >= 3) fail("ESCROW_CAPABILITIES_UNAVAILABLE");
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }
    if (!response.ok) {
      if (attempt >= 3) fail("ESCROW_CAPABILITIES_HTTP_ERROR");
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }
    const data = await response.json();
    if (data?.freshness?.code === "ESCROW_PROTOCOL_CHANGED") fail("ESCROW_PROTOCOL_CHANGED");
    return data;
  }
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
  if (options?.switches) { assertSwitches(live.bindings, options.switches, options); assertSwitches(live.versionBindings, options.switches, options); }
  return live.id;
}
export function wranglerArgs(configPath, dryRun) {
  return ["node_modules/wrangler/bin/wrangler.js", "deploy", "--config", configPath, "--keep-vars", "--strict",
    ...(dryRun ? ["--dry-run", "--outdir", "./.deploy-dry-run"] : [])];
}
export async function runDeployment({ dryRun, env = process.env, fetchImpl = fetch, run = spawnSync, root = process.cwd() }) {
  const rawConfig = parseConfig(readFileSync(resolve(root, "wrangler.jsonc"), "utf8"));
  const config = productionConfig(rawConfig);
  let expected, preExpected, postExpected, before, repin = null, switches = null;
  if (!dryRun) {
    expected = expectedPolicy(env); switches = expectedSwitches(env);
    if (!env.CLOUDFLARE_API_TOKEN) fail("MISSING_CLOUDFLARE_API_TOKEN");
    await assertGitHub(env, fetchImpl);
    const pre = await inspectLive(env.CLOUDFLARE_API_TOKEN, fetchImpl);
    ({ repin, preExpected, postExpected } = resolvePinTransition(env, expected, rawConfig, pre.bindings, root));
    // Precheck keeps current policy exact, but allows the checkout binding to be absent so this
    // deploy can introduce POA_ESCROW_NEW_NAMES=approved-v1. A wrong present value still fails.
    assertBindings(pre.bindings, preExpected, { allowMissing: ["POA_ESCROW_NEW_NAMES"] });
    assertBindings(pre.versionBindings, preExpected, { allowMissing: ["POA_ESCROW_NEW_NAMES"] });
    assertSwitches(pre.bindings, switches, { allowMissingOn: true }); assertSwitches(pre.versionBindings, switches, { allowMissingOn: true });
    before = pre.id;
    const checkout = checkoutPlan(expected, pre.bindings);
    if (checkout) config.vars = { ...config.vars, ...checkout };
    const optional = switchesPlan(switches, pre.bindings);
    if (optional) config.vars = { ...config.vars, ...optional };
    if (repin) { console.log("REPIN advertised by network-facts; " + await assertAdvertised(repin, fetchImpl, root)); config.vars = { ...config.vars, ...repin }; }
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
      if (await liveSnapshot(preExpected, env.CLOUDFLARE_API_TOKEN, fetchImpl, { allowMissing: ["POA_ESCROW_NEW_NAMES"], switches, allowMissingOn: true }) !== before) fail("LIVE_VERSION_CHANGED");
      execute(false);
      // Post-check: the new live version carries exactly the expected policy (new pins after a repin) and does not report ESCROW_PROTOCOL_CHANGED.
      for (let attempt = 1; ; attempt++) {
        try { await liveSnapshot(postExpected, env.CLOUDFLARE_API_TOKEN, fetchImpl, { switches }); break; }
        catch (e) { if (attempt >= 6) throw e; await new Promise(r => setTimeout(r, env.DEPLOY_POSTCHECK_DELAY_MS === "0" ? 0 : 5000)); }
      }
      await assertLiveEscrowFresh(config.vars.PUBLIC_EXPLORER_URL, fetchImpl, env.DEPLOY_POSTCHECK_DELAY_MS === "0" ? 0 : 2000);
    }
  } finally { unlinkSync(path); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !["--dry-run", "--deploy"].includes(mode)) fail("USE_DRY_RUN_OR_DEPLOY");
  await runDeployment({ dryRun: mode === "--dry-run" });
}
