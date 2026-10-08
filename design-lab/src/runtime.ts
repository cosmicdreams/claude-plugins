/** Dependencies live outside the plain-copy plugin, following lab_setup.ts's cache root. */
import { homedir } from 'node:os';
import { resolve, isAbsolute, sep, basename } from 'node:path';
import { createRequire, registerHooks, isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
export function cacheRoot(): string {
  const override = process.env['DESIGN_LAB_CACHE'];
  if (override !== undefined && !isAbsolute(override)) {
    throw new Error(
      'DESIGN_LAB_CACHE must be an absolute path (for example /tmp/design-lab-cache); relative paths and ~ are not supported.',
    );
  }
  return override ?? resolve(homedir(), process.platform === 'darwin' ? 'Library/Caches' : '.cache', 'design-lab');
}
/** Lock-addressed installs can coexist with lab_setup.ts's unpinned playwright folder. */
export function dependencyFolder(): string {
  const hash = createHash('sha256')
    .update(readFileSync(resolve(pluginRoot, 'package-lock.json')))
    .digest('hex')
    .slice(0, 16);
  return resolve(cacheRoot(), 'typescript', `v2-${hash}`);
}
export const completionMarker = '.design-lab-complete';
export function chromiumFolder(): string {
  const override = process.env['PLAYWRIGHT_BROWSERS_PATH'];
  if (override !== undefined && !isAbsolute(override))
    throw new Error('PLAYWRIGHT_BROWSERS_PATH must be an absolute path');
  return override ?? resolve(cacheRoot(), 'browsers', basename(dependencyFolder()));
}
// Playwright reads this at module load. All direct scripts share setup's location.
process.env['PLAYWRIGHT_BROWSERS_PATH'] ??= chromiumFolder();
export function dependenciesReady(folder = dependencyFolder()): boolean {
  return existsSync(resolve(folder, completionMarker)) && existsSync(resolve(folder, 'node_modules'));
}
export function readyDependencyFolder(): string {
  const folder = dependencyFolder();
  if (!dependenciesReady(folder)) {
    throw new Error(
      `design-lab dependencies are incomplete at ${folder}; run node ${resolve(pluginRoot, 'scripts/setup-ts.ts')} with the same DESIGN_LAB_CACHE first.`,
    );
  }
  return folder;
}
export function sharedRequire(): NodeJS.Require {
  return createRequire(resolve(readyDependencyFolder(), 'package.json'));
}
/** Used by launch.ts for entrypoints that prefer ordinary bare ESM imports. */
export function registerSharedDependencies(): void {
  const parentURL = pathToFileURL(resolve(readyDependencyFolder(), 'entry.mjs')).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : undefined;
      const pluginParent = parent?.startsWith(pluginRoot) && !parent.split(sep).includes('node_modules');
      if (
        pluginParent &&
        !isBuiltin(specifier) &&
        !specifier.startsWith('.') &&
        !specifier.startsWith('/') &&
        !specifier.startsWith('#') &&
        !specifier.includes(':')
      ) {
        return nextResolve(specifier, { ...context, parentURL });
      }
      return nextResolve(specifier, context);
    },
  });
}
