# Static public landing page

The GitHub Pages site points people to the production Worker Explorer at
https://poadomains.grok.me. Its table describes current tools only: the Explorer,
agent cart, HTTP MCP and enabled escrow. Escrow may be held by its existing
freshness checks; My POA shows current payment availability. Native registry
ownership and settlement remain unverified. Explorer data is not ownership proof.

The landing page is static files. It never connects to registry APIs, signs,
accepts keys or signed packets, or sends payments. The optional spelling checker
stays local and unchanged. Its native-registry warning does not describe the
Worker's separate escrow service.

The existing browser-only public-node check still uses just the two fixed,
read-only minepoa URLs allowed by CSP. The build itself makes no network read.
Loading says “Checking…” and disables refresh. Valid readings appear as a
semantic definition list with the visitor's local date, hour, minute and timezone;
no server timezone or seconds are imposed. Errors clear every old value and
explain how to retry. Readings expire after 15 minutes.

The strict reader is unchanged: an incident still latches that reader instance.
Only an explicit user refresh after the display clears an incident creates a new
Pages-only reader and fetches a new status/facts pair. Ordinary refreshes retain
checkpoint/hash continuity checks. A fresh unverified reading is not proof of
consensus, finality, ownership or native registry readiness. This reset has no
effect on the Worker's live reads or escrow reconciliation.

The static HTML carries description, Open Graph metadata and a self-canonical
URL. The allowlisted sitemap and robots file are published under /poa-domains/.
A project-site robots.txt is not the origin-root robots.txt; it cannot set
host-wide crawler rules. The sitemap URL can be submitted separately.

Tests cover metadata, exact footer, current copy, initial loading, semantic
visitor-local times, transient failures and explicit incident recovery, keeping
all GET-only, CSP, no-signing, no-stale-fallback and spelling-isolation checks.
No Worker, escrow, deployment configuration or secret is changed by this page.

The publisher archives exactly the already-tested `PUBLIC_FILES` allowlist,
including `.well-known/agent.json` and `.nojekyll`, then uploads `artifact.tar`
with the standard pinned artifact uploader. The pinned Pages wrapper's generic
dot-file exclusion is deliberately not used. Unknown files, symlinks and
hardlinks fail closed; this does not enable arbitrary hidden files. Tests inspect
the actual tar entries and bytes, not just the staging directory.

The archive uses `./`-prefixed member paths, as required by the Pages server
validator (actions/deploy-pages#203). A regression checks the actual TAR paths,
not just successful local extraction; unprefixed archives extract locally but
are rejected during publication.

The server also requires a supported archive, not merely extractable content.
Use the official uploader's GNU directory archive structure, with only regular
files/directories and minimum public read/traverse permissions. The helper first
validates every file AND directory, rejects links, then archives that sealed root.
The regression walks physical 512-byte headers, including metadata records that
`tar --list` suppresses; POSIX PAX extension records are not emitted.
