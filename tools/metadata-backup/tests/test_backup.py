"""Synthetic metadata exists only inside per-test TemporaryDirectory instances."""
import base64
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import stat
import sys
import tempfile
import unittest
from unittest import mock

MODULE = Path(__file__).resolve().parents[1] / 'poa_backup.py'
spec = importlib.util.spec_from_file_location('poa_backup', MODULE)
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='poa-synthetic-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.index = self.root / 'index.json'
        self.review = self.root / 'review.json'
        self.backup = self.root / 'backup'
        self.output = self.root / 'restored'
        self.data = b'{\n  "name": "fixture", "description": "Synthetic fixture."\n}\n'
        self.record = self.put('fixture.json', self.data, current=True)
        self.write_index([self.record])

    def put(self, filename, data, current=True, name='fixture', cid=None):
        (self.source / filename).write_bytes(data)
        return {'name': name, 'cid': cid or B.raw_cid(data), 'file': filename, 'current': current}

    def write_index(self, entries):
        self.index.write_text(json.dumps({'format': B.INPUT_FORMAT, 'entries': entries}))

    def template(self):
        return B.review_template(self.index, self.source, self.review)

    def approve(self):
        if self.review.exists():
            self.review.unlink()
        self.template()
        document = json.loads(self.review.read_bytes())
        for record in document['attestations']:
            record.update(approved=True, reviewer='fixture-reviewer', attestation=B.ATTESTATION)
        self.review.write_bytes(B.canonical(document))

    def prepare(self):
        self.approve()
        return B.prepare(self.index, self.source, self.review, self.backup)

    def object_path(self):
        return self.backup / 'objects' / (B.digest(self.data) + '.json')

    def alter_manifest(self, mutate, checksum=True):
        path = self.backup / 'manifest.json'
        document = json.loads(path.read_bytes())
        mutate(document)
        if checksum:
            document['sha256'] = B.digest(B.canonical(document['payload']))
        path.write_bytes(B.canonical(document))

    def test_template_never_autoapproves(self):
        self.assertEqual(self.template(), 1)
        record = json.loads(self.review.read_bytes())['attestations'][0]
        self.assertIs(record['approved'], False)
        self.assertEqual(record['attestation'], '')
        self.assertEqual(record['sha256'], hashlib.sha256(self.data).hexdigest())
        self.assertFalse(self.backup.exists())

    def test_unapproved_review_refused(self):
        self.template()
        with self.assertRaises(B.Rejected):
            B.prepare(self.index, self.source, self.review, self.backup)
        self.assertFalse(self.backup.exists())

    def test_prepare_verify_restore_exact_bytes(self):
        self.assertEqual(self.prepare(), (1, True))
        self.assertEqual(B.verify(self.backup)[1], 1)
        self.assertEqual(self.object_path().read_bytes(), self.data)
        self.assertEqual(B.restore(self.backup, self.output), 1)
        restored = self.output / 'objects' / self.object_path().name
        self.assertEqual(restored.read_bytes(), self.data)
        self.assertEqual(B.verify(self.output)[1], 1)

    def test_idempotent_no_content_or_manifest_rewrite(self):
        self.prepare()
        manifest = self.backup / 'manifest.json'
        before = (manifest.read_bytes(), manifest.stat().st_mtime_ns,
                  self.object_path().read_bytes(), self.object_path().stat().st_mtime_ns)
        self.assertEqual(B.prepare(self.index, self.source, self.review, self.backup), (1, False))
        self.assertEqual(before, (manifest.read_bytes(), manifest.stat().st_mtime_ns,
                                 self.object_path().read_bytes(), self.object_path().stat().st_mtime_ns))

    def test_history_retained_across_updates(self):
        self.prepare()
        first_cid = self.record['cid']
        (self.source / 'fixture.json').unlink()
        second = self.put('v2.json', b'{"name":"fixture","description":"Revision two."}')
        self.write_index([second])
        self.approve()
        self.assertEqual(B.prepare(self.index, self.source, self.review, self.backup), (2, True))
        history = B.verify(self.backup)[0]['payload']['names']['fixture']
        self.assertEqual(history['current'], second['cid'])
        self.assertEqual(set(history['versions']), {first_cid, second['cid']})
        self.assertEqual(self.object_path().read_bytes(), self.data)
        self.assertEqual(B.restore(self.backup, self.output), 2)
        self.assertEqual(B.verify(self.output)[1], 2)

    def test_initial_import_current_and_history(self):
        first = dict(self.record, current=False)
        second = self.put('v2.json', b'{"name":"fixture","description":"Revision two."}')
        self.write_index([first, second])
        self.assertEqual(self.prepare(), (2, True))

    def test_other_names_preserved_when_only_one_updated(self):
        other = self.put('other.json', b'{"name":"other"}', name='other')
        self.write_index([self.record, other])
        self.prepare()
        (self.source / 'other.json').unlink()
        self.write_index([self.record])
        self.approve()
        self.assertEqual(B.prepare(self.index, self.source, self.review, self.backup), (2, False))
        self.assertIn('other', B.verify(self.backup)[0]['payload']['names'])

    def test_changed_reviewer_does_not_rewrite_old_attestation(self):
        self.prepare()
        review = json.loads(self.review.read_bytes())
        review['attestations'][0]['reviewer'] = 'different-reviewer'
        self.review.write_bytes(B.canonical(review))
        self.assertEqual(B.prepare(self.index, self.source, self.review, self.backup), (1, False))
        history = B.verify(self.backup)[0]['payload']['names']['fixture']
        self.assertEqual(history['versions'][self.record['cid']]['review']['reviewer'], 'fixture-reviewer')

    def test_tampered_object_rejected_by_verify_and_restore(self):
        self.prepare()
        self.object_path().write_bytes(b' ' + self.data[1:])
        with self.assertRaises(B.Rejected):
            B.verify(self.backup)
        with self.assertRaises(B.Rejected):
            B.restore(self.backup, self.output)
        self.assertFalse(self.output.exists())

    def test_manifest_checksum_tamper(self):
        self.prepare()
        self.alter_manifest(lambda d: d['payload']['names']['fixture'].update(current='invalid'), checksum=False)
        with self.assertRaises(B.Rejected):
            B.verify(self.backup)

    def test_manifest_current_consistency_even_with_recomputed_checksum(self):
        self.prepare()
        self.alter_manifest(lambda d: d['payload']['names']['fixture'].update(current=B.raw_cid(b'other')))
        with self.assertRaises(B.Rejected):
            B.verify(self.backup)

    def test_manifest_review_consistency_even_with_recomputed_checksum(self):
        self.prepare()
        cid = self.record['cid']
        self.alter_manifest(lambda d: d['payload']['names']['fixture']['versions'][cid]['review'].update(sha256='0' * 64))
        with self.assertRaises(B.Rejected):
            B.verify(self.backup)

    def test_manifest_extra_field_rejected(self):
        self.prepare()
        self.alter_manifest(lambda d: d['payload'].update(extra='unexpected'))
        with self.assertRaises(B.Rejected):
            B.verify(self.backup)

    def test_review_hash_mismatch(self):
        self.approve()
        review = json.loads(self.review.read_bytes())
        review['attestations'][0]['sha256'] = '0' * 64
        self.review.write_bytes(B.canonical(review))
        with self.assertRaises(B.Rejected):
            B.prepare(self.index, self.source, self.review, self.backup)
        self.assertFalse(self.backup.exists())

    def test_generic_all_files_safety_flag_rejected(self):
        self.approve()
        self.review.write_bytes(B.canonical({'format': B.REVIEW_FORMAT, 'all_files_safe': True}))
        with self.assertRaises(B.Rejected):
            B.prepare(self.index, self.source, self.review, self.backup)

    def test_review_requires_exact_phrase_and_identity(self):
        for field, value in [('attestation', 'approved'), ('name', 'another'), ('cid', B.raw_cid(b'other')),
                             ('size', True), ('approved', 1), ('reviewer', 'person@example.com')]:
            with self.subTest(field=field):
                self.approve()
                review = json.loads(self.review.read_bytes())
                review['attestations'][0][field] = value
                self.review.write_bytes(B.canonical(review))
                with self.assertRaises(B.Rejected):
                    B.prepare(self.index, self.source, self.review, self.backup)

    def test_post_review_source_changed_even_whitespace_rejected(self):
        self.approve()
        (self.source / 'fixture.json').write_bytes(self.data + b' ')
        with self.assertRaises(B.Rejected):
            B.prepare(self.index, self.source, self.review, self.backup)

    def test_raw_cid_matches_independent_digest_encoding(self):
        data = b'abc'
        expected = 'b' + base64.b32encode(bytes([1, 85, 18, 32]) + hashlib.sha256(data).digest()).decode().lower().rstrip('=')
        self.assertEqual(B.raw_cid(data), expected)
        self.assertEqual(B.cid_hash(expected), hashlib.sha256(data).hexdigest())
        B.checked_cid(expected, data)

    def test_malformed_and_unsupported_cids_fail_closed(self):
        def enc(data):
            return 'b' + base64.b32encode(data).decode().lower().rstrip('=')
        cids = ['Qm' + 'a' * 44, self.record['cid'].upper(), 'b', 'b0bad', self.record['cid'] + '=',
                enc(b'\x01\x70\x12\x20' + bytes(32)),  # DAG-PB, NOT raw file hash
                enc(b'\x01\x71\x12\x20' + bytes(32)),  # DAG-CBOR
                enc(b'\x81\x00\x55\x12\x20' + bytes(32)),  # overlong version varint
                enc(b'\x01\x55\x12\x1f' + bytes(31)),
                enc(b'\x01\x55\x13\x20' + bytes(32))]
        for cid in cids:
            with self.subTest(cid_format=cid[:5]):
                with self.assertRaises(B.Rejected):
                    B.cid_hash(cid)

    def test_noncanonical_base32_unused_bits_rejected(self):
        alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
        cid = self.record['cid']
        alternate = cid[:-1] + alphabet[alphabet.index(cid[-1]) | 1]
        self.assertNotEqual(alternate, cid)
        with self.assertRaises(B.Rejected):
            B.cid_hash(alternate)

    def test_unixfs_index_cannot_create_review(self):
        cid = 'b' + base64.b32encode(b'\x01\x70\x12\x20' + hashlib.sha256(self.data).digest()).decode().lower().rstrip('=')
        self.write_index([dict(self.record, cid=cid)])
        with self.assertRaises(B.Rejected):
            self.template()
        self.assertFalse(self.review.exists())

    def test_path_traversal_and_absolute_source_paths(self):
        for path in ['../outside.json', '/tmp/outside.json', 'a/../../outside', 'a//b', './fixture.json', 'a\\b', 'a/' * 9 + 'b']:
            with self.subTest(path_class=path[:2]):
                self.write_index([dict(self.record, file=path)])
                with self.assertRaises(B.Rejected):
                    self.template()

    def test_symlink_source_file_rejected(self):
        target = self.root / 'outside.json'
        target.write_bytes(self.data)
        (self.source / 'fixture.json').unlink()
        (self.source / 'fixture.json').symlink_to(target)
        with self.assertRaises(B.Rejected):
            self.template()

    def test_symlink_source_directory_ancestor_rejected(self):
        link = self.root / 'linked-source'
        link.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(OSError):
            B.review_template(self.index, link, self.review)

    def test_symlink_unreferenced_directory_rejected(self):
        (self.source / 'linked').symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(B.Rejected):
            self.template()

    def test_symlink_backup_object_rejected(self):
        self.prepare()
        target = self.root / 'outside.json'
        target.write_bytes(self.data)
        self.object_path().unlink()
        self.object_path().symlink_to(target)
        with self.assertRaises(B.Rejected):
            B.verify(self.backup)

    def test_hardlinks_and_special_files_rejected(self):
        os.link(self.source / 'fixture.json', self.source / 'linked.json')
        with self.assertRaises(B.Rejected):
            self.template()
        (self.source / 'linked.json').unlink()
        os.mkfifo(self.source / 'fifo')
        with self.assertRaises(B.Rejected):
            self.template()

    def test_oversized_metadata_rejected(self):
        (self.source / 'fixture.json').write_bytes(b' ' * (B.MAX_METADATA + 1))
        with self.assertRaises(B.Rejected):
            self.template()

    def test_oversized_index_rejected(self):
        self.index.write_bytes(b' ' * (B.MAX_DOCUMENT + 1))
        with self.assertRaises(B.Rejected):
            self.template()

    def test_json_depth_limit(self):
        with self.assertRaises(B.Rejected):
            B.load_json(b'[' * (B.MAX_DEPTH + 1) + b'0' + b']' * (B.MAX_DEPTH + 1))

    def test_filecount_limit(self):
        for number in range(B.MAX_FILES):
            (self.source / ('extra-' + str(number))).write_bytes(b'')
        with self.assertRaises(B.Rejected):
            self.template()

    def test_entry_count_limit(self):
        self.write_index([self.record] * (B.MAX_ENTRIES + 1))
        with self.assertRaises(B.Rejected):
            self.template()

    def test_unsafe_content_and_unknown_fields_rejected(self):
        cases = [
            {'name': 'fixture', 'email': 'synthetic@example.com'},
            {'name': 'fixture', 'private_plan': 'not for release'},
            {'name': 'fixture', 'description': 'unsubmitted intent'},
            {'name': 'fixture', 'description': 'API key: synthetic-only'},
            {'name': 'fixture', 'description': 'https://synthetic.example.com/api'},
            {'name': 'fixture', 'description': 'Call +1 (415) 555-0100'},
            {'name': 'fixture', 'description': 'person@example.com'},
            {'name': 'fixture', 'description': 'Internal auction plan'},
            {'name': 'fixture', 'description': '0x' + 'a' * 40},
            {'name': 'fixture', 'image': 'https://synthetic.example.com/image'},
            {'name': 'fixture', 'attributes': [{'trait_type': 'contact', 'value': 'synthetic'}]},
            {'name': 'fixture', 'attributes': [{'trait_type': 'normalized_length', 'value': True}]},
            {'name': 'fixture', 'attributes': [{'trait_type': 'network', 'value': 'OTHER'}]},
        ]
        for number, value in enumerate(cases):
            with self.subTest(case=number):
                with self.assertRaises(B.Rejected):
                    B.metadata(B.canonical(value), 'fixture')

    def test_narrow_safe_schema(self):
        value = {'name': 'fixture', 'description': 'Public synthetic fixture.',
                 'image': 'ipfs://' + B.raw_cid(b'synthetic image bytes'),
                 'attributes': [{'trait_type': 'normalized_length', 'value': 7},
                                {'trait_type': 'category', 'value': 'standard'},
                                {'trait_type': 'network', 'value': 'POA'}]}
        self.assertEqual(B.metadata(B.canonical(value), 'fixture'), value)

    def test_duplicate_keys_and_ambiguous_json(self):
        cases = [b'{"name":"fixture","name":"fixture"}', b'{"name":"fixture","number":NaN}',
                 b'{"name":"fixture","number":1.0}', b'\xef\xbb\xbf{"name":"fixture"}', b'\xff',
                 b'{"name":"fixture","attributes":[{"trait_type":"normalized_length","value":1e0}]}']
        for data in cases:
            with self.subTest(data_length=len(data)):
                with self.assertRaises(B.Rejected):
                    B.metadata(data, 'fixture')

    def test_wrong_name_and_unsupported_name_rejected(self):
        for name in ['different', '../fixture', 'a.b', 'Fixture', 'f\u00edxture']:
            with self.subTest(name_length=len(name)):
                with self.assertRaises(B.Rejected):
                    B.metadata(self.data, name)

    def test_multiple_or_missing_current_rejected(self):
        self.write_index([dict(self.record, current=False)])
        with self.assertRaises(B.Rejected):
            self.template()
        second = self.put('v2.json', b'{"name":"fixture","description":"Revision two."}')
        self.write_index([self.record, second])
        with self.assertRaises(B.Rejected):
            self.template()

    def test_duplicate_index_identity_rejected(self):
        self.write_index([self.record, self.record])
        with self.assertRaises(B.Rejected):
            self.template()

    def test_unreferenced_source_or_backup_files_rejected(self):
        extra = self.source / 'extra.json'
        extra.write_bytes(b'{}')
        with self.assertRaises(B.Rejected):
            self.template()
        extra.unlink()
        self.prepare()
        (self.backup / 'extra.json').write_bytes(b'{}')
        with self.assertRaises(B.Rejected):
            B.verify(self.backup)

    def test_restore_will_not_overwrite_existing_directory(self):
        self.prepare()
        self.output.mkdir()
        sentinel = self.output / 'keep'
        sentinel.write_bytes(b'keep')
        with self.assertRaises(FileExistsError):
            B.restore(self.backup, self.output)
        self.assertEqual(sentinel.read_bytes(), b'keep')

    def test_review_will_not_overwrite_existing_file(self):
        self.review.write_bytes(b'keep')
        with self.assertRaises(FileExistsError):
            self.template()
        self.assertEqual(self.review.read_bytes(), b'keep')

    def test_prepare_refuses_existing_empty_directory(self):
        self.approve()
        self.backup.mkdir()
        with self.assertRaises(B.Rejected):
            B.prepare(self.index, self.source, self.review, self.backup)

    def test_prepare_failure_preserves_existing_committed_backup(self):
        self.prepare()
        before = (self.backup / 'manifest.json').read_bytes()
        (self.source / 'fixture.json').unlink()
        second = self.put('v2.json', b'{"name":"fixture","description":"Revision two."}')
        self.write_index([second])
        self.approve()
        with mock.patch.object(B.os, 'replace', side_effect=OSError('synthetic failure')):
            with self.assertRaises(OSError):
                B.prepare(self.index, self.source, self.review, self.backup)
        self.assertEqual((self.backup / 'manifest.json').read_bytes(), before)
        self.assertEqual(B.verify(self.backup)[1], 1)
        self.assertFalse((self.backup / 'objects' / (B.digest((self.source / 'v2.json').read_bytes()) + '.json')).exists())

    def test_cli_errors_never_echo_metadata_or_paths(self):
        secret = 'SYNTHETIC_PRIVATE_MARKER'
        self.write_index([dict(self.record, file='../' + secret)])
        error = io.StringIO()
        with contextlib.redirect_stderr(error):
            status = B.main(['review', '--index', str(self.index), '--source', str(self.source), '--out', str(self.review)])
        self.assertEqual(status, 2)
        self.assertNotIn(secret, error.getvalue())
        self.assertNotIn(str(self.root), error.getvalue())
        error = io.StringIO()
        with contextlib.redirect_stderr(error):
            status = B.main(['--' + secret])
        self.assertEqual(status, 2)
        self.assertNotIn(secret, error.getvalue())

    def test_restore_cannot_modify_source_by_nesting_output(self):
        self.prepare()
        with self.assertRaises(B.Rejected):
            B.restore(self.backup, self.backup / 'nested')
        self.assertEqual(B.verify(self.backup)[1], 1)

    def test_prepare_cannot_nest_backup_under_source(self):
        self.approve()
        with self.assertRaises(B.Rejected):
            B.prepare(self.index, self.source, self.review, self.source / 'nested')
        self.assertFalse((self.source / 'nested').exists())

    def test_review_output_cannot_pollute_source(self):
        with self.assertRaises(B.Rejected):
            B.review_template(self.index, self.source, self.source / 'review.json')
        self.assertFalse((self.source / 'review.json').exists())

    def test_restore_symlink_ancestor_rejected(self):
        self.prepare()
        parent = self.root / 'linked-parent'
        parent.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(OSError):
            B.restore(self.backup, parent / 'another-restore')
        self.assertFalse((self.root / 'another-restore').exists())

    def test_additional_detectable_contacts_and_endpoints_rejected(self):
        for prose in ['api.synthetic.business', '123 Synthetic Street', 'phone details',
                      'sk_live_' + 'x' * 32, 'seed phrase is synthetic']:
            with self.subTest(prose_length=len(prose)):
                with self.assertRaises(B.Rejected):
                    B.metadata(B.canonical({'name': 'fixture', 'description': prose}), 'fixture')

    def test_cli_subprocess_smoke(self):
        def run(*args, expected=0):
            result = subprocess.run([sys.executable, str(MODULE), *map(str, args)], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, expected, result.stderr)
            return result
        fingerprint = json.loads(run('fingerprint', '--file', self.source / 'fixture.json').stdout)
        self.assertEqual(fingerprint['cid'], self.record['cid'])
        run('review', '--index', self.index, '--source', self.source, '--out', self.review)
        run('prepare', '--index', self.index, '--source', self.source, '--review', self.review, '--backup', self.backup, expected=2)
        review = json.loads(self.review.read_bytes())
        for item in review['attestations']:
            item.update(approved=True, reviewer='fixture-reviewer', attestation=B.ATTESTATION)
        self.review.write_bytes(B.canonical(review))
        run('prepare', '--index', self.index, '--source', self.source, '--review', self.review, '--backup', self.backup)
        run('verify', '--backup', self.backup)
        run('restore', '--backup', self.backup, '--out', self.output)
        run('verify', '--backup', self.output)
        self.assertEqual((self.output / 'objects' / self.object_path().name).read_bytes(), self.data)


    # v2 regression helpers and tests. All state still belongs to setUp's tempdir.
    def stage_multiple_update(self):
        self.prepare()
        before = (self.backup / 'manifest.json').read_bytes()
        (self.source / 'fixture.json').unlink()
        second_data = b'{"name":"fixture","description":"Synthetic second revision."}'
        third_data = b'{"name":"fixture","description":"Synthetic third revision."}'
        second = self.put('second.json', second_data, current=False)
        third = self.put('third.json', third_data, current=True)
        self.write_index([second, third])
        self.approve()
        return before, second_data, third_data

    def assert_three_versions(self, second, third):
        document, count = B.verify(self.backup)
        self.assertEqual(count, 3)
        history = document['payload']['names']['fixture']
        self.assertEqual(history['current'], B.raw_cid(third))
        self.assertEqual(set(history['versions']), {B.raw_cid(data) for data in (self.data, second, third)})
        for data in (self.data, second, third):
            blob = self.backup / 'objects' / (B.digest(data) + '.json')
            self.assertEqual(blob.read_bytes(), data)

    def post_replace_failure(self, error, new=False):
        if new:
            self.approve()
            staged = None
        else:
            staged = self.stage_multiple_update()
        real = B.os.replace
        def replace_then_raise(*args, **kwargs):
            real(*args, **kwargs)
            raise error
        with mock.patch.object(B.os, 'replace', side_effect=replace_then_raise):
            with self.assertRaises(type(error)):
                B.prepare(self.index, self.source, self.review, self.backup)
        if new:
            self.assertEqual(B.verify(self.backup)[1], 1)
            self.assertEqual(self.object_path().read_bytes(), self.data)
        else:
            self.assert_three_versions(staged[1], staged[2])
        return staged

    def fd_label(self, fd):
        info = os.fstat(fd)
        locations = [('backup-objects', self.backup / 'objects'), ('backup', self.backup),
                     ('restore-objects', self.output / 'objects'), ('restored', self.output),
                     ('parent', self.root)]
        for label, path in locations:
            if path.exists():
                other = path.stat()
                if (info.st_dev, info.st_ino) == (other.st_dev, other.st_ino):
                    return label
        if stat.S_ISREG(info.st_mode):
            for folder in (self.backup, self.backup / 'objects', self.output, self.output / 'objects'):
                if folder.exists():
                    for path in folder.iterdir():
                        other = path.stat()
                        if (info.st_dev, info.st_ino) == (other.st_dev, other.st_ino):
                            return 'manifest-file' if path.name.startswith('.manifest-') or path.name == 'manifest.json' else 'blob-file'
        return 'other'

    def fail_fsync_at(self, label, action):
        real = B.os.fsync
        def sync(fd):
            if self.fd_label(fd) == label:
                raise OSError('synthetic fsync failure')
            return real(fd)
        with mock.patch.object(B.os, 'fsync', side_effect=sync):
            with self.assertRaises(OSError):
                action()

    def test_v2_post_replace_interrupt_new_backup_keeps_committed_bytes(self):
        self.post_replace_failure(KeyboardInterrupt('synthetic'), new=True)

    def test_v2_post_replace_oserror_new_backup_keeps_committed_bytes(self):
        self.post_replace_failure(OSError('synthetic'), new=True)

    def test_v2_post_replace_interrupt_existing_keeps_all_three_versions(self):
        self.post_replace_failure(KeyboardInterrupt('synthetic'))

    def test_v2_post_replace_oserror_existing_keeps_all_three_versions(self):
        self.post_replace_failure(OSError('synthetic'))

    def test_v2_pre_replace_interrupt_preserves_exact_previous_backup(self):
        before, _, _ = self.stage_multiple_update()
        with mock.patch.object(B.os, 'replace', side_effect=KeyboardInterrupt('synthetic before rename')):
            with self.assertRaises(KeyboardInterrupt):
                B.prepare(self.index, self.source, self.review, self.backup)
        self.assertEqual((self.backup / 'manifest.json').read_bytes(), before)
        self.assertEqual(B.verify(self.backup)[1], 1)
        self.assertEqual(self.object_path().read_bytes(), self.data)

    def test_v2_interrupt_after_blob_writer_returns_cleans_uncommitted_candidate(self):
        before, _, _ = self.stage_multiple_update()
        real = B.write_exclusive
        def write_then_interrupt(root, name, data):
            real(root, name, data)
            if name.endswith('.json'):
                raise KeyboardInterrupt('synthetic after blob write')
        with mock.patch.object(B, 'write_exclusive', side_effect=write_then_interrupt):
            with self.assertRaises(KeyboardInterrupt):
                B.prepare(self.index, self.source, self.review, self.backup)
        self.assertEqual((self.backup / 'manifest.json').read_bytes(), before)
        self.assertEqual(B.verify(self.backup)[1], 1)

    def test_v2_unreadable_commit_probe_preserves_potentially_referenced_blobs(self):
        _, second, third = self.stage_multiple_update()
        real_replace, real_read = B.os.replace, B.read_relative
        attempted = False
        def replace_then_raise(*args, **kwargs):
            nonlocal attempted
            real_replace(*args, **kwargs)
            attempted = True
            raise OSError('synthetic postcommit')
        def read(root, path, maximum):
            if attempted and path == 'manifest.json':
                raise PermissionError('synthetic ambiguous read')
            return real_read(root, path, maximum)
        with mock.patch.object(B.os, 'replace', side_effect=replace_then_raise), mock.patch.object(B, 'read_relative', side_effect=read):
            with self.assertRaises(OSError):
                B.prepare(self.index, self.source, self.review, self.backup)
        self.assert_three_versions(second, third)

    def test_v2_unexpected_commit_bytes_preserve_blobs_and_fail_closed(self):
        _, second, third = self.stage_multiple_update()
        def replace_with_ambiguous_state(*args, **kwargs):
            (self.backup / 'manifest.json').write_bytes(b'{}')
            raise OSError('synthetic unknown commit state')
        with mock.patch.object(B.os, 'replace', side_effect=replace_with_ambiguous_state):
            with self.assertRaises(OSError):
                B.prepare(self.index, self.source, self.review, self.backup)
        for data in (self.data, second, third):
            self.assertEqual((self.backup / 'objects' / (B.digest(data) + '.json')).read_bytes(), data)
        with self.assertRaises(B.Rejected):
            B.verify(self.backup)
        self.assertTrue(any(path.name.startswith('.manifest-') for path in self.backup.iterdir()))

    def test_v2_missing_manifest_after_replace_is_ambiguous_not_rollback(self):
        _, second, third = self.stage_multiple_update()
        real = B.os.replace
        def replace_remove_and_raise(*args, **kwargs):
            real(*args, **kwargs)
            (self.backup / 'manifest.json').unlink()
            raise OSError('synthetic missing commit state')
        with mock.patch.object(B.os, 'replace', side_effect=replace_remove_and_raise):
            with self.assertRaises(OSError):
                B.prepare(self.index, self.source, self.review, self.backup)
        for data in (self.data, second, third):
            self.assertEqual((self.backup / 'objects' / (B.digest(data) + '.json')).read_bytes(), data)
        with self.assertRaises(B.Rejected):
            B.verify(self.backup)

    def test_v2_new_backup_missing_read_does_not_authorize_cleanup(self):
        self.approve()
        real_replace, real_read = B.os.replace, B.read_relative
        attempted = False
        def replace_then_raise(*args, **kwargs):
            nonlocal attempted
            real_replace(*args, **kwargs)
            attempted = True
            raise OSError('synthetic postcommit')
        def read(root, path, maximum):
            if attempted and path == 'manifest.json':
                raise FileNotFoundError('synthetic ambiguous read')
            return real_read(root, path, maximum)
        with mock.patch.object(B.os, 'replace', side_effect=replace_then_raise), mock.patch.object(B, 'read_relative', side_effect=read):
            with self.assertRaises(OSError):
                B.prepare(self.index, self.source, self.review, self.backup)
        self.assertEqual(B.verify(self.backup)[1], 1)
        self.assertEqual(self.object_path().read_bytes(), self.data)

    def test_v2_new_backup_fsync_call_order_includes_parent_last(self):
        self.approve()
        events = []
        real_sync, real_replace = B.os.fsync, B.os.replace
        def sync(fd):
            events.append(self.fd_label(fd))
            real_sync(fd)
        def replace(*args, **kwargs):
            events.append('replace')
            real_replace(*args, **kwargs)
        with mock.patch.object(B.os, 'fsync', side_effect=sync), mock.patch.object(B.os, 'replace', side_effect=replace):
            self.assertEqual(B.prepare(self.index, self.source, self.review, self.backup), (1, True))
        self.assertEqual(events, ['blob-file', 'backup-objects', 'manifest-file', 'replace', 'backup', 'parent'])

    def test_v2_restore_fsync_call_order_includes_parent_last(self):
        self.prepare()
        events = []
        real = B.os.fsync
        def sync(fd):
            events.append(self.fd_label(fd))
            real(fd)
        with mock.patch.object(B.os, 'fsync', side_effect=sync):
            self.assertEqual(B.restore(self.backup, self.output), 1)
        self.assertEqual(events, ['blob-file', 'restore-objects', 'manifest-file', 'restored', 'parent'])

    def test_v2_backup_root_fsync_failure_preserves_committed_history(self):
        _, second, third = self.stage_multiple_update()
        self.fail_fsync_at('backup', lambda: B.prepare(self.index, self.source, self.review, self.backup))
        self.assert_three_versions(second, third)

    def test_v2_backup_parent_fsync_failure_preserves_valid_new_backup(self):
        self.approve()
        self.fail_fsync_at('parent', lambda: B.prepare(self.index, self.source, self.review, self.backup))
        self.assertEqual(B.verify(self.backup)[1], 1)
        self.assertEqual(self.object_path().read_bytes(), self.data)

    def test_v2_objects_fsync_failure_before_commit_preserves_previous(self):
        before, _, _ = self.stage_multiple_update()
        self.fail_fsync_at('backup-objects', lambda: B.prepare(self.index, self.source, self.review, self.backup))
        self.assertEqual((self.backup / 'manifest.json').read_bytes(), before)
        self.assertEqual(B.verify(self.backup)[1], 1)

    def test_v2_manifest_file_fsync_failure_before_commit_preserves_previous(self):
        before, _, _ = self.stage_multiple_update()
        self.fail_fsync_at('manifest-file', lambda: B.prepare(self.index, self.source, self.review, self.backup))
        self.assertEqual((self.backup / 'manifest.json').read_bytes(), before)
        self.assertEqual(B.verify(self.backup)[1], 1)

    def test_v2_restore_parent_fsync_failure_reports_failure_keeps_bytes(self):
        self.prepare()
        self.fail_fsync_at('parent', lambda: B.restore(self.backup, self.output))
        self.assertEqual(B.verify(self.output)[1], 1)
        self.assertEqual(B.verify(self.backup)[1], 1)

    def test_v2_restore_root_fsync_failure_reports_failure_keeps_bytes(self):
        self.prepare()
        self.fail_fsync_at('restored', lambda: B.restore(self.backup, self.output))
        self.assertEqual(B.verify(self.output)[1], 1)
        self.assertEqual(B.verify(self.backup)[1], 1)

    def test_v2_idempotent_retry_syncs_directories_after_lost_ack(self):
        _, second, third = self.post_replace_failure(OSError('synthetic lost acknowledgement'))
        before = (self.backup / 'manifest.json').read_bytes()
        events = []
        real = B.os.fsync
        def sync(fd):
            events.append(self.fd_label(fd))
            real(fd)
        with mock.patch.object(B.os, 'fsync', side_effect=sync):
            self.assertEqual(B.prepare(self.index, self.source, self.review, self.backup), (3, False))
        self.assertEqual(events, ['backup', 'parent'])
        self.assertEqual((self.backup / 'manifest.json').read_bytes(), before)
        self.assert_three_versions(second, third)

    def test_v2_explicit_indexed_hidden_file_rejected(self):
        (self.source / 'fixture.json').rename(self.source / '.fixture.json')
        self.write_index([dict(self.record, file='.fixture.json')])
        with self.assertRaises(B.Rejected):
            self.template()
        self.assertFalse(self.review.exists())

    def test_v2_explicit_indexed_hidden_directory_component_rejected(self):
        hidden = self.source / '.hidden'
        hidden.mkdir()
        (self.source / 'fixture.json').rename(hidden / 'fixture.json')
        self.write_index([dict(self.record, file='.hidden/fixture.json')])
        with self.assertRaises(B.Rejected):
            self.template()

    def test_v2_explicit_hidden_file_nested_in_visible_directory_rejected(self):
        visible = self.source / 'visible'
        visible.mkdir()
        (self.source / 'fixture.json').rename(visible / '.fixture.json')
        self.write_index([dict(self.record, file='visible/.fixture.json')])
        with self.assertRaises(B.Rejected):
            self.template()

    def test_v2_restore_objects_fsync_failure_leaves_partial_not_success(self):
        self.prepare()
        self.fail_fsync_at('restore-objects', lambda: B.restore(self.backup, self.output))
        with self.assertRaises(B.Rejected):
            B.verify(self.output)
        self.assertEqual(B.verify(self.backup)[1], 1)

    def test_v2_noncano_previous_manifest_bytes_are_preserved_on_rollback(self):
        self.prepare()
        path = self.backup / 'manifest.json'
        previous = json.dumps(json.loads(path.read_bytes()), indent=2).encode() + b'\n'
        path.write_bytes(previous)
        (self.source / 'fixture.json').unlink()
        second = self.put('second.json', b'{"name":"fixture","description":"Synthetic second revision."}')
        self.write_index([second])
        self.approve()
        with mock.patch.object(B.os, 'replace', side_effect=OSError('synthetic precommit failure')):
            with self.assertRaises(OSError):
                B.prepare(self.index, self.source, self.review, self.backup)
        self.assertEqual(path.read_bytes(), previous)
        self.assertEqual(B.verify(self.backup)[1], 1)

    def test_v2_exclusive_create_collision_is_ambiguous_preserves_evidence(self):
        before, _, _ = self.stage_multiple_update()
        real = B.write_exclusive
        marker = b'synthetic collision evidence'
        collided = None
        def collision(root, name, data):
            nonlocal collided
            collided = self.backup / 'objects' / name
            collided.write_bytes(marker)
            return real(root, name, data)
        with mock.patch.object(B, 'write_exclusive', side_effect=collision):
            with self.assertRaises(FileExistsError):
                B.prepare(self.index, self.source, self.review, self.backup)
        self.assertEqual(collided.read_bytes(), marker)
        self.assertEqual((self.backup / 'manifest.json').read_bytes(), before)
        self.assertEqual(self.object_path().read_bytes(), self.data)
        with self.assertRaises(B.Rejected):
            B.verify(self.backup)

    def test_v2_failed_cleanup_sync_never_deletes_prior_referenced_blobs(self):
        before, _, _ = self.stage_multiple_update()
        with mock.patch.object(B.os, 'replace', side_effect=OSError('synthetic precommit')), mock.patch.object(B, 'rollback_candidates', wraps=B.rollback_candidates) as rollback:
            real = B.os.fsync
            def sync(fd):
                if rollback.call_count:
                    raise OSError('synthetic cleanup sync failure')
                real(fd)
            with mock.patch.object(B.os, 'fsync', side_effect=sync):
                with self.assertRaises(OSError):
                    B.prepare(self.index, self.source, self.review, self.backup)
        self.assertEqual((self.backup / 'manifest.json').read_bytes(), before)
        self.assertEqual(self.object_path().read_bytes(), self.data)
        self.assertEqual(B.verify(self.backup)[1], 1)

    def test_v2_interrupted_commit_probe_is_ambiguous_not_rollback(self):
        _, second, third = self.stage_multiple_update()
        real_replace, real_read = B.os.replace, B.read_relative
        attempted = False
        def replace_then_raise(*args, **kwargs):
            nonlocal attempted
            real_replace(*args, **kwargs)
            attempted = True
            raise OSError('synthetic original failure')
        def read(root, path, maximum):
            if attempted and path == 'manifest.json':
                raise KeyboardInterrupt('synthetic interrupted commit probe')
            return real_read(root, path, maximum)
        with mock.patch.object(B.os, 'replace', side_effect=replace_then_raise), mock.patch.object(B, 'read_relative', side_effect=read):
            with self.assertRaises(OSError):
                B.prepare(self.index, self.source, self.review, self.backup)
        self.assert_three_versions(second, third)

    def test_v2_failure_after_complete_temp_manifest_write_preserves_previous(self):
        before, _, _ = self.stage_multiple_update()
        real = B.write_exclusive
        def write_then_raise(root, name, data):
            real(root, name, data)
            if name.startswith('.manifest-'):
                raise OSError('synthetic after temp manifest write')
        with mock.patch.object(B, 'write_exclusive', side_effect=write_then_raise):
            with self.assertRaises(OSError):
                B.prepare(self.index, self.source, self.review, self.backup)
        self.assertEqual((self.backup / 'manifest.json').read_bytes(), before)
        self.assertEqual(B.verify(self.backup)[1], 1)


    def test_v2_cli_post_replace_interrupt_reports_failure_not_success(self):
        _, second, third = self.stage_multiple_update()
        real = B.os.replace
        def replace_then_raise(*args, **kwargs):
            real(*args, **kwargs)
            raise KeyboardInterrupt('synthetic acknowledgement loss')
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(B.os, 'replace', side_effect=replace_then_raise), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = B.main(['prepare', '--index', str(self.index), '--source', str(self.source), '--review', str(self.review), '--backup', str(self.backup)])
        self.assertEqual(status, 130)
        self.assertEqual(stdout.getvalue(), '')
        self.assertIn('interrupted', stderr.getvalue())
        self.assert_three_versions(second, third)

    def test_v2_cli_post_replace_oserror_reports_failure_not_success(self):
        _, second, third = self.stage_multiple_update()
        real = B.os.replace
        def replace_then_raise(*args, **kwargs):
            real(*args, **kwargs)
            raise OSError('synthetic acknowledgement loss')
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(B.os, 'replace', side_effect=replace_then_raise), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = B.main(['prepare', '--index', str(self.index), '--source', str(self.source), '--review', str(self.review), '--backup', str(self.backup)])
        self.assertEqual(status, 2)
        self.assertEqual(stdout.getvalue(), '')
        self.assertIn('ERROR:', stderr.getvalue())
        self.assert_three_versions(second, third)

    def test_v2_cli_parent_fsync_failure_reports_failure_not_success(self):
        self.approve()
        real = B.os.fsync
        def sync(fd):
            if self.fd_label(fd) == 'parent':
                raise OSError('synthetic parent synchronization failure')
            real(fd)
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(B.os, 'fsync', side_effect=sync), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = B.main(['prepare', '--index', str(self.index), '--source', str(self.source), '--review', str(self.review), '--backup', str(self.backup)])
        self.assertEqual(status, 2)
        self.assertEqual(stdout.getvalue(), '')
        self.assertIn('ERROR:', stderr.getvalue())
        self.assertEqual(B.verify(self.backup)[1], 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
