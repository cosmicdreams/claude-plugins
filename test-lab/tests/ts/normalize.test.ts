// Result normalization and run status (plan §2): outcomes from Playwright's outcome algorithm and the
// expected status, per obligation from the innermost step carrying it, per configuration from what the
// test really ran under, and the run as a whole from every planned invocation's ledger.

import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { normalize, type NormalizeInput } from '../../src/normalize.ts';
import { readInvocation, readRun, runStatus, type InvocationPlan } from '../../src/run-observation.ts';
import type { CaseRecord, Mapping, Quarantine } from '../../src/model.ts';
import { CONFIGS, Ledger, QA, caseRecord, caseSteps, tmp } from './support.ts';

const FILE = 'tests/a.spec.ts';
const A = { suite: 'e2e', file: FILE, titlePath: ['a'] };

function mapping(caseId: string, config: string, obligation: string, test = A): Mapping {
  return { obligation: { case: caseId, step: 'S1', obligation }, test, configuration: config, layer: 'served' };
}

function run(ledgers: Ledger[], input: Omit<Partial<NormalizeInput>, 'cases' | 'ledger'> & { cases: CaseRecord[]; regression?: string[]; addendum?: string[]; ledger?: Mapping[] }) {
  const dir = tmp();
  const plans: InvocationPlan[] = ledgers.map((l, i) => {
    const d = join(dir, `inv${i}`);
    l.write(d);
    return { id: `inv${i}`, suite: 'e2e', dir: d };
  });
  const observation = readRun(plans);
  return normalize({
    run: observation,
    configurations: CONFIGS,
    cases: new Map(input.cases.map((c) => [c.id, c])),
    required: { regression: input.regression ?? [], addendum: input.addendum ?? [] },
    ledger: input.ledger ?? [],
    classification: input.classification ?? [],
    liveQuarantines: input.liveQuarantines ?? [],
    quarantinesOnRequired: input.quarantinesOnRequired ?? [],
    roleOverrideFiles: input.roleOverrideFiles ?? new Set(),
  });
}

const REQ = caseRecord('REG-1', 'regression');
const requiredMappings = [mapping('REG-1', 'desktop@1440', 'O1'), mapping('REG-1', 'desktop@1440', 'O2')];

function single(status: string, extra: { expectedStatus?: string; steps?: Record<string, 'passed' | 'failed' | 'skipped'> } = {}) {
  const l = new Ledger().test('t', { file: FILE, titlePath: ['a'], cases: ['REG-1'], ...(extra.expectedStatus === undefined ? {} : { expectedStatus: extra.expectedStatus }) });
  return l.result('t', { status, ...(extra.expectedStatus === undefined ? {} : { expectedStatus: extra.expectedStatus }), steps: caseSteps('REG-1', 'desktop@1440', extra.steps ?? { O1: 'passed', O2: 'passed' }) });
}

