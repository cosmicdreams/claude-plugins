// design-lab's pane: where a run is and when it is done, from the files the run writes. It reads
// only run folders (and, to find them, the person's design-lab settings, the project's runs folder
// and the active-run pointer), writes nothing to disk, and asks nothing of the person except, when
// the runner has stopped, a button that puts the resume request in the prompt.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Summary } from '../../types'
import {
  afterFill, CHECK_MARKS, checkMessage, clockOf, isDown, parseJson, plainOf, preflightPassed, RESUME_PROMPT,
  isIdle, runnerLine, statusOf, stepsLine, summaryOf,
} from './model'
import { ancestors, base, MARKERS, parent } from './locate'

const PANE = 'design-lab'
const COMMAND = 'design-lab:watch'
const RECAP_COMMAND = 'design-lab:recap'
export const POLL_MS = 5_000
// The runner log is tailed only while it is small enough to read whole every poll.
const LOG_READ_LIMIT = 1024 * 1024

const runAtom = atom({ plugin: 'design-lab', key: 'run' } as const, null)
const summaryAtom = atom({ plugin: 'design-lab', key: 'summary' } as const, null)
const alarmedAtom = atom({ plugin: 'design-lab', key: 'alarmed' } as const, false)
// The runs folder the pane follows when the person named no run: it moves to each newer run there.
const followAtom = atom({ plugin: 'design-lab', key: 'follow' } as const, null)

// The files read under a run folder, and nothing else there.
export const RUN_FILES = {
  project: 'project.json',
  phaseLog: 'phase-log.jsonl',
  progress: 'figma/progress.json',
  runnerLog: 'figma/runner.log',
  completion: 'benchmark/completion.md',
  scorecard: 'benchmark/scorecard.json',
  preflightChecks: 'preflight-checks.json',
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
    preflightChecks: await readJson($, at(RUN_FILES.preflightChecks)),
    runnerLog: await readLog($, at(RUN_FILES.runnerLog)),
    ...((await $.fs.exists(at(RUN_FILES.completion)))
      ? { completion: await readText($, at(RUN_FILES.completion)), scorecard: await readJson($, at(RUN_FILES.scorecard)) }
      : {}),
  }
  return summaryOf(run, raw, await $.clock.now())
}

