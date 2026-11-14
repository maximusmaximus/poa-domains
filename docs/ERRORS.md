# Error catalogue

Generated from `src/errors.ts`; run `npm run build && node scripts/errors-generate.mjs`.

Every API error has `{code, message, retryable, accepted, docs, requestId}`. Extra recovery/resource fields are retained. `accepted: "unknown"` means query the receipt/signed account and resend only the **exact same signed bytes**, never a new request ID. `accepted: true` on a rejected registry receipt means the rejection/bookkeeping was committed; it remains HTTP 200. Its documented error status below applies when rejected before admission.

Live escrow successes and complete signed request shapes are unchanged. The production gateway adapts errors; the internal escrow HTTP facade retains its legacy compatibility contract and tests. Off-mode capabilities remain neutral HTTP 200; other valid public escrow routes return `503 ESCROW_DISABLED` only when the flag is not true. Hidden admin authorization remains 404. Existing financial-state errors keep 409; malformed HTTP errors are classified separately. No escrow sender, reconcile, key, config or ledger code changes.

CLI exit codes: **2** local usage, **3** rejected, **4** outcome unknown, **5** network/read failure. Serialization/endpoint errors occur before fetch; a failed signed fetch is conservatively unknown, even if the transport cannot prove whether bytes left the process. There are no automatic write retries.

The legacy native-only availability document is not an operational registry/error response and retains its fail-closed schema.

## ACTION_AND_PARAMS_REQUIRED

HTTP 400; retryable: false. Action and params required. Check the documented inputs and current state.

## AMOUNT

HTTP 400; retryable: false. Amount. Check the documented inputs and current state.

## AMOUNT_CAP

HTTP 400; retryable: false. The intent exceeds its approved spending cap.

## AMOUNT_OVERFLOW

HTTP 400; retryable: false. Amount overflow. Check the documented inputs and current state.

## ARTIFACT_DIRECTORY

HTTP 400; retryable: false. Artifact directory. Check the documented inputs and current state.

## ARTIFACT_LINK

HTTP 400; retryable: false. Artifact link. Check the documented inputs and current state.

## ASSET

HTTP 400; retryable: false. Asset. Check the documented inputs and current state.

## AUCTION_ASSET

HTTP 400; retryable: false. Auction asset. Check the documented inputs and current state.

## AUCTION_CLOSED

HTTP 400; retryable: false. Auction closed. Check the documented inputs and current state.

## AUCTION_NOT_FOUND

HTTP 400; retryable: false. Auction not found. Check the documented inputs and current state.

## AUCTION_TERMINAL

HTTP 400; retryable: false. Auction terminal. Check the documented inputs and current state.

## BACKUP_FORMAT

HTTP 400; retryable: false. Backup format. Check the documented inputs and current state.

## BACKUP_SEQUENCE_MISMATCH

HTTP 400; retryable: false. Backup sequence mismatch. Check the documented inputs and current state.

## BODY_TOO_LARGE

HTTP 413; retryable: false. The request body exceeds the documented limit.

## BOOTSTRAP_FORMAT

HTTP 400; retryable: false. Bootstrap format. Check the documented inputs and current state.

## BOOTSTRAP_MISSING

HTTP 400; retryable: false. Bootstrap missing. Check the documented inputs and current state.

## BOOTSTRAP_SIZE

HTTP 400; retryable: false. Bootstrap size. Check the documented inputs and current state.

## BROWSER_WRITES_DISABLED

HTTP 400; retryable: false. Registry writes must come from an agent with a complete signed packet, not a browser.

## BUILD_DIRECTORY

HTTP 400; retryable: false. Build directory. Check the documented inputs and current state.

## CANCEL_WINDOW

HTTP 400; retryable: false. Cancel window. Check the documented inputs and current state.

## CID

HTTP 400; retryable: false. Cid. Check the documented inputs and current state.

## CID_CONTENT_MISMATCH

HTTP 400; retryable: false. Cid content mismatch. Check the documented inputs and current state.

## CLI_ERROR

HTTP 400; retryable: false. Cli error. Check the documented inputs and current state.

## CLOCK_BACKWARD

HTTP 400; retryable: false. Clock backward. Check the documented inputs and current state.

## COMMAND

HTTP 400; retryable: false. Choose one documented command. See the CLI examples in README.

## CONFIG

HTTP 400; retryable: false. Config. Check the documented inputs and current state.

## CONFIG_AND_DATA_REQUIRED

HTTP 400; retryable: false. Config and data required. Check the documented inputs and current state.

## CONSENT_REQUIRED

HTTP 400; retryable: false. Consent required. Check the documented inputs and current state.

## CONTENT_TYPE

HTTP 400; retryable: false. Send exactly application/json without content encoding.

## DEED_GENERATION

HTTP 400; retryable: false. Deed generation. Check the documented inputs and current state.

## DEED_NOT_FOUND

HTTP 400; retryable: false. Deed not found. Check the documented inputs and current state.

## DEPTH

HTTP 400; retryable: false. Depth. Check the documented inputs and current state.

## DOMAIN

HTTP 400; retryable: false. Domain. Check the documented inputs and current state.

## DUPLICATE_KEY

HTTP 400; retryable: false. Duplicate key. Check the documented inputs and current state.

## DUPLICATE_QUERY

HTTP 400; retryable: false. Duplicate query. Check the documented inputs and current state.

