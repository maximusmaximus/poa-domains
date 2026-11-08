#!/usr/bin/env python3
"""Offline, fail-closed exact-byte metadata backup utility. Python 3.10+, POSIX."""
import argparse
import base64
import copy
import fcntl
import hashlib
import json
import os
import re
import secrets
import stat
import sys
from contextlib import contextmanager

MAX_METADATA = 65536
MAX_DOCUMENT = 2 * 1024 * 1024
MAX_ENTRIES = 512
MAX_NAMES = 256
MAX_FILES = 1024
MAX_DEPTH = 16
MAX_PATH_DEPTH = 8
INPUT_FORMAT = 'poa-metadata-input-v1'
REVIEW_FORMAT = 'poa-metadata-review-v1'
BACKUP_FORMAT = 'poa-metadata-backup-v1'
ATTESTATION = ('I reviewed these exact bytes and approve them as public-safe metadata; '
               'they contain no secrets, private plans, unsubmitted intents, service '
               'endpoints, or personal contact details.')
NAME = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z')
SHA = re.compile(r'[0-9a-f]{64}\Z')
COMPONENT = re.compile(r'[A-Za-z0-9_.-]{1,128}\Z')
REVIEWER = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,39}\Z')
UNSAFE = re.compile(
    r'(?i)(https?://|wss?://|ftp://|localhost|www\.|'
    r'\b(?:api[ _-]?key|secret|password|bearer|token|private[ _-]?key|'
    r'seed[ _-]?phrase|mnemonic|confidential|internal|private|unannounced|'
    r'unsubmitted|intent|roadmap)\b|'
    r'\b(?:launch|auction|bid|reserve)[ _-]+plan\b|'
    r'\b(?:sk|pk)[_-][A-Za-z0-9_-]{8,}|'
    r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|'
    r'\b(?:\d{1,3}\.){3}\d{1,3}\b|'
    r'\b(?:[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?\.)+[A-Z]{2,63}\b|'
    r'\b(?:contact|phone|e-?mail|address|ssn|dob)\b|'
    r'\b\d{1,6}\s+(?:[A-Z0-9]+\s+){0,5}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct|way)\b|'
    r'\b0x[0-9a-f]{40,}\b|'
    r'\+?\d[\d ()-]{7,}\d|'
    r'\b[A-Za-z0-9_+/-]{40,}={0,2}\b)')


class Rejected(Exception):
    """All messages are constant, never interpolated input."""


def reject(message='input rejected (details omitted)'):
    raise Rejected(message)


