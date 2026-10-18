// Builders for the unit tests: step ledgers shaped exactly as kit/reporter.ts writes them, case records,
// evidence receipts over real files, and a "ready" world the counterexamples change one fact at a time.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RECORD_SCHEMA,
  ANALYSIS_VERSION,
  type BeginRecord,
  type ErrorRecord,
  type LedgerRecord,
  type ProjectRecord,
  type ResultRecord,
  type StepAttachment,
  type StepRecord,
  type TestDeclaration,
} from '../../kit/records.ts';
import { sha256 } from '../../src/canonical.ts';
import { canonicalCaseHash } from '../../src/cases.ts';
import { behaviorKey } from '../../src/digest.ts';
import type { BehaviorDigest, DigestReport, EffectiveConfig } from '../../src/digest.ts';
import type {
  AcceptanceRecord,
  BurnInRecord,
  CaseRecord,
  Configuration,
  LedgerRef,
  ObligationRef,
  RedCheckRecord,
  Roles,
  TestIdentity,
  Track,
} from '../../src/model.ts';
import { playwrightOutcome } from '../../src/run-observation.ts';

export const tmp = (prefix = 'test-lab-'): string => mkdtempSync(join(tmpdir(), prefix));

export const ENVIRONMENT = { id: 'local', kind: 'local-candidate' as const, baseUrl: 'http://127.0.0.1:4180' };
export const QA = 'Quinn QA';
export const DEV = 'Dana Dev';
export const ROLES: Roles = { qa: [{ name: QA, standIn: true }] };
export const BROWSER = { name: 'chromium', version: '145.0.0.0' };

export const CONFIGS: Configuration[] = [
  { id: 'desktop@1440', project: 'desktop', viewport: { width: 1440, height: 900 }, role: 'anonymous' },
  { id: 'desktop@900', project: 'desktop', viewport: { width: 900, height: 900 }, role: 'anonymous' },
  { id: 'editor@1440', project: 'desktop', viewport: { width: 1440, height: 900 }, role: 'editor' },
];

export function caseRecord(id: string, track: Track, options: { configurations?: string[]; obligations?: string[]; approvedBy?: string; role?: 'qa' | 'developer' } = {}): CaseRecord {
  const record: CaseRecord = {
    id,
    aliases: [],
    track,
    title: `${id} title`,
    preconditions: 'The fixture page is published.',
    steps: [{ id: 'S1', text: 'Open the page.', obligations: (options.obligations ?? ['O1', 'O2']).map((o) => ({ id: o, text: `${o} holds`, layer: 'served' as const })) }],
    priority: 'p1',
    configurations: options.configurations ?? ['desktop@1440'],
    refs: ['TICKET-1'],
    fixture: null,
    configurationDependent: false,
    provenance: { draftedFrom: 'ticket', independentRefs: ['TICKET-1'], selfDerivedAcceptedBy: null },
    approval: null,
  };
  const role = options.role ?? (track === 'regression' ? 'qa' : 'developer');
  const by = options.approvedBy ?? (role === 'qa' ? QA : DEV);
  record.approval = { by, role, standIn: role === 'qa', on: '2026-10-09', hash: canonicalCaseHash(record) };
  return record;
}

export const viewportOf = (configId: string) => CONFIGS.find((c) => c.id === configId)?.viewport ?? null;

export function ids(caseId: string, step: string, obligation: string | null, configId = 'desktop@1440', browser = BROWSER): StepAttachment {
  const config = CONFIGS.find((c) => c.id === configId);
  return {
    schema: RECORD_SCHEMA,
    kit: '0.2.0',
    case: caseId,
    step,
    obligation,
    project: config?.project ?? 'desktop',
    viewport: config?.viewport ?? null,
    role: { name: config?.role ?? 'anonymous', source: config?.role === 'anonymous' ? 'none' : 'project-storage-state' },
    browser,
  };
}

