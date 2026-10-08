// What a design-lab run looks like from the files it writes, with no engine calls: the same
// reading `workflow.ts watch` does, so the pane and the text fallback agree.

import type { Check, Facts, Findings, Phase, Runner, Scores, Summary as RunSummary } from '../../src/protocol';
import type { Summary as ManifestSummary } from '../../types';
type Summary = RunSummary<'mod'>;
type Assignable<Expected, Actual extends Expected> = Actual;
// Both directions enforce the generated host contract without runtime dependencies.
export type HostSummaryMatchesProtocol = Assignable<Summary, ManifestSummary>;
export type ProtocolSummaryMatchesHost = Assignable<ManifestSummary, Summary>;

// protocol.ts has no runtime dependencies, so these values are safe in the mod host.
import { SERVER_FRESH_MS, RUNNER_ABSENT_MS, isProgressState, isStepKind } from '../../src/protocol.ts';
export { SERVER_FRESH_MS, RUNNER_ABSENT_MS } from '../../src/protocol.ts';
export const LOG_LINES = 8;
// The Markdown element draws at most 10,000 characters.
export const RECAP_LIMIT = 9_500;

const DONE = new Set(['complete', 'approved', 'waived']);

/** The files the mod reads, as text; a missing or unreadable file is undefined. */
export type Raw = {
  project?: unknown;
  phaseLog?: string;
  progress?: unknown;
  runnerLog?: string;
  completion?: string;
  scorecard?: unknown;
  preflightChecks?: unknown;
  verifyReport?: unknown;
  // the artifact files found in the run folder, run-relative
  present?: string[];
};

export function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function msSince(stamp: string | null, nowMs: number): number | null {
  if (!stamp) return null;
  const at = Date.parse(stamp);
  return Number.isNaN(at) ? null : nowMs - at;
}

/** The phase log's lines that parse; a half-written last line is skipped. */
export function entriesOf(log: string | undefined): Record<string, unknown>[] {
  if (!log) return [];
  return log.split('\n').flatMap((line) => {
    const value = parseJson(line.trim() || undefined);
    return typeof value === 'object' && value !== null ? [value as Record<string, unknown>] : [];
  });
}

export function tailOf(log: string | undefined, lines = LOG_LINES): string[] {
  if (!log) return [];
  return log
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-lines);
}

export function runnerOf(progress: unknown, nowMs: number): Runner | null {
  const p = record(progress);
  if (!('state' in p)) return null;
  const serverAge = msSince(text(p.at), nowMs);
  const serverAlive = serverAge !== null && serverAge <= SERVER_FRESH_MS;
  const seenAge = msSince(text(p.lastSeen), nowMs);
  const asked = seenAge !== null && seenAge <= RUNNER_ABSENT_MS;
  const connected = serverAlive && (asked || p.inflight === true);
  return {
    state: typeof p.state === 'string' && isProgressState(p.state) ? p.state : 'waiting',
    stepsDone: count(p.stepsDone),
    stepsTotal: count(p.stepsTotal),
    stepKind: typeof p.stepKind === 'string' && isStepKind(p.stepKind) ? p.stepKind : null,
    message: text(p.message),
    serverAlive,
    connected,
    lastSeenMs: seenAge,
  };
}

