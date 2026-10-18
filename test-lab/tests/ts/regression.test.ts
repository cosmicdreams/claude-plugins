// QA's regression set (plan §3): transitions replayed on the current base, prior hashes checked against
// the replay, roles taken from the base, and the base read from the remote-tracking ref of a real repo.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import type { Profile } from '../../src/model.ts';
import { ABSENT, checkRegression, replayTransitions as replayCore, setHash, type ApprovedSet, type Transition } from '../../src/regression.ts';
import { approvedSetOf, branchTransitions, readTransitionBases, readBase } from '../../src/regression-git.ts';
import { DEV, QA, ROLES, caseRecord, tmp } from './support.ts';

const NOW = new Date('2026-10-09T12:00:00Z');

const historical = new Map<string, ApprovedSet>();
function replayTransitions(base: ApprovedSet, transitions: Transition[], roles: typeof ROLES) { return replayCore(base, transitions, roles, historical); }

function t(id: string, delta: Transition['delta'], extra: Partial<Transition> = {}): Transition {
  const before = new Map(delta.filter((d) => d.before !== ABSENT).map((d) => [d.case, d.before]));
  const after = new Map(before);
  for (const d of delta) if (d.after === ABSENT) after.delete(d.case); else after.set(d.case, d.after);
  historical.set(id, before);
  return { id, kind: 'scope', baseCommit: id, setBefore: setHash(before), setAfter: setHash(after), delta, supersedes: [], by: QA, role: 'qa', standIn: true, at: `2026-10-09T0${id.length}:00:00Z`, reason: 'r', ...extra };
}

const set = (entries: Record<string, string>): ApprovedSet => new Map(Object.entries(entries));

describe('replaying QA transitions on the current base', () => {
  test('a case QA added upstream survives a branch transition that removes another', () => {
    const base = set({ A: 'ha', B: 'hb', C: 'hc-upstream' });
    const r = replayTransitions(base, [t('t', [{ case: 'B', before: 'hb', after: ABSENT }])], ROLES);
    assert.deepEqual([...r.set.keys()].sort(), ['A', 'C']);
    assert.deepEqual(r.problems, []);
  });

  test('an old approval carried on an old branch cannot roll back a newer upstream revision', () => {
    const base = set({ A: 'ha-v2' });
    const r = replayTransitions(base, [t('t', [{ case: 'A', before: 'ha-v0', after: 'ha-v1' }])], ROLES);
    assert.equal(r.problems[0]?.kind, 'conflict');
  });

  test('upstream revising case C while the branch also revises C conflicts; a branch revising an unrelated case replays cleanly', () => {
    const base = set({ C: 'hc-upstream', D: 'hd' });
    assert.equal(replayTransitions(base, [t('t', [{ case: 'C', before: 'hc', after: 'hc-branch' }])], ROLES).problems[0]?.kind, 'conflict');
    const clean = replayTransitions(base, [t('t', [{ case: 'D', before: 'hd', after: 'hd2' }])], ROLES);
    assert.deepEqual(clean.problems, []);
    assert.equal(clean.set.get('C'), 'hc-upstream');
  });

  test('a reconciled transition supersedes the conflicting one', () => {
    const base = set({ C: 'hc-upstream' });
    const r = replayTransitions(
      base,
      [t('t', [{ case: 'C', before: 'hc', after: 'hc-branch' }]), t('tt', [{ case: 'C', before: 'hc-upstream', after: 'hc-merged' }], { kind: 'reconcile', supersedes: ['t'] })],
      ROLES,
    );
    assert.deepEqual(r.problems, []);
    assert.equal(r.set.get('C'), 'hc-merged');
    assert.deepEqual(r.superseded, ['t']);
  });

  test('a developer adding a case to the regression set is refused', () => {
    const r = replayTransitions(set({}), [t('t', [{ case: 'X', before: ABSENT, after: 'hx' }], { by: DEV, role: 'developer', standIn: false })], ROLES);
    assert.equal(r.problems[0]?.kind, 'refused');
  });

  test('a QA transition by someone the base does not list as QA is refused', () => {
    const r = replayTransitions(set({}), [t('t', [{ case: 'X', before: ABSENT, after: 'hx' }], { by: 'Mallory' })], ROLES);
    assert.equal(r.problems[0]?.kind, 'refused');
  });

  test('a branch whose regression list was edited by hand with no QA record is not evaluable', () => {
    const base = set({ A: 'ha' });
    const r = checkRegression({ ref: 'origin/main', commit: 'c', fetchedAt: NOW, now: NOW, maxAgeHours: 24, base, baseRoles: ROLES, transitions: [], declared: set({}) });
    assert.equal(r.ok, false);
    assert.match(r.problems.join(' '), /has A as absent/);
  });

  test('a stale or unreachable base ref is not evaluable', () => {
    const base = set({ A: 'ha' });
    const old = checkRegression({ ref: 'origin/main', commit: 'c', fetchedAt: new Date('2026-10-01T00:00:00Z'), now: NOW, maxAgeHours: 24, base, baseRoles: ROLES, transitions: [], declared: base });
    assert.match(old.problems.join(' '), /last fetched .* hours ago/);
    const none = checkRegression({ ref: 'origin/main', commit: null, fetchedAt: null, now: NOW, maxAgeHours: 24, base, baseRoles: ROLES, transitions: [], declared: base });
    assert.match(none.problems.join(' '), /does not exist/);
  });
});