/** The steps caseStep writes for one case step holding the named obligations: parent at depth 0, one child each. */
export function caseSteps(caseId: string, configId: string, obligations: Record<string, 'passed' | 'failed' | 'skipped'>, browser = BROWSER): StepRecord[] {
  const entries = Object.entries(obligations);
  const failed = entries.find(([, s]) => s === 'failed');
  const error: ErrorRecord | null = failed === undefined ? null : { message: `expect(locator).toHaveCSS(expected) failed in ${failed[0]}` };
  const out: StepRecord[] = [{ path: [1], title: 'Open the page', depth: 0, status: failed === undefined ? 'passed' : 'failed', error, ids: ids(caseId, 'S1', null, configId, browser) }];
  entries.forEach(([o, status], i) =>
    out.push({ path: [1, i], title: `obligation ${o}`, depth: 1, status, error: status === 'failed' ? error : null, ids: ids(caseId, 'S1', o, configId, browser) }),
  );
  return out;
}

export function project(name: string, extra: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    name,
    testDir: '/suite/tests',
    outputDir: '/suite/test-results',
    snapshotDir: '/suite/tests',
    dependencies: [],
    teardown: null,
    retries: 0,
    repeatEach: 1,
    timeout: 15000,
    testMatch: ['**/*.@(spec|test).?(c|m)[jt]s?(x)'],
    testIgnore: [],
    use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:4180', headless: true },
    ...extra,
  };
}

type TestSpec = { file: string; titlePath: string[]; project?: string; cases?: string[]; expectedStatus?: string };

/** Builds one invocation's step ledger, record by record, as the reporter writes it. */
export class Ledger {
  private readonly declarations: TestDeclaration[] = [];
  private readonly body: LedgerRecord[] = [];
  private readonly results = new Map<string, ResultRecord[]>();
  projects: ProjectRecord[] = [project('desktop')];
  baseURL = 'http://127.0.0.1:4180';

  test(id: string, spec: TestSpec): this {
    this.declarations.push({
      testId: id,
      file: spec.file,
      line: 1,
      titlePath: spec.titlePath,
      project: spec.project ?? 'desktop',
      expectedStatus: spec.expectedStatus ?? 'passed',
      optionSafety: {version:ANALYSIS_VERSION,problems:[]},
      annotations: (spec.cases ?? []).map((c) => ({ type: 'case', description: c })),
      tags: [],
    });
    return this;
  }

  result(testId: string, r: { status: string; expectedStatus?: string; retry?: number; steps?: StepRecord[]; error?: string }): this {
    const record: ResultRecord = {
      type: 'result',
      testId,
      retry: r.retry ?? 0,
      status: r.status,
      expectedStatus: r.expectedStatus ?? this.declarations.find((d) => d.testId === testId)?.expectedStatus ?? 'passed',
      duration: 10,
      errors: r.error === undefined ? [] : [{ message: r.error }],
      annotations: [],
      steps: r.steps ?? [],
    };
    this.body.push(record);
    this.results.set(testId, [...(this.results.get(testId) ?? []), record]);
    return this;
  }

  error(message: string): this {
    this.body.push({ type: 'error', error: { message } });
    return this;
  }

  begin(): BeginRecord {
    return {
      type: 'begin',
      schema: RECORD_SCHEMA,
      kit: '0.2.0',
      playwright: '1.58.2',
      environment: { ...ENVIRONMENT, baseUrl: this.baseURL },
      startedAt: '2026-10-09T10:00:00.000Z',
      rootDir: '/suite',
      configFile: '/suite/playwright.config.ts',
      workers: 1,
      globalTimeout: 0,
      maxFailures: 0,
      fullyParallel: false,
      reporters: ['support/test-lab/reporter.ts', 'json', 'html'],
      globalSetup: [],
      globalTeardown: [],
      projects: this.projects.map((p) => ({ ...p, use: { ...p.use, baseURL: this.baseURL } })),
      tests: this.declarations,
    };
  }

