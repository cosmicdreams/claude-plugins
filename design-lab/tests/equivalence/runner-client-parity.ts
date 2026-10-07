import { oracleRoot } from './oracle.ts';
/** Durable executable parity evidence for the stripped Figma runner client. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pluginRoot } from '../../src/runtime.ts';
import { stripTemplate } from '../../src/render-payload.ts';
import { tokens } from './template-parity.ts';

export function assertRunnerClientParity(): { runner: number; cache: boolean; timing: boolean } {
  let current = stripTemplate(readFileSync(resolve(pluginRoot,'runner/code.ts'),'utf8'));
  const original = readFileSync(resolve(oracleRoot,'design-lab/runner/code.js'),'utf8');
  const patches = JSON.parse(readFileSync(resolve(pluginRoot,'tests/fixtures/runner-reviewed-diff.json'),'utf8')) as {current:string;original:string}[];
  // Every intentional protocol/cache/heartbeat/timing edit is pinned literally.
  // No wildcard deletion can conceal another executable change.
  for (const patch of patches) {
    assert.ok(patch.current && current.includes(patch.current), 'reviewed runner edit is present exactly');
    assert.equal(current.indexOf(patch.current), current.lastIndexOf(patch.current), 'reviewed edit is unambiguous');
    current = current.replace(patch.current, patch.original);
  }
  assert.equal(tokens(current),tokens(original),'all remaining runner executable AST nodes match the JS oracle');
  return {runner:1,cache:true,timing:true};
}
