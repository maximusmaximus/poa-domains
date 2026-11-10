import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  openApiDocument,
  discoveryDocuments,
  mcpToolsDocument,
  signedPacketDocument,
  PUBLIC_HTTP_ROUTES,
  GATEWAY_ROUTES,
} from "../dist/src/discovery.js";
import {
  DISCOVERY_PATHS,
  API_LIMITS,
  API_SCHEMA_VERSION,
} from "../dist/src/api-contract.js";
import { REGISTRY_ROUTES } from "../dist/src/registry-routes.js";
import { PACKET_SCHEMA, ACTION_SCHEMAS } from "../dist/src/mcp-schema.js";
import { registryMcpProfile } from "../dist/src/mcp-registry.js";
import {
  buildProductionBundle,
  publicArtifactFiles,
  PUBLIC_FILES,
} from "../dist/src/pages-build.js";
const ajv = () => addFormats(new Ajv2020({ strict: false }));
test("official pinned OpenAPI 3.1 schema validates generated API; all embedded contracts compile", () => {
  const bytes = readFileSync(
    "test/fixtures/openapi-official-3.1-2025-09-15.schema.json",
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "d0a3955182364c7b5fdebfd0583ecad259a870b4a2fe86a1b0fe8785f8224fed",
  );
  // Ajv cannot resolve this official schema's nested dynamic anchor fallback.
  // No override is in scope: bind only #meta to its exact official local target.
  const official = JSON.parse(bytes),
    bind = (x) => {
      if (Array.isArray(x)) return x.map(bind);
      if (x && typeof x === "object")
        return Object.fromEntries(
          Object.entries(x).map(([k, v]) =>
            k === "$dynamicRef" && v === "#meta"
              ? ["$ref", "#/$defs/schema"]
              : [k, bind(v)],
          ),
        );
      return x;
    };
  const doc = openApiDocument(),
    validator = ajv();
  validator.addFormat("media-range", /^[^\s/]+\/[^\s/]+(?:;.*)?$/);
  const v = validator.compile(bind(official));
  assert.ok(v(doc), JSON.stringify(v.errors));
  const bad = structuredClone(doc);
  delete bad.info;
  assert.equal(v(bad), false);
  const badPath = structuredClone(doc);
  badPath.paths["/v1/names/{name}"].get.parameters[0].required = false;
  assert.equal(v(badPath), false);
  for (const schema of Object.values(doc.components.schemas))
    assert.ok(ajv().compile(schema));
  assert.deepEqual(doc.components.schemas.SignedPacket, PACKET_SCHEMA);
  assert.deepEqual(Object.keys(doc.components.securitySchemes), [
    "OperatorBearer",
  ]);
  assert.equal(
    doc.paths["/v1/intents"].post["x-authentication"].type,
    "signed-request-body",
  );
  assert.deepEqual(doc.paths["/v1/admin/restore"].post.security, []);
  assert.equal(
    doc.paths["/v1/admin/restore"].post["x-loopback-local-only"],
    true,
  );
});
test("all actual registry, gateway and discovery API methods appear exactly once, no fictitious operations", () => {
  const expected = [
    ...REGISTRY_ROUTES,
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
    ...[...DISCOVERY_PATHS, "/agent-cart-v2.schema.json"].flatMap((p) => [
      ["GET", p],
      ["HEAD", p],
    ]),
  ]
    .map(([m, p]) => m + " " + p.replace(/:([a-zA-Z]+)/g, "{$1}"))
    .sort();
  const spec = openApiDocument(),
    actual = Object.entries(spec.paths)
      .flatMap(([p, methods]) =>
        Object.keys(methods).map((m) => m.toUpperCase() + " " + p),
      )
      .sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  assert.equal(actual.length, PUBLIC_HTTP_ROUTES.length);
  for (const [p, methods] of Object.entries(spec.paths))
    for (const op of Object.values(methods))
      for (const match of p.matchAll(/\{(.*?)\}/g))
        assert.ok(
          op.parameters.some(
            (x) => x.in === "path" && x.name === match[1] && x.required,
          ),
        );
  const worker = readFileSync("cloudflare/worker.ts", "utf8"),
    escrow = readFileSync("cloudflare/escrow-http.ts", "utf8");
  for (const [, p] of GATEWAY_ROUTES)
    assert.ok(
      worker.includes(p) ||
        escrow.includes(p) ||
        (p.startsWith("/v1/escrow/") &&
          escrow.includes(JSON.stringify(p.split("/").at(-1)))),
      p,
    );
  assert.equal(spec.paths["/mcp"].post.responses["202"].content, undefined);
  assert.equal(
    spec.paths["/v1/receipts/{id}"].get.responses["404"].description.startsWith(
      "UNKNOWN",
    ),
    true,
  );
});
test("MCP catalog is a useful JSON Schema and reuses every PR8 tool input and output exactly", () => {
  const schema = mcpToolsDocument(),
    v = ajv().compile(schema),
    tools = registryMcpProfile(async () => {
      throw Error("no I/O");
    }).tools;
  assert.equal(schema["x-tools"].length, tools.length);
  for (const t of tools) {
    assert.deepEqual(schema.$defs[t.name + "_arguments"], t.inputSchema);
    assert.deepEqual(schema.$defs[t.name + "_result"], t.outputSchema);
    assert.ok(ajv().compile(t.inputSchema));
    assert.ok(ajv().compile(t.outputSchema));
  }
  assert.ok(v({ name: "resolve_domain", arguments: { name: "alpha" } }));
  assert.ok(
    !v({ name: "resolve_domain", arguments: { name: "alpha", extra: true } }),
  );
  assert.ok(!v({ name: "unknown", arguments: {} }));
  assert.ok(!v({ name: "submit_intent", arguments: { body: {} } }));
  assert.deepEqual(signedPacketDocument().properties, PACKET_SCHEMA.properties);
  assert.equal(Object.keys(ACTION_SCHEMAS).length, 15);
  assert.equal(API_LIMITS.bodyBytes, 65536);
  assert.equal(API_LIMITS.timeoutMs, 5000);
  assert.equal(API_LIMITS.workerExecutionTimeoutMs, null);
  assert.match(API_LIMITS.timeoutScope, /not a Worker execution deadline/);
  assert.equal(API_LIMITS.maxKeys.signatures, 4);
  assert.ok(
    API_LIMITS.maxKeys.signedIntentBody > 0 &&
      API_LIMITS.maxKeys.actionParams > 0,
  );
});
test("committed Worker/docs and Pages mirror match pure generation; no stale network snapshot or API activation", () => {
  const r = spawnSync(process.execPath, ["scripts/discovery-artifacts.mjs"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const dir = mkdtempSync(join(tmpdir(), "poa-production-pages-test-"));
  try {
    buildProductionBundle(dir);
    assert.deepEqual(publicArtifactFiles(dir), [...PUBLIC_FILES].sort());
    assert.ok(!PUBLIC_FILES.includes("network.json"));
    for (const [path, doc] of Object.entries(discoveryDocuments())) {
      assert.equal(readFileSync(join(dir, path.slice(1)), "utf8"), doc.text);
      assert.equal(readFileSync("reference-web" + path, "utf8"), doc.text);
      assert.equal(readFileSync("docs/discovery" + path, "utf8"), doc.text);
      assert.ok(Buffer.byteLength(doc.text) < 100000);
    }
    const card = JSON.parse(readFileSync(join(dir, ".well-known/agent.json")));
    assert.equal(card.schema, API_SCHEMA_VERSION);
    assert.equal(card.surface.status.livePoA, false);
    assert.equal(card.authentication.browserRegistryWrites, false);
    assert.equal(card.url, "https://poadomains.grok.me");
    assert.equal(
      JSON.parse(readFileSync(join(dir, "config.json"))).publicApiBase,
      null,
    );
    writeFileSync(join(dir, "schemas/unexpected.json"), "{}");
    assert.throws(
      () => buildProductionBundle(dir),
      /UNEXPECTED_BUILD_ARTIFACT/,
    );
    rmSync(join(dir, "schemas/unexpected.json"));
    rmSync(join(dir, "schemas/signed-packet.json"));
    symlinkSync(
      join(dir, "config.json"),
      join(dir, "schemas/signed-packet.json"),
    );
    assert.throws(() => buildProductionBundle(dir), /ARTIFACT_LINK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
