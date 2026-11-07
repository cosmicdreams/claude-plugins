// The distribution path: the directory the repository's marketplace entry selects for test-lab, taken as
// Git would ship it (tracked, or untracked and not ignored), copied to a physically separate folder with
// no link back, no checkout above it, no npm cache and no network, and run there. A marketplace install
// is a Git copy of exactly those files, so this is the installed plugin, short of publishing it.
// It carries no node_modules: before its install step it refuses to run and names that step. The step
// itself (npm ci in the copy's kit folder) is proven by tests/install, `npm run test:install`.
// The tracked release must also be the build of the current sources: a source change without a rebuild
// fails here, and so does any node_modules in a release tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmp } from './support.ts';
import { writeRequest } from './mod-request.ts';
import { buildRelease, nodeModulesIn, releaseFiles, RELEASE_MANIFEST, releaseProblem, sourceDriftProblem } from '../../scripts/build-release.ts';

import { REPO, gitShipped, hookImports, links, selected, shipCopy, shipIndexCopy } from './shipped.ts';

test('the marketplace\'s test-lab entry selects a release with no node_modules, which in an isolated copy names its install step and refuses to run', () => {
  const dir = selected();
  const files = gitShipped(dir);
  assert.equal(files.some((f) => /(^|\/)node_modules(\/|$)/.test(f)), false, 'the selected directory ships node_modules');
  const isolated = realpathSync(tmp('test-lab-shipped-isolated-'));
  const data = realpathSync(tmp('test-lab-shipped-data-'));
  const cache = realpathSync(tmp('test-lab-shipped-empty-cache-'));
  try {
    const plugin = join(isolated, 'plugin');
    shipIndexCopy(dir, files, plugin);
    assert.deepEqual(links(plugin), []);
    assert.deepEqual(nodeModulesIn(plugin), []);
    // No dependency reachable from outside the copy, no cache, no network: only what Git ships.
    const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], HOME: isolated, TEST_LAB_DATA: data, npm_config_cache: cache, npm_config_offline: 'true' };
    const node = (args: string[]) => spawnSync(process.execPath, args, { encoding: 'utf8', cwd: isolated, env, timeout: 60_000 });
    const probe = node([join(plugin, 'src/mod-entry.ts'), '--data-dir']);
    assert.equal(probe.status, 0, probe.stderr);
    const step = `node ${join(plugin, 'scripts', 'install-runtime.ts')}`;
    assert.equal(JSON.parse(probe.stdout).runtime.problem, `test-lab's runtime parser is not installed in this plugin copy (${plugin}). Install it once with: ${step} (npm ci in the copy's kit folder). Nothing was installed.`);
    // It is a release, and every file it holds is one Git carries: nothing the build made is ignored.
    assert.equal(releaseProblem(plugin), null);
    const manifest = JSON.parse(readFileSync(join(plugin, RELEASE_MANIFEST), 'utf8')) as { schema: number; files: { path: string }[]; parser: { version: string; path: string } };
    assert.equal(manifest.schema, 2);
    assert.deepEqual(files, [...manifest.files.map((f) => f.path), RELEASE_MANIFEST].sort());
    assert.deepEqual([manifest.parser.version, manifest.parser.path], ['6.0.3', 'kit/node_modules/typescript']);
    assert.ok(files.includes('scripts/install-runtime.ts') && files.includes('kit/package-lock.json'), 'the release lacks its install step or the lockfile it installs from');
    // The runner refuses a request before anything runs, and names the same step.
    const op = join(data, 'mod', 'sessions', 'session-a', 'op-shipped');
    mkdirSync(op, { recursive: true });
    const cli = ['verify', '--app-root', '/a', '--suite-root', '/b', '--env', 'local'];
    writeRequest(op, cli, 60_000);
    assert.equal(node([join(plugin, 'src/mod-entry.ts'), '--operation-dir', op, '--deadline-ms', '60000', '--', ...cli]).status, 4);
    assert.match(JSON.parse(readFileSync(join(op, 'status.json'), 'utf8')).error, /not installed in this plugin copy.*install-runtime\.ts.*Nothing was installed\.$/);
    // The refusals installed nothing.
    assert.deepEqual(nodeModulesIn(plugin), []);
    const validation = spawnSync('claude', ['plugin', 'validate', plugin], { encoding: 'utf8', cwd: isolated, env, timeout: 60_000 });
    assert.equal(validation.status, 0, `${validation.stdout}\n${validation.stderr}`);
    // The mod's relative imports land inside the copy.
    const imports = hookImports(plugin);
    assert.ok(imports.length > 0);
    for (const { from, target } of imports) assert.ok(target.startsWith(`${plugin}/`) && existsSync(target), `${relative(plugin, from)} imports ${target}, which the copy does not hold`);
  } finally {
    for (const d of [isolated, data, cache]) rmSync(d, { recursive: true, force: true });
  }
});

