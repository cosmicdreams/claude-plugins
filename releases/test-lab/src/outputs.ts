// What test-lab and Playwright write. Outputs are never inputs (plan §4): they are left out of every input
// manifest and every build-identity manifest, so saving results, evidence or an acceptance can never move
// a digest or change the build a verdict names.
//
// Case files and mutation recipes under .test-lab/ are inputs, but they enter only through the canonical
// hashes of the tests that use them, never as files.

import { matchesGlob } from './glob.ts';

export const OUTPUT_GLOBS = [
  '.test-lab/**',
  '**/.test-lab/**',
  'test-results/**',
  '**/test-results/**',
  'playwright-report/**',
  '**/playwright-report/**',
  'blob-report/**',
  '**/blob-report/**',
  '**/.auth/**',
  '**/.cache/**',
  '**/node_modules/**',
  '.git/**',
];

/** True when a repository-relative path is an output. `extra` adds the run root and similar folders. */
export function isOutput(path: string, extra: string[] = []): boolean {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return [...OUTPUT_GLOBS, ...extra].some((glob) => matchesGlob(p, glob));
}
