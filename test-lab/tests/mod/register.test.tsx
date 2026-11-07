// The mod under the host's test kit (`claude plugin test`): the registered tools, the pane on the
// terminal and desktop surfaces, the report offered on the same machine and summary only elsewhere, the
// runner driven through `$.process.run`, and the pane's per-operation records. The runner here is a
// stand-in answering as src/mod-entry.ts does; tests/ts/mod-entry.test.ts and the Playwright suite run
// the real one. Mocked surfaces exercise the mod's hooks and trees; they are not live terminal or
// Desktop acceptance.

import type { On, RenderSurface } from 'claude-code'
import { describe, expect, mock, test, type TestBody } from 'claude-code/testing'

import { PANE, RUN_TOOL_NAME, TOOL_NAME } from '../../hooks/mod/register'

const HOME = '/home/person'
const RUN = '/runs/r1'
const MACHINE = 'machine-1'
const DATA = `${HOME}/Library/Application Support/test-lab`
const SESSIONS = `${DATA}/mod/sessions`
const SUITE = '/work/qa-suite'
const APP = '/work/app'
const SUITE_RUN = `${SUITE}/.test-lab/runs/2026-10-09T12-00-00-000Z-0b9f`
const OLD_RUN = `${SUITE}/.test-lab/runs/2026-10-08T09-00-00-000Z-77aa`
const NOW = Date.parse('2026-10-09T12:00:00Z')
const AT = new Date(NOW).toISOString()
const FIXTURE_IDENTITY = { schema: 1, operationId: 'op-1', requestHash: 'c'.repeat(64), inputsHash: 'd'.repeat(64), context: { operation: 'run', appRoot: APP, suiteRoot: SUITE, environment: 'local', work: null, noWork: true } }

const CONTEXT = {
  appRoot: APP,
  suiteRoot: SUITE,
  environment: { id: 'local', kind: 'local-candidate', baseUrl: 'http://qa:hunter2@127.0.0.1:8080/base?token=never-shown' },
  build: { commit: 'abc1234', digest: 'build-digest-1' },
  suite: { commit: 'def5678', digest: 'suite-digest-1' },
  corpusRevision: 'corpus-rev-1',
  identityChecks: [{ name: 'served worktree', status: 'ok', detail: 'the site serves /work/app' }],
  counts: [
    { track: 'regression', priority: 'Short', cases: 3, current: 3, verified: 2, waived: 1, developerAttested: 0 },
    { track: 'addendum', priority: 'Short', cases: 1, current: 1, verified: 0, waived: 0, developerAttested: 1 },
  ],
}

const verdict = (machine: string, kind = 'not-ready', extra: Record<string, unknown> = {}, runDir = RUN) =>
  JSON.stringify({
    schema: 1,
    requestIdentity: FIXTURE_IDENTITY,
    runDir,
    project: 'example',
    environment: 'local',
    startedAt: AT,
    finishedAt: AT,
    machine,
    openReport: ['open', `${runDir}/html/index.html`],
    context: CONTEXT,
    verdict: {
      verdict: kind,
      rule: kind === 'ready' ? 8 : 6,
      reasons: kind === 'ready' ? ['every required case has current passing evidence'] : ['governed test tests/g.spec.ts › g [desktop] is failed, with no live risk acceptance'],
      failures: kind === 'ready' ? [] : [{ lane: 'governed', project: 'chromium', outcome: 'failed', obligation: 'REG-2#1', classPrefill: null, acceptance: null, test: { file: 'tests/g.spec.ts', titlePath: ['g'] } }],
      exceptions: ['identity database: declared'],
      scopeChanges: [{ id: 'e1', kind: 'add', ticket: 'WORK-1', case: 'ADD-1', by: 'Dana Dev', role: 'developer', standIn: false, reason: 'covers the new filter', at: '2026-10-09T09:00:00Z' }],
      required: [
        { case: 'REG-1', track: 'regression', priority: 'Short', configuration: 'chromium@desktop', outcome: 'passed', obligations: [], quarantined: false },
        { case: 'REG-2', track: 'regression', priority: 'Short', configuration: 'chromium@desktop', outcome: kind === 'ready' ? 'passed' : 'failed', obligations: [], quarantined: false },
      ],
      outside: ['full tier: not run in a fast run'],
    },
    ...extra,
  })

const EXIT: Record<string, number> = { ready: 0, 'not-ready': 2, inconclusive: 3, 'not-evaluable': 4 }
const opId = (dir: string) => dir.slice(dir.lastIndexOf('/') + 1)
const status = (operation: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 3, requestIdentity: FIXTURE_IDENTITY, operationId: 'op-1', operation, state: 'running', startedAt: new Date(NOW - 80_000).toISOString(), updatedAt: new Date(NOW - 1_000).toISOString(), runDir: null, step: null, stopping: null, result: null, error: null, ...extra })
const finished = (operation: string, kind: string, runDir = SUITE_RUN, exitCode = EXIT[kind]!, operationId = 'op-1') =>
  status(operation, { operationId, state: 'finished', runDir, result: { exitCode, verdict: kind, rule: kind === 'ready' ? 8 : 6, summary: `${kind.toUpperCase()} (rule 6): reasons` } })

type Answer = { exitCode: number; stderr?: string | undefined }
type Runner = (operationDir: string, argv: readonly string[]) => Answer | Promise<Answer>

