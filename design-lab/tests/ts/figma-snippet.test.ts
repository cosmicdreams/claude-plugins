import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { pluginRoot } from '../../src/runtime.ts';

const run = (...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', resolve(pluginRoot, 'scripts/figma_snippet.ts'), ...args], { encoding: 'utf8', cwd: '/tmp' });

test('each read-only dump prints as plain JavaScript that compiles as a use_figma body', () => {
  for (const [name, placeholder] of [['figma_dump_root', ''], ['figma_dump_page', 'PAGE_ID'], ['figma_dump_getting_started', 'PAGE_ID'], ['figma_dump_tree', '__PAGE_ID__']] as const) {
    const result = run(name, ...placeholder ? ['--page-id', '12:34'] : []);
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.ok(!/^\s*(import|export)\s|DESIGN_LAB_TEMPLATE/m.test(result.stdout), `${name} still carries TypeScript module syntax`);
    if (placeholder) { assert.ok(result.stdout.includes("'12:34'"), `${name} did not receive the page id`); assert.ok(!result.stdout.includes(placeholder), `${name} kept its placeholder`); }
    assert.doesNotThrow(() => new vm.Script(`(async () => {${result.stdout}\n})`), name); // compiled, not executed
  }
});

test('the snippet command rejects unknown names and a page id for the root dump with exit 1', () => {
  for (const args of [[], ['no_such_dump'], ['figma_dump_root', '--page-id', '1']]) assert.equal(run(...args).status, 1, args.join(' '));
  assert.equal(run('figma_dump_page', '--no-such-flag').status, 2);
});
