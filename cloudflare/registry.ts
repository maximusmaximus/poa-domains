import { AUDITED_REGISTRY, publicRegistryRoute } from "./public-registry-view.js";
import { registryRoute, type RegistryCall, type RegistryReply } from "../src/registry-routes.js";
import { marketView, publicCommand, subnameView, waitTimeTelemetry } from "./escrow-public.js";
import { escrowPacketBlocked, registryTitles } from "./escrow-titles.js";
import { backupCommittedProfile } from "./profiles-storage.js";
import { validPoaAddr } from "./treasury.js";
import { DurableObject } from "cloudflare:workers";
import { createPrivateKey, generateKeyPairSync, KeyObject } from "node:crypto";
import { Escrow, Policy, SQLiteEscrowJournal, EscrowArchive, exportEscrow, restoreEscrow, reviewedCredit, replay as replayEscrow, type SurplusStore, type SurplusWatermark } from "./escrow.js";
import { CHAIN, WorkerSecretSigner, verifyCommand, digest } from "./escrow-codec.js";
import { PoaHttpNetwork, MAINNET_ENGINE_SHA256, MAINNET_PARAMS_SHA256, PILOT_PER_TX, PILOT_DAILY, type CoveredTxCache } from "./escrow-network.js";
import { nativePrincipal } from "../src/auth.js";
import { mainnetConfig, Config } from "../src/config.js";
import { POA_NEW_NAME_PRICE_RULE, POA_NEW_NAME_PRICES } from "../src/new-name-prices.js";
import { Engine } from "../src/engine.js";
import { Fault, exact, need, parseJSON } from "../src/core.js";
import { capabilities } from "../src/interface.js";
import { normalizeName } from "../src/names.js";
import { provisionProtocolDomains, type ProvisionedProtocolDomain } from "../src/protocol-domains.js";
import { buildTreasuryAutoHandover, provisionTreasuryAuctionDomains, treasuryAuctionReservePoa, TREASURY_CRYPTO_AI_AUCTION_NAMES } from "../src/treasury-auctions.js";
import { BootableSystemClock, seedRegistry } from "../src/seed.js";
import { SQLiteJournal } from "./sqlite-journal.js";
import { BackupKind, JournalRow, buildBackup, encryptSecrets, journalHeadOf, secretAad, verifyBackup } from "./backup-codec.js";
import type { FeedbackChallengeRow, FeedbackConsumeInput, FeedbackConsumeResult } from "./feedback.js";
import type { TermsAgreementRecord } from "./terms.js";

export interface BackupExport { bodyText: string; sha256: string; size: number; sequence: number; stateHash: string; createdAt: string; }
export type EscrowExport = EscrowArchive;
export interface RestoreResult { escrowSourceHead?: string; sequence: number; stateHash: string; journalHead: string | null; principals: Record<string, string>; }

export const DURABILITY = "durable-object-sqlite";
export const SINGLETON = "poa-mainnet-registry-v1"; // Never include a build/version id here.
const ROLES = ["issuer", "treasury", "alice", "bob", "carol"] as const;
class CloudflareEngine extends Engine {
  override durability(): string { return DURABILITY; }
}
interface Bootstrap {
  format: "poa-do-sqlite-v1";
  config: Config;
  policyHash: string;
  principals: Record<string, string>;
  keys: Record<string, string>;
}
export type { RegistryCall, RegistryReply } from "../src/registry-routes.js";

/** POA new-name checkout (primary issuance via escrow). */
export const NEW_NAME_PRICE_RULE=POA_NEW_NAME_PRICE_RULE;
export function subnameSales(env:{POA_ESCROW_SUBNAMES?:string}):{status:"on"|"off";rule:string}{
  return {status:String(env.POA_ESCROW_SUBNAMES)==="approved-v1"?"on":"off",rule:"Parent holders set one fixed POA price for new subnames; buyers pay through POA checkout; holder proceeds are paid out from escrow"};
}
export function newNameCheckout(env:{POA_ESCROW_NEW_NAMES?:string}):{status:"on"|"off";priceRule:string;prices:typeof POA_NEW_NAME_PRICES}{
  return {status:String(env.POA_ESCROW_NEW_NAMES)==="approved-v1"?"on":"off",priceRule:NEW_NAME_PRICE_RULE,prices:POA_NEW_NAME_PRICES};
}

