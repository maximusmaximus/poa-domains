import { createHash } from "node:crypto";
import { canonical, exact, Fault, need, noSecrets, text } from "./core.js";
import { principal } from "./auth.js";
import { base32, cidFor, validCid } from "./metadata.js";

export const PROFILE_SCHEMA_V1 = "poa-domains.profile.v1";
export const PROFILE_VERSION = 1;
export const MAX_PROFILE_DESCRIPTION_CHARS = 280;
export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const);
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export interface ProfileDocumentV1 {
  schema: typeof PROFILE_SCHEMA_V1;
  version: 1;
  name: string;
  rightsHash: string;
  poa: string;
  btc: string | null;
  eth: string | null;
  description: string;
  image: string | null;
}

export interface ProfileMetadataV1 {
  cid: string;
  document: ProfileDocumentV1;
}

/* ---------- Pure Keccak-256 (Ethereum EIP-55) ---------- */
const MASK64 = 0xffffffffffffffffn;
const RC: readonly bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const RHO: readonly number[] = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];
const PI: readonly number[] = [
  0, 10, 20, 5, 15, 16, 1, 11, 21, 6, 7, 17, 2, 12, 22, 23, 8, 18, 3, 13, 14, 24, 9, 19, 4,
];
function rotl64(x: bigint, n: number): bigint {
  if (n === 0) return x;
  const s = BigInt(n);
  return ((x << s) | (x >> (64n - s))) & MASK64;
}
function keccakF1600(state: bigint[]): void {
  const c = new Array<bigint>(5);
  const d = new Array<bigint>(5);
  const b = new Array<bigint>(25);
  for (let r = 0; r < 24; r++) {
    for (let x = 0; x < 5; x++)
      c[x] = state[x]! ^ state[x + 5]! ^ state[x + 10]! ^ state[x + 15]! ^ state[x + 20]!;
    for (let x = 0; x < 5; x++)
      d[x] = c[(x + 4) % 5]! ^ rotl64(c[(x + 1) % 5]!, 1);
    for (let i = 0; i < 25; i++) state[i] = state[i]! ^ d[i % 5]!;
    for (let i = 0; i < 25; i++) b[PI[i]!] = rotl64(state[i]!, RHO[i]!);
    for (let y = 0; y < 25; y += 5)
      for (let x = 0; x < 5; x++)
        state[y + x] = b[y + x]! ^ ((~b[y + ((x + 1) % 5)]! & MASK64) & b[y + ((x + 2) % 5)]!);
    state[0] = state[0]! ^ RC[r]!;
  }
}
export function keccak256Hex(input: string): string {
  const raw = new TextEncoder().encode(input);
  const rate = 136;
  const blockCount = Math.floor(raw.length / rate) + 1;
  const padded = new Uint8Array(blockCount * rate);
  padded.set(raw);
  padded[raw.length] = 0x01;
  padded[padded.length - 1]! |= 0x80;
  const state = new Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < 17; i++) {
      let lane = 0n;
      for (let k = 0; k < 8; k++)
        lane |= BigInt(padded[offset + i * 8 + k]!) << BigInt(k * 8);
      state[i] = state[i]! ^ lane;
    }
    keccakF1600(state);
  }
  let hex = "";
  for (let i = 0; i < 4; i++) {
    let lane = state[i]!;
    for (let k = 0; k < 8; k++) {
      hex += Number(lane & 0xffn).toString(16).padStart(2, "0");
      lane >>= 8n;
    }
  }
  return hex;
}

export function toEip55Address(value: string): string {
  need(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value), "INVALID_ETH_ADDRESS");
  const lower = value.slice(2).toLowerCase();
  const digest = keccak256Hex(lower);
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    const ch = lower[i]!;
    out += parseInt(digest[i]!, 16) >= 8 ? ch.toUpperCase() : ch;
  }
  return out;
}

export function validEthAddress(value: unknown): string {
  need(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value), "INVALID_ETH_ADDRESS");
  const expected = toEip55Address(value);
  need(value === expected, "INVALID_ETH_CHECKSUM");
  return value;
}

/* ---------- Bitcoin Mainnet Validator (Bech32, Bech32m, Legacy Base58Check) ---------- */
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3] as const;
const BECH32M_CONST = 0x2bc830a3;
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= BECH32_GEN[i]!;
  }
  return chk >>> 0;
}

