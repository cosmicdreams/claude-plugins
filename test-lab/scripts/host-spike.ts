#!/usr/bin/env node
// Live host spike (plan §14 phase 0): the mod loaded by the installed Claude Code with the documented
// `--plugin-dir` transient load, in a headless stream-json session, on the generic fixture (a disposable
// app + QA suite and a local HTTP server; no client site, no TestRail). It checks that the host loads the
// plugin and registers both tools; that the model's `verdict` call reads a Ready run the same runner made;
// what the model's `run` call does inside the host (each outcome recorded as found, never assumed); and
// that an edit to the staged mod takes effect after `/reload-plugins`.
//
//   node scripts/host-spike.ts [--model haiku] [--keep]
//
// Everything lives in temporary folders: the plugin is staged (scripts/stage-plugin.ts), so the reload
// edit never touches this checkout, and TEST_LAB_DATA points the runner and the mod at a temporary data
// folder. Nothing is installed and no account setting changes. The log keeps chosen fields only (tool
// names, the calls, their results, the host's reload answer), never the whole init event or environment.
// A headless session draws no surface, so the pane is checked separately (scripts/host-pane-spike.ts).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clip, prepareSpike, spikeLog } from './spike-fixture.ts';

const args = process.argv.slice(2);
const model = args.includes('--model') ? args[args.indexOf('--model') + 1]! : 'haiku';
const keep = args.includes('--keep');
const { path: log, note, check, state } = spikeLog('host-spike');
const started = Date.now();
const { f, staged, data, env, readyDir, directExit, cleanup } = await prepareSpike();

