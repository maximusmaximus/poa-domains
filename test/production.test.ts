import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setup } from "./helpers.js";
import { ACTIONS } from "../src/actions.js";
import { startServer } from "../src/server.js";
import { runMcp } from "../src/mcp.js";
import {
  productionStatus,
  productionOptions,
  rejectRegistryOperation,
  UNAVAILABLE,
} from "../src/production.js";
const exec = promisify(execFile),
  cli = resolve("dist/src/cli.js");

test("production defaults remain disabled and reject engine, fixture, provider, mode and ready overrides", async () => {
  const c = setup();
  try {
    for (const options of [
      c.config,
      { config: c.config },
      { engine: c.e },
      { mode: "local-reference-only" },
      { operational: true },
      { backend: "https://example.invalid" },
    ]) {
      assert.throws(() => productionOptions(options));
      await assert.rejects(startServer(options));
      await assert.rejects(runMcp(options));
    }
    assert.equal(productionStatus().operational, false);
    assert.equal(productionStatus().backend, null);
    assert.deepEqual(productionStatus().actions, []);
    for (const _action of Object.keys(ACTIONS))
      assert.throws(rejectRegistryOperation, new RegExp(UNAVAILABLE));
  } finally {
    c.e.close();
  }
});

test("production HTTP rejects valid local signed intents and every registry read without simulated results", async () => {
  const c = setup();
  c.win();
  const before = c.e.stateHash(),
    server = await startServer();
  try {
    assert.equal((await fetch(server.url + "/readyz")).status, 503);
    const alive = await fetch(server.url + "/healthz");
    assert.equal(alive.status, 200);
    assert.deepEqual(await alive.json(), {
      processAlive: true,
      registryReady: false,
    });
    for (const path of [
      "/v1/state",
      "/v1/resolve?name=alpha",
      "/v1/nonce",
      "/v1/receipts/" + "0".repeat(64),
    ]) {
      const response = await fetch(server.url + path);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), productionStatus());
    }
    const packet = c.packet("transfer", {
      ...c.vp("alpha"),
      recipient: c.bob.id,
    });
    for (const body of [
      JSON.stringify(packet),
      JSON.stringify({ config: c.config, ledger: c.e.snapshot() }),
      "not-json",
    ]) {
      const response = await fetch(server.url + "/v1/intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), productionStatus());
    }
    assert.equal(c.e.stateHash(), before);
    assert.deepEqual(
      await (await fetch(server.url + "/v1/capabilities")).json(),
      productionStatus(),
    );
  } finally {
    await server.close();
    c.e.close();
  }
});

test("production CLI cannot read supplied files, sign, contact fixture endpoints, accept config or report readiness", async () => {
  for (const command of [
    "prepare",
    "sign",
    "handoff",
    "submit",
    "state",
    "export",
    "resolve",
    "receipt",
    "nonce",
    ...Object.keys(ACTIONS),
  ]) {
    await assert.rejects(
      exec(process.execPath, [
        cli,
        command,
        "--file",
        "/nonexistent-do-not-read",
        "--key-file",
        "/nonexistent-do-not-read",
        "--url",
        "http://127.0.0.1:1",
      ]),
      (error: any) => {
        assert.equal(error.code, 3);
        assert.equal(error.stdout, "");
        const detail=JSON.parse(error.stderr);
        assert.deepEqual({code:detail.code,accepted:detail.accepted,submitted:detail.submitted},{code:UNAVAILABLE,accepted:false,submitted:false});
        assert.equal(detail.sent,false);assert.equal(typeof detail.message,"string");assert.equal(typeof detail.requestId,"string");assert.equal(typeof detail.docs,"string");assert.equal(typeof detail.retryable,"boolean");
        return true;
      },
    );
  }
  await assert.rejects(
    exec(process.execPath, [
      cli,
      "serve",
      "--config",
      "/nonexistent-do-not-read",
      "--data",
      "/nonexistent-do-not-create",
    ]),
    (error: any) => {
      assert.equal(
        JSON.parse(error.stderr).code,
        "PRODUCTION_CONFIG_UNSUPPORTED",
      );
      return true;
    },
  );
  assert.deepEqual(
    JSON.parse((await exec(process.execPath, [cli, "status"])).stdout),
    productionStatus(),
  );
  await assert.rejects(exec(process.execPath, [cli, "ready"]), (error: any) => {
    assert.equal(error.code, 3);
    assert.deepEqual(JSON.parse(error.stdout), productionStatus());
    return true;
  });
});

