import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Engine } from "../dist/src/engine.js";
import { ManualClock } from "../dist/src/clock.js";
import { fixtureConfig } from "../dist/src/config.js";
import { publicPrincipal } from "../dist/src/auth.js";
import { profileEngine, SIGNER } from "./fixtures/ui-harness.mjs";
import { capabilities, prepare } from "../dist/src/interface.js";
import { AUCTION_WINDOWS } from "../dist/src/engine.js";
import { rootAuctionPolicy, editCartAmount, cartParamsForSigner, buildAgentCartPrompt,
  buildAgentCheckoutHandoff, inspectName, makeBody } from "../reference-web/shared.js";
export const cap = capabilities(profileEngine());
export const item = { name: "alpha", tier: "standard", isRoot: true, action: "announceAuction+bid", asset: "POA",
  amount: "100", summary: "Old amount", params: { name: "alpha", asset: "POA", reserve: "100", maxBid: "100", expectedDeedId: null, expectedVersion: 0 } };

test("root reserves and both bidding windows match capabilities under both profiles, including multi emoji", () => {
  for (const profile of ["fixture", "mainnet"]) {
    const c = capabilities(profileEngine(profile));
    assert.deepEqual(c.auctionWindows, AUCTION_WINDOWS);
    for (const name of ["🚀", "🚀🚀", "alpha"]) {
      const info = inspectName(name, c.emojiManifest), policy = rootAuctionPolicy(c, info);
      assert.equal(policy.reserve, c.assets.POA[info.tier === "premium" ? "premiumReserve" : "standardReserve"]);
      assert.equal(policy.window, c.auctionWindows[info.tier].window);
      assert.equal(policy.quiet, c.auctionWindows[info.tier].quiet);
    }
  }
  assert.throws(() => rootAuctionPolicy({ assets: cap.assets }, { tier: "standard" }), /Prices unavailable/);
});
test("edited prompt snapshot keeps capability reserve fixed while amount, maxBid, summary, CLI cap and checkout change", () => {
  const edited = editCartAmount(item, "250", cap);
  assert.deepEqual([edited.amount, edited.params.reserve, edited.params.maxBid], ["250", "100", "250"]);
  assert.match(edited.summary, /reserve=100 POA.*maxTotal=250 POA/);
  assert.equal(item.amount, "100", "pure edit does not mutate prior state");
  const prompt = buildAgentCartPrompt([edited], cap, SIGNER, "http://127.0.0.1:8787");
  assert.equal(prompt, readFileSync("test/fixtures/cart-edited-prompt.txt", "utf8"));
  const checkout = buildAgentCheckoutHandoff([edited], cap, SIGNER, "http://127.0.0.1:8787");
  const payload = JSON.parse(checkout.slice(checkout.indexOf("{\n")));
  assert.equal(payload.items[0].amount, "250"); assert.equal(payload.items[0].params.maxBid, "250");
});
test("bad, zero, decimal and below-minimum amounts never silently replace the user's choice", () => {
  for (const amount of ["bad", "0", "-1", "1.5", "99", "", "01"]) assert.throws(() => editCartAmount(item, amount, cap));
  const bid = { ...item, action: "bid", amount: "1000", params: { auctionId: "a".repeat(64), expectedVersion: 1, asset: "POA", amount: "1000" } };
  const state = { auctions: { [bid.params.auctionId]: { reserve: "1000", high: { amount: "1000" } } } };
  assert.throws(() => editCartAmount(bid, "1100", cap, state), /1101/);
  const updated = editCartAmount(bid, "1200", cap, state);
  assert.equal(updated.params.amount, "1200"); assert.match(updated.summary, /1200.*minValidBid=1101/);
  assert.throws(() => editCartAmount({ ...bid, action: "buyFixed" }, "1200", cap), /Fixed price/);
});
test("both handoffs and Node/browser preparation default bid beneficiary to the real signer", () => {
  const bid = { ...item, action: "bid", amount: "1000", params: { auctionId: "a".repeat(64), expectedVersion: 1, asset: "POA", amount: "1000", beneficiary: "<YOUR_BENEFICIARY_PRINCIPAL>" } };
  assert.equal(cartParamsForSigner(bid, SIGNER).beneficiary, SIGNER);
  const params = cartParamsForSigner(bid, null); assert.ok(!Object.hasOwn(params, "beneficiary"));
  for (const build of [buildAgentCartPrompt, buildAgentCheckoutHandoff]) {
    assert.ok(!build([bid], cap, null, "http://127.0.0.1:8787").includes("<YOUR_BENEFICIARY_PRINCIPAL>"));
    assert.ok(build([bid], cap, SIGNER, "http://127.0.0.1:8787").includes(SIGNER));
  }
  const input = { signer: SIGNER, coSigners: [], requestId: "beneficiary-default", nonce: 1, notBefore: 0, deadline: 2000000,
    maxTotal: "1000", maxNetworkFee: "0", action: "bid", params };
  assert.equal(prepare(input, cap).params.beneficiary, SIGNER);
  assert.equal(makeBody(input, cap).params.beneficiary, SIGNER);
});

