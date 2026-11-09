"""Rule-to-enforcer table checks for workshop:harden."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parent.parent / 'scripts' / 'rule_table.py'
HEADER = '| Rule | Source | Level | Enforcer | Proven on | Repeats |\n| --- | --- | --- | --- | --- | --- |\n'


class RuleTableTests(unittest.TestCase):
    def run_check(self, body=None):
        args = [sys.executable, str(SCRIPT), 'check']
        if body is not None:
            tmp = tempfile.NamedTemporaryFile('w', suffix='.md', delete=False)
            self.addCleanup(Path(tmp.name).unlink)
            tmp.write(body)
            tmp.close()
            args += ['--table', tmp.name]
        r = subprocess.run(args, capture_output=True, text=True, timeout=30)
        return r.returncode, json.loads(r.stdout)

    def test_shipped_table_is_valid(self):
        code, result = self.run_check()
        self.assertEqual(code, 0, result)
        self.assertGreater(result['rows'], 0)

    def test_repeated_prose_rule_is_a_hardening_candidate(self):
        code, result = self.run_check(HEADER + '| Spell out acronyms | memory | prose | | | 13 |\n'
                                      '| Once only | memory | prose | | | 1 |\n')
        self.assertEqual(code, 0)
        self.assertEqual(result['harden'], [{'rule': 'Spell out acronyms', 'source': 'memory', 'repeats': 13}])

    def test_enforced_row_needs_enforcer_and_proof(self):
        for row in ('| Guarded | notes | hook | | replayed mistake | 0 |\n',
                    '| Guarded | notes | lint | scripts/x.py | | 0 |\n'):
            with self.subTest(row=row):
                code, result = self.run_check(HEADER + row)
                self.assertEqual(code, 1)
                self.assertRegex(' '.join(result['errors']), 'is required for level')

    def test_table_inside_a_repository_agents_file(self):
        body = ('# Repo\n\n| Other | Table |\n| --- | --- |\n| a | b |\n\n## Rules\n\n' + HEADER
                + '| Enabled modules ship | PPS-345 | lint | scripts/ci/x.php | replayed 6ab60c79e4^ | 0 |\n'
                + '\nTrailing prose | with a pipe.\n')
        code, result = self.run_check(body)
        self.assertEqual(code, 0, result)
        self.assertEqual(result['rows'], 1)

    def test_malformed_tables_fail(self):
        for body, phrase in ((HEADER + '| Rule | src | vibes | | | 0 |\n', 'level must be one of'),
                             (HEADER + '| Rule | src | prose | | | many |\n', 'repeats must be'),
                             (HEADER + '| Rule | src | prose |\n', 'expected 6 cells'),
                             ('| Rule | Level |\n| --- | --- |\n', 'table header must be')):
            with self.subTest(phrase=phrase):
                code, result = self.run_check(body)
                self.assertEqual(code, 1)
                self.assertIn(phrase, ' '.join(result['errors']))


if __name__ == '__main__':
    unittest.main()