def exact_keys(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        reject('invalid or unknown document fields')


def integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        reject('integer outside supported bounds')


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('ascii')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def raw_cid(data):
    return 'b' + base64.b32encode(b'\x01\x55\x12\x20' + hashlib.sha256(data).digest()).decode('ascii').lower().rstrip('=')


def cid_hash(cid):
    if not isinstance(cid, str) or not re.fullmatch(r'b[a-z2-7]{1,120}', cid):
        reject('CID must be canonical lowercase base32 CIDv1')
    encoded = cid[1:]
    try:
        decoded = base64.b32decode(encoded.upper() + '=' * (-len(encoded) % 8))
    except (ValueError, base64.binascii.Error):
        reject('malformed CID encoding')
    if 'b' + base64.b32encode(decoded).decode('ascii').lower().rstrip('=') != cid:
        reject('noncanonical CID encoding')
    # These are canonical unsigned varints: v1, raw codec, sha2-256, 32 bytes.
    # No UnixFS/DAG importer assumptions are made.
    if len(decoded) != 36 or decoded[:4] != b'\x01\x55\x12\x20':
        reject('unsupported CID: only CIDv1 raw sha2-256 is verifiable')
    return decoded[4:].hex()


def checked_cid(cid, data):
    if cid_hash(cid) != digest(data) or raw_cid(data) != cid:
        reject('CID or content hash mismatch')


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            reject('duplicate JSON keys')
        result[key] = value
    return result


def _no_number(_):
    reject('noninteger JSON numbers are not supported')


def load_json(data, maximum=MAX_DOCUMENT):
    if len(data) > maximum:
        reject('document size limit exceeded')
    try:
        text = data.decode('utf-8', 'strict')
    except UnicodeError:
        reject('JSON must use strict UTF-8')
    depth, quoted, escaped = 0, False, False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in '[{':
            depth += 1
            if depth > MAX_DEPTH:
                reject('JSON depth limit exceeded')
        elif char in ']}':
            depth -= 1
            if depth < 0:
                reject('invalid JSON structure')
    try:
        return json.loads(text, object_pairs_hook=_pairs, parse_float=_no_number,
                          parse_constant=_no_number)
    except (ValueError, RecursionError):
        reject('invalid JSON (content omitted)')


def stable_name(value):
    if not isinstance(value, str) or not NAME.fullmatch(value):
        reject('unsupported stable-name format')


def public_prose(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 1024:
        reject('unsupported public description')
    if any(ord(c) < 32 or ord(c) > 126 for c in value) or UNSAFE.search(value):
        reject('metadata safety screen rejected content')


def metadata(data, name):
    stable_name(name)
    value = load_json(data, MAX_METADATA)
    if not isinstance(value, dict) or not {'name'} <= set(value) <= {'name', 'description', 'image', 'attributes'}:
        reject('metadata schema is unknown or ambiguous')
    if value['name'] != name:
        reject('metadata name does not match stable identity')
    if 'description' in value:
        public_prose(value['description'])
    if 'image' in value:
        image = value['image']
        if not isinstance(image, str) or not image.startswith('ipfs://'):
            reject('only direct raw-CID IPFS image references are supported')
        cid_hash(image[7:])
    if 'attributes' in value:
        attributes = value['attributes']
        if not isinstance(attributes, list) or len(attributes) > 3:
            reject('unsupported attributes')
        seen = set()
        for attribute in attributes:
            exact_keys(attribute, {'trait_type', 'value'})
            trait, item = attribute['trait_type'], attribute['value']
            if not isinstance(trait, str) or trait in seen:
                reject('duplicate or invalid trait')
            seen.add(trait)
            if trait == 'category':
                if not isinstance(item, str) or item not in ('standard', 'premium'):
                    reject('unsupported category')
            elif trait == 'normalized_length':
                integer(item, 1, 63)
                if item != len(name):
                    reject('normalized length is inconsistent')
            elif trait == 'network':
                if item != 'POA':
                    reject('unsupported network')
            else:
                reject('unknown trait')
    return value


def relative_parts(path):
    if not isinstance(path, str) or len(path) > 512 or path.startswith('/'):
        reject('unsafe relative path')
    parts = path.split('/')
    if len(parts) > MAX_PATH_DEPTH or any(p in ('', '.', '..') or not COMPONENT.fullmatch(p) for p in parts):
        reject('unsafe relative path')
    return parts


def absolute_parts(path):
    if not isinstance(path, (str, os.PathLike)):
        reject('invalid filesystem path')
    path = os.fspath(path)
    if len(path) > 4096 or '\x00' in path or '..' in path.split('/'):
        reject('unsafe filesystem path')
    full = os.path.abspath(path)
    return [p for p in full.split('/') if p]


def disjoint_paths(first, second):
    left, right = absolute_parts(first), absolute_parts(second)
    if left[:len(right)] == right or right[:len(left)] == left:
        reject('source and output paths must not overlap')


DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC


def open_dir(path):
    parts = absolute_parts(path)
    fd = os.open('/', DIR_FLAGS)
    try:
        for part in parts:
            new = os.open(part, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = new
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextmanager
def directory(path):
    fd = open_dir(path)
    try:
        yield fd
    finally:
        os.close(fd)


@contextmanager
def parent_of(path):
    parts = absolute_parts(path)
    if not parts:
        reject('filesystem root is not an output target')
    name = parts.pop()
    if len(name) > 128:
        reject('output filename is too long')
    with directory('/' + '/'.join(parts)) as fd:
        yield fd, name


def subdir(root, parts):
    fd = os.dup(root)
    try:
        for part in parts:
            new = os.open(part, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = new
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_relative(root, path, maximum):
    parts = relative_parts(path)
    fd = subdir(root, parts[:-1])
    file_fd = None
    try:
        file_fd = os.open(parts[-1], FILE_FLAGS, dir_fd=fd)
        info = os.fstat(file_fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > maximum:
            reject('file type, link count or size is unsupported')
        chunks, total = [], 0
        while True:
            chunk = os.read(file_fd, min(65536, maximum + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum:
                reject('file size limit exceeded')
        return b''.join(chunks)
    finally:
        if file_fd is not None:
            os.close(file_fd)
        os.close(fd)


def read_absolute(path, maximum=MAX_DOCUMENT):
    with parent_of(path) as (fd, name):
        return read_relative(fd, name, maximum)


def scan(root):
    """Bounded walk, including unreferenced files. Never follows symlinks."""
    files, dirs = set(), set()
    count = 0

    def walk(fd, prefix='', depth=0):
        nonlocal count
        if depth > MAX_PATH_DEPTH:
            reject('directory depth limit exceeded')
        with os.scandir(fd) as items:
            for item in items:
                count += 1
                if count > MAX_FILES:
                    reject('directory entry limit exceeded')
                relative_parts(item.name)
                relative = prefix + item.name
                info = item.stat(follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode):
                    reject('symlinks are not allowed')
                if stat.S_ISDIR(info.st_mode):
                    dirs.add(relative)
                    child = os.open(item.name, DIR_FLAGS, dir_fd=fd)
                    try:
                        walk(child, relative + '/', depth + 1)
                    finally:
                        os.close(child)
                elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                    files.add(relative)
                else:
                    reject('unsupported filesystem entry')
    walk(root)
    return files, dirs


def write_exclusive(root, name, data):
    relative_parts(name)
    if '/' in name:
        reject('output file must have one component')
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                 0o600, dir_fd=root)
    try:
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            if not written:
                reject('local file write failed')
            view = view[written:]
        os.fsync(fd)
    except BaseException:
        os.unlink(name, dir_fd=root)
        raise
    finally:
        os.close(fd)


def new_document(path, value):
    with parent_of(path) as (fd, name):
        write_exclusive(fd, name, canonical(value) + b'\n')


def read_source(index_path, source_path):
    index = load_json(read_absolute(index_path))
    exact_keys(index, {'format', 'entries'})
    if index['format'] != INPUT_FORMAT or not isinstance(index['entries'], list) or not 1 <= len(index['entries']) <= MAX_ENTRIES:
        reject('unsupported input index or entry limit exceeded')
    records, contents, files, currents, identities = [], {}, set(), {}, set()
    with directory(source_path) as fd:
        actual, _ = scan(fd)
        for entry in index['entries']:
            exact_keys(entry, {'name', 'cid', 'file', 'current'})
            name, cid, path = entry['name'], entry['cid'], entry['file']
            stable_name(name)
            cid_hash(cid)
            parts = relative_parts(path)
            if any(part.startswith('.') for part in parts):
                reject('hidden source path components are not allowed')
            if type(entry['current']) is not bool:
                reject('current flag must be a JSON boolean')
            if path in files or (name, cid) in identities:
                reject('duplicate input path or identity')
            files.add(path)
            identities.add((name, cid))
            currents[name] = currents.get(name, 0) + int(entry['current'])
            data = read_relative(fd, path, MAX_METADATA)
            metadata(data, name)
            checked_cid(cid, data)
            sha = digest(data)
            records.append({'name': name, 'cid': cid, 'sha256': sha, 'size': len(data), 'current': entry['current']})
            contents[sha] = data
        if actual != files:
            reject('source must contain exactly the indexed metadata files')
    if len(currents) > MAX_NAMES or any(count != 1 for count in currents.values()):
        reject('each included name requires exactly one current version')
    return sorted(records, key=lambda r: (r['name'], r['cid'])), contents


def review_identity(record):
    return {key: record[key] for key in ('name', 'cid', 'sha256', 'size')}


def review_template(index_path, source_path, output_path):
    disjoint_paths(source_path, output_path)
    records, _ = read_source(index_path, source_path)
    attestations = []
    for record in records:
        item = review_identity(record)
        item.update(approved=False, reviewer='', attestation='')
        attestations.append(item)
    new_document(output_path, {'format': REVIEW_FORMAT, 'attestations': attestations})
    return len(records)


def validate_attestation(item, identity):
    exact_keys(item, {'name', 'cid', 'sha256', 'size', 'approved', 'reviewer', 'attestation'})
    if any(type(item[k]) is not type(v) or item[k] != v for k, v in identity.items()):
        reject('review is not bound to these exact bytes and identity')
    if item['approved'] is not True or item['attestation'] != ATTESTATION:
        reject('explicit per-content review attestation is required')
    if not isinstance(item['reviewer'], str) or not REVIEWER.fullmatch(item['reviewer']) or UNSAFE.search(item['reviewer']):
        reject('reviewer must be a neutral local label, not contact details')


def read_reviews(path, records):
    review = load_json(read_absolute(path))
    exact_keys(review, {'format', 'attestations'})
    if review['format'] != REVIEW_FORMAT or not isinstance(review['attestations'], list) or len(review['attestations']) != len(records):
        reject('review allowlist must match input entries exactly')
    wanted = {(r['name'], r['cid']): review_identity(r) for r in records}
    accepted = {}
    for item in review['attestations']:
        if not isinstance(item, dict) or not isinstance(item.get('name'), str) or not isinstance(item.get('cid'), str):
            reject('invalid review identity')
        key = item['name'], item['cid']
        if key not in wanted or key in accepted:
            reject('unexpected or duplicate review identity')
        validate_attestation(item, wanted[key])
        accepted[key] = item
    return accepted


def envelope(payload):
    return {'format': BACKUP_FORMAT, 'payload': payload, 'sha256': digest(canonical(payload))}


def verify_fd(fd):
    files, dirs = scan(fd)
    if dirs != {'objects'} or 'manifest.json' not in files:
        reject('backup layout is invalid')
    document = load_json(read_relative(fd, 'manifest.json', MAX_DOCUMENT))
    exact_keys(document, {'format', 'payload', 'sha256'})
    payload = document['payload']
    if document['format'] != BACKUP_FORMAT or not isinstance(document['sha256'], str) or not SHA.fullmatch(document['sha256']):
        reject('unsupported backup format')
    if digest(canonical(payload)) != document['sha256']:
        reject('manifest checksum mismatch')
    exact_keys(payload, {'names'})
    names = payload['names']
    if not isinstance(names, dict) or not 1 <= len(names) <= MAX_NAMES:
        reject('backup name count is outside supported bounds')
    expected, total = {'manifest.json'}, 0
    for name, history in names.items():
        stable_name(name)
        exact_keys(history, {'current', 'versions'})
        versions = history['versions']
        if not isinstance(versions, dict) or not versions:
            reject('empty or invalid version history')
        total += len(versions)
        if total > MAX_ENTRIES:
            reject('backup version count limit exceeded')
        if not isinstance(history['current'], str) or history['current'] not in versions:
            reject('current version is not in retained history')
        for cid, record in versions.items():
            sha = cid_hash(cid)
            exact_keys(record, {'sha256', 'size', 'review'})
            if record['sha256'] != sha:
                reject('manifest CID and hash are inconsistent')
            integer(record['size'], 1, MAX_METADATA)
            identity = {'name': name, 'cid': cid, 'sha256': sha, 'size': record['size']}
            validate_attestation(record['review'], identity)
            path = 'objects/' + sha + '.json'
            expected.add(path)
            data = read_relative(fd, path, MAX_METADATA)
            if len(data) != record['size']:
                reject('metadata size mismatch')
            checked_cid(cid, data)
            metadata(data, name)
    if files != expected:
        reject('backup contains missing or unreferenced files')
    return document, total


def verify(path):
    with directory(path) as fd:
        return verify_fd(fd)


@contextmanager
def backup_lock(parent, name):
    # Stable advisory lock inode remains outside the backup; no stale-lock deletion race.
    lock_name = '.' + name + '.poa-lock'
    lock = os.open(lock_name, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK,
                   0o600, dir_fd=parent)
    try:
        info = os.fstat(lock)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size != 0:
            reject('invalid local lock file')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            reject('another local preparation is active')
        yield
    finally:
        os.close(lock)


def manifest_unchanged(root, previous_bytes):
    """Permit rollback ONLY when the exact validated prior commit is still visible.

    A rename can succeed even if its Python wrapper raises before returning.
    Unknown/unreadable/unexpected commit state must preserve every candidate blob.
    This is conservative local evidence, not protection against concurrent writers.
    """
    if previous_bytes is None:
        # A new/incomplete directory has no previously validated commit to restore.
        # Missing/unreadable manifest state is not evidence that rename never ran.
        return False
    try:
        current = read_relative(root, 'manifest.json', MAX_DOCUMENT)
    except BaseException:
        return False
    return current == previous_bytes


def rollback_candidates(root, objects, candidates, temporary):
    # Called only after manifest_unchanged proves the exact validated old commit.
    # Paths were registered before exclusive writes; old referenced objects are never
    # candidates. The local working directory must have no other writer.
    for filename in candidates:
        try:
            os.unlink(filename, dir_fd=objects)
        except FileNotFoundError:
            pass
    if temporary:
        try:
            os.unlink(temporary, dir_fd=root)
        except FileNotFoundError:
            pass
    os.fsync(objects)
    os.fsync(root)


def prepare(index_path, source_path, review_path, backup_path):
    disjoint_paths(source_path, backup_path)
    records, contents = read_source(index_path, source_path)
    reviews = read_reviews(review_path, records)
    with parent_of(backup_path) as (parent, leaf), backup_lock(parent, leaf):
        try:
            fd = os.open(leaf, DIR_FLAGS, dir_fd=parent)
        except FileNotFoundError:
            fd = None
        try:
            if fd is not None:
                previous, _ = verify_fd(fd)
                previous_bytes = read_relative(fd, 'manifest.json', MAX_DOCUMENT)
                payload = copy.deepcopy(previous['payload'])
            else:
                previous = None
                previous_bytes = None
                payload = {'names': {}}
            for record in records:
                name, cid = record['name'], record['cid']
                history = payload['names'].setdefault(name, {'current': None, 'versions': {}})
                version = {'sha256': record['sha256'], 'size': record['size'],
                           'review': reviews[(name, cid)]}
                if cid in history['versions']:
                    old = history['versions'][cid]
                    if old['sha256'] != version['sha256'] or old['size'] != version['size']:
                        reject('immutable version conflict')
                    # Preserve the first stored review; do not rewrite historical evidence.
                else:
                    history['versions'][cid] = version
                if record['current']:
                    history['current'] = cid
            total = sum(len(h['versions']) for h in payload['names'].values())
            if len(payload['names']) > MAX_NAMES or total > MAX_ENTRIES:
                reject('merged backup exceeds supported count limits')
            new = envelope(payload)
            manifest_bytes = canonical(new) + b'\n'
            if len(manifest_bytes) > MAX_DOCUMENT:
                reject('merged manifest size limit exceeded')
            if previous == new:
                # Also finish directory synchronization after an earlier commit whose
                # acknowledgement/fsync failed. No content or manifest is rewritten.
                os.fsync(fd)
                os.fsync(parent)
                return total, False
            if fd is None:
                os.mkdir(leaf, 0o700, dir_fd=parent)
                fd = os.open(leaf, DIR_FLAGS, dir_fd=parent)
                os.mkdir('objects', 0o700, dir_fd=fd)
            objects = os.open('objects', DIR_FLAGS, dir_fd=fd)
            candidates, temporary = [], None
            try:
                old_hashes = set()
                if previous:
                    old_hashes = {v['sha256'] for h in previous['payload']['names'].values() for v in h['versions'].values()}
                for sha, data in sorted(contents.items()):
                    if sha not in old_hashes:
                        filename = sha + '.json'
                        candidates.append(filename)
                        write_exclusive(objects, filename, data)
                os.fsync(objects)
                temporary = '.manifest-' + secrets.token_hex(12) + '.tmp'
                write_exclusive(fd, temporary, manifest_bytes)
                os.replace(temporary, 'manifest.json', src_dir_fd=fd, dst_dir_fd=fd)
                # No Python boolean represents the commit boundary: on ANY failure,
                # consult the on-disk manifest before considering destructive rollback.
                os.fsync(fd)
                os.fsync(parent)  # Persist the new backup directory's parent entry.
                verify_fd(fd)
            except BaseException as failure:
                # An exclusive-create collision signals an unexpected filesystem state;
                # preserve evidence instead of guessing ownership of a candidate path.
                if not isinstance(failure, FileExistsError) and manifest_unchanged(fd, previous_bytes):
                    try:
                        rollback_candidates(fd, objects, candidates, temporary)
                    except BaseException:
                        # Cleanup itself can fail/be interrupted. Keep the original error;
                        # never report success or try a broader/destructive repair.
                        pass
                raise
            finally:
                os.close(objects)
            return total, True
        finally:
            if fd is not None:
                os.close(fd)


def restore(backup_path, output_path):
    # Destination must not exist. No merging, overwritten files, network or CID conversion.
    disjoint_paths(backup_path, output_path)
    with directory(backup_path) as source:
        document, total = verify_fd(source)
        with parent_of(output_path) as (parent, leaf):
            os.mkdir(leaf, 0o700, dir_fd=parent)
            target = os.open(leaf, DIR_FLAGS, dir_fd=parent)
            try:
                os.mkdir('objects', 0o700, dir_fd=target)
                objects = os.open('objects', DIR_FLAGS, dir_fd=target)
                try:
                    seen = set()
                    for name, history in sorted(document['payload']['names'].items()):
                        for cid, version in sorted(history['versions'].items()):
                            sha = version['sha256']
                            data = read_relative(source, 'objects/' + sha + '.json', MAX_METADATA)
                            checked_cid(cid, data)
                            metadata(data, name)
                            if len(data) != version['size']:
                                reject('metadata changed during restore')
                            if sha not in seen:
                                write_exclusive(objects, sha + '.json', data)
                                seen.add(sha)
                    os.fsync(objects)
                finally:
                    os.close(objects)
                write_exclusive(target, 'manifest.json', canonical(document) + b'\n')
                os.fsync(target)
                os.fsync(parent)  # Persist the restored directory's parent entry.
                verify_fd(target)  # Re-read restored bytes, hash AND supported CID.
                return total
            finally:
                os.close(target)


class QuietParser(argparse.ArgumentParser):
    def error(self, message):
        reject('invalid command line (values omitted)')


def parser():
    result = QuietParser(description=__doc__)
    commands = result.add_subparsers(dest='command', required=True, parser_class=QuietParser)
    hashes = commands.add_parser('fingerprint', help='Print raw CID, SHA256 and size, not file content')
    hashes.add_argument('--file', required=True)
    review = commands.add_parser('review', help='Create an UNAPPROVED, per-content review template')
    make = commands.add_parser('prepare', help='Prepare local backup only after explicit review')
    for command in (review, make):
        command.add_argument('--index', required=True)
        command.add_argument('--source', required=True)
    review.add_argument('--out', required=True)
    make.add_argument('--review', required=True)
    make.add_argument('--backup', required=True)
    check = commands.add_parser('verify', help='Verify local layout, manifest, review, schema, hashes and CIDs')
    check.add_argument('--backup', required=True)
    recover = commands.add_parser('restore', help='Restore all original bytes/history to a NEW local backup-shaped directory')
    recover.add_argument('--backup', required=True)
    recover.add_argument('--out', required=True)
    return result


def main(argv=None):
    try:
        args = parser().parse_args(argv)
        if args.command == 'fingerprint':
            data = read_absolute(args.file, MAX_METADATA)
            print(canonical({'cid': raw_cid(data), 'sha256': digest(data), 'size': len(data)}).decode('ascii'))
        elif args.command == 'review':
            count = review_template(args.index, args.source, args.out)
            print(f'Created UNAPPROVED review template: {count} entries. No backup prepared.')
        elif args.command == 'prepare':
            count, changed = prepare(args.index, args.source, args.review, args.backup)
            print(f'Local backup {"prepared" if changed else "unchanged"}: {count} retained versions.')
        elif args.command == 'verify':
            _, count = verify(args.backup)
            print(f'Local backup verified: {count} retained versions. No provider availability claim.')
        elif args.command == 'restore':
            count = restore(args.backup, args.out)
            print(f'Local restore verified: {count} retained versions. Original bytes; no publishing.')
        return 0
    except Rejected as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        return 2
    except (OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
        print('ERROR: local operation rejected or failed (paths and content omitted)', file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print('ERROR: interrupted; check local output before reusing it', file=sys.stderr)
        return 130
    except Exception:
        print('ERROR: unexpected local failure (details omitted)', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
