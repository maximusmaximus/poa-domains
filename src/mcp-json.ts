import { need, Fault, text } from "./core.js";
export function parseMcpJSON(
  source: string,
  limit = 65536,
  maxArray = 256,
): any {
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
          need(out.length < maxArray, "SIZE");
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
    need(Number.isFinite(n), "JSON");
    return n;
  };
  try {
    const out = value(0);
    ws();
    need(i === source.length, "JSON");
    return out;
  } catch (e) {
    if (e instanceof Fault) throw e;
    throw new Fault("JSON");
  }
}
