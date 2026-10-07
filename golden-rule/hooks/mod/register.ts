// The golden rule mod: main is never the operating surface. Every gate fails closed (its .catch refuses);
// the shell layer hands each command to hooks/sandbox/run.py, which runs it inside a write-denying
// sandbox and refuses pushes to main from governed repositories.
// Plan: ~/Tools/CLAUDE-PLUGINS/plans/2026-10-06-golden-rule-mod.md.

import type { EngineInterface, Register } from 'claude-code'

import {
  type GitDirs, type Io, type Policy, expandHome, gitDirsOf, governedGitPath, isGuardPath, isIdentityPath, isSettingsFile,
  mainWorktreeOf, normalize, pathLiterals, placed, relativeMainTokens,
} from './paths'
import { RULE, SECTION_ID, SHORT_RULE } from './rule'
import { wrapArgv, wrapCommand } from './shell'

const NAME = 'golden-rule'

export type Refusal = { at: string; tool: string; what: string; why: string }
type Settings = { enabledPlugins?: Record<string, unknown>; disableAllHooks?: unknown }
type Registry = { plugins?: Record<string, unknown> }

let policy: Policy | undefined
let home = ''
// Whether prompt.compose reached the system prompt in this load. On a Team seat the built-in guard skips
// it, so the short rule rides on each prompt and on each subagent's prompt instead.
let composed = false
// The command each wrapped call must arrive with at the shell, by tool call id, for the final check.
const expected = new Map<string, string>()
// The guard's own paths as written and as resolved, and every known main worktree's git directories.
let guardRoots: string[] = []
let gitDirs: GitDirs[] = []

function io($: EngineInterface): Io {
  return {
    // Only "not there" reads as absent. A link that exists but leads nowhere (or nowhere the engine can
    // name) cannot be placed, so it throws, as does any other failure: the gate's .catch refuses.
    realPath: path => $.fs.stat(path, { resolve: true }).then(
      stat => {
        if (stat.realPath === undefined) throw new Error(`${path} cannot be resolved (a link that leads nowhere)`)
        return stat.realPath
      },
      (error: unknown) => {
        if (/ENOENT|not found|no such/i.test(String(error))) return undefined
        throw error
      },
    ),
    exists: path => $.fs.exists(path),
  }
}

async function setup($: EngineInterface): Promise<Policy> {
  if (!policy) {
    home = (await $.env.get('HOME')) ?? ''
    if (!home) throw new Error('HOME is not set')
    const rules = JSON.parse(await $.fs.read(`${$.plugin.root}/hooks/policy.json`)) as Policy
    const written = [$.plugin.root, ...rules.guardFiles.map(file => normalize(expandHome(file, home)))]
    const resolved = await Promise.all(written.map(path => io($).realPath(path)))
    guardRoots = [...new Set([...written, ...resolved.filter((path): path is string => path !== undefined)])]
    policy = rules
    gitDirs = await knownGitDirs($, await guarded($))
  }
  return policy
}

const readText = ($: EngineInterface) => (path: string): Promise<string | undefined> =>
  $.fs.stat(path).then(stat => (stat.kind === 'file' ? $.fs.read(path) : undefined), () => undefined)

async function knownGitDirs($: EngineInterface, roots: readonly string[]): Promise<GitDirs[]> {
  const out: GitDirs[] = []
  for (const root of roots) out.push(await gitDirsOf(root, readText($), io($)))
  return out
}

async function refuse($: EngineInterface, tool: string, what: string, why: string): Promise<{ deny: string }> {
  const log = ((await $.store.get('refusals').catch(() => undefined)) as Refusal[] | undefined) ?? []
  const at = new Date(await $.clock.now()).toISOString()
  await $.store.set('refusals', [...log, { at, tool, what: what.slice(0, 200), why }].slice(-50)).catch(() => undefined)
  $.ui.toast(`golden rule refused ${tool}: ${why.split('.')[0]}`)
  return { deny: `golden-rule: ${why}` }
}

const worktreeHint = (root: string): string =>
  `Make this change in a sibling worktree: git -C ${root} worktree add ../<topic> -b feature/<topic> --no-track origin/main`

