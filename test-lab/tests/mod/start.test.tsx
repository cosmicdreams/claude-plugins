// Interrupting a run tool call before or as its runner starts. The host test kit has no way to abort a
// tool call's `next.signal`, so these drive the mod's startOperation with a real AbortSignal and a
// small stand-in for the host: process, files, store, clock, session and pane. What the stand-in
// answers mirrors the host test kit's world in register.test.tsx.

import type { EngineInterface } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { startOperation } from '../../hooks/mod/register'
import type { RunInput } from '../../hooks/mod/operation'

const SESSIONS = '/data/mod/sessions'
const INPUT: RunInput = { operation: 'run', appRoot: '/work/app', suiteRoot: '/work/qa-suite', environment: 'local', work: null, noWork: true, adapter: null, inputs: null, timeoutMs: 60_000 }

type When = 'locate' | 'open' | 'launch'

function host(controller: AbortController, abortAt: When | null, delayedAt: 'file' | 'store' | 'pane' | null = null) {
  let now = Date.parse('2026-10-09T12:00:00Z')
  let delayed = false
  const delay = (at: string) => { if (delayedAt === at && !delayed) { now += 900_000; delayed = true } }
  const files: Record<string, string> = {}
  const store: Record<string, unknown> = {}
  const launched: string[][] = []
  const launchTimes: number[] = []
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
  const $ = {
    env: { get: async () => undefined },
    plugin: { root: '/plugin' },
    process: {
      run: async (argv: readonly string[]) => {
        if (argv[2] === '--data-dir') {
          if (abortAt === 'locate') controller.abort()
          return { exitCode: 0, stdout: JSON.stringify({ sessions: SESSIONS, node: '24.19.1', runtime: { ok: true } }), stderr: '' }
        }
        launched.push([...argv])
        launchTimes.push(now)
        if (abortAt === 'launch') {
          controller.abort()
          await settle()
        }
        return { exitCode: 4, stdout: '', stderr: 'stopped' }
      },
    },
    fs: {
      stat: async (path: string) => ({ kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: path }),
      write: async (path: string, text: string) => { files[path] = text; delay('file') },
      read: async (path: string) => {
        if (!(path in files)) throw new Error('ENOENT')
        return files[path]!
      },
      exists: async (path: string) => path in files,
    },
    store: {
      get: async (key: string) => store[key],
      set: async (key: string, value: unknown) => { store[key] = JSON.parse(JSON.stringify(value)); delay('store') },
      delete: async (key: string) => { delete store[key] },
      keys: async () => Object.keys(store),
    },
    clock: { now: async () => now, every: () => ({ cancel: () => undefined }) },
    session: { id: async () => 'session-a', surfaces: async () => ['terminal'] },
    ui: {
      open: async () => { delay('pane'); if (abortAt === 'open') controller.abort() },
      invalidate: () => undefined,
      status: () => undefined,
      toast: () => undefined,
      log: () => undefined,
    },
  }
  const records = () => Object.entries(store).filter(([k]) => k.startsWith('op:')).map(([, v]) => v as { phase: string; dir: string; startedAt: number; launchedAt: number | null })
  return { $: $ as unknown as EngineInterface, files, store, launched, launchTimes, records }
}

describe('a run tool call interrupted before its runner starts', () => {
  test('an already-interrupted call starts nothing and records nothing', async () => {
    const controller = new AbortController()
    controller.abort()
    const h = host(controller, null)
    expect(await startOperation(h.$, INPUT, controller.signal)).toBe('test-lab fast run: interrupted before it started; nothing ran.')
    expect(h.launched).toEqual([])
    expect(h.records()).toEqual([])
  })

  test('interrupted while the runner is located: no runner starts and nothing is recorded', async () => {
    const controller = new AbortController()
    const h = host(controller, 'locate')
    expect(await startOperation(h.$, INPUT, controller.signal)).toMatch(/interrupted before it started; nothing ran/)
    expect(h.launched).toEqual([])
    expect(h.records()).toEqual([])
  })

  test('interrupted after it was recorded: the runner is never started, the record says so, and a stop is left for any runner', async () => {
    const controller = new AbortController()
    const h = host(controller, 'open')
    expect(await startOperation(h.$, INPUT, controller.signal)).toMatch(/interrupted before it started; nothing ran/)
    expect(h.launched).toEqual([])
    const [record] = h.records()
    expect(record?.phase).toBe('not-started')
    expect(h.files[`${record!.dir}/cancel`]).toBe('stop\n')
  })

  test('interrupted as the runner starts: a stop request is written for the runner to honour', async () => {
    const controller = new AbortController()
    const h = host(controller, 'launch')
    await startOperation(h.$, INPUT, controller.signal)
    expect(h.launched.length).toBe(1)
    const dir = h.launched[0]![3]!
    expect(h.files[`${dir}/cancel`]).toBe('stop\n')
    expect(h.records()[0]?.phase).toBe('ended')
  })
})


describe('preparation waits are separate from actual host launch timing', () => {
  for (const at of ['file', 'store', 'pane'] as const) test(`a delayed ${at} operation does not consume the launch deadline`, async () => {
    const h = host(new AbortController(), null, at)
    await startOperation(h.$, INPUT)
    expect(h.launched.length).toBe(1)
    expect(h.records()[0]?.launchedAt).toBe(h.launchTimes[0])
    expect(h.records()[0]!.launchedAt! - h.records()[0]!.startedAt).toBe(900_000)
  })
})
