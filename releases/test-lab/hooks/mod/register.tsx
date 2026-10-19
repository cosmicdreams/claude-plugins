// test-lab's mod: one pane and two registered tools. `run` starts a preflight, fast run or policy check
// through the core's runner (src/mod-entry.ts, started with the host's $.process.run, since a hooks
// module has no Node) and returns the verdict the core wrote. `verdict` shows an existing run folder's
// verdict. The pane shows the run while it goes on, then the verdict with the core's whole handoff:
// context and build identity, reasons, scope counts, required cases, every failure seen, the named
// exceptions, scope changes and what is outside the verdict. It offers the HTML report only when the
// run was made on this machine and the surface draws here (src/artifacts.ts), and summary only
// otherwise. The mod computes no verdict.
//
// What the pane shows is kept in the store, one key per operation and one for what is shown, and in the
// run's own files, never in module memory: it is the same after a hot reload, concurrent operations
// never overwrite each other's records, and different sessions never see each other's runs.

import type { EngineInterface, Register } from 'claude-code'

import { LOCAL_SURFACES, presentArtifacts, type ArtifactPresentation, type Surface } from '../../src/artifacts.ts'
import { COLOR, LABEL, checkLine, contextLines, countLine, parseVerdict, standing, summaryText, type PaneVerdict } from './model.ts'
import {
  HOST_GRACE_MS, KEEP_SESSION_MS, LIVE_STATES, OPERATION_LABEL, RUN_SCHEMA,
  bindingProblem, entryArgv, evictable, operationKey, operationPrefix, parseRecord, parseRunInput, parseShown, parseStatus, progressText, shouldPoll, recordOf, requestOf, runFolderOf, shownKey, stripRecord,
  type InputValue, type OperationRecord, type ProgressState, type RunInput, type RunStatus, type Shown,
} from './operation.ts'

export const PANE = 'test-lab'
export const TOOL = 'verdict'
export const TOOL_NAME = 'mcp__test-lab__verdict'
export const RUN_TOOL = 'run'
export const RUN_TOOL_NAME = 'mcp__test-lab__run'
const ENVELOPE: ReadonlySet<string> = new Set(['tool', 'tool_use_id', 'agentId'])
const PBCOPY = '/usr/bin/pbcopy'

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

const firstLine = (text: string): string => (text.trim().split('\n')[0] ?? '').slice(0, 300)

/** Where a path really lands, or undefined when it doesn't exist. */
async function realPath($: EngineInterface, path: string): Promise<string | undefined> {
  return (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
}

/** This machine's test-lab identity, from the data folder the core uses (src/work.ts dataDir). */
async function engineMachine($: EngineInterface): Promise<string | null> {
  const override = await $.env.get('TEST_LAB_DATA')
  const home = await $.env.get('HOME')
  const xdg = await $.env.get('XDG_DATA_HOME')
  const dirs = override ? [override] : home ? [`${home}/Library/Application Support/test-lab`, `${xdg ?? `${home}/.local/share`}/test-lab`] : []
  for (const dir of dirs) {
    const text = await readText($, `${dir}/machine-id`)
    if (text !== undefined && text.trim() !== '') return text.trim()
  }
  return null
}

// --- The session's records: one store key per operation, written only by the call that started it ---

async function operations($: EngineInterface, session: string): Promise<OperationRecord[]> {
  const prefix = operationPrefix(session)
  const records: OperationRecord[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(prefix)) continue
    const record = parseRecord(await $.store.get(key).catch(() => undefined), session)
    if (record !== null) records.push(record)
  }
  return records.sort((a, b) => a.startedAt - b.startedAt)
}

async function operation($: EngineInterface, session: string, id: string): Promise<OperationRecord | null> {
  return parseRecord(await $.store.get(operationKey(session, id)).catch(() => undefined), session)
}

async function saveOperation($: EngineInterface, record: OperationRecord): Promise<void> {
  await $.store.set(operationKey(record.session, record.id), record)
}