describe('outcomes never read a non-pass as a pass', () => {
  test('a clean pass is passed', () => {
    const n = run([single('passed')], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings });
    assert.equal(n.required[0]?.outcome, 'passed');
    assert.equal(n.tests[0]?.lane, 'required-regression');
  });

  test('a retry-pass is flaky, not passed', () => {
    const l = new Ledger().test('t', { file: FILE, titlePath: ['a'], cases: ['REG-1'] });
    l.result('t', { status: 'failed', steps: caseSteps('REG-1', 'desktop@1440', { O1: 'failed', O2: 'passed' }), error: 'expect failed' });
    l.result('t', { status: 'passed', retry: 1, steps: caseSteps('REG-1', 'desktop@1440', { O1: 'passed', O2: 'passed' }) });
    const n = run([l], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings });
    assert.equal(n.tests[0]?.outcome, 'flaky');
    assert.equal(n.required[0]?.outcome, 'flaky');
  });

  test('test.fail() that fails is an expected failure, never passing', () => {
    const n = run([single('failed', { expectedStatus: 'failed' })], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings });
    assert.equal(n.tests[0]?.outcome, 'expected-failure');
    assert.equal(n.required[0]?.outcome, 'expected-failure');
  });

  test('an unexpected pass of test.fail() is a failure', () => {
    const n = run([single('passed', { expectedStatus: 'failed' })], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings });
    assert.equal(n.tests[0]?.outcome, 'failed');
    assert.equal(n.required[0]?.outcome, 'failed');
  });

  test('a runtime skip is skipped', () => {
    const l = new Ledger().test('t', { file: FILE, titlePath: ['a'], cases: ['REG-1'] }).result('t', { status: 'skipped', expectedStatus: 'skipped' });
    const n = run([l], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings });
    assert.equal(n.tests[0]?.outcome, 'skipped');
    assert.notEqual(n.required[0]?.outcome, 'passed');
  });

  test('a passing test whose obligation step skipped does not cover that obligation', () => {
    const n = run([single('passed', { steps: { O1: 'passed', O2: 'skipped' } })], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings });
    assert.equal(n.tests[0]?.outcome, 'passed');
    const o2 = n.required[0]?.obligations.find((o) => o.ref.obligation === 'O2');
    assert.equal(o2?.outcome, 'skipped');
    assert.equal(n.required[0]?.outcome, 'skipped');
  });

  test('a declared test with no result is not run', () => {
    const l = new Ledger().test('t', { file: FILE, titlePath: ['a'], cases: ['REG-1'] });
    const n = run([l], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings });
    assert.equal(n.tests[0]?.outcome, 'not-run');
    assert.equal(n.required[0]?.outcome, 'not-run');
  });

  test('an obligation no step carries is not run, even when the test passed', () => {
    const l = new Ledger().test('t', { file: FILE, titlePath: ['a'], cases: ['REG-1'] }).result('t', { status: 'passed', steps: caseSteps('REG-1', 'desktop@1440', { O1: 'passed' }) });
    const n = run([l], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings });
    assert.equal(n.required[0]?.obligations.find((o) => o.ref.obligation === 'O2')?.outcome, 'not-run');
    assert.equal(n.required[0]?.outcome, 'not-run');
  });
});

