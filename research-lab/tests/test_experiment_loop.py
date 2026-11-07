"""Agent-facing loop acceptance tests using real commits and linked worktrees."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tests.test_experiment_check import CLIMB, SCRIPT


class LoopTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'main'
        self.repo.mkdir()
        self.git('init', '-b', 'main', cwd=self.repo)
        self.git('config', 'user.name', 'Loop Test', cwd=self.repo)
        self.git('config', 'user.email', 'loop@example.invalid', cwd=self.repo)
        self.override = self.root / 'override'
        self.override.write_text('')
        self.w = self.repo
        self.files(metric=10, guard=0, score=100, simplicity=10, readable=0)
        (self.w / 'measure.sh').write_text(
            f'#!/bin/sh\nif [ -s "{self.override}" ]; then cat "{self.override}"; else cat metric; fi\n')
        (self.w / 'measure.sh').chmod(0o755)
        self.git('add', '.')
        self.git('commit', '-m', 'test: seed')
        self.w = self.root / 'trial'
        self.git('worktree', 'add', '-b', 'experiment', str(self.w), cwd=self.repo)
        self.e = self.w / '.experiment' / 'demo'
        self.method = self.root / 'methodology.md'

    def git(self, *args, cwd=None):
        r = subprocess.run(['git', '-C', str(cwd or self.w), *args], text=True, capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.strip()

    def files(self, **values):
        for k, v in values.items():
            (self.w / k).write_text(str(v) + '\n')

    def command(self, *args, ok=True):
        r = subprocess.run([sys.executable, str(SCRIPT), *args, '--engagement', str(self.e)],
                           text=True, capture_output=True, timeout=30)
        self.assertEqual(r.returncode, 0 if ok else 1, r.stdout + r.stderr)
        return json.loads(r.stdout)

    def state(self):
        return json.loads((self.e / 'state.json').read_text())

    def records(self):
        return [json.loads(x) for x in (self.e / 'results.jsonl').read_text().splitlines()]

    def init(self, extra='', strategy='climb', budget=20, target=5, runs=1, ok=True, **kwargs):
        if strategy == 'climb':
            text = CLIMB.replace('**Target:** 200', f'**Target:** {target}')
            text = text.replace('- Budget: 20', f'Budget: {budget}')
            text = text.replace('Measure: echo 240', 'Measure: ./measure.sh')
            text = text.replace('lower is better', kwargs.get('direction', 'lower') + ' is better')
            text = text.replace('Checks: true', 'Checks: test "$(cat guard)" = 0')
        else:
            text = ('## Objective\n## Scope Constraints\n## Working Directory\n'
                    f'Budget: {budget}\nTarget: {target}\nMeasure: ./measure.sh\n'
                    'Checks: test "$(cat guard)" = 0\n')
        self.method.write_text(text + (f'\nRuns: {runs}\n' if runs is not None else '\n') + extra)
        return self.command('init', '--worktree', str(kwargs.get('worktree', self.w)),
                            '--methodology', str(self.method), '--strategy', strategy,
                            '--scorer', 'scripted', ok=ok)

    def baseline(self, **kwargs):
        self.assertEqual(self.command('next')['action'], 'baseline')
        return self.command('baseline', **kwargs)

    def begin(self, change='candidate', tradeoff='one extra branch'):
        self.assertEqual(self.command('next')['action'], 'propose')
        self.command('trial', 'begin', '--change', change, '--tradeoff', tradeoff)
        self.assertEqual(self.command('next')['action'], 'edit')

    def commit(self):
        self.command('trial', 'commit')
        self.assertEqual(self.command('next')['action'], 'resolve')

    def trial(self, value, **values):
        self.begin()
        self.files(metric=value, **values)
        self.commit()
        return self.command('trial', 'score')

    def test_log_failure_replays_pending_keep_and_discard_once(self):
        self.init('Score: cat score\n', strategy='remediate', target=0)
        self.baseline()
        for value, decision, filename in [(8, 'keep', 'results.jsonl'),
                                          (9, 'discard', 'results.jsonl'),
                                          (7, 'keep', 'progress.log'),
                                          (9, 'discard', 'progress.log')]:
            with self.subTest(decision=decision, failed_log=filename):
                self.begin()
                self.files(metric=value, score=101)
                self.commit()
                before = self.state()
                trial = before['trial']['commit']
                blocked = self.e / filename
                backup = blocked.read_text()
                blocked.unlink()
                blocked.mkdir()
                self.command('trial', 'score', ok=False)
                after = self.state()
                for key in ('trials_used', 'consecutive_discards', 'incumbent', 'ratchet', 'score_baseline'):
                    self.assertEqual(after[key], before[key])
                self.assertEqual(after['trial']['pending']['decision'], decision)
                head = self.git('rev-parse', 'HEAD')
                if decision == 'discard':
                    self.assertNotEqual(head, trial)
                blocked.rmdir()
                blocked.write_text(backup)
                self.override.write_text('invalid')  # Replay must not measure again.
                self.command('resume', '--note', 'logging repaired')
                self.assertEqual(self.command('trial', 'score')['decision'], decision)
                final = self.state()
                self.assertIsNone(final['trial'])
                self.assertEqual(final['trials_used'], before['trials_used'] + 1)
                self.assertEqual(final['incumbent'], trial if decision == 'keep' else before['incumbent'])
                self.assertEqual(final['ratchet'], value if decision == 'keep' else before['ratchet'])
                self.assertEqual(final['score_baseline']['median'], 101)
                self.assertEqual(self.git('rev-parse', 'HEAD'), head)
                self.assertEqual(len([r for r in self.records() if r.get('commit') == trial]), 1)
                self.assertEqual(len((self.e / 'progress.log').read_text().splitlines()), len(self.records()))
                self.command('trial', 'score', ok=False)
                self.assertEqual(self.state(), final)
                self.override.write_text('')

    def test_precondition_refusals_leave_state_running(self):
        self.init()
        self.baseline()
        self.begin()
        before = (self.e / 'state.json').read_bytes()
        self.assertIn('commit the trial', self.command('trial', 'score', ok=False)['reason'])
        self.command('baseline', ok=False)
        self.command('confirm', ok=False)
        self.assertEqual((self.e / 'state.json').read_bytes(), before)
        self.assertEqual(self.command('next')['action'], 'edit')
        self.assertEqual(self.state()['status'], 'running')

    def test_commands_refuse_held_lock_and_ignore_stale_pid(self):
        import fcntl
        self.init()
        lock = self.e / '.lock'
        before = (self.e / 'state.json').read_bytes()
        with lock.open('w') as held:
            held.write(str(os.getpid()))
            held.flush()
            fcntl.flock(held, fcntl.LOCK_EX)
            for args in [('baseline',), ('confirm',), ('trial', 'score'), ('trial', 'commit')]:
                out = self.command(*args, ok=False)
                self.assertIn(f'another experiment command is running (pid {os.getpid()})', out['reason'])
                self.assertEqual((self.e / 'state.json').read_bytes(), before)
        # A pid left behind by a killed command (even one now reused by a live
        # process, such as this test) holds no flock, so it never blocks.
        lock.write_text(str(os.getpid()))
        self.baseline()

    def test_measurement_must_leave_tree_clean(self):
        for name, command in [('Measure', './measure.sh; echo generated > artifact; cat metric'),
                              ('Measure', 'echo generated > artifact; exit 1'),
                              ('Checks', 'echo generated > artifact'),
                              ('Score', 'echo generated > artifact; cat score'),
                              ('Tiebreak', 'echo generated > artifact; cat simplicity')]:
            with self.subTest(command=name):
                extra = 'Readability: true\n' if name == 'Tiebreak' else ''
                # Replace the default command rather than adding a duplicate field.
                self.init(extra, strategy='remediate' if name == 'Score' else 'climb')
                text = self.method.read_text()
                if name in ('Measure', 'Checks'):
                    lines = text.splitlines()
                    lines = [name + ': ' + command if line.startswith(name + ':') else line
                             for line in lines]
                    text = '\n'.join(lines) + '\n'
                else:
                    text += name + ': ' + command + '\n'
                (self.e / 'state.json').unlink()
                self.method.write_text(text)
                self.command('init', '--worktree', str(self.w), '--methodology', str(self.method),
                             '--strategy', 'remediate' if name == 'Score' else 'climb',
                             '--scorer', 'scripted')
                reason = self.baseline(ok=False)['reason']
                self.assertIn('artifact', reason)
                self.assertIn('measurement must leave the tree clean', reason)
                self.assertIsNone(self.state()['baseline'])
                self.assertFalse((self.e / 'results.jsonl').exists())
                (self.w / 'artifact').unlink()
                (self.e / 'state.json').unlink()
        for i in range(12):
            self.files(**{f'dirty-{i:02}': 1})
        reason = self.init(ok=False)['reason']
        for i in range(10):
            self.assertIn(f'dirty-{i:02}', reason)
        self.assertNotIn('dirty-10', reason)

    def test_confirmation_rechecks_incumbent_guardrails(self):
        external = {}
        for name in ('guard', 'score'):
            external[name] = self.root / ('external-' + name)
            external[name].write_text((self.w / name).read_text())
            (self.w / name).unlink()
            (self.w / name).symlink_to(external[name])
        self.git('add', 'guard', 'score')
        self.git('commit', '-m', 'test: external guardrails')
        self.init('Score: cat score\n', strategy='remediate', target=0)
        self.baseline()
        self.trial(0)
        for filename, value, reason in [('guard', 1, 'Checks'), ('score', 90, 'Score guardrail')]:
            with self.subTest(guardrail=filename):
                state_before = self.state()
                original = external[filename].read_text()
                external[filename].write_text(str(value) + '\n')
                out = self.command('confirm', ok=False)
                self.assertIn(reason, out['reason'])
                self.assertIn('incumbent', out['reason'])
                self.assertEqual(self.state()['ending']['kind'], 'paused')
                external[filename].write_text(original)
                (self.e / 'state.json').write_text(json.dumps(state_before))

    def test_findings_follow_incumbent_measurements(self):
        self.init(strategy='remediate', target=0)
        self.override.write_text('FINDING F1\nFINDING F2\n10\n')
        self.baseline()
        self.assertEqual(self.state()['findings'], ['F1', 'F2'])
        self.assertEqual(self.command('next')['findings'], ['F1', 'F2'])
        self.override.write_text('FINDING F2\n8\n')
        self.trial(8)
        self.assertEqual(self.command('next')['findings'], ['F2'])
        self.override.write_text('FINDING rejected\n9\n')
        self.trial(9)
        self.assertEqual(self.state()['findings'], ['F2'])
        self.override.write_text('7\n')
        self.trial(7)
        self.assertNotIn('findings', self.state())
        self.assertNotIn('findings', self.command('next'))

    def test_score_metric_uses_same_measure_runs(self):
        counter = self.root / 'measure-count'
        counter.write_text('0')
        (self.w / 'measure.sh').write_text(
            f'#!/bin/sh\nn=$(cat "{counter}"); echo $((n+1)) > "{counter}"\n'
            'echo "METRIC count=$(cat metric)"\necho "METRIC quality=$(cat score)"\n')
        self.git('add', 'measure.sh')
        self.git('commit', '-m', 'test: multi-metric harness')
        self.init('Metric name: count\nScore: METRIC quality\nScore target: 110\n',
                  strategy='remediate', target=0, runs=3)
        self.baseline()
        self.assertEqual(counter.read_text().strip(), '3')
        self.assertEqual(self.state()['score_baseline']['runs'], [100, 100, 100])
        self.assertEqual(self.trial(8, score=90)['decision'], 'retry')
        self.files(score=100)
        self.commit()
        self.command('trial', 'score')
        self.trial(0)
        self.command('confirm')
        self.assertEqual(counter.read_text().strip(), '15')
        self.command('report')
        self.assertIn('Final score: 100;', (self.e / 'report.md').read_text())

    def test_propose_lists_kept_changes_since_baseline(self):
        self.init()
        self.baseline()
        self.assertEqual(self.command('next')['kept'], [])
        self.begin(change='first improvement')
        self.files(metric=8)
        self.commit()
        self.command('trial', 'score')
        self.trial(9)
        self.assertEqual(self.command('next')['kept'], ['first improvement'])
        self.trial(7)
        self.assertEqual(self.command('next')['kept'], ['first improvement', 'candidate'])

    def test_reachable_confirmation_and_run_level_invariants(self):
        self.init(runs=3)
        self.baseline()
        original = self.state()['incumbent']
        self.assertEqual(self.trial(8)['decision'], 'keep')
        kept = self.state()['incumbent']
        self.assertEqual(self.trial(9)['decision'], 'discard')
        discarded = self.records()[-1]['commit']
        revert = self.git('rev-parse', 'HEAD')
        self.assertIn(discarded, self.git('log', '-1', '--format=%B'))
        self.assertEqual(self.git('rev-parse', 'HEAD^{tree}'), self.git('rev-parse', kept + '^{tree}'))
        self.assertEqual(self.command('next')['tried'], ['candidate'])
        self.assertEqual(self.trial(5)['action'], 'confirm')
        self.assertEqual(self.command('next')['action'], 'confirm')
        self.assertEqual(self.command('confirm')['ending']['kind'], 'met')
        self.assertEqual(self.command('next')['action'], 'stop')
        self.assertEqual(len(self.records()), 5)
        self.assertEqual(len((self.e / 'progress.log').read_text().splitlines()), 5)
        for record in self.records()[1:-1]:
            self.assertEqual(self.git('rev-list', '--parents', '-n', '1', record['commit']).split(),
                             [record['commit'], record['base']])
            self.assertEqual(len(record['runs']), 3)
            if record['decision'] == 'keep':
                self.assertTrue(record['tradeoff'])
        self.assertEqual(self.git('rev-list', '--count', original + '..HEAD'), '4')
        self.assertNotEqual(revert, kept)
        self.assertEqual(self.git('status', '--porcelain'), '')

    def test_bound_and_tiebreak_contract_refusals(self):
        self.assertIn('target beyond measured bound', self.init('Bound: 6\n', ok=False)['reason'])
        r = subprocess.run([sys.executable, str(SCRIPT), 'check', '--strategy', 'climb',
                            '--methodology', str(self.method)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertEqual(json.loads(r.stdout)['reason'], 'target beyond measured bound')
        self.assertIn('Readability', self.init('Tiebreak: cat simplicity\n', ok=False)['reason'])

    def test_budget_spent(self):
        self.init(budget=1)
        self.baseline()
        self.assertEqual(self.trial(9)['ending'], {'kind': 'paused', 'detail': 'budget spent'})
        self.assertEqual(self.command('next')['action'], 'stop')

    def test_escalation_resets_counter_and_exhausts(self):
        self.init('Futility: 2\n')
        self.baseline()
        for i in range(8):
            self.trial(11)
            s = self.state()
            self.assertEqual(s['escalation'], (i + 1) // 2)
            self.assertEqual(s['consecutive_discards'], (i + 1) % 2)
            if i < 7:
                out = self.command('next')
                self.assertEqual(out['escalation'], (i + 1) // 2)
                self.assertTrue(out['level_name'])
        self.assertIn('ladder exhausted', self.state()['ending']['detail'])
        self.assertEqual(self.command('next')['action'], 'stop')

    def test_guard_retry_amends_one_commit(self):
        self.init()
        self.baseline()
        out = self.trial(8, guard=1)
        self.assertEqual((out['decision'], out['action']), ('retry', 'rework'))
        t = self.state()['trial']
        self.assertEqual(self.command('next')['action'], 'edit')
        self.files(guard=0)
        self.commit()
        self.assertNotEqual(self.state()['trial']['commit'], t['commit'])
        self.assertEqual(self.command('trial', 'score')['decision'], 'keep')
        self.assertEqual(self.git('rev-list', '--count', t['base'] + '..HEAD'), '1')
        self.assertEqual([r['decision'] for r in self.records()], ['keep', 'retry', 'keep'])
        self.assertEqual(self.state()['trials_used'], 1)

    def test_second_guard_failure_discards(self):
        self.init()
        self.baseline()
        self.trial(8, guard=1)
        base = self.state()['trial']['base']
        self.files(metric=7)
        self.commit()
        self.assertEqual(self.command('trial', 'score')['decision'], 'discard')
        self.assertEqual(self.git('rev-parse', 'HEAD^{tree}'), self.git('rev-parse', base + '^{tree}'))
        self.assertEqual(self.state()['trials_used'], 1)

    def test_invalid_measurement_preserves_unresolved_trial_and_log(self):
        self.init()
        self.baseline()
        self.begin()
        self.files(metric=8)
        self.commit()
        before = self.state()
        self.override.write_text('not numeric\n')
        self.command('trial', 'score', ok=False)
        after = self.state()
        self.assertEqual(before['trial'], after['trial'])
        self.assertEqual(before['ratchet'], after['ratchet'])
        self.assertEqual(len(self.records()), 1)
        self.assertEqual(self.command('next')['action'], 'pause')

    def test_discard_refusal_preserves_trial_without_decision(self):
        self.init()
        self.baseline()
        self.begin()
        self.files(metric=11)
        # Deleting a tracked file then placing an ignored obstruction exercises
        # discard-trial's restore-path guard without making the tree dirty.
        (self.w / 'readable').unlink()
        self.commit()
        exclude = Path(self.git('rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'))
        with exclude.open('a') as f:
            f.write('\n/readable\n')
        self.files(readable='obstruction')
        before = self.state()
        out = self.command('trial', 'score', ok=False)
        self.assertIn('discard refused', out['reason'])
        trial = self.state()['trial']
        self.assertEqual(trial.pop('pending')['decision'], 'discard')
        self.assertEqual(trial, before['trial'])
        self.assertEqual(self.state()['trials_used'], 0)
        self.assertEqual(self.command('next')['action'], 'pause')
        self.assertEqual(len(self.records()), 1)

    def test_tiebreak_requires_strictly_simpler_and_readable(self):
        self.init('Margin: 2\nTiebreak: cat simplicity\nReadability: test "$(cat readable)" = 0\n')
        self.baseline()
        self.assertEqual(self.trial(9, simplicity=10)['decision'], 'discard')
        self.assertEqual(self.trial(9, simplicity=9, readable=1)['decision'], 'discard')
        out = self.trial(9, simplicity=9)
        self.assertEqual((out['decision'], out['reason']), ('keep', 'simplicity tie-break'))
        self.assertEqual(self.state()['tiebreak'], 9)

    def test_tie_without_declarations_discards(self):
        self.init('Margin: 2\n')
        self.baseline()
        self.assertEqual(self.trial(9, simplicity=9)['decision'], 'discard')

    def test_remediate_count_falls_then_zero_confirms(self):
        self.init(strategy='remediate', target=0)
        self.baseline()
        self.assertEqual(self.trial(8)['decision'], 'keep')
        self.assertEqual(self.trial(0)['action'], 'confirm')
        self.assertEqual(self.command('confirm')['ending']['kind'], 'met')

    def test_remediate_exception_ending(self):
        self.init(strategy='remediate', target=0)
        self.baseline()
        self.trial(1)
        self.command('exception', 'add', '--finding', 'F1', '--kind', 'scope', '--evidence', 'vendor code')
        self.assertEqual(self.command('next')['action'], 'confirm')
        self.assertEqual(self.command('confirm')['ending']['kind'], 'exceptions')

    def test_score_guardrail_retry_then_discard(self):
        self.init('Score: cat score\n', strategy='remediate', target=0)
        self.baseline()
        self.assertEqual(self.state()['score_baseline']['median'], 100)
        self.assertEqual(self.trial(8, score=90)['decision'], 'retry')
        self.files(metric=7)
        self.commit()
        out = self.command('trial', 'score')
        self.assertEqual(out['decision'], 'discard')
        self.assertIn('Score guardrail', out['reason'])
        self.assertEqual(self.state()['ratchet'], 10)
        self.assertEqual((self.w / 'score').read_text().strip(), '100')

    def test_confirm_miss_continues_and_next_is_readonly(self):
        self.init()
        self.baseline()
        self.trial(5)
        self.override.write_text('6\n')
        self.assertEqual(self.command('confirm')['action'], 'propose')
        self.assertEqual(self.state()['ratchet'], 6)
        self.assertEqual(self.records()[-1]['reason'], 'confirmation missed target')
        before = (self.e / 'state.json').read_bytes()
        self.command('next')
        self.assertEqual((self.e / 'state.json').read_bytes(), before)

    def test_conclude_and_evidence_validation(self):
        self.init()
        self.baseline()
        self.command('conclude', '--kind', 'bound', '--evidence', '', ok=False)
        out = self.command('conclude', '--kind', 'bound', '--evidence', 'physical limit measured')
        self.assertEqual(out['ending']['kind'], 'unreachable')

    def test_init_refuses_primary_dirty_and_duplicate(self):
        self.init(worktree=self.repo, ok=False)
        self.files(metric=11)
        self.assertIn('dirty', self.init(ok=False)['reason'])
        self.git('restore', 'metric')
        self.init()
        s = self.state()
        self.assertEqual(s['methodology_sha256'], hashlib.sha256(self.method.read_bytes()).hexdigest())
        self.assertEqual(s['scorer_sha256'], {str((self.w / 'measure.sh').resolve()):
                         hashlib.sha256((self.w / 'measure.sh').read_bytes()).hexdigest()})
        self.assertIn('already exists', self.init(ok=False)['reason'])

    def test_baseline_failure_has_no_record(self):
        self.files(guard=1)
        self.git('add', '.')
        self.git('commit', '-m', 'test: failing guard')
        self.init()
        self.baseline(ok=False)
        self.assertIsNone(self.state()['baseline'])
        self.assertFalse((self.e / 'results.jsonl').exists())
        self.assertEqual(self.command('next')['action'], 'pause')

    def test_metric_selection_legacy_and_mad(self):
        self.init('Metric name: latency\n', runs=3)
        self.override.write_text('diagnostic\nMETRIC unrelated=100\nMETRIC latency=10\n')
        self.baseline()
        self.assertEqual(self.state()['baseline'], {'median': 10, 'runs': [10, 10, 10], 'mad': 0})

    def test_ambiguous_metric_and_command_exit_refuse(self):
        for output in ('METRIC a=10\nMETRIC b=11\n', 'NaN\n', '2 3\n'):
            with self.subTest(output=output):
                self.init()
                self.override.write_text(output)
                self.baseline(ok=False)
                self.assertIsNone(self.state()['baseline'])
                (self.e / 'state.json').unlink()
        self.override.write_text('')
        self.init('')
        (self.w / 'measure.sh').write_text('#!/bin/sh\nexit 1\n')
        self.git('add', '.')
        self.git('commit', '-m', 'test: command fails')
        # Reinitialize to record the actual incumbent before measuring.
        (self.e / 'state.json').unlink()
        self.init()
        self.baseline(ok=False)
        self.assertIn('command failed', self.state()['ending']['detail'])


    def test_default_runs_median_absolute_deviation_and_margin(self):
        counter = self.root / 'counter'
        counter.write_text('0')
        (self.w / 'measure.sh').write_text(
            f'#!/bin/sh\nn=$(cat "{counter}"); n=$((n+1)); echo "$n" > "{counter}"\n'
            'case "$n" in 1) echo 8;; 2) echo 10;; 3) echo 12;; *) cat metric;; esac\n')
        self.git('add', '.')
        self.git('commit', '-m', 'test: noisy baseline')
        self.init(runs=None)
        self.baseline()
        self.assertEqual(self.state()['baseline'], {'median': 10, 'runs': [8, 10, 12], 'mad': 2})
        self.assertEqual(self.state()['margin'], 4)
        self.assertEqual(self.trial(7)['decision'], 'discard')
        self.assertEqual(self.trial(5)['decision'], 'keep')

    def test_higher_direction_bound_and_target(self):
        self.init('Bound: 11\n', direction='higher', target=12, ok=False)
        self.init('Bound: 15\n', direction='higher', target=12)
        self.baseline()
        self.assertEqual(self.trial(11)['decision'], 'keep')
        self.assertEqual(self.trial(12)['action'], 'confirm')
        self.assertEqual(self.command('confirm')['ending']['kind'], 'met')

    def test_trial_command_preconditions(self):
        self.init()
        self.command('trial', 'begin', '--change', 'x', '--tradeoff', 'y', ok=False)
        self.baseline()
        self.command('trial', 'begin', '--change', 'x', '--tradeoff', ' ', ok=False)
        self.begin()
        self.command('trial', 'begin', '--change', 'x', '--tradeoff', 'y', ok=False)
        self.command('trial', 'commit', ok=False)
        self.files(metric=8)
        self.commit()
        self.command('trial', 'commit', ok=False)
        self.assertEqual(self.command('trial', 'score')['decision'], 'keep')
        self.files(metric=7)
        self.command('trial', 'begin', '--change', 'x', '--tradeoff', 'y', ok=False)

    def test_insensitive_harness_refuses_to_freeze_baseline(self):
        # Lower is better; a known-worse variant that measures the same as baseline proves nothing.
        self.init('Sensitivity: echo 10\n')
        reason = self.baseline(ok=False)['reason']
        self.assertIn('harness is not sensitive', reason)
        self.assertIsNone(self.state()['baseline'])

    def test_sensitive_harness_freezes_baseline_and_records_it(self):
        self.init('Sensitivity: echo 20\n')
        self.baseline()
        self.assertEqual(self.state()['baseline']['median'], 10)
        self.assertEqual(self.records()[0]['sensitivity'], {'median': 20, 'runs': [20]})

    def test_harness_errors_or_no_work_refuse_the_baseline(self):
        for extra, phrase in [('Errors: echo 2\n', 'harness reported 2 errors'),
                              ('Work: echo 0\n', 'no work done')]:
            with self.subTest(extra=extra):
                self.init(extra)
                self.assertIn(phrase, self.baseline(ok=False)['reason'])
                self.assertIsNone(self.state()['baseline'])
                (self.e / 'state.json').unlink()

    def test_harness_counts_are_recorded_and_a_trial_with_errors_is_refused(self):
        self.init('Errors: cat errors 2>/dev/null || echo 0\nWork: echo 7\n')
        self.baseline()
        self.assertEqual(self.records()[0]['harness'], {'errors': 0, 'work': 7})
        self.assertEqual(self.trial(8)['decision'], 'keep')
        self.assertEqual(self.records()[-1]['harness'], {'errors': 0, 'work': 7})
        self.begin()
        self.files(metric=6, errors=1)
        self.commit()
        self.assertIn('harness reported 1 errors', self.command('trial', 'score', ok=False)['reason'])


if __name__ == '__main__':
    unittest.main()
