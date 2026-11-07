import { Fault, need, text } from "./core.js";
// Public upstream JSON uses fractional economics. This parser is deliberately
// separate from the integer-only registry parser; nothing widens reference amounts.
// Canonical encoding matches the documented Node client's sorted JSON encoding
// for this bounded JSON subset. No upstream program is downloaded or executed.
export function publicCanonical(value: unknown, depth = 0): string {
  need(depth <= 24, "DEPTH");
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(text(value, 32768));
  if (typeof value === "number") {
    need(Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER, "PUBLIC_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    need(value.length <= 256, "SIZE");
    return "[" + value.map(v => publicCanonical(v, depth + 1)).join(",") + "]";
  }
  need(value && typeof value === "object", "PUBLIC_JSON");
  const proto = Object.getPrototypeOf(value);
  need(proto === null || proto === Object.prototype, "PUBLIC_JSON");
  const o = value as Record<string, unknown>, keys = Object.keys(o).sort();
  need(keys.length <= 256, "SIZE");
  return "{" + keys.map(key => {
    text(key, 256);
    need(!["__proto__", "prototype", "constructor"].includes(key), "UNSAFE_KEY");
    need(!/^(?:private.?key|privkey|seed|mnemonic|api.?key|password|authorization|secret)$/i.test(key), "SECRET_FIELD");
    return JSON.stringify(key) + ":" + publicCanonical(o[key], depth + 1);
  }).join(",") + "}";
}
// Bounded JSON parser with duplicate-key rejection. No eval and no coercion.
export function parsePublicJSON(source: string, limit = 65536): any {
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
    need(Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER, "PUBLIC_NUMBER");
    return n;
  };
  try {
    const out = value(0);
    ws();
    need(i === source.length, "JSON");
    publicCanonical(out);
    return out;
  } catch (e) {
    if (e instanceof Fault) throw e;
    throw new Fault("JSON");
  }
}
