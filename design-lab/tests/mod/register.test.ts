import type { CommandRunInput, On, RenderSurface } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { ARTIFACT_FILES, artifactsOf, POLL_MS, RUN_FILES } from '../../hooks/mod/register'

const RUN = '/runs/example'
const HOME = '/home/person'
const NOW = Date.parse('2026-10-02T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const CREATED = ago(3_600_000)
const PROJECT = JSON.stringify({
  createdAt: CREATED, run: { siteLabel: 'Example site' },
  phases: { capture: { status: 'complete' }, components: { status: 'running' },
    preflight: { status: 'complete', updatedAt: ago(600_000) } },
})
const progress = (lastSeenAgoMs: number, atAgoMs = 1_000) => JSON.stringify({
  state: 'building', stepsDone: 3, stepsTotal: 10, stepKind: 'use_figma', message: null,
  inflight: false, lastSeen: ago(lastSeenAgoMs), at: ago(atAgoMs), serverPid: 1,
})

/** A machine with one run on it, answered from memory; keeps what the mod asks of it. */
function world(on: On, files: Record<string, string>, surfaces: RenderSurface[] = ['terminal'], composer = true, cwd = '/work',
  links: Record<string, string> = {}) {
  const reads: string[] = []
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const opened: string[] = []
  const fills: string[] = []
  const clock = mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('fs.read', ($, e) => {
    reads.push(e.path)
    const text = files[e.path]
    return text === undefined ? { deny: 'missing' } : { value: text }
  })
  const isDir = (path: string) => Object.keys(files).some(f => f.startsWith(`${path}/`))
  on('fs.exists', ($, e) => ({ value: e.path in files || isDir(e.path) }))
  on('fs.list', ($, e) => {
    const names = new Set<string>()
    for (const f of Object.keys(files)) if (f.startsWith(`${e.path}/`)) names.add(f.slice(e.path.length + 1).split('/')[0]!)
    return { value: [...names].map(name => ({ name, kind: isDir(`${e.path}/${name}`) ? 'dir' as const : 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  // Links: a path under a linked folder lands under its target, as the real file system resolves it.
  const land = (path: string) => {
    for (const [from, to] of Object.entries(links)) if (path === from || path.startsWith(`${from}/`)) return to + path.slice(from.length)
    return path
  }
  on('fs.stat', ($, e) => {
    const target = land(e.path)
    if (target in files) return { value: { kind: 'file' as const, size: files[target]!.length, mtimeMs: 0, isLink: target !== e.path,
      ...(e.resolve ? { realPath: target } : {}) } }
    if (Object.keys(files).some(f => f.startsWith(`${target}/`))) return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0,
      isLink: target !== e.path, ...(e.resolve ? { realPath: target } : {}) } }
    return { deny: 'missing' }
  })
  on('ui.status', ($, e) => { statuses.push(e.text); return { value: undefined } })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.open', ($, e) => { opened.push(e.focus ? `${e.id} (front)` : e.id); return { value: { isPlaced: true } } })
  const submits: string[] = []
  on('prompt.fill', ($, e) => { fills.push(e.text); return composer ? { isFilled: true } : { isFilled: false } })
  on('prompt.submit', ($, e) => { submits.push(e.text); return { text: e.text } })
  return { reads, statuses, toasts, opened, fills, submits, clock }
}

const at = (file: string) => `${RUN}/${file}`
const scorecard = (buildCreatedAt: string) => JSON.stringify({ run: { buildCreatedAt } })
const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const WATCH: CommandRunInput = {
  command: 'design-lab:watch', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 },
}

describe('design-lab:watch', () => {
  test('finds the active run, opens the pane and shows the status line', async ($, on) => {
    const w = world(on, {
      [`${HOME}/.design-lab/active-run.json`]: JSON.stringify({ workspace: RUN }),
      [at(RUN_FILES.project)]: PROJECT,
      [at(RUN_FILES.progress)]: progress(5_000),
    })
    await $.session.start(SESSION)
    const answer = await $.command.run(WATCH)
    expect(answer.text).toBe('Watching Example site.')
    expect(w.opened, 'brought to the front, over any other pane').toEqual(['design-lab (front)'])
    expect(w.statuses.at(-1)).toBe('steps 3/10 · runner connected · 10m')
  })

  test('answers in full text where nothing draws', async ($, on) => {
    world(on, { [at(RUN_FILES.project)]: PROJECT }, [])
    await $.session.start(SESSION)
    const answer = await $.command.run({ ...WATCH, args: RUN })
    expect(answer.text).toContain('design-lab · Example site')
    expect(answer.text).toContain('▸ components')
  })

  test('says what to do when no run is active', async ($, on) => {
    world(on, {})
    await $.session.start(SESSION)
    expect((await $.command.run(WATCH)).text).toContain('/design-lab:watch <run folder>')
  })

  test('the watchdog raises the alarm once, and again only after the runner came back', async ($, on) => {
    const files: Record<string, string> = { [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.progress)]: progress(5_000) }
    const w = world(on, files)
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    expect(w.toasts).toEqual([])
    files[at(RUN_FILES.progress)] = progress(300_000)
    await w.clock.advance(POLL_MS)
    await w.clock.advance(POLL_MS)
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0], 'the toast says what the Needs you card says').toContain('The Figma runner has stopped')
    files[at(RUN_FILES.progress)] = progress(1_000)
    await w.clock.advance(POLL_MS)
    files[at(RUN_FILES.progress)] = progress(300_000)
    await w.clock.advance(POLL_MS)
    expect(w.toasts).toHaveLength(2)
  })

  test('a half-written progress file keeps the last good reading', async ($, on) => {
    const files: Record<string, string> = { [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.progress)]: progress(5_000) }
    const w = world(on, files)
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    files[at(RUN_FILES.progress)] = '{"state": "buil'
    await w.clock.advance(POLL_MS)
    expect(w.statuses.at(-1)).toContain('steps 3/10')
  })

  test('the pane draws on every surface, and its one button fills the resume request', async ($, on) => {
    const stopped = JSON.stringify({ phase: 'components', status: 'stopped',
      message: 'Open Figma desktop, open the file, and start the design-lab runner.' })
    const w = world(on, {
      [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.progress)]: progress(300_000),
      [at(RUN_FILES.phaseLog)]: `${stopped}\n`,
      [at(RUN_FILES.runnerLog)]: '2026-10-02T11:50:00 serving verify:page (3/10)\n2026-10-02T11:50:01 recorded verify:page\n',
    })
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({
        plugin: 'design-lab', surface, component: 'Pane', requestId: 'design-lab',
        props: { title: 'design-lab', isFocused: false, bodyColumns: 60, placement: 'dock',
          scroll: { offset: 0, bodyRows: 30 }, view: {} },
      })
      expect(await ui.find({ type: 'Text', text: /Preflight/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Needs you$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Open Figma desktop/ })).toBeDefined()
      expect((await ui.find({ type: 'Button' }))?.props.label).toBe('Resume run')
      expect(await ui.find({ type: 'Text', text: /serving|recorded/ }), 'no runner log in the pane').toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /3 of 10 steps/ }), 'stopped, the bar alone shows the steps').toBeUndefined()
      const card = await ui.find({ type: 'Box', key: 'card-build' })
      expect(card, 'the stopped Build card is open').toBeDefined()
      expect(card?.props.borderColor, 'the Needs you card is the only yellow box').toBeUndefined()
      await ui.press({ key: 'resume' })
      await ui.unmount()
    }
    expect(w.fills).toHaveLength(4)
    expect(w.fills[0]).toContain(`Resume the design-lab run in ${RUN}`)
    expect(w.submits, 'a filled prompt box is left for the person to send').toEqual([])
  })

  test('with the prompt box held by a dialog, nothing is sent and the person is told', async ($, on) => {
    const stopped = JSON.stringify({ phase: 'components', status: 'stopped', message: 'Start the runner.' })
    const w = world(on, { [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.progress)]: progress(300_000),
      [at(RUN_FILES.phaseLog)]: `${stopped}\n` }, ['desktop'], false)
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    const ui = await $.ui.mount({
      plugin: 'design-lab', surface: 'desktop', component: 'Pane', requestId: 'design-lab',
      props: { title: 'design-lab', isFocused: false, bodyColumns: 60, placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect((await ui.find({ type: 'Button', key: 'resume' }))?.props.label).toBe('Resume run')
    await ui.press({ key: 'resume' })
    expect(w.submits).toEqual([])
    expect(w.toasts.at(-1)).toContain('close the open dialog')
  })

  test('when the recap appears the pane shows it and says so once', async ($, on) => {
    const files: Record<string, string> = { [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.progress)]: progress(5_000) }
    const w = world(on, files)
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    files[at(RUN_FILES.scorecard)] = scorecard(CREATED)
    files[at(RUN_FILES.completion)] = 'design-lab finished the Example site component library.\n\n- Figma file: https://www.figma.com/design/KEY'
    await w.clock.advance(POLL_MS)
    await w.clock.advance(POLL_MS)
    expect(w.toasts.filter(t => t.includes('is done'))).toHaveLength(1)
    expect(w.statuses.at(-1), 'the status line clears once the run is done').toBeUndefined()
    const ui = await $.ui.mount({
      plugin: 'design-lab', surface: 'terminal', component: 'Pane', requestId: 'design-lab',
      props: { title: 'design-lab', isFocused: false, bodyColumns: 60, placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /^Recap$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\u00a0Done\u00a0$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /runner/ }), 'a finished run shows no runner line').toBeUndefined()
    expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  })

  test('a finished run leads with its headline figures from the scorecard', async ($, on) => {
    const card = JSON.stringify({ run: { buildCreatedAt: CREATED },
      headline: { coverage: { built: 48, eligible: 58 }, accuracy: { corrected: { pass: 22, total: 144 } },
        effort: { workingSeconds: 13_435, buildSeconds: 749, buildSteps: 540, tokens: 40_013_109 } },
      sections: { conformance: { open: { blocker: 6, major: 2, minor: 2 } } } })
    world(on, { [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.progress)]: progress(5_000),
      [at(RUN_FILES.scorecard)]: card, [at(RUN_FILES.completion)]: 'design-lab finished.\n',
      [at(ARTIFACT_FILES.report)]: '<html></html>',
      [at(RUN_FILES.verifyReport)]: JSON.stringify({ generatedAt: ago(60_000), passed: ['a'],
        open: [...Array(6).fill({ severity: 'blocker' }), ...Array(2).fill({ severity: 'major' }), ...Array(2).fill({ severity: 'minor' })] }) })
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    const ui = await $.ui.mount({
      plugin: 'design-lab', surface: 'desktop', component: 'Pane', requestId: 'design-lab',
      props: { title: 'design-lab', isFocused: false, bodyColumns: 60, placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    for (const text of [/^83%$/, /^48 of 58 buildable$/, /^10 not built$/, /^15%$/, /^22 of 144 widths within tolerance$/, /^3h 44m$/,
      /^40\.0M$/, /^6 blockers · 2 major open$/, /^\u00a0Done · needs review\u00a0$/, /^Verification found problems$/, /^report ready$/]) {
      expect(await ui.find({ type: 'Text', text }), String(text)).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /^22\/144$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^6 blocking and 2 major problems are still open/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^example$/ }), 'the Time tile holds the time, not the subtitle').toBeDefined()
    expect((await ui.find({ type: 'Box', key: 'tile-coverage' }))?.props.borderColor, 'tile borders stay quiet').toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^83%$/ }))?.props.color, 'short of 100% is yellow').toBe('yellow')
    expect((await ui.find({ type: 'Text', text: /^3h 44m$/ }))?.props.color).toBe('magenta')
    expect(await ui.find({ type: 'Markdown', text: /Open the benchmark report/ }), 'the artifacts are listed').toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /Build plan/ }), 'a file the run does not have is not linked').toBeUndefined()
    const folded = (await ui.findAll({ type: 'Markdown' })).length
    expect(await ui.find({ type: 'Markdown', text: /^design-lab finished/ }), 'the recap stays folded until asked for').toBeUndefined()
    await ui.press({ key: 'recap' })
    expect(await ui.findAll({ type: 'Markdown' })).toHaveLength(folded + 1)
  })

  test('a finished run whose verification is clean reads Done, with no verdict card', async ($, on) => {
    const card = JSON.stringify({ run: { buildCreatedAt: CREATED },
      headline: { coverage: { built: 58, eligible: 58 }, accuracy: { corrected: { pass: 144, total: 144 } } } })
    world(on, { [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.scorecard)]: card, [at(RUN_FILES.completion)]: 'design-lab finished.\n',
      [at(RUN_FILES.verifyReport)]: JSON.stringify({ generatedAt: ago(60_000), passed: ['a', 'b'], open: [] }) })
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    const ui = await $.ui.mount({
      plugin: 'design-lab', surface: 'desktop', component: 'Pane', requestId: 'design-lab',
      props: { title: 'design-lab', isFocused: false, bodyColumns: 60, placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /^\u00a0Done\u00a0$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^all 2 checks pass$/ })).toBeDefined()
    expect(await ui.find({ type: 'Box', key: 'verdict' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^100%$/ }))?.props.color, 'at 100% the judgment is green').toBe('green')
  })

  test('a runner gone with no stop entry still asks for the person, with a button', async ($, on) => {
    const w = world(on, { [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.progress)]: progress(300_000) })
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    const ui = await $.ui.mount({
      plugin: 'design-lab', surface: 'terminal', component: 'Pane', requestId: 'design-lab',
      props: { title: 'design-lab', isFocused: false, bodyColumns: 60, placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /^\u00a0Needs you\u00a0$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^The Figma runner has stopped/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^When the runner is open again, press Resume run\.$/ })).toBeDefined()
    await ui.press({ key: 'resume' })
    expect(w.fills).toHaveLength(1)
  })

  test('two stages under way: both show as active, only the first opens', async ($, on) => {
    const project = JSON.stringify({ createdAt: CREATED, run: { siteLabel: 'Example site' },
      phases: { preflight: { status: 'complete' }, discovery: { status: 'running' }, components: { status: 'running' } } })
    world(on, { [at(RUN_FILES.project)]: project, [at(RUN_FILES.progress)]: progress(5_000) })
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    const ui = await $.ui.mount({
      plugin: 'design-lab', surface: 'terminal', component: 'Pane', requestId: 'design-lab',
      props: { title: 'design-lab', isFocused: false, bodyColumns: 60, placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /^▸ 2  Discovery$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^▸ 3  Build$/ })).toBeDefined()
    const cards = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('card-'))
    expect(cards.map(box => box.key)).toEqual(['card-discovery'])
  })

  test('at narrow widths the bar fits, the tiles stack and the steps go one per line', async ($, on) => {
    const card = JSON.stringify({ run: { buildCreatedAt: CREATED },
      headline: { coverage: { built: 48, eligible: 58 }, accuracy: { corrected: { pass: 22, total: 144 } } } })
    const files: Record<string, string> = { [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.progress)]: progress(5_000) }
    const w = world(on, files)
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    const mount = (bodyColumns: number) => $.ui.mount({
      plugin: 'design-lab', surface: 'terminal', component: 'Pane', requestId: 'design-lab',
      props: { title: 'design-lab', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    for (const columns of [24, 32, 40]) {
      const ui = await mount(columns)
      const bars = await ui.findAll({ type: 'Text', text: /^━+$/ })
      expect(bars.length, `a bar at ${columns}`).toBeGreaterThan(0)
      for (const bar of bars) expect(bar.text.length, `bar at ${columns}`).toBeLessThanOrEqual(columns - 10)
      // Below 40 columns each step is its own line.
      expect((await ui.find({ type: 'Text', text: /^▸ Components$/ }))?.props.wrap, `steps at ${columns}`)
        .toBe(columns < 40 ? 'truncate-end' : 'wrap')
      await ui.unmount()
    }
    files[at(RUN_FILES.scorecard)] = card
    files[at(RUN_FILES.completion)] = 'design-lab finished.\n'
    await w.clock.advance(POLL_MS)
    for (const columns of [24, 32, 40]) {
      const ui = await mount(columns)
      for (const key of ['tile-coverage', 'tile-accuracy', 'tile-time', 'tile-tokens']) {
        expect((await ui.find({ type: 'Box', key }))?.props.width, `${key} at ${columns}`).toBe('100%')
      }
      await ui.unmount()
    }
    const wide = await mount(60)
    expect((await wide.find({ type: 'Box', key: 'tile-coverage' }))?.props.width).toBe('50%')
  })

  test('preflight items tick as preflight proves them, with nothing pressed', async ($, on) => {
    // What workflow.py init seeds: preflight records its phase only once it passes.
    const preflighting = JSON.stringify({ createdAt: CREATED, run: { siteLabel: 'Example site' },
      phases: Object.fromEntries(['discovery', 'inventory', 'usage', 'capture', 'tokens', 'plan', 'foundation', 'components', 'index', 'verify']
        .map(name => [name, { status: 'pending' }])) })
    const checks = (runner: string, message: string | null) => JSON.stringify({ pass: ago(30_000), at: ago(1_000), ready: null,
      checks: [{ id: 'site', label: 'The local site answers', status: 'done', message: null, dependsOn: [] },
        { id: 'runner', label: 'Runner connected to the target file', status: runner, message, dependsOn: [] }] })
    const files: Record<string, string> = { [at(RUN_FILES.project)]: preflighting,
      [at(RUN_FILES.preflightChecks)]: checks('needs-you', 'Open the target file and start the design-lab runner.') }
    const w = world(on, files)
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    const mount = () => $.ui.mount({
      plugin: 'design-lab', surface: 'terminal', component: 'Pane', requestId: 'design-lab',
      props: { title: 'design-lab', isFocused: false, bodyColumns: 60, placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    let ui = await mount()
    expect(await ui.find({ type: 'Text', text: /! Runner connected/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Open the target file and start/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^! 1  Preflight$/ }), 'a check that needs the person stops the stage').toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\u00a0Needs you\u00a0$/ })).toBeDefined()
    expect(w.statuses.at(-1)).toContain('preflight 1/2')
    await ui.unmount()
    files[at(RUN_FILES.preflightChecks)] = checks('done', null)
    await w.clock.advance(POLL_MS)
    ui = await mount()
    expect(await ui.find({ type: 'Text', text: /✓ Runner connected/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^▸ 1  Preflight$/ }), 'preflight shows as running before it records a phase').toBeDefined()
    expect(await ui.find({ type: 'Box', key: 'card-preflight' }), 'its checklist is open').toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\u00a0Preflight\u00a0$/ })).toBeDefined()
    expect(w.statuses.at(-1)).toContain('preflight 2/2')
    expect(w.fills).toEqual([])
  })

  test("the build's wait for the runner is told once, with no button, below the pane's close button", async ($, on) => {
    const waiting = JSON.stringify({ phase: 'connect', status: 'waiting', message: 'Open the file and start the design-lab runner.' })
    const w = world(on, { [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.phaseLog)]: `${waiting}\n` })
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    await w.clock.advance(POLL_MS)
    expect(w.toasts.filter(t => t.includes('needs you'))).toHaveLength(1)
    const ui = await $.ui.mount({
      plugin: 'design-lab', surface: 'terminal', component: 'Pane', requestId: 'design-lab',
      props: { title: 'design-lab', isFocused: false, bodyColumns: 60, placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect((await ui.find({ type: 'Box' }))?.props.marginTop, 'the first row is left to the close button').toBe(1)
    expect(await ui.find({ type: 'Text', text: /^\u00a0Needs you\u00a0$/ }), 'the header says so in one word').toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Open the file/ })).toBeDefined()
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
  })

  test('a recap left from an earlier build in the same folder raises nothing', async ($, on) => {
    const w = world(on, { [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.progress)]: progress(5_000),
      [at(RUN_FILES.completion)]: 'design-lab finished.\n', [at(RUN_FILES.scorecard)]: scorecard(ago(90_000_000)) })
    await $.session.start(SESSION)
    await $.command.run({ ...WATCH, args: RUN })
    await w.clock.advance(POLL_MS)
    expect(w.toasts).toEqual([])
    expect(w.statuses.at(-1)).toContain('steps 3/10')
  })

  test('/design-lab:recap answers with the completion message, with no Claude turn', async ($, on) => {
    world(on, { [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.completion)]: 'design-lab finished.\n',
      [at(RUN_FILES.scorecard)]: scorecard(CREATED) })
    await $.session.start(SESSION)
    const answer = await $.command.run({ ...WATCH, command: 'design-lab:recap', args: RUN })
    expect(answer.text).toBe('design-lab finished.')
  })

  test('/design-lab:recap on an unfinished run says so', async ($, on) => {
    world(on, { [at(RUN_FILES.project)]: PROJECT })
    await $.session.start(SESSION)
    const answer = await $.command.run({ ...WATCH, command: 'design-lab:recap', args: RUN })
    expect(answer.text).toContain('has no recap yet')
  })

  test('reads only the run folder and the pointer, never the runner token', async ($, on) => {
    const w = world(on, {
      [`${HOME}/.design-lab/active-run.json`]: JSON.stringify({ workspace: RUN }),
      [at(RUN_FILES.project)]: PROJECT, [at(RUN_FILES.progress)]: progress(5_000),
      [at(RUN_FILES.runnerLog)]: 'serving component:card (3/10)\n',
    })
    await $.session.start(SESSION)
    await $.command.run(WATCH)
    await w.clock.advance(POLL_MS)
    expect(w.reads.length).toBeGreaterThan(0)
    for (const path of w.reads) {
      expect(path.includes('runner-token')).toBe(false)
      expect(path.startsWith(`${RUN}/`) || path === `${HOME}/.design-lab/active-run.json`
        || path === `${HOME}/.claude/design-lab.json`, path).toBe(true)
    }
  })

  describe('with no run named', () => {
    const PROJECT_DIR = '/sites/EXAMPLE'
    const REPO = `${PROJECT_DIR}/worktrees/main`
    const CONFIG = JSON.stringify({ runs: { convention: 'project' } })
    const run = (name: string, createdAt: string) => ({
      [`${PROJECT_DIR}/design/${name}/project.json`]: JSON.stringify({ createdAt, run: { siteLabel: `Example ${name}` },
        phases: { preflight: { status: 'complete' }, capture: { status: 'running' } } }),
    })

    test('the pane finds this project\'s newest run by convention, and follows a newer one', async ($, on) => {
      const files: Record<string, string> = { [`${HOME}/.claude/design-lab.json`]: CONFIG, [`${REPO}/.git`]: 'gitdir: x',
        ...run('2026-10-01', '2026-10-01T09:00:00+00:00'), ...run('2026-10-03', '2026-10-03T09:00:00+00:00') }
      const w = world(on, files, ['terminal'], true, `${REPO}/frontend`)
      await $.session.start({ ...SESSION, cwd: `${REPO}/frontend` })
      expect((await $.command.run(WATCH)).text).toBe('Watching Example 2026-10-03.')
      Object.assign(files, run('2026-10-04', '2026-10-04T09:00:00+00:00'))
      await w.clock.advance(POLL_MS)
      const ui = await $.ui.mount({ plugin: 'design-lab', surface: 'terminal', component: 'Pane', requestId: 'design-lab',
        props: { title: 'design-lab', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
      expect(await ui.find({ type: 'Text', text: /Example 2026-10-04/ })).toBeDefined()
    })

    test('before the first run, the pane opens and waits for it', async ($, on) => {
      const files: Record<string, string> = { [`${HOME}/.claude/design-lab.json`]: CONFIG, [`${REPO}/.git`]: 'gitdir: x',
        [`${PROJECT_DIR}/design/.keep`]: '' }
      const w = world(on, files, ['terminal'], true, REPO)
      await $.session.start({ ...SESSION, cwd: REPO })
      expect((await $.command.run(WATCH)).text).toContain(`No design-lab run yet in ${PROJECT_DIR}/design`)
      expect(w.opened).toEqual(['design-lab (front)'])
      Object.assign(files, run('2026-10-05', '2026-10-05T09:00:00+00:00'))
      await w.clock.advance(POLL_MS)
      expect(w.statuses.at(-1)).toContain('capture')
    })

    test('before design-lab:init, it says to run it', async ($, on) => {
      world(on, { [`${REPO}/.git`]: 'gitdir: x' }, ['terminal'], true, REPO)
      await $.session.start({ ...SESSION, cwd: REPO })
      expect((await $.command.run(WATCH)).text).toContain('run design-lab:init once')
    })
  
    test('an empty runs folder waits for this project, never another project the pointer names', async ($, on) => {
      const files: Record<string, string> = { [`${HOME}/.claude/design-lab.json`]: CONFIG, [`${REPO}/.git`]: 'gitdir: x',
        [`${PROJECT_DIR}/design/.keep`]: '',
        [`${HOME}/.design-lab/active-run.json`]: JSON.stringify({ workspace: '/elsewhere/OTHER/design/run' }),
        ['/elsewhere/OTHER/design/run/project.json']: JSON.stringify({ createdAt: '2026-10-01T09:00:00+00:00', run: { siteLabel: 'Other' } }) }
      world(on, files, ['terminal'], true, REPO)
      await $.session.start({ ...SESSION, cwd: REPO })
      const answer = (await $.command.run(WATCH)).text
      expect(answer).toContain(`No design-lab run yet in ${PROJECT_DIR}/design`)
      expect(answer).not.toContain('Other')
    })

    test('runs that began in the same second are ordered by folder name, as the scripts order them', async ($, on) => {
      const files: Record<string, string> = { [`${HOME}/.claude/design-lab.json`]: CONFIG, [`${REPO}/.git`]: 'gitdir: x',
        ...run('2026-10-03-2', '2026-10-03T09:00:00+00:00'), ...run('2026-10-03', '2026-10-03T09:00:00+00:00') }
      world(on, files, ['terminal'], true, REPO)
      await $.session.start({ ...SESSION, cwd: REPO })
      expect((await $.command.run(WATCH)).text).toBe('Watching Example 2026-10-03-2.')
    })

    test('a session in a linked folder finds the project the link leads to', async ($, on) => {
      const files: Record<string, string> = { [`${HOME}/.claude/design-lab.json`]: CONFIG, [`${REPO}/.git`]: 'gitdir: x',
        ...run('2026-10-03', '2026-10-03T09:00:00+00:00') }
      world(on, files, ['terminal'], true, '/short/site', { '/short/site': REPO })
      await $.session.start({ ...SESSION, cwd: '/short/site' })
      expect((await $.command.run(WATCH)).text).toBe('Watching Example 2026-10-03.')
    })

    const finished = (name: string, createdAt: string) => ({
      ...run(name, createdAt),
      [`${PROJECT_DIR}/design/${name}/benchmark/completion.md`]: `Example ${name} is done.`,
      [`${PROJECT_DIR}/design/${name}/benchmark/scorecard.json`]: JSON.stringify({ run: { buildCreatedAt: createdAt } }),
    })
    const RUN_SKILL: CommandRunInput = { ...WATCH, command: 'design-lab:run' }
    const pane = ($: Parameters<Parameters<typeof test>[1]>[0]) => $.ui.mount({ plugin: 'design-lab', surface: 'terminal',
      component: 'Pane', requestId: 'design-lab', props: { title: 'design-lab', isFocused: false, bodyColumns: 60,
        placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })

    test('design-lab:run opens the pane itself, passes over the finished run and shows the new one', async ($, on) => {
      const files: Record<string, string> = { [`${HOME}/.claude/design-lab.json`]: CONFIG, [`${REPO}/.git`]: 'gitdir: x',
        ...finished('2026-10-03', '2026-10-03T09:00:00+00:00') }
      on('command.run', { command: 'design-lab:run' }, () => ({ text: '' }))
      const w = world(on, files, ['terminal'], true, REPO)
      await $.session.start({ ...SESSION, cwd: REPO })
      await $.command.run(RUN_SKILL)
      expect(w.opened, 'beside the conversation, without taking the keyboard').toEqual(['design-lab'])
      const ui = await pane($)
      expect(await ui.find({ type: 'Text', text: /Waiting for the new design-lab run/ })).toBeDefined()
      expect(w.toasts, 'the old run\'s recap is not news').toEqual([])
      Object.assign(files, run('2026-10-05', '2026-10-05T09:00:00+00:00'))
      await w.clock.advance(POLL_MS)
      expect(await ui.find({ type: 'Text', text: /Example 2026-10-05/ })).toBeDefined()
      expect(w.statuses.at(-1)).toContain('capture')
    })

    test('design-lab:run on a run still going shows that run at once', async ($, on) => {
      const files: Record<string, string> = { [`${HOME}/.claude/design-lab.json`]: CONFIG, [`${REPO}/.git`]: 'gitdir: x',
        ...finished('2026-10-01', '2026-10-01T09:00:00+00:00'), ...run('2026-10-03', '2026-10-03T09:00:00+00:00') }
      on('command.run', { command: 'design-lab:run' }, () => ({ text: '' }))
      const w = world(on, files, ['terminal'], true, REPO)
      await $.session.start({ ...SESSION, cwd: REPO })
      await $.command.run(RUN_SKILL)
      expect(w.opened).toEqual(['design-lab'])
      expect(await (await pane($)).find({ type: 'Text', text: /Example 2026-10-03/ })).toBeDefined()
    })

    test('design-lab:figma-build opens it too, and so does either skill called through the Skill tool', async ($, on) => {
      const files: Record<string, string> = { [`${HOME}/.claude/design-lab.json`]: CONFIG, [`${REPO}/.git`]: 'gitdir: x',
        ...finished('2026-10-03', '2026-10-03T09:00:00+00:00') }
      on('command.run', { command: 'design-lab:figma-build' }, () => ({ text: '' }))
      on('skill.prompt', ($, e) => ({ text: e.text }))
      const w = world(on, files, ['terminal'], true, REPO)
      await $.session.start({ ...SESSION, cwd: REPO })
      await $.command.run({ ...WATCH, command: 'design-lab:figma-build' })
      expect(w.opened).toEqual(['design-lab'])
      await $.skill.prompt({ skill: 'design-lab:run', text: 'Run design-lab end to end' })
      await $.skill.prompt({ skill: 'commit', text: 'not ours' })
      expect(w.opened).toEqual(['design-lab', 'design-lab'])
    })

    test('before design-lab:init, design-lab:run opens nothing: the skill sends the person to init', async ($, on) => {
      on('command.run', { command: 'design-lab:run' }, () => ({ text: '' }))
      const w = world(on, { [`${REPO}/.git`]: 'gitdir: x' }, ['terminal'], true, REPO)
      await $.session.start({ ...SESSION, cwd: REPO })
      await $.command.run(RUN_SKILL)
      expect(w.opened).toEqual([])
    })

    test('a file named like a marker is not a project folder', async ($, on) => {
      const files: Record<string, string> = { [`${HOME}/.claude/design-lab.json`]: CONFIG,
        ['/work/plain/.git']: 'gitdir: x', ['/work/plans']: 'a file, not a folder' }
      world(on, files, ['terminal'], true, '/work/plain')
      await $.session.start({ ...SESSION, cwd: '/work/plain' })
      expect((await $.command.run(WATCH)).text).toContain('No design-lab run found for this folder')
    })
  })
})

describe('artifact links', () => {
  test('only files that exist are linked, each path segment encoded, the arrow inside the link', () => {
    const run = '/runs/My site (2) #1?'
    const links = artifactsOf(run, 'https://www.figma.com/design/KEY', new Set([ARTIFACT_FILES.report, ARTIFACT_FILES.verifyReport]))
    expect(links.main).toContain('[Open the Figma library ↗](https://www.figma.com/design/KEY)')
    expect(links.main).toContain('(file:///runs/My%20site%20%282%29%20%231%3F/benchmark/report.html)')
    expect(links.files).toContain('[Verification findings](file:///runs/My%20site%20%282%29%20%231%3F/verify-report.json)')
    expect(links.files).not.toContain('Build plan')
  })
})