/** Why writing `text` (when known) to `path` is refused, or undefined when it is allowed. */
async function judgeWrite($: EngineInterface, path: string, text?: string): Promise<string | undefined> {
  const rules = await setup($)
  const cwd = await $.session.cwd()
  const spelled = normalize(expandHome(path, home), cwd)
  if (isIdentityPath(spelled)) return `${path} names a file by its identity (/.vol), which the guard cannot place; use its real path.`
  const real = await placed(path, cwd, home, io($))
  if (isIdentityPath(real)) return `${path} lands on a file-identity path (${real}), which the guard cannot place; use its real path.`
  const root = await mainWorktreeOf(real, io($))
  if (root) return `${real} is in the main worktree ${root}, the reference, which is never written to. ${worktreeHint(root)}`
  const owner = governedGitPath(real, gitDirs)
  if (owner) return `${real} is git metadata of the main worktree ${owner.root}; only git itself writes there.`
  if (isGuardPath([spelled, real], guardRoots, rules)) return `${real} belongs to the golden rule's guard, which a session never changes.`
  if (text !== undefined && switchesOff(text, rules.pluginId) && (isSettingsFile(spelled) || isSettingsFile(real) || await isWatchedSettings($, real))) {
    return `that change to ${real} would switch the golden rule guard off, which a session never does.`
  }
  return undefined
}

// ---- Settings and the plugin registry ---------------------------------------------------------------

/** Whether a real path is where one of the watched settings files resolves to now (a settings file may be a
 * link to a file named anything, and may be retargeted during the session). */
async function isWatchedSettings($: EngineInterface, real: string): Promise<boolean> {
  const { settings } = await watchedFiles($)
  for (const path of settings) {
    const resolved = await io($).realPath(path).catch(() => undefined)
    if (resolved !== undefined && resolved.toLowerCase() === real.toLowerCase()) return true
  }
  return false
}

function parse(text: string | undefined): unknown {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function disables(json: unknown, pluginId: string): boolean {
  if (typeof json !== 'object' || json === null) return false
  const settings = json as Settings
  return settings.disableAllHooks === true || settings.enabledPlugins?.[pluginId] === false
}

/** Whether a settings file's proposed text switches the plugin off. Text that is not JSON is judged by
 * its words, since Claude Code may still read a settings file a later write repairs. */
function switchesOff(text: string, pluginId: string): boolean {
  const json = parse(text)
  if (json !== undefined) return disables(json, pluginId)
  const id = pluginId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return /"disableAllHooks"\s*:\s*true/.test(text) || new RegExp(`"${id}"\\s*:\\s*false`).test(text)
}

/** The text an Edit would leave in a file, from its current text. */
function edited(current: string, oldString: string, newString: string, all: boolean): string {
  return all ? current.split(oldString).join(newString) : current.replace(oldString, () => newString)
}

/** Every Claude configuration folder this session's settings and registry live in. */
async function configDirs($: EngineInterface): Promise<string[]> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  return [...new Set([configured, `${home}/.claude`, `${home}/.claude-work`].filter((dir): dir is string => Boolean(dir)))]
}

async function watchedFiles($: EngineInterface): Promise<{ settings: string[]; registries: string[] }> {
  const dirs = await configDirs($)
  const cwd = await $.session.cwd()
  return {
    settings: [...dirs.flatMap(dir => [`${dir}/settings.json`, `${dir}/settings.local.json`]), `${cwd}/.claude/settings.json`, `${cwd}/.claude/settings.local.json`],
    registries: dirs.map(dir => `${dir}/plugins/installed_plugins.json`),
  }
}

async function snapshot($: EngineInterface): Promise<Map<string, string | undefined>> {
  const { settings, registries } = await watchedFiles($)
  const out = new Map<string, string | undefined>()
  for (const path of [...settings, ...registries]) out.set(path, await $.fs.read(path).catch(() => undefined))
  return out
}