test('the plugin source folder is not what the marketplace ships: its Git-shipped files carry no parser', () => {
  const source = resolve(REPO, 'test-lab');
  assert.notEqual(selected(), source);
  assert.equal(gitShipped(source).some((f) => f.startsWith('node_modules/')), false);
});


test('the actual marketplace release matches every current source and locked parser input', () => {
  assert.equal(sourceDriftProblem(selected()), null);
});


test('the release gate fails when a release tree holds any node_modules, shipped or listed', () => {
  const dir = tmp('test-lab-release-modules-');
  try {
    const built = join(dir, 'release');
    buildRelease(built);
    assert.deepEqual(nodeModulesIn(built), []);
    assert.equal(releaseProblem(built), null);
    for (const where of ['node_modules/typescript', 'kit/node_modules/typescript', 'src/node_modules/x']) {
      mkdirSync(join(built, where), { recursive: true });
      writeFileSync(join(built, where, 'package.json'), '{}');
      assert.match(String(releaseProblem(built)), /holds .*node_modules.*never committed or shipped/, where);
      assert.match(String(sourceDriftProblem(built)), /node_modules/, where);
      // Only an installed copy's own kit parser is tolerated, and only when asked for.
      if (where === 'kit/node_modules/typescript') assert.equal(releaseProblem(built, { installed: true }), null);
      rmSync(join(built, where.slice(0, where.indexOf('node_modules') + 'node_modules'.length)), { recursive: true, force: true });
    }
    assert.equal(releaseProblem(built), null);
    const manifestPath = join(built, RELEASE_MANIFEST);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files: { path: string; sha256: string; mode: string }[] };
    manifest.files.push({ path: 'node_modules/typescript/package.json', sha256: '0'.repeat(64), mode: '644' });
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.match(String(releaseProblem(built)), /lists node_modules files/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a changed, added, removed or executable source without regeneration fails the release drift gate', () => {
  const dir = tmp('test-lab-drift-');
  try {
    const root = join(dir, 'source');
    const built = join(dir, 'release');
    const manifest = buildRelease(built);
    shipCopy(resolve(REPO, 'test-lab'), releaseFiles(), root);
    execFileSync('git', ['init', '-b', 'fixture-release-drift'], { cwd: root, stdio: 'ignore' });
    assert.equal(sourceDriftProblem(built, root), null);
    const file = join(root, 'kit/records.ts');
    const original = readFileSync(file);
    writeFileSync(file, '// changed without a rebuild\n');
    assert.match(sourceDriftProblem(built, root)!, /source drifted/);
    writeFileSync(file, original);
    chmodSync(file, 0o755);
    assert.match(sourceDriftProblem(built, root)!, /source drifted/);
    chmodSync(file, 0o644);
    writeFileSync(join(root, 'src/new-runtime.ts'), '// newly shipped\n');
    assert.match(sourceDriftProblem(built, root)!, /file list drifted/);
    rmSync(join(root, 'src/new-runtime.ts'));
    rmSync(file);
    assert.match(sourceDriftProblem(built, root)!, /file list drifted/);
    writeFileSync(file, original);
    assert.equal(sourceDriftProblem(built, root), null);
    assert.equal(JSON.parse(readFileSync(join(built, RELEASE_MANIFEST), 'utf8')).digest, manifest.digest);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
