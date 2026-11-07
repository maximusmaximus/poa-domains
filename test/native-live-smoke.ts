// Explicit opt-in real public reads only. Not part of offline check/PR tests.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { startServer } from "../src/server.js";
import { NATIVE_CHAIN, validateNetworkDocument } from "../src/native.js";
const exec = promisify(execFile), cli = resolve("dist/src/cli.js");
const cliResult = JSON.parse((await exec(process.execPath, [cli, "native-network"])).stdout);
validateNetworkDocument(cliResult);
assert.equal(cliResult.chainId, NATIVE_CHAIN);
const server = await startServer();
try {
  const response = await fetch(server.url + "/v1/native/network");
  assert.equal(response.status, 200);
  const value = await response.json(); validateNetworkDocument(value);
  assert.equal((value as any).chainId, cliResult.chainId);
  assert.equal((value as any).registryReady, false);
  const unknown = await fetch(server.url + "/v1/native/receipts/" + "0".repeat(64));
  assert.equal(unknown.status, 200);
  const receipt: any = await unknown.json();
  assert.equal(receipt.reportedStatus, "unknown"); assert.equal(receipt.safeToResubmit, false); assert.equal(receipt.finalityVerified, false);
  assert.equal((await fetch(server.url + "/v1/native/receipts/not-a-txid")).status, 400);
  assert.equal((await fetch(server.url + "/readyz")).status, 503);
  assert.equal((await fetch(server.url + "/v1/intents", { method: "POST", body: "{}" })).status, 503);
} finally { await server.close(); }
const messages = [
  { id: 1, method: "initialize", params: {} }, { method: "notifications/initialized" },
  { id: 2, method: "tools/call", params: { name: "native_network", arguments: {} } },
];
const mcp = await new Promise<any>((resolvePromise, reject) => {
  const child = spawn(process.execPath, [cli, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", error = "";
  child.stdout.on("data", data => output += data); child.stderr.on("data", data => error += data);
  child.on("error", reject); child.on("close", code => {
    try { assert.equal(code, 0); assert.equal(error, ""); resolvePromise(JSON.parse(output.trim().split("\n")[1]!).result); } catch (e) { reject(e); }
  });
  child.stdin.end(messages.map(message => JSON.stringify({ jsonrpc: "2.0", ...message })).join("\n") + "\n");
});
assert.equal(mcp.isError, false); validateNetworkDocument(JSON.parse(mcp.content[0].text));
console.log(JSON.stringify({ status: "passed", assertionGroups: 5, checks: ["real official chain-scoped CLI network observation", "real API and MCP network reads match network identity", "real unknown receipt never authorizes replay/finality", "malformed identifiers, registry readiness and writes fail closed", "localhost service and child processes close cleanly"], source: cliResult.source, chainId: cliResult.chainId, observedAt: cliResult.observedAt, checkpoint: cliResult.checkpoint, finalityVerified: false, realPoATransactions: 0, serverClosed: true }, null, 2));
