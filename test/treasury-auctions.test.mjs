import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { Engine } from "../dist/src/engine.js";
import { mainnetConfig } from "../dist/src/config.js";
import { DEFAULT_RESERVED_NAMES } from "../dist/src/reserved.js";
import { normalizeName } from "../dist/src/names.js";
import { DOMAIN, nativePrincipal, signBody } from "../dist/src/auth.js";
import { BootableSystemClock } from "../dist/src/seed.js";
import { cidFor } from "../dist/src/metadata.js";
import { rightsHash } from "../dist/src/model.js";
import { base58 } from "../dist/src/native-crypto.js";
import { canonical } from "../dist/src/core.js";
import {
  TREASURY_AI_AUCTION_NAMES,
  TREASURY_CRYPTO_AUCTION_NAMES,
  TREASURY_CRYPTO_AI_AUCTION_NAMES,
  treasuryAuctionReservePoa,
  provisionTreasuryAuctionDomains,
} from "../dist/src/treasury-auctions.js";
import { McpCore } from "../dist/src/mcp-core.js";
import { registryMcpProfile } from "../dist/src/mcp-registry.js";
import { publicRegistryRoute, HIDDEN, AUDITED_REGISTRY } from "../dist/public-registry-view.mjs";
import { auditedEngine, get } from "./fixtures/audited-engine.mjs";

function mkKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { key: privateKey, addr: nativePrincipal(privateKey) };
}

function makeSignedPacket(engine, signerKey, signerAddr, action, params, { requestId, maxTotal = "0", time } = {}) {
  const now = time ?? Math.max(Math.floor(Date.now() / 1000), engine.snapshot().time);
  return signBody(
    {
      domain: DOMAIN,
      revision: engine.config.revision,
      chainId: engine.config.chainId,
      genesisHash: engine.config.genesisHash,
      registryId: engine.registryId,
      policyHash: engine.policyHash,
      normalizationHash: engine.config.normalizationHash,
      signer: signerAddr,
      coSigners: [],
      requestId: requestId ?? `req-${action}-${engine.nextNonce(signerAddr)}`,
      nonce: engine.nextNonce(signerAddr),
      notBefore: 0,
      deadline: now + 3600,
      maxTotal,
      maxNetworkFee: "0",
      action,
      params,
    },
    [signerKey],
  );
}

test("TREASURY_CRYPTO_AI_AUCTION_NAMES: 100 unique valid non-reserved non-hidden Crypto & AI root names", () => {
  assert.equal(TREASURY_AI_AUCTION_NAMES.length, 50);
  assert.equal(TREASURY_CRYPTO_AUCTION_NAMES.length, 50);
  assert.equal(TREASURY_CRYPTO_AI_AUCTION_NAMES.length, 100);
  assert.equal(new Set(TREASURY_CRYPTO_AI_AUCTION_NAMES).size, 100);

  const reservedSet = new Set(DEFAULT_RESERVED_NAMES);
  const hiddenSet = new Set(HIDDEN.names);
  for (const name of TREASURY_CRYPTO_AI_AUCTION_NAMES) {
    assert.equal(reservedSet.has(name), false, `${name} must not be in DEFAULT_RESERVED_NAMES`);
    assert.equal(hiddenSet.has(name), false, `${name} must not collide with HIDDEN.names`);
    const norm = normalizeName(name);
    assert.equal(norm.canonical, name, `${name} must be canonical`);
    assert.equal(norm.labels.length, 1, `${name} must be a single root label`);
    assert.equal(
      treasuryAuctionReservePoa(name),
      norm.tier === "premium" ? "1000.000000" : "100.000000",
    );
  }
});