export function summaryOf(workspace: string, raw: Raw, nowMs: number): Summary {
  const project = record(raw.project);
  if (raw.project === undefined) {
    return {
      workspace,
      found: false,
      siteLabel: null,
      phases: [],
      current: null,
      preflight: null,
      runner: null,
      blocker: null,
      waiting: null,
      log: [],
      hasRecap: false,
      recap: null,
      scores: null,
      facts: { found: null, toBuild: null, built: null, expected: null, figmaUrl: null },
      findings: null,
      startedAt: null,
      phaseErrors: {},
      present: [],
    };
  }
  const recorded: Phase[] = Object.entries(record(project.phases)).map(([name, value]) => ({
    name,
    status: text(record(value).status) ?? 'pending',
    reused: Boolean(record(value).from),
  }));
  const finished = recapIsCurrent(project, raw);
  // Preflight records its phase only once it passes, so until then a run that has not reached the
  // build is still in preflight. A rebuild copies preflight from its source and never runs it here.
  const preflighting =
    !recorded.some((phase) => phase.name === 'preflight') &&
    !recorded.some((phase) => phase.reused) &&
    !finished &&
    !recorded.some((phase) => BUILD_PHASES.has(phase.name) && phase.status !== 'pending');
  // In the order the run takes them, not the order project.json happens to hold them.
  const phases = [...recorded, ...(preflighting ? [{ name: 'preflight', status: 'running', reused: false }] : [])].sort(
    (a, b) => flowRank(a.name) - flowRank(b.name),
  );
  // A phase copied from an earlier run never takes the current phase, whatever status it copied.
  const own = phases.filter((phase) => !phase.reused);
  const running = own.find((phase) => phase.status === 'running');
  const due = own.find((phase) => !DONE.has(phase.status));
  const runner = runnerOf(raw.progress, nowMs);
  const entries = entriesOf(raw.phaseLog);
  const last = entries[entries.length - 1];
  const phaseErrors: Record<string, string> = {};
  for (const phase of phases) {
    if (phase.status !== 'failed') continue;
    const said = entries.filter((entry) => entry.phase === phase.name && typeof entry.message === 'string').pop();
    if (said) phaseErrors[phase.name] = said.message as string;
  }
  // The open blocker: the newest entry stopped the run for the person, and the runner has not
  // come back since.
  const blocker = last && last.status === 'stopped' && !runner?.connected ? text(last.message) : null;
  // Waiting on the person for something the run notices by itself (the runner starting at the
  // build's connection): what to do, with nothing to press.
  const waiting = last && last.status === 'waiting' && !runner?.connected ? text(last.message) : null;
  // While the build waits for the person to start the runner, the runner is awaited, not idle.
  const shown = waiting && runner && runner.state === 'waiting' ? { ...runner, state: 'connecting' as const } : runner;
  const preflight = record(record(project.phases).preflight);
  const preflightAt = preflight.from ? null : text(preflight.updatedAt);
  const checks = checksOf(raw.preflightChecks, preflight);
  return {
    workspace,
    found: true,
    siteLabel: text(record(project.run).siteLabel),
    phases,
    current: (running ?? due)?.name ?? null,
    preflight:
      preflight.status || checks ? { status: text(preflight.status) ?? 'running', at: preflightAt, checks } : null,
    runner: shown,
    blocker,
    waiting,
    log: tailOf(raw.runnerLog),
    hasRecap: finished,
    recap: finished ? recapOf(raw.completion!) : null,
    scores: finished ? scoresOf(raw.scorecard) : null,
    facts: factsOf(project, finished ? raw.completion : undefined),
    findings: findingsOf(raw.verifyReport, text(project.createdAt)),
    startedAt: preflightAt ?? text(project.createdAt),
    phaseErrors,
    present: raw.present ?? [],
  };
}

export const CHECK_MARKS: Record<string, string> = {
  done: '✓',
  checking: '▸',
  'needs-you': '!',
  failed: '✗',
  waiting: '·',
};
export const CHECK_COLORS: Record<string, string | undefined> = {
  done: 'green',
  checking: 'cyan',
  'needs-you': 'yellow',
  failed: 'red',
};

/** The checklist preflight last wrote, or null when there is none or it is older than the recorded
 * preflight phase (a run that passed preflight before the checklist existed). */
export function checksOf(document: unknown, phase: Record<string, unknown>): Check[] | null {
  const d = record(document);
  if (!Array.isArray(d.checks)) return null;
  const written = Date.parse(text(d.at) ?? '');
  const passed = Date.parse(phase.from ? '' : (text(phase.updatedAt) ?? ''));
  if (phase.status === 'complete' && written < passed) return null;
  return d.checks.flatMap((value) => {
    const c = record(value);
    const id = text(c.id);
    return id === null
      ? []
      : [
          {
            id,
            label: text(c.label) ?? id,
            status: text(c.status) ?? 'waiting',
            message: text(c.message),
            dependsOn: Array.isArray(c.dependsOn) ? c.dependsOn.filter((x): x is string => typeof x === 'string') : [],
          },
        ];
  });
}

