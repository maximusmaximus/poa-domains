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
    const html = readFileSync(join(dir, "index.html"), "utf8");
    assert.match(html, /<title>PoA domains — emoji names and agent tools<\/title>/);
    assert.match(html, /<meta name="description" content="[^"\n]+"/);
    for (const property of ["type", "title", "description", "url", "image"]) assert.match(html, new RegExp(`<meta property="og:${property}" content="[^"\n]+"`));
    assert.match(html, /<link rel="canonical" href="https:\/\/maximusmaximus.github.io\/poa-domains\/"/);
    assert.match(html, /class="hero-cta" href="https:\/\/poadomains.grok.me"/);
    assert.match(html, /<p id="status">Checking…<\/p>/);
    assert.match(html, /<p id="network-status">Checking…<\/p>/);
    assert.match(html, /<button id="refresh" type="button" disabled>/);
    assert.match(html, /<dl id="network-details"><\/dl>/);
    assert.match(html, /<table class="availability-table">/);
    assert.match(html, /Native on-chain registration, ownership and settlement are not verified/);
    assert.match(html, /Safety checks can hold payments/);
    assert.doesNotMatch(html, /xero\s*emoji|roadmap|coming\s+soon|future\s+plans/i);
    const footer = /<footer>([\s\S]*?)<\/footer>/.exec(html)![1]!.replace(/<[^>]+>/g, "").trim();
    assert.equal(footer, "made with ❤️ in SF by Tesselate Army | maxi.grok.me");
    assert.equal(readFileSync(join(dir, "robots.txt"), "utf8"), "User-agent: *\nAllow: /poa-domains/\nSitemap: https://maximusmaximus.github.io/poa-domains/sitemap.xml\n");
    assert.match(readFileSync(join(dir, "sitemap.xml"), "utf8"), /<loc>https:\/\/maximusmaximus.github.io\/poa-domains\/<\/loc>/);
    assert.doesNotMatch(app, /timeZone:\s*["']/);
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


test("Pages explicit incident recovery matches every unchanged strict-reader incident code", () => {
  const codes = (file: string, name: string) => {
    const body = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(readFileSync(file, "utf8"))![1]!;
    return [...body.matchAll(/["']([A-Z_]+)["']/g)].map(match => match[1]).sort();
  };
  assert.deepEqual(codes("web/app.js", "INCIDENT_CODES"), codes("web/live-network.js", "INCIDENTS"));
  const app = readFileSync("web/app.js", "utf8");
  assert.match(app, /if \(refreshFlight\) return refreshFlight;\s*if \(userRequested && readerNeedsRestart\)/);
  assert.match(app, /addEventListener\("click", \(\) => refresh\(true\)\)/);
});