// Disposable local fixture identity only: never an account key or an upstream request.
test("above-reserve edit matches both capability policies and CLI forwards an accepted announcement", { timeout: 20000 }, async () => {
  for (const profile of ["fixture", "mainnet"]) {
    const c = capabilities(profileEngine(profile));
    const minimum = rootAuctionPolicy(c, inspectName("alpha", c.emojiManifest)).reserve;
    const edited = editCartAmount({ ...item, amount: minimum, params: { ...item.params, reserve: minimum } }, (BigInt(minimum) * 3n).toString(), c);
    assert.equal(edited.params.reserve, minimum);
    assert.equal(edited.params.maxBid, edited.amount);
    assert.match(edited.summary, new RegExp(`reserve=${minimum} POA.*maxTotal=${edited.amount} POA`));
  }
  const key = generateKeyPairSync("ed25519").privateKey;
  const issuer = publicPrincipal(key), engine = new Engine(fixtureConfig(issuer, "ed25519:" + "3".repeat(64), []), new ManualClock(1000000));
  const c = capabilities(engine), edited = editCartAmount(item, "250", c), received = [];
  const dir = mkdtempSync(join(tmpdir(), "poa-cart-regression-")), keyFile = join(dir, "fixture.pem");
  writeFileSync(keyFile, key.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const reply = value => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    try {
      if (req.method === "GET" && u.pathname === "/v1/capabilities") return reply(c);
      if (req.method === "GET" && u.pathname === "/v1/state") return reply({ state: engine.snapshot(), observedServerTime: 1000000 });
      if (req.method === "GET" && u.pathname === "/v1/nonce") return reply({ nonce: engine.nextNonce(u.searchParams.get("signer")) });
      if (req.method === "POST" && u.pathname === "/v1/intents") {
        let raw = ""; for await (const chunk of req) raw += chunk;
        const packet = JSON.parse(raw); received.push(packet.body);
        return reply(engine.submit(packet)); // Synthetic in-memory registry only.
      }
      res.writeHead(404); res.end();
    } catch (error) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ["dist/src/reference-cli.js", "act", "--url", `http://127.0.0.1:${server.address().port}`, "--key-file", keyFile, "--action", edited.action, "--params", JSON.stringify(edited.params), "--max-total", edited.amount], { timeout: 15000 });
    assert.equal(JSON.parse(stdout).announceReceipt.status, "succeeded");
    assert.equal(received.length, 1); assert.equal(received[0].action, "announceAuction");
    assert.equal(received[0].params.reserve, c.assets.POA.standardReserve);
    assert.equal(Object.values(engine.snapshot().auctions)[0].reserve, "100");
    assert.equal(edited.amount, "250"); assert.equal(edited.params.maxBid, "250");
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    rmSync(dir, { recursive: true, force: true });
  }
});
