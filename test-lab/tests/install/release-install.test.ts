// The documented install step, for real: the release the marketplace entry selects, copied as Git ships
// it (no node_modules anywhere) to a physically separate folder, reaches a working state with
// `node scripts/install-runtime.ts`, which runs `npm ci` in the copy's own kit folder from its lockfile.
//
// This gate needs the locked parser tarball (typescript 6.0.3) in the local npm cache, because it runs
// npm offline: it never touches the network. If the cache lacks it, run `npm ci` once in this plugin's
// kit folder (which fetches and caches it), then run `npm run test:install` again. The precondition
// is checked first and reported as such, not as a product failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tmp } from '../ts/support.ts';
import { writeRequest } from '../ts/mod-request.ts';
import { gitShipped, links, selected, shipIndexCopy } from '../ts/shipped.ts';
import { nodeModulesIn, pinnedParser, releaseProblem } from '../../scripts/build-release.ts';

const CACHE = process.env['npm_config_cache'] ?? join(homedir(), '.npm');

/** Whether the npm cache holds the locked tarball by its integrity, so an offline npm ci can succeed. */
function cached(integrity: string): boolean {
  const hex = Buffer.from(integrity.slice('sha512-'.length), 'base64').toString('hex');
  const file = join(CACHE, '_cacache', 'content-v2', 'sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
  return existsSync(file) && `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}` === integrity;
}

/** Every path under `dir`, relative, for "nothing else was written" checks. */
const tree = (dir: string, base = dir): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  return e.isDirectory() ? [p.slice(base.length + 1) + '/', ...tree(p, base)] : [p.slice(base.length + 1)];
}).sort();

function freshCopy() {
  const isolated = realpathSync(tmp('test-lab-install-'));
  const plugin = join(isolated, 'plugin');
  const dir = selected();
  shipIndexCopy(dir, gitShipped(dir), plugin);
  return { isolated, plugin };
}

test('precondition: the locked parser tarball is in the local npm cache (run npm ci once in kit/ if not)', () => {
  assert.ok(cached(pinnedParser().integrity), `the npm cache at ${CACHE} lacks ${pinnedParser().integrity}; run npm ci once in test-lab/kit, then run npm run test:install again`);
});

test('a fresh copy of the marketplace release, with no node_modules, reaches a working state by its documented install step', () => {
  if (!cached(pinnedParser().integrity)) return assert.fail('precondition not met: see the precondition test');
  const { isolated, plugin } = freshCopy();
  const data = realpathSync(tmp('test-lab-install-data-'));
  try {
    assert.deepEqual(nodeModulesIn(plugin), []);
    assert.deepEqual(links(plugin), []);
    const before = tree(plugin);
    // Offline, with this machine's npm cache and nothing else: HOME is the scratch folder.
    const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], HOME: isolated, TEST_LAB_DATA: data, npm_config_cache: CACHE, npm_config_offline: 'true', npm_config_update_notifier: 'false' };
    const node = (args: string[]) => spawnSync(process.execPath, args, { encoding: 'utf8', cwd: isolated, env, timeout: 300_000 });
    assert.match(JSON.parse(node([join(plugin, 'src/mod-entry.ts'), '--data-dir']).stdout).runtime.problem, /not installed in this plugin copy/);
    // The documented step.
    const install = node([join(plugin, 'scripts/install-runtime.ts'), '--offline']);
    assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`);
    assert.equal(install.stdout, `test-lab runtime ready in ${plugin}\n`);
    // It wrote kit/node_modules (the parser, from the lockfile) and nothing else.
    assert.deepEqual(nodeModulesIn(plugin), ['kit/node_modules']);
    assert.deepEqual(tree(plugin).filter((p) => !p.startsWith('kit/node_modules/')), before);
    assert.equal(JSON.parse(readFileSync(join(plugin, 'kit/node_modules/typescript/package.json'), 'utf8')).version, '6.0.3');
    assert.equal(releaseProblem(plugin, { installed: true }), null);
    // Running it again is a no-op.
    assert.equal(node([join(plugin, 'scripts/install-runtime.ts'), '--offline']).status, 0);
    // Working state: the runner says the runtime is present, the CLI, coordinator and kit load from the
    // copy's own parser, and the runner hands a request to the CLI's parser.
    assert.deepEqual(JSON.parse(node([join(plugin, 'src/mod-entry.ts'), '--data-dir']).stdout).runtime, { ok: true });
    const loaded = node(['--input-type=module', '-e', "const {createRequire}=await import('node:module');const root=process.argv[1];await import(root+'/src/cli.ts');await import(root+'/src/coordinator.ts');await import(root+'/src/mod-entry.ts');const analysis=(await import(root+'/kit/source-analysis.ts')).ANALYSIS_VERSION;const where=createRequire(root+'/kit/package.json').resolve('typescript');process.stdout.write(JSON.stringify({analysis,where}));", plugin]);
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.ok(JSON.parse(loaded.stdout).where.startsWith(`${plugin}/kit/node_modules/`), loaded.stdout);
    const help = node([join(plugin, 'src/cli.ts'), '--help']);
    assert.match(`${help.stdout}${help.stderr}`, /stage-kit --suite-root PATH/);
    const op = join(data, 'mod', 'sessions', 'session-a', 'op-installed');
    mkdirSync(op, { recursive: true });
    const cli = ['verify', '--app-root', '/a', '--env', 'local'];
    writeRequest(op, cli, 60_000);
    assert.equal(node([join(plugin, 'src/mod-entry.ts'), '--operation-dir', op, '--deadline-ms', '60000', '--', ...cli]).status, 4);
    assert.equal(JSON.parse(readFileSync(join(op, 'status.json'), 'utf8')).error, '--suite-root is required');
  } finally {
    for (const d of [isolated, data]) rmSync(d, { recursive: true, force: true });
  }
});

test('without the tarball the install step fails clearly, offline, and the copy still refuses to run', () => {
  const { isolated, plugin } = freshCopy();
  const empty = realpathSync(tmp('test-lab-install-empty-cache-'));
  try {
    const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], HOME: isolated, npm_config_cache: empty, npm_config_offline: 'true', npm_config_update_notifier: 'false' };
    const install = spawnSync(process.execPath, [join(plugin, 'scripts/install-runtime.ts'), '--offline'], { encoding: 'utf8', cwd: isolated, env, timeout: 300_000 });
    assert.equal(install.status, 1, install.stdout);
    assert.match(install.stderr, new RegExp(`^npm ci in ${join(plugin, 'kit').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} failed: npm error`));
    assert.equal(existsSync(join(plugin, 'kit/node_modules/typescript/package.json')), false);
    const probe = spawnSync(process.execPath, [join(plugin, 'src/mod-entry.ts'), '--data-dir'], { encoding: 'utf8', cwd: isolated, env: { ...env, TEST_LAB_DATA: join(isolated, 'data') } });
    assert.match(JSON.parse(probe.stdout).runtime.problem, /not installed in this plugin copy.*install-runtime\.ts/);
  } finally {
    for (const d of [isolated, empty]) rmSync(d, { recursive: true, force: true });
  }
});