try {
  check('the staged runner made a Ready run outside the host', directExit === 0 && readyDir !== null, { exit: directExit, runDir: readyDir });
  const argv = ['-p', '--plugin-dir', staged, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', model, '--permission-mode', 'default', '--allowedTools', 'mcp__test-lab__run,mcp__test-lab__verdict'];
  note({ command: ['claude', ...argv], cwd: f.suite, model, testLabData: data, stagedPlugin: staged, claudeVersion: null });
  const claude = spawn('claude', argv, { cwd: f.suite, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const events: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  claude.stdout.on('data', (b) => {
    buffer += String(b);
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (line.trim() === '') continue;
      try {
        events.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        note({ unparsed: clip(line, 300) });
      }
      for (const w of waiters.splice(0)) w();
    }
  });
  let stderr = '';
  claude.stderr.on('data', (b) => (stderr += String(b)));
  const exited = new Promise<number | null>((done) => claude.on('close', done));
  const send = (text: string) => claude.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`);
  const nextResult = async (from: number, ms: number) => {
    const end = Date.now() + ms;
    for (;;) {
      const found = events.slice(from).find((e) => e['type'] === 'result');
      if (found) return found;
      if (Date.now() > end) throw new Error(`no result within ${ms} ms; stderr: ${clip(stderr, 500)}`);
      await new Promise<void>((done) => { waiters.push(done); setTimeout(done, 1000); });
    }
  };
  const toolCalls = (from: number) => {
    const uses: { id: string; name: string; input: unknown }[] = [];
    const results = new Map<string, string>();
    for (const e of events.slice(from)) {
      const content = (e['message'] as { content?: unknown } | undefined)?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as Record<string, unknown>[]) {
        if (block['type'] === 'tool_use') uses.push({ id: String(block['id']), name: String(block['name']), input: block['input'] });
        if (block['type'] === 'tool_result') results.set(String(block['tool_use_id']), Array.isArray(block['content']) ? (block['content'] as { text?: string }[]).map((c) => c.text ?? '').join('') : String(block['content']));
      }
    }
    return uses.map((u) => ({ ...u, result: results.get(u.id) ?? null }));
  };

  const runArgs = { operation: 'run', appRoot: f.app, suiteRoot: f.suite, environment: 'local', noWork: true, adapter: join(f.suite, 'adapter.ts'), timeoutMs: 300_000 };
  send(`Call the tool mcp__test-lab__verdict exactly once with {"runDir": ${JSON.stringify(readyDir)}}. Do not call any other tool. Then reply with the tool result's first line, verbatim.`);
  // The init event names the session's tools; keep only test-lab's and the plugin list's test-lab entry.
  const first = await nextResult(0, 300_000);
  const init = events.find((e) => e['type'] === 'system' && e['subtype'] === 'init') ?? {};
  const tools = ((init['tools'] as string[] | undefined) ?? []).filter((t) => t.includes('test-lab'));
  const plugins = ((init['plugins'] as { name?: string; path?: string }[] | undefined) ?? []).filter((p) => p.name === 'test-lab');
  note({ init: { claudeVersion: init['claude_code_version'] ?? null, model: init['model'] ?? null, tools, plugins, pluginErrors: init['plugin_errors'] ?? null } });
  check('the host loads the plugin from --plugin-dir and lists both registered tools', plugins.length === 1 && tools.includes('mcp__test-lab__run') && tools.includes('mcp__test-lab__verdict'), { tools, plugins });
  const shownCall = toolCalls(0).find((c) => c.name === 'mcp__test-lab__verdict');
  note({ turn: 1, calls: toolCalls(0).map((c) => ({ name: c.name, input: c.input, result: clip(c.result) })), result: clip(first['result']) });
  check('the verdict tool, called by the model through the host, returns the core\'s Ready summary', /^test-lab · Generic fixture · local: READY \(rule \d+\)/.test(shownCall?.result ?? ''), clip(shownCall?.result ?? '', 300));

  const second = events.length;
  send(`Call the tool mcp__test-lab__run exactly once with exactly these arguments: ${JSON.stringify(runArgs)}. Do not call any other tool. Then reply with the tool result's first two lines, verbatim.`);
  const ran = await nextResult(second, 420_000);
  const run = toolCalls(second).find((c) => c.name === 'mcp__test-lab__run');
  note({ turn: 2, calls: toolCalls(second).map((c) => ({ name: c.name, input: c.input, result: clip(c.result) })), result: clip(ran['result']), durationMs: ran['duration_ms'] ?? null });
  check('the model called run through the host with the explicit arguments', run !== undefined && JSON.stringify(run.input) === JSON.stringify(runArgs), run?.input ?? null);
  const blocked = /sandbox_apply: Operation not permitted/.test(run?.result ?? '');
  if (blocked) note({ environment: 'the host runs $.process.run under sandbox-exec; this spike is itself inside a macOS sandbox, which refuses a nested sandbox_apply, so the in-host run could not start here' });
  check(blocked ? 'run inside the host: BLOCKED by the enclosing sandbox (not a pass)' : 'run returned the core\'s Ready verdict as a finished answer', !blocked && /^test-lab fast run finished \(exit 0\)\.\ntest-lab · Generic fixture · local: READY/.test(run?.result ?? ''), clip(run?.result ?? '', 400));

  // Rebuild: edit the staged mod, ask the host to reload, and read the run back through the new code.
  const model_ts = join(staged, 'hooks/mod/model.ts');
  writeFileSync(model_ts, readFileSync(model_ts, 'utf8').replace('`test-lab · ${p.project}', '`test-lab (rebuilt) · ${p.project}'));
  const mark = events.length;
  send('/reload-plugins');
  const reload = await nextResult(mark, 120_000);
  note({ turn: 3, reload: clip(reload['result'], 800), isError: reload['is_error'] ?? null });
  check('the host answered /reload-plugins', reload['is_error'] !== true, clip(reload['result'], 200));
  const fourth = events.length;
  send(`Call the tool mcp__test-lab__verdict exactly once with {"runDir": ${JSON.stringify(readyDir)}}. Do not call any other tool. Then reply with the tool result's first line, verbatim.`);
  const after = await nextResult(fourth, 180_000);
  const verdictCall = toolCalls(fourth).find((c) => c.name === 'mcp__test-lab__verdict');
  note({ turn: 4, calls: toolCalls(fourth).map((c) => ({ name: c.name, input: c.input, result: clip(c.result) })), result: clip(after['result']) });
  check('after the edit and reload, the verdict tool runs the rebuilt module', /^test-lab \(rebuilt\) · Generic fixture · local: READY/.test(verdictCall?.result ?? ''), clip(verdictCall?.result ?? '', 300));
  claude.stdin.end();
  const code = await exited;
  check('the session ended cleanly', code === 0, { code, stderr: clip(stderr, 300) });
  const last = events.filter((e) => e['type'] === 'result').map((e) => e['total_cost_usd']).filter((c) => typeof c === 'number').at(-1) ?? null;
  note({ summary: { failed: state.failed, seconds: Math.round((Date.now() - started) / 1000), totalCostUsd: last } });
  console.log(`log: ${log}\nruntime: ${Math.round((Date.now() - started) / 1000)}s, cost: ${String(last)}`);
} catch (error) {
  state.failed = true;
  note({ error: clip(error instanceof Error ? error.message : error, 800) });
  console.log(`FAIL ${error instanceof Error ? error.message : String(error)}\nlog: ${log}`);
} finally {
  await cleanup(keep);
}
process.exitCode = state.failed ? 1 : 0;