function world(on: On, files: Record<string, string>, options: { surfaces?: RenderSurface[]; session?: { id: string }; store?: Record<string, unknown>; runner?: Runner; node?: 'missing' | 'old'; runtime?: string; links?: Record<string, string> } = {}) {
  const ran: { argv: string[]; cwd?: string; timeoutMs?: number; stdin?: string }[] = []
  const opened: string[] = []
  const registered: { name: string; description: string }[] = []
  const toasts: string[] = []
  const counts = { invalidate: 0 }
  const panes = { open: true }
  const session = options.session ?? { id: 'session-a' }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, options.store ?? {})
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }) as never)
  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }))
  on('session.id', () => ({ value: session.id }))
  on('session.start', (_$, e) => ({ cwd: (e as { cwd?: string }).cwd }) as never)
  on('session.end', () => ({ sessionId: session.id }) as never)
  on('tool.register', (_$, e) => {
    registered.push({ name: e.name, description: e.description ?? '' })
    return { value: { tool: `mcp__test-lab__${e.name}` } }
  })
  on('fs.read', (_$, e) => {
    const text = files[e.path]
    return text === undefined ? { deny: 'missing' } : { value: text }
  })
  on('fs.write', (_$, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: e.path in files }))
  // Folders exist where the test put files under them; `links` say where a path really lands.
  on('fs.stat', (_$, e) => {
    const links = options.links ?? {}
    const link = Object.keys(links).find(from => e.path === from || e.path.startsWith(`${from}/`))
    const real = link === undefined ? e.path : `${links[link]}${e.path.slice(link.length)}`
    const known = real === SUITE || real === APP || real in files || Object.keys(files).some(f => f.startsWith(`${real}/`))
    return (known ? { value: { kind: real in files ? 'file' : 'dir', size: 0, mtimeMs: 0, isLink: link !== undefined, realPath: real } } : { deny: 'ENOENT' }) as never
  })
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: panes.open ? [{ id: PANE, title: 'test-lab', isShown: true, isFocused: false, isPlaced: true }] : [] }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', (_$, e, next) => {
    counts.invalidate++
    return next(e)
  })
  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    ran.push({ argv, ...(e.init?.cwd === undefined ? {} : { cwd: e.init.cwd }), ...(e.init?.timeoutMs === undefined ? {} : { timeoutMs: e.init.timeoutMs }), ...(e.init?.stdin === undefined ? {} : { stdin: e.init.stdin }) })
    if (argv[1]?.endsWith('/src/mod-entry.ts')) {
      if (options.node === 'missing') return { deny: 'ENOENT: node' }
      if (argv[2] === '--data-dir') return { value: { exitCode: 0, stdout: JSON.stringify({ sessions: SESSIONS, node: options.node === 'old' ? '22.12.0' : '24.19.1', runtime: options.runtime === undefined ? { ok: true } : { problem: options.runtime } }), stderr: '' } }
      const runner: Runner = options.runner ?? (() => ({ exitCode: 0 }))
      const r = await runner(argv[3]!, argv)
      // The stand-in runner propagates the validated request identity like the real runner/core.
      const request = JSON.parse(files[`${argv[3]}/request.json`] ?? '{}') as { requestIdentity?: unknown }
      for (const path of [`${argv[3]}/status.json`, ...Object.keys(files).filter(p => p.endsWith('/verdict.json'))]) {
        if (files[path] === undefined) continue
        const raw = JSON.parse(files[path]!) as Record<string, unknown>
        if (JSON.stringify(raw['requestIdentity']) === JSON.stringify(FIXTURE_IDENTITY)) {
          raw['requestIdentity'] = request.requestIdentity
          files[path] = JSON.stringify(raw)
        }
      }
      return { value: { exitCode: r.exitCode, stdout: '', stderr: r.stderr ?? '' } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  return { ran, opened, registered, toasts, clock, files, session, counts, panes }
}

const PANE_PROPS = { title: 'test-lab', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }
const mount = ($: Parameters<TestBody>[0], surface: RenderSurface = 'terminal') =>
  $.ui.mount({ plugin: 'test-lab', surface, component: 'Pane', requestId: PANE, props: PANE_PROPS } as never)
const RUN_ARGS = { tool: RUN_TOOL_NAME, operation: 'run', appRoot: APP, suiteRoot: SUITE, environment: 'local', noWork: true, adapter: `${SUITE}/adapter.ts` }

/** A runner that writes what the real one would: a finished status for its operation and the core's verdict. */
const answering = (kind: string, operation = 'run', machine = MACHINE, runDir = SUITE_RUN): Runner => (dir) => {
  const requestIdentity = (JSON.parse(filesOf.current[`${dir}/request.json`] ?? '{}') as Record<string, unknown>)['requestIdentity']

  filesOf.current[`${dir}/status.json`] = JSON.stringify({ ...JSON.parse(finished(operation, kind, runDir, EXIT[kind]!, opId(dir))), requestIdentity })
  filesOf.current[`${runDir}/verdict.json`] = verdict(machine, kind, { requestIdentity }, runDir)
  filesOf.current[`${runDir}/html/index.html`] = '<html>'
  return { exitCode: EXIT[kind]! }
}
const filesOf: { current: Record<string, string> } = { current: {} }

/** A runner held until the test lets it go, so operations overlap. */
function held() {
  const waiting: { dir: string; release: (a: Answer) => void }[] = []
  const runner: Runner = (dir) => new Promise<Answer>(release => waiting.push({ dir, release }))
  return { runner, waiting }
}

describe('the verdict tool', () => {
  test('both tools are registered at session start; verdict returns the core\'s summary', async ($, on) => {
    const w = world(on, { [`${RUN}/verdict.json`]: verdict(MACHINE) })
    await $.session.start({ cwd: '/work' } as never)
    expect(w.registered.map(r => r.name)).toEqual(['verdict', 'run'])
    const answer = await $.tool.call({ tool: TOOL_NAME, runDir: RUN } as never)
    expect(String(answer.result)).toMatch(/NOT READY \(rule 6\)/)
    expect(String(answer.result)).toMatch(/tests\/g\.spec\.ts/)
    expect(w.opened).toEqual([PANE])
  })

  test('a folder with no verdict answers so, and invents nothing', async ($, on) => {
    world(on, {})
    await $.session.start({ cwd: '/work' } as never)
    const answer = await $.tool.call({ tool: TOOL_NAME, runDir: '/runs/none' } as never)
    expect(String(answer.result)).toMatch(/no verdict\.json/)
  })

  test('a call without runDir is refused', async ($, on) => {
    world(on, {})
    await $.session.start({ cwd: '/work' } as never)
    const answer = await $.tool.call({ tool: TOOL_NAME } as never)
    expect(answer.deny).toMatch(/give runDir/)
  })

  test('a run folder given through a link is read where it really is', async ($, on) => {
    world(on, { [`${RUN}/verdict.json`]: verdict(MACHINE) }, { links: { '/latest': RUN } })
    await $.session.start({ cwd: '/work' } as never)
    expect(String((await $.tool.call({ tool: TOOL_NAME, runDir: '/latest' } as never)).result)).toMatch(/NOT READY \(rule 6\)/)
  })

  test('a verdict.json that links out of its run folder is not shown', async ($, on) => {
    world(on, { '/elsewhere/verdict.json': verdict(MACHINE, 'ready', {}, RUN), [`${RUN}/marker`]: '' }, { links: { [`${RUN}/verdict.json`]: '/elsewhere/verdict.json' } })
    await $.session.start({ cwd: '/work' } as never)
    const answer = String((await $.tool.call({ tool: TOOL_NAME, runDir: RUN } as never)).result)
    expect(answer).toMatch(/resolves outside the run folder/)
    expect(answer).not.toMatch(/READY \(rule/)
  })
})

describe('the pane', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`on ${surface}, on the machine that ran the tests, offers the report and opens it by argv`, async ($, on) => {
      const w = world(on, { [`${RUN}/verdict.json`]: verdict(MACHINE), [`${RUN}/html/index.html`]: '<html>', [`${DATA}/machine-id`]: `${MACHINE}\n` }, { surfaces: [surface] })
      await $.session.start({ cwd: '/work' } as never)
      await $.tool.call({ tool: TOOL_NAME, runDir: RUN } as never)
      const ui = await mount($, surface)
      expect((await ui.find({ type: 'Text', text: /^NOT READY \(rule 6\)$/ }))?.props.color).toBe('red')
      expect(await ui.find({ type: 'Text', text: /tests\/g\.spec\.ts/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /summary only/ })).toBeUndefined()
      expect((await ui.find({ key: 'open-report' }))?.props.label).toBe('Open report')
      await ui.press({ key: 'open-report' })
      expect(w.ran.map(r => r.argv)).toEqual([['open', `${RUN}/html/index.html`]])
      await ui.unmount()
    })

    test(`on ${surface}, a run made on another machine is summary only, with the path`, async ($, on) => {
      const w = world(on, { [`${RUN}/verdict.json`]: verdict('ci-runner'), [`${RUN}/html/index.html`]: '<html>', [`${DATA}/machine-id`]: `${MACHINE}\n` }, { surfaces: [surface] })
      await $.session.start({ cwd: '/work' } as never)
      await $.tool.call({ tool: TOOL_NAME, runDir: RUN } as never)
      const ui = await mount($, surface)
      expect(await ui.find({ key: 'open-report' })).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: /summary only/ }))?.text).toMatch(/\/runs\/r1\/html\/index\.html \(summary only: the run was made on another machine\)/)
      expect(w.ran).toEqual([])
      await ui.unmount()
    })
  }

  test('on mobile, the report is summary only even on the same machine, and nothing is copied there', async ($, on) => {
    world(on, { [`${RUN}/verdict.json`]: verdict(MACHINE), [`${RUN}/html/index.html`]: '<html>', [`${DATA}/machine-id`]: `${MACHINE}\n`, '/usr/bin/pbcopy': '' }, { surfaces: ['mobile'] })
    await $.session.start({ cwd: '/work' } as never)
    await $.tool.call({ tool: TOOL_NAME, runDir: RUN } as never)
    const ui = await mount($, 'mobile')
    expect(await ui.find({ key: 'open-report' })).toBeUndefined()
    expect(await ui.find({ key: 'copy-summary' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /summary only/ }))?.text).toMatch(/mobile surface/)
    await ui.unmount()
  })

  test('a report that links out of the run folder is summary only, never opened', async ($, on) => {
    const w = world(on, { [`${RUN}/verdict.json`]: verdict(MACHINE), '/elsewhere/index.html': '<html>', [`${DATA}/machine-id`]: `${MACHINE}\n` }, { links: { [`${RUN}/html`]: '/elsewhere' } })
    await $.session.start({ cwd: '/work' } as never)
    await $.tool.call({ tool: TOOL_NAME, runDir: RUN } as never)
    const ui = await mount($)
    expect(await ui.find({ key: 'open-report' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /summary only/ }))?.text).toMatch(/the HTML report is not in the run folder/)
    expect(w.ran).toEqual([])
    await ui.unmount()
  })

  test('Copy summary hands the summary to the host clipboard on a local surface', async ($, on) => {
    const w = world(on, { [`${RUN}/verdict.json`]: verdict(MACHINE), '/usr/bin/pbcopy': '' })
    await $.session.start({ cwd: '/work' } as never)
    await $.tool.call({ tool: TOOL_NAME, runDir: RUN } as never)
    const ui = await mount($)
    await ui.press({ key: 'copy-summary' })
    expect(w.ran.map(r => r.argv)).toEqual([['/usr/bin/pbcopy']])
    expect(w.ran[0]?.stdin).toMatch(/^test-lab · example · local: NOT READY \(rule 6\)/)
    expect(w.toasts).toContain('test-lab: summary copied')
    await ui.unmount()
  })

  test('with nothing shown yet, the pane says so', async ($, on) => {
    world(on, {})
    await $.session.start({ cwd: '/work' } as never)
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: /No test-lab run in this session yet/ }))).toBeDefined()
    await ui.unmount()
  })
})

