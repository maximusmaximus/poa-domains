/** Public contract metadata. No network, environment, registry state or credentials. */
import { ACTIONS } from "./actions.js";
import { PACKET_SCHEMA, ACTION_SCHEMAS } from "./mcp-schema.js";
export const API_SCHEMA_VERSION = "poa-domains.api.v1";
export const API_ORIGIN = "https://poadomains.grok.me";
export const API_LIMITS = Object.freeze({
  bodyBytes: 65536,
  timeoutMs: 5000,
  timeoutScope:
    "Reference HTTP client and local Node server; not a Worker execution deadline",
  workerExecutionTimeoutMs: null,
  maxKeys: {
    signedIntentBody: Object.keys(
      PACKET_SCHEMA.properties.body.oneOf[0].properties,
    ).length,
    actionParams: Math.max(...Object.values(ACTIONS).map((a) => a.length)),
    signatures: 4,
  },
  jsonDepth: 24,
  arrayItems: 256,
});
export const DISCOVERY_PATHS = Object.freeze([
  "/llms.txt",
  "/.well-known/agent.json",
  "/openapi.json",
  "/schemas/signed-packet.json",
  "/schemas/mcp-tools.json",
]);
export const API_SURFACE = Object.freeze({
  schemaVersion: API_SCHEMA_VERSION,
  canonicalOrigin: API_ORIGIN,
  rest: {
    version: "v1",
    enabledSigningActions: Object.keys(ACTION_SCHEMAS),
    legacyReplayOnlyActions: ["renewLease", "expireLease"],
    openapi: "/openapi.json",
    signedPacketSchema: "/schemas/signed-packet.json",
  },
  mcp: {
    url: API_ORIGIN + "/mcp",
    transport: "Streamable HTTP",
    protocolVersion: "2025-11-25",
    stateless: true,
    toolsSchema: "/schemas/mcp-tools.json",
  },
  cart: {
    schema: "poa-domains.agent-cart.v2",
    jsonSchema: "/agent-cart-v2.schema.json",
  },
  discovery: { llms: "/llms.txt", agent: "/.well-known/agent.json" },
  status: {
    registry: "application-registry",
    finality: "registry-committed",
    livePoA: false,
    nativeNaming: "not-live",
    escrow:
      "Separate service; read /v1/escrow/capabilities for current enabled/paused/held status",
  },
});
