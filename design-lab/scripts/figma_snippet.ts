#!/usr/bin/env node
/** Print one read-only Figma dump as plain JavaScript, ready to pass to use_figma as its code. */
import { parseArgs } from 'node:util';
import { failureCode } from '../src/exit-code.ts';
import { snippet } from '../src/figma-runner.ts';
const NAMES: Record<string, string> = { figma_dump_root: '', figma_dump_page: 'PAGE_ID', figma_dump_getting_started: 'PAGE_ID', figma_dump_tree: '__PAGE_ID__' };
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'page-id': { type: 'string' } } });
  const name = positionals[0], placeholder = name === undefined ? undefined : NAMES[name];
  if (positionals.length !== 1 || name === undefined || placeholder === undefined) throw new Error(`usage: figma_snippet.ts ${Object.keys(NAMES).join('|')} [--page-id ID]`);
  if (values['page-id'] !== undefined && !placeholder) throw new Error(`${name} takes no page id`);
  const code = snippet(name);
  process.stdout.write(values['page-id'] !== undefined ? code.split(placeholder).join(values['page-id']) : code);
} catch (error) { console.error('error: ' + (error as Error).message); process.exitCode = failureCode(error); }
