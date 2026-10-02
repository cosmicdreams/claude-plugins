// design-lab's pane: where a run is and when it is done, from the files the run writes. It reads
// only the run folder and the active-run pointer, writes nothing to disk, and asks nothing of the
// person except, when the runner has stopped, a button that puts the resume request in the prompt.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Summary } from '../../types'
import {
  afterFill, isDown, parseJson, plainOf, RESUME_PROMPT, runnerLine, statusOf, stepsLine, summaryOf,
} from './model'

const PANE = 'design-lab'
const COMMAND = 'design-lab:watch'
export const POLL_MS = 5_000
// The runner log is tailed only while it is small enough to read whole every poll.
const LOG_READ_LIMIT = 1024 * 1024

const runAtom = atom({ plugin: 'design-lab', key: 'run' } as const, null)
const summaryAtom = atom({ plugin: 'design-lab', key: 'summary' } as const, null)
const alarmedAtom = atom({ plugin: 'design-lab', key: 'alarmed' } as const, false)

// The files read under a run folder, and nothing else there.
export const RUN_FILES = {
  project: 'project.json',
  phaseLog: 'phase-log.jsonl',
  progress: 'figma/progress.json',
  runnerLog: 'figma/runner.log',
  completion: 'benchmark/completion.md',
} as const

let timer: Timer | undefined
// The last JSON that parsed, so a file caught half-written keeps the last good reading.
const lastGood = new Map<string, unknown>()

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  const value = parseJson(await readText($, path))
  if (value !== undefined) lastGood.set(path, value)
  return value ?? lastGood.get(path)
}

async function readLog($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    const stat = await $.fs.stat(path)
    return stat.size <= LOG_READ_LIMIT ? await $.fs.read(path) : undefined
  } catch {
    return undefined
  }
}

export async function summarise($: EngineInterface, run: string): Promise<Summary> {
  const at = (file: string) => `${run}/${file}`
  const raw = {
    project: await readJson($, at(RUN_FILES.project)),
    phaseLog: await readText($, at(RUN_FILES.phaseLog)),
    progress: await readJson($, at(RUN_FILES.progress)),
    runnerLog: await readLog($, at(RUN_FILES.runnerLog)),
    hasCompletion: await $.fs.exists(at(RUN_FILES.completion)),
  }
  return summaryOf(run, raw, await $.clock.now())
}

async function refresh($: EngineInterface): Promise<void> {
  const run = await read($, runAtom)
  if (!run) return
  const summary = await summarise($, run)
  const before = await read($, summaryAtom)
  if (JSON.stringify(before) !== JSON.stringify(summary)) await update($, summaryAtom, () => summary)
  $.ui.status(statusOf(summary, await $.clock.now()))
  // The watchdog: once per transition, never again until the runner has come back.
  const down = isDown(summary)
  const alarmed = await read($, alarmedAtom)
  if (down && !alarmed) {
    $.ui.toast(summary.blocker ?? `design-lab: ${summary.runner ? runnerLine(summary.runner) : 'the run stopped'}`,
      { timeoutMs: 10_000 })
    await update($, alarmedAtom, () => true)
  } else if (!down && alarmed) {
    await update($, alarmedAtom, () => false)
  }
}

function watch($: EngineInterface): void {
  timer?.cancel()
  timer = $.clock.every(POLL_MS, () => void refresh($))
}

/** The run folder: the command's argument, else the run the active-run pointer names. */
async function runOf($: EngineInterface, args: string): Promise<string | { missing: string }> {
  const given = args.trim()
  if (given) return given.startsWith('/') ? given.replace(/\/+$/, '') : `${await $.session.cwd()}/${given}`
  const home = await $.env.get('HOME')
  const pointer = parseJson(home ? await readText($, `${home}/.design-lab/active-run.json`) : undefined)
  const workspace = typeof pointer === 'object' && pointer !== null ? (pointer as { workspace?: unknown }).workspace : undefined
  return typeof workspace === 'string'
    ? workspace
    : { missing: 'No design-lab run is active. Give the run folder: /design-lab:watch <run folder>' }
}

async function resume($: EngineInterface, run: string): Promise<void> {
  const text = RESUME_PROMPT(run)
  const step = afterFill(await $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined))
  if (step === 'submit') await $.prompt.submit({ text }).catch(() => undefined)
  if (step === 'explain') $.ui.toast('design-lab: close the open dialog, then press resume again.')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // After a reload the run is still in state; pick the watch back up.
    if (await read($, runAtom)) {
      watch($)
      void refresh($)
    }
    return next(e)
  })

  on('session.end', async (_$, e, next) => {
    timer?.cancel()
    timer = undefined
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const run = await runOf($, e.args)
    if (typeof run !== 'string') return { text: run.missing }
    await update($, runAtom, () => run)
    await update($, alarmedAtom, () => false)
    await refresh($)
    watch($)
    const summary = (await read($, summaryAtom)) ?? (await summarise($, run))
    if ((await $.session.surfaces()).length === 0) return { text: plainOf(summary) }
    const opened = await $.ui.open({ id: PANE, title: 'design-lab' })
    return { text: opened.isPlaced ? `Watching ${summary.siteLabel ?? run}.` : plainOf(summary) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const summary = await read($, summaryAtom)
    const run = await read($, runAtom)
    if (!summary || !run) return <Text dimColor>No design-lab run is being watched.</Text>
    if (!summary.found) return <Text>{plainOf(summary)}</Text>
    const runner = summary.runner
    const steps = runner ? stepsLine(runner) : null
    const preflight = summary.preflight
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">{summary.siteLabel ?? run}</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Preflight</Text>
          <Text dimColor={preflight?.status !== 'complete'}>
            {preflight?.status === 'complete'
              ? `✓ passed${preflight.at ? ` at ${preflight.at.slice(11, 16)}` : ''}`
              : preflight ? `· ${preflight.status}` : '· not yet'}
          </Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {summary.phases.filter(phase => phase.name !== 'preflight').map(phase => (
            <Text key={phase.name} dimColor={phase.name !== summary.current && !['complete', 'approved', 'waived'].includes(phase.status)}>
              {['complete', 'approved', 'waived'].includes(phase.status) ? '✓' : phase.name === summary.current ? '▸' : '·'} {phase.name}
            </Text>
          ))}
        </Box>
        {runner && (
          <Box flexDirection="column" marginTop={1}>
            {steps && <Text>{steps}</Text>}
            <Text color={runner.connected ? 'green' : 'yellow'}>{runnerLine(runner)}</Text>
          </Box>
        )}
        {summary.blocker && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">Needs you: {summary.blocker}</Text>
            <Button key="resume" label="Runner restarted, resume" onPress={() => void resume($, run)} />
          </Box>
        )}
        {summary.log.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {summary.log.map((line, i) => <Text key={`log-${i}`} dimColor wrap="truncate-end">{line}</Text>)}
          </Box>
        )}
      </Box>
    )
  })
}
