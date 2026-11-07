import { createPublicKey, KeyObject, sign, verify } from "node:crypto";
import {
  canonical,
  exact,
  integer,
  need,
  noSecrets,
  obj,
  text,
  hash,
} from "./core.js";
export const DOMAIN = "poa-domains.local.intent.v1";
export interface Body {
  domain: string;
  revision: string;
  chainId: string;
  genesisHash: string;
  registryId: string;
  policyHash: string;
  normalizationHash: string;
  signer: string;
  coSigners: string[];
  requestId: string;
  nonce: number;
  notBefore: number;
  deadline: number;
  maxTotal: string;
  maxNetworkFee: string;
  action: string;
  params: Record<string, any>;
}
export interface Packet {
  body: Body;
  signatures: Record<string, string>;
}
export function principal(v: unknown): string {
  const s = text(v, 80);
  need(/^ed25519:[0-9a-f]{64}$/.test(s), "PRINCIPAL");
  return s;
}
export function publicPrincipal(key: KeyObject): string {
  const pub = createPublicKey(key).export({ format: "jwk" });
  need(pub.crv === "Ed25519" && pub.x, "PRINCIPAL");
  return "ed25519:" + Buffer.from(pub.x, "base64url").toString("hex");
}
export function message(body: Body): Buffer {
  return Buffer.from(canonical([DOMAIN, body]), "utf8");
}
export function signBody(body: Body, keys: KeyObject[]): Packet {
  const signatures: Record<string, string> = {};
  for (const key of keys)
    signatures[publicPrincipal(key)] = sign(null, message(body), key).toString(
      "hex",
    );
  return { body, signatures };
}
export function validateBody(v: unknown): Body {
  const b = exact(v, [
    "domain",
    "revision",
    "chainId",
    "genesisHash",
    "registryId",
    "policyHash",
    "normalizationHash",
    "signer",
    "coSigners",
    "requestId",
    "nonce",
    "notBefore",
    "deadline",
    "maxTotal",
    "maxNetworkFee",
    "action",
    "params",
  ]);
  noSecrets(b);
  need(Buffer.byteLength(canonical(b)) <= 49152, "BODY_TOO_LARGE");
  principal(b.signer);
  need(Array.isArray(b.coSigners) && b.coSigners.length <= 3, "SIGNATURES");
  b.coSigners.forEach(principal);
  need(
    canonical(b.coSigners) == canonical([...new Set(b.coSigners)].sort()) &&
      !b.coSigners.includes(b.signer),
    "SIGNATURES",
  );
  need(/^[a-zA-Z0-9_-]{1,64}$/.test(text(b.requestId, 64)), "REQUEST_ID");
  integer(b.nonce);
  integer(b.notBefore);
  integer(b.deadline);
  need(b.notBefore < b.deadline, "VALIDITY");
  for (const k of [
    "domain",
    "revision",
    "chainId",
    "genesisHash",
    "registryId",
    "policyHash",
    "normalizationHash",
    "maxTotal",
    "maxNetworkFee",
    "action",
  ])
    text(b[k], 128);
  obj(b.params);
  return b as Body;
}
export function authenticate(v: unknown): Packet {
  const p = exact(v, ["body", "signatures"]);
  const body = validateBody(p.body);
  const signatures = obj(p.signatures);
  const who = [body.signer, ...body.coSigners];
  need(
    canonical(Object.keys(signatures).sort()) === canonical([...who].sort()),
    "SIGNATURES",
  );
  for (const id of who) {
    const sig = text(signatures[id], 128);
    need(/^[0-9a-f]{128}$/.test(sig), "SIGNATURE");
    const key = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: Buffer.from(id.slice(8), "hex").toString("base64url"),
      },
      format: "jwk",
    });
    need(
      verify(null, message(body), key, Buffer.from(sig, "hex")),
      "SIGNATURE",
    );
  }
  return p as Packet;
}
export const intentId = (body: Body) => hash("local-intent-id/v1", body);
