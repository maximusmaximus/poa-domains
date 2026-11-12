# Disabled custodial escrow module

This module is **off by default** and keeps the payments UI neutral while disabled and retains the registry’s `livePoA: false` capability. Mock tests are not evidence of mainnet readiness.
It is a bounded, single-custodian implementation, not native naming escrow.

## Boundaries

- One registry SQLite Durable Object coordinates the escrow wallet's outgoing nonce
  lane, ledger, bids, refunds, and title reservations. Practice balances and starter
  grants are never escrow assets. Only verified incoming transfers credit funds.
- The supported market path is fixed-price resale or auction of an existing, unencumbered permanent deed.
  No new-name issuance, leases, renewals, or new dispute rules are introduced.
  The seller chooses a positive reserve; existing premium/standard auction durations,
  quiet windows, strict >10% bid increment, no highest-bidder self-raise, and registry
  fee basis points are retained. Escrow API amounts are six-decimal POA strings;
  internal accounting uses integer micros, not floating point.
- While any escrow auction is open or settling, **all ordinary registry writes are
  conservatively held** to preserve title and signed-transfer nonce reservations.
  Reads continue. These reservations survive disabling the feature.
- An external payout and a registry name transfer are **not atomic**. The durable
  saga is `PAYING -> TITLE_PENDING -> COMPLETE`. Seller/fee payments must be verified
  final before a local SQLite transaction commits the signed title transfer and
  settlement journal. If consent expires, payment is not repeated: title remains
  reserved until the seller supplies a valid `repair-title` consent. There is no
  automatic refund after any uncertain or verified payout.
- A custodian/runtime/account compromise can drain held money. Worker secrets do not
  protect against compromised application code. No independent security approval or
  independent consensus-proof verification is implied by this module.

## Gates and credentials

The committed Wrangler configuration has `POA_ESCROW_ENABLED=false` and
`POA_ESCROW_NETWORK_WRITES=false`. Caller inputs cannot override either value.
An enabled instance still starts **paused**, requires an explicit public
`POA_ESCROW_ADDRESS`, positive `POA_ESCROW_PER_TX` / `POA_ESCROW_DAILY` limits, and
an authenticated administrator. The native transport also requires public
`POA_ESCROW_ENGINE_SHA256` and `POA_ESCROW_PARAMS_SHA256` version pins; a different
node-advertised engine/parameter version holds operations. These pins detect changes,
not prove that an engine is safe. Policy changes against an existing ledger fail closed.
Signing and transport submission additionally require the server-side write gate
`POA_ESCROW_NETWORK_WRITES=approved-v1`.

The only signing-key input is the Worker secret `POA_ESCROW_KEY`, a base58-encoded
32-byte Ed25519 seed. It is loaded lazily after both gates and its derived address
must match the configured public escrow address. No key is returned, logged, placed
in SQL, included in application backups, or accepted in HTTP commands. The secret
must never be placed in a query string, repository, local env file, or command argv.
`ESCROW_ADMIN_TOKEN` is a separate Worker secret (at least 32 characters).
There is no wallet creation, enrollment, generic signing, or generic send endpoint.

## Administrative API

`POST /v1/admin/escrow` accepts exact `application/json`, a bearer admin credential,
no browser Origin/fetch metadata, and at most 64 KiB. Disabled/unauthenticated requests
return 404. Never put the bearer value in a URL. Actions:

- `{"action":"status"}`: private ledger state and pending outcomes.
- `{"action":"pause","paused":true}`: immediate administrative hold; false unpauses
  but does not clear a reconciliation or restored-archive halt.
- `{"action":"reconcile"}`: compare checkpoint-aligned observations and liabilities.
- `{"action":"tick"}`: recover known transactions, auto-expire abandoned auctions,
  complete titles, or prepare one eligible outgoing transfer. A recovery alarm does
  the same when the write gate is on.
- `{"action":"rebroadcast"}`: re-transmit the exact retained signed bytes of an
  `UNKNOWN` outgoing transfer if and only if it is unseen on-chain and the wallet's
  ledger `next_nonce` still matches the transfer's nonce.
- `{"action":"command","packet":{"command":...,"signature":...}}`: a separately
  actor-signed request. The admin credential alone cannot create seller/bidder consent.

The signed command is sorted-key, whitespace-free JSON:

