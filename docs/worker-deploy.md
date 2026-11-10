# Reviewed Worker deployment gate (currently disarmed)

Production is the `poadomains-registry` Worker and the existing
`REGISTRY` / `PoaRegistry` / `poa-mainnet-registry-v1` Durable Object. Node and
Docker are local development only. This change does **not** deploy the Worker,
create credentials, change escrow code, pause/unpause it or perform a PoA action.

## Observed live settings (read-only, November 9, 2026)

The active deployment `1528f497-589a-46f5-a61d-8db7a690bcf5`, created
at 4:51:44 PM PST, has source `wrangler`, serving 100% version
`46459dd0-989d-46dc-ad79-c8b24a867595`. Both version bindings and Worker settings
show **plaintext variables**, not secrets:

- `POA_ESCROW_ENABLED=true`
- `POA_ESCROW_NETWORK_WRITES=approved-v1` (not the boolean string `true`)
- `POA_ESCROW_ADDRESS=poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf`
- per-transaction/daily limits and engine/parameter pins matching the committed values.

`POA_ESCROW_KEY` and `ESCROW_ADMIN_TOKEN` are **secret_text** bindings. Only names
and types were inspected; no secret values were retrieved. The active version's
source establishes a Wrangler deployment with non-repository policy overrides;
this API metadata cannot prove the exact original CLI flags or exclude earlier
dashboard edits. Max confirmed escrow is unpaused. The public workers.dev
capabilities read returned HTTP 403 from this network, so pause state was not
independently re-verified. No admin request was attempted.

The committed disabled defaults remain unchanged. A plain `wrangler deploy`
against those defaults is **not** the production upgrade procedure.

## Approval and prerequisites

`.github/workflows/deploy-worker.yml` dry-runs on PRs without credentials. On a
successful `native-and-reference-checks` run for main, it also dry-runs that exact
SHA. The production job is skipped unless repository variable
`WORKER_DEPLOY_ENABLED` is explicitly set to `true`. It is intentionally unset
now. No token was created and no deployment approval is requested by this change.

Before Max enables deployments:

1. The GitHub `production` environment must require **only Max
   (`maximusmaximus`, user ID 15719015)** as reviewer, disable administrator bypass,
   and allow protected branches only. This gate is configured. Self-review is
   allowed because the automation commits as Max; approval is still a separate
   environment-review decision and is never automated by this workflow.
2. Max must provide `CLOUDFLARE_API_TOKEN` in that environment, with the minimum
   reviewed Worker-update/read permissions. No token is committed or created here.
3. Set these **non-secret production-environment variables** from the currently
   active live bindings, not from the disabled repository defaults:
   `POA_ESCROW_ENABLED`, `POA_ESCROW_NETWORK_WRITES`, `POA_ESCROW_ADDRESS`,
   `POA_ESCROW_PER_TX`, `POA_ESCROW_DAILY`, `POA_ESCROW_ENGINE_SHA256`,
   `POA_ESCROW_PARAMS_SHA256`. Missing values fail closed.
4. Only then explicitly enable the repository switch. Each eligible deployment
   still waits for Max's production-environment approval. This is a GitHub
   environment, **not** a Wrangler `--env` that would create another Worker.

The runner re-verifies the actual reviewer/branch/bypass protection, current main
SHA and successful main push CI through read-only GitHub APIs. Before and after
its local dry-run, it reads Cloudflare settings and the single 100%-active
version. It refuses policy mismatches, disabled escrow, another wallet,
missing secret bindings, unknown escrow settings, split rollouts and version
changes. A newer main commit invalidates the old approval/run's eligibility.
No provider response or signing credential is printed.

## Preservation, not replay of stale values

Passing `--keep-vars` alone is **insufficient** while committed values say false.
Instead the runner makes a temporary, mode-0600 config beside `wrangler.jsonc`,
removes **every `POA_ESCROW_*` variable** from that copy and uses `--keep-vars
--strict`. The committed config is never modified. Public environment variables
are the expected-policy guard, **not outgoing overrides**.