async function shown($: EngineInterface, session: string): Promise<Shown> {
  const value = await $.store.get(shownKey(session)).catch(() => undefined)
  return parseShown((value as { shown?: unknown } | undefined)?.shown)
}

async function show($: EngineInterface, session: string, what: Shown): Promise<void> {
  await $.store.set(shownKey(session), { at: await $.clock.now(), shown: what })
}

/** Completed records past this session's history cap; an operation still under way is never evicted. */
async function evict($: EngineInterface, session: string): Promise<void> {
  for (const record of evictable(await operations($, session))) await $.store.delete(operationKey(session, record.id))
}

/** Records older than the retention period, and the single-record layout of earlier versions. */
async function prune($: EngineInterface, now: number): Promise<void> {
  for (const key of await $.store.keys()) {
    const value = await $.store.get(key).catch(() => undefined) as Record<string, unknown> | undefined
    const at = key.startsWith('op:') ? value?.['startedAt'] : key.startsWith('shown:') ? value?.['at'] : undefined
    const active = key.startsWith('op:') && (value?.['phase'] === 'preparing' || value?.['phase'] === 'launched')
    const current = key.startsWith('shown:') && typeof value?.['shown'] === 'object' && value['shown'] !== null ? value['shown'] as Record<string, unknown> : null
    const shownOperation = current?.['kind'] === 'operation' && typeof current['id'] === 'string' ? await $.store.get(`${key.replace('shown:', 'op:')}:${current['id']}`).catch(() => undefined) as Record<string, unknown> | undefined : undefined
    const showingActive = shownOperation?.['phase'] === 'preparing' || shownOperation?.['phase'] === 'launched'
    if (key.startsWith('session:') || (!active && !showingActive && typeof at === 'number' && at < now - KEEP_SESSION_MS)) await $.store.delete(key)
  }
}

async function showPane($: EngineInterface): Promise<void> {
  if ((await $.session.surfaces()).length > 0) await $.ui.open({ id: PANE, title: 'test-lab' }).catch(() => undefined)
  $.ui.invalidate('ui.render')
}

// --- Reading a run folder ---

/**
 * A run folder's verdict, read only where the folder really is: the folder and its verdict.json are
 * resolved first, and the verdict must name that resolved folder.
 */
async function readVerdict($: EngineInterface, runDir: string): Promise<PaneVerdict | { error: string }> {
  const dir = runDir.replace(/\/+$/, '')
  const real = await realPath($, dir)
  if (real === undefined) return { error: 'no verdict.json in that run folder' }
  const file = `${real}/verdict.json`
  const fileReal = await realPath($, file)
  if (fileReal === undefined) return { error: 'no verdict.json in that run folder' }
  if (fileReal !== file) return { error: `verdict.json there resolves outside the run folder (${fileReal}), so it is not shown` }
  // Failure classes live beside the verdict; they never change it, and an absent file adds nothing.
  const triage = `${real}/triage.json`
  const triageText = await realPath($, triage) === triage ? await readText($, triage) : undefined
  const parsed = parseVerdict(await readText($, file), triageText)
  if (!('error' in parsed) && parsed.runDir.replace(/\/+$/, '') !== real) return { error: `verdict.json names another run folder (${parsed.runDir})` }
  return parsed
}

async function present($: EngineInterface, v: PaneVerdict, surface: Surface): Promise<ArtifactPresentation> {
  const index = `${v.runDir}/html/index.html`
  // A report reached through a link out of the run folder is not this run's report.
  const reportExists = await realPath($, index) === index
  return presentArtifacts({ runDir: v.runDir, runMachine: v.machine, engineMachine: await engineMachine($), reportExists, openReport: v.openReport, surface })
}

type OperationView =
  | { kind: 'progress'; state: ProgressState; text: string; missing: boolean }
  | { kind: 'verdict'; status: RunStatus; verdict: PaneVerdict | { error: string } }

