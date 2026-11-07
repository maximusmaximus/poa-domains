# Security boundaries

The production surface is an unavailable-registry guard, not a service for real funds or title. It has not received an independent security audit.

## Production isolation

The main CLI/API/MCP import no reference engine, signer, client, store or fixture generator. Their import graph and command/HTTP/RPC rejection behavior are regression-tested. Configuration, backend URLs, supplied files and mode flags cannot enable native naming. Registry readiness is always false; liveness must never be used as a readiness signal.

Production entry points never inspect supplied signer/config files or inherited credentials. The public build imports availability metadata, the fixed public native reader and selected web assets. It neither generates nor consumes test accounts, balances, deeds, bids or settlement receipts. A structurally valid availability document is not a cryptographic network capability proof; explicit native reads only contact fixed documented public HTTPS routes.

The production HTTP server is loopback-only, bounded by connection/time limits, and rejects registry requests without parsing their bodies. Production MCP advertises read-only availability/native-network/native-receipt tools. No field can activate a registry or simulated fallback.

## Credentials

Local tests and CI require **no external credentials or manually configured GitHub Secrets**. Test keys are generated at runtime, held in memory or temporary 0600 files outside the repository, and removed by the smoke harness. No live PoA API key, personal token, wallet secret, pinning credential or chain account is used.

The isolated reference CLI reads a private file only in the local signer process. Keys are never input to the HTTP/MCP service, static UI, signed-intent payload, URL, configuration, Git commit or logs. Do not store real keys in the working tree even if ignored. Ignore rules, artifact checks and Gitleaks are defense in depth, not a guarantee of detecting every secret. Protocol metadata and records are public data; never put credentials or private information there.

Authenticated integrations must receive credentials through GitHub Actions Secrets or a private runtime environment, never frontend files, commits, request parameters, URLs or logs. The current CI only uses the automatic platform checkout context, with read-only permission and no persistent checkout credential. No personal token is supplied to application code, CI tests or scanners.

## Isolated reference trust model (not production)

- Genesis configuration is explicit, hash-bound, frozen, and trusted synthetic input. Only `local:` chain IDs and `local-fixture` asset descriptors are accepted. The fixture issuer may announce unsold roots; it has no holder-signature or seizure bypass.
- The constructor injects an authoritative local clock. HTTP and MCP expose no clock adjustment or funding endpoint. Tests advance a `ManualClock` inside their own process. System clock samples wall time once, then uses monotonic elapsed time. Restart skew/backward execution fails closed.
- Ed25519 signatures cover canonical bytes `[domain, body]`. Intent ID is SHA-256 over canonical `['local-intent-id/v1', body]`. Amounts are decimal strings; ordinary nonnegative integers are safe JavaScript integers. Object keys sort lexically, arrays preserve order, UTF-8 is used, lone surrogates/control strings/duplicate JSON keys are rejected. This is an explicit local encoding, not a claim of an adopted chain standard.
- Primary nonce is per signer. Bad authentication/domain/nonce does not consume it. An admitted authenticated business rejection consumes its nonce and stores one durable rejection, changing no economic/title state. Identical idempotency retry returns that outcome before nonce/expiry checks; changed body for the same signer/request ID conflicts. All co-signers sign exactly the same body; primary nonce/request identity makes consent replays ineffective.
- Full bids are funded atomically; refunds belong to original payer, title to the signed beneficiary. All sale fees are deducted from price (integer floor), never added outside the amount cap; local network fee is exactly zero. Gift transfer has no sale fee in this fixture profile. No cross-asset netting occurs.
- Failed, duplicate and self bids do not extend quiet time. Bid interval ends exclusively at current close eligibility; finalization is allowed at equality. Seller/payer or seller/beneficiary self-bids are rejected, but hidden Sybil shill bids and ordering/censorship attacks are not solved.
- Parent auction locks block new grants, ordinary parent mutations and discretionary new obligations. Already sold child management, transfers and original guaranteed options remain independent. Encumbrance version commits grant policy, not child mutable records/owner or formula-derived guaranteed renewal state.
- Metadata witnesses bind canonical name and immutable rights policy. Current owner, derived lease expiry and authoritative records remain registry state, not writable metadata authority. No URLs are fetched by execution. Descriptive values remain untrusted inert data.
- Each complete journal line binds prior checksum and recomputed state root; replay verifies signatures, time/order, nonces and all transitions. This detects corruption/inconsistent replay but is **not consensus or protection against a malicious local administrator rewriting trusted inputs/history**.
- A receipt is acknowledged after journal fsync when journal mode is enabled. A durability exception halts further writes and returns UNKNOWN; restart/replay and query the original intent. Do not infer failure or rebuild an intent after timeout. The memory-only demo explicitly reports volatile durability.

