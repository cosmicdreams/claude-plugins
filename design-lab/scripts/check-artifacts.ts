#!/usr/bin/env node
import { resolve } from 'node:path';
import { scanArtifacts, defaultRoots } from '../src/artifact-scan.ts';
const args = process.argv.slice(2);
const json = args.includes('--json');
const roots = args.filter((arg) => arg !== '--json').map((p) => resolve(p));
const results = scanArtifacts(roots.length ? roots : defaultRoots);
if (json) console.log(JSON.stringify(results, null, 2));
else {
  for (const result of results)
    console.log(
      `${result.errors.length ? 'FAIL' : 'PASS'} ${result.kind} ${result.root}/${result.file}${result.errors.length ? '\n  ' + result.errors.join('\n  ') : ''}`,
    );
  console.log(`${results.length - results.filter((r) => r.errors.length).length}/${results.length} files passed`);
}
process.exitCode = results.some((r) => r.errors.length) ? 1 : 0;
