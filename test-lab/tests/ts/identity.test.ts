// Build identity over a real Git checkout (plan §2): a content manifest before and after the run, so two
// uncommitted states at one commit differ, an edit during the run is caught, and test-lab's own outputs
// never change the build a verdict names. Every other identity part is checked, not-checked or declared,
// and never shown as passed when it was not performed.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { compareManifests, contentManifest, evaluateIdentity, type IdentityState } from '../../src/identity.ts';
import { tmp } from './support.ts';

function repo(): string {
  const root = tmp('test-lab-identity-');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), 'vendor/\n');
  mkdirSync(join(root, 'web/themes/custom/x/css'), { recursive: true });
  writeFileSync(join(root, 'web/themes/custom/x/css/site.css'), 'h1 { color: black; }\n');
  writeFileSync(join(root, 'module.php'), '<?php return 1;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'test: fixture base');
  return root;
}

const local = (overrides: Partial<IdentityState>): IdentityState => ({
  environment: { id: 'local', kind: 'local-candidate', baseUrl: 'https://site.ddev.site', baseUrlEnv: 'BASE_URL' },
  appRoot: '/app',
  before: null,
  after: null,
  ddevDescribe: null,
  drushConfigStatus: null,
  knownConfigOverrides: [],
  effectiveBaseUrls: [],
  database: { source: null, pulledAt: null },
  buildProbe: null,
  ...overrides,
});

describe('the content manifest', () => {
  test('two different uncommitted states at one commit have different manifests', async () => {
    const root = repo();
    writeFileSync(join(root, 'module.php'), '<?php return 2;\n');
    const a = await contentManifest(root);
    writeFileSync(join(root, 'module.php'), '<?php return 3;\n');
    const b = await contentManifest(root);
    assert.equal(a.commit, b.commit);
    assert.notEqual(a.digest, b.digest);
  });

  test('an untracked file is part of the build; an ignored one is not', async () => {
    const root = repo();
    const a = await contentManifest(root);
    mkdirSync(join(root, 'vendor'), { recursive: true });
    writeFileSync(join(root, 'vendor/lib.php'), 'x');
    assert.equal(a.digest, (await contentManifest(root)).digest);
    writeFileSync(join(root, 'new.php'), 'x');
    assert.notEqual(a.digest, (await contentManifest(root)).digest);
  });

  test('a file edited during the run makes the before and after manifests differ', async () => {
    const root = repo();
    const before = await contentManifest(root);
    writeFileSync(join(root, 'web/themes/custom/x/css/site.css'), 'h1 { color: red; }\n');
    const after = await contentManifest(root);
    const diffs = compareManifests(before, after);
    assert.deepEqual(diffs.map((d) => d.path), ['web/themes/custom/x/css/site.css']);
    const r = evaluateIdentity(local({ appRoot: root, before, after }));
    assert.ok(r.unknown.some((u) => /changed during the run/.test(u)));
  });

  test('writing test-lab outputs, results and reports never changes the build', async () => {
    const root = repo();
    const before = await contentManifest(root);
    mkdirSync(join(root, '.test-lab/runs/r1'), { recursive: true });
    writeFileSync(join(root, '.test-lab/runs/r1/verdict.json'), '{}');
    writeFileSync(join(root, '.test-lab/evidence.json'), '{}');
    mkdirSync(join(root, 'tests/e2e/test-results'), { recursive: true });
    writeFileSync(join(root, 'tests/e2e/test-results/trace.zip'), 'z');
    mkdirSync(join(root, 'tests/e2e/playwright-report'), { recursive: true });
    writeFileSync(join(root, 'tests/e2e/playwright-report/index.html'), 'h');
    assert.deepEqual(compareManifests(before, await contentManifest(root)), []);
  });

  test('a declared generated-asset folder is hashed even when Git ignores it', async () => {
    const root = repo();
    writeFileSync(join(root, '.gitignore'), 'vendor/\nweb/sites/default/files/\n');
    mkdirSync(join(root, 'web/sites/default/files/css'), { recursive: true });
    writeFileSync(join(root, 'web/sites/default/files/css/generated.css'), 'a{}');
    const a = await contentManifest(root, { assetDirs: ['web/sites/default/files/css'] });
    writeFileSync(join(root, 'web/sites/default/files/css/generated.css'), 'a{color:red}');
    const b = await contentManifest(root, { assetDirs: ['web/sites/default/files/css'] });
    assert.notEqual(a.digest, b.digest);
    const missing = await contentManifest(root, { assetDirs: ['web/nowhere'] });
    assert.deepEqual(missing.missingAssetDirs, ['web/nowhere']);
  });
});

describe('every identity part is checked, not checked, or declared', () => {
  test('the site must serve this worktree, as DDEV reports it', async () => {
    const root = repo();
    const m = await contentManifest(root);
    const other = evaluateIdentity(local({ appRoot: root, before: m, after: m, ddevDescribe: JSON.stringify({ raw: { approot: '/Users/x/other-worktree' } }) }));
    assert.equal(other.checks.find((c) => c.name === 'root')?.status, 'mismatch');
    assert.ok(other.unknown.length > 0);
    const same = evaluateIdentity(local({ appRoot: root, before: m, after: m, ddevDescribe: JSON.stringify({ raw: { approot: root } }) }));
    assert.equal(same.checks.find((c) => c.name === 'root')?.status, 'matched');
  });

  test('a root that was not checked is shown as not checked, never as matched', async () => {
    const root = repo();
    const m = await contentManifest(root);
    const r = evaluateIdentity(local({ appRoot: root, before: m, after: m }));
    assert.equal(r.checks.find((c) => c.name === 'root')?.status, 'not-checked');
    assert.equal(r.checks.find((c) => c.name === 'base-url')?.status, 'not-checked');
    assert.equal(r.checks.find((c) => c.name === 'database')?.status, 'declared');
  });

  test('the effective base URL is the one Playwright resolved, compared with the environment', () => {
    const r = evaluateIdentity(local({ effectiveBaseUrls: ['https://prod.example.org'] }));
    assert.equal(r.checks.find((c) => c.name === 'base-url')?.status, 'mismatch');
  });

  test('a deployed environment with no build probe is not evaluable; a supplied label is never proof', () => {
    const deployed = { id: 'dev', kind: 'deployed' as const, baseUrl: 'https://dev.example.org', baseUrlEnv: 'BASE_URL' };
    assert.ok(evaluateIdentity(local({ environment: deployed })).notEvaluable.length > 0);
    const wrong = evaluateIdentity(local({ environment: deployed, buildProbe: { before: 'v1', after: 'v1', intended: 'v2' } }));
    assert.ok(wrong.unknown.some((u) => /not serve the intended candidate/.test(u)));
    const moved = evaluateIdentity(local({ environment: deployed, buildProbe: { before: 'v1', after: 'v2', intended: 'v2' } }));
    assert.ok(moved.unknown.some((u) => /changed during the run/.test(u)));
  });
});