## Journal recovery

Keep configuration and local data private and backed up. Do not commit runtime data or test keys. Shutdown closes HTTP and releases `writer.lock.local`. A killed process may leave that lock: verify the recorded process is no longer running and that no other writer owns this directory before an operator removes it. Do not bypass a live lock. Only an unterminated final journal fragment is automatically truncated. A complete corrupt line or changed config manifest fails closed. There is no administrative API for replacing ownership, funds, signatures or journal checks.

## Isolated reference HTTP / UI

The server binds `127.0.0.1`, validates Host, rejects browser-origin POSTs, limits request size/time/connections and does not log bodies or raw exceptions. GET CORS is public; state contains no signer keys. The CLI/MCP client accepts only literal loopback HTTP origins with no credentials, path, query, fragment or redirect. No arbitrary fetch proxy exists.

UI content uses `textContent`, never `innerHTML`, eval or embedded executable instructions. The browser makes GET requests only. Generated data/code is untrusted: independently check allowlisted origin, policies, normalization, canonical name, deed/generation/version, asset, beneficiary, caps, nonce and deadline, and obtain signing authorization. A copied handoff is not authorization to sign. The static configuration may contain only a public API origin; no credential or wallet fields. Headless tests exercise XSS/injection and compare browser/engine digests, but do not constitute a full browser security audit.

Use GitHub's private vulnerability-reporting channel if the repository enables one. Do not publish secret material in issues.

## Public production-only Pages

Only eight public assets are published from `_site/`. There is no fixture JSON, ownership explorer, handoff generator, signer or configurable backend URL. A public-node observation is build-time, unverified and expires after 15 minutes. The browser uses textContent and fixed same-origin GET paths only; forged ready/native fields, extra ledger fields, backend overrides and demo mode fail closed. Generated stale demo files are removed after strict path/type checks; unknown files or symlinks stop the build rather than being uploaded or silently deleted.

Builds/tests run with an allowlisted environment (HOME/PATH/LANG), excluding inherited credentials; no environment dump occurs. Reference fixture keys are generated only by isolated automated tests/local reference tools, never the public build. Test-only static output uses a temporary directory and is removed after browser verification.

The trusted-main-only Pages build job has contents-read permission. The separate deployment job has Pages-write/OIDC-write, checks out no source and runs the pinned official action. Pull-request jobs cannot trigger deployment or receive those privileges. Only `_site/` is uploaded, never reference test output, repository/runtime data, keys, environment files or evidence.

## Native read and cryptographic boundaries

The public transport uses a literal documented HTTPS origin/chain/path allowlist, no redirects, strict TLS, bounded response/time/concurrency limits and a curl subprocess with `--disable` first and an explicit PATH/LANG-only environment. It never invokes a shell or reads curl config, credentials, cookies, netrc, key files or an inherited credential environment. Untrusted endpoint strings cannot be passed through API/CLI/MCP. Raw upstream bodies/errors are never logged or forwarded. Fractional public-node JSON parsing is separate from integer-only registry amounts.

All native information remains `node-reported-unverified`; no JSON final/covered flag becomes proof of settlement. Cross-network and inconsistent snapshots fail closed. In-process rollback/release-drift tripwires do not authenticate the initial baseline, detect all reorgs or survive restart. There is no persistent native-state backup, authoritative resolver, independent operational monitoring service or audited native naming deployment here.

Wire envelope signatures and checkpoint signer quorum are mathematical checks only. Native transfer signing is a library-only explicit caller callback and supports a restricted documented body subset, exact decimal strings (six native POA decimals) and bounded 127-bit units. It infers no balances, nonces, timestamps, policies, permissions or settlement. Native naming signatures are unsupported. Checkpoint preimages omit chain ID, so signer quorum alone cannot prove chain binding or anchoring. Trusted signer sets/thresholds are caller inputs, never inferred from untrusted node reports. All finality claims remain false.
