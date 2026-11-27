// Pre-flight guard for .github/workflows/poa-compat.yml.
// Uses only Node built-ins so up-to-date scheduled runs finish in seconds without npm ci.
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_FACTS_URLS = Object.freeze([
  "https://minepoa.com/chain/poa-mainnet-1/api/network-facts",
  "https://minepoa.com/api/network-facts",
]);
export const DEFAULT_CLIENT_URLS = Object.freeze([
  "https://minepoa.com/chain/poa-mainnet-1/client/poa.mjs",
  "https://minepoa.com/client/poa.mjs",
]);
export const PR_BRANCH = "poa-compat/update";
export const MAX_AUTO_RERUN_ATTEMPT = 3;

const HEX64 = /^[0-9a-f]{64}$/;
const defaultSleep = ms => new Promise(r => setTimeout(r, ms));

export function readCommittedPins(root = process.cwd()) {
  const raw = readFileSync(resolve(root, "wrangler.jsonc"), "utf8");
  const pick = key => {
    const m = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(raw);
    return m ? m[1] : "";
  };
  const engine = pick("POA_ESCROW_ENGINE_SHA256");
  const params = pick("POA_ESCROW_PARAMS_SHA256");
  const publicUrl = pick("PUBLIC_EXPLORER_URL") || "https://poadomains.link";
  if (!HEX64.test(engine) || !HEX64.test(params)) {
    throw new Error("INVALID_COMMITTED_PIN");
  }
  return { engine, params, publicUrl };
}

export async function fetchLiveFacts(
  fetchImpl = fetch,
  { factsUrls = DEFAULT_FACTS_URLS, sleep = defaultSleep, retries = 3, retryDelayMs = 5000 } = {},
) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    for (const url of factsUrls) {
      try {
        const r = await fetchImpl(url, {
          method: "GET",
          redirect: "error",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) continue;
        const body = await r.json();
        if (
          body?.chain_id === "poa-mainnet-1" &&
          HEX64.test(body?.engine_sha256 ?? "") &&
          HEX64.test(body?.params_sha256 ?? "")
        ) {
          return { engine: body.engine_sha256, params: body.params_sha256, openEpoch: body.open_epoch ?? null, url };
        }
      } catch {
        // retry next candidate or attempt
      }
    }
    if (attempt < retries) await sleep(retryDelayMs);
  }
  return null;
}

export async function waitForMatchingBundle(
  expectedEngineSha,
  fetchImpl = fetch,
  { clientUrls = DEFAULT_CLIENT_URLS, sleep = defaultSleep, maxAttempts = 5, retryDelayMs = 25000 } = {},
) {
  let lastStatus = "unavailable";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const url of clientUrls) {
      try {
        const r = await fetchImpl(url, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(90000),
        });
        if (!r.ok) {
          lastStatus = `http-${r.status}`;
          continue;
        }
        const bytes = new Uint8Array(await r.arrayBuffer());
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (digest === expectedEngineSha) {
          return { ok: true, attempt, url, bytes: bytes.byteLength, digest };
        }
        lastStatus = `hash-mismatch:${digest.slice(0, 8)}`;
      } catch {
        lastStatus = "fetch-error";
      }
    }
    if (attempt < maxAttempts) await sleep(retryDelayMs);
  }
  return { ok: false, attempts: maxAttempts, lastStatus };
}

