// Real SDK + real local workerd. Disposable signatures only; no external writes or deployments.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, openSync, closeSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { generateKeyPairSync } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import Ajv2020 from "ajv/dist/2020.js";
import { fixtureConfig } from "../../dist/src/config.js";
import { publicPrincipal, signBody } from "../../dist/src/auth.js";
import { capabilities, prepare } from "../../dist/src/interface.js";
import {
  contractEngine,
  CONTRACT_OPTIONS,
  CONTRACT_TIME,
} from "../../dist/test/fixtures/contract-engine.js";
import { startReferenceServer } from "../../dist/src/reference-server.js";
const golden = JSON.parse(readFileSync("test/fixtures/mcp-golden.json"));
const schema = JSON.parse(
  readFileSync("test/fixtures/mcp-official-2025-11-25.schema.json"),
);
const ajv = new Ajv2020({ strict: false, validateFormats: false });
ajv.addSchema(schema, "official");
const valid = (name, data) =>
  assert.ok(
    ajv.validate({ $ref: "official#/$defs/" + name }, data),
    name + ": " + JSON.stringify(ajv.errors),
  );
const scratch = mkdtempSync(join(tmpdir(), "poa-mcp-")),
  port = Number(process.env.CF_MCP_PORT ?? 18897),
  base = `http://127.0.0.1:${port}`;
const key = generateKeyPairSync("ed25519").privateKey,
  issuer = publicPrincipal(key),
  config = fixtureConfig(issuer, "ed25519:" + "3".repeat(64), []),
  engine = contractEngine(config);
