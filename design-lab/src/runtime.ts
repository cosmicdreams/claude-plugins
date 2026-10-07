/** Dependencies live outside the plain-copy plugin, following lab_setup.py's cache root. */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire, registerHooks, isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
export function cacheRoot(): string {
  const override = process.env['DESIGN_LAB_CACHE'];
  return override ? resolve(override.replace(/^~(?=\/|$)/, homedir()))
    : resolve(homedir(), process.platform === 'darwin' ? 'Library/Caches' : '.cache', 'design-lab');
}
/** Lock-addressed installs can coexist with lab_setup.py's unpinned playwright folder. */
export function dependencyFolder(): string {
  const hash = createHash('sha256').update(readFileSync(resolve(pluginRoot, 'package-lock.json'))).digest('hex').slice(0, 16);
  return resolve(cacheRoot(), 'typescript', hash);
}
export function sharedRequire(): NodeJS.Require {
  return createRequire(resolve(dependencyFolder(), 'package.json'));
}
/** Used by launch.ts for entrypoints that prefer ordinary bare ESM imports. */
export function registerSharedDependencies(): void {
  const parentURL = pathToFileURL(resolve(dependencyFolder(), 'entry.mjs')).href;
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (!isBuiltin(specifier) && !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('#') && !specifier.includes(':')) {
      return nextResolve(specifier, { ...context, parentURL });
    }
    return nextResolve(specifier, context);
  } });
}
