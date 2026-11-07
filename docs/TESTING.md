# Test surfaces

Tests use generated, unfunded local Ed25519 keys, synthetic genesis balances and injected deterministic clocks. No real PoA endpoint is called. The reference fixtures explicitly select sample prices/fees/increments; these are not economics recommendations or a production choice.

- `npm run typecheck`: strict TypeScript including unchecked-index checks.
- `npm test`: Node test runner; cryptographic forgery/domain replay, strict parser, amount bounds, pinned emoji aliases/counterexamples, timing/bid races, exact refunds/fees/conservation, idempotency/nonces, rights/leases/options/consent, generation replay, metadata/records, fsynced journal/restart/torn-tail/corruption/lock, actual HTTP/CLI/MCP paths. The model-based property case executes 200 seeded mixed bid/refund/rejection steps against an independent balance/credit model.
- `npm run smoke`: actual localhost HTTP service, actual CLI subprocesses, stdio MCP, in-process test-only clock advancement, complete auction/refund/finalize/child/fixed resale flow, durable restart, cleanup, and real headless Chromium read-only UI/XSS/injection/digest parity checks. No public writes, uploads or network state changes. Only loopback API/browser requests occur inside the harness.
- `npm run unicode:audit`: explicit supported-subset/source/license check; not a full emoji/artwork conformance claim.
- `npm run security`: tracked/unignored artifact/material checks (values never printed) and npm advisory audit.
- `bash scripts/gitleaks.sh`: official pinned release/checksum verification; default + PoA bearer rules on working directory and all Git history, always redacted. Only exact public name-ID hash lines in the engine-generated static snapshot are narrowly allowlisted for the generic-key rule; the builder/tests verify their derivation. Other fields and all other files remain scanned. CI installs it temporarily and uploads nothing.

`test/helpers.ts` generates keys at runtime. Only the CLI sign test/smoke writes an ephemeral PKCS#8 signer under an OS temporary directory, mode 0600, removed in `finally`; no fixture secret is committed. Source artifacts and evidence must not include private product documents or runtime signer/data files.

These tests do not establish native PoA adoption, cross-chain atomicity, consensus time/finality, cryptographic compatibility with a hosted wallet, pin persistence, economic suitability, a full independent security audit or production scalability. Unsupported capabilities are rejected/absent rather than represented by passing fake adapter tests.

CI uses an explicit Ubuntu 24.04 runner rather than a moving latest image, matching the pinned Playwright browser/system dependencies. All checks run without user secrets or deployment permissions.

## Static Pages coverage

`npm run pages:smoke` builds the actual public bundle, serves it under `/poa-domains/` without any API, then uses Chromium to verify null-backend bootstrap, rendered fixture names/children/records/auctions, all 17 handoff digests and exact caps, inert injection text, duplicate-input rejection, static GET-only repo-subpath requests, zero console errors and a resource-size budget. The bundle is built from the implemented engine; no existing account/treasury key, external state, IPFS upload or real transaction is involved. CI runs this coverage before uploading the exact same static directory.
