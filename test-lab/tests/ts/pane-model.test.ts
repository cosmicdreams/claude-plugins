// The pane reads the saved run (scope item 7): its handoff sections with role labels, and the failure
// classes chosen afterwards in triage.json, without ever changing the verdict it shows.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseVerdict, summaryText } from '../../hooks/mod/model.ts';

const verdict = (context: Record<string, unknown> | undefined) => JSON.stringify({
  schema: 1, runDir: '/runs/r1', project: 'Generic', environment: 'local', startedAt: '2026-10-18T10:00:00Z', finishedAt: '2026-10-18T10:01:00Z', machine: 'm', openReport: null,
  ...(context === undefined ? {} : { context }),
  verdict: { verdict: 'not-ready', rule: 5, reasons: ['REG-1 failed'], exceptions: [], required: [{ track: 'regression', case: 'REG-1', configuration: 'desktop@1440', outcome: 'failed' }], scopeChanges: [], outside: [],
    failures: [{ lane: 'required-regression', test: { suite: 'e2e', file: 'tests/home.spec.ts', titlePath: ['heading'] }, project: 'desktop', outcome: 'failed', obligation: 'O1', classPrefill: null, acceptance: null }] },
});
const context = { appRoot: '/app', suiteRoot: '/qa', environment: { id: 'local', kind: 'local-candidate', baseUrl: 'http://127.0.0.1:1' }, build: { commit: 'a', digest: 'b' }, suite: { commit: 'c', digest: 'd' }, corpusRevision: 'r', identityChecks: [], counts: [],
  handoff: [{ title: 'Case approvals', items: ['REG-1 (regression, @p2): reading approved by Quinn QA as QA (stand-in) on 2026-10-18'] }] };

test('the pane shows the handoff with stand-in labels and the classes chosen on the saved run', () => {
  const triage = JSON.stringify({ schema: 1, entries: [{ failure: 1, test: 'x', class: 'product-bug', by: 'Quinn QA', role: 'qa', standIn: true, at: '2026-10-18T10:02:00Z', note: '' }] });
  const p = parseVerdict(verdict(context), triage);
  assert.ok(!('error' in p));
  assert.equal(p.verdict, 'not-ready', 'triage never changes the verdict');
  assert.match(p.failures[0]!, /class product-bug, chosen by Quinn QA \(QA \(stand-in\)\)/);
  const text = summaryText(p);
  assert.match(text, /Case approvals:\n- REG-1 \(regression, @p2\): reading approved by Quinn QA as QA \(stand-in\)/);
});

test('without triage a failure says its class is not chosen; an older verdict without handoff still reads', () => {
  const p = parseVerdict(verdict({ ...context, handoff: undefined }));
  assert.ok(!('error' in p));
  assert.match(p.failures[0]!, /class not chosen/);
  assert.deepEqual(p.context?.handoff, []);
  assert.ok('error' in parseVerdict(verdict({ ...context, handoff: [{ title: 1 }] })));
});
