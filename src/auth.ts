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
import { base58, nativeAddress, unbase58 } from "./native-crypto.js";
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
  if (/^ed25519:[0-9a-f]{64}$/.test(s)) return s;
  if (s.startsWith("poa1")) {
    try {
      unbase58(s.slice(4), 32);
      return s;
    } catch {
      need(false, "PRINCIPAL");
    }
  }
  need(false, "PRINCIPAL");
}
export function publicPrincipal(key: KeyObject): string {
  const pub = createPublicKey(key).export({ format: "jwk" });
  need(pub.crv === "Ed25519" && pub.x, "PRINCIPAL");
  return "ed25519:" + Buffer.from(pub.x, "base64url").toString("hex");
}
export function nativePrincipal(key: KeyObject): string {
  const pub = createPublicKey(key).export({ format: "jwk" });
  need(pub.crv === "Ed25519" && pub.x, "PRINCIPAL");
  return nativeAddress(Buffer.from(pub.x, "base64url"));
}
export function message(body: Body): Buffer {
  return Buffer.from(canonical([DOMAIN, body]), "utf8");
}
export function signBody(body: Body, keys: KeyObject[]): Packet {
  const signatures: Record<string, string> = {};
  const who = [
    body.signer,
    ...(Array.isArray(body.coSigners) ? body.coSigners : []),
  ];
  for (const key of keys) {
    const edId = publicPrincipal(key);
    const poaId = nativePrincipal(key);
    const rawSig = sign(null, message(body), key);
    if (who.includes(poaId)) {
      signatures[poaId] = base58(rawSig);
    } else if (who.includes(edId)) {
      signatures[edId] = rawSig.toString("hex");
    } else if (
      typeof body.signer === "string" &&
      body.signer.startsWith("poa1")
    ) {
      signatures[poaId] = base58(rawSig);
    } else {
      signatures[edId] = rawSig.toString("hex");
    }
  }
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
    let sigBytes: Buffer;
    if (/^[0-9a-f]{128}$/.test(sig)) {
      sigBytes = Buffer.from(sig, "hex");
    } else {
      try {
        sigBytes = unbase58(sig, 64);
      } catch {
        need(false, "SIGNATURE");
      }
    }
    const rawPub = id.startsWith("poa1")
      ? unbase58(id.slice(4), 32)
      : Buffer.from(id.slice(8), "hex");
    const key = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: rawPub.toString("base64url"),
      },
      format: "jwk",
    });
    need(verify(null, message(body), key, sigBytes), "SIGNATURE");
  }
  return p as Packet;
}
export const intentId = (body: Body) => hash("local-intent-id/v1", body);
