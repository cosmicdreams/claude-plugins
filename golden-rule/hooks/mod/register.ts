// The golden rule mod: main is never the operating surface. Every gate fails closed (its .catch refuses);
// the shell layer hands each command to hooks/sandbox/run.py, which runs it inside a write-denying
// sandbox. Plan: ~/Tools/CLAUDE-PLUGINS/plans/2026-10-06-golden-rule-mod.md.

import type { EngineInterface, Register } from 'claude-code'

import { type Io, type Policy, expandHome, isGuardPath, mainWorktreeOf, normalize, pathLiterals, placed } from './paths'
import { RULE, SECTION_ID, SHORT_RULE } from './rule'
import { trunkViolation, wrapArgv, wrapCommand } from './shell'

const NAME = 'golden-rule'
// What the wrapped command starts with, so the final check can tell a stripped wrapper.
const WRAPPED = '__gr=$(/usr/bin/mktemp -t golden-rule)'
// MCP tools whose names say they only read; any other MCP tool that names a main worktree is refused.
const READS = /(^|_)(get|read|list|search|find|query|view|show|fetch|describe|stat|status|diff|log)(_|$)/i

export type Refusal = { at: string; tool: string; what: string; why: string }

let policy: Policy | undefined
let home = ''
// Whether prompt.compose reached the system prompt in this load. On a Team seat the built-in guard skips
// it, so the short rule rides on each prompt and on each subagent's prompt instead.
let composed = false

function io($: EngineInterface): Io {
  return {
    realPath: path => $.fs.stat(path, { resolve: true }).then(stat => stat.realPath, () => undefined),
    exists: path => $.fs.exists(path).catch(() => false),
  }
}