async function refresh($: EngineInterface): Promise<void> {
  const follow = await read($, followAtom)
  if (follow) {
    const newest = await newestRun($, follow)
    if (newest && newest !== (await read($, runAtom))) {
      await update($, runAtom, () => newest)
      await update($, alarmedAtom, () => false)
    }
  }
  const run = await read($, runAtom)
  if (!run) return
  const summary = await summarise($, run)
  const before = await read($, summaryAtom)
  if (JSON.stringify(before) !== JSON.stringify(summary)) await update($, summaryAtom, () => summary)
  $.ui.status(statusOf(summary, await $.clock.now()))
  // Done: say so once, the moment the recap appears.
  if (summary.hasRecap && before && before.found && !before.hasRecap) {
    $.ui.toast(`design-lab: ${summary.siteLabel ?? 'the run'} is done. The recap is in the design-lab pane.`, { timeoutMs: 10_000 })
  }
  // The watchdog: once per transition, never again until the runner has come back.
  // The build's one planned wait for the person (start the runner) is told the same way, once.
  const down = isDown(summary) || summary.waiting !== null
  const alarmed = await read($, alarmedAtom)
  if (down && !alarmed) {
    $.ui.toast(summary.blocker ?? (summary.waiting ? `design-lab needs you: ${summary.waiting}` : null)
      ?? `design-lab: ${summary.runner ? runnerLine(summary.runner) : 'the run stopped'}`,
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
/** The run a command names, or with none: the newest in this project's runs folder, which the pane
 * then follows; else the run the machine-wide pointer names. */
async function runOf($: EngineInterface, args: string): Promise<string | { missing: string; follow?: string }> {
  const given = args.trim()
  if (given) return given.startsWith('/') ? given.replace(/\/+$/, '') : `${await $.session.cwd()}/${given}`
  const folder = await runsFolder($, await $.session.cwd())
  if (folder) {
    const newest = await newestRun($, folder)
    if (newest) return newest
  }
  const home = await $.env.get('HOME')
  const pointer = parseJson(home ? await readText($, `${home}/.design-lab/active-run.json`) : undefined)
  const workspace = typeof pointer === 'object' && pointer !== null ? (pointer as { workspace?: unknown }).workspace : undefined
  if (typeof workspace === 'string') return workspace
  if (folder) return { missing: `No design-lab run yet in ${folder}. The pane shows the first one as soon as it starts.`, follow: folder }
  return { missing: (await settings($)).convention
    ? 'No design-lab run found for this folder. Give the run folder: /design-lab:watch <run folder>'
    : 'design-lab is not set up on this machine yet: run design-lab:init once. Or give the run folder: /design-lab:watch <run folder>' }
}

// Which run to watch when the person names none: the newest in this project's runs folder, by
// the convention design-lab:init recorded (scripts/lab_config.py holds the same rule).

async function exists($: EngineInterface, path: string): Promise<boolean> {
  return $.fs.exists(path).catch(() => false)
}

async function hasMarker($: EngineInterface, folder: string): Promise<boolean> {
  for (const marker of MARKERS) if (await exists($, `${folder}/${marker}`)) return true
  return false
}

/** The person's design-lab settings, or {} before design-lab:init has run. */
async function settings($: EngineInterface): Promise<{ convention?: string; home?: string }> {
  const home = await $.env.get('HOME')
  const path = (await $.env.get('DESIGN_LAB_CONFIG')) ?? (home ? `${home}/.claude/design-lab.json` : undefined)
  const text = path ? await $.fs.read(path).catch(() => undefined) : undefined
  const value = parseJson(typeof text === 'string' ? text : undefined) as { runs?: { convention?: unknown } } | undefined
  const convention = typeof value?.runs?.convention === 'string' ? value.runs.convention : undefined
  return { convention, home }
}

/** The project folder for a session in `cwd`: above worktrees/ for PROJECT/worktrees/<name>,
 * else the nearest folder above the repository holding plans/, analysis-reports/ or design/. */
async function projectFolder($: EngineInterface, cwd: string, home?: string): Promise<string | undefined> {
  const stop = (folder: string) => folder === '/' || folder === home
  const chain = ancestors(cwd)
  let repo: string | undefined
  for (const folder of chain) if (await exists($, `${folder}/.git`)) { repo = folder; break }
  if (!repo) {
    for (const folder of chain) {
      if (stop(folder)) return undefined
      if (await exists($, `${folder}/worktrees`) || await hasMarker($, folder)) return folder
    }
    return undefined
  }
  if (base(parent(repo)) === 'worktrees') return parent(parent(repo))
  for (const folder of ancestors(parent(repo))) {
    if (stop(folder)) return undefined
    if (await hasMarker($, folder)) return folder
  }
  return undefined
}

/** Where this project's runs live, or undefined when design-lab:init has not chosen. */
async function runsFolder($: EngineInterface, cwd: string): Promise<string | undefined> {
  const { convention, home } = await settings($)
  const project = await projectFolder($, cwd, home)
  if (convention === 'project') return project ? `${project}/design` : undefined
  if (convention === 'home' && home) {
    let repo: string | undefined
    for (const folder of ancestors(cwd)) if (await exists($, `${folder}/.git`)) { repo = folder; break }
    return `${home}/.design/${base(project ?? repo ?? cwd)}`
  }
  return undefined
}

/** The newest run in a runs folder, by when each began (its project.json createdAt). */
async function newestRun($: EngineInterface, folder: string): Promise<string | undefined> {
  const entries = await $.fs.list(folder).catch(() => [])
  let best: { created: string; path: string } | undefined
  for (const entry of entries) {
    if (entry.kind !== 'dir') continue
    const path = `${folder}/${entry.name}`
    const text = await $.fs.read(`${path}/project.json`).catch(() => undefined)
    const created = (parseJson(typeof text === 'string' ? text : undefined) as { createdAt?: unknown } | undefined)?.createdAt
    if (typeof created !== 'string') continue
    if (!best || created > best.created) best = { created, path }
  }
  return best?.path
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
    if ((await read($, runAtom)) || (await read($, followAtom))) {
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
    // Named, a run is watched as named; found by convention, the pane follows the runs folder.
    const follow = e.args.trim() ? null : typeof run === 'string'
      ? (await runsFolder($, await $.session.cwd())) ?? null : run.follow ?? null
    await update($, followAtom, () => follow)
    if (typeof run !== 'string') {
      if (!follow) return { text: run.missing }
      await update($, runAtom, () => null)
      await update($, summaryAtom, () => null)
      watch($)
      if ((await $.session.surfaces()).length > 0) await $.ui.open({ id: PANE, title: 'design-lab', focus: true })
      return { text: run.missing }
    }
    await update($, runAtom, () => run)
    await update($, alarmedAtom, () => false)
    await refresh($)
    watch($)
    const summary = (await read($, summaryAtom)) ?? (await summarise($, run))
    if ((await $.session.surfaces()).length === 0) return { text: plainOf(summary) }
    // The person asked for it: bring it to the front, over any other pane already open.
    const opened = await $.ui.open({ id: PANE, title: 'design-lab', focus: true })
    return { text: opened.isPlaced ? `Watching ${summary.siteLabel ?? run}.` : plainOf(summary) }
  })

  on('command.run', { command: RECAP_COMMAND }, async ($, e) => {
    const run = await runOf($, e.args)
    if (typeof run !== 'string') return { text: run.missing }
    const summary = await summarise($, run)
    if (!summary.found) return { text: plainOf(summary) }
    return { text: summary.recap ?? `${summary.siteLabel ?? run} has no recap yet: the run has not finished its benchmark.` }
  })

  // The recap's output row, drawn as the Markdown it is, so its links are links.
  on('ui.render', { component: 'CommandOutput', props: { command: RECAP_COMMAND } }, async ($, e, next) => {
    if (!e.props.text) return next(e)
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const summary = await read($, summaryAtom)
    const run = await read($, runAtom)
    // The pane's ✕ sits on its first row: start one row lower so it never covers text.
    const follow = await read($, followAtom)
    if (!summary || !run) {
      return <Box marginTop={1}><Text dimColor>{follow
        ? `No design-lab run yet in ${follow}. It appears here as soon as one starts.`
        : 'No design-lab run is being watched.'}</Text></Box>
    }
    if (!summary.found) return <Box marginTop={1}><Text>{plainOf(summary)}</Text></Box>
    const runner = summary.runner
    const steps = runner ? stepsLine(runner) : null
    const preflight = summary.preflight
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold wrap="truncate-end">{summary.siteLabel ?? run}</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Preflight</Text>
          {preflight?.checks && !preflightPassed(summary)
            ? preflight.checks.map(check => {
              const message = checkMessage(check)
              return (
                <Box key={`check-${check.id}`} flexDirection="column">
                  <Text dimColor={check.status === 'waiting'}
                    color={check.status === 'needs-you' ? 'yellow' : check.status === 'failed' ? 'red' : undefined}>
                    {CHECK_MARKS[check.status] ?? '·'} {check.label}
                  </Text>
                  {message && <Text dimColor={check.status === 'checking'}>  {message}</Text>}
                </Box>
              )
            })
            : (
              <Text dimColor={preflight?.status !== 'complete'}>
                {preflight?.status === 'complete'
                  ? `✓ passed${clockOf(preflight.at) ? ` at ${clockOf(preflight.at)}` : ''}${preflight.checks ? `, ${preflight.checks.length} checks` : ''}`
                  : preflight ? `· ${preflight.status}` : '· not yet'}
              </Text>
            )}
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
            {/* A finished run's server is stopped on purpose: no runner line, no false alarm. */}
            {!summary.hasRecap && (
              <Text color={runner.connected ? 'green' : isIdle(runner) ? undefined : 'yellow'} dimColor={isIdle(runner)}>{runnerLine(runner)}</Text>
            )}
          </Box>
        )}
        {summary.waiting && !summary.blocker && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">Needs you: {summary.waiting}</Text>
          </Box>
        )}
        {summary.blocker && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">Needs you: {summary.blocker}</Text>
            <Button key="resume" label="Runner restarted, resume" onPress={() => void resume($, run)} />
          </Box>
        )}
        {summary.recap && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Recap</Text>
            <Markdown text={summary.recap} />
          </Box>
        )}
        {summary.log.length > 0 && !summary.hasRecap && (
          <Box flexDirection="column" marginTop={1}>
            {summary.log.map((line, i) => <Text key={`log-${i}`} dimColor wrap="truncate-end">{line}</Text>)}
          </Box>
        )}
      </Box>
    )
  })
}
