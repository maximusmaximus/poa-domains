/** Narrow POA transfer codec. No wallet creation, file I/O, or generic signing endpoint. */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { base58, unbase58 } from "../src/native-crypto.js";
import { canonical, exact, integer, need, text } from "../src/core.js";
export const CHAIN = "poa-mainnet-1";
export function address(value: unknown): string {
  const s = text(value, 64); need(s.startsWith("poa1"), "ESCROW_ADDRESS");
  unbase58(s.slice(4), 32); return s;
}
export function micros(value: unknown): bigint {
  need(typeof value === "string" && /^(0|[1-9][0-9]{0,12})\.[0-9]{6}$/.test(value), "ESCROW_AMOUNT");
  return BigInt(value.replace(".", ""));
}
export function decimal(n: bigint): string {
  need(n >= 0n && n <= 9999999999999999999n, "ESCROW_AMOUNT");
  return `${n / 1000000n}.${String(n % 1000000n).padStart(6, "0")}`;
}
export interface Transfer {
  type: "transfer"; cid: string; from: string; to: string; amount: string; memo: string;
  nonce: number; parents: string[]; ts: number; sig?: string;
}
export const digest = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
export function txid(body: Transfer): string { const { sig, ...rest } = body; return digest(rest); }
export function verifyTransfer(body: Transfer, chain = CHAIN): void {
  exact(body, ["type", "cid", "from", "to", "amount", "memo", "nonce", "parents", "ts", "sig"]);
  need(body.type === "transfer" && body.cid === chain, "ESCROW_CHAIN");
  address(body.from); address(body.to); need(micros(body.amount) > 0n, "ESCROW_AMOUNT");
  text(body.memo, 160); integer(body.nonce, 1); integer(body.ts);
  need(Array.isArray(body.parents) && body.parents.length <= 2 && new Set(body.parents).size === body.parents.length &&
    body.parents.every(p => /^[0-9a-f]{64}$/.test(p)), "ESCROW_PARENTS");
  const key = createPublicKey({ format: "der", type: "spki", key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"), unbase58(body.from.slice(4), 32)]) });
  const { sig, ...unsigned } = body;
  need(verify(null, Buffer.from(canonical(unsigned)), key, unbase58(sig!, 64)), "ESCROW_SIGNATURE");
}
export interface Signer { address: string; transfer(body: Transfer): Transfer; }
export class WorkerSecretSigner implements Signer {
  constructor(readonly address: string, private readonly secret: () => string | undefined,
    private readonly allowed: () => boolean) {}
  transfer(body: Transfer): Transfer {
    // Both gates precede even accessing the secret. Only fixed-purpose, validated transfers.
    need(this.allowed(), "ESCROW_SIGNING_DISABLED");
    need(body.from === this.address && !body.sig && body.type === "transfer", "ESCROW_SIGNER");
    const seed = unbase58(this.secret() ?? "", 32);
    try {
      const key = createPrivateKey({ format: "der", type: "pkcs8", key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"), seed]) });
      const pub = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
      need("poa1" + base58(pub) === this.address, "ESCROW_KEY_IDENTITY");
      const signed = { ...body, sig: base58(sign(null, Buffer.from(canonical(body)), key)) };
      verifyTransfer(signed, body.cid); return signed;
    } catch { throw new Error("ESCROW_KEY_OR_TRANSFER_INVALID"); }
    finally { seed.fill(0); }
  }
}
export interface Command {
  domain: "poa-domains.escrow.v1"; chainId: string; registryId: string;
  actor: string; key: string; expires: number; action: string; params: Record<string, unknown>;
}
export function verifyCommand(value: unknown, registryId: string, now: number): Command {
  const v = exact(value, ["command", "signature"]);
  const c = exact(v.command, ["domain", "chainId", "registryId", "actor", "key", "expires", "action", "params"]) as Command;
  need(c.domain === "poa-domains.escrow.v1" && c.chainId === CHAIN && c.registryId === registryId, "ESCROW_DOMAIN");
  address(c.actor); need(/^[a-zA-Z0-9_-]{1,64}$/.test(text(c.key,64)), "ESCROW_IDEMPOTENCY_KEY");
  integer(c.expires, now + 1); text(c.action, 32);
  const pub = createPublicKey({ format: "der", type: "spki", key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"), unbase58(c.actor.slice(4),32)]) });
  need(verify(null, Buffer.from(canonical(c)), pub, unbase58(v.signature,64)), "ESCROW_SIGNATURE");
  return c;
}
