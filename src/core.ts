import { createHash } from "node:crypto";
export class Fault extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export function need(ok: unknown, code = "INVALID_INPUT"): asserts ok {
  if (!ok) throw new Fault(code);
}
export type Obj = Record<string, any>;
export function obj(v: unknown): Obj {
  need(v && typeof v === "object" && !Array.isArray(v));
  return v as Obj;
}
export function exact(
  v: unknown,
  required: string[],
  optional: string[] = [],
): Obj {
  const o = obj(v);
  need(
    Object.keys(o).every((k) => [...required, ...optional].includes(k)) &&
      required.every((k) => Object.hasOwn(o, k)),
    "SCHEMA",
  );
  return o;
}
export function text(v: unknown, max = 2048): string {
  need(
    typeof v === "string" &&
      v.length <= max &&
      !/[\u0000-\u001f\ud800-\udfff]/u.test(v),
    "STRING",
  );
  return v;
}
export function integer(
  v: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  need(
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max,
    "INTEGER",
  );
  return v;
}
export function flag(v: unknown): boolean {
  need(typeof v === "boolean");
  return v;
}
export const MAX_AMOUNT = (1n << 127n) - 1n;
export function amount(v: unknown, positive = false): bigint {
  need(typeof v === "string" && /^(0|[1-9][0-9]{0,38})$/.test(v), "AMOUNT");
  const n = BigInt(v);
  need(n <= MAX_AMOUNT && (!positive || n > 0n), "AMOUNT");
  return n;
}
export function bounded(n: bigint): string {
  need(n >= 0n && n <= MAX_AMOUNT, "AMOUNT_OVERFLOW");
  return n.toString();
}
export function canonical(v: any): string {
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "string") {
    text(v, 1000000);
    return JSON.stringify(v);
  }
  if (typeof v === "number") {
    integer(v);
    return String(v);
  }
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = obj(v);
  return (
    "{" +
    Object.keys(o)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(o[k]))
      .join(",") +
    "}"
  );
}
export const hash = (domain: string, value: any) =>
  createHash("sha256")
    .update(canonical([domain, value]))
    .digest("hex");
export function noSecrets(v: any, depth = 0): void {
  need(depth <= 24, "DEPTH");
  if (typeof v === "string") {
    text(v, 16384);
    need(!/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(v), "SECRET_FIELD");
  } else if (Array.isArray(v)) {
    need(v.length <= 256, "SIZE");
    for (const x of v) noSecrets(x, depth + 1);
  } else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      need(
        !["__proto__", "prototype", "constructor"].includes(k),
        "UNSAFE_KEY",
      );
      need(
        !/^(?:private.?key|seed|mnemonic|api.?key|password|authorization|secret)$/i.test(
          k,
        ),
        "SECRET_FIELD",
      );
      noSecrets(x, depth + 1);
    }
  else if (typeof v === "number") integer(v);
  else need(v === null || typeof v === "boolean");
}
// Bounded JSON parser with duplicate-key rejection. No eval and no coercion.
export function parseJSON(source: string, limit = 65536): any {
  need(Buffer.byteLength(source) <= limit, "BODY_TOO_LARGE");
  let i = 0;
  const ws = () => {
    while (i < source.length && /[ \n\r\t]/.test(source[i]!)) i++;
  };
  const str = (): string => {
    const start = i++;
    while (i < source.length) {
      const c = source[i++];
      if (c === '"') {
        const s = JSON.parse(source.slice(start, i));
        text(s, limit);
        return s;
      }
      if (c === "\\") i++;
    }
    throw new Fault("JSON");
  };
  const value = (depth: number): any => {
    need(depth <= 24, "DEPTH");
    ws();
    const c = source[i];
    if (c === '"') return str();
    if (c === "{" || c === "[") {
      i++;
      ws();
      const array = c === "[";
      const end = array ? "]" : "}";
      const out: any = array ? [] : Object.create(null);
      const keys = new Set<string>();
      if (source[i] === end) {
        i++;
        return out;
      }
      while (i < source.length) {
        if (array) {
          need(out.length < 256, "SIZE");
          out.push(value(depth + 1));
        } else {
          need(source[i] === '"', "JSON");
          const k = str();
          need(!keys.has(k), "DUPLICATE_KEY");
          keys.add(k);
          ws();
          need(source[i++] === ":", "JSON");
          out[k] = value(depth + 1);
        }
        ws();
        const next = source[i++];
        if (next === end) return out;
        need(next === ",", "JSON");
        ws();
      }
      throw new Fault("JSON");
    }
    for (const [literal, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const)
      if (source.startsWith(literal, i)) {
        i += literal.length;
        return result;
      }
    const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      source.slice(i),
    );
    need(m, "JSON");
    i += m[0].length;
    const n = Number(m[0]);
    integer(n);
    return n;
  };
  try {
    const out = value(0);
    ws();
    need(i === source.length, "JSON");
    noSecrets(out);
    return out;
  } catch (e) {
    if (e instanceof Fault) throw e;
    throw new Fault("JSON");
  }
}