In pinned Wrangler 4.158.0, `--keep-vars` adds upload metadata
`keep_bindings: ["plain_text", "json"]`; omitted values are retained by Cloudflare.
Thus this deployment does not send an earlier copy of the address/switches and
cannot overwrite a concurrent live change with stale expected values. Existing
secrets are retained by normal deployment; no `--secrets-file`, key value,
`--var`, `--name` or named Wrangler environment is used. Policy values and any
PoA-key environment variables are stripped from the Wrangler subprocess.
`--strict` additionally refuses conflicting remote changes. The temporary config
is removed even on failure. No pause/admin/reconcile route is called, and the
existing SQLite Durable Object identity/migration is unchanged.

A deliberate live-policy change requires the operator to reconcile the expected
production variables (and a reviewed update for a different wallet), not bypass
the guard. External operators must likewise avoid unguarded deployments.

## Domain and verification

The connected account has no `grok.me` zone. Keep the existing Grok Build proxy;
there is no `custom_domain` route that would fail deployment. Domain binding
needs Max or Grok Build. The Worker and CLI accept the production host and local
workerd integration tests cover that Host, `/d/` and `/p/`, without production writes.

`npm run cf:dry-run` uses the escrow-preserving config and performs no upload.
`test/worker-deploy.test.mjs` tests missing/mismatched policy, unsafe switches and
wallet, secret-binding types, Max-only protection, stale/failed/foreign main,
split rollout, live drift, both runner phases and offline credential-free dry-run.
It runs in the enforced CI unit coverage lane. Existing escrow suites remain
unchanged, including runtime/admin/UI and escrow-local coverage.

Sources:
- https://developers.cloudflare.com/workers/wrangler/commands/workers/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/


## First gated MCP deploy: non-secret expected policy

MCP source was added without deployment. Max's separate approval is still
required to make `/mcp` live. The repository `WORKER_DEPLOY_ENABLED` remains
unset, and the workflow is unchanged. Before enabling it, provide the environment
API-token secret separately (never paste its value into a PR or inbox), keep the
Max-only production review gate, and use the latest green main SHA.

Read-only reinspection on November 9, 2026 (PST) found the same active deployment
`1528f497-589a-46f5-a61d-8db7a690bcf5` and version
`46459dd0-989d-46dc-ad79-c8b24a867595`, source `wrangler`. Both version plaintext
bindings and Worker settings match these **production-environment expected-policy
variables** (these are not secrets or deployment overrides):

| Variable | Expected value |
| --- | --- |
| `POA_ESCROW_ENABLED` | `true` |
| `POA_ESCROW_NETWORK_WRITES` | `approved-v1` |
| `POA_ESCROW_ADDRESS` | `poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf` |
| `POA_ESCROW_PER_TX` | `250000.000000` |
| `POA_ESCROW_DAILY` | `1000000.000000` |
| `POA_ESCROW_ENGINE_SHA256` | `4e1f5c41dda9fda8939d92ffd6e9c2f05b66b4b8f1c5ff271960ea18b7bc6aa5` |
| `POA_ESCROW_PARAMS_SHA256` | `82f994768b0bd7d430226147bfe90aad5aff1d4a50eae0400e8a950cb4416348` |

Re-read live policy at approval time; do not replay this observation over a later
operator change. The existing runner refuses missing/mismatched values, preserves
all live `POA_ESCROW_*` bindings server-side and never sends committed false
defaults. It does not alter the Durable Object's pause/state or escrow wallet.
Only the existing secret binding **types** are checked; no secret value is read.

The first MCP deploy also adds `MCP_RATE_LIMITER` (namespace `2026110908`,
60 requests per minute per connecting IP). Keep the existing Grok Build front
door (there is no grok.me zone/custom-domain binding here), confirm it passes
POST/body/protocol/Accept headers and trusted client-IP behavior, and verify the
remote handshake/security guards **after** the separately approved deployment.
Merging this source does not configure the proxy, arm the switch or deploy it.
