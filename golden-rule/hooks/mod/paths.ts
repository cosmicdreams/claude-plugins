// Where a path lands, and whether that is a main worktree, its git metadata, or one of the guard's own
// files. Pure functions over a small file-system view, so tests can run them without the engine.

export type Policy = {
  containers: string[]
  guardFiles: string[]
  guardPatterns: string[]
  mcpReadTools: string[]
  pluginId: string
  quarantineFile: string
}

/** The file-system answers the decisions need. `realPath` is undefined only for a path that is not there. */
export type Io = {
  realPath: (path: string) => Promise<string | undefined>
  exists: (path: string) => Promise<boolean>
}

export function expandHome(path: string, home: string): string {
  if (path === '~') return home
  return path.startsWith('~/') ? `${home}${path.slice(1)}` : path
}

/** Collapses `.`, `..` and repeated slashes without touching the disk. Relative paths join `cwd`. */
export function normalize(path: string, cwd = '/'): string {
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

export const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/'
export const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
// macOS volumes are case-insensitive by default: `MAIN` and `.GIT` name the same folders.
const named = (path: string, name: string): boolean => baseOf(path).toLowerCase() === name

/** Every directory from `path` up to the root, nearest first. */
export function ancestorsOf(path: string): string[] {
  const out: string[] = []
  for (let at = path; ; at = parentOf(at)) {
    out.push(at)
    if (at === '/') return out
  }
}

/**
 * Where a path a tool names would land: the file's real path if it exists, else its deepest existing
 * folder's real path plus the rest. A file-system error other than "not there" propagates, so the
 * calling gate's `.catch` refuses instead of judging a path it could not place.
 */
export async function placed(path: string, cwd: string, home: string, io: Io): Promise<string> {
  const spelled = normalize(expandHome(path, home), cwd)
  const rest: string[] = []
  for (let at = spelled; ; at = parentOf(at)) {
    const real = await io.realPath(at)
    if (real !== undefined) return normalize([real, ...rest].join('/'))
    if (at === '/') return spelled
    rest.unshift(baseOf(at))
  }
}

/**
 * The main worktree a real path is inside, if any: the nearest ancestor that is a working-tree root named
 * `main` (any case). A repository nested inside a main worktree stays inside it; a feature worktree nested
 * inside a project root that merely has `main` checked out is not inside one, since that root is not
 * named `main`.
 */
export async function mainWorktreeOf(real: string, io: Io): Promise<string | undefined> {
  for (const dir of ancestorsOf(real)) {
    if (named(dir, 'main') && await io.exists(`${dir}/.git`)) return dir
  }
  return undefined
}

/**
 * Whether a real path is inside the git directory of a repository that has a main worktree: its own
 * `.git` (the main worktree's) or a shared one whose linked worktree `main` lives elsewhere. Git writes
 * these itself; a session's Edit or Write never needs to.
 */
export async function governedGitPath(real: string, io: Io): Promise<string | undefined> {
  for (const dir of ancestorsOf(real)) {
    if (!named(dir, '.git')) continue
    if (named(parentOf(dir), 'main') || await io.exists(`${dir}/worktrees/main`)) return dir
  }
  return undefined
}

const lower = (path: string): string => path.toLowerCase()

/** Whether a real path is one of the guard's own files, or a place that would load a new hooks module. */
export function isGuardPath(real: string, policy: Policy, home: string, pluginRoot: string): boolean {
  const roots = [pluginRoot, ...policy.guardFiles.map(file => normalize(expandHome(file, home)))].map(lower)
  const path = lower(real)
  if (roots.some(root => path === root || path.startsWith(`${root}/`))) return true
  return policy.guardPatterns.some(pattern => new RegExp(pattern, 'i').test(real))
}

/** Settings files that could switch a plugin off, in any Claude configuration folder (`~/.claude-work` too). */
export const isSettingsFile = (real: string): boolean => /\/\.claude[^/]*\/settings(\.local)?\.json$/i.test(real)

/** Absolute, home-relative and relative path tokens in a command or a tool's string arguments. */
export function pathLiterals(text: string): string[] {
  return [...text.matchAll(/(?:^|[\s"'`=:(])((?:~|\/)[^\s"'`;|&()<>]*)/g)].map(match => match[1]).filter(path => path.length > 1)
}

/** Relative tokens that name a `main` folder (`../main/README.md`), resolved later against the working directory. */
export function relativeMainTokens(text: string): string[] {
  return [...text.matchAll(/[^\s"'`;|&()<>]+/g)].map(match => match[0])
    .filter(token => /(^|\/)main(\/|$)/i.test(token) && !/^[~/-]/.test(token))
}
