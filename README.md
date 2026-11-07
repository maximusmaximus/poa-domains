# PoA domains — local reference engine

Working TypeScript naming/deed registry with a localhost API, CLI, MCP adapter and read-only agent-handoff UI.

**This is not deployed to PoA and does not create live PoA NFTs.** Balances and deeds are synthetic local state, not tokens, real funds or blockchain finality. No mining, live writes, IPFS uploads, wallet connection or deployment is performed.

## Run and verify

Node **22.15+** (tested with Node 24), npm and Linux are supported.

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run typecheck
npm test
npm run smoke
npm run unicode:audit
npm run security
# Requires a git commit for history scanning:
bash scripts/gitleaks.sh
# Read-only synthetic in-memory UI, http://127.0.0.1:8787
npm run demo
```

The offline smoke command runs a temporary localhost service and real headless browser. It exercises signed auction, bids, refund, finalization, child sale, fixed resale, CLI/API/MCP parity and journal restart; then removes temporary signer files and service data. After dependencies/browser installation it needs no internet or external credentials. `npm run security` separately queries the public npm advisory service; the scanner installation downloads an official checksum-verified release.

## Implemented

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

## Interfaces

```sh
node dist/src/cli.js capabilities --url http://127.0.0.1:8787
node dist/src/cli.js state --url http://127.0.0.1:8787
node dist/src/cli.js resolve --url http://127.0.0.1:8787 --name poa:alpha
node dist/src/cli.js mcp --url http://127.0.0.1:8787
```

[API and action schemas](docs/API.md) · [Local persistence and security](SECURITY.md) · [Testing](docs/TESTING.md)

`serve --config PUBLIC_CONFIG.json --data /private/runtime/local-data --port 8787` opens an explicitly configured local journal. `fixtureConfig()` in `src/config.ts` produces a **synthetic fixture**, not a production manifest. Public keys and synthetic genesis balances are configuration; signing keys are never configuration. The demo discards its ephemeral signing keys and is intentionally read-only to its viewer. Use the smoke command for a complete executable transaction example.

The CLI `sign` command accepts only a private local file path (mode 0600) and emits a signed packet, never a key. It is a local testing utility, not a compatibility claim for actual PoA wallets or hosted signing. Never give private key bytes to an agent, frontend or tool parameter. `export` emits public local state; no audit data is automatically published to GitHub.

## Actual limitations

This independently runnable reference is **not a native PoA extension or adopted naming/NFT protocol**, has no consensus/ingress proof or network transaction adapter, and is not safe for real assets. There is no external-chain settlement, bridge, oracle, custody service, identity linking, arbitration/dispute mechanism, post-bid outage cancellation or key recovery. Such actions are absent/unsupported, not administratively improvised.

The journal replays the complete history; there is no checkpoint acceleration, horizontal writer coordination or authenticated public resolver proof. Filesystem integrity and the local operator/clock are trusted. A stale writer lock after a crash requires operator verification/recovery, not automatic lock stealing. State growth and public reads are not production-scale DoS defenses. UI state can be stale: `asOf` and sequence describe the last local commit, not elapsed wall time or chain finality.

Unicode coverage and CID codec support are intentionally limited and explicit. Initial leases use a disclosed absolute expiry, not a moving fill-time duration. Consensual retirement/negotiated renewal cannot add or alter encumbrances while the parent is auction-locked; original guaranteed options remain exercisable. No full economic simulation, native-chain integration test or independent security audit is claimed.

Source and CI live on GitHub. The optional static `web/config.json` holds only a public API origin; no Pages setting or deployment is enabled by this repository. CI has `contents: read`, no deployment job and needs no user secrets. No project-wide license has been selected; vendored Unicode data carries its own license.
