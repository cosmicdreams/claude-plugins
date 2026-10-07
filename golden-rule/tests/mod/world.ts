// An in-memory world for the hook tests: a home folder, a governed project with a main worktree and a
// feature worktree, and a PNCB-style project root that has `main` checked out with feature worktrees
// nested inside it. Registers the stubs every hook test needs.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const HOME = '/Users/t'
export const MAIN = `${HOME}/Sites/P/worktrees/main`
export const FEATURE = `${HOME}/Sites/P/worktrees/feat`
export const NESTED = `${HOME}/Sites/R/worktrees/T-1`
// A linked main worktree: the repository's first checkout is `base`, whose .git is shared.
export const BASE = `${HOME}/Sites/L/base`
export const LINKED = `${HOME}/Sites/L/worktrees/main`

// The test's copy of hooks/policy.json (tests have no file system to read it from).
export const POLICY = {
  containers: ['~/*'],
  guardFiles: ['~/.claude/hooks/golden-rule.sh', '~/.claude/AGENTS.md', '~/.codex/write-guard', '~/.codex/hooks.json',
    '~/.codex/config.toml', '~/.codex/AGENTS.md', '~/.gitconfig', '~/.git-hooks', '~/.golden-rule'],
  guardPatterns: ['^/.+/\\.claude/skills/[^/]+/hooks(/|$)'],
  mcpReadTools: ['^mcp__reader__'],
  pluginId: 'golden-rule@local',
  quarantineFile: '~/.golden-rule/quarantine.json',
}

const FILES = [`${MAIN}/.git`, `${MAIN}/README.md`, `${FEATURE}/.git`, `${HOME}/Sites/R/.git`, `${NESTED}/.git`,
  `${HOME}/.claude/hooks/golden-rule.sh`, `${HOME}/.claude/settings.json`, `${BASE}/.git/config`, `${BASE}/.git/worktrees/main/HEAD`,
  `${LINKED}/.git`]

function withAncestors(paths: string[]): Set<string> {
  const out = new Set<string>(['/'])
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) out.add(`/${parts.slice(0, i).join('/')}`)
  }
  return out
}

export type Recorded = { calls: Array<Record<string, unknown>>; toasts: string[]; writes: Array<{ path: string; text: string }> }

export function world(on: On, options: { cwd?: string; files?: Record<string, string>; failEnv?: boolean } = {}): Recorded {
  const recorded: Recorded = { calls: [], toasts: [], writes: [] }
  const files = { ...options.files }
  const existing = withAncestors([...FILES, ...Object.keys(files)])
  mock.clock(on, { now: Date.UTC(2026, 9, 7) })
  mock.store(on)
  if (options.failEnv) on('env.get', () => ({ deny: 'no environment in this test' }))
  else mock.env(on, { HOME })
  on('session.cwd', () => ({ value: options.cwd ?? `${HOME}/Sites/P` }))
  on('fs.read', ($, e) => {
    if (e.path.endsWith('/hooks/policy.json')) return { value: JSON.stringify(POLICY) }
    return e.path in files ? { value: files[e.path] } : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.stat', ($, e) => (existing.has(e.path) ? { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } } : { deny: `ENOENT: ${e.path}` }))
  on('fs.exists', ($, e) => ({ value: existing.has(e.path) }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', ($, e) => {
    recorded.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    recorded.toasts.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('tool.call', ($, e) => {
    recorded.calls.push({ ...e })
    return { result: 'ran' }
  })
  return recorded
}
