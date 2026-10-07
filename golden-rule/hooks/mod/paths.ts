// Where a path lands, and whether that is a main worktree or one of the guard's own files.
// Pure functions over a small file-system view, so tests can run them without the engine.

export type Policy = {
  containers: string[]
  guardFiles: string[]
  guardPatterns: string[]
  pluginId: string
  quarantineFile: string
}

/** The file-system answers the decisions need: where a path really lands, and whether a path exists. */
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
 * folder's real path plus the rest. Undefined when nothing on the way resolves, which callers treat as
 * "cannot place it" and judge by the spelling alone.
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
 * The main worktree a real path is inside, if any. The nearest folder holding `.git` governs, so a
 * feature worktree nested inside a project root that has `main` checked out is judged on its own.
 * A main worktree is a working-tree root named `main` (in practice `<project>/worktrees/main`).
 */
export async function mainWorktreeOf(real: string, io: Io): Promise<string | undefined> {
  for (const dir of ancestorsOf(real)) {
    if (await io.exists(`${dir}/.git`)) return baseOf(dir) === 'main' ? dir : undefined
  }
  return undefined
}

/** Whether a real path is one of the guard's own files, or a place that would load a new hooks module. */
export function isGuardPath(real: string, policy: Policy, home: string, pluginRoot: string): boolean {
  const roots = [pluginRoot, ...policy.guardFiles.map(file => normalize(expandHome(file, home)))]
  if (roots.some(root => real === root || real.startsWith(`${root}/`))) return true
  return policy.guardPatterns.some(pattern => new RegExp(pattern).test(real))
}

/** Absolute or home-relative path literals in a command or a tool's string arguments. */
export function pathLiterals(text: string): string[] {
  return [...text.matchAll(/(?:^|[\s"'`=:(])((?:~|\/)[^\s"'`;|&()<>]*)/g)].map(match => match[1]).filter(path => path.length > 1)
}
