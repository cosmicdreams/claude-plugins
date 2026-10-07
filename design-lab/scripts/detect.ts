#!/usr/bin/env node
/** Standalone detection: prints the same detection document the workflow's detect step writes. */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertValid } from '../src/contracts.ts';
import { detect } from '../src/detect.ts';

export function main(argv = process.argv.slice(2)): number {
  const [repository, ...extra] = argv;
  if (!repository || extra.length) { console.error('usage: detect.ts <repository>'); return 2; }
  const document = detect(resolve(repository));
  assertValid('detection', document);
  console.log(JSON.stringify(document, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) try { process.exitCode = main(); } catch (error) { console.error(`error: ${(error as Error).message}`); process.exitCode = 2; }
