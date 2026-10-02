// What a design-lab run looks like from the files it writes, with no engine calls: the same
// reading `workflow.py watch` does, so the pane and the text fallback agree.

import type { Phase, Runner, Summary } from '../../types'

// Three missed heartbeats (figma_runner.HEARTBEAT_SECONDS is 10).
export const SERVER_FRESH_MS = 30_000
// workflow.py's RUNNER_ABSENT_MINUTES: the runner must have asked for a step within two minutes.
export const RUNNER_ABSENT_MS = 120_000
export const LOG_LINES = 8

const DONE = new Set(['complete', 'approved', 'waived'])

/** The files the mod reads, as text; a missing or unreadable file is undefined. */
export type Raw = {
  project?: unknown
  phaseLog?: string
  progress?: unknown
  runnerLog?: string
  hasCompletion?: boolean
}

export function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function count(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function msSince(stamp: string | null, nowMs: number): number | null {
  if (!stamp) return null
  const at = Date.parse(stamp)
  return Number.isNaN(at) ? null : nowMs - at
}

/** The phase log's lines that parse; a half-written last line is skipped. */
export function entriesOf(log: string | undefined): Record<string, unknown>[] {
  if (!log) return []
  return log.split('\n').flatMap(line => {
    const value = parseJson(line.trim() || undefined)
    return typeof value === 'object' && value !== null ? [value as Record<string, unknown>] : []
  })
}

export function tailOf(log: string | undefined, lines = LOG_LINES): string[] {
  if (!log) return []
  return log.split('\n').filter(line => line.trim() !== '').slice(-lines)
}

export function runnerOf(progress: unknown, nowMs: number): Runner | null {
  const p = record(progress)
  if (!('state' in p)) return null
  const serverAge = msSince(text(p.at), nowMs)
  const serverAlive = serverAge !== null && serverAge <= SERVER_FRESH_MS
  const seenAge = msSince(text(p.lastSeen), nowMs)
  const asked = seenAge !== null && seenAge <= RUNNER_ABSENT_MS
  const connected = serverAlive && (asked || p.inflight === true)
  return {
    state: text(p.state) ?? 'waiting',
    stepsDone: count(p.stepsDone),
    stepsTotal: count(p.stepsTotal),
    stepKind: text(p.stepKind),
    message: text(p.message),
    serverAlive,
    connected,
    lastSeenMs: seenAge,
  }
}

export function summaryOf(workspace: string, raw: Raw, nowMs: number): Summary {
  const project = record(raw.project)
  if (raw.project === undefined) {
    return { workspace, found: false, siteLabel: null, phases: [], current: null, preflight: null,
      runner: null, blocker: null, log: [], hasRecap: false, startedAt: null }
  }
  const phases: Phase[] = Object.entries(record(project.phases)).map(([name, value]) => ({
    name, status: text(record(value).status) ?? 'pending',
  }))
  const running = phases.find(phase => phase.status === 'running')
  const due = phases.find(phase => !DONE.has(phase.status))
  const runner = runnerOf(raw.progress, nowMs)
  const entries = entriesOf(raw.phaseLog)
  const last = entries[entries.length - 1]
  // The open blocker: the newest entry stopped the run for the person, and the runner has not
  // come back since.
  const blocker = last && last.status === 'stopped' && !runner?.connected ? text(last.message) : null
  const preflight = record(record(project.phases).preflight)
  return {
    workspace,
    found: true,
    siteLabel: text(record(project.run).siteLabel),
    phases,
    current: (running ?? due)?.name ?? null,
    preflight: preflight.status ? { status: text(preflight.status) ?? 'pending', at: text(preflight.updatedAt) } : null,
    runner,
    blocker,
    log: tailOf(raw.runnerLog),
    hasRecap: raw.hasCompletion === true,
    startedAt: text(preflight.updatedAt) ?? text(project.createdAt),
  }
}

/** Finished: the scorer has written the recap, or every build step is recorded. */
export function isFinished(summary: Summary): boolean {
  return summary.hasRecap || summary.runner?.state === 'done'
}

/** The run is stopped for the person: building or checking, and the runner is gone. */
export function isDown(summary: Summary): boolean {
  if (!summary.found || isFinished(summary)) return false
  if (summary.blocker) return true
  const runner = summary.runner
  return runner !== null && (runner.state === 'building' || runner.state === 'preflight') && !runner.connected
}

export function runnerLine(runner: Runner): string {
  if (!runner.serverAlive) return 'runner server not responding'
  if (runner.connected) return 'runner connected'
  const minutes = Math.max(1, Math.round((runner.lastSeenMs ?? 0) / 60_000))
  return `runner not seen for ${minutes}m`
}

export function stepsLine(runner: Runner): string | null {
  if ((runner.state === 'building' || runner.state === 'done') && runner.stepsTotal) {
    const kind = runner.state === 'building' && runner.stepKind ? `, ${runner.stepKind}` : ''
    return `steps ${runner.stepsDone ?? 0}/${runner.stepsTotal}${kind}`
  }
  return runner.message
}

function elapsed(startedAt: string | null, nowMs: number): string | null {
  const ms = msSince(startedAt, nowMs)
  if (ms === null || ms < 0) return null
  const minutes = Math.floor(ms / 60_000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** The status line, or undefined to clear it once the run is over or gone. */
export function statusOf(summary: Summary, nowMs: number): string | undefined {
  if (!summary.found) return undefined
  if (isFinished(summary)) return undefined
  const parts = ['design-lab']
  const runner = summary.runner
  if (runner?.state === 'building' && runner.stepsTotal) parts.push(`steps ${runner.stepsDone ?? 0}/${runner.stepsTotal}`)
  else if (summary.current) parts.push(summary.current)
  if (runner) parts.push(runnerLine(runner))
  const time = elapsed(summary.startedAt, nowMs)
  if (time) parts.push(time)
  return parts.join(' · ')
}

/** The whole summary as plain text: the command's answer where nothing draws. */
export function plainOf(summary: Summary): string {
  if (!summary.found) return `No design-lab run in ${summary.workspace}: it has no project.json.`
  const lines = [`design-lab · ${summary.siteLabel ?? summary.workspace}`, '']
  for (const phase of summary.phases) {
    const mark = DONE.has(phase.status) ? '✓' : phase.name === summary.current ? '▸' : phase.status === 'stopped' ? '!' : '·'
    lines.push(`  ${mark} ${phase.name}`)
  }
  if (summary.runner) {
    const steps = stepsLine(summary.runner)
    lines.push('')
    if (steps) lines.push(`  ${steps}`)
    lines.push(`  ${runnerLine(summary.runner)}`)
  }
  if (summary.blocker) lines.push('', `  Needs you: ${summary.blocker}`)
  if (summary.hasRecap) lines.push('', `  Recap: ${summary.workspace}/benchmark/completion.md`)
  return lines.join('\n')
}

/**
 * What the resume button does after asking to fill the prompt box: nothing more once filled;
 * send the request where the session has no prompt box at all; otherwise (a dialog holds the
 * keys, or the reason is unknown) leave the person's draft alone and say why.
 */
export function afterFill(filled: { isFilled: boolean; refusal?: string } | undefined): 'done' | 'submit' | 'explain' {
  if (filled?.isFilled) return 'done'
  return filled?.refusal === 'no_composer' ? 'submit' : 'explain'
}

export const RESUME_PROMPT = (workspace: string) =>
  `The design-lab runner is open again in Figma desktop. Resume the design-lab run in ${workspace} from where it stopped.`
