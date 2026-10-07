/** Durable executable parity evidence for the stripped Figma runner client. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pluginRoot } from '../../src/runtime.ts';
import { stripTemplate } from '../../src/render-payload.ts';
import { tokens } from './template-parity.ts';

export function assertRunnerClientParity(): { runner: number; cache: boolean; timing: boolean } {
  let current = stripTemplate(readFileSync(resolve(pluginRoot,'runner/code.ts'),'utf8'));
  const original = readFileSync(resolve(pluginRoot,'runner/code.js'),'utf8');
  const cache = current.match(/    const cacheId = [\s\S]*?    const started = Date.now\(\);\n/)?.[0];
  assert.ok(cache,'the runner cache/timer addition is present');
  // Compare the entire removed block before removing it: unrelated runtime edits
  // inside this block must not be hidden by the parity normalization.
  assert.equal(tokens(cache),tokens(`
    const cacheId = (step.buildId || 'preflight');
    try { if (typeof globalThis !== 'undefined' && (!globalThis.__designLabBuildCache || globalThis.__designLabBuildCache.buildId !== cacheId)) {
      globalThis.__designLabBuildCache = { buildId: cacheId, loadedFonts: new Map() };
    } } catch { /* A sandbox without persistent globals uses the template-local cache. */ }
    const started = Date.now();
  `),'only the reviewed cache initialization and timer block may differ');
  current = current.replace(cache,'');
  const wrapped = current.match(/await call\((`\/record\?step=\$\{encodeURIComponent\(step.step\)\}`), \{\s*__designLabTiming: \{ durationMs: Date.now\(\) - started \},\s*result: result === undefined \? \{\} : result,\s*\}\);/)?.[0];
  assert.ok(wrapped,'the reviewed timing wrapper is present exactly');
  current = current.replace(wrapped,'await call(`/record?step=${encodeURIComponent(step.step)}`, result === undefined ? {} : result);');
  assert.equal(tokens(current),tokens(original),'all remaining runner executable AST nodes match the JS oracle');
  return {runner:1,cache:true,timing:true};
}
