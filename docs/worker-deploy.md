# Reviewed Worker deployment gate

Production is the `poadomains-registry` Worker and the existing
`REGISTRY` / `PoaRegistry` / `poa-mainnet-registry-v1` Durable Object. Node and
Docker are local development only. This change does **not** deploy the Worker,
create credentials, change escrow code, pause/unpause it or perform a PoA action.

## Observed live settings (read-only, November 9, 2026)

The pre-gated deployment `1528f497-589a-46f5-a61d-8db7a690bcf5`, created
at 4:51:44 PM PST, had source `wrangler`, serving 100% version
`46459dd0-989d-46dc-ad79-c8b24a867595`. Both the earlier and approved first-release version/settings
show the same **plaintext variables**, not secrets:

- `POA_ESCROW_ENABLED=true`
- `POA_ESCROW_NETWORK_WRITES=approved-v1` (not the boolean string `true`)
- `POA_ESCROW_ADDRESS=poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf`
- per-transaction/daily limits and engine/parameter pins matching the committed values.

`POA_ESCROW_KEY` and `ESCROW_ADMIN_TOKEN` are **secret_text** bindings. Only names
and types were inspected; no secret values were retrieved. The active version's
source establishes a Wrangler deployment with non-repository policy overrides;
this API metadata cannot prove the exact original CLI flags or exclude earlier
dashboard edits. Subsequent first-release checks independently verified enabled,
unpaused and not held through public capabilities on both hosts. No admin or
signed account request was attempted.

The committed disabled defaults remain unchanged. A plain `wrangler deploy`
against those defaults is **not** the production upgrade procedure.

## Approval and prerequisites

`.github/workflows/deploy-worker.yml` dry-runs on PRs without credentials. On a
successful `native-and-reference-checks` run for main, it also dry-runs that exact
SHA. The production job is skipped unless repository variable
`WORKER_DEPLOY_ENABLED` is explicitly set to `true`. Max authorized this switch
and the first production review on November 9, 2026 (PST); the switch is now true,
with the required environment secret and seven expected-policy variables set.
No token value was read, created or committed. Each subsequent release still
requires a new, explicit production approval from Max.

Deployment prerequisites (configured for the approved first release):

1. The GitHub `production` environment must require **only Max
   (`maximusmaximus`, user ID 15719015)** as reviewer, disable administrator bypass,
   and allow protected branches only. This gate is configured. Self-review is
   allowed because the automation commits as Max; approval is still a separate
   environment-review decision and is never automated by this workflow.
2. Max must provide `CLOUDFLARE_API_TOKEN` in that environment, with the minimum
   reviewed Worker-update/read permissions. No token is committed or created here.
3. Set these **non-secret production-environment variables** from the currently
   active live bindings, not from the disabled repository defaults:
   `POA_ESCROW_ENABLED`, `POA_ESCROW_NETWORK_WRITES`, `POA_ESCROW_NEW_NAMES`,
   `POA_ESCROW_ADDRESS`, `POA_ESCROW_PER_TX`, `POA_ESCROW_DAILY`,
   `POA_ESCROW_ENGINE_SHA256`, `POA_ESCROW_PARAMS_SHA256`. Missing values fail closed.
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

Max separately approved the first release at 8:19 PM PST on November 9, 2026.
Workflow `42754711881` attempt 2 deployed main
`16108c8894e7fad8588af4b41053d5183208332f`, deployment
`007ab4f5-bd8b-4500-81c0-3db7c275c999`, version
`d4fc3995-7a2a-4a49-85ff-41b3c554667f` at 100%. Rollback version is
`46459dd0-989d-46dc-ad79-c8b24a867595`. All seven live public policy bindings were
unchanged; public escrow capabilities reported enabled/unpaused/not held and the
same wallet/limits. `/v1/escrow/account` requires a signed wallet query and was
not called. Both hosts passed health/capabilities/UI and read-only MCP checks.
The proxy passed POST/body/Accept/protocol forwarding and Origin/version/Accept
rejections. The reviewer rules/admin-bypass restriction were not changed.

The switch remains true; later main releases wait for Max's new production review.
Do not treat that first approval as standing permission. Cart v2 was not included
and is not deployed by merging its source. Never paste an API-token value into a
PR or inbox.

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
| `POA_ESCROW_ENGINE_SHA256` | `e01abd959dd0439dd89af8e8c187d1bed3897deb2a855a615e7dfa2d0222f1fb` |
| `POA_ESCROW_PARAMS_SHA256` | `6a5451ccd3109bb861e12dc31788fe368e0f974f89c41b1e4c8bfab178101101` |

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
Merging later source does not configure the proxy, grant approval or deploy it.

## Pin transition (repin)

Approved by Max on Nov 11 2026 (t108s1102). Set the production environment variables
`POA_ESCROW_REPIN_ENGINE_SHA256` / `POA_ESCROW_REPIN_PARAMS_SHA256` to the new pins. The next gated
deploy then (1) prechecks that the live Worker still has the current pins, (2) refuses unless
`network-facts` advertises exactly the new pins and the served `client/poa.mjs` hashes to the
new engine pin, (3) writes only those two bindings (`--keep-vars` keeps everything else), and
(4) post-checks the new live version. Afterwards set `POA_ESCROW_ENGINE_SHA256` /
`POA_ESCROW_PARAMS_SHA256` to the new values and delete the two repin variables. Pins are not part of
the persisted escrow policy digest, so a repin does not trigger `ESCROW_POLICY_CHANGED`.
Rollback: `wrangler rollback` to the previous version restores its bindings.

## POA new-name checkout

Approved by Max on Nov 13 2026 (t136u, 3:20 PM PT). The committed Wrangler default
stays `POA_ESCROW_NEW_NAMES=false`. Set the production environment variable
`POA_ESCROW_NEW_NAMES` to `approved-v1`. The next gated deploy then (1) prechecks
the current seven live escrow bindings, allowing this binding to be absent,
(2) writes only `POA_ESCROW_NEW_NAMES=approved-v1` (`--keep-vars` keeps everything
else, including pause/hold state, the escrow wallet and limits), and (3) post-checks
the new live version. Later deploys require the live binding to remain `approved-v1`
and do not rewrite it. This does not change prices, pins, the escrow wallet or
paused/held behavior.

| Variable | Expected value |
| --- | --- |
| `POA_ESCROW_NEW_NAMES` | `approved-v1` |