test("production MCP advertises only status and public-node reads and refuses reference tools or supplied synthetic settlement", async () => {
  const messages = [
    { id: 1, method: "initialize", params: {protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"native-guard-test",version:"1"}} },
    { method: "notifications/initialized" },
    { id: 2, method: "tools/list" },
    {
      id: 3,
      method: "tools/call",
      params: { name: "registry_status", arguments: {} },
    },
    ...["read_state", "submit_intent", "read_capabilities"].map(
      (name, index) => ({
        id: index + 4,
        method: "tools/call",
        params: {
          name,
          arguments: {
            body: { mode: "local-reference-only" },
            state: { balances: { synthetic: "100" } },
          },
        },
      }),
    ),
  ];
  const result = await new Promise<any[]>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, "mcp"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "",
      error = "";
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (error += data));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        assert.equal(code, 0);
        assert.equal(error, "");
        resolvePromise(
          output
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line)),
        );
      } catch (failure) {
        reject(failure);
      }
    });
    child.stdin.end(
      messages
        .map((message) => JSON.stringify({ jsonrpc: "2.0", ...message }))
        .join("\n") + "\n",
    );
  });
  assert.deepEqual(
    result
      .find((row) => row.id === 2)
      .result.tools.map((tool: any) => tool.name),
    ["registry_status", "native_network", "native_receipt"],
  );
  assert.deepEqual(
    JSON.parse(result.find((row) => row.id === 3).result.content[0].text),
    productionStatus(),
  );
  for (const id of [4, 5, 6]) {
    const row = result.find((item) => item.id === id);
    assert.equal(row.result.isError, true);
    const {docs,requestId,retryable,...held}=JSON.parse(row.result.content[0].text);
    assert.deepEqual(held,productionStatus());
    assert.equal(typeof docs,"string");assert.equal(typeof requestId,"string");assert.equal(typeof retryable,"boolean");
  }
});

test("production entrypoint import graphs cannot load reference engines, signers, clients, fixtures or environment switches", () => {
  const visited = new Set<string>();
  const visit = (path: string) => {
    if (visited.has(path)) return;
    visited.add(path);
    assert.doesNotMatch(
      path,
      /reference|fixture|\/(?:engine|client|store|auth)\.ts$/,
    );
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(
      source,
      /process\.env|generateKeyPairSync|createPrivateKey|signBody|fixtureConfig/,
    );
    for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g))
      visit(resolve(dirname(path), match[1]!.replace(/\.js$/, ".ts")));
  };
  for (const file of [
    "cli.ts",
    "mcp.ts",
    "server.ts",
    "production.ts",
    "pages-build.ts",
  ])
    visit(resolve("src", file));
});


test("new native read entry points reject provider/fixture injection and malformed identifiers before external reads", async () => {
  for (const args of [
    ["native-network", "--url", "http://127.0.0.1:1"],
    ["native-network", "--key-file", "/nonexistent-do-not-read"],
    ["native-receipt", "--id", "../status"],
    ["native-receipt", "--id", "0".repeat(64), "--url", "https://example.invalid"],
  ]) await assert.rejects(exec(process.execPath, [cli, ...args]), (error: any) => {
    assert.equal(error.code, JSON.parse(error.stderr).code===UNAVAILABLE?3:2); assert.equal(error.stdout, "");
    assert.ok([UNAVAILABLE, "NATIVE_DIGEST"].includes(JSON.parse(error.stderr).code)); return true;
  });
  const server = await startServer();
  try {
    for (const path of ["/v1/native/network?endpoint=http://127.0.0.1:1", "/v1/native/receipts/" + "0".repeat(64) + "?mode=local-reference-only"])
      assert.equal((await fetch(server.url + path)).status, 503);
    assert.equal((await fetch(server.url + "/v1/native/receipts/invalid")).status, 400);
    assert.equal((await fetch(server.url + "/v1/native/network", { method: "POST", body: "{}" })).status, 503);
  } finally { await server.close(); }
});