```
{
  "domain": "poa-domains.escrow.v1",
  "chainId": "poa-mainnet-1",
  "registryId": "<exact registry id>",
  "actor": "<payer or seller public poa1 address>",
  "key": "<unique idempotency key>",
  "expires": 2000000000,
  "action": "intent",
  "params": {"amount": "1.000000"}
}
```

The actor signs those exact UTF-8 canonical bytes with Ed25519; signature is base58.
Domain, chain, registry, actor, expiry, and full payload are authenticated. A reused
actor/key with a different payload conflicts. Query private status after any ambiguous
HTTP outcome instead of creating a new payment/request key.

Command parameter schemas (all fields required; no extras):

| Action | Parameters |
|---|---|
| `intent` | `amount` (returns unique intent, exact memo, public recipient) |
| `detect` | `intent`, `txid` |
| `list` | `name`, `price` (fixed-price escrow listing) |
| `buy` | `auction`, `amount` (exact fixed price; reserves credited funds) |
| `view` | no parameters (public signed account read only) |
| `open` | `name`, `reserve` |
| `bid` | `auction`, `amount` |
| `cancel` / `expire` | `auction` |
| `withdraw` | `amount` (original payer only; no redirect) |
| `settle` / `repair-title` | `auction`, `transfer` (seller-signed existing registry transfer packet) |
| `issue` | `name`, `amount`, `registration` (buyer-signed `issueFromTreasury`; **OFF** unless `POA_ESCROW_NEW_NAMES=approved-v1`; see NEW-NAME-CHECKOUT.md) |

Outbid/cancel/expiry create original-payer refund obligations. Pausing or a network
hold does not erase liabilities. Expiry without executable seller consent refunds
instead of assuming a sale. New commands other than cancel/expire require fresh
network status and reconciliation. Reconciliation mismatches persist a halt and
quarantine observation without crediting unexplained funds; there is no generic
remote "clear halt" endpoint.

## Native transport and finality

The narrow codec follows public `https://minepoa.com/go.md` and
`https://minepoa.com/client/poa.mjs`: recursively sorted JSON excluding `sig`, Ed25519,
base58 signatures/address keys, SHA-256 unsigned-body transaction ids, sequential
sender nonces, recent accepted parents, checkpoint-cutoff-aware timestamp, six decimals.
The complete native engine is not imported or executed.

The adapter is fixed to `https://minepoa.com`, bounded responses, timeouts, and no
redirects. It verifies transfer signature/id/chain/body, recipient, original payer,
exact amount and intent memo. It accepts finality via five node-reported peer
attestations or node-reported checkpoint coverage at a matching checkpoint cut.
**This explicitly trusts the node's validity, attestation count and checkpoint/anchor
assertions.** A user-supplied `final` flag or HTTP 202 does not establish finality.
Independent quorum/anchor proof verification is not implemented.

Checkpoint-only balance is compared only with covered known incoming/outgoing
transactions at the same checkpoint cut, not open-window balances. An unsupported
response schema, missing freshness/chain/cutoff/receipt context, stale status, fee
change, inconsistent cut, nonce gap, unavailable node, or asset mismatch holds writes.
The native context reader deliberately refuses oversized snapshots (>8 MB) or an
unestablished enrolled-sender nonce rather than guessing. These guards may prevent
operation against a node that omits required observations. Source `stale: false`
and a recent valid `as_of` are required; observing a checkpoint locally never
substitutes for source freshness.

Before any network effect, exact signed bytes, tx id, nonce and cap reservation are
durable. `SIGNED` is pre-I/O; `UNKNOWN` is committed before the first submit. Recovery
may send a proven pre-I/O retained payload once. Automatic `UNKNOWN` recovery is
lookup-only. The explicit admin `rebroadcast` action may resend only the exact
retained signed bytes after fresh lookup, nonce and reconciliation checks. Not-found,
timeout, rejection or date changes never authorize a new nonce, signature or replacement payment. Unresolved amounts remain
reserved across restart/day change; transaction and daily caps include reservations.

## Persistence and tests

