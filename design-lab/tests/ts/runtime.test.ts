import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pluginRoot, sharedRequire, dependencyFolder } from '../../src/runtime.ts';

test('pinned runtime dependencies load from shared cache', async () => {
  const require = sharedRequire();
  const sharp = require('sharp') as typeof import('sharp')['default'];
  const { chromium } = require('playwright') as typeof import('playwright');
  assert.ok(chromium.executablePath()); // no browser launched or downloaded
  const pixels = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#ff0000' } }).raw().toBuffer();
  assert.equal(pixels.length, 24);
  assert.equal(pixels[0], 255);
  assert.ok(require.resolve('sharp').startsWith(realpathSync(dependencyFolder())));
  assert.equal(existsSync(resolve(pluginRoot, 'node_modules')), false);
});
test('plain-copy direct TS and bare-import launcher work from unrelated cwd', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'design-lab-copy-'));
  try {
    const copy = resolve(dir, 'plugin'); mkdirSync(copy);
    for (const name of ['src', 'scripts/launch.ts', 'scripts/check-artifacts.ts', 'schemas', 'package.json', 'package-lock.json']) {
      cpSync(resolve(pluginRoot, name), resolve(copy, name), { recursive: true });
    }
    const cwd = resolve(dir, 'unrelated'); mkdirSync(cwd);
    const artifacts = resolve(dir, 'run'); mkdirSync(artifacts);
    writeFileSync(resolve(artifacts, 'phase-log.jsonl'), '{"at":"now","phase":"init","status":"complete"}\n');
    const direct = spawnSync(process.execPath, [resolve(copy, 'scripts/check-artifacts.ts'), artifacts], { cwd, encoding: 'utf8' });
    assert.equal(direct.status, 0, direct.stderr); assert.match(direct.stdout, /1\/1 files passed/);
    writeFileSync(resolve(copy, 'scripts/probe.ts'), "import sharp from 'sharp'; import { chromium } from 'playwright'; console.log(sharp.versions.vips, chromium.name());");
    const launch = spawnSync(process.execPath, [resolve(copy, 'scripts/launch.ts'), 'scripts/probe.ts'], { cwd, encoding: 'utf8' });
    assert.equal(launch.status, 0, launch.stderr); assert.match(launch.stdout, /chromium/);
    assert.equal(existsSync(resolve(copy, 'node_modules')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
