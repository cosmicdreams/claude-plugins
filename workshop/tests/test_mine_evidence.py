"""Evidence collection for workshop:harden's repository mode."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parent.parent / 'scripts' / 'mine_evidence.py'


def git(repo, *args):
    subprocess.run(['git', '-C', str(repo), '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t',
                    '-c', 'user.email=t@example.com', *args], check=True, capture_output=True)


class MineEvidenceTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        git(self.repo, 'init', '-q')
        git(self.repo, 'remote', 'add', 'origin', 'git@github.com:acme/site.git')
        for n, subject in enumerate(('feat: add page', 'fix(config): keep settings', 'fix(config): keep settings (#7)',
                                     'revert: drop page', 'chore: fixups')):
            (self.repo / f'f{n}.txt').write_text(subject)
            git(self.repo, 'add', '.')
            git(self.repo, 'commit', '-q', '-m', subject)
        self.ledgers = self.root / 'ledgers'
        folder = self.ledgers / 'acme-site'
        folder.mkdir(parents=True)
        (folder / 'feature-x.jsonl').write_text(
            json.dumps({'id': 'S1', 'severity': 'should', 'outcome': 'fixed', 'claim': 'missing cache context'}) + '\n'
            + json.dumps({'id': None, 'round': 2}) + '\n')

    def mine(self):
        r = subprocess.run([sys.executable, str(SCRIPT), '--repo', str(self.repo), '--since', '2000-01-01',
                            '--ledgers', str(self.ledgers), '--offline'],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_collects_fix_commits_once_per_subject(self):
        result = self.mine()
        self.assertEqual(result['repo'], 'acme/site')
        self.assertEqual(sorted(c['subject'] for c in result['fix_commits']),
                         ['fix(config): keep settings (#7)', 'revert: drop page'])
        self.assertTrue(all(c['files'] for c in result['fix_commits']))

    def test_reads_this_repositorys_ledger_findings(self):
        result = self.mine()
        self.assertEqual([f['id'] for f in result['review_findings']], ['S1'])

    def test_offline_skips_github(self):
        result = self.mine()
        self.assertIsNone(result['ci_failures'])
        self.assertIsNone(result['review_comments'])
        self.assertEqual(result['errors'], [])


if __name__ == '__main__':
    unittest.main()
