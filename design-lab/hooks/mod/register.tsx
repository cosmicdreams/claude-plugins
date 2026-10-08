// design-lab's pane: where a run is and when it is done, from the files the run writes. It reads
// only run folders (and, to find them, the person's design-lab settings, the project's runs folder
// and the active-run pointer), writes nothing to disk, and asks nothing of the person except, when
// the runner has stopped, a button that puts the resume request in the prompt.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Summary as RunSummary } from '../../src/protocol'
type Summary = RunSummary<'mod'>
import {
  afterFill, barOf, CHECK_COLORS, CHECK_MARKS, checkMessage, compactOf, durationOf, elapsedOf, failureOf, needsYouOf, parseJson,
  percentOf, PHASE_DONE, phaseLabel, plainOf, RESUME_PROMPT, isIdle, runnerLine, stagesOf, statusOf, stepsLine,
  summaryOf, toneOf, verdictOf,
} from './model'
import { ancestors, base, MARKERS, parent } from './locate'

const PANE = 'design-lab'
const COMMAND = 'design-lab:watch'
const RECAP_COMMAND = 'design-lab:recap'
// The skills that start or resume a run: each opens the pane by itself, so nobody has to know
// about design-lab:watch to see where a run is.
export const RUN_SKILLS = ['design-lab:run', 'design-lab:figma-build'] as const
import { POLL_MS } from '../../src/protocol.ts'
export { POLL_MS } from '../../src/protocol.ts'
// The runner log is tailed only while it is small enough to read whole every poll.
const LOG_READ_LIMIT = 1024 * 1024

const runAtom = atom({ plugin: 'design-lab', key: 'run' } as const, null)
const summaryAtom = atom({ plugin: 'design-lab', key: 'summary' } as const, null)
const alarmedAtom = atom({ plugin: 'design-lab', key: 'alarmed' } as const, false)
// The runs folder the pane follows when the person named no run: it moves to each newer run there.
const followAtom = atom({ plugin: 'design-lab', key: 'follow' } as const, null)
// A finished run the pane passes over while a run skill is starting the next one, so the pane
// never shows the last run's recap as if it were the new run.
const skipAtom = atom({ plugin: 'design-lab', key: 'skip' } as const, null)
// Whether a finished run's full completion message is open under its figures.
// Named by run, so opening one run's recap never opens the next run's.
const recapOpenAtom = atom({ plugin: 'design-lab', key: 'recapOpen' } as const, null)

// The files read under a run folder, and nothing else there.
export const RUN_FILES = {
  project: 'project.json',
  phaseLog: 'phase-log.jsonl',
  progress: 'figma/progress.json',
  runnerLog: 'figma/runner.log',
  completion: 'benchmark/completion.md',
  scorecard: 'benchmark/scorecard.json',
  preflightChecks: 'preflight-checks.json',
  verifyReport: 'verify-report.json',
} as const

// The files a finished run links to, when they exist: a rebuild has no plan or components of its
// own unless it copied them.
export const ARTIFACT_FILES = {
  report: 'benchmark/report.html',
  verifyReport: 'verify-report.json',
  plan: 'plan.json',
  components: 'components.json',
  scorecard: 'benchmark/scorecard.json',
} as const

// The bar's fill by the color its Text would take, and its empty track.
const BAR_COLORS: Record<string, string> = { cyan: '#4fa8d6', green: '#3fb36b', yellow: '#d6b44f', red: '#d65f5f' }
const BAR_TRACK = '#8888884d'

/** A rounded progress bar, wide and short so it scales to the pane's width. */
function barSvg(share: number, fill: string): string {
  const filled = share > 0 ? `<rect width="${Math.max(12, share)}" height="12" rx="6" fill="${fill}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="12" viewBox="0 0 1000 12">`
    + `<rect width="1000" height="12" rx="6" fill="${BAR_TRACK}"/>${filled}</svg>`
}

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
    verifyReport: await readJson($, at(RUN_FILES.verifyReport)),
    runnerLog: await readLog($, at(RUN_FILES.runnerLog)),
    ...((await $.fs.exists(at(RUN_FILES.completion)))
      ? { completion: await readText($, at(RUN_FILES.completion)), scorecard: await readJson($, at(RUN_FILES.scorecard)),
        present: await presentOf($, run) }
      : {}),
  }
  return summaryOf(run, raw, await $.clock.now())
}