describe('the handoff carries what the core\'s page carries', () => {
  test('the summary has the context, build identity, counts, required cases, scope changes and what is outside', async ($, on) => {
    world(on, { [`${RUN}/verdict.json`]: verdict(MACHINE) })
    await $.session.start({ cwd: '/work' } as never)
    const text = String((await $.tool.call({ tool: TOOL_NAME, runDir: RUN } as never)).result)
    expect(text).toMatch(/Local candidate: ready means ready to deploy for QA\. Human QA owns sign-off\./)
    expect(text).toMatch(/Application: \/work\/app; commit abc1234; manifest build-digest-1/)
    expect(text).toMatch(/Suite\/corpus: \/work\/qa-suite; commit def5678; manifest suite-digest-1/)
    expect(text).toMatch(/Environment: local \(local-candidate\), http:\/\/127\.0\.0\.1:8080\/base/)
    expect(text).toMatch(/Corpus revision: corpus-rev-1/)
    expect(text).toMatch(/- regression, Short: 3 cases; 3 current; 2 verified; 1 waived; 0 developer-attested/)
    expect(text).toMatch(/- addendum, Short: 1 cases; 1 current; 0 verified; 0 waived; 1 developer-attested/)
    expect(text).toMatch(/- served worktree: ok \(the site serves \/work\/app\)/)
    expect(text).toMatch(/- regression REG-2 on chromium@desktop: failed/)
    expect(text).toMatch(/- \[governed\] tests\/g\.spec\.ts › g \[chromium\]: failed in REG-2#1/)
    expect(text).toMatch(/- 2026-10-09T09:00:00Z add ADD-1 by Dana Dev \(developer\): covers the new filter/)
    expect(text).toMatch(/Outside this verdict:\n- full tier: not run in a fast run/)
    // Nothing that could carry a secret in the profile's URL is repeated.
    expect(text).not.toMatch(/hunter2|never-shown|qa:/)
  })

  test('the pane shows the same handoff, and a deployed confirmation is worded as one', async ($, on) => {
    world(on, { [`${RUN}/verdict.json`]: verdict(MACHINE, 'ready', { context: { ...CONTEXT, environment: { id: 'stage', kind: 'deployed', baseUrl: 'https://stage.example' } } }) })
    await $.session.start({ cwd: '/work' } as never)
    await $.tool.call({ tool: TOOL_NAME, runDir: RUN } as never)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /^Deployed confirmation: ready means ready for human QA\.$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Application: \/work\/app; commit abc1234/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Required cases \(2\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^- regression, Short: 3 cases/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^- 2026-10-09T09:00:00Z add ADD-1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^- full tier: not run in a fast run$/ })).toBeDefined()
    await ui.unmount()
  })

  test('the run tool describes a fast run as a local candidate\'s verdict, not readiness for human QA', async ($, on) => {
    const w = world(on, {})
    await $.session.start({ cwd: '/work' } as never)
    const run = w.registered.find(r => r.name === 'run')!.description
    expect(run).toMatch(/local candidate \(ready means ready to deploy for QA; human QA owns sign-off\)/)
    expect(run).not.toMatch(/readiness for human QA/)
  })
})

