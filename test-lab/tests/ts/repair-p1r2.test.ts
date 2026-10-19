// Phase 1, review round 2, in disposable Git repositories (no Playwright, no network):
// - `regression add` refuses on main, master and a detached checkout, and writes nothing there;
// - a red check refused before it runs (here: on main) leaves no recipe behind;
// - `graduate decide` refused part-way (an Undefined priority, an unpublished QA base) leaves the
//   dispositions, the corpus and the profile byte-identical, and the proposal still open for a retry.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { redcheck } from '../../src/certify.ts';
import { renderCaseMarkdown } from '../../src/case-file.ts';
import { runCommand } from '../../src/commands.ts';
import type { CaseRecord } from '../../src/model.ts';

const QA = 'Quinn QA';
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
const cli = async (...args: string[]) => { try { return { ...(await runCommand(args)), error: '' }; } catch (e) { return { exitCode: 4, output: {}, error: e instanceof Error ? e.message : String(e) }; } };
const dirs: string[] = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); delete process.env['TEST_LAB_DATA']; });

/** A suite checkout and an application worktree on feature branches, with test-lab initialised. */
async function world(options: { publish: boolean }) {
  const dir = realpathSync(execFileSync('mktemp', ['-d', join(realpathSync(tmpdir()), 'test-lab-p1r2-XXXXXX')], { encoding: 'utf8' }).trim());
  dirs.push(dir);
  process.env['TEST_LAB_DATA'] = join(dir, 'data');
  const suite = join(dir, 'qa'), app = join(dir, 'app');
  for (const [root, name] of [[suite, QA], [app, 'Dana Dev']] as const) { mkdirSync(root); g(root, 'init', '-b', 'main'); g(root, 'config', 'user.name', name); g(root, 'config', 'user.email', 'fixture@example.invalid'); }
  mkdirSync(join(suite, 'site/tests'), { recursive: true });
  writeFileSync(join(suite, 'site/playwright.config.ts'), 'export default {};\n');
  writeFileSync(join(suite, 'site/tests/home.spec.ts'), "test('C9 - heading', async () => {});\n");
  writeFileSync(join(app, 'index.txt'), 'application');
  for (const root of [suite, app]) { g(root, 'add', '.'); g(root, 'commit', '-m', 'test: fixture'); g(dir, 'clone', '--bare', root, `${root}.git`); g(root, 'remote', 'add', 'origin', `${root}.git`); g(root, 'fetch', 'origin'); g(root, 'checkout', '-b', 'feature/pilot'); }
  writeFileSync(join(dir, 'c.json'), JSON.stringify([{ id: 'desktop@1440', project: 'desktop-chrome', viewport: { width: 1440, height: 900 }, role: 'anonymous' }]));
  writeFileSync(join(dir, 'f.json'), JSON.stringify([{ id: 'home', environments: ['local'], path: '/', title: 'Home', structure: null }]));
  const init = await cli('init', '--suite-root', suite, '--app-root', app, '--project', 'Generic', '--suite-id', 'site', '--config', 'site/playwright.config.ts', '--env-id', 'local', '--base-url', 'http://127.0.0.1:4999', '--base-url-env', 'BASE_URL', '--qa', QA, '--qa-stand-in', '--configurations', join(dir, 'c.json'), '--fixture-map', join(dir, 'f.json'));
  assert.equal(init.exitCode, 0, init.error);
  g(suite, 'add', '.'); g(suite, 'commit', '-m', 'test: test-lab profile');
  if (options.publish) { g(suite, 'push', 'origin', 'HEAD:main'); g(suite, 'fetch', 'origin'); }
  return { dir, suite, app };
}

