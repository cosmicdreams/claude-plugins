#!/usr/bin/env node
// The host discovers every test file recursively and can't load Node tests, so the mod's own surface is
// staged in a temporary folder and `claude plugin test` runs there.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = mkdtempSync(join(tmpdir(), 'test-lab-mod-tests-'));
try {
  if (process.argv.includes('--release')) {
    const repo = resolve(root, '..');
    const marketplace = JSON.parse(readFileSync(join(repo, '.claude-plugin/marketplace.json'), 'utf8')) as { plugins: { name: string; source: string }[] };
    const selected = marketplace.plugins.find(p => p.name === 'test-lab');
    if (selected === undefined) throw new Error('no test-lab marketplace entry');
    const source = resolve(repo, selected.source);
    // Test the actual selected Git payload, physically copied, with only the mock tests added.
    const { execFileSync } = await import('node:child_process');
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const file of files) {
      const path = relative(repo, join(source, file));
      mkdirSync(dirname(join(folder, file)), { recursive: true });
      writeFileSync(join(folder, file), execFileSync('git', ['show', `:${path}`], { cwd: repo, maxBuffer: 32 * 1024 * 1024 }));
      const entry = execFileSync('git', ['ls-files', '--stage', '--', path], { cwd: repo, encoding: 'utf8' });
      chmodSync(join(folder, file), entry.startsWith('100755') ? 0o755 : 0o644);
    }
  }
  for (const name of process.argv.includes('--release') ? ['tests/mod'] : ['.claude-plugin/plugin.json', 'hooks', 'src/artifacts.ts', 'tests/mod']) {
    mkdirSync(dirname(join(folder, name)), { recursive: true });
    cpSync(join(root, name), join(folder, name), { recursive: true });
  }
  const result = spawnSync('claude', ['plugin', 'test', folder], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(folder, { recursive: true, force: true });
}
