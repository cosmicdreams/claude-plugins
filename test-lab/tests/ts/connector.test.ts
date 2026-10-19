// Source connectors (scope item 3): the core reads cases only through SourceConnector. The file
// connector serves tests; the TestRail connector calls lib:testrail's own read-only helper. These tests
// use a stand-in helper with lib's layout, so no network, account or credential is touched.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { fileConnector, readOnlyEndpoint, requestConnector, testrailConnector } from '../../src/connectors/connector.ts';
import { mapPriority, priorityOf } from '../../src/priority.ts';
import { importSnapshot } from '../../src/source.ts';

const PRIORITIES = [
  { id: 1, name: '4 - Non-Regression' },
  { id: 2, name: '3 - Full Regression' },
  { id: 3, name: '2 - Short Regression' },
  { id: 4, name: '1 - Smoke' },
  { id: 5, name: 'Undefined' },
];
const CASES = [
  { id: 101, suite_id: 9, title: 'Footer logo links home', priority_id: 3, custom_steps_separated: [{ content: 'Click the footer logo.', expected: 'The home page opens.' }] },
  { id: 102, suite_id: 9, title: 'Listing sort', priority_id: 5, custom_steps: 'Open the listing.', custom_expected: 'Items sort by ID.' },
];
function responses(pages: 'complete' | 'partial' = 'complete') {
  return {
    schema: 1, source: 'testrail',
    responses: {
      get_priorities: PRIORITIES,
      'get_suites/93': [{ id: 9, project_id: 93 }],
      'get_cases/93&suite_id=9&limit=250&offset=0': { offset: 0, size: 1, total: 2, cases: [CASES[0]], _links: { next: '/api/v2/get_cases/93&suite_id=9&limit=250&offset=1' } },
      'get_cases/93&suite_id=9&limit=250&offset=1': pages === 'complete'
        ? { offset: 1, size: 1, total: 2, cases: [CASES[1]], _links: { next: null } }
        : { offset: 1, size: 0, total: 2, cases: [], _links: { next: null } },
      'get_case/101': CASES[0],
    },
  };
}
function fileWith(value: unknown): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'test-lab-connector-'));
  const path = join(dir, 'responses.json');
  writeFileSync(path, JSON.stringify(value));
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a complete snapshot: every suite and page, dated, through the connector only', async () => {
  const f = fileWith(responses());
  try {
    const c = fileConnector(f.path, 93, () => new Date('2026-10-18T09:00:00Z'));
    assert.equal(c.name, 'file');
    const s = await c.snapshot();
    assert.equal(s.complete, true);
    assert.equal(s.fetchedAt, '2026-10-18T09:00:00.000Z');
    assert.deepEqual(s.suites.map((x) => [x.id, x.cases.map((r) => r['id'])]), [[9, [101, 102]]]);
  } finally { f.cleanup(); }
});

test('a partial refresh is refused: no snapshot is returned, so nothing can retire a case', async () => {
  const f = fileWith(responses('partial'));
  try {
    await assert.rejects(fileConnector(f.path, 93).snapshot(), /pagination|partial|inconsistent/);
  } finally { f.cleanup(); }
});

test('priority comes from get_priorities metadata, never the stored id; the label number is the tag', async () => {
  const f = fileWith(responses());
  try {
    const c = fileConnector(f.path, 93, () => new Date('2026-10-18T09:00:00Z'));
    const priorities = await c.priorities();
    // priority_id 3 is "2 - Short Regression": tagged @p2, not @p3.
    assert.deepEqual(mapPriority(priorities.find((p) => p.id === 3)!), { id: 3, label: '2 - Short Regression', tag: 'p2', defaulted: false, tier: 'short' });
    assert.equal(mapPriority(priorities.find((p) => p.id === 4)!).tag, 'p1');
    const drafts = importSnapshot(await c.snapshot());
    assert.deepEqual(drafts.map((d) => [d.record.id, d.record.priority, d.priority.label, d.record.priorityDefaulted ?? false]), [
      ['C101', 'p2', '2 - Short Regression', false],
      ['C102', 'p3', 'Undefined', true],
    ]);
  } finally { f.cleanup(); }
});

