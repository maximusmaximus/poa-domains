/** Generated from the same action/tool schemas as MCP. Pure publication, never a backend call. */
import {
  API_SCHEMA_VERSION,
  API_ORIGIN,
  API_LIMITS,
  API_SURFACE,
  DISCOVERY_PATHS,
  NEW_ACCOUNT_UNITS_FIELD,
  PUBLIC_VIEW_POLICY,
  PUBLIC_VIEW_POLICY_DEPRECATED,
} from "./api-contract.js";
import { REGISTRY_ROUTES } from "./registry-routes.js";
import { POA_CHECKOUT_STEPS } from "./new-name-prices.js";
import { registryMcpProfile } from "./mcp-registry.js";
import {
  ACTION_SCHEMAS,
  PACKET_SCHEMA,
  ID,
  NAME,
  PRINCIPAL,
  UINT,
  objectSchema,
  Schema,
} from "./mcp-schema.js";
export const GATEWAY_ROUTES = Object.freeze([
  ["POST", "/mcp"],
  ["POST", "/v1/search-log"],
  ["POST", "/v1/media/upload"],
  ["GET", "/v1/media/domain/:name"],
  ["HEAD", "/v1/media/domain/:name"],
  ["GET", "/v1/media/:cid"],
  ["HEAD", "/v1/media/:cid"],
  ["GET", "/v1/network-status"],
  ["HEAD", "/v1/network-status"],
  ["GET", "/v1/treasury"],
  ["HEAD", "/v1/treasury"],
  ["GET", "/v1/terms"],
  ["HEAD", "/v1/terms"],
  ["GET", "/v1/terms/status"],
  ["HEAD", "/v1/terms/status"],
  ["POST", "/v1/terms/agree"],
  ["GET", "/v1/feedback/challenge"],
  ["GET", "/v1/feedback/captcha/:id"],
  ["HEAD", "/v1/feedback/captcha/:id"],
  ["POST", "/v1/feedback"],
  ...["capabilities", "market", "domain", "subnames", "intent"].map((p) => [
    "GET",
    "/v1/escrow/" + p,
  ]),
  ...["intent", "withdraw", "command", "account"].map((p) => [
    "POST",
    "/v1/escrow/" + p,
  ]),
  ...["escrow", "backup", "restore"].map((p) => ["POST", "/v1/admin/" + p]),
]);
export const PUBLIC_HTTP_ROUTES = Object.freeze([
  ...REGISTRY_ROUTES,
  ...GATEWAY_ROUTES,
  ...[...DISCOVERY_PATHS, "/agent-cart-v2.schema.json"].flatMap((p) => [
    ["GET", p],
    ["HEAD", p],
  ]),
]);
export const ERROR_SCHEMA = {
  type: "object",
  required: ["code", "message", "retryable", "accepted", "docs", "requestId"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    retryable: { type: "boolean" },
    accepted: { anyOf: [{ type: "boolean" }, { const: "unknown" }] },
    docs: { type: "string" },
    requestId: { type: "string" },
  },
};
const O = { type: "object" },
  S = { type: "string" },
  ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