function decodeBech32Mainnet(addr: string): boolean {
  if (addr.length < 14 || addr.length > 90) return false;
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) return false;
  const lower = addr.toLowerCase();
  if (!lower.startsWith("bc1")) return false;
  const dataPart = lower.slice(3);
  if (dataPart.length < 7) return false;
  const data: number[] = [];
  for (const ch of dataPart) {
    const idx = BECH32_CHARSET.indexOf(ch);
    if (idx < 0) return false;
    data.push(idx);
  }
  // hrpExpand("bc") = [3, 3, 0, 2, 3]
  const polymod = bech32Polymod([3, 3, 0, 2, 3, ...data]);
  const version = data[0]!;
  if (version > 16) return false;
  if (version === 0 && polymod !== 1) return false;
  if (version > 0 && polymod !== BECH32M_CONST) return false;
  const payload = data.slice(1, -6);
  let acc = 0, bits = 0;
  const prog: number[] = [];
  for (const v of payload) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      prog.push((acc >>> bits) & 255);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 255) !== 0) return false;
  if (prog.length < 2 || prog.length > 40) return false;
  if (version === 0 && prog.length !== 20 && prog.length !== 32) return false;
  if (version === 1 && prog.length !== 32) return false;
  return true;
}

function decodeBase58Mainnet(addr: string): boolean {
  if (addr.length < 25 || addr.length > 35) return false;
  if (!addr.startsWith("1") && !addr.startsWith("3")) return false;
  let n = 0n;
  for (const ch of addr) {
    const d = B58_ALPHABET.indexOf(ch);
    if (d < 0) return false;
    n = n * 58n + BigInt(d);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.push(Number(n & 0xffn));
    n >>= 8n;
  }
  bytes.reverse();
  let leadingZeros = 0;
  for (const ch of addr) {
    if (ch === "1") leadingZeros++;
    else break;
  }
  const full = new Uint8Array(leadingZeros + bytes.length);
  full.set(bytes, leadingZeros);
  if (full.length !== 25) return false;
  if (full[0] !== 0x00 && full[0] !== 0x05) return false;
  const payload = full.slice(0, 21);
  const checksum = full.slice(21, 25);
  const h1 = createHash("sha256").update(payload).digest();
  const h2 = createHash("sha256").update(h1).digest();
  return (
    h2[0] === checksum[0] &&
    h2[1] === checksum[1] &&
    h2[2] === checksum[2] &&
    h2[3] === checksum[3]
  );
}

export function validBtcAddress(value: unknown): string {
  need(typeof value === "string" && value.length >= 14 && value.length <= 90, "INVALID_BTC_ADDRESS");
  const lower = value.toLowerCase();
  if (lower.startsWith("bc1")) {
    need(decodeBech32Mainnet(value), "INVALID_BTC_ADDRESS");
    return lower;
  }
  need(decodeBase58Mainnet(value), "INVALID_BTC_ADDRESS");
  return value;
}

export function validPoaAddress(value: unknown): string {
  need(typeof value === "string" && value.startsWith("poa1"), "INVALID_POA_ADDRESS");
  try {
    return principal(value);
  } catch {
    throw new Fault("INVALID_POA_ADDRESS");
  }
}

export function validProfileDescription(value: unknown): string {
  need(typeof value === "string", "INVALID_PROFILE_DESCRIPTION");
  need(!/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value), "INVALID_PROFILE_DESCRIPTION");
  need([...value].length <= MAX_PROFILE_DESCRIPTION_CHARS, "INVALID_PROFILE_DESCRIPTION");
  noSecrets(value);
  return value;
}

export function validProfileImage(value: unknown): string {
  need(typeof value === "string" && value.length > 0 && value.length <= 2048, "INVALID_PROFILE_IMAGE");
  need(!/[\u0000-\u001f\u007f-\u009f\ud800-\udfff\s]/u.test(value), "INVALID_PROFILE_IMAGE");
  if (value.startsWith("ipfs://")) {
    const cid = value.slice("ipfs://".length);
    if (cid.startsWith("bafkrei")) {
      try {
        validCid(cid);
        return value;
      } catch {
        throw new Fault("INVALID_PROFILE_IMAGE");
      }
    }
    need(
      /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) || /^b[a-z2-7]{50,120}$/.test(cid),
      "INVALID_PROFILE_IMAGE",
    );
    return value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Fault("INVALID_PROFILE_IMAGE");
  }
  need(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      ![...url.searchParams.keys()].some((k) =>
        /^(token|api.?key|password|secret|authorization)$/i.test(k),
      ),
    "INVALID_PROFILE_IMAGE",
  );
  return value;
}