/**
 * An operation as its own files tell it, each read checked against what this mod recorded: the status
 * must name this operation, its run folder must really be one of the suite's runs, and the verdict
 * there must agree with the status, the request and, once the host call returned, its exit code.
 */
async function viewOf($: EngineInterface, op: OperationRecord, now: number): Promise<OperationView> {
  const text = await readText($, `${op.dir}/status.json`)
  const status = parseStatus(text, { id: op.id, operation: op.input.operation })
  if ('error' in status || status.state !== 'finished') return { kind: 'progress', missing: text === undefined, ...progressText(op, status, now, text === undefined) }
  const result = status.result!
  const unreadable = (error: string): OperationView => ({ kind: 'verdict', status, verdict: { error } })
  const runDir = runFolderOf(status.runDir!, op.suiteReal)
  if (runDir === null) return unreadable(`the run reported a folder outside ${op.suiteReal}/.test-lab/runs, so it is not shown`)
  const real = await realPath($, runDir)
  if (real !== runDir) return unreadable(real === undefined ? `the run folder ${runDir} does not exist` : `the run folder resolves outside ${op.suiteReal}/.test-lab/runs (${real}), so it is not shown`)
  if (op.exit !== null && op.exit.code !== null && op.exit.code !== result.exitCode) return unreadable(`the runner exited ${op.exit.code} but its status says ${result.exitCode}, so neither is shown as the result`)
  const verdict = await readVerdict($, runDir)
  if ('error' in verdict) return { kind: 'verdict', status, verdict }
  const problem = bindingProblem(op, status, { runDir: verdict.runDir, environment: verdict.environment, startedAt: verdict.startedAt, finishedAt: verdict.finishedAt, verdict: verdict.verdict, rule: verdict.rule, requestIdentity: verdict.requestIdentity, context: verdict.context === null ? null : { appRoot: verdict.context.appRoot, suiteRoot: verdict.context.suiteRoot, environmentId: verdict.context.environment.id } })
  return problem === null ? { kind: 'verdict', status, verdict } : unreadable(problem)
}

// --- Starting an operation ---

type Runner = { node: string; sessions: string }

/** Where the runner keeps operations, from the runner itself, so mod and core never disagree. */
async function locateRunner($: EngineInterface): Promise<Runner | { error: string }> {
  const node = (await $.env.get('TEST_LAB_NODE')) || 'node'
  let answer
  try {
    answer = await $.process.run([node, `${$.plugin.root}/src/mod-entry.ts`, '--data-dir'], { timeoutMs: 15_000 })
  } catch {
    return { error: 'Node.js 24 or newer must be on PATH to run test-lab (or set TEST_LAB_NODE to its absolute path)' }
  }
  if (answer.exitCode !== 0) return { error: `test-lab's runner did not start: ${firstLine(answer.stderr) || `exit ${answer.exitCode}`}` }
  try {
    const parsed = JSON.parse(answer.stdout) as Record<string, unknown>
    const sessions = parsed['sessions']
    const version = parsed['node']
    const runtime = parsed['runtime']
    if (typeof sessions !== 'string' || !sessions.startsWith('/') || typeof version !== 'string' || typeof runtime !== 'object' || runtime === null) throw new Error('unexpected answer')
    if (Number(version.split('.')[0]) < 24) return { error: `test-lab needs Node.js 24 or newer; ${node} is ${version}` }
    const problem = (runtime as Record<string, unknown>)['problem']
    if (typeof problem === 'string') return { error: problem }
    return { node, sessions }
  } catch {
    return { error: 'test-lab\'s runner gave an answer this mod does not understand' }
  }
}

// A redraw timer, not state: the pane starts it while it draws an operation whose runner may be alive
// and stops it otherwise, when the pane closes or is no longer open, and when the session ends. A hot
// reload cancels the old module's timers itself.
let ticker: { cancel: () => void } | null = null

