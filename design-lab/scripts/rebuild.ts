#!/usr/bin/env node
/** Rebuild operations are also exposed by workflow figma-build, await-build and finish. */
import { failureCode } from '../src/exit-code.ts';
import { main } from './workflow.ts';
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(String(error));
  process.exitCode = failureCode(error);
}
