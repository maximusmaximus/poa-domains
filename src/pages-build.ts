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

const discoveryFiles=["llms.txt",".well-known/agent.json","openapi.json","schemas/signed-packet.json","schemas/mcp-tools.json"] as const;
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
  "robots.txt",
  "sitemap.xml",
  "config.json",
  "status.json",
  ...discoveryFiles,
  ".nojekyll",
] as const;
// Known generated assets from the replaced public demo may be removed, but an
// unexpected file or symlink fails closed rather than being uploaded/deleted.
const previous = new Set([
  ...PUBLIC_FILES,
  "network.json",
  "shared.js",
  "demo/state.json",
  "demo/capabilities.json",
  "demo/examples.json",
  "demo/details.json",
]);
export function publicArtifactFiles(directory:string):string[]{
 const out:string[]=[];
 for(const entry of readdirSync(directory,{recursive:true}) as string[]){const stat=lstatSync(join(directory,entry));need(!stat.isSymbolicLink(),"ARTIFACT_LINK");if(stat.isDirectory())need(["demo",".well-known","schemas"].includes(entry),"UNEXPECTED_BUILD_ARTIFACT");else{need(stat.isFile(),"ARTIFACT_DIRECTORY");out.push(entry);}}
 return out.sort();
}
export function buildProductionBundle(directory = resolve("_site"), _unusedObservation?: unknown) {
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
    for(const file of publicArtifactFiles(output))need(previous.has(file),"UNEXPECTED_BUILD_ARTIFACT");
    rmSync(output, { recursive: true });
  }
  mkdirSync(output);
  for (const file of ["index.html", "app.js", "live-network.js", "network-schema.js", "style.css", "icon.svg", "robots.txt", "sitemap.xml", ...Object.keys(unicodePublicPins)])
    copyFileSync(join("web", file), join(output, file));
  const config = JSON.parse(readFileSync("web/config.json", "utf8"));
  need(
    canonical(config) ===
      canonical({
        mode: "production-only",
        publicApiBase: null,
        statusFile: "./status.json",
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
  // Copy verified generated public text only. Never import Engine/auth/MCP into
  // the production-only Pages guard's dependency graph.
  for(const name of discoveryFiles){const source=join("reference-web",name),file=join(output,name);need(lstatSync(source).isFile()&&!lstatSync(source).isSymbolicLink(),"ARTIFACT_LINK");if(name.includes("/"))need(!lstatSync(join("reference-web",name.split("/")[0]!)).isSymbolicLink(),"ARTIFACT_LINK");mkdirSync(join(file,".."),{recursive:true});copyFileSync(source,file);}

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
    publicArtifactFiles(output).length === PUBLIC_FILES.length &&
      publicArtifactFiles(output).every((file) =>
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
