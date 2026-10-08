import type { Project } from '../../src/generated/project.ts';
import type { ChecklistDocument } from '../../src/protocol.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import * as config from '../../src/lab-config.ts';
import * as setup from '../../src/lab-setup.ts';
import * as workflow from '../../src/workflow.ts';
import { COMMANDS } from '../../scripts/workflow.ts';
import { pluginRoot } from '../../src/runtime.ts';
function sandbox(t: { after(fn: () => void): void }) {
  const root = realpathSync(mkdtempSync('/tmp/design-lab-p5-unit-')),
    old = { ...process.env };
  process.env['DESIGN_LAB_HOME'] = resolve(root, 'home');
  process.env['DESIGN_LAB_CONFIG'] = resolve(root, 'config.json');
  process.env['CLAUDE_CONFIG_DIR'] = resolve(root, 'account');
  t.after(() => {
    process.env = old;
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
const write = (path: string, value: unknown) => {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};
test('signed-in operator is account-specific, trimmed, and explicitly overridable', (t) => {
  const root = sandbox(t),
    account = process.env['CLAUDE_CONFIG_DIR']!;
  write(resolve(account, '.claude.json'), { oauthAccount: { fullName: ' Ada Lovelace ', displayName: 'Ada' } });
  assert.equal(config.claudeAccountName(), 'Ada Lovelace');
  assert.equal(workflow.runIdentity({}, root).operator, 'Ada Lovelace');
  assert.equal(workflow.runIdentity({ operator: 'Operator' }, root).operator, 'Operator');
  write(resolve(account, '.claude.json'), { oauthAccount: { displayName: 'Grace' } });
  assert.equal(config.claudeAccountName(), 'Grace');
  write(resolve(account, '.claude.json'), {});
  assert.equal(config.claudeAccountName(), null);
});
test('setup updates preserve unrelated personal settings and expand evaluation paths', (t) => {
  sandbox(t);
  config.writeConfig({ corpus: '/c', scoreboard: { ledger: '/l', dashboard: '/d' }, runner: { imported: true } });
  setup.setValue('runs', ['home']);
  setup.setValue('operator', [' A. Person ']);
  assert.deepEqual(config.readConfig(), {
    corpus: '/c',
    scoreboard: { ledger: '/l', dashboard: '/d' },
    runner: { imported: true },
    runs: { convention: 'home' },
    operator: 'A. Person',
  });
  assert.equal(config.loadConfig().corpus, '/c');
});
test('read-blocking settings change only on explicit request, preserving other keys', (t) => {
  const root = sandbox(t),
    dir = resolve(root, 'account'),
    path = resolve(dir, 'settings.json'),
    value = { permissions: { defaultMode: 'auto', [setup.READ_BLOCK]: true }, model: 'opus' };
  write(path, value);
  assert.deepEqual(setup.blockingSettings([dir]), [path]);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), value);
  assert.deepEqual(setup.allowReads([dir]), { changed: [path], restart: true });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { permissions: { defaultMode: 'auto' }, model: 'opus' });
});
test('allowing requested folders is idempotent and preserves symlink and read guard', (t) => {
  const root = sandbox(t),
    dir = resolve(root, 'account'),
    real = resolve(root, 'settings.json'),
    link = resolve(dir, 'settings.json'),
    plugin = resolve(root, 'plugin'),
    sites = resolve(root, 'Sites');
  mkdirSync(dir, { recursive: true });
  write(real, { permissions: { [setup.READ_BLOCK]: true } });
  symlinkSync(real, link);
  config.writeConfig({ runs: { convention: 'project' } });
  assert.equal((setup.allowFolders([sites], [dir], [plugin]) as any).restart, true);
  const value = JSON.parse(readFileSync(real, 'utf8'));
  assert.equal(value.permissions[setup.READ_BLOCK], true);
  assert.deepEqual(value.permissions.additionalDirectories, [plugin, sites]);
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.deepEqual((setup.allowFolders([], [dir], [plugin]) as any).changed, []);
});
test('run folders and explicit init reject repositories including symlink destinations', (t) => {
  const root = sandbox(t),
    repo = resolve(root, 'Sites/EXAMPLE/worktrees/main');
  mkdirSync(resolve(repo, 'design'), { recursive: true });
  writeFileSync(resolve(repo, '.git'), 'gitdir: fixture');
  symlinkSync(resolve(repo, 'design'), resolve(root, 'Sites/EXAMPLE/design'));
  config.writeConfig({ runs: { convention: 'project' } });
  assert.throws(() => config.nextRun(repo, '2026-10-03'), /inside the working copy/);
  assert.throws(() => workflow.init({ repo, workspace: resolve(repo, 'runs/one') }), /inside the working copy/);
  assert.throws(() => setup.createRunsFolder(repo), /inside the working copy/);
});
test('eight simultaneous allocators reserve distinct dated run folders', async (t) => {
  const root = sandbox(t),
    repo = resolve(root, 'Sites/EXAMPLE/worktrees/main');
  mkdirSync(repo, { recursive: true });
  writeFileSync(resolve(repo, '.git'), 'gitdir: fixture');
  config.writeConfig({ runs: { convention: 'project' } });
  const source = `import {nextRun} from ${JSON.stringify(resolve(pluginRoot, 'src/lab-config.ts'))};console.log(nextRun(${JSON.stringify(repo)}, '2026-10-03'));`;
  const results = await Promise.all(
    Array.from(
      { length: 8 },
      () =>
        new Promise<string>((done, reject) => {
          const p = spawn(process.execPath, ['--input-type=module', '-e', source], { env: process.env });
          let out = '';
          p.stdout.on('data', (b) => (out += b));
          p.on('error', reject);
          p.on('exit', (code) => (code === 0 ? done(out.trim()) : reject(new Error('allocator failed'))));
        }),
    ),
  );
  assert.equal(new Set(results).size, 8);
});
test('capture resolves pinned shared dependencies or gives the documented setup command', (t) => {
  const root = sandbox(t);
  const [ready, detail] = setup.playwrightReady();
  assert.equal(typeof ready, 'boolean');
  assert.ok(detail.length);
  const p = spawnSync(
    process.execPath,
    [
      resolve(pluginRoot, 'scripts/capture_all.ts'),
      '--project',
      root,
      '--site-url',
      'http://x',
      '--canonical-base-url',
      'http://x',
    ],
    { env: { ...process.env, DESIGN_LAB_CACHE: resolve(root, 'absent-cache') }, encoding: 'utf8' },
  );
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /setup-ts.ts|design-lab:init/);
});
test('all 24 baseline workflow subcommands expose their preserved help and reject invalid flags', () => {
  assert.equal(Object.keys(COMMANDS).length, 24);
  for (const name of Object.keys(COMMANDS)) {
    const p = spawnSync(process.execPath, [resolve(pluginRoot, 'scripts/workflow.ts'), name, '--help'], {
      encoding: 'utf8',
    });
    assert.equal(p.status, 0, p.stderr);
    assert.match(p.stdout, new RegExp('workflow.ts ' + name));
  }
  const p = spawnSync(process.execPath, [resolve(pluginRoot, 'scripts/workflow.ts'), 'detect', '--unknown'], {
    encoding: 'utf8',
  });
  assert.equal(p.status, 2);
});
test('workflow init, identity, target and phase recording preserve validation and provenance', (t) => {
  const root = sandbox(t),
    repo = resolve(root, 'repo'),
    workspace = resolve(root, 'run');
  mkdirSync(repo);
  const result = workflow.init({ repo, workspace, operator: 'Example', 'site-label': 'Fixture' });
  assert.equal(result.run.operator, 'Example');
  assert.equal(result.run.plugin?.version, workflow.pluginVersion());
  assert.equal(workflow.identity(workspace, { 'no-schema-change': true }).schemaChurn?.changed, false);
  assert.throws(() => workflow.identity(workspace, { 'no-schema-change': true, 'schema-change': ['x'] }), /not both/);
  assert.equal(workflow.target(workspace, 'https://www.figma.com/design/ABC/Fixture').figmaFileKey, 'ABC');
  assert.throws(() => workflow.record(workspace, { phase: 'usage', status: 'waived' }), /--by/);
  assert.equal(
    (
      workflow.record(workspace, {
        phase: 'usage',
        status: 'waived',
        by: 'Example',
        detail: '{"reason":"offline"}',
      }) as Project['phases'][string]
    ).status,
    'waived',
  );
  assert.match(workflow.renderWatch(workflow.watchSummary(workspace)), /design-lab · Fixture/);
});
test('project ordering and an empty project run folder never fall back to another pointer', (t) => {
  const root = sandbox(t),
    repo = resolve(root, 'P/worktrees/main'),
    folder = resolve(root, 'P/design');
  mkdirSync(repo, { recursive: true });
  mkdirSync(folder);
  writeFileSync(resolve(repo, '.git'), 'gitdir: fixture');
  config.writeConfig({ runs: { convention: 'project' } });
  workflow.writeActiveRun(resolve(root, 'other'));
  assert.throws(() => workflow.watchWorkspace(undefined, repo), /no design-lab run yet/);
  for (const name of ['2026-10-03-2', '2026-10-03'])
    write(resolve(folder, name, 'project.json'), { createdAt: '2026-10-03T09:00:00+00:00' });
  assert.deepEqual(
    config.runsIn(folder).map((p) => p.split('/').at(-1)),
    ['2026-10-03', '2026-10-03-2'],
  );
});
test('reports summarize recorded outcomes and a completed benchmark rejects another start', (t) => {
  const root = sandbox(t),
    repo = resolve(root, 'repo'),
    workspace = resolve(root, 'run');
  mkdirSync(repo);
  workflow.init({ repo, workspace });
  write(resolve(workspace, 'plan.json'), {
    plans: [{ verdict: 'build' }, { verdict: 'refuse', refuseReason: 'no capture' }],
  });
  assert.deepEqual(workflow.reportLines(workspace, 'plan'), ['2 planned: 1 build, 1 refuse', '  1 x no capture']);
  workflow.record(workspace, { phase: 'benchmark', status: 'complete' });
  assert.equal('ignored' in workflow.record(workspace, { phase: 'benchmark', status: 'running' }), true);
});

