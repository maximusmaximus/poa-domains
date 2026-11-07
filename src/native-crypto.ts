import { createHash, createPublicKey, verify } from "node:crypto";
import { exact, integer, need, obj, text, MAX_AMOUNT } from "./core.js";
import { publicCanonical } from "./native-json.js";
// Independently implemented wire codec based on the official public client's
// canonical/signBody/txidOf/pubOfAddr interfaces. No upstream code is vendored.
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array): string {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0")), out = "";
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = "1" + out; }
  return out;
}
export function unbase58(value: unknown, length: number): Buffer {
  need(typeof value === "string" && value.length > 0 && value.length <= 128, "NATIVE_BASE58");
  let n = 0n;
  for (const c of value) { const digit = alphabet.indexOf(c); need(digit >= 0, "NATIVE_BASE58"); n = n * 58n + BigInt(digit); }
  const hex = n.toString(16), body = n === 0n ? Buffer.alloc(0) : Buffer.from(hex.length % 2 ? "0" + hex : hex, "hex");
  const zeros = value.length - value.replace(/^1+/, "").length, bytes = Buffer.concat([Buffer.alloc(zeros), body]);
  need(bytes.length === length && base58(bytes) === value, "NATIVE_BASE58_LENGTH");
  return bytes;
}
export function nativeAddress(raw: Uint8Array): string { need(raw.length === 32, "NATIVE_PUBLIC_KEY"); return "poa1" + base58(raw); }
function publicKey(address: unknown) {
  need(typeof address === "string" && address.startsWith("poa1"), "NATIVE_ADDRESS");
  return createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), unbase58(address.slice(4), 32)]), format: "der", type: "spki" });
}
function preimage(value: unknown, chainId: string) {
  const body = obj(value);
  publicCanonical(body);
  need(body.cid === text(chainId, 128) && chainId.length > 0, "NATIVE_CHAIN_MISMATCH");
  text(body.type, 64); need(body.type.length > 0, "NATIVE_TYPE"); publicKey(body.from);
  integer(body.nonce, 1); integer(body.ts);
  need(Array.isArray(body.parents) && body.parents.length <= 2 && body.parents.every((p: unknown) => typeof p === "string" && /^[a-f0-9]{64}$/.test(p)), "NATIVE_PARENTS");
  need(new Set(body.parents).size === body.parents.length, "NATIVE_PARENTS");
  const { sig: _sig, ...unsigned } = body;
  const bytes = Buffer.from(publicCanonical(unsigned), "utf8");
  need(bytes.length <= 32768, "BODY_TOO_LARGE");
  return { body, unsigned, bytes, txid: createHash("sha256").update(bytes).digest("hex") };
}
export function verifyNativeEnvelope(value: unknown, context: unknown) {
  const { chainId, txid } = exact(context, ["chainId", "txid"]);
  need(typeof txid === "string" && /^[a-f0-9]{64}$/.test(txid), "NATIVE_DIGEST");
  const message = preimage(value, chainId);
  need(message.txid === txid, "NATIVE_TXID_MISMATCH");
  need(verify(null, message.bytes, publicKey(message.body.from), unbase58(message.body.sig, 64)), "NATIVE_SIGNATURE");
  return { txid, chainId, signer: message.body.from as string, signatureValid: true, protocolValidityVerified: false, finalityVerified: false } as const;
}
export function nativeTransferMicros(value: unknown): bigint {
  need(typeof value === "string" && /^(0|[1-9][0-9]{0,38})(?:\.[0-9]{1,6})?$/.test(value), "NATIVE_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  need(units > 0n && units <= MAX_AMOUNT, "NATIVE_AMOUNT");
  return units;
}
export type NativeSigner = { address: string; sign: (preimage: Uint8Array) => Promise<Uint8Array> };
// Library-only caller-controlled signer. No key discovery/loading, nonce/time
// inference, protocol validity claim, PoW, broadcast or financial authority.
export async function signNativeEnvelope(unsigned: unknown, chainId: string, signer: NativeSigner) {
  need(!Object.hasOwn(obj(unsigned), "sig"), "NATIVE_UNSIGNED_REQUIRED");
  const input = exact(unsigned, ["type", "from", "to", "amount", "nonce", "ts", "parents", "cid"], ["memo"]);
  need(input.type === "transfer", "NATIVE_SIGNING_TYPE_UNSUPPORTED");
  publicKey(input.to); nativeTransferMicros(input.amount);
  if (input.memo !== undefined) text(input.memo, 2048);
  // Snapshot before await: a caller cannot mutate what we validate vs sign.
  const message = preimage(structuredClone(unsigned), chainId);
  need(message.body.from === signer.address, "NATIVE_SIGNER_MISMATCH");
  const signature = await signer.sign(Uint8Array.from(message.bytes));
  need(signature.length === 64, "NATIVE_SIGNATURE");
  const body: Record<string, unknown> = { ...message.unsigned, sig: base58(signature) };
  verifyNativeEnvelope(body, { chainId, txid: message.txid });
  return { body, txid: message.txid, submitted: false, protocolValidityVerified: false, finalityVerified: false };
}

// The upstream checkpoint-signature preimage contains type/root/height/verifier,
// but NO chain id. Do not manufacture network binding or anchored finality from it.
export function verifyNativeCheckpointSignatures(bundle: unknown, policy: unknown) {
  const cp = exact(bundle, ["state_root", "height", "sigs"]);
  const p = exact(policy, ["chainId", "expectedRoot", "expectedHeight", "trustedVerifiers", "threshold"]);
  text(p.chainId, 128); need(p.chainId.length > 0, "NATIVE_CHAIN_MISMATCH");
  need(typeof p.expectedRoot === "string" && /^[a-f0-9]{64}$/.test(p.expectedRoot), "NATIVE_DIGEST");
  integer(p.expectedHeight, 1);
  need(cp.state_root === p.expectedRoot && cp.height === p.expectedHeight, "NATIVE_CHECKPOINT_MISMATCH");
  need(Array.isArray(p.trustedVerifiers) && p.trustedVerifiers.length <= 256 && new Set(p.trustedVerifiers).size === p.trustedVerifiers.length, "NATIVE_TRUST_POLICY");
  p.trustedVerifiers.forEach(publicKey);
  integer(p.threshold, 1, p.trustedVerifiers.length);
  need(Array.isArray(cp.sigs) && cp.sigs.length <= 256, "NATIVE_CHECKPOINT_SIGNATURES");
  const seen = new Set<string>();
  for (const item of cp.sigs) {
    const s = exact(item, ["type", "root", "height", "verifier", "sig"]);
    need(s.type === "checkpoint-sig" && s.root === cp.state_root && s.height === cp.height, "NATIVE_CHECKPOINT_MISMATCH");
    need(p.trustedVerifiers.includes(s.verifier) && !seen.has(s.verifier), "NATIVE_TRUST_POLICY");
    const { sig, ...body } = s;
    need(verify(null, Buffer.from(publicCanonical(body)), publicKey(s.verifier), unbase58(sig, 64)), "NATIVE_SIGNATURE");
    seen.add(s.verifier);
  }
  return { root: cp.state_root as string, height: cp.height as number, validTrustedSignatures: seen.size, threshold: p.threshold as number, quorumSatisfied: seen.size >= p.threshold, networkBindingVerified: false, stateRootVerified: false, externalAnchorsVerified: false, finalityVerified: false } as const;
}
