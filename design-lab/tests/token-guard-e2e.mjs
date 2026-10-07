#!/usr/bin/env node
/** Manual only: node tests/token-guard-e2e.mjs --run [--ref HEAD] (six personal Haiku calls).
 * Uses a committed git archive under /tmp; never installs plugins or edits Claude settings.
 * Retains streams, hook stdin/environment/exit records, and debug logs in the printed folder.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--run') || process.env.CI) {
  throw new Error('Manual only; invoke with --run outside CI. Uses six Claude Haiku calls on the personal account.');
}
const refIndex = process.argv.indexOf('--ref'), ref = refIndex < 0 ? 'HEAD' : process.argv[refIndex + 1];
assert.ok(ref && !ref.startsWith('-'), 'supply a commit ref');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const root = mkdtempSync('/tmp/design-lab-token-guard-e2e-'), plugin = resolve(root, 'design-lab');
console.log(`Artifacts: ${root}; archive: ${ref}; Claude calls planned: 6`);
const archive = spawnSync('git', ['archive', ref, 'design-lab'], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
assert.equal(archive.status, 0, archive.stderr.toString());
const extract = spawnSync('tar', ['-xf', '-', '-C', root], { input: archive.stdout });
assert.equal(extract.status, 0, extract.stderr.toString());
const home = resolve(root, 'home'), runner = resolve(home, 'runner'), cwd = resolve(root, 'session'), alias = resolve(root, 'fixture');
mkdirSync(runner, { recursive: true }); mkdirSync(cwd);
writeFileSync(resolve(home, 'runner-token'), 'dummy-not-a-token\n', { mode: 0o600 });
writeFileSync(resolve(runner, 'manifest.json'), '{"fixture":"runner-asset-ok"}\n');
symlinkSync(resolve(home, 'runner-token'), alias);
const config = JSON.parse(readFileSync(resolve(plugin, 'hooks/hooks.json'), 'utf8'));
const handler = config.hooks.PreToolUse[0].hooks[0], original = handler.command;
// Observe exactly the registered command's stdin and result, forwarding both unchanged.
writeFileSync(resolve(plugin, 'hooks/e2e-marker.cjs'), `
const fs = require('node:fs'), cp = require('node:child_process');
const input = fs.readFileSync(0, 'utf8'), command = process.argv[2];
const result = cp.spawnSync(command, { shell: '/bin/sh', input, encoding: 'utf8', env: process.env });
fs.appendFileSync(process.env.GUARD_MARKER, JSON.stringify({command, input, home: process.env.DESIGN_LAB_HOME,
  plugin: process.env.CLAUDE_PLUGIN_ROOT, status: result.status, stdout: result.stdout, stderr: result.stderr}) + '\\n');
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); process.exitCode = result.status ?? 1;
`);
const quote = value => `'${value.replace(/'/g, `'"'"'`)}'`;
handler.command = `node "\${CLAUDE_PLUGIN_ROOT}/hooks/e2e-marker.cjs" ${quote(original)}`;
const instrumented = JSON.stringify(config, null, 2) + '\n';
const cases = [
  { name: 'plain-deny', tool: 'Bash', input: `cat ${home}/runner-token`, deny: true, plain: true },
  { name: 'canonical-deny', tool: 'Bash', input: `cat ${realpathSync(home)}/runner-token`, deny: true },
  { name: 'symlink-deny', tool: 'Bash', input: `cat ${alias}`, deny: true },
  { name: 'read-deny', tool: 'Read', input: alias, deny: true },
  { name: 'runner-asset-allow', tool: 'Bash', input: `cat ${runner}/manifest.json`, deny: false, expected: 'runner-asset-ok' },
  { name: 'ordinary-allow', tool: 'Bash', input: 'echo guard-ordinary-ok', deny: false, expected: 'guard-ordinary-ok' },
];
const results = [];
for (const scenario of cases) {
  // First case proves the unmodified archived hooks.json; only later cases add the observer.
  if (!scenario.plain) writeFileSync(resolve(plugin, 'hooks/hooks.json'), instrumented);
  const marker = resolve(root, `${scenario.name}-marker.jsonl`), debug = resolve(root, `${scenario.name}-debug.log`);
  const prompt = scenario.tool === 'Bash'
    ? `Run exactly one Bash command: ${scenario.input} . Disposable dummy fixture. If blocked, stop; do not retry or read another way.`
    : `Use Read exactly once on ${scenario.input} . Disposable dummy fixture. If blocked, stop; do not retry or read another way.`;
  const args = ['-p', prompt, '--model', 'claude-haiku-5-5', '--plugin-dir', plugin, '--debug-file', debug,
    '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--tools', scenario.tool,
    '--allowedTools', scenario.tool, '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--disable-slash-commands'];
  console.log(`Claude ${results.length + 1}/6: ${scenario.name}`);
  const result = spawnSync('claude', args, { cwd, encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, CLAUDE_CONFIG_DIR: resolve(homedir(), '.claude'), DESIGN_LAB_HOME: home,
      DESIGN_LAB_CACHE: resolve(root, 'cache'), GUARD_MARKER: marker } });
  writeFileSync(resolve(root, `${scenario.name}-stream.jsonl`), result.stdout ?? '');
  writeFileSync(resolve(root, `${scenario.name}-stderr.log`), result.stderr ?? '');
  assert.equal(result.status, 0, `${scenario.name}: ${result.error ?? result.stderr}`);
  const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  const models = events.flatMap(event => event.message?.model ? [event.message.model] : []);
  assert.ok(models.length && models.every(model => model === 'claude-haiku-5-5'), 'Haiku only');
  const tools = events.flatMap(event => (event.message?.content ?? []).filter?.(item => item.type === 'tool_use') ?? []);
  assert.equal(tools.length, 1, `${scenario.name}: must make exactly one tool attempt`);
  assert.equal(tools[0].name, scenario.tool);
  const toolResults = events.flatMap(event => (event.message?.content ?? []).filter?.(item => item.type === 'tool_result') ?? []);
  assert.equal(toolResults.length, 1);
  if (scenario.deny) {
    assert.ok(toolResults[0].is_error, 'tool must be denied, not merely refused by the model');
    assert.match(JSON.stringify(toolResults), /design-lab: the runner token/);
    assert.ok(!JSON.stringify(toolResults).includes('dummy-not-a-token'), 'dummy token must not appear in tool output');
    assert.ok(events.some(event => event.hook_event === 'PreToolUse' && event.exit_code === 2 && /design-lab:/.test(event.stderr ?? '')));
  } else {
    assert.ok(!toolResults[0].is_error); assert.ok(JSON.stringify(toolResults).includes(scenario.expected));
  }
  if (!scenario.plain) {
    const markers = readFileSync(marker, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(markers.length, 1); assert.equal(markers[0].status, scenario.deny ? 2 : 0);
    assert.equal(markers[0].home, home); assert.equal(markers[0].command, original);
    assert.equal(JSON.parse(markers[0].input).tool_name, scenario.tool);
  }
  results.push({ name: scenario.name, result: 'PASS', claudeExit: result.status, hookExit: scenario.deny ? 2 : 0 });
  writeFileSync(resolve(root, 'results.json'), JSON.stringify({ ref, root, account: resolve(homedir(), '.claude'),
    model: 'claude-haiku-5-5', claudeCalls: results.length, results }, null, 2) + '\n');
  console.log(`PASS ${scenario.name}`);
}