const caseOf = (id: string, track: 'regression' | 'addendum', priority: { priority: string; defaulted?: boolean }): CaseRecord => ({
  id, aliases: [], track, title: `${id} title`, preconditions: 'The home page is published.', steps: [{ id: 'S1', text: 'Open the home page.', obligations: [{ id: 'O1', text: 'The heading reads the site name.', layer: 'served' as const }] }],
  priority: priority.priority, ...(priority.defaulted === true ? { priorityDefaulted: true as const } : {}), configurations: ['desktop@1440'], refs: ['TICKET-1'], fixture: 'home', configurationDependent: false,
  provenance: { draftedFrom: 'ticket' as const, independentRefs: ['TICKET-1'], selfDerivedAcceptedBy: null }, approval: null,
});

/** Every file under the suite's and the application's .test-lab/, with its bytes. */
function snapshot(...roots: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (base: string, rel: string) => {
    const abs = join(base, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name === 'runs') continue;
      const r = join(rel, e.name);
      if (e.isDirectory()) walk(base, r); else out.set(`${base}:${r}`, readFileSync(join(base, r), 'utf8'));
    }
  };
  for (const root of roots) walk(root, '.test-lab');
  return out;
}

describe('regression add writes only on a dedicated branch', () => {
  test('refused on main and on a detached checkout; nothing is written there', async () => {
    const w = await world({ publish: true });
    writeFileSync(join(w.suite, '.test-lab/cases/drafts/REG-9.md'), renderCaseMarkdown(caseOf('REG-9', 'regression', { priority: 'p2' }), { interpretation: 'One obligation: the heading text.', source: 'TICKET-1' }));
    const approved = await cli('case', 'approve', '--suite-root', w.suite, '--id', 'REG-9', '--as', 'qa', '--reason', 'reading confirmed');
    assert.equal(approved.exitCode, 0, approved.error);
    g(w.suite, 'add', '.'); g(w.suite, 'commit', '-m', 'test: approve REG-9');
    for (const leave of [() => { g(w.suite, 'checkout', 'main'); g(w.suite, 'merge', '--ff-only', 'feature/pilot'); }, () => g(w.suite, 'checkout', '--detach', 'feature/pilot')]) {
      leave();
      const before = snapshot(w.suite);
      const r = await cli('regression', 'add', '--suite-root', w.suite, '--id', 'REG-9', '--as', 'qa', '--reason', 'add it');
      assert.equal(r.exitCode, 4);
      assert.match(r.error, /dedicated branch/);
      assert.deepEqual(snapshot(w.suite), before, 'no transition and no profile change');
      assert.equal(g(w.suite, 'status', '--porcelain'), '');
    }
    g(w.suite, 'checkout', 'feature/pilot');
    const ok = await cli('regression', 'add', '--suite-root', w.suite, '--id', 'REG-9', '--as', 'qa', '--reason', 'add it');
    assert.equal(ok.exitCode, 0, ok.error);
  });

  test('a red check refused before it runs (on main) leaves no recipe behind', async () => {
    const w = await world({ publish: true });
    writeFileSync(join(w.suite, '.test-lab/cases/drafts/REG-9.md'), renderCaseMarkdown(caseOf('REG-9', 'regression', { priority: 'p2' }), { interpretation: 'One obligation.', source: 'TICKET-1' }));
    assert.equal((await cli('case', 'approve', '--suite-root', w.suite, '--id', 'REG-9', '--as', 'qa', '--reason', 'r')).exitCode, 0);
    const test = { suite: 'site', file: 'tests/home.spec.ts', titlePath: ['C9 - heading'] };
    assert.equal((await cli('adopt', '--suite-root', w.suite, '--suite', 'site', '--file', test.file, '--title', test.titlePath[0]!, '--case', 'REG-9', '--configuration', 'desktop@1440')).exitCode, 0);
    g(w.suite, 'add', '.'); g(w.suite, 'commit', '-m', 'test: adopt'); g(w.suite, 'checkout', 'main'); g(w.suite, 'merge', '--ff-only', 'feature/pilot');
    let mutations = 0;
    const adapter = { name: 'fake', async identity() { return { appRoot: w.app }; }, async fixture() { throw new Error('unused'); }, async configuration() { return { status: '[]', lastImportAt: null }; }, async mutate() { mutations++; }, async restore() {}, async stop() {} };
    const before = snapshot(w.suite);
    await assert.rejects(redcheck({ suiteRoot: w.suite, appRoot: w.app, environment: 'local', adapter: adapter as never }, { test, obligation: { case: 'REG-9', step: 'S1', obligation: 'O1' }, configuration: 'desktop@1440', recipe: { hypothesis: 'the heading regresses', technique: 'adapter', mutation: { heading: 'broken' } } }), /dedicated suite branch/);
    assert.deepEqual(snapshot(w.suite), before, 'no recipe, no evidence');
    assert.equal(mutations, 0);
  });
});