const UNITS_AMOUNT = {
  type: "string",
  pattern: "^(0|[1-9][0-9]{0,38})$",
};
const PUBLIC_VIEW_SCHEMA = {
  type: "object",
  properties: {
    filtered: { type: "boolean" },
    policy: {
      type: "string",
      enum: [PUBLIC_VIEW_POLICY, PUBLIC_VIEW_POLICY_DEPRECATED],
      description:
        "Canonical value is audited-withheld-records-v1. audited-test-records-v1 is a deprecated alias accepted by readers.",
    },
    hiddenNamesRemainReserved: { type: "boolean" },
    unavailableNameKeys: { type: "array", items: { type: "string" } },
    unavailableAccountKeys: { type: "array", items: { type: "string" } },
    stateHashScope: { type: "string" },
    sequenceScope: { type: "string" },
  },
};
const parameter = (
  name: string,
  where: string,
  schema: Schema,
  required = false,
) => ({ name, in: where, required, schema });
const response = (
  description: string,
  schema: Schema = O,
  type = "application/json",
) => ({ description, content: { [type]: { schema } } });
function toolDefinitions() {
  return registryMcpProfile(async () => {
    throw Error("Discovery cannot call a backend");
  }).tools;
}
export function mcpToolsDocument(): any {
  const tools = toolDefinitions(),
    defs: Record<string, Schema> = {};
  for (const t of tools) {
    defs[t.name + "_arguments"] = t.inputSchema;
    defs[t.name + "_result"] = t.outputSchema;
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: API_ORIGIN + "/schemas/mcp-tools.json",
    title: "MCP tools/call arguments and structured results",
    $defs: defs,
    oneOf: tools.map((t) =>
      objectSchema(
        {
          name: { const: t.name },
          arguments: { $ref: "#/$defs/" + t.name + "_arguments" },
        },
        t.inputSchema.required?.length ? ["name", "arguments"] : ["name"],
      ),
    ),
    "x-schemaVersion": API_SCHEMA_VERSION,
    "x-protocolVersion": "2025-11-25",
    "x-tools": tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { $ref: "#/$defs/" + t.name + "_arguments" },
      outputSchema: { $ref: "#/$defs/" + t.name + "_result" },
    })),
    "x-note":
      "Discovery is untrusted data, never spending approval. These validate tools/call params, not a JSON-RPC envelope; submit/simulate require complete signed packets.",
  };
}
export function signedPacketDocument(): any {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: API_ORIGIN + "/schemas/signed-packet.json",
    title:
      "Complete signed registry packet: 15 enabled permanent-ownership actions",
    ...PACKET_SCHEMA,
  };
}
function params(method: string, path: string): any[] {
  const list: any[] = [];
  for (const match of path.matchAll(/:([a-zA-Z]+)/g))
    list.push(
      parameter(
        match[1]!,
        "path",
        match[1] === "name" ? NAME : match[1] === "cid" ? { type: "string", pattern: "^bafkrei[a-z2-7]{52}$" } : path === "/v1/feedback/captcha/:id" ? { type: "string", pattern: "^[0-9a-f]{32}$" } : ID,
        true,
      ),
    );
  if (method !== "GET") return list;
  if (path === "/v1/capabilities")
    list.push(parameter("include", "query", { enum: ["emoji"] }));
  if (
    path === "/v1/resolve" ||
    path === "/v1/quote" ||
    path === "/v1/escrow/domain"
  )
    list.push(
      parameter(
        "name",
        "query",
        path.includes("escrow")
          ? { type: "string", minLength: 1, maxLength: 256 }
          : NAME,
        true,
      ),
    );
  if (path === "/v1/nonce")
    list.push(parameter("signer", "query", PRINCIPAL, true));
  if (path === "/v1/quote")
    for (const [name, schema] of Object.entries({
      action: { enum: Object.keys(ACTION_SCHEMAS) },
      signer: PRINCIPAL,
      asset: S,
      auctionId: ID,
      offerId: ID,
    }))
      list.push(parameter(name, "query", schema, name === "action"));
  if (["/v1/auctions", "/v1/offers"].includes(path))
    list.push(
      parameter("limit", "query", {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 50,
      }),
      parameter("cursor", "query", S),
    );
  if (path === "/v1/escrow/subnames")
    list.push(parameter("parent", "query", { type: "string", minLength: 1, maxLength: 256 }));
  if (path === "/v1/escrow/intent")
    list.push(
      parameter("id", "query", ID, true),
      parameter("txid", "query", ID),
    );
  return list;
}
export function openApiDocument(): any {
  const paths: Record<string, any> = {};
  for (const [method, path] of PUBLIC_HTTP_ROUTES) {
    const template = path!.replace(/:([a-zA-Z]+)/g, "{$1}"),
      verb = method!.toLowerCase();
    const isEscrow = path!.startsWith("/v1/escrow/"),
      admin = path!.startsWith("/v1/admin/"),
      discovery =
        DISCOVERY_PATHS.includes(path!) ||
        path === "/agent-cart-v2.schema.json";
    const operation: any = {
      operationId: verb + "_" + path!.replace(/[^a-zA-Z0-9]/g, "_"),
      tags: [
        discovery
          ? "discovery"
          : admin
            ? "operator"
            : isEscrow
              ? "escrow"
              : path === "/mcp"
                ? "mcp"
                : "registry",
      ],
      summary: method + " " + template,
      description: admin
        ? "Operator-only; no browser/agent spending permission. Restore is loopback-only, never the live singleton."
        : isEscrow
          ? "Separate signed escrow protocol, not a registry intent. Read capabilities first; preserve the exact command/signature on UNKNOWN."
          : path === "/mcp"
            ? "Stateless Streamable HTTP; JSON responses, no GET stream/session. Origin/Sec-Fetch-Site forbidden; initialize negotiates 2025-11-25. Tool arguments come from the same published MCP catalog."
            : "Application registry, not native-chain naming/finality. Signed writes require explicit approval; never send private keys.",
      parameters: params(method!, path!),
      responses: {
        "200": response(
          "Success; signed business rejection may still be a durable accepted receipt",
        ),
        default: response(
          "Fail-closed error; accepted unknown requires exact-packet receipt lookup/retry",
          ref("Error"),
        ),
      },
      "x-browser-writes": isEscrow
        ? "Exact same-origin signed command only; never keys"
        : "forbidden",
    };
    if (path === "/v1/capabilities")
      operation.responses["200"] = response(
        "Registry identity, policies and limits",
        ref("Capabilities"),
      );
    if (path === "/v1/state")
      operation.responses["200"] = response(
        "Committed registry state; publicView is present when the view is filtered",
        ref("RegistryState"),
      );
    if (path === "/v1/search-log") {
      operation.description = "Explicit browser search telemetry only, never a registry or escrow action. Requires an approved same-site Origin. Private daily-partitioned R2 JSONL shards store a bounded canonical query, server timestamp, host, browser-reported coarse result and source only. Contact/wallet/key-like input is rejected. No IP, account, cookie, user agent or personal-identifier hashes are stored. No public log-reading endpoint.";
      operation["x-browser-writes"] = "Anonymous search telemetry only; no signed intent or payment";
      operation["x-max-body-bytes"] = 1024;
      operation.requestBody = { required: true, content: { "application/json": { schema: objectSchema({query: {type:"string",minLength:1,maxLength:256},result: {enum:["available","auction","owned","unavailable","unknown"]}}, ["query","result"]) } } };
      operation.responses = {"200":response("Stored in private R2; no registry action",{type:"object",properties:{saved:{const:true},key:{type:"string",pattern:"^v1/[^/]+/[a-f0-9-]+\\.jsonl$"}},required:["saved","key"]}),default:response("Not saved; normal name checking remains available",ref("Error"))};
    }
    if (path === "/v1/media/upload") {
      operation.description = "Upload a public profile avatar image (PNG, JPG, WebP, or GIF, max 5 MB). Verified by magic bytes, stored in R2, and pinned to IPFS when configured. Limited to 10 uploads per minute and 30 per hour per client (429 MEDIA_RATE_LIMITED or MEDIA_HOURLY_LIMITED with Retry-After). Returns ipfs://<cid> and /v1/media/<cid>.";
      operation["x-browser-writes"] = "Same-origin public avatar upload only; no signed intent or payment";
      operation["x-max-body-bytes"] = 5242880;
      operation.responses = {
        "200": response("Stored in R2 (and pinned to IPFS if configured)", {
          type: "object",
          properties: {
            cid: { type: "string" },
            uri: { type: "string" },
            mediaUrl: { type: "string" },
            contentType: { type: "string" },
            bytes: { type: "integer" },
            r2Stored: { type: "boolean" },
            ipfsPinned: { type: "boolean" },
          },
          required: ["cid", "uri", "mediaUrl", "contentType", "bytes", "r2Stored", "ipfsPinned"],
        }),
        default: response("Rejected or temporarily unavailable", ref("Error")),
      };
    }
    if (path === "/v1/media/domain/:name") {
      operation.description = "Read a domain's committed public profile avatar image same-origin (serves R2 CIDs directly or fetches, magic-byte verifies, and R2-caches committed https:// PNG/JPG/WebP/GIF images).";
      operation.responses = {
        "200": { description: "Validated avatar image bytes (image/png, image/jpeg, image/webp, or image/gif)" },
        default: response("Domain or avatar not found, withheld, or invalid image", ref("Error")),
      };
    }
    if (path === "/v1/media/:cid") {
      operation.description = "Read a validated public profile avatar image stored in R2 by raw-CIDv1.";
      operation.responses = {
        "200": { description: "Immutable image bytes (image/png, image/jpeg, image/webp, or image/gif)" },
        default: response("Invalid CID or image not found", ref("Error")),
      };
    }
    if (path === "/v1/treasury") {
      operation.description = "Read-only Domains Treasury balance (escrow + treasury on PoA mainnet) with POAScan links.";
    }
    if (path === "/v1/terms") {
      operation.description = "Read current Terms & Privacy version, SHA-256 hash, one-sentence summary, key warning, and canonical statement template for agent signing.";
    }
    if (path === "/v1/terms/status") {
      operation.description = "Check whether a public principal (poa1… or ed25519:…) has signed and recorded agreement to the current Terms version.";
      operation.parameters.push(parameter("actor", "query", PRINCIPAL, true));
    }
    if (path === "/v1/terms/agree") {
      operation.description = "Submit a locally signed Ed25519 Terms agreement attestation { statement, signature }. Never send private keys.";
      operation["x-max-body-bytes"] = 8192;
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["statement", "signature"],
              properties: {
                statement: {
                  type: "object",
                  required: ["domain", "chainId", "actor", "termsVersion", "termsHash", "agreed", "agreedAt"],
                  properties: {
                    domain: { const: "poa-domains.terms.v1" },
                    chainId: S,
                    actor: PRINCIPAL,
                    termsVersion: S,
                    termsHash: ID,
                    agreed: { const: true },
                    agreedAt: { type: "integer", minimum: 1 },
                  },
                },
                signature: { type: "string", minLength: 32, maxLength: 160 },
              },
            },
          },
        },
      };
      operation.responses = {
        "200": response("Already agreed to current Terms version"),
        "201": response("Signed Terms agreement recorded"),
        default: response("Invalid input, signature, timestamp, or Terms version", ref("Error")),
      };
    }
    if (path === "/v1/feedback/challenge") {
      operation.description = "Issue a single-use CAPTCHA and SHA-256 Proof-of-Work challenge for bug/feature feedback.";
    }
    if (path === "/v1/feedback/captcha/:id") {
      operation.description = "Render the distorted SVG image for an active feedback verification challenge.";
      operation.responses = {
        "200": { description: "SVG verification image (image/svg+xml)" },
        default: response("Challenge expired or not found", ref("Error")),
      };
    }
    if (path === "/v1/feedback") {
      operation.description = "Submit a CAPTCHA + PoW verified bug report or feature request (rate-limited; filed as a GitHub issue for review). Never send private keys.";
      operation["x-browser-writes"] = "Same-origin feedback submission protected by CAPTCHA, PoW, and multi-tier rate limits";
      operation["x-max-body-bytes"] = 16384;
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["kind", "title", "details", "challengeId", "captchaAnswer", "powNonce"],
              properties: {
                kind: { enum: ["bug", "feature"] },
                title: { type: "string", minLength: 5, maxLength: 120 },
                details: { type: "string", minLength: 15, maxLength: 3000 },
                poaAddress: { type: "string", maxLength: 80 },
                pagePath: { type: "string", maxLength: 256 },
                challengeId: { type: "string", pattern: "^[0-9a-f]{32}$" },
                captchaAnswer: { type: "string", minLength: 4, maxLength: 8 },
                powNonce: { type: "string", pattern: "^[0-9]{1,12}$" },
                website: { type: "string", maxLength: 0 },
              },
            },
          },
        },
      };
      operation.responses = {
        "201": response("Created GitHub issue reference for review"),
        default: response("Rejected or rate-limited", ref("Error")),
      };
    }
    if (discovery) {
      operation.responses = {
        "200": response(
          "Public deterministic contract document",
          path === "/llms.txt" ? S : O,
          path === "/llms.txt" ? "text/plain" : "application/json",
        ),
      };
      operation.description =
        "Public discovery only; not live health, authorization or a native naming implementation.";
    }
    if (path === "/v1/intents" || path === "/v1/intents/preview") {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: ref("SignedPacket") } },
      };
      operation["x-max-body-bytes"] = API_LIMITS.bodyBytes;
      operation.security = [];
      operation["x-authentication"] = {
        type: "signed-request-body",
        schema: "#/components/schemas/SignedPacket",
      };
      if (path!.endsWith("preview"))
        operation.description +=
          " Preview is side-effect-free, never acceptance.";
    }
    if (method === "POST" && isEscrow) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: ref("EscrowSignedCommand") } },
      };
      operation.security = [];
      operation["x-authentication"] = {
        type: "escrow-command-signature-body",
        schema: "#/components/schemas/EscrowSignedCommand",
      };
      operation["x-max-body-bytes"] = 65536;
    }
    if (admin) {
      operation.security = path!.endsWith("restore")
        ? []
        : [{ OperatorBearer: [] }];
      if (path!.endsWith("restore")) operation["x-loopback-local-only"] = true;
      if (path!.endsWith("restore"))
        operation.parameters.push(
          parameter(
            "target",
            "query",
            { type: "string", pattern: "^restore-[a-z0-9-]{1,48}$" },
            true,
          ),
        );
      if (!path!.endsWith("backup"))
        operation.requestBody = {
          required: true,
          content: { "application/json": { schema: O } },
        };
    }
    if (path === "/mcp") {
      operation.parameters = [
        parameter(
          "Accept",
          "header",
          { const: "application/json, text/event-stream" },
          true,
        ),
        parameter("MCP-Protocol-Version", "header", { const: "2025-11-25" }),
      ];
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: ref("JsonRpcRequest") } },
      };
      operation.responses = {
        "200": response("JSON-RPC result or error", ref("JsonRpcResponse")),
        "202": { description: "Accepted notification; empty response" },
        "400": response("Protocol/parse error", ref("JsonRpcResponse")),
        "403": response(
          "Browser Origin/Sec-Fetch-Site rejected",
          ref("JsonRpcResponse"),
        ),
        "406": response(
          "Both JSON and event-stream Accept values required",
          ref("JsonRpcResponse"),
        ),
        "413": response("Body exceeds 64 KiB", ref("JsonRpcResponse")),
        "429": {
          ...response("Per-IP limit; retry later", ref("JsonRpcResponse")),
          headers: { "Retry-After": { schema: { const: "60" } } },
        },
        "503": response("Limiter/backend unavailable", ref("JsonRpcResponse")),
      };
      operation["x-max-body-bytes"] = 65536;
      operation["x-rate-limit"] = {
        requests: 60,
        windowMinutes: 1,
        scope:
          "per Cloudflare location/connecting IP; approximate, not a global financial limit",
      };
    }
    if (path === "/v1/receipts/:id")
      operation.responses["404"] = response(
        "UNKNOWN: no receipt is not permission for another payment",
        ref("Error"),
      );
    if (isEscrow)
      operation.responses["503"] = response(
        "Escrow off, network held or unknown dispatched outcome; inspect accepted",
        ref("Error"),
      );
    if (method === "HEAD")
      operation.responses = {
        "200": { description: "Same headers as GET; no response body" },
      };
    (paths[template] ??= {})[verb] = operation;
  }
  return {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "PoA Domains Worker API",
      version: API_SCHEMA_VERSION,
      description:
        "Worker = production. Node is local development only. Registry livePoA:false; native naming is not enabled. Everything is priced and paid in POA: new names 100 POA (common) or 1000 POA (premium) through POA checkout at /v1/escrow; registry auctions, bids and offers return POA_ONLY. Hidden stored names remain reserved; PUBLIC_RECORD_WITHHELD is not permission to re-register. Escrow is a separately gated service. No keys/server-side signing; exact signed-packet retries only. The two disabled lease replay actions are not part of this supported signing contract.",
    },
    servers: [{ url: API_ORIGIN }],
    paths,
    components: {
      schemas: {
        SignedPacket: PACKET_SCHEMA,
        Error: ERROR_SCHEMA,
        PublicView: PUBLIC_VIEW_SCHEMA,
        Capabilities: {
          type: "object",
          properties: {
            [NEW_ACCOUNT_UNITS_FIELD]: {
              ...UNITS_AMOUNT,
              description:
                "Deprecated. Omitted on the production public view, where everything is paid in POA (see poaOnly).",
              deprecated: true,
            },
            onboardingGrantRegistryUnits: {
              ...UNITS_AMOUNT,
              deprecated: true,
              description:
                "Deprecated alias. Omitted on the production public view.",
            },
            onboardingGrantPoa: {
              ...UNITS_AMOUNT,
              deprecated: true,
              description:
                "Deprecated alias of newAccountRegistryUnits. Omitted on the production public view.",
            },
            publicView: PUBLIC_VIEW_SCHEMA,
            poaOnly: {
              type: "object",
              description: "Production: every price, bid, purchase, resale and refund is in POA through POA checkout. closedRegistryActions return POA_ONLY.",
            },
          },
        },
        RegistryState: {
          type: "object",
          properties: {
            publicView: PUBLIC_VIEW_SCHEMA,
          },
        },
        EscrowSignedCommand: objectSchema({ command: O, signature: S }),
        JsonRpcRequest: objectSchema(
          {
            jsonrpc: { const: "2.0" },
            id: { anyOf: [S, { type: "integer" }, { type: "null" }] },
            method: { type: "string", minLength: 1 },
            params: O,
          },
          ["jsonrpc", "method"],
        ),
        JsonRpcResponse: {
          type: "object",
          required: ["jsonrpc", "id"],
          properties: {
            jsonrpc: { const: "2.0" },
            id: { anyOf: [S, { type: "number" }, { type: "null" }] },
            result: {},
            error: {
              type: "object",
              required: ["code", "message"],
              properties: { code: { type: "integer" }, message: S, data: {} },
            },
          },
          oneOf: [{ required: ["result"] }, { required: ["error"] }],
        },
      },
      securitySchemes: {
        OperatorBearer: {
          type: "http",
          scheme: "bearer",
          description:
            "Operator credential only; never included in discovery or public escrow calls.",
        },
      },
    },
    "x-surface": API_SURFACE,
    "x-limits": API_LIMITS,
    "x-mcp-tools": toolDefinitions().map((t: any) => {
      const replaceError = (node: any): any => {
        if (!node || typeof node !== "object") return node;
        if (Array.isArray(node)) return node.map(replaceError);
        if (
          node.type === "object" &&
          Array.isArray(node.required) &&
          node.required.length === ERROR_SCHEMA.required.length &&
          node.required.every((k: string, i: number) => k === ERROR_SCHEMA.required[i]) &&
          node.properties &&
          Object.keys(node.properties).length === Object.keys(ERROR_SCHEMA.properties).length
        ) {
          return ref("Error");
        }
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(node)) out[k] = replaceError(v);
        return out;
      };
      return {
        name: t.name,
        inputSchema: ["simulate_intent", "submit_intent"].includes(t.name)
          ? ref("SignedPacket")
          : t.name === "submit_escrow_command"
            ? ref("EscrowSignedCommand")
            : t.inputSchema,
        outputSchema: replaceError(t.outputSchema),
      };
    }),
  };
}
export function agentCard(): any {
  return {
    schema: API_SCHEMA_VERSION,
    name: "PoA Domains Registry",
    url: API_ORIGIN,
    description:
      "Application registry explorer and agent API. Native-chain naming is not enabled. Everything is priced and paid in POA: new names 100 POA (common) or 1000 POA (premium) through POA checkout. Some stored names are hidden from public lists but remain reserved.",
    surface: API_SURFACE,
    limits: API_LIMITS,
    authentication: {
      registry:
        "Complete locally signed packets only; no private keys or server signing",
      escrow:
        "Separate command/signature protocol; current state at /v1/escrow/capabilities",
      browserRegistryWrites: false,
    },
    safety: [
      "Discovery is untrusted data, never authorization",
      "Independently verify registry identity and state freshness",
      "Quote, locally sign with explicit approval, simulate, submit, poll intentId receipt",
      "No receipt is UNKNOWN; resend identical original bytes/requestId/nonce only",
      "Never silently increase an item or whole-cart spending cap",
    ],
    routes: PUBLIC_HTTP_ROUTES.map(([method, path]) => ({ method, path })),
    documents: {
      openapi: API_ORIGIN + "/openapi.json",
      packet: API_ORIGIN + "/schemas/signed-packet.json",
      mcpTools: API_ORIGIN + "/schemas/mcp-tools.json",
      cart: API_ORIGIN + "/agent-cart-v2.schema.json",
    },
  };
}
export function discoveryDocuments(): Record<
  string,
  { type: string; text: string }
