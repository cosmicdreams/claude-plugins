"""Contract tests for `experiment.py check`: strategy/scorer precedence and refusals."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'skills' / 'experiment' / 'scripts' / 'experiment.py'

CLIMB = """# Methodology: demo

## 1. Objective
**Metric:** p95 latency ms
**Direction:** lower is better
**Target:** 200

## 2. Baseline
Measure: echo 240
Checks: true
240

## 3. Hypotheses
1. cache it

## 4. Iteration Rules
- Budget: 20

## 5. Measurement Protocol
run it

## 6. Correctness Checks
- tests pass

## 7. Scope Constraints
- src only

## 8. Working Directory
/tmp/x
"""


class CheckTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def method(self, text):
        p = Path(self.tmp.name) / 'methodology.md'
        p.write_text(text)
        return str(p)

    def run_check(self, *args, env=None):
        r = subprocess.run([sys.executable, str(SCRIPT), 'check', *args],
                           text=True, capture_output=True, timeout=60, env=env)
        return r.returncode, json.loads(r.stdout)

    def test_no_strategy_routes(self):
        code, out = self.run_check('--methodology', self.method(CLIMB))
        self.assertEqual((code, out['status']), (2, 'route'))

    def test_auto_routes(self):
        code, out = self.run_check('--strategy', 'auto')
        self.assertEqual((code, out['status']), (2, 'route'))

    def test_preloaded_climb_ready_with_default_scorer(self):
        code, out = self.run_check('--strategy', 'climb', '--methodology', self.method(CLIMB))
        self.assertEqual(code, 0, out)
        self.assertEqual((out['strategy'], out['scorer']), ('climb', 'scripted'))
        self.assertEqual(out['source'], {'strategy': 'argument', 'scorer': 'default'})

    def test_methodology_field_used_without_argument(self):
        code, out = self.run_check('--methodology', self.method('strategy: climb\n' + CLIMB))
        self.assertEqual(code, 0, out)
        self.assertEqual(out['source']['strategy'], 'methodology')

    def test_argument_beats_methodology(self):
        code, out = self.run_check('--strategy', 'climb',
                                   '--methodology', self.method('strategy: compare\n' + CLIMB))
        self.assertEqual((code, out['strategy'], out['source']['strategy']), (0, 'climb', 'argument'))

    def test_missing_target_refused_with_list(self):
        code, out = self.run_check('--strategy', 'climb',
                                   '--methodology', self.method(CLIMB.replace('**Target:** 200\n', '')))
        self.assertEqual(code, 1)
        self.assertIn('target: a numeric target value', out['missing'])

    def test_empty_fields_do_not_read_the_next_line(self):
        text = CLIMB.replace('**Target:** 200', '**Target:**').replace('- Budget: 20', '- Budget:')
        code, out = self.run_check('--strategy', 'climb', '--methodology', self.method(text))
        self.assertEqual(code, 1)
        self.assertIn('target: a numeric target value', out['missing'])
        self.assertIn('budget: maximum iterations', out['missing'])

    def test_missing_sections_listed(self):
        text = CLIMB.split('## 5.')[0]
        code, out = self.run_check('--strategy', 'climb', '--methodology', self.method(text))
        self.assertEqual(code, 1)
        for name in ('Measurement Protocol', 'Correctness Checks', 'Scope Constraints', 'Working Directory'):
            self.assertIn(f'section: {name}', out['missing'])

    def test_climb_without_methodology_refused(self):
        code, out = self.run_check('--strategy', 'climb')
        self.assertEqual((code, out['missing']), (1, ['methodology']))

    def test_explore_requires_question(self):
        code, out = self.run_check('--strategy', 'explore', '--methodology', self.method(CLIMB))
        self.assertEqual(code, 1)
        self.assertIn('Question', out['reason'])

    def test_not_an_experiment_refused(self):
        code, out = self.run_check('--strategy', 'not-an-experiment')
        self.assertEqual(code, 1)
        self.assertIn('build it directly', out['reason'])

    def test_unknown_strategy_and_scorer(self):
        self.assertEqual(self.run_check('--strategy', 'sweep')[0], 1)
        code, out = self.run_check('--strategy', 'climb', '--scorer', 'vibes',
                                   '--methodology', self.method(CLIMB))
        self.assertEqual(code, 1)
        self.assertIn('unknown scorer', out['reason'])

    def test_unpassed_council_transport_refused(self):
        status = Path(self.tmp.name) / 'council-status.json'
        status.write_text(json.dumps({'status': 'passed', 'record': 'r', 'transports': ['t3']}))
        env = dict(os.environ, RESEARCH_LAB_COUNCIL_STATUS=str(status))
        code, out = self.run_check('--strategy', 'climb', '--scorer', 'council', '--transport', 'direct',
                                   '--methodology', self.method('metric_type: judged\n' + CLIMB), env=env)
        self.assertEqual(code, 1)
        self.assertIn('transport has not passed', out['reason'])

    def test_legacy_metric_type_maps_to_council(self):
        code, out = self.run_check('--strategy', 'climb',
                                   '--methodology', self.method('metric_type: judged\n' + CLIMB))
        self.assertEqual((code, out['scorer']), (1, 'council'))

    def test_scorer_conflicting_with_metric_type_refused(self):
        code, out = self.run_check('--strategy', 'climb', '--scorer', 'scripted',
                                   '--methodology', self.method('metric_type: judged\n' + CLIMB))
        self.assertEqual(code, 1)
        self.assertIn('conflicts', out['reason'])
        code, out = self.run_check('--methodology',
                                   self.method('metric_type: scripted\nscorer: council\n' + CLIMB))
        self.assertEqual(code, 1)
        self.assertIn('conflict', out['reason'])

    def test_route_carries_preloaded_scorer(self):
        code, out = self.run_check('--scorer', 'council')
        self.assertEqual((code, out['scorer'], out['source']), (2, 'council', {'scorer': 'argument'}))


if __name__ == '__main__':
    unittest.main()
