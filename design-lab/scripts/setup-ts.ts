#!/usr/bin/env node
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dependencyFolder, pluginRoot } from '../src/runtime.ts';
const folder = dependencyFolder();
mkdirSync(folder, { recursive: true });
for (const name of ['package.json', 'package-lock.json']) copyFileSync(resolve(pluginRoot, name), resolve(folder, name));
const result = spawnSync('npm', ['ci', '--no-audit', '--no-fund', ...(process.argv.includes('--production') ? ['--omit=dev'] : [])], {
  cwd: folder, stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
console.log(`design-lab dependencies: ${folder}`);
