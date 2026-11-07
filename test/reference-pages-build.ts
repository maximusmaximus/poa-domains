import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  lstatSync,
} from "node:fs";
import { resolve, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { publicDemoFixture } from "./reference-fixture.js";
import { noSecrets, need } from "../src/core.js";
import { nameKey } from "../src/names.js";

// Test-only builder; never imported by the public Pages build.
export function buildReferenceBundle(directory: string) {
  const output = resolve(directory);
  need(
    output.startsWith(resolve(tmpdir()) + sep) &&
      output.includes("poa-reference-pages-test-"),
    "TEST_OUTPUT_ONLY",
  );
  mkdirSync(output, { recursive: true });
  need(
    lstatSync(output).isDirectory() && !lstatSync(output).isSymbolicLink(),
    "ARTIFACT_DIRECTORY",
  );
  mkdirSync(join(output, "demo"), { recursive: true });
  need(
    lstatSync(join(output, "demo")).isDirectory() &&
      !lstatSync(join(output, "demo")).isSymbolicLink(),
    "ARTIFACT_DIRECTORY",
  );
  const fixture = publicDemoFixture();
  noSecrets(fixture);
  for (const entry of Object.values(fixture.state.state.names))
    need(
      entry.key === nameKey(fixture.capabilities.registryId, entry.name),
      "PUBLIC_NAME_ID",
    );
  const files = ["index.html", "style.css", "app.js", "shared.js", "icon.svg"];
  for (const file of files)
    copyFileSync(join("reference-web", file), join(output, file));
  const policy =
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";
  const html = readFileSync(join(output, "index.html"), "utf8").replace(
    "<head>",
    '<head>\n<meta http-equiv="Content-Security-Policy" content="' +
      policy +
      '">',
  );
  writeFileSync(join(output, "index.html"), html);
  writeFileSync(
    join(output, "config.json"),
    JSON.stringify(
      {
        mode: "static-synthetic-demo",
        publicApiBase: null,
        files: {
          state: "./demo/state.json",
          capabilities: "./demo/capabilities.json",
          examples: "./demo/examples.json",
          details: "./demo/details.json",
        },
      },
      null,
      2,
    ) + "\n",
  );
  for (const key of ["state", "capabilities", "examples", "details"] as const)
    writeFileSync(
      join(output, "demo", key + ".json"),
      JSON.stringify(fixture[key], null, 2) + "\n",
    );
  writeFileSync(join(output, ".nojekyll"), "");
  const expected = new Set([...files, "config.json", "demo", ".nojekyll"]);
  need(
    readdirSync(output).every((f) => expected.has(f)),
    "UNEXPECTED_BUILD_ARTIFACT",
  );
  need(
    readdirSync(join(output, "demo")).every((f) =>
      [
        "state.json",
        "capabilities.json",
        "examples.json",
        "details.json",
      ].includes(f),
    ),
    "UNEXPECTED_BUILD_ARTIFACT",
  );
  for (const file of [
    ...files,
    "config.json",
    ".nojekyll",
    ...["state", "capabilities", "examples", "details"].map(
      (x) => "demo/" + x + ".json",
    ),
  ]) {
    const path = join(output, file);
    need(
      lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(),
      "ARTIFACT_LINK",
    );
    const bytes = readFileSync(path);
    need(bytes.length < 1000000, "ARTIFACT_SIZE");
    need(
      !/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{20}/.test(
        bytes.toString(),
      ),
      "PRIVATE_ARTIFACT",
    );
  }
  console.log(
    JSON.stringify(
      {
        status: "built",
        mode: "static-synthetic-demo",
        files: 11,
        names: Object.keys(fixture.state.state.names).length,
        actions: Object.keys(fixture.capabilities.actions).length,
        apiEndpoint: null,
        keysExported: false,
        output: "temporary-reference-test-only",
      },
      null,
      2,
    ),
  );

  return output;
}
