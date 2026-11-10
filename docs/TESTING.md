# Verification surfaces

Production-only does not mean omitting test fixtures. All synthetic execution is explicitly confined to local reference tests/tools; no fixture data is published or accepted by production entry points. Keys are ephemeral, unfunded and generated during testing. No test changes real PoA state or uses an existing account/treasury credential.

- `npm run typecheck`: strict TypeScript including unchecked-index checks.
- `npm test`: retained engine, cryptography, parsing, timing/races, balances/credits/fees, legacy lease replay, permanent ownership admission and child rights, metadata, Unicode, journal/restart and API/CLI/MCP parity tests. The independent seeded balance model runs 200 bid/refund/rejection steps. Added tests cover production CLI file/URL/config/signing rejection, valid reference packets rejected by production HTTP, empty production actions, MCP read-only behavior, fail-closed mode/provider injection, production import isolation and artifact allowlisting/stale-demo removal.
- `npm run production:smoke`: temporary production status service; liveness versus readiness, registry reads/writes unavailable, no simulated settlement, CLI cannot sign/submit/load fixture configuration, clean shutdown.
- `npm run smoke`: retained complete local reference auction/refund/finalize/child/fixed-resale flow using actual reference HTTP/CLI/MCP, journal restart and Chromium. This uses `reference-cli.js` and `reference-server.ts`, never production entry points. Temporary signer files/service data are removed.
- `npm run reference:pages:smoke`: retained 17-action/digest/cap/injection/browser coverage for the isolated reference UI. Test-only snapshot generation/build lives under `test/`; its static server/output are temporary and cleaned up, not uploaded.
- `npm run pages:smoke`: actual sixteen-file production bundle under `/poa-domains/`, with no naming backend. Chromium intercepts the two fixed official-node GETs using synthetic local test responses, verifies current refresh behavior, retryable failures, unavailable naming guards and rejected forged configuration/status payloads. No real network mutation or registry state is created. `npm run test:live-network` separately checks the dependency-free browser reader parser, bounds, deadlines, schemas, coalescing and incident behavior.
- `npm run native:smoke`: explicit, separately invoked real GET-only official-node integration through CLI/API/MCP; unknown-receipt safety, disabled settlement and clean shutdown. It uses no account or secret and fails if the upstream node is unavailable. It is not an offline or mocked integration test.
- Native unit regressions cover strict transport/SSRF boundaries, duplicate keys/limits, network mismatch, malformed or stale observations, receipt forgery/unknown outcomes, rollback/release drift, signer race snapshots, native signature/chain/hash forgery, exact amounts, 256 Base58 property roundtrips and explicit-trust checkpoint quorum without overstated finality. Browser-only controlled responses test observation expiry, injected fields and forged readiness; no controlled response is published.
- `npm run unicode:audit`: pinned explicit Unicode subset/source/license check, not full emoji/artwork conformity.
- `npm run security`: tracked/unignored credential/material checks, LF/action-SHA checks, npm advisory audit. Values are never printed.
- `bash scripts/gitleaks.sh`: official checksum-verified pinned scanner; default rules plus PoA bearer detection on working tree, complete Git history and the public bundle, always redacted. No snapshot-hash allowlist is needed for the production artifact.

`npm run check` runs all of these except opt-in live smoke and the separate Gitleaks installer, which CI executes afterward. Builds clean stale compiled output first. CI uses Ubuntu 24.04, Node 24 and the dependency lockfile. Public dependencies and the browser must be installed before offline tests; the Pages build is network-independent and the browser alone can make the existing two fixed read-only public-node checks; npm advisory/scanner installation separately use public network services.

These checks verify implemented isolation and the reference state machine. They do not establish native protocol adoption, wallet compatibility, real settlement, consensus finality, production economics, security audit, scalability or pin persistence. Passing tests must not be reported as an operational native naming registry.

## Local emoji spelling check

The read-only web checker recognizes exact emoji-only Unicode 17 spellings and counts 1–32 whole emoji sequences. It runs locally with fixed options and does not transmit, persist, trim or normalize the entered spelling. Results describe format only, not name availability, ownership, pricing or registration. Native registry operations remain disabled. The bundle contains only the pinned public Unicode runtime, data, license and source provenance plus the checker module and external stylesheet; candidate equivalence data is not included.

`npm run test:emoji-format` runs the 59 portable checker tests, including all 5,216 pinned accepted spellings and rejection of nine standalone components. The legacy `unicode:audit` command checks the older reference subset; it does not establish semantic ownership normalization. Browser-specific checker tests are accounted separately from Node DOM-stub tests.

The integrated emoji format browser gate runs with `npm run test:emoji-format:browser` after building `_site` and is included in `npm run check`. It serves only the sixteen built public files under the deployment subpath, enforces the unchanged document meta CSP, and checks the native-disabled guard and normal/runtime/CSS/data failure states. Official-node transport in this gate is explicitly synthetic and fulfilled locally; it makes no upstream node requests and does not establish live-node reliability, naming availability, ownership, mobile input, or screen-reader support.

## Shared Node ↔ Worker contract and UI modules

`node cloudflare/test/routes-contract.mjs` starts both the real Node HTTP server
and local workerd with the production Worker HTTP adapter. Identical deterministic
Engine fixtures receive the same disposable signed packet and exact resend. It
compares status and body on every shared registry route, malformed input, bounds,
browser-write rejection, `/d/` and `/p/` deep links on `poadomains.grok.me`, and UI
module assets. Its registry RPC seam is volatile and **local only**: the unchanged
production-DO integration suite separately exercises SQLite, restart/recovery and
title reservations. Neither test performs upstream PoA actions.

`src/registry-routes.ts` owns the registry routes; ingress limits, host checks,
durable failure handling and the escrow-title reservation remain adapter-owned.
The escrow sender, signing policy, reconcile transport and committed config are
unchanged. `reference-web/escrow.js` is formatting-only; a normalized executable
fingerprint proves parity with the pre-refactor program, in addition to all the
existing escrow suites.

`web/network-schema.js` is the single status projection. Browser and native
observations share the full pinned status-plus-facts checks. The Worker's existing
status-only availability probe uses an explicit compatibility profile: it must not
start requiring the separate facts endpoint or change live write-hold behavior in
a refactor. Paired malformed-report and compatibility tests lock this distinction
in. This helper does not intercept escrow's live reconcile requests.

The explorer has explicit state, router, render, cart, poll, handoff, search,
domain and ideas modules. `buildCartItem` alone derives cart action parameters
from capabilities/current state. One content revision stamps the complete ES
module graph, including cycles, so a proxy cache cannot mix module versions.

## Error contracts

`test/errors.test.mjs` inventories nested literal `need`/`Fault` calls, rejects
undocumented codes and stale generated JSON/docs, verifies never-sent vs unknown
submissions and malformed acknowledgements, and runs real CLI 2/3/4/5 processes
plus MCP error-data schema checks. `cloudflare/test/error-contract.mjs` uses local
workerd with a test-only RPC seam to compare every enabled escrow endpoint's exact
success bytes and signed request forwarding against the untouched legacy facade,
and covers off mode, hidden admin auth, unknown outcomes and network Retry-After.
All outbound calls are denied locally. Existing escrow suites are unchanged and
remain mandatory alongside this additive gate.
