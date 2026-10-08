import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { prepare, planApproved, siteUrls, waitForBuild } from '../../src/rebuild.ts';
import { writeJson } from '../../src/contracts.ts';
const write = (path: string, value: unknown) => writeJson(path, value);
function fixture(t: { after(fn: () => void): void }) {
  const root = realpathSync(mkdtempSync('/tmp/design-lab-p5-rebuild-')),
    source = resolve(root, 'source');
  mkdirSync(source);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(resolve(source, 'project.json'), {
    schemaVersion: 1,
    pluginVersion: '0.23.2',
    standardVersion: '4.1.0',
    createdAt: '2026-10-03T00:00:00+00:00',
    repository: { root, commit: null, dirty: false },
    target: { figmaFileKey: 'original' },
    decisions: {},
    phases: { plan: { status: 'approved', updatedAt: '2026-10-03T01:00:00+00:00' } },
    artifacts: {},
    run: { siteLabel: 'Fixture' },
  });
  for (const name of ['components', 'tokens', 'plan']) write(resolve(source, name + '.json'), {});
  write(resolve(source, 'capture-evidence.json'), { canonicalBaseUrl: 'https://public.test', captures: {} });
  mkdirSync(resolve(source, 'capture/measurements'), { recursive: true });
  write(resolve(source, 'figma/state.json'), {
    fileKey: 'original',
    siteUrl: 'https://local.test',
    canonicalBaseUrl: 'https://public.test',
  });
  return { root, source };
}
void test('rebuild rejects original target, unapproved plan, nested and occupied destinations before copy', (t) => {
  const { root, source } = fixture(t),
    workspace = resolve(root, 'new'),
    identity = { siteLabel: 'Fixture' };
  assert.throws(() => prepare(source, workspace, 'original', 'url', { identity }), /differ/);
  assert.equal(existsSync(workspace), false);
  const project = JSON.parse(readFileSync(resolve(source, 'project.json'), 'utf8'));
  project.phases.plan.status = 'pending';
  write(resolve(source, 'project.json'), project);
  assert.throws(() => prepare(source, workspace, 'scratch', 'url', { identity }), /approve/);
  project.phases.plan.status = 'approved';
  write(resolve(source, 'project.json'), project);
  assert.throws(() => prepare(source, resolve(source, 'nested'), 'scratch', 'url', { identity }), /outside/);
  mkdirSync(workspace);
  writeFileSync(resolve(workspace, 'keep'), 'owned');
  assert.throws(() => prepare(source, workspace, 'scratch', 'url', { identity }), /new or empty/);
  assert.equal(readFileSync(resolve(workspace, 'keep'), 'utf8'), 'owned');
});
void test('rebuild publishes a fresh manifest after copied inputs, retaining approved and completed history', (t) => {
  const { root, source } = fixture(t),
    workspace = resolve(root, 'new'),
    original = readFileSync(resolve(source, 'project.json'), 'utf8');
  prepare(source, workspace, 'scratch', 'url', {
    identity: { siteLabel: 'Fixture', startedAt: '2026-10-07T00:00:00+00:00' },
  });
  const project = JSON.parse(readFileSync(resolve(workspace, 'project.json'), 'utf8'));
  assert.equal(project.target.figmaFileKey, 'scratch');
  assert.equal(project.phases.plan.status, 'approved');
  assert.equal(project.phases.plan.from, source);
  assert.equal(project.phases.plan.updatedAt, undefined);
  assert.equal(project.phases.plan.sourceUpdatedAt, '2026-10-03T01:00:00+00:00');
  assert.equal(project.phases.components.status, 'pending');
  assert.equal(readFileSync(resolve(source, 'project.json'), 'utf8'), original);
  assert.equal(planApproved(source, { phases: { benchmark: { status: 'complete' } } }), true);
  writeFileSync(resolve(source, 'phase-log.jsonl'), '{broken\n{"phase":"plan","status":"approved"}\n');
  assert.equal(planApproved(source, { phases: { plan: { status: 'pending' } } }), true);
  assert.ok(existsSync(resolve(workspace, 'components.json')));
});
void test('rebuild refuses a workspace that reaches the source through a symlinked parent or link', (t) => {
  const { root, source } = fixture(t),
    identity = { siteLabel: 'Fixture' },
    alias = resolve(root, 'alias'),
    into = resolve(root, 'into');
  mkdirSync(resolve(source, 'inner'));
  symlinkSync(source, alias);
  symlinkSync(resolve(source, 'inner'), into);
  assert.throws(
    () => prepare(source, resolve(alias, 'copy'), 'scratch', 'url', { identity }),
    /copy destination must be outside the source run/,
  );
  assert.throws(
    () => prepare(source, into, 'scratch', 'url', { identity }),
    /copy destination must be outside the source run/,
  );
  assert.equal(existsSync(resolve(source, 'copy')), false);
});
void test('rebuild copies into a symlinked workspace that lies outside the source', (t) => {
  const { root, source } = fixture(t),
    target = resolve(root, 'elsewhere'),
    link = resolve(root, 'linked');
  mkdirSync(target);
  symlinkSync(target, link);
  prepare(source, link, 'scratch', 'url', { identity: { siteLabel: 'Fixture' } });
  assert.ok(existsSync(resolve(target, 'components.json')));
  assert.ok(existsSync(resolve(target, 'project.json')));
});
void test('rebuild treats a sibling whose name extends the source name as outside it', (t) => {
  const { root, source } = fixture(t),
    sibling = resolve(root, 'source-copy');
  prepare(source, sibling, 'scratch', 'url', { identity: { siteLabel: 'Fixture' } });
  assert.ok(existsSync(resolve(sibling, 'components.json')));
});
void test('rebuild uses saved capture URLs and reports missing reconstruction context', (t) => {
  const { source } = fixture(t);
  write(resolve(source, 'figma/state.json'), {});
  assert.deepEqual(siteUrls(source), ['https://public.test', 'https://public.test']);
  write(resolve(source, 'capture-evidence.json'), {});
  assert.throws(() => siteUrls(source), /missing saved/);
});
void test('build wait detects current failures, ignores historical and old-server evidence and recovers after progress', async (t) => {
  const { root } = fixture(t),
    workspace = resolve(root, 'run'),
    log = resolve(workspace, 'figma/runner.log');
  mkdirSync(resolve(workspace, 'figma'), { recursive: true });
  let tick = 0,
    calls = 0;
  const options = {
    now: () => tick,
    sleep: async () => {
      tick += 10;
    },
    status: () => ({ next: 'build:a' }),
    dumpStep: () => ({ step: 'build:a' }),
    pollMs: 10,
  };
  writeFileSync(log, '2026-10-01 FAILED old\n');
  write(resolve(workspace, 'figma/progress.json'), { state: 'failed', serverPid: 1, message: 'old latch' });
  writeFileSync(resolve(workspace, 'figma/runner.pid'), '2');
  await waitForBuild(workspace, 1, 0, {
    ...options,
    status: () => ({ next: ++calls > 1 ? null : 'build:a' }),
    dumpStep: () => null,
  });
  write(resolve(workspace, 'figma/progress.json'), { state: 'failed', serverPid: 2, message: 'current latch' });
  await assert.rejects(waitForBuild(workspace, 1, 0, options), /current latch/);
  write(resolve(workspace, 'figma/progress.json'), {});
  calls = 0;
  await waitForBuild(workspace, 1, 0, {
    ...options,
    status: () => ({ next: ++calls > 1 ? null : 'build:a' }),
    dumpStep: () => null,
    sleep: async () => {
      writeFileSync(log, '2026-10-01 FAILED old\n2026-10-07 FAILED current\n2026-10-07 recorded build:a\n');
      tick += 10;
    },
  });
});
