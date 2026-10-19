// The decision table (plan §2): every rule and clearing condition, each built from real ledgers, receipts,
// manifests, journals and transitions and changed one fact at a time from a world that is ready.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { outageBreaker, type HealthProbe } from '../../src/breaker.ts';
import { quarantines, riskAcceptances } from '../../src/dispositions.ts';
import { evaluateCase } from '../../src/evidence.ts';
import { judgeFixture } from '../../src/fixtures.ts';
import { evaluateIdentity, type ContentManifest, type IdentityState } from '../../src/identity.ts';
import { requiredSetProblems } from '../../src/cases.ts';
import type { CaseRecord, ClassificationChange, Disposition, EvidenceRecord, Mapping, RiskAcceptance, TestIdentity } from '../../src/model.ts';
import { normalize } from '../../src/normalize.ts';
import { checkRegression, type ApprovedSet } from '../../src/regression.ts';
import { readRun, runStatus } from '../../src/run-observation.ts';
import { decide, type Verdict } from '../../src/verdict.ts';
import { effectiveClassification } from '../../src/dispositions.ts';
import { verifyWork, type Journal, type ScopeEvent, type WorkFile } from '../../src/work.ts';
import { ENVIRONMENT, CONFIGS, DEV, Ledger, QA, ROLES, TEST_A, acceptance, burnIn, caseRecord, caseSteps, digests, effective, project, redCheck, tmp, writeEvidenceLedgers } from './support.ts';

const TEST_B: TestIdentity = { suite: 'e2e', file: 'tests/addendum.spec.ts', titlePath: ['addendum'] };
const GOV: TestIdentity = { suite: 'e2e', file: 'tests/governed.spec.ts', titlePath: ['governed'] };
const LEGACY: TestIdentity = { suite: 'e2e', file: 'scratch/old.spec.ts', titlePath: ['old'] };
const NOW = new Date('2026-10-09T12:00:00Z');

const ev = (id: string, kind: ScopeEvent['kind'], c?: string): ScopeEvent => ({
  id,
  kind,
  ticket: 'WORK-1',
  ...(c === undefined ? {} : { case: c }),
  by: DEV,
  role: 'developer',
  standIn: false,
  reason: 'r',
  at: `2026-10-09T0${id.length}:00:00Z`,
});

const manifest = (digest: string, files: ContentManifest['files'] = []): ContentManifest => ({ root: '/app', commit: 'abc', files, missingAssetDirs: [], takenAt: NOW.toISOString(), digest });

type Options = {
  /** Status of the regression test, the addendum test, the governed test and the legacy test. */
  reg?: 'passed' | 'failed' | 'flaky' | 'skipped' | 'expected-failure' | 'not-run';
  add?: 'passed' | 'failed';
  gov?: 'passed' | 'failed' | 'flaky';
  legacy?: 'passed' | 'failed';
  error?: string;
  finalStatus?: string;
  complete?: boolean;
  secondInvocation?: 'governed-passes' | 'missing';
  evidence?: (records: EvidenceRecord[]) => EvidenceRecord[];
  dispositions?: Disposition[];
  identity?: Partial<IdentityState>;
  regressionIds?: string[];
  addendumLog?: ScopeEvent[];
  journal?: Journal | null;
  workless?: boolean;
  regressionCases?: (r: CaseRecord) => CaseRecord;
  configurationDependent?: boolean;
  fixture?: { status: number | null; title: string | null };
  probe?: HealthProbe | null;
  failureMessage?: string;
  regressionBase?: ApprovedSet;
  /** The mapped regression test also ran under a mobile project, where its viewport guard skipped it. */
  mobileSkip?: boolean;
};

