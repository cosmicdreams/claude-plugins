"""Frozen packet 3: subprocess-driven lifecycle scorer, scope.md overrides §9.

Interpretations: scenario queues belong to the test/orchestrator, never to persisted
production state. A restart discards the Driver, whose first operation is next.
One propose action includes begin/edit/commit/trial commit; interrupting after it
is the requested interruption after trial commit. An error-return interruption
is after open/dispatch; a drift-result interruption is after score. Rule 12 may
add a second capture of a kept tree before confirm. A withdrawal skip following
an invalid eval finalizes the trial, and may cite that eval as provenance; it is
not a second evaluation decision (consistent with packet 2).
D8 continue without a pending trial stales calibration; it may reuse captures.
Reference scores are resolved from each request mapping at dispatch.
"""
from collections import Counter, deque
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from judged_fixtures import Fixture, panel


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def calibration(value=5):
    return {'capture-1': value, 'capture-2': value, 'reference': 4}


def measurement(incumbent=5, candidate=6, reference=4):
    return {'incumbent': incumbent, 'candidate': candidate, 'reference': reference}


class Scenario:
    """Recorded inputs in dispatch order, independent of all production decisions."""
    def __init__(self, opens=(), checks=(), changes=(), seed=137):
        self.opens = deque(opens)
        self.checks = deque(checks)
        self.changes = deque(changes)
        self.seed = seed


class Driver:
    """Mechanical interpreter of next actions; no experiment decision logic.

    open entries: {scores, errors?: {request_index: text}, partial?: count}.
    partial simulates process loss during dispatch, returning after open without
    fabricating missing returns. Inputs are consumed once, by open, in queue order.
    """
    def __init__(self, fixture, scenario):
        self.f, self.scenario = fixture, scenario
        self.actions = []

    @staticmethod
    def pop(queue, label):
        assert queue, 'unexpected action exhausted scenario ' + label
        return queue.popleft()

    def perform(self, a):
        f, s, kind = self.f, self.scenario, a['action']
        if kind == 'capture':
            f.ok('capture', '--worktree', f.work, '--role', a['role'])
        elif kind == 'open':
            recorded = self.pop(s.opens, 'opens')
            opened = f.ok('open', '--purpose', a['purpose'], '--panel', f.panel_path,
                          '--seed', s.seed)
            assert isinstance(opened.get('eval'), str), opened
            assert isinstance(opened.get('requests'), list) and opened['requests'], opened
            e = f.engagement / 'evals' / opened['eval']
            for index, request in enumerate(opened['requests']):
                if index >= recorded.get('partial', len(opened['requests'])):
                    break
                role, k = request['role'], request['k']
                mapping = read(e / f'{role}-{k}' / 'mapping.json')
                scores = {meaning: recorded['scores']['reference' if meaning.startswith('ref:') else meaning]
                          for meaning in mapping.values()}
                f.write_return(e, role, k, scores)
                if index in recorded.get('errors', {}):
                    (e / f'{role}-{k}' / 'return.json').write_text(json.dumps(
                        {'error': recorded['errors'][index]}), encoding='utf-8')
            return recorded.get('partial', len(opened['requests'])) < len(opened['requests'])
        elif kind in ('score', 'abandon', 'invalidate'):
            args = ['--eval', a['eval']]
            if kind == 'invalidate':
                args += ['--reason', a['reason']]
            f.ok(kind, *args)
        elif kind == 'run_checks':
            passed = self.pop(s.checks, 'checks')
            assert isinstance(passed, bool), passed
            f.ok('checks', '--eval', a['eval'], '--worktree', f.work,
                 '--passed' if passed else '--failed')
        elif kind == 'discard_trial':
            result = f.discard(a)
            assert result.returncode == 0, (result.stdout, result.stderr)
        elif kind == 'log':
            result = f.log(a['args'])
            assert result.returncode == 0, (result.stdout, result.stderr)
        elif kind == 'propose':
            change, text = self.pop(s.changes, 'changes')
            f.ok('trial', 'begin', '--worktree', f.work, '--change', change)
            f.commit(text)
            f.ok('trial', 'commit', '--worktree', f.work)
        elif kind not in ('pause', 'stop'):
            raise AssertionError(('unknown next action', a))

    def run(self, stop_after=None, stop_type=None, max_steps=200):
        for count in range(1, max_steps + 1):
            code, a, err = self.f.next()  # Always the first operation, including resume.
            assert code == 0 and isinstance(a, dict), ('next behavior', code, a, err)
            assert 'action' in a, a
            self.actions.append(a)
            dispatch_interrupted = self.perform(a)
            if dispatch_interrupted:
                return a
            if a['action'] in ('pause', 'stop') or count == stop_after or a['action'] == stop_type:
                return a
        raise AssertionError('driver exceeded max-steps: ' + repr(self.actions))