describe('graduate decide is all or nothing', () => {
  async function proposed(options: { publish: boolean; defaulted: boolean }) {
    const w = await world({ publish: options.publish });
    const add = caseOf('ADD-1', 'addendum', options.defaulted ? { priority: 'p3', defaulted: true } : { priority: 'p2' });
    writeFileSync(join(w.suite, '.test-lab/cases/drafts/ADD-1.md'), renderCaseMarkdown(add, { interpretation: 'One obligation, from the ticket.', source: 'TICKET-1' }));
    const a = await cli('case', 'approve', '--suite-root', w.suite, '--id', 'ADD-1', '--as', 'developer', '--reason', 'my reading');
    assert.equal(a.exitCode, 0, a.error);
    const run = join(w.dir, 'run'); mkdirSync(run);
    writeFileSync(join(run, 'manifest.json'), JSON.stringify({ operation: 'run', observations: [{ evidence: [{ case: 'ADD-1', status: 'verified' }] }] }));
    writeFileSync(join(run, 'verdict.json'), JSON.stringify({ verdict: { verdict: 'ready' } }));
    const p = await cli('graduate', 'propose', '--suite-root', w.suite, '--case', 'ADD-1', '--run', run, '--reason', 'guards the heading');
    assert.equal(p.exitCode, 0, p.error);
    return w;
  }
  const decide = (suite: string) => cli('graduate', 'decide', '--suite-root', suite, '--case', 'ADD-1', '--decision', 'graduated', '--as', 'qa', '--reason', 'belongs in regression');

  test('an Undefined source priority refuses before anything is written', async () => {
    const w = await proposed({ publish: true, defaulted: true });
    const before = snapshot(w.suite, w.app);
    const d = await decide(w.suite);
    assert.equal(d.exitCode, 4);
    assert.match(d.error, /Undefined source priority/);
    assert.deepEqual(snapshot(w.suite, w.app), before, 'dispositions, corpus and profile are byte-identical');
  });

  test('an unpublished QA base refuses before anything is written, and the proposal stays open for a retry', async () => {
    const w = await proposed({ publish: false, defaulted: false });
    const before = snapshot(w.suite, w.app);
    const d = await decide(w.suite);
    assert.equal(d.exitCode, 4);
    assert.match(d.error, /no validated profile/);
    assert.deepEqual(snapshot(w.suite, w.app), before);
    // Publish the base, as the stand-in QA would, and decide again: the same proposal is still open.
    g(w.suite, 'add', '.'); g(w.suite, 'commit', '-m', 'test: corpus'); g(w.suite, 'push', 'origin', 'HEAD:main'); g(w.suite, 'fetch', 'origin');
    const retry = await decide(w.suite);
    assert.equal(retry.exitCode, 0, retry.error);
    const dispositions = (JSON.parse(readFileSync(join(w.suite, '.test-lab/dispositions.json'), 'utf8')) as { records: { kind: string; decision?: string }[] }).records.filter((r) => r.kind === 'graduation').map((r) => r.decision);
    assert.deepEqual(dispositions, ['proposed', 'graduated']);
    assert.ok(existsSync(join(w.suite, '.test-lab/cases/regression/ADD-1.md')));
    assert.ok(!existsSync(join(w.suite, '.test-lab/cases/addendum/ADD-1.md')));
    assert.deepEqual((JSON.parse(readFileSync(join(w.suite, '.test-lab/profile.json'), 'utf8')) as { regression: string[] }).regression, ['ADD-1']);
  });
});