async function setup($: EngineInterface): Promise<Policy> {
  if (!policy) {
    home = (await $.env.get('HOME')) ?? ''
    policy = JSON.parse(await $.fs.read(`${$.plugin.root}/hooks/policy.json`)) as Policy
  }
  return policy
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

/** Why writing to `path` is refused, or undefined when it is allowed. */
async function judgeWrite($: EngineInterface, path: string): Promise<string | undefined> {
  const rules = await setup($)
  const real = await placed(path, await $.session.cwd(), home, io($))
  const root = await mainWorktreeOf(real, io($))
  if (root) return `${real} is in the main worktree ${root}, the reference, which is never written to. ${worktreeHint(root)}`
  if (isGuardPath(real, rules, home, $.plugin.root)) return `${real} belongs to the golden rule's guard, which a session never changes.`
  return undefined
}

// ---- Settings that would switch the guard off -------------------------------------------------------

const SETTINGS = /\/\.claude\/settings(\.local)?\.json$/

/** Whether a settings file's JSON switches this plugin off. */
function disables(json: unknown, pluginId: string): boolean {
  if (typeof json !== 'object' || json === null) return false
  const settings = json as { enabledPlugins?: Record<string, unknown>; disableAllHooks?: unknown }
  return settings.disableAllHooks === true || settings.enabledPlugins?.[pluginId] === false
}

async function settingsFiles($: EngineInterface): Promise<string[]> {
  const cwd = await $.session.cwd()
  return [`${home}/.claude/settings.json`, `${home}/.claude/settings.local.json`, `${cwd}/.claude/settings.json`, `${cwd}/.claude/settings.local.json`]
}

async function readJson($: EngineInterface, path: string): Promise<{ text: string; json: unknown } | undefined> {
  const text = await $.fs.read(path).catch(() => undefined)
  if (text === undefined) return undefined
  try {
    return { text, json: JSON.parse(text) }
  } catch {
    return { text, json: undefined }
  }
}

/** Undoes a command's switching the guard off: only the two keys that do it, and says so. */
async function restoreSettings($: EngineInterface, before: Map<string, unknown>): Promise<string[]> {
  const rules = await setup($)
  const restored: string[] = []
  for (const path of await settingsFiles($)) {
    const now = await readJson($, path)
    if (!now || !disables(now.json, rules.pluginId) || disables(before.get(path), rules.pluginId)) continue
    const was = (before.get(path) ?? {}) as { enabledPlugins?: Record<string, unknown>; disableAllHooks?: unknown }
    const json = now.json as { enabledPlugins?: Record<string, unknown>; disableAllHooks?: unknown }
    if (json.enabledPlugins && json.enabledPlugins[rules.pluginId] === false) {
      if (was.enabledPlugins && rules.pluginId in was.enabledPlugins) json.enabledPlugins[rules.pluginId] = was.enabledPlugins[rules.pluginId]
      else delete json.enabledPlugins[rules.pluginId]
    }
    if (json.disableAllHooks === true && was.disableAllHooks !== true) delete json.disableAllHooks
    const indent = /\n( +)"/.exec(now.text)?.[1] ?? '  '
    await $.fs.write(path, `${JSON.stringify(json, null, indent)}\n`)
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

async function guarded($: EngineInterface): Promise<string[]> {
  const rules = await setup($)
  const roots: string[] = []
  for (const container of rules.containers) {
    const folder = expandHome(container, home)
    for (const entry of await $.fs.list(folder).catch(() => [])) {
      const root = `${folder}/${entry.name}/worktrees/main`
      if (await $.fs.exists(`${root}/.git`).catch(() => false)) roots.push(root)
    }
  }
  return roots
}

async function quarantine($: EngineInterface): Promise<Record<string, { at: string; path: string; command: string }>> {
  const rules = await setup($)
  const file = await readJson($, expandHome(rules.quarantineFile, home))
  return (file?.json ?? {}) as Record<string, { at: string; path: string; command: string }>
}

async function showStatus($: EngineInterface): Promise<void> {
  const held = Object.keys(await quarantine($))
  const count = (await guarded($)).length
  $.ui.status(held.length > 0
    ? `golden rule: ${held.length} main worktree quarantined, run /golden-rule`
    : `golden rule: ${count} main worktrees guarded${composed ? '' : ' (rule on each prompt)'}`)
}

async function report($: EngineInterface): Promise<string> {
  const roots = await guarded($)
  const held = await quarantine($)
  const refusals = (((await $.store.get('refusals').catch(() => undefined)) as Refusal[] | undefined) ?? []).slice(-10)
  return [
    `Golden rule: main is never the operating surface. ${roots.length} main worktrees guarded:`,
    `  ${roots.map(root => root.split('/').slice(-3, -2)[0]).join(', ')}`,
    Object.keys(held).length > 0 ? 'Quarantined (a change was observed; run /golden-rule clear once you have looked):' : 'Nothing quarantined.',
    ...Object.entries(held).map(([root, entry]) => `  ${root}: ${entry.path} at ${entry.at}, during: ${entry.command}`),
    refusals.length > 0 ? 'Recent refusals:' : 'No refusals yet.',
    ...refusals.map(entry => `  ${entry.at} ${entry.tool}: ${entry.why.split('.')[0]}`),
    `Rule as the model reads it: system prompt${composed ? '' : ' (skipped on this account; a short form rides on each prompt)'}.`,
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
    const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
    const why = await judgeWrite($, path)
    if (why) return refuse($, e.tool, path, why)
    const rules = await setup($)
    if (SETTINGS.test(normalize(path))) {
      const switchesOff = e.tool === 'Write'
        ? (() => { try { return disables(JSON.parse(e.content), rules.pluginId) } catch { return false } })()
        : e.tool === 'Edit' && /disableAllHooks|golden-rule/.test(e.new_string)
      if (switchesOff) return refuse($, e.tool, path, 'that change would switch the golden rule guard off, which a session never does.')
    }
    return next(e)
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
    const trunk = trunkViolation(e.command)
    if (trunk) return refuse($, e.tool, e.command, `this ${trunk}; changes reach main only through a pull request.`)
    const rules = await setup($)
    const before = new Map<string, unknown>()
    for (const path of await settingsFiles($)) before.set(path, (await readJson($, path))?.json)
    const result = await next({ ...e, command: wrapCommand($.plugin.root, e.command) })
    const restored = await restoreSettings($, before).catch(() => [] as string[])
    if (restored.length === 0) return result
    await refuse($, e.tool, e.command, `that command switched the golden rule guard off in ${restored.join(', ')}; the setting was put back.`)
    return { deny: `golden-rule: that command switched the guard off (${rules.pluginId}); the setting was put back. A session never disables the guard.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `golden-rule: the shell guard failed (${next.error.kind}), so this command was not run.` }))

  // The last word on what runs, beneath every plugin's rewrite (skipped on a Team seat by the built-in guard).
  on('classic.PreToolUse', async ($, e, next) => {
    if ((e.tool === 'Bash' || e.tool === 'Monitor') && typeof e.command === 'string' && !e.command.startsWith(WRAPPED)) {
      return { deny: 'golden-rule: this command lost its sandbox on the way to the shell, so it was not run.' }
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'golden-rule: the final command check failed, so this command was not run.' }))

  // ---- Layer 4: MCP tools that name a main worktree ----
  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) => {
    if (String(e.tool).startsWith(`mcp__${NAME}__`) || READS.test(String(e.tool))) return next(e)
    for (const path of strings(e).flatMap(pathLiterals)) {
      const why = await judgeWrite($, path)
      if (why) return refuse($, String(e.tool), path, why)
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'golden-rule: the MCP guard failed, so this call was not made.' }))

  // ---- Layer 5: other plugins' files and processes ----
  on('fs.write', async ($, e, next) => {
    if (next.origin.plugin === NAME) return next(e)
    const why = await judgeWrite($, e.path)
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
}
