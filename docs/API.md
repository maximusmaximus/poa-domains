# Production boundary

The default executable is `dist/src/cli.js`. `status` and `capabilities` report `mode:production-only`, `operational:false`, `nativeNamingVerified:false`, `backend:null`, `actions:[]`, `accepted:false`, `submitted:false` and `code:NATIVE_NAMING_UNAVAILABLE`. `ready` returns the same document with exit 1. This is static application availability metadata, not a live chain capability check.

`serve` starts a loopback status-only HTTP server. `/healthz` is process liveness (200; registryReady false); `/readyz` is registry readiness (503). `/v1/status` and `/v1/capabilities` return availability metadata (200). Every other `/v1/` path, including state, resolve, nonce, receipts and intent submission, returns HTTP 503 with the unavailable document. No request body is used for settlement. No native receipt or ownership data exists here.

Configuration/ledger injection into the production server is rejected; only a numeric listening port is accepted. The production CLI rejects config/data options without reading files, and rejects supplied URLs, key/input/output paths and all registry/signing/handoff commands. There is no environment-based reference fallback.

`cli.js mcp` supports the initialization handshake, read-only `registry_status`, ping and empty resources/prompts. Only `registry_status` is listed. Reference tool names such as `read_state` and `submit_intent` return `isError:true` with the unavailable document; no provider, fixture, ledger or signer is loaded.

Public Pages only serves a fixed availability interface. It has no API, state explorer, wallet, unsigned-body builder or transaction form. Browser configuration is exactly `mode:production-only`, `publicApiBase:null`, `statusFile:./status.json`; any demo mode, provider override or simulated state fails closed.

## Isolated reference protocol — tests/local research only

Everything below applies only to `dist/src/reference-cli.js`, `src/reference-server.ts`, `src/reference-mcp.ts` and `reference-web/`. These are not production or live PoA interfaces. Production entry points deliberately reject their configuration and transaction packets.

# Implemented local interface

All paths are under an explicitly allowlisted `http://127.0.0.1:PORT`. No API key or cookies. GET is read-only. POST is for a complete previously authorized Ed25519 packet from a local signer; browser POSTs are refused.

