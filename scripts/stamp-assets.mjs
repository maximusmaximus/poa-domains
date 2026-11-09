// Cache-busting: stamp content hashes into asset URLs so a fresh HTML page never
// pairs with a stale cached app.js / shared.js / style.css (the public proxy
// serves static assets with a multi-hour max-age).
// Usage: node scripts/stamp-assets.mjs          (rewrite files)
//        node scripts/stamp-assets.mjs --check  (exit 1 if stamps are stale)
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const dir = new URL("../reference-web/", import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), "utf8");
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);

export function stampAssets() {
  const shared = read("shared.js");
  const escrow = read("escrow.js");
  const appIn = read("app.js");
  const app = appIn.replace(/from "\.\/escrow\.js(?:\?v=[0-9a-f]+)?"/, `from "./escrow.js?v=${hash(escrow)}"`).replace(/from "\.\/shared\.js(?:\?v=[0-9a-f]+)?"/, `from "./shared.js?v=${hash(shared)}"`);
  const style = read("style.css");
  const htmlIn = read("index.html");
  const html = htmlIn
    .replace(/href="\/style\.css(?:\?v=[0-9a-f]+)?"/, `href="/style.css?v=${hash(style)}"`)
    .replace(/src="\/app\.js(?:\?v=[0-9a-f]+)?"/, `src="/app.js?v=${hash(app)}"`);
  return { files: { "app.js": app, "index.html": html }, changed: app !== appIn || html !== htmlIn };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { files, changed } = stampAssets();
  if (process.argv.includes("--check")) {
    if (changed) { console.error("reference-web asset stamps are stale: run node scripts/stamp-assets.mjs"); process.exit(1); }
    console.log("asset stamps current");
  } else {
    for (const [f, text] of Object.entries(files)) writeFileSync(new URL(f, dir), text);
    console.log(changed ? "asset stamps updated" : "asset stamps current");
  }
}
