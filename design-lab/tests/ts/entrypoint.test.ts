import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pluginRoot } from '../../src/runtime.ts';

for (const [entry, args, expected] of [
  ['scripts/detect.ts', [], /usage: detect.ts <repository>/],
  ['scripts/workflow.ts', ['--help'], /workflow.ts <command>/],
  ['scripts/evaluation.ts', ['--help'], /usage:/],
  ['src/capture.ts', [], /usage: capture.ts/],
  ['src/fetch-images.ts', [], /usage: fetch-images.ts/],
  ['src/figma-build.ts', [], /--project is required/],
  ['src/figma-runner.ts', ['--help'], /usage:/],
  ['src/fonts.ts', [], /usage: fonts.ts/],
  ['src/render-payload.ts', ['hash'], /^[a-f0-9]+/],
  ['src/responsive.ts', [], /usage: responsive.ts SPEC.json/],
] as const)
  void test(`phase 5 entrypoint executes through symlink: ${entry}`, () => {
    const root = mkdtempSync('/tmp/design-lab-p5-entry-');
    try {
      const link = resolve(root, 'plugin');
      symlinkSync(pluginRoot, link);
      const direct = spawnSync(process.execPath, [resolve(pluginRoot, entry), ...args], {
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.match(direct.stdout + direct.stderr, expected, 'positive control');
      const linked = spawnSync(process.execPath, [resolve(link, entry), ...args], { encoding: 'utf8', timeout: 10000 });
      assert.equal(linked.status, direct.status, linked.stderr);
      assert.match(linked.stdout + linked.stderr, expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