## DURABILITY_UNKNOWN_RESTART_AND_QUERY

HTTP 503; retryable: true. Persistence is uncertain. Query the receipt after restart; resend only the exact same signed bytes.

## EMOJI17_DATA_CORRUPT

HTTP 400; retryable: false. Emoji17 data corrupt. Check the documented inputs and current state.

## EMOJI_ONLY_LABEL

HTTP 400; retryable: false. Emoji only label. Check the documented inputs and current state.

## EMPTY_BODY

HTTP 400; retryable: false. Empty body. Check the documented inputs and current state.

## ENCODING

HTTP 400; retryable: false. Encoding. Check the documented inputs and current state.

## ENDPOINT

HTTP 400; retryable: false. Endpoint. Check the documented inputs and current state.

## ENGINE_STOPPED

HTTP 400; retryable: false. Engine stopped. Check the documented inputs and current state.

## ESCROW_ACCOUNTING

HTTP 400; retryable: false. Escrow accounting. Check the documented inputs and current state.

## ESCROW_ACTION

HTTP 409; retryable: false. Escrow action. Check the documented inputs and current state.

## ESCROW_ADDRESS

HTTP 400; retryable: false. Escrow address. Check the documented inputs and current state.

## ESCROW_AMOUNT

HTTP 400; retryable: false. Escrow amount. Check the documented inputs and current state.

## ESCROW_AUCTION_CLOSED

HTTP 400; retryable: false. Escrow auction closed. Check the documented inputs and current state.

## ESCROW_BID_INCREMENT

HTTP 400; retryable: false. Escrow bid increment. Check the documented inputs and current state.

## ESCROW_CANCEL_NOT_ALLOWED

HTTP 400; retryable: false. Escrow cancel not allowed. Check the documented inputs and current state.

## ESCROW_CHAIN

HTTP 400; retryable: false. Escrow chain. Check the documented inputs and current state.

## ESCROW_CHECKPOINT

HTTP 400; retryable: false. Escrow checkpoint. Check the documented inputs and current state.

## ESCROW_CHECKPOINT_DETAILS_REQUIRED

HTTP 400; retryable: false. Escrow checkpoint details required. Check the documented inputs and current state.

## ESCROW_CHECKPOINT_ROLLBACK

HTTP 400; retryable: false. Escrow checkpoint rollback. Check the documented inputs and current state.

## ESCROW_COMMAND_EXPIRY

HTTP 400; retryable: false. Escrow command expiry. Check the documented inputs and current state.

## ESCROW_CONSENT_EXPIRING

HTTP 400; retryable: false. Escrow consent expiring. Check the documented inputs and current state.

## ESCROW_CONTEXT_UNAVAILABLE

HTTP 400; retryable: false. Escrow context unavailable. Check the documented inputs and current state.

## ESCROW_CUT

HTTP 400; retryable: false. Escrow cut. Check the documented inputs and current state.

## ESCROW_DEPOSIT_BINDING

HTTP 400; retryable: false. Escrow deposit binding. Check the documented inputs and current state.

## ESCROW_DEPOSIT_DUPLICATE

HTTP 400; retryable: false. Escrow deposit duplicate. Check the documented inputs and current state.

## ESCROW_DEPOSIT_INTENT

HTTP 400; retryable: false. Escrow deposit intent. Check the documented inputs and current state.

## ESCROW_DISABLED

HTTP 503; retryable: true. Escrow is switched off. No escrow command was dispatched.

## ESCROW_DISTINCT_WALLET

HTTP 400; retryable: false. Escrow distinct wallet. Check the documented inputs and current state.

## ESCROW_DOMAIN

HTTP 400; retryable: false. Escrow domain. Check the documented inputs and current state.

## ESCROW_DUPLICATE

HTTP 400; retryable: false. Escrow duplicate. Check the documented inputs and current state.

## ESCROW_DUPLICATE_PAYMENT

HTTP 400; retryable: false. Escrow duplicate payment. Check the documented inputs and current state.

## ESCROW_ENCUMBERED_TITLE

HTTP 400; retryable: false. Escrow encumbered title. Check the documented inputs and current state.

## ESCROW_ENDPOINT_ACTION

HTTP 400; retryable: false. Escrow endpoint action. Check the documented inputs and current state.

## ESCROW_ENROLLED_SENDER_REQUIRED

HTTP 400; retryable: false. Escrow enrolled sender required. Check the documented inputs and current state.

## ESCROW_FEE_POLICY

HTTP 400; retryable: false. Escrow fee policy. Check the documented inputs and current state.

## ESCROW_FUTURE_CHECKPOINT

HTTP 400; retryable: false. Escrow future checkpoint. Check the documented inputs and current state.

## ESCROW_HALTED

HTTP 400; retryable: false. Escrow halted. Check the documented inputs and current state.

## ESCROW_IDEMPOTENCY_CONFLICT

HTTP 400; retryable: false. Escrow idempotency conflict. Check the documented inputs and current state.

## ESCROW_IDEMPOTENCY_KEY

HTTP 400; retryable: false. Escrow idempotency key. Check the documented inputs and current state.

## ESCROW_INCREMENT_POLICY

HTTP 400; retryable: false. Escrow increment policy. Check the documented inputs and current state.

## ESCROW_INSUFFICIENT_FUNDS

HTTP 400; retryable: false. Escrow insufficient funds. Check the documented inputs and current state.

## ESCROW_ISSUE_ACTION

