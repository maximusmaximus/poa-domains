# CI contract

`native-and-reference-checks` runs on PRs, manual dispatch, and pushes to `main`
only. A concurrency group cancels superseded runs for the same PR/ref. The
required ruleset context remains exactly `check`; it rejects failed, cancelled,
or skipped dependencies before combining coverage.

The build job compiles once on Node 22.15.0, emits source maps, builds the public
Pages allowlist and prepares local Cloudflare test bundles. `dist/`, `_site/`
and `cloudflare/generated/` travel together in the short-lived `compiled`
artifact (including the allowlisted `.nojekyll` file). Unit, browser, Cloudflare, escrow-local, and security lanes consume
that artifact, each tested on Node 22.15.0 and Node 24. No lane recompiles it.
Playwright binaries are cached by OS, job family and lockfile; system packages
are installed even on cache hits. Every checkout disables persisted credentials.
No CI job deploys a Worker or uses Cloudflare credentials.
Existing escrow source, tests, config, and `scripts/test-escrow.mjs` are unchanged;
`scripts/ci-bundles.mjs` only prepares source-mapped test bundles for CI.

## Local commands

- `npm run check`: build once, then run the existing unit, smoke, browser,
  metadata, Unicode, and security checks without repeated TypeScript builds.
- `npm run test:coverage`: build once, run all eight CI suites (including local
  workerd/recovery and the complete mock escrow/browser suites), combine coverage
  and enforce the same thresholds. Install all three Playwright engines first.
- `node scripts/ci.mjs <suite>`: run a lane against an existing build, recording
  its raw coverage and completion manifest under `.coverage/`.

## Coverage gate

The gate requires a successful completion manifest and nonempty V8 data from
**every suite on both Node versions**. It merges V8 process coverage, follows
TypeScript and inline escrow bundle source maps, and reports lines and branches
in the Actions job summary and `coverage-report` artifact. `--all` includes
unloaded source files as zero, rather than hiding untested modules. Tests,
declarations, and generated Unicode data are not production coverage targets.
The configuration in `.c8rc.json` enforces 70% lines and 80% branches. A regression
test exercises real c8 rejection for an uncovered branch and insufficient lines.
The report also fails if key TypeScript, Cloudflare escrow, and `.mjs` source
maps disappear. Raw coverage is never included in Pages.

V8 coverage measures **Node execution**, including `.mjs` suites, source-mapped
escrow units and the Node side of `cloudflare/test` integration suites. It does
not claim to measure JavaScript running inside browser engines or workerd.
Unmeasured production files remain zero in the denominator; those integration
assertions independently gate `check`. The committed transitive overrides keep
the coverage tool's glob/minimatch dependencies on patched versions compatible
with the supported Node baseline.

## Reproducible Pages artifact

The Pages CLI build uses the deterministic `NOT_OBSERVED` fallback already used
by `buildProductionBundle()`. It performs no network observation and never bakes
a stale live response or timestamp into the output. Runtime network reads stay
unchanged. A test disables fetch, HTTP(S), TCP and TLS and compares every emitted
file's hash across two CLI builds. The existing allowlist/secret guards remain.