export class PoaRegistry extends DurableObject<Env> {
  private engine!: CloudflareEngine;
  private escrowService?: Escrow;
  private principals!: Record<string, string>;
  private pendingProtocolBackups: ProvisionedProtocolDomain[] = [];
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      try { this.#initialize(); }
      catch {
        // Private bootstrap/parser exceptions must never expose storage/key contents.
        console.error(JSON.stringify({ event: "registry-initialization-failed", code: "PRIVATE_STORAGE_INVALID" }));
        throw new Error("REGISTRY_INITIALIZATION_FAILED");
      }
      if (this.pendingProtocolBackups.length) {
        const queued = this.pendingProtocolBackups.splice(0);
        ctx.waitUntil(
          Promise.all(queued.map(({ packet, receipt }) => backupCommittedProfile(env, packet, receipt))).then(
            () => undefined,
            () => undefined,
          ),
        );
      }
      if (String(env.POA_ESCROW_ENABLED) === "true" && String(env.POA_ESCROW_NETWORK_WRITES) === "approved-v1") {
        const existingAlarm = await ctx.storage.getAlarm();
        if (existingAlarm === null || existingAlarm > Date.now() + 15000) {
          await ctx.storage.setAlarm(Date.now() + 2000);
        }
      }
    });
  }
  /** Display-only last known PoA network status. Separate table: never registry state, journal, hash, sequence or backup. */
  lastNetworkStatus(): { at: number; value: string } | null {
    const sql = this.ctx.storage.sql;
    if (!sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='network_status_cache'").toArray().length) return null;
    return sql.exec<{ at: number; value: string }>("SELECT at, value FROM network_status_cache WHERE id=1").toArray()[0] ?? null;
  }
  saveNetworkStatus(at: number, value: string): void {
    if (!Number.isSafeInteger(at) || at < 0 || typeof value !== "string" || value.length > 4096) throw new TypeError("invalid network status row");
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS network_status_cache (id INTEGER PRIMARY KEY CHECK(id=1), at INTEGER NOT NULL, value TEXT NOT NULL)");
    // Newest observation wins across isolates.
    sql.exec("INSERT INTO network_status_cache(id, at, value) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at=excluded.at, value=excluded.value WHERE excluded.at >= network_status_cache.at", at, value);
  }
  /** Read-only public addresses for the Domains Treasury footer balance aggregator. */
  treasuryAddresses(): { escrow: string | null; treasury: string | null } {
    const escrow = typeof this.env.POA_ESCROW_ADDRESS === "string" && this.env.POA_ESCROW_ADDRESS.trim()
      ? this.env.POA_ESCROW_ADDRESS.trim()
      : null;
    const treasury = typeof this.engine?.config?.treasury === "string" && this.engine.config.treasury.trim()
      ? this.engine.config.treasury.trim()
      : null;
    return { escrow, treasury };
  }
  #ensureTermsTable(): void {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS terms_agreements (actor TEXT NOT NULL, terms_version TEXT NOT NULL, terms_hash TEXT NOT NULL, agreed_at INTEGER NOT NULL, recorded_at INTEGER NOT NULL, signature TEXT NOT NULL, statement_json TEXT NOT NULL, PRIMARY KEY (actor, terms_version));",
    );
  }
  /** Isolated Terms acceptance table for signed agent attestations; never part of registry state, journal, or backups. */
  getTermsAgreement(actor: string, termsVersion: string): TermsAgreementRecord | null {
    this.#ensureTermsTable();
    const row = this.ctx.storage.sql.exec<{
      actor: string;
      terms_version: string;
      terms_hash: string;
      agreed_at: number;
      recorded_at: number;
      signature: string;
      statement_json: string;
    }>(
      "SELECT actor, terms_version, terms_hash, agreed_at, recorded_at, signature, statement_json FROM terms_agreements WHERE actor = ? AND terms_version = ?",
      actor,
      termsVersion,
    ).toArray()[0];
    if (!row) return null;
    return {
      actor: String(row.actor),
      termsVersion: String(row.terms_version),
      termsHash: String(row.terms_hash),
      agreedAt: Number(row.agreed_at),
      recordedAt: Number(row.recorded_at),
      signature: String(row.signature),
      statementJson: String(row.statement_json),
    };
  }
  recordTermsAgreement(row: TermsAgreementRecord): { record: TermsAgreementRecord; alreadyAgreed: boolean } {
    this.#ensureTermsTable();
    return this.ctx.storage.transactionSync(() => {
      const existing = this.getTermsAgreement(row.actor, row.termsVersion);
      if (existing && existing.termsHash === row.termsHash) {
        return { record: existing, alreadyAgreed: true };
      }
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO terms_agreements(actor, terms_version, terms_hash, agreed_at, recorded_at, signature, statement_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        row.actor,
        row.termsVersion,
        row.termsHash,
        row.agreedAt,
        row.recordedAt,
        row.signature,
        row.statementJson,
      );
      return { record: row, alreadyAgreed: false };
    });
  }
  #ensureFeedbackTables(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS feedback_challenges (id TEXT PRIMARY KEY, answer_hash TEXT NOT NULL, svg TEXT NOT NULL, pow_salt TEXT NOT NULL, pow_bits INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip_hash TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);" +
      "CREATE TABLE IF NOT EXISTS feedback_events (id TEXT PRIMARY KEY, ip_hash TEXT NOT NULL, poa_hash TEXT, content_hash TEXT NOT NULL, created_at INTEGER NOT NULL);",
    );
  }
  /** Ephemeral side table for single-use CAPTCHA challenges; never part of registry state, journal, or backups. */
  createFeedbackChallenge(row: FeedbackChallengeRow): { ok: true } | { ok: false; code: string } {
    this.#ensureFeedbackTables();
    const sql = this.ctx.storage.sql;
    const now = row.createdAt;
    sql.exec("DELETE FROM feedback_challenges WHERE expires_at <= ? OR used = 1", now);
    const recentIp = sql.exec<{ n: number }>(
      "SELECT COUNT(*) AS n FROM feedback_challenges WHERE ip_hash = ? AND created_at > ?",
      row.ipHash,
      now - 10 * 60_000,
    ).one().n;
    if (recentIp >= 15) return { ok: false, code: "FEEDBACK_RATE_LIMITED" };
    const totalActive = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM feedback_challenges").one().n;
    if (totalActive >= 500) {
      sql.exec("DELETE FROM feedback_challenges WHERE id IN (SELECT id FROM feedback_challenges ORDER BY created_at ASC LIMIT 100)");
    }
    sql.exec(
      "INSERT INTO feedback_challenges(id, answer_hash, svg, pow_salt, pow_bits, created_at, expires_at, ip_hash, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
      row.id,
      row.answerHash,
      row.svg,
      row.powSalt,
      row.powBits,
      row.createdAt,
      row.expiresAt,
      row.ipHash,
    );
    return { ok: true };
  }
  getFeedbackChallengeMeta(id: string, now: number): { powSalt: string; powBits: number; svg: string } | null {
    this.#ensureFeedbackTables();
    const sql = this.ctx.storage.sql;
    const row = sql.exec<{ pow_salt: string; pow_bits: number; svg: string }>(
      "SELECT pow_salt, pow_bits, svg FROM feedback_challenges WHERE id = ? AND used = 0 AND expires_at > ?",
      id,
      now,
    ).toArray()[0];
    if (!row) return null;
    return { powSalt: row.pow_salt, powBits: Number(row.pow_bits), svg: row.svg };
  }
  consumeFeedbackChallenge(input: FeedbackConsumeInput): FeedbackConsumeResult {
    this.#ensureFeedbackTables();
    const sql = this.ctx.storage.sql;
    return this.ctx.storage.transactionSync((): FeedbackConsumeResult => {
      sql.exec("DELETE FROM feedback_events WHERE created_at <= ?", input.now - 24 * 60 * 60_000);
      const row = sql.exec<{
        answer_hash: string;
        pow_salt: string;
        pow_bits: number;
        created_at: number;
        expires_at: number;
        ip_hash: string;
        used: number;
      }>(
        "SELECT answer_hash, pow_salt, pow_bits, created_at, expires_at, ip_hash, used FROM feedback_challenges WHERE id = ?",
        input.id,
      ).toArray()[0];
      if (!row || row.used !== 0 || row.expires_at <= input.now || row.ip_hash !== input.ipHash) {
        return { ok: false, code: "FEEDBACK_CAPTCHA_EXPIRED" };
      }
      if (input.now - Number(row.created_at) < input.minDwellMs) {
        return { ok: false, code: "FEEDBACK_TOO_FAST" };
      }
      // Single-use burn on any attempt so callers get strictly one guess per challenge.
      sql.exec("UPDATE feedback_challenges SET used = 1, svg = '' WHERE id = ?", input.id);
      let diff = row.answer_hash.length ^ input.answerHash.length;
      const len = Math.min(row.answer_hash.length, input.answerHash.length);
      for (let i = 0; i < len; i++) diff |= row.answer_hash.charCodeAt(i) ^ input.answerHash.charCodeAt(i);
      if (diff !== 0) {
        return { ok: false, code: "FEEDBACK_CAPTCHA_INVALID" };
      }
      const ipHour = sql.exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM feedback_events WHERE ip_hash = ? AND created_at > ?",
        input.ipHash,
        input.now - 60 * 60_000,
      ).one().n;
      if (ipHour >= 3) return { ok: false, code: "FEEDBACK_RATE_LIMITED", retryAfterSec: 1800 };
      const ipDay = sql.exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM feedback_events WHERE ip_hash = ?",
        input.ipHash,
      ).one().n;
      if (ipDay >= 6) return { ok: false, code: "FEEDBACK_RATE_LIMITED", retryAfterSec: 3600 };
      if (input.poaHash) {
        const poaDay = sql.exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM feedback_events WHERE poa_hash = ?",
          input.poaHash,
        ).one().n;
        if (poaDay >= 5) return { ok: false, code: "FEEDBACK_RATE_LIMITED", retryAfterSec: 3600 };
      }
      const globalDay = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM feedback_events").one().n;
      if (globalDay >= 25) return { ok: false, code: "FEEDBACK_RATE_LIMITED", retryAfterSec: 3600 };
      const dup = sql.exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM feedback_events WHERE content_hash = ?",
        input.contentHash,
      ).one().n;
      if (dup > 0) return { ok: false, code: "FEEDBACK_DUPLICATE" };
      sql.exec(
        "INSERT INTO feedback_events(id, ip_hash, poa_hash, content_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        input.id,
        input.ipHash,
        input.poaHash,
        input.contentHash,
        input.now,
      );
      return { ok: true, powSalt: row.pow_salt, powBits: Number(row.pow_bits) };
    });
  }
  #initialize(): void {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS bootstrap (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS journal (sequence INTEGER PRIMARY KEY, record TEXT NOT NULL)");
    const saved = sql.exec<{ value: string }>("SELECT value FROM bootstrap WHERE id=1").toArray();
    const clock = new BootableSystemClock();
    if (saved.length === 0) {
      need(sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM journal").one().n === 0, "BOOTSTRAP_MISSING");
      // Keys, immutable config, and all 15 seed intents commit atomically.
      this.ctx.storage.transactionSync(() => {
        const keys: Record<string, KeyObject> = {}, pem: Record<string, string> = {}, principals: Record<string, string> = {};
        for (const role of ROLES) {
          keys[role] = generateKeyPairSync("ed25519").privateKey;
          principals[role] = nativePrincipal(keys[role]!);
          pem[role] = keys[role]!.export({ format: "pem", type: "pkcs8" }).toString();
        }
        const config = mainnetConfig(principals.issuer!, principals.treasury!, [principals.alice!, principals.bob!, principals.carol!]);
        const engine = new CloudflareEngine(config, clock);
        const bootstrap: Bootstrap = { format: "poa-do-sqlite-v1", config, policyHash: engine.policyHash, principals, keys: pem };
        sql.exec("INSERT INTO bootstrap(id, value) VALUES (1, ?)", JSON.stringify(bootstrap));
        engine.attach(new SQLiteJournal(this.ctx.storage, engine));
        seedRegistry(engine, clock, principals, keys);
        this.engine = engine;
        this.principals = principals;
      });
    } else {
      // Private bootstrap contains multiline PEMs; the public intent parser deliberately
      // forbids such strings. Bound and validate this private storage codec separately.
      need(new TextEncoder().encode(saved[0]!.value).byteLength <= 262144, "BOOTSTRAP_SIZE");
      const b = exact(JSON.parse(saved[0]!.value), ["format", "config", "policyHash", "principals", "keys"]) as unknown as Bootstrap;
      need(b.format === "poa-do-sqlite-v1", "BOOTSTRAP_FORMAT");
      exact(b.principals, [...ROLES]); exact(b.keys, [...ROLES]);
      for (const role of ROLES) need(nativePrincipal(createPrivateKey(b.keys[role]!)) === b.principals[role], "KEY_IDENTITY_MISMATCH");
      need(b.config.issuer === b.principals.issuer && b.config.treasury === b.principals.treasury, "MANIFEST_MISMATCH");
      this.engine = new CloudflareEngine(b.config, clock);
      need(this.engine.policyHash === b.policyHash, "MANIFEST_MISMATCH");
      this.engine.attach(new SQLiteJournal(this.ctx.storage, this.engine));
      this.principals = b.principals;
      const escrowAddress = validPoaAddr(this.env.POA_ESCROW_ADDRESS);
      const isLiveSingleton =
        this.engine.registryId === AUDITED_REGISTRY &&
        (!this.env.REGISTRY || this.ctx.id.equals(this.env.REGISTRY.idFromName(SINGLETON)));
      if (isLiveSingleton && escrowAddress) {
        const treasuryKey = createPrivateKey(b.keys.treasury!);
        const provisioned = provisionProtocolDomains(
          this.engine,
          clock,
          treasuryKey,
          escrowAddress,
        );
        if (provisioned.length) {
          this.pendingProtocolBackups.push(...provisioned);
        }
        const mintedInventory = provisionTreasuryAuctionDomains(
          this.engine,
          clock,
          treasuryKey,
        );
        if (mintedInventory.length) {
          console.log(JSON.stringify({ event: "treasury-inventory-provisioned", count: mintedInventory.length }));
        }
        if (String(this.env.POA_ESCROW_ENABLED) === "true") {
          try {
            const specs = TREASURY_CRYPTO_AI_AUCTION_NAMES.map((name) => ({
              name,
              reserve: treasuryAuctionReservePoa(name),
            }));
            const opened = [
              ...this.escrow().seedInventoryAuctions(this.engine.config.treasury, specs),
              // Idempotently re-open any Treasury catalog name whose v1 auction expired while still Treasury-owned.
              ...this.escrow().seedInventoryAuctions(this.engine.config.treasury, specs, "treasury-inventory-auction-v2"),
            ];
            if (opened.length) {
              console.log(JSON.stringify({ event: "treasury-auctions-seeded", count: opened.length }));
            }
          } catch (error) {
            const code = error instanceof Error && /^ESCROW_[A-Z_]+$/.test(error.message) ? error.message : "ESCROW_SEED_SKIPPED";
            console.error(JSON.stringify({ event: "treasury-auctions-seed-skipped", code }));
          }
        }
      }
    }
    console.log(JSON.stringify({ event: "registry-ready", sequence: this.engine.snapshot().sequence,
      durability: DURABILITY, livePoA: false, principals: this.principals }));
  }
  // Backup export. Registry rows are read synchronously (one consistent point in time);
  // role keys leave this object only inside an envelope encrypted to BACKUP_PUBLIC_KEY_SPKI.
  async exportBackup(kind: BackupKind): Promise<BackupExport> {
    const sql = this.ctx.storage.sql;
    const saved = JSON.parse(sql.exec<{ value: string }>("SELECT value FROM bootstrap WHERE id=1").one().value) as Bootstrap;
    const journal: JournalRow[] = sql.exec<{ sequence: number; record: string }>("SELECT sequence, record FROM journal ORDER BY sequence ASC")
      .toArray().map((r) => ({ sequence: Number(r.sequence), record: String(r.record) }));
    const sequence = this.engine.snapshot().sequence, stateHash = this.engine.stateHash();
    need(journal.length === sequence, "BACKUP_SEQUENCE_MISMATCH");
    const head = { sequence, stateHash, journalHead: journalHeadOf(journal) };
    const createdAt = new Date().toISOString();
    // Escrow financial records belong inside the encrypted envelope, never the public journal.
    const escrow = exportEscrow(this.ctx.storage);
    const secrets = await encryptSecrets({ keys: saved.keys, ...(escrow ? { escrow } : {}) }, this.env.BACKUP_PUBLIC_KEY_SPKI ?? "", secretAad(saved.policyHash, head));
    const { bodyText, sha256, size } = await buildBackup({ createdAt, kind, head, journal, secrets,
      registry: { singleton: SINGLETON, bootstrapFormat: saved.format, config: saved.config, policyHash: saved.policyHash, principals: saved.principals } });
    return { bodyText, sha256, size, sequence, stateHash, createdAt };
  }
  // Restore into THIS object. Only allowed in local dev (BACKUP_RESTORE_ENABLED=local-only)
  // and never into the production singleton. Full signature/hash-chain replay validates it.
  async restoreBackup(backupText: string, keys: Record<string, string>, escrow?: EscrowExport): Promise<RestoreResult> {
    need(this.env.BACKUP_RESTORE_ENABLED === "local-only", "RESTORE_DISABLED");
    need(!this.ctx.id.equals(this.env.REGISTRY.idFromName(SINGLETON)), "RESTORE_TARGET_IS_LIVE");
    const b = await verifyBackup(JSON.parse(backupText));
    exact(keys, [...ROLES]);
    const bootstrap: Bootstrap = { format: "poa-do-sqlite-v1", config: b.registry.config as Config, policyHash: b.registry.policyHash, principals: b.registry.principals, keys };
    const sql = this.ctx.storage.sql;
    if (escrow) replayEscrow(escrow.rows, escrow.policy);
    this.ctx.storage.transactionSync(() => {
      sql.exec("DELETE FROM journal"); sql.exec("DELETE FROM bootstrap");
      sql.exec("DROP TABLE IF EXISTS escrow_covered_tx_cache");
      sql.exec("DROP TABLE IF EXISTS escrow_surplus_watermark");
      sql.exec("INSERT INTO bootstrap(id, value) VALUES (1, ?)", JSON.stringify(bootstrap));
      for (const row of b.journal) sql.exec("INSERT INTO journal(sequence, record) VALUES (?, ?)", row.sequence, row.record);
      restoreEscrow(this.ctx.storage, escrow);
    });
    this.escrowService = undefined;
    try { this.#initialize(); }
    catch { this.ctx.abort("Restore validation failed"); throw new Error("RESTORE_VALIDATION_FAILED"); }
    const rows = sql.exec<{ sequence: number; record: string }>("SELECT sequence, record FROM journal ORDER BY sequence ASC").toArray()
      .map((r) => ({ sequence: Number(r.sequence), record: String(r.record) }));
    return { sequence: this.engine.snapshot().sequence, stateHash: this.engine.stateHash(), journalHead: journalHeadOf(rows), principals: this.principals,
      ...(escrow ? { escrowSourceHead: digest(escrow) } : {}) };
  }
  private escrowPolicy(): Policy {
    need(String(this.env.POA_ESCROW_ENABLED) === "true", "ESCROW_DISABLED");
    return { wallet: this.env.POA_ESCROW_ADDRESS ?? "", treasury: this.engine.config.treasury,
      perTx: this.env.POA_ESCROW_PER_TX ?? PILOT_PER_TX, daily: this.env.POA_ESCROW_DAILY ?? PILOT_DAILY,
      feeBps: this.engine.config.feeBps, maxAgeMs: 90000 };
  }
  /** Isolated cache of cryptographically verified checkpoint-covered tx heights (never journal/backup state). */
  private coveredTxCache(): CoveredTxCache {
    const sql = this.ctx.storage.sql;
    const ensure = () => {
      sql.exec("CREATE TABLE IF NOT EXISTS escrow_covered_tx_cache (wallet TEXT NOT NULL, txid TEXT NOT NULL, height INTEGER NOT NULL, PRIMARY KEY (wallet, txid))");
    };
    return {
      get: (wallet, ids) => {
        const out = new Map<string, number>();
        if (!ids.length) return out;
        ensure();
        const rows = sql.exec<{ txid: string; height: number }>("SELECT txid, height FROM escrow_covered_tx_cache WHERE wallet = ?", wallet).toArray();
        const wanted = new Set(ids);
        for (const r of rows) {
          if (wanted.has(r.txid) && Number.isSafeInteger(Number(r.height)) && Number(r.height) >= 0) {
            out.set(r.txid, Number(r.height));
          }
        }
        return out;
      },
      set: (wallet, entries) => {
        if (!entries.length) return;
        ensure();
        for (const [id, height] of entries) {
          if (/^[0-9a-f]{64}$/.test(id) && Number.isSafeInteger(height) && height >= 0) {
            sql.exec("INSERT INTO escrow_covered_tx_cache(wallet, txid, height) VALUES (?, ?, ?) ON CONFLICT(wallet, txid) DO UPDATE SET height = MIN(height, excluded.height)", wallet, id, height);
          }
        }
      },
      clear: () => {
        sql.exec("DROP TABLE IF EXISTS escrow_covered_tx_cache");
      },
    };
  }
  /** Non-journal SQLite watermark tracking checkpoint-aligned unexplained surplus so dust never consumes journal capacity while unexpected surplus drops still halt immediately. */
  private surplusStore(): SurplusStore {
    const sql = this.ctx.storage.sql;
    const ensure = () => {
      sql.exec("CREATE TABLE IF NOT EXISTS escrow_surplus_watermark (wallet TEXT PRIMARY KEY, value TEXT NOT NULL)");
    };
    return {
      read: (wallet) => {
        ensure();
        const row = sql.exec<{ value: string }>("SELECT value FROM escrow_surplus_watermark WHERE wallet = ?", wallet).toArray()[0];
        if (!row) return null;
        try {
          const parsed = JSON.parse(row.value) as SurplusWatermark;
          if (Number.isSafeInteger(parsed?.height) && typeof parsed?.root === "string" && /^(0|[1-9][0-9]*)$/.test(String(parsed?.unexplainedMicros ?? ""))) return parsed;
        } catch {}
        return null;
      },
      write: (wallet, mark) => {
        ensure();
        sql.exec("INSERT OR REPLACE INTO escrow_surplus_watermark(wallet, value) VALUES (?, ?)", wallet, JSON.stringify(mark));
      },
      clear: (wallet) => {
        ensure();
        sql.exec("DELETE FROM escrow_surplus_watermark WHERE wallet = ?", wallet);
      },
    };
  }
  private escrow(): Escrow {
    if (this.escrowService) return this.escrowService;
    const policy = this.escrowPolicy();
    const enabled = () => String(this.env.POA_ESCROW_ENABLED) === "true";
    const signing = () => enabled() && String(this.env.POA_ESCROW_NETWORK_WRITES) === "approved-v1";
    const e = this.engine;
    const savedRow = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM bootstrap WHERE id=1").toArray()[0];
    const treasuryKey = savedRow ? createPrivateKey((JSON.parse(savedRow.value) as Bootstrap).keys.treasury!) : undefined;
    const titles = registryTitles(e, treasuryKey);
    this.escrowService = new Escrow(new SQLiteEscrowJournal(this.ctx.storage, policy), new PoaHttpNetwork(signing, fetch, { engine: this.env.POA_ESCROW_ENGINE_SHA256 ?? MAINNET_ENGINE_SHA256, params: this.env.POA_ESCROW_PARAMS_SHA256 ?? MAINNET_PARAMS_SHA256 }, Date.now, this.env.POA_API_TOKEN, this.coveredTxCache()),
      new WorkerSecretSigner(policy.wallet, () => this.env.POA_ESCROW_KEY, signing), titles, policy, () => Date.now(), enabled,
      undefined, () => newNameCheckout(this.env).status === "on", () => subnameSales(this.env).status === "on", this.surplusStore());
    return this.escrowService;
  }
  async escrowRead(path:string,query:Record<string,string>):Promise<unknown>{
    need(String(this.env.POA_ESCROW_ENABLED)==="true","ESCROW_DISABLED");
    const escrow=this.escrow();
    if(path==="capabilities"){
      const freshness=await escrow.readiness(),s=escrow.state();const configured=String(this.env.POA_ESCROW_NETWORK_WRITES)==="approved-v1"&&!!this.env.POA_ESCROW_KEY&&(this.env.ESCROW_ADMIN_TOKEN?.length??0)>=32;
      return {enabled:true,paused:s.paused,held:s.paused||!!s.halt||freshness.held||!configured,
        holdReason:s.halt??(s.paused?"POA payments paused":!configured?"POA payments held for operator setup":freshness.reason),
        instantSettlement:escrow.instantSettlement(),
        address:escrow.policy.wallet,limits:{perTransaction:escrow.policy.perTx,daily:escrow.policy.daily},newNameCheckout:newNameCheckout(this.env),subnameSales:subnameSales(this.env),freshness,serverTime:Date.now(),registryId:this.engine.registryId};
    }
    if(path==="intent")return escrow.depositView(query.id!,query.txid);
    if(path==="market"||path==="domain"){
      const es=escrow.state();
      const base={items:marketView(es,path==="domain"?query.name:undefined,escrow.instantSettlement()),serverTime:Date.now()};
      if(path==="market"){
        const snap=this.engine.snapshot();
        return {...base,telemetry:{waitTime:waitTimeTelemetry(es,{treasury:this.engine.config.treasury,receipts:snap.receipts})}};
      }
      return base;
    }
    if(path==="subnames")return {items:subnameView(escrow.state(),query.parent),serverTime:Date.now()};
    need(false,"ESCROW_ROUTE");
  }
  async escrowCommand(packet:string,endpoint:string):Promise<unknown>{
    need(String(this.env.POA_ESCROW_ENABLED)==="true","ESCROW_DISABLED");
    try{
      const result=await publicCommand(()=>this.escrow(),packet,this.engine.registryId,endpoint,Date.now(),String(this.env.POA_ESCROW_NETWORK_WRITES)==="approved-v1"&&!!this.env.POA_ESCROW_KEY&&(this.env.ESCROW_ADMIN_TOKEN?.length??0)>=32);
      if(result.action!=="view"&&String(this.env.POA_ESCROW_NETWORK_WRITES)==="approved-v1"){
        if(this.escrow().hasActiveWork(this.engine.config.treasury))await this.ctx.storage.setAlarm(Date.now()+1000);
        else{
          const existingAlarm=await this.ctx.storage.getAlarm();
          if(existingAlarm===null||existingAlarm>Date.now()+60000)await this.ctx.storage.setAlarm(Date.now()+60000);
        }
      }
      return result;
    }catch(e){if(e instanceof Fault||e instanceof Error&&/^ESCROW_[A-Z_]+$/.test(e.message))throw e;
      this.ctx.abort("Escrow public command storage failure");throw new Error("ESCROW_UNAVAILABLE");}
  }
  private escrowTitleLocked(packet?: unknown): boolean {
    const sql = this.ctx.storage.sql;
    if (!sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='escrow_journal'").toArray().length) return false;
    const row = sql.exec<{record:string}>("SELECT record FROM escrow_journal ORDER BY sequence DESC LIMIT 1").toArray()[0];
    if (!row) return false;
    const state = JSON.parse(row.record).state as import("./escrow.js").State;
    if (packet === undefined) return Object.values(state.auctions).some(a => a.status === "OPEN" || a.status === "SETTLING");
    return escrowPacketBlocked(state, this.engine, packet);
  }
  private async autoSettleTreasuryAuctions(): Promise<void> {
    if (String(this.env.POA_ESCROW_ENABLED) !== "true" || String(this.env.POA_ESCROW_NETWORK_WRITES) !== "approved-v1") return;
    const escrow = this.escrow(), es = escrow.state();
    if (es.paused || es.halt) return;
    const savedRow = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM bootstrap WHERE id=1").toArray()[0];
    if (!savedRow) return;
    const bootstrap = JSON.parse(savedRow.value) as Bootstrap;
    const nowMs = Date.now();
    const planned = buildTreasuryAutoHandover({
      engine: this.engine,
      treasuryKey: createPrivateKey(bootstrap.keys.treasury!),
      auctions: es.auctions,
      settlements: es.settlements,
      nowMs,
      chainId: CHAIN,
    });
    if (!planned) return;
    const nowSec = Math.max(Math.floor(nowMs / 1000), this.engine.snapshot().time);
    await escrow.command(verifyCommand(planned.packet, this.engine.registryId, nowSec));
  }
  async alarm(): Promise<void> {
    if (String(this.env.POA_ESCROW_ENABLED) !== "true" || String(this.env.POA_ESCROW_NETWORK_WRITES) !== "approved-v1") return;
    const runStep = async (step: string, fn: () => Promise<unknown>) => {
      try { await fn(); }
      catch (error) {
        if (error instanceof Error && /^ESCROW_[A-Z_]+$/.test(error.message)) {
          console.error(JSON.stringify({ event: "escrow-alarm-held", step, code: error.message }));
          return;
        }
        this.ctx.abort("Escrow recovery failure; restart and reconcile");
        throw error;
      }
    };
    await runStep("tick", () => this.escrow().tick());
    await runStep("auto-settle-fallback", () => this.autoSettleTreasuryAuctions());
    // Drain active payouts/settlements every 15s; wake promptly if a funded auction closes sooner; else 60s.
    const esc = this.escrow();
    let delayMs = esc.hasActiveWork(this.engine.config.treasury) ? 15000 : 60000;
    if (delayMs > 15000) {
      const nowMs = Date.now(), s = esc.state();
      if (!s.paused && !s.halt) {
        for (const a of Object.values(s.auctions)) {
          if (a.status === "OPEN" && a.high !== null && a.closes > nowMs) {
            delayMs = Math.min(delayMs, Math.max(1000, a.closes - nowMs + 500));
          }
        }
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + delayMs);
  }
  /** Authenticated Worker RPC only. There is no browser signing, key-read, or generic send route. */
  async escrowAdmin(packetText: string): Promise<RegistryReply> {
    try {
      need(String(this.env.POA_ESCROW_ENABLED) === "true", "ESCROW_DISABLED");
      const value = parseJSON(packetText), v = exact(value, ["action"], ["packet", "paused", "review", "txid"]), escrow = this.escrow();
      if (String(this.env.POA_ESCROW_NETWORK_WRITES) === "approved-v1") await this.ctx.storage.setAlarm(Date.now() + 60000);
      switch (v.action) {
        case "status": exact(value, ["action"]); return { status: 200, jsonText: JSON.stringify(escrow.state()) };
        case "uncredited": exact(value, ["action"]); return { status: 200, jsonText: JSON.stringify(await escrow.uncreditedIncoming()) };
        case "pause": exact(value, ["action", "paused"]); await escrow.pause(v.paused); break;
        case "reconcile": exact(value, ["action"]); await escrow.reconcile(); break;
        case "tick": exact(value, ["action"]); await escrow.tick(); break;
        case "rebroadcast": exact(value, ["action"]); await escrow.rebroadcast(); break;
        case "credit-reviewed": exact(value, ["action", "review"]); await escrow.creditReviewed(reviewedCredit(v.review)); break;
        case "refund-uncredited": exact(value, ["action", "txid"]); await escrow.refundUncredited(v.txid); if (String(this.env.POA_ESCROW_NETWORK_WRITES) === "approved-v1" && escrow.hasActiveWork(this.engine.config.treasury)) await this.ctx.storage.setAlarm(Date.now() + 1000); break;
        case "command": exact(value, ["action", "packet"]); await escrow.command(verifyCommand(v.packet, this.engine.registryId, Math.floor(Date.now()/1000))); break;
        default: need(false, "ESCROW_ACTION");
      }
      return { status: 200, jsonText: JSON.stringify(escrow.state()) };
    } catch (error) {
      if ((error instanceof Fault && error.code !== "DURABILITY_UNKNOWN_RESTART_AND_QUERY") || (error instanceof Error && /^ESCROW_[A-Z_]+$/.test(error.message)))
        return { status: 409, jsonText: JSON.stringify({ code: error.message, accepted: "unknown", recovery: "query escrow status" }) };
      // Any unclassified persistence error discards engine caches and stops the sender.
      this.ctx.abort("Escrow storage failure; restart and reconcile"); throw new Error("ESCROW_UNAVAILABLE");
    }
  }
  // RPC only; the public Worker bounds/validates HTTP before invoking this method.
  // No await between reading registry state and synchronously appending a commit.
  handle(call: RegistryCall): RegistryReply {
    const e = this.engine;
    try {
      return publicRegistryRoute(e, call, {
        health: { livePoA: false, principals: this.principals },
        capabilities: { publicExplorerUrl: this.env.PUBLIC_EXPLORER_URL, escrow: {enabled:String(this.env.POA_ESCROW_ENABLED)==="true",capabilities:"/v1/escrow/capabilities"} },
        // Scope title/nonce reservation to domains currently in escrow (and settling seller nonces).
        beforeSubmit: (packet) => need(!this.escrowTitleLocked(packet), "ESCROW_TITLE_RESERVED"),
      });
    } catch (error) {
      if (error instanceof Fault) {
        if (error.code === "DURABILITY_UNKNOWN_RESTART_AND_QUERY") {
          this.ctx.abort("Registry storage failure; restart and query receipt");
          throw new Error("DURABILITY_UNKNOWN_RESTART_AND_QUERY");
        }
        return { status: 400, jsonText: JSON.stringify({ code: error.code, accepted: false }) };
      }
      // Unknown internal/storage failure must discard in-memory state. No details/keys are logged.
      this.ctx.abort("Registry internal failure; restart and query receipt");
      throw new Error("REGISTRY_UNAVAILABLE");
    }
  }
}
