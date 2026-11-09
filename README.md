# PoA domains — native public reads and isolated naming reference

Public site: https://maximusmaximus.github.io/poa-domains/

**The native naming registry is unavailable. This repository is not production-ready native PoA naming.** The public site displays application availability and, when obtainable, an explicit current read-only observation of the official native node. It does not display simulated ownership, balances, auctions, records or transaction receipts, and has no signing or transaction handoff form.

## Production entry points

The default CLI, API and MCP never initialize a reference ledger, read supplied key/configuration files, accept a caller-selected provider, or fall back to test data. Explicit native reads contact only the documented public node; they do not enable naming. There is no flag, credential, environment switch or endpoint override that enables registry operations.

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run build
node dist/src/cli.js status       # availability metadata; operational:false
node dist/src/cli.js ready        # unavailable; exits 1
node dist/src/cli.js native-network # real public status + engine/parameter hashes
node dist/src/cli.js native-receipt --id TXID # reported native receipt, not finality
node dist/src/cli.js mcp          # stdio; registry_status/native_network/native_receipt
npm start                        # read-only API on http://127.0.0.1:8787
```

The read-only API has no ownership or settlement backend:

| Path                                     | Current behavior                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /healthz`                           | HTTP 200, process alive, `registryReady:false`                               |
| `GET /readyz`                            | HTTP 503, `NATIVE_NAMING_UNAVAILABLE`                                        |
| `GET /v1/status`, `GET /v1/capabilities` | Availability metadata, `operational:false`, empty native actions, no backend |
| `GET /v1/native/network`                 | Public node report; HTTP 502 on invalid/unavailable data, no fixture fallback |
| `GET /v1/native/receipts/TXID`            | Reported native receipt; unknown never authorizes retry or finality |
| Registry reads and writes under `/v1/`   | HTTP 503, `accepted:false`, `submitted:false`, no state or receipt           |

Production CLI signing, preparation, handoffs, submission, state/receipt/nonce/resolve/export commands are rejected. Supplied `--config`/`--data` are rejected without file access. Supplied provider URLs and key/input/output paths do not enable processing. Status metadata is not a live network probe; process liveness is not registry readiness.

`npm run pages:build` emits exactly fifteen public assets into `_site/`. The builder imports no fixture generator or reference engine. The browser validates relative configuration/status JSON, then reads only the two fixed official-node status and network-facts URLs. It rejects demo modes, backend overrides, forged ready flags and extra ledger fields. Prior generated demo files are removed during a validated rebuild; unexpected artifacts or symlinks fail the build. GitHub Pages hosts no `/v1` API.

## Implemented native components

- Fixed documented, chain-scoped public HTTPS reads from `https://minepoa.com/chain/poa-mainnet-1/api/status`, `network-facts` and `receipt/TXID`. No authentication or writes. **Node 22.15+ and a standard `curl` executable are required.** The curl subprocess disables configuration, follows no redirects, and receives only an explicit PATH/LANG environment, never inherited credentials. Timeout/body/concurrency limits and strict field/duplicate-key validation fail closed.
- API/CLI/MCP expose the same native read capabilities. API observations coalesce/cache for at most 10 seconds. Chain mismatch, inconsistent epoch/quorum fields, future checkpoints and invalid provenance hashes are rejected. Process-memory monitoring latches observed checkpoint rollback, epoch rollback or engine/parameter hash drift. This is not a consensus/reorg detector and the baseline is not persisted across restart.
- `src/native-crypto.ts` implements the native sorted-JSON/SHA-256/Base58/Ed25519 wire subset. `verifyNativeEnvelope` checks the expected transaction hash and chain-bound signature, **not** replay validity, balance, nonce availability, PoW, adoption or finality. A library-only transfer signer accepts an explicit caller callback, decimal-string amount, nonce, parents, timestamp and chain; it loads no keys and broadcasts nothing. It supports only the documented transfer-body subset, never naming transactions; the default CLI/API/MCP expose no signing operation.
- Checkpoint signature-bundle verification requires caller-supplied expected root/height, trusted public signers and threshold. Quorum does **not** establish root computation, network binding, external anchors or finality. The upstream checkpoint-signature body has no chain ID. No unapproved signer set or threshold is selected.
- The browser reads the official node when opened or explicitly refreshed, with bounded bodies, request deadlines, strict parsing and process-memory incident detection. Duplicate refreshes coalesce; failures clear displayed values without a snapshot fallback. Observations expire after 15 minutes. The builder retains a compatibility observation document, but the browser does not consume it. The fifteen-file bundle contains no fixture ledger. An observed native ledger is not an operational naming registry.

[Exact upstream interfaces and verification boundaries](docs/NATIVE.md).

## Verify

Node 22.15+ is required (tested with Node 24). CI uses Ubuntu 24.04 and locked dependencies.

