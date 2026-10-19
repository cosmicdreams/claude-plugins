// Phase 1 end to end on the local fixture site, through the public CLI only: red check (an
// application-side fault through the adapter), burn-in, QA (stand-in) acceptance, a green fast verdict,
// the counterexamples this site can reach, triage on the saved run, reverify after an edit, a
// developer addendum with its work journal, and graduation into QA's regression set.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { renderCaseMarkdown } from '../../src/case-file.ts';
import { setupCoordinator } from '../fixtures/coordinator.ts';

const exec = promisify(execFile);
const CLI = join(import.meta.dirname, '../../src/cli.ts');
type Out = { code: number; out: Record<string, unknown> };
async function cli(args: string[], env: Record<string, string> = {}): Promise<Out> {
  const started = Date.now();
  try {
    const r = await exec(process.execPath, [CLI, ...args], { timeout: 300_000, env: { ...process.env, ...env } });
    return { code: 0, out: JSON.parse(r.stdout.trim()) as Record<string, unknown> };
  } catch (e) {
    const r = e as { code: number; stdout: string; stderr: string; signal?: string };
    if (typeof r.code !== 'number') throw new Error(`${args.slice(0, 2).join(' ')} did not finish (${r.signal ?? 'no exit code'}) after ${Date.now() - started} ms: ${r.stderr}`);
    return { code: r.code, out: r.stdout.trim() ? JSON.parse(r.stdout.trim()) as Record<string, unknown> : { stderr: r.stderr } };
  }
}

