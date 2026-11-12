import { publicRegistryRoute } from "./public-registry-view.js";
import { registryRoute, type RegistryCall, type RegistryReply } from "../src/registry-routes.js";
import { marketView, publicCommand } from "./escrow-public.js";
import { registryTitles } from "./escrow-titles.js";
import { DurableObject } from "cloudflare:workers";
import { createPrivateKey, generateKeyPairSync, KeyObject } from "node:crypto";
import { Escrow, Policy, SQLiteEscrowJournal, EscrowArchive, exportEscrow, restoreEscrow, replay as replayEscrow } from "./escrow.js";
import { WorkerSecretSigner, verifyCommand, digest } from "./escrow-codec.js";
import { PoaHttpNetwork, MAINNET_ENGINE_SHA256, MAINNET_PARAMS_SHA256, PILOT_PER_TX, PILOT_DAILY } from "./escrow-network.js";
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

/** POA new-name checkout (primary issuance via escrow). OFF until the issuance path below ships AND Max approves turning it on. */
export const NEW_NAME_PRICE_RULE="POA price = registry reserve schedule for the name's tier; 1 registry unit = 1 POA (6 decimals)";
export function newNameCheckout(env:{POA_ESCROW_NEW_NAMES?:string}):{status:"on"|"off";priceRule:string}{
  return {status:String(env.POA_ESCROW_NEW_NAMES)==="approved-v1"?"on":"off",priceRule:NEW_NAME_PRICE_RULE};
}

export class PoaRegistry extends DurableObject<Env> {
  private engine!: CloudflareEngine;
  private escrowService?: Escrow;
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
  private escrow(): Escrow {
    if (this.escrowService) return this.escrowService;
    const policy = this.escrowPolicy();
    const enabled = () => String(this.env.POA_ESCROW_ENABLED) === "true";
    const signing = () => enabled() && String(this.env.POA_ESCROW_NETWORK_WRITES) === "approved-v1";
    const e = this.engine;
    const titles = registryTitles(e);
    this.escrowService = new Escrow(new SQLiteEscrowJournal(this.ctx.storage, policy), new PoaHttpNetwork(signing, fetch, { engine: this.env.POA_ESCROW_ENGINE_SHA256 ?? MAINNET_ENGINE_SHA256, params: this.env.POA_ESCROW_PARAMS_SHA256 ?? MAINNET_PARAMS_SHA256 }, Date.now, this.env.POA_API_TOKEN),
      new WorkerSecretSigner(policy.wallet, () => this.env.POA_ESCROW_KEY, signing), titles, policy, () => Date.now(), enabled,
      undefined, () => newNameCheckout(this.env).status === "on");
    return this.escrowService;
  }
  async escrowRead(path:string,query:Record<string,string>):Promise<unknown>{
    need(String(this.env.POA_ESCROW_ENABLED)==="true","ESCROW_DISABLED");
    const escrow=this.escrow();
    if(path==="capabilities"){
      const freshness=await escrow.readiness(),s=escrow.state();const configured=String(this.env.POA_ESCROW_NETWORK_WRITES)==="approved-v1"&&!!this.env.POA_ESCROW_KEY&&(this.env.ESCROW_ADMIN_TOKEN?.length??0)>=32;
      return {enabled:true,paused:s.paused,held:s.paused||!!s.halt||freshness.held||!configured,
        holdReason:s.halt??(s.paused?"POA payments paused":!configured?"POA payments held for operator setup":freshness.reason),
        address:escrow.policy.wallet,limits:{perTransaction:escrow.policy.perTx,daily:escrow.policy.daily},newNameCheckout:newNameCheckout(this.env),freshness,serverTime:Date.now(),registryId:this.engine.registryId};
    }
    if(path==="intent")return escrow.depositView(query.id!,query.txid);
    if(path==="market"||path==="domain")return {items:marketView(escrow.state(),path==="domain"?query.name:undefined),serverTime:Date.now()};
    need(false,"ESCROW_ROUTE");
  }
  async escrowCommand(packet:string,endpoint:string):Promise<unknown>{
    need(String(this.env.POA_ESCROW_ENABLED)==="true","ESCROW_DISABLED");
    try{
      const result=await publicCommand(()=>this.escrow(),packet,this.engine.registryId,endpoint,Date.now(),String(this.env.POA_ESCROW_NETWORK_WRITES)==="approved-v1"&&!!this.env.POA_ESCROW_KEY&&(this.env.ESCROW_ADMIN_TOKEN?.length??0)>=32);
      if(result.action!=="view"&&String(this.env.POA_ESCROW_NETWORK_WRITES)==="approved-v1")await this.ctx.storage.setAlarm(Date.now()+1000);
      return result;
    }catch(e){if(e instanceof Fault||e instanceof Error&&/^ESCROW_[A-Z_]+$/.test(e.message))throw e;
      this.ctx.abort("Escrow public command storage failure");throw new Error("ESCROW_UNAVAILABLE");}
  }
  private escrowTitleLocked(): boolean {
    const sql = this.ctx.storage.sql;
    if (!sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='escrow_journal'").toArray().length) return false;
    const row = sql.exec<{record:string}>("SELECT record FROM escrow_journal ORDER BY sequence DESC LIMIT 1").toArray()[0];
    if (!row) return false;
    const state = JSON.parse(row.record).state as import("./escrow.js").State;
    return Object.values(state.auctions).some(a => a.status === "OPEN" || a.status === "SETTLING");
  }
  async alarm(): Promise<void> {
    if (String(this.env.POA_ESCROW_ENABLED) !== "true" || String(this.env.POA_ESCROW_NETWORK_WRITES) !== "approved-v1") return;
    try { await this.escrow().tick(); }
    catch (error) {
      if (!(error instanceof Error && /^ESCROW_[A-Z_]+$/.test(error.message))) this.ctx.abort("Escrow recovery failure; restart and reconcile");
    }
    // Continue lookup/recovery without replaying a command or regenerating a transaction.
    await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  /** Authenticated Worker RPC only. There is no browser signing, key-read, or generic send route. */
  async escrowAdmin(packetText: string): Promise<RegistryReply> {
    try {
      need(String(this.env.POA_ESCROW_ENABLED) === "true", "ESCROW_DISABLED");
      const value = parseJSON(packetText), v = exact(value, ["action"], ["packet", "paused"]), escrow = this.escrow();
      if (String(this.env.POA_ESCROW_NETWORK_WRITES) === "approved-v1") await this.ctx.storage.setAlarm(Date.now() + 60000);
      switch (v.action) {
        case "status": exact(value, ["action"]); return { status: 200, jsonText: JSON.stringify(escrow.state()) };
        case "pause": exact(value, ["action", "paused"]); await escrow.pause(v.paused); break;
        case "reconcile": exact(value, ["action"]); await escrow.reconcile(); break;
        case "tick": exact(value, ["action"]); await escrow.tick(); break;
        case "rebroadcast": exact(value, ["action"]); await escrow.rebroadcast(); break;
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
        // Keep the title/nonce reservation hook in its original durable-object boundary.
        beforeSubmit: () => need(!this.escrowTitleLocked(), "ESCROW_TITLE_RESERVED"),
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
