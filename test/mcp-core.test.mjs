import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { McpCore } from "../dist/src/mcp-core.js";
import { registryMcpProfile } from "../dist/src/mcp-registry.js";
import { registryRoute } from "../dist/src/registry-routes.js";
import {
  ACTION_SCHEMAS,
  PACKET_SCHEMA,
  matches,
} from "../dist/src/mcp-schema.js";
import { ACTIONS } from "../dist/src/actions.js";
import { setup } from "../dist/test/helpers.js";
import { errorReply, ERROR_CATALOGUE } from "../dist/src/errors.js";
const golden = JSON.parse(readFileSync("test/fixtures/mcp-golden.json"));
const official = JSON.parse(
  readFileSync("test/fixtures/mcp-official-2025-11-25.schema.json"),
);
const ajv = new Ajv2020({ strict: false, validateFormats: false });
addFormats(ajv);
ajv.addSchema(official, "official");
export const protocol = (name, value) => {
  const valid = ajv.validate({ $ref: "official#/$defs/" + name }, value);
  assert.ok(valid, name + ": " + JSON.stringify(ajv.errors));
};
const rpc = (id, method, params = {}) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params });
const init = {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "mcp-fixture", version: "1" },
};
function fixture() {
  const t = setup(),
    calls = [];
  const backend = async (method, path, query = {}, packet) => {
    calls.push({ method, path, packet });
    try {
      const r = registryRoute(t.e, {
        method,
        path,
        query,
        packet: packet ? JSON.stringify(packet) : undefined,
        requestId: "mcp-fixture",
      });
      const data = JSON.parse(r.jsonText);
      if (r.status >= 400)
        throw Object.assign(Error(data.code), { detail: data });
      return data;
    } catch (e) {
      if (e.detail) throw e;
      throw Object.assign(e, {
        detail: errorReply(400, { code: e.code }, "mcp-fixture").body,
      });
    }
  };
  return { t, calls, core: new McpCore(registryMcpProfile(backend)) };
}
test("official protocol schemas and golden registry discovery/lifecycle are shared and complete", async () => {
  assert.equal(
    createHash("sha256")
      .update(readFileSync("test/fixtures/mcp-official-2025-11-25.schema.json"))
      .digest("hex"),
    "268a5f82ba70fd7e4b6dc4aa1e64f116f74b4d0edcb69dc046829c79dd4e97e7",
  );
  const { core } = fixture();
  const initialized = await core.handle(rpc(1, "initialize", init));
  protocol("InitializeResult", initialized.result);
  assert.equal(initialized.result.protocolVersion, golden.protocolVersion);
  assert.equal(
    await core.handle(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ),
    null,
  );
  for (const [method, type, key, expected] of [
    ["tools/list", "ListToolsResult", "tools", golden.tools],
    ["resources/list", "ListResourcesResult", "resources", golden.resources],
    [
      "resources/templates/list",
      "ListResourceTemplatesResult",
      "resourceTemplates",
      golden.templates,
    ],
    ["prompts/list", "ListPromptsResult", "prompts", golden.prompts],
  ]) {
    const r = await core.handle(rpc(2, method));
    protocol(type, r.result);
    assert.deepEqual(
      r.result[key].map((x) => x.uri ?? x.uriTemplate ?? x.name),
      expected,
    );
    if (method === "tools/list")
      for (const tool of r.result.tools) {
        assert.equal(tool.outputSchema.type, "object");
        assert.ok(tool.inputSchema);
      }
  }
  const cap = (
    await core.handle(
      rpc(3, "tools/call", { name: "read_capabilities", arguments: {} }),
    )
  ).result;
  protocol("CallToolResult", cap);
  assert.deepEqual(Object.keys(cap.structuredContent.actions), golden.actions);
  assert.deepEqual(cap.structuredContent.actionSchemas, ACTION_SCHEMAS);
  assert.equal(cap.structuredContent.emojiManifest, undefined);
  assert.deepEqual(
    Object.keys(ACTION_SCHEMAS),
    Object.keys(ACTIONS).filter(
      (k) => !["renewLease", "expireLease"].includes(k),
    ),
  );
  for (const [key, schema] of Object.entries(ACTION_SCHEMAS))
    assert.deepEqual(
      Object.keys(schema.properties).sort(),
      [...ACTIONS[key]].sort(),
    );
  const resource = (
    await core.handle(rpc(4, "resources/read", { uri: "poa://capabilities" }))
  ).result;
  protocol("ReadResourceResult", resource);
  const prompt = (
    await core.handle(
      rpc(5, "prompts/get", {
        name: "buy_a_domain",
        arguments: { name: "alpha" },
      }),
    )
  ).result;
  protocol("GetPromptResult", prompt);
  assert.match(prompt.messages[0].content.text, /untrusted task data/);
});
test("correct parse/method/param errors and protocol negotiation; notifications cannot write", async () => {
  const { core, t, calls } = fixture();
  const malformed = await core.handle("{");
  assert.equal(malformed.error.code, golden.errors.parse);
  protocol("JSONRPCErrorResponse", malformed);
  const negotiated = await core.handle(
    rpc(-1, "initialize", { ...init, protocolVersion: "2099-01-01" }),
  );
  assert.equal(negotiated.result.protocolVersion, golden.protocolVersion);
  assert.equal(negotiated.id, -1);
  await core.handle(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  );
  assert.equal(
    (await core.handle(rpc(2, "unknown"))).error.code,
    golden.errors.method,
  );
  for (const args of [
    { name: "get_nonce", arguments: {} },
    { name: "unknown", arguments: {} },
    {
      name: "quote_domain",
      arguments: { name: "alpha", action: "renewLease" },
    },
    { name: "read_state", arguments: { extra: 1 } },
    { name: "read_state", arguments: { toString: "inherited schema bypass" } },
  ])
    assert.equal(
      (await core.handle(rpc(3, "tools/call", args))).error.code,
      golden.errors.params,
    );
  assert.equal(
    await core.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "submit_intent", arguments: {} },
      }),
    ),
    null,
  );
  assert.equal(t.e.snapshot().sequence, 0);
  assert.equal(calls.length, 0);
  assert.equal(
    (await core.handle('{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}')).error
      .code,
    -32700,
  );
  for (const code of ["MCP_PARSE_ERROR", "MCP_BAD_PARAMS"])
    assert.ok(ERROR_CATALOGUE[code]);
});
test("typed packets match Ajv; simulation, signed submit, exact resend and receipt preserve economic contracts", async () => {
  const { t, core, calls } = fixture();
  t.win();
  await core.handle(rpc(1, "initialize", init));
  await core.handle(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  );
  const packet = t.packet("transfer", {
    ...t.vp("alpha"),
    recipient: t.carol.id,
  });
  for (const candidate of [
    packet,
    { ...packet, privateKey: "never-send-this" },
    { ...packet, body: { ...packet.body, action: "expireLease" } },
    { ...packet, body: { ...packet.body, nonce: "0" } },
    {
      ...packet,
      body: { ...packet.body, params: { ...packet.body.params, extra: 1 } },
    },
  ])
    assert.equal(
      matches(PACKET_SCHEMA, candidate),
      ajv.validate(PACKET_SCHEMA, candidate),
    );
  const before = t.e.snapshot();
  const preview = (
    await core.handle(
      rpc(2, "tools/call", { name: "simulate_intent", arguments: packet }),
    )
  ).result;
  protocol("CallToolResult", preview);
  assert.equal(preview.structuredContent.wouldSucceed, true);
  assert.deepEqual(t.e.snapshot(), before);
  const broken = structuredClone(packet);
  broken.signatures[packet.body.signer] = "00".repeat(64);
  const n = calls.length;
  assert.equal(
    (
      await core.handle(
        rpc(3, "tools/call", { name: "submit_intent", arguments: broken }),
      )
    ).error.code,
    -32602,
  );
  assert.equal(calls.length, n);
  const first = (
    await core.handle(
      rpc(4, "tools/call", { name: "submit_intent", arguments: packet }),
    )
  ).result;
  protocol("CallToolResult", first);
  assert.equal(first.structuredContent.accepted, true);
  assert.equal(first.structuredContent.status, "succeeded");
  const again = (
    await core.handle(
      rpc(5, "tools/call", { name: "submit_intent", arguments: packet }),
    )
  ).result;
  assert.deepEqual(first, again);
  const receipt = (
    await core.handle(
      rpc(6, "tools/call", {
        name: "get_receipt",
        arguments: { id: first.structuredContent.intentId },
      }),
    )
  ).result;
  assert.equal(
    receipt.structuredContent.intentId,
    first.structuredContent.intentId,
  );
  assert.equal(t.e.snapshot().sequence, before.sequence + 1);
  const tools = (await core.handle(rpc(7, "tools/list"))).result.tools;
  for (const [name, value] of [
    ["simulate_intent", preview.structuredContent],
    ["submit_intent", first.structuredContent],
    ["get_receipt", receipt.structuredContent],
  ])
    assert.ok(
      ajv.validate(tools.find((t) => t.name === name).outputSchema, value),
      JSON.stringify(ajv.errors),
    );
  const missing = (
    await core.handle(
      rpc(8, "tools/call", {
        name: "get_receipt",
        arguments: { id: "0".repeat(64) },
      }),
    )
  ).result;
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent.accepted, "unknown");
});