  /** The records in file order; `complete: false` leaves out the per-test outcomes and the completion record. */
  records(options: { finalStatus?: string; complete?: boolean } = {}): LedgerRecord[] {
    const out: LedgerRecord[] = [this.begin(), ...this.body];
    if (options.complete === false) return out;
    for (const d of this.declarations) {
      const results = this.results.get(d.testId) ?? [];
      const expected = results.at(-1)?.expectedStatus ?? d.expectedStatus;
      out.push({ type: 'test', testId: d.testId, outcome: playwrightOutcome(results, expected), expectedStatus: expected, results: results.length });
    }
    const failed = this.declarations.some((d) => {
      const results = this.results.get(d.testId) ?? [];
      const o = playwrightOutcome(results, results.at(-1)?.expectedStatus ?? d.expectedStatus);
      return o === 'unexpected';
    });
    out.push({
      type: 'completion',
      finalStatus: options.finalStatus ?? (failed || this.body.some((r) => r.type === 'error') ? 'failed' : 'passed'),
      at: '2026-10-09T10:01:00.000Z',
      results: this.body.filter((r) => r.type === 'result').length,
      errors: this.body.filter((r) => r.type === 'error').length,
    });
    return out;
  }

  /** Writes the ledger as `<dir>/steps.jsonl` (or `file`) and returns its path. */
  write(dir: string, options: { finalStatus?: string; complete?: boolean; file?: string } = {}): string {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, options.file ?? 'steps.jsonl');
    writeFileSync(path, this.records(options).map((r) => JSON.stringify(r)).join('\n') + '\n');
    return path;
  }
}

// --- Evidence over real files ---

export function ledgerRef(evidenceDir: string, path: string): LedgerRef {
  return { path, sha256: sha256(readFileSync(join(evidenceDir, path))) };
}

export function writeRecipe(recipesDir: string, ob: ObligationRef): string {
  mkdirSync(recipesDir, { recursive: true });
  const text = JSON.stringify({ format: 1, obligation: ob, hypothesis: `${ob.obligation} regresses`, technique: 'addStyleTag', css: '.x{font-family:serif}' });
  const hash = sha256(text);
  writeFileSync(join(recipesDir, `${hash}.json`), text);
  return `sha256:${hash}`;
}

export const TEST_A: TestIdentity = { suite: 'e2e', file: 'tests/accordion.spec.ts', titlePath: ['accordion', 'title and rows'] };

/** A mutated run failing inside `failIn`, a restored run passing, and a five-repeat burn-in, all on `configId`. */
export function writeEvidenceLedgers(
  evidenceDir: string,
  caseId: string,
  test: TestIdentity,
  configId: string,
  options: { failIn?: string; obligations?: string[]; browser?: { name: string; version: string }; repeats?: number; setupFails?: boolean; tag?: string } = {},
): { mutated: string; restored: string; burn: string } {
  const obligations = options.obligations ?? ['O1', 'O2'];
  const browser = options.browser ?? BROWSER;
  const tag = options.tag ?? `${caseId}-${configId}-${options.failIn ?? 'O1'}`;
  const all = (status: 'passed' | 'failed' | 'skipped', fail?: string) => Object.fromEntries(obligations.map((o) => [o, o === fail ? 'failed' : status])) as Record<string, 'passed' | 'failed'>;
  const mutated = new Ledger();
  if (options.setupFails === true) {
    mutated.projects = [project('setup'), project('desktop', { dependencies: ['setup'] })];
    mutated.test('setup', { file: 'tests/auth.setup.ts', titlePath: ['log in'], project: 'setup' }).result('setup', { status: 'failed', error: 'login failed' });
  }
  mutated.test('t', { file: test.file, titlePath: test.titlePath, cases: [caseId] }).result('t', { status: 'failed', steps: caseSteps(caseId, configId, all('passed', options.failIn ?? 'O1'), browser), error: 'expect failed' });
  const restored = new Ledger();
  restored.test('t', { file: test.file, titlePath: test.titlePath, cases: [caseId] }).result('t', { status: 'passed', steps: caseSteps(caseId, configId, all('passed'), browser) });
  const burn = new Ledger();
  burn.projects = [project('desktop', { repeatEach: 5 })];
  for (let i = 0; i < (options.repeats ?? 5); i++)
    burn.test(`t${i}`, { file: test.file, titlePath: test.titlePath, cases: [caseId] }).result(`t${i}`, { status: 'passed', steps: caseSteps(caseId, configId, all('passed'), browser) });
  const dir = join(evidenceDir, 'ledgers');
  mutated.write(dir, { file: `${tag}-mutated.jsonl` });
  restored.write(dir, { file: `${tag}-restored.jsonl` });
  burn.write(dir, { file: `${tag}-burn.jsonl` });
  return { mutated: `ledgers/${tag}-mutated.jsonl`, restored: `ledgers/${tag}-restored.jsonl`, burn: `ledgers/${tag}-burn.jsonl` };
}

