/** Self-contained values: safe in the Node server, Figma stripping and the no-Node mod host.
 * The only imports are erased types generated from our JSON schemas. */
import type { Progress } from './generated/progress.ts';
import type { RunnerStep } from './generated/runner-step.ts';
export const PORT = 8765;
export const WAIT_MS = 5000;
export const RETRY_MS = WAIT_MS;
export const HEARTBEAT_SECONDS = 10;
export const SERVER_FRESH_MS = 3 * HEARTBEAT_SECONDS * 1000;
export const RUNNER_ABSENT_MS = 120_000;
export const POLL_MS = WAIT_MS;
export type ProgressState = Progress['state'];
export type StepKind = RunnerStep['kind'];
export const PROGRESS_STATES = {waiting:'waiting',preflight:'preflight',building:'building',done:'done',failed:'failed'} as const satisfies {[State in ProgressState]:State};
export const STEP_KINDS = {wait:'wait',done:'done',check:'check',dump:'dump',use_figma:'use_figma',upload:'upload',screenshot:'screenshot',skip:'skip'} as const satisfies {[Kind in StepKind]:Kind};
export const isProgressState = (value: string): value is ProgressState => Object.values(PROGRESS_STATES).some(state => state === value);
export const isStepKind = (value: string): value is StepKind => Object.values(STEP_KINDS).some(kind => kind === value);

/** Finite workflow vocabulary; dynamic artifact paths remain generated typed maps. */
export const PHASE_NAMES = ['init','discovery','inventory','usage','capture','tokens','plan','variables','preflight','connect','foundation','components','index','verify','benchmark'] as const;
export type PhaseName = typeof PHASE_NAMES[number];
export const REGISTRABLE_PHASES=['usage','capture','foundation','components','index','verify'] as const satisfies readonly PhaseName[];
export type RegistrablePhase=typeof REGISTRABLE_PHASES[number];
export const RECORDABLE_PHASES=[...REGISTRABLE_PHASES,'benchmark'] as const satisfies readonly PhaseName[];
export type RecordablePhase=typeof RECORDABLE_PHASES[number];
export const PHASE_STATUSES = ['pending','running','complete','failed','waived','awaiting-approval','approved','waiting','stopped','invalidated'] as const;
export type PhaseStatus = typeof PHASE_STATUSES[number];
export type CheckStatus = 'done'|'checking'|'needs-you'|'failed'|'waiting';
export interface ChecklistDocument {pass:string;at:string;ready:boolean|null;goAheadAt?:string|null;checks:(Omit<Check,'status'> & {status:CheckStatus;at:string})[]}
export interface Handshake {
  ok:boolean;at?:string;failure?:string;runnerConnected?:boolean;fileKey?:string|null;fileName?:string|null;
  fileKeyMatches?:boolean;empty?:boolean;onlyPreflightCover?:boolean;writable?:boolean;pluginData?:boolean;
  connectionOnly?:boolean;coverPageId?:string;coverId?:string;font?:string;fontLoaded?:boolean;
  fonts?:Record<string,string[]>|null;server?:{pid:number|null;started:boolean};
  install?:{folder:string;manifest:string;version:string;firstInstall:boolean;updated:boolean};instructions?:string[];
  outdated?:boolean;runnerVersion?:string;
}

// DESIGN_LAB_MOD_CONTRACT_BEGIN
// reused: copied from an earlier run (design-lab:figma-build), not run again here
export type Phase = { name: string; status: string; reused: boolean }

// What the phases recorded that the pane says beside each stage; each null until recorded.
export type Facts = {
  found: number | null
  toBuild: number | null
  built: number | null
  expected: number | null
  figmaUrl: string | null
}

// The verification report's open findings by severity, the checks it passed, and those it waived.
export type Findings = { blocker: number; major: number; minor: number; passed: number; waived: number }

export type Runner = {
  state: ProgressState | 'connecting'
  stepsDone: number | null
  stepsTotal: number | null
  stepKind: StepKind | null
  message: string | null
  serverAlive: boolean
  connected: boolean
  lastSeenMs: number | null
}

export type Check = {
  id: string
  label: string
  status: string
  message: string | null
  dependsOn: string[]
}

// The headline figures of a finished run, from its scorecard: each null when the scorer left it out.
export type Scores = {
  built: number | null
  eligible: number | null
  withinTolerance: number | null
  widths: number | null
  workingSeconds: number | null
  buildSeconds: number | null
  buildSteps: number | null
  tokens: number | null
  toolCalls: number | null
  blockers: number | null
  majors: number | null
}

type ModSummary = {
  workspace: string
  found: boolean
  siteLabel: string | null
  phases: Phase[]
  current: string | null
  // checks: the list preflight last wrote, or null when it has none newer than the recorded phase
  preflight: { status: string; at: string | null; checks: Check[] | null } | null
  runner: Runner | null
  blocker: string | null
  // the run is waiting for the person to do something it will notice by itself (start the runner)
  waiting: string | null
  log: string[]
  hasRecap: boolean
  recap: string | null
  scores: Scores | null
  facts: Facts
  findings: Findings | null
  startedAt: string | null
  // the last message the phase log holds for each failed phase, by phase name
  phaseErrors: Record<string, string>
  // the run's artifact files that exist, run-relative (read only once the recap is written)
  present: string[]
}

// DESIGN_LAB_MOD_CONTRACT_END

/** Both readers describe one run, but the CLI keeps its historical file-path/seconds
 * projection; the pane adds presentation facts and recap text. The surface parameter
 * makes these differences explicit without weakening either contract. */
type CliRunner = Omit<Runner, 'lastSeenMs'> & {lastSeenSeconds:number|null};
type CliSummary = {found:false;workspace:string;recap?:never} | {
  found:true;workspace:string;siteLabel?:string;
  phases:Omit<Phase,'reused'>[];nextPhase:string|null;
  preflightChecks:Check[]|null;runner:CliRunner|null;
  blocker:string|null;waiting:string|null;recap:string|null;
  startedAt:string|null;elapsedSeconds:number|null;
};
export type Summary<Surface extends 'cli'|'mod' = 'cli'> = Surface extends 'mod' ? ModSummary : CliSummary;
