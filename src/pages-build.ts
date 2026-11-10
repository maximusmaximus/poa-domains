import { createHash } from "node:crypto";
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
import { nativeFailure, validateNetworkDocument } from "./native.js";
import { Fault } from "./core.js";
import { productionStatus } from "./production.js";

const unicodePublicPins: Record<string, { bytes: number; sha256: string }> = {
  "emoji17.mjs": {
    "bytes": 7417,
    "sha256": "1a937b91d2e54b1c68af66a8ac0c780980f2b9ddeb7e48e90a74274ada142d0c"
  },
  "emoji17-data.mjs": {
    "bytes": 754062,
    "sha256": "5e511ed00485deeff7e9f382dd9722807c031cc67f92d8ad7f550c436251296c"
  },
  "LICENSE-UNICODE.txt": {
    "bytes": 1995,
    "sha256": "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96"
  },
  "PUBLIC-PROVENANCE.json": {
    "bytes": 2042,
    "sha256": "5b8ffbe6a6a4caf49770fd4dfb972743209a7c5b4f7f9c2550fc3fc80db287f5"
  },
  "emoji-format-checker.mjs": {
    "bytes": 11294,
    "sha256": "f7c6e412c63951c6a617ff79e59ddd7b36cceba2be39b57c882a131a4783869b"
  },
  "emoji-format-checker.css": {
    "bytes": 1064,
    "sha256": "32d2c62e558ee2997b0c37d7a42f104fd334240e16afb5b772868f88737bb120"
  }
};

export const PUBLIC_FILES = [
  "index.html",
  "app.js",
  "live-network.js",
  "network-schema.js",
  "emoji17.mjs",
  "emoji-format-checker.mjs",
  "emoji-format-checker.css",
  "emoji17-data.mjs",
  "LICENSE-UNICODE.txt",
  "PUBLIC-PROVENANCE.json",
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
  for (const file of ["index.html", "app.js", "live-network.js", "network-schema.js", "style.css", "icon.svg", ...Object.keys(unicodePublicPins)])
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
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://minepoa.com/chain/poa-mainnet-1/api/status https://minepoa.com/chain/poa-mainnet-1/api/network-facts; img-src 'self'; base-uri 'none'; form-action 'none'";
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
        lstatSync(path).size < (file === "emoji17-data.mjs" ? 800000 : 100000),
      "PUBLIC_ARTIFACT",
    );
  }
  for (const [file, pin] of Object.entries(unicodePublicPins)) {
    const bytes = readFileSync(join(output, file));
    need(bytes.length === pin.bytes && createHash("sha256").update(bytes).digest("hex") === pin.sha256, "UNICODE_PUBLIC_ARTIFACT_IDENTITY");
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
  console.log(JSON.stringify(buildProductionBundle(), null, 2));