export function sniffImageFormat(bytes: Uint8Array): AllowedImageType | null {
  if (bytes.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // GIF: GIF87a or GIF89a
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) return "image/gif";
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

export function cidForBytes(bytes: Uint8Array): string {
  const digest = createHash("sha256").update(bytes).digest();
  return "b" + base32(Buffer.concat([Buffer.from([1, 0x55, 0x12, 0x20]), digest]));
}

export function validateProfileDocument(
  v: unknown,
  name: string,
  rightsHash: string,
): ProfileDocumentV1 {
  const d = exact(v, [
    "schema",
    "version",
    "name",
    "rightsHash",
    "poa",
    "btc",
    "eth",
    "description",
    "image",
  ]);
  noSecrets(d);
  need(d.schema === PROFILE_SCHEMA_V1 && d.name === name && d.rightsHash === rightsHash, "METADATA_BINDING");
  need(d.version === PROFILE_VERSION, "PROFILE_VERSION");
  const poa = validPoaAddress(d.poa);
  const btc = d.btc === null ? null : validBtcAddress(d.btc);
  const eth = d.eth === null ? null : validEthAddress(d.eth);
  const description = validProfileDescription(d.description);
  const image = d.image === null ? null : validProfileImage(d.image);
  // Canonical check ensures e.g. Bech32 uppercase wasn't mixed in differently from normalized value
  need(d.btc === btc, "INVALID_BTC_ADDRESS");
  return {
    schema: PROFILE_SCHEMA_V1,
    version: 1,
    name: text(d.name, 8192),
    rightsHash: text(d.rightsHash, 64),
    poa,
    btc,
    eth,
    description,
    image,
  };
}

export function buildProfileWitness(input: {
  name: string;
  rightsHash: string;
  poa: string;
  btc?: string | null;
  eth?: string | null;
  description?: string;
  image?: string | null;
}): ProfileMetadataV1 {
  const rawBtc = typeof input.btc === "string" && input.btc.trim() ? input.btc.trim() : null;
  const rawEth = typeof input.eth === "string" && input.eth.trim() ? input.eth.trim() : null;
  const rawImage = typeof input.image === "string" && input.image.trim() ? input.image.trim() : null;
  const doc = validateProfileDocument(
    {
      schema: PROFILE_SCHEMA_V1,
      version: 1,
      name: input.name,
      rightsHash: input.rightsHash,
      poa: input.poa.trim(),
      btc: rawBtc ? rawBtc.toLowerCase().startsWith("bc1") ? rawBtc.toLowerCase() : rawBtc : null,
      eth: rawEth,
      description: input.description ?? "",
      image: rawImage,
    },
    input.name,
    input.rightsHash,
  );
  return { cid: cidFor(doc), document: doc };
}

export function extractLatestProfile(deed: {
  name: string;
  owner: string;
  rightsHash: string;
  profileResetAt?: number;
  metadata?: readonly { cid: string; document: any }[];
} | null | undefined): {
  profile: ProfileDocumentV1;
  cid: string | null;
  isDefault: boolean;
  metadataVersion: number;
} | null {
  if (!deed) return null;
  const list = Array.isArray(deed.metadata) ? deed.metadata : [];
  const rawReset = Number(deed.profileResetAt);
  const resetAt = Number.isSafeInteger(rawReset) && rawReset > 0 ? Math.min(rawReset, list.length) : 0;
  for (let i = list.length - 1; i >= resetAt; i--) {
    const entry = list[i];
    if (entry?.document?.schema === PROFILE_SCHEMA_V1) {
      return {
        profile: entry.document as ProfileDocumentV1,
        cid: entry.cid,
        isDefault: false,
        metadataVersion: i + 1,
      };
    }
  }
  const latest = resetAt === 0 ? list.at(-1) : undefined;
  return {
    profile: {
      schema: PROFILE_SCHEMA_V1,
      version: 1,
      name: deed.name,
      rightsHash: deed.rightsHash,
      poa: deed.owner,
      btc: null,
      eth: null,
      description: typeof latest?.document?.description === "string"
        ? [...latest.document.description].slice(0, MAX_PROFILE_DESCRIPTION_CHARS).join("")
        : "",
      image: null,
    },
    cid: latest?.cid ?? null,
    isDefault: true,
    metadataVersion: list.length,
  };
}

export function canonicalProfileJson(doc: ProfileDocumentV1): string {
  return canonical(doc);
}
