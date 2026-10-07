#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as setup from '../src/lab-setup.ts';
import { runsFolder } from '../src/lab-config.ts';
const [command, ...args] = process.argv.slice(2);
try {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { json: { type: 'boolean' }, create: { type: 'boolean' }, imported: { type: 'boolean' }, from: { type: 'string', default: process.cwd() }, 'allow-reads': { type: 'boolean' }, 'allow-folders': { type: 'boolean' } } });
  let result: unknown;
  if (command === 'check') { const checks = setup.checks(); result = { config: (await import('../src/lab-config.ts')).configPath(), ready: !checks.some(c => c.status === 'missing'), checks }; process.exitCode = checks.some(c => c.status === 'missing') ? 1 : 0; if (!values.json) { console.log(checks.map(c => `${c.status}: ${c.label}: ${c.detail}${c.fix ? `\n  ${c.fix}` : ''}`).join('\n')); result = undefined; } }
  else if (command === 'set') result = setup.setValue(positionals[0] ?? '', positionals.slice(1));
  else if (command === 'install') { if (!['dependencies', 'playwright'].includes(positionals[0] ?? '')) throw new Error('install dependencies|playwright'); result = setup.installDependencies(positionals[0] === 'playwright'); }
  else if (command === 'runner') result = await setup.runner(!!values.imported);
  else if (command === 'runs-folder') { console.log(values.create ? setup.createRunsFolder(values.from) : runsFolder(values.from)); result = undefined; }
  else if (command === 'claude-settings') { if (!!values['allow-reads'] === !!values['allow-folders']) throw new Error('choose --allow-folders or --allow-reads'); result = values['allow-reads'] ? setup.allowReads() : setup.allowFolders(positionals); }
  else throw new Error('usage: lab_setup.ts check|runs-folder|set|install|runner|claude-settings');
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(`error: ${(error as Error).message}`); process.exitCode = 2; }
