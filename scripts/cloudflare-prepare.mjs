import { mkdirSync, copyFileSync } from "node:fs";
mkdirSync(new URL("../cloudflare/generated/", import.meta.url), { recursive: true });
copyFileSync(new URL("../web/emoji17-data.mjs", import.meta.url), new URL("../cloudflare/generated/emoji17-source.txt", import.meta.url));