/** Preflight passed and every check is done: the group can fold to one line. */
export function preflightPassed(summary: Summary): boolean {
  const p = summary.preflight;
  return p?.status === 'complete' && (p.checks ?? []).every((check) => check.status === 'done');
}

/** What a check says beside its label: only while it is working or needs something. */
export function checkMessage(check: Check): string | null {
  return ['checking', 'needs-you', 'failed'].includes(check.status) ? check.message : null;
}

/** HH:MM on the person's clock. */
export function clockOf(stamp: string | null): string | null {
  if (!stamp) return null;
  const at = new Date(stamp);
  if (Number.isNaN(at.getTime())) return null;
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** The recap belongs to this build: its scorecard names the build's creation, or, from a scorer
 * before that stamp, the build has recorded its benchmark as complete. A folder initialised again
 * keeps the old benchmark/ folder until it is scored, and that must not read as done. */
export function recapIsCurrent(project: Record<string, unknown>, raw: Raw): boolean {
  if (raw.completion === undefined) return false;
  const stamp = record(record(raw.scorecard).run).buildCreatedAt;
  if (typeof stamp === 'string') return stamp === text(project.createdAt);
  return text(record(record(project.phases).benchmark).status) === 'complete';
}

/** The completion message as written, cut with a note if it ever outgrows what Markdown draws. */
export function recapOf(completion: string): string {
  const text = completion.trim();
  return text.length <= RECAP_LIMIT
    ? text
    : `${text.slice(0, RECAP_LIMIT)}\n\n(cut here: the whole message is in benchmark/completion.md)`;
}

/** Finished: the scorer has written this build's recap. The runner reports done once the Figma
 * build is over, while verification and scoring still have to run. */
export function isFinished(summary: Summary): boolean {
  return summary.hasRecap;
}

/** The run is stopped for the person: building or checking, and the runner is gone. */
export function isDown(summary: Summary): boolean {
  if (!summary.found || isFinished(summary)) return false;
  if (summary.blocker) return true;
  const runner = summary.runner;
  return runner !== null && (runner.state === 'building' || runner.state === 'preflight') && !runner.connected;
}

/** Before the build starts, or between builds, the runner is not needed: idle, not missing. */
export function isIdle(runner: Runner): boolean {
  return runner.state === 'waiting' && !runner.connected;
}

export function runnerLine(runner: Runner): string {
  if (runner.state === 'done') return 'Figma build finished';
  if (!runner.serverAlive) return 'runner server not responding';
  if (runner.connected) return 'runner connected';
  if (isIdle(runner)) return 'runner idle until the build';
  if (runner.state === 'connecting') return 'waiting for the runner to start';
  const minutes = Math.max(1, Math.round((runner.lastSeenMs ?? 0) / 60_000));
  return `runner not seen for ${minutes}m`;
}

export function stepsLine(runner: Runner): string | null {
  if ((runner.state === 'building' || runner.state === 'done') && runner.stepsTotal) {
    const kind = runner.state === 'building' && runner.stepKind ? `, ${runner.stepKind}` : '';
    return `steps ${runner.stepsDone ?? 0}/${runner.stepsTotal}${kind}`;
  }
  // The server's last word to a runner that has since gone quiet ("Connected. Waiting…") is stale.
  return isIdle(runner) || runner.state === 'connecting' ? null : runner.message;
}

/** A length of time as the pane writes it: 41m, 3h 44m; under a minute, 40s. */
export function durationOf(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  // Rounded, as the recap rounds it, so the two agree.
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** How long the run has been going, from its start. */
export function elapsedOf(startedAt: string | null, nowMs: number): string | null {
  const ms = msSince(startedAt, nowMs);
  if (ms === null || ms < 0) return null;
  return ms < 60_000 ? '0m' : durationOf(Math.floor(ms / 60_000) * 60);
}

/** The scorecard's headline figures; null when there is no scorecard to read. */
export function scoresOf(scorecard: unknown): Scores | null {
  const card = record(scorecard);
  if (!('headline' in card)) return null;
  const headline = record(card.headline);
  const coverage = record(headline.coverage);
  const accuracy = record(record(headline.accuracy).corrected);
  const effort = record(headline.effort);
  const open = record(record(record(card.sections).conformance).open);
  return {
    built: count(coverage.built),
    eligible: count(coverage.eligible),
    withinTolerance: count(accuracy.pass),
    widths: count(accuracy.total),
    workingSeconds: count(effort.workingSeconds),
    buildSeconds: count(effort.buildSeconds),
    buildSteps: count(effort.buildSteps),
    tokens: count(effort.tokens),
    toolCalls: count(effort.toolCalls),
    blockers: count(open.blocker),
    majors: count(open.major),
  };
}

/** The first Figma file link in the recap, without the punctuation of the sentence it ends. */
export function figmaUrlOf(completion: string): string | null {
  return /https:\/\/www\.figma\.com\/(?:design|file)\/[^\s)>\]]+/.exec(completion)?.[0].replace(/[.,;:]+$/, '') ?? null;
}