Escrow records are append-only, payload-bound, checksummed and replayed; no mutable
snapshot is independently trusted. Ledger invariants require credited assets to equal
available balances + bid holds + non-final payout/refund liabilities. Outbox nonces
cannot be reused. New work atomically reserves its worst-case recovery records
within the 2,000-record admission budget, including pending deposits and capped
withdrawal chunks. A finite drain-only lane may exceed this budget for legacy
backlogs or emergency entries: each permitted transition must strictly reduce
remaining recovery work. It cannot admit new money or no-op entries. Emergency
pause/halt controls remain available beyond that admission cap and repeated
identical controls do not append another record. Near capacity,
withdraw the full available balance or the existing per-transaction maximum, not
arbitrarily small partial amounts. This is not unrestricted-volume storage.

Private financial records are exported only inside the existing RSA-OAEP/AES-GCM
backup envelope, alongside encrypted registry bootstrap keys. The escrow Worker secret
is excluded. Isolated restore validates the escrow journal, forces a pause record, and
sets a permanent `RESTORED_ARCHIVE_READ_ONLY` halt so unpausing a restored archive can
never replay old payouts; live-target restore is refused.

Run `npm run escrow:test`: 63 unit/adversarial/model tests (including 1,200 generated
model transitions) plus 18 real local workerd/SQLite integration checks and 27 real
HTTP admin-boundary workerd/SQLite checks. The admin suite uses synthetic credentials
and intercepts every chain request; it covers strict-parser RPC transport, native
fetch/redirect behavior, freshness holds, and disabled/authentication gates. The runtime
suite uses the real engine/journal/title adapter, a simulated PoA transport, full
process restarts after deposit and payout, and concurrent recovery. It tests no real
wallet, network signature submission, deposit or payout. Existing checks remain
separate. Deterministic public test keys are never operational credentials.

## Public API and agent-first screens

`GET /v1/capabilities` advertises the escrow capability. `GET /v1/escrow/capabilities`
reports enabled/paused/held, the public receiving address, limits and source freshness.
Disabled deployments return a neutral “POA payments not open”; all other escrow routes
are absent, without creating a ledger or contacting the chain.

When enabled, `GET /v1/escrow/market`, `/domain?name=...` and
`/intent?id=...&txid=...` expose bounded sanitized market/history and receipt projections,
never journals, title-consent packets, signing material or administrative credentials.
Receipt previews never credit a deposit: even an observed final transfer remains “seen”
until its payer signs `detect` and the ledger independently verifies and credits it.

`POST /v1/escrow/intent`, `/withdraw`, `/account` and `/command` require the exact
`{command,signature}` envelope above, with a valid actor signature and an expiry within
one hour. The first three routes bind the actions `intent`, `withdraw`, and `view`.
The generic command route permits only the documented actor-signed market/deposit actions,
not administrator controls. Unknown post-dispatch/storage outcomes return 503 with
`accepted:"unknown"`; retain/retry the exact packet and query the signed account, never
create a fresh payment or request key. Account reads expose only the signed payer's balances and
refunds and do not schedule recovery. JSON envelopes are bounded to 64 KiB with strict
UTF-8, duplicate/prototype-key rejection and no extra fields. Cross-origin browser calls
and admin credentials on public writes are refused. Admin routes remain token-only.

The **My POA** tab supplies copy-prompts for an agent to sign requests externally;
the browser never signs, asks for keys, or saves signed requests to disk/storage. A
payment intent returns the exact recipient, amount and unique `poadomains:<intent>` memo.
Funding an account is not a bid, reservation, purchase, or title transfer. After final
credit, the payer separately signs `bid` or `buy`. Seller consent is a separately signed
registry transfer inside `settle`, never a direct transfer submitted ahead of payment.
Fixed-price reservations still require seller handover and final seller/fee payments.
Existing registry-only fixed offers are not silently converted; their owner must cancel
the old encumbrance before creating a POA escrow listing. No lease support is added; POA new-name issuance exists behind an OFF flag (NEW-NAME-CHECKOUT.md). Refund requests have no redirect field: payment goes only to the original payer.

`npm run escrow:ui` drives these exact signed public HTTP boundaries and the real
workerd/SQLite ledger/title store against the isolated mock chain: deposit waiting/seen/
final/refund, auction settlement, fixed-price handover, stale/pause holds, and OFF screens.
It checks Chromium/Firefox/WebKit at all seven supported viewports (including 320px),
and captures clearly labeled MOCK screens at 390px and 1280px. No real funds are used.
