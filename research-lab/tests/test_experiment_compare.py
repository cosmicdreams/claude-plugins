"""Compare acceptance contracts through the public CLI and disposable worktrees."""
import json
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
        self.assertEqual(len(self.records()), 2)
        for row in self.records():
            for key in ('strategy', 'variant', 'commit', 'runs', 'mad', 'checks', 'tradeoff'):
                self.assertIn(key, row)
            self.assertEqual(row['decision'], 'measured')
        self.assertEqual(len((self.e / 'progress.log').read_text().splitlines()), 2)
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