HTTP 400; retryable: false. Escrow issue action. Check the documented inputs and current state.

## ESCROW_ISSUE_COMMIT

HTTP 400; retryable: false. Escrow issue commit. Check the documented inputs and current state.

## ESCROW_ISSUE_CONSENT

HTTP 400; retryable: false. Escrow issue consent. Check the documented inputs and current state.

## ESCROW_ISSUE_NAME

HTTP 400; retryable: false. Escrow issue name. Check the documented inputs and current state.

## ESCROW_ISSUE_NOT_READY

HTTP 400; retryable: false. Escrow issue not ready. Check the documented inputs and current state.

## ESCROW_ISSUE_POLICY

HTTP 400; retryable: false. Escrow issue policy. Check the documented inputs and current state.

## ESCROW_JOURNAL_CAPACITY

HTTP 400; retryable: false. Escrow journal capacity. Check the documented inputs and current state.

## ESCROW_JOURNAL_CORRUPT

HTTP 400; retryable: false. Escrow journal corrupt. Check the documented inputs and current state.

## ESCROW_KEY_IDENTITY

HTTP 400; retryable: false. Escrow key identity. Check the documented inputs and current state.

## ESCROW_KEY_OR_TRANSFER_INVALID

HTTP 400; retryable: false. Escrow key or transfer invalid. Check the documented inputs and current state.

## ESCROW_LIMITS

HTTP 400; retryable: false. Escrow limits. Check the documented inputs and current state.

## ESCROW_LOOKUP_HELD

HTTP 400; retryable: false. Escrow lookup held. Check the documented inputs and current state.

## ESCROW_MARKET_KIND

HTTP 400; retryable: false. Escrow market kind. Check the documented inputs and current state.

## ESCROW_NAME

HTTP 400; retryable: false. Escrow name. Check the documented inputs and current state.

## ESCROW_NAME_TAKEN

HTTP 400; retryable: false. Escrow name taken. Check the documented inputs and current state.

## ESCROW_NETWORK_HELD

HTTP 409; retryable: true. Escrow network held. Check the documented inputs and current state.

## ESCROW_NETWORK_WRITES_DISABLED

HTTP 400; retryable: false. Escrow network writes disabled. Check the documented inputs and current state.

## ESCROW_NEW_NAMES_OFF

HTTP 400; retryable: false. Escrow new names off. Check the documented inputs and current state.

## ESCROW_NODE_AUTH

HTTP 400; retryable: false. Escrow node auth. Check the documented inputs and current state.

## ESCROW_NODE_CHAIN

HTTP 400; retryable: false. Escrow node chain. Check the documented inputs and current state.

## ESCROW_NODE_HTTP

HTTP 400; retryable: false. Escrow node http. Check the documented inputs and current state.

## ESCROW_NODE_REDIRECT

HTTP 400; retryable: false. Escrow node redirect. Check the documented inputs and current state.

## ESCROW_NODE_RESPONSE_LIMIT

HTTP 400; retryable: false. Escrow node response limit. Check the documented inputs and current state.

## ESCROW_NONCE_CONTEXT

HTTP 400; retryable: false. Escrow nonce context. Check the documented inputs and current state.

## ESCROW_NONCE_GAP

HTTP 400; retryable: false. Escrow nonce gap. Check the documented inputs and current state.

## ESCROW_NONCE_REUSE

HTTP 400; retryable: false. Escrow nonce reuse. Check the documented inputs and current state.

## ESCROW_NOT_FINAL

HTTP 409; retryable: true. Escrow not final. Check the documented inputs and current state.

## ESCROW_NO_ADMIN_CREDENTIAL

HTTP 400; retryable: false. Escrow no admin credential. Check the documented inputs and current state.

## ESCROW_ONLY

HTTP 400; retryable: false. Escrow only. Check the documented inputs and current state.

## ESCROW_OPERATOR_SETUP_HELD

HTTP 400; retryable: false. Escrow operator setup held. Check the documented inputs and current state.

## ESCROW_OUTBOX_CORRUPT

HTTP 400; retryable: false. Escrow outbox corrupt. Check the documented inputs and current state.

## ESCROW_OUTBOX_PROOF

HTTP 400; retryable: false. Escrow outbox proof. Check the documented inputs and current state.

## ESCROW_OUTBOX_STATE

HTTP 400; retryable: false. Escrow outbox state. Check the documented inputs and current state.

## ESCROW_PARENTS

HTTP 400; retryable: false. Escrow parents. Check the documented inputs and current state.

## ESCROW_PAUSE

HTTP 400; retryable: false. Escrow pause. Check the documented inputs and current state.

## ESCROW_PAUSED

HTTP 409; retryable: true. Escrow paused. Check the documented inputs and current state.

## ESCROW_PAYOUT_LIMIT

HTTP 400; retryable: false. Escrow payout limit. Check the documented inputs and current state.

## ESCROW_POLICY_CHANGED

HTTP 400; retryable: false. Escrow policy changed. Check the documented inputs and current state.

## ESCROW_PRICE

HTTP 400; retryable: false. Escrow price. Check the documented inputs and current state.

## ESCROW_PROTOCOL_CHANGED

HTTP 400; retryable: false. Escrow protocol changed. Check the documented inputs and current state.

## ESCROW_PROTOCOL_UNPINNED

HTTP 400; retryable: false. Escrow protocol unpinned. Check the documented inputs and current state.

