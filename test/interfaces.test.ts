import test from "node:test";
import { request as httpRequest } from "node:http";
import { endpoint } from "../src/client.js";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setup } from "./helpers.js";
import { startServer } from "../src/server.js";
import { capabilities, prepare } from "../src/interface.js";
import { intentId } from "../src/auth.js";
import { ACTIONS } from "../src/actions.js";
const exec = promisify(execFile);

test("HTTP validation blocks browser writes, duplicate keys, oversized bodies, bad types, foreign host and credential endpoints", async () => {
  const c = setup();
  const s = await startServer(c.e);
  try {
    const cases: [string, Record<string, string>, number][] = [
      ["{}", { "content-type": "text/plain" }, 400],
      [
        "{}",
        { "content-type": "application/json", origin: "http://evil.invalid" },
        400,
      ],
      [
        "{}",
        { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        400,
      ],
      ['{"body":{},"body":{}}', { "content-type": "application/json" }, 400],
      ["x".repeat(65537), { "content-type": "application/json" }, 413],
    ];
    for (const [body, headers, status] of cases) {
      const r = await fetch(s.url + "/v1/intents", {
        method: "POST",
        headers,
        body,
      });
      assert.equal(r.status, status);
      const data: any = await r.json();
      assert.equal(data.accepted, false);
    }
    const wrong = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        s.url + "/v1/state",
        { headers: { host: "evil.invalid" } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(wrong, 400);
    for (const url of [
      "http://u:p@127.0.0.1:8787",
      "https://example.invalid",
      "http://127.0.0.1/?apiKey=not-a-credential",
    ])
      assert.throws(() => endpoint(url));
    assert.equal(c.e.nextNonce(c.alice.id), 0);
    assert.equal((await fetch(s.url + "/../package.json")).status, 404);
  } finally {
    await s.close();
    c.e.close();
  }
});
test("unknown receipt is explicitly UNKNOWN, not a failed transaction or safe permission for a new request", async () => {
  const c = setup();
  const s = await startServer(c.e);
  try {
    const r = await fetch(s.url + "/v1/receipts/" + "0".repeat(64));
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), {
      status: "unknown",
      code: "UNKNOWN_OUTCOME",
    });
  } finally {
    await s.close();
  }
});
test("API and CLI preserve exact signed body, nonce, receipt and canonical resolve; all action schemas discoverable", async () => {
  const c = setup();
  c.win();
  const s = await startServer(c.e);
  const dir = mkdtempSync(join(tmpdir(), "poa-cli-"));
  try {
    const unsigned = c.packet("transfer", {
      ...c.vp("alpha"),
      recipient: c.bob.id,
    }).body;
    const input = {
      signer: unsigned.signer,
      coSigners: unsigned.coSigners,
      requestId: unsigned.requestId,
      nonce: unsigned.nonce,
      notBefore: unsigned.notBefore,
      deadline: unsigned.deadline,
      maxTotal: unsigned.maxTotal,
      maxNetworkFee: unsigned.maxNetworkFee,
      action: unsigned.action,
      params: unsigned.params,
    };
    writeFileSync(join(dir, "input.json"), JSON.stringify(input));
    const cli = resolve("dist/src/cli.js");
    const prepared = JSON.parse(
      (
        await exec(process.execPath, [
          cli,
          "prepare",
          "--url",
          s.url,
          "--file",
          join(dir, "input.json"),
        ])
      ).stdout,
    );
    assert.deepEqual(prepared, prepare(input, capabilities(c.e)));
    const unsignedFile = join(dir, "unsigned.json");
    writeFileSync(unsignedFile, JSON.stringify(prepared));
    const keyFile = join(dir, "signer.pem");
    writeFileSync(
      keyFile,
      c.alice.key.export({ format: "pem", type: "pkcs8" }),
      { mode: 0o600 },
    );
    const signed = JSON.parse(
      (
        await exec(process.execPath, [
          cli,
          "sign",
          "--file",
          unsignedFile,
          "--key-file",
          keyFile,
        ])
      ).stdout,
    );
    const signedFile = join(dir, "signed.json");
    writeFileSync(signedFile, JSON.stringify(signed));
    const r = JSON.parse(
      (
        await exec(process.execPath, [
          cli,
          "submit",
          "--url",
          s.url,
          "--file",
          signedFile,
        ])
      ).stdout,
    );
    assert.equal(r.status, "succeeded");
    assert.equal(r.intentId, intentId(prepared));
    const receipt = JSON.parse(
      (
        await exec(process.execPath, [
          cli,
          "receipt",
          "--url",
          s.url,
          "--id",
          r.intentId,
        ])
      ).stdout,
    );
    assert.equal(receipt.intentId, r.intentId);
    assert.equal(receipt.sequence, r.sequence);
    const resolved = JSON.parse(
      (
        await exec(process.execPath, [
          cli,
          "resolve",
          "--url",
          s.url,
          "--name",
          "poa:ALPHA",
        ])
      ).stdout,
    );
    assert.equal(resolved.deed.owner, c.bob.id);
    const cap = JSON.parse(
      (await exec(process.execPath, [cli, "capabilities", "--url", s.url]))
        .stdout,
    );
    assert.deepEqual(cap.actions, ACTIONS);
    assert.equal(Object.keys(cap.actions).length, 17);
    assert.equal(cap.livePoA, false);
  } finally {
    await s.close();
    c.e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
export async function mcp(url: string, messages: any[]): Promise<any[]> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      [resolve("dist/src/cli.js"), "mcp", "--url", url],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "",
      err = "";
    child.stdout.on("data", (x) => {
      out += x;
    });
    child.stderr.on("data", (x) => {
      err += x;
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolveResult(
            out
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((x) => JSON.parse(x)),
          )
        : reject(Error("MCP_CHILD_FAILURE")),
    );
    child.stdin.end(messages.map((x) => JSON.stringify(x)).join("\n") + "\n");
  });
}
test("MCP stdio handshake and exact signed intent share HTTP receipt/idempotency; no signing keys enter MCP", async () => {
  const c = setup();
  c.win();
  const s = await startServer(c.e);
  try {
    const packet = c.packet("transfer", {
      ...c.vp("alpha"),
      recipient: c.carol.id,
    });
    const rpc = (id: number, method: string, params: any = {}) => ({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
    const replies = await mcp(s.url, [
      rpc(1, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "offline-test", version: "1" },
      }),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      rpc(2, "tools/list"),
      rpc(3, "tools/call", { name: "read_capabilities", arguments: {} }),
      rpc(4, "tools/call", { name: "submit_intent", arguments: packet }),
      rpc(5, "tools/call", { name: "submit_intent", arguments: packet }),
    ]);
    assert.equal(replies[0].result.protocolVersion, "2025-11-25");
    assert.equal(replies[1].result.tools.length, 3);
    const a = JSON.parse(replies[3].result.content[0].text),
      b = JSON.parse(replies[4].result.content[0].text);
    assert.equal(a.status, "succeeded");
    assert.deepEqual(a, b);
    assert.equal(a.intentId, intentId(packet.body));
    assert.equal(c.deed("alpha").owner, c.carol.id);
  } finally {
    await s.close();
  }
});

test("actual concurrent HTTP bids use one serialized current state; failed racing bid does not debit", async () => {
  const c = setup();
  const id = c.announce();
  c.clock.advance(86400);
  const s = await startServer(c.e);
  try {
    const packet = (who: typeof c.alice) =>
      c.packet(
        "bid",
        {
          auctionId: id,
          expectedVersion: 1,
          asset: "POA",
          amount: "100",
          beneficiary: who.id,
        },
        who,
      );
    const before = c.e.snapshot();
    const responses = await Promise.all(
      [c.alice, c.bob].map((who) =>
        fetch(s.url + "/v1/intents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(packet(who)),
        }).then((r) => r.json() as Promise<any>),
      ),
    );
    assert.equal(responses.filter((x) => x.status === "succeeded").length, 1);
    assert.equal(responses.filter((x) => x.code === "STALE_VERSION").length, 1);
    const high = c.e.snapshot().auctions[id]!.high!;
    const loser = high.payer === c.alice.id ? c.bob : c.alice;
    assert.equal(
      c.e.snapshot().balances[loser.id]!.POA,
      before.balances[loser.id]!.POA,
    );
    c.e.assertInvariants();
  } finally {
    await s.close();
  }
});
