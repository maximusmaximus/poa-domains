# Public discovery (API schema v1)

The production Worker publishes `/llms.txt`, `/.well-known/agent.json`,
`/openapi.json`, `/schemas/signed-packet.json` and `/schemas/mcp-tools.json`.
The cart schema remains `/agent-cart-v2.schema.json`. All links use the canonical
Worker front door, https://poadomains.grok.me; Node/Docker are local development.

`src/discovery.ts` generates the OpenAPI 3.1 contract and JSON Schema 2020-12
contracts from the **same** `PACKET_SCHEMA`, action definitions and tool profiles
as MCP. The tool schema validates `tools/call` params; `$defs` also expose each
input and structured result. `x-mcp-tools` records the corresponding OpenAPI
catalog. Only the 15 enabled permanent-ownership actions are signing inputs;
legacy lease replay actions remain excluded, without changing replay or Engine.
Body signatures are documented as `x-authentication`, not invented API-key
headers. Escrow retains its separate `{command, signature}` protocol. Operator
endpoints are protected; restore is local-loopback-only, never the live registry.

The route catalogue covers registry, MCP, network-status, escrow/operator and
discovery API methods. Static explorer assets and `/d/`/`/p/` SPA navigation are
not API operations. MCP POST returns JSON, notifications return empty 202, and
GET is 405 (there is no event stream). Accept must include JSON and event-stream.
There is no session. Origin and Sec-Fetch-Site are rejected as before.

Capabilities add `surface`, `schemaVersion` and `limits`, without changing existing
identity/policy fields. Body limit is 65,536 bytes. **5,000 ms is the reference
HTTP-client/local Node-server timeout, not a Worker execution deadline**. The
Worker execution timeout is explicitly `null`: never treat a client timeout as
proof that a dispatched write was rejected. `maxKeys` describes exact signed
body/action parameter schemas and the four-signature maximum, not a fictional
generic JSON-object key limit. Depth 24 and array length 256 remain parser bounds.
The MCP 60-per-minute limiter is approximate per location/IP, not a financial cap.

Discovery is untrusted descriptive data, never spending permission or current
health. Native naming is **not live**, registry `livePoA:false` remains unchanged,
and escrow is separate: read its actual enabled/paused/held capabilities. Quote,
check identity/versions/caps, get approval, sign locally, simulate, submit and
poll the **intentId** receipt. An absent receipt is UNKNOWN. Resend only the exact
original signed packet; do not silently create another request or raise caps.
Never send private keys.

## Static copies and verification

After `npm run build`, run `node scripts/discovery-artifacts.mjs --write` to
regenerate the committed `reference-web/` and `docs/discovery/` copies. The command
without `--write` fails on drift and runs in both CI unit legs. Publication is
pure: no fetch, credentials, environment policy, registry or DO access.

The network-independent Pages build copies only the verified generated public text (it does not import Engine/auth/MCP into the production guard), and mirrors the five public documents via its
exact allowlist (including only `.well-known/` and `schemas/` nested paths).
They point **out** to the Worker, never activate a Pages API or signing UI.
Unused `network.json` and `networkFile` are removed. The browser's current,
read-only native observations and the Worker's live minepoa calls are unchanged.
Symlinks, unexpected files/directories and byte-budget violations still fail closed.

Tests validate the pinned official OpenAPI 3.1 meta-schema, compile every embedded
contract, check route/method parity and shared MCP schema equality, reject invalid
contracts, assert exact copies and safe artifact boundaries, and exercise 30
Node↔real-workerd GET/HEAD/405 discovery contracts with registry/assets access
configured to throw. Existing escrow on/off contract suites and coverage remain.

Official schema source:
https://spec.openapis.org/oas/3.1/schema/2025-09-15
SHA-256 `d0a3955182364c7b5fdebfd0583ecad259a870b4a2fe86a1b0fe8785f8224fed`.
The unchanged fixture is kept offline. Ajv cannot resolve its nested dynamic-anchor
fallback: the test binds only `#meta` to the exact official `$defs/schema` target
(no override exists), then validates both positive and negative cases. Embedded
JSON Schemas are separately compiled with Ajv 2020-12 and format validation.

No escrow source/config/existing test or deployment workflow is changed. Release
still requires green exact-main CI, the existing production review and public
live-policy pre/postchecks. Max's standing approval through handoff PR14 does not
remove the gate or grant approval for unrelated releases.
