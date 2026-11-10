# Shared MCP core and stateless Streamable HTTP

**Source-ready, not deployed.** Merging this PR does not publish `/mcp`.
The first production deployment requires Max's separate approval through the
existing disarmed gate. Do not point hosted agents at it as live until that
approved deployment is verified. No secrets, keys, escrow actions or Worker
updates were performed to implement/test it.

## Registry profile

The Worker endpoint is `https://poadomains.grok.me/mcp` after approval.
The local `reference-cli.js mcp --url ORIGIN` stdio profile uses the same core,
tool definitions, schemas, errors, resources and prompts. Native-only `cli.js mcp`
uses that protocol core but **retains only** `registry_status`, `native_network`
and `native_receipt`: it never gains a reference registry or signing fallback.

Nine registry tools: `read_state`, `read_capabilities`, `resolve_domain`,
`build_metadata_witness`, `quote_domain`, `simulate_intent`, `submit_intent`,
`get_receipt`, `get_nonce`. All publish object-root `outputSchema` and return
`structuredContent` as well as the legacy text JSON. `src/mcp-schema.ts` is the
single input-schema source: action-tagged `oneOf` with 15 enabled actions,
exact required params, enums, formats and examples. `renewLease`/`expireLease`
and new lease rights are excluded; legacy replay Engine semantics are unchanged.
Schema key parity with the Engine action table is tested. Runtime validation is
bounded and eval-free, cross-checked against Ajv 2020 in tests (no Ajv/SDK ships
in the Worker). Signatures and Engine validation remain authoritative.

`read_capabilities` returns typed enabled `actionSchemas` and defaults to small
capabilities; `includeEmoji:true` explicitly asks for the full tables. It never
claims native-chain finality; registry `livePoA:false` is separate from the
existing live escrow service. No escrow tools or admin/reconcile calls are added.

Resources: `poa://capabilities`, templates `poa://names/{name}` and
`poa://receipts/{id}`. Prompts: `buy_a_domain` and `accept_cart_handoff`.
Cart text is explicitly untrusted task data, never signing/spending permission.
This does not introduce Cart Handoff v2 (that is the next separately approved PR).

## HTTP contract

- Stateless: no session ID, persistent connection or initialize state. Initialize
  negotiates `2025-11-25`; that is the only supported version. Subsequent POSTs
  require `MCP-Protocol-Version: 2025-11-25`. Missing header is allowed only on
  initialize. Unknown/invalid versions return 400 rather than silently guessing.
- Send `Accept: application/json, text/event-stream` and JSON UTF-8. Requests
  receive `application/json`; accepted notifications get empty 202. Notifications
  cannot invoke tools or submit anything. Unsolicited responses are rejected.
- GET (and other methods) returns 405 with `Allow: POST`: no SSE stream is offered.
- Any Origin or Sec-Fetch-Site is rejected with 403, including same-origin browser
  requests. No browser CORS exemption, signing service or private-key field exists.
- Maximum body 64 KiB, streamed with a running bound; invalid UTF-8, duplicate
  keys, deep/oversized JSON, encoded bodies and query strings are rejected.
- `MCP_RATE_LIMITER` binding: 60 requests per minute per connecting IP, namespace
  `2026110908`. The key is scoped to this endpoint and uses Cloudflare's
  `CF-Connecting-IP`, never caller-chosen signer or X-Forwarded-For. Missing IP
  shares one restricted bucket. Missing/failing limiter fails closed (503).
  A rejected bucket returns 429 / Retry-After 60. Cloudflare binding limits are
  approximate and per location, **not a strict global financial limit**.
- Preserve the proxy's method/body, Accept, protocol and content headers. Check
  trusted client-IP behavior before first deployment: shared proxy egress can
  legitimately share a bucket. No Grok Build proxy configuration is changed here.

JSON-RPC: -32700 parse error, -32600 invalid envelope/lifecycle, -32601 unknown
method, -32602 bad params/unknown tool. `error.data` carries the shared PR6 error
envelope. Valid tool operation failures are `isError:true` tool results, not
mislabelled JSON-RPC protocol errors. Success results include structured data.

## Financial safety and retry rule

`simulate_intent` and `submit_intent` accept only complete signed packets,
with matching signer/co-signer signatures. They never accept or derive a key.
Preview calls only the existing isolated Engine preview and read-only title
admission guard: no nonce/sequence/journal/balance/receipt mutation. Submit uses
the **same** Durable Object route, title reservation guard, synchronous commit,
network hold and idempotency as `/v1/intents`; it does not bypass escrow locks.

Quote → locally prepare/sign an explicitly approved cap → simulate → submit →
get_receipt. **Resending the exact same packet is safe.** Unknown submission
outcomes stay `accepted:"unknown"`; keep original signed bytes, requestId and
nonce and query/resend only those bytes. Preview/read transport failures remain
`accepted:false`, never an unknown financial acceptance. Even a hypothetical
successful preview is not acceptance or authorization to spend.

## Tests and pinned sources

CI retains every prior escrow suite/coverage job. New tests validate discovery,
results and errors against the official 2025-11-25 JSON schema, lock a golden
stdio/HTTP transcript, use the official SDK 1.32.2 against local workerd, exercise
signed preview/submission/idempotent resend/receipts, simulate lost responses,
and check Origin/version/body/real rate-binding guards. All actors/ledger writes
are disposable local fixtures; no upstream node, real PoA write or deployment.

Official schema: `test/fixtures/mcp-official-2025-11-25.schema.json`, retrieved from
https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2025-11-25/schema.json
(SHA-256 `268a5f82ba70fd7e4b6dc4aa1e64f116f74b4d0edcb69dc046829c79dd4e97e7`).

Sources opened for this implementation:
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/schema
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

For the exact first-deployment policy values and gate, see
[Worker deployment](worker-deploy.md#first-gated-mcp-deploy-non-secret-expected-policy).
