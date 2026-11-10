import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { discoveryDocuments } from "../dist/src/discovery.js";
for (const [path, { text }] of Object.entries(discoveryDocuments()))
  for (const root of ["reference-web", "docs/discovery"]) {
    const name = root + path;
    if (process.argv.includes("--write")) {
      mkdirSync(dirname(name), { recursive: true });
      writeFileSync(name, text);
    } else if (readFileSync(name, "utf8") !== text)
      throw Error("Discovery drift: " + name);
  }
console.log("Discovery artifacts match shared MCP/REST schemas");