/** 40013109 as 40.0M, 563519 as 564K. */
export function compactOf(value: number | null): string | null {
  if (value === null) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

/** A share as a whole percent, or null with nothing to divide by. Anything short of the whole
 * stays below 100, so 200 of 201 reads 99% and is never judged complete. */
export function percentOf(part: number | null, whole: number | null): number | null {
  if (part === null || !whole) return null;
  const percent = Math.round((part / whole) * 100);
  return part < whole && percent >= 100 ? 99 : percent;
}

/** A bar of `cells` cells, filled in proportion: the filled run and the empty run, drawn apart. */
export function barOf(done: number, total: number, cells: number): { filled: string; empty: string } {
  const width = Math.max(4, cells);
  const share = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const filled = Math.round(share * width);
  return { filled: '━'.repeat(filled), empty: '━'.repeat(width - filled) };
}

/** Where the run stands, in one word, and the color it is drawn in. */
export type Tone = { label: string; color: string };

export function toneOf(summary: Summary): Tone {
  const stages = stagesOf(summary);
  if (stages.some((stage) => stage.state === 'failed')) return { label: 'Failed', color: 'red' };
  if (needsYouOf(summary)) return { label: 'Needs you', color: 'yellow' };
  if (isFinished(summary)) {
    return verdictOf(summary.findings)
      ? { label: 'Done · needs review', color: 'yellow' }
      : { label: 'Done', color: 'green' };
  }
  const active = stages.find((stage) => stage.state === 'active' || stage.state === 'stopped');
  return { label: active?.doing ?? 'Starting', color: 'cyan' };
}

/** What the person has to do, from one place, so the header, the card, the stage and the toast
 * always agree; null when the run needs nothing from them. */
export function needsYouOf(summary: Summary): { message: string; canResume: boolean } | null {
  // A failure outranks every request: the Failed card says what went wrong, and resuming would
  // only run into it again.
  if (hasFailed(summary)) return null;
  if (summary.blocker) return { message: summary.blocker, canResume: true };
  if (summary.waiting) return { message: summary.waiting, canResume: false };
  const check = (summary.preflight?.checks ?? []).find((c) => c.status === 'needs-you');
  if (check) return { message: `${check.label}: ${check.message ?? 'needs your attention'}`, canResume: false };
  if (isDown(summary)) {
    return {
      message: 'The Figma runner has stopped. Reopen it in Figma desktop, then press Resume run.',
      canResume: true,
    };
  }
  return null;
}

/** Something failed: a phase run here, the runner while the run is unfinished, or a preflight check. */
export function hasFailed(summary: Summary): boolean {
  return (
    summary.phases.some((phase) => !phase.reused && phase.status === 'failed') ||
    (summary.runner?.state === 'failed' && !isFinished(summary)) ||
    (summary.preflight?.checks ?? []).some((check) => check.status === 'failed')
  );
}

/** The first stage that failed, and what the card says about it; null when nothing failed. */
export function failureOf(summary: Summary): { stage: string; text: string } | null {
  const stage = stagesOf(summary).find((s) => s.state === 'failed');
  if (!stage) return null;
  const check =
    stage.id === 'preflight' ? (summary.preflight?.checks ?? []).find((c) => c.status === 'failed') : undefined;
  const phase = stage.phases.find((p) => !p.reused && p.status === 'failed');
  const message = check
    ? check.message
      ? `${check.label}: ${check.message}`
      : check.label
    : ((phase && summary.phaseErrors[phase.name]) ??
      (stage.id === 'build' && summary.runner?.state === 'failed' ? summary.runner.message : null));
  return {
    stage: stage.label,
    text: message
      ? `${stage.label} stopped with an error: ${message}`
      : `${stage.label} stopped with an error. Ask Claude in the conversation what went wrong.`,
  };
}

/** What the verdict card says when verification left blocking or major problems open; null otherwise. */
export function verdictOf(findings: Findings | null): string | null {
  if (!findings || findings.blocker + findings.major === 0) return null;
  const { blocker, major } = findings;
  const parts = [blocker ? `${blocker} blocking` : null, major ? `${major} major` : null].filter(Boolean);
  const one = blocker + major === 1;
  return `${parts.join(' and ')} problem${one ? ' is' : 's are'} still open, so the library does not yet meet the design-lab standard.`;
}

/** A phase name as a person reads it: figma-build as Figma build. */
export function phaseLabel(name: string): string {
  const words = name.replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const PHASE_DONE = DONE;

/** The status line, or undefined to clear it once the run is over or gone. */
export function statusOf(summary: Summary, nowMs: number): string | undefined {
  if (!summary.found) return undefined;
  if (isFinished(summary)) return undefined;
  // The engine shows the plugin's name before it: `design-lab: steps 112/158 · runner connected · 41m`.
  const parts: string[] = [];
  const runner = summary.runner;
  const checks = summary.preflight?.checks;
  if (runner?.state === 'building' && runner.stepsTotal)
    parts.push(`steps ${runner.stepsDone ?? 0}/${runner.stepsTotal}`);
  else if (checks && summary.preflight?.status !== 'complete') {
    parts.push(`preflight ${checks.filter((check) => check.status === 'done').length}/${checks.length}`);
  } else if (summary.current) parts.push(summary.current);
  if (runner) parts.push(runnerLine(runner));
  const time = elapsedOf(summary.startedAt, nowMs);
  if (time) parts.push(time);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** The whole summary as plain text: the command's answer where nothing draws. */
export function plainOf(summary: Summary): string {
  if (!summary.found) return `No design-lab run in ${summary.workspace}: it has no project.json.`;
  const lines = [`design-lab · ${summary.siteLabel ?? summary.workspace}`, ''];
  const checks = summary.preflight?.checks;
  if (checks && checks.length > 0) {
    lines.push('  Preflight');
    for (const check of checks) {
      const message = checkMessage(check);
      lines.push(`    ${CHECK_MARKS[check.status] ?? '·'} ${check.label}${message ? `: ${message}` : ''}`);
    }
    lines.push('');
  }
  for (const phase of summary.phases) {
    const mark = DONE.has(phase.status)
      ? '✓'
      : phase.status === 'failed'
        ? '✗'
        : phase.name === summary.current
          ? '▸'
          : phase.status === 'stopped'
            ? '!'
            : '·';
    lines.push(`  ${mark} ${phase.name}`);
  }
  if (summary.runner) {
    const steps = stepsLine(summary.runner);
    lines.push('');
    if (steps) lines.push(`  ${steps}`);
    if (!summary.hasRecap) lines.push(`  ${runnerLine(summary.runner)}`);
  }
  const failure = failureOf(summary);
  if (failure) lines.push('', `  Failed: ${failure.text}`);
  const need = needsYouOf(summary);
  if (need) lines.push('', `  Needs you: ${need.message}`);
  if (summary.hasRecap) lines.push('', `  Recap: ${summary.workspace}/benchmark/completion.md`);
  return lines.join('\n');
}

/**
 * What the resume button does after asking to fill the prompt box: nothing more once filled;
 * send the request where the session has no prompt box at all; otherwise (a dialog holds the
 * keys, or the reason is unknown) leave the person's draft alone and say why.
 */
export function afterFill(filled: { isFilled: boolean; refusal?: string } | undefined): 'done' | 'submit' | 'explain' {
  if (filled?.isFilled) return 'done';
  return filled?.refusal === 'no_composer' ? 'submit' : 'explain';
}

export const RESUME_PROMPT = (workspace: string) =>
  `The design-lab runner is open again in Figma desktop. Resume the design-lab run in ${workspace} from where it stopped.`;

/** What the phases recorded about the run: counts from inventory, plan and components, the file
 * from connect (or, failing that, the recap). */
export function factsOf(project: Record<string, unknown>, completion: string | undefined): Facts {
  const phases = record(project.phases);
  const detail = (name: string) => record(record(phases[name]).detail);
  return {
    found: count(detail('inventory').components),
    toBuild: count(detail('plan').build),
    built: count(detail('components').built),
    expected: count(detail('components').expected),
    figmaUrl: text(detail('connect').fileUrl) ?? (completion ? figmaUrlOf(completion) : null),
  };
}

/** The open findings by severity, or null before this run's verification has written its report.
 * A folder initialised again keeps the last run's report, so one written before this run began is
 * not this run's. */
export function findingsOf(report: unknown, createdAt: string | null): Findings | null {
  const r = record(report);
  if (!Array.isArray(r.open) || !Array.isArray(r.passed)) return null;
  const written = Date.parse(text(r.generatedAt) ?? '');
  if (Number.isNaN(written) || written < Date.parse(createdAt ?? '')) return null;
  const by = (severity: string) => (r.open as unknown[]).filter((f) => record(f).severity === severity).length;
  return {
    blocker: by('blocker'),
    major: by('major'),
    minor: by('minor'),
    passed: r.passed.length,
    waived: Array.isArray(r.waived) ? r.waived.length : 0,
  };
}

/** The five stages a run moves through, and the phases each holds. A phase not named here
 * belongs to Build, so nothing the run records goes unshown. */
export const STAGES = [
  { id: 'preflight', label: 'Preflight', doing: 'Preflight', phases: ['preflight'] },
  {
    id: 'discovery',
    label: 'Discovery',
    doing: 'Discovering',
    phases: ['discovery', 'inventory', 'usage', 'capture', 'tokens', 'plan'],
  },
  { id: 'build', label: 'Build', doing: 'Building', phases: ['connect', 'foundation', 'components', 'index'] },
  { id: 'verify', label: 'Verify', doing: 'Verifying', phases: ['verify'] },
  { id: 'report', label: 'Report', doing: 'Reporting', phases: ['benchmark'] },
] as const;

export type StageId = (typeof STAGES)[number]['id'];
// flagged: finished with open blocking or major problems; failed: stopped with an error.
export type StageState = 'done' | 'flagged' | 'active' | 'stopped' | 'failed' | 'pending' | 'reused';
export type Stage = {
  id: StageId;
  label: string;
  doing: string;
  state: StageState;
  phases: Phase[];
  note: string | null;
  noteColor?: string;
};

// Every known phase in the order the run takes them. A phase not named here sits just after index,
// so it stays with Build and comes before verify.
const FLOW: string[] = STAGES.flatMap((stage) => [...stage.phases]);
const BUILD_PHASES = new Set<string>(STAGES.find((stage) => stage.id === 'build')!.phases);

function flowRank(name: string): number {
  const at = FLOW.indexOf(name);
  return at >= 0 ? at : FLOW.indexOf('index') + 0.5;
}

function stageOf(name: string): StageId {
  return STAGES.find((stage) => (stage.phases as readonly string[]).includes(name))?.id ?? 'build';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function stageNote(
  id: StageId,
  state: StageState,
  summary: Summary,
  phases: Phase[],
): { note: string | null; noteColor?: string } {
  const f = summary.facts;
  if (state === 'reused') return { note: 'reused from an earlier run' };
  if (state === 'pending') return { note: null };
  if (id === 'preflight') {
    const checks = summary.preflight?.checks;
    if (!checks) return { note: state === 'done' ? 'passed' : null };
    const done = checks.filter((check) => check.status === 'done').length;
    return { note: state === 'done' ? `${checks.length} checks passed` : `${done} of ${checks.length} checks` };
  }
  if (id === 'discovery') {
    if (state !== 'done')
      return { note: `${phases.filter((phase) => DONE.has(phase.status)).length} of ${phases.length} steps` };
    const parts = [
      f.found !== null ? `${f.found} found` : null,
      f.toBuild !== null ? `${f.toBuild} planned` : null,
    ].filter(Boolean);
    return { note: parts.length ? parts.join(' · ') : 'complete' };
  }
  if (id === 'build') {
    const runner = summary.runner;
    if (state !== 'done' && runner?.state === 'building' && runner.stepsTotal)
      return { note: `${percentOf(runner.stepsDone ?? 0, runner.stepsTotal)}%` };
    if (f.built !== null && f.expected !== null) {
      return {
        note: `${f.built} of ${f.expected} planned built`,
        noteColor: state === 'done' && f.built < f.expected ? 'yellow' : undefined,
      };
    }
    return { note: state === 'done' ? 'complete' : null };
  }
  if (id === 'verify') {
    const k = summary.findings;
    if (!k || (state !== 'done' && state !== 'flagged')) return { note: null };
    // Kept short so the row fits a narrow pane; the verdict card above the figures has the rest.
    if (state === 'flagged') {
      const parts = [
        k.blocker ? plural(k.blocker, 'blocker', 'blockers') : null,
        k.major ? `${k.major} major` : null,
      ].filter(Boolean);
      return { note: `${parts.join(' · ')} open`, noteColor: 'yellow' };
    }
    if (k.minor > 0) return { note: `${k.minor} minor open`, noteColor: 'yellow' };
    // Checks that do not apply to this site are not problems, so the note leaves them out.
    return {
      note: k.waived === 0 ? `all ${k.passed} checks pass` : `${k.passed} passed · ${k.waived} waived`,
      noteColor: 'green',
    };
  }
  return { note: state === 'done' ? 'report ready' : null };
}

/** Each stage with where it stands, first match winning: copied from an earlier run, failed, done
 * (flagged when verification left problems open), stopped for the person, under way, not started.
 * A stage is under way when it holds the run's current phase or any of its phases is running, so
 * more than one can be. */
export function stagesOf(summary: Summary): Stage[] {
  const finished = isFinished(summary);
  const need = needsYouOf(summary);
  const checks = summary.preflight?.checks ?? [];
  const k = summary.findings;
  return STAGES.map((def) => {
    // summary.phases is already in flow order.
    const phases = summary.phases.filter((phase) => stageOf(phase.name) === def.id);
    const own = phases.filter((phase) => !phase.reused);
    const running = own.some((phase) => phase.status === 'running');
    const holdsCurrent = phases.some((phase) => phase.name === summary.current);
    const failed =
      own.some((phase) => phase.status === 'failed') ||
      (def.id === 'build' && summary.runner?.state === 'failed' && !finished) ||
      (def.id === 'preflight' && checks.some((check) => check.status === 'failed'));
    // Once the recap is written the run is over: a stage whose phase record never caught up
    // (verify left 'running', say) is still done, and Verify is judged by its findings.
    const done = (phases.length > 0 && phases.every((phase) => DONE.has(phase.status))) || finished;
    let state: StageState;
    if (
      phases.length > 0 &&
      phases.every((phase) => phase.reused) &&
      !phases.some((phase) => phase.status === 'running')
    )
      state = 'reused';
    else if (failed) state = 'failed';
    else if (done) state = def.id === 'verify' && k && k.blocker + k.major > 0 ? 'flagged' : 'done';
    else if ((holdsCurrent || running) && !finished) {
      const stopped =
        (need !== null && holdsCurrent) ||
        (def.id === 'preflight' && checks.some((check) => check.status === 'needs-you')) ||
        phases.some((phase) => phase.status === 'stopped');
      state = stopped ? 'stopped' : 'active';
    } else state = 'pending';
    return {
      id: def.id,
      label: def.label,
      doing: def.doing,
      state,
      phases,
      ...stageNote(def.id, state, summary, phases),
    };
  });
}