## ESCROW_RECEIPT_BINDING

HTTP 400; retryable: false. Escrow receipt binding. Check the documented inputs and current state.

## ESCROW_RECONCILIATION_MISMATCH

HTTP 400; retryable: false. Escrow reconciliation mismatch. Check the documented inputs and current state.

## ESCROW_REFUND_DUPLICATE

HTTP 400; retryable: false. Escrow refund duplicate. Check the documented inputs and current state.

## ESCROW_RESERVE

HTTP 400; retryable: false. Escrow reserve. Check the documented inputs and current state.

## ESCROW_ROUTE

HTTP 404; retryable: false. Escrow route. Check the documented inputs and current state.

## ESCROW_SECRET_LEAK

HTTP 400; retryable: false. Escrow secret leak. Check the documented inputs and current state.

## ESCROW_SELF_DEPOSIT

HTTP 400; retryable: false. Escrow self deposit. Check the documented inputs and current state.

## ESCROW_SELF_RAISE

HTTP 400; retryable: false. Escrow self raise. Check the documented inputs and current state.

## ESCROW_SELF_SALE

HTTP 400; retryable: false. Escrow self sale. Check the documented inputs and current state.

## ESCROW_SETTLE_NOT_ALLOWED

HTTP 400; retryable: false. Escrow settle not allowed. Check the documented inputs and current state.

## ESCROW_SIGNATURE

HTTP 400; retryable: false. Escrow signature. Check the documented inputs and current state.

## ESCROW_SIGNER

HTTP 400; retryable: false. Escrow signer. Check the documented inputs and current state.

## ESCROW_SIGNING_DISABLED

HTTP 400; retryable: false. Escrow signing disabled. Check the documented inputs and current state.

## ESCROW_STALE

HTTP 409; retryable: true. Escrow stale. Check the documented inputs and current state.

## ESCROW_TITLE

HTTP 400; retryable: false. Escrow title. Check the documented inputs and current state.

## ESCROW_TITLE_COMMIT

HTTP 400; retryable: false. Escrow title commit. Check the documented inputs and current state.

## ESCROW_TITLE_CONSENT

HTTP 400; retryable: false. Escrow title consent. Check the documented inputs and current state.

## ESCROW_TITLE_NOT_PENDING

HTTP 400; retryable: false. Escrow title not pending. Check the documented inputs and current state.

## ESCROW_TITLE_NOT_READY

HTTP 400; retryable: false. Escrow title not ready. Check the documented inputs and current state.

## ESCROW_TITLE_RESERVED

HTTP 400; retryable: false. Escrow title reserved. Check the documented inputs and current state.

## ESCROW_TXID

HTTP 400; retryable: false. Escrow txid. Check the documented inputs and current state.

## ESCROW_TX_BINDING

HTTP 400; retryable: false. Escrow tx binding. Check the documented inputs and current state.

## ESCROW_UNALIGNED_CUT

HTTP 400; retryable: false. Escrow unaligned cut. Check the documented inputs and current state.

## ESCROW_UNAVAILABLE

HTTP 503; retryable: true. Escrow outcome may be unknown. Keep the exact signed request and query the signed account.

## ESCROW_UNKNOWN_DEPOSIT

HTTP 400; retryable: false. Escrow unknown deposit. Check the documented inputs and current state.

## FILE_REQUIRED

HTTP 400; retryable: false. File required. Check the documented inputs and current state.

## HAS_BIDS

HTTP 400; retryable: false. Has bids. Check the documented inputs and current state.

## HIGH_SELF_RAISE

HTTP 400; retryable: false. High self raise. Check the documented inputs and current state.

## HOST

HTTP 400; retryable: false. Host. Check the documented inputs and current state.

## HTTP_ERROR

HTTP 400; retryable: false. Http error. Check the documented inputs and current state.

## IDEMPOTENCY_CONFLICT

HTTP 400; retryable: false. This request ID already belongs to different signed bytes. Query its existing receipt.

## INSUFFICIENT_FUNDS

HTTP 400; retryable: false. Insufficient funds. Check the documented inputs and current state.

## INTEGER

HTTP 400; retryable: false. Integer. Check the documented inputs and current state.

## INTENT_EXPIRED

HTTP 400; retryable: false. Intent expired. Check the documented inputs and current state.

## INTENT_ID

HTTP 400; retryable: false. Intent id. Check the documented inputs and current state.

## INVALID

HTTP 400; retryable: false. Invalid. Check the documented inputs and current state.

## INVALID_REQUEST

HTTP 400; retryable: false. The request could not be read. Check the documented request shape.

## INVARIANT_ASSET

HTTP 400; retryable: false. Invariant asset. Check the documented inputs and current state.

## INVARIANT_CONSERVATION

HTTP 400; retryable: false. Invariant conservation. Check the documented inputs and current state.

## INVARIANT_CREDIT

HTTP 400; retryable: false. Invariant credit. Check the documented inputs and current state.

## INVARIANT_DEPTH

HTTP 400; retryable: false. Invariant depth. Check the documented inputs and current state.

## INVARIANT_ESCROW

HTTP 400; retryable: false. Invariant escrow. Check the documented inputs and current state.

## INVARIANT_LOCK

HTTP 400; retryable: false. Invariant lock. Check the documented inputs and current state.

## INVARIANT_METADATA

HTTP 400; retryable: false. Invariant metadata. Check the documented inputs and current state.