/** Which of the run's artifact files exist, so the pane links only to those. */
async function presentOf($: EngineInterface, run: string): Promise<string[]> {
  const found: string[] = []
  for (const path of Object.values(ARTIFACT_FILES)) if (await exists($, `${run}/${path}`)) found.push(path)
  return found
}

let refreshing = false

async function refresh($: EngineInterface): Promise<void> {
  // A slow file system must not stack refreshes: skip a tick while the last one is still reading.
  if (refreshing) return
  refreshing = true
  try {
    await refreshNow($)
  } finally {
    refreshing = false
  }
}

async function refreshNow($: EngineInterface): Promise<void> {
  const follow = await read($, followAtom)
  if (follow) {
    const newest = await newestRun($, follow)
    if (newest && newest !== (await read($, skipAtom)) && newest !== (await read($, runAtom))) {
      await update($, runAtom, () => newest)
      await update($, skipAtom, () => null)
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
    // Say what the header says: a run that left problems open is done but needs review.
    const review = verdictOf(summary.findings) ? ', with verification problems to review' : ''
    $.ui.toast(`design-lab: ${summary.siteLabel ?? 'the run'} is done${review}. The recap is in the design-lab pane.`, { timeoutMs: 10_000 })
  }
  // The watchdog: once per transition, never again until the run needs nothing from the person.
  // It says what the Needs you card says.
  const need = needsYouOf(summary)
  const alarmed = await read($, alarmedAtom)
  if (need && !alarmed) {
    $.ui.toast(`design-lab needs you: ${need.message}`, { timeoutMs: 10_000 })
    await update($, alarmedAtom, () => true)
  } else if (!need && alarmed) {
    await update($, alarmedAtom, () => false)
  }
}

function watch($: EngineInterface): void {
  timer?.cancel()
  timer = $.clock.every(POLL_MS, () => void refresh($))
}

/** The run a command names, or with none: the newest in this project's runs folder, which the pane
 * then follows; else the run the machine-wide pointer names. */
async function runOf($: EngineInterface, args: string): Promise<string | { missing: string; follow?: string }> {
  const given = args.trim()
  if (given) return given.startsWith('/') ? given.replace(/\/+$/, '') : `${await $.session.cwd()}/${given}`
  const folder = await runsFolder($, await $.session.cwd())
  if (folder) {
    const newest = await newestRun($, folder)
    return newest ?? { missing: `No design-lab run yet in ${folder}. The pane shows the first one as soon as it starts.`, follow: folder }
  }
  const home = await $.env.get('HOME')
  const pointer = parseJson(home ? await readText($, `${home}/.design-lab/active-run.json`) : undefined)
  const workspace = typeof pointer === 'object' && pointer !== null ? (pointer as { workspace?: unknown }).workspace : undefined
  if (typeof workspace === 'string') return workspace
  return { missing: (await settings($)).convention
    ? 'No design-lab run found for this folder. Give the run folder: /design-lab:watch <run folder>'
    : 'design-lab is not set up on this machine yet: run design-lab:init once. Or give the run folder: /design-lab:watch <run folder>' }
}

// Which run to watch when the person names none: the newest in this project's runs folder, by
// the convention design-lab:init recorded (src/lab-config.ts holds the same rule).

async function exists($: EngineInterface, path: string): Promise<boolean> {
  return $.fs.exists(path).catch(() => false)
}

async function isDir($: EngineInterface, path: string): Promise<boolean> {
  const found = await $.fs.stat(path, { resolve: false }).catch(() => undefined)
  return found?.kind === 'dir'
}

async function hasMarker($: EngineInterface, folder: string): Promise<boolean> {
  for (const marker of MARKERS) if (await isDir($, `${folder}/${marker}`)) return true
  return false
}

/** A path with every link followed, as the scripts resolve it; the path itself when it cannot be. */
async function real($: EngineInterface, path: string): Promise<string> {
  const found = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  return (found?.realPath ?? path).replace(/\/+$/, '') || '/'
}

/** The person's design-lab settings, or {} before design-lab:init has run. */
async function settings($: EngineInterface): Promise<{ convention?: string; home?: string }> {
  const rawHome = await $.env.get('HOME')
  const home = rawHome ? await real($, rawHome) : undefined
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
      if (await isDir($, `${folder}/worktrees`) || await hasMarker($, folder)) return folder
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
async function runsFolder($: EngineInterface, sessionCwd: string): Promise<string | undefined> {
  const { convention, home } = await settings($)
  const cwd = await real($, sessionCwd)
  const project = await projectFolder($, cwd, home)
  if (convention === 'project') return project ? `${project}/design` : undefined
  if (convention === 'home' && home) {
    let repo: string | undefined
    for (const folder of ancestors(cwd)) if (await exists($, `${folder}/.git`)) { repo = folder; break }
    return `${home}/.design/${base(project ?? repo ?? cwd)}`
  }
  return undefined
}

// When each run began, read once per run folder: a run's start never changes, so a poll lists the
// runs folder and reads only the project.json of runs it has not seen.
const startedAt = new Map<string, string>()

/** The newest run in a runs folder: latest start (project.json createdAt), then folder name. */
async function newestRun($: EngineInterface, folder: string): Promise<string | undefined> {
  const entries = await $.fs.list(folder).catch(() => [])
  let best: { created: string; name: string; path: string } | undefined
  for (const entry of entries) {
    if (entry.kind !== 'dir') continue
    const path = `${folder}/${entry.name}`
    let created = startedAt.get(path)
    if (created === undefined) {
      const text = await $.fs.read(`${path}/project.json`).catch(() => undefined)
      const value = (parseJson(typeof text === 'string' ? text : undefined) as { createdAt?: unknown } | undefined)?.createdAt
      if (typeof value !== 'string') continue
      startedAt.set(path, value)
      created = value
    }
    if (!best || created > best.created || (created === best.created && entry.name > best.name)) {
      best = { created, name: entry.name, path }
    }
  }
  return best?.path
}

/** A run skill is starting: follow this project's runs folder and open the pane beside the
 * conversation. A newest run with no recap yet is the one being resumed, so it shows at once; a finished
 * one is passed over until the new run's folder appears. Opened from the person's own slash
 * command, Claude Code places the pane at any width; from the Skill tool, only in a wide window. */
async function followRunSkill($: EngineInterface): Promise<void> {
  const folder = await runsFolder($, await $.session.cwd())
  // Not set up yet: the skill sends the person to design-lab:init first.
  if (!folder) return
  const newest = await newestRun($, folder)
  const summary = newest ? await summarise($, newest) : undefined
  const resuming = newest && summary?.found && !summary.hasRecap ? newest : null
  await update($, followAtom, () => folder)
  await update($, skipAtom, () => resuming ? null : newest ?? null)
  await update($, runAtom, () => resuming)
  await update($, summaryAtom, () => resuming ? summary! : null)
  await update($, alarmedAtom, () => false)
  watch($)
  if (resuming) void refresh($)
  if ((await $.session.surfaces()).length > 0) await $.ui.open({ id: PANE, title: 'design-lab' }).catch(() => undefined)
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
    await update($, skipAtom, () => null)
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

  // Typed as a slash command: the person asked, so the pane opens at any width.
  for (const command of RUN_SKILLS) {
    on('command.run', { command }, async ($, e, next) => {
      await followRunSkill($).catch(() => undefined)
      return next(e)
    })
  }

  // Called through the Skill tool (the person asked in their own words): the same, unasked. A typed
  // command raises this too, after command.run; following again then changes nothing.
  on('skill.prompt', async ($, e, next) => {
    if ((RUN_SKILLS as readonly string[]).includes(e.skill)) {
      await followRunSkill($).catch(() => undefined)
    }
    return next(e)
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
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = elements
    // Drawn surfaces (desktop, editor, phone) draw the bar as a vector; the terminal as cells.
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    const summary = await read($, summaryAtom)
    const run = await read($, runAtom)
    // The pane's ✕ sits on its first row: start one row lower so it never covers text.
    const follow = await read($, followAtom)
    if (!summary || !run) {
      const skip = await read($, skipAtom)
      return <Box marginTop={1} flexDirection="column" gap={1}>
        <Text bold>design-lab</Text>
        <Text dimColor>{follow
          ? skip
            ? 'Waiting for the new design-lab run to start. It appears here as soon as its folder is made.'
            : `No design-lab run yet in ${follow}. It appears here as soon as one starts.`
          : 'No design-lab run is being watched.'}</Text>
      </Box>
    }
    if (!summary.found) return <Box marginTop={1}><Text>{plainOf(summary)}</Text></Box>
    const now = await $.clock.now()
    const columns = e.props.bodyColumns
    // The card around the bar takes margin 2, border 2 and padding 2; the rest is slack.
    const width = Math.max(4, columns - 10)
    const tone = toneOf(summary)
    const stages = stagesOf(summary)
    const need = needsYouOf(summary)
    const failure = failureOf(summary)
    const runner = summary.runner
    const preflight = summary.preflight
    const scores = summary.scores
    const finished = summary.hasRecap
    const verdict = finished ? verdictOf(summary.findings) : null
    const recapOpen = (await read($, recapOpenAtom)) === run
    const time = finished ? durationOf(scores?.workingSeconds ?? null) : elapsedOf(summary.startedAt, now)
    const name = run.split('/').pop()
    // Finished with figures, the Time tile holds the time, so the subtitle does not repeat it.
    const subtitle = finished && scores ? [name] : [name, time && `${time} ${finished ? 'working time' : 'elapsed'}`]
    // Two tiles side by side need about 52 columns; narrower, they stack.
    const narrowTiles = columns < 52
    // Narrower still, a stage's steps go one per line.
    const narrowSteps = columns < 40

    // One figure in a quietly bordered tile: only the value carries color, so the tiles never
    // compete with a card that asks for attention.
    const tile = (key: string, label: string, value: string | null, details: (string | null)[], color: string | undefined) => (
      <Box key={`tile-${key}`} flexDirection="column" flexGrow={1} flexShrink={1} width={narrowTiles ? '100%' : '50%'}
        borderStyle="round" borderDimColor paddingX={1}>
        <Text dimColor>{label}</Text>
        <Text bold color={color}>{value ?? '–'}</Text>
        {details.filter(Boolean).map((detail, i) => <Text key={`${key}-${i}`} dimColor wrap="wrap">{detail}</Text>)}
      </Box>
    )
    // Coverage and accuracy are judgments: green only when nothing is missing, yellow otherwise.
    const judged = (share: number | null) => share === null ? undefined : share >= 100 ? 'green' : 'yellow'
    const progress = (done: number, total: number, color: string) => {
      if (Svg) {
        const share = Math.round(Math.min(1, Math.max(0, total > 0 ? done / total : 0)) * 1000)
        return <Svg alt={`${done} of ${total} steps`} source={barSvg(share, BAR_COLORS[color] ?? BAR_COLORS.cyan!)} />
      }
      const bar = barOf(done, total, width)
      return <Text wrap="truncate-end"><Text color={color}>{bar.filled}</Text><Text dimColor>{bar.empty}</Text></Text>
    }
    // A stage's phases as ticks: done, failed, under way (or waiting on the person), still to come.
    const steps = (phases: { name: string; status: string }[], stopped: boolean) => {
      const ticks = phases.map(phase => {
        const done = PHASE_DONE.has(phase.status)
        const failed = phase.status === 'failed'
        const current = phase.name === summary.current || phase.status === 'running'
        const color = done ? 'green' : failed ? 'red' : current ? (stopped ? 'yellow' : 'cyan') : undefined
        const mark = done ? '✓' : failed ? '✗' : current ? (stopped ? '!' : '▸') : '○'
        return { key: phase.name, color, current, quiet: !done && !failed && !current, text: `${mark} ${phaseLabel(phase.name)}` }
      })
      if (narrowSteps) {
        return <Box flexDirection="column">{ticks.map(t =>
          <Text key={t.key} color={t.color} dimColor={t.quiet} bold={t.current} wrap="truncate-end">{t.text}</Text>)}</Box>
      }
      return <Text wrap="wrap">{ticks.map((t, i) =>
        <Text key={t.key} color={t.color} dimColor={t.quiet} bold={t.current}>{i > 0 ? '  ' : ''}{t.text}</Text>)}</Text>
    }

    // What the open stage shows beneath its row: only the detail that stage needs.
    const detail = (id: string, state: string, phases: { name: string; status: string }[]) => {
      if (id === 'preflight') {
        return preflight?.checks
          ? preflight.checks.map(check => {
            const message = checkMessage(check)
            return (
              <Box key={`check-${check.id}`} flexDirection="column">
                <Text dimColor={check.status === 'waiting'} color={CHECK_COLORS[check.status]}>
                  {CHECK_MARKS[check.status] ?? '·'} {check.label}
                </Text>
                {message && <Text dimColor={check.status === 'checking'}>  {message}</Text>}
              </Box>
            )
          })
          : <Text dimColor>Checking the site, the tools and the Figma file.</Text>
      }
      if (id === 'build') {
        const stopped = state === 'stopped'
        const building = runner && runner.state === 'building' && runner.stepsTotal
        // Stopped, the Needs you card says what to do; the step count would only repeat the bar.
        const line = !runner || stopped || state === 'failed' ? null
          : runner.stepsTotal && (runner.state === 'building' || runner.state === 'done')
            ? `${runner.stepsDone ?? 0} of ${runner.stepsTotal} steps` : stepsLine(runner)
        return (
          <Box flexDirection="column" gap={1}>
            {steps(phases, stopped)}
            {(building || line) && runner && (
              <Box flexDirection="column">
                {building && progress(runner.stepsDone ?? 0, runner.stepsTotal!, stopped ? 'yellow' : state === 'failed' ? 'red' : 'cyan')}
                {line && <Text dimColor wrap="truncate-end">{line}</Text>}
              </Box>
            )}
            {runner && (
              <Text wrap="truncate-end">
                <Text color={runner.connected || runner.state === 'done' ? 'green' : isIdle(runner) ? 'gray' : 'yellow'}>● </Text>
                <Text dimColor={isIdle(runner)}>{runnerLine(runner)}</Text>
              </Text>
            )}
          </Box>
        )
      }
      if (id === 'verify') return <Text dimColor>Checking the file against the design-lab standard.</Text>
      if (id === 'report') return <Text dimColor>Scoring the run and writing the report.</Text>
      return steps(phases, state === 'stopped')
    }

    const MARK: Record<string, string> = { done: '✓', flagged: '!', active: '▸', stopped: '!', failed: '✗', pending: '○', reused: '↺' }
    const COLOR: Record<string, string | undefined> = {
      done: 'green', flagged: 'yellow', active: 'cyan', stopped: 'yellow', failed: 'red', pending: undefined, reused: undefined,
    }
    // One card opens: a failure first, then a stop for the person, then the first stage under way.
    const opened = stages.find(stage => stage.state === 'failed') ?? stages.find(stage => stage.state === 'stopped')
      ?? stages.find(stage => stage.state === 'active')

    return (
      <Box flexDirection="column" marginTop={1} gap={1}>
        {/* Header: what the run is, and where it stands in one colored word. */}
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text bold wrap="truncate-end">{summary.siteLabel ?? run}</Text>
            <Text bold inverse color={tone.color}>{`\u00a0${tone.label}\u00a0`}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">{subtitle.filter(Boolean).join(' · ')}</Text>
        </Box>

        {/* What went wrong, above everything else. */}
        {failure && (
          <Box key="failed" flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
            <Text bold color="red">Failed</Text>
            <Text>{failure.text}</Text>
          </Box>
        )}

        {/* The one thing the person has to do. */}
        {need && (
          <Box key="needs-you" flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
            <Text bold color="yellow">Needs you</Text>
            <Text>{need.message}</Text>
            {need.canResume && <Text dimColor>When the runner is open again, press Resume run.</Text>}
            {summary.facts.figmaUrl && <Markdown text={`[Open the Figma file ↗](${summary.facts.figmaUrl})`} />}
            {need.canResume && (
              <Box marginTop={1}>
                <Button key="resume" label="Resume run" onPress={() => void resume($, run)} />
              </Box>
            )}
          </Box>
        )}

        {/* The five stages, in order: one row each, the open one with its detail beneath. */}
        <Box flexDirection="column">
          {stages.map((stage, i) => {
            const lit = stage.state === 'active' || stage.state === 'stopped' || stage.state === 'failed'
            const color = COLOR[stage.state]
            return (
              <Box key={`stage-${stage.id}`} flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between" gap={1}>
                  <Box flexShrink={0}>
                    <Text bold={lit} dimColor={stage.state === 'pending' || stage.state === 'reused'}
                      color={lit || stage.state === 'flagged' ? color : undefined}>
                      <Text color={color}>{MARK[stage.state]}</Text> {i + 1}  {stage.label}
                    </Text>
                  </Box>
                  {stage.note ? <Text color={stage.noteColor} dimColor={!stage.noteColor && !lit}
                    wrap={stage.id === 'verify' ? 'wrap' : 'truncate-end'}>{stage.note}</Text> : null}
                </Box>
                {opened === stage && (
                  // Stopped, the card stays quiet: the Needs you card is the only yellow box.
                  <Box key={`card-${stage.id}`} flexDirection="column" marginLeft={2} marginY={1} paddingX={1} borderStyle="round"
                    borderColor={stage.state === 'stopped' ? undefined : color} borderDimColor>
                    {detail(stage.id, stage.state, stage.phases)}
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>

        {/* Finished: the verdict, the report's figures, then what the run made and where it is. */}
        {finished && (
          <Box flexDirection="column" gap={1}>
            {verdict && (
              <Box key="verdict" flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
                <Text bold color="yellow">Verification found problems</Text>
                <Text>{verdict}</Text>
                <Markdown text={`[Open the verification findings](${fileUrl(run, ARTIFACT_FILES.verifyReport)})`} />
              </Box>
            )}
            {scores && (() => {
              const coverage = percentOf(scores.built, scores.eligible)
              const accuracy = percentOf(scores.withinTolerance, scores.widths)
              const missing = scores.built !== null && scores.eligible !== null && scores.eligible > scores.built
                ? `${scores.eligible - scores.built} not built` : null
              return (
                <Box flexDirection="column" gap={1}>
                  <Box flexDirection={narrowTiles ? 'column' : 'row'} gap={1}>
                    {tile('coverage', 'Coverage', coverage !== null ? `${coverage}%` : null,
                      [scores.built !== null && scores.eligible !== null ? `${scores.built} of ${scores.eligible} buildable` : null, missing],
                      judged(coverage))}
                    {tile('accuracy', 'Accuracy', accuracy !== null ? `${accuracy}%` : null,
                      [scores.withinTolerance !== null && scores.widths !== null ? `${scores.withinTolerance} of ${scores.widths} widths within tolerance` : null],
                      judged(accuracy))}
                  </Box>
                  <Box flexDirection={narrowTiles ? 'column' : 'row'} gap={1}>
                    {tile('time', 'Time', durationOf(scores.workingSeconds),
                      [scores.buildSeconds !== null ? `Figma build ${durationOf(scores.buildSeconds)}` : null], 'magenta')}
                    {tile('tokens', 'Tokens', compactOf(scores.tokens),
                      [scores.toolCalls !== null ? `${scores.toolCalls} tool calls` : null], 'blue')}
                  </Box>
                </Box>
              )
            })()}
            {(() => {
              const links = artifactsOf(run, summary.facts.figmaUrl, new Set(summary.present))
              return (links.main || links.files) && (
                <Box flexDirection="column" gap={1}>
                  {links.main && (
                    <Box flexDirection="column">
                      <Text bold dimColor>Results</Text>
                      <Markdown text={links.main} />
                    </Box>
                  )}
                  {links.files && (
                    <Box flexDirection="column">
                      <Text bold dimColor>Run files</Text>
                      <Markdown text={links.files} />
                    </Box>
                  )}
                </Box>
              )
            })()}
            {summary.recap && (
              <Box flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between" alignItems="center">
                  <Text bold dimColor>Recap</Text>
                  <Button key="recap" label={recapOpen ? 'Hide' : 'Show'} onPress={() => void update($, recapOpenAtom, open => open === run ? null : run)} />
                </Box>
                {recapOpen && <Markdown text={summary.recap} />}
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}

/** A file in the run folder as a link: each path segment encoded, so a space, #, ? or bracket in a
 * folder name cannot end or break the link. */
export function fileUrl(run: string, path: string): string {
  const encode = (segment: string) => encodeURIComponent(segment).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `file://${`${run}/${path}`.split('/').map(encode).join('/')}`
}

/** What a finished run made, as links: the two that matter (the Figma file and the benchmark
 * report), then the run's own files. Only files that exist are listed. */
export function artifactsOf(run: string, figmaUrl: string | null, present: Set<string>): { main: string | null; files: string | null } {
  const main = [
    figmaUrl ? `**[Open the Figma library ↗](${figmaUrl})**` : null,
    present.has(ARTIFACT_FILES.report) ? `**[Open the benchmark report](${fileUrl(run, ARTIFACT_FILES.report)})**` : null,
  ].filter(Boolean)
  const files = ([
    ['Verification findings', ARTIFACT_FILES.verifyReport],
    ['Build plan', ARTIFACT_FILES.plan],
    ['Components', ARTIFACT_FILES.components],
    ['Scorecard', ARTIFACT_FILES.scorecard],
  ] as const).filter(([, path]) => present.has(path)).map(([label, path]) => `[${label}](${fileUrl(run, path)})`)
  // No bullets: Markdown indents them unevenly. The two results stand one per line (a hard break
  // is two trailing spaces); the run files share one line.
  return { main: main.length ? main.join('  \n') : null, files: files.length ? files.join(' · ') : null }
}
