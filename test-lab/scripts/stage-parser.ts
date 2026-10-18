// Stages the parser the kit resolves (kit/package.json's typescript): the copy's own
// kit/node_modules after scripts/install-runtime.ts, or a development checkout's root node_modules.
// That compiler package may be the TypeScript 6 compatibility wrapper; stage the actual parser
// distribution, not a wrapper that would need an undeclared parent dependency.
import { cpSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PARSER_VERSION } from '../kit/source-analysis.ts';

export function stageParser(destination: string): void {
  let manifest = createRequire(join(import.meta.dirname, '..', 'kit', 'package.json')).resolve('typescript/package.json');
  let pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name: string; version: string };
  if (pkg.name === '@typescript/typescript6') {
    manifest = createRequire(manifest).resolve('@typescript/old/package.json');
    pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name: string; version: string };
  }
  if (pkg.name !== 'typescript' || pkg.version !== PARSER_VERSION) throw new Error(`cannot stage kit parser: expected typescript ${PARSER_VERSION}, found ${pkg.name} ${pkg.version}`);
  cpSync(dirname(manifest), destination, { recursive: true });
}
