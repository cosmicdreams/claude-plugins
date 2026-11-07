// The marketplace's view of test-lab, shared by the release tests (tests/ts/release.test.ts) and the
// install-step proof (tests/install): which folder the entry selects, the files Git would carry from it,
// and copies of them made the way a Git checkout would.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../../..');

/** The folder the marketplace entry named test-lab selects. */
export function selected(): string {
  const marketplace = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8')) as { plugins: { name: string; source: unknown }[] };
  const entry = marketplace.plugins.find((p) => p.name === 'test-lab');
  assert.ok(entry !== undefined && typeof entry.source === 'string', 'the marketplace has no local test-lab entry');
  return resolve(REPO, entry.source as string);
}

/** The files Git would carry from `dir`: tracked, or untracked and not ignored. */
export function gitShipped(dir: string): string[] {
  const rel = relative(REPO, dir);
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', rel], { cwd: REPO, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f !== '' && existsSync(join(REPO, f)))
    .map((f) => relative(rel, f).split('\\').join('/'))
    .sort();
}

/** A copy as a Git checkout would make it: those files only, mode 755 or 644 by the owner's execute bit. */
export function shipCopy(dir: string, files: string[], destination: string): void {
  for (const file of files) {
    mkdirSync(dirname(join(destination, file)), { recursive: true });
    cpSync(join(dir, file), join(destination, file));
    chmodSync(join(destination, file), statSync(join(dir, file)).mode & 0o100 ? 0o755 : 0o644);
  }
}

/** The selected tracked payload's actual Git blobs, including Git's byte/mode normalization. */
export function shipIndexCopy(dir: string, files: string[], destination: string): void {
  for (const file of files) {
    const path = relative(REPO, join(dir, file));
    mkdirSync(dirname(join(destination, file)), { recursive: true });
    writeFileSync(join(destination, file), execFileSync('git', ['show', `:${path}`], { cwd: REPO, maxBuffer: 32 * 1024 * 1024 }));
    const entry = execFileSync('git', ['ls-files', '--stage', '--', path], { cwd: REPO, encoding: 'utf8' });
    chmodSync(join(destination, file), entry.startsWith('100755') ? 0o755 : 0o644);
  }
}

export const links = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); const s = lstatSync(p); return s.isSymbolicLink() ? [p] : s.isDirectory() ? links(p) : []; });

/** Relative imports of every hooks module, each with the file it would load. */
export function hookImports(root: string): { from: string; target: string }[] {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });
  return files(join(root, 'hooks')).flatMap((from) => [...readFileSync(from, 'utf8').matchAll(/^\s*import\s[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)].map((m) => ({ from, target: resolve(dirname(from), m[1]!) })));
}

