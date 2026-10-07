// Hook decisions under the mocked engine. What actually reaches the disk is the end-to-end suite's job
// (tests/e2e/run.zsh): these tests prove which calls are refused, rewritten or passed.
import { describe, expect, test } from 'claude-code/testing'

import { SHORT_RULE } from '../../hooks/mod/rule'
import { FEATURE, HOME, MAIN, NESTED, world } from './world'

describe('Layer 2: structured tools', () => {
  test('a Write into the main worktree is refused with the worktree command in the reason', async ($, on) => {
    const seen = world(on)
    const answer = await $.tool.call({ tool: 'Write', file_path: `${MAIN}/new.txt`, content: 'x' })
    expect(answer.deny).toMatch(/main worktree .*worktrees\/main, the reference/)
    expect(answer.deny).toContain('--no-track origin/main')
    expect(seen.calls.length).toBe(0)
  })

  test('a Write in a feature worktree goes through untouched', async ($, on) => {
    const seen = world(on)
    const answer = await $.tool.call({ tool: 'Write', file_path: `${FEATURE}/new.txt`, content: 'x' })
    expect(answer.deny).toBeUndefined()
    expect(seen.calls[0]?.file_path).toBe(`${FEATURE}/new.txt`)
  })

  test('a feature worktree nested inside a project root on main is judged on its own', async ($, on) => {
    const seen = world(on, { cwd: `${HOME}/Sites/R` })
    await $.tool.call({ tool: 'Edit', file_path: `${NESTED}/a.php`, old_string: 'a', new_string: 'b' })
    expect(seen.calls.length).toBe(1)
  })

  test('a relative path that climbs into main is placed before it is judged', async ($, on) => {
    world(on, { cwd: FEATURE })
    const answer = await $.tool.call({ tool: 'Write', file_path: '../main/README.md', content: 'x' })
    expect(answer.deny).toMatch(/main worktree/)
  })

  test("the guard's own files are refused", async ($, on) => {
    world(on)
    const answer = await $.tool.call({ tool: 'Edit', file_path: `${HOME}/.claude/hooks/golden-rule.sh`, old_string: 'exit 2', new_string: 'exit 0' })
    expect(answer.deny).toMatch(/belongs to the golden rule's guard/)
  })

  test('a settings write that switches the guard off is refused', async ($, on) => {
    world(on)
    const content = JSON.stringify({ enabledPlugins: { 'golden-rule@local': false } })
    const answer = await $.tool.call({ tool: 'Write', file_path: `${HOME}/.claude/settings.json`, content })
    expect(answer.deny).toMatch(/switch the golden rule guard off/)
  })

  test('EnterWorktree into the main worktree is refused', async ($, on) => {
    world(on)
    const answer = await $.tool.call({ tool: 'EnterWorktree', path: MAIN })
    expect(answer.deny).toMatch(/never works inside it/)
  })

  test('when the guard itself fails, the edit is refused, not let through', async ($, on) => {
    const seen = world(on, { failEnv: true })
    const answer = await $.tool.call({ tool: 'Write', file_path: `${FEATURE}/new.txt`, content: 'x' })
    expect(answer.deny).toMatch(/edit guard failed/)
    expect(seen.calls.length).toBe(0)
  })
})

describe('Layer 3: commands', () => {
  test('every Bash command is handed to the sandbox bootstrap', async ($, on) => {
    const seen = world(on)
    await $.tool.call({ tool: 'Bash', command: 'echo hi' })
    const ran = String(seen.calls[0]?.command)
    expect(ran.startsWith('__gr=$(/usr/bin/mktemp -t golden-rule)')).toBe(true)
    expect(ran).toContain('/hooks/sandbox/run.py')
    expect(ran).not.toContain('echo hi')
  })

  test('a push to main is refused before anything runs', async ($, on) => {
    const seen = world(on)
    for (const command of ['git push origin HEAD:main', 'git push origin main', 'git push --mirror origin', 'gh pr merge 12 --admin --squash']) {
      const answer = await $.tool.call({ tool: 'Bash', command })
      expect(answer.deny).toMatch(/pull request/)
    }
    expect(seen.calls.length).toBe(0)
  })

  test('a push of a feature branch runs', async ($, on) => {
    const seen = world(on)
    await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD:feature/t' })
    expect(seen.calls.length).toBe(1)
  })
})

describe('Layer 1 and subagents', () => {
  test("a subagent's prompt carries the short rule until the system prompt has it", async ($, on) => {
    const seen = world(on)
    await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'do the thing', subagent_type: 'general-purpose' })
    expect(String(seen.calls[0]?.prompt).startsWith(SHORT_RULE)).toBe(true)
  })
})

describe('/golden-rule', () => {
  test('only the person can clear a quarantine', async ($, on) => {
    const seen = world(on)
    const answer = await $.command.run({ command: 'golden-rule', args: 'clear', origin: { kind: 'plugin', name: 'other' } } as never)
    expect(answer.text).toMatch(/only Chris/)
    expect(seen.writes.length).toBe(0)
  })
})
