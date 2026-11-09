// Registry backup codec. Dependency-free WebCrypto so it runs in Workers and Node.
// Public registry records are stored in plaintext. Private role keys are only ever
// written as an RSA-OAEP-wrapped AES-256-GCM envelope; the decryption key is never
// stored in the bucket or in the Worker.

export const BACKUP_FORMAT = "poadomains-registry-backup/v1";
export const SECRET_SCHEME = "rsa-oaep-4096-sha256+aes-256-gcm/v1";
export const BACKUP_BUCKET = "poadomains-registry-backups";
export const HOURLY_CRON = "17 * * * *";
export const DAILY_CRON = "47 8 * * *"; // 00:47 America/Los_Angeles during PST
export type BackupKind = "hourly" | "daily" | "manual";
export const RETENTION_DAYS: Record<BackupKind, number> = { hourly: 2, daily: 30, manual: 90 };

export interface JournalRow { sequence: number; record: string; }
export interface BackupHead { sequence: number; stateHash: string; journalHead: string | null; }
export interface SecretEnvelope {
  scheme: string; publicKeySha256: string; wrappedKey: string; iv: string; ciphertext: string; aad: string;
}
export interface RegistryBackup {
  format: string;
  createdAt: string;
  kind: BackupKind;
  registry: { singleton: string; bootstrapFormat: string; config: unknown; policyHash: string; principals: Record<string, string>; };
  head: BackupHead;
  journalSha256: string;
  journal: JournalRow[];
  secrets: SecretEnvelope;
  integrity: { contentSha256: string };
}

const enc = new TextEncoder();
const subtle = (): SubtleCrypto => globalThis.crypto.subtle;
const toB64 = (b: ArrayBuffer | Uint8Array): string => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
type Bytes = Uint8Array<ArrayBuffer>;
const fromB64 = (s: string): Bytes => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Bytes;
const utf8 = (s: string): Bytes => enc.encode(s) as Bytes;
const fail = (code: string): never => { throw new Error(code); };

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = (typeof data === "string" ? utf8(data) : data) as Bytes;
  const d = new Uint8Array(await subtle().digest("SHA-256", bytes));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Deterministic JSON: sorted object keys, no whitespace. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

export function secretAad(policyHash: string, head: BackupHead): string {
  return `${BACKUP_FORMAT}|${policyHash}|${head.sequence}|${head.stateHash}|${head.journalHead ?? "genesis"}`;
}

export function journalHeadOf(rows: JournalRow[]): string | null {
  if (rows.length === 0) return null;
  const last = JSON.parse(rows[rows.length - 1]!.record) as { checksum?: unknown };
  return typeof last.checksum === "string" ? last.checksum : fail("BACKUP_JOURNAL_RECORD");
}

export async function encryptSecrets(secrets: unknown, spkiB64: string, aad: string): Promise<SecretEnvelope> {
  if (!spkiB64) fail("BACKUP_PUBLIC_KEY_MISSING");
  const spki = fromB64(spkiB64);
  const pub = await subtle().importKey("spki", spki, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["wrapKey"]);
  const dek = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: utf8(aad) }, dek, utf8(JSON.stringify(secrets)));
  const wrapped = await subtle().wrapKey("raw", dek, pub, { name: "RSA-OAEP" });
  return { scheme: SECRET_SCHEME, publicKeySha256: await sha256Hex(spki), wrappedKey: toB64(wrapped), iv: toB64(iv), ciphertext: toB64(ct), aad };
}

export async function decryptSecrets<T = unknown>(env: SecretEnvelope, pkcs8: Uint8Array, expectedAad: string): Promise<T> {
  if (env.scheme !== SECRET_SCHEME) fail("BACKUP_SECRET_SCHEME");
  if (env.aad !== expectedAad) fail("BACKUP_SECRET_AAD");
  const priv = await subtle().importKey("pkcs8", pkcs8 as Bytes, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["unwrapKey"]);
  const dek = await subtle().unwrapKey("raw", fromB64(env.wrappedKey), priv, { name: "RSA-OAEP" }, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(env.iv), additionalData: utf8(expectedAad) }, dek, fromB64(env.ciphertext));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(pt)) as T;
}

export async function buildBackup(input: Omit<RegistryBackup, "format" | "journalSha256" | "integrity">):
  Promise<{ backup: RegistryBackup; bodyText: string; sha256: string; size: number }> {
  const partial = { ...input, format: BACKUP_FORMAT, journalSha256: await sha256Hex(stableStringify(input.journal)) };
  const backup: RegistryBackup = { ...partial, integrity: { contentSha256: await sha256Hex(stableStringify(partial)) } };
  const bodyText = JSON.stringify(backup);
  const bytes = enc.encode(bodyText);
  return { backup, bodyText, sha256: await sha256Hex(bytes), size: bytes.byteLength };
}

/** Structural and checksum verification. Signature/hash-chain replay is done by the restore target. */
export async function verifyBackup(value: unknown): Promise<RegistryBackup> {
  const b = value as RegistryBackup;
  if (!b || typeof b !== "object" || b.format !== BACKUP_FORMAT) fail("BACKUP_FORMAT");
  const { integrity, ...content } = b;
  if (!integrity || integrity.contentSha256 !== await sha256Hex(stableStringify(content))) fail("BACKUP_CONTENT_CHECKSUM");
  if (b.journalSha256 !== await sha256Hex(stableStringify(b.journal))) fail("BACKUP_JOURNAL_CHECKSUM");
  if (!Array.isArray(b.journal)) fail("BACKUP_JOURNAL");
  b.journal.forEach((row, i) => { if (row.sequence !== i + 1 || typeof row.record !== "string") fail("BACKUP_JOURNAL_GAP"); });
  if (b.head.sequence !== b.journal.length) fail("BACKUP_HEAD_SEQUENCE");
  if (b.head.journalHead !== journalHeadOf(b.journal)) fail("BACKUP_HEAD_CHECKSUM");
  if (b.secrets?.scheme !== SECRET_SCHEME || b.secrets.aad !== secretAad(b.registry.policyHash, b.head)) fail("BACKUP_SECRET_ENVELOPE");
  if (/PRIVATE KEY/.test(JSON.stringify({ ...b, secrets: null }))) fail("BACKUP_PLAINTEXT_SECRET");
  return b;
}

/** Immutable, sortable object key: kind/date/time-sequence-checksum. */
export function backupObjectKey(kind: BackupKind, createdAt: string, sequence: number, sha256: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime()) || !/^[0-9a-f]{64}$/.test(sha256)) fail("BACKUP_KEY_INPUT");
  const iso = d.toISOString().replace(/[:.]/g, "-");
  const [y, m, day] = [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, "0"), String(d.getUTCDate()).padStart(2, "0")];
  return `v1/${kind}/${y}/${m}/${day}/${iso}-seq${String(sequence).padStart(9, "0")}-${sha256.slice(0, 16)}.json`;
}

export function kindForCron(cron: string): BackupKind { return cron === DAILY_CRON ? "daily" : "hourly"; }
