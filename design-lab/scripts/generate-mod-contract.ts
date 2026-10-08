#!/usr/bin/env node
/** The engine requires a self-contained manifest contract. Derive it from protocol.ts. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pluginRoot } from '../src/runtime.ts';
import { isEntrypoint } from '../src/entrypoint.ts';
import { PROGRESS_STATES, STEP_KINDS } from '../src/protocol.ts';
const stateContract =
  "declare module 'claude-code' {\n  interface PluginState {\n    'design-lab': {\n      run: string | null\n      summary: Summary | null\n      alarmed: boolean\n      follow: string | null\n      skip: string | null\n      // the run whose full completion message is shown under its figures, or null when folded\n      recapOpen: string | null\n    }\n  }\n}\n";
export function modContract(): string {
  const source = readFileSync(resolve(pluginRoot, 'src/protocol.ts'), 'utf8');
  const begin = '// DESIGN_LAB_MOD_CONTRACT_BEGIN\n',
    end = '// DESIGN_LAB_MOD_CONTRACT_END';
  const from = source.indexOf(begin),
    to = source.indexOf(end);
  if (from < 0 || to < from) throw new Error('missing mod contract boundaries');
  const declarations = source.slice(from + begin.length, to).replace('type ModSummary =', 'export type Summary =');
  const union = (values: string[]) => values.map((value) => JSON.stringify(value)).join(' | ');
  return (
    '// Generated from src/protocol.ts by scripts/generate-mod-contract.ts. Do not edit.\n' +
    `export type ProgressState = ${union(Object.values(PROGRESS_STATES))};\n` +
    `export type StepKind = ${union(Object.values(STEP_KINDS))};\n\n` +
    declarations +
    stateContract
  );
}
export function main(args = process.argv.slice(2)): number {
  const path = resolve(pluginRoot, 'types/index.d.ts'),
    expected = modContract();
  if (args.includes('--check')) {
    if (readFileSync(path, 'utf8') !== expected)
      throw new Error('mod contract drift: run node scripts/generate-mod-contract.ts');
  } else writeFileSync(path, expected);
  return 0;
}
if (isEntrypoint(import.meta.url)) process.exitCode = main();
