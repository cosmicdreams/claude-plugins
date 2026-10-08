import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMMANDS, BOOLEAN_FLAGS, CHOICES, NUMBER_DEFAULTS, parseCommand } from '../../scripts/workflow.ts';
import type { CommandArgs } from '../../scripts/workflow.ts';

void test('workflow retains all 24 commands and 44 flags, required flags, choices and defaults', () => {
  assert.deepEqual(
    COMMANDS,
    JSON.parse(readFileSync(new URL('../fixtures/workflow-commands.json', import.meta.url), 'utf8')),
  );
  assert.equal(Object.keys(COMMANDS).length, 24);
  assert.equal(new Set(Object.values(COMMANDS).flatMap((s) => s.flags)).size, 44);
  assert.deepEqual(BOOLEAN_FLAGS, [
    'force',
    'allow-in-repository',
    'no-schema-change',
    'without-twig-debug',
    'ensure',
    'await-runner',
    'from-preflight',
    'finished',
    'json',
  ]);
  assert.deepEqual(CHOICES, {
    kind: ['components', 'tokens', 'all'],
    'plan-approval': ['proposed', 'review'],
    'usage-fallback': ['stop', 'untiered'],
    status: ['pending', 'running', 'complete', 'failed', 'waived'],
  });
  assert.deepEqual(NUMBER_DEFAULTS, { timeout: 1800, high: 50, medium: 10, 'runner-timeout': 300, minutes: 2 });
  assert.deepEqual(
    { ...parseCommand('identity', ['--schema-change', 'first', '--schema-change', 'second']).args },
    { 'schema-change': ['first', 'second'] },
  );
  assert.deepEqual({ ...parseCommand('runs', []).args }, {});
  assert.deepEqual(parseCommand('report', ['--project', 'run', 'capture']).positionals, ['capture']);
  assert.throws(() => parseCommand('init', []), /--repo is required/);
  assert.throws(() => parseCommand('extract', ['--kind', 'bogus']), /--kind must be one of/);
  const register = parseCommand('register', ['--name', 'x', '--path', 'x', '--kind', 'custom']);
  assert.equal(register.command, 'register');
  if (register.command === 'register') assert.equal(register.args.kind, 'custom');
  assert.throws(() => parseCommand('init', ['--repo', 'x', '--site-labl', 'x']), /Unknown option/);
  assert.throws(() => parseCommand('record', ['--phase', 'captuer', '--status', 'complete']), /invalid --phase/);
  assert.equal(parseCommand('record', ['--phase', 'benchmark', '--status', 'running']).args.phase, 'benchmark');
});
// Compile-time regressions: each subcommand exposes only its declared keys and value unions.
function checkArgs(
  identity: CommandArgs<'identity'>,
  extract: CommandArgs<'extract'>,
  init: CommandArgs<'init'>,
): void {
  // @ts-expect-error misspelled flag
  void identity['site-labl'];
  // @ts-expect-error flag belongs to a different subcommand
  void extract['operator'];
  // @ts-expect-error finite choice union
  extract.kind = 'bogus';
  // @ts-expect-error finite phase union
  const badPhase: CommandArgs<'record'> = { phase: 'captuer', status: 'complete' };
  void badPhase;
  // @ts-expect-error required init argument
  const missing: CommandArgs<'init'> = {};
  void missing;
  const repo: string = init.repo;
  void repo;
}
void checkArgs;
