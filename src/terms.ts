/** Canonical Terms & Privacy identity and Ed25519 signed-agreement verifier for humans and AI agents. */
import { createPublicKey, KeyObject, sign, verify } from "node:crypto";
import { canonical, exact, integer, need, noSecrets, text } from "./core.js";
import { base58, unbase58 } from "./native-crypto.js";
import { nativePrincipal, principal, publicPrincipal } from "./auth.js";

export const TERMS_DOMAIN = "poa-domains.terms.v1";
export const TERMS_CHAIN_ID = "poa-mainnet-1";
export const TERMS_VERSION = "2026-11-24.v1";
/** Exact SHA-256 of reference-web/terms.html (UTF-8, LF). Verified in unit tests so terms and hash cannot drift. */
export const TERMS_HASH = "a0fbfdb5b853b1ec52512e02e1ec2c60fcc58e0d6b3900449a3d48d791aee75d";
export const TERMS_URL = "/terms";
export const TERMS_SUMMARY =
  "PoA Domains is a standalone application registry for permanent names and public profiles using custodial POA escrow, not a native PoA naming protocol.";
export const TERMS_KEY_WARNING =
  "Never enter private keys, seed phrases, or passwords on this site — your agent signs locally in your own wallet.";

const MAX_PAST_SKEW_SEC = 3600;
const MAX_FUTURE_SKEW_SEC = 300;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface TermsStatement {
  domain: typeof TERMS_DOMAIN;
  chainId: string;
  actor: string;
  termsVersion: string;
  termsHash: string;
  agreed: true;
  agreedAt: number;
}

export interface SignedTermsAgreement {
  statement: TermsStatement;
  signature: string;
}

export interface TermsInfo {
  domain: typeof TERMS_DOMAIN;
  chainId: string;
  termsVersion: string;
  termsHash: string;
  termsUrl: string;
  summary: string;
  keyWarning: string;
  statementTemplate: {
    domain: typeof TERMS_DOMAIN;
    chainId: string;
    actor: string;
    termsVersion: string;
    termsHash: string;
    agreed: true;
    agreedAt: number;
  };
  instructions: string;
}

export function buildTermsInfo(options?: {
  baseUrl?: string;
  chainId?: string;
  nowSec?: number;
}): TermsInfo {
  const base = options?.baseUrl ? options.baseUrl.replace(/\/+$/, "") : "";
  const chainId = options?.chainId || TERMS_CHAIN_ID;
  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  return {
    domain: TERMS_DOMAIN,
    chainId,
    termsVersion: TERMS_VERSION,
    termsHash: TERMS_HASH,
    termsUrl: base ? `${base}${TERMS_URL}` : TERMS_URL,
    summary: TERMS_SUMMARY,
    keyWarning: TERMS_KEY_WARNING,
    statementTemplate: {
      domain: TERMS_DOMAIN,
      chainId,
      actor: "<YOUR_POA_ADDRESS>",
      termsVersion: TERMS_VERSION,
      termsHash: TERMS_HASH,
      agreed: true,
      agreedAt: nowSec,
    },
    instructions:
      "Sign canonical sorted-key UTF-8 JSON of `statement` locally with Ed25519 (base58 64-byte signature for poa1... actors, hex for ed25519:... fixture actors). Submit { statement, signature } to POST /v1/terms/agree or MCP agree_terms. Never share or send private keys.",
  };
}

export function termsStatementBytes(statement: TermsStatement): Buffer {
  return Buffer.from(canonical(statement), "utf8");
}

function publicKeyForActor(actor: string): { key: KeyObject; isNative: boolean } {
  if (actor.startsWith("poa1")) {
    const raw = unbase58(actor.slice(4), 32);
    return {
      key: createPublicKey({
        format: "der",
        type: "spki",
        key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      }),
      isNative: true,
    };
  }
  const raw = Buffer.from(actor.slice(8), "hex");
  return {
    key: createPublicKey({
      format: "der",
      type: "spki",
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    }),
    isNative: false,
  };
}

export function signTermsAgreement(
  statement: TermsStatement,
  privateKey: KeyObject,
): SignedTermsAgreement {
  const actor = principal(statement.actor);
  const rawSig = sign(null, termsStatementBytes(statement), privateKey);
  if (actor.startsWith("poa1")) {
    need(nativePrincipal(privateKey) === actor, "TERMS_SIGNATURE_INVALID");
    return { statement, signature: base58(rawSig) };
  }
  need(publicPrincipal(privateKey) === actor, "TERMS_SIGNATURE_INVALID");
  return { statement, signature: rawSig.toString("hex") };
}

export function verifyTermsAgreement(
  value: unknown,
  nowSec = Math.floor(Date.now() / 1000),
): { statement: TermsStatement; signature: string; statementJson: string } {
  let outer: Record<string, unknown>;
  try {
    outer = exact(value, ["statement", "signature"]);
  } catch {
    need(false, "TERMS_INVALID_INPUT");
  }
  noSecrets(outer);

  let st: Record<string, unknown>;
  try {
    st = exact(outer.statement, [
      "domain",
      "chainId",
      "actor",
      "termsVersion",
      "termsHash",
      "agreed",
      "agreedAt",
    ]);
  } catch {
    need(false, "TERMS_INVALID_INPUT");
  }

  need(st.domain === TERMS_DOMAIN, "TERMS_INVALID_INPUT");
  const chainId = text(st.chainId, 64);
  need(chainId === TERMS_CHAIN_ID || chainId.startsWith("local:"), "TERMS_INVALID_INPUT");
  need(st.agreed === true, "TERMS_INVALID_INPUT");

  let actor: string;
  try {
    actor = principal(st.actor);
  } catch {
    need(false, "TERMS_INVALID_INPUT");
  }

  const termsVersion = text(st.termsVersion, 64);
  const termsHash = text(st.termsHash, 64);
  need(termsVersion === TERMS_VERSION && termsHash === TERMS_HASH, "TERMS_VERSION_MISMATCH");

  let agreedAt: number;
  try {
    agreedAt = integer(st.agreedAt, 1);
  } catch {
    need(false, "TERMS_INVALID_INPUT");
  }
  need(
    agreedAt >= nowSec - MAX_PAST_SKEW_SEC && agreedAt <= nowSec + MAX_FUTURE_SKEW_SEC,
    "TERMS_EXPIRED",
  );

  const signature = text(outer.signature, 160);
  const statement: TermsStatement = {
    domain: TERMS_DOMAIN,
    chainId,
    actor,
    termsVersion,
    termsHash,
    agreed: true,
    agreedAt,
  };
  const statementJson = canonical(statement);

  let sigBytes: Buffer;
  let pub: { key: KeyObject; isNative: boolean };
  try {
    pub = publicKeyForActor(actor);
    if (pub.isNative) {
      sigBytes = unbase58(signature, 64);
    } else {
      need(/^[0-9a-f]{128}$/.test(signature), "TERMS_SIGNATURE_INVALID");
      sigBytes = Buffer.from(signature, "hex");
    }
  } catch {
    need(false, "TERMS_SIGNATURE_INVALID");
  }

  need(verify(null, Buffer.from(statementJson, "utf8"), pub.key, sigBytes), "TERMS_SIGNATURE_INVALID");
  return { statement, signature, statementJson };
}