```sh
npm run check
bash scripts/gitleaks.sh
npm run native:smoke # explicit GET-only public-network smoke; requires node availability
```

The complete check includes production guard/API/CLI/MCP regressions, production smoke, the retained isolated reference test suite, both browser test surfaces, Unicode subset audit and npm advisory checks. Tests use ephemeral unfunded keys and synthetic fixtures only where explicitly testing the reference engine; no real PoA state is changed. [Test details](docs/TESTING.md).

## Explicitly isolated reference implementation & launchable registry app

`src/app.ts`, `src/reference-cli.ts`, `src/reference-server.ts`, `src/reference-mcp.ts`, `src/reference-demo.ts` and `reference-web/` are local registry/reference tools, not public Pages services. They are never loaded by the read-only production guard entry points (`src/cli.ts`, `src/server.ts`, `src/mcp.ts`) or the public Pages bundle. The fixture snapshot generator and its static test builder live under `test/`; their output is temporary and not published.

To launch the persistent full-stack PoA Domains registry application (`poa-mainnet-v1` config profile, `poa1...` Base58 Ed25519 principals, all 5,216 official Unicode 17 emoji sequences, 655 reserved root names, and fsynced journal persistence in `local-data/registry`):

```sh
npm run app                      # launches persistent registry app & Web UI on http://127.0.0.1:8787
npm run app:cli -- resolve --url http://127.0.0.1:8787 --name nexus
npm run app:cli -- state --url http://127.0.0.1:8787
npm run app:cli -- capabilities --url http://127.0.0.1:8787
```

`npm run reference:demo` explicitly opens the in-memory local reference UI. `node dist/src/reference-cli.js ...` is the reference CLI. Its `serve --config PUBLIC_CONFIG.json --data /private/runtime/local-data --port 8787` opens a durable journal for either `local-reference-v1` or `poa-mainnet-v1`. The local signer consumes only ephemeral/private local files; no key belongs in a frontend, URL, request parameter, log or repository.

The default reserved list (`src/reserved.ts`, loaded by `src/config.ts`) reserves **655 root names**: all 26 single-character ASCII letters (`a`–`z`), 129 protocol/system/network/anti-phishing names, and 500 top global brand and product names.

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

This independently runnable reference is **not a native PoA extension or adopted naming/NFT protocol**, has no consensus/ingress proof or adopted naming transaction adapter, and is not safe for real assets. There is no external-chain settlement, bridge, oracle, custody service, identity linking, arbitration/dispute mechanism, post-bid outage cancellation or key recovery. Such actions are absent/unsupported, not administratively improvised.

The journal replays the complete history; there is no checkpoint acceleration, horizontal writer coordination or authenticated public resolver proof. Filesystem integrity and the local operator/clock are trusted. A stale writer lock after a crash requires operator verification/recovery, not automatic lock stealing. State growth and public reads are not production-scale DoS defenses. UI state can be stale: `asOf` and sequence describe the last local commit, not elapsed wall time or chain finality.

Unicode coverage and CID codec support are intentionally limited and explicit. Initial leases use a disclosed absolute expiry, not a moving fill-time duration. Consensual retirement/negotiated renewal cannot add or alter encumbrances while the parent is auction-locked; original guaranteed options remain exercisable. No full economic simulation, native-chain integration test or independent security audit is claimed.

## Publication and security

CI has contents-read permission. The main-only Pages workflow checks production guards and all reference tests in a sanitized environment, uploads only `_site/`, and grants Pages-write/OIDC-write only to the separate official deployment action. No workflow, production entry point or frontend uses repository secrets or treasury configuration. No real account, signer, funds, IPFS upload or protocol deployment is involved.

[API boundaries](docs/API.md) · [Security](SECURITY.md) · [Unicode subset](docs/UNICODE.md)

No project-wide license has been selected; vendored Unicode data carries its own license.

## Offline metadata backup utility

The local Python utility in `tools/metadata-backup/` prepares and verifies exact-byte, individually reviewed metadata backups, retains imported history, and restores files locally. Run `npm run metadata:check` for its tests; they are also included in `npm run check`. Usage and security limitations are documented in [the utility README](tools/metadata-backup/README.md).

This utility supports only canonical base32 CIDv1 raw sha2-256 metadata and its deliberately narrow ASCII schema; UnixFS/DAG and the production emoji namespace are not supported by this utility. No real metadata is bundled. It does not fetch, pin, publish, synchronize GitHub backups, or enable native naming or settlement.

## Local emoji spelling check

The read-only web checker recognizes exact emoji-only Unicode 17 spellings and counts 1–32 whole emoji sequences. It runs locally with fixed options and does not transmit, persist, trim or normalize the entered spelling. Results describe format only, not name availability, ownership, pricing or registration. Native registry operations remain disabled. The bundle contains only the pinned public Unicode runtime, data, license and source provenance plus the checker module and external stylesheet; candidate equivalence data is not included.