test("issueTreasuryInventory and provisionTreasuryAuctionDomains: treasury acquires 100 non-reserved names safely and idempotently", () => {
  const issuer = mkKey();
  const treasury = mkKey();
  const outsider = mkKey();
  const buyer = mkKey();
  const clock = new BootableSystemClock();
  const engine = new Engine(mainnetConfig(issuer.addr, treasury.addr, [outsider.addr, buyer.addr]), clock);
  const rootRights = rightsHash({ kind: "permanent" }, null);

  const witnessFor = (name) => {
    const doc = { schema: "poa-domains.metadata.v1", name, rightsHash: rootRights, description: `meta for ${name}` };
    return { cid: cidFor(doc), document: doc };
  };

  // Non-treasury cannot invoke issueTreasuryInventory (rejected in admit without burning sequence).
  const seq0 = engine.snapshot().sequence;
  const badCaller = makeSignedPacket(engine, outsider.key, outsider.addr, "issueTreasuryInventory", {
    name: "ai",
    expectedVersion: 0,
    expectedDeedId: null,
    metadata: witnessFor("ai"),
  });
  assert.throws(() => engine.submit(badCaller), (e) => e.code === "NOT_OWNER");
  assert.equal(engine.snapshot().sequence, seq0);

  // Treasury cannot acquire a reserved word via issueTreasuryInventory.
  const reservedAttempt = makeSignedPacket(engine, treasury.key, treasury.addr, "issueTreasuryInventory", {
    name: "bitcoin",
    expectedVersion: 0,
    expectedDeedId: null,
    metadata: witnessFor("bitcoin"),
  });
  const rRes = engine.submit(reservedAttempt);
  assert.equal(rRes.status, "rejected");
  assert.equal(rRes.code, "RESERVED_NAME");

  // Treasury cannot pass non-zero maxTotal.
  const capAttempt = makeSignedPacket(
    engine,
    treasury.key,
    treasury.addr,
    "issueTreasuryInventory",
    { name: "ai", expectedVersion: 0, expectedDeedId: null, metadata: witnessFor("ai") },
    { maxTotal: "100" },
  );
  const rCap = engine.submit(capAttempt);
  assert.equal(rCap.status, "rejected");
  assert.equal(rCap.code, "AMOUNT_CAP");

  // Pre-existing user-owned domain ("defi") must NEVER be overwritten or stolen by Treasury provisioning.
  const buyerIssue = makeSignedPacket(engine, buyer.key, buyer.addr, "issueFromTreasury", {
    name: "defi",
    asset: "POA",
    price: "100000000",
    expectedVersion: 0,
    expectedDeedId: null,
    metadata: witnessFor("defi"),
  });
  assert.equal(engine.submitEscrowIssue(buyerIssue).status, "succeeded");
  assert.equal(engine.resolve("defi").deed.owner, buyer.addr);

  // Provision all 100 Crypto & AI words -> acquires 99 unclaimed ones, skips buyer-owned "defi".
  const firstRun = provisionTreasuryAuctionDomains(engine, clock, treasury.key);
  assert.equal(firstRun.length, 99);
  assert.equal(engine.resolve("defi").deed.owner, buyer.addr);
  assert.equal(engine.resolve("ai").deed.owner, treasury.addr);
  assert.equal(engine.resolve("llm").deed.owner, treasury.addr);
  assert.equal(engine.resolve("web3").deed.owner, treasury.addr);
  assert.equal(engine.resolve("whale").deed.owner, treasury.addr);

  // Re-running provisioning is a 100% idempotent no-op.
  const seqAfter = engine.snapshot().sequence;
  assert.deepEqual(provisionTreasuryAuctionDomains(engine, clock, treasury.key), []);
  assert.equal(engine.snapshot().sequence, seqAfter);

  // Even after "ai" transfers to a buyer (auction winner), re-running provisioning does NOT re-mint it.
  const aiDeed = engine.resolve("ai").deed;
  const xfer = makeSignedPacket(engine, treasury.key, treasury.addr, "transfer", {
    name: "ai",
    expectedDeedId: aiDeed.id,
    expectedVersion: aiDeed.version,
    recipient: buyer.addr,
  });
  assert.equal(engine.submit(xfer).status, "succeeded");
  assert.equal(engine.resolve("ai").deed.owner, buyer.addr);
  assert.deepEqual(provisionTreasuryAuctionDomains(engine, clock, treasury.key), []);
});

