#!/usr/bin/env node
import { main } from '../src/capture.ts';
try { const code = await main(['run', ...process.argv.slice(2)]); if (typeof code === 'number') process.exitCode = code; } catch (error) { console.error('error: ' + (error as Error).message); process.exitCode = 2; }