## INVARIANT_RIGHTS

HTTP 400; retryable: false. Invariant rights. Check the documented inputs and current state.

## INVARIANT_TITLE

HTTP 400; retryable: false. Invariant title. Check the documented inputs and current state.

## JOURNAL_CORRUPT

HTTP 400; retryable: false. Journal corrupt. Check the documented inputs and current state.

## JSON

HTTP 400; retryable: false. Json. Check the documented inputs and current state.

## KEYS

HTTP 400; retryable: false. Keys. Check the documented inputs and current state.

## KEY_FILE_PERMISSIONS

HTTP 400; retryable: false. Key file permissions. Check the documented inputs and current state.

## KEY_FILE_REQUIRED

HTTP 400; retryable: false. Key file required. Check the documented inputs and current state.

## KEY_IDENTITY_MISMATCH

HTTP 400; retryable: false. Key identity mismatch. Check the documented inputs and current state.

## KEY_SCHEME

HTTP 400; retryable: false. Key scheme. Check the documented inputs and current state.

## LABELS

HTTP 400; retryable: false. Labels. Check the documented inputs and current state.

## LABEL_NOT_OFFERED

HTTP 400; retryable: false. Label not offered. Check the documented inputs and current state.

## LEASE_ASSET

HTTP 400; retryable: false. Lease asset. Check the documented inputs and current state.

## LEASE_INACTIVE

HTTP 400; retryable: false. Lease inactive. Check the documented inputs and current state.

## LEASE_OBLIGATION

HTTP 400; retryable: false. Lease obligation. Check the documented inputs and current state.

## MANIFEST_MISMATCH

HTTP 400; retryable: false. Manifest mismatch. Check the documented inputs and current state.

## MCP_ACCEPT

HTTP 406; retryable: false. Mcp accept. Check the documented inputs and current state.

## MCP_ALREADY_INITIALIZED

HTTP 400; retryable: false. Mcp already initialized. Check the documented inputs and current state.

## MCP_BAD_PARAMS

HTTP 400; retryable: false. Mcp bad params. Check the documented inputs and current state.

## MCP_NOT_INITIALIZED

HTTP 400; retryable: false. Mcp not initialized. Check the documented inputs and current state.

## MCP_ORIGIN

HTTP 403; retryable: false. Mcp origin. Check the documented inputs and current state.

## MCP_PARSE_ERROR

HTTP 400; retryable: false. Mcp parse error. Check the documented inputs and current state.

## MCP_PROTOCOL_VERSION

HTTP 400; retryable: false. Mcp protocol version. Check the documented inputs and current state.

## MCP_RATE_LIMITED

HTTP 429; retryable: false. Mcp rate limited. Check the documented inputs and current state.

## MCP_RATE_UNAVAILABLE

HTTP 503; retryable: false. Mcp rate unavailable. Check the documented inputs and current state.

## MCP_RESOURCE

HTTP 400; retryable: false. Mcp resource. Check the documented inputs and current state.

## METADATA_BINDING

HTTP 400; retryable: false. Metadata binding. Check the documented inputs and current state.

## METADATA_VERSION

HTTP 400; retryable: false. Metadata version. Check the documented inputs and current state.

## METHOD_NOT_ALLOWED

HTTP 405; retryable: false. Use the documented HTTP method for this route.

## METHOD_NOT_FOUND

HTTP 400; retryable: false. Method not found. Check the documented inputs and current state.

## MIN_RAISE

HTTP 400; retryable: false. The bid is below the current minimum next bid.

## NAME

HTTP 400; retryable: false. Name. Check the documented inputs and current state.

## NAME_DEPTH

HTTP 400; retryable: false. Name depth. Check the documented inputs and current state.

## NAME_LENGTH

HTTP 400; retryable: false. Name length. Check the documented inputs and current state.

## NAME_REQUIRED

HTTP 400; retryable: false. Name required. Check the documented inputs and current state.

## NAME_RESERVED

HTTP 400; retryable: false. Name reserved. Check the documented inputs and current state.

## NAME_SIZE

HTTP 400; retryable: false. Name size. Check the documented inputs and current state.

## NAME_TAKEN

HTTP 400; retryable: false. Name taken. Check the documented inputs and current state.

## NATIVE_ADDRESS

HTTP 502; retryable: false. Native address. Check the documented inputs and current state.

## NATIVE_AMOUNT

HTTP 502; retryable: false. Native amount. Check the documented inputs and current state.

## NATIVE_BASE58

HTTP 502; retryable: false. Native base58. Check the documented inputs and current state.

## NATIVE_BASE58_LENGTH

HTTP 502; retryable: false. Native base58 length. Check the documented inputs and current state.

## NATIVE_BODY

HTTP 502; retryable: false. Native body. Check the documented inputs and current state.

## NATIVE_BUSY

HTTP 502; retryable: true. Native busy. Check the documented inputs and current state.

## NATIVE_CHAIN_MISMATCH

HTTP 502; retryable: false. Native chain mismatch. Check the documented inputs and current state.

## NATIVE_CHECKPOINT_MISMATCH

HTTP 502; retryable: false. Native checkpoint mismatch. Check the documented inputs and current state.

## NATIVE_CHECKPOINT_SIGNATURES

HTTP 502; retryable: false. Native checkpoint signatures. Check the documented inputs and current state.

## NATIVE_CLOCK

HTTP 502; retryable: false. Native clock. Check the documented inputs and current state.

