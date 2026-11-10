# PoA Domains — Full-Stack Registry Application, Human Explorer & Native Read Guard

- **Primary Interactive Explorer**: https://poadomains.grok.me
- **GitHub Pages Mirror & Guard**: https://maximusmaximus.github.io/poa-domains/
- **Proof of Agent Mainnet**: https://minepoa.com · **Proof Floor**: https://poa.grok.me
- **Xero Emoji COLRv1 Font**: https://github.com/maximusmaximus/xeroemoji

> **Production hosting and local development:**
>
> - **Public GitHub Pages & Default Native-Chain Read Guard (`src/cli.ts`, `src/server.ts`, `src/mcp.ts`, `web/`)**: Strictly read-only status monitor and local Unicode 17 emoji spelling checker. **The upstream native naming registry is not yet enabled on the public chain; these native-chain guard entry points never simulate ownership or accept writes.**
> - **Production Worker**: `poadomains-registry` serves the explorer and Durable Object registry at https://poadomains.grok.me through the existing Grok Build proxy. Worker = production; Node/Docker = local development only. See [hosting](docs/cloudflare-hosting.md) and the [reviewed, escrow-preserving deployment gate](docs/worker-deploy.md). The registry retains `livePoA:false`; this is distinct from the separately enabled escrow service.
> - **Local Full-Stack Persistent Registry Application (`src/app.ts`, `src/reference-server.ts`, `src/reference-cli.ts`, `src/reference-mcp.ts`, `reference-web/`)**: Complete, deterministic, single-writer PoA Domains registry engine (`poa-mainnet-v1` profile) with fsynced journal persistence, `poa1...` Base58 Ed25519 principals, all **5,216 official Unicode 17 emoji sequences** rendered with the bundled emoji OpenType COLRv1 web font (`XeroEmoji-COLRv1.woff2`), **655 reserved root domains**, **`100,000 POA` (`100k POA`) single-emoji / `1,000 POA` (`1k POA`) multi-emoji mainnet-profile default minimum bid policy (the UI always reads capabilities)**, human domain availability search, multi-domain **Agent Bid & Purchase Cart** with copy-paste agent prompts, purchase/bid/settlement history, standing child & fixed-price resale offers, and an interactive 17-action handoff explorer.

---

## Table of Contents

