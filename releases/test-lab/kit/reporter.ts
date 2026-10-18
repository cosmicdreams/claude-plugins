// The step reporter: one JSON object per line in the file TEST_LAB_STEP_OUTPUT names. It writes the
// run's resolved configuration and every planned test first, each test result (with its steps and
// their caseStep IDs) as it ends, every run-level error, a per-test outcome once the run is over, and a
// completion record last. Records are written as they happen, so an interrupted run still shows every
// result it reached; a file with no completion record is an interrupted run.
//
// The file must not exist beforehand: each invocation writes into a fresh directory, so results from two
// runs can never mix.

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

import type {
  FullConfig,
  FullProject,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

import { ENVIRONMENT_INPUTS_ENV, ENVIRONMENT_INPUTS_DIR, parseRequest, bindingsOf, validProcess, type EnvironmentInputObservation } from './environment-inputs.ts';
import { optionClosureProblems } from './option-safety.ts';

import {
  ENVIRONMENT_ENV,
  ANALYSIS_VERSION,
  KIT_VERSION,
  RECORD_SCHEMA,
  SECRET_OPTIONS_ENV,
  STEP_ATTACHMENT,
  STEP_OUTPUT_ENV,
  ACTOR_ATTACHMENT,
  validActorObservation,
  type ErrorRecord,
  type LedgerRecord,
  type ProjectRecord,
  type StepAttachment,
  type StepRecord,
  type TestDeclaration,
} from './records.ts';

/** `use` options whose values are or carry secrets: only their presence is ever written. */
const SECRET_USE = ['httpCredentials', 'extraHTTPHeaders', 'proxy', 'clientCertificates'];

function secretOptions(): Set<string> {
  const extra = (process.env[SECRET_OPTIONS_ENV] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return new Set([...SECRET_USE, ...extra]);
}

function plain(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[deep]';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'function') return '[function]';
  if (value instanceof RegExp) return `/${value.source}/${value.flags}`;
  if (Array.isArray(value)) return value.map((v) => plain(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = plain(v, depth + 1);
    return out;
  }
  return String(value);
}

function redactUse(use: Record<string, unknown>, secrets: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(use)) {
    if (value === undefined) continue;
    if (secrets.has(key)) out[key] = { secret: true, present: true };
    else if (key === 'storageState') {
      // A path names the role's source; inline state is credentials and is never written.
      out[key] = typeof value === 'string' ? value : { secret: true, present: true };
    } else out[key] = plain(value);
  }
  return out;
}

function patterns(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v) => v !== undefined && v !== null).map((v) => (v instanceof RegExp ? `/${v.source}/${v.flags}` : String(v)));
}

function errorOf(error: TestError): ErrorRecord {
  const record: ErrorRecord = { message: error.message ?? error.value ?? 'unknown error' };
  if (error.stack !== undefined) record.stack = error.stack;
  if (error.location !== undefined) record.location = { ...error.location };
  return record;
}

function attachmentOf(step: TestStep): StepAttachment | null {
  for (const a of step.attachments) {
    if (a.name !== STEP_ATTACHMENT || a.body === undefined) continue;
    try {
      return JSON.parse(a.body.toString('utf8')) as StepAttachment;
    } catch {
      return null;
    }
  }
  return null;
}

function stepsOf(steps: readonly TestStep[], prefix: number[], out: StepRecord[]): StepRecord[] {
  steps.forEach((step, index) => {
    const path = [...prefix, index];
    if (step.category === 'test.step') {
      out.push({
        path,
        title: step.title,
        depth: path.length - 1,
        status: step.error !== undefined ? 'failed' : step.annotations.some((a) => a.type === 'skip') ? 'skipped' : 'passed',
        error: step.error === undefined ? null : errorOf(step.error),
        ids: attachmentOf(step),
      });
    }
    stepsOf(step.steps, path, out);
  });
  return out;
}

export default class TestLabStepReporter implements Reporter {
  private fd: number | null = null;
  private readonly path: string;
  private rootDir = '';
  private results = 0;
  private errors = 0;
  private suite: Suite | null = null;
  private readonly workerIndices = new Set<number>();

  private inputObservation(phase: 'begin' | 'complete'): EnvironmentInputObservation | undefined {
    const raw = process.env[ENVIRONMENT_INPUTS_ENV];
    if (raw === undefined) return undefined;
    const request = parseRequest(raw);
    const observation: EnvironmentInputObservation = { version:1,invocation:request.invocation,phase,declarations:request.declarations,bindings:bindingsOf(request.declarations,request.values),processes:[],workers:this.workerIndices.size,problems:[] };
    try {
      const dir = resolve(dirname(this.path),ENVIRONMENT_INPUTS_DIR,request.invocation);
      const files = phase === 'begin' ? [`${process.pid}.json`] : readdirSync(dir);
      for (const file of files) {
        const p: unknown = JSON.parse(readFileSync(resolve(dir,file),'utf8'));
        if (!validProcess(p,request.declarations)) { observation.problems.push('invalid environment process observation'); continue; }
        observation.processes.push({...p,closed:p.pid === process.pid && phase === 'complete' ? true : p.closed});
      }
      if (!observation.processes.some(p => p.pid === process.pid)) observation.problems.push('missing pre-config reporter process observation');
    } catch { observation.problems.push('missing or unreadable pre-load environment observation'); }
    return observation;
  }

