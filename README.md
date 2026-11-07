# PoA domains — production-only availability guard

Public site: https://maximusmaximus.github.io/poa-domains/

**The native naming registry is unavailable. This repository is not production-ready native PoA naming.** The public site displays only application availability. It does not display simulated ownership, balances, auctions, records or transaction receipts, and has no signing or transaction handoff form.

## Production entry points

The default CLI, API and MCP never initialize a reference ledger, read supplied key/configuration files, connect to a provider, or fall back to test data. There is no flag, credential, environment switch or endpoint override that enables registry operations.

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run build
node dist/src/cli.js status       # availability metadata; operational:false
node dist/src/cli.js ready        # unavailable; exits 1
node dist/src/cli.js mcp          # stdio; registry_status is the only tool
npm start                        # status-only API on http://127.0.0.1:8787
```

The status-only API has no ownership or settlement backend:

| Path                                     | Current behavior                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /healthz`                           | HTTP 200, process alive, `registryReady:false`                               |
| `GET /readyz`                            | HTTP 503, `NATIVE_NAMING_UNAVAILABLE`                                        |
| `GET /v1/status`, `GET /v1/capabilities` | Availability metadata, `operational:false`, empty native actions, no backend |
| Registry reads and writes under `/v1/`   | HTTP 503, `accepted:false`, `submitted:false`, no state or receipt           |

Production CLI signing, preparation, handoffs, submission, state/receipt/nonce/resolve/export commands are rejected. Supplied `--config`/`--data` are rejected without file access. Supplied provider URLs and key/input/output paths do not enable processing. Status metadata is not a live network probe; process liveness is not registry readiness.

`npm run pages:build` emits exactly seven public availability assets into `_site/`. The builder imports no fixture generator or reference engine. The browser only reads relative configuration/status JSON and rejects demo modes, backend overrides, forged ready flags and extra ledger fields. Prior generated demo files are removed during a validated rebuild; unexpected artifacts or symlinks fail the build. GitHub Pages hosts no `/v1` API.

## Verify

Node 22.15+ is required (tested with Node 24). CI uses Ubuntu 24.04 and locked dependencies.

```sh
npm run check
bash scripts/gitleaks.sh
```

The complete check includes production guard/API/CLI/MCP regressions, production smoke, the retained isolated reference test suite, both browser test surfaces, Unicode subset audit and npm advisory checks. Tests use ephemeral unfunded keys and synthetic fixtures only where explicitly testing the reference engine; no real PoA state is changed. [Test details](docs/TESTING.md).

## Explicitly isolated reference implementation

`src/reference-cli.ts`, `src/reference-server.ts`, `src/reference-mcp.ts`, `src/reference-demo.ts` and `reference-web/` are local test/reference tools, not production services. They are never loaded by production entry points or the public bundle. The fixture snapshot generator and its static test builder live under `test/`; their output is temporary and not published.

`npm run reference:demo` explicitly opens the local reference UI. `node dist/src/reference-cli.js ...` is the reference-only CLI. Its `serve --config PUBLIC_CONFIG.json --data /private/runtime/local-data --port 8787` accepts only the local reference profile and opens a synthetic journal. Do not use it with real assets or a real treasury key. The reference signer consumes only ephemeral/private local test files; no key belongs in a frontend, URL, request parameter, log or repository.

The fixture reserved names are exactly `system` and `admin` (`src/config.ts`); these are not an approved production reservation policy. Fixture fees, reserves, assets and bid increment likewise are not approved production economics or custody choices.

### Reference engine capabilities (not native operations)

- Deterministic replayable, atomic single-writer state machine; authenticated rejections roll back economic/title state.
- Supply-one permanent root deeds; root ascending auctions and fixed resales; child fixed sales/resales and free transfers.
- Standard 1-hour minimum + 1-hour quiet; premium 24-hour minimum + 24-hour quiet. Every auction has at least 24-hour announcement notice and an immutable single asset. Per-name permissionless closing; no global queue or hard duration cap.
- Full replacement bid funding, current-state increment checks, immediate full outbid credits, independent refund withdrawal, exactly-once settlement and title locks.
- Explicit required fixture configuration: strict EOS-style >10% candidate or configurable strict-basis-point/minimum-unit candidate; reserves, fees, assets and reject-high-self-raise policy. None are approved production settings.
- Parent-signed listed/open standing offers; permanent children or absolute-expiry leases with explicit grace, grace resolution/management, guaranteed or co-signed negotiated renewal. Sold rights survive parent transfer; unfilled prior-holder offers do not.
- Holder + parent consent for child retirement; permanent retired paths remain reserved. Leased reallocation increments generation and cannot revive an old deed's signatures.
- ASCII `a-z0-9`, case-folding and optional `poa:` input prefix; root/direct child only; no hyphens. Explicit Unicode **17.0 subset: 140 aliases / 29 base emoji tokens**. One normalized sequence counts as one of 1–32 label tokens; 1–3 is premium. See [Unicode policy](docs/UNICODE.md).
- Ed25519 intent signatures binding local network, genesis, registry, policy, normalization, action, exact versions/generation, nonce, deadline, beneficiary and amount caps. Stable idempotency and explicit unknown-outcome queries.
- Required IPFS **CIDv1/base32/raw/sha2-256** canonical JSON metadata witness and append-only CID history, without gateway fetch or pinning. Typed wallet, HTTPS service and IPFS records; no delegated controller.
- Bounded integer base-unit strings up to `2^127-1`, conservation checks per synthetic asset, duplicate-key/unsafe-field rejection and conservative localhost HTTP limits.
- Fsynced checksummed journal, full replay verification, exclusive writer lock, torn-tail recovery and immutable configuration manifest. UI and normal resolver read committed local state only.
- All **17 implemented actions** use the same signed-intent endpoint and CLI/MCP submission path. UI generates inert human instructions, exact unsigned body/digest and matching API/CLI/MCP material. It never signs or writes.

## Actual limitations

This independently runnable reference is **not a native PoA extension or adopted naming/NFT protocol**, has no consensus/ingress proof or network transaction adapter, and is not safe for real assets. There is no external-chain settlement, bridge, oracle, custody service, identity linking, arbitration/dispute mechanism, post-bid outage cancellation or key recovery. Such actions are absent/unsupported, not administratively improvised.

The journal replays the complete history; there is no checkpoint acceleration, horizontal writer coordination or authenticated public resolver proof. Filesystem integrity and the local operator/clock are trusted. A stale writer lock after a crash requires operator verification/recovery, not automatic lock stealing. State growth and public reads are not production-scale DoS defenses. UI state can be stale: `asOf` and sequence describe the last local commit, not elapsed wall time or chain finality.

Unicode coverage and CID codec support are intentionally limited and explicit. Initial leases use a disclosed absolute expiry, not a moving fill-time duration. Consensual retirement/negotiated renewal cannot add or alter encumbrances while the parent is auction-locked; original guaranteed options remain exercisable. No full economic simulation, native-chain integration test or independent security audit is claimed.

## Publication and security

CI has contents-read permission. The main-only Pages workflow checks production guards and all reference tests in a sanitized environment, uploads only `_site/`, and grants Pages-write/OIDC-write only to the separate official deployment action. No workflow, production entry point or frontend uses repository secrets or treasury configuration. No real account, signer, funds, IPFS upload or protocol deployment is involved.

[API boundaries](docs/API.md) · [Security](SECURITY.md) · [Unicode subset](docs/UNICODE.md)

No project-wide license has been selected; vendored Unicode data carries its own license.