def opened(scores, **options):
    return dict(scores=scores, **options)


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.actions = []

    def records(self):
        p = self.f.engagement / 'results.jsonl'
        return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []

    def step(self, scenario):
        # New driver per action, no previous driver's memory survives.
        d = Driver(self.f, scenario)
        a = d.run(stop_after=1)
        self.actions.extend(d.actions)
        return a

    def walk(self, scenario, predicate):
        for _ in range(200):
            a = self.step(scenario)
            if predicate(a):
                return a
            self.assertNotIn(a['action'], ('pause', 'stop'), a)
        self.fail('scenario exceeded max-steps')

    def logged(self, scenario, decision):
        return self.walk(scenario, lambda a: a['action'] == 'log' and a['decision'] == decision)

    def calibrated(self):
        self.logged(Scenario([opened(calibration())], [True]), 'calibrate')
        self.assertEqual([r['decision'] for r in self.records()], ['calibrate'])

    def expect_next(self, kind, **fields):
        code, a, err = self.f.next()
        self.assertEqual(code, 0, (a, err))
        self.assertIsInstance(a, dict)
        self.assertEqual(a.get('action'), kind, a)
        for k, v in fields.items():
            self.assertEqual(a.get(k), v, a)
        return a

    def resolve(self, decision):
        self.f.ok('resolve', '--decision', decision, '--note', 'by Chris',
                  '--worktree', self.f.work)

    def eval_path(self, name):
        return self.f.engagement / 'evals' / name

    def revert_counts(self):
        messages = self.f.git('log', '--format=%B%x00').stdout.split('\x00')
        counts = Counter()
        for message in messages:
            for line in message.splitlines():
                if line.startswith('This reverts commit '):
                    counts[line.removeprefix('This reverts commit ').rstrip('.')] += 1
        return counts

    def invariants(self):
        records = self.records()
        ids = [r['eval'] for r in records if r.get('eval') and r['decision'] != 'skip']
        self.assertEqual(len(ids), len(set(ids)), records)
        terminal = [r['iteration'] for r in records if r['decision'] in ('keep', 'discard', 'skip')]
        self.assertEqual(len(terminal), len(set(terminal)), records)
        self.assertTrue(all(n == 1 for n in self.revert_counts().values()))
        for r in records:
            if not r.get('eval'):
                continue
            result = read(self.eval_path(r['eval']) / 'result.json')
            if result['status'] == 'invalid':
                self.assertIn(r['decision'], ('invalid', 'skip'))
            if r['decision'] == 'keep':
                self.assertEqual(result['status'], 'keep')
                self.assertIn('cells', r)
                self.assertIn('references', r)
                checks = read(self.eval_path(r['eval']) / 'checks.json')
                self.assertIs(checks['passed'], True)
                self.assertEqual(checks['tree'], r['tree'])
                self.assertEqual(checks['fingerprint'], read(self.eval_path(r['eval']) / 'eval.json')['fingerprint'])

    def test_target_keep_discard_keep_confirm(self):
        # §9.28: full climb; every action runs in a newly constructed Driver.
        s = Scenario([opened(calibration()), opened(measurement(5, 6)),
                      opened(measurement(6, 5)), opened(measurement(6, 9)),
                      opened(calibration(9))], [True] * 4,
                     [('first improvement', 'BETTER\n'), ('regression', 'WORSE\n'),
                      ('target improvement', 'BEST\n')])
        end = self.walk(s, lambda a: a['action'] == 'stop')
        self.assertEqual(end['reason'], 'target')
        records = self.records()
        self.assertEqual([r['decision'] for r in records], ['calibrate', 'keep', 'discard', 'keep', 'confirm'])
        self.assertEqual([r['ratchet'] for r in records], [5, 6, 6, 9, 9])
        last = [r for r in records if r['decision'] == 'keep'][-1]
        self.assertEqual(self.f.tree(), read(self.eval_path(last['eval']) / 'eval.json')['candidate_tree'])
        self.assertEqual(sum(self.revert_counts().values()), 1)
        self.assertFalse(s.opens or s.checks or s.changes)
        self.invariants()

    def drift_pause(self):
        self.calibrated()
        s = Scenario([opened(measurement(5, 6, 4.75))], changes=[('same improvement', 'IMPROVED\n')])
        a = self.logged(s, 'invalid')
        self.assertIs(read(self.eval_path(a['eval']) / 'result.json')['drift'], True)
        self.assertEqual(self.step(s)['action'], 'pause')
        return a['eval']

    def test_drift_retry_keeps_same_trial(self):
        # §9.29 / D3: pause then explicit retry, never an automatic re-measure.
        invalid = self.drift_pause()
        trial = read(self.f.engagement / 'trial.json')
        self.resolve('retry')
        self.logged(Scenario([opened(measurement())], [True]), 'keep')
        keep = self.records()[-1]
        self.assertNotEqual(keep['eval'], invalid)
        self.assertEqual(keep['iteration'], trial['iteration'])
        self.assertEqual(self.f.tree(), read(self.eval_path(keep['eval']) / 'eval.json')['candidate_tree'])
        self.assertEqual([r['decision'] for r in self.records()], ['calibrate', 'invalid', 'keep'])
        self.assertFalse(self.revert_counts())
        self.invariants()

    def test_drift_withdraw_recalibrate_repropose(self):
        # §9.29 / D3: explicit withdraw restores base and forces calibration.
        invalid = self.drift_pause()
        trial = read(self.f.engagement / 'trial.json')
        candidate_tree = self.f.tree()
        self.resolve('withdraw')
        self.logged(Scenario(), 'skip')
        self.assertEqual(self.records()[-1]['reason'], 'withdrawn: by Chris')
        self.assertEqual(self.records()[-1]['eval'], invalid)
        self.assertEqual(self.f.tree(), trial['base_tree'])
        s = Scenario([opened(calibration()), opened(measurement())], [True, True],
                     [('same improvement', 'IMPROVED\n')])
        self.logged(s, 'keep')
        self.assertEqual(self.f.tree(), candidate_tree)
        self.assertEqual([r['decision'] for r in self.records()], ['calibrate', 'invalid', 'skip', 'calibrate', 'keep'])
        self.assertEqual(self.revert_counts(), {trial['commit']: 1})
        self.invariants()

    def test_numeric_keep_failed_guardrail_discards(self):
        # §9.30: numeric improvement is a positive control, failed checks override it.
        self.calibrated()
        incumbent = self.f.tree()
        s = Scenario([opened(measurement())], [False], [('unsafe improvement', 'UNSAFE\n')])
        a = self.logged(s, 'discard')
        self.assertEqual(read(self.eval_path(a['eval']) / 'result.json')['status'], 'keep')
        self.assertIs(read(self.eval_path(a['eval']) / 'checks.json')['passed'], False)
        self.assertEqual(self.f.tree(), incumbent)
        self.assertEqual(self.records()[-1]['ratchet'], 5)
        self.assertEqual(sum(self.revert_counts().values()), 1)
        self.expect_next('propose', iteration=2)
        self.invariants()

    def failed_calibration(self, decision):
        # §9.31 / D7: failed checks finalize invalid; both resolutions recover.
        s = Scenario([opened(calibration())], [False])
        a = self.logged(s, 'invalid')
        self.assertEqual(read(self.eval_path(a['eval']) / 'result.json')['status'], 'valid')
        self.assertEqual(self.records()[-1]['reason'], 'checks failed')
        self.assertEqual(self.step(s)['action'], 'pause')
        self.resolve(decision)
        self.logged(Scenario([opened(calibration())], [True]), 'calibrate')
        self.expect_next('propose', iteration=1)
        self.assertEqual([r['decision'] for r in self.records()], ['invalid', 'calibrate'])
        self.invariants()

    def test_failed_calibration_retry(self):
        # §9.31 / D7.
        self.failed_calibration('retry')

    def test_failed_calibration_continue(self):
        # §9.31 / D7 / D8.
        self.failed_calibration('continue')

    def interrupted(self, point):
        # §9.32: every boundary followed by a fresh next, never replay an action.
        self.calibrated()
        incumbent = self.f.tree()
        bad = point in ('error_return', 'drift_result', 'mid_dispatch')
        options = {'errors': {0: 'offline judge failure'}} if point == 'error_return' else {}
        if point == 'mid_dispatch':
            options['partial'] = 1
        values = measurement(reference=4.75 if point == 'drift_result' else 4)
        failed = point in ('failed_checks', 'revert')
        s = Scenario([opened(values, **options)], [not failed], [('pending improvement', 'PENDING\n')])
        boundary = {'score_keep': 'score', 'failed_checks': 'run_checks',
                    'revert': 'discard_trial', 'error_return': 'open',
                    'drift_result': 'score', 'trial_commit': 'propose',
                    'candidate_capture': 'capture', 'mid_dispatch': 'open'}[point]
        self.walk(s, lambda a: a['action'] == boundary and
                  (boundary != 'capture' or a['role'] == 'candidate'))
        trial = read(self.f.engagement / 'trial.json')
        if point in ('score_keep', 'failed_checks', 'revert'):
            self.assertEqual(read(self.eval_path(self.actions[-1].get('eval', 'e0002')) / 'result.json')['status'], 'keep')
        if point == 'failed_checks':
            self.assertIs(read(self.eval_path(self.actions[-1]['eval']) / 'checks.json')['passed'], False)
        if point == 'revert':
            self.assertEqual(self.f.tree(), incumbent)
            self.assertFalse(any(r['decision'] == 'discard' for r in self.records()))
        if point == 'mid_dispatch':
            e = self.f.engagement / 'evals/e0002'
            self.assertEqual(len(list(e.glob('*/return.json'))), 1)
            self.assertEqual(self.step(s)['action'], 'abandon')
        if bad:
            a = self.logged(s, 'invalid')
            self.assertEqual(read(self.eval_path(a['eval']) / 'result.json')['status'], 'invalid')
            if point == 'drift_result':
                self.assertIs(read(self.eval_path(a['eval']) / 'result.json')['drift'], True)
            self.assertEqual(self.step(s)['action'], 'pause')
            self.assertFalse(any(r['decision'] in ('keep', 'discard') for r in self.records()))
            self.resolve('retry')
            self.logged(Scenario([opened(measurement())], [True]), 'keep')
        else:
            self.logged(s, 'discard' if failed else 'keep')
        final = self.records()[-1]
        self.assertEqual(final['decision'], 'discard' if failed else 'keep')
        self.assertEqual(final['iteration'], trial['iteration'])
        self.assertEqual(self.f.tree(), incumbent if failed else
                         read(self.eval_path(final['eval']) / 'eval.json')['candidate_tree'])
        self.assertEqual(read(self.eval_path(final['eval']) / 'eval.json')['candidate_tree'],
                         self.f.git('rev-parse', trial['commit'] + '^{tree}').stdout.strip())
        self.assertEqual(self.revert_counts(), {trial['commit']: 1} if failed else {})
        if not failed:
            # Rule 12 needs two captures of the now-kept tree; the candidate
            # supplied one. Resume through that housekeeping to a stable proposal.
            self.expect_next('capture', role='incumbent')
            self.assertEqual(self.step(Scenario())['action'], 'capture')
        self.expect_next('propose', iteration=2)
        self.invariants()

    def test_restart_rechecks_wrong_tree_before_keep(self):
        self.calibrated()
        s = Scenario([opened(measurement())], [True], [('improvement', 'IMPROVED\n')])
        a = self.walk(s, lambda a: a['action'] == 'score')
        self.assertEqual(read(self.eval_path(a['eval']) / 'result.json')['status'], 'keep')
        self.f.ok('checks', '--eval', a['eval'], '--worktree', self.f.primary, '--passed')
        self.expect_next('run_checks', eval=a['eval'], target='candidate', tree=self.f.tree())
        self.logged(s, 'keep')
        self.invariants()

    def test_budget_across_restarts_between_opens(self):
        # §9.32 / §5.6: opens charge persisted requests, including abandoned work.
        p = self.f.protocol.copy()
        p['budget_calls'] = 8
        self.f.write_methodology(p)
        s = Scenario([opened(calibration(), partial=1)])
        self.logged(s, 'invalid')
        self.assertEqual(self.step(s)['action'], 'pause')
        self.resolve('retry')
        s = Scenario([opened(calibration())], [True], [('budget candidate', 'BUDGET\n')])
        end = self.walk(s, lambda a: a['action'] == 'stop')
        self.assertEqual(end['reason'], 'budget')
        metas = [read(p) for p in (self.f.engagement / 'evals').glob('*/eval.json')]
        self.assertEqual(len(metas), 2)
        self.assertEqual(sum(m['requests'] for m in metas), 8)
        self.assertLessEqual(sum(m['requests'] for m in metas), self.f.protocol['budget_calls'])
        self.assertEqual([r['decision'] for r in self.records()], ['invalid', 'calibrate'])
        self.invariants()


