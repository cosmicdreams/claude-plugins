"""Compare acceptance contracts through the public CLI and disposable worktrees."""
import json
import random
import shutil
import signal
from pathlib import Path
import subprocess
import sys
import time
import unittest

from tests.test_experiment_check import SCRIPT
from tests.test_experiment_report import ReportTests


class CompareTests(ReportTests):
    def init_compare(self, extra='', mode='given', runs=3, budget=30, ok=True):
        text = ('## Objective\n## Scope Constraints\n## Working Directory\n'
                'Measure: ./measure.sh\nChecks: test "$(cat guard)" = 0\n'
                f'Direction: lower\nBudget: {budget}\nRuns: {runs}\nVariants: {mode}\n')
        if mode == 'given':
            text += 'Variant a: first approach\nVariant b: second approach\n'
        self.method.write_text(text + extra)
        return self.command('init', '--worktree', str(self.w), '--methodology', str(self.method),
                            '--strategy', 'compare', '--scorer', 'scripted', ok=ok)

    def variant(self, name, metric, guard=0, description=None):
        args = ['variant', 'begin', '--name', name, '--tradeoff', 'cost of ' + name]
        if description:
            args += ['--description', description]
        self.command(*args)
        self.files(metric=metric, guard=guard)
        return self.command('variant', 'commit')

    def report(self):
        self.command('report')
        return (self.e / 'report.md').read_text()

    def assert_base(self):
        s = self.state()
        self.assertEqual(self.git('symbolic-ref', '--short', 'HEAD'), 'experiment')
        self.assertEqual(self.git('rev-parse', 'HEAD'), s['base'])
        self.assertEqual(self.git('rev-parse', 'experiment'), s['base'])
        self.assertEqual(self.git('status', '--porcelain'), '')
        for n, v in s['variants'].items():
            if n != 'incumbent' and v['commit']:
                self.assertEqual(self.git('rev-list', '--parents', '-n', '1', v['commit']).split(),
                                 [v['commit'], s['base']])

    def test_detached_variant_recovers_on_locked_command(self):
        self.init_compare()
        self.variant('a', 5)
        self.variant('b', 8)
        for command, commit in [('measure', 'a'), ('confirm', None), ('report', 'a')]:
            s = self.state()
            self.git('switch', '--detach', s['variants'][commit]['commit'] if commit else s['base'])
            self.command(command)
            self.assert_base()

    def test_sigterm_restores_measurement_checkout(self):
        ready = self.root / 'ready'
        (self.w / 'measure.sh').write_text(
            f'#!/bin/sh\ntouch "{ready}"\nsleep 1\ncat metric\n')
        self.git('add', 'measure.sh')
        self.git('commit', '-m', 'test: interruptible scorer')
        self.init_compare()
        self.variant('a', 5)
        self.variant('b', 8)
        proc = subprocess.Popen([sys.executable, str(SCRIPT), 'measure', '--engagement', str(self.e)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 10
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue(ready.exists())
            proc.terminate()
            proc.communicate(timeout=10)
            self.assertNotEqual(proc.returncode, 0)
            self.assert_base()
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.communicate(timeout=10)

    def test_interrupted_confirmation_resumes_within_exact_budget(self):
        for interrupt in (signal.SIGTERM, signal.SIGINT):
            with self.subTest(signal=interrupt):
                self.setUp()
                counter = self.root / 'confirmation-count'
                ready = self.root / 'ready'
                (self.w / 'measure.sh').write_text(
                    f'#!/bin/sh\nif [ -f "{counter}" ]; then\n'
                    f'  n=$(cat "{counter}"); n=$((n+1)); echo "$n" > "{counter}"\n'
                    f'  if [ "$n" = 2 ]; then touch "{ready}"; sleep 1; fi\n'
                    'fi\ncat metric\n')
                self.git('add', 'measure.sh')
                self.git('commit', '-m', 'test: interruptible confirmation')
                self.init_compare(runs=3, budget=9)
                self.variant('a', 5)
                self.variant('b', 8)
                self.command('measure')
                counter.write_text('0')
                proc = subprocess.Popen(
                    [sys.executable, str(SCRIPT), 'confirm', '--engagement', str(self.e)],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    deadline = time.monotonic() + 10
                    while not ready.exists() and time.monotonic() < deadline:
                        time.sleep(.02)
                    self.assertTrue(ready.exists())
                    proc.send_signal(interrupt)
                    proc.communicate(timeout=10)
                    self.assertNotEqual(proc.returncode, 0)
                finally:
                    if proc.poll() is None:
                        proc.kill()
                        proc.communicate(timeout=10)
                s = self.state()
                self.assertEqual(s['confirmation_partial']['runs'], [5])
                self.assertEqual(s['measurements_used'], 7)
                self.assertEqual(s['variants']['a']['status'], 'measured')
                self.assert_base()
                self.assertEqual(self.command('confirm')['ending']['winner'], 'a')
                s = self.state()
                self.assertEqual(s['measurements_used'], 9)
                self.assertEqual(s['confirmation']['runs'], [5, 5, 5])
                self.assertNotIn('confirmation_partial', s)
                self.assertEqual(s['variants']['a']['status'], 'measured')
                self.assertEqual(len([r for r in self.records() if r['decision'] == 'confirm']), 1)
                self.assert_base()

    def test_finished_report_without_worktree(self):
        self.e = self.root / 'engagement'
        self.init_compare()
        self.variant('a', 5)
        self.variant('b', 8)
        self.command('measure')
        self.command('confirm')
        shutil.rmtree(self.w)
        report = self.report()
        self.assertIn('Winner: a; basis: margin', report)
        self.assertIn('a (chosen)', report)
        self.assertIn('Checks: n/a (worktree unavailable)', report)
        self.assertIn('Scorer files unchanged: n/a (worktree unavailable)', report)
        self.assertIn('VALIDITY NOT RE-VERIFIED', report)
        self.assertIn('Confirmation present: PASS', report)

    def test_resumed_measure_summarizes_previously_failed_variants(self):
        for status, runs in (('invalid', []), ('fails checks', [5])):
            for other_pending in (False, True):
                with self.subTest(status=status, other_pending=other_pending):
                    self.setUp()
                    self.init_compare(runs=1)
                    self.variant('a', 5)
                    self.variant('b', 8)
                    s = self.state()
                    s['variants']['a'].update(status=status, runs=runs, reason='failed before interruption')
                    s['measurements_used'] = len(runs)
                    if not other_pending:
                        s['variants']['b'].update(status='fails checks', runs=[8], checks=False,
                                                  reason='Checks failed')
                        s['measurements_used'] += 1
                    (self.e / 'state.json').write_text(json.dumps(s))
                    self.assertEqual(self.command('next')['action'], 'measure')
                    self.command('measure')
                    s = self.state()
                    self.assertEqual(s['variants']['a']['median'], 5 if runs else None)
                    self.assertEqual(s['variants']['a']['status'], status)
                    rows = self.records()
                    self.assertEqual(sorted(r['variant'] for r in rows), ['a', 'b'])
                    self.assertTrue(all(r['decision'] == 'measured' for r in rows))
                    self.assertEqual(s['measurements_used'], len(runs) + 1)
                    self.assert_base()

    def test_resumed_sample_without_checks_runs_checks(self):
        self.init_compare(runs=1)
        self.variant('a', 5, guard=1)
        self.variant('b', 8)
        s = self.state()
        s['variants']['a']['runs'] = [5]
        s['measurements_used'] = 1
        (self.e / 'state.json').write_text(json.dumps(s))
        self.command('measure')
        self.assertFalse(self.state()['variants']['a']['checks'])
        self.assertEqual(self.state()['variants']['a']['status'], 'fails checks')
        self.assertEqual(self.state()['measurements_used'], 2)
        self.assert_base()

    def test_rejected_commit_cleans_variant_and_grid_branches(self):
        for mode in ('given', 'grid'):
            with self.subTest(mode=mode):
                self.setUp()
                self.init_compare('Grid x: 5,8\nApply: echo {x} > metric\n' if mode == 'grid' else '', mode=mode)
                hooks = self.root / 'hooks'
                hooks.mkdir()
                hook = hooks / 'pre-commit'
                hook.write_text('#!/bin/sh\nexit 1\n')
                hook.chmod(0o755)
                self.git('config', 'core.hooksPath', str(hooks))
                if mode == 'given':
                    self.command('variant', 'begin', '--name', 'a', '--tradeoff', 'cost')
                    self.files(metric=5)
                    self.command('variant', 'commit', ok=False)
                    self.assertEqual(self.git('branch', '--list', 'experiment--a'), '')
                    hook.unlink()
                    self.command('variant', 'commit')
                    self.assertIn('a', self.state()['variants'])
                else:
                    self.command('grid', 'build')
                    self.assertTrue(all(v['status'] == 'invalid' for v in self.state()['variants'].values()))
                    self.assertEqual(self.git('branch', '--list', 'experiment--p*'), '')
                self.assert_base()

    def test_confirmation_fallback_reapplies_incumbent_and_margin(self):
        for failure, incumbent in ((False, False), (True, False), (False, True), (True, True)):
            with self.subTest(failure=failure, incumbent=incumbent):
                self.setUp()
                self.init_compare('Margin: 2\nVariant c: third approach\n' +
                                  ('Include incumbent: yes\n' if incumbent else ''))
                self.variant('a', 5)
                self.variant('b', 14 if incumbent else 8)
                self.variant('c', 20)
                self.command('measure')
                self.override.write_text('bad metric\n' if failure else '18\n')
                out = self.command('confirm')
                if incumbent:
                    self.assertEqual(out['ending']['detail'], 'no variant beats the incumbent')
                else:
                    self.assertEqual((out['action'], out['group']), ('decide', ['b']))
                    self.command('decide', '--choose', 'c', '--reason', 'outsider', ok=False)
                self.assertLessEqual(self.state()['measurements_used'], 15)
                self.assert_base()

    def test_resumed_measure_preserves_seed_and_order(self):
        self.init_compare()
        self.variant('a', 5)
        self.variant('b', 8)
        s = self.state()
        seed = s['seed']
        row = list(s['variants'])
        random.Random(seed).shuffle(row)
        s['order'] = [row]
        s['variants'][row[0]].update(runs=[5 if row[0] == 'a' else 8], checks=True)
        s['measurements_used'] = 1
        (self.e / 'state.json').write_text(json.dumps(s))
        self.command('measure')
        s = self.state()
        self.assertEqual((s['seed'], len(s['order']), s['order'][0]), (seed, 3, row))
        self.assertEqual(s['measurements_used'], 6)
        self.assertEqual(s['variants']['a']['runs'], [5, 5, 5])
        self.assertIn(f'Measurement order interleaved (seed {seed}): PASS', self.report())
        self.assert_base()

    def test_pending_grid_surface_uses_status(self):
        self.init_compare('Grid x: 5,8\nApply: echo {x} > metric\n', mode='grid')
        self.command('grid', 'build')
        self.assertIn('| p1 | 5 | pending |', self.report())
        self.assertIn('| p2 | 8 | pending |', self.report())
        self.assert_base()

    def test_unusable_incumbent_is_explained_in_report(self):
        for status, reason in (('fails checks', 'Checks failed'), ('invalid', 'measurement failed')):
            with self.subTest(status=status):
                self.setUp()
                self.init_compare('Include incumbent: yes\n')
                self.variant('a', 5)
                self.variant('b', 8)
                s = self.state()
                s['variants']['incumbent'].update(status=status, reason=reason)
                (self.e / 'state.json').write_text(json.dumps(s))
                self.command('measure')
                self.assertIn('The incumbent was not a usable comparison: ' + reason, self.report())
                self.assert_base()

    def test_confirmation_log_and_report_evidence(self):
        for value, outcome in [(6, 'held'), (10, 'within noise')]:
            with self.subTest(outcome=outcome):
                self.setUp()
                self.init_compare('Margin: 2\n')
                self.variant('a', 5)
                self.variant('b', 11)
                self.command('measure')
                self.override.write_text(str(value) + '\n')
                self.command('confirm')
                row = self.records()[-1]
                self.assertEqual(row['decision'], 'confirm')
                self.assertEqual({k: row[k] for k in ('variant', 'runs', 'mad', 'median', 'outcome')},
                                 dict(variant='a', runs=[value] * 3, mad=0, median=value, outcome=outcome))
                self.assertEqual((row['metric_before'], row['metric_after']), (5, value))
                report = self.report()
                self.assertIn('Confirmation runs | Confirmation median | Decision used', report)
                self.assertIn(f"| 5 | 0 | {[float(value)] * 3} | {value} | confirmation median {value} |", report)
                self.assert_base()

    def test_add_variants_remaining(self):
        self.init_compare('Include incumbent: yes\n')
        self.assertEqual(self.command('next')['remaining'], ['a', 'b'])
        self.variant('a', 5)
        self.assertEqual(self.command('next')['remaining'], ['b'])
        self.command('variant', 'begin', '--name', 'b', '--tradeoff', 'cost')
        self.assertEqual(self.command('next')['remaining'], ['b'])
        self.setUp()
        self.init_compare('Count: 2\nIdea: alternatives\nInclude incumbent: yes\n', mode='generated')
        self.assertEqual(self.command('next')['remaining_count'], 2)
        self.variant('a', 5, description='first alternative')
        self.assertEqual(self.command('next')['remaining_count'], 1)
        self.command('variant', 'discard', '--name', 'a')
        self.assertEqual(self.command('next')['remaining_count'], 2)

    def test_iterations_count_records_not_measurements(self):
        self.init_compare('Include incumbent: yes\n')
        self.variant('a', 5)
        self.variant('b', 8)
        self.command('measure')
        self.assertEqual([r['iteration'] for r in self.records()], [1, 2, 3])
        self.assertEqual(self.state()['measurements_used'], 9)
        self.command('confirm')
        self.assertEqual([r['iteration'] for r in self.records()], [1, 2, 3, 4])
        self.assertEqual(self.state()['measurements_used'], 12)
        self.assertEqual(len((self.e / 'progress.log').read_text().splitlines()), 4)

    def test_report_metric_margin_revision_and_not_viable(self):
        cases = [('Metric name: latency\nMargin: 1\n', 'latency', 'declared Margin: 1', False),
                 ('', 'duration', '2 × pooled MAD = 4', False),
                 ('', 'metric', '2 × pooled MAD = 0', True)]
        for extra, metric, margin, failure in cases:
            with self.subTest(metric=metric):
                self.setUp()
                if metric != 'metric':
                    counter = self.root / 'counts'
                    counter.mkdir()
                    scorer = (f'#!/bin/sh\nm=$(cat metric); p="{counter}/$m"; n=0; '
                              '[ ! -f "$p" ] || n=$(cat "$p"); n=$((n+1)); echo "$n" > "$p"\n'
                              'echo "METRIC duration=$((m + 2 * n))"\n')
                    if metric == 'latency':
                        scorer = '#!/bin/sh\necho METRIC other=100\necho "METRIC latency=$(cat metric)"\n'
                    (self.w / 'measure.sh').write_text(scorer)
                    self.git('add', 'measure.sh')
                    self.git('commit', '-m', 'test: named scorer')
                self.init_compare(extra + 'Held-out: test "$(cat metric)" = 5\n')
                self.variant('a', 5)
                self.variant('b', 8, guard=int(failure))
                action = self.command('measure')['action']
                if action == 'confirm':
                    self.command('confirm')
                else:
                    self.command('decide', '--choose', 'a', '--reason', 'lower cost')
                report = self.report()
                self.assertIn(f'| Variant | {metric} |', report)
                self.assertIn('Margin used: ' + margin, report)
                self.assertIn('## Not viable\n\n' + ('- b: Checks failed' if failure else 'None.'), report)
                chosen = self.state()['variants']['a']
                worth = report.split('## Worth keeping', 1)[1]
                self.assertIn(f"Evaluated commit `{chosen['commit']}` (branch `{chosen['branch']}`).", worth)
                self.assertIn('Held-out: PASS', worth)
                self.assertIn('Checks: PASS', worth)
                self.assert_base()

    def test_given_clear_winner_confirmation_report_and_interleaving(self):
        self.init_compare('Held-out: test "$(cat metric)" = 5\n')
        self.assertEqual(self.command('next')['action'], 'add-variants')
        self.variant('a', 5)
        self.variant('b', 8)
        self.assertEqual(self.command('measure')['action'], 'confirm')
        s = self.state()
        self.assertIsInstance(s['seed'], int)
        self.assertEqual(len(s['order']), 3)
        self.assertNotEqual(s['order'][0], s['order'][1])
        self.assertEqual(self.command('confirm')['ending']['winner'], 'a')
        self.assertEqual(self.state()['ending']['basis'], 'margin')
        self.assertEqual(self.state()['measurements_used'], 9)
        self.assertEqual(len(self.records()), 3)
        for row in self.records()[:2]:
            for key in ('strategy', 'variant', 'commit', 'runs', 'mad', 'checks', 'tradeoff'):
                self.assertIn(key, row)
            self.assertEqual(row['decision'], 'measured')
        self.assertEqual(len((self.e / 'progress.log').read_text().splitlines()), 3)
        report = self.report()
        for text in ('a (chosen)', 'experiment--a', 'Held-out: PASS', 'Checks: PASS',
                     'Scorer files unchanged: PASS', 'Each variant is one commit on base: PASS',
                     'Experiment branch never moved: PASS', 'Confirmation present: PASS',
                     'Measurement order interleaved (seed'):
            self.assertIn(text, report)
        self.assert_base()

    def test_within_noise_tradeoffs_and_reject_outsider(self):
        self.init_compare('Margin: 2\n')
        self.variant('a', 5)
        self.variant('b', 6)
        out = self.command('measure')
        self.assertEqual((out['action'], out['group']), ('decide', ['a', 'b']))
        self.command('decide', '--choose', 'incumbent', '--reason', 'x', ok=False)
        self.command('decide', '--choose', 'b', '--reason', '', ok=False)
        self.assertEqual(self.command('decide', '--choose', 'b', '--reason', 'less maintenance')['ending']['basis'], 'trade-offs')
        self.assertIn('b (chosen)', self.report())
        self.assert_base()

    def test_all_checks_fail(self):
        self.init_compare()
        self.variant('a', 5, guard=1)
        self.variant('b', 6, guard=1)
        out = self.command('measure')
        self.assertEqual(out['ending']['kind'], 'no-path')
        self.assertEqual(out['ending']['detail'], 'no variant is viable')
        self.assertEqual(len(out['ending']['reasons']), 2)
        self.assertIn('Checks failed', self.report())
        self.assert_base()

    def test_incumbent_unbeaten(self):
        self.init_compare('Include incumbent: yes\n')
        self.variant('a', 11)
        self.variant('b', 12)
        self.assertEqual(self.command('measure')['ending']['detail'], 'no variant beats the incumbent')
        self.assert_base()

    def test_incumbent_beaten(self):
        self.init_compare('Include incumbent: yes\n')
        self.variant('a', 5)
        self.variant('b', 12)
        self.assertEqual(self.command('measure')['action'], 'confirm')
        self.assertEqual(self.command('confirm')['ending']['winner'], 'a')

    def test_grid_surface_sensitivity_and_invalid_point(self):
        self.init_compare('Grid x: 1, 2\nGrid y: 1, 2, 3\n'
            'Apply: test "{x},{y}" != "2,3" && echo $(({x} * 10 + {y})) > metric\n', mode='grid')
        self.assertEqual(self.command('next')['action'], 'build-grid')
        self.assertEqual(self.command('grid', 'build')['action'], 'measure')
        self.assertEqual(self.state()['variants']['p6']['status'], 'invalid')
        self.assertEqual(self.command('measure')['action'], 'confirm')
        self.command('confirm')
        report = self.report()
        self.assertIn('## Response surface', report)
        self.assertIn('### Parameter sensitivity', report)
        self.assertIn('| p6 | 2 | 3 | invalid |', report)
        self.assertIn('- x: 9.5', report)
        self.assertIn('Each variant is one commit on base: PASS', report)
        self.assert_base()

    def test_grid_empty_point_and_shell_quoting(self):
        self.init_compare("Grid x: unchanged, a'; touch INJECTED; echo '\n"
                          "Apply: if [ {x} != unchanged ]; then printf '%s' {x} > metric; fi\n", mode='grid')
        self.command('grid', 'build')
        self.assertIn('empty change', self.state()['variants']['p1']['reason'])
        self.assertFalse((self.w / 'INJECTED').exists())
        self.assert_base()

    def test_measure_failure_continues_and_restores(self):
        (self.w / 'measure.sh').write_text('#!/bin/sh\ntest "$(cat metric)" != 5 || exit 1\ncat metric\n')
        self.git('add', 'measure.sh')
        self.git('commit', '-m', 'test: failing measurement')
        self.init_compare()
        self.variant('a', 5)
        self.variant('b', 6)
        self.assertEqual(self.command('measure')['action'], 'confirm')
        self.assertEqual(self.state()['variants']['a']['status'], 'invalid')
        self.assertEqual(self.state()['variants']['b']['runs'], [6, 6, 6])
        self.assertEqual(len(self.records()), 2)
        self.assert_base()

    def test_dirty_measurement_restores_and_marks_invalid(self):
        (self.w / 'measure.sh').write_text('#!/bin/sh\necho temporary > artifact\necho 5\n')
        self.git('add', 'measure.sh')
        self.git('commit', '-m', 'test: dirty harness')
        self.init_compare()
        self.variant('a', 5)
        self.variant('b', 6)
        self.assertEqual(self.command('measure')['ending']['kind'], 'no-path')
        self.assertFalse((self.w / 'artifact').exists())
        self.assert_base()

    def test_confirmation_miss_requires_tradeoffs(self):
        self.init_compare('Margin: 2\n')
        self.variant('a', 5)
        self.variant('b', 11)
        self.command('measure')
        self.override.write_text('10\n')
        self.assertEqual(self.command('confirm')['action'], 'decide')
        self.assertEqual(set(self.state()['group']), {'a', 'b'})
        self.command('decide', '--choose', 'a', '--reason', 'lower cost')
        self.assertEqual(self.state()['ending']['basis'], 'trade-offs')
        self.assert_base()

    def test_generated_description_discard_and_preconditions(self):
        self.init_compare('Count: 2\nIdea: alternatives\n', mode='generated')
        self.command('variant', 'begin', '--name', 'a', '--tradeoff', 'cost', ok=False)
        self.command('variant', 'begin', '--name', 'BAD', '--tradeoff', 'cost', '--description', 'x', ok=False)
        self.variant('a', 5, description='first alternative')
        self.command('variant', 'discard', '--name', 'a')
        self.assertEqual(self.git('branch', '--list', 'experiment--a'), '')
        self.variant('a', 5, description='first alternative')
        self.variant('b', 6, description='second alternative')
        self.command('measure')
        self.command('variant', 'discard', '--name', 'a', ok=False)
        self.assert_base()

    def test_measure_lock_and_hook_silence(self):
        ready = self.root / 'ready'
        release = self.root / 'release'
        (self.w / 'measure.sh').write_text(f'#!/bin/sh\ntouch "{ready}"\nwhile [ ! -f "{release}" ]; do sleep .05; done\ncat metric\n')
        self.git('add', 'measure.sh')
        self.git('commit', '-m', 'test: blocking scorer')
        self.init_compare(runs=1)
        self.variant('a', 5)
        self.variant('b', 6)
        proc = subprocess.Popen([sys.executable, str(SCRIPT), 'measure', '--engagement', str(self.e)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 10
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue(ready.exists())
            out = self.command('measure', ok=False)
            self.assertIn('another experiment command', out['reason'])
            hook = SCRIPT.parents[3] / 'hooks' / 'keepgoing.py'
            r = subprocess.run([sys.executable, str(hook), 'stop'], input=json.dumps({'cwd': str(self.w)}), capture_output=True, text=True)
            self.assertEqual(r.stdout, '')
        finally:
            release.touch()
            stdout, stderr = proc.communicate(timeout=15)
        self.assertEqual(proc.returncode, 0, stdout + stderr)
        self.assert_base()

    def test_check_refusals(self):
        cases = [('', 'given', 8), ('Count: 1\nIdea: x\n', 'generated', 30),
                 ('Count: 2\n', 'generated', 30), ('Grid x: 1,2\n', 'grid', 30),
                 ('Grid x: ' + ','.join(map(str, range(65))) + '\nApply: true\n', 'grid', 300)]
        for extra, mode, budget in cases:
            with self.subTest(mode=mode, extra=extra):
                out = self.init_compare(extra, mode=mode, budget=budget, ok=False)
                self.assertTrue(out['reason'])
        self.init_compare()
        (self.e / 'state.json').unlink()
        for field in ('Measure', 'Checks', 'Direction', 'Budget', 'Variants'):
            text = self.method.read_text()
            self.method.write_text('\n'.join(line for line in text.splitlines() if not line.startswith(field + ':')))
            r = subprocess.run([sys.executable, str(SCRIPT), 'check', '--strategy', 'compare', '--methodology', str(self.method)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1, r.stdout)
            self.method.write_text(text)

    def test_all_grid_points_invalid(self):
        self.init_compare('Grid x: 1,2\nApply: false\n', mode='grid')
        out = self.command('grid', 'build')
        self.assertEqual(out['ending']['kind'], 'no-path')
        self.assert_base()

    def test_higher_direction_and_checks_on_chosen_variant(self):
        self.init_compare('Held-out: test "$(cat metric)" = 12\n')
        self.method.write_text(self.method.read_text().replace('Direction: lower', 'Direction: higher'))
        (self.e / 'state.json').unlink()
        self.command('init', '--worktree', str(self.w), '--methodology', str(self.method),
                     '--strategy', 'compare', '--scorer', 'scripted')
        self.variant('a', 12)
        self.variant('b', 9)
        self.command('measure')
        self.assertEqual(self.command('confirm')['ending']['winner'], 'a')
        self.assertIn('Held-out: PASS', self.report())
        self.assert_base()

    def test_pooled_mad_and_metric_parsing(self):
        counter = self.root / 'counts'
        counter.mkdir()
        (self.w / 'measure.sh').write_text(
            f'#!/bin/sh\nm=$(cat metric); p="{counter}/$m"; n=0; [ ! -f "$p" ] || n=$(cat "$p"); '
            'n=$((n+1)); echo "$n" > "$p"\n'
            'echo METRIC other=100; echo "METRIC latency=$((m + 2 * n))"\n')
        self.git('add', 'measure.sh')
        self.git('commit', '-m', 'test: noisy metrics')
        self.init_compare('Metric name: latency\n')
        self.variant('a', 5)
        self.variant('b', 7)
        self.assertEqual(self.command('measure')['action'], 'decide')
        self.assertEqual(self.state()['variants']['a']['runs'], [7, 9, 11])
        self.assertEqual(self.state()['margin'], 4)
        self.assert_base()

    def test_engagement_files_are_excluded_even_when_force_staged(self):
        self.init_compare()
        self.command('variant', 'begin', '--name', 'a', '--tradeoff', 'cost')
        self.files(metric=5)
        artifact = self.e / 'artifact'
        artifact.write_text('private engagement evidence')
        self.git('add', '-f', str(artifact))
        self.command('variant', 'commit')
        v = self.state()['variants']['a']
        self.assertEqual(self.git('diff', '--name-only', self.state()['base'], v['commit']), 'metric')
        self.assertTrue(artifact.exists())
        self.assert_base()

    def test_report_detects_variant_scorer_mutation(self):
        self.init_compare()
        self.command('variant', 'begin', '--name', 'a', '--tradeoff', 'cost')
        (self.w / 'measure.sh').write_text('#!/bin/sh\necho 1\n')
        self.command('variant', 'commit')
        self.variant('b', 6)
        self.command('measure')
        self.command('confirm')
        self.assertIn('Scorer files unchanged: FAIL', self.report())
        self.assert_base()


if __name__ == '__main__':
    unittest.main()
