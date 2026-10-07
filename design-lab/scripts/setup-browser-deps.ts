#!/usr/bin/env node
import {resolve,dirname} from 'node:path';
/** CI Linux libraries only; ordinary plugin setup never invokes sudo. */
import { spawnSync } from 'node:child_process';
import { sharedRequire } from '../src/runtime.ts';
if (process.platform === 'linux') { const result = spawnSync(process.execPath, [resolve(dirname(sharedRequire().resolve('playwright/package.json')), 'cli.js'), 'install-deps', 'chromium'], { stdio: 'inherit', env: process.env }); process.exitCode = result.status ?? 1; }
