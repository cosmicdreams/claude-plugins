#!/usr/bin/env node
/**
 * Run a command with every artifact write validated (see check-writes.ts), then summarise.
 * Usage: node tests/support/run-write-check.ts [--log FILE] -- COMMAND [ARGS...]
 * Exits 1 when any artifact written during the command fails its schema, or the command itself fails.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pluginRoot } from '../../src/runtime.ts';

const args = process.argv.slice(2);
const split = args.indexOf('--');
if (split < 0 || split === args.length - 1) { console.error('usage: run-write-check.ts [--log FILE] -- COMMAND [ARGS...]'); process.exit(2); }
const option = args.indexOf('--log');
const log = option >= 0 && option < split ? resolve(args[option + 1]!) : resolve(tmpdir(), `design-lab-writes-${process.pid}.jsonl`);
rmSync(log, { force: true });
const preload = resolve(pluginRoot, 'tests/support/check-writes.ts');
const [command, ...rest] = args.slice(split + 1);
const result = spawnSync(command!, rest, { stdio: 'inherit', env: { ...process.env, DESIGN_LAB_WRITE_LOG: log, NODE_OPTIONS: `${process.env['NODE_OPTIONS'] ?? ''} --import=${preload}`.trim() } });

interface Entry { kind: string; path: string; errors: string[]; by: string[]; test: string | null }
const entries: Entry[] = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Entry) : [];
const kinds = new Map<string, { writes: number; bad: Map<string, { path: string; by: string; count: number }> }>();
for (const entry of entries) {
  const row = kinds.get(entry.kind) ?? { writes: 0, bad: new Map() };
  row.writes++;
  for (const error of entry.errors) { const key = error.replace(/\/\d+(?=\/|:)/g, '/#'); const seen = row.bad.get(key); if (seen) seen.count++; else row.bad.set(key, { path: entry.path, by: entry.by.join(' < ') + (entry.test ? ' @ ' + entry.test : ''), count: 1 }); }
  kinds.set(entry.kind, row);
}
console.log(`\nwrite check: ${entries.length} artifact writes across ${kinds.size} kinds`);
let failures = 0;
for (const [kind, row] of [...kinds].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`  ${kind}: ${row.writes} writes, ${row.bad.size} distinct errors`);
  for (const [error, seen] of row.bad) { failures++; console.log(`    ${error}  (x${seen.count}, by ${seen.by})`); }
}
console.log(`log: ${log}`);
process.exitCode = failures || result.status ? 1 : 0;