describe('the base is read from the remote-tracking ref of a real repository', () => {
  function repos() {
    const dir = tmp('test-lab-regression-');
    const run = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8' });
    const origin = join(dir, 'origin.git');
    run(dir, 'init', '-q', '--bare', '-b', 'main', origin);
    const upstream = join(dir, 'upstream');
    run(dir, 'clone', '-q', origin, upstream);
    const write = (root: string, files: Record<string, unknown>) => {
      for (const [path, value] of Object.entries(files)) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
      }
    };
    const a = caseRecord('REG-A', 'regression');
    const profile = (ids: string[]): Profile => ({ regression: ids, roles: ROLES } as unknown as Profile);
    write(upstream, { '.test-lab/profile.json': profile(['REG-A']), '.test-lab/cases/regression/REG-A.json': a });
    run(upstream, 'add', '.');
    run(upstream, 'commit', '-q', '-m', 'test: fixture A');
    run(upstream, 'push', '-q', 'origin', 'main');
    const local = join(dir, 'local');
    run(dir, 'clone', '-q', origin, local);
    run(local, 'checkout', '-q', '-b', 'feature/x');
    return { run, write, upstream, local, profile, a };
  }

  test('a stale local base missing a case QA added upstream: the remote-tracking ref has it', async () => {
    const r = repos();
    const b = caseRecord('REG-B', 'regression');
    r.write(r.upstream, { '.test-lab/profile.json': r.profile(['REG-A', 'REG-B']), '.test-lab/cases/regression/REG-B.json': b });
    r.run(r.upstream, 'add', '.');
    r.run(r.upstream, 'commit', '-q', '-m', 'test: fixture B');
    r.run(r.upstream, 'push', '-q', 'origin', 'main');
    r.run(r.local, 'fetch', '-q', 'origin');
    // The local main branch still lacks REG-B; the remote-tracking ref has it.
    const base = await readBase(r.local, 'origin', 'main');
    assert.deepEqual([...base.cases.keys()].sort(), ['REG-A', 'REG-B']);
    assert.ok(base.fetchedAt !== null);
    const baseSet = approvedSetOf(base.profile as Profile, base.cases);
    assert.deepEqual(baseSet.problems, []);
    const declared = approvedSetOf(r.profile(['REG-A']), new Map([['REG-A', r.a]]));
    const { transitions } = await branchTransitions(r.local, base.ref);
    const check = checkRegression({ ref: base.ref, commit: base.commit, fetchedAt: base.fetchedAt, now: new Date(), maxAgeHours: 24, base: baseSet.set, baseRoles: ROLES, transitions, declared: declared.set });
    assert.equal(check.ok, false);
    assert.match(check.problems.join(' '), /REG-B/);
  });

  test('a QA transition committed on the branch validates its original binding and preserves a later upstream addition', async () => {
    const r = repos();
    const c = caseRecord('REG-C', 'regression');
    const original = new Map([['REG-A', r.a.approval!.hash]]);
    const transition = t('add-c', [{ case: 'REG-C', before: ABSENT, after: c.approval!.hash }], {
      baseCommit: r.run(r.local, 'rev-parse', 'HEAD').trim(),
      setBefore: setHash(original), setAfter: setHash(new Map([...original, ['REG-C', c.approval!.hash]])),
    });
    r.write(r.local, { '.test-lab/transitions/add-c.json': transition, '.test-lab/cases/regression/REG-C.json': c, '.test-lab/profile.json': r.profile(['REG-A', 'REG-C']) });
    r.run(r.local, 'add', '.');
    r.run(r.local, 'commit', '-q', '-m', 'test: QA adds C');
    const b = caseRecord('REG-B', 'regression');
    r.write(r.upstream, { '.test-lab/profile.json': r.profile(['REG-A', 'REG-B']), '.test-lab/cases/regression/REG-B.json': b });
    r.run(r.upstream, 'add', '.');
    r.run(r.upstream, 'commit', '-q', '-m', 'test: upstream adds B');
    r.run(r.upstream, 'push', '-q', 'origin', 'main');
    r.run(r.local, 'fetch', '-q', 'origin');
    const base = await readBase(r.local, 'origin', 'main');
    const got = await branchTransitions(r.local, base.ref);
    assert.deepEqual(got.transitions.map((x) => x.id), ['add-c']);
    const history = await readTransitionBases(r.local, base.ref, got.transitions);
    assert.deepEqual(history.problems, []);
    assert.deepEqual(history.historicalBases.get(transition.baseCommit), original);
    const input = { ref: base.ref, commit: base.commit, fetchedAt: base.fetchedAt, now: new Date(), maxAgeHours: 24,
      base: approvedSetOf(base.profile as Profile, base.cases).set, baseRoles: ROLES, transitions: got.transitions, historicalBases: history.historicalBases };
    const missingB = approvedSetOf(r.profile(['REG-A', 'REG-C']), new Map([['REG-A', r.a], ['REG-C', c]]));
    assert.equal(checkRegression({...input, declared: missingB.set}).ok, false);
    const declared = approvedSetOf(r.profile(['REG-A', 'REG-B', 'REG-C']), new Map([['REG-A', r.a], ['REG-B', b], ['REG-C', c]]));
    assert.deepEqual(checkRegression({...input, declared: declared.set}).problems, []);
    for (const field of ['baseCommit', 'setBefore', 'setAfter'] as const) {
      const forged = {...transition, [field]:'nonexistent'};
      const originalBases = await readTransitionBases(r.local, base.ref, [forged]);
      assert.equal(checkRegression({...input, transitions:[forged], historicalBases:originalBases.historicalBases, declared:declared.set}).ok, false, field);
    }
  });
});

