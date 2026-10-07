import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pluginRoot } from '../../src/runtime.ts';

/** Everything lives under /tmp; the person's real ~/.design-lab is never read or written. */
const scratch = (): string => mkdtempSync('/tmp/design-lab-install-');
/** The shared dependency cache is inherited; only the personal folder is private. */
const isolatedEnv = (home: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, DESIGN_LAB_HOME: home };
  delete env['DESIGN_LAB_CONFIG'];
  return env;
};
const TYPE_STRIPPING = /ExperimentalWarning|stripTypeScriptTypes/;

test('the type-stripping notice is dropped while other warnings still reach the process', () => {
  const home = scratch();
  try {
    const script = `
      import { stripTemplate } from ${JSON.stringify(pathToFileURL(resolve(pluginRoot, 'src/render-payload.ts')).href)};
      const before = process.emitWarning;
      stripTemplate('const kept: number = 1;');
      console.log('restored ' + (process.emitWarning === before));
      process.emitWarning('a different warning', 'UserWarning');`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: isolatedEnv(home), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /restored true/);
    assert.doesNotMatch(result.stderr, TYPE_STRIPPING);
    assert.match(result.stderr, /UserWarning: a different warning/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
