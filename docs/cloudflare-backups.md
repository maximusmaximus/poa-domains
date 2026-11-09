# Registry backups (Cloudflare R2)

The Worker `poadomains-registry` backs up the registry Durable Object to the **private**
R2 bucket `poadomains-registry-backups` (no public bucket access, no r2.dev URL, no custom
domain). Nothing in the bucket is served by the explorer.

## What is in a backup

The Durable Object stores two tables:

| Table | Contents | Sensitivity | In the backup as |
|---|---|---|---|
| `journal` | Hash-chained, signed registry commits (names, offers, auctions, balances) | Public | Plaintext |
| `bootstrap` | Immutable config, policy hash, five role principals | Public | Plaintext |
| `bootstrap.keys` | Ed25519 private keys for the issuer, treasury and showcase roles | **Secret** | Encrypted envelope only |

Role keys are encrypted inside the Durable Object before they leave it:
a fresh AES-256-GCM key encrypts them (additional data binds the policy hash, head sequence,
state hash and journal head), and that AES key is wrapped with RSA-OAEP-4096/SHA-256 to the
public key in `BACKUP_PUBLIC_KEY_SPKI`. The matching private key is held offline by the
operator; it is not stored in R2, in the Worker or in this repository. If the public key is
missing the export fails; there is no plaintext fallback.

## Format and checksums

Each object is JSON, format `poadomains-registry-backup/v1`, containing `head`
(`sequence`, `stateHash`, `journalHead`), the full `journal`, `journalSha256`,
`integrity.contentSha256` (SHA-256 of the canonical content) and the secret envelope.
The object is written with R2's server-verified `sha256`, and custom metadata records
`sha256`, `sequence`, `stateHash`, `kind` and `createdAt`. Keys are immutable and sortable:

```
v1/<hourly|daily|manual>/YYYY/MM/DD/<ISO time>-seq<9-digit sequence>-<first 16 hex of sha256>.json
v1/latest-<kind>.json   # metadata pointer only (key, size, sha256, sequence)
```

## Schedule and retention

| Kind | Trigger | Retention (R2 lifecycle rule on the prefix) |
|---|---|---|
| hourly | Cron `17 * * * *` | 2 days |
| daily | Cron `47 8 * * *` (00:47 Pacific standard time) | 30 days |
| manual | `POST /v1/admin/backup` | 90 days |

`POST /v1/admin/backup` requires `Authorization: Bearer <BACKUP_ADMIN_TOKEN>` (Worker secret)
and rejects browser-origin requests. Without a valid token it answers 404. It returns only
metadata (key, size, sha256, sequence), never backup contents. Helper:
`npm run backup:now` (reads the token from a local file, never from arguments).

## Restore (isolated only)

```sh
npm run backup:restore -- --key v1/daily/2026/11/09/<object>.json
```

The script downloads the object, checks its SHA-256 (against the key suffix and optional
`--expect-sha256`), verifies structure and checksums, decrypts the role keys locally,
starts a separate local `wrangler dev` on fresh temporary storage with
`BACKUP_RESTORE_ENABLED=local-only`, restores into a new Durable Object named
`restore-<time>`, replays and validates every signature and hash-chain link, and compares
the restored head sequence, state hash, journal head and principals with the backup. The
temporary storage is deleted afterwards. The restore route does not exist on the deployed
Worker, and the Durable Object refuses to restore into the live singleton.

Tests: `npm test` (codec, tamper and plaintext-key checks) and `npm run cf:test:backup`
(local workerd + local R2: admin guard, manual and scheduled backups, isolated restore,
tamper rejection).
