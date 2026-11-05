"""Council comparison through the public CLI, with inert recorded judge returns."""
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from tests.judged_fixtures import Fixture, panel

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/experiment/scripts/experiment.py'
sys.path.insert(0, str(SCRIPT.parent))
import experiment


class CouncilTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.method = self.f.methodology

    def command(self, *args, ok=True):
        r = subprocess.run([sys.executable, str(SCRIPT), *map(str, args), '--engagement', str(self.f.engagement)],
                           env=self.f.env, capture_output=True, text=True, timeout=60)
        value = json.loads(r.stdout)
        self.assertEqual(r.returncode, 0 if ok else 1, (value, r.stderr))
        return value

    def init(self, extra='', budget=4, count=2, ok=True):
        text = ('## Objective\n## Scope Constraints\n## Working Directory\n'
                f'Checks: true\nVariants: generated\nCount: {count}\nIdea: text variants\nBudget: {budget}\n'
                '```judging-protocol\n' + json.dumps(self.f.protocol) + '\n```\n' + extra)
        self.method.write_text(text)
        return self.command('init', '--worktree', self.f.work, '--methodology', self.method,
                            '--strategy', 'compare', '--scorer', 'council', ok=ok)

    def build(self, extra='', count=2):
        self.init(extra, budget=12 if extra else (count*(count-1)*2), count=count)
        for i in range(count):
            name = chr(97+i)
            self.command('variant', 'begin', '--name', name, '--tradeoff', 'cost '+name, '--description', name)
            (self.f.work / 'doc.md').write_text(name + '\n')
            self.command('variant', 'commit')
        return self.command('measure', '--panel', self.f.panel_path, '--seed', 42)

    def returns(self, opened, preference):
        for request in opened['requests']:
            d = Path(request['dir'])
            mapping = json.loads((d / 'mapping.json').read_text())
            chosen = preference(request, mapping)
            label = next((k for k, v in mapping.items() if v == chosen), chosen)
            ret = self.f.root / 'return.json'; inv = self.f.root / 'invocation.json'
            ret.write_text(json.dumps(dict(preferred=label, critique='fixture preference')))
            inv.write_text(json.dumps(panel()[request['role']]))
            self.command('record', '--request', d, '--return-file', ret, '--invocation-file', inv)

    def test_unanimous_and_report(self):
        opened = self.build(count=3)
        self.assertEqual(len(opened['requests']), 12)
        self.returns(opened, lambda r, m: min(m.values()))
        out = self.command('score')
        self.assertEqual(out['ending']['basis'], 'council: unanimous')
        self.assertEqual(out['ending']['winner'], 'a')
        self.command('report')
        report = (self.f.engagement / 'report.md').read_text()
        self.assertIn('Position inconsistencies', report)
        self.assertIn('council: unanimous', report)
        self.assertEqual(self.f.git('symbolic-ref', '--short', 'HEAD').stdout.strip(), 'experiment')
        self.assertEqual(self.f.head(), self.f.base)

    def test_scorer_hashes_block_changed_external_scripts(self):
        self.init()
        state = json.loads((self.f.engagement / 'state.json').read_text())
        self.assertEqual(set(state['scorer_sha256']),
                         {str(self.f.methodology_dir / name) for name in ('capture.sh', 'guard.sh')})
        for name in ('a', 'b'):
            self.command('variant', 'begin', '--name', name, '--tradeoff', name, '--description', name)
            (self.f.work / 'doc.md').write_text(name)
            self.command('variant', 'commit')
        (self.f.methodology_dir / 'guard.sh').write_text('#!/bin/sh\nexit 1\n')
        self.assertIn('scorer changed', self.command('measure', '--panel', self.f.panel_path, ok=False)['reason'])

    def test_variant_scorer_copy_cannot_score_itself(self):
        import shutil
        shutil.copytree(self.f.methodology_dir, self.f.work / 'methodology')
        self.f.git('add', 'methodology')
        self.f.git('commit', '-m', 'base methodology')
        self.f.base = self.f.head()
        self.method = self.f.work / 'methodology/methodology.md'
        self.f.protocol['artifact_command'] = str(self.method.parent / 'capture.sh')
        # Write compare methodology before init's clean-worktree check.
        text = ('## Objective\n## Scope Constraints\n## Working Directory\n'
                'Checks: true\nVariants: generated\nCount: 2\nIdea: text variants\nBudget: 4\n'
                '```judging-protocol\n' + json.dumps(self.f.protocol) + '\n```\n')
        self.method.write_text(text)
        self.f.git('add', 'methodology/methodology.md')
        self.f.git('commit', '-m', 'prepare compare')
        self.f.base = self.f.head()
        self.init()
        for name in ('a', 'b'):
            self.command('variant', 'begin', '--name', name, '--tradeoff', name, '--description', name)
            (self.f.work / 'doc.md').write_text(name)
            if name == 'a':
                (self.method.parent / 'capture.sh').write_text('#!/bin/sh\ntouch '+str(self.f.root / 'ran-variant')+'\nexit 1\n')
            self.command('variant', 'commit')
        opened = self.command('measure', '--panel', self.f.panel_path)
        self.assertEqual(opened['requests'], [])
        state = json.loads((self.f.engagement / 'state.json').read_text())
        self.assertEqual(state['variants']['a']['status'], 'invalid')
        self.assertEqual(state['variants']['b']['status'], 'measured')
        self.assertFalse((self.f.root / 'ran-variant').exists())

    def test_report_validity_hash_failure_and_missing_worktree_banner(self):
        import shutil
        opened = self.build()
        self.returns(opened, lambda r, m: 'a')
        self.command('score')
        self.command('report')
        report = (self.f.engagement / 'report.md').read_text()
        self.assertIn('Scorer files unchanged: PASS', report)
        (self.f.methodology_dir / 'capture.sh').write_text('changed')
        self.command('report')
        self.assertIn('Scorer files unchanged: FAIL', (self.f.engagement / 'report.md').read_text())
        shutil.rmtree(self.f.work)
        self.command('report')
        self.assertIn('VALIDITY NOT RE-VERIFIED', (self.f.engagement / 'report.md').read_text())

    def test_malformed_return_pauses_without_recovery(self):
        opened = self.build()
        self.returns(opened, lambda r, m: 'a')
        (Path(opened['requests'][0]['dir']) / 'return.json').write_text('{')
        out = self.command('score')
        self.assertEqual(out['ending']['kind'], 'paused')
        self.assertIn('not running', self.command('score', ok=False)['reason'])

    def test_trials_used_matches_updated_request_budget(self):
        self.build(count=3)
        state = json.loads((self.f.engagement / 'state.json').read_text())
        self.assertEqual(state['measurements_used'], 12)
        self.assertEqual(state['trials_used'], state['measurements_used'])

    def test_position_bias_is_tie(self):
        opened = self.build()
        self.returns(opened, lambda r, m: 'X')
        out = self.command('measure')
        self.assertEqual(out['action'], 'decide')
        self.assertEqual(out['result']['position_inconsistencies'], {'primary': 1, 'second': 1})
        self.assertIsNone(out['result']['pairwise'][0]['winner'])
        self.command('decide', '--choose', 'b', '--reason', 'trade-off choice')

    def test_unrecorded_requests_block_scoring_without_pausing(self):
        opened = self.build(count=3)
        self.returns(dict(requests=opened['requests'][:2]), lambda r, m: 'tie')
        pending = self.command('next')
        self.assertEqual(pending['action'], 'record')
        self.assertEqual(pending['eval'], opened['eval'])
        self.assertEqual(pending['remaining'],
                         [dict(dir=r['dir'], role=r['role']) for r in opened['requests'][2:]])
        before = (self.f.engagement / 'state.json').read_text()
        self.assertIn('10 requests unrecorded', self.command('score', ok=False)['reason'])
        self.assertEqual((self.f.engagement / 'state.json').read_text(), before)
        self.assertFalse((self.f.engagement / 'evals' / opened['eval'] / 'result.json').exists())
        self.returns(dict(requests=opened['requests'][2:]), lambda r, m: 'tie')
        self.assertEqual(self.command('next')['action'], 'score')
        self.assertEqual(self.command('score')['action'], 'decide')

    def test_report_includes_agent_view_per_variant(self):
        self.build()
        self.command('report')
        report = (self.f.engagement / 'report.md').read_text()
        header = next(line for line in report.splitlines() if line.startswith('| Variant |'))
        columns = [c.strip() for c in header.split('|')[1:-1]]
        view = columns.index("worth adopting? (agent's view)")
        for name in ('a', 'b'):
            row = next(line for line in report.splitlines() if line.startswith(f'| {name} |'))
            values = [c.strip() for c in row.split('|')[1:-1]]
            self.assertEqual(len(values), len(columns))
            self.assertEqual(values[view], '_')

    def test_nonunanimous_pair(self):
        opened = self.build()
        self.returns(opened, lambda r, m: 'a' if r['role'] == 'primary' else 'b')
        out = self.command('score')
        self.assertEqual(out['action'], 'decide')
        self.assertEqual(out['group'], ['a', 'b'])
        self.assertEqual(out['result']['position_inconsistencies'], {'primary': 0, 'second': 0})

    def test_provenance_mismatch_invalidates_request(self):
        opened = self.build()
        self.returns(opened, lambda r, m: 'a')
        d = Path(opened['requests'][0]['dir'])
        (d / 'invocation.json').write_text('{}')
        out = self.command('score')
        self.assertEqual(out['ending']['kind'], 'paused')
        self.assertEqual(out['result']['status'], 'invalid')
        self.assertEqual(out['result']['position_inconsistencies'], {'primary': 0, 'second': 0})
        self.assertIn('invocation mismatch', out['result']['invalid_requests'][0]['reason'])
        self.assertEqual(out['result']['invalid_requests'][0]['request'], d.name)

    def test_incumbent_unbeaten_no_path(self):
        opened = self.build('Include incumbent: yes\n')
        self.returns(opened, lambda r, m: 'tie' if 'incumbent' in m.values() else 'a')
        out = self.command('score')
        self.assertEqual(out['ending']['kind'], 'no-path')

    def test_budget_and_cap(self):
        self.assertIn('Budget', self.init(budget=3, ok=False)['reason'])
        self.assertIn('2–5', self.init(count=6, budget=100, ok=False)['reason'])

    def test_failed_checks_excluded(self):
        self.init()
        self.method.write_text(self.method.read_text().replace('Checks: true', 'Checks: grep -q b doc.md'))
        # Reinitialize after clearing the state, before building any variant.
        (self.f.engagement / 'state.json').unlink()
        self.command('init', '--worktree', self.f.work, '--methodology', self.method,
                     '--strategy', 'compare', '--scorer', 'council')
        for name in ('a', 'b'):
            self.command('variant', 'begin', '--name', name, '--tradeoff', name, '--description', name)
            (self.f.work / 'doc.md').write_text(name)
            self.command('variant', 'commit')
        opened = self.command('measure', '--panel', self.f.panel_path)
        self.assertEqual(opened['requests'], [])
        out = self.command('score')
        self.assertEqual(out['group'], ['b'])
        self.command('report')
        report = (self.f.engagement / 'report.md').read_text()
        header = next(line for line in report.splitlines() if line.startswith('| Variant |'))
        columns = [c.strip() for c in header.split('|')[1:-1]]
        for name, expected in (('a', 'FAIL'), ('b', 'PASS')):
            row = next(line for line in report.splitlines() if line.startswith(f'| {name} |'))
            values = [c.strip() for c in row.split('|')[1:-1]]
            self.assertEqual(values[columns.index('Checks')], expected)

    def test_check_passed_legacy_and_blocked_status(self):
        self.assertEqual(experiment.check('climb', None, str(self.method))['status'], 'ready')
        self.assertEqual(experiment.check('climb', None, str(self.method))['engine'], 'judged.py')
        status = self.f.root / 'status.json'
        status.write_text(json.dumps(dict(status='blocked', record='fixture')))
        with patch.object(experiment, 'COUNCIL_STATUS', status):
            self.assertIn('blocked', experiment.check('climb', 'council', str(self.method))['reason'])


if __name__ == '__main__':
    unittest.main()