async function ghJson(fetchImpl, token, path, { method = "GET", body } = {}) {
  if (!token) return null;
  const r = await fetchImpl(`https://api.github.com${path}`, {
    method,
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return null;
  if (r.status === 204 || r.status === 201 && method === "POST" && path.endsWith("/rerun-failed-jobs")) {
    return { ok: true };
  }
  try {
    return await r.json();
  } catch {
    return { ok: true };
  }
}

async function checkLiveEscrowCode(publicUrl, fetchImpl) {
  try {
    const r = await fetchImpl(`${publicUrl.replace(/\/+$/, "")}/v1/escrow/capabilities`, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return { held: Boolean(data?.held), code: data?.freshness?.code ?? null };
  } catch {
    return null;
  }
}

async function findOpenCompatPr(fetchImpl, token, repo) {
  const owner = repo.split("/")[0];
  const list = await ghJson(
    fetchImpl,
    token,
    `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${PR_BRANCH}`)}&base=main`,
  );
  if (!Array.isArray(list) || !list.length) return null;
  const full = await ghJson(fetchImpl, token, `/repos/${repo}/pulls/${list[0].number}`);
  return full ?? list[0];
}

async function latestWorkflowRunForSha(fetchImpl, token, repo, workflowFile, sha) {
  const data = await ghJson(
    fetchImpl,
    token,
    `/repos/${repo}/actions/workflows/${workflowFile}/runs?head_sha=${sha}&per_page=5`,
  );
  const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
  return runs[0] ?? null;
}

async function maybeRerunFailedWorkflow(fetchImpl, actionsToken, repo, workflowFile, sha) {
  const run = await latestWorkflowRunForSha(fetchImpl, actionsToken, repo, workflowFile, sha);
  if (!run) return { state: "missing", runId: null };
  if (run.status !== "completed") return { state: "in-progress", runId: run.id };
  if (run.conclusion === "success") return { state: "success", runId: run.id };
  if ((run.run_attempt ?? 1) >= MAX_AUTO_RERUN_ATTEMPT) return { state: "exhausted", runId: run.id };
  const res = await ghJson(fetchImpl, actionsToken, `/repos/${repo}/actions/runs/${run.id}/rerun-failed-jobs`, {
    method: "POST",
  });
  return { state: res ? "rerun-requested" : "rerun-failed", runId: run.id };
}

export async function runPreflight({
  root = process.cwd(),
  repo = process.env.GITHUB_REPOSITORY || "maximusmaximus/poa-domains",
  headSha = process.env.GITHUB_SHA || "",
  appToken = process.env.GH_APP_TOKEN || "",
  actionsToken = process.env.GH_ACTIONS_TOKEN || process.env.GH_APP_TOKEN || "",
  fetchImpl = fetch,
  sleep = defaultSleep,
  bundleAttempts = 5,
  bundleRetryMs = 25000,
  factsRetries = 3,
  factsRetryMs = 5000,
  log = console.log,
} = {}) {
  const committed = readCommittedPins(root);
  const live = await fetchLiveFacts(fetchImpl, { sleep, retries: factsRetries, retryDelayMs: factsRetryMs });
  if (!live) {
    const out = { shouldRun: false, reason: "facts-unavailable" };
    log(JSON.stringify(out));
    return out;
  }

  const pinsMatch = committed.engine === live.engine && committed.params === live.params;
  const openPr = await findOpenCompatPr(fetchImpl, appToken || actionsToken, repo);

  if (pinsMatch) {
    let closedPr = null;
    if (openPr && appToken) {
      await ghJson(fetchImpl, appToken, `/repos/${repo}/issues/${openPr.number}/comments`, {
        method: "POST",
        body: {
          body: `Closing superseded update PR: \`main\` already matches live PoA pins (\`${live.engine.slice(0, 8)}\` / \`${live.params.slice(0, 8)}\`).`,
        },
      });
      await ghJson(fetchImpl, appToken, `/repos/${repo}/pulls/${openPr.number}`, {
        method: "PATCH",
        body: { state: "closed" },
      });
      await ghJson(fetchImpl, appToken, `/repos/${repo}/git/refs/heads/${PR_BRANCH}`, {
        method: "DELETE",
      });
      closedPr = openPr.number;
    }

    const liveEscrow = await checkLiveEscrowCode(committed.publicUrl, fetchImpl);
    let recovery = null;
    if (liveEscrow?.code === "ESCROW_PROTOCOL_CHANGED" && headSha && actionsToken) {
      const ci = await maybeRerunFailedWorkflow(fetchImpl, actionsToken, repo, "ci.yml", headSha);
      recovery = { ci };
      if (ci.state === "success") {
        recovery.deploy = await maybeRerunFailedWorkflow(fetchImpl, actionsToken, repo, "deploy-worker.yml", headSha);
      }
    }

    const out = {
      shouldRun: false,
      reason: recovery ? "main-matches-live-recovery" : "up-to-date",
      closedPr,
      recovery,
    };
    log(JSON.stringify(out));
    return out;
  }

  // Pins differ from live network. Avoid cancelling in-flight CI on an already-current auto-merge PR.
  const engShort = live.engine.slice(0, 8);
  const parShort = live.params.slice(0, 8);
  const prTargetsLive = Boolean(
    openPr &&
      typeof openPr.title === "string" &&
      openPr.title.includes(engShort) &&
      openPr.title.includes(parShort),
  );
  if (prTargetsLive && openPr.auto_merge && openPr.mergeable !== false && openPr.head?.sha) {
    const ci = await maybeRerunFailedWorkflow(fetchImpl, actionsToken, repo, "ci.yml", openPr.head.sha);
    if (ci.state === "in-progress") {
      const out = { shouldRun: false, reason: "pr-ci-in-progress", pr: openPr.number, runId: ci.runId };
      log(JSON.stringify(out));
      return out;
    }
    if (ci.state === "rerun-requested") {
      const out = { shouldRun: false, reason: "pr-rerun-failed-ci", pr: openPr.number, runId: ci.runId };
      log(JSON.stringify(out));
      return out;
    }
    if (ci.state === "success") {
      const out = { shouldRun: false, reason: "pr-ready-to-merge", pr: openPr.number, runId: ci.runId };
      log(JSON.stringify(out));
      return out;
    }
  }

  // Wait for the served client bundle to be 200 OK and match engine_sha256 before running poa-compat-watch.
  const bundle = await waitForMatchingBundle(live.engine, fetchImpl, {
    sleep,
    maxAttempts: bundleAttempts,
    retryDelayMs: bundleRetryMs,
  });
  if (!bundle.ok) {
    const out = {
      shouldRun: false,
      reason: "upstream-rollout-pending",
      lastStatus: bundle.lastStatus,
      live: { engine: engShort, params: parShort },
    };
    log(JSON.stringify(out));
    return out;
  }

  const out = {
    shouldRun: true,
    reason: "bundle-verified",
    live: { engine: engShort, params: parShort },
    bundleBytes: bundle.bytes,
    bundleAttempt: bundle.attempt,
  };
  log(JSON.stringify(out));
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const result = await runPreflight();
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `should_run=${result.shouldRun ? "true" : "false"}\nreason=${result.reason}\n`,
    );
  }
}
