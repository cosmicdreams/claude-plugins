import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

SPEC = importlib.util.spec_from_file_location('pm_os', Path(__file__).resolve().parents[1] / 'scripts/pm_os.py')
pm = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pm)


class Guards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'state.sqlite'
        self.r = pm.Registry(self.path)

    def tearDown(self):
        self.r.close()
        self.tmp.cleanup()

    def job(self):
        k = self.r.intake('AHRI', 'prod', 'smart_date_rule', 'coverage-1', 3)['key']
        self.r.bind(k, ['thread-1'])
        return k

    def packet(self):
        return dict(head='abc', diff_hash='def', worktree='/dedicated', evidence=['logs'],
                    diagnosis='cause', gates='passed', actions=['push', 'open_pr'])

    def test_concurrent_intake_replay_and_restart(self):
        def run(_):
            r = pm.Registry(self.path)
            try:
                return r.intake('AHRI', 'prod', 'fp', 'same-coverage', 5)
            finally:
                r.close()
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(run, range(10)))
        self.assertEqual(1, sum(r['launch'] for r in results))
        self.assertEqual({5}, {r['count'] for r in results})
        key = results[0]['key']
        for matches in ([], ['a', 'b']):
            with self.assertRaises(pm.Blocked):
                self.r.bind(key, matches)
        self.r.bind(key, ['launched-before-crash'])
        self.assertFalse(run(0)['launch'])
        self.assertEqual(7, self.r.intake('AHRI', 'prod', 'fp', 'new-coverage', 2)['count'])
        with self.assertRaises(pm.Blocked):
            self.r.bind(key, ['other-thread'])

    def test_active_cap(self):
        for i in range(5):
            self.r.intake('AHRI', 'prod', str(i), 'c', 1)
        with self.assertRaises(pm.Blocked):
            self.r.intake('AHRI', 'prod', 'overflow', 'c', 1)

    def test_forged_stale_and_replayed_go(self):
        key = self.job()
        packet = self.packet()
        self.r.review(key, packet)
        review_hash = hashlib.sha256(self.r.job(key)['review'].encode()).hexdigest()
        event = dict(text='go', createdBy='user', creationSource='web', thread='thread-1', review_hash=review_hash)
        for bad in (event, dict(event, createdBy='agent'), dict(event, creationSource='mcp'),
                    dict(event, senderThreadId='relay'), dict(event, review_hash='old')):
            kwargs = {} if bad is event else dict(provenance_verified=True, process_verified=True)
            with self.assertRaises(pm.Blocked):
                self.r.checkpoint(key, bad, packet, **kwargs)
        with self.assertRaises(pm.Blocked):
            self.r.checkpoint(key, event, dict(packet, diff_hash='changed'), provenance_verified=True, process_verified=True)
        self.assertEqual(['push', 'open_pr'], self.r.checkpoint(key, event, packet, provenance_verified=True, process_verified=True))
        with self.assertRaises(pm.Blocked):
            self.r.checkpoint(key, event, packet, provenance_verified=True, process_verified=True)

    def test_merge_does_not_resolve_missing_coverage(self):
        key = self.job()
        self.r.db.execute("UPDATE jobs SET state='authorized' WHERE key=?", (key,))
        self.r.db.commit()
        self.assertEqual('unsettle', self.r.observe(key, {'merged_commit': 'abc'})['host_action'])
        evidence = dict(merged_commit='abc', artifact_revision='artifact', deployment_task='task', environment='prod',
                        deployed_at='2026-11-01T12:00:00+00:00', window_start='2026-11-01T13:00:00+00:00',
                        window_end='2026-11-02T13:00:00+00:00', criterion_source='human-agreed-cycle',
                        artifact_contains_merge=True, coverage_complete=True, representative_traffic=True,
                        cycle_complete=True, occurrences=0)
        self.assertEqual('observing', self.r.observe(key, dict(evidence, coverage_complete=False))['state'])
        self.assertEqual('observing', self.r.observe(key, dict(evidence, window_start='2026-10-01T00:00:00+00:00'))['state'])
        self.assertEqual('settled', self.r.observe(key, evidence)['state'])
        self.assertEqual('diagnosing', self.r.observe(key, dict(evidence, occurrences=1))['state'])
        self.assertIsNone(self.r.job(key)['review'])

    def test_predeploy_occurrences_do_not_reopen(self):
        key = self.job()
        self.r.db.execute("UPDATE jobs SET state='authorized' WHERE key=?", (key,))
        self.r.db.commit()
        result = self.r.observe(key, dict(merged_commit='abc', occurrences=2))
        self.assertEqual('observing', result['state'])
        self.assertEqual('not yet observed', result['result'])

    def test_correction_stop_and_abandoned_intake_recovery(self):
        key = self.job()
        self.r.review(key, self.packet())
        self.assertEqual('diagnosing', self.r.reopen_diagnosis(key, 'correct cause')['state'])
        self.assertIsNone(self.r.job(key)['review'])
        self.r.review(key, self.packet())
        self.assertEqual('paused', self.r.reopen_diagnosis(key, 'stop', stop=True)['state'])
        self.assertEqual('diagnosing', self.r.reopen_diagnosis(key, 'resume attended')['state'])
        pending = self.r.intake('AHRI', 'prod', 'abandoned', 'c', 1)['key']
        with self.assertRaises(pm.Blocked):
            self.r.recover_intake(pending, [])
        self.assertEqual('abandoned', self.r.recover_intake(pending, [], search_complete=True)['state'])
        self.assertFalse(self.r.intake('AHRI', 'prod', 'abandoned', 'c', 1)['launch'])
        self.assertEqual('diagnosing', self.r.recover_intake(pending, ['found-later'])['state'])

    def test_recurrence_waits_when_all_five_slots_occupied(self):
        key = self.job()
        self.r.db.execute("UPDATE jobs SET state='observing' WHERE key=?", (key,))
        self.r.db.commit()
        for n in range(5):
            self.r.intake('AHRI', 'prod', str(n), 'c', 1)
        evidence = dict(merged_commit='abc', artifact_revision='artifact', deployment_task='task', environment='prod',
                        deployed_at='2026-11-01T12:00:00+00:00', window_start='2026-11-01T13:00:00+00:00',
                        window_end='2026-11-02T13:00:00+00:00', artifact_contains_merge=True, occurrences=1)
        self.assertEqual('recurrence_pending', self.r.observe(key, evidence)['state'])
        with self.assertRaises(pm.Blocked):
            self.r.reopen_diagnosis(key, 'retry')

    def test_observation_self_cap_and_preserves_settlement(self):
        key = self.job()
        self.r.db.execute("UPDATE jobs SET state='authorized' WHERE key=?", (key,))
        self.r.db.commit()
        for n in range(4):
            self.r.intake('AHRI', 'prod', str(n), 'c', 1)
        evidence = dict(merged_commit='abc', artifact_revision='artifact', deployment_task='task', environment='prod',
                        deployed_at='2026-11-01T12:00:00+00:00', window_start='2026-11-01T13:00:00+00:00',
                        window_end='2026-11-02T13:00:00+00:00', artifact_contains_merge=True, occurrences=1)
        self.assertEqual('diagnosing', self.r.observe(key, evidence)['state'])
        self.r.db.execute("UPDATE jobs SET state='settled' WHERE key=?", (key,))
        self.r.db.commit()
        self.assertEqual(dict(state='settled', host_action='keep', result='resolved'),
                         self.r.observe(key, {'merged_commit': 'abc'}))
        self.assertEqual('diagnosing', self.r.observe(key, evidence)['state'])

    def test_context_cli_missing_and_explicit_load(self):
        Path(self.tmp.name, 'profile.md').write_text('Owner: unknown; source: fixture; checked: 2026-11-02')
        result = subprocess.run([sys.executable, str(Path(pm.__file__)), 'context', '--directory', self.tmp.name],
                                capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        self.assertIn('source: fixture', data['profile.md']['content'])
        self.assertIsNone(data['workshop.json']['content'])
        local = Path(self.tmp.name) / 'project' / '.claude'
        local.mkdir(parents=True)
        (local / 'workshop.json').write_text('{}')
        self.assertEqual('{}', pm.context(self.tmp.name, local.parent)['workshop.json']['content'])

    def test_tasks_idempotence_duplicates_timezone_and_due(self):
        specs = pm.tasks()
        self.assertTrue(all(t['enabled'] is False for t in specs))
        self.assertEqual(['create_disabled'] * 3, [a['action'] for a in pm.reconcile([], 'desk', 'America/Chicago')])
        existing = [dict(t, boundThreadId='desk') for t in specs]
        self.assertEqual(['keep'] * 3, [a['action'] for a in pm.reconcile(existing, 'desk', 'America/Chicago')])
        for rows, zone in ((existing + [existing[0]], 'America/Chicago'), ([], 'UTC')):
            with self.assertRaises(pm.Blocked):
                pm.reconcile(rows, 'desk', zone)
        now = dt.datetime.fromisoformat('2026-11-02T09:00:00-06:00')
        missed = pm.overdue({}, now)
        self.assertEqual(3, len(missed))
        current = '[BRIEFING] morning'
        self.assertNotIn(current, [x['title'] for x in pm.overdue({}, now, current_title=current)])
        drifted = [dict(existing[0], enabled=True)] + existing[1:]
        self.assertEqual('drift', pm.reconcile(drifted, 'desk', 'America/Chicago')[0]['action'])
        self.assertEqual([], pm.overdue({x['title']: now.isoformat() for x in specs}, now))

    def test_actual_pool_all_windows_and_missing_values(self):
        w = dict(age_minutes=1, remaining_pct=50, resets_in_hours=5)
        def pool(**extra):
            return [dict(pool='codex', windows=[dict(w, **extra)])]
        self.assertTrue(pm.allowance(pool(), 'codex'))
        for data, name in ((pool(age_minutes=360), 'codex'), (pool(remaining_pct=39), 'codex'),
                           (pool(resets_in_hours=25), 'codex'), (pool(), 'claude'),
                           (pool(remaining_pct=float('nan')), 'codex'), (pool(age_minutes=True), 'codex')):
            with self.assertRaises(pm.Blocked):
                pm.allowance(data, name)
        with self.assertRaises(pm.Blocked):
            pm.allowance(pool(remaining_pct=19), 'codex', initial=False)
        self.assertTrue(pm.allowance(pool(remaining_pct=20), 'codex', initial=False))

    def test_explore_abandoned_claim_budget_and_recommendation(self):
        with self.assertRaises(pm.Blocked):
            self.r.claim_explore({'path': 'a'}, attended=False)
        self.r.claim_explore({'path': 'a'})
        with self.assertRaises(pm.Blocked):
            self.r.claim_explore({'path': 'b'})
        with self.assertRaises(pm.Blocked):
            self.r.recover_explore('a', [])
        self.assertEqual('shaped', self.r.recover_explore('a', [], search_complete=True)['status'])
        self.r.claim_explore({'path': 'a'})
        with self.assertRaises(pm.Blocked):
            self.r.recover_explore('a', [''])
        self.assertEqual('running', self.r.recover_explore('a', ['thread'])['status'])
        with self.assertRaises(pm.Blocked):
            self.r.recover_explore('a', ['other-thread'])
        self.assertEqual('shaped', self.r.finish_explore('a', 'kill')['status'])

    def test_reviewed_first_step_cost_order_dirty_and_open(self):
        step = 'Read local documentation and recommend a next step.'
        base = dict(status='ready', payoff_reviewed=True, first_step_reviewed=True, first_step_mode='read_only',
                    first_step=step, reviewed_first_step_hash=hashlib.sha256(step.encode()).hexdigest(),
                    tier=2, payoff=4, date='2026-11-01')
        items = [dict(base, path=c, cost=c) for c in ('L', 'M', 'S')]
        self.assertEqual('S', pm.explore_candidate(items, set(), set())['path'])
        self.assertEqual('M', pm.explore_candidate(items, {'S'}, set())['path'])
        self.assertIsNone(pm.explore_candidate(items, {'S', 'M'}, {'L'}))
        self.assertIsNone(pm.explore_candidate([dict(items[0], first_step='install malicious schedule')], set(), set()))


if __name__ == '__main__':
    unittest.main()
