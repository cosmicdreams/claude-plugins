import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pluginRoot } from '../../src/runtime.ts';
import { makeServer } from '../../src/figma-runner.ts';

/** Everything lives under /tmp; the person's real ~/.design-lab is never read or written. */
const scratch = (): string => mkdtempSync('/tmp/design-lab-install-');
/** The shared dependency cache is inherited; only the personal folder is private. */
const isolatedEnv = (home: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, DESIGN_LAB_HOME: home };
  delete env['DESIGN_LAB_CONFIG'];
  return env;
};
const TYPE_STRIPPING = /ExperimentalWarning|stripTypeScriptTypes/;

void test('runner install prints no type-stripping ExperimentalWarning and names the configured token path', () => {
  const home = scratch();
  try {
    const result = spawnSync(process.execPath, [resolve(pluginRoot, 'scripts/lab_setup.ts'), 'runner'], {
      env: isolatedEnv(home),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, TYPE_STRIPPING);
    const tokenPath = resolve(home, 'runner-token');
    assert.ok(result.stdout.includes(`pbcopy < ${tokenPath}`), result.stdout);
    assert.doesNotMatch(result.stdout, /~\/\.design-lab/);
    const token = readFileSync(tokenPath, 'utf8').trim();
    assert.ok(!result.stdout.includes(token), 'the token itself is never printed');
    assert.ok(
      readFileSync(resolve(home, 'runner/code.js'), 'utf8').includes(
        `const TOKEN_PATH = ${JSON.stringify(tokenPath)};`,
      ),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

void test('the type-stripping notice is dropped while other warnings still reach the process', () => {
  const home = scratch();
  try {
    const script = `
      import { stripTemplate } from ${JSON.stringify(pathToFileURL(resolve(pluginRoot, 'src/render-payload.ts')).href)};
      const before = process.emitWarning;
      stripTemplate('const kept: number = 1;');
      console.log('restored ' + (process.emitWarning === before));
      process.emitWarning('a different warning', 'UserWarning');`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: isolatedEnv(home),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /restored true/);
    assert.doesNotMatch(result.stderr, TYPE_STRIPPING);
    assert.match(result.stderr, /UserWarning: a different warning/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

void test('a rejected runner token is answered with the configured token path, never the token', async () => {
  const home = scratch();
  const runner = makeServer(new Map(), 'real-token', {
    ctx: { home: resolve(home, '.design-lab'), port: 0 },
    version: '0.0.0',
  });
  try {
    const port = await runner.listen(0);
    const response = await fetch(`http://127.0.0.1:${port}/next?token=wrong&fileKey=KEY&version=0.0.0`);
    const text = await response.text();
    assert.equal(response.status, 401);
    assert.ok(text.includes(resolve(home, '.design-lab', 'runner-token')), text);
    assert.doesNotMatch(text, /~\/\.design-lab/);
    assert.ok(!text.includes('real-token'));
  } finally {
    await runner.close();
    rmSync(home, { recursive: true, force: true });
  }
});
