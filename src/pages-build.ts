import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { canonical, need, noSecrets } from "./core.js";
import { NativeMonitor, nativeFailure, validateNetworkDocument } from "./native.js";
import { Fault } from "./core.js";
import { productionStatus } from "./production.js";

export const PUBLIC_FILES = [
  "index.html",
  "app.js",
  "style.css",
  "icon.svg",
  "config.json",
  "status.json",
  "network.json",
  ".nojekyll",
] as const;
// Known generated assets from the replaced public demo may be removed, but an
// unexpected file or symlink fails closed rather than being uploaded/deleted.
const previous = new Set([
  ...PUBLIC_FILES,
  "shared.js",
  "demo/state.json",
  "demo/capabilities.json",
  "demo/examples.json",
  "demo/details.json",
]);
export function buildProductionBundle(directory = resolve("_site"), observation: unknown = nativeFailure(new Fault("NOT_OBSERVED"))) {
  const network = validateNetworkDocument(observation);
  const output = resolve(directory);
  need(
    output === resolve("_site") ||
      output.startsWith(resolve(tmpdir()) + sep + "poa-production-pages-test-"),
    "BUILD_DIRECTORY",
  );
  if (existsSync(output)) {
    need(
      lstatSync(output).isDirectory() && !lstatSync(output).isSymbolicLink(),
      "ARTIFACT_DIRECTORY",
    );
    for (const file of readdirSync(output)) {
      const path = join(output, file),
        stat = lstatSync(path);
      need(!stat.isSymbolicLink(), "ARTIFACT_LINK");
      if (file === "demo" && stat.isDirectory()) {
        for (const child of readdirSync(path))
          need(
            previous.has("demo/" + child) &&
              lstatSync(join(path, child)).isFile() &&
              !lstatSync(join(path, child)).isSymbolicLink(),
            "UNEXPECTED_BUILD_ARTIFACT",
          );
      } else
        need(stat.isFile() && previous.has(file), "UNEXPECTED_BUILD_ARTIFACT");
    }
    rmSync(output, { recursive: true });
  }
  mkdirSync(output);
  for (const file of ["index.html", "app.js", "style.css", "icon.svg"])
    copyFileSync(join("web", file), join(output, file));
  const config = JSON.parse(readFileSync("web/config.json", "utf8"));
  need(
    canonical(config) ===
      canonical({
        mode: "production-only",
        publicApiBase: null,
        statusFile: "./status.json",
        networkFile: "./network.json",
      }),
    "PRODUCTION_WEB_CONFIG",
  );
  const status = productionStatus();
  noSecrets(status);
  writeFileSync(
    join(output, "config.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
  writeFileSync(
    join(output, "status.json"),
    JSON.stringify(status, null, 2) + "\n",
  );
  noSecrets(network);
  writeFileSync(join(output, "network.json"), JSON.stringify(network, null, 2) + "\n");
  const policy =
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";
  writeFileSync(
    join(output, "index.html"),
    readFileSync(join(output, "index.html"), "utf8").replace(
      "<head>",
      '<head><meta http-equiv="Content-Security-Policy" content="' +
        policy +
        '">',
    ),
  );
  writeFileSync(join(output, ".nojekyll"), "");
  need(
    readdirSync(output).length === PUBLIC_FILES.length &&
      readdirSync(output).every((file) =>
        (PUBLIC_FILES as readonly string[]).includes(file),
      ),
    "UNEXPECTED_BUILD_ARTIFACT",
  );
  for (const file of PUBLIC_FILES) {
    const path = join(output, file);
    need(
      lstatSync(path).isFile() &&
        !lstatSync(path).isSymbolicLink() &&
        lstatSync(path).size < 100000,
      "PUBLIC_ARTIFACT",
    );
  }
  return {
    status: "built",
    mode: "production-only",
    operational: false,
    files: PUBLIC_FILES.length,
    apiEndpoint: null,
    fixtureData: false,
    output,
  };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  console.log(JSON.stringify(buildProductionBundle(undefined, await new NativeMonitor().observe().catch(nativeFailure)), null, 2));
