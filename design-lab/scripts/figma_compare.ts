#!/usr/bin/env node
import { failureCode } from '../src/exit-code.ts';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { compare } from '../src/figma-compare.ts';
import { writeJson } from '../src/contracts.ts';
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' }, corrected: { type: 'boolean' } },
  });
  if (positionals.length !== 2) throw new Error('usage: figma_compare.ts PNG GEOMETRY [--out FILE] [--corrected]');
  const result = await compare(positionals[0]!, JSON.parse(readFileSync(positionals[1]!, 'utf8')), !!values.corrected);
  if (values.out) writeJson(values.out, result);
  else console.log(JSON.stringify(result, null, 1));
  process.exitCode = result.pass ? 0 : 1;
} catch (error) {
  console.error(String(error));
  process.exitCode = failureCode(error);
}
