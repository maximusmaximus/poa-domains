import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setup, witness } from "./helpers.js";
import { attachJournal } from "../src/store.js";
import { Engine } from "../src/engine.js";
import { startServer } from "../src/server.js";
import { browserSmoke } from "./browser.js";
import { intentId } from "../src/auth.js";
const exec = promisify(execFile);
const dir = mkdtempSync(join(tmpdir(), "poa-offline-smoke-"));
const checks: string[] = [];
const c = setup();
attachJournal(c.e, join(dir, "data"));
const server = await startServer(c.e);
const cli = resolve("dist/src/cli.js");
const call = async (command: string, ...args: string[]) =>
  JSON.parse((await exec(process.execPath, [cli, command, ...args])).stdout);
const post = async (packet: any) => {
  const response = await fetch(server.url + "/v1/intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(packet),
  });
  assert.equal(response.status, 200);
  const result: any = await response.json();
  assert.equal(result.status, "succeeded", result.code);
  return result;
};
try {
  const cap = await call("capabilities", "--url", server.url);
  assert.equal(cap.livePoA, false);
  assert.equal(cap.durability, "fsynced-journal");
  assert.equal(Object.keys(cap.actions).length, 17);
  checks.push(
    "API/CLI exposes all 17 actions, pinned fixture policies and local journal durability",
  );
  const pkt = c.packet(
    "announceAuction",
    {
      name: "alpha",
      asset: "POA",
      reserve: "100",
      openAt: c.clock.now() + 86400,
      expectedDeedId: null,
      expectedVersion: 0,
      metadata: witness("alpha"),
    },
    c.issuer,
  );
  const body = pkt.body;
  const input = {
    signer: body.signer,
    coSigners: body.coSigners,
    requestId: body.requestId,
    nonce: body.nonce,
    notBefore: body.notBefore,
    deadline: body.deadline,
    maxTotal: body.maxTotal,
    maxNetworkFee: body.maxNetworkFee,
    action: body.action,
    params: body.params,
  };
  writeFileSync(join(dir, "input.json"), JSON.stringify(input));
  const unsigned = await call(
    "prepare",
    "--url",
    server.url,
    "--file",
    join(dir, "input.json"),
  );
  assert.equal(intentId(unsigned), intentId(body));
  writeFileSync(join(dir, "unsigned.json"), JSON.stringify(unsigned));
  const key = join(dir, "ephemeral.pem");
  writeFileSync(key, c.issuer.key.export({ format: "pem", type: "pkcs8" }), {
    mode: 0o600,
  });
  const signed = await call(
    "sign",
    "--file",
    join(dir, "unsigned.json"),
    "--key-file",
    key,
  );
  assert.equal(intentId(signed.body), intentId(body));
  writeFileSync(join(dir, "signed.json"), JSON.stringify(signed));
  const announcement = await call(
    "submit",
    "--url",
    server.url,
    "--file",
    join(dir, "signed.json"),
  );
  assert.equal(announcement.status, "succeeded");
  const id = announcement.result.auctionId;
  checks.push(
    "actual CLI prepares, privately signs ephemeral test intent and submits exact signed announcement",
  );
  let receipt = await call(
    "receipt",
    "--url",
    server.url,
    "--id",
    announcement.intentId,
  );
  assert.equal(receipt.intentId, announcement.intentId);
  checks.push("stable receipt lookup agrees with submitted operation hash");
  c.clock.set(c.e.snapshot().auctions[id]!.openAt + 3599);
  await post(
    c.packet("bid", {
      auctionId: id,
      expectedVersion: 1,
      asset: "POA",
      amount: "100",
      beneficiary: c.alice.id,
    }),
  );
  assert.equal(c.e.resolve("alpha").deed, null);
  assert.equal(
    c.e.closeEligible(c.e.snapshot().auctions[id]!),
    c.clock.now() + 3600,
  );
  checks.push(
    "late first bid fully funds escrow and extends standard quiet period without minting",
  );
  await post(
    c.packet(
      "bid",
      {
        auctionId: id,
        expectedVersion: 2,
        asset: "POA",
        amount: "111",
        beneficiary: c.bob.id,
      },
      c.bob,
    ),
  );
  const beforeRefund = c.e.snapshot().balances[c.alice.id]!.POA;
  await post(
    c.packet("withdrawRefund", {
      auctionId: id,
      asset: "POA",
      expectedVersion: 1,
      amount: "100",
    }),
  );
  assert.equal(
    BigInt(c.e.snapshot().balances[c.alice.id]!.POA!),
    BigInt(beforeRefund!) + 100n,
  );
  checks.push(
    "full displaced refund withdrawn before closing, independently of high bidder",
  );
  await post(
    c.packet("bid", {
      auctionId: id,
      expectedVersion: 3,
      asset: "POA",
      amount: "124",
      beneficiary: c.alice.id,
    }),
  );
  c.clock.set(c.e.closeEligible(c.e.snapshot().auctions[id]!));
  const finalPacket = c.packet(
    "finalize",
    { auctionId: id, expectedVersion: 4 },
    c.carol,
  );
  const finalized = await post(finalPacket);
  const seq = c.e.snapshot().sequence;
  const duplicate = await post(finalPacket);
  assert.deepEqual(duplicate, finalized);
  assert.equal(c.e.snapshot().sequence, seq);
  assert.equal(c.deed("alpha").owner, c.alice.id);
  checks.push(
    "permissionless finalization atomically creates one permanent root and duplicate is exactly-once",
  );
  const root = c.deed("alpha");
  const offer = await post(
    c.packet("createChildOffer", {
      parent: "alpha",
      parentDeedId: root.id,
      expectedOwnerVersion: root.ownerVersion,
      asset: "POA",
      price: "200",
      validUntil: c.clock.now() + 86400,
      rights: { kind: "permanent" },
      labels: ["agent"],
      maxUses: 1,
    }),
  );
  await post(
    c.packet(
      "fillChildOffer",
      {
        offerId: offer.result.offerId,
        expectedVersion: 1,
        expectedGeneration: 1,
        label: "agent",
        asset: "POA",
        amount: "200",
        metadata: witness("agent.alpha", { kind: "permanent" }, root.id),
      },
      c.bob,
    ),
  );
  const child = await call(
    "resolve",
    "--url",
    server.url,
    "--name",
    "agent.alpha",
  );
  assert.equal(child.deed.owner, c.bob.id);
  checks.push(
    "standing parent-signed offer fills child sale without fresh parent signature and resolves via CLI",
  );
  const sale = await post(
    c.packet("sellFixed", {
      ...c.vp("alpha"),
      asset: "POA",
      price: "500",
      validUntil: c.clock.now() + 86400,
    }),
  );
  const buy = c.packet(
    "buyFixed",
    {
      offerId: sale.result.offerId,
      expectedVersion: 1,
      asset: "POA",
      amount: "500",
    },
    c.carol,
  );
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "smoke", version: "1" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "submit_intent", arguments: buy },
    },
  ];
  const replies: any[] = await new Promise((resolveResult, reject) => {
    const p = spawn(process.execPath, [cli, "mcp", "--url", server.url], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (x) => {
      out += x;
    });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolveResult(
            out
              .trim()
              .split("\n")
              .map((x) => JSON.parse(x)),
          )
        : reject(Error("MCP_FAILURE")),
    );
    p.stdin.end(messages.map((x) => JSON.stringify(x)).join("\n") + "\n");
  });
  assert.equal(
    JSON.parse(replies[1].result.content[0].text).status,
    "succeeded",
  );
  assert.equal(c.deed("alpha").owner, c.carol.id);
  assert.equal(c.deed("agent.alpha").owner, c.bob.id);
  checks.push(
    "MCP submits exact signed fixed resale; child ownership survives root transfer",
  );
  c.e.assertInvariants();
  checks.push(
    "asset balances, high escrow and refund liabilities conserve genesis supply",
  );
  checks.push(...(await browserSmoke(server.url, c.e, c.carol.id)));
  const rootHash = c.e.stateHash(),
    snapshot = c.e.snapshot();
  await server.close();
  c.e.close();
  const restored = new Engine(c.config, c.clock);
  attachJournal(restored, join(dir, "data"));
  assert.equal(restored.stateHash(), rootHash);
  assert.deepEqual(restored.snapshot(), snapshot);
  restored.close();
  checks.push(
    "clean shutdown/restart replays exact full state and receipts from durable journal",
  );
  rmSync(dir, { recursive: true, force: true });
  assert.equal(existsSync(dir), false);
  checks.push(
    "ephemeral local signer files and all service data removed; no external writes",
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        assertionGroups: checks.length,
        checks,
        externalWrites: 0,
        realPoATransactions: 0,
        externalCredentialsRequired: false,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
  c.e.close();
  rmSync(dir, { recursive: true, force: true });
}