describe('the pane runs nothing a verdict file names', () => {
  test('an edited opener vector is summary only and never run', async ($, on) => {
    const w = world(on, { [`${RUN}/verdict.json`]: verdict(MACHINE, 'not-ready', { openReport: ['sh', '-c', 'touch /tmp/pwned'] }), [`${RUN}/html/index.html`]: '<html>', [`${DATA}/machine-id`]: `${MACHINE}\n` })
    await $.session.start({ cwd: '/work' } as never)
    await $.tool.call({ tool: TOOL_NAME, runDir: RUN } as never)
    const ui = await mount($)
    expect(await ui.find({ key: 'open-report' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /summary only/ }))?.text).toMatch(/not the platform opener/)
    expect(w.ran).toEqual([])
    await ui.unmount()
  })

  test('a verdict file naming another run folder is not shown', async ($, on) => {
    world(on, { [`${RUN}/verdict.json`]: verdict(MACHINE, 'not-ready', { runDir: '/elsewhere' }) })
    await $.session.start({ cwd: '/work' } as never)
    const answer = await $.tool.call({ tool: TOOL_NAME, runDir: RUN } as never)
    expect(String(answer.result)).toMatch(/names another run folder/)
  })
})

describe('the run tool', () => {
  test('starts the runner by argv, without a shell, under the host deadline, and returns a Not ready verdict as an answer', async ($, on) => {
    const files: Record<string, string> = { [`${DATA}/machine-id`]: `${MACHINE}\n` }
    filesOf.current = files
    const w = world(on, files, { runner: answering('not-ready') })
    await $.session.start({ cwd: '/work' } as never)
    const answer = await $.tool.call({ ...RUN_ARGS, timeoutMs: 120_000 } as never)
    expect(answer.deny).toBeUndefined()
    expect(String(answer.result)).toMatch(/^test-lab fast run finished \(exit 2\)\.\ntest-lab · example · local: NOT READY \(rule 6\)/)
    const [probe, run] = w.ran
    expect(probe?.argv[0]).toBe('node')
    expect(probe?.argv[1]).toMatch(/\/src\/mod-entry\.ts$/)
    expect(probe?.argv[2]).toBe('--data-dir')
    const dir = run!.argv[3]!
    expect(dir.startsWith(`${SESSIONS}/session-a/`)).toBe(true)
    const cli = ['run', '--app-root', APP, '--suite-root', SUITE, '--env', 'local', '--no-work', '--adapter', `${SUITE}/adapter.ts`, '--timeout-ms', '120000']
    expect(run!.argv.slice(2)).toEqual(['--operation-dir', dir, '--deadline-ms', '120000', '--', ...cli])
    expect(run!.cwd).toBe(SUITE)
    expect(run!.timeoutMs).toBe(145_000)
    // The request names this operation and its exact arguments; the runner refuses any other argv.
    const request = JSON.parse(files[`${dir}/request.json`]!) as Record<string, unknown>
    expect({ ...request, requestIdentity: undefined }).toEqual({ requestIdentity: undefined, schema: 2, id: opId(dir), operation: 'run', deadlineMs: 120_000, cli, hasInputs: false })
    expect(w.opened).toContain(PANE)
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: /^NOT READY \(rule 6\)$/ }))?.props.color).toBe('red')
    expect((await ui.find({ type: 'Text', text: /^Fast run · exit 2$/ }))).toBeDefined()
    expect((await ui.find({ key: 'open-report' }))?.props.label).toBe('Open report')
    await ui.unmount()
  })

  test('inputs go to the operation folder by file; their values are never echoed back', async ($, on) => {
    const files: Record<string, string> = {}
    filesOf.current = files
    const w = world(on, files, { runner: answering('inconclusive') })
    await $.session.start({ cwd: '/work' } as never)
    const answer = await $.tool.call({ ...RUN_ARGS, inputs: { SITE_LANG: { state: 'set', value: 'value-never-echoed' }, OPTIONAL: { state: 'unset' } } } as never)
    const run = w.ran[1]!.argv
    const dir = run[3]!
    expect(run.slice(run.indexOf('--inputs'), run.indexOf('--inputs') + 2)).toEqual(['--inputs', `${dir}/inputs.json`])
    expect(JSON.parse(files[`${dir}/inputs.json`]!)).toEqual({ SITE_LANG: { state: 'set', value: 'value-never-echoed' }, OPTIONAL: { state: 'unset' } })
    expect(files[`${dir}/request.json`]).not.toMatch(/value-never-echoed/)
    expect(String(answer.result)).not.toMatch(/value-never-echoed/)
    expect(String(answer.result)).toMatch(/INCONCLUSIVE/)
  })

  test('a passed policy check says readiness was not evaluated, and takes no adapter', async ($, on) => {
    const files: Record<string, string> = {}
    filesOf.current = files
    const w = world(on, files, { runner: (dir) => {
      files[`${dir}/status.json`] = status('verify', { operationId: opId(dir), state: 'finished', runDir: SUITE_RUN, result: { exitCode: 0, verdict: 'inconclusive', rule: 7, summary: 'Policy verification passed; local readiness was not evaluated.' } })
      files[`${SUITE_RUN}/verdict.json`] = verdict(MACHINE, 'inconclusive', { verdict: { ...JSON.parse(verdict(MACHINE, 'inconclusive')).verdict, rule: 7 } }, SUITE_RUN)
      return { exitCode: 0 }
    } })
    await $.session.start({ cwd: '/work' } as never)
    const refused = await $.tool.call({ ...RUN_ARGS, operation: 'verify' } as never)
    expect(refused.deny).toMatch(/verify reads persisted policy only/)
    const { adapter: _adapter, ...verifyArgs } = RUN_ARGS
    const answer = await $.tool.call({ ...verifyArgs, operation: 'verify' } as never)
    expect(String(answer.result)).toMatch(/^test-lab policy check finished \(exit 0\)\.\nPolicy verification passed; local readiness was not evaluated\./)
    expect(w.ran[1]!.argv.slice(7)).toEqual(['verify', '--app-root', APP, '--suite-root', SUITE, '--env', 'local', '--no-work'])
  })

  for (const [why, args, message] of [
    ['a relative root', { suiteRoot: 'qa-suite' }, /suiteRoot must be an absolute path/],
    ['both work and noWork', { work: 'WORK-1' }, /give work or noWork, not both/],
    ['an unknown argument', { runDir: '/x' }, /runDir is not an argument of this tool/],
    ['a secret-shaped input object', { inputs: { TOKEN: 'raw' } }, /input TOKEN must be/],
    ['an over-long deadline', { timeoutMs: 900_000 }, /timeoutMs must be a whole number/],
  ] as const) {
    test(`refuses ${why} before starting anything`, async ($, on) => {
      const w = world(on, {})
      await $.session.start({ cwd: '/work' } as never)
      const answer = await $.tool.call({ ...RUN_ARGS, ...args } as never)
      expect(answer.deny).toMatch(message)
      expect(w.ran).toEqual([])
    })
  }

  test('a missing Node is named, and nothing is recorded as run', async ($, on) => {
    const w = world(on, {}, { node: 'missing' })
    await $.session.start({ cwd: '/work' } as never)
    const answer = await $.tool.call(RUN_ARGS as never)
    expect(String(answer.result)).toMatch(/Node\.js 24 or newer must be on PATH/)
    expect(w.ran.length).toBe(1)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /No test-lab run in this session yet/ })).toBeDefined()
    await ui.unmount()
  })

  test('an old Node is refused by version', async ($, on) => {
    world(on, {}, { node: 'old' })
    await $.session.start({ cwd: '/work' } as never)
    expect(String((await $.tool.call(RUN_ARGS as never)).result)).toMatch(/needs Node\.js 24 or newer; node is 22\.12\.0/)
  })

  test('a plugin copy without its runtime parser is refused before anything is recorded or run', async ($, on) => {
    const w = world(on, {}, { runtime: 'test-lab\'s runtime parser is not in this plugin copy (/cache/test-lab): use a test-lab release build' })
    await $.session.start({ cwd: '/work' } as never)
    expect(String((await $.tool.call(RUN_ARGS as never)).result)).toMatch(/^test-lab fast run: test-lab's runtime parser is not in this plugin copy/)
    expect(w.ran.length).toBe(1)
  })

  test('a runner that refuses the request is a failure to run, not a verdict', async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, { runner: (dir) => {
      files[`${dir}/status.json`] = status('run', { operationId: opId(dir), state: 'failed', error: 'only an explicitly selected local-candidate environment is supported' })
      return { exitCode: 4, stderr: 'only an explicitly selected local-candidate environment is supported' }
    } })
    await $.session.start({ cwd: '/work' } as never)
    const answer = String((await $.tool.call(RUN_ARGS as never)).result)
    expect(answer).toMatch(/^test-lab Fast run could not run: only an explicitly selected local-candidate environment/)
    expect(answer).not.toMatch(/NOT EVALUABLE|READY/)
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: /could not run/ }))?.props.color).toBe('yellow')
    expect(await ui.find({ key: 'run-again' })).toBeDefined()
    await ui.unmount()
  })

  test('a runner the host ended before it finished says so, with no verdict', async ($, on) => {
    world(on, {}, { runner: () => ({ exitCode: 1, stderr: 'killed' }) })
    await $.session.start({ cwd: '/work' } as never)
    expect(String((await $.tool.call(RUN_ARGS as never)).result)).toMatch(/^test-lab fast run did not finish\. Fast run: the runner wrote no status; the host reported: killed\./)
  })

  test('a runner stopped before the run started says nothing ran', async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, { runner: (dir) => {
      files[`${dir}/status.json`] = status('run', { operationId: opId(dir), state: 'cancelled', stopping: 'requested', error: 'stopped before the run started; nothing ran' })
      return { exitCode: 4 }
    } })
    await $.session.start({ cwd: '/work' } as never)
    const answer = String((await $.tool.call(RUN_ARGS as never)).result)
    expect(answer).toBe('test-lab fast run did not finish. Fast run was stopped before the run started (a stop was asked for); nothing ran.')
    expect(answer).not.toMatch(/READY|INCONCLUSIVE/)
  })

  test('a status naming a run folder outside the suite\'s runs is never followed', async ($, on) => {
    const files: Record<string, string> = { '/elsewhere/r/verdict.json': verdict(MACHINE, 'ready', {}, '/elsewhere/r') }
    world(on, files, { runner: (dir) => {
      files[`${dir}/status.json`] = finished('run', 'ready', '/elsewhere/r', 0, opId(dir))
      return { exitCode: 0 }
    } })
    await $.session.start({ cwd: '/work' } as never)
    const answer = String((await $.tool.call(RUN_ARGS as never)).result)
    expect(answer).toMatch(/result is not shown: the run reported a folder outside \/work\/qa-suite\/\.test-lab\/runs/)
    expect(answer).not.toMatch(/: READY/)
  })

  test('a status whose exit code contradicts its verdict is unreadable, not green', async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, { runner: (dir) => {
      files[`${dir}/status.json`] = finished('run', 'ready', SUITE_RUN, 2, opId(dir))
      files[`${SUITE_RUN}/verdict.json`] = verdict(MACHINE, 'ready', {}, SUITE_RUN)
      return { exitCode: 0 }
    } })
    await $.session.start({ cwd: '/work' } as never)
    expect(String((await $.tool.call(RUN_ARGS as never)).result)).toMatch(/did not finish\. Fast run: the runner result exit code does not match its verdict/)
  })
})

