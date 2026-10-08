import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pluginRoot, sharedRequire, dependencyFolder, completionMarker } from '../../src/runtime.ts';

void test('pinned runtime dependencies load from shared cache', async () => {
  const require = sharedRequire();
  const sharp = require('sharp') as (typeof import('sharp'))['default'];
  const { chromium } = require('playwright') as typeof import('playwright');
  assert.ok(chromium.executablePath()); // no browser launched or downloaded
  const pixels = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#ff0000' } })
    .raw()
    .toBuffer();
  assert.equal(pixels.length, 24);
  assert.equal(pixels[0], 255);
  assert.ok(require.resolve('sharp').startsWith(realpathSync(dependencyFolder())));
  assert.equal(existsSync(resolve(pluginRoot, 'node_modules')), false);
});
void test('plain-copy direct TS and bare-import launcher work from unrelated cwd', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'design-lab-copy-'));
  try {
    const copy = resolve(dir, 'plugin');
    mkdirSync(copy);
    for (const name of [
      'src',
      'scripts/launch.ts',
      'scripts/check-artifacts.ts',
      'schemas',
      'package.json',
      'package-lock.json',
    ]) {
      cpSync(resolve(pluginRoot, name), resolve(copy, name), { recursive: true });
    }
    const cwd = resolve(dir, 'unrelated');
    mkdirSync(cwd);
    const artifacts = resolve(dir, 'run');
    mkdirSync(artifacts);
    writeFileSync(resolve(artifacts, 'phase-log.jsonl'), '{"at":"now","phase":"init","status":"complete"}\n');
    const direct = spawnSync(process.execPath, [resolve(copy, 'scripts/check-artifacts.ts'), artifacts], {
      cwd,
      encoding: 'utf8',
    });
    assert.equal(direct.status, 0, direct.stderr);
    assert.match(direct.stdout, /1\/1 files passed/);
    writeFileSync(
      resolve(copy, 'scripts/probe.ts'),
      "import sharp from 'sharp'; import { chromium } from 'playwright'; console.log(sharp.versions.vips, chromium.name());",
    );
    const launch = spawnSync(process.execPath, [resolve(copy, 'scripts/launch.ts'), 'scripts/probe.ts'], {
      cwd,
      encoding: 'utf8',
    });
    assert.equal(launch.status, 0, launch.stderr);
    assert.match(launch.stdout, /chromium/);
    assert.equal(existsSync(resolve(copy, 'node_modules')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('bare ESM imports retain nested dependency versions and default exports', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'design-lab-nested-esm-'));
  try {
    const copy = resolve(dir, 'plugin');
    mkdirSync(copy);
    for (const name of ['src/runtime.ts', 'scripts/launch.ts', 'package.json', 'package-lock.json']) {
      cpSync(resolve(pluginRoot, name), resolve(copy, name), { recursive: true });
    }
    const env = { ...process.env, DESIGN_LAB_CACHE: resolve(dir, 'cache') };
    const locate = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { dependencyFolder } from ${JSON.stringify(resolve(copy, 'src/runtime.ts'))}; console.log(dependencyFolder());`,
      ],
      { env, encoding: 'utf8' },
    );
    assert.equal(locate.status, 0, locate.stderr);
    const folder = locate.stdout.trim();
    const outer = resolve(folder, 'node_modules/outer');
    const nested = resolve(outer, 'node_modules/versioned');
    const top = resolve(folder, 'node_modules/versioned');
    for (const path of [outer, nested, top]) mkdirSync(path, { recursive: true });
    writeFileSync(resolve(folder, completionMarker), 'complete\n');
    for (const path of [outer, nested, top])
      writeFileSync(resolve(path, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
    writeFileSync(resolve(outer, 'index.js'), "import value from 'versioned'; export default value;");
    writeFileSync(resolve(nested, 'index.js'), "export default 'nested-4';");
    writeFileSync(resolve(top, 'index.js'), "export const value = 'top-5';");
    writeFileSync(resolve(copy, 'scripts/probe.ts'), "import value from 'outer'; console.log(value);");
    const result = spawnSync(process.execPath, [resolve(copy, 'scripts/launch.ts'), 'scripts/probe.ts'], {
      env,
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'nested-4');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
void test('relative cache overrides fail identically from unrelated working directories', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'design-lab-relative-cache-'));
  try {
    for (const cwd of [pluginRoot, dir]) {
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { cacheRoot } from ${JSON.stringify(resolve(pluginRoot, 'src/runtime.ts'))}; cacheRoot();`,
        ],
        {
          cwd,
          env: { ...process.env, DESIGN_LAB_CACHE: 'relative-cache' },
          encoding: 'utf8',
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /DESIGN_LAB_CACHE must be an absolute path.*\/tmp\/design-lab-cache/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