test('label to tag: each numbered label maps to its number; Undefined and unknown ids default to @p3', () => {
  assert.deepEqual(PRIORITIES.map((p) => mapPriority(p).tag), ['p4', 'p3', 'p2', 'p1', 'p3']);
  assert.equal(mapPriority({ id: 5, name: 'Undefined' }).defaulted, true);
  const unknown = priorityOf(77, PRIORITIES);
  assert.equal(unknown.tag, 'p3');
  assert.equal(unknown.defaulted, true);
  // A number in a label is never read from the id, and the id never from the label.
  assert.equal(mapPriority({ id: 1, name: '3 - Full Regression' }).tag, 'p3');
});

test('one case by ID; a response for another case is refused', async () => {
  const f = fileWith(responses());
  try {
    const c = fileConnector(f.path, 93);
    assert.equal((await c.case(101))['title'], 'Footer logo links home');
    await assert.rejects(c.case(102), /no recorded response/);
    const lying = requestConnector('x', 'x', 93, async () => ({ id: 999 }));
    await assert.rejects(lying.case(101), /returned case 999/);
  } finally { f.cleanup(); }
});

test('connectors are read-only: write endpoints are refused before any request', async () => {
  for (const e of ['add_result/1', 'update_case/101', 'get_cases/93', 'get_case/1;rm', 'get_users']) assert.throws(() => readOnlyEndpoint(e), /refuses endpoint/);
  let called = 0;
  const c = requestConnector('x', 'x', 93, async () => { called++; return []; });
  await assert.rejects(c.case(-1), /positive/);
  assert.equal(called, 0);
});

function fakeLib(version: string): { helper: string; log: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'test-lab-fake-lib-'));
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'lib', version }));
  const scripts = join(root, 'skills/testrail/scripts');
  mkdirSync(scripts, { recursive: true });
  const log = join(root, 'calls.log');
  const helper = join(scripts, 'testrail.py');
  writeFileSync(helper, [
    'import json, sys',
    `open(${JSON.stringify(log)}, "a").write(" ".join(sys.argv[1:]) + "\\n")`,
    'endpoint = sys.argv[1]',
    `data = json.loads(${JSON.stringify(JSON.stringify(responses().responses))})`,
    'if endpoint not in data:',
    '    print("lib:testrail: no such endpoint", file=sys.stderr); sys.exit(1)',
    'print("TestRail account=shared, source=stand-in, login=nobody", file=sys.stderr)',
    'print(json.dumps(data[endpoint]))',
  ].join('\n'));
  chmodSync(helper, 0o755);
  return { helper, log, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('TestRail connector: lib:testrail 1.4.2 helper by argument vector, shared account, project 93', async () => {
  const lib = fakeLib('1.4.2');
  try {
    const c = testrailConnector({ helper: lib.helper, account: 'shared', project: 93 });
    assert.match(c.origin, /lib:testrail 1\.4\.2/);
    const s = await c.snapshot();
    assert.equal(s.project, 93);
    const { readFileSync } = await import('node:fs');
    const calls = readFileSync(lib.log, 'utf8').trim().split('\n');
    assert.ok(calls.every((line) => line.endsWith('--account shared --project 93')), calls.join('\n'));
    assert.deepEqual(calls.map((l) => l.split(' ')[0]), ['get_priorities', 'get_suites/93', 'get_cases/93&suite_id=9&limit=250&offset=0', 'get_cases/93&suite_id=9&limit=250&offset=1']);
    await assert.rejects(c.case(555), /lib:testrail get_case\/555 failed: lib:testrail: no such endpoint/);
  } finally { lib.cleanup(); }
});

test('TestRail connector refuses a lib older than the reviewed read path, and a relative helper', () => {
  const old = fakeLib('1.4.1');
  try {
    assert.throws(() => testrailConnector({ helper: old.helper, account: 'shared', project: 93 }), /predates/);
    assert.throws(() => testrailConnector({ helper: 'testrail.py', account: 'shared', project: 93 }), /absolute path/);
    assert.throws(() => testrailConnector({ helper: old.helper, account: 'a b', project: 93 }), /account/);
  } finally { old.cleanup(); }
});
