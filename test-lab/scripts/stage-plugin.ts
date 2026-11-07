// The plugin as it would ship, in a fresh folder, for the runner's packaging tests and the live host
// spike. Without dependencies: the runtime parts Git would carry (tracked, or untracked and not
// ignored), as a plain checkout would have them. With dependencies: the release package
// (scripts/build-release.ts), which ships no node_modules, plus the parser an installed copy gets from
// scripts/install-runtime.ts, copied into its kit/node_modules from this checkout's verified, pinned
// parser so the tests need no npm cache or network. The real `npm ci` install step is proven by
// `npm run test:install`. Nothing is linked from this checkout, installed or fetched.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildRelease } from './build-release.ts';
import { stageParser } from './stage-parser.ts';

export const PLUGIN = resolve(import.meta.dirname, '..');
const RUNTIME = ['.claude-plugin', 'hooks', 'src', 'kit', 'scripts', 'package.json', 'package-lock.json'];

export function shippedFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...RUNTIME], { cwd: PLUGIN, encoding: 'utf8' }).split('\n').filter(Boolean);
}

export function stagePlugin(destination: string, options: { dependencies: boolean }): string[] {
  if (options.dependencies) {
    const files = buildRelease(destination).files.map((f) => f.path);
    stageParser(join(destination, 'kit', 'node_modules', 'typescript'));
    return files;
  }
  const files = shippedFiles();
  for (const file of files) {
    mkdirSync(dirname(join(destination, file)), { recursive: true });
    cpSync(join(PLUGIN, file), join(destination, file));
  }
  return files;
}