test('preflight readiness does not connect to Figma and failed prerequisites never record a go-ahead', async (t) => {
  const root = sandbox(t),
    repo = resolve(root, 'repo'),
    workspace = resolve(root, 'run');
  mkdirSync(repo);
  workflow.init({ repo, workspace, operator: 'Example', 'site-label': 'Fixture' });
  const deps = {
    siteResponse: async () => ({ reachable: true, detail: 'HTTP 200', html: '<main>No debug</main>' }),
    serverStatus: async () => ({
      alive: false,
      pid: null,
      portInUse: false,
      inflight: false,
      otherRun: null,
      otherPid: null,
      log: '',
    }),
    browserReady: (): [boolean, string] => [true, '/fixture/chromium'],
    svgReady: async () => {},
  };
  const args = {
    'site-url': 'https://local.test',
    'figma-url': 'https://www.figma.com/design/ABC/File',
    'plan-approval': 'review',
  } as const;
  const ready = await workflow.preflight(workspace, args, deps);
  assert.equal(ready.ready, true);
  assert.equal(ready.checks.twigDebug?.enabled, false);
  assert.ok(ready.goAheadAt);
  assert.equal(workflow.optional(resolve(workspace, 'figma/handshake-request.json')), null);
  const p = workflow.read<Project>(resolve(workspace, 'project.json'));
  p.phases['plan'] = { status: 'awaiting-approval' };
  write(resolve(workspace, 'project.json'), p);
  assert.throws(() => workflow.approve(workspace, { 'from-preflight': true }), /review/);
  assert.equal(workflow.approve(workspace, { by: 'Reviewer' }).status, 'approved');
  const failure = await workflow.preflight(workspace, args, { ...deps, browserReady: () => [false, 'no browser'] });
  assert.equal(failure.ready, false);
  const checklist = workflow.read<ChecklistDocument>(resolve(workspace, 'preflight-checks.json'));
  assert.equal(checklist.ready, false);
  assert.equal(checklist.goAheadAt, null);
  const q = workflow.read<Project>(resolve(workspace, 'project.json'));
  q.decisions.componentSource = 'sitestudio';
  write(resolve(workspace, 'project.json'), q);
  const sourceMissing = await workflow.preflight(workspace, args, deps);
  assert.equal(sourceMissing.ready, false);
  assert.ok(sourceMissing.missing?.some((s: string) => s.includes('Site Studio')));
});
test('connection startup failures leave a stopped log and no false connection claim', async (t) => {
  const root = sandbox(t),
    repo = resolve(root, 'repo'),
    workspace = resolve(root, 'run');
  mkdirSync(repo);
  workflow.init({ repo, workspace });
  workflow.target(workspace, 'https://www.figma.com/design/ABC/File');
  const result = await workflow.connect(workspace, 1, {
    handshake: async () => {
      throw new Error('port is occupied');
    },
  });
  assert.equal(result.ok, false);
  assert.match(workflow.entries(workspace).at(-1)!.message ?? '', /port is occupied/);
  assert.equal(workflow.entries(workspace).at(-1)!.status, 'stopped');
});
test('failed build wait stops the server before logging; retry ensures a fresh server', async (t) => {
  const root = sandbox(t),
    repo = resolve(root, 'repo'),
    workspace = resolve(root, 'run'),
    order: string[] = [];
  mkdirSync(repo);
  workflow.init({ repo, workspace });
  const deps = {
    ensureServer: async () => {
      order.push('ensure');
      return {} as any;
    },
    stopServer: async () => {
      assert.notEqual(workflow.entries(workspace).at(-1)!.status, 'stopped');
      order.push('stop');
      return { stopped: true, pid: 1 };
    },
    waitForBuild: async () => {
      order.push('wait');
      throw new Error('runner failed');
    },
  };
  await assert.rejects(workflow.awaitBuild(workspace, 1, deps), /runner failed/);
  assert.equal(workflow.entries(workspace).at(-1)!.status, 'stopped');
  await workflow.awaitBuild(workspace, 1, {
    ...deps,
    waitForBuild: async () => {
      order.push('retry');
    },
  });
  assert.deepEqual(order, ['ensure', 'wait', 'stop', 'ensure', 'retry']);
});
test('failed rebuild cleans allocated or explicitly empty workspaces and preserves occupied work', (t) => {
  const root = sandbox(t),
    repo = resolve(root, 'P/worktrees/main'),
    source = resolve(root, 'source'),
    given = resolve(root, 'new');
  mkdirSync(repo, { recursive: true });
  writeFileSync(resolve(repo, '.git'), 'gitdir: fixture');
  mkdirSync(source);
  config.writeConfig({ runs: { convention: 'project' } });
  const args = { repo, from: source, 'figma-url': 'https://www.figma.com/design/ABC/File' };
  assert.throws(() => workflow.figmaBuild(args));
  assert.deepEqual(config.runsIn(resolve(root, 'P/design')), []);
  assert.throws(() => workflow.figmaBuild({ ...args, workspace: given }));
  assert.deepEqual(workflow.optional(resolve(given, 'project.json')), null);
  writeFileSync(resolve(given, 'keep.txt'), 'owned');
  assert.throws(() => workflow.figmaBuild({ ...args, workspace: given }), /new or empty/);
  assert.equal(readFileSync(resolve(given, 'keep.txt'), 'utf8'), 'owned');
});
test('setup checks and configuration writes bootstrap with an entirely absent dependency cache', (t) => {
  const root = sandbox(t),
    env = { ...process.env, DESIGN_LAB_CACHE: resolve(root, 'empty-cache') };
  const script = resolve(pluginRoot, 'scripts/lab_setup.ts');
  const check = spawnSync(process.execPath, [script, 'check', '--json'], { env, encoding: 'utf8' });
  assert.equal(check.status, 1, check.stderr);
  const result = JSON.parse(check.stdout);
  assert.equal(result.checks.find((c: any) => c.id === 'dependencies').status, 'missing');
  const set = spawnSync(process.execPath, [script, 'set', 'runs', 'home'], { env, encoding: 'utf8' });
  assert.equal(set.status, 0, set.stderr);
  assert.equal(config.readConfig().runs?.convention, 'home');
  const relative = spawnSync(process.execPath, [script, 'check', '--json'], {
    env: { ...env, DESIGN_LAB_HOME: 'relative' },
    encoding: 'utf8',
  });
  assert.equal(relative.status, 1);
  assert.match(relative.stderr, /absolute path/);
});
test('workflow executes through a symlink path instead of silently returning without work', (t) => {
  const root = sandbox(t),
    link = resolve(root, 'plugin');
  symlinkSync(pluginRoot, link);
  const help = spawnSync(process.execPath, [resolve(link, 'scripts/workflow.ts'), '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /workflow.ts <command>/);
  const repo = resolve(root, 'repo'),
    workspace = resolve(root, 'run');
  mkdirSync(repo);
  const init = spawnSync(
    process.execPath,
    [resolve(link, 'scripts/workflow.ts'), 'init', '--repo', repo, '--workspace', workspace],
    { encoding: 'utf8' },
  );
  assert.equal(init.status, 0, init.stderr);
  assert.equal(JSON.parse(readFileSync(resolve(workspace, 'project.json'), 'utf8')).schemaVersion, 1);
});
test('component phase completes only after every accepted planned build receipt', (t) => {
  const root = sandbox(t),
    repo = resolve(root, 'repo'),
    workspace = resolve(root, 'run');
  mkdirSync(repo);
  workflow.init({ repo, workspace });
  const fixture = (name: string) =>
    JSON.parse(readFileSync(resolve(pluginRoot, 'tests/ts/fixtures', name + '.json'), 'utf8'));
  const plan = fixture('plan'),
    base = plan.plans[0];
  plan.plans = ['fixture:a', 'fixture:b'].map((id) => ({
    ...base,
    id,
    libraryRole: 'component',
    verdict: 'build',
    refuseReason: null,
  }));
  write(resolve(workspace, 'plan.json'), plan);
  workflow.register(workspace, { name: 'plan', kind: 'plan', path: resolve(workspace, 'plan.json') });
  for (const [i, id] of ['fixture:a', 'fixture:b'].entries()) {
    const record = fixture('build-record');
    record.id = id;
    for (const rel of record.documentation.anatomy.relationships ?? []) rel.accepts = ['any'];
    for (const assertion of Object.values(record.assertions) as any[]) assertion.verdict = 'pass';
    record.assertions['visual-comparison'].breakpoints = { desktop: 'pass', tablet: 'pass', mobile: 'pass' };
    record.visualEvidence.comparison = {
      ...record.visualEvidence.comparison,
      verdict: 'pass',
      breakpoints: { desktop: 'pass', tablet: 'pass', mobile: 'pass' },
    };
    const path = resolve(workspace, 'builds', id.replace(':', '-') + '.json');
    write(path, record);
    workflow.register(workspace, { name: 'build:' + id, kind: 'build-record', path, phase: 'components' });
    assert.equal(
      workflow.read<Project>(resolve(workspace, 'project.json')).phases['components']?.status,
      i ? 'complete' : 'running',
    );
  }
});
