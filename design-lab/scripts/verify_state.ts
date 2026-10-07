#!/usr/bin/env node
import { main } from './evaluation.ts';
try { process.exitCode = await main(['verify-state', ...process.argv.slice(2)]); } catch (error) { console.error('error: ' + (error as Error).message); process.exitCode = 2; }