| Method/path                  | Result                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /v1/capabilities`       | Exact policies, local registry identity, explicit emoji table and required payload keys for every action    |
| `GET /v1/state`              | Complete committed local state/hash/sequence/time plus observed local server time and durability            |
| `GET /v1/resolve?name=...`   | Canonical name and deed only if resolvable as of last commit; no pending owner                              |
| `GET /v1/nonce?signer=...`   | Next logical nonce                                                                                          |
| `GET /v1/receipts/INTENT_ID` | Durable local receipt, or 404 `UNKNOWN_OUTCOME` (not proof of rejection)                                    |
| `POST /v1/intents`           | Atomic local success/business-rejection receipt after journal fsync (or explicitly volatile in memory mode) |

## Envelope

Packet: `{ "body": BODY, "signatures": { "ed25519:PUBLIC_HEX": "SIGNATURE_HEX" } }`.

The body requires every field below, with no unknown keys:

```
domain revision chainId genesisHash registryId policyHash normalizationHash
signer coSigners requestId nonce notBefore deadline
maxTotal maxNetworkFee action params
```

- Capability fields bind the exact local configuration/registry; `domain=poa-domains.local.intent.v1`.
- Principal is `ed25519:` plus 64 lowercase hex digits; signatures are 128 lowercase hex digits. No private bytes are accepted. `coSigners` is sorted/unique and excludes the primary signer; every listed signer must sign the same body.
- `nonce`, versions, generation and times are nonnegative safe integers. `requestId` is 1–64 ASCII letters/digits/underscore/hyphen. Validity is `[notBefore, deadline)` in authoritative local seconds.
- Amounts/caps are canonical nonnegative decimal strings, up to `2^127-1`; prices/bids/payments must be positive. `maxTotal` caps the exact signer debit; `maxNetworkFee` must be string `"0"` in this profile. No floating point token conversion.
- `expectedDeedId` plus version protects generation/ownership. An initial root announcement uses `expectedDeedId:null, expectedVersion:0`. Current deed IDs/versions, parent owner version, offer version, auction version and refund-credit version come from committed state, never guessed defaults.
- Names in a signed body must already be canonical. CLI preparation/UI normalize supported inputs, show the result and preserve exact operation fields. All 17 actions are available through `submit`; there are no privileged alternative mutation routes.

## Actions

`GET /v1/capabilities` exposes the exact required-key list. Additional keys are rejected, not ignored.

| Action             | Required payload / execution rule                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `announceAuction`  | `name,asset,reserve,openAt,expectedVersion,expectedDeedId,metadata`; root only, authorized fixture issuer or root holder, 24h notice; immutable terms              |
| `bid`              | `auctionId,expectedVersion,asset,amount,beneficiary`; open/current funded ladder, signed cap; refund to payer, title to beneficiary                                |
| `finalize`         | `auctionId,expectedVersion`; any signer at/after eligibility, high exists; mint/transfer + proceeds once                                                           |
| `closeNoBid`       | `auctionId,expectedVersion`; any signer after empty minimum window; no sale                                                                                        |
| `cancelAuction`    | `auctionId,expectedVersion`; issuer/seller only before open and without bids; not an outage mechanism                                                              |
| `withdrawRefund`   | `auctionId,asset,expectedVersion,amount`; available credit only, same payer and asset, no fee                                                                      |
| `createChildOffer` | `parent,parentDeedId,expectedOwnerVersion,asset,price,validUntil,rights,labels,maxUses`; parent signs; `labels:null` is open, or an explicit canonical label list  |
| `fillChildOffer`   | `offerId,expectedVersion,expectedGeneration,label,asset,amount,metadata`; valid original parent authority, available label, fixed price; no fresh parent signature |
| `cancelOffer`      | `offerId,expectedVersion`; original seller cancels unsold standing/fixed offer                                                                                     |
| `sellFixed`        | `name,expectedDeedId,expectedVersion,asset,price,validUntil`; current unlocked holder; root/child resale                                                           |
| `buyFixed`         | `offerId,expectedVersion,asset,amount`; checks original owner, deed and encumbrance versions before payment                                                        |
| `transfer`         | `name,expectedDeedId,expectedVersion,recipient`; holder, unchanged terms; no fresh parent approval for child                                                       |
| `setRecords`       | `name,expectedDeedId,expectedVersion,records`; holder; HTTPS service, wallet chain/address, raw-CID IPFS only                                                      |
| `setMetadata`      | `name,expectedDeedId,expectedVersion,metadata`; holder; verified new witness appends history, cannot rewrite rights                                                |
| `renewLease`       | `name,expectedDeedId,expectedVersion,asset,amount,termSeconds`; holder exercises frozen guarantee, or current parent co-signs negotiated extension                 |
| `expireLease`      | `name,expectedDeedId,expectedVersion`; permissionless objective expiry/grace/options check; never permanent expiry                                                 |
| `revokeChild`      | `name,expectedDeedId,expectedVersion,parentOwnerVersion`; current child holder primary + current parent co-signature; permanent path remains reserved              |

### Rights and metadata

Permanent rights: `{kind:"permanent"}`. Leased rights:

```
{
 kind:"lease", settlementAsset:"POA", expiresAt:INTEGER,
 graceSeconds:INTEGER, resolveDuringGrace:BOOLEAN, manageDuringGrace:BOOLEAN,
 renewal:{kind:"negotiated"}
 // OR renewal:{kind:"guaranteed",price:"UNITS",termSeconds:INTEGER,
 //             windowSeconds:INTEGER,maxRenewals:INTEGER,optionUntil:INTEGER}
}
```

All values are parent-chosen explicit terms in the signed offer. `expiresAt` is the absolute initial expiry; it is not reset by sale/transfer. The original rights policy remains immutable; derived expiry and renewal count are separate deed state. Guaranteed exercise occurs from current expiry minus window through exclusive `optionUntil`, within remaining renewals, at the original asset/price/term. New expiry is `max(currentExpiry,executionTime)+termSeconds`; renewals pay the current parent holder (fee included in price). Reallocation waits for expiry+grace **and** any surviving option deadline. Negotiated extensions require child and parent signatures, before grace ends. In this profile the explicit `manageDuringGrace` flag controls both record/metadata changes and transfers during grace.

Metadata is `{cid,document:{schema:"poa-domains.metadata.v1",name,rightsHash,description}}`. Use `rightsHash(rights,parentDeedIdOrNull)` and `cidFor(document)` from the SDK. CIDv1 raw SHA-256 addresses exact canonical JSON bytes. Both witnesses and hashes are verified without fetching/pinning. Descriptions are inert untrusted public data. Current ownership/derived expiry/records cannot be overridden by a CID.

### Receipts and errors

Business receipt: `intentId,requestId,signer,sequence,time,status,code,result`, plus HTTP `accepted:true`, explicit durability/finality label. Status is `succeeded` or `rejected`. Rejections such as `STALE_VERSION`, `MIN_RAISE`, `AMOUNT_CAP`, `LEASE_OBLIGATION` make no economic/title changes; admitted nonce/outcome bookkeeping still advances. Invalid authentication/domain/nonce is a bounded nonadmission error `{code,accepted:false}`. Durability failure returns HTTP 503 with `accepted:"unknown"`, halts writes and requires restart/query. Unknown receipt is not permission to change nonce or generate a new request.

## Reference CLI / MCP / static interface

`node dist/src/reference-cli.js prepare --url ORIGIN --file PUBLIC_INPUT.json` requires all non-capability body fields explicitly; it fills only pinned capability identity and canonicalizes names. `handoff --file unsigned.json` returns inert instructions, body/digest and API/CLI/MCP material. `sign --file unsigned.json --key-file /private/runtime/signer.pem --out signed.json` is a local signer utility; repeat `--key-file` for co-signers. Output files are created exclusively, mode 0600. `submit --url ORIGIN --file signed.json` sends the exact packet; `receipt`, `nonce`, `state`, `export`, `resolve`, `capabilities` are read-only. No automatic retry or spend escalation.

The isolated `reference-cli.js mcp --url ORIGIN` stdio MCP adapter implements the **2025-11-25** initialization handshake, `tools/list`, `read_state`, `read_capabilities` and `submit_intent`. Every implemented action uses the same packet under `submit_intent`. This is a bounded adapter, not a claim of full protocol-version compatibility. No HTTP MCP transport or signing service is exposed.

The isolated reference UI lists all 17 reference actions and builds unsigned local test handoffs. It lives in `reference-web/`, not in the production Pages artifact. Its static fixture variant is exercised only in a temporary test directory. Production CLI/MCP/API do not consume these bodies, states, receipts or fixture capabilities.
