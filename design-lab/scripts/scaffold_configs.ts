#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scaffold } from '../src/capture/scaffold.ts';
import { writeJson } from '../src/contracts.ts';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string', default: 'capture/configs' }, 'site-url': { type: 'string' }, 'canonical-base-url': { type: 'string' }, 'theme-root': { type: 'string' }, force: { type: 'boolean' } } });
  if (positionals.length !== 1 || !values['canonical-base-url']) throw new Error('usage: scaffold_configs.ts COMPONENTS --canonical-base-url URL [--site-url URL] [--theme-root DIR] [--out DIR] [--force]');
  const configs = scaffold(JSON.parse(readFileSync(positionals[0]!, 'utf8')), { siteUrl: values['site-url'], canonicalBaseUrl: values['canonical-base-url'], themeRoot: values['theme-root'] }); let written = 0, skipped = 0;
  for (const config of configs) { const path = resolve(values.out, `${config.machineName}.json`); if (existsSync(path) && !values.force) { skipped++; continue; } writeJson(path, config); written++; }
  console.log(`wrote ${written} config(s), skipped ${skipped} that already existed`);
} catch (error) { console.error(String(error)); process.exitCode = 2; }
