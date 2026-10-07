import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pluginRoot } from '../../src/runtime.ts';
import { touchesToken } from '../../hooks/guard_runner_token.ts';
test('token guard blocks paths, globs, traversal, edits and function disclosure', () => {
  for (const input of [ { file_path: '/Users/someone/.design-lab/runner-token' }, { command: 'pbcopy < ~/.design-lab/runner-token' }, { command: 'cat ~/.design-lab/runner-token | pbcopy' }, { command: 'cat ~/.design-lab/*' }, { command: 'rg -r . ~/.design-lab' }, { command: 'cat "$HOME/.design-lab/runner-t"oken' }, { path: '/Users/someone/.design-lab', pattern: 'x' }, { path: '/Users/someone/.design-lab/', pattern: '**/*' }, { file_path: '/Users/someone/.design-lab/runner-token', content: 'x' }, { command: 'cat ~/.design-lab/runner/../runner-token' }, { file_path: '/Users/someone/.design-lab/runner/../runner-token' }, { command: 'node -e "print(personToken())"' }, { command: 'echo $(node -e "person_token()")' } ]) assert.equal(touchesToken(input), true, JSON.stringify(input));
  const result = spawnSync(process.execPath, [resolve(pluginRoot, 'hooks/guard_runner_token.ts')], { input: JSON.stringify({ tool_input: { command: 'cat ~/.design-lab/*' } }), encoding: 'utf8' }); assert.equal(result.status, 2); assert.match(result.stderr, /pbcopy < ~\/.design-lab\/runner-token/);
});
test('token guard allows runner assets, ordinary script execution and malformed input', () => {
  for (const input of [ { file_path: '/Users/someone/.design-lab/runner/manifest.json' }, { command: 'ls ~/.design-lab/runner' }, { command: 'node scripts/workflow.ts preflight --project W' }, { file_path: '/repo/design-lab/skills/run/SKILL.md' }, { pattern: 'runner-token', path: '/repo/design-lab' }, { command: 'node scripts/figma_runner.ts start --project W' }, { command: 'node scripts/workflow.ts runner --project W --await-runner' }, { command: 'node --test tests/ts/*.test.ts' } ]) assert.equal(touchesToken(input), false, JSON.stringify(input));
  for (const input of ['{', '{}', 'null']) { const result = spawnSync(process.execPath, [resolve(pluginRoot, 'hooks/guard_runner_token.ts')], { input, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); }
});
