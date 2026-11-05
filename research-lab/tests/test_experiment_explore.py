"""Explore contracts over the public CLI and inert council returns."""
import fcntl
import json
import os
from pathlib import Path
import random
import signal
import subprocess
import sys
import time
import unittest

from tests.test_experiment_report import ReportTests
from tests import test_experiment_council as council
from tests.test_experiment_check import SCRIPT


class ExploreTests(ReportTests):
    def init_explore(self, extra='', count=2, rounds=2, budget=12, runs=3, ok=True):
        self.method.write_text('## Objective\n## Scope Constraints\n## Working Directory\n'
            'Question: What is possible?\nMeasure: ./measure.sh\nChecks: test "$(cat guard)" = 0\n'
            f'Direction: lower\nCount: {count}\nRounds: {rounds}\nBudget: {budget}\nRuns: {runs}\n' + extra)
        return self.command('init', '--worktree', str(self.w), '--methodology', str(self.method),
                            '--strategy', 'explore', '--scorer', 'scripted', ok=ok)

    def candidate(self, name, metric, parent=None, guard=0):
        args = ['variant', 'begin', '--name', name, '--tradeoff', 'cost '+name, '--description', name]
        if parent:
            args += ['--parent', parent]
        self.command(*args)
        self.files(metric=metric, guard=guard)
        return self.command('variant', 'commit')

    def announce(self, name, **kwargs):
        return self.command('announce', '--name', name, '--note', 'vary '+name, **kwargs)

    def test_two_rounds_gallery_lineage_and_limits(self):
        self.init_explore()
        self.candidate('a', 8)
        self.candidate('b', 5)
        self.command('announce', '--name', 'a', '--note', 'too early', ok=False)
        self.assertEqual(self.command('measure')['ranking'], ['b', 'a'])
        self.command('variant', 'begin', '--name', 'c', '--tradeoff', 'c', '--description', 'c', '--parent', 'b', ok=False)
        before = (self.e / 'state.json').read_bytes()
        self.assertEqual(self.command('next')['action'], 'announce')
        self.assertEqual((self.e / 'state.json').read_bytes(), before)
        self.command('confirm', ok=False)
        self.command('decide', '--choose', 'a', '--reason', 'x', ok=False)
        self.announce('a')
        self.announce('a', ok=False)
        self.announce('b')
        self.announce('b', ok=False)
        self.command('variant', 'begin', '--name', 'c', '--tradeoff', 'c', '--description', 'c', '--parent', 'unknown', ok=False)
        self.candidate('c', 3, 'b')
        self.command('variant', 'discard', '--name', 'a', ok=False)
        self.candidate('d', 4, 'a')
        self.assertEqual(self.command('measure')['ranking'], ['c', 'd'])
        self.assertEqual(self.announce('c')['ending']['kind'], 'explored')
        self.announce('d')
        self.announce('c', ok=False)
        s = self.state()
        self.assertEqual((s['measurements_used'], s['ending']['candidates_built']), (12, 4))
        self.assertEqual(s['variants']['c']['parent'], 'b')
        self.assertEqual([v['round'] for v in s['variants'].values()], [1, 1, 2, 2])
        for v in s['variants'].values():
            self.assertEqual(self.git('rev-list', '--parents', '-n', '1', v['commit']).split(), [v['commit'], s['base']])
        self.command('report')
        report = (self.e / 'report.md').read_text()
        for text in ('No improvement is claimed', '## Gallery', '### Round 2', '## Points of interest',
                     'vary b', '## Next experiments', 'climb', 'compare', 'experiment--c',
                     'Each variant is one commit on base: PASS', 'Checks: PASS'):
            self.assertIn(text, report)
        self.assertEqual(report.count('Measurement order interleaved'), 2)
        self.assertNotIn(': FAIL', report)
        self.assertEqual(self.git('rev-parse', 'HEAD'), s['base'])
        self.assertEqual(len(self.records()), 4)

    def test_check_budget_bounds_defaults_and_incumbent(self):
        for count, rounds, budget in [(1, 2, 100), (7, 2, 100), (2, 0, 100), (2, 4, 100), (2, 2, 11)]:
            with self.subTest(count=count, rounds=rounds, budget=budget):
                self.init_explore(count=count, rounds=rounds, budget=budget, ok=False)
        self.init_explore('Include incumbent: yes\n', budget=14, ok=False)
        self.init_explore('Include incumbent: yes\n', budget=15)
        self.candidate('a', 11)
        self.candidate('b', 12)
        self.assertEqual(self.command('measure')['ranking'], ['incumbent', 'a', 'b'])
        self.assertEqual(self.state()['measurements_used'], 9)
        self.announce('incumbent')
        self.candidate('c', 13, 'incumbent')
        self.candidate('d', 14, 'incumbent')
        self.command('measure')
        self.assertEqual(self.announce('c')['ending']['budget_used'], 15)

    def test_check_defaults_and_required_inputs(self):
        from experiment import check
        self.init_explore(budget=100)
        text = self.method.read_text().replace('Count: 2\n', '').replace('Rounds: 2\n', '')
        self.method.write_text(text)
        self.assertEqual(check('explore', 'scripted', str(self.method))['status'], 'ready')
        from experiment_explore import configuration
        from experiment_loop import config
        cfg, exp = configuration(text, dict(config(text, 'explore'), scorer='scripted'))
        self.assertEqual((cfg['count'], exp['rounds']), (4, 2))
        for line in ('Question: What is possible?\n', 'Budget: 100\n', 'Direction: lower\n',
                     'Measure: ./measure.sh\n', 'Checks: test "$(cat guard)" = 0\n', '## Objective\n'):
            with self.subTest(line=line):
                self.method.write_text(text.replace(line, ''))
                self.assertEqual(check('explore', 'scripted', str(self.method))['status'], 'refused')

    def test_higher_ranking_and_failed_candidate_gallery(self):
        self.init_explore(rounds=1, budget=6)
        text = self.method.read_text().replace('Direction: lower', 'Direction: higher')
        (self.e / 'state.json').unlink()
        self.method.write_text(text)
        self.command('init', '--worktree', str(self.w), '--methodology', str(self.method),
                     '--strategy', 'explore', '--scorer', 'scripted')
        self.candidate('a', 20, guard=1)
        self.candidate('b', 12)
        self.assertEqual(self.command('measure')['ranking'], ['b'])
        self.announce('b')
        self.command('report')
        self.assertIn('Checks failed', (self.e / 'report.md').read_text())

    def test_remaining_budget_does_not_open_round(self):
        self.init_explore()
        self.candidate('a', 8)
        self.candidate('b', 5)
        self.command('measure')
        s = self.state()
        s['budget_override'] = 11
        (self.e / 'state.json').write_text(json.dumps(s))
        out = self.announce('b')
        self.assertEqual(out['ending']['rounds_completed'], 1)
        self.assertEqual(self.state()['round'], 1)
        self.command('variant', 'begin', '--name', 'c', '--tradeoff', 'x', '--description', 'x', '--parent', 'b', ok=False)

    def test_recovery_partial_measurement_and_second_round(self):
        self.init_explore()
        self.candidate('a', 8)
        self.candidate('b', 5)
        self.command('measure')
        self.announce('b')
        self.candidate('c', 3, 'b')
        self.candidate('d', 4, 'b')
        s = self.state()
        order = ['c', 'd']
        random.Random(s['seed']).shuffle(order)
        s['order'] = [order]
        s['variants'][order[0]].update(runs=[3 if order[0] == 'c' else 4], checks=True)
        s['measurements_used'] += 1
        (self.e / 'state.json').write_text(json.dumps(s))
        self.git('switch', '--detach', s['variants'][order[0]]['commit'])
        self.command('measure')
        self.assertEqual(self.state()['measurements_used'], 12)
        self.assertEqual(self.state()['order'][0], order)
        self.assertEqual(self.state()['variants']['a']['runs'], [8]*3)
        self.assertEqual(self.git('symbolic-ref', '--short', 'HEAD'), 'experiment')
        self.announce('c')

    def test_announce_and_report_share_lock(self):
        self.init_explore()
        with (self.e / '.lock').open('w') as lock:
            lock.write(str(os.getpid())); lock.flush()
            fcntl.flock(lock, fcntl.LOCK_EX)
            for args in [('announce', '--name', 'a', '--note', 'x'), ('report',)]:
                self.assertIn('another experiment command', self.command(*args, ok=False)['reason'])

    def test_sigterm_recovers_mid_round(self):
        ready = self.root / 'ready'
        (self.w / 'measure.sh').write_text(f'#!/bin/sh\ntouch "{ready}"\nsleep 1\ncat metric\n')
        self.git('add', 'measure.sh')
        self.git('commit', '-m', 'test: interruptible explore scorer')
        self.init_explore(rounds=1, runs=1, budget=2)
        self.candidate('a', 8)
        self.candidate('b', 5)
        proc = subprocess.Popen([sys.executable, str(SCRIPT), 'measure', '--engagement', str(self.e)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 10
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue(ready.exists())
            proc.send_signal(signal.SIGTERM)
            proc.communicate(timeout=10)
            self.assertNotEqual(proc.returncode, 0)
        finally:
            if proc.poll() is None:
                proc.kill(); proc.communicate(timeout=10)
        self.assertEqual(self.git('symbolic-ref', '--short', 'HEAD'), 'experiment')
        self.assertEqual(self.command('measure')['action'], 'announce')
        self.assertEqual(self.announce('b')['ending']['kind'], 'explored')


class CouncilExploreTests(unittest.TestCase):
    setUp = council.CouncilTests.setUp
    command = council.CouncilTests.command
    returns = council.CouncilTests.returns

    def init_explore(self, count=2, rounds=2, budget=8, extra='', ok=True):
        self.method.write_text('## Objective\n## Scope Constraints\n## Working Directory\n'
            f'Question: What can this say?\nChecks: true\nCount: {count}\nRounds: {rounds}\nBudget: {budget}\n'
            '```judging-protocol\n' + json.dumps(self.f.protocol) + '\n```\n' + extra)
        return self.command('init', '--worktree', self.f.work, '--methodology', self.method,
                            '--strategy', 'explore', '--scorer', 'council', ok=ok)

    def candidate(self, name, parent=None):
        args = ['variant', 'begin', '--name', name, '--tradeoff', 'cost '+name, '--description', name]
        if parent:
            args += ['--parent', parent]
        self.command(*args)
        (self.f.work / 'doc.md').write_text(name)
        self.command('variant', 'commit')

    def test_two_rounds_record_recovery_rank_and_report(self):
        self.init_explore()
        for names, parent in [(('a', 'b'), None), (('c', 'd'), 'a')]:
            for n in names:
                self.candidate(n, parent)
            opened = self.command('measure', '--panel', self.f.panel_path)
            self.returns(dict(requests=opened['requests'][:1]), lambda r, m: min(m.values()))
            self.assertEqual(self.command('next')['action'], 'record')
            self.command('score', ok=False)
            self.returns(dict(requests=opened['requests'][1:]), lambda r, m: min(m.values()))
            out = self.command('score')
            self.assertEqual(out['action'], 'announce')
            self.assertEqual(out['ranking'], list(names))
            self.command('announce', '--name', names[0], '--note', 'develop this')
        s = json.loads((self.f.engagement / 'state.json').read_text())
        self.assertEqual(s['ending']['kind'], 'explored')
        self.assertEqual(s['measurements_used'], 8)
        self.assertEqual(s['variants']['c']['wins'], 1)
        self.assertEqual(s['variants']['c']['parent'], 'a')
        self.assertEqual(len(list((self.f.engagement / 'evals').iterdir())), 2)
        self.assertEqual(self.f.head(), self.f.base)
        self.command('report')
        report = (self.f.engagement / 'report.md').read_text()
        for text in ('1 wins; 0 ties', 'fixture preference', '## Gallery', '## Points of interest', 'Checks: PASS'):
            self.assertIn(text, report)

    def test_pairs_won_then_not_lost(self):
        from experiment_explore import finish_round
        s = dict(round=1, round_results={}, seed=0, order=[], strategy='explore', scorer='council',
                 variants={n: dict(round=1, status='measured') for n in ('a', 'b', 'c', 'd')},
                 council_result=dict(pairwise=[
                     dict(pair=['a', 'b'], winner=None), dict(pair=['a', 'c'], winner=None),
                     dict(pair=['a', 'd'], winner=None), dict(pair=['b', 'c'], winner='b'),
                     dict(pair=['b', 'd'], winner='d'), dict(pair=['c', 'd'], winner='c')]))
        finish_round(s, {})
        self.assertEqual(s['round_results']['1']['ranking'], ['b', 'c', 'd', 'a'])
        # Same wins: fewer losses (more ties) ranks first.
        s['council_result']['pairwise'][-1]['winner'] = None
        finish_round(s, {})
        self.assertEqual(s['round_results']['1']['ranking'][:2], ['d', 'b'])

    def test_council_budget_count_six_and_incumbent_reference(self):
        self.init_explore(budget=7, ok=False)
        self.init_explore(count=6, rounds=1, budget=59, ok=False)
        self.init_explore(count=6, rounds=1, budget=60)

    def test_unbeaten_incumbent_does_not_end_exploration(self):
        self.init_explore(rounds=1, budget=12, extra='Include incumbent: yes\n')
        self.candidate('a')
        self.candidate('b')
        opened = self.command('measure', '--panel', self.f.panel_path)
        self.returns(opened, lambda r, m: 'tie')
        out = self.command('score')
        self.assertEqual(out['action'], 'announce')
        self.command('announce', '--name', 'incumbent', '--note', 'reference')
        self.assertEqual(json.loads((self.f.engagement / 'state.json').read_text())['ending']['kind'], 'explored')


if __name__ == '__main__':
    unittest.main()
