// Node-only loader. The Worker aliases this module to a build-time static loader.
import { readFileSync } from "node:fs";
export const manifestData: unknown = JSON.parse(readFileSync(new URL("../../vendor/unicode/manifest.json", import.meta.url), "utf8"));
export const emoji17DataSource = readFileSync(new URL("../../web/emoji17-data.mjs", import.meta.url), "utf8");
