import { DurableObject } from "cloudflare:workers";
import { createPrivateKey, generateKeyPairSync, KeyObject } from "node:crypto";
import { nativePrincipal } from "../src/auth.js";
import { mainnetConfig, Config } from "../src/config.js";
import { Engine } from "../src/engine.js";
import { Fault, exact, need, parseJSON } from "../src/core.js";
import { capabilities } from "../src/interface.js";
import { normalizeName } from "../src/names.js";
import { BootableSystemClock, seedRegistry } from "../src/seed.js";
import { SQLiteJournal } from "./sqlite-journal.js";
import { BackupKind, JournalRow, buildBackup, encryptSecrets, journalHeadOf, secretAad, verifyBackup } from "./backup-codec.js";

export interface BackupExport { bodyText: string; sha256: string; size: number; sequence: number; stateHash: string; createdAt: string; }
export interface RestoreResult { sequence: number; stateHash: string; journalHead: string | null; principals: Record<string, string>; }

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
export interface RegistryCall { method: string; path: string; query: Record<string, string>; packet?: string; }
export interface RegistryReply { status: number; jsonText: string; }

export class PoaRegistry extends DurableObject<Env> {
  private engine!: CloudflareEngine;
  private principals!: Record<string, string>;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      try { this.#initialize(); }
      catch {
        // Private bootstrap/parser exceptions must never expose storage/key contents.
        console.error(JSON.stringify({ event: "registry-initialization-failed", code: "PRIVATE_STORAGE_INVALID" }));
        throw new Error("REGISTRY_INITIALIZATION_FAILED");
      }
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
    const secrets = await encryptSecrets({ keys: saved.keys }, this.env.BACKUP_PUBLIC_KEY_SPKI ?? "", secretAad(saved.policyHash, head));
    const { bodyText, sha256, size } = await buildBackup({ createdAt, kind, head, journal, secrets,
      registry: { singleton: SINGLETON, bootstrapFormat: saved.format, config: saved.config, policyHash: saved.policyHash, principals: saved.principals } });
    return { bodyText, sha256, size, sequence, stateHash, createdAt };
  }
  // Restore into THIS object. Only allowed in local dev (BACKUP_RESTORE_ENABLED=local-only)
  // and never into the production singleton. Full signature/hash-chain replay validates it.
  async restoreBackup(backupText: string, keys: Record<string, string>): Promise<RestoreResult> {
    need(this.env.BACKUP_RESTORE_ENABLED === "local-only", "RESTORE_DISABLED");
    need(!this.ctx.id.equals(this.env.REGISTRY.idFromName(SINGLETON)), "RESTORE_TARGET_IS_LIVE");
    const b = await verifyBackup(JSON.parse(backupText));
    exact(keys, [...ROLES]);
    const bootstrap: Bootstrap = { format: "poa-do-sqlite-v1", config: b.registry.config as Config, policyHash: b.registry.policyHash, principals: b.registry.principals, keys };
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sql.exec("DELETE FROM journal"); sql.exec("DELETE FROM bootstrap");
      sql.exec("INSERT INTO bootstrap(id, value) VALUES (1, ?)", JSON.stringify(bootstrap));
      for (const row of b.journal) sql.exec("INSERT INTO journal(sequence, record) VALUES (?, ?)", row.sequence, row.record);
    });
    try { this.#initialize(); }
    catch { this.ctx.abort("Restore validation failed"); throw new Error("RESTORE_VALIDATION_FAILED"); }
    const rows = sql.exec<{ sequence: number; record: string }>("SELECT sequence, record FROM journal ORDER BY sequence ASC").toArray()
      .map((r) => ({ sequence: Number(r.sequence), record: String(r.record) }));
    return { sequence: this.engine.snapshot().sequence, stateHash: this.engine.stateHash(), journalHead: journalHeadOf(rows), principals: this.principals };
  }
  // RPC only; the public Worker bounds/validates HTTP before invoking this method.
  // No await between reading registry state and synchronously appending a commit.
  handle(call: RegistryCall): RegistryReply {
    const e = this.engine;
    const ok = (body: unknown): RegistryReply => ({ status: 200, jsonText: JSON.stringify(body) });
    try {
      if (call.method === "GET") {
        if (call.path === "/healthz") return ok({ status: "ok", processAlive: true, chainId: e.config.chainId,
          revision: e.config.revision, sequence: e.snapshot().sequence, durability: DURABILITY,
          livePoA: false, principals: this.principals });
        if (call.path === "/v1/capabilities") return ok({ ...capabilities(e), publicExplorerUrl: this.env.PUBLIC_EXPLORER_URL });
        if (call.path === "/v1/state") return ok({ state: e.snapshot(), stateHash: e.stateHash(),
          observedServerTime: e.observedTime(), durability: DURABILITY, finality: "local-committed-only" });
        if (call.path === "/v1/resolve") return ok(e.resolve(normalizeName(call.query.name, e.normalizationMode).canonical));
        if (call.path === "/v1/nonce") return ok({ nonce: e.nextNonce(call.query.signer ?? "") });
        if (call.path.startsWith("/v1/receipts/")) {
          const id = call.path.slice("/v1/receipts/".length);
          need(/^[0-9a-f]{64}$/.test(id), "INTENT_ID");
          const receipt = e.receipt(id);
          return { status: receipt ? 200 : 404, jsonText: JSON.stringify(receipt ?? { status: "unknown", code: "UNKNOWN_OUTCOME" }) };
        }
        return { status: 404, jsonText: JSON.stringify({ code: "NOT_FOUND" }) };
      }
      if (call.method === "POST" && call.path === "/v1/intents") return ok({ ...e.submit(parseJSON(call.packet ?? "")), accepted: true,
        durability: DURABILITY, finality: "local-committed-not-chain-finality" });
      return { status: 405, jsonText: JSON.stringify({ code: "METHOD_NOT_ALLOWED" }) };
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