async function redraw($: EngineInterface): Promise<void> {
  const open = (await $.ui.panes().catch(() => [])).some(pane => pane.id === PANE)
  if (open) $.ui.invalidate('ui.render')
  else tick($, false)
}

function tick($: EngineInterface, on: boolean): void {
  if (on && ticker === null) ticker = $.clock.every(1000, () => void redraw($))
  if (!on && ticker !== null) {
    ticker.cancel()
    ticker = null
  }
}

const notStarted = (label: string): string => `test-lab ${label.toLowerCase()}: interrupted before it started; nothing ran.`

/** Exported for the abort tests, which need a real AbortSignal the host test kit can't send. */
export async function startOperation($: EngineInterface, input: RunInput, signal?: AbortSignal): Promise<string> {
  const label = OPERATION_LABEL[input.operation]
  // An interrupted call starts nothing; the checks repeat after every wait before the runner starts.
  if (signal?.aborted) return notStarted(label)
  const runner = await locateRunner($)
  if ('error' in runner) return `test-lab ${label.toLowerCase()}: ${runner.error}`
  const suite = await realPath($, input.suiteRoot)
  if (suite === undefined) return `test-lab ${label.toLowerCase()}: ${input.suiteRoot} does not exist`
  const app = await realPath($, input.appRoot)
  if (app === undefined) return `test-lab ${label.toLowerCase()}: ${input.appRoot} does not exist`
  if (signal?.aborted) return notStarted(label)
  const session = await $.session.id()
  const now = await $.clock.now()
  const id = `${now}-${crypto.randomUUID()}`
  const dir = `${runner.sessions}/${session.replace(/[^A-Za-z0-9._-]/g, '_')}/${id}`
  let record = recordOf(session, id, dir, input, { suite, app }, now)
  const request = await requestOf(id, dir, input, { suite, app })
  record = { ...record, requestIdentity: request.requestIdentity }
  await $.fs.write(`${dir}/request.json`, `${JSON.stringify(request)}\n`)
  if (input.inputs !== null) await $.fs.write(`${dir}/inputs.json`, `${JSON.stringify(input.inputs)}\n`)
  await saveOperation($, record)
  await show($, session, { kind: 'operation', id })
  // From here a stop is a `cancel` file, which the runner honours before and during its run.
  const stop = () => void $.fs.write(`${dir}/cancel`, 'stop\n').catch(() => undefined)
  signal?.addEventListener('abort', stop, { once: true })
  let failure: string | null = null
  let code: number | null = null
  try {
    await showPane($)
    if (signal?.aborted) {
      record = { ...record, phase: 'not-started' }
      await saveOperation($, record)
      return notStarted(label)
    }
    record = { ...record, phase: 'preparing' }
    await saveOperation($, record)
    if (signal?.aborted) {
      record = { ...record, phase: 'not-started' }
      await saveOperation($, record)
      return notStarted(label)
    }
    $.ui.status(`test-lab: ${label.toLowerCase()} running`)
    const argv = entryArgv(runner.node, $.plugin.root, dir, input, input.inputs === null ? null : `${dir}/inputs.json`)
    record = { ...record, phase: 'launched', launchedAt: await $.clock.now() }
    // No preparation wait separates this timestamp from dispatch. Persist while the host runs.
    const running = $.process.run(argv, { cwd: input.suiteRoot, timeoutMs: input.timeoutMs + HOST_GRACE_MS }).then(exit => ({ exit }), error => ({ error }))
    await saveOperation($, record).catch(() => undefined)
    const settled = await running
    if ('error' in settled) throw settled.error
    const exit = settled.exit
    code = exit.exitCode
    if (exit.exitCode !== 0) failure = firstLine(exit.stderr) || `exit ${exit.exitCode}`
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    signal?.removeEventListener('abort', stop)
    $.ui.status(undefined)
  }
  record = { ...record, phase: 'ended', exit: { code, failure } }
  await saveOperation($, record)
  await evict($, session).catch(() => undefined)
  $.ui.invalidate('ui.render')
  const view = await viewOf($, record, await $.clock.now())
  if (view.kind === 'progress') {
    // No verdict: the runner refused the request, failed, was stopped first, or never finished. Say so.
    if (view.state === 'failed') return `test-lab ${view.text}`
    return `test-lab ${label.toLowerCase()} did not finish. ${view.text}${view.missing || failure === null || view.state === 'stopped' ? '' : ` The host reported: ${failure}.`}`
  }
  $.ui.toast(`test-lab: ${label.toLowerCase()} ${'error' in view.verdict ? 'finished, result not shown' : LABEL[view.verdict.verdict]}`)
  if ('error' in view.verdict) return `test-lab ${label.toLowerCase()} finished, but its result is not shown: ${view.verdict.error}`
  // A Not ready, Inconclusive or Not evaluable verdict is an answer, not a failure of the tool.
  const head = `test-lab ${label.toLowerCase()} finished (exit ${view.status.result!.exitCode}).`
  return [head, ...(input.operation === 'verify' ? [view.status.result!.summary] : []), summaryText(view.verdict)].join('\n')
}

