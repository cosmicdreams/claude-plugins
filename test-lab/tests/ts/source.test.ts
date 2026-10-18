import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { importSnapshot, validateSnapshot, snapshotProblem, collectPages, readSnapshot, fetchSnapshot } from '../../src/source.ts';

const snapshot = () => ({
  schema: 1, source: 'testrail', project: 7, fetchedAt: '2026-10-09T10:00:00Z', complete: true,
  priorities: [{ id: 3, name: '2 - Short Regression' }, { id: 2, name: '3 - Full Regression' }],
  suites: [{ id: 11, cases: [
    { id: 21, suite_id: 11, title: 'Link home', priority_id: 3, custom_preconds: 'Published page.', custom_steps_separated: [{ content: 'Click logo.', expected: 'Home page opens.' }] },
    { id: 22, suite_id: 11, title: 'Footer year', priority_id: 2, custom_steps: 'Read footer.', custom_expected: 'Current year appears.' },
  ] }],
});
test('actual metadata ids decide tiers; source imports only unapproved drafts', () => {
  const drafts = importSnapshot(snapshot());
  assert.deepEqual(drafts.map((d) => [d.record.id, d.tier, d.record.priority]), [['C21', 'short', 'p1'], ['C22', 'full', 'p2']]);
  for (const d of drafts) { assert.equal(d.record.approval, null); assert.deepEqual(d.record.configurations, []); assert.equal(d.mark, 'needs-review'); }
  assert.equal(drafts[0]?.record.steps[0]?.obligations[0]?.text, 'Home page opens.');
});
test('partial, undated, duplicate and wrong-suite snapshots fail rather than shrink scope', () => {
  assert.throws(() => validateSnapshot({ ...snapshot(), complete: false }), /partial/);
  assert.throws(() => validateSnapshot({ ...snapshot(), fetchedAt: '' }), /timestamp/);
  const duplicate = snapshot(); duplicate.suites[0]!.cases[1]!.id = 21;
  assert.throws(() => validateSnapshot(duplicate), /duplicate case/);
  const wrong = snapshot(); wrong.suites[0]!.cases[0]!.suite_id = 99;
  assert.throws(() => validateSnapshot(wrong), /another suite/);
});
test('unknown priority and missing expected results stay needs-work, not guessed', () => {
  const s = snapshot(); s.suites[0]!.cases[1]!.priority_id = 999; s.suites[0]!.cases[1]!.custom_expected = '';
  const d = importSnapshot(s)[1]!;
  assert.equal(d.mark, 'needs-work'); assert.equal(d.tier, 'unassigned');
  assert.deepEqual(d.record.steps[0]!.obligations, []);
});
test('freshness rejects stale, future and invalid policy without using file mtime', () => {
  const s = validateSnapshot(snapshot());
  assert.equal(snapshotProblem(s, new Date('2026-10-09T11:00:00Z'), 2), null);
  assert.match(snapshotProblem(s, new Date('2026-10-09T13:00:00Z'), 2)!, /stale/);
  assert.match(snapshotProblem(s, new Date('2026-10-09T09:00:00Z'), 2)!, /future/);
  assert.match(snapshotProblem(s, new Date(), NaN)!, /policy/);
});
const endpoint = 'get_cases/7&suite_id=11';
test('all pages are collected under the same project and suite', async () => {
  const calls: string[] = [];
  const rows = await collectPages(endpoint, 'cases', async (e) => {
    calls.push(e);
    return calls.length === 1 ? { offset: 0, size: 1, total: 2, cases: [{ id: 21 }], _links: { next: `/api/v2/${endpoint}&limit=250&offset=1` } } : { offset: 1, size: 1, total: 2, cases: [{ id: 22 }], _links: { next: null } };
  });
  assert.deepEqual(rows.map((r) => r['id']), [21, 22]);
  assert.equal(calls[1], `${endpoint}&limit=250&offset=1`);
});
test('early end, duplicate ids and redirected next links fail complete refresh', async () => {
  await assert.rejects(collectPages(endpoint, 'cases', async () => ({ offset: 0, size: 1, total: 2, cases: [{ id: 21 }], _links: { next: null } })), /partial/);
  await assert.rejects(collectPages(endpoint, 'cases', async () => [{ id: 21 }, { id: 21 }]), /duplicate/);
  await assert.rejects(collectPages(endpoint, 'cases', async () => ({ offset: 0, size: 1, cases: [{ id: 21 }], _links: { next: 'https://outside.invalid/api/v2/get_cases/7&suite_id=11&limit=250&offset=1' } })), /changed endpoint/);
});
test('a dated complete snapshot is read from disk; a partial replacement is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'test-lab-source-'));
  try {
    const path = join(dir, 'source.json');
    await writeFile(path, JSON.stringify(snapshot()));
    assert.equal(importSnapshot(await readSnapshot(path)).length, 2);
    await writeFile(path, JSON.stringify({ ...snapshot(), complete: false }));
    await assert.rejects(readSnapshot(path), /partial/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('collection uses actual priority metadata and every suite before returning complete', async () => {
  const calls: string[] = [];
  const s = await fetchSnapshot({ project: 7, now: () => new Date('2026-10-09T10:00:00Z'), request: async (endpoint) => {
    calls.push(endpoint);
    if (endpoint === 'get_priorities') return snapshot().priorities;
    if (endpoint === 'get_suites/7') return [{ id: 11 }, { id: 12 }];
    if (endpoint.includes('suite_id=11')) return [{ id: 21, priority_id: 3, title: 'One', custom_steps: 'Click', custom_expected: 'Opens' }];
    if (endpoint.includes('suite_id=12')) return [{ id: 22, priority_id: 2, title: 'Two', custom_steps: 'Click', custom_expected: 'Opens' }];
    throw new Error('unexpected endpoint');
  } });
  assert.deepEqual(s.suites.map((s) => s.id), [11, 12]);
  assert.deepEqual(importSnapshot(s).map((d) => d.tier), ['short', 'full']);
  assert.equal(s.fetchedAt, '2026-10-09T10:00:00.000Z');
  assert.equal(calls.length, 4);
});
test('a later suite failure returns no new snapshot and leaves prior input unchanged', async () => {
  const prior = snapshot(); const before = JSON.stringify(prior);
  await assert.rejects(fetchSnapshot({ project: 7, request: async (endpoint) => {
    if (endpoint === 'get_priorities') return prior.priorities;
    if (endpoint === 'get_suites/7') return [{ id: 11 }, { id: 12 }];
    if (endpoint.includes('suite_id=11')) return prior.suites[0]!.cases;
    throw new Error('second suite unavailable');
  } }), /second suite unavailable/);
  assert.equal(JSON.stringify(prior), before);
});
test('R2-10: supplied project identity contradictions cannot acquire requested-project provenance', async () => {
  const suiteMismatch = { ...snapshot(), suites: [{ ...snapshot().suites[0]!, project_id: 99 }] };
  assert.throws(() => validateSnapshot(suiteMismatch), /project/);
  const caseMismatch = { ...snapshot(), suites: [{ id: 11, cases: [{ ...snapshot().suites[0]!.cases[0]!, project_id: 99 }] }] };
  assert.throws(() => validateSnapshot(caseMismatch), /project/);
  let casesRequested = false;
  await assert.rejects(fetchSnapshot({ project: 7, request: async (endpoint) => {
    if (endpoint === 'get_priorities') return snapshot().priorities;
    if (endpoint === 'get_suites/7') return [{ id: 11, project_id: 99 }];
    casesRequested = true; return [];
  } }), /project/);
  assert.equal(casesRequested, false);
  await assert.rejects(fetchSnapshot({ project: 7, request: async (endpoint) => {
    if (endpoint === 'get_priorities') return snapshot().priorities;
    if (endpoint === 'get_suites/7') return [{ id: 11, project_id: 7 }];
    return [{ ...snapshot().suites[0]!.cases[0]!, project_id: 99 }];
  } }), /project/);
});
test('R2-11: malformed separated steps never silently become plain-step interpretations', () => {
  for (const malformed of ['unsupported steps', { content: 'unexpected shape' }, 1, false]) {
    const raw = snapshot();
    const caseWithBadSteps = { ...raw.suites[0]!.cases[1]!, custom_steps_separated: malformed };
    const imported = importSnapshot({ ...raw, suites: [{ id: 11, cases: [caseWithBadSteps] }] })[0]!;
    assert.equal(imported.mark, 'needs-work');
    assert.match(imported.problems.join(';'), /separated steps/);
    assert.deepEqual(imported.record.steps, []);
    assert.equal(imported.record.approval, null);
  }
});
