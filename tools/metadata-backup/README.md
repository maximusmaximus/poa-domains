# POA local metadata backup tool

Offline utility; no live Pinata/IPFS/GitHub synchronization or native naming integration.
No gateway, IPFS node, account, credential, network, payment or transaction
integration is included. No real metadata is supplied or assumed.

## Requirements and capabilities

Python 3.10+ on Linux/POSIX; standard library only. Run `python3 poa_backup.py --help`.
Local preparation preserves metadata **exactly**, including whitespace and UTF-8
bytes. A manifest maps each stable name to its current CID and every imported
historical version, with SHA256, byte length and content-bound review evidence.
Blobs live at `objects/<sha256>.json`; the tool never overwrites a stored blob.
Repeated preparation rewrites no content when neither versions nor current pointers
change; it still synchronizes backup and parent directory entries.
Updates retain old versions and names not present in the new input. Historical
versions must be explicitly supplied to be imported: this tool cannot discover them.

## Use

Use trusted, private local working directories for metadata. Keep these
three items separate: a dedicated metadata source directory, an input index file,
and a review file. Source must contain exactly the indexed metadata files (no
index, hidden files, unrelated files, symlinks or special files). Parents of all
output paths must already exist. New review files must not exist. A new backup
path must not exist; subsequent preparation accepts only a fully valid backup.
Indexed source paths must not contain any component starting with a dot.
Source and output paths must not overlap.

1. Obtain the intended **existing** CID for each metadata version from your own
   reviewed records. `fingerprint` prints SHA256, byte length and a **candidate raw
   CID** for local bytes; it does not prove what CID any provider used:

   ```sh
   python3 poa_backup.py fingerprint --file work/source/your-file.json
   ```

   Do not replace an unsupported production CID with this computed raw CID and
   claim that the original was verified.

2. Write your own UTF-8 JSON input index. Its exact top-level fields are `format`
   (value `poa-metadata-input-v1`) and `entries` (nonempty array). Every entry has
   exactly `name` (stable name), `cid` (original supported CID), `file` (relative
   metadata path under source), and `current` (JSON boolean). No unknown fields.
   There must be exactly one `current: true` version per included name. Paths and
   name/CID pairs must be unique. An update can supply just the new current version
   of an existing name; previous versions remain in the backup. The index is not
   copied into the backup; local source filenames are not published there.

3. Prepare an **unapproved** per-content review template:

   ```sh
   python3 poa_backup.py review --index work/index.json \
     --source work/source --out work/review.json
   ```

   This checks schema and supported CID, but approves nothing. Manually inspect
   each exact metadata file, including private meaning that a scanner cannot know.
   Compare its fingerprint with that entry's `name`, `cid`, `sha256` and `size`.
   For **each individual entry** you actually approve, change `approved` to `true`,
   enter a neutral local `reviewer` label (1-40 letters/digits/underscore/hyphen,
   starting with letter/digit; no contact information), and set `attestation` to
   this exact text:

   > I reviewed these exact bytes and approve them as public-safe metadata; they contain no secrets, private plans, unsubmitted intents, service endpoints, or personal contact details.

   Do not change the identity/hash/size fields. No command auto-approves entries,
   no blanket safety flag is accepted, and every input entry must have exactly one
   matching attestation. Editing even whitespace in metadata changes its hash and
   requires a new CID and fresh exact-byte review. To reject an entry, do not approve
   it; preparation will refuse the whole input. The first stored review for an
   existing immutable version is retained rather than silently replaced.

4. Prepare, verify, and restore locally:

   ```sh
   python3 poa_backup.py prepare --index work/index.json \
     --source work/source --review work/review.json \
     --backup work/backup
   python3 poa_backup.py verify --backup work/backup
   python3 poa_backup.py restore --backup work/backup \
     --out work/restored
   python3 poa_backup.py verify --backup work/restored
   ```

   Restore requires a **nonexistent** destination. It exports the entire local
   backup-shaped directory, including current pointers, all retained history and
   original metadata blobs, and re-reads restored bytes to check size, SHA256,
   supported CID, schema and review consistency. Locate a version using
   `manifest.json` -> `payload.names` -> stable name -> `versions` -> CID ->
   `sha256`, then `objects/<sha256>.json`. No JSON metadata is rewritten, sanitized,
   renamed to a different CID, fetched or published. No provider availability is
   checked. Success means local validation, not public availability or redundancy.

Commands return 0 on success, 2 on rejection/failure, 130 on interruption. Error
messages omit input values, paths, metadata content and exception details.

## Supported CID and metadata schema

Only canonical lowercase unpadded **base32 CIDv1 / raw codec (0x55) / sha2-256
(0x12), 32-byte digest** is supported. Its digest is checked against original file
bytes. CIDv0, DAG-PB/UnixFS, DAG-CBOR, other encodings/codecs/hashes and noncanonical
encodings fail closed in review, prepare, verify and restore. SHA256 of JSON is
**not** a UnixFS root. No importer or DAG traversal is implemented; provider-default
UnixFS metadata may therefore be unsupported and cannot be approved by this tool.

Metadata is one strict UTF-8 JSON object. Duplicate keys, BOM, noninteger numbers,
NaN and unknown/ambiguous structures are rejected. The deliberately narrow schema:

