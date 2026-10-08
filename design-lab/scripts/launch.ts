#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pluginRoot, registerSharedDependencies } from '../src/runtime.ts';
const entry = process.argv[2];
if (!entry) throw new Error('usage: node scripts/launch.ts <plugin-relative entry.ts> [args...]');
const path = resolve(pluginRoot, entry);
process.argv = [process.argv[0]!, path, ...process.argv.slice(3)];
registerSharedDependencies();
await import(pathToFileURL(path).href);
