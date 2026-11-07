# Verification surfaces

Production-only does not mean omitting test fixtures. All synthetic execution is explicitly confined to local reference tests/tools; no fixture data is published or accepted by production entry points. Keys are ephemeral, unfunded and generated during testing. No test changes real PoA state or uses an existing account/treasury credential.

- `npm run typecheck`: strict TypeScript including unchecked-index checks.
- `npm test`: retained engine, cryptography, parsing, timing/races, balances/credits/fees, lease/child rights, metadata, Unicode, journal/restart and API/CLI/MCP parity tests. The independent seeded balance model runs 200 bid/refund/rejection steps. Added tests cover production CLI file/URL/config/signing rejection, valid reference packets rejected by production HTTP, empty production actions, MCP status-only behavior, fail-closed mode/provider injection, production import isolation and artifact allowlisting/stale-demo removal.
- `npm run production:smoke`: temporary production status service; liveness versus readiness, registry reads/writes unavailable, no simulated settlement, CLI cannot sign/submit/load fixture configuration, clean shutdown.
- `npm run smoke`: retained complete local reference auction/refund/finalize/child/fixed-resale flow using actual reference HTTP/CLI/MCP, journal restart and Chromium. This uses `reference-cli.js` and `reference-server.ts`, never production entry points. Temporary signer files/service data are removed.
- `npm run reference:pages:smoke`: retained 17-action/digest/cap/injection/browser coverage for the isolated reference UI. Test-only snapshot generation/build lives under `test/`; its static server/output are temporary and cleaned up, not uploaded.
- `npm run pages:smoke`: actual seven-file public production bundle under `/poa-domains/` with no backend. Chromium verifies unavailable status, absence of holdings/forms/handoffs, rejected forged native/ready/state/config payloads, GET-only same-origin fixed files, no backend/localhost writes or requests, zero console errors and a size budget.
- `npm run unicode:audit`: pinned explicit Unicode subset/source/license check, not full emoji/artwork conformity.
- `npm run security`: tracked/unignored credential/material checks, LF/action-SHA checks, npm advisory audit. Values are never printed.
- `bash scripts/gitleaks.sh`: official checksum-verified pinned scanner; default rules plus PoA bearer detection on working tree, complete Git history and the public bundle, always redacted. No snapshot-hash allowlist is needed for the production artifact.

`npm run check` runs all of these except the separate Gitleaks installer, which CI executes afterward. Builds clean stale compiled output first. CI uses Ubuntu 24.04, Node 24 and the dependency lockfile. Public dependencies and the browser must be installed before offline tests; npm advisory/scanner installation separately use public network services.

These checks verify implemented isolation and the reference state machine. They do not establish native protocol adoption, wallet compatibility, real settlement, consensus finality, production economics, security audit, scalability or pin persistence. Passing tests must not be reported as an operational native naming registry.
