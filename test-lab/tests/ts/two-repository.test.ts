// Two-repository identity (scope item 4): the suite checkout and the application worktree are separate,
// and the check of which worktree the local site serves compares DDEV's own application root, never the
// suite checkout and never the adapter's working folder. A stand-in `ddev` on PATH plays DDEV.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { commandAdapter } from '../../src/local-adapter.ts';

const ADAPTER = join(import.meta.dirname, '../../adapters/ddev.ts');
let dir = '';
let app = '';
let suite = '';
let other = '';
let log = '';
const savedPath = process.env['PATH'];

function fakeDdev(approot: string, status: string): void {
  const script = join(dir, 'bin/ddev');
  writeFileSync(script, [
    '#!/usr/bin/env node',
    "const { appendFileSync } = require('node:fs');",
    `appendFileSync(${JSON.stringify(log)}, process.cwd() + ' ' + process.argv.slice(2).join(' ') + '\\n');`,
    "const args = process.argv.slice(2);",
    `if (args[0] === 'describe') { console.log(JSON.stringify({ level: 'info', msg: 'describing' })); console.log(JSON.stringify({ level: 'info', raw: { approot: ${JSON.stringify(approot)}, status: ${JSON.stringify(status)} } })); process.exit(0); }`,
    "if (args[0] === 'drush' && args[1] === 'config:status') { console.log('[]'); process.exit(0); }",
    "if (args[0] === 'drush' && args[1] === 'php:eval') { console.log(JSON.stringify({ exists: true, published: args[2].includes(\"'/unpublished'\") ? false : true })); process.exit(0); }",
    'process.exit(3);',
  ].join('\n'));
  chmodSync(script, 0o755);
  writeFileSync(log, '');
}

before(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'test-lab-two-repo-')));
  app = join(dir, 'app');
  suite = join(dir, 'qa-suite');
  other = join(dir, 'other-worktree');
  log = join(dir, 'ddev.log');
  for (const d of [app, suite, other, join(dir, 'bin')]) mkdirSync(d);
  process.env['PATH'] = `${join(dir, 'bin')}:${savedPath ?? ''}`;
});
after(() => { process.env['PATH'] = savedPath; rmSync(dir, { recursive: true, force: true }); });

test('identity is DDEV\'s real application root, observed from the application worktree', async () => {
  fakeDdev(app, 'running');
  const a = commandAdapter(ADAPTER, app);
  assert.equal((await a.identity()).appRoot, app);
  assert.match(readFileSync(log, 'utf8'), new RegExp(`^${app} describe -j$`, 'm'), 'DDEV is asked from the application worktree');
});

test('a site serving another worktree is reported as that worktree, never as the one asked about', async () => {
  fakeDdev(other, 'running');
  assert.equal((await commandAdapter(ADAPTER, app).identity()).appRoot, other);
});

test('a site rooted at the suite checkout is reported as the suite checkout, so the caller refuses it', async () => {
  fakeDdev(suite, 'running');
  const served = (await commandAdapter(ADAPTER, app).identity()).appRoot;
  assert.equal(served, suite);
  assert.notEqual(served, app);
});

test('DDEV must be running before any Drush command', async () => {
  fakeDdev(app, 'stopped');
  const a = commandAdapter(ADAPTER, app);
  await assert.rejects(a.identity(), /stopped; start it and wait until it is ready/);
  await assert.rejects(a.fixture({ id: 'home', environments: ['local'], path: '/', title: 'Home', structure: null }), /stopped/);
  assert.doesNotMatch(readFileSync(log, 'utf8'), /drush/);
});

test('fixtures: validated paths only, observed through Drush on the served site', async () => {
  fakeDdev(app, 'running');
  const a = commandAdapter(ADAPTER, app);
  assert.deepEqual((await a.fixture({ id: 'home', environments: ['local'], path: '/', title: 'Home', structure: null })).observation, { via: 'local', exists: true, published: true });
  assert.deepEqual((await a.fixture({ id: 'u', environments: ['local'], path: '/unpublished', title: 'U', structure: null })).observation, { via: 'local', exists: true, published: false });
  await assert.rejects(a.fixture({ id: 'x', environments: ['local'], path: "/'; system('id'); '", title: 'x', structure: null }), /fixture path must be/);
  assert.deepEqual(await a.configuration!(), { status: '[]', lastImportAt: null });
});

test('mutations come from the application worktree\'s own module, never from the plugin', async () => {
  fakeDdev(app, 'running');
  const a = commandAdapter(ADAPTER, app);
  await assert.rejects(a.mutate!({ technique: 'adapter' }), /mutations\.ts/);
  mkdirSync(join(app, '.test-lab'), { recursive: true });
  writeFileSync(join(app, '.test-lab/mutations.ts'), `import { writeFileSync } from 'node:fs';\nexport async function mutate(r) { writeFileSync('mutated.txt', JSON.stringify(r)); }\nexport async function restore() { writeFileSync('mutated.txt', ''); }\n`);
  await a.mutate!({ technique: 'adapter', mutation: { logo: '/elsewhere' } });
  assert.match(readFileSync(join(app, 'mutated.txt'), 'utf8'), /elsewhere/);
  await a.restore!({ technique: 'adapter' });
  assert.equal(readFileSync(join(app, 'mutated.txt'), 'utf8'), '');
});
