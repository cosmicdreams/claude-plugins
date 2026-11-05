"""Stop and session hooks operate only on running engagements registered by `init`."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest

from tests.test_experiment_report import ReportTests

HOOK = Path(__file__).resolve().parents[1] / 'hooks/keepgoing.py'


class HookTests(ReportTests):
    def hook(self, command='stop', cwd=None, active=False):
        return subprocess.run([sys.executable, str(HOOK), command], cwd=self.w,
                              input=json.dumps(dict(cwd=str(cwd or self.w), stop_hook_active=active)),
                              capture_output=True, text=True, timeout=3)

    def test_live_lock_keeps_hook_silent_and_state_unchanged(self):
        self.init()
        import fcntl
        before = (self.e / 'state.json').read_bytes()
        with (self.e / '.lock').open('w') as held:
            held.write(str(os.getpid()))
            held.flush()
            fcntl.flock(held, fcntl.LOCK_EX)
            for command in ('stop', 'start'):
                r = self.hook(command)
                self.assertEqual((r.returncode, r.stdout, r.stderr), (0, '', ''))
                self.assertEqual((self.e / 'state.json').read_bytes(), before)
        self.assertEqual(json.loads(self.hook().stdout)['decision'], 'block')

    def test_import_failure_is_silent(self):
        for module in ('experiment_loop', 'experiment_report'):
            code = ("import builtins, runpy\n"
                    "original = builtins.__import__\n"
                    "def broken(name, *args, **kwargs):\n"
                    f"    if name == {module!r}: raise ImportError('broken import')\n"
                    "    return original(name, *args, **kwargs)\n"
                    "builtins.__import__ = broken\n"
                    f"runpy.run_path({str(HOOK)!r}, run_name='__main__')\n")
            r = subprocess.run([sys.executable, '-c', code], input='{}',
                               capture_output=True, text=True)
            self.assertEqual((r.returncode, r.stdout, r.stderr), (0, '', ''))

    def test_silent_without_engagement_and_outside_git(self):
        start = time.monotonic()
        for cwd in (self.w, self.root):
            r = self.hook(cwd=cwd)
            self.assertEqual((r.returncode, r.stdout, r.stderr), (0, '', ''))
        self.assertLess(time.monotonic() - start, 1)

    def test_blocks_three_then_pauses_and_start_context(self):
        self.init()
        r = self.hook('start')
        self.assertIn(str(self.e), r.stdout)
        self.assertIn('experiment.py next --engagement', r.stdout)
        for i in range(3):
            r = self.hook(active=bool(i))
            self.assertEqual(json.loads(r.stdout)['decision'], 'block')
            self.assertEqual(self.state()['stop_blocks'], i + 1)
        self.assertEqual(self.hook().stdout, '')
        self.assertEqual(self.state()['status'], 'paused')
        self.assertIn('no progress across 3 continuations', self.state()['ending']['detail'])
        self.assertEqual(self.hook('start').stdout, '')

    def test_results_growth_resets_blocks(self):
        self.init()
        for _ in range(3):
            self.hook()
        # Simulate a new log record without the loop's own stop-block reset.
        (self.e / 'results.jsonl').write_text('{}\n')
        self.assertEqual(json.loads(self.hook().stdout)['decision'], 'block')
        self.assertEqual(self.state()['stop_blocks'], 1)
        self.assertEqual(self.state()['status'], 'running')

    def test_registry_only_and_cwd_subdirectory(self):
        self.init()
        sub = self.w / 'nested'
        sub.mkdir()
        self.assertEqual(json.loads(self.hook(cwd=sub).stdout)['decision'], 'block')
        stray = self.w / 'stray'
        stray.mkdir()
        (stray / 'state.json').write_text((self.e / 'state.json').read_text())
        (self.e / 'state.json').unlink()
        self.assertEqual(self.hook().stdout, '')

    def test_hook_registration(self):
        hooks = json.loads((HOOK.parent / 'hooks.json').read_text())['hooks']
        for event, mode in [('Stop', 'stop'), ('SessionStart', 'start')]:
            entry = hooks[event][0]['hooks'][0]
            self.assertEqual(entry['type'], 'command')
            self.assertTrue(entry['command'].endswith(' ' + mode))