1. [Quick Start — Launch the Full-Stack Registry Application](#1-quick-start--launch-the-full-stack-registry-application)
2. [Web Explorer UI & Human-to-Agent Cart Workflow](#2-web-explorer-ui--human-to-agent-cart-workflow)
3. [Domain Naming Rules, Tiers & Unicode 17 Emoji Canonicalization](#3-domain-naming-rules-tiers--unicode-17-emoji-canonicalization)
4. [Reserved Root Domains Catalog (655 Names)](#4-reserved-root-domains-catalog-655-names)
5. [17-Action State Machine, Pricing & Economic Invariants](#5-17-action-state-machine-pricing--economic-invariants)
6. [Principals, Signatures & Native `poa1` Cryptography](#6-principals-signatures--native-poa1-cryptography)
7. [Production Read-Only Entry Points & Public Pages Bundle](#7-production-read-only-entry-points--public-pages-bundle)
8. [Implemented Native Chain Read & Verification Components](#8-implemented-native-chain-read--verification-components)
9. [Verification & 12-Gate Test Suite](#9-verification--12-gate-test-suite)
10. [Actual Limitations & Security Boundaries](#10-actual-limitations--security-boundaries)
11. [Offline Metadata Backup Utility & Local Emoji Spelling Check](#11-offline-metadata-backup-utility--local-emoji-spelling-check)

---

## 1. Quick Start — Launch the Full-Stack Registry Application

The commands in this section run a **local development instance**, not the production Worker.

**Requirements:** Node.js `22.15+` (tested with Node 24) and a standard `curl` executable.

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run build
```

### Start the Persistent Registry Server & Web Explorer

```sh
npm run app
```

By default, `npm run app` initializes or replays the persistent journal in `local-data/registry` under the `poa-mainnet-v1` configuration profile (`chainId: "poa-mainnet-1"`, `"emoji17-full"` normalization with all 5,216 Unicode 17 emoji sequences, and 655 reserved root domains) and serves the Web Explorer and `/v1/*` HTTP API on `http://127.0.0.1:8787`.

On first boot, `src/app.ts` provisions local `poa1...` Base58 Ed25519 demo keys (`local-data/registry/keys/`), seeds initial root and child domains (`👩‍🦰`, `🫪.👩‍🦰`, `nexus`), opens a live ascending auction on `🌐`, publishes a multi-use standing child offer on `*.nexus`, and lists a fixed-price resale offer on `🫪.👩‍🦰`. Across subsequent restarts, the engine replays deterministically from `local-data/registry/journal.ndjson`.

### Query & Operate via the Registry CLI (`keygen`, `act`, `resolve`, `state`)

Errors use the [shared catalogue](docs/ERRORS.md). CLI exits: **2** usage, **3** rejected, **4** outcome unknown, **5** network. On exit 4, save `retry.body`, query the original receipt, and resend only those exact signed bytes—never a new request ID. No automatic write retries.

```sh
# 1. Generate a fresh poa1... Ed25519 agent keypair (receives 10,000,000 POA starter allocation on first action)
npm run app:cli -- keygen --out agent.pem

# 2. Check capabilities, normalization hash, and reserved root domain count
npm run app:cli -- capabilities --url http://127.0.0.1:8787

# 3. One-command agent execution (announce + bid on a single-emoji 100k POA domain, or mint a child domain)
npm run app:cli -- act --url http://127.0.0.1:8787 --key-file agent.pem --action "announceAuction+bid" --params '{"name":"🚀","asset":"POA","reserve":"100000","maxBid":"100000"}' --max-total 100000

# 4. Resolve an ASCII or Unicode 17 emoji domain
npm run app:cli -- resolve --url http://127.0.0.1:8787 --name nexus
npm run app:cli -- resolve --url http://127.0.0.1:8787 --name "🫪.👩‍🦰"

# 5. Inspect full committed registry state (deeds, auctions, offers, bids, receipts, credits, balances)
npm run app:cli -- state --url http://127.0.0.1:8787
```

### Local Development Container (not production)

```sh
docker compose up -d --build
```

For local development only, the included [`Dockerfile`](Dockerfile) and [`docker-compose.yml`](docker-compose.yml) run `node dist/src/app.js` bound to port `8787` with `/data/registry` mounted on a persistent Docker volume, `POA_DOMAINS_PUBLIC_URL=https://poadomains.grok.me`, and a built-in `/healthz` container healthcheck. That legacy public-URL label does not bind the production domain: do not expose this container as `poadomains.grok.me`. Production uses the Worker and its existing Durable Object, not this filesystem journal.

You can also launch an ephemeral in-memory demo instance with `npm run reference:demo` or run a custom persistent directory with `node dist/src/reference-cli.js serve --config PUBLIC_CONFIG.json --data /path/to/data --port 8787`.

---

## 2. Web Explorer UI & Human-to-Agent Cart Workflow

The Web Explorer (`reference-web/`) provides a complete, zero-framework, XSS-hardened interface for human users to inspect registry state, search domain availability, queue domains into a bid/purchase cart, and generate a copy-paste prompt for their AI agent.

The explorer labels hosted registry data, local registry data and synthetic demo data separately; native naming remains distinct from the live escrow service. Registry-read age appears on every tab in minutes/hours (My POA refreshes separately). A failed read keeps the last view with a visible error and pauses cart copying. Changed cart versions/minimums need **Review changed item**; expired offers, changed fixed prices or unavailable names must be removed and checked again. Polling never raises a spending cap or wipes a draft. Share a view with `?q=alpha&tab=auctions`.

### Human Domain Availability Search & Agent Bid/Purchase Cart

1. **Search Any Root or Child Domain (`#searchSection`)**:
   - Enter any ASCII domain (`nexus`, `alpha`, `builder.nexus`), `poa:`-prefixed label (`poa:quantum`), or Unicode 17 emoji sequence (`🌐`, `🚀`, `🫪.👩‍🦰`).
   - The explorer normalizes the input client-side against the active Unicode manifest (`140`-alias reference subset or all `5,216` Unicode 17 emoji sequences) and checks it against the 655-domain reserved catalog, active deeds, live ascending auctions, and standing offers.
   - Displays an immediate availability badge and breakdown:
     - **`AVAILABLE ROOT`**: Unclaimed root domain eligible for `openRootAuction` + `bid`, showing its tier and the active `/v1/capabilities` reserve/window policy. Mainnet-profile defaults are `100000` / `1000` POA base units; local fixture defaults are `1000` / `100`.
     - **`IN LIVE AUCTION`**: Active ascending auction showing current high bid, high bidder, minimum next valid bid (`>10%` increment or strict basis-point/minimum-unit step), phase (`announced`, `bidding`, `settled`), and end time.
     - **`STANDING CHILD OFFER` / `FIXED-PRICE RESALE`**: Active parent child offer (`acceptChildOffer`) or fixed-price deed listing (`buyFixed`) with exact price and remaining supply.
     - **`OWNED`**: Displays current owner principal, deed ID, version, rights (always `permanent`: owned forever, resale or transfer only), and whether a parent standing child offer is available.
     - **`RESERVED ROOT`**: Flags any of the 655 protected root domains (`RESERVED_NAME`) that cannot be opened for public auction.
2. **Add Domains to the Agent Bid & Purchase Cart (`#cartList`)**:
   - Click **Add to Agent Cart** from the search result card, from any live auction card (`Add minimum bid (N POA) to cart`), or from any standing offer card (`Add purchase to cart`).
   - Adjust your custom bid amount in `POA` directly inside the cart and confirm the real signer privately with your agent. The UI does not request a key or automatically sign.
3. **Copy or download Agent Cart Handoff v2**:
   - Both copy buttons and **📥 Download JSON** use one versioned, schema-validated plan with a human summary. The UI shows its age in minutes/hours.
   - Remote MCP first: `https://poadomains.grok.me/mcp`; CLI second. Verify the complete registry identity before using either, especially for local/demo carts.
   - The plan pins genesis, committed state sequence/hash, per-operation request IDs and exact spending caps per item and per asset. The capability reserve never changes when editing a max bid.
   - Quote → simulate → explicitly approved signed submission → receipt. A missing receipt is **UNKNOWN**, not failure; keep the exact original packet/requestId/nonce for a safe resend.
   - [Cart v2 contract, schema and retry rules](docs/AGENT-CART.md). The v2 UI is source-ready; it needs its own reviewed Worker release. `/mcp` itself is already live from the separately approved first release.

### Explorer Dashboard Sections

| Section                                        | DOM ID           | What It Represents                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Domain & Market Statistics**                 | `#stats`         | 8 live counters: Active Deeds, Owned Root/Child Names, Live Auctions, Standing Offers, Total Bids & Purchases, Volume Settled (`POA`), Active Escrow Locked (`POA`), and Reserved Root Names (`655`).                                                         |
| **Domain Search & Agent Cart**                 | `#searchSection` | Real-time availability lookup, quick-try domain pills, multi-domain bid/purchase cart, and one-click copyable Agent Prompt.                                                                                                                                   |
| **Owned Deeds & Records**                      | `#names`         | Every active root and child deed with owner, version, generation, rights (`permanent`, owned forever), protection badge, IPFS metadata title/CID, and typed records (`wallet`, `service`, `ipfs`).                                                                |
| **Ascending Auctions**                         | `#auctions`      | Every root auction with phase (`announced`, `bidding`, `settled`), funded status, high bid, high bidder, calculated **Minimum Next Bid**, closing time, and a one-click **Add bid to cart** button.                                                           |
| **Standing Child & Fixed-Price Resale Offers** | `#offers`        | Every open `child` offer (`createChildOffer`) and `fixed` resale listing (`sellFixed`) with price, remaining uses, seller principal, and one-click **Add purchase to cart**.                                                                    |
| **Purchase, Bid & Settlement History**         | `#history`       | Chronological log of all bids placed (sequence, bidder, amount, `LEADING` vs `OUTBID` badge) and all purchase/settlement/registration receipts (`bid`, `settleAuction`, `buyFixed`, `acceptChildOffer`, `openRootAuction`) with price paid and replay status. |
| **Escrow Refunds & Wallet Balances**           | `#balances`      | Per-principal withdrawable outbid escrow credits (`state.credits`, claimable via `withdrawRefund`) and synthetic wallet balances (`state.balances`).                                                                                                          |
| **17-Action Signed-Intent Handoff Builder**    | `#handoff`       | Interactive form for all 17 engine actions that validates parameters client-side, computes the exact SHA-256 intent digest, and outputs canonical unsigned JSON plus API/CLI/MCP submission instructions without ever touching private keys.                  |

---

## 3. Domain Naming Rules, Tiers & Unicode 17 Emoji Canonicalization

### Syntax & Hierarchy (`src/names.ts`)

- **Optional Prefix**: Input names may optionally start with `poa:` (e.g. `poa:nexus` or `poa:🌐`), which is stripped during canonicalization.
- **Hierarchy**: At most **2 labels** separated by `.` — a root domain (`alpha`, `👩‍🦰`) or a direct child domain (`agent.alpha`, `🫪.👩‍🦰`). Deeper subdomains (`a.b.c`) are rejected.
- **Token Composition**:
  - **ASCII Labels**: Lowercase `a–z` and `0–9` only (`1..32` characters). Uppercase ASCII is case-folded to lowercase; hyphens (`-`), underscores, spaces, and punycode prefixes (`xn--`) are rejected.
  - **Emoji Labels**: `1..32` canonical Unicode 17 emoji tokens per label with no mixing of ASCII and emoji within the same label.
- **Pricing, Minimum Bids & Duration Tiers (`poa-mainnet-v1` / `"emoji17-full"`)**:
  - **Single-Emoji Root (`1` emoji token — `premium` tier)**: Minimum opening bid / reserve price of **`100,000 POA` (`100k POA`)**; 24-hour minimum bidding window + 24-hour quiet-period extension window.
  - **Multi-Emoji Root (`2..32` emoji tokens) & ASCII Root (`1..32` characters) — `standard` tier**: Minimum opening bid / reserve price of **`1,000 POA` (`1k POA`)**; 1-hour minimum bidding window + 1-hour quiet-period extension window.
  - **Xero Emoji Typography**: All emoji sequences across the Web Explorer (`reference-web/XeroEmoji-COLRv1.woff2`) and stylesheet stack are rendered using **Xero Emoji** (`Xero Emoji` / `XeroEmoji` OpenType COLRv1 color vector font by Max Infeld, covering all 3,963 locked Xero Emoji glyphs with FE0F-aware OpenType GSUB ligatures).

### Unicode 17 Emoji Modes

1. **`"emoji17-full"` (`poa-mainnet-v1` default)**:
   - Supports all **5,216 non-component official Unicode 17.0 emoji sequences** (`Basic_Emoji`, `Emoji_Keycap_Sequence`, `RGI_Emoji_Modifier_Sequence`, `RGI_Emoji_Flag_Sequence`, `RGI_Emoji_Tag_Sequence`, `RGI_Emoji_ZWJ_Sequence`) from `web/emoji17-data.mjs`.
   - Enforces greedy longest-match segmentation and canonical FE0F qualification so visually identical variants normalize to a single canonical sequence and count as **1 token** toward the `1..32` label token limit.
   - Binds `EMOJI17_NORMALIZATION_HASH` (`8d50819c7fb167dc0f6c113785564044a75e8a64df55551a65392a22b0931d19`) into every signed intent.
2. **`"subset"` (`local-reference-v1` fixture mode)**:
   - Uses the deterministic 140-alias / 29-base-token reference subset (`NORMALIZATION_HASH`: `67274d3363fe554c6f9eb295dc02b2a4d5f88df1ec7400501b179de2140174f9`). See [docs/UNICODE.md](docs/UNICODE.md).

---

## 4. Reserved Root Domains Catalog (655 Names)

Defined in [`src/reserved.ts`](src/reserved.ts) and loaded into both `defaultConfig()` and `mainnetConfig()` in [`src/config.ts`](src/config.ts), the registry protects **655 root domains** from public root auction (`RESERVED_NAME` rejection on `openRootAuction`):

| Category                                      | Count | Examples                                                                                                                                                                                                                                 |
| --------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single-Character ASCII (`a`–`z`)**          | 26    | `a`, `b`, `c`, ..., `x`, `y`, `z`                                                                                                                                                                                                        |
| **Protocol, System, Network & Anti-Phishing** | 129   | `poa`, `minepoa`, `root`, `admin`, `validator`, `treasury`, `bridge`, `rpc`, `api`, `mcp`, `wallet`, `escrow`, `auction`, `dns`, `ipfs`, `http`, `https`, `www`, `security`, `support`, `official`, `login`, `auth`, `verify`            |
| **Top 500 Global Brand & Product Names**      | 500   | Major technology, AI, cloud, consumer, finance, automotive, media, retail, telecom, and Web3 brands (`google`, `apple`, `microsoft`, `openai`, `anthropic`, `nvidia`, `amazon`, `stripe`, `visa`, `bitcoin`, `ethereum`, `solana`, etc.) |

---

## 5. 17-Action State Machine, Pricing & Economic Invariants

All **17 state-mutating actions** in [`src/engine.ts`](src/engine.ts) execute atomically inside a single-writer deterministic state machine. Every mutation checks asset conservation (`sum(balances) + sum(credits) + sum(live_escrow) + sum(fees) == initial_supply`) before committing to the checksummed NDJSON journal:

| #   | Action                | Description & Key Rules                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `openRootAuction`     | Announces a root domain auction (`24h` announcement lead time) with an initial metadata witness. Rejects reserved or already-owned roots.                                                                                                                                                                                                      |
| 2   | `bid`                 | Places a fully funded ascending bid in `POA`. First bid must meet the reserve from `/v1/capabilities` (mainnet defaults: `100000` single emoji / `1000` standard; local fixture: `1000` / `100`); subsequent bids must meet the configured increment (`>10%` or strict basis-point/minimum-unit step). Immediately credits the previous high bidder's full escrow to `state.credits`. Bids during the quiet window extend `endsAt`. |
| 3   | `settleAuction`       | Permissionlessly settles a funded auction once `now >= endsAt`, transferring the root deed to `highBidder` and moving the winning bid to protocol fees.                                                                                                                                                                                        |
| 4   | `withdrawRefund`      | Withdraws accumulated outbid escrow credits (`state.credits[signer][asset]`) back to the signer's liquid balance (`state.balances`).                                                                                                                                                                                                           |
| 5   | `setRecords`          | Updates typed resolution records (`wallet`, `service` HTTPS URL, or `ipfs` CIDv1 URI) on an owned deed (`expectedDeedId`, `expectedVersion`).                                                                                                                                                                                                  |
| 6   | `setMetadata`         | Appends a new verified IPFS **CIDv1/base32/raw/sha2-256** canonical JSON metadata witness to the deed's append-only CID history.                                                                                                                                                                                                               |
| 7   | `transfer`            | Transfers a root or child deed to a `recipient` principal for `0` consideration, clearing any unfilled standing offers created by the prior owner.                                                                                                                                                                                             |
| 8   | `sellFixed`           | Lists an owned root or child deed for a fixed price in `POA` (optionally restricted to a targeted `buyer` principal).                                                                                                                                                                                                                          |
| 9   | `buyFixed`            | Purchases an active `sellFixed` offer for its exact price, transferring ownership atomically and crediting the seller.                                                                                                                                                                                                                         |
| 10  | `cancelOffer`         | Cancels an open `sellFixed` or `createChildOffer` listing created by the signer.                                                                                                                                                                                                                                                               |
| 11  | `createChildOffer`    | Parent owner creates a single-use or multi-use standing offer for child domains (`*.parent`) as `permanent` deeds (lease rights are refused).                                                                                                                                     |
| 12  | `acceptChildOffer`    | Mints or reallocates a child domain (`label.parent`) under an active parent standing child offer, paying the parent owner and locking protected child rights that survive parent transfers.                                                                                                                                                    |
| 13  | `renewChildLease`     | Off: names are owned forever, so renewals are refused (`PERMANENT_OWNERSHIP_ONLY`). |
| 14  | `retireChild`         | Consensually retires a child domain with both child owner and parent owner signatures (`coSigners`). Permanent retired paths remain permanently reserved.                                                                                                                                                                                      |
| 15  | `reclaimExpiredChild` | Off: names never expire (`PERMANENT_OWNERSHIP_ONLY`). |
| 16  | `setOperatorLock`     | Toggles an owner-controlled transfer/sale lock on a deed.                                                                                                                                                                                                                                                                                      |
| 17  | `anchorCheckpoint`    | Records a signed state-hash checkpoint anchor in registry history.                                                                                                                                                                                                                                                                             |

---

### MCP for hosted agents

The shared MCP core exposes nine typed registry tools, resources and prompts
over local stdio and stateless Streamable HTTP `/mcp`. **Production `/mcp` was
verified after Max's separately approved first gated deployment on November 9,
2026 (PST). Each later release still requires Max's separate approval.**
See [MCP contracts and tests](docs/MCP.md) and the [non-secret deployment policy](docs/worker-deploy.md#first-gated-mcp-deploy-non-secret-expected-policy).

### Read → quote → preview → submit

The Worker and local registry share `GET /v1/quote?name=NAME&action=ACTION`,
`POST /v1/intents/preview`, `/v1/time`, targeted name/auction/offer reads and
bounded auction/offer pages. Quotes bind current versions and derive prices;
fees are **included in** the gross price, not added to `maxTotal`. Preview takes
only a complete signed packet and never consumes a nonce, stores a receipt or
changes balances. It is not submission or permission to spend.

Default capabilities omit the large emoji tables. Request
`/v1/capabilities?include=emoji` when normalizing/rendering emoji names (the
explorer and local MCP adapter do this explicitly). CLI `act` now uses quotes
and targeted reads, never downloads state just to read the time, and re-quotes
before the bid in `announceAuction+bid`. Sellers still choose prices/validity;
recipients, records and spending choices are not invented.
See [the API planning contract](docs/API.md#quotes-previews-and-targeted-reads).

## 6. Principals, Signatures & Native `poa1` Cryptography

The registry supports two Ed25519 principal encodings in [`src/auth.ts`](src/auth.ts) and [`src/native-crypto.ts`](src/native-crypto.ts):

1. **Native PoA Principals (`poa1<base58-32-byte-ed25519-pubkey>`)**:
   - Generated via `nativePrincipal(publicKeyPem)` and used by default in `src/app.ts` (`poa-mainnet-v1`).
   - Supports both Base58-encoded and 128-hex-character Ed25519 signatures over the canonical intent digest (`poa-domains/intent-v1\n<canonical-json>`).
2. **Legacy Reference Principals (`ed25519:<64-lowercase-hex-pubkey>`)**:
   - Retained for full backward compatibility with the existing reference test suite and `local-reference-v1` fixtures.

Every signed intent binds `chainId`, `genesisHash`, `registryId`, `policyVersion`, `normalizationVersion`, `action`, `requestId`, `signer`, `coSigners`, `nonce`, `notBefore`, `deadline`, `maxTotal`, `maxNetworkFee`, and action-specific `params` (`expectedDeedId`, `expectedVersion`, `expectedGeneration`).

---

## 7. Production Read-Only Entry Points & Public Pages Bundle

**The upstream native naming registry is unavailable on the public chain. Default native-chain read-guard entry points (`src/cli.ts`, `src/server.ts`, `src/mcp.ts`) are strictly read-only guards.** The public site displays application availability and, when obtainable, an explicit current read-only observation of the official native node. It does not display simulated ownership, balances, auctions, records or transaction receipts, and has no signing or transaction handoff form.

The default CLI, API and MCP never initialize a reference ledger, read supplied key/configuration files, accept a caller-selected provider, or fall back to test data. Explicit native reads contact only the documented public node; they do not enable naming. There is no flag, credential, environment switch or endpoint override that enables registry operations on the read-only guard surface.

```sh
node dist/src/cli.js status         # availability metadata; operational:false
node dist/src/cli.js ready          # unavailable; exits 1
node dist/src/cli.js native-network # real public status + engine/parameter hashes
node dist/src/cli.js native-receipt --id TXID # reported native receipt, not finality
node dist/src/cli.js mcp            # stdio; registry_status/native_network/native_receipt
npm start                           # read-only API on http://127.0.0.1:8787
```

The read-only API (`npm start`) has no ownership or settlement backend:

| Path                                     | Current behavior                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `GET /healthz`                           | HTTP 200, process alive, `registryReady:false`                                |
| `GET /readyz`                            | HTTP 503, `NATIVE_NAMING_UNAVAILABLE`                                         |
| `GET /v1/status`, `GET /v1/capabilities` | Availability metadata, `operational:false`, empty native actions, no backend  |
| `GET /v1/native/network`                 | Public node report; HTTP 502 on invalid/unavailable data, no fixture fallback |
| `GET /v1/native/receipts/TXID`           | Reported native receipt; unknown never authorizes retry or finality           |
| Registry reads and writes under `/v1/`   | HTTP 503, `accepted:false`, `submitted:false`, no state or receipt            |

Production CLI signing, preparation, handoffs, submission, state/receipt/nonce/resolve/export commands are rejected. Supplied `--config`/`--data` are rejected without file access. Supplied provider URLs and key/input/output paths do not enable processing. Status metadata is not a live network probe; process liveness is not registry readiness.

`npm run pages:build` emits a sixteen-file bundle of public assets into `_site/`. The builder imports no fixture generator or reference engine. The browser validates relative configuration/status JSON, then reads only the two fixed official-node status and network-facts URLs. It rejects demo modes, backend overrides, forged ready flags and extra ledger fields. Prior generated demo files are removed during a validated rebuild; unexpected artifacts or symlinks fail the build. GitHub Pages hosts no `/v1` API.

---

## 8. Implemented Native Chain Read & Verification Components

- Fixed documented, chain-scoped public HTTPS reads from `https://minepoa.com/chain/poa-mainnet-1/api/status`, `network-facts` and `receipt/TXID`. No authentication or writes. **Node 22.15+ and a standard `curl` executable are required.** The curl subprocess disables configuration, follows no redirects, and receives only an explicit PATH/LANG environment, never inherited credentials. Timeout/body/concurrency limits and strict field/duplicate-key validation fail closed.
- API/CLI/MCP expose the same native read capabilities. API observations coalesce/cache for at most 10 seconds. Chain mismatch, inconsistent epoch/quorum fields, future checkpoints and invalid provenance hashes are rejected. Process-memory monitoring latches observed checkpoint rollback, epoch rollback or engine/parameter hash drift. This is not a consensus/reorg detector and the baseline is not persisted across restart.
- `src/native-crypto.ts` implements the native sorted-JSON/SHA-256/Base58/Ed25519 wire subset. `verifyNativeEnvelope` checks the expected transaction hash and chain-bound signature, **not** replay validity, balance, nonce availability, PoW, adoption or finality. A library-only transfer signer accepts an explicit caller callback, decimal-string amount, nonce, parents, timestamp and chain; it loads no keys and broadcasts nothing. It supports only the documented transfer-body subset, never naming transactions; the default CLI/API/MCP expose no signing operation.
- Checkpoint signature-bundle verification requires caller-supplied expected root/height, trusted public signers and threshold. Quorum does **not** establish root computation, network binding, external anchors or finality. The upstream checkpoint-signature body has no chain ID. No unapproved signer set or threshold is selected.
- The browser reads the official node when opened or explicitly refreshed, with bounded bodies, request deadlines, strict parsing and process-memory incident detection. Duplicate refreshes coalesce; failures clear displayed values without a snapshot fallback. Observations expire after 15 minutes. The builder retains a compatibility observation document, but the browser does not consume it. The sixteen-file bundle contains no fixture ledger. An observed native ledger is not an operational naming registry.

[Exact upstream interfaces and verification boundaries](docs/NATIVE.md).

---

## 9. Verification & 12-Gate Test Suite

Node 22.15+ is required (tested with Node 24). CI uses Ubuntu 24.04 and locked dependencies.

```sh
npm run check
bash scripts/gitleaks.sh
npm run native:smoke # explicit GET-only public-network smoke; requires node availability
```

`npm run check` runs all 12 verification gates sequentially:

1. `security:scan` — verifies LF line endings, pinned GitHub Action SHAs, zero secret/key artifacts, and no forbidden placeholder phrases.
2. `build` — compiles TypeScript (`src/` and `test/`) with strict typechecking.
3. `metadata:check` — runs the Python offline metadata backup test suite (`tools/metadata-backup/`).
4. `unicode:audit` — audits the pinned Unicode 17 emoji table (`5,216` sequences) against upstream provenance hashes.
5. `test` — runs all unit, integration, cryptographic, state-machine, journal persistence, and full-stack registry app tests (`test/core.test.ts` & `test/production.test.ts`).
6. `smoke` — runs the production read-only CLI/API/MCP guard smoke check.
7. `reference:smoke` — runs the end-to-end 17-action reference engine + headless Playwright browser smoke check (`test/browser.ts`).
8. `pages:build` — builds and verifies the 15-file `_site/` public Pages bundle.
9. `pages:verify` — runs headless Playwright verification against the public Pages bundle.
10. `reference:pages:verify` — builds and verifies the static reference explorer bundle in headless Chromium (`test/reference-pages-browser.ts`), including domain search, Agent Cart prompt generation, standing offers, and purchase/bid history.
11. `format:check` — verifies Prettier formatting across all files.
12. `audit:deps` — verifies zero npm security advisories.

Tests use ephemeral unfunded keys and synthetic fixtures only where explicitly testing the reference engine; no real PoA state is changed. [Test details](docs/TESTING.md).

---

## 10. Actual Limitations & Security Boundaries

This independently runnable reference and local registry application is **not a native PoA consensus extension or adopted on-chain naming/NFT protocol**, has no consensus/ingress proof or adopted naming transaction adapter, and is not safe for real assets. There is no external-chain settlement, bridge, oracle, custody service, identity linking, arbitration/dispute mechanism, post-bid outage cancellation or key recovery. Such actions are absent/unsupported, not administratively improvised.

The journal replays the complete history; there is no checkpoint acceleration, horizontal writer coordination or authenticated public resolver proof. Filesystem integrity and the local operator/clock are trusted. A stale writer lock after a crash requires operator verification/recovery, not automatic lock stealing. State growth and public reads are not production-scale DoS defenses. UI state can be stale: `asOf` and sequence describe the last local commit, not elapsed wall time or chain finality.

Unicode coverage and CID codec support are intentionally explicit. Ownership is permanent: there are no leases, renewals or expiry, and names change hands only by resale or transfer. Emoji spellings in the same ownership class count as one name. Consensual retirement cannot add or alter encumbrances while the parent is auction-locked. No full economic simulation, native-chain integration test or independent security audit is claimed.

### Publication and Security

CI has contents-read permission. The main-only Pages workflow checks production guards and all reference tests in a sanitized environment, uploads only `_site/`, and grants Pages-write/OIDC-write only to the separate official deployment action. Those read-only guard and Pages checks use no treasury configuration or signing credentials. The separate Worker deployment workflow is disarmed by default; it requires green main CI, Max’s production-environment review, a Cloudflare API token and exact public live-policy validation. Existing Cloudflare secret bindings are preserved, never downloaded. See [the deployment gate](docs/worker-deploy.md).

[API boundaries](docs/API.md) · [Security](SECURITY.md) · [Unicode subset](docs/UNICODE.md)

No project-wide license has been selected; vendored Unicode data carries its own license.

---

## 11. Offline Metadata Backup Utility & Local Emoji Spelling Check

### Offline Metadata Backup Utility

The local Python utility in `tools/metadata-backup/` prepares and verifies exact-byte, individually reviewed metadata backups, retains imported history, and restores files locally. Run `npm run metadata:check` for its tests; they are also included in `npm run check`. Usage and security limitations are documented in [the utility README](tools/metadata-backup/README.md).

This utility supports only canonical base32 CIDv1 raw sha2-256 metadata and its deliberately narrow ASCII schema; UnixFS/DAG and the production emoji namespace are not supported by this utility. No real metadata is bundled. It does not fetch, pin, publish, synchronize GitHub backups, or enable native naming or settlement.

### Local Emoji Spelling Check

The read-only web checker recognizes exact emoji-only Unicode 17 spellings and counts 1–32 whole emoji sequences. It runs locally with fixed options and does not transmit, persist, trim or normalize the entered spelling. Results describe format only, not name availability, ownership, pricing or registration. Native registry operations remain disabled. The bundle contains only the pinned public Unicode runtime, data, license and source provenance plus the checker module and external stylesheet; candidate equivalence data is not included.