test('phase 1 on the local fixture site: certify through the CLI, verdict, counterexamples, addendum, graduation', { timeout: 1_500_000 }, async () => {
  const f = await setupCoordinator('1.60.0');
  const data = join(f.dir, 'journal-data');
  const env = { TEST_LAB_DATA: data };
  try {
    await f.g(f.suite, ['config', 'user.name', 'Quinn QA']);
    await f.g(f.app, ['config', 'user.name', 'Dana Dev']);
    const run = ['--suite-root', f.suite, '--app-root', f.app, '--env', 'local', '--adapter', join(f.suite, 'adapter.ts')];
    const reg = ['--suite', 'e2e', '--file', 'tests/home.spec.ts', '--title', 'heading'];
    writeFileSync(join(f.dir, 'recipe.json'), JSON.stringify({ hypothesis: 'the served heading template regresses to another text', technique: 'adapter', mutation: { heading: 'broken' } }));

    // Two repositories: an adapter that reports the suite checkout as the served root is refused before
    // any test runs, and a verdict through it is inconclusive (rule 2), never green.
    writeFileSync(join(f.dir, 'wrong-adapter.ts'), `console.log(JSON.stringify({schema:1,appRoot:${JSON.stringify(f.suite)},exists:true,published:true,structureObservation:null,status:'[]',lastImportAt:null}));`);
    const wrongRun = ['--suite-root', f.suite, '--app-root', f.app, '--env', 'local', '--adapter', join(f.dir, 'wrong-adapter.ts')];
    const refused = await cli(['redcheck', ...wrongRun, ...reg, '--case', 'REG-1', '--step', 'S1', '--obligation', 'O1', '--configuration', 'desktop@1440', '--recipe', join(f.dir, 'recipe.json')], env);
    assert.equal(refused.code, 4);
    assert.match(String(refused.out['stderr']), /serves .*qa-suite, not the application worktree/);
    const wrongVerdict = await cli(['run', ...wrongRun, '--no-work'], env);
    assert.equal(wrongVerdict.out['rule'], 2, JSON.stringify(wrongVerdict.out));

    // Host safety: a spec naming any origin but the local site refuses a red check before any spec loads.
    writeFileSync(join(f.suite, 'tests/leak.spec.ts'), `import {test} from '@playwright/test';test('leak',async({page})=>{await page.goto('https://outside.example.org/');});`);
    const leak = await cli(['redcheck', ...run, ...reg, '--case', 'REG-1', '--step', 'S1', '--obligation', 'O1', '--configuration', 'desktop@1440', '--recipe', join(f.dir, 'recipe.json')], env);
    rmSync(join(f.suite, 'tests/leak.spec.ts'));
    assert.equal(leak.code, 4);
    assert.match(String(leak.out['stderr']), /unsafe literal host outside\.example\.org/);
    assert.equal(f.state.mutations, 0, 'nothing was mutated');

    // Before any evidence the verdict can't support a claim (rule 7).
    const bare = await cli(['run', ...run, '--no-work'], env);
    assert.equal(bare.code, 3, JSON.stringify(bare.out));
    assert.equal(bare.out['rule'], 7);

    // Red check: the mutation is applied in the site, the test fails inside O1, and passes once restored.
    const red = await cli(['redcheck', ...run, ...reg, '--case', 'REG-1', '--step', 'S1', '--obligation', 'O1', '--configuration', 'desktop@1440', '--recipe', join(f.dir, 'recipe.json')], env);
    assert.equal(red.code, 0, JSON.stringify(red.out));
    assert.equal(f.state.mutations, 1);
    assert.equal(f.state.mutant, false, 'the adapter restored the site');
    const burn = await cli(['burnin', ...run, ...reg, '--configuration', 'desktop@1440'], env);
    assert.equal(burn.code, 0, JSON.stringify(burn.out));
    assert.equal((await cli(['accept', '--suite-root', f.suite, '--case', 'REG-1', ...reg, '--as', 'developer'], env)).code, 4, 'a regression test is accepted in the QA role only');
    const accepted = await cli(['accept', '--suite-root', f.suite, '--case', 'REG-1', ...reg, '--as', 'qa'], env);
    assert.equal(accepted.code, 0, JSON.stringify(accepted.out));
    assert.equal(accepted.out['label'], 'QA (stand-in)');

    // A green local verdict, read back from the saved run.
    const green = await cli(['run', ...run, '--no-work'], env);
    assert.equal(green.code, 0, JSON.stringify(green.out));
    assert.equal(green.out['verdict'], 'ready');
    const greenDir = String(green.out['runDir']);
    const page = readFileSync(join(greenDir, 'verdict.md'), 'utf8');
    assert.match(page, /## Case approvals\n- REG-1 \(regression, @p1\): reading approved by Quinn QA as QA \(stand-in\)/);
    assert.match(page, /## Test acceptances\n- REG-1: tests\/home\.spec\.ts › heading accepted by Quinn QA as QA \(stand-in\)/);
    assert.match(page, /not published to TestRail/);
    const manifest = JSON.parse(readFileSync(join(greenDir, 'manifest.json'), 'utf8')) as { invocations: { purpose: string; argv: string[] }[] };
    assert.ok(manifest.invocations.filter((i) => i.purpose === 'run').every((i) => i.argv.includes('--retries=0')), 'every verdict run is planned with --retries=0');

    // Counterexample: the application regresses. Not ready (rule 5); triage records a class, never clears it.
    f.state.mutant = true;
    const broken = await cli(['run', ...run, '--no-work'], env);
    f.state.mutant = false;
    assert.equal(broken.code, 2, JSON.stringify(broken.out));
    assert.equal(broken.out['rule'], 5);
    const brokenDir = String(broken.out['runDir']);
    const before = readFileSync(join(brokenDir, 'verdict.json'), 'utf8');
    assert.match(readFileSync(join(brokenDir, 'verdict.md'), 'utf8'), /class: not chosen/);
    const triaged = await cli(['triage', '--run', brokenDir, '--failure', '1', '--class', 'product-bug', '--as', 'qa', '--suite-root', f.suite, '--note', 'heading template regressed'], env);
    assert.equal(triaged.code, 0, JSON.stringify(triaged.out));
    assert.equal(readFileSync(join(brokenDir, 'verdict.json'), 'utf8'), before, 'triage never changes the verdict');
    assert.match(readFileSync(join(brokenDir, 'verdict.md'), 'utf8'), /class: product-bug, chosen by Quinn QA \(QA \(stand-in\)\): heading template regressed/);

    // Counterexample: a file edited during the run makes the build identity changed (rule 2).
    f.state.editDuringRun = true;
    const edited = await cli(['run', ...run, '--no-work'], env);
    writeFileSync(join(f.app, 'template.txt'), 'Generic fixture');
    assert.equal(edited.code, 3);
    assert.equal(edited.out['rule'], 2);

    // Counterexample: a missing fixture page is inconclusive (rule 3).
    f.state.missing = true;
    const missing = await cli(['run', ...run, '--no-work'], env);
    f.state.missing = false;
    assert.equal(missing.out['rule'], 3);

    // Counterexample: global teardown throws while every test passes (rule 3).
    f.state.teardown = true;
    const teardown = await cli(['run', ...run, '--no-work'], env);
    f.state.teardown = false;
    assert.equal(teardown.out['rule'], 3);

    // Reverify: nothing is stale; then an edit to the spec moves its behavior digest, the verdict turns
    // inconclusive (rule 7), reverify replays the committed recipe and burns in again, and QA re-accepts.
    assert.deepEqual((await cli(['reverify', ...run], env)).out['replayed'], []);
    const spec = join(f.suite, 'tests/home.spec.ts');
    writeFileSync(spec, `${readFileSync(spec, 'utf8')}\n// reviewed\n`);
    const stale = await cli(['run', ...run, '--no-work'], env);
    assert.equal(stale.out['rule'], 7, JSON.stringify(stale.out));
    const replay = await cli(['reverify', ...run], env);
    assert.equal(replay.code, 0, JSON.stringify(replay.out));
    assert.equal((replay.out['replayed'] as unknown[]).length, 2);
    const stillStale = await cli(['run', ...run, '--no-work'], env);
    assert.equal(stillStale.out['rule'], 7, 'the acceptance is for the old behavior digest');
    assert.equal((await cli(['accept', '--suite-root', f.suite, '--case', 'REG-1', ...reg, '--as', 'qa'], env)).code, 0);
    assert.equal((await cli(['run', ...run, '--no-work'], env)).out['verdict'], 'ready');

    // The developer's addendum lives in the application worktree, never in QA's suite checkout.
    const localPath = join(f.suite, '.test-lab/local.json');
    writeFileSync(localPath, JSON.stringify({ ...JSON.parse(readFileSync(localPath, 'utf8')) as object, addendumRoot: 'application' }, null, 2));
    for (const folder of ['cases/addendum', 'cases/drafts', 'work']) mkdirSync(join(f.app, '.test-lab', folder), { recursive: true });
    const noApp = await cli(['adopt', '--suite-root', f.suite, ...reg, '--case', 'REG-1', '--configuration', 'desktop@1440'], env);
    assert.equal(noApp.code, 4);
    assert.match(String(noApp.out['stderr']), /application worktree/);
    const appArg = ['--app-root', f.app];

    // The developer's addendum: a case from a ticket, approved as developer, gating bound work.
    const add = { id: 'GEN-ADD-001', aliases: [], track: 'addendum' as const, title: 'The heading reads the site name', preconditions: 'The home page is published.', steps: [{ id: 'S1', text: 'Open the home page.', obligations: [{ id: 'O1', text: 'The level-one heading reads "Generic fixture".', layer: 'served' as const }] }], priority: 'p2', configurations: ['desktop@1440'], refs: ['TICKET-9'], fixture: 'home', configurationDependent: false, provenance: { draftedFrom: 'ticket' as const, independentRefs: ['TICKET-9'], selfDerivedAcceptedBy: null }, approval: null };
    writeFileSync(join(f.app, '.test-lab/cases/drafts/GEN-ADD-001.md'), renderCaseMarkdown(add, { interpretation: 'One obligation, read from the ticket: the heading text.', source: 'TICKET-9' }));
    writeFileSync(join(f.suite, 'tests/addendum.spec.ts'), `import {test,expect} from '@playwright/test';import {bindCase,caseStep} from '../support/test-lab/case-step';import {registerActorProbe} from '../support/test-lab/actor-probe';registerActorProbe({path:'actor',roleField:'role'});test('addendum heading',bindCase('GEN-ADD-001'),async({page})=>{await page.goto('/');await caseStep(page,{case:'GEN-ADD-001',step:'S1'},'Open the home page',async()=>{await caseStep(page,{case:'GEN-ADD-001',step:'S1',obligation:'O1'},'the heading reads the site name',async()=>{await expect(page.getByRole('heading',{level:1})).toHaveText('Generic fixture');});});});`);
    const approvedAdd = await cli(['case', 'approve', '--suite-root', f.suite, ...appArg, '--id', 'GEN-ADD-001', '--as', 'developer', '--reason', 'my reading of TICKET-9'], env);
    assert.equal(approvedAdd.code, 0, JSON.stringify(approvedAdd.out));
    assert.ok(existsSync(join(f.app, '.test-lab/cases/addendum/GEN-ADD-001.md')));
    assert.ok(!existsSync(join(f.suite, '.test-lab/cases/addendum/GEN-ADD-001.md')));
    const addTest = ['--suite', 'e2e', '--file', 'tests/addendum.spec.ts', '--title', 'addendum heading'];
    assert.equal((await cli(['adopt', '--suite-root', f.suite, ...appArg, ...addTest, '--case', 'GEN-ADD-001', '--configuration', 'desktop@1440'], env)).code, 0);
    assert.equal((await cli(['work', 'start', '--suite-root', f.suite, '--app-root', f.app, '--ticket', 'TICKET-9', '--as', 'developer', '--reason', 'heading work'], env)).code, 0);
    assert.equal((await cli(['work', 'add', '--suite-root', f.suite, '--app-root', f.app, '--ticket', 'TICKET-9', '--case', 'GEN-ADD-001', '--as', 'developer', '--reason', 'gates this work'], env)).code, 0);
    writeFileSync(join(f.dir, 'add-recipe.json'), JSON.stringify({ hypothesis: 'the heading template renders another text', technique: 'adapter', mutation: { heading: 'broken' } }));
    const addRed = await cli(['redcheck', ...run, ...addTest, '--case', 'GEN-ADD-001', '--step', 'S1', '--obligation', 'O1', '--configuration', 'desktop@1440', '--recipe', join(f.dir, 'add-recipe.json')], env);
    assert.equal(addRed.code, 0, JSON.stringify(addRed.out));
    assert.equal((await cli(['burnin', ...run, ...addTest, '--configuration', 'desktop@1440'], env)).code, 0);
    assert.equal((await cli(['accept', '--suite-root', f.suite, ...appArg, '--case', 'GEN-ADD-001', ...addTest, '--as', 'developer'], env)).code, 0);
    assert.ok(existsSync(join(f.app, '.test-lab/work/TICKET-9.json')), 'the work file sits beside the addendum');
    const withAddendum = await cli(['run', ...run], env);
    assert.equal(withAddendum.code, 0, JSON.stringify(withAddendum.out));
    const addDir = String(withAddendum.out['runDir']);
    const addPage = readFileSync(join(addDir, 'verdict.md'), 'utf8');
    assert.match(addPage, /addendum GEN-ADD-001 on desktop@1440: passed/);
    assert.match(addPage, /## Scope changes in this work\n.*start by Dana Dev \(developer\)/);

    // Graduation: proposed from the saved run, decided by QA (stand-in), which re-accepts in its own name.
    const proposed = await cli(['graduate', 'propose', '--suite-root', f.suite, ...appArg, '--case', 'GEN-ADD-001', '--run', addDir, '--reason', 'guards the heading for everyone'], env);
    assert.equal(proposed.code, 0, JSON.stringify(proposed.out));
    const decided = await cli(['graduate', 'decide', '--suite-root', f.suite, '--app-root', f.app, '--case', 'GEN-ADD-001', '--decision', 'graduated', '--as', 'qa', '--reason', 'belongs in the regression suite', '--work', 'TICKET-9'], env);
    assert.equal(decided.code, 0, JSON.stringify(decided.out));
    assert.ok(readdirSync(join(f.suite, '.test-lab/cases/regression')).includes('GEN-ADD-001.md'));
    assert.ok(!existsSync(join(f.app, '.test-lab/cases/addendum/GEN-ADD-001.md')), 'graduation moves the case into QA\'s corpus');
    const graduated = await cli(['run', ...run], env);
    assert.equal(graduated.code, 0, JSON.stringify(graduated.out));
    const gradPage = readFileSync(join(String(graduated.out['runDir']), 'verdict.md'), 'utf8');
    assert.match(gradPage, /regression GEN-ADD-001 on desktop@1440: passed/);
    assert.match(gradPage, /GEN-ADD-001: graduated by Quinn QA as QA \(stand-in\)/);
    assert.match(gradPage, /drop GEN-ADD-001 by Quinn QA \(qa, stand-in\): graduated to the regression suite/);
  } finally { await f.cleanup(); }
});
