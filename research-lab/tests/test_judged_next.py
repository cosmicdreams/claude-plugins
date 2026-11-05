"""Frozen packet 2: offline transitions, scope.md takes precedence over plan §9.

Every next call runs a fresh process and checks paths AND bytes for purity.
Helpers execute fixed documented steps, never dispatch on the returned action.
Hand-seeding is limited to deliberate corruption that no subcommand can produce.

Contract interpretations used here:
* Rule 12 precedes target handling: target candidates are captured twice before
  measurement so their kept tree is already eligible for confirmation.
* A skip with no trial evaluation need not name the unrelated last calibration;
  skip actions withdrawing a measured evaluation must preserve that eval id.
* Human review text has no judge-evaluation source; its diagnostic eval id is
  not pinned. Scored incumbent/tried critiques must carry their source eval id.
* D16 cheap-gate skips have no next-generated log action; the orchestrator writes
  them with the real logger, using the iteration returned by propose.
* D8 makes every withdraw stale, including withdrawal before a trial commit.
"""
import json
from pathlib import Path
import unittest

from judged_fixtures import Fixture, panel, write_panel


class JudgedNextTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        self.serial = 0

    def read(self, path):
        return json.loads(Path(path).read_text(encoding='utf-8'))

    def snapshot(self):
        return {str(p.relative_to(self.f.engagement)):
                p.read_bytes() if p.is_file() else None
                for p in self.f.engagement.rglob('*')}

    def action(self, expected, **fields):
        before, head = self.snapshot(), self.f.head()
        code, result, err = self.f.next()
        self.assertEqual(self.snapshot(), before, 'next wrote engagement state')
        self.assertEqual(self.f.head(), head, 'next moved HEAD')
        self.assertEqual(code, 0, (result, err))
        self.assertIsInstance(result, dict)
        self.assertEqual(result.get('action'), expected, result)
        for key, value in fields.items():
            self.assertEqual(result.get(key), value, result)
        return result

    def capture(self, role='incumbent'):
        r = self.f.ok('capture', '--worktree', self.f.work, '--role', role)
        self.assertEqual(r.get('status'), 'ok', r)
        return r

    def opened(self, purpose):
        r = self.f.ok('open', '--purpose', purpose, '--panel', self.f.panel_path, '--seed', 0)
        self.assertRegex(r.get('eval', ''), r'^e\d{4,}$')
        e = self.f.engagement / 'evals' / r['eval']
        self.assertEqual(self.read(e / 'eval.json')['purpose'], purpose)
        return e

    def returns(self, e, values=None, tag='critique'):
        for mapping in sorted(e.glob('*/mapping.json')):
            role, k = mapping.parent.name.rsplit('-', 1)
            scores = {v: (values or {}).get(v, 4 if v.startswith('ref:') else 5)
                      for v in self.read(mapping).values()}
            critiques = {v: {c: f'{tag}:{v}:{c}' for c in self.f.protocol['categories']}
                         for v in scores}
            self.f.write_return(e, role, int(k), scores, critiques=critiques)

    def score(self, e, status):
        r = self.f.ok('score', '--eval', e.name)
        self.assertEqual(r.get('status'), status, r)
        return r

    def checks(self, e, target, passed=True):
        self.action('run_checks', eval=e.name, target=target, tree=self.f.tree())
        self.f.ok('checks', '--eval', e.name, '--worktree', self.f.work,
                  '--passed' if passed else '--failed')

    def records(self):
        p = self.f.engagement / 'results.jsonl'
        return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []

    def retained(self):
        return next((r['ratchet'] for r in reversed(self.records())
                     if r['decision'] in ('keep', 'discard', 'calibrate', 'confirm')), None)

    def log(self, decision, e=None, after=None, ratchet=None, iteration=None, prefix=None):
        a = self.action('log', decision=decision, **({'eval': e.name} if e else {}))
        args = a.get('args')
        self.assertIsInstance(args, list)
        self.assertEqual(len(args), 10)
        self.assertEqual(Path(args[0]), self.f.engagement / 'results.jsonl')
        extras = json.loads(args[9])
        self.assertIsInstance(extras, dict)
        self.assertEqual(extras.get('metric_type'), 'judged')
        if decision == 'keep':
            self.assertIn('cells', extras)
            self.assertIn('references', extras)
        if e:
            self.assertEqual(extras.get('eval'), e.name)
        before = self.retained()
        count = len(self.records())
        run = self.f.log(args)
        self.assertEqual(run.returncode, 0, (run.stdout, run.stderr))
        records = self.records()
        self.assertEqual(len(records), count + 1)
        record = records[-1]
        self.assertEqual(record['decision'], decision)
        self.assertEqual(record['metric_type'], 'judged')
        if decision in ('invalid', 'skip'):
            self.assertIn(record['metric_before'], (before, None))
        else:
            self.assertEqual(record['metric_before'], before)
        self.assertEqual(record['metric_after'], after)
        self.assertEqual(record['ratchet'], ratchet)
        self.assertEqual(record['gate'], 'skip' if decision == 'skip' else 'pass')
        if iteration is not None:
            self.assertEqual(record['iteration'], iteration)
        if prefix:
            self.assertTrue(record['reason'].startswith(prefix), record)
        if e:
            self.assertEqual(record['eval'], e.name)
        if decision in ('keep', 'calibrate', 'confirm'):
            self.assertEqual(record.get('tree'), self.f.tree())
        if decision in ('keep', 'discard', 'skip'):
            self.assertEqual(record['change'], self.read(self.f.engagement / 'trial.json')['change'])
        elif decision in ('calibrate', 'confirm'):
            self.assertEqual(record['change'], 'Calibration' if decision == 'calibrate' else 'Confirmation')
        return record

    def calibrated(self, metric=5):
        # §9.21: fixed fresh-engagement actions, no next-driven branching.
        self.action('capture', role='incumbent'); self.capture()
        self.action('capture', role='incumbent'); self.capture()
        return self.calibrate_existing(metric)

    def calibrate_existing(self, metric=5):
        self.action('open', purpose='calibrate')
        e = self.opened('calibrate')
        self.returns(e, {'capture-1': metric, 'capture-2': metric})
        self.action('score', eval=e.name)
        self.score(e, 'valid')
        self.checks(e, 'incumbent')
        self.log('calibrate', e, ratchet=metric,
                 iteration=max((r['iteration'] for r in self.records()), default=0))
        return e

    def resolve(self, decision, note='by Chris'):
        pending = (self.f.engagement / 'trial.json').exists() and not any(
            r['decision'] in ('keep', 'discard', 'skip') and r['iteration'] ==
            self.read(self.f.engagement / 'trial.json')['iteration'] for r in self.records())
        self.f.ok('resolve', '--decision', decision, '--note', note, '--worktree', self.f.work)
        if decision == 'continue':
            record = json.loads((self.f.engagement / 'resolutions.jsonl').read_text().splitlines()[-1])
            self.assertIs(record['adopted'], not pending)

    def begin(self):
        self.f.ok('trial', 'begin', '--worktree', self.f.work, '--change', 'Improve text')
        return self.read(self.f.engagement / 'trial.json')

    def candidate(self, captures=2):
        self.begin()
        self.serial += 1
        self.f.commit(f'REVISION {self.serial}\n')
        self.f.ok('trial', 'commit', '--worktree', self.f.work)
        for _ in range(captures):
            self.capture('candidate')
        return self.read(self.f.engagement / 'trial.json')

    def measured(self, incumbent=5, candidate=6, status='keep', tag='measure'):
        self.action('open', purpose='measure')
        e = self.opened('measure')
        self.returns(e, {'incumbent': incumbent, 'candidate': candidate}, tag)
        self.action('score', eval=e.name)
        self.score(e, status)
        return e

    def discard(self):
        t = self.read(self.f.engagement / 'trial.json')
        a = self.action('discard_trial', worktree=t['worktree'], branch=t['branch'],
                        base=t['base'], trial=t['commit'])
        run = self.f.discard(a)
        self.assertEqual(run.returncode, 0, (run.stdout, run.stderr))
        self.assertEqual(self.f.tree(), t['base_tree'])
        self.assertEqual(self.f.git('rev-list', '--parents', '-n', '1', 'HEAD').stdout.split(),
                         [self.f.head(), t['commit']])
        return t

    def keep(self, incumbent=5, candidate=6):
        self.candidate()
        e = self.measured(incumbent, candidate)
        self.checks(e, 'candidate')
        self.log('keep', e, after=candidate, ratchet=candidate,
                 iteration=self.read(self.f.engagement / 'trial.json')['iteration'])
        return e

    def lose(self, incumbent=6, candidate=5, tag='discard'):
        self.candidate(captures=1)
        e = self.measured(incumbent, candidate, 'discard', tag)
        t = self.discard()
        self.log('discard', e, after=candidate, ratchet=incumbent, iteration=t['iteration'])
        return e

    def mutate(self, kind):
        if kind == 'panel':
            p = panel(); p['primary']['options']['effort'] = 'low'
            write_panel(self.f.panel_path, p)
        elif kind in ('margin_floor', 'judges', 'relative_to', 'guardrails'):
            p = self.f.protocol.copy()
            if kind == 'margin_floor': p[kind] = 0.5
            elif kind == 'judges': p[kind] = [dict(j, tier=4) for j in p[kind]]
            elif kind == 'relative_to': p[kind] = 'references'
            else: p[kind] = ['guard.sh --strict']
            self.f.write_methodology(p)
        elif kind == 'reference_manifest':
            # Deliberate manifest corruption has no subcommand writer after first open.
            path = self.f.engagement / 'references/manifest.json'
            value = self.read(path)
            def changed(v):
                if isinstance(v, dict): return {k: changed(x) for k, x in v.items()}
                if isinstance(v, list): return [changed(x) for x in v]
                if isinstance(v, str) and len(v) == 64: return '0' * 64
                return v
            altered = changed(value)
            self.assertNotEqual(value, altered)
            path.write_text(json.dumps(altered))
        elif kind == 'rubric':
            p = self.f.protocol.copy()
            p['categories'] = dict(p['categories'], clarity='Changed rubric')
            self.f.write_methodology(p)
        else:
            p = self.f.methodology_dir / ('capture.sh' if kind == 'capture' else 'guard.sh')
            p.write_text(p.read_text() + '\n# changed bytes, same command\n')

    def withdraw(self, e=None, reason='withdrawn: by Chris'):
        retained = self.retained()
        t = self.discard()
        self.log('skip', e, ratchet=retained, iteration=t['iteration'], prefix=reason)

    def test_keep_discard_discard_incumbent(self):
        # §9.11, rules 6–7/17: real reverts preserve the kept tree.
        self.calibrated(); self.keep()
        tree = self.f.tree()
        self.lose(); self.lose()
        self.assertEqual(self.f.tree(), tree)
        self.action('propose', iteration=4)
        self.begin()  # positive ownership control after revert commits

    def test_later_lower_keep_is_incumbent(self):
        # §9.12: latest keep wins even when an older metric was larger.
        self.calibrated(); self.keep(5, 7)
        old_tree = self.f.tree()
        self.keep(4, 5)
        self.assertNotEqual(self.f.tree(), old_tree)
        self.action('propose', iteration=3)
        t = self.begin()
        self.assertEqual(t['base_tree'], self.f.tree())

    def test_reject_target_then_changed_tree_eligible(self):
        # §9.13 / D8: reject belongs to a tree, and supplies review diagnostics.
        self.calibrated(); e = self.keep(5, 9)
        self.confirm(9)
        self.action('stop', reason='target')
        self.resolve('reject', 'Review: fix clarity')
        a = self.action('propose', iteration=2)
        reviews = [d for d in a['diagnostics'] if d['kind'] == 'review']
        self.assertTrue(any('Review: fix clarity' in d['text'] for d in reviews))
        self.keep(8, 9.5)
        self.action('open', purpose='confirm')

    def test_missing_return_abandon_budget_and_new_id(self):
        # §9.14 / D6, rules 1/4/9: abandon finalizes once, remains spent.
        self.capture(); self.capture(); e = self.opened('calibrate')
        # A partial dispatch: one return is present, the others are missing.
        mapping = self.read(e / 'primary-1/mapping.json')
        self.f.write_return(e, 'primary', 1,
                            {v: 4 if v.startswith('ref:') else 5 for v in mapping.values()})
        self.action('abandon', eval=e.name)
        self.f.ok('abandon', '--eval', e.name)
        self.log('invalid', e, iteration=0)
        self.action('pause', rule=9); self.action('pause', rule=9)
        self.resolve('retry')
        p = self.f.protocol.copy(); p['budget_calls'] = 7; self.f.write_methodology(p)
        self.action('stop', reason='budget')
        p['budget_calls'] = 8; self.f.write_methodology(p)
        self.action('open', purpose='calibrate')
        new = self.opened('calibrate')
        self.assertEqual((e.name, new.name), ('e0001', 'e0002'))
        self.assertEqual(sum(self.read(p)['requests'] for p in
                             (self.f.engagement / 'evals').glob('*/eval.json')), 8)

    def test_error_return_scores_then_invalid_pause(self):
        # §9.14/19 / D4: a single invalid calibration pauses across restarts.
        self.capture(); self.capture(); e = self.opened('calibrate'); self.returns(e)
        (e / 'primary-1/return.json').write_text('{"error":"offline failure"}')
        self.action('score', eval=e.name); self.score(e, 'invalid')
        self.log('invalid', e, iteration=0)
        self.action('pause', rule=9); self.action('pause', rule=9)
        self.resolve('retry'); self.action('open', purpose='calibrate')

    def test_gate_g1_malformed_trial(self):
        # §9.15: deliberate corruption cannot be produced by the real trial writer.
        (self.f.engagement / 'trial.json').write_text('{broken')
        self.action('pause', gate='G1')

    def test_gate_g3_unknown_tree_continue_adopts(self):
        # §9.15/26 / D8: continue adopts a clean unknown tree, stales calibration.
        self.calibrated(); self.f.commit('HUMAN CHANGE\n')
        self.action('pause', gate='G3'); self.resolve('continue')
        self.action('capture', role='incumbent'); self.capture()
        self.action('capture', role='incumbent'); self.capture()
        self.calibrate_existing()
        self.action('propose', iteration=1)
        self.assertEqual(self.begin()['base_tree'], self.f.tree())

    def test_gate_g3_dirty_without_trial(self):
        # §9.15: even the incumbent tree must be clean.
        self.calibrated(); (self.f.work / 'doc.md').write_text('DIRTY')
        self.action('pause', gate='G3')

    def test_stale_calibration_withdraw_no_second_revert(self):
        # §9.17, rule 8: restart after real revert logs skip, never reverts twice.
        self.calibrated(); t = self.candidate(); self.mutate('capture')
        self.withdraw(reason='withdrawn: calibration changed')
        self.assertEqual(self.f.tree(), t['base_tree'])
        self.action('capture', role='incumbent'); self.capture()
        self.action('capture', role='incumbent'); self.capture()
        self.action('open', purpose='calibrate')

    def drifted(self):
        self.calibrated(); self.candidate()
        self.action('open', purpose='measure'); e = self.opened('measure'); self.returns(e)
        for path in e.glob('*/return.json'):
            data = self.read(path)
            for label, meaning in self.read(path.parent / 'mapping.json').items():
                if meaning.startswith('ref:'):
                    data['items'][label]['clarity']['score'] = 5.25
            path.write_text(json.dumps(data))
        self.action('score', eval=e.name)
        self.assertIs(self.score(e, 'invalid').get('drift'), True)
        record = self.log('invalid', e, ratchet=5, iteration=1)
        self.assertIs(record.get('drift'), True)
        self.action('pause', rule=9); self.action('pause', rule=9)
        return e

    def test_drift_retry_same_trial(self):
        # §9.18 / D3: explicit retry remeasures the same candidate and iteration.
        old = self.drifted(); t = self.read(self.f.engagement / 'trial.json')
        self.resolve('retry'); e = self.measured()
        meta = self.read(e / 'eval.json')
        self.assertNotEqual(e.name, old.name)
        self.assertEqual(meta['iteration'], t['iteration'])
        self.assertEqual(meta['candidate_tree'], self.f.tree())
        self.assertEqual(self.read(self.f.engagement / 'trial.json'), t)

    def test_drift_withdraw_forces_recalibration(self):
        # §9.18 / D3: withdraw stales an otherwise matching calibration.
        e = self.drifted(); self.resolve('withdraw'); self.withdraw(e)
        self.action('open', purpose='calibrate')

    def test_empty_and_new_capture_fingerprint(self):
        # §9.21, rules 12–13: script bytes force two new captures.
        self.action('capture', role='incumbent'); self.capture()
        self.action('capture', role='incumbent'); self.capture()
        self.action('open', purpose='calibrate'); self.mutate('capture')
        self.action('capture', role='incumbent'); self.capture()
        self.action('capture', role='incumbent'); self.capture()
        self.action('open', purpose='calibrate')

    def test_pending_commit_capture_then_measure(self):
        # §9.22, rule 10: committed candidate is measured before proposing again.
        self.calibrated(); self.candidate(captures=0)
        self.action('capture', role='candidate')
        before = self.snapshot()
        code, value, err = self.f.run('trial', 'begin', '--worktree', self.f.work, '--change', 'again')
        self.assertEqual(code, 1, (value, err)); self.assertTrue(value.get('error'))
        self.assertEqual(self.snapshot(), before)
        self.capture('candidate'); self.action('open', purpose='measure')

    def confirm(self, metric):
        self.action('open', purpose='confirm'); e = self.opened('confirm')
        self.returns(e, {'capture-1': metric, 'capture-2': metric})
        self.action('score', eval=e.name); self.score(e, 'valid')
        self.checks(e, 'incumbent')
        self.log('confirm', e, ratchet=metric, iteration=1)
        return e

    def test_confirm_below_target_climbs_without_second_confirm(self):
        # §9.23, rule 14: selection at target requires independent confirmation.
        self.calibrated(); self.keep(5, 9); self.confirm(8)
        self.action('propose', iteration=2); self.action('propose', iteration=2)

    def test_confirm_target_and_panel_epoch(self):
        # §9.23: old successful confirmation cannot stop a changed panel.
        self.calibrated(); self.keep(5, 9); self.confirm(9)
        self.action('stop', reason='target'); self.mutate('panel')
        self.calibrate_existing(9)
        self.confirm(9); self.action('stop', reason='target')

    def test_calibration_failed_checks_logs_invalid_pauses(self):
        # Rule 5 / D7: failing incumbent checks finalizes invalid, not calibrate.
        self.capture(); self.capture(); e = self.opened('calibrate'); self.returns(e)
        self.score(e, 'valid'); self.checks(e, 'incumbent', False)
        self.log('invalid', e, iteration=0)
        self.action('pause', rule=9); self.resolve('retry')
        self.action('open', purpose='calibrate')

    def test_failed_candidate_checks_discards(self):
        # Rules 6–7: numeric keep alone cannot retain an unsafe candidate.
        self.calibrated(); self.candidate(); e = self.measured()
        self.checks(e, 'candidate', False); self.discard()
        self.log('discard', e, after=6, ratchet=5, iteration=1)
        self.action('propose', iteration=2)

    def test_pending_without_commit_withdraw_logs_skip(self):
        # Rule 11: no commit means no revert, but withdrawal must finalize iteration.
        self.calibrated(); self.begin(); self.action('pause', rule=11)
        self.resolve('withdraw')
        self.log('skip', ratchet=5, iteration=1, prefix='withdrawn: by Chris')
        self.action('open', purpose='calibrate')

    def test_next_readonly_repeated_states(self):
        # Contract: paths plus bytes unchanged for repeated next in distinct states.
        self.action('capture', role='incumbent'); self.action('capture', role='incumbent')
        self.calibrated()
        self.action('propose', iteration=1); self.action('propose', iteration=1)
        self.begin(); self.action('pause', rule=11); self.action('pause', rule=11)

    def test_diagnostics_incumbent_tried_review(self):
        # §9.27: decoded critiques retain provenance and semantic kind.
        self.calibrated(); self.keep(); e = self.lose(tag='last-discard')
        self.resolve('reject', 'Human review note')
        a = self.action('propose', iteration=3)
        ds = a['diagnostics']
        for kind, meaning in [('incumbent', 'incumbent'), ('tried', 'candidate')]:
            relevant = [d for d in ds if d.get('kind') == kind and d.get('eval') == e.name]
            self.assertTrue(relevant, (kind, ds))
            self.assertTrue(any(f'last-discard:{meaning}:' in d['text'] for d in relevant))
        self.assertTrue(any(d['kind'] == 'review' and 'Human review note' in d['text'] for d in ds))


    def limits(self, **changes):
        p = self.f.protocol.copy(); p.update(changes); self.f.write_methodology(p)

    def cheap_skip(self, iteration):
        # D16 explicitly makes the orchestrator build this log (no trial/eval).
        self.action('propose', iteration=iteration)
        args = [str(self.f.engagement / 'results.jsonl'), str(iteration),
                'Cheap gate rejection', 'skip', str(self.retained()), 'null',
                str(self.retained()), 'skip', 'cheap gate',
                json.dumps({'metric_type': 'judged'})]
        run = self.f.log(args)
        self.assertEqual(run.returncode, 0, (run.stdout, run.stderr))
        r = self.records()[-1]
        self.assertEqual((r['iteration'], r['decision'], r['metric_after'], r['ratchet']),
                         (iteration, 'skip', None, self.retained()))

    def test_iteration_limit_with_call_budget_left(self):
        # §9.25 / rule 15: measured distinct iterations consume the iteration cap.
        self.calibrated(); self.limits(iterations=1)
        self.keep(); self.action('stop', reason='iterations')
        self.limits(iterations=2); self.action('propose', iteration=2)

    def test_withdrawals_do_not_consume_iterations_or_futility(self):
        # §9.25: withdrawal increments proposal id but consumes neither limit.
        self.calibrated(); self.limits(iterations=1, futility=1)
        self.candidate(); self.resolve('withdraw'); self.withdraw()
        self.calibrate_existing()
        self.action('propose', iteration=2)
        self.keep(); self.action('stop', reason='iterations')

    def test_remeasure_is_one_iteration(self):
        # §9.25: invalid + retry + keep is one iteration, never a futility event.
        old = self.drifted(); self.limits(iterations=2, futility=1)
        self.resolve('retry'); e = self.measured()
        self.assertNotEqual(e.name, old.name)
        self.assertEqual(self.read(e / 'eval.json')['iteration'], 1)
        self.checks(e, 'candidate')
        self.log('keep', e, after=6, ratchet=6, iteration=1)
        self.action('propose', iteration=2)

    def test_trial_begin_refuses_after_futility_stop(self):
        self.calibrated(); self.limits(futility=1); self.lose()
        self.action('stop', reason='futility')
        before = self.snapshot()
        code, out, err = self.f.run('trial', 'begin', '--worktree', self.f.work, '--change', 'too late')
        self.assertEqual(code, 1, (out, err))
        self.assertIn('stop futility', out['error'])
        self.assertEqual(self.snapshot(), before)

    def test_keep_resets_futility(self):
        # §9.25 / rule 16: keep resets the discard streak.
        self.calibrated(); self.limits(futility=2)
        self.lose(); self.keep(); self.lose()
        self.action('propose', iteration=4)
        self.lose(); self.action('stop', reason='futility')


    def test_continue_pending_trial_does_not_adopt_or_stale(self):
        self.calibrated(); incumbent = self.f.tree()
        self.candidate(); e = self.measured()
        self.f.git('checkout', '-b', 'temporary')
        self.action('pause', gate='G2')
        self.f.git('checkout', 'experiment'); self.resolve('continue')
        self.checks(e, 'candidate', False); self.discard()
        self.log('discard', e, after=6, ratchet=5, iteration=1)
        self.assertEqual(self.f.tree(), incumbent)
        self.action('propose', iteration=2)

    def test_gate_g2_unrecorded_commit(self):
        self.calibrated(); self.begin(); self.f.commit('UNRECORDED COMMIT\n')
        self.assertIsNone(self.read(self.f.engagement / 'trial.json')['commit'])
        self.action('pause', gate='G2')

    def test_confirm_target_and_protocol_epoch(self):
        self.calibrated(); self.keep(5, 9); self.confirm(9)
        self.action('stop', reason='target'); self.mutate('rubric')
        self.calibrate_existing(9)
        self.confirm(9); self.action('stop', reason='target')


