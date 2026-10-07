#!/usr/bin/env node
import { isEntrypoint } from './entrypoint.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runCapture } from './capture/run.ts';
import type { CaptureProgress } from './capture/run.ts';
import { roundEven } from './json.ts';
import type { CaptureConfig } from './capture/types.ts';
export { runCapture } from './capture/run.ts';
export function progressLine({ record, completed, total, remainingSeconds }: CaptureProgress): string {
  return `[${completed}/${total}] ${record.componentId}: ${record.status} in ${record.seconds.toFixed(1)}s`
    + (record.revealed ? ' (revealed)' : '') + ` — about ${roundEven(remainingSeconds / 60)} min left`
    + (record.status === 'complete' ? '' : ` (${record.problems[0] ?? 'capture failed'})`);
}
export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args[0] !== 'run') throw new Error('usage: capture.ts run --project RUN --canonical-base-url URL [--configs DIR] [--site-url URL] [--theme-root DIR] [--concurrency 4] [--scale 1] [--only id,id] [--fresh] [--check] [--no-check]');
  const value = (flag: string, fallback?: string): string | undefined => {
    const index = args.indexOf(flag); if (index < 0) return fallback;
    const result = args[index + 1]; if (!result || result.startsWith('--')) throw new Error(`missing value for ${flag}`); return result;
  };
  const required = (flag: string): string => { const result = value(flag); if (!result) throw new Error(`missing ${flag}`); return result; };
  const dir = value('--configs');
  const configs = dir ? readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(file => JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as CaptureConfig) : undefined;
  const result = await runCapture({ project: required('--project'), canonicalBaseUrl: required('--canonical-base-url'), siteUrl: value('--site-url'), themeRoot: value('--theme-root'), configs,
    concurrency: Number(value('--concurrency', '4')), scale: Number(value('--scale', '1')), only: value('--only')?.split(','), fresh: args.includes('--fresh'), check: args.includes('--check'), noCheck: args.includes('--no-check'), maxPages: Number(value('--max-pages', '3')),
    onComplete: progress => console.log(progressLine(progress)) });
  console.log(JSON.stringify({ captures: Object.keys(result.captures).length, problems: result.problems }, null, 2));
  return result.problems.length ? 1 : 0;
}
if (isEntrypoint(import.meta.url)) process.exitCode = await main();
