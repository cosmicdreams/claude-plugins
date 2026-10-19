// Phase 1 authoring through the public commands, in disposable Git repositories (no Playwright, no
// network): init in a suite checkout separate from the application worktree, source through the file
// connector, ingest to Markdown drafts with provenance, a written interpretation, a QA (stand-in)
// approval bound to the case hash and the exact source text, the regression transition, and the work
// journal. The core's own `verify` must accept what the commands wrote.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { runCommand } from '../../src/commands.ts';
import { parseCaseMarkdown, renderCaseMarkdown } from '../../src/case-file.ts';
import { coordinate } from '../../src/coordinator.ts';
import { parseCase } from '../../src/persistence.ts';

const QA = 'Quinn QA';
const PRIORITIES = [{ id: 3, name: '2 - Short Regression' }, { id: 5, name: 'Undefined' }];
const CASES = [
  { id: 101, suite_id: 9, title: 'Footer logo links home', priority_id: 3, custom_preconds: 'Any page.', custom_steps_separated: [{ content: 'Click the footer logo.', expected: 'The home page opens.' }] },
  { id: 102, suite_id: 9, title: 'Listing sort', priority_id: 5, custom_steps: 'Open the listing.', custom_expected: 'Items sort by ID.' },
  { id: 103, suite_id: 9, title: 'Vague', priority_id: 3, custom_steps: 'Look around.', custom_expected: '' },
];

let dir = '';
let suite = '';
let app = '';
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
const cli = async (...args: string[]) => (await runCommand(args)) as { exitCode: number; output: Record<string, unknown> };

before(async () => {
  dir = realpathSync(join(tmpdir(), '.'));
  dir = execFileSync('mktemp', ['-d', join(dir, 'test-lab-authoring-XXXXXX')], { encoding: 'utf8' }).trim();
  dir = realpathSync(dir);
  process.env['TEST_LAB_DATA'] = join(dir, 'data');
  suite = join(dir, 'qa');
  app = join(dir, 'app');
  for (const [root, name] of [[suite, QA], [app, 'Dana Dev']] as const) {
    mkdirSync(root);
    g(root, 'init', '-b', 'main');
    g(root, 'config', 'user.name', name);
    g(root, 'config', 'user.email', 'fixture@example.invalid');
  }
  mkdirSync(join(suite, 'automation/site/tests'), { recursive: true });
  writeFileSync(join(suite, 'automation/site/playwright.config.ts'), "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests' });\n");
  writeFileSync(join(suite, 'automation/site/tests/footer.spec.ts'), "test('C101 - Verify the footer logo links home', async () => {});\n");
  writeFileSync(join(app, 'index.txt'), 'application');
  for (const root of [suite, app]) {
    g(root, 'add', '.');
    g(root, 'commit', '-m', 'test: fixture');
    g(dir, 'clone', '--bare', root, `${root}.git`);
    g(root, 'remote', 'add', 'origin', `${root}.git`);
    g(root, 'fetch', 'origin');
    g(root, 'checkout', '-b', 'feature/pilot');
  }
});
after(() => { rmSync(dir, { recursive: true, force: true }); delete process.env['TEST_LAB_DATA']; });

