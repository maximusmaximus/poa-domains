// CI-only preparation: existing test sources are unchanged. The same escrow
// unit/public/fixture bundles are built once with source maps for V8 reporting.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const output = resolve("dist/escrow-tests");
mkdirSync(output, { recursive: true });
for (const [source, name] of [["escrow.test.ts", "unit.mjs"], ["escrow-public.test.ts", "public.mjs"], ["escrow-runtime-fixture.ts", "fixture.mjs"]])
  await build({ entryPoints: [resolve("cloudflare/test", source)], bundle: true,
    platform: "node", format: "esm", sourcemap: "inline",
    alias: { "#poa-unicode-data": resolve("cloudflare/unicode-data.ts") }, outfile: resolve(output, name) });
