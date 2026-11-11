"""upstream-post-guard: blocks git.drupalcode.org posts that skip the worth-it gate."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HOOK = Path(__file__).resolve().parents[1] / 'hooks/upstream-post-guard.py'

GOOD = ('Rebased onto 4.0.x (49159f2) with no code changes. The new kernel test fails '
        'on 4.0.x with "Failed asserting that 4 is identical to 0." and passes here. '
        'Not checked: sites that already have dangling rows.\n')

# Shaped like the notes that drew the maintainer's objection: long, with a side finding.
LONG = ' '.join(['The fix moves reassignment into the delete hook and covers every cancel method.'] * 25)
SIDE = 'The test fails without the fix. Separate from this fix: config import still exits 1.\n'


def gate_for(body, **over):
    gate = {
        'body_sha256': hashlib.sha256(body.encode()).hexdigest(),
        'problem': 'relationships keep a deleted uid',
        'proof': 'phpunit UserDeleteTest -> Failed asserting that 4 is identical to 0.',
        'smallest': 'one hook, keeps the author approach',
        'trigger': 'initial evidence',
        'reviewer_value': 'shows the failing test',
        'not_verified': 'existing dangling rows',
        'chris_approved': False,
    }
    gate.update(over)
    return gate


class Guard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.maint = self.dir / 'maintainers.json'
        self.maint.write_text(json.dumps([{'project': 'project/group', 'maintainer': 'someone'}]))

    def tearDown(self):
        self.tmp.cleanup()

    def body(self, text, gate=True, **over):
        path = self.dir / 'body.md'
        path.write_text(text)
        gate_path = self.dir / 'body.md.gate.json'
        if gate:
            gate_path.write_text(json.dumps(gate_for(text, **over)))
        elif gate_path.exists():
            gate_path.unlink()
        return path

    def run_hook(self, cmd):
        env = dict(os.environ, UPSTREAM_MAINTAINERS=str(self.maint))
        env.pop('GITLAB_HOST', None)
        payload = json.dumps({'tool_input': {'command': cmd}, 'cwd': str(self.dir)})
        return subprocess.run([sys.executable, '-I', str(HOOK)], input=payload, text=True,
                              capture_output=True, env=env)

    def note(self, path, project='project/webform'):
        return f'glab mr note 12 -R {project} --message "$(cat {path})"'

    def test_reads_and_other_tools_pass(self):
        for cmd in ('glab mr view 330 -R project/group', 'gh pr comment 1 --body x', 'ls -la',
                    'glab api projects/project%2Fgroup/merge_requests/330/notes'):
            self.assertEqual(self.run_hook(cmd).returncode, 0, cmd)

    def test_inline_message_blocked(self):
        r = self.run_hook('glab mr note 12 -R project/webform -m "LGTM"')
        self.assertEqual(r.returncode, 2)
        self.assertIn('write the post body to a file', r.stderr)

    def test_missing_gate_blocked(self):
        path = self.body(GOOD, gate=False)
        self.assertEqual(self.run_hook(self.note(path)).returncode, 2)

    def test_good_post_passes(self):
        path = self.body(GOOD)
        r = self.run_hook(self.note(path))
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_api_post_detected(self):
        path = self.body(GOOD, gate=False)
        cmd = f'glab api -X POST projects/project%2Fwebform/merge_requests/1/notes -F body=@{path}'
        self.assertEqual(self.run_hook(cmd).returncode, 2)

    def test_empty_answer_blocked(self):
        path = self.body(GOOD, proof='')
        r = self.run_hook(self.note(path))
        self.assertEqual(r.returncode, 2)
        self.assertIn('proof', r.stderr)

    def test_edited_after_gate_blocked(self):
        path = self.body(GOOD)
        path.write_text(GOOD + 'One more thing.\n')
        r = self.run_hook(self.note(path))
        self.assertEqual(r.returncode, 2)
        self.assertIn('changed after its gate', r.stderr)

    def test_long_body_blocked(self):
        r = self.run_hook(self.note(self.body(LONG)))
        self.assertEqual(r.returncode, 2)
        self.assertIn('words', r.stderr)

    def test_side_finding_blocked(self):
        r = self.run_hook(self.note(self.body(SIDE)))
        self.assertEqual(r.returncode, 2)
        self.assertIn('side finding', r.stderr)

    def test_heading_blocked(self):
        r = self.run_hook(self.note(self.body('## Summary\n' + GOOD)))
        self.assertEqual(r.returncode, 2)

    def test_listed_maintainer_needs_approval(self):
        path = self.body(GOOD)
        r = self.run_hook(self.note(path, 'project/group'))
        self.assertEqual(r.returncode, 2)
        self.assertIn('human-written', r.stderr)
        path = self.body(GOOD, chris_approved=True)
        self.assertEqual(self.run_hook(self.note(path, 'project/group')).returncode, 0)

    def test_do_command_short_passes_gate_still_required(self):
        path = self.body('/do:rebase\n')
        self.assertEqual(self.run_hook(self.note(path)).returncode, 0)
        path = self.body('/do:rebase\n', gate=False)
        self.assertEqual(self.run_hook(self.note(path)).returncode, 2)


if __name__ == '__main__':
    unittest.main()