for _point in ('score_keep', 'failed_checks', 'revert', 'error_return', 'drift_result',
               'trial_commit', 'candidate_capture', 'mid_dispatch'):
    def _test(self, point=_point):
        # §9.32: one isolated repository for each interruption.
        self.interrupted(point)
    setattr(LifecycleTests, 'test_interrupt_' + _point, _test)


class DriverTests(unittest.TestCase):
    def test_driver_scripted_actions_and_interrupts(self):
        # §9.28–32 driver self-check: fake next/commands, real returns/Git/log/revert.
        with Fixture() as f:
            calls = []
            def fake_ok(command, *args):
                calls.append((command, *args))
                if command == 'open':
                    f.seed_json('evals/e0001/eval.json', {'panel': panel()})
                    requests = []
                    for role in ('primary', 'second'):
                        path = f.seed_json(f'evals/e0001/{role}-1/mapping.json',
                                           {'B': 'incumbent', 'A': 'candidate', 'Ref-1': 'ref:ref-1.md'}).parent
                        requests.append(dict(role=role, k=1, dir=str(path), request_md=str(path / 'request.md')))
                    return dict(eval='e0001', requests=requests)
                return {}

            def run_actions(actions, s, **kwargs):
                with patch.object(f, 'next', side_effect=[(0, a, '') for a in actions]), patch.object(f, 'ok', side_effect=fake_ok):
                    d = Driver(f, s)
                    result = d.run(**kwargs)
                    self.assertEqual(d.actions, actions)
                    return result

            base, tree = f.head(), f.tree()
            s = Scenario([opened(measurement(), errors={0: 'recorded error'}, partial=1)],
                         [False, True], [('scripted change', 'DRIVER CHANGE\n')], seed=19)
            run_actions([dict(action='propose', iteration=1)], s, stop_after=1)
            trial = f.head()
            self.assertNotEqual(trial, base)
            self.assertEqual((f.work / 'doc.md').read_text(), 'DRIVER CHANGE\n')
            run_actions([dict(action='capture', role='candidate')], s, stop_type='capture')
            run_actions([dict(action='open', purpose='measure')], s)
            e = f.engagement / 'evals/e0001'
            self.assertEqual(read(e / 'primary-1/return.json'), {'error': 'recorded error'})
            self.assertEqual(read(e / 'primary-1/invocation.json'), panel()['primary'])
            self.assertFalse((e / 'second-1/return.json').exists())
            # A complete dispatch verifies semantic A/B decoding separately.
            s.opens.append(opened(measurement()))
            run_actions([dict(action='open', purpose='measure')], s, stop_after=1)
            self.assertEqual(read(e / 'second-1/return.json')['items']['A']['clarity']['score'], 6)
            self.assertEqual(read(e / 'second-1/return.json')['items']['B']['accuracy']['score'], 5)
            # The self-check uses the real logger's supported legacy argv; lifecycle
            # actions must supply judged extras and are checked by invariants().
            args = [str(f.engagement / 'results.jsonl'), '1', 'scripted change', 'pass',
                    '5', '6', '5', 'discard', 'checks failed']
            actions = [dict(action='score', eval='e0001'),
                       dict(action='run_checks', eval='e0001', target='candidate', tree=f.tree()),
                       dict(action='run_checks', eval='e0001', target='candidate', tree=f.tree()),
                       dict(action='invalidate', eval='e0001', reason='stale'),
                       dict(action='abandon', eval='e0001'),
                       dict(action='discard_trial', worktree=str(f.work), branch='experiment', base=base, trial=trial),
                       dict(action='log', decision='discard', eval='e0001', args=args),
                       dict(action='pause', reason='scripted boundary')]
            self.assertEqual(run_actions(actions, s)['action'], 'pause')
            self.assertEqual(f.tree(), tree)
            self.assertEqual(json.loads((f.engagement / 'results.jsonl').read_text())['decision'], 'discard')
            self.assertIn('This reverts commit ' + trial, f.git('log', '-1', '--format=%B').stdout)
            expected = [('trial', 'begin', '--worktree', f.work, '--change', 'scripted change'),
                        ('trial', 'commit', '--worktree', f.work),
                        ('capture', '--worktree', f.work, '--role', 'candidate'),
                        ('open', '--purpose', 'measure', '--panel', f.panel_path, '--seed', 19)]
            self.assertEqual(calls[:4], expected)
            self.assertEqual(calls[4:], [expected[-1], ('score', '--eval', 'e0001'),
                             ('checks', '--eval', 'e0001', '--worktree', f.work, '--failed'),
                             ('checks', '--eval', 'e0001', '--worktree', f.work, '--passed'),
                             ('invalidate', '--eval', 'e0001', '--reason', 'stale'),
                             ('abandon', '--eval', 'e0001')])
            self.assertEqual(run_actions([dict(action='stop', reason='budget')], s)['reason'], 'budget')
            with patch.object(f, 'next', return_value=(0, dict(action='capture', role='incumbent'), '')), patch.object(f, 'ok', return_value={}):
                with self.assertRaisesRegex(AssertionError, 'max-steps'):
                    Driver(f, Scenario()).run(max_steps=2)


if __name__ == '__main__':
    unittest.main()
