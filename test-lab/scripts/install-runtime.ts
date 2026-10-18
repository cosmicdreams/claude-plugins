#!/usr/bin/env node
// Installs test-lab's one runtime dependency into this plugin copy, once, after install or update:
// the pinned source parser (kit/package.json's typescript), with `npm ci` in the copy's own kit
// folder, from kit/package-lock.json, so the tarball is checked against the lockfile's integrity.
// Lifecycle scripts are not run. Nothing outside <plugin>/kit/node_modules is written.
//
//   node <plugin>/scripts/install-runtime.ts            (npm's usual registry and cache)
//   node <plugin>/scripts/install-runtime.ts --offline  (the local npm cache only; fails if it lacks the tarball)
//
// The release ships no node_modules (each copy installs its own), so a fresh install needs this
// step; the runner and the mod refuse to start until it is done, and say so.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { runtimeProblem } from '../src/mod-entry.ts';

export const PLUGIN_ROOT = dirname(import.meta.dirname);
export const INSTALL_ARGS = ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev'] as const;

/** Runs `npm ci` in `<root>/kit` and returns why the runtime is still missing, or null when it is ready. */
export function installRuntime(root = PLUGIN_ROOT, options: { offline?: boolean; env?: NodeJS.ProcessEnv } = {}): string | null {
  if (runtimeProblem(root) === null) return null;
  const args = [...INSTALL_ARGS, ...(options.offline === true ? ['--offline'] : [])];
  const npm = spawnSync('npm', args, { cwd: join(root, 'kit'), encoding: 'utf8', env: options.env ?? process.env, timeout: 300_000 });
  if (npm.error !== undefined) return `npm could not be started (${npm.error.message}); install Node.js 24 or newer with npm, then run this again`;
  if (npm.status !== 0) {
    const detail = `${npm.stderr}\n${npm.stdout}`.split('\n').find((line) => /npm (error|ERR!)/.test(line)) ?? `exit ${String(npm.status)}`;
    return `npm ci in ${join(root, 'kit')} failed: ${detail.trim()}`;
  }
  return runtimeProblem(root);
}

if (import.meta.main) {
  const offline = process.argv.includes('--offline');
  const unknown = process.argv.slice(2).filter((a) => a !== '--offline');
  if (unknown.length > 0) {
    process.stderr.write(`unknown argument ${unknown[0]}; usage: node scripts/install-runtime.ts [--offline]\n`);
    process.exitCode = 4;
  } else {
    const problem = installRuntime(PLUGIN_ROOT, { offline });
    if (problem === null) process.stdout.write(`test-lab runtime ready in ${PLUGIN_ROOT}\n`);
    else {
      process.stderr.write(`${problem}\n`);
      process.exitCode = 1;
    }
  }
}
