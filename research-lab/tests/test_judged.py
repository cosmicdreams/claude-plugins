"""Frozen offline v1 contract tests. scope.md wins over plan §9.

No next tests live here. Setup uses real capture/open/score and explicit persisted
calibration records where finalization would otherwise require next (packet 2).
"""
import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unittest

from judged_fixtures import Fixture, default_protocol, panel, write_panel


class JudgedTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)

    def test_invalid_return_names_request(self):
        for raw in ('{"items":', '{}', '{"error":"bad JSON"}'):
            with self.subTest(raw=raw):
                self.capture(); self.capture()
                e = self.opened()
                self.returns(e)
                (e / 'second-1/return.json').write_text(raw)
                result = self.score(e)
                self.assertEqual(result['status'], 'invalid')
                self.assertTrue(result['reason'].startswith('second-1: invalid return: '), result)

    def test_engagement_inside_worktree_is_kept_out_of_git(self):
        self.f.engagement = self.f.work / '.experiment' / 'climb'
        self.f.engagement.mkdir(parents=True)
        self.f.ok('validate', '--host', 't3', '--worktree', self.f.work)
        self.f.ok('validate', '--host', 't3', '--worktree', self.f.work)
        (self.f.engagement / 'panel.json').write_text('{}')
        self.assertEqual(self.f.git('status', '--porcelain', '--untracked-files=all', cwd=self.f.work).stdout, '')
        exclude = self.f.git('rev-parse', '--path-format=absolute', '--git-path', 'info/exclude', cwd=self.f.work).stdout.strip()
        self.assertEqual(Path(exclude).read_text().count('/.experiment/climb/'), 1)

    def test_empty_trial_commit_refused(self):
        self.begin()
        self.f.git('commit', '--allow-empty', '-m', 'empty trial')
        before = (self.f.engagement / 'trial.json').read_bytes()
        code, value, err = self.f.run('trial', 'commit', '--worktree', self.f.work)
        self.assertEqual(code, 1, (value, err))
        self.assertEqual(value, {'error': 'trial changes nothing'})
        self.assertEqual((self.f.engagement / 'trial.json').read_bytes(), before)

    def test_transport_change_stales_calibration(self):
        self.f.ok('validate', '--host', 'direct')
        self.calibration()
        code, value, err = self.f.run('open', '--purpose', 'confirm', '--panel', self.f.panel_path,
                                      '--seed', 0, '--transport', 'direct')
        self.assertEqual(code, 1, (value, err))
        self.assertIn('stale', value['error'])
        action = self.f.ok('next', '--worktree', self.f.work, '--panel', self.f.panel_path,
                            '--transport', 'direct')
        self.assertEqual(action, {'action': 'open', 'purpose': 'calibrate', 'transport': 'direct'})
        opened = self.f.ok('open', '--purpose', 'calibrate', '--panel', self.f.panel_path,
                            '--seed', 0, '--transport', 'direct')
        e = self.f.engagement / 'evals' / opened['eval']
        self.assertEqual(self.read(e / 'eval.json')['transport'], 'direct')
        self.returns(e); self.score(e)
        self.f.ok('checks', '--eval', e.name, '--worktree', self.f.work, '--passed')
        action = self.f.ok('next', '--worktree', self.f.work, '--panel', self.f.panel_path,
                            '--transport', 'direct')
        self.assertEqual(action['decision'], 'calibrate')
        self.assertEqual(self.f.log(action['args']).returncode, 0)
        self.f.ok('open', '--purpose', 'confirm', '--panel', self.f.panel_path,
                  '--seed', 1, '--transport', 'direct')
        code, value, err = self.f.run('open', '--purpose', 'confirm', '--panel', self.f.panel_path, '--seed', 0)
        self.assertEqual(code, 1, (value, err))
        self.assertIn('stale', value['error'])

    def read(self, path):
        return json.loads(Path(path).read_text(encoding='utf-8'))

    def snapshot(self):
        return {str(p.relative_to(self.f.engagement)): p.read_bytes() if p.is_file() else None
                for p in self.f.engagement.rglob('*')}

    def refuse(self, command, *args):
        before, head = self.snapshot(), self.f.head()
        code, value, err = self.f.run(command, *args)
        self.assertEqual(code, 1, (value, err))
        self.assertIsInstance(value, dict)
        if command == 'validate':
            self.assertIs(value.get('ok'), False)
            self.assertTrue(value.get('errors'))
        else:
            self.assertTrue(value.get('error'))
        self.assertEqual(self.snapshot(), before, 'refusal wrote engagement state')
        self.assertEqual(self.f.head(), head, 'refusal moved HEAD')

    def capture(self, role='incumbent'):
        result = self.f.ok('capture', '--worktree', self.f.work, '--role', role)
        self.assertEqual(result.get('status'), 'ok')
        path = Path(result['dir'])
        if not path.is_absolute():
            path = self.f.engagement / path
        self.assertTrue(path.is_dir())
        return path

    def opened(self, purpose='calibrate', seed=0):
        result = self.f.ok('open', '--purpose', purpose, '--panel', self.f.panel_path, '--seed', seed)
        self.assertRegex(result.get('eval', ''), r'^e\d{4,}$')
        path = self.f.engagement / 'evals' / result['eval']
        self.assertTrue((path / 'eval.json').is_file())
        self.assertEqual(len(result['requests']), len(self.f.protocol['judges']) * (1 if purpose == 'measure' else 2))
        return path

    def returns(self, evaluation, values=None):
        for mapping in sorted(evaluation.glob('*/mapping.json')):
            role, k = mapping.parent.name.rsplit('-', 1)
            meanings = self.read(mapping).values()
            scores = {meaning: (values or {}).get(meaning, 5 if not meaning.startswith('ref:') else 4)
                      for meaning in meanings}
            self.f.write_return(evaluation, role, int(k), scores)

    def score(self, evaluation):
        result = self.f.ok('score', '--eval', evaluation.name)
        self.assertEqual(self.read(evaluation / 'result.json'), result)
        return result

    def calibration(self):
        self.capture()
        self.capture()
        evaluation = self.opened()
        self.returns(evaluation)
        result = self.score(evaluation)
        self.assertEqual(result.get('status'), 'valid')
        self.f.ok('checks', '--eval', evaluation.name, '--worktree', self.f.work, '--passed')
        self.finalize(evaluation, 'calibrate')
        return evaluation

    def begin(self):
        self.f.ok('trial', 'begin', '--worktree', self.f.work, '--change', 'Improve text')
        return self.read(self.f.engagement / 'trial.json')

    def candidate(self, iteration=None):
        if iteration is not None:
            run = self.f.log([str(self.f.engagement / 'results.jsonl'), str(iteration - 1),
                              'Cheap gate', 'skip', '5', 'null', '5', 'skip', 'cheap gate',
                              json.dumps({'metric_type': 'judged'})])
            self.assertEqual(run.returncode, 0, run.stderr)
        self.begin()
        self.f.commit('REVISED TEXT café\n')
        self.f.ok('trial', 'commit', '--worktree', self.f.work)
        self.capture('candidate')

    def measure(self, values=None, seed=0):
        self.calibration()
        self.candidate()
        evaluation = self.opened('measure', seed)
        self.returns(evaluation, values)
        return evaluation

    def history(self, *records):
        # The logger is the public writer for persisted historical/orchestrator
        # records; use it instead of manufacturing results.jsonl bytes.
        reserved = {'iteration', 'change', 'gate', 'metric_before', 'metric_after',
                    'ratchet', 'decision', 'reason'}
        for r in records:
            args = [str(self.f.engagement / 'results.jsonl'), str(r['iteration']),
                    r.get('change', 'Historical fixture'), r.get('gate', 'pass'),
                    json.dumps(r.get('metric_before')), json.dumps(r.get('metric_after')),
                    json.dumps(r.get('ratchet')), r['decision'], r.get('reason', 'fixture'),
                    json.dumps({k: v for k, v in r.items() if k not in reserved})]
            run = self.f.log(args)
            self.assertEqual(run.returncode, 0, run.stderr)

    def finalize(self, e, decision):
        code, action, err = self.f.next()
        self.assertEqual(code, 0, (action, err))
        self.assertEqual((action.get('action'), action.get('decision')), ('log', decision))
        self.assertEqual(action['eval'], e.name)
        run = self.f.log(action['args'])
        self.assertEqual(run.returncode, 0, run.stderr)

    def assert_request(self, e, texts):
        for path in e.glob('*/mapping.json'):
            mapping = self.read(path)
            request = (path.parent / 'request.md').read_text(encoding='utf-8')
            for category, rubric in self.f.protocol['categories'].items():
                self.assertIn(category, request)
                self.assertIn(rubric, request)
            for key in ('items', 'score', 'critique', 'file', 'command'):
                self.assertIn(key, request.lower())
            for name in self.f.protocol['references']:
                self.assertNotIn(Path(name).name, request)
            sections = re.split(r'(?m)^#{1,6}\s+', request)
            for label, meaning in mapping.items():
                section = next((part for part in sections if part.splitlines() and part.splitlines()[0].strip() == label), None)
                self.assertIsNotNone(section, (label, request))
                key = meaning if meaning in texts else 'reference' if meaning.startswith('ref:') else meaning
                self.assertIn(texts[key], section)
                for other, text in texts.items():
                    if other != key: self.assertNotIn(text, section)

    def test_requests_capture_selection_and_frozen_reference_bytes(self):
        p = default_protocol(); p['references'].append('refs/ref-2.md')
        (self.f.methodology_dir / 'refs/ref-2.md').write_text('SECOND ANCHOR TEXT\n')
        self.f.write_methodology(p)
        tag = self.f.methodology_dir / 'capture-tag'
        tag.write_text('CAPTURE ONE\n'); self.capture()
        tag.write_text('CAPTURE TWO\n'); self.capture()
        tag.write_text('CAPTURE THREE\n'); self.capture()
        texts = {'capture-1': 'CAPTURE ONE', 'capture-2': 'CAPTURE TWO',
                 'ref:refs/ref-1.md': 'REFERENCE TEXT', 'ref:refs/ref-2.md': 'SECOND ANCHOR TEXT'}
        e = self.opened(); self.assert_request(e, texts)
        self.returns(e); self.assertEqual(self.score(e)['status'], 'valid')
        self.f.ok('checks', '--eval', e.name, '--worktree', self.f.work, '--passed')
        self.finalize(e, 'calibrate')
        (self.f.methodology_dir / 'refs/ref-1.md').write_text('CHANGED SOURCE REFERENCE')
        e = self.opened('confirm'); self.assert_request(e, texts)
        self.returns(e); self.assertEqual(self.score(e)['status'], 'valid')
        self.f.ok('checks', '--eval', e.name, '--worktree', self.f.work, '--passed')
        self.finalize(e, 'confirm')
        tag.write_text('CANDIDATE CAPTURE\n'); self.candidate()
        e = self.opened('measure')
        self.assert_request(e, dict(incumbent='CAPTURE ONE', candidate='CANDIDATE CAPTURE',
                                    **{'ref:refs/ref-1.md': 'REFERENCE TEXT', 'ref:refs/ref-2.md': 'SECOND ANCHOR TEXT'}))
        for path in e.glob('*/request.md'):
            request = path.read_text(encoding='utf-8')
            self.assertNotIn('CAPTURE TWO', request)
            self.assertNotIn('CAPTURE THREE', request)
            self.assertNotIn('CHANGED SOURCE REFERENCE', request)
        self.returns(e, {'incumbent': 5, 'candidate': 6})
        self.assertEqual(self.score(e)['status'], 'keep')

    def test_score_renamed_single_role_four_categories(self):
        p = default_protocol()
        p['judges'] = [dict(role='editor', tier=5)]
        p['categories'] = dict(precision='Precise?', depth='Deep?', tone='Appropriate?', flow='Coherent?')
        self.f.write_methodology(p)
        write_panel(self.f.panel_path, {'editor': panel()['second']})
        self.calibration(); self.candidate(); e = self.opened('measure')
        self.returns(e, {'incumbent': 5, 'candidate': dict(precision=6, depth=7, tone=8, flow=9)})
        r = self.score(e)
        self.assertEqual(r['status'], 'keep')
        self.assertEqual(r['metric_candidate'], 6)
        self.assertEqual({c['role'] for c in self.read(e / 'critiques.json')}, {'editor'})
        self.assertEqual({c['category'] for c in self.read(e / 'critiques.json')}, set(p['categories']))

    def test_fixture_capture_and_isolation(self):
        # scope: capture manifest contract; independent fixture positive control.
        f = self.f
        self.assertEqual(f.git('branch', '--show-current', cwd=f.primary).stdout.strip(), 'main')
        self.assertEqual(f.git('branch', '--show-current').stdout.strip(), 'experiment')
        self.assertTrue((f.work / '.git').is_file(), 'must be a linked worktree')
        self.assertFalse(f.engagement.is_relative_to(f.primary))
        self.assertFalse(f.methodology_dir.is_relative_to(f.work))
        out = f.root / 'direct-capture'
        result = subprocess.run([str(f.methodology_dir / 'capture.sh'), str(f.work), str(out)],
                                env=f.env, capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = self.read(out / 'manifest.json')
        self.assertEqual(manifest['tree'], f.tree())
        self.assertEqual(manifest['files'], [dict(path='doc.md', sha256=hashlib.sha256(
            (f.work / 'doc.md').read_bytes()).hexdigest())])
        self.assertEqual((out / 'doc.md').read_text(), 'BASE TEXT café\n')
        for mode in ('nonzero', 'no-manifest', 'malformed', 'missing-file', 'hash-mismatch', 'wrong-tree', 'nonutf8'):
            (f.methodology_dir / 'capture-mode').write_text(mode)
            dest = f.root / mode
            run = subprocess.run([str(f.methodology_dir / 'capture.sh'), str(f.work), str(dest)],
                                 env=f.env, capture_output=True, timeout=60)
            if mode == 'nonzero':
                self.assertNotEqual(run.returncode, 0)
            else:
                self.assertEqual(run.returncode, 0, run.stderr)
                if mode == 'no-manifest': self.assertFalse((dest / 'manifest.json').exists())
                elif mode == 'malformed': self.assertEqual((dest / 'manifest.json').read_text(), '{')
                elif mode == 'missing-file': self.assertFalse((dest / 'doc.md').exists())
                elif mode == 'nonutf8': self.assertEqual((dest / 'doc.md').read_bytes(), b'\xff')
                elif mode == 'wrong-tree': self.assertNotEqual(self.read(dest / 'manifest.json')['tree'], f.tree())
                elif mode == 'hash-mismatch': self.assertNotEqual(self.read(dest / 'manifest.json')['files'][0]['sha256'], manifest['files'][0]['sha256'])

    def test_fixture_return_decodes_meanings(self):
        # scope: dispatch schema; helper sanity independent of production stub.
        e = self.f.engagement / 'evals/e0001'
        self.f.seed_json('evals/e0001/eval.json', dict(panel=panel()))
        self.f.seed_json('evals/e0001/primary-1/mapping.json', {'B': 'candidate', 'A': 'incumbent', 'Ref-1': 'ref:ref-1.md'})
        self.f.write_return(e, 'primary', 1, {'candidate': 6, 'incumbent': 4, 'ref:ref-1.md': 3})
        returned = self.read(e / 'primary-1/return.json')['items']
        self.assertEqual(returned['B']['clarity']['score'], 6)
        self.assertEqual(returned['A']['accuracy']['score'], 4)
        self.assertEqual(self.read(e / 'primary-1/invocation.json'), panel()['primary'])

    def test_validate_default_and_drift_warning(self):
        # scope: validate positive controls.
        self.assertIs(self.f.ok('validate', '--host', 't3')['ok'], True)
        p = default_protocol()
        p['references'] = []
        self.f.write_methodology(p)
        result = self.f.ok('validate', '--host', 't3')
        self.assertIs(result['ok'], True)
        self.assertIn('drift', json.dumps(result['warnings']).lower())
        self.assertFalse((self.f.engagement / 'captures').exists())
        self.assertFalse((self.f.engagement / 'evals').exists())

    def test_capture_namespace_and_fingerprints(self):
        # scope: capture identity (tree, command string AND script bytes).
        a, b = self.capture(), self.capture()
        self.assertRegex(a.name, '^' + self.f.tree() + r'-[0-9a-f]{12}-1$')
        self.assertEqual(b.name, a.name[:-1] + '2')
        p = default_protocol()
        p['artifact_command'] = 'capture.sh --variant'
        self.f.write_methodology(p)
        c = self.capture()
        self.assertNotEqual(a.name.split('-')[-2], c.name.split('-')[-2])
        script = self.f.methodology_dir / 'capture.sh'
        script.write_text(script.read_text() + '\n# edited capture implementation\n')
        d = self.capture()
        self.assertNotEqual(c.name.split('-')[-2], d.name.split('-')[-2])
        self.assertTrue(c.name.endswith('-1'))
        self.assertTrue(d.name.endswith('-1'))

    def test_capture_role_gates(self):
        # scope: candidate requires recorded commit; incumbent prohibited during committed trial.
        self.capture()
        self.refuse('capture', '--worktree', self.f.work, '--role', 'candidate')
        self.begin()
        self.refuse('capture', '--worktree', self.f.work, '--role', 'candidate')
        self.f.commit('REVISED TEXT\n')
        self.f.ok('trial', 'commit', '--worktree', self.f.work)
        self.capture('candidate')
        self.refuse('capture', '--worktree', self.f.work, '--role', 'incumbent')
        self.f.commit('UNRELATED TEXT\n')
        self.refuse('capture', '--worktree', self.f.work, '--role', 'candidate')

    def test_trial_success_fields_and_numbering(self):
        # scope: trial ownership and numbering includes skips and previous trial.json.
        self.history(dict(iteration=4, decision='skip'),
                            dict(iteration=100, decision='invalid'),
                            dict(iteration=200, decision='confirm'))
        t = self.begin()
        self.assertEqual(t, dict(iteration=5, worktree=str(self.f.work.resolve()), branch='experiment',
                                 base=self.f.base, base_tree=self.f.tree(), commit=None, change='Improve text'))
        sha = self.f.commit('NEW TEXT\n')
        self.f.ok('trial', 'commit', '--worktree', self.f.work)
        self.assertEqual(self.read(self.f.engagement / 'trial.json')['commit'], sha)
        self.history(dict(iteration=5, decision='keep', tree=self.f.tree()))
        self.assertEqual(self.begin()['iteration'], 6)

    def test_open_reference_copies_and_monotonic_ids(self):
        # scope: open freezes references once, and abandon never recycles ids.
        self.capture(); self.capture()
        first = self.opened()
        self.assertEqual(first.name, 'e0001')
        refs = self.f.engagement / 'references'
        self.assertTrue((refs / 'manifest.json').is_file())
        copies = [p for p in refs.rglob('*') if p.is_file() and p.name != 'manifest.json']
        self.assertEqual(len(copies), 1)
        self.assertEqual(copies[0].read_text(), 'REFERENCE TEXT\n')
        manifest = self.read(refs / 'manifest.json')
        self.assertIn(hashlib.sha256(copies[0].read_bytes()).hexdigest(), json.dumps(manifest))
        self.f.ok('abandon', '--eval', first.name)
        second = self.opened(seed=1)
        self.assertEqual(second.name, 'e0002')
        self.f.ok('abandon', '--eval', second.name)
        self.assertEqual(self.opened(seed=2).name, 'e0003')

    def test_open_budget_counts_abandoned_invalid_and_measure_cost(self):
        # scope: budget counts every eval at open, including abandoned and invalid.
        self.calibration()  # four calls
        e = self.opened(); self.f.ok('abandon', '--eval', e.name)  # four more
        e = self.opened(); self.returns(e)
        (e / 'primary-1/return.json').write_text('{"error":"offline failure"}')
        self.assertEqual(self.score(e)['status'], 'invalid')  # four more
        p = default_protocol(); p['budget_calls'] = 14
        self.f.write_methodology(p)
        self.refuse('open', '--purpose', 'calibrate', '--panel', self.f.panel_path, '--seed', 0)
        self.candidate()
        e = self.opened('measure')  # two calls fit exactly
        self.assertEqual(self.read(e / 'eval.json')['requests'], 2)
        self.refuse('open', '--purpose', 'measure', '--panel', self.f.panel_path, '--seed', 0)

    def test_open_trial_and_capture_prerequisites(self):
        # scope: open refuses absent captures, active calibration, or inappropriate trial.
        self.refuse('open', '--purpose', 'calibrate', '--panel', self.f.panel_path, '--seed', 0)
        self.capture()
        self.refuse('open', '--purpose', 'calibrate', '--panel', self.f.panel_path, '--seed', 0)
        self.capture()
        self.calibration()
        self.begin()
        for purpose in ('calibrate', 'confirm', 'measure'):
            self.refuse('open', '--purpose', purpose, '--panel', self.f.panel_path, '--seed', 0)

    def test_open_blinding_seed_and_mapping_content(self):
        # scope: request text hides state, seed ordering is deterministic and covers both orders.
        self.calibration()
        self.candidate(iteration=37)
        seen, repeat = set(), {}
        for seed in list(range(12)) + [0]:
            e = self.opened('measure', seed)
            data = self.read(e / 'eval.json')
            self.assertEqual(data['iteration'], 37)
            self.assertEqual(data['panel'], panel())
            self.assertEqual(data['purpose'], 'measure')
            self.assertTrue(data['fingerprint'])
            self.assertEqual(data['candidate_tree'], self.f.tree())
            mappings = []
            for mapping_path in sorted(e.glob('*/mapping.json')):
                mapping = self.read(mapping_path)
                mappings.append(mapping)
                seen.add(mapping['A'])
                request = (mapping_path.parent / 'request.md').read_text(encoding='utf-8')
                for forbidden in ('8.73', '37', 'ref-1.md', 'incumbent', 'candidate', 'iteration',
                                  str(self.f.engagement), str(self.f.methodology_dir)):
                    self.assertNotIn(forbidden.lower(), request.lower())
                for rubric in default_protocol()['categories'].values():
                    self.assertIn(rubric, request)
                # A heading's section must contain the artifact mapped to A and not B.
                sections = re.split(r'(?m)^#{1,6}\s+', request)
                for label in ('A', 'B'):
                    section = next((s for s in sections if re.match(label + r'\b', s)), None)
                    self.assertIsNotNone(section, request)
                    expected = 'BASE TEXT café' if mapping[label] == 'incumbent' else 'REVISED TEXT café'
                    other = 'REVISED TEXT café' if mapping[label] == 'incumbent' else 'BASE TEXT café'
                    self.assertIn(expected, section)
                    self.assertNotIn(other, section)
            if seed in repeat:
                self.assertEqual(mappings, repeat[seed])
            repeat[seed] = mappings
            self.f.ok('abandon', '--eval', e.name)
        self.assertEqual(seen, {'incumbent', 'candidate'})

    def test_score_minimum_and_decoded_critiques(self):
        # §9.1, §6 diagnostics: minimum, not average; decode all label meanings.
        e = self.measure({'incumbent': 5, 'candidate': dict(clarity=6, accuracy=9, usefulness=9)})
        result = self.score(e)
        self.assertEqual(result['status'], 'keep')
        self.assertEqual(result['metric_candidate'], 6)
        self.assertEqual(result['metric_incumbent'], 5)
        self.assertEqual(result['margin'], 0.25)
        self.assertIs(result['drift'], False)
        critiques = self.read(e / 'critiques.json')
        mapping = self.read(e / 'primary-1/mapping.json')
        ref = next(v.removeprefix('ref:') for v in mapping.values() if v.startswith('ref:'))
        self.assertEqual({c['item'] for c in critiques}, {'incumbent', 'candidate', ref})
        self.assertEqual(len(critiques), 18)
        for c in critiques:
            meaning = 'ref:' + c['item'] if c['item'] == ref else c['item']
            self.assertEqual(c['critique'], meaning + ':' + c['category'])
            self.assertIn(c['role'], panel())

    def test_score_paired_ignores_earlier_ratchet(self):
        # §9.3: a historic ratchet must never participate in the paired rule.
        e = self.measure({'incumbent': 5, 'candidate': 6})
        self.history(dict(iteration=0, decision='confirm', ratchet=9.5, tree=self.read(e / 'eval.json')['incumbent_tree'], metric_type='judged'))
        self.assertEqual(self.score(e)['status'], 'keep')

    def test_score_swapped_mapping_same_decision(self):
        # §9.7: swap labels and their payloads, not meanings; outcome unchanged.
        self.calibration(); self.candidate()
        results = []
        for swap in (False, True):
            e = self.opened('measure')
            if swap:
                for path in e.glob('*/mapping.json'):
                    m = self.read(path); m['A'], m['B'] = m['B'], m['A']
                    path.write_text(json.dumps(m))
            self.returns(e, {'incumbent': 5, 'candidate': 6})
            results.append(self.score(e))
        for key in ('status', 'metric_candidate', 'metric_incumbent', 'margin', 'cells'):
            self.assertEqual(results[0][key], results[1][key])
        self.assertEqual(results[0]['status'], 'keep')

    def test_score_calibration_exact_noise_and_four_score_means(self):
        # §9.8, scope D14: cross-request and within-request differences by meaning.
        self.capture(); self.capture()
        e = self.opened()
        for role in panel():
            for k, one, two in ((1, 4, 4.5), (2, 5.5, 5)):
                values = self.cal_values(e, role, k, one, two)
                values = {meaning: (dict(clarity=value, accuracy=9.5-value, usefulness=8)
                                    if not meaning.startswith('ref:') else (4 if k == 1 else 4.5))
                          for meaning, value in values.items()}
                self.f.write_return(e, role, k, values)
        result = self.score(e)
        self.assertEqual(result['status'], 'valid')
        self.assertAlmostEqual(result['metric'], 4.75)
        self.assertAlmostEqual(result['noise'], 1.5)
        self.assertAlmostEqual(result['margin'], 1.5)
        self.assertEqual(result['panel'], panel())
        self.assertTrue(result['cells'])
        baseline = result['reference_baseline']
        self.assertTrue(baseline)
        def numbers(value):
            if isinstance(value, dict):
                return [n for child in value.values() for n in numbers(child)]
            if isinstance(value, list):
                return [n for child in value for n in numbers(child)]
            return [value] if isinstance(value, (float, int)) else []
        baseline_scores = numbers(baseline)
        self.assertTrue(baseline_scores)
        for value in baseline_scores:
            self.assertAlmostEqual(value, 4.25)

    def cal_values(self, e, role, k, one, two):
        return {v: (one if v == 'capture-1' else two if v == 'capture-2' else 4)
                for v in self.read(e / f'{role}-{k}/mapping.json').values()}

    def test_score_calibration_floor(self):
        # §9.8: identical scores have zero noise; margin cannot fall below floor.
        self.capture(); self.capture(); e = self.opened(); self.returns(e)
        r = self.score(e)
        self.assertEqual(r['noise'], 0)
        self.assertEqual(r['margin'], 0.25)
        self.assertEqual(r['metric'], 5)

    def test_score_relative_to_best_reference(self):
        # scope: cell = score minus MAX reference in that request, not mean/min.
        p = default_protocol(); p['relative_to'] = 'references'
        p['references'].append('refs/ref-2.md')
        (self.f.methodology_dir / 'refs/ref-2.md').write_text('SECOND REFERENCE\n')
        self.f.write_methodology(p)
        self.capture(); self.capture(); cal = self.opened()
        for mapping in cal.glob('*/mapping.json'):
            role, k = mapping.parent.name.rsplit('-', 1)
            scores = {v: (3 if v == 'ref:' + p['references'][0] else 4 if v.startswith('ref:') else 5)
                      for label, v in self.read(mapping).items()}
            self.f.write_return(cal, role, int(k), scores)
        r = self.score(cal)
        self.assertEqual(r['metric'], 1)
        self.f.ok('checks', '--eval', cal.name, '--worktree', self.f.work, '--passed')
        self.finalize(cal, 'calibrate')
        self.candidate(); e = self.opened('measure')
        for mapping in e.glob('*/mapping.json'):
            role, k = mapping.parent.name.rsplit('-', 1)
            scores = {v: (3 if v == 'ref:' + p['references'][0] else 4 if v.startswith('ref:') else
                          6 if v == 'candidate' else 5) for label, v in self.read(mapping).items()}
            self.f.write_return(e, role, int(k), scores)
        r = self.score(e)
        self.assertEqual(r['status'], 'keep')
        self.assertEqual(r['metric_candidate'], 2)
        self.assertEqual(r['metric_incumbent'], 1)

    def test_score_existing_result_and_missing_return_refused(self):
        # §9.10 / scope: incomplete dispatch is a refusal; repeat scoring preserves result.
        self.capture(); self.capture(); e = self.opened()
        self.refuse('score', '--eval', e.name)
        self.returns(e); self.score(e)
        self.refuse('score', '--eval', e.name)

    def test_abandon_idempotent_and_scored_refusal(self):
        # §9.10 amended by scope D6.
        self.capture(); self.capture(); e = self.opened()
        self.f.ok('abandon', '--eval', e.name)
        self.assertEqual(self.read(e / 'result.json'), dict(status='invalid', reason='abandoned'))
        before = self.snapshot()
        self.f.ok('abandon', '--eval', e.name)
        self.assertEqual(self.snapshot(), before)
        e = self.opened(); self.returns(e); self.score(e)
        self.refuse('abandon', '--eval', e.name)

    def test_invalidate_moves_scored_result(self):
        # scope D6: scored unfinalized only; preserve original score verbatim.
        self.capture(); self.capture(); e = self.opened()
        self.refuse('invalidate', '--eval', e.name, '--reason', 'stale')
        self.returns(e); self.score(e)
        old = (e / 'result.json').read_bytes()
        self.f.ok('invalidate', '--eval', e.name, '--reason', 'stale')
        self.assertEqual((e / 'result.scored.json').read_bytes(), old)
        self.assertEqual(self.read(e / 'result.json'), dict(status='invalid', reason='stale'))
        self.refuse('invalidate', '--eval', e.name, '--reason', 'again')

    def test_checks_scored_tree_and_fingerprint(self):
        # scope D9: checks provenance is computed, and unscored evaluations refused.
        self.capture(); self.capture(); e = self.opened()
        self.refuse('checks', '--eval', e.name, '--worktree', self.f.work, '--passed')
        self.returns(e); self.score(e)
        for flag, passed in (('--passed', True), ('--failed', False)):
            self.f.ok('checks', '--eval', e.name, '--worktree', self.f.work, flag, '--details', 'offline check')
            self.assertEqual(self.read(e / 'checks.json'), dict(tree=self.f.tree(),
                             fingerprint=self.read(e / 'eval.json')['fingerprint'],
                             passed=passed, details='offline check'))

    def test_resolve_snapshots_and_withdraw_gate(self):
        # scope D8: snapshot line counts, last eval, current tree and trial iteration.
        self.refuse('resolve', '--decision', 'withdraw', '--note', 'no pending trial', '--worktree', self.f.work)
        self.capture(); self.capture(); e = self.opened()
        self.history(dict(iteration=0, decision='invalid', eval=e.name),
                            dict(iteration=3, decision='skip'))
        for role, count in [('incumbent', 2), ('candidate', 1)]:
            path = self.f.engagement / 'captures' / f'{role}-failures.jsonl'
            path.write_text(''.join(json.dumps(dict(tree=self.f.tree(), cfp='x', reason='fixture')) + '\n' for _ in range(count)))
        for decision in ('retry', 'continue', 'reject'):
            self.f.ok('resolve', '--decision', decision, '--note', 'reviewed', '--worktree', self.f.work)
            record = json.loads((self.f.engagement / 'resolutions.jsonl').read_text().splitlines()[-1])
            for key, value in dict(decision=decision, note='reviewed', results_lines=2,
                                   failures=dict(incumbent=2, candidate=1), last_eval=e.name).items():
                self.assertEqual(record[key], value)
            if decision in ('continue', 'reject'): self.assertEqual(record['tree'], self.f.tree())
            if decision == 'continue': self.assertIs(record['adopted'], True)
        self.begin()
        self.f.ok('resolve', '--decision', 'withdraw', '--note', 'withdraw', '--worktree', self.f.work)
        record = json.loads((self.f.engagement / 'resolutions.jsonl').read_text().splitlines()[-1])
        self.assertEqual(record['trial_iteration'], 4)
        self.assertEqual(record['decision'], 'withdraw')

    def test_validate_permitted_boundaries_and_defaults(self):
        # scope: positive boundaries prevent overly restrictive validators.
        for relative, target in [('absolute', 10), ('references', -9.99), ('references', 0)]:
            p = default_protocol(); p.update(relative_to=relative, target=target)
            p.pop('iterations'); p.pop('futility')
            self.f.write_methodology(p)
            self.assertIs(self.f.ok('validate', '--host', 't3')['ok'], True)
        for judges, categories, margin in [(1, 3, 0.25), (4, 7, 5)]:
            p = default_protocol()
            p.update(judges=[dict(role=f'role{i}', tier=5) for i in range(judges)],
                     categories={f'cat{i}': 'Rubric' for i in range(categories)},
                     margin_floor=margin, budget_calls=2 * judges)
            self.f.write_methodology(p)
            self.assertIs(self.f.ok('validate', '--host', 't3')['ok'], True)

    def test_open_confirm_requires_active_calibration(self):
        # scope: two captures alone do not authorize confirm or measure.
        self.capture(); self.capture()
        self.refuse('open', '--purpose', 'confirm', '--panel', self.f.panel_path, '--seed', 0)
        self.calibration()
        e = self.opened('confirm')
        self.returns(e)
        self.assertEqual(self.score(e)['status'], 'valid')

    def test_confirm_detects_reference_drift(self):
        # scope score: confirm is drift-checked against active baseline and margin.
        self.calibration()
        e = self.opened('confirm'); self.returns(e)
        for path in e.glob('*/return.json'):
            payload = self.read(path)
            for label, meaning in self.read(path.parent / 'mapping.json').items():
                if meaning.startswith('ref:'):
                    payload['items'][label]['accuracy']['score'] = 5.1
            path.write_text(json.dumps(payload))
        r = self.score(e)
        self.assertEqual(r['status'], 'invalid')
        self.assertIs(r['drift'], True)

    def test_reference_spread_in_calibration_widens_drift_limit(self):
        # A reference that already moved 3 points between calibration requests
        # cannot flag drift for a 1.5-point move (real climb·council run, 2026-11-05).
        self.capture(); self.capture(); e = self.opened(); self.returns(e)
        def shift_ref(evaluation, request, delta):
            path = evaluation / request / 'return.json'
            payload = self.read(path)
            for label, meaning in self.read(path.parent / 'mapping.json').items():
                if meaning.startswith('ref:'):
                    payload['items'][label]['clarity']['score'] += delta
            path.write_text(json.dumps(payload))
        shift_ref(e, 'primary-2', -3)
        r = self.score(e)
        self.assertEqual(r['status'], 'valid')
        ref = next(iter(r['reference_spread']['primary']))
        self.assertEqual(r['reference_spread']['primary'][ref]['clarity'], 3)
        self.assertEqual(r['reference_spread']['primary'][ref]['accuracy'], 0)
        self.f.ok('checks', '--eval', e.name, '--worktree', self.f.work, '--passed')
        self.finalize(e, 'calibrate')
        c = self.opened('confirm'); self.returns(c)
        for request in ('primary-1', 'primary-2'):
            shift_ref(c, request, -1.5)
        self.assertEqual(self.score(c)['status'], 'valid')

    def test_noisy_reference_cell_does_not_hide_stable_cell_drift(self):
        self.capture(); self.capture(); e = self.opened(); self.returns(e)
        path = e / 'primary-2/return.json'
        payload = self.read(path)
        ref = next(label for label, meaning in self.read(path.parent / 'mapping.json').items() if meaning.startswith('ref:'))
        payload['items'][ref]['clarity']['score'] -= 3
        path.write_text(json.dumps(payload))
        self.assertEqual(self.score(e)['status'], 'valid')
        self.f.ok('checks', '--eval', e.name, '--worktree', self.f.work, '--passed')
        self.finalize(e, 'calibrate')
        c = self.opened('confirm'); self.returns(c)
        path = c / 'primary-1/return.json'
        payload = self.read(path)
        ref = next(label for label, meaning in self.read(path.parent / 'mapping.json').items() if meaning.startswith('ref:'))
        payload['items'][ref]['accuracy']['score'] += 1.5
        path.write_text(json.dumps(payload))
        result = self.score(c)
        self.assertEqual(result['status'], 'invalid')
        self.assertTrue(result['drift'])

    def test_calibration_within_request_noise(self):
        # scope D14: within-request differences also enter the maximum noise.
        self.capture(); self.capture(); e = self.opened()
        for role in panel():
            for k in (1, 2):
                self.f.write_return(e, role, k, self.cal_values(e, role, k, 4, 6))
        r = self.score(e)
        self.assertEqual(r['noise'], 2)
        self.assertEqual(r['margin'], 2)
        self.assertEqual(r['metric'], 5)

    def test_invalidate_refuses_scored_invalid(self):
        # scope D6: invalid results cannot be invalidated again.
        self.capture(); self.capture(); e = self.opened(); self.returns(e)
        (e / 'primary-1/return.json').write_text('{"error":"fixture"}')
        self.assertEqual(self.score(e)['status'], 'invalid')
        self.refuse('invalidate', '--eval', e.name, '--reason', 'replacement')
        self.refuse('checks', '--eval', e.name, '--worktree', self.f.work, '--passed')

    def test_checks_measure_keep_and_refuses_discard(self):
        # scope D9: successful measure checks bind the candidate tree, not baseline.
        self.calibration(); self.candidate()
        e = self.opened('measure'); self.returns(e, {'incumbent': 5, 'candidate': 6})
        self.assertEqual(self.score(e)['status'], 'keep')
        self.f.ok('checks', '--eval', e.name, '--worktree', self.f.work, '--passed', '--details', 'verified')
        check = self.read(e / 'checks.json')
        self.assertEqual(check['tree'], self.f.tree())
        self.assertEqual(check['fingerprint'], self.read(e / 'eval.json')['fingerprint'])
        self.assertIs(check['passed'], True)
        e = self.opened('measure'); self.returns(e, {'incumbent': 5, 'candidate': 5})
        self.assertEqual(self.score(e)['status'], 'discard')
        self.refuse('checks', '--eval', e.name, '--worktree', self.f.work, '--passed')

    def test_trial_previous_finalized_iteration_counts(self):
        # scope trial: iteration = 1 + the highest finalized iteration (council r2 N4: a
        # previous trial.json can only exceed the logs while pending, when begin is refused).
        self.history(dict(iteration=10, decision='skip'))
        self.assertEqual(self.begin()['iteration'], 11)
        self.history(dict(iteration=11, decision='skip'))
        self.assertEqual(self.begin()['iteration'], 12)

    def test_trial_commit_wrong_worktree_refused(self):
        # scope trial: same tree and branch do not authorize another working directory.
        self.begin(); self.f.commit('NEW TEXT\n')
        self.refuse('trial', 'commit', '--worktree', self.f.primary)

    def test_trial_commit_merge_refused(self):
        # scope trial: a merge with base as first parent still has two parents.
        self.begin()
        self.f.git('checkout', '-b', 'side')
        self.f.commit('SIDE TEXT\n')
        self.f.git('checkout', 'experiment')
        self.f.git('merge', '--no-ff', '--no-edit', 'side')
        self.refuse('trial', 'commit', '--worktree', self.f.work)


# Each generated case is a separate unittest (not a loop stopped by the first red).
def validation_case(name, mutate=None, edit=None, host=True):
    def test(self):
        # scope: validate fail-fast rule named by this case.
        self.assertIs(self.f.ok('validate', '--host', 't3')['ok'], True)
        p = default_protocol()
        if mutate: mutate(p)
        self.f.write_methodology(p)
        if edit: edit(self.f)
        self.refuse('validate', *(['--host', 't3'] if host else []))
        self.assertFalse((self.f.engagement / 'captures').exists())
        self.assertFalse((self.f.engagement / 'evals').exists())
    test.__name__ = 'test_validate_' + name
    setattr(JudgedTests, test.__name__, test)


def set_field(key, value):
    return lambda p: p.__setitem__(key, value)


for name, key, value in [
    ('duplicate_roles', 'judges', [dict(role='primary', tier=5)] * 2),
    ('zero_judges', 'judges', []), ('five_judges', 'judges', [dict(role=str(i), tier=5) for i in range(5)]),
    ('two_categories', 'categories', dict(a='a', b='b')),
    ('eight_categories', 'categories', {str(i): 'rubric' for i in range(8)}),
    ('margin_low', 'margin_floor', 0.24), ('margin_high', 'margin_floor', 5.01),
    ('absolute_target_zero', 'target', 0), ('absolute_target_high', 'target', 10.01),
    ('max_batch_zero', 'max_batch', 0), ('budget_small', 'budget_calls', 3),
    ('iterations_zero', 'iterations', 0), ('futility_zero', 'futility', 0)]:
    validation_case(name, set_field(key, value))
validation_case('missing_host', host=False)
validation_case('missing_section9', edit=lambda f: f.write_methodology(None))
validation_case('scripted_section9', edit=lambda f: f.write_methodology(default_protocol(), metric_type='scripted'))
validation_case('absent_metric_type_section9', edit=lambda f: f.methodology.write_text(f.methodology.read_text().replace('metric_type: judged\n', '')))
validation_case('missing_protocol_fence', edit=lambda f: f.methodology.write_text(f.methodology.read_text().replace('```judging-protocol', '```json')))
validation_case('missing_direction', edit=lambda f: f.methodology.write_text(f.methodology.read_text().replace('direction: higher', '')))
validation_case('direction_lower', edit=lambda f: f.write_methodology(default_protocol(), direction='lower'))
validation_case('malformed_json', edit=lambda f: f.methodology.write_text(f.methodology.read_text().replace('"target": 8.73', '"target": broken')))
validation_case('missing_reference', edit=lambda f: (f.methodology_dir / 'refs/ref-1.md').unlink())
validation_case('nonutf8_reference', edit=lambda f: (f.methodology_dir / 'refs/ref-1.md').write_bytes(b'\xff'))
validation_case('references_empty', lambda p: p.update(relative_to='references', references=[]))
validation_case('relative_target_minus_ten', lambda p: p.update(relative_to='references', target=-10))
validation_case('relative_target_high', lambda p: p.update(relative_to='references', target=10.01))


def wrong_host(self):
    # scope: only t3 is accepted.
    self.f.ok('validate', '--host', 't3')
    self.refuse('validate', '--host', 'other')
JudgedTests.test_validate_wrong_host = wrong_host


def capture_failure(mode):
    def test(self):
        # scope: capture invalidity must be recorded without publishing a capture.
        self.capture()  # positive control, existing valid capture preserved
        before = {p.name for p in (self.f.engagement / 'captures').iterdir() if p.is_dir()}
        (self.f.methodology_dir / 'capture-mode').write_text(mode)
        r = self.f.ok('capture', '--worktree', self.f.work, '--role', 'incumbent')
        self.assertEqual(r['status'], 'invalid'); self.assertTrue(r['reason'])
        self.assertEqual(before, {p.name for p in (self.f.engagement / 'captures').iterdir() if p.is_dir()})
        lines = (self.f.engagement / 'captures/incumbent-failures.jsonl').read_text().splitlines()
        self.assertEqual(len(lines), 1)
        record = json.loads(lines[0])
        self.assertEqual(record['tree'], self.f.tree())
        self.assertRegex(record['cfp'], r'^[0-9a-f]{64}$')
        self.assertTrue(record['reason'])
    return test
for mode in ('nonzero', 'no-manifest', 'malformed', 'missing-file', 'hash-mismatch', 'wrong-tree', 'nonutf8'):
    setattr(JudgedTests, 'test_capture_failure_' + mode.replace('-', '_'), capture_failure(mode))


def capture_not_a_result(text):
    def test(self):
        # scope: a capture that is empty or a bare limit reply is invalid, never scored.
        self.f.commit(text)
        r = self.f.ok('capture', '--worktree', self.f.work, '--role', 'incumbent')
        self.assertEqual(r['status'], 'invalid')
        self.assertRegex(r['reason'], 'empty capture|limit or error reply')
        self.assertFalse(any(p.is_dir() for p in (self.f.engagement / 'captures').iterdir()))
    return test
for name, text in (('empty', '  \n'), ('limit_reply', "You've hit your limit · resets 5pm\n"),
                   ('rate_limit', 'Error: rate limit exceeded, retry later\n')):
    setattr(JudgedTests, 'test_capture_not_a_result_' + name, capture_not_a_result(text))


def trial_refusal(case):
    def test(self):
        # scope: begin/commit ownership refusal, no state mutation.
        self.f.ok('validate', '--host', 't3')
        if case in ('dirty', 'untracked', 'detached', 'not_incumbent', 'pending'):
            if case == 'dirty': (self.f.work / 'doc.md').write_text('dirty')
            if case == 'untracked': (self.f.work / 'extra').write_text('untracked')
            if case == 'detached': self.f.git('checkout', '--detach')
            if case == 'not_incumbent':
                self.history(dict(iteration=0, decision='calibrate', tree=self.f.tree(), ratchet=5))
                self.f.commit('UNKNOWN TREE\n')
            if case == 'pending': self.begin()
            self.refuse('trial', 'begin', '--worktree', self.f.work, '--change', 'test')
        else:
            self.begin()
            if case != 'same_head': self.f.commit('NEW TEXT\n')
            if case == 'two_commits': self.f.commit('ANOTHER TEXT\n')
            if case == 'wrong_parent':
                self.f.git('checkout', '--orphan', 'orphan')
                self.f.git('add', '.'); self.f.git('commit', '-m', 'root')
                self.f.git('branch', '-D', 'experiment'); self.f.git('branch', '-m', 'experiment')
            if case == 'commit_dirty': (self.f.work / 'doc.md').write_text('dirty')
            if case == 'commit_untracked': (self.f.work / 'extra').write_text('untracked')
            if case == 'wrong_branch': self.f.git('checkout', '-b', 'other')
            if case == 'already_recorded': self.f.ok('trial', 'commit', '--worktree', self.f.work)
            self.refuse('trial', 'commit', '--worktree', self.f.work)
    return test
for case in ('dirty', 'untracked', 'detached', 'not_incumbent', 'pending', 'same_head',
             'two_commits', 'wrong_parent', 'commit_dirty', 'commit_untracked', 'wrong_branch', 'already_recorded'):
    setattr(JudgedTests, 'test_trial_refuses_' + case, trial_refusal(case))


def stale_case(case):
    def test(self):
        # scope: panel/fingerprint epoch; excluded target changes remain usable.
        self.calibration(); self.candidate()
        p = default_protocol()
        if case == 'panel':
            changed = panel(); changed['primary']['options']['effort'] = 'low'
            write_panel(self.f.panel_path, changed)
        elif case == 'rubric':
            p['categories']['clarity'] = 'CHANGED RUBRIC'; self.f.write_methodology(p)
        elif case == 'guardrail':
            guard = self.f.methodology_dir / 'guard.sh'; guard.write_text(guard.read_text() + '# changed\n')
        elif case == 'correctness': self.f.write_methodology(p, correctness='Changed checks.')
        elif case == 'capture_script':
            script = self.f.methodology_dir / 'capture.sh'; script.write_text(script.read_text() + '# changed\n')
            self.capture('candidate')
        elif case in ('margin_floor', 'judges', 'relative_to', 'guardrails', 'reference_manifest'):
            if case == 'margin_floor': p[case] = 0.5
            elif case == 'judges': p[case] = [dict(j, tier=4) for j in p[case]]
            elif case == 'relative_to': p[case] = 'references'
            elif case == 'guardrails': p[case] = ['guard.sh --strict']
            else:
                # The frozen manifest cannot be changed by a production subcommand.
                path = self.f.engagement / 'references/manifest.json'
                raw = path.read_text()
                changed = re.sub(r'[0-9a-f]{64}', '0' * 64, raw)
                self.assertNotEqual(raw, changed)
                path.write_text(changed)
            if case != 'reference_manifest': self.f.write_methodology(p)
        elif case == 'target':
            p['target'] = 9.25; self.f.write_methodology(p)
        if case == 'target': self.opened('measure')
        else: self.refuse('open', '--purpose', 'measure', '--panel', self.f.panel_path, '--seed', 0)
    return test
for case in ('panel', 'rubric', 'guardrail', 'correctness', 'capture_script', 'target', 'margin_floor', 'judges', 'relative_to', 'guardrails', 'reference_manifest'):
    setattr(JudgedTests, 'test_open_epoch_' + case, stale_case(case))


def score_decision(case, incumbent, candidate, expected):
    def test(self):
        # §9.2 / §9.4: shifting minimum, strict improvement, per-cell non-regression.
        e = self.measure({'incumbent': incumbent, 'candidate': candidate})
        result = self.score(e)
        self.assertEqual(result['status'], expected)
        expected_i = min(incumbent.values()) if isinstance(incumbent, dict) else incumbent
        expected_c = min(candidate.values()) if isinstance(candidate, dict) else candidate
        self.assertEqual(result['metric_incumbent'], expected_i)
        self.assertEqual(result['metric_candidate'], expected_c)
    setattr(JudgedTests, 'test_score_' + case, test)
score_decision('shifting_weakest', dict(clarity=5, accuracy=5.1, usefulness=9),
               dict(clarity=5.4, accuracy=4.9, usefulness=9), 'discard')
score_decision('improvement_equal_margin', 5, 5.25, 'discard')
score_decision('improvement_below_margin', 5, 5.2, 'discard')
score_decision('cell_regression', dict(clarity=5, accuracy=8, usefulness=8),
               dict(clarity=6, accuracy=7.5, usefulness=8), 'discard')
score_decision('regression_exact_margin_allowed', dict(clarity=5, accuracy=8, usefulness=8),
               dict(clarity=6, accuracy=7.75, usefulness=8), 'keep')


def invalid_score(case):
    def test(self):
        # §9.5–6, §9.9: invalid judge data/provenance never supplies a decision.
        e = self.measure({'incumbent': 5, 'candidate': 6})
        path = e / 'primary-1/return.json'
        payload = self.read(path)
        label = 'A'
        if case == 'error': payload = {'error': 'offline error'}
        elif case == 'missing_cell': del payload['items'][label]['clarity']
        elif case == 'unknown_label': payload['items']['UNKNOWN'] = payload['items']['A']
        elif case == 'missing_item': del payload['items'][label]
        elif case in ('nan', 'high', 'negative', 'pos_inf', 'neg_inf'):
            payload['items'][label]['clarity']['score'] = {'nan': float('nan'), 'high': 10.5, 'negative': -0.1, 'pos_inf': float('inf'), 'neg_inf': -float('inf')}[case]
        elif case == 'missing_invocation': (e / 'primary-1/invocation.json').unlink()
        elif case == 'different_invocation':
            (e / 'primary-1/invocation.json').write_text(json.dumps(dict(provider='wrong', model='wrong', options={})))
        elif case == 'reference_hash':
            refs = self.f.engagement / 'references'
            next(p for p in refs.rglob('*') if p.is_file() and p.name != 'manifest.json').write_text('TAMPERED')
        elif case in ('drift', 'drift_boundary'):
            for request in e.glob('*/return.json'):
                p = self.read(request)
                for lab, meaning in self.read(request.parent / 'mapping.json').items():
                    if meaning.startswith('ref:'):
                        p['items'][lab]['clarity']['score'] = 5.01 if case == 'drift' else 5
                request.write_text(json.dumps(p))
        if case not in ('drift', 'drift_boundary'): path.write_text(json.dumps(payload))
        if case == 'duplicate_cell':
            raw = path.read_text()
            raw = raw.replace('"clarity": {', '"clarity": {"score": 6, "critique": "duplicate"}, "clarity": {', 1)
            path.write_text(raw)
        result = self.score(e)
        if case == 'drift_boundary':
            self.assertEqual(result['status'], 'keep')
            self.assertIs(result['drift'], False)
        else:
            self.assertEqual(result['status'], 'invalid')
            self.assertTrue(result['reason'])
            if case == 'drift': self.assertIs(result['drift'], True)
    return test
for case in ('error', 'missing_item', 'pos_inf', 'neg_inf', 'missing_cell', 'duplicate_cell', 'unknown_label', 'nan', 'high', 'negative',
             'reference_hash', 'missing_invocation', 'different_invocation', 'drift', 'drift_boundary'):
    setattr(JudgedTests, 'test_score_invalid_' + case, invalid_score(case))


def finalized_case(command):
    def test(self):
        # scope: results naming an evaluation finalize it; mutations must refuse.
        self.capture(); self.capture(); e = self.opened()
        if command != 'abandon': self.returns(e)
        if command in ('invalidate', 'checks'): self.score(e)
        self.history(dict(iteration=0, decision='calibrate', eval=e.name, tree=self.f.tree(), ratchet=5))
        args = ['--eval', e.name]
        if command == 'invalidate': args += ['--reason', 'stale']
        if command == 'checks': args += ['--worktree', self.f.work, '--passed']
        self.refuse(command, *args)
    return test
for command in ('score', 'abandon', 'invalidate', 'checks'):
    setattr(JudgedTests, 'test_finalized_refuses_' + command, finalized_case(command))


def asymmetric(case):
    def test(self):
        e = self.measure({'incumbent': 5, 'candidate': 7})
        mapping = self.read(e / 'second-1/mapping.json')
        values = {v: 4 if v.startswith('ref:') else 5 if v == 'incumbent' else 6 for v in mapping.values()}
        if case == 'regression':
            values['incumbent'] = dict(clarity=5, accuracy=8, usefulness=8)
            values['candidate'] = dict(clarity=7, accuracy=7.5, usefulness=8)
        self.f.write_return(e, 'second', 1, values)
        if case == 'provenance':
            (e / 'second-1/invocation.json').write_text(json.dumps(panel()['primary']))
        if case == 'reference':
            values[next(v for v in mapping.values() if v.startswith('ref:'))] = 5.25
            self.f.write_return(e, 'second', 1, values)
        r = self.score(e)
        self.assertEqual(r['status'], 'invalid' if case in ('provenance', 'reference') else
                         'discard' if case == 'regression' else 'keep')
        if case == 'minimum': self.assertEqual(r['metric_candidate'], 6)
        if case == 'reference': self.assertIs(r['drift'], True)
    return test

for _case in ('minimum', 'regression', 'provenance', 'reference'):
    setattr(JudgedTests, 'test_second_judge_' + _case, asymmetric(_case))


def calibrated_margin(case):
    def test(self):
        self.capture(); self.capture(); e = self.opened()
        for role in panel():
            for k in (1, 2):
                # Only the second role contributes the maximum noise.
                self.f.write_return(e, role, k, self.cal_values(e, role, k, 5,
                                    6.5 if role == 'second' else 5))
        r = self.score(e)
        self.assertEqual((r['status'], r['noise'], r['margin']), ('valid', 1.5, 1.5))
        self.f.ok('checks', '--eval', e.name, '--worktree', self.f.work, '--passed')
        self.finalize(e, 'calibrate')
        self.candidate(); e = self.opened('measure')
        incumbent, candidate = 5, 7
        if case == 'below': candidate = 6.25
        if case == 'equal': candidate = 6.5
        if case.startswith('regression'):
            incumbent = dict(clarity=4, accuracy=9, usefulness=9)
            candidate = dict(clarity=6, accuracy=7.5 if case == 'regression_equal' else 7.25, usefulness=9)
        self.returns(e, {'incumbent': incumbent, 'candidate': candidate})
        if case.startswith('drift'):
            path = e / 'second-1/return.json'; payload = self.read(path)
            mapping = self.read(path.parent / 'mapping.json')
            label = next(label for label, value in mapping.items() if value.startswith('ref:'))
            payload['items'][label]['clarity']['score'] = 7 if case == 'drift_equal' else 7.25
            path.write_text(json.dumps(payload))
        r = self.score(e)
        expected = 'invalid' if case == 'drift_beyond' else 'discard' if case in (
            'below', 'equal', 'regression_beyond') else 'keep'
        self.assertEqual(r['status'], expected)
        self.assertEqual(r['margin'], 1.5)
        if case.startswith('drift'): self.assertIs(r['drift'], case == 'drift_beyond')
    return test

for _case in ('below', 'equal', 'above', 'regression_equal', 'regression_beyond', 'drift_equal', 'drift_beyond'):
    setattr(JudgedTests, 'test_calibrated_margin_' + _case, calibrated_margin(_case))


def panel_roles(case):
    def test(self):
        # Refuse the bad panel first, so no unfinished eval can be the cause (council r2 N1).
        self.capture(); self.capture()
        p = panel()
        if case == 'missing': del p['second']
        else: p['extra'] = p['second']
        write_panel(self.f.panel_path, p)
        self.refuse('open', '--purpose', 'calibrate', '--panel', self.f.panel_path, '--seed', 0)
        write_panel(self.f.panel_path, panel())
        self.opened()  # valid panel positive control
    return test

for _case in ('missing', 'extra'):
    setattr(JudgedTests, 'test_open_panel_' + _case, panel_roles(_case))


if __name__ == '__main__':
    unittest.main()
