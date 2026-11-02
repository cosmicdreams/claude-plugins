#!/usr/bin/env python3
"""Attended PM OS guards. No network calls, model calls, or external writes.

The host adapter must supply trusted metadata; JSON from logs is never an
approval adapter. Until that adapter is verified, checkpoints fail closed.
"""
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import sqlite3
from zoneinfo import ZoneInfo


class Blocked(ValueError):
    pass


def context(directory, cwd=None):
    """Read the same machine-local sources in either agent harness."""
    directory = Path(directory).expanduser()
    result = {}
    for name in ('workshop.json', 'profile.md', 'experience.md', 't3-conventions.md'):
        path = directory / name
        if name == 'workshop.json' and cwd is not None:
            local = Path(cwd) / '.claude' / name
            if local.is_file():
                path = local
        result[name] = {'path': str(path), 'content': path.read_text() if path.is_file() else None}
    return result


def tasks():
    # T3 fixed_time has no timezone field. Adapter must verify server timezone.
    return [dict(title=title, enabled=False, bindToCurrentThread=True,
                 timezone_required='America/Chicago',
                 schedule=dict(type='fixed_time', timeOfDay=time, weekdays=days),
                 skill=skill)
            for title, time, days, skill in (
                ('[BRIEFING] morning', '08:30', [1, 2, 3, 4, 5], 'workshop:prioritize'),
                ('[BRIEFING] afternoon', '13:00', [1, 2, 3, 4, 5], 'workshop:prioritize'),
                ('[BRIEFING] weekly', '16:00', [5], 'workshop:recap --week'))]


def reconcile(existing, desk, timezone):
    if not desk or timezone != 'America/Chicago':
        raise Blocked('verified Briefing desk and server America/Chicago timezone required')
    actions = []
    for spec in tasks():
        found = [t for t in existing if t['title'] == spec['title']]
        if len(found) > 1:
            raise Blocked('duplicate task title: ' + spec['title'])
        if found and found[0].get('boundThreadId') != desk:
            raise Blocked('task is bound to another thread: ' + spec['title'])
        action = 'create_disabled'
        if found:
            action = 'keep' if all(found[0].get(k) == spec[k] for k in ('enabled', 'schedule')) else 'drift'
        actions.append(dict(action=action, spec=spec))
    return actions


def overdue(successes, now, current_title=None):
    now = now.astimezone(ZoneInfo('America/Chicago'))
    missed = []
    for spec in tasks():
        if spec['title'] == current_title:
            continue
        hour, minute = map(int, spec['schedule']['timeOfDay'].split(':'))
        due = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        for _ in range(8):
            if due <= now and due.isoweekday() in spec['schedule']['weekdays']:
                break
            due -= dt.timedelta(days=1)
        last = successes.get(spec['title'])
        if last is None or dt.datetime.fromisoformat(last).astimezone(due.tzinfo) < due:
            missed.append(dict(title=spec['title'], due=due.isoformat()))
    return missed


def allowance(pools, actual_pool, initial=True):
    """Gate the routed pool, all windows, with no token/percentage conversion."""
    matches = [p for p in pools if p.get('pool') == actual_pool]
    if len(matches) != 1 or matches[0].get('stale'):
        raise Blocked('unknown or stale routed pool')
    windows = matches[0].get('windows') or []
    if not windows:
        raise Blocked('no allowance windows')
    for w in windows:
        for field in ('age_minutes', 'remaining_pct', 'resets_in_hours'):
            v = w.get(field)
            if type(v) not in (int, float) or not math.isfinite(v) or v < 0:
                raise Blocked('missing or invalid allowance ' + field)
        if w.get('stale') or w['age_minutes'] >= 360 or w['remaining_pct'] > 100:
            raise Blocked('stale or invalid allowance')
        if w['remaining_pct'] < 10:
            raise Blocked('10% hard floor')
        if w['remaining_pct'] < (40 if initial else 20):
            raise Blocked('explore entry gate' if initial else '20% reserve')
        if initial and not 0 < w['resets_in_hours'] <= 24:
            raise Blocked('reset outside pilot window')
    return True


