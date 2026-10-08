import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { pluginRoot } from '../../src/runtime.ts';

void test('registered hook command enforces documented PreToolUse input in a plain copy', () => {
  const root = mkdtempSync('/tmp/design-lab-hook-command-'),
    copy = resolve(root, 'design-lab');
  try {
    for (const name of ['hooks/hooks.json', 'hooks/guard_runner_token.ts', 'src/entrypoint.ts', 'package.json']) {
      const dest = resolve(copy, name);
      mkdirSync(resolve(dest, '..'), { recursive: true });
      cpSync(resolve(pluginRoot, name), dest);
    }
    const home = resolve(root, 'home with spaces'),
      runner = resolve(home, 'runner'),
      cwd = resolve(root, 'session');
    mkdirSync(runner, { recursive: true });
    mkdirSync(cwd);
    writeFileSync(resolve(home, 'runner-token'), 'dummy-not-a-token\n');
    writeFileSync(resolve(runner, 'manifest.json'), '{}');
    symlinkSync(home, resolve(root, 'alias-home'));
    symlinkSync(resolve(home, 'runner-token'), resolve(root, 'innocent'));
    symlinkSync(resolve(home, 'runner-token'), resolve(runner, 'asset.json'));
    symlinkSync(home, resolve(runner, 'back-home'));
    symlinkSync(resolve(home, 'runner-token'), resolve(cwd, 'fixture'));
    symlinkSync(copy, resolve(root, 'plugin-link'));
    const group = JSON.parse(readFileSync(resolve(copy, 'hooks/hooks.json'), 'utf8')).hooks.PreToolUse[0];
    for (const tool of ['Bash', 'Monitor', 'Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob']) {
      assert.ok(group.matcher.split('|').includes(tool), `${tool} must register`);
    }
    const invoke = (tool: string, input: unknown, expected: number, plugin = copy, eventCwd = cwd): void => {
      const result = spawnSync('/bin/sh', ['-c', group.hooks[0].command], {
        cwd,
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin, DESIGN_LAB_HOME: home },
        encoding: 'utf8',
        timeout: 5000,
        input: JSON.stringify({
          session_id: 'fixture',
          transcript_path: resolve(root, 'unused.jsonl'),
          cwd: eventCwd,
          permission_mode: 'dontAsk',
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_use_id: 'fixture-tool',
          tool_input: input,
        }),
      });
      assert.equal(
        result.status,
        expected,
        JSON.stringify({ tool, input, stderr: result.stderr, error: result.error }),
      );
      assert.equal(result.stdout, '', 'exit-code protocol emits no JSON or token');
      if (expected === 2) assert.match(result.stderr, /design-lab: the runner token/);
      else assert.equal(result.stderr, '');
    };
    for (const command of [
      `cat '${home}/runner-token'`,
      `cat '${realpathSync(home)}/runner-token'`,
      `cat '${root}/alias-home/runner-token'`,
      `cat '${root}/innocent'`,
      `cat '${runner}/asset.json'`,
      'cat "$DESIGN_LAB_HOME/runner-token"',
      'cat "${DESIGN_LAB_HOME}/runner-t"oken',
      `rm '${home}/runner-token'`,
      `cat '${runner}/../runner-token'`,
      `cat '${home}/'*`,
      `cat '${runner}/back-home/runner-token'`,
      'cat fixture',
    ])
      invoke('Bash', { command }, 2);
    invoke('Monitor', { command: `cat '${home}/runner-token'` }, 2);
    invoke('Bash', { command: `echo ${'a'.repeat(300)}; cat '${root}/innocent'` }, 2);
    // A relative word under the limits still resolves, however long the working directory makes it.
    invoke('Bash', { command: `cat ${'./'.repeat(505)}fixture` }, 2);
    for (const [tool, input] of [
      ['Read', { file_path: resolve(root, 'innocent') }],
      ['Edit', { file_path: resolve(home, 'runner-token') }],
      ['Write', { file_path: resolve(root, 'alias-home/new-file') }],
      ['NotebookEdit', { notebook_path: resolve(root, 'innocent') }],
      ['Grep', { path: resolve(root, 'alias-home'), pattern: '.' }],
      ['Glob', { path: home, pattern: '**/*' }],
      ['Read', { file_path: '../innocent' }],
    ] as const)
      invoke(tool, input, 2);
    invoke('Read', { file_path: './runner-token' }, 2, copy, home);
    invoke('Read', { file_path: 'runner-token' }, 2, copy, home);
    invoke('Bash', { command: 'cat *' }, 2, copy, home);
    invoke('Glob', { pattern: '**/*' }, 2, copy, home);
    invoke('Grep', { pattern: '.' }, 2, copy, home);
    invoke('Bash', { command: `cat '${root}/innocent'` }, 2, resolve(root, 'plugin-link'));
    for (const command of [
      'echo ok',
      'node scripts/workflow.ts preflight --project W',
      'node --test tests/ts/*.test.ts',
      `cat '${runner}/manifest.json'`,
      // A word past the system's path limits names no file; it must not refuse the command.
      `echo ${'a'.repeat(300)}`,
      `echo '${Buffer.from('x'.repeat(400)).toString('base64')}'`,
    ])
      invoke('Bash', { command }, 0);
    invoke('Read', { file_path: resolve(runner, 'manifest.json') }, 0);
    // Malformed unrelated input has no actionable path; do not break ordinary sessions.
    for (const input of [null, [], 'wrong shape']) invoke('Bash', input, 0);
    unlinkSync(resolve(home, 'runner-token'));
    invoke('Write', { file_path: resolve(root, 'innocent'), content: 'x' }, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
