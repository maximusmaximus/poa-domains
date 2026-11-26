import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  DEFAULT_CLIENT_URLS,
  DEFAULT_FACTS_URLS,
  fetchLiveFacts,
  readCommittedPins,
  runPreflight,
  waitForMatchingBundle,
} from "../scripts/poa-compat-preflight.mjs";

const BUNDLE_OLD = new TextEncoder().encode("export const v = 1;\n");
const BUNDLE_NEW = new TextEncoder().encode("export const v = 2;\n");
const ENG_OLD = createHash("sha256").update(BUNDLE_OLD).digest("hex");
const ENG_NEW = createHash("sha256").update(BUNDLE_NEW).digest("hex");
const PAR_OLD = "a".repeat(64);
const PAR_NEW = "b".repeat(64);

const noSleep = async () => {};
const quiet = () => {};

function tempRepo(engine = ENG_OLD, params = PAR_OLD) {
  const dir = mkdtempSync(join(tmpdir(), "poa-compat-preflight-"));
  writeFileSync(
    join(dir, "wrangler.jsonc"),
    JSON.stringify({
      vars: {
        POA_ESCROW_ENGINE_SHA256: engine,
        POA_ESCROW_PARAMS_SHA256: params,
        PUBLIC_EXPLORER_URL: "https://poadomains.grok.me",
      },
    }),
  );
  return dir;
}

function jsonResp(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
}