function build(o: Options = {}): Verdict {
  const dir = tmp('test-lab-verdict-');
  const recipes = join(dir, 'recipes');
  let reg = caseRecord('REG-1', 'regression');
  if (o.configurationDependent === true) reg = { ...reg, configurationDependent: true };
  reg = o.regressionCases?.(reg) ?? reg;
  const add = caseRecord('ADD-1', 'addendum');
  const cases = new Map([[reg.id, reg], [add.id, add]]);

  // The run: one invocation holding the regression, addendum, governed and legacy tests.
  const l = new Ledger();
  const regStatus = o.reg ?? 'passed';
  const msg = o.failureMessage ?? 'expect(locator).toHaveCSS(expected) failed';
  l.test('r', { file: TEST_A.file, titlePath: TEST_A.titlePath, cases: ['REG-1'], ...(regStatus === 'expected-failure' ? { expectedStatus: 'failed' } : {}) });
  if (regStatus === 'flaky') {
    l.result('r', { status: 'failed', steps: caseSteps('REG-1', 'desktop@1440', { O1: 'failed', O2: 'passed' }), error: msg });
    l.result('r', { status: 'passed', retry: 1, steps: caseSteps('REG-1', 'desktop@1440', { O1: 'passed', O2: 'passed' }) });
  } else if (regStatus === 'skipped') l.result('r', { status: 'skipped', expectedStatus: 'skipped' });
  else if (regStatus === 'expected-failure') l.result('r', { status: 'failed', expectedStatus: 'failed', steps: caseSteps('REG-1', 'desktop@1440', { O1: 'failed', O2: 'passed' }), error: msg });
  else if (regStatus !== 'not-run')
    l.result('r', { status: regStatus, steps: caseSteps('REG-1', 'desktop@1440', regStatus === 'failed' ? { O1: 'failed', O2: 'passed' } : { O1: 'passed', O2: 'passed' }), ...(regStatus === 'failed' ? { error: msg } : {}) });
  if (o.mobileSkip === true) {
    l.projects.push(project('mobile', { use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:4180', headless: true, viewport: { width: 390, height: 844 } } }));
    l.test('rm', { file: TEST_A.file, titlePath: TEST_A.titlePath, cases: ['REG-1'], project: 'mobile' });
    l.result('rm', { status: 'skipped', expectedStatus: 'skipped' });
  }
  l.test('a', { file: TEST_B.file, titlePath: TEST_B.titlePath, cases: ['ADD-1'] });
  l.result('a', { status: o.add ?? 'passed', steps: caseSteps('ADD-1', 'desktop@1440', o.add === 'failed' ? { O1: 'failed', O2: 'passed' } : { O1: 'passed', O2: 'passed' }), ...(o.add === 'failed' ? { error: msg } : {}) });
  l.test('g', { file: GOV.file, titlePath: GOV.titlePath });
  if (o.gov === 'flaky') l.result('g', { status: 'failed', error: msg }).result('g', { status: 'passed', retry: 1 });
  else l.result('g', { status: o.gov ?? 'passed', ...(o.gov === 'failed' ? { error: msg } : {}) });
  l.test('l', { file: LEGACY.file, titlePath: LEGACY.titlePath });
  l.result('l', { status: o.legacy ?? 'passed', ...(o.legacy === 'failed' ? { error: 'locator.click: Timeout 5000ms exceeded' } : {}) });
  if (o.error !== undefined) l.error(o.error);
  l.write(join(dir, 'inv0'), { ...(o.finalStatus === undefined ? {} : { finalStatus: o.finalStatus }), ...(o.complete === undefined ? {} : { complete: o.complete }) });
  const plans = [{ id: 'inv0', suite: 'e2e', dir: join(dir, 'inv0') }];
  if (o.secondInvocation !== undefined) {
    plans.push({ id: 'inv1', suite: 'e2e', dir: join(dir, 'inv1') });
    if (o.secondInvocation === 'governed-passes') new Ledger().test('g', { file: GOV.file, titlePath: GOV.titlePath }).result('g', { status: 'passed' }).write(join(dir, 'inv1'));
  }
  const run = readRun(plans);

  // Scope.
  const log = o.addendumLog ?? [ev('s', 'start'), ev('ss', 'add', 'ADD-1')];
  const file: WorkFile = { schema: 1, ticket: 'WORK-1', branch: 'feature/x', addendum: log.filter((e) => e.kind === 'add').map((e) => e.case as string).filter((c) => !log.some((d) => d.kind === 'drop' && d.case === c)), log };
  const journal: Journal | null = o.journal === undefined ? { ticket: 'WORK-1', repoKey: 'k', seededAt: null, entries: log.map((event) => ({ origin: 'local' as const, event })) } : o.journal;
  const work = verifyWork(journal, file);
  const regressionIds = o.regressionIds ?? ['REG-1'];
  const declared: ApprovedSet = new Map(regressionIds.flatMap((id) => (cases.get(id)?.approval ? [[id, cases.get(id)?.approval?.hash as string]] : [])));
  const regression = checkRegression({ ref: 'refs/remotes/origin/main', commit: 'base', fetchedAt: NOW, now: NOW, maxAgeHours: 24, base: o.regressionBase ?? declared, baseRoles: ROLES, transitions: [], declared });
  const addendum = o.workless === true ? [] : work.addendum;

  // Classification: scratch/ is legacy.
  const change: ClassificationChange = { id: 'c1', target: { suite: 'e2e', glob: 'scratch/**' }, from: null, to: 'legacy', by: QA, role: 'qa', standIn: true, at: '2026-10-01', reason: 'old' };
  const { rules } = effectiveClassification([change], ROLES);
  const dispositions = o.dispositions ?? [];
  const ledgerRows: Mapping[] = ['REG-1', 'ADD-1'].flatMap((c) => ['O1', 'O2'].map((ob) => ({ obligation: { case: c, step: 'S1', obligation: ob }, test: c === 'REG-1' ? TEST_A : TEST_B, configuration: 'desktop@1440', layer: 'served' as const })));
  const requiredTests = new Set([TEST_A, TEST_B].map((t) => t.file));
  const q = quarantines(dispositions, ROLES, NOW, 8, (t) => requiredTests.has(t.file));
  const normalized = normalize({
    run,
    configurations: CONFIGS,
    cases,
    required: { regression: regressionIds, addendum },
    ledger: ledgerRows,
    classification: rules,
    liveQuarantines: q.live,
    quarantinesOnRequired: q.onRequired,
    roleOverrideFiles: new Set(),
  });

  // Evidence for both required cases.
  let records: EvidenceRecord[] = [];
  for (const [record, t] of [[reg, TEST_A], [add, TEST_B]] as const) {
    for (const ob of ['O1', 'O2']) {
      const paths = writeEvidenceLedgers(join(dir, 'evidence'), record.id, t, 'desktop@1440', { failIn: ob });
      records.push(redCheck(join(dir, 'evidence'), recipes, { case: record.id, step: 'S1', obligation: ob }, t, 'desktop@1440', paths));
      if (ob === 'O1') records.push(burnIn(join(dir, 'evidence'), t, 'desktop@1440', paths.burn));
    }
    records.push(acceptance(record, t));
  }
  records = o.evidence?.(records) ?? records;
  const ctx = { evidenceDir: join(dir, 'evidence'), recipesDir: recipes, records, digests: digests([TEST_A, TEST_B]), environment: ENVIRONMENT, effective: effective(), configurations: CONFIGS, ledger: ledgerRows, dispositions, roles: ROLES, materialFields: ['browserName', 'browserVersion', 'channel', 'headless', 'retries'] as const };
  const evidence = [...regressionIds.map((id) => [id, 'regression'] as const), ...addendum.map((id) => [id, 'addendum'] as const)]
    .filter(([id]) => cases.has(id))
    .map(([id, track]) => evaluateCase(cases.get(id) as CaseRecord, track, { ...ctx, materialFields: [...ctx.materialFields] }));

  const identity = evaluateIdentity({
    environment: { id: 'local', kind: 'local-candidate', baseUrl: 'http://127.0.0.1:4180', baseUrlEnv: 'BASE_URL' },
    appRoot: '/app',
    before: manifest('m1'),
    after: manifest('m1'),
    ddevDescribe: JSON.stringify({ raw: { approot: '/app', status: 'running' } }),
    drushConfigStatus: '',
    knownConfigOverrides: [],
    effectiveBaseUrls: ['http://127.0.0.1:4180'],
    database: { source: null, pulledAt: null },
    buildProbe: null,
    ...o.identity,
  });
  const fixtures = o.fixture === undefined ? [] : [judgeFixture({ id: 'accordion-page', environments: ['local'], path: '/accordion', title: 'Accordion example', structure: 'two items' }, { via: 'http', status: o.fixture.status, title: o.fixture.title, error: o.fixture.status === null ? 'ECONNREFUSED' : null })];
  const risks = riskAcceptances(dispositions, ROLES, NOW);
  return decide({
    profileProblems: requiredSetProblems({ regression: regressionIds, addendum }, cases, ROLES),
    regression,
    work: { resolution: o.workless === true ? { status: 'none', via: 'flag' } : { status: 'bound', ticket: 'WORK-1', via: 'git-config' }, check: o.workless === true ? null : work },
    identity,
    configurationDependent: [...cases.values()].filter((c) => c.configurationDependent).map((c) => c.id),
    runStatus: runStatus(run),
    fixtures,
    requiredFixtures: ['accordion-page'],
    breaker: outageBreaker(normalized.tests, o.probe === undefined ? { url: 'http://127.0.0.1:4180/health', reachable: true, ok: true, status: 200, error: null } : o.probe),
    normalized,
    riskAcceptances: risks.live,
    evidence,
  });
}

const signatureOf = (v: Verdict, file: string) => v.failures.find((f) => f.test.file === file)?.signature ?? '';
const risk = (signature: string, extra: Partial<RiskAcceptance> = {}): RiskAcceptance => ({
  kind: 'risk-acceptance', id: 'risk-1', test: GOV, project: 'desktop', signature, owner: QA, expires: '2099-01-01', by: QA, role: 'qa', standIn: true, at: '2026-10-09', reason: 'known product bug, fix next sprint', ...extra,
});

describe('rule 8: ready', () => {
  test('the baseline world is ready, and names its exceptions', () => {
    const v = build();
    assert.equal(v.verdict, 'ready', v.reasons.join('\n'));
    assert.equal(v.rule, 8);
    assert.ok(v.exceptions.some((e) => /identity database: declared/.test(e)));
  });

  test('an empty addendum is named on a ready page', () => {
    const v = build({ addendumLog: [ev('s', 'start')] });
    assert.equal(v.verdict, 'ready', v.reasons.join('\n'));
    assert.ok(v.exceptions.includes('the addendum is empty'));
  });

  test('legacy-lane timeouts while every required case passes are ready, and reported', () => {
    const v = build({ legacy: 'failed' });
    assert.equal(v.verdict, 'ready', v.reasons.join('\n'));
    assert.ok(v.exceptions.some((e) => /^legacy .*old\.spec\.ts.*failed/.test(e)));
    assert.ok(v.failures.some((f) => f.lane === 'legacy'));
  });
});

describe('rule 1: not evaluable', () => {
  test('an empty regression set', () => assert.equal(build({ regressionIds: [] }).rule, 1));

  test('an addendum alone, with an empty regression set', () => {
    const v = build({ regressionIds: [] });
    assert.equal(v.verdict, 'not-evaluable');
    assert.match(v.reasons.join(' '), /addendum alone/);
  });

  test('a required case edited after its approval', () => {
    const v = build({ regressionCases: (r) => ({ ...r, preconditions: 'changed after approval' }) });
    assert.equal(v.rule, 1);
    assert.match(v.reasons.join(' '), /edited since its approval/);
  });

  test('a regression case approved by a developer', () => {
    const v = build({ regressionCases: (r) => ({ ...r, approval: { ...(r.approval as NonNullable<CaseRecord['approval']>), by: DEV, role: 'developer', standIn: false } }) });
    assert.equal(v.rule, 1);
  });

  test('a stale local base missing a case QA added upstream', () => {
    const upstream: ApprovedSet = new Map([['REG-1', caseRecord('REG-1', 'regression').approval?.hash as string], ['REG-2', 'sha256:new']]);
    const v = build({ regressionBase: upstream });
    assert.equal(v.rule, 1);
    assert.match(v.reasons.join(' '), /REG-2/);
  });

  test('a run with no bound work, --work or --no-work is not evaluable, never an empty addendum', () => {
    const v = decideWith({ status: 'unresolved', reason: 'branch feature/x is bound to no work: bind it, or run with --work or --no-work', suggestion: 'WORK-1' });
    assert.equal(v.rule, 1);
    assert.match(v.reasons.join(' '), /did you mean WORK-1/);
  });

  test('a rebase that dropped an add-and-drop pair is not evaluable, and stays so on every later run', () => {
    const full = [ev('s', 'start'), ev('ss', 'add', 'ADD-1'), ev('sss', 'add', 'ADD-2'), ev('ssss', 'drop', 'ADD-2')];
    const journal: Journal = { ticket: 'WORK-1', repoKey: 'k', seededAt: null, entries: full.map((event) => ({ origin: 'local', event })) };
    const truncated = full.slice(0, 2);
    for (let i = 0; i < 3; i++) {
      const v = build({ addendumLog: truncated, journal });
      assert.equal(v.rule, 1);
      assert.match(v.reasons.join(' '), /missing-event/);
    }
  });

  test('a fresh clone with no journal is not evaluable until imported', () => {
    assert.equal(build({ journal: null }).rule, 1);
  });
});

function decideWith(resolution: Parameters<typeof decide>[0]['work']['resolution']): Verdict {
  const base = build();
  return decide({
    profileProblems: [],
    regression: { ok: true, set: ['REG-1'], base: { ref: 'r', commit: 'c', fetchedAt: null }, problems: [] },
    work: { resolution, check: null },
    identity: { checks: [], unknown: [], changed: [], configDrift: [], notEvaluable: [] },
    configurationDependent: [],
    runStatus: { complete: true, problems: [] },
    fixtures: [],
    requiredFixtures: [],
    breaker: { tripped: false, reason: '', blocking: 0, failures: 0, connectionFailures: 0, probe: null },
    normalized: { tests: [], required: base.required, problems: [] },
    riskAcceptances: [],
    evidence: [],
  });
}

describe('rule 2: build identity', () => {
  test('a file edited during the run', () => {
    const v = build({ identity: { after: manifest('m2', [{ path: 'web/themes/x.css', state: 'changed', hash: 'h2' }]) } });
    assert.equal(v.verdict, 'inconclusive');
    assert.equal(v.rule, 2);
  });

  test('a shell variable pointing at the wrong host: the run resolved another base URL', () => {
    const v = build({ identity: { effectiveBaseUrls: ['http://wrong.example'] } });
    assert.equal(v.rule, 2);
    assert.match(v.reasons.join(' '), /wrong\.example/);
  });

  test('the site serves another checkout', () => {
    const v = build({ identity: { ddevDescribe: JSON.stringify({ raw: { approot: '/somewhere/else' } }) } });
    assert.equal(v.rule, 2);
  });

  test('configuration drift gates a configuration-dependent required case only', () => {
    assert.equal(build({ configurationDependent: true, identity: { drushConfigStatus: JSON.stringify([{ name: 'system.site', state: 'Different' }]) } }).rule, 2);
    const v = build({ identity: { drushConfigStatus: JSON.stringify([{ name: 'system.site', state: 'Different' }]) } });
    assert.equal(v.verdict, 'ready', v.reasons.join('\n'));
    assert.ok(v.exceptions.some((e) => /configuration drift/.test(e)));
  });
});

describe('rule 3: the run did not complete cleanly', () => {
  test('every test passing while global teardown throws', () => {
    const v = build({ error: 'Error: EXAMPLE_GLOBAL_TEARDOWN_ERROR' });
    assert.equal(v.rule, 3);
    assert.match(v.reasons.join(' '), /EXAMPLE_GLOBAL_TEARDOWN_ERROR/);
  });

  test('an interrupted run with earlier passes', () => assert.equal(build({ complete: false }).rule, 3));

  test('an interrupted run with an earlier failure still lists the failure', () => {
    const v = build({ complete: false, gov: 'failed' });
    assert.equal(v.rule, 3);
    assert.ok(v.failures.some((f) => f.test.file === GOV.file));
  });

  test('an interrupted run that still wrote its report', () => assert.equal(build({ finalStatus: 'interrupted' }).rule, 3));

  test('a planned second invocation that never reported', () => assert.equal(build({ secondInvocation: 'missing' }).rule, 3));

  test('a missing required fixture page is inconclusive, naming it', () => {
    const v = build({ fixture: { status: 404, title: null } });
    assert.equal(v.rule, 3);
    assert.match(v.reasons.join(' '), /accordion-page/);
  });

  test('a fixture page answering 500 is not "missing": the tests decide', () => {
    const v = build({ fixture: { status: 500, title: 'Error' }, reg: 'failed', failureMessage: 'locator.toHaveCSS: Timeout 5000ms exceeded' });
    assert.equal(v.rule, 5);
    assert.equal(v.failures.find((f) => f.test.file === TEST_A.file)?.classPrefill, 'application error');
  });
});

describe('rule 4: the outage breaker', () => {
  const refused = 'page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4180/';
  test('every blocking test refused and the health page unreachable', () => {
    const v = build({ reg: 'failed', add: 'failed', gov: 'failed', failureMessage: refused, probe: { url: 'h', reachable: false, ok: false, status: null, error: 'ECONNREFUSED' } });
    assert.equal(v.rule, 4);
  });

  test('a health page answering 500 shows the host is up: not an outage', () => {
    const v = build({ reg: 'failed', add: 'failed', gov: 'failed', failureMessage: refused, probe: { url: 'h', reachable: true, ok: false, status: 500, error: null } });
    assert.equal(v.verdict, 'not-ready');
  });

  test('locator timeouts on a page that loaded are not an outage', () => {
    const v = build({ reg: 'failed', add: 'failed', gov: 'failed', failureMessage: 'locator.click: Timeout 5000ms exceeded', probe: { url: 'h', reachable: false, ok: false, status: null, error: 'x' } });
    assert.equal(v.verdict, 'not-ready');
  });
});

describe('rule 5: required cases', () => {
  for (const status of ['failed', 'flaky', 'skipped', 'expected-failure', 'not-run'] as const) {
    test(`a required case that is ${status} is not ready`, () => {
      const v = build({ reg: status });
      assert.equal(v.verdict, 'not-ready');
      assert.equal(v.rule, 5);
    });
  }

  test('an addendum case failing while every regression case passes', () => assert.equal(build({ add: 'failed' }).rule, 5));

  test('a required case that is quarantined and passes is still not ready', () => {
    const q: Disposition = { kind: 'quarantine', id: 'q', test: TEST_A, owner: QA, ticket: 'T-9', expires: '2099-01-01', by: QA, role: 'qa', standIn: true, at: '2026-10-09', reason: 'flaky' };
    const v = build({ dispositions: [q] });
    assert.equal(v.rule, 5);
    assert.match(v.reasons.join(' '), /quarantine on a required case never takes effect/);
  });

  test('a required case failing outranks missing evidence', () => assert.equal(build({ reg: 'failed', evidence: () => [] }).rule, 5));
});

describe('rule 6: governed tests and risk acceptance', () => {
  test('a failing governed test triaged "product bug" but not accepted', () => assert.equal(build({ gov: 'failed' }).rule, 6));

  test('the same failure with a live QA risk acceptance is ready, listing the acceptance', () => {
    const signature = signatureOf(build({ gov: 'failed' }), GOV.file);
    const v = build({ gov: 'failed', dispositions: [risk(signature)] });
    assert.equal(v.verdict, 'ready', v.reasons.join('\n'));
    assert.ok(v.exceptions.some((e) => /risk acceptance risk-1/.test(e)));
  });

  test('a risk acceptance for another failure signature does not clear it', () => assert.equal(build({ gov: 'failed', dispositions: [risk('sha256:other')] }).rule, 6));

  test('an expired risk acceptance does not clear it', () => {
    const signature = signatureOf(build({ gov: 'failed' }), GOV.file);
    assert.equal(build({ gov: 'failed', dispositions: [risk(signature, { expires: '2020-01-01' })] }).rule, 6);
  });

  test('a risk acceptance recorded in the developer role is refused', () => {
    const signature = signatureOf(build({ gov: 'failed' }), GOV.file);
    assert.equal(build({ gov: 'failed', dispositions: [risk(signature, { by: DEV, role: 'developer', standIn: false })] }).rule, 6);
  });

  test('a flaky governed test blocks', () => assert.equal(build({ gov: 'flaky' }).rule, 6));

  test('a two-invocation run whose first invocation fails a governed test and whose second passes', () => {
    const v = build({ gov: 'failed', secondInvocation: 'governed-passes' });
    assert.equal(v.rule, 6);
  });

  test('a quarantined governed test does not block, and is listed', () => {
    const q: Disposition = { kind: 'quarantine', id: 'q', test: GOV, owner: QA, ticket: 'T-9', expires: '2099-01-01', by: QA, role: 'qa', standIn: true, at: '2026-10-09', reason: 'flaky' };
    const v = build({ gov: 'failed', dispositions: [q] });
    assert.equal(v.verdict, 'ready', v.reasons.join('\n'));
    assert.ok(v.exceptions.some((e) => /^quarantined/.test(e)));
  });

  test('a quarantine recorded in the developer role is refused', () => {
    const q: Disposition = { kind: 'quarantine', id: 'q', test: GOV, owner: DEV, ticket: 'T-9', expires: '2099-01-01', by: DEV, role: 'developer', standIn: false, at: '2026-10-09', reason: 'flaky' };
    assert.equal(build({ gov: 'failed', dispositions: [q] }).rule, 6);
  });
});

describe('rule 7: evidence', () => {
  test('a missing evidence file', () => {
    const v = build({ evidence: (records) => records.filter((r) => !(r.kind === 'burn-in' && r.test.file === TEST_A.file)) });
    assert.equal(v.rule, 7);
    assert.match(v.reasons.join(' '), /no burn-in/);
  });

  test('a waived red check is ready, listed as waived, never as verified', () => {
    const reg = caseRecord('REG-1', 'regression');
    const waivers: Disposition[] = ['O1', 'O2'].map((o) => ({ kind: 'sensitivity-waived', id: `w${o}`, case: 'REG-1', step: 'S1', obligation: o, caseHash: reg.approval?.hash as string, by: QA, role: 'qa', standIn: true, at: '2026-10-09', reason: 'no faithful mutation' }));
    const v = build({ dispositions: waivers, evidence: (records) => records.filter((r) => !(r.kind === 'red-check' && r.test.file === TEST_A.file)) });
    assert.equal(v.verdict, 'ready', v.reasons.join('\n'));
    assert.ok(v.exceptions.includes('case REG-1: sensitivity waived, not verified'));
  });

  test('a stale acceptance', () => {
    const v = build({ evidence: (records) => records.map((r) => (r.kind === 'acceptance' && r.case === 'REG-1' ? { ...r, behaviorDigest: 'sha256:before-the-helper-changed' } : r)) });
    assert.equal(v.rule, 7);
  });

  test('a regression acceptance written in the developer role', () => {
    const v = build({ evidence: (records) => records.map((r) => (r.kind === 'acceptance' && r.case === 'REG-1' ? { ...r, by: DEV, role: 'developer' as const, standIn: false } : r)) });
    assert.equal(v.rule, 7);
  });
});

describe('scope changes are listed', () => {
  test('a failing addendum case dropped, then more runs: the drop stays listed', () => {
    const log = [ev('s', 'start'), ev('ss', 'add', 'ADD-1'), ev('sss', 'add', 'ADD-2'), ev('ssss', 'drop', 'ADD-2')];
    for (let i = 0; i < 2; i++) {
      const v = build({ addendumLog: log });
      assert.equal(v.verdict, 'ready', v.reasons.join('\n'));
      assert.ok(v.scopeChanges.some((e) => e.kind === 'drop' && e.case === 'ADD-2'));
      assert.ok(v.scopeChanges.some((e) => e.kind === 'add' && e.case === 'ADD-2'));
    }
  });

  test('--no-work names the empty addendum', () => {
    const v = build({ workless: true });
    assert.equal(v.verdict, 'ready', v.reasons.join('\n'));
    assert.ok(v.exceptions.some((e) => /--no-work/.test(e)));
  });
});

// Review R1 finding 3: approval cannot make an empty required matrix disappear.
test('R1-3 approved empty configuration matrix never reaches Ready', () => {
  const v = build({ regressionCases: () => caseRecord('REG-1', 'regression', { configurations: [] }) });
  assert.equal(v.verdict, 'not-evaluable');
  assert.equal(v.rule, 1);
  assert.match(v.reasons.join(' '), /configuration/);
  assert.ok(v.required.some((r) => r.case === 'REG-1'), 'the declared required case stays in the denominator');
});

// Phase 1: where QA's automation standard and the verdict disagree (scope item 2). Each is settled by a
// checker rule (rules.json, TL-*) and by the verdict counterexamples below.
describe('phase 1: QA standard settlements', () => {
  test('TL-RETRIES-ZERO: a pass on retry is never a pass, whatever the suite config allows', () => {
    const v = build({ reg: 'flaky' });
    assert.equal(v.verdict, 'not-ready');
    assert.equal(v.rule, 5);
    assert.ok(v.required.some((c) => c.case === 'REG-1' && c.outcome === 'flaky'));
  });

  test('TL-MOBILE-GUARD: a viewport-guard skip on a configuration the case declares is not a pass', () => {
    // REG-1 declares desktop@1440; a skip there (the guard firing on a declared configuration) is rule 5.
    const v = build({ reg: 'skipped' });
    assert.equal(v.rule, 5);
    assert.ok(v.required.some((c) => c.case === 'REG-1' && c.outcome === 'skipped'));
  });

  test('TL-MOBILE-GUARD: the same guard skipping under a project the case does not declare stays outside the verdict', () => {
    const v = build({ mobileSkip: true });
    assert.equal(v.verdict, 'ready', v.reasons.join('\n'));
    assert.ok(!v.required.some((c) => c.outcome === 'skipped'));
  });

  test('TL-KNOWN-FAILURE: a test.fail spec that fails as expected never counts toward ready', () => {
    const v = build({ reg: 'expected-failure' });
    assert.equal(v.verdict, 'not-ready');
    assert.equal(v.rule, 5);
    assert.ok(v.required.filter((c) => c.case === 'REG-1').every((c) => c.outcome !== 'passed'), JSON.stringify(v.required));
  });

  test('TL-UNDEFINED-PRIORITY: a case whose source priority was Undefined is tagged @p3 but can never be required', () => {
    const v = build({ regressionCases: (r) => ({ ...r, priority: 'p3', priorityDefaulted: true }) });
    assert.equal(v.verdict, 'not-evaluable');
    assert.equal(v.rule, 1);
    assert.match(v.reasons.join(' '), /Undefined source priority/);
  });
});
