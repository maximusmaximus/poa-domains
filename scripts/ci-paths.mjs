// Container and hosted jobs mount the same commit at different absolute paths.
// Relocate only workspace-root prefixes, preserving coverage counters and maps.
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
export function relocateCoverage(value, from, to) {
  const pairs = [[pathToFileURL(resolve(from) + sep).href, pathToFileURL(resolve(to) + sep).href],
    [resolve(from) + sep, resolve(to) + sep]];
  const rename = text => {
    const pair = pairs.find(([prefix]) => text.startsWith(prefix));
    return pair ? pair[1] + text.slice(pair[0].length) : text;
  };
  const walk = v => typeof v === "string" ? rename(v) : Array.isArray(v) ? v.map(walk) :
    v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [rename(k), walk(x)])) : v;
  return walk(value);
}
