"""Contract tests for `experiment.py check`: strategy/scorer precedence and refusals."""
import json
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'skills' / 'experiment' / 'scripts' / 'experiment.py'
OPTIMIZE = Path(__file__).resolve().parents[2] / 'drupal-lab' / 'skills' / 'optimize'
TEMPLATE = OPTIMIZE / 'references' / 'methodology-template.md'

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

    def run_check(self, *args):
        r = subprocess.run([sys.executable, str(SCRIPT), 'check', *args],
                           text=True, capture_output=True, timeout=60)
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

    def test_unbuilt_strategies_refused(self):
        for s in ('compare', 'explore'):
            code, out = self.run_check('--strategy', s, '--methodology', self.method(CLIMB))
            self.assertEqual(code, 1, s)
            self.assertIn('not built yet', out['reason'])

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

    def test_council_blocked(self):
        code, out = self.run_check('--strategy', 'climb', '--scorer', 'council',
                                   '--methodology', self.method('metric_type: judged\n' + CLIMB))
        self.assertEqual(code, 1)
        self.assertIn('blocked', out['reason'])

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

    def test_drupal_lab_optimize_handoff_is_ready_without_pause(self):
        """drupal-lab:optimize's actual invocation args plus its filled template are `ready`."""
        call = re.search(r'Skill\("research-lab:experiment", args="([^"]+)"\)',
                         (OPTIMIZE / 'SKILL.md').read_text())
        args = dict(kv.split('=', 1) for kv in call.group(1).split())
        body = TEMPLATE.read_text().split('```markdown', 1)[1].rsplit('```', 1)[0]
        filled = (body.replace('<Numeric target value>', '0.95')
                      .replace('<"higher is better" or "lower is better">', 'higher is better')
                      .replace('<max iterations, e.g., 20>', '20'))
        filled += '\nMeasure: echo 0.9\nChecks: true\n'
        flags = [x for k in ('strategy', 'scorer') if k in args for x in (f'--{k}', args[k])]
        code, out = self.run_check(*flags, '--methodology', self.method(filled))
        self.assertEqual(code, 0, out)
        self.assertEqual(out['source'], {'strategy': 'argument', 'scorer': 'argument'})


if __name__ == '__main__':
    unittest.main()
