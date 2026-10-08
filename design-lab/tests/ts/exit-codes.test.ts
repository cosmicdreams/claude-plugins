import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pluginRoot } from '../../src/runtime.ts';
import { failureCode, FAILURE, USAGE } from '../../src/exit-code.ts';

const run = (script: string, args: string[]) =>
  spawnSync(process.execPath, [resolve(pluginRoot, 'scripts', script), ...args], { encoding: 'utf8', cwd: '/tmp' });

test('an ordinary failure exits 1, as the Python baseline did', () => {
  assert.equal(FAILURE, 1);
  for (const [script, args] of [
    ['workflow.ts', ['status', '--project', '/nonexistent-design-lab-run']],
    ['workflow.ts', ['no-such-command']],
    ['lab_setup.ts', ['no-such-command']],
    ['capture_all.ts', ['--project', '/tmp/design-lab-exit-code-run']],
  ] as const) {
    const result = run(script, [...args]);
    assert.equal(result.status, 1, `${script} ${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, /error|usage/i);
  }
});

test('a command-line usage error exits 2, as argparse did', () => {
  assert.equal(USAGE, 2);
  const result = run('workflow.ts', ['status', '--no-such-flag']);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Unknown option/);
  assert.equal(failureCode(Object.assign(new Error('x'), { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' })), 2);
  assert.equal(failureCode(new Error('x')), 1);
  assert.equal(failureCode('plain string'), 1);
  assert.equal(failureCode(null), 1);
});

test('no launcher hard-codes exit code 2 for failures', () => {
  const folder = resolve(pluginRoot, 'scripts');
  for (const name of readdirSync(folder).filter((file) => file.endsWith('.ts'))) {
    const source = readFileSync(resolve(folder, name), 'utf8');
    assert.ok(!/exitCode\s*=\s*2\b|process\.exit\(2\)/.test(source), `${name} hard-codes exit code 2`);
  }
});
