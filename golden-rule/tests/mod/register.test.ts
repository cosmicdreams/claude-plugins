// Hook decisions under the mocked engine. What actually reaches the disk is the end-to-end suite's job
// (tests/e2e/run.zsh): these tests prove which calls are refused, rewritten or passed.
import { describe, expect, test } from 'claude-code/testing'

import { SHORT_RULE } from '../../hooks/mod/rule'
import { BASE, FEATURE, HOME, MAIN, NESTED, world } from './world'

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

  test('a MAIN spelling of the main worktree is the same folder on a case-insensitive volume', async ($, on) => {
    world(on, { files: { [`${HOME}/Sites/P/worktrees/MAIN/.git`]: '' } })
    const answer = await $.tool.call({ tool: 'Write', file_path: `${HOME}/Sites/P/worktrees/MAIN/x.txt`, content: 'x' })
    expect(answer.deny).toMatch(/main worktree/)
  })

  test("a linked main worktree's git metadata outside its folder is refused", async ($, on) => {
    world(on)
    for (const file_path of [`${BASE}/.git/config`, `${BASE}/.git/worktrees/main/HEAD`]) {
      const answer = await $.tool.call({ tool: 'Write', file_path, content: 'x' })
      expect(answer.deny).toMatch(/git metadata of the main worktree .*Sites\/L\/worktrees\/main/)
    }
  })

  test('an Edit is judged by the settings file it would leave', async ($, on) => {
    const settings = `${HOME}/.claude/settings.json`
    world(on, { files: { [settings]: '{\n  "enabledPlugins": { "golden-rule@local": true }\n}\n' } })
    const answer = await $.tool.call({ tool: 'Edit', file_path: settings, old_string: 'true', new_string: 'false' })
    expect(answer.deny).toMatch(/switch the golden rule guard off/)
  })

  test('a symlink followed by .. is resolved before the .. is applied', async ($, on) => {
    world(on, { links: { [`${FEATURE}/link`]: `${MAIN}/sub` } })
    const answer = await $.tool.call({ tool: 'Write', file_path: `${FEATURE}/link/../escaped.txt`, content: 'x' })
    expect(answer.deny).toMatch(/main worktree/)
  })

  test('a link that leads nowhere is refused rather than placed by its own spelling', async ($, on) => {
    const seen = world(on, { links: { [`${FEATURE}/dangling`]: null } })
    const answer = await $.tool.call({ tool: 'Write', file_path: `${FEATURE}/dangling`, content: 'x' })
    expect(answer.deny).toBeDefined()
    expect(seen.calls.length).toBe(0)
  })

  test('MCP calls are refused while the session works inside a main worktree', async ($, on) => {
    const seen = world(on, { cwd: MAIN })
    const answer = await $.tool.call({ tool: 'mcp__files__write_file', path: 'LICENSE', content: 'x' } as never)
    expect(answer.deny).toMatch(/session's folder is inside the main worktree/)
    expect(seen.calls.length).toBe(0)
  })

  test('an MCP destination reached through a link into main is refused, whatever its name looks like', async ($, on) => {
    world(on, { cwd: FEATURE, links: { [`${FEATURE}/LICENSE`]: `${MAIN}/LICENSE`, [`${FEATURE}/docs`]: MAIN } })
    for (const path of ['LICENSE', 'docs/My File.md']) {
      const answer = await $.tool.call({ tool: 'mcp__files__write_file', path, content: 'x' } as never)
      expect(answer.deny).toMatch(/main worktree/)
    }
  })

  test('a settings file is recognised by where its link resolves at the time of the write', async ($, on) => {
    world(on, { links: { [`${HOME}/.claude/settings.json`]: '/config/claude-settings.json' }, files: { '/config/claude-settings.json': '{}' } })
    const content = JSON.stringify({ enabledPlugins: { 'golden-rule@local': false } })
    const answer = await $.tool.call({ tool: 'Write', file_path: '/config/claude-settings.json', content })
    expect(answer.deny).toMatch(/switch the golden rule guard off/)
  })

  test('an MCP destination with a newline in its name is still placed and judged', async ($, on) => {
    world(on, { cwd: FEATURE, links: { [`${FEATURE}/docs`]: MAIN } })
    const answer = await $.tool.call({ tool: 'mcp__files__write_file', path: 'docs/My\nFile.md', content: 'x' } as never)
    expect(answer.deny).toMatch(/main worktree/)
  })

  test('long content in an MCP call is not mistaken for a path', async ($, on) => {
    const seen = world(on, { cwd: FEATURE })
    await $.tool.call({ tool: 'mcp__files__write_file', path: 'note.txt', content: 'This is ordinary prose. '.repeat(60) } as never)
    expect(seen.calls.length).toBe(1)
  })

  test('a file-identity path is refused', async ($, on) => {
    world(on)
    const answer = await $.tool.call({ tool: 'Write', file_path: '/.vol/16777234/123456', content: 'x' })
    expect(answer.deny).toMatch(/identity/)
  })

  test('ordinary text in an MCP call is not judged as a path', async ($, on) => {
    const seen = world(on, { cwd: FEATURE })
    await $.tool.call({ tool: 'mcp__chat__send_message', text: 'the build is green' } as never)
    expect(seen.calls.length).toBe(1)
  })

  test('an MCP tool naming a main worktree is refused unless policy lists it as read-only', async ($, on) => {
    const seen = world(on)
    const refused = await $.tool.call({ tool: 'mcp__files__get_file', path: `${MAIN}/README.md` } as never)
    expect(refused.deny).toMatch(/main worktree/)
    await $.tool.call({ tool: 'mcp__reader__read', path: `${MAIN}/README.md` } as never)
    expect(seen.calls.length).toBe(1)
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