describe('the approved set comes from approvals, never the folder', () => {
  test('an unapproved or edited listed case is a problem, not a member', () => {
    const a = caseRecord('A', 'regression');
    const edited = { ...caseRecord('B', 'regression'), title: 'same', preconditions: 'edited' };
    const draft = { ...caseRecord('C', 'regression'), approval: null };
    const r = approvedSetOf({ regression: ['A', 'B', 'C'], roles: ROLES } as unknown as Profile, new Map([['A', a], ['B', edited], ['C', draft]]));
    assert.deepEqual([...r.set.keys()], ['A']);
    assert.equal(r.problems.length, 2);
  });
});

// Review R1 finding 9: valid deltas do not excuse forged original bindings.
test('R1-9 forged transition base and set hashes cannot replay', () => {
  const r = checkRegression({ ref: 'origin/main', commit: 'current', fetchedAt: NOW, now: NOW, maxAgeHours: 24,
    base: set({ KEEP: 'hk', DROP: 'hd' }), baseRoles: ROLES,
    transitions: [t('forged', [{ case: 'DROP', before: 'hd', after: ABSENT }], { baseCommit: 'nonexistent', setBefore: 'wrong-before', setAfter: 'wrong-after' })],
    declared: set({ KEEP: 'hk' }) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /binding|historical|base commit/);
});

// Each signed field is validated independently, including prior branch transitions.
test('R1-9 original bindings use the full historical set and preceding branch deltas', () => {
  const base = set({ KEEP: 'hk', DROP: 'hd' });
  const after1 = set({ KEEP: 'hk' });
  const after2 = set({ KEEP: 'hk2' });
  const first = t('first', [{case:'DROP',before:'hd',after:ABSENT}], {baseCommit:'old',setBefore:setHash(base),setAfter:setHash(after1)});
  const second = t('second', [{case:'KEEP',before:'hk',after:'hk2'}], {baseCommit:'old',setBefore:setHash(after1),setAfter:setHash(after2)});
  const original = new Map([['old',base]]);
  const current = set({KEEP:'hk',DROP:'hd',UPSTREAM:'hu'});
  const valid = replayCore(current,[first,second],ROLES,original);
  assert.deepEqual(valid.problems, []);
  assert.deepEqual([...valid.set], [['KEEP','hk2'],['UPSTREAM','hu']]);
  for (const field of ['baseCommit','setBefore','setAfter'] as const) {
    const forged = {...second,[field]:'forged'};
    assert.equal(replayCore(current,[first,forged],ROLES,original).problems[0]?.kind, 'invalid',field);
  }
  assert.equal(replayCore(current,[second,first],ROLES,original).problems[0]?.kind,'invalid','reordered branch transitions');
});