describe('a finished result is bound to the operation that asked for it', () => {
  const unbound = async (
    $: Parameters<TestBody>[0],
    on: On,
    write: (files: Record<string, string>, dir: string) => number,
    options: { links?: Record<string, string> } = {},
  ) => {
    const files: Record<string, string> = {}
    world(on, files, { runner: (dir) => ({ exitCode: write(files, dir) }), ...options })
    await $.session.start({ cwd: '/work' } as never)
    const answer = String((await $.tool.call(RUN_ARGS as never)).result)
    const ui = await mount($)
    const ready = await ui.find({ type: 'Text', text: /^READY \(rule 8\)$/ })
    await ui.unmount()
    return { answer, ready }
  }

  test('a status written for another operation is not this operation\'s result', async ($, on) => {
    const { answer, ready } = await unbound($, on, (files, dir) => {
      files[`${dir}/status.json`] = finished('run', 'ready', SUITE_RUN, 0, 'another-operation')
      files[`${SUITE_RUN}/verdict.json`] = verdict(MACHINE, 'ready', {}, SUITE_RUN)
      return 0
    })
    expect(answer).toMatch(/the runner status belongs to another operation/)
    expect(answer).not.toMatch(/: READY/)
    expect(ready).toBeUndefined()
  })

  test('a Not ready status beside a Ready verdict file shows neither as Ready', async ($, on) => {
    const { answer, ready } = await unbound($, on, (files, dir) => {
      files[`${dir}/status.json`] = finished('run', 'not-ready', SUITE_RUN, 2, opId(dir))
      files[`${SUITE_RUN}/verdict.json`] = verdict(MACHINE, 'ready', {}, SUITE_RUN)
      return 2
    })
    expect(answer).toMatch(/the runner reported not-ready \(rule 6\) but verdict\.json says ready \(rule 8\)/)
    expect(answer).not.toMatch(/READY \(rule 8\)\n|: READY/)
    expect(ready).toBeUndefined()
  })

  test('an older Ready run folder of the same suite is not accepted as this operation\'s result', async ($, on) => {
    const { answer, ready } = await unbound($, on, (files, dir) => {
      files[`${dir}/status.json`] = finished('run', 'ready', OLD_RUN, 0, opId(dir))
      files[`${OLD_RUN}/verdict.json`] = verdict(MACHINE, 'ready', { startedAt: '2026-10-08T09:00:00.000Z', finishedAt: '2026-10-08T09:05:00.000Z' }, OLD_RUN)
      return 0
    })
    expect(answer).toMatch(/verdict\.json is from a run that started before this operation/)
    expect(ready).toBeUndefined()
  })

  for (const timing of ['recent', 'future']) test(`a ${timing} same-context sibling for different work/inputs is refused`, async ($, on) => {
    const { answer, ready } = await unbound($, on, (files, dir) => {
      files[`${dir}/status.json`] = finished('run', 'ready', SUITE_RUN, 0, opId(dir))
      files[`${SUITE_RUN}/verdict.json`] = verdict(MACHINE, 'ready', {
        startedAt: new Date(NOW + (timing === 'future' ? 30_000 : 0)).toISOString(),
        finishedAt: new Date(NOW + 60_000).toISOString(),
        requestIdentity: { schema: 1, operationId: 'sibling', requestHash: 'a'.repeat(64), inputsHash: 'b'.repeat(64), context: { operation: 'run', appRoot: APP, suiteRoot: SUITE, environment: 'local', work: 'WORK-OTHER', noWork: false } },
      }, SUITE_RUN)
      return 0
    })
    expect(answer).toMatch(/request identity/)
    expect(ready).toBeUndefined()
  })

  test('a mod-operated legacy result with no identity is refused while the standalone verdict tool can view it', async ($, on) => {
    const { answer, ready } = await unbound($, on, (files, dir) => {
      files[`${dir}/status.json`] = finished('run', 'ready', SUITE_RUN, 0, opId(dir))
      files[`${SUITE_RUN}/verdict.json`] = verdict(MACHINE, 'ready', { requestIdentity: null }, SUITE_RUN)
      return 0
    })
    expect(answer).toMatch(/request identity/)
    expect(ready).toBeUndefined()
    expect(String((await $.tool.call({ tool: TOOL_NAME, runDir: SUITE_RUN } as never)).result)).toMatch(/READY/)
  })

  test('a copied status identity from another request is refused even beside a matching artifact', async ($, on) => {
    const { answer, ready } = await unbound($, on, (files, dir) => {
      files[`${dir}/status.json`] = status('run', { ...JSON.parse(finished('run', 'ready', SUITE_RUN, 0, opId(dir))), requestIdentity: { ...FIXTURE_IDENTITY, operationId: 'other' } })
      files[`${SUITE_RUN}/verdict.json`] = verdict(MACHINE, 'ready', {}, SUITE_RUN)
      return 0
    })
    expect(answer).toMatch(/request identity/)
    expect(ready).toBeUndefined()
  })

  test('a run folder that resolves outside the suite\'s runs through a link is not followed', async ($, on) => {
    const { answer, ready } = await unbound($, on, (files, dir) => {
      files[`${dir}/status.json`] = finished('run', 'ready', SUITE_RUN, 0, opId(dir))
      files['/elsewhere/run/verdict.json'] = verdict(MACHINE, 'ready', {}, SUITE_RUN)
      return 0
    }, { links: { [SUITE_RUN]: '/elsewhere/run' } })
    expect(answer).toMatch(/the run folder resolves outside \/work\/qa-suite\/\.test-lab\/runs \(\/elsewhere\/run\)/)
    expect(ready).toBeUndefined()
  })

  test('a runner exit code that disagrees with its status is not shown as either', async ($, on) => {
    const { answer, ready } = await unbound($, on, (files, dir) => {
      files[`${dir}/status.json`] = finished('run', 'ready', SUITE_RUN, 0, opId(dir))
      files[`${SUITE_RUN}/verdict.json`] = verdict(MACHINE, 'ready', {}, SUITE_RUN)
      return 2
    })
    expect(answer).toMatch(/the runner exited 2 but its status says 0/)
    expect(ready).toBeUndefined()
  })

  test('a verdict for another application or environment is not this operation\'s result', async ($, on) => {
    const { answer, ready } = await unbound($, on, (files, dir) => {
      files[`${dir}/status.json`] = finished('run', 'ready', SUITE_RUN, 0, opId(dir))
      files[`${SUITE_RUN}/verdict.json`] = verdict(MACHINE, 'ready', { context: { ...CONTEXT, appRoot: '/work/other-app' } }, SUITE_RUN)
      return 0
    })
    expect(answer).toMatch(/verdict\.json is for application \/work\/other-app, not \/work\/app/)
    expect(ready).toBeUndefined()
  })

  test('a Ready verdict without the core\'s context is not shown as Ready', async ($, on) => {
    const { answer, ready } = await unbound($, on, (files, dir) => {
      files[`${dir}/status.json`] = finished('run', 'ready', SUITE_RUN, 0, opId(dir))
      const v = JSON.parse(verdict(MACHINE, 'ready', {}, SUITE_RUN)) as Record<string, unknown>
      delete v['context']
      files[`${SUITE_RUN}/verdict.json`] = JSON.stringify(v)
      return 0
    })
    expect(answer).toMatch(/records no context, so a Ready verdict is not shown/)
    expect(ready).toBeUndefined()
  })
})

