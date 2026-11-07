import type { EnvironmentInputObservation } from './environment-inputs.ts';
// The records the step reporter writes, one JSON object per line, and caseStep()'s step attachment.
// This file is copied into a suite with the rest of the kit, so it imports nothing.
// The core reads these files back (src/run-observation.ts) and validates every field it uses.

export const KIT_VERSION = '0.2.0';
export const RECORD_SCHEMA = 2;
/** Input-aware AST safety, including erased dependencies and conservative environment inputs. */
export const ANALYSIS_VERSION = 5;
/** The step attachment caseStep() writes, read back by the reporter from `step.attachments`. */
export const STEP_ATTACHMENT = 'test-lab-step';
/** The file the run plan points the reporter at. */
export type EnvironmentIdentity = { id: string; kind: 'local-candidate' | 'deployed'; baseUrl: string };
export const ENVIRONMENT_ENV = 'TEST_LAB_ENVIRONMENT';
export const STEP_OUTPUT_ENV = 'TEST_LAB_STEP_OUTPUT';
/** Comma-separated custom `use` option names whose values are secrets; never written, only their presence. */
export const SECRET_OPTIONS_ENV = 'TEST_LAB_SECRET_OPTIONS';
export const ACTOR_ATTACHMENT = 'test-lab-actor-probe';
export type ActorObservation = {schema:1;phase:'after-setup';project:string;path:string;roleField:string;expected:string;actual:string|null;url:string;status:number;ok:boolean};
export function validActorObservation(v:unknown):v is ActorObservation {
  if(v===null||typeof v!=='object'||Array.isArray(v))return false;
  const x=v as Record<string,unknown>;
  return x['schema']===1&&x['phase']==='after-setup'&&typeof x['project']==='string'&&typeof x['path']==='string'&&x['roleField']==='role'&&typeof x['expected']==='string'&&typeof x['url']==='string'&&
    (x['actual']===null||typeof x['actual']==='string')&&typeof x['status']==='number'&&Number.isInteger(x['status'])&&typeof x['ok']==='boolean';
}

export type Viewport = { width: number; height: number };

/** Where a role was read from. caseStep sees only the project's own storageState. */
export type RoleObservation = { name: string; source: 'project-storage-state' | 'project-inline-storage-state' | 'none' };

export type BrowserObservation = { name: string; version: string };

/** caseStep()'s attachment body. */
export type StepAttachment = {
  schema: typeof RECORD_SCHEMA;
  kit: string;
  case: string;
  step: string;
  obligation: string | null;
  project: string;
  viewport: Viewport | null;
  role: RoleObservation;
  browser: BrowserObservation | null;
  /** The origin actually open at this obligation's entry; no path, query or credential is retained. */
  navigationOrigin?: string | null;
};

export type ErrorRecord = { message: string; stack?: string; location?: { file: string; line: number; column: number } };

export type StepRecord = {
  /** Indices from the result's top-level steps down, counting every step category: stable across titles. */
  path: number[];
  title: string;
  depth: number;
  status: 'passed' | 'failed' | 'skipped';
  error: ErrorRecord | null;
  ids: StepAttachment | null;
};

export type TestDeclaration = {
  testId: string;
  /** Relative to the config file's folder (BeginRecord.rootDir), with forward slashes. */
  file: string;
  line: number;
  /** Describe titles, then the test title: the project and file are not part of it. */
  titlePath: string[];
  project: string;
  expectedStatus: string;
  /** Versioned safety check: project options are not assumed effective under unobservable overrides. */
  optionSafety: { version: number; problems: string[] };
  annotations: { type: string; description?: string }[];
  tags: string[];
};

export type SecretValue = { secret: true; present: true };

export type ProjectRecord = {
  name: string;
  testDir: string;
  outputDir: string;
  snapshotDir: string;
  dependencies: string[];
  teardown: string | null;
  retries: number;
  repeatEach: number;
  timeout: number;
  testMatch: string[];
  testIgnore: string[];
  /** The project's resolved `use`, with secret values replaced by SecretValue. */
  use: Record<string, unknown>;
};

export type BeginRecord = {
  type: 'begin';
  schema: typeof RECORD_SCHEMA;
  kit: string;
  playwright: string;
  startedAt: string;
  environment: EnvironmentIdentity | null;
  /** Absent on environment-independent/legacy invocations; never inferred from the reader process. */
  environmentInputs?: EnvironmentInputObservation;
  /** The folder test files are named relative to: the config file's folder. */
  rootDir: string;
  configFile: string | null;
  workers: number;
  globalTimeout: number;
  maxFailures: number;
  fullyParallel: boolean;
  reporters: string[];
  globalSetup: string[];
  globalTeardown: string[];
  projects: ProjectRecord[];
  tests: TestDeclaration[];
};

export type ResultRecord = {
  type: 'result';
  testId: string;
  retry: number;
  /** Public worker identity; -1 means the result never entered a worker. */
  workerIndex?: number;
  status: string;
  expectedStatus: string;
  duration: number;
  errors: ErrorRecord[];
  annotations: { type: string; description?: string }[];
  steps: StepRecord[];
  actorProbes?: ActorObservation[];
};

export type RunErrorRecord = { type: 'error'; error: ErrorRecord };

export type TestEndRecord = { type: 'test'; testId: string; outcome: string; expectedStatus: string; results: number };

export type CompletionRecord = { type: 'completion'; finalStatus: string; at: string; results: number; errors: number };

export type EnvironmentInputsRecord = { type: 'environment-inputs'; observation: EnvironmentInputObservation };

export type LedgerRecord = EnvironmentInputsRecord | BeginRecord | ResultRecord | RunErrorRecord | TestEndRecord | CompletionRecord;