describe('attribution and many-to-many', () => {
  test('the deepest failing obligation is credited; the passing sibling is not a passing witness', () => {
    const n = run([single('failed', { steps: { O1: 'passed', O2: 'failed' } })], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings });
    assert.equal(n.tests[0]?.failure?.obligation, 'O2');
    assert.deepEqual(n.tests[0]?.failure?.stepPath, [1, 1]);
    const [o1, o2] = n.required[0]?.obligations ?? [];
    assert.equal(o2?.outcome, 'failed');
    assert.equal(o1?.outcome, 'failed', 'a failed test gives no passing witness for any obligation');
    assert.match(o1?.reason ?? '', /failed in O2/);
  });

  test('a passing witness never hides another mapped test failing the same obligation', () => {
    const B = { suite: 'e2e', file: 'tests/b.spec.ts', titlePath: ['b'] };
    const l = new Ledger();
    l.test('t', { file: FILE, titlePath: ['a'], cases: ['REG-1'] }).result('t', { status: 'passed', steps: caseSteps('REG-1', 'desktop@1440', { O1: 'passed', O2: 'passed' }) });
    l.test('u', { file: B.file, titlePath: B.titlePath, cases: ['REG-1'] }).result('u', { status: 'failed', steps: caseSteps('REG-1', 'desktop@1440', { O1: 'failed' }), error: 'expect failed' });
    const n = run([l], { cases: [REQ], regression: ['REG-1'], ledger: [...requiredMappings, mapping('REG-1', 'desktop@1440', 'O1', B)] });
    assert.equal(n.required[0]?.obligations[0]?.outcome, 'failed');
    assert.equal(n.required[0]?.outcome, 'failed');
  });

  test('a failure in one invocation is not hidden by a pass in a later one', () => {
    const fail = single('failed', { steps: { O1: 'failed', O2: 'passed' } });
    const pass = single('passed');
    const n = run([fail, pass], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings });
    assert.equal(n.tests.length, 2);
    assert.equal(n.required[0]?.outcome, 'failed');
  });

  test('a pass at one width is not claimed for another (test.use at 1440 mapped to 900)', () => {
    const record = caseRecord('REG-2', 'regression', { configurations: ['desktop@900'] });
    const l = new Ledger().test('t', { file: FILE, titlePath: ['a'], cases: ['REG-2'] }).result('t', { status: 'passed', steps: caseSteps('REG-2', 'desktop@1440', { O1: 'passed', O2: 'passed' }) });
    const n = run([l], { cases: [record], regression: ['REG-2'], ledger: [mapping('REG-2', 'desktop@900', 'O1'), mapping('REG-2', 'desktop@900', 'O2')] });
    assert.equal(n.required[0]?.outcome, 'not-run');
    assert.match(n.required[0]?.obligations[0]?.reason ?? '', /no result for this test under this configuration/);
    assert.equal(n.tests[0]?.lane, 'outside', 'its own tuple is declared by no bound case');
  });

  test('a mapped test failing only in an undeclared configuration is outside the verdict; an unbound governed failure is governed', () => {
    const l = new Ledger();
    l.test('t', { file: FILE, titlePath: ['a'], cases: ['REG-1'] }).result('t', { status: 'failed', steps: caseSteps('REG-1', 'desktop@900', { O1: 'failed' }), error: 'expect failed' });
    l.test('g', { file: 'tests/g.spec.ts', titlePath: ['g'] }).result('g', { status: 'failed', error: 'expect failed' });
    const n = run([l], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings });
    assert.equal(n.tests[0]?.lane, 'outside');
    assert.equal(n.tests[1]?.lane, 'governed');
  });

  test('a test failing before its first caseStep stays in a blocking lane', () => {
    const governedCase = caseRecord('GOV-1', 'regression');
    const l = new Ledger().test('t', { file: FILE, titlePath: ['a'], cases: ['GOV-1'] }).result('t', { status: 'failed', error: 'page.goto: net::ERR_ABORTED' });
    const n = run([l], { cases: [governedCase], ledger: [mapping('GOV-1', 'desktop@1440', 'O1')] });
    assert.equal(n.tests[0]?.lane, 'governed');
  });

  test('a case ID with no case record cannot move a failing test out of the governed lane', () => {
    const l = new Ledger().test('t', { file: FILE, titlePath: ['a'], cases: ['NO-SUCH-CASE'] }).result('t', { status: 'failed', steps: caseSteps('NO-SUCH-CASE', 'desktop@900', { O1: 'failed' }), error: 'x' });
    const n = run([l], { cases: [REQ] });
    assert.equal(n.tests[0]?.lane, 'governed');
    assert.ok(n.problems.some((p) => /NO-SUCH-CASE/.test(p)));
  });

  test('a role set in a describe block cannot be observed, so the required case is not run', () => {
    const n = run([single('passed')], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings, roleOverrideFiles: new Set([`e2e::${FILE}`]) });
    assert.equal(n.required[0]?.outcome, 'not-run');
    assert.match(n.required[0]?.obligations[0]?.reason ?? '', /role is set in a describe block/);
  });

  test('a passing result under the wrong role does not count for the role-bound configuration', () => {
    const record = caseRecord('REG-3', 'regression', { configurations: ['editor@1440'] });
    const l = new Ledger().test('t', { file: FILE, titlePath: ['a'], cases: ['REG-3'] }).result('t', { status: 'passed', steps: caseSteps('REG-3', 'desktop@1440', { O1: 'passed', O2: 'passed' }) });
    const n = run([l], { cases: [record], regression: ['REG-3'], ledger: [mapping('REG-3', 'editor@1440', 'O1'), mapping('REG-3', 'editor@1440', 'O2')] });
    assert.equal(n.required[0]?.outcome, 'not-run');
  });

  test('a quarantine on a required case never takes effect: the case is not passed', () => {
    const q: Quarantine = { kind: 'quarantine', id: 'q1', test: A, owner: QA, ticket: 'T-1', expires: '2099-01-01', by: QA, role: 'qa', standIn: true, at: '2026-10-09', reason: 'flaky' };
    const n = run([single('passed')], { cases: [REQ], regression: ['REG-1'], ledger: requiredMappings, quarantinesOnRequired: [q] });
    assert.equal(n.required[0]?.quarantined, true);
    assert.notEqual(n.required[0]?.outcome, 'passed');
  });

  test('a declared required configuration with no mapping is not run', () => {
    const record = caseRecord('REG-4', 'regression', { configurations: ['desktop@1440', 'desktop@900'] });
    const l = new Ledger().test('t', { file: FILE, titlePath: ['a'], cases: ['REG-4'] }).result('t', { status: 'passed', steps: caseSteps('REG-4', 'desktop@1440', { O1: 'passed', O2: 'passed' }) });
    const n = run([l], { cases: [record], regression: ['REG-4'], ledger: [mapping('REG-4', 'desktop@1440', 'O1'), mapping('REG-4', 'desktop@1440', 'O2')] });
    assert.equal(n.required.find((r) => r.configuration === 'desktop@1440')?.outcome, 'passed');
    assert.equal(n.required.find((r) => r.configuration === 'desktop@900')?.outcome, 'not-run');
  });
});