const OP = { schema: 2, session: 'session-a', id: 'op-1', dir: `${SESSIONS}/session-a/op-1`, input: { operation: 'run', appRoot: APP, suiteRoot: SUITE, environment: 'local', work: null, noWork: true, adapter: `${SUITE}/adapter.ts`, timeoutMs: 540_000, hasInputs: false }, suiteReal: SUITE, appReal: APP, startedAt: NOW - 80_000, launchedAt: NOW - 80_000 as number | null, requestIdentity: FIXTURE_IDENTITY, phase: 'launched', exit: null as { code: number | null; failure: string | null } | null }
const storeWith = (...ops: (typeof OP)[]) => ({ ...Object.fromEntries(ops.map(o => [`op:session-a:${o.id}`, o])), 'shown:session-a': { at: NOW, shown: { kind: 'operation', id: ops[ops.length - 1]!.id } } })
const STORE = storeWith(OP)

describe('the pane\'s records are per session and survive a reload', () => {
  test('a reloaded module redraws the finished run from the store and its files, without a tool call', async ($, on) => {
    world(on, { [`${OP.dir}/status.json`]: finished('run', 'ready'), [`${SUITE_RUN}/verdict.json`]: verdict(MACHINE, 'ready', {}, SUITE_RUN) }, { store: STORE })
    await $.session.start({ cwd: '/work' } as never)
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: /^READY \(rule 8\)$/ }))?.props.color).toBe('green')
    expect(await ui.find({ type: 'Text', text: /^No failures seen$/ })).toBeDefined()
    await ui.unmount()
  })

  test('another session sees none of it', async ($, on) => {
    world(on, { [`${OP.dir}/status.json`]: finished('run', 'ready'), [`${SUITE_RUN}/verdict.json`]: verdict(MACHINE, 'ready', {}, SUITE_RUN) }, { store: STORE, session: { id: 'session-b' } })
    await $.session.start({ cwd: '/work' } as never)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /No test-lab run in this session yet/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /READY/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a run in progress shows its step and elapsed time, and Stop asks it to stop', async ($, on) => {
    const w = world(on, { [`${OP.dir}/status.json`]: status('run', { runDir: SUITE_RUN, step: 'e2e: run' }) }, { store: STORE })
    await $.session.start({ cwd: '/work' } as never)
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: /^Fast run running/ }))?.text).toBe('Fast run running for 1m 20s · now e2e: run')
    await ui.press({ key: 'stop' })
    expect(w.files[`${OP.dir}/cancel`]).toBe('stop\n')
    await ui.unmount()
  })

  test('Run again repeats the recorded operation with the same explicit arguments', async ($, on) => {
    const files: Record<string, string> = { [`${OP.dir}/status.json`]: finished('run', 'not-ready'), [`${SUITE_RUN}/verdict.json`]: verdict(MACHINE, 'not-ready', {}, SUITE_RUN) }
    filesOf.current = files
    const w = world(on, files, { store: storeWith({ ...OP, phase: 'ended', exit: { code: 2, failure: 'exit 2' } }), runner: answering('ready') })
    await $.session.start({ cwd: '/work' } as never)
    const ui = await mount($)
    await ui.press({ key: 'run-again' })
    for (let i = 0; i < 50; i++) await w.clock.settle()
    const run = w.ran.find(r => r.argv.includes('--operation-dir'))!.argv
    expect(run.slice(7)).toEqual(['run', '--app-root', APP, '--suite-root', SUITE, '--env', 'local', '--no-work', '--adapter', `${SUITE}/adapter.ts`, '--timeout-ms', '540000'])
    expect(run[3]).not.toBe(OP.dir)
    await ui.unmount()
  })
})

