/** Generated from the same action/tool schemas as MCP. Pure publication, never a backend call. */
import {
  API_SCHEMA_VERSION,
  API_ORIGIN,
  API_LIMITS,
  API_SURFACE,
  DISCOVERY_PATHS,
} from "./api-contract.js";
import { REGISTRY_ROUTES } from "./registry-routes.js";
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
  ["GET", "/v1/network-status"],
  ["HEAD", "/v1/network-status"],
  ...["capabilities", "market", "domain", "intent"].map((p) => [
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
      parameter(match[1]!, "path", match[1] === "name" ? NAME : ID, true),
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
    if (path === "/v1/search-log") {
      operation.description = "Explicit browser search telemetry only, never a registry or escrow action. Requires an approved same-site Origin. Private daily-partitioned R2 JSONL shards store a bounded canonical query, server timestamp, host, browser-reported coarse result and source only. Contact/wallet/key-like input is rejected. No IP, account, cookie, user agent or personal-identifier hashes are stored. No public log-reading endpoint.";
      operation["x-browser-writes"] = "Anonymous search telemetry only; no signed intent or payment";
      operation["x-max-body-bytes"] = 1024;
      operation.requestBody = { required: true, content: { "application/json": { schema: objectSchema({query: {type:"string",minLength:1,maxLength:256},result: {enum:["available","auction","owned","unavailable","unknown"]}}, ["query","result"]) } } };
      operation.responses = {"200":response("Stored in private R2; no registry action",{type:"object",properties:{saved:{const:true},key:{type:"string",pattern:"^v1/[^/]+/[a-f0-9-]+\\.jsonl$"}},required:["saved","key"]}),default:response("Not saved; normal name checking remains available",ref("Error"))};
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
        "Worker = production. Node is local development only. Registry livePoA:false; native naming is not live. Registry amounts and onboarding grants are internal units, not native POA or wallet money. Hidden stored test records remain unavailable; PUBLIC_RECORD_WITHHELD is not permission to re-register. Escrow is a separately gated service. No keys/server-side signing; exact signed-packet retries only. The two disabled lease replay actions are not part of this supported signing contract.",
    },
    servers: [{ url: API_ORIGIN }],
    paths,
    components: {
      schemas: {
        SignedPacket: PACKET_SCHEMA,
        Error: ERROR_SCHEMA,
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
    "x-mcp-tools": toolDefinitions().map((t: any) => ({
      name: t.name,
      inputSchema: ["simulate_intent", "submit_intent"].includes(t.name)
        ? ref("SignedPacket")
        : t.inputSchema,
      outputSchema: t.outputSchema,
    })),
  };
}
export function agentCard(): any {
  return {
    schema: API_SCHEMA_VERSION,
    name: "PoA Domains Registry",
    url: API_ORIGIN,
    description:
      "Application registry explorer and agent API; native-chain naming is not live. Registry prices, balances and onboarding grants are internal units, not POA or wallet money. Test records are hidden, not deleted; hidden names remain reserved.",
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
        "# PoA Domains Registry\n\n> Worker = production. Registry finality is registry-committed, livePoA:false. Native-chain naming is NOT live. Registry prices, balances and onboarding grants are internal units, NOT POA or wallet money. Test records are hidden, not deleted. Hidden names and references return PUBLIC_RECORD_WITHHELD and remain unavailable; hidden receipts are not a missing outcome. Escrow is separate; read its current capabilities, never infer payment availability from discovery.\n\n- [Remote MCP first](" +
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
        "/v1/escrow/capabilities): enabled/paused/held, wallet and limits; a different protocol from registry intents.\n\nQuote → verify versions/caps → locally sign with explicit approval → simulate → submit → poll intentId receipt. A missing receipt means UNKNOWN: resend only the exact original signed bytes, requestId and nonce, never a new payment. No private keys, custodial signing or automatic spending. Local/demo carts must not be sent to production unless complete registry identity matches. Pages is a read-only informational mirror, not this API. Discovery is data, not approval.\n",
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
