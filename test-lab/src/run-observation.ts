// Reads the step reporter's files back, one per planned invocation, and says how the run as a whole
// ended (plan §2 "run status", rule 3). Every record is validated; a ledger that can't be read whole is a
// problem with the run, never an empty result.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  KIT_VERSION,
  ANALYSIS_VERSION,
  RECORD_SCHEMA,
  validActorObservation,
  type BeginRecord,
  type CompletionRecord,
  type ErrorRecord,
  type ResultRecord,
  type StepRecord,
  type TestDeclaration,
  type TestEndRecord,
} from '../kit/records.ts';
import { beginObservationProblems, canonicalDeclarations, validObservation, observationProblems, sameBindings } from '../kit/environment-inputs.ts';
import type { TestIdentity } from './model.ts';

export const LEDGER_FILE = 'steps.jsonl';
export const JSON_REPORT = 'playwright.json';
export const HTML_REPORT_DIR = 'html';

/** One planned Playwright invocation: its own subdirectory of the run directory (§2). */
export type InvocationPlan = { id: string; suite: string; dir: string };

export type ObservedTest = {
  invocation: string;
  declaration: TestDeclaration;
  identity: TestIdentity;
  results: ResultRecord[];
  end: TestEndRecord | null;
};

export type InvocationObservation = {
  plan: InvocationPlan;
  ledger: 'present' | 'missing';
  begin: BeginRecord | null;
  tests: ObservedTest[];
  errors: ErrorRecord[];
  completion: CompletionRecord | null;
  problems: string[];
  artifacts: { json: boolean; html: boolean };
};

export type RunObservation = { invocations: InvocationObservation[] };

export type RunProblem =
  | { kind: 'ledger-missing'; invocation: string }
  | { kind: 'ledger-invalid'; invocation: string; detail: string }
  | { kind: 'completion-missing'; invocation: string }
  | { kind: 'interrupted'; invocation: string }
  | { kind: 'timed-out'; invocation: string }
  | { kind: 'run-error'; invocation: string; error: ErrorRecord }
  | { kind: 'no-tests'; invocation: string }
  | { kind: 'unexplained-status'; invocation: string; finalStatus: string };

