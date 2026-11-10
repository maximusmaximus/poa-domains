import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const PINNED_BINARIES = new Map([
  [
    "reference-web/domain-emoji.a5ec1ef950064a71.woff2",
    "a5ec1ef950064a71a858b3844ed01e4b4fb6f4e0d286fbbc6dc39878d08d3b19",
  ],
  [
    "reference-web/XeroEmoji-COLRv1.woff2",
    "a5ec1ef950064a71a858b3844ed01e4b4fb6f4e0d286fbbc6dc39878d08d3b19",
  ],
]);
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const findings = [];
for (const file of new Set(files)) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  if (/(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:pem|key|p12|pfx|jwk))$/.test(file))
    findings.push({ file, rule: "credential-artifact" });
  if (file.endsWith(".woff2")) {
    const digest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex");
    if (PINNED_BINARIES.get(file) !== digest)
      findings.push({ file, rule: "unpinned-binary-artifact" });
    continue;
  }
  const body = fs.readFileSync(file, "utf8");
  if (body.includes("\r\n")) findings.push({ file, rule: "crlf-line-endings" });
  if (/^\.github\/workflows\/.+\.ya?ml$/.test(file)) {
    for (const line of body.split("\n")) {
      const m = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(line);
      if (m && !/@[0-9a-f]{40}$/.test(m[1]))
        findings.push({ file, rule: "unpinned-github-action" });
    }
  }
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=]{20}/.test(
      body,
    )
  )
    findings.push({ file, rule: "private-key-material" });
  if (new RegExp("https://cursor\\.com/" + "canvas/").test(body))
    findings.push({ file, rule: "private-document-link" });
  if (
    /\b(?:coming\x20soon|product\x20interview|private\x20product\x20roadmap)\b/i.test(
      body,
    )
  )
    findings.push({ file, rule: "private-or-unimplemented-material" });
}
// Never emit a discovered value, only a path and rule name.
console.log(
  JSON.stringify(
    {
      status: findings.length ? "failed" : "passed",
      files: new Set(files).size,
      findings,
    },
    null,
    2,
  ),
);
if (findings.length) process.exitCode = 1;
