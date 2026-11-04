"""Contract tests for the iteration logger."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'log-iteration.sh'
RESERVED = ('iteration', 'timestamp', 'change', 'gate', 'metric_before',
            'metric_after', 'ratchet', 'decision', 'reason')

class LogIterationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'results.jsonl'

    def run_log(self, *extra):
        return subprocess.run([str(SCRIPT), str(self.path), '1', 'change', 'pass',
                               '4', '5', '5', 'keep', 'reason', *extra],
                              text=True, capture_output=True, timeout=60)

    def test_fixture_nine_arguments_preserve_record(self):
        r = self.run_log()
        self.assertEqual(r.returncode, 0, r.stderr)
        record = json.loads(self.path.read_text())
        self.assertTrue(record.pop('timestamp'))
        self.assertEqual(record, dict(iteration=1, change='change', gate='pass',
                                      metric_before=4, metric_after=5, ratchet=5,
                                      decision='keep', reason='reason'))

    def test_extra_object_is_merged(self):
        r = self.run_log('{"metric_type":"judged","eval":"e0001"}')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(self.path.read_text())['eval'], 'e0001')

    def test_invalid_extras_leave_existing_and_missing_files_unchanged(self):
        valid = self.run_log('{}')  # Rejecting every tenth argument is unsafe too.
        self.assertEqual(valid.returncode, 0, valid.stderr)
        for present in (False, True):
            for extra in ['[]', 'null', '42', '"text"', '{broken'] + [json.dumps({k: 1}) for k in RESERVED]:
                with self.subTest(present=present, extra=extra):
                    if present:
                        self.path.write_bytes(b'existing\n')
                    else:
                        self.path.unlink(missing_ok=True)
                    before = self.path.read_bytes() if present else None
                    r = self.run_log(extra)
                    self.assertNotEqual(r.returncode, 0)
                    self.assertEqual(self.path.read_bytes() if self.path.exists() else None, before)