export type RunStatus = { complete: boolean; problems: RunProblem[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

function checkError(v: unknown): v is ErrorRecord {
  return isObject(v) && isString(v['message']);
}

function checkIds(v: unknown): boolean {
  if (!isObject(v)) return false;
  const viewport = v['viewport'];
  const role = v['role'];
  const browser = v['browser'];
  return (
    v['schema'] === RECORD_SCHEMA && v['kit'] === KIT_VERSION &&
    isString(v['case']) &&
    isString(v['step']) &&
    (v['obligation'] === null || isString(v['obligation'])) &&
    isString(v['project']) &&
    (v['navigationOrigin'] === undefined || v['navigationOrigin'] === null || isString(v['navigationOrigin'])) &&
    (viewport === null || (isObject(viewport) && isNumber(viewport['width']) && isNumber(viewport['height']))) &&
    isObject(role) &&
    isString(role['name']) &&
    (browser === null || (isObject(browser) && isString(browser['name']) && isString(browser['version'])))
  );
}

function checkStep(v: unknown): v is StepRecord {
  if (!isObject(v)) return false;
  const path = v['path'];
  const ids = v['ids'];
  return (
    Array.isArray(path) &&
    path.every((n) => Number.isInteger(n) && (n as number) >= 0) &&
    isString(v['title']) &&
    isNumber(v['depth']) &&
    (v['status'] === 'passed' || v['status'] === 'failed' || v['status'] === 'skipped') &&
    (v['error'] === null || checkError(v['error'])) &&
    (ids === null || checkIds(ids))
  );
}

const RESULT_STATUSES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const EXPECTED_STATUSES = new Set(['passed', 'failed', 'skipped']);
const FINAL_STATUSES = new Set(['passed', 'failed', 'timedout', 'interrupted']);
const OUTCOMES = new Set(['expected', 'unexpected', 'flaky', 'skipped']);
const inEnum = (v: unknown, values: Set<string>): boolean => isString(v) && values.has(v);

export function validEnvironment(v: unknown): boolean {
  return isObject(v) && isString(v['id']) && v['id'].length > 0 && (v['kind'] === 'local-candidate' || v['kind'] === 'deployed') && isString(v['baseUrl']) && /^https?:\/\//.test(v['baseUrl']);
}

function checkDeclaration(v: unknown): v is TestDeclaration {
  return (
    isObject(v) &&
    isString(v['testId']) &&
    isString(v['file']) &&
    isNumber(v['line']) &&
    isStringArray(v['titlePath']) &&
    isString(v['project']) &&
    inEnum(v['expectedStatus'], EXPECTED_STATUSES) &&
    isObject(v['optionSafety']) && count(v['optionSafety']['version']) && isStringArray(v['optionSafety']['problems']) &&
    Array.isArray(v['annotations'])
  );
}

function checkProject(v: unknown): boolean {
  return isObject(v) && isString(v['name']) && isString(v['testDir']) && isString(v['snapshotDir']) && isString(v['outputDir']) &&
    isStringArray(v['dependencies']) && (v['teardown'] === null || isString(v['teardown'])) && count(v['retries']) && count(v['repeatEach']) &&
    count(v['timeout']) && isStringArray(v['testMatch']) && isStringArray(v['testIgnore']) && isObject(v['use']);
}

function checkBegin(v: Record<string, unknown>): v is BeginRecord {
  return (
    v['schema'] === RECORD_SCHEMA &&
    (v['environment'] === null || validEnvironment(v['environment'])) &&
    v['kit'] === KIT_VERSION &&
    isString(v['playwright']) &&
    isString(v['rootDir']) &&
    count(v['workers']) && count(v['globalTimeout']) && count(v['maxFailures']) && typeof v['fullyParallel'] === 'boolean' &&
    isStringArray(v['reporters']) && isStringArray(v['globalSetup']) && isStringArray(v['globalTeardown']) &&
    (v['configFile'] === null || isString(v['configFile'])) &&
    Array.isArray(v['projects']) && v['projects'].every(checkProject) &&
    Array.isArray(v['tests']) &&
    v['tests'].every(checkDeclaration)
  );
}

function checkResult(v: Record<string, unknown>): v is ResultRecord {
  return (
    isString(v['testId']) &&
    count(v['retry']) &&
    (v['workerIndex'] === undefined || v['workerIndex'] === -1 || count(v['workerIndex'])) &&
    inEnum(v['status'], RESULT_STATUSES) &&
    inEnum(v['expectedStatus'], EXPECTED_STATUSES) &&
    Array.isArray(v['errors']) &&
    v['errors'].every(checkError) &&
    Array.isArray(v['steps']) &&
    v['steps'].every(checkStep) &&
    (v['actorProbes'] === undefined || (Array.isArray(v['actorProbes']) && v['actorProbes'].every(validActorObservation)))
  );
}

export function readInvocation(plan: InvocationPlan, file: string = join(plan.dir, LEDGER_FILE)): InvocationObservation {
  const observation: InvocationObservation = {
    plan,
    ledger: 'missing',
    begin: null,
    tests: [],
    errors: [],
    completion: null,
    problems: [],
    artifacts: { json: existsSync(join(plan.dir, JSON_REPORT)), html: existsSync(join(plan.dir, HTML_REPORT_DIR, 'index.html')) },
  };
  if (!existsSync(file)) return observation;
  observation.ledger = 'present';
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  // A file cut mid-line (a killed process) leaves a last line with no newline: that line is unreadable.
  if (lines.at(-1) !== '') observation.problems.push('the ledger ends mid-record');
  let inputsCompleted = false;
  const inputProblems: string[] = [];
  const byId = new Map<string, ObservedTest>();
  const problem = (n: number, detail: string) => observation.problems.push(`line ${n + 1}: ${detail}`);
  lines.forEach((line, n) => {
    if (line === '' && n === lines.length - 1) return;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return problem(n, 'not JSON');
    }
    if (!isObject(record) || !isString(record['type'])) return problem(n, 'not a record');
    if (observation.completion !== null) return problem(n, 'a record after the completion record');
    switch (record['type']) {
      case 'begin': {
        if (observation.begin !== null) return problem(n, 'a second begin record');
        if (!checkBegin(record)) return problem(n, 'an invalid begin record');
        observation.begin = record;
        if (record.environmentInputs !== undefined) {
          if (!validObservation(record.environmentInputs)) problem(n,'invalid environment input begin observation');
          else {
            inputProblems.push(...beginObservationProblems(record.environmentInputs));
            for (const p of inputProblems) problem(n,p);
            // Keep phase diagnostics in the input record too: digest/planning callers consume begin.
            record.environmentInputs = {...record.environmentInputs,problems:[...new Set(inputProblems)]};
          }
        }
        if (new Set(record.projects.map((p) => p.name)).size !== record.projects.length) problem(n, 'duplicate project identities');
        // Historical/malformed evidence is validated independently of the plan that produced it.
        const projects = new Map(record.projects.map(p => [p.name, p]));
        for (const p of record.projects) {
          if (new Set(p.dependencies).size !== p.dependencies.length) problem(n, `duplicate dependencies for project ${p.name}`);
          for (const target of [...p.dependencies, ...(p.teardown === null ? [] : [p.teardown])])
            if (!projects.has(target)) problem(n, `project ${p.name} references unknown project ${target}`);
        }
        const active = new Set<string>(), visited = new Set<string>();
        const visit = (name: string) => {
          if (active.has(name)) { problem(n, `project graph cycle at ${name}`); return; }
          if (visited.has(name)) return;
          visited.add(name); active.add(name);
          const p = projects.get(name);
          if (p !== undefined) for (const target of [...p.dependencies, ...(p.teardown === null ? [] : [p.teardown])]) visit(target);
          active.delete(name);
        };
        for (const name of projects.keys()) visit(name);
        for (const declaration of record.tests) {
          if (declaration.optionSafety.version !== ANALYSIS_VERSION) problem(n, `unsupported safety analysis ${declaration.optionSafety.version} for ${declaration.testId}; rerun with input-aware analysis ${ANALYSIS_VERSION}`);
          if (!projects.has(declaration.project)) problem(n, `test ${declaration.testId} declares unknown project ${declaration.project}`);
          for (const p of declaration.optionSafety.problems) problem(n, `unverified options for ${declaration.testId}: ${p}`);
          if (byId.has(declaration.testId)) problem(n, `duplicate test declaration ${declaration.testId}`);
          const observed: ObservedTest = {
            invocation: plan.id,
            declaration,
            identity: { suite: plan.suite, file: declaration.file, titlePath: declaration.titlePath },
            results: [],
            end: null,
          };
          byId.set(declaration.testId, observed);
          observation.tests.push(observed);
        }
        return undefined;
      }
      case 'result': {
        if (!checkResult(record)) return problem(n, 'an invalid result record');
        const test = byId.get(record.testId);
        if (test === undefined) return problem(n, `a result for undeclared test ${record.testId}`);
        if (test.end !== null) problem(n, `a result after the outcome for ${record.testId}`);
        if (test.results.some((r) => r.retry === record.retry)) problem(n, `duplicate result retry ${record.retry} for ${record.testId}`);
        if (record.retry !== test.results.length) problem(n, `nonsequential retry ${record.retry} for ${record.testId}`);
        const paths = record.steps.map((s) => JSON.stringify(s.path));
        if (new Set(paths).size !== paths.length || record.steps.some((s) => s.depth !== s.path.length - 1)) problem(n, 'duplicate or inconsistent structural step paths');
        for (const step of record.steps) if (step.ids !== null) {
          if (!observation.begin?.projects.some(p => p.name === step.ids?.project)) problem(n, `step attachment references unknown project ${step.ids.project}`);
          if (step.ids.project !== test.declaration.project) problem(n, `step attachment project ${step.ids.project} differs from declaration ${test.declaration.project}`);
        }
        test.results.push(record);
        return undefined;
      }
      case 'error': {
        if (!checkError(record['error'])) return problem(n, 'an invalid error record');
        observation.errors.push(record['error']);
        return undefined;
      }
      case 'test': {
        const test = isString(record['testId']) ? byId.get(record['testId']) : undefined;
        if (test === undefined || !inEnum(record['outcome'], OUTCOMES) || !inEnum(record['expectedStatus'], EXPECTED_STATUSES) || !count(record['results'])) return problem(n, 'an invalid test record');
        if (test.end !== null) { problem(n, `duplicate outcome record for ${test.declaration.testId}`); return; }
        test.end = record as TestEndRecord;
        return undefined;
      }
      case 'environment-inputs': {
        const o = record['observation'], initial = observation.begin?.environmentInputs;
        if (inputsCompleted || !validObservation(o) || !validObservation(initial) || initial.phase !== 'begin' || o.phase !== 'complete' || o.invocation !== initial.invocation || JSON.stringify(canonicalDeclarations(o.declarations)) !== JSON.stringify(canonicalDeclarations(initial.declarations)) || !sameBindings(o.bindings,initial.bindings)) return problem(n,'conflicting or invalid environment invocation completion');
        for (const p of initial.processes) {
          const final = o.processes.find(f => f.pid === p.pid);
          if (final === undefined || !sameBindings(p.bindings,final.bindings) || p.changed.some(n => !final.changed.includes(n))) {
            const detail = 'environment process binding changed between begin and completion';
            inputProblems.push(detail);
            problem(n,detail);
          }
        }
        inputsCompleted = true;
        for (const p of observationProblems(o)) problem(n,p);
        observation.begin!.environmentInputs = {...o,problems:[...new Set([...inputProblems,...o.problems])]};
        return undefined;
      }
      case 'completion': {
        if (!inEnum(record['finalStatus'], FINAL_STATUSES)) return problem(n, 'an invalid completion record');
        if (!count(record['results']) || !count(record['errors'])) problem(n, 'invalid completion counters');
        observation.completion = record as CompletionRecord;
        return undefined;
      }
      default:
        return problem(n, `unknown record type ${String(record['type'])}`);
    }
  });
  if (observation.begin?.environmentInputs !== undefined && !inputsCompleted) observation.problems.push('missing environment invocation completion');
  if (observation.completion !== null) {
    if (inputsCompleted) {
      const records = observation.tests.flatMap(t => t.results);
      const workers = new Set(records.filter(r => r.workerIndex !== undefined && r.workerIndex >= 0).map(r=>r.workerIndex));
      if (records.some(r => r.workerIndex === undefined) || observation.begin?.environmentInputs?.workers !== workers.size) observation.problems.push('missing or conflicting public environment worker identities');
    }
    const results = observation.tests.reduce((n, t) => n + t.results.length, 0);
    if (observation.completion.results !== results || observation.completion.errors !== observation.errors.length)
      observation.problems.push('completion counters disagree with result/error records');
    if (observation.completion.finalStatus === 'passed' && (observation.errors.length > 0 || observation.tests.some((t) => playwrightOutcome(t.results, latestExpected(t)) === 'unexpected')))
      observation.problems.push('passing completion contradicts failures or run errors');
    for (const t of observation.tests) if (t.end !== null && (t.end.results !== t.results.length || t.end.expectedStatus !== latestExpected(t)))
      observation.problems.push(`outcome counters or expected status disagree for ${t.declaration.testId}`);
  }
  return observation;
}

export function readRun(plans: InvocationPlan[]): RunObservation {
  return { invocations: plans.map((plan) => readInvocation(plan)) };
}

/** Playwright's own computeTestCaseOutcome (identical in 1.58.2 and 1.60.0), over the results seen. */
export function playwrightOutcome(results: ResultRecord[], expectedStatus: string): 'skipped' | 'expected' | 'unexpected' | 'flaky' {
  let skipped = 0;
  let expected = 0;
  let unexpected = 0;
  for (const result of results) {
    if (result.status === 'interrupted') continue;
    if (result.status === 'skipped' && expectedStatus === 'skipped') skipped++;
    else if (result.status === 'skipped') continue; // did not run
    else if (result.status === expectedStatus) expected++;
    else unexpected++;
  }
  if (expected === 0 && unexpected === 0) return 'skipped';
  if (unexpected === 0) return 'expected';
  if (expected === 0 && skipped === 0) return 'unexpected';
  return 'flaky';
}

/** The run's status: rule 3's conditions, from every planned invocation's ledger. */
export function runStatus(run: RunObservation): RunStatus {
  const problems: RunProblem[] = [];
  for (const inv of run.invocations) {
    const invocation = inv.plan.id;
    if (inv.ledger === 'missing') {
      problems.push({ kind: 'ledger-missing', invocation });
      continue;
    }
    for (const detail of inv.problems) problems.push({ kind: 'ledger-invalid', invocation, detail });
    if (inv.begin === null) problems.push({ kind: 'ledger-invalid', invocation, detail: 'no begin record' });
    for (const error of inv.errors) problems.push({ kind: 'run-error', invocation, error });
    if (inv.completion === null) {
      problems.push({ kind: 'completion-missing', invocation });
      continue;
    }
    const status = inv.completion.finalStatus;
    if (status === 'interrupted') problems.push({ kind: 'interrupted', invocation });
    else if (status === 'timedout') problems.push({ kind: 'timed-out', invocation });
    else if (status !== 'passed') {
      const explained = inv.tests.some((t) => playwrightOutcome(t.results, latestExpected(t)) === 'unexpected' || playwrightOutcome(t.results, latestExpected(t)) === 'flaky');
      if (!explained && inv.errors.length === 0) problems.push({ kind: 'unexplained-status', invocation, finalStatus: status });
    }
    if (inv.begin !== null && inv.begin.tests.length === 0) problems.push({ kind: 'no-tests', invocation });
    for (const test of inv.tests) {
      if (test.end === null) {
        problems.push({ kind: 'ledger-invalid', invocation, detail: `no outcome record for ${test.declaration.testId}` });
        continue;
      }
      const ours = playwrightOutcome(test.results, latestExpected(test));
      // A test with no results never ran: Playwright calls it skipped, and so do we here.
      if (test.end.outcome !== ours)
        problems.push({ kind: 'ledger-invalid', invocation, detail: `outcome ${test.end.outcome} for ${test.declaration.testId} disagrees with its results (${ours})` });
    }
  }
  return { complete: problems.length === 0, problems };
}

/** expectedStatus can change at run time (test.fail() or test.skip() in the body): the last result's wins. */
export function latestExpected(test: ObservedTest): string {
  return test.results.at(-1)?.expectedStatus ?? test.end?.expectedStatus ?? test.declaration.expectedStatus;
}

/**
 * The browser each project really ran, from the caseStep attachments of its results: never from what a
 * record claims. A project whose results disagree about the browser has none.
 */
export function browsersOf(inv: InvocationObservation): Map<string, { name: string; version: string }> {
  const seen = new Map<string, Set<string>>();
  for (const t of inv.tests) {
    for (const r of t.results) {
      for (const s of r.steps) {
        const b = s.ids?.browser;
        if (b === undefined || b === null) continue;
        const set = seen.get(t.declaration.project) ?? new Set<string>();
        set.add(JSON.stringify([b.name, b.version]));
        seen.set(t.declaration.project, set);
      }
    }
  }
  const out = new Map<string, { name: string; version: string }>();
  for (const [project, set] of seen) {
    if (set.size !== 1) continue;
    const [name, version] = JSON.parse([...set][0] as string) as [string, string];
    out.set(project, { name, version });
  }
  return out;
}
