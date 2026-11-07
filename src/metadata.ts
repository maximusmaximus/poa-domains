import { createHash } from "node:crypto";
import { canonical, exact, need, noSecrets, text } from "./core.js";
const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
export function base32(bytes: Uint8Array): string {
  let acc = 0,
    bits = 0,
    out = "";
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(acc >>> bits) & 31];
    }
  }
  if (bits) out += alphabet[(acc << (5 - bits)) & 31];
  return out;
}
export function cidFor(document: unknown): string {
  const digest = createHash("sha256").update(canonical(document)).digest();
  return (
    "b" + base32(Buffer.concat([Buffer.from([1, 0x55, 0x12, 0x20]), digest]))
  );
}
export function validCid(cid: unknown): string {
  const s = text(cid, 59);
  need(/^bafkrei[a-z2-7]{52}$/.test(s), "CID");
  let acc = 0,
    bits = 0;
  const bytes: number[] = [];
  for (const c of s.slice(1)) {
    acc = (acc << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 255);
    }
  }
  need(
    bytes.length === 36 &&
      bytes[0] === 1 &&
      bytes[1] === 0x55 &&
      bytes[2] === 0x12 &&
      bytes[3] === 32 &&
      "b" + base32(Uint8Array.from(bytes)) === s,
    "CID",
  );
  return s;
}
export interface Metadata {
  cid: string;
  document: {
    schema: string;
    name: string;
    rightsHash: string;
    description: string;
  };
}
export function metadata(
  v: unknown,
  name: string,
  rightsHash: string,
): Metadata {
  const m = exact(v, ["cid", "document"]);
  const d = exact(m.document, ["schema", "name", "rightsHash", "description"]);
  noSecrets(d);
  need(
    d.schema === "poa-domains.metadata.v1" &&
      d.name === name &&
      d.rightsHash === rightsHash,
    "METADATA_BINDING",
  );
  text(d.description, 2048);
  validCid(m.cid);
  need(cidFor(d) === m.cid, "CID_CONTENT_MISMATCH");
  return m as Metadata;
}
