#!/usr/bin/env node
/** Publish immutable complete installs; never run npm inside a published folder. */
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, readdirSync, writeFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { dependencyFolder, dependenciesReady, completionMarker, pluginRoot } from '../src/runtime.ts';

const folder = dependencyFolder();
const lock = `${folder}.lock`;
mkdirSync(dirname(folder), { recursive: true });

function code(error: unknown): string | undefined { return (error as NodeJS.ErrnoException).code; }
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (code(error) === 'ESRCH') return false; throw error; }
}
/** A prepared nonempty directory is atomically renamed to claim the lock. Stale
 * recovery only unlinks the observed dead owner's file and removes EMPTY dirs,
 * so competing recoverers cannot recursively remove a new owner's lock. */
async function acquire(): Promise<() => void> {
  const candidate = mkdtempSync(`${lock}-`);
  const owner = `${process.pid}.json`;
  writeFileSync(resolve(candidate, owner), JSON.stringify({ pid: process.pid }));
  const deadline = Date.now() + 120_000;
  try {
    while (true) {
      try {
        renameSync(candidate, lock);
        return () => {
          unlinkSync(resolve(lock, owner));
          // A waiter may already have replaced the now-empty lock directory.
          try { rmdirSync(lock); } catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(code(error) ?? '')) throw error; }
        };
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(code(error) ?? '')) throw error;
      }
      let owners: string[];
      try { owners = readdirSync(lock); } catch (error) { if (code(error) === 'ENOENT') continue; throw error; }
      for (const name of owners) {
        const pid = Number(name.replace(/\.json$/, ''));
        if (!Number.isSafeInteger(pid) || pid <= 0 || alive(pid)) continue;
        try { unlinkSync(resolve(lock, name)); } catch (error) { if (code(error) !== 'ENOENT') throw error; }
      }
      try { rmdirSync(lock); } catch (error) { if (!['ENOTEMPTY', 'ENOENT'].includes(code(error) ?? '')) throw error; }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for design-lab setup lock ${lock}; another setup may still be running.`);
      await setTimeout(50);
    }
  } finally { rmSync(candidate, { recursive: true, force: true }); }
}

// --production remains compatible, but always includes dev packages. One complete
// profile prevents an end-user setup from stripping another checkout's compiler.
if (!dependenciesReady(folder)) {
  const release = await acquire();
  let stage: string | undefined;
  try {
    if (!dependenciesReady(folder)) {
      stage = mkdtempSync(`${folder}.install-`);
      for (const name of ['package.json', 'package-lock.json']) copyFileSync(resolve(pluginRoot, name), resolve(stage, name));
      const installer = spawn('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], {
        cwd: stage, stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
      });
      const status = await new Promise<number>((done, reject) => {
        installer.once('error', reject);
        installer.once('exit', (status, signal) => signal ? reject(new Error(`npm ci interrupted by ${signal}`)) : done(status ?? 1));
      });
      if (status !== 0) throw new Error(`npm ci failed with exit code ${status}; no dependency install was published.`);
      writeFileSync(resolve(stage, completionMarker), 'complete\n');
      // An incomplete target is never usable by this runtime. Preserve it for
      // inspection; completed targets are never moved, deleted, or reinstalled.
      try { renameSync(folder, `${stage}.incomplete`); } catch (error) { if (code(error) !== 'ENOENT') throw error; }
      renameSync(stage, folder);
    }
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true });
    release();
  }
}
console.log(`design-lab dependencies: ${folder}`);
