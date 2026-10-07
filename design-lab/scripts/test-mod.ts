#!/usr/bin/env node
/** The host discovers every test recursively; isolate its mod-only test surface. */
import { cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pluginRoot } from '../src/runtime.ts';
const folder = mkdtempSync(resolve(tmpdir(), 'design-lab-mod-tests-'));
try {
  for (const name of ['.claude-plugin/plugin.json', 'hooks', 'src/entrypoint.ts', 'types', 'tests/mod']) { mkdirSync(resolve(folder, name, '..'), { recursive: true }); cpSync(resolve(pluginRoot, name), resolve(folder, name), { recursive: true }); }
  const result = spawnSync('claude', ['plugin', 'test', folder], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error; process.exitCode = result.status ?? 1;
} finally { rmSync(folder, { recursive: true, force: true }); }
