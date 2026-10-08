/** Explicit saved-run inputs; no fallback to a developer's home folders. */
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export function savedRun(name: string): string {
  const manifest = process.env['DESIGN_LAB_SAVED_RUNS'];
  if (!manifest?.trim() || !isAbsolute(manifest))
    throw new Error('DESIGN_LAB_SAVED_RUNS must name an absolute JSON file mapping saved-run names to paths.');
  const runs = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
  const path = runs[name];
  if (typeof path !== 'string' || !isAbsolute(path))
    throw new Error(`DESIGN_LAB_SAVED_RUNS must supply an absolute path for ${name}.`);
  return path;
}
