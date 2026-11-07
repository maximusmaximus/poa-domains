#!/usr/bin/env bash
set -euo pipefail
# Public verified release, temporary scanner only; no credentials or uploads.
version=8.30.1
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
base="https://github.com/gitleaks/gitleaks/releases/download/v${version}"
archive="gitleaks_${version}_linux_x64.tar.gz"
curl --fail --silent --show-error --location "$base/$archive" --output "$work/$archive"
curl --fail --silent --show-error --location "$base/gitleaks_${version}_checksums.txt" --output "$work/checksums.txt"
python3 - "$work" "$archive" <<'PY'
import hashlib,pathlib,sys,tarfile
root=pathlib.Path(sys.argv[1]); name=sys.argv[2]
expected=next(line.split()[0] for line in (root/'checksums.txt').read_text().splitlines() if line.endswith(name))
assert hashlib.sha256((root/name).read_bytes()).hexdigest()==expected
with tarfile.open(root/name) as archive:
 member=archive.getmember('gitleaks')
 assert member.isfile()
 with archive.extractfile(member) as source:
  (root/'gitleaks').write_bytes(source.read())
(root/'gitleaks').chmod(0o700)
PY
"$work/gitleaks" dir --no-banner --redact --config .gitleaks.toml .
"$work/gitleaks" git --no-banner --redact --config .gitleaks.toml --log-opts=--all .
