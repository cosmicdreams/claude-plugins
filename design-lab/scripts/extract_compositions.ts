#!/usr/bin/env node
import { main } from '../src/extract-compositions.ts';
try { const code = await main(); if (typeof code === 'number') process.exitCode = code; } catch (error) { console.error('error: ' + (error as Error).message); process.exitCode = 2; }
