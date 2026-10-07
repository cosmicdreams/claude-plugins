// The pure helpers: path placement, main-worktree detection and push recognition.
import { describe, expect, test } from 'claude-code/testing'

import { mainWorktreeOf, normalize, pathLiterals, placed } from '../../hooks/mod/paths'
import { trunkViolation, wrapCommand } from '../../hooks/mod/shell'

const tree = new Set(['/', '/p', '/p/worktrees', '/p/worktrees/main', '/p/worktrees/main/.git', '/p/worktrees/main/src',
  '/p/worktrees/main/src/main', '/p/worktrees/feat', '/p/worktrees/feat/.git', '/p/worktrees/feat/src', '/p/worktrees/feat/src/main'])
const io = { realPath: async (path: string) => (tree.has(path) ? path : undefined), exists: async (path: string) => tree.has(path) }

describe('paths', () => {
  test('normalize collapses dots and joins relative paths', () => {
    expect(normalize('../main/./a//b', '/p/worktrees/feat')).toBe('/p/worktrees/main/a/b')
  })

  test('placed keeps the unresolved rest under the deepest real folder', async () => {
    expect(await placed('/p/worktrees/main/new/deep.txt', '/', '/h', io)).toBe('/p/worktrees/main/new/deep.txt')
  })

  test('a folder named main inside a feature worktree is not a main worktree', async () => {
    expect(await mainWorktreeOf('/p/worktrees/feat/src/main/X.java', io)).toBeUndefined()
    expect(await mainWorktreeOf('/p/worktrees/main/src/main/X.java', io)).toBe('/p/worktrees/main')
  })

  test('path literals are found inside commands', () => {
    expect(pathLiterals('cat ~/a "/b c" x=/d')).toEqual(['~/a', '/b', '/d'])
  })
})

describe('pushes to main', () => {
  test('every spelling of a push to main is recognised', () => {
    for (const command of ['git push origin main', 'git push origin HEAD:main', 'git push origin +x:refs/heads/main',
      'cd x && git push --all origin', 'gh api -X PATCH repos/a/b/git/refs/heads/main -f sha=1']) {
      expect(trunkViolation(command)).toBeDefined()
    }
  })

  test('feature pushes and reads are not', () => {
    for (const command of ['git push origin HEAD:feature/x', 'git push', 'git log main', 'gh pr merge 3 --squash', 'gh api repos/a/b/git/refs/heads/main']) {
      expect(trunkViolation(command)).toBeUndefined()
    }
  })

  test('the wrapper never carries the command in clear text', () => {
    const wrapped = wrapCommand('/plugin', "echo 'quoted' && rm -rf x")
    expect(wrapped).not.toContain('rm -rf')
    expect(wrapped).toContain("'/plugin/hooks/sandbox/run.py'")
  })
})
