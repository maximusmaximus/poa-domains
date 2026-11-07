#!/usr/bin/env bash
set -euo pipefail
# Public verified release, temporary scanner only; no credentials or uploads.
version=8.30.1
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
base="https://github.com/gitleaks/gitleaks/releases/download/v${version}"
os=$(uname -s)
arch=$(uname -m)
case "$os:$arch" in
  Linux:x86_64|Linux:amd64) archive="gitleaks_${version}_linux_x64.tar.gz"; bin="gitleaks" ;;
  Linux:aarch64|Linux:arm64) archive="gitleaks_${version}_linux_arm64.tar.gz"; bin="gitleaks" ;;
  Darwin:x86_64|Darwin:amd64) archive="gitleaks_${version}_darwin_x64.tar.gz"; bin="gitleaks" ;;
  Darwin:arm64|Darwin:aarch64) archive="gitleaks_${version}_darwin_arm64.tar.gz"; bin="gitleaks" ;;
  MINGW*:x86_64|MSYS*:x86_64|CYGWIN*:x86_64) archive="gitleaks_${version}_windows_x64.zip"; bin="gitleaks.exe" ;;
  *) echo "Unsupported platform: $os:$arch" >&2; exit 1 ;;
esac
curl --fail --silent --show-error --location "$base/$archive" --output "$work/$archive"
curl --fail --silent --show-error --location "$base/gitleaks_${version}_checksums.txt" --output "$work/checksums.txt"
node --input-type=module - "$work" "$archive" "$bin" <<'JS'
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const [, , rawRoot, name, bin] = process.argv;
const root = process.platform === "win32" && rawRoot.startsWith("/")
  ? execFileSync("cygpath", ["-w", rawRoot], { encoding: "utf8" }).trim()
  : rawRoot;
const lines = fs.readFileSync(path.join(root, "checksums.txt"), "utf8").split(/\r?\n/);
const row = lines.find((line) => line.endsWith(name));
assert.ok(row, "Missing checksum entry for " + name);
const expected = row.trim().split(/\s+/)[0];
const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex");
assert.equal(actual, expected);
execFileSync("tar", [name.endsWith(".zip") ? "-xf" : "-xzf", path.join(root, name), "-C", root, bin]);
const target = path.join(root, bin);
assert.ok(fs.statSync(target).isFile());
fs.chmodSync(target, 0o700);
JS
"$work/$bin" dir --no-banner --redact --config .gitleaks.toml .
"$work/$bin" git --no-banner --redact --config .gitleaks.toml --log-opts=--all .

if [ -d _site ]; then
  "$work/$bin" dir --no-banner --redact --config .gitleaks.toml _site
fi