## NATIVE_CONTENT_TYPE

HTTP 502; retryable: false. Native content type. Check the documented inputs and current state.

## NATIVE_DIGEST

HTTP 400; retryable: false. Native digest. Check the documented inputs and current state.

## NATIVE_DOCUMENT

HTTP 502; retryable: false. Native document. Check the documented inputs and current state.

## NATIVE_FUTURE_CHECKPOINT

HTTP 502; retryable: false. Native future checkpoint. Check the documented inputs and current state.

## NATIVE_HTTP

HTTP 502; retryable: true. Native http. Check the documented inputs and current state.

## NATIVE_HTTP_HEADERS

HTTP 502; retryable: false. Native http headers. Check the documented inputs and current state.

## NATIVE_INCONSISTENT

HTTP 502; retryable: false. Native inconsistent. Check the documented inputs and current state.

## NATIVE_NAMING_UNAVAILABLE

HTTP 503; retryable: false. Native naming unavailable. Check the documented inputs and current state.

## NATIVE_PARENTS

HTTP 502; retryable: false. Native parents. Check the documented inputs and current state.

## NATIVE_PUBLIC_KEY

HTTP 502; retryable: false. Native public key. Check the documented inputs and current state.

## NATIVE_READ_FAILED

HTTP 502; retryable: true. Native read failed. Check the documented inputs and current state.

## NATIVE_RECEIPT_FLAG

HTTP 502; retryable: false. Native receipt flag. Check the documented inputs and current state.

## NATIVE_RECEIPT_MISMATCH

HTTP 502; retryable: false. Native receipt mismatch. Check the documented inputs and current state.

## NATIVE_RECEIPT_STATUS

HTTP 502; retryable: false. Native receipt status. Check the documented inputs and current state.

## NATIVE_REDIRECT

HTTP 502; retryable: false. Native redirect. Check the documented inputs and current state.

## NATIVE_RELEASE_DRIFT

HTTP 502; retryable: false. Native release drift. Check the documented inputs and current state.

## NATIVE_ROLLBACK_DETECTED

HTTP 502; retryable: false. Native rollback detected. Check the documented inputs and current state.

## NATIVE_ROUTE

HTTP 502; retryable: false. Native route. Check the documented inputs and current state.

## NATIVE_SCHEMA

HTTP 502; retryable: false. Native schema. Check the documented inputs and current state.

## NATIVE_SIGNATURE

HTTP 502; retryable: false. Native signature. Check the documented inputs and current state.

## NATIVE_SIGNER_MISMATCH

HTTP 502; retryable: false. Native signer mismatch. Check the documented inputs and current state.

## NATIVE_SIGNING_TYPE_UNSUPPORTED

HTTP 502; retryable: false. Native signing type unsupported. Check the documented inputs and current state.

## NATIVE_STALE_CACHE

HTTP 502; retryable: true. Native stale cache. Check the documented inputs and current state.

## NATIVE_STALE_OBSERVATION

HTTP 502; retryable: false. Native stale observation. Check the documented inputs and current state.

## NATIVE_TRANSPORT

HTTP 502; retryable: false. Native transport. Check the documented inputs and current state.

## NATIVE_TRUST_POLICY

HTTP 502; retryable: false. Native trust policy. Check the documented inputs and current state.

## NATIVE_TXID_MISMATCH

HTTP 502; retryable: false. Native txid mismatch. Check the documented inputs and current state.

## NATIVE_TYPE

HTTP 502; retryable: false. Native type. Check the documented inputs and current state.

## NATIVE_UNSIGNED_REQUIRED

HTTP 502; retryable: false. Native unsigned required. Check the documented inputs and current state.

## NETWORK_ERROR

HTTP 502; retryable: true. The read failed before any signed submission. Check the connection and try again.

## NETWORK_FEE_POLICY

HTTP 400; retryable: false. Network fee policy. Check the documented inputs and current state.

## NETWORK_HELD

HTTP 503; retryable: true. The network is held. No registry write was accepted. Try again after recovery.

## NONCE

HTTP 400; retryable: false. The nonce is not current. Query the existing receipt before preparing another request.

## NONCE_OVERFLOW

HTTP 400; retryable: false. Nonce overflow. Check the documented inputs and current state.

## NON_CANONICAL_NAME

HTTP 400; retryable: false. Non canonical name. Check the documented inputs and current state.

## NORMALIZATION_HASH

HTTP 400; retryable: false. Normalization hash. Check the documented inputs and current state.

## NORMALIZATION_MODE

HTTP 400; retryable: false. Normalization mode. Check the documented inputs and current state.

## NORMALIZATION_POLICY

HTTP 400; retryable: false. Normalization policy. Check the documented inputs and current state.

## NOT_CHILD_HOLDER

HTTP 400; retryable: false. Not child holder. Check the documented inputs and current state.

## NOT_FOUND

HTTP 404; retryable: false. This route or resource does not exist.

## NOT_ISSUER

HTTP 400; retryable: false. Not issuer. Check the documented inputs and current state.

## NOT_LEASE_HOLDER

HTTP 400; retryable: false. Not lease holder. Check the documented inputs and current state.

## NOT_OBSERVED

HTTP 400; retryable: false. Not observed. Check the documented inputs and current state.

## NOT_OWNER

HTTP 400; retryable: false. Not owner. Check the documented inputs and current state.

## NOT_SELLER