test("Escrow seedInventoryAuctions + MCP POA auction tools: atomic 100-auction open, first-bid timer, >10% outbid credit, withdraw & settle", async () => {
  const fixtureMod = await import("./fixtures/escrow-mcp-helper.mjs");
  const {
    escrow,
    engine,
    clock,
    treasury,
    bidder1,
    bidder2,
    signEscrowCommand,
    creditFinalDeposit,
    advanceMs,
    marketView,
    publicCommand,
  } = await fixtureMod.createTreasuryAuctionFixture();

  // 1. Acquire all 100 Crypto & AI words for Treasury and seed all 100 as first-bid POA auctions in ONE journal entry.
  const minted = provisionTreasuryAuctionDomains(engine, clock, treasury.key);
  assert.equal(minted.length, 100);
  const seqBeforeSeed = escrow.state().sequence;
  const seedSpecs = TREASURY_CRYPTO_AI_AUCTION_NAMES.map((name) => ({ name, reserve: treasuryAuctionReservePoa(name) }));
  const opened = escrow.seedInventoryAuctions(treasury.addr, seedSpecs);
  assert.equal(opened.length, 100);
  assert.equal(escrow.state().sequence, seqBeforeSeed + 1, "All 100 auctions must open in ONE atomic journal entry");

  // Re-seeding is a 100% idempotent no-op.
  assert.deepEqual(escrow.seedInventoryAuctions(treasury.addr, seedSpecs), []);
  assert.equal(escrow.state().sequence, seqBeforeSeed + 1);

  // marketView returns all 100 auctions (not truncated by old 100-item slice).
  const allMarket = marketView(escrow.state());
  assert.equal(allMarket.length, 100);
  assert.ok(allMarket.every((a) => a.awaitingFirstBid === true && a.closes === 0 && a.price === treasuryAuctionReservePoa(a.name)));

  // 2. Wire real McpCore + registryMcpProfile to this real Engine + Escrow backend.
  const mcp = new McpCore(
    registryMcpProfile(async (method, path, query = {}, body) => {
      if (path === "/v1/escrow/capabilities" && method === "GET") {
        return {
          enabled: true,
          paused: escrow.state().paused,
          held: false,
          holdReason: null,
          address: escrow.policy.wallet,
          limits: { perTransaction: escrow.policy.perTx, daily: escrow.policy.daily },
          serverTime: clock.now() * 1000,
          registryId: engine.registryId,
        };
      }
      if (path === "/v1/escrow/market" && method === "GET") {
        return { items: marketView(escrow.state()), serverTime: clock.now() * 1000 };
      }
      if (path === "/v1/escrow/domain" && method === "GET") {
        return { items: marketView(escrow.state(), query.name), serverTime: clock.now() * 1000 };
      }
      if (path === "/v1/escrow/intent" && method === "GET") {
        return escrow.depositView(query.id, query.txid);
      }
      if (path === "/v1/escrow/command" && method === "POST") {
        return publicCommand(() => escrow, JSON.stringify(body), engine.registryId, "command", clock.now() * 1000, true);
      }
      throw Error(`Unexpected MCP backend call: ${method} ${path}`);
    }),
    true,
  );

  const callTool = async (id, name, args = {}) => {
    const res = await mcp.handle(
      JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    );
    assert.ok(!res.error, JSON.stringify(res));
    assert.equal(res.result.isError, false, JSON.stringify(res));
    return res.result.structuredContent;
  };

  // Verify tools/list exposes all 17 tools including all 4 POA auction/escrow tools + bid_on_poa_auction prompt.
  const toolsRes = await mcp.handle(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
  const toolNames = toolsRes.result.tools.map((t) => t.name);
  assert.equal(toolNames.length, 17);
  for (const t of ["get_escrow_capabilities", "list_poa_auctions", "get_escrow_intent", "submit_escrow_command"]) {
    assert.ok(toolNames.includes(t), t);
  }
  const promptRes = await mcp.handle(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "bid_on_poa_auction", arguments: { name: "ai" } } }),
  );
  assert.match(promptRes.result.messages[0].content.text, /list_poa_auctions/);
  assert.match(promptRes.result.messages[0].content.text, /submit_escrow_command/);

  // MCP get_escrow_capabilities
  const cap = await callTool(3, "get_escrow_capabilities");
  assert.equal(cap.enabled, true);
  assert.equal(cap.held, false);

  // MCP list_poa_auctions: 100 queued, 0 live
  const queuedList = await callTool(4, "list_poa_auctions", { phase: "queued" });
  assert.equal(queuedList.total, 100);
  assert.equal(queuedList.counts.queued, 100);
  assert.equal(queuedList.counts.live, 0);

  // MCP list_poa_auctions filtered by premium name="ai" (1000 POA reserve) and standard name="defi" (100 POA reserve)
  const aiLookup = await callTool(5, "list_poa_auctions", { name: "ai" });
  assert.equal(aiLookup.total, 1);
  assert.equal(aiLookup.items[0].name, "ai");
  assert.equal(aiLookup.items[0].awaitingFirstBid, true);
  assert.equal(aiLookup.items[0].minimumNextBid, "1000.000000");

  const defiLookup = await callTool(50, "list_poa_auctions", { name: "defi" });
  assert.equal(defiLookup.total, 1);
  const defiAuction = defiLookup.items[0];
  assert.equal(defiAuction.name, "defi");
  assert.equal(defiAuction.awaitingFirstBid, true);
  assert.equal(defiAuction.minimumNextBid, "100.000000");

  // Bidder 1 creates deposit intent via MCP submit_escrow_command, checks via get_escrow_intent, credits final deposit, and places first bid via MCP!
  const b1IntentCmd = signEscrowCommand(bidder1, "b1_intent_1", "intent", { amount: "200.000000" });
  const b1IntentRes = await callTool(6, "submit_escrow_command", b1IntentCmd);
  const b1IntentId = b1IntentRes.result.intent;
  const b1IntentStatus = await callTool(7, "get_escrow_intent", { id: b1IntentId });
  assert.equal(b1IntentStatus.status, "waiting");
  await creditFinalDeposit(bidder1, b1IntentId, "200.000000");
  assert.equal((await callTool(8, "get_escrow_intent", { id: b1IntentId })).status, "final");

  // Place first bid via MCP submit_escrow_command -> starts the countdown timer!
  const b1BidCmd = signEscrowCommand(bidder1, "b1_bid_defi", "bid", { auction: defiAuction.id, amount: "100.000000" });
  const b1BidRes = await callTool(9, "submit_escrow_command", b1BidCmd);
  assert.equal(b1BidRes.account.available, "100.000000");
  assert.equal(b1BidRes.account.lockedInAuctions, "100.000000");

  // MCP list_poa_auctions now reports 1 live auction ("defi") and 99 queued!
  const afterFirstBid = await callTool(10, "list_poa_auctions", { phase: "live" });
  assert.equal(afterFirstBid.total, 1);
  assert.equal(afterFirstBid.counts.live, 1);
  assert.equal(afterFirstBid.counts.queued, 99);
  assert.equal(afterFirstBid.items[0].name, "defi");
  assert.equal(afterFirstBid.items[0].awaitingFirstBid, false);
  assert.ok(afterFirstBid.items[0].closes > 0);
  assert.equal(afterFirstBid.items[0].minimumNextBid, "110.000001");

  // Bidder 2 deposits and outbids Bidder 1 by >10% via MCP -> Bidder 1 gets instant available credit back!
  const b2IntentRes = await callTool(11, "submit_escrow_command", signEscrowCommand(bidder2, "b2_intent_1", "intent", { amount: "150.000000" }));
  await creditFinalDeposit(bidder2, b2IntentRes.result.intent, "150.000000");
  await callTool(12, "submit_escrow_command", signEscrowCommand(bidder2, "b2_bid_defi", "bid", { auction: defiAuction.id, amount: "120.000000" }));

  // Check Bidder 1's account via MCP view: full 200.000000 POA immediately available again!
  const b1View = await callTool(13, "submit_escrow_command", signEscrowCommand(bidder1, "b1_view_after_outbid", "view", {}));
  assert.equal(b1View.account.available, "200.000000");
  assert.equal(b1View.account.lockedInAuctions, "0.000000");

  // Bidder 1 withdraws displaced balance via MCP withdraw -> queued ONLY to bidder1's original wallet!
  const b1Withdraw = await callTool(14, "submit_escrow_command", signEscrowCommand(bidder1, "b1_withdraw_1", "withdraw", { amount: "200.000000" }));
  assert.equal(b1Withdraw.account.available, "0.000000");
  assert.equal(b1Withdraw.account.refunds.length, 1);
  assert.equal(b1Withdraw.account.refunds[0].amount, "200.000000");

  // Advance clock past auction close, settle via Treasury-signed transfer + MCP settle command -> Bidder 2 owns "defi"!
  advanceMs(3600000 + 5000);
  const defiDeed = engine.resolve("defi").deed;
  const transferPacket = makeSignedPacket(
    engine,
    treasury.key,
    treasury.addr,
    "transfer",
    {
      name: "defi",
      expectedDeedId: defiDeed.id,
      expectedVersion: defiDeed.version,
      recipient: bidder2.addr,
    },
    { time: clock.now() },
  );
  await callTool(15, "submit_escrow_command", signEscrowCommand(treasury, "treasury_settle_defi", "settle", {
    auction: defiAuction.id,
    transfer: transferPacket,
  }));
  await escrow.tick();
  await escrow.tick();
  await escrow.tick();
  await escrow.tick();
  assert.equal(engine.resolve("defi").deed.owner, bidder2.addr);
  assert.equal(escrow.state().auctions[defiAuction.id].status, "COMPLETE");

  // Re-seeding NEVER re-lists the sold "defi" domain (neither v1 nor v2)!
  assert.deepEqual(escrow.seedInventoryAuctions(treasury.addr, seedSpecs), []);
  assert.deepEqual(escrow.seedInventoryAuctions(treasury.addr, seedSpecs, "treasury-inventory-auction-v2"), []);

  // If a Treasury-owned auction was CANCELLED (still owned by Treasury), v2 re-lists ONLY that cancelled name once.
  const coinLookup = await callTool(16, "list_poa_auctions", { name: "coin" });
  const coinV1 = coinLookup.items[0];
  await callTool(17, "submit_escrow_command", signEscrowCommand(treasury, "treasury_cancel_coin_v1", "cancel", { auction: coinV1.id }));
  const relisted = escrow.seedInventoryAuctions(treasury.addr, seedSpecs, "treasury-inventory-auction-v2");
  assert.equal(relisted.length, 1);
  assert.equal(escrow.state().auctions[relisted[0]].name, "coin");
  assert.equal(escrow.state().auctions[relisted[0]].status, "OPEN");
  // Re-running v2 is a 100% idempotent no-op.
  assert.deepEqual(escrow.seedInventoryAuctions(treasury.addr, seedSpecs, "treasury-inventory-auction-v2"), []);
});