/** Undoes a command's switching the guard off or uninstalling it: only the keys that do it. */
async function restore($: EngineInterface, before: Map<string, string | undefined>): Promise<string[]> {
  const rules = await setup($)
  const { settings, registries } = await watchedFiles($)
  const restored: string[] = []
  const indentOf = (text: string): string => /\n( +)"/.exec(text)?.[1] ?? '  '
  for (const path of settings) {
    const now = await $.fs.read(path).catch(() => undefined)
    const was = parse(before.get(path)) as Settings | undefined
    const json = parse(now) as Settings | undefined
    if (now === undefined || !json || !disables(json, rules.pluginId) || disables(was, rules.pluginId)) continue
    if (json.enabledPlugins?.[rules.pluginId] === false) {
      if (was?.enabledPlugins && rules.pluginId in was.enabledPlugins) json.enabledPlugins[rules.pluginId] = was.enabledPlugins[rules.pluginId]
      else delete json.enabledPlugins[rules.pluginId]
    }
    if (json.disableAllHooks === true && was?.disableAllHooks !== true) delete json.disableAllHooks
    await $.fs.write(path, `${JSON.stringify(json, null, indentOf(now))}\n`)
    restored.push(path)
  }
  for (const path of registries) {
    const was = parse(before.get(path)) as Registry | undefined
    const now = await $.fs.read(path).catch(() => undefined)
    const json = (parse(now) ?? {}) as Registry
    const entry = was?.plugins?.[rules.pluginId]
    if (entry === undefined || json.plugins?.[rules.pluginId] !== undefined) continue
    json.plugins = { ...json.plugins, [rules.pluginId]: entry }
    await $.fs.write(path, `${JSON.stringify(json, null, indentOf(now ?? before.get(path) ?? ''))}\n`)
    restored.push(path)
  }
  return restored
}

// ---- Strings inside a tool's arguments ---------------------------------------------------------------

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings)
  return []
}

// ---- Status and the /golden-rule command -------------------------------------------------------------

/** Every main worktree in the person's project folders: each container's children with worktrees/main. */
async function guarded($: EngineInterface): Promise<string[]> {
  const rules = await setup($)
  const containers: string[] = []
  for (const container of rules.containers) {
    const path = expandHome(container, home)
    if (!path.endsWith('/*')) containers.push(path)
    else for (const entry of await $.fs.list(path.slice(0, -2)).catch(() => [])) if (entry.kind === 'dir') containers.push(`${path.slice(0, -2)}/${entry.name}`)
  }
  const roots: string[] = []
  for (const folder of containers) {
    for (const entry of await $.fs.list(folder).catch(() => [])) {
      const root = `${folder}/${entry.name}/worktrees/main`
      if (entry.kind === 'dir' && await $.fs.exists(`${root}/.git`).catch(() => false)) roots.push(root)
    }
  }
  return roots
}

type Quarantine = Record<string, { at: string; path: string; command: string }>

async function quarantine($: EngineInterface): Promise<Quarantine | 'unreadable'> {
  const rules = await setup($)
  const text = await $.fs.read(expandHome(rules.quarantineFile, home)).catch(() => undefined)
  if (text === undefined) return {}
  const json = parse(text)
  return typeof json === 'object' && json !== null ? json as Quarantine : 'unreadable'
}

async function showStatus($: EngineInterface): Promise<void> {
  const held = await quarantine($)
  const count = (await guarded($)).length
  if (held === 'unreadable') $.ui.status('golden rule: quarantine record unreadable, commands in main worktrees refused; run /golden-rule')
  else if (Object.keys(held).length > 0) $.ui.status(`golden rule: ${Object.keys(held).length} main worktree quarantined, run /golden-rule`)
  else $.ui.status(`golden rule: ${count} main worktrees guarded${composed ? '' : ' (rule on each prompt)'}`)
}

