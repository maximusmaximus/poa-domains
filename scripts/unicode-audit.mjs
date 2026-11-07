import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const raw = fs.readFileSync("vendor/unicode/emoji-test.txt");
const manifest = JSON.parse(
  fs.readFileSync("vendor/unicode/manifest.json", "utf8"),
);
assert.equal(
  crypto.createHash("sha256").update(raw).digest("hex"),
  manifest.sourceSha256,
);
assert.match(raw.toString(), /# Version: 17\.0/);
const reference = new Map();
let fullyQualified = 0;
for (const line of raw.toString().split("\n")) {
  if (line.startsWith("#") || !line.includes(";")) continue;
  const [cp, status] = line.split("#")[0].split(";");
  const sequence = String.fromCodePoint(
    ...cp
      .trim()
      .split(/\s+/)
      .map((x) => parseInt(x, 16)),
  );
  reference.set(sequence, status.trim());
  if (status.trim() === "fully-qualified") fullyQualified++;
}
const seen = new Set(),
  bases = new Set();
for (const a of manifest.aliases) {
  assert.ok(reference.has(a.input));
  assert.notEqual(reference.get(a.input), "component");
  assert.equal(reference.get(a.canonical), "fully-qualified");
  assert.ok(!seen.has(a.input));
  seen.add(a.input);
  bases.add(a.token);
  assert.equal(
    a.token,
    "u" + [...a.canonical].map((x) => x.codePointAt(0).toString(16)).join("-"),
  );
  assert.ok(
    manifest.aliases.some(
      (x) => x.input === a.canonical && x.canonical === a.canonical,
    ),
  );
}
assert.ok(
  fs.readFileSync("vendor/unicode/LICENSE.txt", "utf8").includes("UNICODE"),
);
console.log(
  JSON.stringify(
    {
      status: "passed",
      unicodeVersion: manifest.unicodeVersion,
      sourceSha256: manifest.sourceSha256,
      officialFullyQualifiedSequences: fullyQualified,
      supportedAliases: seen.size,
      supportedBaseTokens: bases.size,
      scope:
        "explicit supported subset only; NOT full emoji repertoire or artwork audit",
    },
    null,
    2,
  ),
);
