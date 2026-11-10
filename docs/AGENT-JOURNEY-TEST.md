# 🧪 Local HTTP MCP agent journey

Run after `npm run ci:build`:

```
node cloudflare/test/agent-journey.mjs
node --test dist/test/property-fuzz.test.js
```

The existing covered `browser-e2e` Chromium job runs the journey. Both Node22.15
and Node24 unit lanes run the deterministic property/fuzz tests automatically.
No existing command, browser, escrow job, threshold or coverage scope is removed.

A real mobile Chromium user types a search, adds a name and copies the exact v2
handoff. A scripted agent validates its deterministic IDs, complete registry
identity, snapshot hash, per-item and whole-cart caps. Every agent request is
POST `/mcp`: quote, nonce, locally sign, simulate without state/nonce changes,
submit, poll the original receipt, then finalize and resolve the owner.
The bid verifies the auction ID from the announcement receipt.

Failure cases cover a competitor outbid (abort before signing, plus actual
STALE_VERSION preview with no mutation), a reduced whole-cart cap (abort before
signing), and a response lost AFTER commit followed by one missing receipt.
UNKNOWN keeps the original budget reservation. The agent resends identical
signed packet bytes/requestId/nonce, never a replacement; sequence, balance and
nonce prove exactly one commit/debit. Stored receipt fields and submit transport
metadata are checked separately, matching the documented API contract.

## 🔒 Isolation, not production

* Fixed `http://127.0.0.1:18898/mcp`; all other targets and direct REST writes are
  rejected. The handoff's advertised production discovery URL is NEVER followed.
  All six identity fields are independently pinned to the harness-generated fixture
  BEFORE signing (also preventing a port collision/proxy from reaching production).
  Engine construction in Node derives only that independent expected identity;
  the scripted agent performs every registry read/action over HTTP MCP.
* `wrangler dev --local` uses a separate test-only entry/config with no remote
  resources, DO/R2/service bindings, accounts, secrets or escrow policy. Public
  keys are disposable and private keys exist only in process memory, never files.
* Production HTTP/MCP adapters and the real Engine run inside local workerd.
  Its registry seam is in-memory; existing real-DO persistence/recovery/contract
  suites remain mandatory and independent. This is not a production finality test.
* A fixture ManualClock advances to the real close-eligible time only when the
  test agent quotes finalize. No production clock, admin endpoint or write rule
  changes. No sleep/retry masks business-logic failures.
* Browser traffic is same-origin GET-only, service workers are disabled, escrow
  routes are forbidden. A local synthetic network read replaces the upstream.
* Worker outbound fetch is denied BEFORE dynamic production-module initialization
  (the network monitor captures fetch). Every MCP response asserts zero outbound
  attempts. Browser errors/blocked requests are failures, not ignored.
* Three independent scenarios use RFC5737 test IPs; the actual local and production
  60/min limiter remain unchanged. The existing dedicated rate-limit suite remains.
* No real PoA writes, transfers, payments, funding or production escrow actions.

Fuzz seeds `0x51f00d`, `0xcafebabe`, `0xdeadbeef` appear in test names. Bounded
checks cover strict JSON canonical round trips/null prototypes, duplicate/escaped
keys, unsafe/secret keys, malformed input, integer/depth/array/UTF8 byte limits;
exact required/optional/extra/inherited fields and nonmutation; complete intent
body counters/signers/validity/size/string-cap preservation; and both name
normalization modes, case/prefix/emoji aliases, idempotence and invalid bounds.
These are reproducible property tests, not a proof of parser completeness.

Production Worker sources, assets, configuration and escrow code/tests are unchanged.
A before/after offline production bundle hash determines that no Worker deployment
is needed for this test-only PR. Any automatically pending deploy is left unapproved
and canceled, rather than redeploying unchanged code.
