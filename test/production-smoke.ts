import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { startServer } from "../src/server.js";
import { productionStatus } from "../src/production.js";
const exec = promisify(execFile),
  cli = resolve("dist/src/cli.js"),
  server = await startServer();
const checks: string[] = [];
try {
  assert.equal((await fetch(server.url + "/healthz")).status, 200);
  assert.equal((await fetch(server.url + "/readyz")).status, 503);
  assert.deepEqual(
    await (await fetch(server.url + "/v1/capabilities")).json(),
    productionStatus(),
  );
  checks.push(
    "production liveness is separate from unavailable registry readiness and empty native actions",
  );
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
  const write = await fetch(server.url + "/v1/intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"mode":"local-reference-only","state":{"balances":{"synthetic":"100"}}}',
  });
  assert.equal(write.status, 503);
  assert.deepEqual(await write.json(), productionStatus());
  checks.push(
    "production HTTP never returns registry state or accepts a simulated settlement packet",
  );
  assert.deepEqual(
    JSON.parse((await exec(process.execPath, [cli, "status"])).stdout),
    productionStatus(),
  );
  for (const args of [
    ["submit", "--url", server.url, "--file", "/nonexistent"],
    ["sign", "--key-file", "/nonexistent"],
    ["serve", "--config", "/nonexistent", "--data", "/nonexistent"],
    ["ready"],
  ])
    await assert.rejects(
      exec(process.execPath, [cli, ...args]),
      (error: any) => error.code === (args[0] === "serve" ? 2 : 3),
    );
  checks.push(
    "production CLI rejects signing, submission, fixture configuration and readiness without reading supplied files",
  );
} finally {
  await server.close();
}
checks.push(
  "production guard service closes cleanly; no reference ledger, signer, external credentials or native transactions",
);
console.log(
  JSON.stringify(
    {
      status: "passed",
      assertionGroups: checks.length,
      checks,
      operational: false,
      fixtureSettlementAccepted: false,
      realPoATransactions: 0,
      serverClosed: true,
    },
    null,
    2,
  ),
);