# Generated cases are separate unittest tests, each owns a fresh isolated repository.
def gate_g2(case):
    def test(self):
        # §9.15/26: ownership gates precede checks/log; fixed G2 resumes in place.
        self.calibrated(); self.candidate(); e = self.measured()
        if case == 'branch': self.f.git('checkout', '-b', 'other')
        elif case == 'dirty': (self.f.work / 'doc.md').write_text('DIRTY')
        elif case == 'worktree':
            other = self.f.root / 'other'
            self.f.git('worktree', 'add', '-b', 'other', str(other))
            original = self.f.work
            self.f.work = other
        else: self.f.commit('UNRELATED COMMIT\n')
        self.action('pause', gate='G2')
        if case == 'branch':
            self.f.git('checkout', 'experiment'); self.resolve('continue')
            self.checks(e, 'candidate')
            self.log('keep', e, after=6, ratchet=6, iteration=1)
            self.action('propose', iteration=2)
        if case == 'worktree': self.f.work = original
    return test


for _case in ('branch', 'dirty', 'unrelated_commit', 'worktree'):
    setattr(JudgedNextTests, 'test_gate_g2_' + _case, gate_g2(_case))


def stale_keep(kind, checked):
    def test(self):
        # §9.16, rules 3/4/8: stale result invalidates even after passed checks.
        self.calibrated(); self.candidate(); e = self.measured()
        if checked: self.checks(e, 'candidate')
        self.mutate(kind)
        self.action('invalidate', eval=e.name, reason='stale')
        self.f.ok('invalidate', '--eval', e.name, '--reason', 'stale')
        self.log('invalid', e, ratchet=5, iteration=1, prefix='stale')
        self.withdraw(e, reason='withdrawn: calibration changed')
        if kind == 'capture':
            self.action('capture', role='incumbent'); self.capture()
            self.action('capture', role='incumbent'); self.capture()
        self.action('open', purpose='calibrate')
    return test