function bytesResp(bytes, status = 200) {
  return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

test("readCommittedPins reads wrangler.jsonc pins and rejects malformed hashes", () => {
  const real = readCommittedPins();
  assert.match(real.engine, /^[0-9a-f]{64}$/);
  assert.match(real.params, /^[0-9a-f]{64}$/);
  assert.equal(real.publicUrl, "https://poadomains.grok.me");

  const badDir = tempRepo("not-a-hash", PAR_OLD);
  try {
    assert.throws(() => readCommittedPins(badDir), /INVALID_COMMITTED_PIN/);
  } finally {
    rmSync(badDir, { recursive: true, force: true });
  }
});

test("fetchLiveFacts retries transient failures and validates mainnet chain_id", async () => {
  let calls = 0;
  const fetchImpl = async url => {
    calls++;
    if (calls <= 2) return jsonResp({ error: "down" }, 503);
    if (url === DEFAULT_FACTS_URLS[0]) return jsonResp({ chain_id: "wrong", engine_sha256: ENG_NEW, params_sha256: PAR_NEW });
    return jsonResp({ chain_id: "poa-mainnet-1", engine_sha256: ENG_NEW, params_sha256: PAR_NEW, open_epoch: 127 });
  };
  const facts = await fetchLiveFacts(fetchImpl, { sleep: noSleep, retries: 3, retryDelayMs: 0 });
  assert.equal(facts.engine, ENG_NEW);
  assert.equal(facts.params, PAR_NEW);
  assert.equal(facts.openEpoch, 127);

  const alwaysDown = async () => { throw new Error("network"); };
  assert.equal(await fetchLiveFacts(alwaysDown, { sleep: noSleep, retries: 2, retryDelayMs: 0 }), null);
});

test("waitForMatchingBundle retries HTTP 503 and mid-rollout hash mismatches until bundle matches", async () => {
  let hits = 0;
  const fetchImpl = async () => {
    hits++;
    if (hits === 1) return bytesResp(new Uint8Array(), 503);
    if (hits === 2) throw new Error("timeout");
    if (hits <= 4) return bytesResp(BUNDLE_OLD, 200);
    return bytesResp(BUNDLE_NEW, 200);
  };
  const ok = await waitForMatchingBundle(ENG_NEW, fetchImpl, { sleep: noSleep, maxAttempts: 4, retryDelayMs: 0 });
  assert.equal(ok.ok, true);
  assert.equal(ok.digest, ENG_NEW);
  assert.equal(ok.bytes, BUNDLE_NEW.byteLength);

  const stuck = await waitForMatchingBundle(ENG_NEW, async () => bytesResp(BUNDLE_OLD, 200), {
    clientUrls: [DEFAULT_CLIENT_URLS[0]],
    sleep: noSleep,
    maxAttempts: 2,
    retryDelayMs: 0,
  });
  assert.equal(stuck.ok, false);
  assert.match(stuck.lastStatus, /^hash-mismatch:/);
});

test("runPreflight fast-paths when up to date, closes superseded PR, and recovers stale live deploy", async () => {
  const dir = tempRepo(ENG_NEW, PAR_NEW);
  try {
    // 1. Completely up to date: fast-path skip
    const upToDate = await runPreflight({
      root: dir,
      headSha: "1".repeat(40),
      appToken: "app-tok",
      actionsToken: "act-tok",
      sleep: noSleep,
      log: quiet,
      fetchImpl: async url => {
        if (url.includes("network-facts")) return jsonResp({ chain_id: "poa-mainnet-1", engine_sha256: ENG_NEW, params_sha256: PAR_NEW });
        if (url.includes("/pulls?")) return jsonResp([]);
        if (url.includes("/v1/escrow/capabilities")) return jsonResp({ held: false, freshness: { code: null } });
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.deepEqual(upToDate, { shouldRun: false, reason: "up-to-date", closedPr: null, recovery: null });

    // 2. Main matches live pins, superseded PR is still open, AND live Worker still reports ESCROW_PROTOCOL_CHANGED
    const actions = [];
    const recover = await runPreflight({
      root: dir,
      headSha: "2".repeat(40),
      appToken: "app-tok",
      actionsToken: "act-tok",
      sleep: noSleep,
      log: quiet,
      fetchImpl: async (url, init = {}) => {
        actions.push(`${init.method || "GET"} ${url}`);
        if (url.includes("network-facts")) return jsonResp({ chain_id: "poa-mainnet-1", engine_sha256: ENG_NEW, params_sha256: PAR_NEW });
        if (url.includes("/pulls?")) return jsonResp([{ number: 131, title: `PoA core update ${ENG_NEW.slice(0, 8)} ${PAR_NEW.slice(0, 8)}` }]);
        if (url.endsWith("/pulls/131") && (init.method || "GET") === "GET") return jsonResp({ number: 131, mergeable: false });
        if (url.endsWith("/issues/131/comments")) return jsonResp({ id: 1 }, 201);
        if (url.endsWith("/pulls/131") && init.method === "PATCH") return jsonResp({ number: 131, state: "closed" });
        if (url.endsWith("/git/refs/heads/poa-compat/update") && init.method === "DELETE") return jsonResp({}, 204);
        if (url.includes("/v1/escrow/capabilities")) return jsonResp({ held: true, freshness: { code: "ESCROW_PROTOCOL_CHANGED" } });
        if (url.includes("/workflows/ci.yml/runs")) return jsonResp({ workflow_runs: [{ id: 501, status: "completed", conclusion: "success", run_attempt: 1 }] });
        if (url.includes("/workflows/deploy-worker.yml/runs")) return jsonResp({ workflow_runs: [{ id: 602, status: "completed", conclusion: "failure", run_attempt: 1 }] });
        if (url.endsWith("/actions/runs/602/rerun-failed-jobs")) return jsonResp({}, 201);
        throw new Error(`unexpected ${init.method || "GET"} ${url}`);
      },
    });
    assert.equal(recover.shouldRun, false);
    assert.equal(recover.reason, "main-matches-live-recovery");
    assert.equal(recover.closedPr, 131);
    assert.equal(recover.recovery.ci.state, "success");
    assert.equal(recover.recovery.deploy.state, "rerun-requested");
    assert.ok(actions.some(a => a.startsWith("PATCH ") && a.endsWith("/pulls/131")));
    assert.ok(actions.some(a => a.startsWith("DELETE ") && a.endsWith("/git/refs/heads/poa-compat/update")));
    assert.ok(actions.some(a => a.startsWith("POST ") && a.endsWith("/actions/runs/602/rerun-failed-jobs")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runPreflight protects in-flight PR CI, auto-reruns failed flaky PR CI, and refreshes stale or 503 PRs", async () => {
  const dir = tempRepo(ENG_OLD, PAR_OLD);
  const prTitle = `PoA core update: breaking, engine ${ENG_NEW.slice(0, 8)} / params ${PAR_NEW.slice(0, 8)}`;
  try {
    // 1. Open PR for exact live pins with auto_merge + CI in progress -> skip force-push
    const inProgress = await runPreflight({
      root: dir,
      appToken: "app-tok",
      actionsToken: "act-tok",
      sleep: noSleep,
      log: quiet,
      fetchImpl: async url => {
        if (url.includes("network-facts")) return jsonResp({ chain_id: "poa-mainnet-1", engine_sha256: ENG_NEW, params_sha256: PAR_NEW });
        if (url.includes("/pulls?")) return jsonResp([{ number: 201, title: prTitle }]);
        if (url.endsWith("/pulls/201")) return jsonResp({ number: 201, title: prTitle, auto_merge: { merge_method: "squash" }, mergeable: true, head: { sha: "3".repeat(40) } });
        if (url.includes("/workflows/ci.yml/runs")) return jsonResp({ workflow_runs: [{ id: 701, status: "in_progress", conclusion: null, run_attempt: 1 }] });
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.equal(inProgress.shouldRun, false);
    assert.equal(inProgress.reason, "pr-ci-in-progress");

    // 2. Open PR with auto_merge whose CI failed (e.g. flaky browser-escrow) -> rerun failed jobs without force-pushing
    const rerun = await runPreflight({
      root: dir,
      appToken: "app-tok",
      actionsToken: "act-tok",
      sleep: noSleep,
      log: quiet,
      fetchImpl: async (url, init = {}) => {
        if (url.includes("network-facts")) return jsonResp({ chain_id: "poa-mainnet-1", engine_sha256: ENG_NEW, params_sha256: PAR_NEW });
        if (url.includes("/pulls?")) return jsonResp([{ number: 201, title: prTitle }]);
        if (url.endsWith("/pulls/201")) return jsonResp({ number: 201, title: prTitle, auto_merge: { merge_method: "squash" }, mergeable: true, head: { sha: "3".repeat(40) } });
        if (url.includes("/workflows/ci.yml/runs")) return jsonResp({ workflow_runs: [{ id: 701, status: "completed", conclusion: "failure", run_attempt: 1 }] });
        if (url.endsWith("/actions/runs/701/rerun-failed-jobs") && init.method === "POST") return jsonResp({}, 201);
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.equal(rerun.shouldRun, false);
    assert.equal(rerun.reason, "pr-rerun-failed-ci");

    // 3. Open PR with auto_merge whose CI already passed -> wait for GitHub auto-merge
    const ready = await runPreflight({
      root: dir,
      appToken: "app-tok",
      actionsToken: "act-tok",
      sleep: noSleep,
      log: quiet,
      fetchImpl: async url => {
        if (url.includes("network-facts")) return jsonResp({ chain_id: "poa-mainnet-1", engine_sha256: ENG_NEW, params_sha256: PAR_NEW });
        if (url.includes("/pulls?")) return jsonResp([{ number: 201, title: prTitle }]);
        if (url.endsWith("/pulls/201")) return jsonResp({ number: 201, title: prTitle, auto_merge: { merge_method: "squash" }, mergeable: true, head: { sha: "3".repeat(40) } });
        if (url.includes("/workflows/ci.yml/runs")) return jsonResp({ workflow_runs: [{ id: 701, status: "completed", conclusion: "success", run_attempt: 1 }] });
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.equal(ready.shouldRun, false);
    assert.equal(ready.reason, "pr-ready-to-merge");

    // 4. Open PR WITHOUT auto_merge (e.g. previous run hit 503) -> verifies bundle & runs poa-compat-watch
    const refresh = await runPreflight({
      root: dir,
      appToken: "app-tok",
      actionsToken: "act-tok",
      sleep: noSleep,
      bundleAttempts: 2,
      bundleRetryMs: 0,
      log: quiet,
      fetchImpl: async url => {
        if (url.includes("network-facts")) return jsonResp({ chain_id: "poa-mainnet-1", engine_sha256: ENG_NEW, params_sha256: PAR_NEW });
        if (url.includes("/pulls?")) return jsonResp([{ number: 201, title: prTitle }]);
        if (url.endsWith("/pulls/201")) return jsonResp({ number: 201, title: prTitle, auto_merge: null, mergeable: true, head: { sha: "3".repeat(40) } });
        if (url.includes("poa.mjs")) return bytesResp(BUNDLE_NEW, 200);
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.equal(refresh.shouldRun, true);
    assert.equal(refresh.reason, "bundle-verified");

    // 5. Mid-rollout bundle never matches within retry budget -> skip cleanly instead of opening broken PR
    const rollout = await runPreflight({
      root: dir,
      sleep: noSleep,
      bundleAttempts: 2,
      bundleRetryMs: 0,
      log: quiet,
      fetchImpl: async url => {
        if (url.includes("network-facts")) return jsonResp({ chain_id: "poa-mainnet-1", engine_sha256: ENG_NEW, params_sha256: PAR_NEW });
        if (url.includes("poa.mjs")) return bytesResp(BUNDLE_OLD, 200);
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.equal(rollout.shouldRun, false);
    assert.equal(rollout.reason, "upstream-rollout-pending");

    // 6. Facts unavailable -> skip cleanly
    const down = await runPreflight({
      root: dir,
      sleep: noSleep,
      factsRetries: 1,
      factsRetryMs: 0,
      log: quiet,
      fetchImpl: async () => jsonResp({}, 503),
    });
    assert.equal(down.shouldRun, false);
    assert.equal(down.reason, "facts-unavailable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("poa-compat.yml workflow uses off-peak 15m schedule, Node 24, pinned SHAs, preflight, and auto-merge", () => {
  const wf = parse(readFileSync(".github/workflows/poa-compat.yml", "utf8"));
  assert.equal(wf.on.schedule[0].cron, "11,26,41,56 * * * *");
  assert.equal(wf.permissions.actions, "write");
  assert.equal(wf.permissions.contents, "write");
  assert.equal(wf.permissions["pull-requests"], "write");
  const steps = wf.jobs.watch.steps;
  for (const s of steps.filter(x => x.uses)) {
    assert.match(s.uses, /@[0-9a-f]{40}$/, `unpinned action: ${s.uses}`);
  }
  const pre = steps.find(s => s.id === "preflight");
  assert.ok(pre && pre.run.includes("scripts/poa-compat-preflight.mjs"));
  const compat = steps.find(s => s.uses?.startsWith("maximusmaximus/poa-compat-watch@"));
  assert.equal(compat.with["node-version"], "24");
  assert.equal(compat.with["auto-merge-when"], "non-breaking-surface");
  assert.match(compat.if, /steps\.preflight\.outputs\.should_run == 'true'/);
});
