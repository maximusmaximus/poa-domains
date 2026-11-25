import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Engine } from "../../dist/src/engine.js";
import { mainnetConfig } from "../../dist/src/config.js";
import { nativePrincipal } from "../../dist/src/auth.js";
import { BootableSystemClock } from "../../dist/src/seed.js";
import { base58 } from "../../dist/src/native-crypto.js";
import { canonical } from "../../dist/src/core.js";

let bundledCache = null;

async function loadEscrowModules() {
  if (bundledCache) return bundledCache;
  const dir = mkdtempSync(join(tmpdir(), "poa-escrow-mcp-"));
  const outfile = join(dir, "bundle.mjs");
  await build({
    stdin: {
      contents: `
        export * from "./cloudflare/escrow.ts";
        export { CHAIN, verifyCommand, verifyTransfer, txid, micros, decimal, digest } from "./cloudflare/escrow-codec.ts";
        export { marketView, publicCommand, accountView } from "./cloudflare/escrow-public.ts";
        export { registryTitles } from "./cloudflare/escrow-titles.ts";
      `,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    outfile,
    format: "esm",
    platform: "node",
    target: "node22",
    alias: { "#poa-unicode-data": resolve("cloudflare/unicode-data.ts") },
    external: ["node:*", "cloudflare:*"],
  });
  bundledCache = await import(pathToFileURL(outfile).href);
  return bundledCache;
}

function mkKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { key: privateKey, addr: nativePrincipal(privateKey) };
}

export async function createTreasuryAuctionFixture() {
  const mod = await loadEscrowModules();
  const { Escrow, initial, nextEntry, replay, CHAIN, txid, micros, decimal, digest, marketView, publicCommand, registryTitles } = mod;

  const issuer = mkKey();
  const treasury = mkKey();
  const escrowWallet = mkKey();
  const bidder1 = mkKey();
  const bidder2 = mkKey();

  const clock = new BootableSystemClock();
  let nowMs = 1795600000000;
  clock.overrideTime = Math.floor(nowMs / 1000);

  const engine = new Engine(mainnetConfig(issuer.addr, treasury.addr, [bidder1.addr, bidder2.addr]), clock);
  const policy = {
    wallet: escrowWallet.addr,
    treasury: treasury.addr,
    perTx: "250000.000000",
    daily: "1000000.000000",
    feeBps: engine.config.feeBps,
    maxAgeMs: 90000,
  };

  const rows = [];
  const journal = {
    load: () => replay(rows, policy),
    append(event, payload, change) {
      const s = replay(rows, policy);
      const prev = rows.at(-1)?.checksum ?? digest(["escrow-genesis/v1", s.policy]);
      const e = nextEntry(s, prev, event, payload, change, policy);
      rows.push(e);
      return e.state;
    },
  };

  const txs = new Map();
  let walletBalance = 0n;
  let walletNonce = 1;
  let blockHeight = 100;
  const blockRoot = () => createHash("sha256").update(`root:${blockHeight}`).digest("hex");

  const network = {
    async status() {
      return { chain: CHAIN, asOf: nowMs, stale: false, height: blockHeight, root: blockRoot(), fee: "0.000000" };
    },
    async lookup(id) {
      return txs.get(id) ?? null;
    },
    async context() {
      return {
        nextNonce: walletNonce,
        parents: [createHash("sha256").update(`p1:${walletNonce}`).digest("hex"), createHash("sha256").update(`p2:${walletNonce}`).digest("hex")],
        cutoff: Math.floor(nowMs / 1000) - 10,
      };
    },
    async cut(_wallet, ids, status) {
      const covered = ids.filter((id) => txs.has(id));
      return { chain: CHAIN, height: status.height, root: status.root, balance: decimal(walletBalance), covered };
    },
    async submit(body) {
      const id = txid(body);
      if (!txs.has(id)) {
        txs.set(id, { id, body, chain: CHAIN, valid: true, attestations: 5, checkpoint: null });
        walletBalance -= micros(body.amount);
        walletNonce++;
        blockHeight++;
      }
    },
  };

  const signer = {
    address: escrowWallet.addr,
    transfer(body) {
      const sig = base58(sign(null, Buffer.from(canonical(body)), escrowWallet.key));
      return { ...body, sig };
    },
  };

  const escrow = new Escrow(
    journal,
    network,
    signer,
    registryTitles(engine),
    policy,
    () => nowMs,
    () => true,
    () => {},
    () => true,
    () => true,
  );
  await escrow.pause(false);

  const signEscrowCommand = (who, key, action, params) => {
    const command = {
      domain: "poa-domains.escrow.v1",
      chainId: CHAIN,
      registryId: engine.registryId,
      actor: who.addr,
      key,
      expires: Math.floor(nowMs / 1000) + 600,
      action,
      params,
    };
    const signature = base58(sign(null, Buffer.from(canonical(command)), who.key));
    return { command, signature };
  };

  let depNonce = 1;
  const creditFinalDeposit = async (who, intentId, amountStr) => {
    const unsigned = {
      type: "transfer",
      cid: CHAIN,
      from: who.addr,
      to: escrowWallet.addr,
      amount: amountStr,
      memo: `poadomains:${intentId}`,
      nonce: depNonce++,
      parents: [createHash("sha256").update(`dp1:${depNonce}`).digest("hex"), createHash("sha256").update(`dp2:${depNonce}`).digest("hex")],
      ts: Math.floor(nowMs / 1000),
    };
    const body = { ...unsigned, sig: base58(sign(null, Buffer.from(canonical(unsigned)), who.key)) };
    const id = txid(body);
    txs.set(id, { id, body, chain: CHAIN, valid: true, attestations: 5, checkpoint: null });
    walletBalance += micros(amountStr);
    blockHeight++;
    const detectCmd = signEscrowCommand(who, `detect_${intentId.slice(0, 16)}`, "detect", { intent: intentId, txid: id });
    await publicCommand(() => escrow, JSON.stringify(detectCmd), engine.registryId, "command", nowMs, true);
    return id;
  };

  const advanceMs = (deltaMs) => {
    nowMs += deltaMs;
    clock.overrideTime = Math.floor(nowMs / 1000);
  };

  return {
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
  };
}