/** Run again: the same operation with the arguments recorded for it, its inputs from its own folder. */
async function rerun($: EngineInterface, op: OperationRecord): Promise<void> {
  const raw = stripRecord(op.input as unknown as Record<string, unknown>)
  if (op.input.hasInputs) {
    const text = await readText($, `${op.dir}/inputs.json`)
    try {
      raw['inputs'] = JSON.parse(text ?? '') as Record<string, InputValue>
    } catch {
      $.ui.toast('test-lab: that run\'s inputs are gone, so it cannot be run again')
      return
    }
  }
  const input = parseRunInput(raw)
  if ('error' in input) {
    $.ui.toast(`test-lab: that run cannot be run again (${input.error})`)
    return
  }
  const answer = await startOperation($, input)
  $.ui.log(answer.split('\n')[0] ?? answer)
}

async function copySummary($: EngineInterface, text: string): Promise<void> {
  try {
    const r = await $.process.run([PBCOPY], { stdin: text, timeoutMs: 5_000 })
    $.ui.toast(r.exitCode === 0 ? 'test-lab: summary copied' : `test-lab: could not copy the summary (${firstLine(r.stderr) || `exit ${r.exitCode}`})`)
  } catch (error) {
    $.ui.toast(`test-lab: could not copy the summary (${firstLine(error instanceof Error ? error.message : String(error))})`)
  }
}

async function openReport($: EngineInterface, argv: string[]): Promise<void> {
  try {
    const r = await $.process.run(argv, { timeoutMs: 15_000 })
    if (r.exitCode !== 0) $.ui.toast(`test-lab: could not open the report (${firstLine(r.stderr) || `exit ${r.exitCode}`})`)
  } catch (error) {
    $.ui.toast(`test-lab: could not open the report (${firstLine(error instanceof Error ? error.message : String(error))})`)
  }
}

