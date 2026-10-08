#!/usr/bin/env node
import { failureCode } from '../src/exit-code.ts';
import { main } from './evaluation.ts';
try {
  process.exitCode = await main(['tier1', ...process.argv.slice(2)]);
} catch (error) {
  console.error('error: ' + (error as Error).message);
  process.exitCode = failureCode(error);
}