- Required `name`: exactly the index stable name, 1-63 lowercase ASCII letters,
  digits or internal hyphens; no dot, slash, leading or trailing hyphen. This is a
  tool restriction, not an assertion about final protocol normalization policy.
- Optional `description`: 1-1024 printable ASCII characters, passing the heuristic
  safety screen. Newlines and other controls are not supported.
- Optional `image`: exactly `ipfs://` followed by a supported raw CID; no path,
  query, gateway or service endpoint. Referenced media is **not** fetched, reviewed
  or backed up; CID syntax alone says nothing about its safety or availability.
- Optional `attributes`: up to three unique objects, each with only `trait_type`
  and `value`. Allowed traits are `category` with `standard` or `premium`,
  `normalized_length` with an integer equal to the stable-name character count,
  and `network` with `POA`. Category is a supplied label, not a protocol policy check.

Arbitrary NFT extensions, contact fields, wallet/account/owner fields, links,
service endpoints, private plans and intents are not accepted schema extensions.
The prose screen rejects detectable credentials, secret keywords, private-plan
and intent keywords, web/service endpoints, emails, common phone/address patterns
and key-like strings. It intentionally produces false positives. **It cannot prove
public safety, detect every secret/contact/intent, interpret hidden private meaning,
or replace human review.** Never redact unsafe metadata under its original CID.
This utility refuses it instead. Stored review labels are local assertions, not
verified identities, signatures or authorizations to publish.

## Integrity and operational security

- The manifest checks its canonical payload SHA256, current/history references,
  each review's exact identity/hash/size, and every object's size, schema, SHA256
  and supported CID. Missing, extra/unreferenced and mismatched files are rejected.
  The checksum detects changes but is **not authentication**: an attacker able to
  replace both content and manifest/review can forge a consistent new backup.
  Keep trusted independent hashes/access controls when authenticity matters.
- Limits: 64 KiB per metadata blob; 2 MiB per index/review/manifest document;
  JSON nesting depth 16; 256 names; 512 retained versions; 1024 filesystem entries
  per walked directory tree; relative path length 512 and at most 8 components.
  No absolute source filenames, `..`, symlinks (including ancestors), hardlinked
  files, devices or FIFOs. Inputs must be stable while a command runs.
- Files are created with private permissions (0600, executable script 0700;
  directories 0700). No encryption is provided. Immutable means the **tool** never
  overwrites content-addressed blobs; the filesystem owner can still edit them,
  which verification detects unless all evidence is coherently forged.
- An advisory sibling `.<backup-name>.poa-lock` file serializes tool preparations.
  The empty lock file is intentionally retained outside the backup. All writers
  must honor it; do not run prepare/verify/restore concurrently or modify files
  externally during an operation. Descriptor-relative no-follow operations reduce
  path risks but are not a sandbox against hostile concurrent filesystem/mount
  manipulation or a compromised OS.
- Preparation writes blobs exclusively, synchronizes blob files and the objects
  directory, writes/synchronizes a temporary manifest, replaces the manifest, then
  synchronizes the backup directory and its parent directory. Restore synchronizes
  blob files, the objects directory, the new manifest file, the destination
  directory and its parent. Idempotent preparation synchronizes backup and parent
  directories without rewriting content. Synchronization errors are propagated;
  success is subject to local POSIX filesystem/kernel/hardware `fsync` semantics,
  not a power-loss guarantee or a statement about remote/provider storage.
- On a caught preparation failure, rollback is permitted **only** when a bounded
  re-read confirms the exact bytes of the previously validated manifest are still
  current. Only new, unreferenced candidate blobs and the attempt's temporary
  manifest are removed; old referenced blobs are never rollback candidates. A
  successful rename whose wrapper subsequently raises is recognized by the changed
  on-disk manifest, not a Python success flag: newly committed blobs are retained.
  Missing, unreadable or unexpected manifest state, and exclusive-create
  collisions, cause conservative preservation rather than destructive guesses.
  A new directory has no validated prior commit, so a failed attempt can remain
  partial. If cleanup itself fails or is interrupted, unreferenced files may remain.
- **Failure does not necessarily mean the commit failed.** An interruption or I/O
  error can occur after the manifest is committed, including during directory
  synchronization or before the caller receives an acknowledgement. The CLI still
  reports failure (2 or 130), never success on that error. Run `verify` before any
  retry; verification checks local bytes, not whether synchronization completed.
  If verification passes, retry preparation with the same reviewed input to finish
  directory synchronization without rewriting an already committed version. If
  verification fails, retain the original/evidence and stop for inspection rather
  than deleting blobs or automatically repairing the manifest.
- Power loss/process kill can leave an incomplete new directory, temporary file or
  unreferenced blob. A failed restore can leave partial output, or a complete local
  copy whose synchronization/acknowledgement failed. Verify before reuse; use a new
  restore destination after inspecting a failed attempt. There is no automatic
  repair, garbage collection, deletion of history or partial restore. No concurrent
  writer or hostile filesystem/mount manipulation is supported.

## Tests

Run from the directory containing `poa_backup.py` and `tests/`:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
```

The `tests/test_backup.py` suite contains 81 tests (the original 50 plus 31 v2 regressions). It creates synthetic metadata
only in temporary directories and deletes those through the test harness.
No real metadata, review approvals, backups, credentials or provider settings are
included as data assets.