describe('phase 1 authoring commands', () => {
  test('init names the suite checkout and the application worktree separately', async () => {
    writeFileSync(join(dir, 'configurations.json'), JSON.stringify([{ id: 'desktop@1440', project: 'desktop-chrome', viewport: { width: 1440, height: 900 }, role: 'anonymous' }]));
    writeFileSync(join(dir, 'fixtures.json'), JSON.stringify([{ id: 'home', environments: ['local'], path: '/', title: 'Home', structure: null }]));
    const common = ['--project', 'Generic site', '--suite-id', 'site', '--config', 'automation/site/playwright.config.ts', '--env-id', 'local', '--base-url', 'http://127.0.0.1:4999', '--base-url-env', 'BASE_URL', '--qa', QA, '--qa-stand-in', '--configurations', join(dir, 'configurations.json'), '--fixture-map', join(dir, 'fixtures.json')];
    await assert.rejects(cli('init', '--suite-root', suite, '--app-root', suite, ...common), /named separately/);
    const r = await cli('init', '--suite-root', suite, '--app-root', app, ...common);
    assert.equal(r.exitCode, 0);
    assert.match(String(r.output['qa']), /QA \(stand-in\)/);
    await assert.rejects(cli('init', '--suite-root', suite, '--app-root', app, ...common), /never overwrites/);
    // Publish the empty profile as QA's base, as the stand-in QA would before approving anything.
    g(suite, 'add', '.');
    g(suite, 'commit', '-m', 'test: test-lab profile');
    g(suite, 'push', 'origin', 'HEAD:main');
    g(suite, 'fetch', 'origin');
  });

  test('source snapshot through the file connector; ingest drafts with provenance; needs-work goes back to QA', async () => {
    const responses = { schema: 1, source: 'testrail', responses: { get_priorities: PRIORITIES, 'get_suites/93': [{ id: 9 }], 'get_cases/93&suite_id=9&limit=250&offset=0': CASES } };
    writeFileSync(join(dir, 'responses.json'), JSON.stringify(responses));
    const s = await cli('source', 'snapshot', '--connector', 'file', '--responses', join(dir, 'responses.json'), '--project', '93', '--output', join(suite, '.test-lab/sources/s1'));
    assert.equal(s.exitCode, 0);
    assert.deepEqual(s.output['byPriority'], { '2 - Short Regression': 2, Undefined: 1 });
    const i = await cli('ingest', '--suite-root', suite, '--snapshot', join(suite, '.test-lab/sources/s1/snapshot.json'));
    assert.deepEqual(i.output['written'], ['.test-lab/cases/drafts/C101.md', '.test-lab/cases/drafts/C102.md']);
    assert.deepEqual((i.output['returnedToQa'] as { case: string }[]).map((x) => x.case), ['C103']);
    const draft = readFileSync(join(suite, '.test-lab/cases/drafts/C101.md'), 'utf8');
    assert.match(draft, /drafted_from: testrail/);
    assert.match(draft, /testrail:project:93:suite:9:case:101/);
    assert.match(draft, /"2 - Short Regression" \(priority_id 3\) maps to @p2/);
    assert.match(draft, /Expected: The home page opens\./);
    assert.match(readFileSync(join(suite, '.test-lab/cases/drafts/C102.md'), 'utf8'), /priority_defaulted: true/);
  });

  test('approval needs a written interpretation and declared configurations, in the owner\'s role', async () => {
    await assert.rejects(cli('case', 'approve', '--suite-root', suite, '--id', 'C101', '--as', 'developer', '--reason', 'r'), /QA role/);
    await assert.rejects(cli('case', 'approve', '--suite-root', suite, '--id', 'C101', '--as', 'qa', '--reason', 'r'), /no applicable configurations/);
    const path = join(suite, '.test-lab/cases/drafts/C101.md');
    const doc = parseCaseMarkdown(readFileSync(path, 'utf8'));
    const record = parseCase({ ...(doc.record as object), configurations: ['desktop@1440'], fixture: 'home' });
    record.steps[0]!.obligations[0]!.text = 'Clicking the footer logo opens the home page (path /), with the footer and logo still visible.';
    writeFileSync(path, renderCaseMarkdown(record, { interpretation: '', source: doc.source }));
    await assert.rejects(cli('case', 'approve', '--suite-root', suite, '--id', 'C101', '--as', 'qa', '--reason', 'r'), /Interpretation section/);
    writeFileSync(path, renderCaseMarkdown(record, { interpretation: 'One obligation: the logo\'s destination is the home page. Nothing in the source is stale.', source: doc.source }));
    const r = await cli('case', 'approve', '--suite-root', suite, '--id', 'C101', '--as', 'qa', '--reason', 'reading checked against the served footer', '--add');
    assert.equal(r.output['label'], 'QA (stand-in)');
    assert.ok(existsSync(join(suite, '.test-lab/cases/regression/C101.md')));
    assert.ok(!existsSync(path));
    const approved = parseCaseMarkdown(readFileSync(join(suite, '.test-lab/cases/regression/C101.md'), 'utf8'));
    assert.match(JSON.stringify(approved.record), /"standIn":true/);
    const profile = JSON.parse(readFileSync(join(suite, '.test-lab/profile.json'), 'utf8')) as { regression: string[] };
    assert.deepEqual(profile.regression, ['C101']);
    const index = JSON.parse(readFileSync(join(suite, '.test-lab/source.json'), 'utf8')) as { snapshot: string; cases: { case: string }[] };
    assert.equal(index.snapshot, 'sources/s1/snapshot.json');
    assert.deepEqual(index.cases.map((c) => c.case), ['C101']);
  });

  test('an Undefined-priority case can be approved but never added to the required set', async () => {
    const path = join(suite, '.test-lab/cases/drafts/C102.md');
    const doc = parseCaseMarkdown(readFileSync(path, 'utf8'));
    writeFileSync(path, renderCaseMarkdown(parseCase({ ...(doc.record as object), preconditions: 'The listing page is published.', configurations: ['desktop@1440'] }), { interpretation: 'Sort order reading; the source does not say ascending or descending (flagged to QA).', source: doc.source }));
    await cli('case', 'approve', '--suite-root', suite, '--id', 'C102', '--as', 'qa', '--reason', 'r');
    await assert.rejects(cli('regression', 'add', '--suite-root', suite, '--id', 'C102', '--as', 'qa', '--reason', 'r'), /Undefined source priority/);
  });

  test('the core verifies what the commands wrote: the QA transition replays and the source binding holds', async () => {
    const r = await coordinate({ operation: 'verify', appRoot: app, suiteRoot: suite, environment: 'local', noWork: true });
    assert.equal(r.exitCode, 0, r.summary);
    assert.match(r.summary, /Policy verification passed/);
  });

  test('a hand edit to the regression list, with no QA record, is not evaluable', async () => {
    const p = join(suite, '.test-lab/profile.json');
    const saved = readFileSync(p, 'utf8');
    const profile = JSON.parse(saved) as { regression: string[] };
    writeFileSync(p, JSON.stringify({ ...profile, regression: [...profile.regression, 'C102'] }, null, 2));
    const r = await coordinate({ operation: 'verify', appRoot: app, suiteRoot: suite, environment: 'local', noWork: true });
    assert.equal(r.verdict.verdict, 'not-evaluable');
    writeFileSync(p, saved);
  });

  test('work start binds the application branch; the journal is written before the committed log', async () => {
    const add = renderCaseMarkdown({ id: 'SITE-ACC-001', aliases: [], track: 'addendum', title: 'Accordion title is serif; rows stay sans-serif', preconditions: 'The accordion page is published.', steps: [{ id: 'S1', text: 'Open the page.', obligations: [{ id: 'O1', text: 'The title renders in the serif face.', layer: 'served' }, { id: 'O2', text: 'Every row renders in the sans-serif face.', layer: 'served' }] }], priority: 'p1', configurations: ['desktop@1440'], refs: ['TICKET-1'], fixture: 'home', configurationDependent: false, provenance: { draftedFrom: 'ticket', independentRefs: ['TICKET-1'], selfDerivedAcceptedBy: null }, approval: null }, { interpretation: 'Font selection only; loading is a separate obligation in a later revision.', source: 'TICKET-1' });
    writeFileSync(join(suite, '.test-lab/cases/drafts/SITE-ACC-001.md'), add);
    const approved = await cli('case', 'approve', '--suite-root', suite, '--id', 'SITE-ACC-001', '--as', 'developer', '--reason', 'my reading of the ticket');
    assert.equal(approved.output['label'], 'developer');
    await assert.rejects(cli('work', 'add', '--suite-root', suite, '--app-root', app, '--ticket', 'TICKET-1', '--case', 'SITE-ACC-001', '--as', 'developer', '--reason', 'r'), /start it first/);
    await cli('work', 'start', '--suite-root', suite, '--app-root', app, '--ticket', 'TICKET-1', '--as', 'developer', '--reason', 'accordion fix');
    assert.equal(g(app, 'config', '--get', 'branch.feature/pilot.test-lab-work'), 'TICKET-1');
    const w = await cli('work', 'add', '--suite-root', suite, '--app-root', app, '--ticket', 'TICKET-1', '--case', 'SITE-ACC-001', '--as', 'developer', '--reason', 'gates this work');
    assert.deepEqual(w.output['addendum'], ['SITE-ACC-001']);
    const r = await coordinate({ operation: 'verify', appRoot: app, suiteRoot: suite, environment: 'local' });
    assert.equal(r.exitCode, 0, r.summary);
  });

  test('adopt binds a test to obligations; a synthetic test can\'t claim a served obligation', async () => {
    const base = ['--suite-root', suite, '--suite', 'site', '--file', 'tests/footer.spec.ts', '--title', 'C101 - Verify the footer logo links home', '--case', 'C101', '--configuration', 'desktop@1440'];
    await assert.rejects(cli('adopt', ...base, '--layer', 'synthetic'), /needs a served test/);
    await assert.rejects(cli('adopt', ...base.map((x) => x === 'C101 - Verify the footer logo links home' ? 'no such test' : x)), /does not declare a test/);
    const r = await cli('adopt', ...base);
    assert.equal(r.output['added'], 1);
    assert.equal((await cli('adopt', ...base)).output['added'], 0);
    await assert.rejects(cli('adopt', '--suite-root', suite, '--suite', 'site', '--legacy', 'scratch/**', '--as', 'developer', '--reason', 'r'), /QA role/);
  });

  test('accept refuses without a burn-in; a waiver is the owner\'s, with a reason', async () => {
    await assert.rejects(cli('accept', '--suite-root', suite, '--case', 'C101', '--suite', 'site', '--file', 'tests/footer.spec.ts', '--title', 'C101 - Verify the footer logo links home', '--as', 'qa'), /no burn-in/);
    await assert.rejects(cli('waive', '--suite-root', suite, '--case', 'C101', '--step', 'S1', '--obligation', 'O1', '--as', 'developer', '--reason', 'r'), /QA role/);
    const w = await cli('waive', '--suite-root', suite, '--case', 'C101', '--step', 'S1', '--obligation', 'O1', '--as', 'qa', '--reason', 'no faithful mutation of the logo link exists on this fixture');
    assert.match(String(w.output['by']), /QA \(stand-in\)/);
  });
});
