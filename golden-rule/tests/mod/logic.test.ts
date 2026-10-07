// The pure helpers: path placement, main-worktree and git-metadata detection, the command wrapper.
import { describe, expect, test } from 'claude-code/testing'

import { governedGitPath, mainWorktreeOf, normalize, pathLiterals, placed, relativeMainTokens } from '../../hooks/mod/paths'
import { wrapCommand } from '../../hooks/mod/shell'

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

describe('git metadata and tokens', () => {
  test("a main worktree's git directories are governed wherever git keeps them; a feature worktree's are not", () => {
    const dirs = [
      { root: '/p/worktrees/main', gitdir: '/p/worktrees/main/.git', common: '/p/worktrees/main/.git' },
      { root: '/q/worktrees/main', gitdir: '/q/repo.git/worktrees/main1', common: '/q/repo.git' },
    ]
    expect(governedGitPath('/p/worktrees/main/.git/config', dirs)?.root).toBe('/p/worktrees/main')
    expect(governedGitPath('/q/repo.git/worktrees/main1/HEAD', dirs)?.root).toBe('/q/worktrees/main')
    expect(governedGitPath('/Q/REPO.GIT/config', dirs)?.root).toBe('/q/worktrees/main')
    expect(governedGitPath('/p/worktrees/feat/.git/config', dirs)).toBeUndefined()
  })

  test('a repository nested inside the main worktree is inside it', async () => {
    const nested = { ...io, exists: async (path: string) => tree.has(path) || path === '/p/worktrees/main/src/main/.git' }
    expect(await mainWorktreeOf('/p/worktrees/main/src/main/x', nested)).toBe('/p/worktrees/main/src/main')
  })

  test('relative tokens that name main are found', () => {
    expect(relativeMainTokens('cd ../main && cat README.md src/main.ts')).toEqual(['../main'])
  })

  test('the wrapper never carries the command in clear text', () => {
    const wrapped = wrapCommand('/plugin', "echo 'quoted' && rm -rf x")
    expect(wrapped).not.toContain('rm -rf')
    expect(wrapped).toContain("'/plugin/hooks/sandbox/run.py'")
  })
})