export function redCheck(evidenceDir: string, recipesDir: string, ob: ObligationRef, test: TestIdentity, configId: string, paths: { mutated: string; restored: string }, extra: Partial<RedCheckRecord> = {}): RedCheckRecord {
  return {
    kind: 'red-check',
    environment: ENVIRONMENT,
    id: `red-${ob.case}-${ob.obligation}-${configId}`,
    obligation: ob,
    test,
    configuration: configId,
    recipeHash: writeRecipe(recipesDir, ob),
    behaviorDigest: 'sha256:behavior',
    toolchainDigest: 'sha256:toolchain',
    mutated: ledgerRef(evidenceDir, paths.mutated),
    restored: ledgerRef(evidenceDir, paths.restored),
    appliesTo: [],
    at: '2026-10-09T10:00:00Z',
    ...extra,
  };
}

export function burnIn(evidenceDir: string, test: TestIdentity, configId: string, path: string, extra: Partial<BurnInRecord> = {}): BurnInRecord {
  return {
    kind: 'burn-in',
    environment: ENVIRONMENT,
    id: `burn-${configId}-${path}`,
    test,
    configuration: configId,
    behaviorDigest: 'sha256:behavior',
    toolchainDigest: 'sha256:toolchain',
    run: ledgerRef(evidenceDir, path),
    appliesTo: [],
    at: '2026-10-09T10:00:00Z',
    ...extra,
  };
}

export function acceptance(record: CaseRecord, test: TestIdentity, extra: Partial<AcceptanceRecord> = {}): AcceptanceRecord {
  const qa = record.track === 'regression';
  return {
    kind: 'acceptance',
    id: `acc-${record.id}`,
    test,
    case: record.id,
    caseHash: canonicalCaseHash(record),
    behaviorDigest: 'sha256:behavior',
    by: qa ? QA : DEV,
    role: qa ? 'qa' : 'developer',
    standIn: qa,
    at: '2026-10-09T10:00:00Z',
    ...extra,
  };
}

/** Digests as computed elsewhere: every listed test resolved to `sha256:behavior` on project desktop. */
export function digests(tests: TestIdentity[], options: { toolchain?: string; behavior?: string; roleOverrideFiles?: string[] } = {}): DigestReport {
  const behavior = new Map<string, BehaviorDigest>();
  for (const t of tests)
    behavior.set(behaviorKey(t, 'desktop'), { status: 'resolved', test: t, project: 'desktop', digest: options.behavior ?? 'sha256:behavior', inputs: [] });
  return {
    behavior,
    toolchain: { status: 'resolved', digest: options.toolchain ?? 'sha256:toolchain', inputs: [] },
    manifest: { inputs: [], excluded: [] },
    roleOverrideFiles: new Set(options.roleOverrideFiles ?? []),
  };
}

export function effective(browser = BROWSER, extra: Partial<EffectiveConfig['projects'][number]> = {}): EffectiveConfig {
  return {
    playwright: '1.58.2',
    workers: 1,
    projects: [{ name: 'desktop', browserName: browser.name, browserVersion: browser.version, channel: null, headless: true, retries: 0, baseURL: 'http://127.0.0.1:4180', ...extra }],
  };
}
