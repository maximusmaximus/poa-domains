# Production Worker hosting

The **Worker is the production host** for the explorer and Durable Object registry.
`src/app.ts`, the filesystem Node server and Docker are local development only.
`livePoA:false`, the registry signing domain, state-machine semantics and economics are retained. Hosting does not establish
native PoA consensus, ownership, balances or transaction finality.

## Live backend

The Worker `poadomains-registry` is deployed at:

`https://poadomains-registry.maxinfeld-artshow.workers.dev`

Health reports `durability: durable-object-sqlite`. Bootstrap Ed25519 role keys are
generated once inside the Durable Object and are never returned by an endpoint.
The private R2 bucket supports scheduled backups (see `docs/cloudflare-backups.md`).
Escrow has separate live policy variables and existing Cloudflare secret bindings;
never redeploy the committed disabled defaults over those live values. See the
[reviewed deployment gate](worker-deploy.md). The existing Worker
`artshow-crypto-cron` is untouched. Configured public explorer URL:
`https://poadomains.grok.me`.

## Design

- Workers Static Assets serves the unchanged explorer and emoji font. `_headers` supplies
  MIME and security headers. `/healthz`, `/v1/*`, `/d/*`, `/p/*`, `/mcp`,
  `/.well-known/*` and `/llms.txt` reach the Worker first. Reserving discovery paths
  does not implement MCP or discovery responses. Logs sample at 1.0 so error events
  are not discarded by the former 10% head sample.
- `REGISTRY.getByName("poa-mainnet-registry-v1")` is the sole writer for this entire
  registry. Do not change that name, binding or class on upgrades without a reviewed migration.
  The global ledger currently requires atomic cross-name/balance operations, so it is
  deliberately not sharded.
- The original Engine is reused unmodified. A subclass reports `durable-object-sqlite`
  consistently in health, capabilities, state and receipts, not `fsynced-journal`.
- A SQLite transaction stores immutable configuration, all five generated Ed25519 role
  keys/principals and the 15 showcase seed commits atomically on first initialization.
  Keys are generated once, stored only in private DO storage, checked against the pinned
  principals on restoration, and never returned by an endpoint. Private bootstrap uses a
  bounded private JSON codec (multiline PEMs); public intents and journal records retain
  the strict public JSON parser. Initialization errors are sanitized.
- Hash-chained commits remain the authoritative log. Restoration replays signatures,
  sequence, checksums, policy binding and state hashes before accepting traffic.
- The synchronous append seam uses SQLite transactions, with no awaits between version/
  nonce reads and append. RPC output gates are left enabled, preventing successful
  acknowledgment before storage confirmation. Storage faults discard the object; the
  caller gets an unknown outcome and must query its original receipt, not sign a new intent.
- Fixed-size bounded HTTP decoding, exact content type, browser-write rejection and
  no-store dynamic responses are retained. Signed requests are not retried by this adapter.
- The Worker and CLI allowlist `poadomains.grok.me` and the exact workers.dev hostname
  above (not arbitrary workers.dev); the existing Grok Build `.grok.me` support remains.

## Local verification

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run cf:typecheck
npm run cf:test
npm run cf:dry-run
npm run cf:dev
```

`cf:test` runs real local workerd/SQLite on 127.0.0.1:18879, launches a rendered browser,
submits locally generated signed intents, tests concurrent nonce/idempotency/security
rules, fully stops and restarts Wrangler using the same `.local-cf-state` path, and compares
all principals, every state table, state hash and receipts. It stops its own servers.
Do not run it concurrently with `cf:dev` on the same port or persistence path.
It records public evidence in `cloudflare/test/evidence/`; the directory is ignored.
Browser binaries must be installed locally for the Playwright smoke.

`.local-cf-state/` contains private bootstrap keys. It is ignored and restricted by the
harness; never commit, upload or expose it. Removing it resets this local registry's
identity and history. Local SQLite persistence is **not proof of replicated cloud
durability or remote PITR**. The identical durability string names the storage backend;
local mode is explicitly declared in test reports.

Production upgrades use [deploy-worker.yml](../.github/workflows/deploy-worker.yml),
not an ad-hoc `wrangler deploy`. The workflow is currently disarmed and has no
Cloudflare token. Its protected `production` environment requires Max's review;
it checks current green main and live policy, dry-runs locally, then preserves
server-side escrow variables and secrets. [Operator prerequisites and safety tests](worker-deploy.md).
No deployment was made by this hosting change.

Do not publish or import local private key data from `.local-cf-state/`.

## Explorer host

`PUBLIC_EXPLORER_URL` is `https://poadomains.grok.me`. Keep the existing Grok Build
proxy as the front door: a read-only zone lookup on November 9, 2026 found no
`grok.me` zone in the configured account, so no failing `custom_domain` route is added.
Direct domain binding needs Max or Grok Build. The stateless full-site proxy must forward root HTML, app/shared JS,
style, icon, config, font, `/healthz` and all `/v1/*`; preserve raw POST bytes, content type,
query strings, statuses and no-store headers; preserve Origin and Sec-Fetch-Site; strip
unrelated cookies/authorization; never cache API state/receipts, retry POSTs, follow
redirects for signed writes, accept a user-controlled upstream, or fall back to another
registry. This Worker does not enforce a shared proxy-token header.

## Current limits

This adapter is a bounded-volume reference registry. A full-state clone, hash and invariant
scan occur on every write; replay history is unbounded; one Durable Object's CPU/memory and
head-of-line blocking constrain scale. Keep configuration and keys with backups; do not
silently regenerate identities or automatically roll back economic state. Hosting here does
not claim an independent production/security audit or native PoA clearance.

Sources:
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