for _kind in ('panel', 'rubric', 'capture', 'guardrail'):
    for _checked in (False, True):
        setattr(JudgedNextTests, f'test_stale_keep_{_kind}_{"after" if _checked else "before"}_checks',
                stale_keep(_kind, _checked))


def capture_failure(role):
    def test(self):
        # §9.20 / D4: one failure pauses across process restart; retry clears it.
        if role == 'candidate': self.calibrated(); self.candidate(captures=0)
        self.action('capture', role=role)
        mode = self.f.methodology_dir / 'capture-mode'; mode.write_text('nonzero')
        result = self.f.ok('capture', '--worktree', self.f.work, '--role', role)
        self.assertEqual(result.get('status'), 'invalid')
        self.action('pause', rule=10 if role == 'candidate' else 12)
        self.action('pause', rule=10 if role == 'candidate' else 12)
        mode.unlink(); self.resolve('retry')
        self.action('capture', role=role); self.capture(role)
        self.action('open', purpose='measure') if role == 'candidate' else self.action('capture', role=role)
    return test


for _role in ('candidate', 'incumbent'):
    setattr(JudgedNextTests, 'test_capture_failure_' + _role, capture_failure(_role))


def budget(purpose):
    def test(self):
        # §9.24: insufficient remaining requests blocks every opening state.
        self.calibrated()
        if purpose == 'measure': self.candidate()
        elif purpose == 'confirm': self.keep(5, 9)
        else: self.mutate('panel')
        cost = 2 if purpose == 'measure' else 4
        spent = sum(self.read(p)['requests'] for p in (self.f.engagement / 'evals').glob('*/eval.json'))
        p = self.f.protocol.copy(); p['budget_calls'] = spent + cost - 1
        self.f.write_methodology(p); self.action('stop', reason='budget')
        p['budget_calls'] += 1; self.f.write_methodology(p)
        self.action('open', purpose=purpose)  # positive boundary control
        self.opened(purpose)
    return test


