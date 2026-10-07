import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Node canonicalizes module URLs; canonicalize argv too, including symlinked parents. */
export function isEntrypoint(moduleUrl: string, script = process.argv[1]): boolean {
  if (!script) return false;
  try { return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(script)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
