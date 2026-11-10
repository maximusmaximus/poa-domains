import test from "node:test";
import {flipCiphertextBit} from "./fixtures/backup-tamper.mjs";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";

const c = await import("../cloudflare/backup-codec.ts");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 4096 });
const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const pkcs8 = new Uint8Array(privateKey.export({ type: "pkcs8", format: "der" }));
const tag = ["PRIVATE", "KEY"].join(" "); // assembled at runtime: not a real key
const pem = `-----BEGIN ${tag}-----\nFAKEFAKE\n-----END ${tag}-----\n`;
const rec = (seq, prev) => JSON.stringify({ previous: prev, commit: { sequence: seq }, checksum: `c${seq}` });
const journal = [1, 2, 3].map((n) => ({ sequence: n, record: rec(n, n === 1 ? "g" : `c${n - 1}`) }));
const policyHash = "p".repeat(64);
const head = { sequence: 3, stateHash: "s".repeat(64), journalHead: "c3" };

async function sample() {
  const keys = { issuer: pem, treasury: pem, alice: pem, bob: pem, carol: pem };
  const secrets = await c.encryptSecrets({ keys }, spki, c.secretAad(policyHash, head));
  return c.buildBackup({ createdAt: "2026-11-09T08:17:00.000Z", kind: "hourly", head, journal, secrets,
    registry: { singleton: "poa-mainnet-registry-v1", bootstrapFormat: "poa-do-sqlite-v1", config: { chainId: "poa-mainnet-1" }, policyHash,
      principals: { issuer: "poa1i", treasury: "poa1t", alice: "a", bob: "b", carol: "c" } } });
}

test("backup round-trips; body sha256 matches; secrets are never plaintext", async () => {
  const { bodyText, sha256, size, backup } = await sample();
  assert.equal(sha256, createHash("sha256").update(bodyText).digest("hex"));
  assert.equal(size, Buffer.byteLength(bodyText));
  assert.ok(!bodyText.includes("PRIVATE KEY") && !bodyText.includes("FAKEFAKE"));
  const v = await c.verifyBackup(JSON.parse(bodyText));
  assert.equal(v.head.sequence, 3);
  const out = await c.decryptSecrets(v.secrets, pkcs8, c.secretAad(policyHash, v.head));
  assert.equal(out.keys.issuer, pem);
  assert.equal(backup.secrets.publicKeySha256, createHash("sha256").update(Buffer.from(spki, "base64")).digest("hex"));
});

test("tampering with records, head or secrets is rejected", async () => {
  const { bodyText } = await sample();
  const a = JSON.parse(bodyText); a.journal[1].record = a.journal[1].record.replace("c2", "cX");
  await assert.rejects(c.verifyBackup(a), /BACKUP_CONTENT_CHECKSUM/);
  const b = JSON.parse(bodyText); b.head.sequence = 2;
  await assert.rejects(c.verifyBackup(b), /BACKUP_CONTENT_CHECKSUM/);
  const d = JSON.parse(bodyText);
  await assert.rejects(c.decryptSecrets(d.secrets, pkcs8, c.secretAad(policyHash, { ...head, sequence: 4 })), /AAD/);
  const e = JSON.parse(bodyText); e.secrets.ciphertext = flipCiphertextBit(e.secrets.ciphertext);
  assert.notEqual(e.secrets.ciphertext, d.secrets.ciphertext, "tampering must actually change the authenticated bytes");
  await assert.rejects(c.decryptSecrets(e.secrets, pkcs8, e.secrets.aad));
  const wrong = new Uint8Array(generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "der" }));
  await assert.rejects(c.decryptSecrets(d.secrets, wrong, d.secrets.aad));
});

test("journal gaps, wrong head and plaintext keys are rejected even with fresh checksums", async () => {
  const rebuild = async (mut) => { const { backup } = await sample(); const { integrity, journalSha256, format, ...rest } = backup; mut(rest); return JSON.parse((await c.buildBackup(rest)).bodyText); };
  await assert.rejects(c.verifyBackup(await rebuild((r) => { r.journal = [r.journal[0], r.journal[2]]; })), /GAP/);
  await assert.rejects(c.verifyBackup(await rebuild((r) => { r.head = { ...r.head, journalHead: "c2" }; })), /HEAD|SECRET/);
  await assert.rejects(c.verifyBackup(await rebuild((r) => { r.registry = { ...r.registry, config: { leaked: pem } }; })), /PLAINTEXT/);
});

test("missing public key never falls back to plaintext", async () => {
  await assert.rejects(c.encryptSecrets({ keys: {} }, "", "x"), /PUBLIC_KEY_MISSING/);
});

test("object keys are sortable, immutable and kind-scoped; cron mapping", () => {
  const k = c.backupObjectKey("daily", "2026-11-09T08:47:00.123Z", 15, "ab".repeat(32));
  assert.equal(k, "v1/daily/2026/11/09/2026-11-09T08-47-00-123Z-seq000000015-abababababababab.json");
  assert.throws(() => c.backupObjectKey("hourly", "bad", 1, "ab".repeat(32)));
  assert.equal(c.kindForCron(c.DAILY_CRON), "daily");
  assert.throws(() => c.kindForCron(c.HOURLY_CRON), /CRON_DISABLED/);
  assert.deepEqual(c.RETENTION_DAYS, { hourly: 2, daily: 14, manual: 90 });
});