for _purpose in ('calibrate', 'measure', 'confirm'):
    setattr(JudgedNextTests, 'test_budget_' + _purpose, budget(_purpose))


def neutral_futility(kind):
    def test(self):
        # §9.25: invalid/calibrate/confirm neither extend nor reset futility.
        self.calibrated(); self.limits(futility=2); self.lose()
        e = self.opened('confirm' if kind == 'confirm' else 'calibrate')
        self.returns(e)
        if kind == 'invalid':
            (e / 'primary-1/return.json').write_text('{"error":"offline failure"}')
            self.score(e, 'invalid'); self.log('invalid', e, ratchet=6, iteration=1)
            self.action('pause', rule=9); self.resolve('retry')
        else:
            self.score(e, 'valid'); self.checks(e, 'incumbent')
            self.log(kind, e, ratchet=5, iteration=1)
        self.action('propose', iteration=2)  # neutral did not EXTEND streak
        self.lose(); self.action('stop', reason='futility')  # nor RESET it
    return test


for _kind in ('invalid', 'calibrate', 'confirm'):
    setattr(JudgedNextTests, 'test_futility_neutral_' + _kind, neutral_futility(_kind))


def cheap_limit(kind):
    def test(self):
        # §9.25 / D16: a cheap-gate skip counts toward both relevant limits.
        self.calibrated(); self.limits(**{kind: 1})
        self.cheap_skip(1)
        self.action('stop', reason=kind)
    return test