HTTP 400; retryable: false. Not seller. Check the documented inputs and current state.

## NO_BID

HTTP 400; retryable: false. No bid. Check the documented inputs and current state.

## NO_REFUND

HTTP 400; retryable: false. No refund. Check the documented inputs and current state.

## OFFER_CLOSED

HTTP 400; retryable: false. Offer closed. Check the documented inputs and current state.

## OFFER_EXPIRED

HTTP 400; retryable: false. Offer expired. Check the documented inputs and current state.

## OFFER_EXPIRY

HTTP 400; retryable: false. Offer expiry. Check the documented inputs and current state.

## OFFER_NOT_FOUND

HTTP 400; retryable: false. Offer not found. Check the documented inputs and current state.

## OFFER_PRICE

HTTP 400; retryable: false. Offer price. Check the documented inputs and current state.

## OFFER_TYPE

HTTP 400; retryable: false. Offer type. Check the documented inputs and current state.

## ORIGIN

HTTP 400; retryable: false. Origin. Check the documented inputs and current state.

## OUTCOME_UNKNOWN

HTTP 503; retryable: true. The signed request may have been accepted. Keep it, query its receipt, and resend only the exact same signed bytes.

## OWNERSHIP_CLASS_TAKEN

HTTP 400; retryable: false. Ownership class taken. Check the documented inputs and current state.

## PAGE_CURSOR

HTTP 400; retryable: false. Use the unchanged nextCursor from this collection.

## PAGE_LIMIT

HTTP 400; retryable: false. Choose a whole-number page limit from 1 to 100.

## PARAMS

HTTP 400; retryable: false. Params. Check the documented inputs and current state.

## PERMANENT_DEED

HTTP 400; retryable: false. Permanent deed. Check the documented inputs and current state.

## PERMANENT_OWNERSHIP_ONLY

HTTP 400; retryable: false. Permanent ownership only. Check the documented inputs and current state.

## POA_ONLY

HTTP 409; retryable: false. This registry is priced in POA. Buy, bid, list and resell names with POA checkout: read /v1/escrow/capabilities. No registry change was made.

## POLICY_UNSET

HTTP 400; retryable: false. Policy unset. Check the documented inputs and current state.

## PORT

HTTP 400; retryable: false. Port. Check the documented inputs and current state.

## PORT_ONLY_FOR_SERVE

HTTP 400; retryable: false. Port only for serve. Check the documented inputs and current state.

## PRINCIPAL

HTTP 400; retryable: false. Principal. Check the documented inputs and current state.

## PRODUCTION_CONFIG_UNSUPPORTED

HTTP 400; retryable: false. Production config unsupported. Check the documented inputs and current state.

## PRODUCTION_WEB_CONFIG

HTTP 400; retryable: false. Production web config. Check the documented inputs and current state.

## PUBLIC_ARTIFACT

HTTP 400; retryable: false. Public artifact. Check the documented inputs and current state.

## PUBLIC_JSON

HTTP 400; retryable: false. Public json. Check the documented inputs and current state.

## PUBLIC_NUMBER

HTTP 400; retryable: false. Public number. Check the documented inputs and current state.

## PUBLIC_RECORD_WITHHELD

HTTP 409; retryable: false. This stored record is not public. The name or reference remains unavailable; it is not free to register. No new action was dispatched. Hidden receipts are not reported as missing: keep the original packet and do not replace its nonce or request ID.

## QUERY_NOT_ALLOWED

HTTP 400; retryable: false. Query not allowed. Check the documented inputs and current state.

## QUIET_PERIOD

HTTP 400; retryable: false. Quiet period. Check the documented inputs and current state.

## QUOTE_AMBIGUOUS

HTTP 409; retryable: false. Several offers match. Read the offers and quote again with an explicit offerId.

## QUOTE_INPUT_REQUIRED

HTTP 400; retryable: false. Supply each required quote input explicitly before signing.

## RECORDS

HTTP 400; retryable: false. Records. Check the documented inputs and current state.

## REFUND_EXCEEDED

HTTP 400; retryable: false. Refund exceeded. Check the documented inputs and current state.

## REGISTRY_INITIALIZATION_FAILED

HTTP 400; retryable: false. Registry initialization failed. Check the documented inputs and current state.

## REGISTRY_UNAVAILABLE

HTTP 503; retryable: true. Registry reads are temporarily unavailable.

## RENEWAL_TERMS

HTTP 400; retryable: false. Renewal terms. Check the documented inputs and current state.

## RENEWAL_WINDOW

HTTP 400; retryable: false. Renewal window. Check the documented inputs and current state.

## REPLAY_MISMATCH

HTTP 400; retryable: false. Replay mismatch. Check the documented inputs and current state.

## REPLAY_ORDER

HTTP 400; retryable: false. Replay order. Check the documented inputs and current state.

## REQUEST_ID

HTTP 400; retryable: false. Request id. Check the documented inputs and current state.

## RESALE_POA_ONLY

HTTP 400; retryable: false. Resale poa only. Check the documented inputs and current state.

## RESERVE

HTTP 400; retryable: false. Reserve. Check the documented inputs and current state.

## RESERVED_NAME

HTTP 400; retryable: false. Reserved name. Check the documented inputs and current state.

## RESERVE_POLICY

HTTP 400; retryable: false. Reserve policy. Check the documented inputs and current state.

## RESOURCE_ID

