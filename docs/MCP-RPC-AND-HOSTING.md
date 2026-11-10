# Runtime boundary and hosting checks

## MCP RPC regression

The strict MCP parser deliberately produces null-prototype records. `quote_domain`
forwarded its validated arguments directly as a query. workerd RPC rejects that
prototype before the real Durable Object method runs; the gateway correctly
reported `REGISTRY_UNAVAILABLE`. REST constructed an ordinary record and worked.
The fix copies the validated, flat string filters to an ordinary record at the
DO RPC boundary. Duplicate-key, schema, secret-field and authentication validation
are unchanged. This is not a retry or an upstream registry outage.

`cloudflare/test/mcp-real-do.mjs` bundles the production gateway and `PoaRegistry`,
uses a real local workerd SQLite Durable Object binding and denies every outbound
request. It exercises both host routes, every read-only tool, ASCII/emoji quote
parity with REST, a disposable signed preview, and unchanged committed state.
It reproduced the production quote failure before the fix. The older golden and
agent-journey fixtures use in-process adapters, so cannot catch RPC serialization.

### RPC argument audit

- MCP reads, resource templates and prompts share the gateway backend: plain query
  copy; method/path/request ID are primitive strings.
- MCP preview/submit share that backend: authenticated signed packets are JSON
  text before RPC. No parser record crosses the boundary in a signed packet.
- REST reads use `Object.fromEntries(URLSearchParams)`; signed intents use JSON text.
- Escrow public reads use `Object.fromEntries`; commands and admin use JSON text.
- Backup export takes a primitive kind. Restore uses the existing ordinary JSON
  decoder and stays isolated from the live singleton. No backup/admin logic changed.
- Registry replies use ordinary envelopes containing JSON text.

## Escrow display freshness (not authorization)

The former display cache set its ten-second expiry at probe start. A slow probe
could still be running when another display request started a second one. The
new cache shares one pending promise regardless of elapsed time and starts its
TTL only when both upstream reads settle. A successful cached result also expires
at the unchanged financial freshness-age boundary, whichever comes first.

Display reads have one shared 15-second transport deadline (including fallback
aliases/body reads), so a successful roughly 3–12-second response plus processing
is not called stale solely for crossing the financial request-time budget. They
still run every existing chain, pin, epoch, checkpoint, rollback, source-freshness,
fee and 90-second policy-age check. Both sibling reads settle before caching.
The display and financial reads share monotonic checkpoint observations; display
cannot erase or bypass a rollback pin. Capabilities takes its pause/halt snapshot
AFTER the slow read, so a pause change during I/O is not shown as the old state.
The real-DO regression reproduced that stale-snapshot race before its fix.

Every financial operation still calls the uncached `fresh()` lane. Its independent
12-second request/deadline check and all financial, signature, freshness, pin,
pause, accounting and limit gates remain unchanged. A display success is never an
authorization. No escrow binding, key, wallet, config, policy or limit changed.
The additive public diagnostics contain only bounded reason codes, checked time,
latency numbers and per-read timings—not raw exceptions, URLs, node responses,
request bodies, keys or user identifiers. Real upstream timeouts and pin/staleness
failures still hold payments; this does not hide an upstream outage.

Unit tests prove single flight past the old expiry, settlement TTL, age expiry,
strict uncached rejection while display is pending/cached, shared rollback pins,
protocol mismatch holds, bounded errors, and unchanged financial rejection over
12 seconds. A production-gateway/real-DO regression uses a synthetic 11-second
local node response and verifies one shared pair and unchanged paused/setup holds.

## GitHub Pages security limits

The landing page retains its existing, centrally generated restrictive meta CSP
(self-hosted scripts/styles, no inline/eval code, exactly the two official public-
node GET paths). It now also declares the previously missing `no-referrer` meta
policy. There is one CSP, not a second broader/conflicting source policy. Scriptless Terms keeps its own restrictive meta CSP and
has the same referrer policy. Worker responses retain their existing HTTP policy.

GitHub Pages does not honor the Worker's `_headers`. A meta policy cannot set
HSTS, X-Content-Type-Options, Permissions-Policy, COOP, response CORS/cache headers,
or enforce `frame-ancestors`; the latter is deliberately not claimed in the meta
CSP. Those remaining response-header controls require a separately approved
hosting/proxy change. The static mirror is not security-header equivalent to the
Worker. No such infrastructure change is included here.

## Historical browser diagnostics

The WebKit hard-navigation diagnostic is an upstream provisional-document loader
issue, not an unhandled application promise or same-origin CORS policy. A new
non-keepalive read during replacement can be reported as an access-control
`pageerror` even when its rejection is caught. Upstream:
https://github.com/microsoft/playwright/issues/43120.

The prior event-bound local reproduction compared unchanged `82a2b833` and feature
`b0c9e972`: 12/12 no-navigation reads per version succeeded; 12/12 caught reads
started during held replacement emitted the same native diagnostic; 24 requests
already in flight at replacement did not. Changing financial code, enabling
keepalive, filtering page errors, weakening tests, or hiding real failures is not
a safe fix for that engine behavior. Existing strict three-browser suites remain
unchanged and the limitation is documented rather than suppressed.

The historical Firefox Terms-popup layout timeout was separately caused by
reusing/resizing a page after popup navigation. PR #61 already uses a fresh browser
context per viewport and tests the popup independently. No blind retry is a fix.