  constructor() {
    const output = process.env[STEP_OUTPUT_ENV];
    if (output === undefined || output === '') throw new Error(`test-lab step reporter: set ${STEP_OUTPUT_ENV} to the output file`);
    this.path = resolve(output);
  }

  printsToStdio(): boolean {
    return false;
  }

  private write(record: LedgerRecord): void {
    if (this.fd === null) {
      mkdirSync(dirname(this.path), { recursive: true });
      this.fd = openSync(this.path, 'wx');
    }
    writeSync(this.fd, `${JSON.stringify(record)}\n`);
  }

  private fileOf(test: TestCase): string {
    return relative(this.rootDir, realpathSync(test.location.file)).split(sep).join('/');
  }

  private declaration(test: TestCase): TestDeclaration {
    const project = test.parent.project();
    // titlePath() is ['', project, file, ...describes, title].
    const titlePath = test.titlePath().slice(3);
    return {
      testId: test.id,
      file: this.fileOf(test),
      line: test.location.line,
      titlePath,
      project: project?.name ?? '',
      expectedStatus: test.expectedStatus,
      optionSafety: {version:ANALYSIS_VERSION,problems:optionClosureProblems([test.location.file])},
      annotations: test.annotations.map((a) => (a.description === undefined ? { type: a.type } : { type: a.type, description: a.description })),
      tags: [...test.tags],
    };
  }

  onBegin(config: FullConfig, suite: Suite): void {
    // Test files are named relative to the config's folder, where profile globs are written, not to
    // Playwright's rootDir (its testDir), so a path means the same thing in every record.
    this.rootDir = realpathSync(config.configFile === undefined ? config.rootDir : dirname(config.configFile));
    this.suite = suite;
    const secrets = secretOptions();
    const project = (p: FullProject): ProjectRecord => ({
      name: p.name,
      testDir: p.testDir,
      outputDir: p.outputDir,
      snapshotDir: p.snapshotDir,
      dependencies: [...p.dependencies],
      teardown: p.teardown ?? null,
      retries: p.retries,
      repeatEach: p.repeatEach,
      timeout: p.timeout,
      testMatch: patterns(p.testMatch),
      testIgnore: patterns(p.testIgnore),
      use: redactUse(p.use as Record<string, unknown>, secrets),
    });
    const setup = (config as unknown as { globalSetup: unknown }).globalSetup;
    const teardown = (config as unknown as { globalTeardown: unknown }).globalTeardown;
    const environmentInputs = this.inputObservation('begin');
    this.write({
      type: 'begin',
      ...(environmentInputs === undefined ? {} : {environmentInputs}),
      schema: RECORD_SCHEMA,
      kit: KIT_VERSION,
      playwright: config.version,
      environment: process.env[ENVIRONMENT_ENV] === undefined ? null : JSON.parse(process.env[ENVIRONMENT_ENV] as string),
      startedAt: new Date().toISOString(),
      rootDir: this.rootDir,
      configFile: config.configFile ?? null,
      workers: config.workers,
      globalTimeout: config.globalTimeout,
      maxFailures: config.maxFailures,
      fullyParallel: config.fullyParallel,
      reporters: config.reporter.map(([name]) => name),
      globalSetup: patterns(setup),
      globalTeardown: patterns(teardown),
      projects: config.projects.map(project),
      tests: suite.allTests().map((t) => this.declaration(t)),
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.results += 1;
    if (result.workerIndex >= 0) this.workerIndices.add(result.workerIndex);
    this.write({
      type: 'result',
      testId: test.id,
      retry: result.retry,
      workerIndex: result.workerIndex,
      status: result.status,
      expectedStatus: test.expectedStatus,
      duration: result.duration,
      errors: result.errors.map(errorOf),
      annotations: test.annotations.map((a) => (a.description === undefined ? { type: a.type } : { type: a.type, description: a.description })),
      steps: stepsOf(result.steps, [], []),
      actorProbes: result.attachments.filter(a=>a.name===ACTOR_ATTACHMENT).map(a=>{
        const value:unknown=JSON.parse((a.body??readFileSync(a.path??'')).toString('utf8'));
        if(!validActorObservation(value))throw new Error('invalid actor probe attachment');
        return value;
      }),
    });
  }

  onError(error: TestError): void {
    this.errors += 1;
    this.write({ type: 'error', error: errorOf(error) });
  }

  async onEnd(result: FullResult): Promise<void> {
    for (const test of this.suite?.allTests() ?? []) {
      this.write({ type: 'test', testId: test.id, outcome: test.outcome(), expectedStatus: test.expectedStatus, results: test.results.length });
    }
    const environmentInputs = this.inputObservation('complete');
    if (environmentInputs !== undefined) this.write({type:'environment-inputs',observation:environmentInputs});
    this.write({ type: 'completion', finalStatus: result.status, at: new Date().toISOString(), results: this.results, errors: this.errors });
    if (this.fd !== null) {
      fsyncSync(this.fd);
      closeSync(this.fd);
      this.fd = null;
    }
  }
}
