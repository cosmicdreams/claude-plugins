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
 * Where a path a tool names would land, resolved the way the file system walks it: component by
 * component, each existing one replaced by its real path before the next `..` is applied (so
 * `link/../x` lands beside the link's target, not beside the link). Past the first component that does
 * not exist the rest is joined as written. A file-system error other than "not there" propagates, so the
 * calling gate's `.catch` refuses instead of judging a path it could not place.
 */
export async function placed(path: string, cwd: string, home: string, io: Io): Promise<string> {
  const expanded = expandHome(path, home)
  let at = expanded.startsWith('/') ? '/' : (await io.realPath(cwd)) ?? normalize(cwd)
  let exists = true
  for (const part of expanded.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      at = parentOf(at)
      continue
    }
    const next = at === '/' ? `/${part}` : `${at}/${part}`
    const real = exists ? await io.realPath(next) : undefined
    if (real === undefined) exists = false
    at = real ?? next
  }
  return at
}

/** A spelling that reaches a file by its identity (`/.vol/<device>/<inode>`), which no path check can judge. */
export const isIdentityPath = (path: string): boolean => /^\/\.vol(\/|$)/i.test(path)

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

/** A main worktree's git directories as git lays them out: its own (`gitdir`) and the shared one. */
export type GitDirs = { root: string; gitdir: string; common: string }

/**
 * Where a main worktree keeps its git metadata: a `.git` folder, or a `.git` file naming a directory
 * elsewhere (a linked worktree under any administrative id, a separate git dir, a bare repository's
 * worktree), whose `commondir` names the shared directory.
 */
export async function gitDirsOf(root: string, read: (path: string) => Promise<string | undefined>, io: Io): Promise<GitDirs> {
  const marker = `${root}/.git`
  const text = await read(marker)
  if (text === undefined) {
    const real = (await io.realPath(marker)) ?? marker
    return { root, gitdir: real, common: real }
  }
  const pointer = /^gitdir: (.+)$/m.exec(text)?.[1]?.trim()
  if (!pointer) throw new Error(`cannot read ${marker}`)
  const gitdir = (await io.realPath(normalize(pointer, root))) ?? normalize(pointer, root)
  const commondir = (await read(`${gitdir}/commondir`))?.trim()
  const common = commondir ? (await io.realPath(normalize(commondir, gitdir))) ?? normalize(commondir, gitdir) : gitdir
  return { root, gitdir, common }
}

/** Which main worktree's git metadata a real path is inside, if any. Git writes there itself; a session's
 * Edit or Write never needs to. */
export function governedGitPath(real: string, dirs: readonly GitDirs[]): GitDirs | undefined {
  const path = real.toLowerCase()
  return dirs.find(({ gitdir, common }) => [gitdir, common].some(dir => path === dir.toLowerCase() || path.startsWith(`${dir.toLowerCase()}/`)))
}

const lower = (path: string): string => path.toLowerCase()

/** Whether a path is one of the guard's own files, or a place that would load a new hooks module.
 * `roots` holds the guard's paths both as written and resolved, and callers pass both spellings. */
export function isGuardPath(paths: readonly string[], roots: readonly string[], policy: Policy): boolean {
  const guarded = roots.map(lower)
  return paths.some(candidate => {
    const path = lower(candidate)
    return guarded.some(root => path === root || path.startsWith(`${root}/`))
      || policy.guardPatterns.some(pattern => new RegExp(pattern, 'i').test(candidate))
  })
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