describe('the pane from the runner\'s start to its end', () => {
  test('mounted before the runner writes anything, the pane shows the start with Stop, and follows the run once it reports', async ($, on) => {
    const files: Record<string, string> = {}
    const w = world(on, files, { store: storeWith({ ...OP, startedAt: NOW - 2_000, launchedAt: NOW - 2_000 }) })
    await $.session.start({ cwd: '/work' } as never)
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: /^Fast run starting/ }))?.text).toBe('Fast run starting (2s)')
    expect(await ui.find({ key: 'stop' })).toBeDefined()
    expect(await ui.find({ key: 'run-again' })).toBeUndefined()
    files[`${OP.dir}/status.json`] = status('run', { startedAt: AT, updatedAt: AT, step: 'e2e: run' })
    await w.clock.advance(1_000)
    expect((await ui.find({ type: 'Text', text: /^Fast run running/ }))?.text).toBe('Fast run running for 1s · now e2e: run')
    await ui.unmount()
  })

  test('a runner that stopped reporting keeps best-effort Stop after its launch budget, without claiming death', async ($, on) => {
    const files: Record<string, string> = { [`${OP.dir}/status.json`]: status('run', { updatedAt: new Date(NOW - 60_000).toISOString() }) }
    const w = world(on, files, { store: STORE })
    await $.session.start({ cwd: '/work' } as never)
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: /has not reported/ }))?.text).toMatch(/^Fast run has not reported for 1m 0s \(running for 1m 20s\); it may be busy or stuck/)
    expect(await ui.find({ key: 'stop' })).toBeDefined()
    // Reporting again brings it back to running.
    files[`${OP.dir}/status.json`] = status('run', { updatedAt: new Date(NOW + 1_000).toISOString(), step: 'e2e: run' })
    await w.clock.advance(1_000)
    expect(await ui.find({ type: 'Text', text: /^Fast run running/ })).toBeDefined()
    // Elapsed time bounds polling; it cannot prove death or descendant cleanup.
    files[`${OP.dir}/status.json`] = status('run', { updatedAt: new Date(NOW + 1_000).toISOString() })
    await w.clock.advance(600_000)
    expect((await ui.find({ type: 'Text', text: /stopped reporting/ }))?.text).toMatch(/Completion and cleanup are unknown/)
    expect(await ui.find({ key: 'stop' })).toBeDefined()
    expect(await ui.find({ key: 'run-again' })).toBeUndefined()
    const before = w.counts.invalidate
    await w.clock.advance(5_000)
    expect(w.counts.invalidate).toBe(before)
    await ui.unmount()
  })

  test('a launched runner that never writes a status is unresponsive, not finished, while it may still be starting', async ($, on) => {
    world(on, {}, { store: storeWith({ ...OP, startedAt: NOW - 30_000, launchedAt: NOW - 30_000 }) })
    await $.session.start({ cwd: '/work' } as never)
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: /has not reported/ }))?.text).toMatch(/^Fast run has not reported for 30s since it was started/)
    expect(await ui.find({ key: 'stop' })).toBeDefined()
    await ui.unmount()
  })

  test('reload during preparation after its assumed deadline keeps best-effort Stop', async ($, on) => {
    const w = world(on, {}, { store: storeWith({ ...OP, phase: 'preparing', launchedAt: null, startedAt: NOW - 900_000 }) })
    await $.session.start({ cwd: '/work' } as never)
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: /preparing/ }))?.text).toMatch(/preparing/)
    expect(await ui.find({ key: 'stop' })).toBeDefined()
    await ui.press({ key: 'stop' })
    expect(w.files[`${OP.dir}/cancel`]).toBe('stop\n')
    await ui.unmount()
  })

  // The host test kit can't raise `ui.close`, which the mod also hooks; a pane no longer open is the
  // case it can show.
  test('a pane that is no longer open stops its redraw timer', async ($, on) => {
    const w = world(on, { [`${OP.dir}/status.json`]: status('run', { updatedAt: AT }) }, { store: STORE })
    await $.session.start({ cwd: '/work' } as never)
    const ui = await mount($)
    await w.clock.advance(3_000)
    expect(w.counts.invalidate).toBeGreaterThan(0)
    w.panes.open = false
    await w.clock.advance(1_000)
    const before = w.counts.invalidate
    await w.clock.advance(5_000)
    expect(w.counts.invalidate).toBe(before)
    await ui.unmount()
  })

  test('ending the session stops the redraw timer', async ($, on) => {
    const w = world(on, { [`${OP.dir}/status.json`]: status('run', { updatedAt: AT }) }, { store: STORE })
    await $.session.start({ cwd: '/work' } as never)
    const ui = await mount($)
    await w.clock.advance(2_000)
    await $.session.end({ reason: 'exit' } as never)
    const before = w.counts.invalidate
    await w.clock.advance(5_000)
    expect(w.counts.invalidate).toBe(before)
    await ui.unmount()
  })
})

