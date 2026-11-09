#!/usr/bin/env node
// Run one version of interrogate-panel.js outside the Workflow tool.
//
//   panel_headless.cjs <panel.js> <submission.json> <out.json>
//
// Each agent() call becomes a lean headless Claude Code session: no settings,
// skills or MCP servers, a fresh empty folder, read-only tools plus WebFetch
// for checking locators (no shell), a minimal environment, and the call's
// schema as --json-schema. This is close to the Workflow runtime's
// context-isolated subagents, not identical: subagents there also see the
// user's instruction files.
// The 2026-11-09 run used an earlier version with Bash and skipped permissions.
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const [panelPath, submissionPath, outPath] = process.argv.slice(2)
const source = fs.readFileSync(panelPath, 'utf8')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const panel = new AsyncFunction('args', 'parallel', 'agent', 'budget', 'log',
  source.replace('export const meta =', 'const meta ='))

const calls = []
const logs = []
// Only what the CLI needs to find its login and tools.
const env = Object.fromEntries(['HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'TMPDIR', 'SHELL']
  .filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]))

function agent (prompt, options = {}) {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-'))
  const argv = ['-p', '--model', options.model || 'sonnet', '--no-session-persistence',
    '--output-format', 'json', '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config',
    '--tools=Read,Grep,Glob,WebFetch', '--allowedTools=Read,Grep,Glob,WebFetch']
  if (options.schema) argv.push('--json-schema', JSON.stringify(options.schema))
  argv.push('--', prompt)
  const started = Date.now()
  return new Promise((resolve) => {
    execFile('claude', argv, { cwd: box, env, maxBuffer: 64 << 20, timeout: 900000 }, (error, stdout) => {
      let parsed = null
      let cost = null
      try {
        const d = JSON.parse(stdout)
        cost = d.total_cost_usd
        parsed = options.schema ? (d.structured_output ?? null) : d.result
      } catch (_) { /* recorded below as a null response */ }
      calls.push({ label: options.label, model: options.model, seconds: Math.round((Date.now() - started) / 1000),
        cost, error: error ? String(error.message).slice(0, 200) : null, output: parsed })
      fs.rmSync(box, { recursive: true, force: true })
      resolve(parsed)
    })
  })
}

const parallel = (tasks) => Promise.all(tasks.map((t) => t()))
const budget = { remaining: () => 1e9 }
const args = JSON.parse(fs.readFileSync(submissionPath, 'utf8'))

panel(args, parallel, agent, budget, (m) => logs.push(m))
  .then((result) => ({ ok: true, result }))
  .catch((e) => ({ ok: false, error: String(e.message || e) }))
  .then((outcome) => {
    const cost = calls.reduce((s, c) => s + (c.cost || 0), 0)
    fs.writeFileSync(outPath, JSON.stringify({ ...outcome, logs, calls, agentCalls: calls.length, cost }, null, 1) + '\n')
    console.log(path.basename(outPath), outcome.ok ? outcome.result.verdict : 'ERROR ' + outcome.error.slice(0, 120),
      'calls', calls.length, 'cost', cost.toFixed(3))
  })