const requestStop = ($: EngineInterface, op: OperationRecord) => void $.fs.write(`${op.dir}/cancel`, 'stop\n').then(() => $.ui.toast('test-lab: stopping; the verdict will say it was interrupted'), () => $.ui.toast('test-lab: could not ask the run to stop'))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: TOOL,
      description: 'Show an existing test-lab run\'s verdict in the test-lab pane and return its summary. Give the run folder that holds verdict.json.',
      inputSchema: { type: 'object', properties: { runDir: { type: 'string', description: 'The run folder, absolute.' } }, required: ['runDir'] },
    })
    await $.tool.register({
      name: RUN_TOOL,
      description: 'Run test-lab on this machine and return the verdict the core wrote: a fast run on a local candidate (ready means ready to deploy for QA; human QA owns sign-off), a preflight, or a policy check. Every root, the environment and the adapter are explicit. Takes minutes; shows progress in the test-lab pane. A Not ready or Inconclusive verdict is a finished answer, not a tool failure.',
      inputSchema: RUN_SCHEMA as unknown as Record<string, unknown>,
    })
    await prune($, await $.clock.now()).catch(() => undefined)
    return next(e)
  })

  // Every operation the session leaves under way is asked to stop, including one whose runner has not
  // written its first status yet (the runner honours a `cancel` it finds at start); its own deadline
  // ends it otherwise.
  on('session.end', async ($, e, next) => {
    tick($, false)
    try {
      const session = await $.session.id()
      for (const op of await operations($, session)) {
        if (op.phase === 'ended' || op.phase === 'not-started') continue
        const status = parseStatus(await readText($, `${op.dir}/status.json`), { id: op.id, operation: op.input.operation })
        if ('error' in status || status.state === 'running') await $.fs.write(`${op.dir}/cancel`, 'session ended\n').catch(() => undefined)
      }
    } catch {
      // Best effort: the runner's deadline still ends the run.
    }
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) tick($, false)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__test-lab__run' }, async ($, e, next) => {
    const input = parseRunInput(e as Record<string, unknown>, ENVELOPE)
    if ('error' in input) return { deny: `test-lab run: ${input.error}` }
    return { result: await startOperation($, input, next.signal) }
  }).catch(() => ({ deny: 'test-lab run: the run could not be started' }))

  // A failure answers with an error, never a made-up summary.
  on('tool.call', { tool: 'mcp__test-lab__verdict' }, async ($, e) => {
    const runDir = (e as Record<string, unknown>)['runDir']
    if (typeof runDir !== 'string' || runDir === '') return { deny: 'test-lab verdict: give runDir, the run folder that holds verdict.json' }
    const parsed = await readVerdict($, runDir)
    await show($, await $.session.id(), { kind: 'verdict', runDir: 'error' in parsed ? runDir : parsed.runDir })
    await showPane($)
    return { result: 'error' in parsed ? `test-lab: ${parsed.error} (${runDir})` : summaryText(parsed) }
  }).catch(() => ({ deny: 'test-lab verdict: the verdict could not be read' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const session = await $.session.id()
    const what = await shown($, session)
    if (what === null) {
      tick($, false)
      return <Box marginTop={1}><Text dimColor>No test-lab run in this session yet. Ask Claude to run test-lab, or to show a run folder's verdict.</Text></Box>
    }
    let verdict: PaneVerdict | { error: string }
    let op: OperationRecord | null = null
    let heading: string | null = null
    if (what.kind === 'verdict') {
      tick($, false)
      verdict = await readVerdict($, what.runDir)
    }
    else {
      op = await operation($, session, what.id)
      if (op === null) {
        tick($, false)
        return <Box marginTop={1}><Text dimColor>That run is no longer recorded in this session.</Text></Box>
      }
      const view = await viewOf($, op, await $.clock.now())
      tick($, view.kind === 'progress' && LIVE_STATES.has(view.state) && shouldPoll(op, await $.clock.now()))
      if (view.kind === 'progress') {
        const record = op
        const live = LIVE_STATES.has(view.state)
        return (
          <Box marginTop={1} flexDirection="column" gap={1}>
            {view.state === 'running' || view.state === 'starting' ? <Text key="progress">{view.text}</Text> : <Text key="progress" color="yellow">{view.text}</Text>}
            {live ? <Button key="stop" label="Stop" hotkey="s" onPress={() => requestStop($, record)} /> : null}
            {live ? null : <Button key="run-again" label="Run again" hotkey="r" onPress={() => rerun($, record).catch(() => $.ui.toast('test-lab: could not run again'))} />}
          </Box>
        )
      }
      verdict = view.verdict
      heading = `${OPERATION_LABEL[op.input.operation]} · exit ${view.status.result!.exitCode}${op.input.operation === 'verify' ? ` · ${view.status.result!.summary}` : ''}`
    }
    const again = op
    if ('error' in verdict) {
      return (
        <Box marginTop={1} flexDirection="column" gap={1}>
          {heading === null ? null : <Text key="heading" dimColor>{heading}</Text>}
          <Text key="error" color="yellow">{verdict.error}</Text>
          {again === null ? null : <Button key="run-again" label="Run again" hotkey="r" onPress={() => rerun($, again).catch(() => $.ui.toast('test-lab: could not run again'))} />}
        </Box>
      )
    }
    const v = verdict
    const artifacts = await present($, v, e.surface)
    const canCopy = LOCAL_SURFACES.includes(e.surface) && await $.fs.exists(PBCOPY).catch(() => false)
    const list = (key: string, items: string[], dim = false) => <Box key={key} flexDirection="column">{items.map((x, i) => <Text key={`${key}-${i}`} dimColor={dim}>{`- ${x}`}</Text>)}</Box>
    return (
      <Box marginTop={1} flexDirection="column" gap={1}>
        {heading === null ? null : <Text key="heading" dimColor>{heading}</Text>}
        <Text key="verdict" bold color={COLOR[v.verdict]}>{`${LABEL[v.verdict]} (rule ${v.rule})`}</Text>
        <Text key="context" dimColor>{`${v.project} · ${v.environment} · ${v.finishedAt}`}</Text>
        <Text key="standing">{standing(v)}</Text>
        <Box key="identity" flexDirection="column">{contextLines(v).map((l, i) => <Text key={`identity-${i}`} dimColor>{l}</Text>)}</Box>
        {list('reasons', v.reasons)}
        {v.context === null ? null : <Text key="counts-heading" bold>Scope counts</Text>}
        {v.context === null ? null : list('counts', v.context.counts.map(countLine))}
        {v.context === null ? null : <Text key="checks-heading" bold>Build checks</Text>}
        {v.context === null ? null : list('checks', v.context.identityChecks.map(checkLine), true)}
        {v.context === null ? null : v.context.handoff.map((h, i) => <Box key={`handoff-${i}`} flexDirection="column"><Text key={`handoff-${i}-title`} bold>{h.title}</Text>{list(`handoff-${i}-items`, h.items.length === 0 ? ['none'] : h.items, true)}</Box>)}
        <Text key="required-heading" bold>{v.required.length === 0 ? 'No required cases' : `Required cases (${v.required.length})`}</Text>
        {list('required', v.required)}
        <Text key="failures-heading" bold>{v.failures.length === 0 ? 'No failures seen' : `Failures seen (${v.failures.length})`}</Text>
        {list('failures', v.failures)}
        {v.exceptions.length > 0 ? <Text key="exceptions-heading" bold>Exceptions</Text> : null}
        {list('exceptions', v.exceptions, true)}
        {v.scopeChanges.length > 0 ? <Text key="scope-heading" bold>Scope changes in this work</Text> : null}
        {list('scope', v.scopeChanges)}
        {v.outside.length > 0 ? <Text key="outside-heading" bold>Outside this verdict</Text> : null}
        {list('outside', v.outside, true)}
        {artifacts.mode === 'open'
          ? null
          : <Text key="summary-only" dimColor>{`Report: ${artifacts.path} (summary only: ${artifacts.reason})`}</Text>}
        <Box key="actions" flexDirection="row" gap={2}>
          {artifacts.mode === 'open' ? <Button key="open-report" label="Open report" hotkey="o" onPress={() => void openReport($, artifacts.argv)} /> : null}
          {canCopy ? <Button key="copy-summary" label="Copy summary" hotkey="c" onPress={() => void copySummary($, summaryText(v))} /> : null}
          {again === null ? null : <Button key="run-again" label="Run again" hotkey="r" onPress={() => rerun($, again).catch(() => $.ui.toast('test-lab: could not run again'))} />}
        </Box>
      </Box>
    )
  })
}
