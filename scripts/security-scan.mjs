import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  const body = fs.readFileSync(file, "utf8");
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