describe('run status', () => {
  function status(ledgers: Ledger[], write: (dir: string, l: Ledger, i: number) => void = (d, l) => void l.write(d)) {
    const dir = tmp();
    const plans = ledgers.map((l, i) => {
      const d = join(dir, `inv${i}`);
      write(d, l, i);
      return { id: `inv${i}`, suite: 'e2e', dir: d };
    });
    return runStatus(readRun(plans));
  }
  const passing = () => new Ledger().test('t', { file: FILE, titlePath: ['a'] }).result('t', { status: 'passed' });

  test('a clean invocation is complete', () => assert.deepEqual(status([passing()]).problems, []));

  test('every test passing while global teardown throws is a run-level error', () => {
    const s = status([passing().error('Error: EXAMPLE_GLOBAL_TEARDOWN_ERROR')]);
    assert.equal(s.complete, false);
    assert.ok(s.problems.some((p) => p.kind === 'run-error'));
  });

  test('a ledger with no completion record is interrupted, whatever passed before', () => {
    const s = status([passing()], (d, l) => void l.write(d, { complete: false }));
    assert.ok(s.problems.some((p) => p.kind === 'completion-missing'));
  });

  test('an interrupted run that still wrote its report is interrupted', () => {
    const s = status([passing()], (d, l) => void l.write(d, { finalStatus: 'interrupted' }));
    assert.ok(s.problems.some((p) => p.kind === 'interrupted'));
  });

  test('a planned invocation that wrote nothing makes the run incomplete', () => {
    const s = status([passing(), passing()], (d, l, i) => (i === 0 ? void l.write(d) : undefined));
    assert.ok(s.problems.some((p) => p.kind === 'ledger-missing' && p.invocation === 'inv1'));
  });

  test('a ledger cut mid-record is invalid', () => {
    const s = status([passing()], (d, l) => {
      const path = l.write(d);
      appendFileSync(path, '{"type":"result","testId":');
    });
    assert.ok(s.problems.some((p) => p.kind === 'ledger-invalid'));
  });

  test('a per-test outcome that disagrees with its results is invalid', () => {
    const s = status([passing()], (d, l) => {
      const records = l.records().map((r) => (r.type === 'test' ? { ...r, outcome: 'unexpected' } : r));
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'steps.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    });
    assert.ok(s.problems.some((p) => p.kind === 'ledger-invalid' && /disagrees/.test(p.detail)));
  });

  test('a failed final status no test result explains is a problem', () => {
    const s = status([passing()], (d, l) => void l.write(d, { finalStatus: 'failed' }));
    assert.ok(s.problems.some((p) => p.kind === 'unexplained-status'));
  });

  test('an invocation that ran no tests is a problem', () => {
    const s = status([new Ledger()]);
    assert.ok(s.problems.some((p) => p.kind === 'no-tests'));
  });

  test('a global timeout is a problem', () => {
    const s = status([passing()], (d, l) => void l.write(d, { finalStatus: 'timedout' }));
    assert.ok(s.problems.some((p) => p.kind === 'timed-out'));
  });
});

// Review R1 finding 11: persisted status enums are closed before outcome computation.
test('R1-11 arbitrary persisted statuses are invalid rather than passing', () => {
  const dir = tmp('test-lab-invalid-status-');
  new Ledger().test('t', { file: A.file, titlePath: A.titlePath, expectedStatus: 'not-a-status' })
    .result('t', { status: 'not-a-status', expectedStatus: 'not-a-status', steps: caseSteps('C1', 'desktop@1440', { O1: 'passed', O2: 'passed' }) }).write(dir);
  const status = runStatus({ invocations: [readInvocation({ id: 'r', suite: 'e2e', dir })] });
  assert.equal(status.complete, false);
  assert.ok(status.problems.some((p) => p.kind === 'ledger-invalid'));
});