HTTP 400; retryable: false. Resource id. Check the documented inputs and current state.

## RESOURCE_NOT_FOUND

HTTP 404; retryable: false. Resource not found. Check the documented inputs and current state.

## RESTORE_DISABLED

HTTP 400; retryable: false. Restore disabled. Check the documented inputs and current state.

## RESTORE_JSON

HTTP 400; retryable: false. Restore json. Check the documented inputs and current state.

## RESTORE_JSON_LIMIT

HTTP 400; retryable: false. Restore json limit. Check the documented inputs and current state.

## RESTORE_KEY_FORMAT

HTTP 400; retryable: false. Restore key format. Check the documented inputs and current state.

## RESTORE_TARGET

HTTP 400; retryable: false. Restore target. Check the documented inputs and current state.

## RESTORE_TARGET_IS_LIVE

HTTP 400; retryable: false. Restore target is live. Check the documented inputs and current state.

## RESTORE_VALIDATION_FAILED

HTTP 400; retryable: false. Restore validation failed. Check the documented inputs and current state.

## RIGHTS

HTTP 400; retryable: false. Rights. Check the documented inputs and current state.

## ROOT_ONLY

HTTP 400; retryable: false. Root only. Check the documented inputs and current state.

## RPC

HTTP 400; retryable: false. Rpc. Check the documented inputs and current state.

## RPC_ERROR

HTTP 400; retryable: false. Rpc error. Check the documented inputs and current state.

## SCHEMA

HTTP 400; retryable: false. Schema. Check the documented inputs and current state.

## SEARCH_LOG_DISABLED

HTTP 503; retryable: true. Search saving is not configured. Name checks still work.

## SEARCH_LOG_FAILED

HTTP 503; retryable: true. Search could not be saved. Name checks still work.

## SEARCH_LOG_LIMITER_UNAVAILABLE

HTTP 503; retryable: true. Search saving is temporarily unavailable. Name checking still works.

## SEARCH_LOG_RATE_LIMITED

HTTP 429; retryable: true. Search saving is busy. Name checking still works.

## SEARCH_QUERY_PRIVATE

HTTP 400; retryable: false. Only name queries without contact, wallet or key-like text can be saved.

## SECRET_FIELD

HTTP 400; retryable: false. Secret field. Check the documented inputs and current state.

## SELF_SALE

HTTP 400; retryable: false. Self sale. Check the documented inputs and current state.

## SELLER_SELF_BID

HTTP 400; retryable: false. Seller self bid. Check the documented inputs and current state.

## SEQUENCE_OVERFLOW

HTTP 400; retryable: false. Sequence overflow. Check the documented inputs and current state.

## SERVICE_URL

HTTP 400; retryable: false. Service url. Check the documented inputs and current state.

## SIGNATURE

HTTP 400; retryable: false. The packet signature is invalid. Do not submit a different packet blindly.

## SIGNATURES

HTTP 400; retryable: false. Signatures. Check the documented inputs and current state.

## SIZE

HTTP 400; retryable: false. Size. Check the documented inputs and current state.

## STALE_CURSOR

HTTP 409; retryable: false. The registry changed. Restart this paginated read without a cursor.

## STALE_OFFER

HTTP 400; retryable: false. Stale offer. Check the documented inputs and current state.

## STALE_VERSION

HTTP 400; retryable: false. The resource version changed. Read or quote again before approving a new intent.

## STORAGE

HTTP 400; retryable: false. Storage. Check the documented inputs and current state.

## STORAGE_CLOSED

HTTP 400; retryable: false. Storage closed. Check the documented inputs and current state.

## STORAGE_PATH

HTTP 400; retryable: false. Storage path. Check the documented inputs and current state.

## STRING

HTTP 400; retryable: false. String. Check the documented inputs and current state.

## TITLE_LOCKED

HTTP 400; retryable: false. Title locked. Check the documented inputs and current state.

## TOOL

HTTP 400; retryable: false. Tool. Check the documented inputs and current state.

## TOOL_FAILURE

HTTP 400; retryable: false. Tool failure. Check the documented inputs and current state.

## UNEXPECTED_BUILD_ARTIFACT

HTTP 400; retryable: false. Unexpected build artifact. Check the documented inputs and current state.

## UNICODE_PUBLIC_ARTIFACT_IDENTITY

HTTP 400; retryable: false. Unicode public artifact identity. Check the documented inputs and current state.

## UNKNOWN_OUTCOME

HTTP 404; retryable: true. No receipt is available. Keep and query the original packet; resend only the exact same signed bytes.

## UNSAFE_KEY

HTTP 400; retryable: false. Unsafe key. Check the documented inputs and current state.

## UNSUPPORTED_ACTION

HTTP 400; retryable: false. Unsupported action. Check the documented inputs and current state.

## UNSUPPORTED_ASSET

HTTP 400; retryable: false. Unsupported asset. Check the documented inputs and current state.

## UNSUPPORTED_NAME

HTTP 400; retryable: false. Unsupported name. Check the documented inputs and current state.

## URL_REQUIRED

HTTP 400; retryable: false. Url required. Check the documented inputs and current state.

## URL_SIZE

HTTP 414; retryable: false. Url size. Check the documented inputs and current state.

## VALIDITY

HTTP 400; retryable: false. Validity. Check the documented inputs and current state.

## WRITER_LOCKED

HTTP 400; retryable: false. Writer locked. Check the documented inputs and current state.
