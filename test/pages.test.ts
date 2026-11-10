import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProductionBundle, PUBLIC_FILES, publicArtifactFiles } from "../src/pages-build.js";
import { productionStatus } from "../src/production.js";

test("production Pages allowlist publishes external Worker discovery but no fixture ledger, signer, local API or synthetic settlement", () => {
  const dir = mkdtempSync(join(tmpdir(), "poa-production-pages-test-"));
  try {
    mkdirSync(join(dir, "demo"));
    writeFileSync(join(dir, "demo/state.json"), '{"oldGeneratedFixture":true}');
    buildProductionBundle(dir);
    assert.deepEqual(publicArtifactFiles(dir), [...PUBLIC_FILES].sort());
    assert.equal(existsSync(join(dir, "demo")), false);
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, "status.json"), "utf8")),
      productionStatus(),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, "config.json"), "utf8")),
      {
        mode: "production-only",
        publicApiBase: null,
        statusFile: "./status.json",
      },
    );
    assert.equal(existsSync(join(dir,"network.json")),false);
    assert.equal(JSON.parse(readFileSync(join(dir,".well-known/agent.json"),"utf8")).url,"https://poadomains.grok.me");
    const app = readFileSync(join(dir, "app.js"), "utf8");
    assert.doesNotMatch(
      app,
      /shared\.js|\/v1\/|makeBody|generateKeyPair|fixtureConfig|localhost|127\.0\.0\.1|innerHTML|eval\(/,
    );
    assert.doesNotMatch(
      readFileSync(join(dir, "index.html"), "utf8"),
      /<form|<input|<select|<textarea/,
    );
    writeFileSync(join(dir, "unexpected.txt"), "not-a-generated-file");
    assert.throws(
      () => buildProductionBundle(dir),
      /UNEXPECTED_BUILD_ARTIFACT/,
    );
    assert.equal(existsSync(join(dir, "unexpected.txt")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