test("publicRegistryRoute exposes all 100 Treasury Crypto+AI auction domains while withholding legacy hidden records", () => {
  const e = auditedEngine();
  assert.equal(e.registryId, AUDITED_REGISTRY);
  const treasuryAddr = e.config.treasury;
  const rootRights = rightsHash({ kind: "permanent" }, null);

  let seq = 20;
  for (const name of TREASURY_CRYPTO_AI_AUCTION_NAMES) {
    seq++;
    const deedId = createHash("sha256").update(`deed:${name}`).digest("hex");
    const recId = createHash("sha256").update(`receipt:${name}`).digest("hex");
    const doc = { schema: "poa-domains.metadata.v1", name, rightsHash: rootRights, description: `Treasury inventory ${name}` };
    e.state.names[name] = { name, key: createHash("sha256").update(`key:${name}`).digest("hex"), generation: 1, activeId: deedId, auctionId: null };
    e.state.deeds[deedId] = {
      id: deedId, name, generation: 1, owner: treasuryAddr, ownerVersion: 1, version: 1, parentId: null,
      rights: { kind: "permanent" }, rightsHash: rootRights, expiry: null, renewals: 0, retired: false,
      metadata: [{ cid: cidFor(doc), document: doc }], records: [], recordsVersion: 0, lock: null, encumbranceVersion: 0,
    };
    e.state.receipts[recId] = {
      intentId: recId, requestId: `treasury-inventory-${name}-v1`, signer: treasuryAddr, sequence: seq,
      time: 1795580000 + seq, status: "succeeded", code: "OK", result: { deedId, name, owner: treasuryAddr },
    };
    e.state.requests[`${treasuryAddr}:treasury-inventory-${name}-v1`] = recId;
  }
  e.state.nonces[treasuryAddr] = 100;
  e.state.sequence = seq;

  const stateRes = get(e, "/v1/state");
  assert.equal(stateRes.status, 200);
  const st = stateRes.data.state;
  assert.equal(Object.keys(st.names).length, 100);
  assert.equal(Object.keys(st.deeds).length, 100);
  assert.equal(Object.keys(st.receipts).length, 100);
  assert.deepEqual(st.balances, {});
  assert.deepEqual(st.auctions, {});
  assert.deepEqual(st.offers, {});
  for (const hName of HIDDEN.names) assert.equal(st.names[hName], undefined);
  for (const name of ["ai", "defi", "llm", "web3", "whale"]) {
    const r = get(e, "/v1/resolve", { name });
    assert.equal(r.status, 200, name);
    assert.equal(r.data.deed.owner, treasuryAddr);
  }
  assert.equal(get(e, "/v1/resolve", { name: "nexus" }).status, 409);
  assert.equal(get(e, "/v1/nonce", { signer: HIDDEN.accounts[0] }).status, 409);
});