for _kind in ('iterations', 'futility'):
    setattr(JudgedNextTests, 'test_cheap_gate_counts_' + _kind, cheap_limit(_kind))


def mismatched_checks(purpose, kind):
    def test(self):
        if purpose == 'measure':
            self.calibrated(); self.candidate(); e = self.measured()
            target = 'candidate'
        else:
            self.capture(); self.capture(); e = self.opened('calibrate')
            self.returns(e); self.score(e, 'valid'); target = 'incumbent'
        self.checks(e, target)
        if kind == 'tree':
            if purpose == 'calibrate':
                # Give the primary checkout a different tree without touching eval identity.
                (self.f.primary / 'doc.md').write_text('OTHER CHECK TREE\n')
                self.f.git('add', 'doc.md', cwd=self.f.primary)
                self.f.git('commit', '-m', 'other check tree', cwd=self.f.primary)
            self.f.ok('checks', '--eval', e.name, '--worktree', self.f.primary, '--passed')
        else:
            # checks computes fingerprints; no subcommand can create a wrong one
            # while leaving a current eval/protocol, so corrupt only this field.
            path = e / 'checks.json'; value = self.read(path)
            value['fingerprint'] = '0' * 64; path.write_text(json.dumps(value))
        self.action('run_checks', eval=e.name, target=target, tree=self.f.tree())
        self.checks(e, target)
        self.log('keep' if purpose == 'measure' else 'calibrate', e,
                 after=6 if purpose == 'measure' else None,
                 ratchet=6 if purpose == 'measure' else 5,
                 iteration=1 if purpose == 'measure' else 0)
    return test

for _purpose in ('calibrate', 'measure'):
    for _kind in ('tree', 'fingerprint'):
        setattr(JudgedNextTests, f'test_checks_identity_{_purpose}_{_kind}', mismatched_checks(_purpose, _kind))


def stale_result(purpose):
    def test(self):
        if purpose == 'calibrate':
            self.capture(); self.capture(); e = self.opened(purpose)
            self.returns(e); self.score(e, 'valid')
        elif purpose == 'confirm':
            self.calibrated(); e = self.opened(purpose)
            self.returns(e); self.score(e, 'valid')
        else:
            self.calibrated(); self.candidate(); e = self.measured(5, 5, 'discard')
        self.mutate('rubric')
        self.action('invalidate', eval=e.name, reason='stale')
    return test

for _purpose in ('calibrate', 'confirm', 'measure_discard'):
    setattr(JudgedNextTests, 'test_stale_result_' + _purpose, stale_result(_purpose))

for _kind in ('margin_floor', 'judges', 'relative_to', 'guardrails', 'reference_manifest'):
    setattr(JudgedNextTests, 'test_stale_keep_' + _kind, stale_keep(_kind, False))


if __name__ == '__main__':
    unittest.main()