const node = await startReferenceServer(engine, 0, {
  host: "127.0.0.1",
  routes: CONTRACT_OPTIONS,
});
const logPath = join(scratch, "workerd.log"),
  log = openSync(logPath, "w", 0o600);
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--config",
    "cloudflare/test/mcp.wrangler.jsonc",
    "--local",
    "--local-upstream",
    "poadomains.grok.me",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--inspector-port",
    "0",
    "--persist-to",
    join(scratch, "state"),
    "--var",
    `CONTRACT_CONFIG:${JSON.stringify(config)}`,
  ],
  {
    cwd: resolve(import.meta.dirname, "../.."),
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    detached: true,
    stdio: ["ignore", log, log],
  },
);
closeSync(log);
const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": golden.protocolVersion,
  "cf-connecting-ip": "192.0.2.8",
};
let counter = 0;
const rpc = (method, params = {}) => ({
  jsonrpc: "2.0",
  id: ++counter,
  method,
  params,
});
async function post(value, extra = {}, expected = 200) {
  const response = await fetch(base + "/mcp", {
    method: "POST",
    headers: { ...headers, ...extra },
    body: typeof value === "string" ? value : JSON.stringify(value),
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(response.status, expected);
  if (response.status === 202) return null;
  const data = await response.json();
  if (data.result) valid("JSONRPCResultResponse", data);
  else valid("JSONRPCErrorResponse", data);
  return data;
}
let client;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null)
      throw Error("Local MCP workerd exited: " + logPath);
    try {
      if (
        (await fetch(base + "/healthz", { signal: AbortSignal.timeout(1000) }))
          .status === 200
      ) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert.ok(ready, logPath);
  assert.equal((await fetch(base + "/mcp")).status, 405);
  const init = {
    protocolVersion: golden.protocolVersion,
    capabilities: {},
    clientInfo: { name: "golden", version: "1" },
  };
  const transcript = [
    rpc("initialize", init),
    { jsonrpc: "2.0", method: "notifications/initialized" },
    rpc("tools/list"),
    rpc("resources/list"),
    rpc("resources/templates/list"),
    rpc("prompts/list"),
    rpc("tools/call", {
      name: "quote_domain",
      arguments: {
        name: "mcpfixture",
        action: "announceAuction",
        signer: issuer,
      },
    }),
    rpc("tools/call", { name: "get_nonce", arguments: { signer: issuer } }),
  ];
  const stdio = spawn(
    process.execPath,
    ["dist/src/reference-cli.js", "mcp", "--url", node.url],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  stdio.stdout.on("data", (x) => (stdout += x));
  stdio.stderr.on("data", (x) => (stderr += x));
  const closed = once(stdio, "close");
  stdio.stdin.end(transcript.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const [exit] = await closed;
  assert.equal(exit, 0, stderr);
  const remote = [];
  for (const entry of transcript) {
    const response = await post(entry, {}, entry.id === undefined ? 202 : 200);
    if (response) remote.push(response);
  }
  assert.deepEqual(
    remote,
    stdout
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x)),
    "golden stdio ↔ HTTP transcripts",
  );
  assert.deepEqual(
    remote[1].result.tools.map((t) => t.name),
    golden.tools,
  );
  // Real official SDK handshake/notifications/discovery/structured tools over HTTP, no sessions.
  client = new Client(
    { name: "poa-sdk-contract", version: "1" },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
    requestInit: { headers: { "cf-connecting-ip": "192.0.2.8" } },
  });
  await client.connect(transport);
  assert.equal(transport.sessionId, undefined);
  assert.deepEqual(
    (await client.listTools()).tools.map((t) => t.name),
    golden.tools,
  );
  assert.equal(
    (await client.listResources()).resources[0].uri,
    "poa://capabilities",
  );
  assert.equal(
    (await client.listResourceTemplates()).resourceTemplates.length,
    2,
  );
  assert.equal((await client.listPrompts()).prompts.length, 2);
  const quote = (
    await client.callTool({
      name: "quote_domain",
      arguments: {
        name: "mcpfixture",
        action: "announceAuction",
        signer: issuer,
      },
    })
  ).structuredContent;
  assert.equal(quote.reserve, "100");
  assert.equal(quote.requiredMaxTotal, "0");
  const body = prepare(
    {
      signer: issuer,
      coSigners: [],
      requestId: "sdk-fixture-announce",
      nonce: 0,
      notBefore: CONTRACT_TIME,
      deadline: CONTRACT_TIME + 300000,
      maxTotal: "0",
      maxNetworkFee: "0",
      action: "announceAuction",
      params: quote.params,
    },
    capabilities(engine),
  );
  const packet = signBody(body, [key]);
  const before = await (await fetch(base + "/v1/state")).json();
  const preview = await client.callTool({
    name: "simulate_intent",
    arguments: packet,
  });
  assert.equal(preview.structuredContent.wouldSucceed, true);
  assert.deepEqual(await (await fetch(base + "/v1/state")).json(), before);
  const lostPreview = await post(
    rpc("tools/call", { name: "simulate_intent", arguments: packet }),
    { "x-test-fault": "after-dispatch" },
  );
  assert.equal(lostPreview.result.structuredContent.accepted, false);
  assert.equal(
    lostPreview.result.structuredContent.code,
    "REGISTRY_UNAVAILABLE",
  );
  const lost = await post(
    rpc("tools/call", { name: "submit_intent", arguments: packet }),
    { "x-test-fault": "after-dispatch" },
  );
  assert.equal(lost.result.isError, true);
  assert.equal(lost.result.structuredContent.accepted, "unknown");
  const accepted = await client.callTool({
    name: "submit_intent",
    arguments: packet,
  });
  assert.equal(accepted.structuredContent.status, "succeeded");
  for (const fault of ["malformed-reply", "wrong-receipt"]) {
    const bad = await post(
      rpc("tools/call", { name: "submit_intent", arguments: packet }),
      { "x-test-fault": fault },
    );
    assert.equal(bad.result.structuredContent.accepted, "unknown");
    assert.equal(bad.result.isError, true);
  }
  const again = await client.callTool({
    name: "submit_intent",
    arguments: packet,
  });
  assert.deepEqual(again, accepted);
  const receipt = await client.callTool({
    name: "get_receipt",
    arguments: { id: accepted.structuredContent.intentId },
  });
  assert.equal(receipt.structuredContent.sequence, before.state.sequence + 1);
  assert.equal(
    (await client.readResource({ uri: "poa://names/mcpfixture" })).contents
      .length,
    1,
  );
  assert.equal(
    (
      await client.getPrompt({
        name: "buy_a_domain",
        arguments: { name: "mcpfixture" },
      })
    ).messages.length,
    1,
  );
  const noVersion = { ...headers };
  delete noVersion["mcp-protocol-version"];
  const withoutHeader = await fetch(base + "/mcp", {
    method: "POST",
    headers: noVersion,
    body: JSON.stringify(rpc("ping")),
  });
  assert.equal(withoutHeader.status, 400);
  const initialWithoutHeader = await fetch(base + "/mcp", {
    method: "POST",
    headers: noVersion,
    body: JSON.stringify(rpc("initialize", init)),
  });
  assert.equal(initialWithoutHeader.status, 200);
  assert.equal(initialWithoutHeader.headers.get("mcp-session-id"), null);
  const invalidUtf8 = await fetch(base + "/mcp", {
    method: "POST",
    headers,
    body: new Uint8Array([0xff]),
  });
  assert.equal(invalidUtf8.status, 400);
  assert.equal((await invalidUtf8.json()).error.code, -32700);
  const secret = await post(
    rpc("tools/call", {
      name: "get_nonce",
      arguments: { signer: issuer, privateKey: "synthetic-never-a-key" },
    }),
  );
  assert.equal(secret.error.code, -32602);
  assert.ok(!JSON.stringify(secret).includes("synthetic-never-a-key"));
  assert.equal((await post("{", {}, 400)).error.code, -32700);
  assert.equal((await post(rpc("unknown"))).error.code, -32601);
  assert.equal(
    (await post(rpc("tools/call", { name: "get_nonce", arguments: {} }))).error
      .code,
    -32602,
  );
  await post(rpc("ping"), { origin: "https://poadomains.grok.me" }, 403);
  await post(rpc("ping"), { "sec-fetch-site": "same-origin" }, 403);
  await post(rpc("ping"), { "mcp-protocol-version": "bad" }, 400);
  await post(rpc("ping"), { accept: "application/json" }, 406);
  await post("x".repeat(65537), {}, 413);
  await post(rpc("ping"), { "content-type": "text/plain" }, 400);
  for (const [fault, status, code] of [
    ["rate-deny", 429, "MCP_RATE_LIMITED"],
    ["rate-error", 503, "MCP_RATE_UNAVAILABLE"],
    ["rate-missing", 503, "MCP_RATE_UNAVAILABLE"],
  ]) {
    const r = await post(rpc("ping"), { "x-test-fault": fault }, status);
    assert.equal(r.error.data.code, code);
    assert.equal(r.error.data.accepted, false);
  }
  // Real rate binding, not the fault seam: eventually 429 for this IP (Cloudflare limits are approximate).
  let limited = false;
  for (let i = 0; i < 150; i++) {
    const r = await fetch(base + "/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(rpc("ping")),
    });
    if (r.status === 429) {
      limited = true;
      assert.equal(r.headers.get("retry-after"), "60");
      break;
    }
    assert.equal(r.status, 200);
  }
  assert.ok(limited, "real local rate binding must enforce its bucket");
  console.log(
    "PASS real SDK + workerd: stateless golden stdio/HTTP parity, 9 tools, 15 typed actions, resources/prompts, signed preview/submit/receipt/exact resend, lost-response outcome safety, Origin/version/body guards and real binding rate limit; no external I/O",
  );
} finally {
  if (client) await client.close();
  await node.close();
  if (child.exitCode === null) {
    const exited = once(child, "exit");
    process.kill(-child.pid, "SIGTERM");
    let timer;
    try {
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("MCP workerd shutdown timeout")),
            10000,
          );
        }),
      ]);
    } catch (e) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