describe('ending the session stops what it started', () => {
  test('a running operation is asked to stop', async ($, on) => {
    const w = world(on, { [`${OP.dir}/status.json`]: status('run') }, { store: STORE })
    await $.session.start({ cwd: '/work' } as never)
    await $.session.end({ reason: 'exit' } as never)
    expect(w.files[`${OP.dir}/cancel`]).toBe('session ended\n')
  })

  test('an operation whose runner has not written its first status is asked to stop too', async ($, on) => {
    const w = world(on, {}, { store: STORE })
    await $.session.start({ cwd: '/work' } as never)
    await $.session.end({ reason: 'exit' } as never)
    expect(w.files[`${OP.dir}/cancel`]).toBe('session ended\n')
  })

  test('a finished operation is left alone', async ($, on) => {
    const w = world(on, { [`${OP.dir}/status.json`]: finished('run', 'ready') }, { store: storeWith({ ...OP, phase: 'ended', exit: { code: 0, failure: null } }) })
    await $.session.start({ cwd: '/work' } as never)
    await $.session.end({ reason: 'exit' } as never)
    expect(w.files[`${OP.dir}/cancel`]).toBeUndefined()
  })
})

describe('concurrent operations keep their own records', () => {
  test('two overlapping starts both stay recorded, both are stopped at session end, and both finish', async ($, on) => {
    const files: Record<string, string> = {}
    filesOf.current = files
    const h = held()
    const w = world(on, files, { runner: h.runner })
    await $.session.start({ cwd: '/work' } as never)
    const first = $.tool.call(RUN_ARGS as never)
    const second = $.tool.call({ ...RUN_ARGS, noWork: undefined, work: 'WORK-1' } as never)
    for (let i = 0; i < 50 && h.waiting.length < 2; i++) await w.clock.settle()
    expect(h.waiting.length).toBe(2)
    await $.session.end({ reason: 'exit' } as never)
    for (const { dir } of h.waiting) expect(files[`${dir}/cancel`]).toBe('session ended\n')
    for (const { dir, release } of h.waiting) {
      answering('inconclusive', 'run', MACHINE, `${SUITE_RUN}-${opId(dir)}`)(dir, [])
      release({ exitCode: 3 })
    }
    expect(String((await first).result)).toMatch(/INCONCLUSIVE/)
    expect(String((await second).result)).toMatch(/INCONCLUSIVE/)
  })

  test('a verdict call overlapping a start does not lose the operation, which a reload still finds', async ($, on) => {
    const files: Record<string, string> = { [`${RUN}/verdict.json`]: verdict(MACHINE) }
    filesOf.current = files
    const h = held()
    const w = world(on, files, { runner: h.runner })
    await $.session.start({ cwd: '/work' } as never)
    const started = $.tool.call(RUN_ARGS as never)
    for (let i = 0; i < 50 && h.waiting.length < 1; i++) await w.clock.settle()
    await $.tool.call({ tool: TOOL_NAME, runDir: RUN } as never)
    // The pane shows the verdict asked for last; the running operation is still recorded and stoppable.
    await $.session.end({ reason: 'exit' } as never)
    expect(files[`${h.waiting[0]!.dir}/cancel`]).toBe('session ended\n')
    answering('ready')(h.waiting[0]!.dir, [])
    h.waiting[0]!.release({ exitCode: 0 })
    expect(String((await started).result)).toMatch(/READY \(rule 8\)/)
  })

  test('the history cap evicts finished operations only, never one still running', async ($, on) => {
    const done = Array.from({ length: 12 }, (_, i) => ({ ...OP, id: `op-done-${i}`, dir: `${SESSIONS}/session-a/op-done-${i}`, startedAt: NOW - 200_000 + i, phase: 'ended', exit: { code: 0, failure: null } }))
    const active = { ...OP, id: 'op-active', dir: `${SESSIONS}/session-a/op-active`, startedAt: NOW - 300_000 }
    const files: Record<string, string> = {}
    filesOf.current = files
    const w = world(on, files, { store: storeWith(active, ...done), runner: answering('ready') })
    await $.session.start({ cwd: '/work' } as never)
    await $.tool.call(RUN_ARGS as never)
    await $.session.end({ reason: 'exit' } as never)
    // The oldest operation is the active one: it is still recorded, so session end still stops it.
    expect(w.files[`${active.dir}/cancel`]).toBe('session ended\n')
  })
})