def explore_candidate(items, dirty, open_items):
    """Only structured human-reviewed scope is eligible; never execute first_step."""
    eligible = [i for i in items if i.get('status') == 'ready'
                and i.get('payoff_reviewed') is True
                and i.get('first_step_reviewed') is True
                and i.get('first_step_mode') == 'read_only'
                and isinstance(i.get('first_step'), str) and i['first_step']
                and i.get('reviewed_first_step_hash') ==
                hashlib.sha256(i['first_step'].encode()).hexdigest()
                and type(i.get('tier')) is int and i['tier'] in range(1, 6)
                and isinstance(i.get('path'), str) and i['path']
                and isinstance(i.get('date'), str) and i['date']
                and type(i.get('payoff')) is int and 1 <= i['payoff'] <= 5
                and i.get('cost') in ('S', 'M', 'L')
                and i['path'] not in dirty and i['path'] not in open_items]
    return min(eligible, key=lambda i: (-i['payoff'], {'S': 0, 'M': 1, 'L': 2}[i['cost']],
                                       i['tier'], i['date'], i['path']), default=None)


class Registry:
    """SQLite transactions serialize intake; pending launch never auto-retries.

    A crash after the external launch but before bind requires exact-key search.
    Incomplete/ambiguous searches block. An attended complete empty search
    abandons the claim and never automatically relaunches it.
    """
    def __init__(self, path):
        self.db = sqlite3.connect(path, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS jobs (
            key TEXT PRIMARY KEY, project TEXT, environment TEXT, fingerprint TEXT,
            thread TEXT UNIQUE, state TEXT NOT NULL, review TEXT, consumed INTEGER DEFAULT 0);
          CREATE TABLE IF NOT EXISTS explorations (
            path TEXT PRIMARY KEY, thread TEXT, state TEXT NOT NULL, reason TEXT);
          CREATE TABLE IF NOT EXISTS coverage (
            key TEXT, id TEXT, count INTEGER, PRIMARY KEY(key,id));
        ''')

    def close(self):
        self.db.close()

    @contextlib.contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    def claim_explore(self, item, *, attended=True):
        # No host-enforced per-run token cap has been verified. Do not infer one
        # from allowance percentages or a prompt's requested token budget.
        if not attended:
            raise Blocked('unattended exploration blocked: enforceable measured token cap unverified')
        with self.transaction():
            active = self.db.execute("SELECT path FROM explorations WHERE state IN ('pending','running')").fetchone()
            if active:
                raise Blocked('reconcile active exploration before another claim')
            self.db.execute("INSERT INTO explorations VALUES(?,NULL,'pending',NULL) ON CONFLICT(path) DO UPDATE SET thread=NULL,state='pending',reason=NULL",
                            (item['path'],))
        return dict(path=item['path'], state='pending')

    def recover_explore(self, path, exact_matches, *, search_complete=False):
        with self.transaction():
            row = self.db.execute('SELECT * FROM explorations WHERE path=?', (path,)).fetchone()
            if not row or row['state'] not in ('pending', 'running'):
                raise Blocked('no active exploration claim')
            if len(exact_matches) == 1 and exact_matches[0]:
                if row['thread'] and row['thread'] != exact_matches[0]:
                    raise Blocked('exploration thread mapping conflict')
                self.db.execute("UPDATE explorations SET thread=?,state='running' WHERE path=?", (exact_matches[0], path))
                return dict(status='running', thread=exact_matches[0])
            if not search_complete or exact_matches:
                raise Blocked('ambiguous/incomplete thread search; no automatic launch retry')
            self.db.execute("UPDATE explorations SET state='shaped',reason='abandoned claim; needs Chris' WHERE path=?", (path,))
            return dict(status='shaped', reason='abandoned claim; needs Chris')

    def finish_explore(self, path, recommendation):
        if recommendation not in ('promote', 'park', 'kill'):
            raise Blocked('recommendation required, never apply a lifecycle decision')
        with self.transaction():
            row = self.db.execute('SELECT state FROM explorations WHERE path=?', (path,)).fetchone()
            if not row or row['state'] != 'running':
                raise Blocked('no running exploration')
            self.db.execute("UPDATE explorations SET state='shaped',reason=? WHERE path=?", (recommendation, path))
        return dict(status='shaped', recommendation=recommendation, needs_human=True)

    def _capacity(self, exclude_key=''):
        active = self.db.execute("SELECT count(*) FROM jobs WHERE state IN ('pending','diagnosing','review','authorized') AND key != ?", (exclude_key,)).fetchone()[0]
        if active >= 5:
            raise Blocked('five active jobs; send overflow and Beads reference to Briefing')

    def recover_intake(self, key, exact_matches, *, search_complete=False):
        """Attended reconciliation, never permission for an automatic relaunch."""
        with self.transaction():
            row = self.job(key)
            if row['state'] not in ('pending', 'abandoned'):
                raise Blocked('no pending or abandoned intent')
            if len(exact_matches) == 1 and exact_matches[0]:
                if row['state'] == 'abandoned':
                    self._capacity(key)
                self.db.execute("UPDATE jobs SET thread=?,state='diagnosing' WHERE key=?", (exact_matches[0], key))
                return dict(state='diagnosing', thread=exact_matches[0])
            if exact_matches or not search_complete:
                raise Blocked('ambiguous/incomplete search; needs attended reconciliation')
            self.db.execute("UPDATE jobs SET state='abandoned' WHERE key=?", (key,))
            return dict(state='abandoned', launch=False)

    def reopen_diagnosis(self, key, reason, *, stop=False):
        if not reason:
            raise Blocked('human correction or stop reason required')
        with self.transaction():
            row = self.job(key)
            if row['state'] not in ('review', 'paused', 'recurrence_pending'):
                raise Blocked('no checkpoint or deferred diagnosis to reopen')
            if not stop and row['state'] != 'review':
                self._capacity(key)
            state = 'paused' if stop else 'diagnosing'
            self.db.execute('UPDATE jobs SET state=?,review=NULL,consumed=0 WHERE key=?', (state, key))
        return dict(state=state, reason=reason)

    def intake(self, project, environment, fingerprint, coverage_id, count):
        if project != 'AHRI' or not all((environment, fingerprint, coverage_id)):
            raise Blocked('attended AHRI intake only; exact environment/fingerprint/coverage required')
        if type(count) is not int or count < 0:
            raise Blocked('invalid count')
        key = hashlib.sha256(json.dumps([project, environment, fingerprint]).encode()).hexdigest()
        with self.transaction():
            row = self.db.execute('SELECT * FROM jobs WHERE key=?', (key,)).fetchone()
            new = row is None
            if new:
                self._capacity()
                self.db.execute('INSERT INTO jobs(key,project,environment,fingerprint,state) VALUES(?,?,?,?,?)',
                                (key, project, environment, fingerprint, 'pending'))
            self.db.execute('INSERT OR IGNORE INTO coverage VALUES(?,?,?)', (key, coverage_id, count))
        return dict(key=key, launch=new, state='pending' if new else row['state'],
                    count=self.db.execute('SELECT sum(count) FROM coverage WHERE key=?', (key,)).fetchone()[0])

    def bind(self, key, exact_matches):
        if len(exact_matches) != 1 or not exact_matches[0]:
            raise Blocked('pending intent requires one verified exact-key thread match; no automatic retry')
        with self.transaction():
            row = self.job(key)
            if row['thread'] and row['thread'] != exact_matches[0]:
                raise Blocked('thread mapping conflict')
            self.db.execute("UPDATE jobs SET thread=?, state=CASE WHEN state='pending' THEN 'diagnosing' ELSE state END WHERE key=?",
                            (exact_matches[0], key))

    def job(self, key):
        row = self.db.execute('SELECT * FROM jobs WHERE key=?', (key,)).fetchone()
        if row is None:
            raise Blocked('unknown intent')
        return dict(row)

    def review(self, key, packet):
        required = ('head', 'diff_hash', 'worktree', 'evidence', 'diagnosis', 'gates', 'actions')
        if not all(packet.get(k) for k in required) or packet['gates'] != 'passed':
            raise Blocked('incomplete evidence or failed gates')
        if not set(packet['actions']) <= {'push', 'open_pr', 'jira_listed_write'}:
            raise Blocked('merge/deploy and unlisted writes require separate authority')
        with self.transaction():
            row = self.job(key)
            if row['state'] != 'diagnosing' or not row['thread']:
                raise Blocked('one checkpoint per diagnosis; corrections require a new diagnosis')
            self.db.execute("UPDATE jobs SET review=?, state='review', consumed=0 WHERE key=?",
                            (json.dumps(packet, sort_keys=True), key))

    def checkpoint(self, key, event, current, *, provenance_verified=False, process_verified=False):
        # These flags may ONLY come from a tested host adapter / attended operator.
        # They are deliberately unavailable in the CLI.
        with self.transaction():
            row = self.job(key)
            packet = json.loads(row['review'] or '{}')
            if not provenance_verified or not process_verified:
                raise Blocked('trusted direct-human provenance and process evidence not verified')
            if (row['state'] != 'review' or row['consumed'] or event.get('text') != 'go'
                or event.get('createdBy') != 'user' or event.get('creationSource') not in ('web', 'mobile')
                or event.get('senderThreadId') or event.get('thread') != row['thread']
                or event.get('review_hash') != hashlib.sha256(row['review'].encode()).hexdigest()
                or any(current.get(k) != packet.get(k) for k in ('head', 'diff_hash', 'worktree'))):
                raise Blocked('checkpoint does not match direct human, reviewed diff and actions')
            self.db.execute("UPDATE jobs SET consumed=1, state='authorized' WHERE key=?", (key,))
            return packet['actions']

    def observe(self, key, evidence):
        # Adapter verifies artifact ancestry, task/environment, timestamps and
        # agreed fingerprint-specific coverage/traffic/cycle. Never infer deploy.
        required = ('merged_commit', 'artifact_revision', 'deployment_task', 'environment',
                    'deployed_at', 'window_start', 'window_end', 'criterion_source')
        with self.transaction():
            row = self.job(key)
            if row['state'] not in ('authorized', 'observing', 'settled'):
                raise Blocked('not awaiting deployment observation')
            deployment = all(evidence.get(k) for k in required[:5])
            deployment = deployment and evidence.get('environment') == row['environment'] and evidence.get('artifact_contains_merge') is True
            try:
                times = [dt.datetime.fromisoformat(evidence[k]) for k in ('deployed_at', 'window_start', 'window_end')]
                timed = all(t.tzinfo for t in times) and times[0] <= times[1] < times[2]
            except (KeyError, ValueError, TypeError):
                timed = False
            deployment = deployment and timed
            complete = deployment and bool(evidence.get('criterion_source'))
            for flag in ('coverage_complete', 'representative_traffic', 'cycle_complete'):
                complete = complete and evidence.get(flag) is True
            occurrences = evidence.get('occurrences')
            recurrence = deployment and type(occurrences) is int and occurrences > 0
            resolved = complete and type(occurrences) is int and occurrences == 0
            if row['state'] == 'settled' and not recurrence:
                return dict(state='settled', host_action='keep', result='resolved')
            state = 'settled' if resolved else 'observing'
            if recurrence:
                try:
                    self._capacity(key)
                    state = 'diagnosing'
                except Blocked:
                    state = 'recurrence_pending'
            self.db.execute('UPDATE jobs SET state=?, review=NULL, consumed=0 WHERE key=?', (state, key))
            return dict(state=state, host_action='settle' if state == 'settled' else 'unsettle',
                        result='resolved' if state == 'settled' else ('recurrence' if recurrence else 'not yet observed'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('context', 'tasks'))
    parser.add_argument('--directory', type=Path, default=Path.home() / '.claude')
    args = parser.parse_args()
    print(json.dumps(context(args.directory, Path.cwd()) if args.command == 'context' else tasks(), indent=2))


if __name__ == '__main__':
    main()
