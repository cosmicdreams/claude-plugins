#!/usr/bin/env node
import { failureCode } from '../src/exit-code.ts';
import { main } from '../src/extract-compositions.ts';
try { const code = await main(); if (typeof code === 'number') process.exitCode = code; } catch (error) { console.error('error: ' + (error as Error).message); process.exitCode = failureCode(error); }