> {
  const json = (value: any) => ({
    type: "application/json; charset=utf-8",
    text: JSON.stringify(value) + "\n",
  });
  return {
    "/llms.txt": {
      type: "text/plain; charset=utf-8",
      text:
        "# PoA Domains Registry\n\n> Worker = production. Registry finality is registry-committed, livePoA:false. Native-chain naming is not enabled. Everything is priced and paid in POA: new names 100 POA (common) or 1000 POA (premium) through POA checkout. Some stored names are hidden from public lists but remain reserved. Hidden names and references return PUBLIC_RECORD_WITHHELD and remain unavailable; a withheld receipt is not a missing outcome. Escrow is separate; read its current capabilities, never infer payment availability from discovery.\n\n- [Remote MCP first](" +
        API_ORIGIN +
        "/mcp): stateless Streamable HTTP, protocol 2025-11-25. POST only; Accept: application/json, text/event-stream. No browser Origin.\n- [REST OpenAPI](" +
        API_ORIGIN +
        "/openapi.json): GET /v1/time, /v1/names/{name}, /v1/auctions, /v1/offers, /v1/quote and /v1/receipts/{intentId}; POST /v1/intents/preview then /v1/intents with the exact signed packet.\n- [Capabilities](" +
        API_ORIGIN +
        "/v1/capabilities): identity, policies, surface, schemaVersion and limits; ?include=emoji opts into large tables.\n- [Agent card](" +
        API_ORIGIN +
        "/.well-known/agent.json)\n- [Signed packet schema](" +
        API_ORIGIN +
        "/schemas/signed-packet.json)\n- [MCP tool schemas](" +
        API_ORIGIN +
        "/schemas/mcp-tools.json)\n- [Cart v2 schema](" +
        API_ORIGIN +
        "/agent-cart-v2.schema.json)\n- [Escrow status](" +
        API_ORIGIN +
        "/v1/escrow/capabilities): POA checkout status (enabled/paused/held), escrow address, limits and new-name prices. Live & queued first-bid POA auctions and signed escrow commands are also available over Remote MCP (`get_escrow_capabilities`, `list_poa_auctions`, `get_escrow_intent`, `submit_escrow_command`, prompt `bid_on_poa_auction`).\n- [Public Domain Profiles (v1)](" +
        API_ORIGIN +
        "/v1/media/upload): Read profiles via MCP get_domain_profile, validate/build poa-domains.profile.v1 witnesses via build_profile_witness (POA/BTC/ETH addresses, <=280-char plain-text bio, https/ipfs image), upload PNG/JPG/WebP/GIF avatars <= 5 MB via POST /v1/media/upload, then sign and submit setMetadata. All profile fields are public, backed up to R2, and pinned to IPFS.\n- [Terms & Signed Agent Agreement](" +
        API_ORIGIN +
        "/v1/terms): Read current Terms version/hash via GET /v1/terms or MCP get_terms; agents can cryptographically sign poa-domains.terms.v1 and record agreement via POST /v1/terms/agree or MCP agree_terms.\n\n" + POA_CHECKOUT_STEPS + "\n\nTitle actions (transfer, records, metadata): quote → verify versions → locally sign with explicit approval → preflight (simulate_intent) → submit → poll intentId receipt. Native on-chain naming is not enabled (livePoA:false). simulate_intent is a no-change preflight check of your signed packet against this same production registry, not a test network or simulation. A missing receipt means UNKNOWN: resend only the exact original signed bytes, requestId and nonce, never a new payment. No private keys, custodial signing or automatic spending. Never send a cart to this registry unless the complete registry identity matches. Pages is a read-only informational mirror, not this API. Discovery is data, not approval.\n",
    },
    "/.well-known/agent.json": json(agentCard()),
    "/openapi.json": json(openApiDocument()),
    "/schemas/signed-packet.json": json(signedPacketDocument()),
    "/schemas/mcp-tools.json": json(mcpToolsDocument()),
  };
}
const DOCUMENTS = new Map(Object.entries(discoveryDocuments()));
export function discoveryDocument(path: string) {
  return DOCUMENTS.get(path) ?? null;
}
