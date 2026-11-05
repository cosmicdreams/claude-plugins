"""Report, resume and discovery contracts driven through the public CLI."""
import json
import subprocess
import sys
import unittest

from tests import test_experiment_loop as loop
from tests.test_experiment_check import SCRIPT


class ReportTests(unittest.TestCase):
    def setUp(self):
        loop.LoopTests.setUp(self)
        for name in ('root', 'repo', 'w', 'e', 'method', 'override'):
            setattr(self, name, getattr(self, name).resolve())

    git = loop.LoopTests.git
    files = loop.LoopTests.files
    command = loop.LoopTests.command
    state = loop.LoopTests.state
    records = loop.LoopTests.records
    init = loop.LoopTests.init
    baseline = loop.LoopTests.baseline
    begin = loop.LoopTests.begin
    commit = loop.LoopTests.commit
    trial = loop.LoopTests.trial

class PacketTests(ReportTests):
    def report(self):
        out = self.command('report')
        self.assertEqual(out['path'], str(self.e / 'report.md'))
        return (self.e / 'report.md').read_text()

    def test_gameable_metric_and_report_sections(self):
        self.init('Held-out: test "$(cat metric)" -ge 10\n')
        self.baseline()
        self.trial(5)
        self.command('confirm')
        (self.e / 'strategy.md').write_text('Router evidence.')
        report = self.report()
        self.assertEqual([x for x in report.splitlines() if x.startswith('## ')],
                         ['## Ending and goal', '## Decisions to review', '## Rejected directions',
                          '## Router notes', '## Validity', '## Worth keeping'])
        self.assertIn('Held-out: FAIL', report)
        self.assertIn('Checks: PASS', report)
        self.assertIn('Router evidence.', report)
        self.assertIn('one extra branch | _ |', report)
        self.assertIn('confirmed final number: 5', report)
        self.assertIn('Confirmation present: PASS', report)

    def test_unconfirmed_endings_show_ratchet_and_confirmation_not_applicable(self):
        self.init()
        self.baseline()
        self.trial(8)
        self.command('conclude', '--kind', 'bound', '--evidence', 'measured limit')
        for kind in ('unreachable', 'paused'):
            with self.subTest(ending=kind):
                state = self.state()
                state.update(status='paused' if kind == 'paused' else 'stopped',
                             ending=dict(kind=kind, detail='bound: measured limit'))
                (self.e / 'state.json').write_text(json.dumps(state))
                report = self.report()
                self.assertIn('Goal: 5; best measured value: 8;', report)
                self.assertIn('Confirmation present: n/a (ending ' + kind + ')', report)
                self.assertNotIn('8.0', report)

    def test_checks_run_again_on_report(self):
        guard = self.root / 'external-guard'
        guard.write_text('0')
        (self.w / 'guard').unlink()
        (self.w / 'guard').symlink_to(guard)
        self.git('add', 'guard')
        self.git('commit', '-m', 'test: external guard')
        self.init()
        self.baseline()
        self.trial(5)
        self.command('confirm')
        guard.write_text('1')
        self.assertIn('Checks: FAIL', self.report())

    def test_report_validity_from_files_and_history(self):
        self.init()
        self.baseline()
        self.trial(8)
        self.trial(9)
        self.trial(5)
        self.command('confirm')
        report = self.report()
        validity = report.split('## Validity')[1].split('## Worth keeping')[0]
        self.assertNotIn('FAIL', validity)
        self.assertIn('candidate: 1 discard(s)', report)
        # Corrupt evidence without changing the clean incumbent.
        records = self.records()
        records[2]['commit'] = records[1]['commit']
        records[1]['metric_after'] = 12
        records[1]['tradeoff'] = ''
        (self.e / 'results.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in records))
        state = self.state()
        state['scorer_sha256'][str(self.w / 'measure.sh')] = 'wrong'
        state['ending']['kind'] = 'invented'
        (self.e / 'state.json').write_text(json.dumps(state))
        report = self.report()
        for label in ('Scorer files unchanged', 'Every keep beat margin or tie-break',
                      'Every discard has a revert commit referencing the trial commit',
                      'One trial commit per trial', 'Ending is allowed', 'Every keep has tradeoff'):
            self.assertIn(label + ': FAIL', report)

    def test_tiebreak_report(self):
        self.init('Margin: 2\nTiebreak: cat simplicity\nReadability: true\n')
        self.baseline()
        self.trial(9, simplicity=9)
        self.command('conclude', '--kind', 'bound', '--evidence', 'measured limit')
        self.assertIn('Every keep beat margin or tie-break: PASS', self.report())

    def test_remediate_climb_offer_and_absent_heldout(self):
        self.init('Score: cat score\nScore target: 110\n', strategy='remediate', target=0)
        self.baseline()
        self.trial(0)
        self.command('confirm')
        report = self.report()
        self.assertIn('Offer a climb hand-off', report)
        self.assertIn('Final score: 100; Score target: 110', report)
        self.assertIn('Held-out: ABSENT', report)

    def test_report_refuses_open_trial(self):
        self.init()
        self.baseline()
        self.begin()
        self.assertIn('open trial', self.command('report', ok=False)['reason'])

    def test_resume_measurement_failure_rescores_same_trial(self):
        self.init()
        self.baseline()
        self.begin()
        self.files(metric=8)
        self.commit()
        commit = self.state()['trial']['commit']
        self.override.write_text('invalid')
        self.command('trial', 'score', ok=False)
        self.override.write_text('')
        self.assertEqual(self.command('resume', '--note', 'harness repaired')['action'], 'resolve')
        self.assertNotIn('unresolved', self.state())
        self.assertIsNone(self.state()['ending'])
        resolution = json.loads((self.e / 'resolutions.jsonl').read_text())
        self.assertTrue(resolution['timestamp'])
        self.assertEqual(resolution['previous_ending']['kind'], 'paused')
        self.assertEqual(self.command('trial', 'score')['decision'], 'keep')
        self.assertEqual(self.state()['incumbent'], commit)

    def test_resume_budget_override_and_refuses_running(self):
        self.init(budget=1)
        self.command('resume', '--note', 'no', ok=False)
        self.baseline()
        self.trial(9)
        self.command('resume', '--note', 'more time', ok=False)
        self.command('resume', '--note', 'more time', '--budget', '1', ok=False)
        out = self.command('resume', '--note', 'more time', '--budget', '3')
        self.assertEqual(out['trials_left'], 2)
        self.assertEqual(self.state()['budget_override'], 3)
        self.assertEqual(self.trial(8)['action'], 'propose')
        self.assertEqual(self.command('next')['trials_left'], 1)

    def test_resume_exhausted_ladder_and_uncommitted_trial(self):
        self.init('Futility: 1\n')
        self.baseline()
        for _ in range(4):
            self.trial(11)
        self.assertEqual(self.command('resume', '--note', 'new hypotheses')['escalation'], 0)
        self.begin()
        state = self.state()
        state.update(status='paused', ending=dict(kind='paused', detail='agent stalled'))
        (self.e / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.command('resume', '--note', 'continue')['action'], 'edit')

    def test_status_tolerates_missing_or_unreadable_methodology(self):
        self.init()
        other = self.e.parent / 'other'
        other.mkdir()
        method = self.root / 'other-method.md'
        method.write_text(self.method.read_text())
        state = self.state()
        state['methodology'] = str(method)
        (other / 'state.json').write_text(json.dumps(state))
        registry = self.git('rev-parse', '--path-format=absolute', '--git-path', 'research-lab-engagements')
        with open(registry, 'a') as f:
            f.write(str(other) + '\n')
        self.method.unlink()
        for unreadable in (False, True):
            if unreadable:
                self.method.mkdir()
            r = subprocess.run([sys.executable, str(SCRIPT), 'status', '--all', '--repo', str(self.repo)],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            rows = {row['engagement']: row for row in map(json.loads, r.stdout.splitlines())}
            self.assertEqual(rows[str(self.e)]['budget'], '?')
            self.assertEqual(rows[str(other)]['budget'], 20)

    def test_status_lists_running_engagement(self):
        self.init()
        r = subprocess.run([sys.executable, str(SCRIPT), 'status', '--all', '--repo', str(self.repo)],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        rows = [json.loads(x) for x in r.stdout.splitlines()]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['worktree'], str(self.w))
        self.assertEqual(rows[0]['status'], 'running')
        self.assertEqual((rows[0]['trials_used'], rows[0]['budget']), (0, 20))
