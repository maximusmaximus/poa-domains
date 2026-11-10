import { readFileSync, writeFileSync } from "node:fs";
import { AGENT_CART_SCHEMA } from "../reference-web/agent-cart.js";
const text = JSON.stringify(AGENT_CART_SCHEMA, null, 2) + "\n";
for (const path of [
  "docs/schemas/agent-cart-v2.schema.json",
  "reference-web/agent-cart-v2.schema.json",
]) {
  if (process.argv.includes("--write")) writeFileSync(path, text);
  else if (readFileSync(path, "utf8") !== text)
    throw Error("Cart schema drift: " + path);
}
console.log("Cart v2 schema artifacts match their single source");
