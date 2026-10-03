import { describe, expect, test } from 'claude-code/testing'

import {
  afterFill, isDown, RECAP_LIMIT, plainOf, RUNNER_ABSENT_MS, SERVER_FRESH_MS, statusOf, summaryOf,
} from '../../hooks/mod/model'

const NOW = Date.parse('2026-10-02T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const PROJECT = {
  run: { siteLabel: 'Example site' },
  createdAt: ago(3_600_000),
  phases: {
    capture: { status: 'complete' }, plan: { status: 'approved' },
    components: { status: 'pending' }, verify: { status: 'pending' },
    preflight: { status: 'complete', updatedAt: ago(41 * 60_000) },
  },
}

// The scorecard of this build, as score_run.py stamps it.
const SCORED = { run: { buildCreatedAt: PROJECT.createdAt } }

const progress = (fields: Record<string, unknown> = {}) => ({
  state: 'building', stepsDone: 112, stepsTotal: 158, stepKind: 'use_figma', message: null,
  inflight: false, lastSeen: ago(5_000), at: ago(2_000), serverPid: 1, ...fields,
})

const summary = (raw: Parameters<typeof summaryOf>[1]) => summaryOf('/runs/example', raw, NOW)

describe('summaryOf', () => {
  test('a building run shows its steps, its runner and its current phase', () => {
    const s = summary({ project: PROJECT, progress: progress() })
    expect(s.current).toBe('components')
    expect(s.runner?.connected).toBe(true)
    expect(statusOf(s, NOW)).toBe('design-lab · steps 112/158 · runner connected · 41m')
    expect(plainOf(s)).toContain('steps 112/158, use_figma')
    expect(isDown(s)).toBe(false)
  })

  test('a runner gone quiet is down, and says for how long', () => {
    const s = summary({ project: PROJECT, progress: progress({ lastSeen: ago(RUNNER_ABSENT_MS + 180_000) }) })
    expect(s.runner?.connected).toBe(false)
    expect(isDown(s)).toBe(true)
    expect(plainOf(s)).toContain('runner not seen for 5m')
  })

  test('a slow step in flight counts as connected while the server beats', () => {
    const s = summary({ project: PROJECT, progress: progress({ lastSeen: ago(300_000), inflight: true }) })
    expect(s.runner?.connected).toBe(true)
  })

  test('a stale heartbeat overrides in flight', () => {
    const s = summary({ project: PROJECT,
      progress: progress({ lastSeen: ago(300_000), inflight: true, at: ago(SERVER_FRESH_MS + 1) }) })
    expect(s.runner?.serverAlive).toBe(false)
    expect(s.runner?.connected).toBe(false)
    expect(isDown(s)).toBe(true)
  })

  test('the blocker comes from the phase log and clears when the runner returns', () => {
    const phaseLog = [
      JSON.stringify({ phase: 'components', status: 'running' }),
      JSON.stringify({ phase: 'components', status: 'stopped', message: 'Open Figma desktop and start the runner.' }),
      '',
    ].join('\n')
    const stopped = summary({ project: PROJECT, phaseLog, progress: progress({ lastSeen: ago(300_000) }) })
    expect(stopped.blocker).toBe('Open Figma desktop and start the runner.')
    const back = summary({ project: PROJECT, phaseLog, progress: progress() })
    expect(back.blocker).toBeNull()
  })

  test('a finished run clears the status line and is never down', () => {
    const s = summary({ project: PROJECT, progress: progress({ lastSeen: ago(900_000) }), completion: '# done', scorecard: SCORED })
    expect(statusOf(s, NOW)).toBeUndefined()
    expect(isDown(s)).toBe(false)
  })

  test('a half-written phase log line is skipped, and a missing project says so', () => {
    const s = summary({ project: PROJECT, phaseLog: '{"phase": "capture", "status": "stopped", "message": "x"}\n{"phase": ' })
    expect(s.blocker).toBe('x')
    expect(plainOf(summary({}))).toContain('No design-lab run in /runs/example')
  })
})

describe('afterFill', () => {
  test('filled is done; no prompt box sends; anything else explains', () => {
    expect(afterFill({ isFilled: true })).toBe('done')
    expect(afterFill({ isFilled: false, refusal: 'no_composer' })).toBe('submit')
    expect(afterFill({ isFilled: false, refusal: 'dialog' })).toBe('explain')
    expect(afterFill({ isFilled: false })).toBe('explain')
    expect(afterFill(undefined)).toBe('explain')
  })
})

describe('recap', () => {
  test('the completion message is the recap, cut with a note only if it outgrows Markdown', () => {
    expect(summary({ project: PROJECT, completion: 'design-lab finished.\n', scorecard: SCORED }).recap).toBe('design-lab finished.')
    const long = summary({ project: PROJECT, completion: 'x'.repeat(RECAP_LIMIT + 10), scorecard: SCORED }).recap ?? ''
    expect(long.length).toBeLessThan(10_000)
    expect(long).toContain('benchmark/completion.md')
  })

  test("an earlier build's recap is not this one's, and an unstamped one counts once the benchmark is complete", () => {
    const earlier = { run: { buildCreatedAt: ago(90_000_000) } }
    expect(summary({ project: PROJECT, completion: '# done', scorecard: earlier }).hasRecap).toBe(false)
    expect(summary({ project: PROJECT, completion: '# done' }).hasRecap).toBe(false)
    const benchmarked = { ...PROJECT, phases: { ...PROJECT.phases, benchmark: { status: 'complete' } } }
    expect(summary({ project: benchmarked, completion: '# done' }).hasRecap).toBe(true)
  })
})