async function report($: EngineInterface): Promise<string> {
  const roots = await guarded($)
  const held = await quarantine($)
  const refusals = (((await $.store.get('refusals').catch(() => undefined)) as Refusal[] | undefined) ?? []).slice(-10)
  const heldLines = held === 'unreadable'
    ? ['The quarantine record is unreadable: commands touching main worktrees are refused until /golden-rule clear.']
    : Object.keys(held).length > 0
      ? ['Quarantined (a change was observed; run /golden-rule clear once you have looked):',
        ...Object.entries(held).map(([root, entry]) => `  ${root}: ${entry.path} at ${entry.at}, during: ${entry.command}`)]
      : ['Nothing quarantined.']
  return [
    `Golden rule: main is never the operating surface. ${roots.length} main worktrees guarded:`,
    `  ${roots.map(root => root.split('/').slice(-3, -2)[0]).join(', ')}`,
    ...heldLines,
    refusals.length > 0 ? 'Recent refusals:' : 'No refusals yet.',
    ...refusals.map(entry => `  ${entry.at} ${entry.tool}: ${entry.why.split('.')[0]}`),
    `Rule as the model reads it: ${composed ? 'system prompt' : 'a short form on each prompt (the system prompt is not open to mods on this account)'}.`,
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await setup($)
    await showStatus($).catch(() => undefined)
    await $.command.register({ name: 'golden-rule', description: 'Golden rule: what is guarded, recent refusals, quarantines', argumentHint: '[clear]' }).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'golden-rule' }, async ($, e) => {
    if (e.args.trim() !== 'clear') return { text: await report($) }
    if (e.origin.kind !== 'composer') return { text: 'golden-rule: only Chris, typing /golden-rule clear himself, can lift a quarantine.' }
    const rules = await setup($)
    await $.fs.write(expandHome(rules.quarantineFile, home), '{}\n')
    await showStatus($)
    return { text: 'golden-rule: quarantine cleared.' }
  })

  // ---- Layer 1: the rule is always in context ----
  on('prompt.compose', async ($, e, next) => {
    const composedPrompt = await next(e)
    composed = true
    if (composedPrompt.sections.some(section => section.id === SECTION_ID)) return composedPrompt
    return { sections: [...composedPrompt.sections, { id: SECTION_ID, text: RULE, scope: 'session' as const }] }
  })

  on('prompt.submit', async ($, e, next) =>
    composed ? next(e) : next({ ...e, context: [...(e.context ?? []), SHORT_RULE] }),
  ).catch(($, e, next) => next(e))

  // ---- Layer 2: structured tools ----
  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    let path: string
    let text: string | undefined
    if (e.tool === 'NotebookEdit') path = e.notebook_path
    else if (e.tool === 'Write') [path, text] = [e.file_path, e.content]
    else {
      path = e.file_path
      const current = await $.fs.read(path).catch(() => undefined)
      text = current === undefined ? undefined : edited(current, e.old_string, e.new_string, e.replace_all === true)
    }
    const why = await judgeWrite($, path, text)
    return why ? refuse($, e.tool, path, why) : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'golden-rule: the edit guard failed, so this edit was not made.' }))

  on('tool.call', { tool: 'EnterWorktree' }, async ($, e, next) => {
    if (e.path) {
      const root = await mainWorktreeOf(await placed(e.path, await $.session.cwd(), home, io($)), io($))
      if (root) return refuse($, e.tool, e.path, `${root} is the main worktree, the reference; a session never works inside it. ${worktreeHint(root)}`)
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'golden-rule: the worktree guard failed, so the session stayed where it is.' }))

  // A subagent's prompt carries the short rule where the system prompt cannot (a Team seat).
  on('tool.call', { tool: 'Agent' }, async ($, e, next) =>
    composed || typeof e.prompt !== 'string' ? next(e) : next({ ...e, prompt: `${SHORT_RULE}\n\n${e.prompt}` }),
  ).catch(($, e, next) => next(e))

  // ---- Layer 3: every command runs sandboxed ----
  on('tool.call', { tool: ['Bash', 'Monitor'] }, async ($, e, next) => {
    if (typeof e.command !== 'string') return next(e)
    const rules = await setup($)
    const before = await snapshot($)
    const wrapped = wrapCommand($.plugin.root, e.command)
    if (e.tool_use_id) expected.set(e.tool_use_id, wrapped)
    const result = await next({ ...e, command: wrapped })
    if (e.tool_use_id) expected.delete(e.tool_use_id)
    let restored: string[]
    try {
      restored = await restore($, before)
    } catch (error) {
      await refuse($, e.tool, e.command, `the guard could not check whether that command switched it off (${String(error).slice(0, 120)}).`)
      return { deny: 'golden-rule: the command ran, but the guard could not confirm it is still switched on; tell Chris.' }
    }
    if (restored.length === 0) return result
    await refuse($, e.tool, e.command, `that command switched the golden rule guard off in ${restored.join(', ')}; the setting was put back.`)
    return { deny: `golden-rule: that command switched the guard off (${rules.pluginId}); the setting was put back. A session never disables the guard.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `golden-rule: the shell guard failed (${next.error.kind}), so this command was not run.` }))

  // The last word on what runs, beneath every plugin's rewrite: exactly the wrapped command, or nothing
  // (skipped on a Team seat by the built-in guard).
  on('classic.PreToolUse', async ($, e, next) => {
    if ((e.tool === 'Bash' || e.tool === 'Monitor') && typeof e.command === 'string') {
      const want = e.tool_use_id ? expected.get(e.tool_use_id) : undefined
      if (want === undefined ? !e.command.startsWith('__gr=$(/usr/bin/mktemp -t golden-rule)') : e.command !== want) {
        return { deny: 'golden-rule: this command was changed on its way to the shell after the guard wrapped it, so it was not run.' }
      }
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'golden-rule: the final command check failed, so this command was not run.' }))

  // ---- Layer 4: MCP tools that name a main worktree ----
  // Every string argument is judged as a path where it could be one: whole (a path with spaces), each path
  // token inside it, and a bare relative name against the session's folder. A destination split across
  // arguments or computed by the server cannot be seen; that residual is documented.
  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) => {
    const tool = String(e.tool)
    const rules = await setup($)
    if (rules.mcpReadTools.some(pattern => new RegExp(pattern).test(tool))) return next(e)
    // A session working inside a main worktree: any relative destination an MCP server takes lands there.
    const inside = await mainWorktreeOf(await placed('.', await $.session.cwd(), home, io($)), io($))
    if (inside) return refuse($, tool, inside, `this session's folder is inside the main worktree ${inside}, so this MCP call could write there. ${worktreeHint(inside)}`)
    const texts = strings(Object.fromEntries(Object.entries(e).filter(([key]) => key !== 'tool' && key !== 'tool_use_id' && key !== 'agentId')))
    // Every single-line string is placed as a path, links followed, and judged by where it lands: a
    // destination reached through a link into main is caught, and ordinary text lands nowhere protected.
    const whole = texts.filter(text => text.length > 0 && text.length < 4096 && !text.includes('\n'))
    for (const path of [...new Set([...whole, ...texts.flatMap(pathLiterals), ...texts.flatMap(relativeMainTokens)])]) {
      const why = await judgeWrite($, path)
      if (why) return refuse($, tool, path, `${why} (MCP tools are refused for main worktrees unless listed as read-only in policy.json)`)
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'golden-rule: the MCP guard failed, so this call was not made.' }))

  // ---- Layer 5: other plugins' files and processes ----
  on('fs.write', async ($, e, next) => {
    if (next.origin.plugin === NAME) return next(e)
    const why = await judgeWrite($, e.path, e.text)
    return why ? { deny: `golden-rule (refusing ${next.origin.plugin}): ${why}` } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'golden-rule: the file guard failed, so this write was not made.' }))

  on('process.run', async ($, e, next) =>
    next.origin.plugin === NAME ? next(e) : next({ ...e, argv: wrapArgv($.plugin.root, e.argv) }),
  ).catch(($, e, next) => (next.called ? next(e) : { deny: 'golden-rule: the process guard failed, so this program was not started.' }))

  on('process.spawn', async function* ($, e, next) {
    return yield* next(next.origin.plugin === NAME ? e : { ...e, argv: wrapArgv($.plugin.root, e.argv) })
  }).catch(async function* ($, e, next) {
    if (next.called) return yield* next(e)
    return { deny: 'golden-rule: the process guard failed, so this program was not started.' }
  })

  // ---- Settings rows that would switch hooks or plugins off ----
  // The person's own changes in the menu pass; a plugin's are refused for hook and plugin rows.
  on('config.set', async ($, e, next) =>
    e.origin.kind !== 'composer' && /hook|plugin|golden/i.test(e.key)
      ? { deny: 'golden-rule: a plugin never changes hook or plugin settings; Chris can change this in /config himself.' }
      : next(e),
  ).catch(($, e, next) => (next.called ? next(e) : { deny: 'golden-rule: the settings guard failed, so this setting was not changed.' }))
}
