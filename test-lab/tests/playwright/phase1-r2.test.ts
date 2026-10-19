// Phase 1, review round 2, on the local fixture site through the public CLI: one test carrying two
// obligations (the page title, then the heading), each red-checked against its own application-side
// fault, then burned in and accepted with no reverify in between. A red check refused before it runs
// leaves no recipe and does not turn a ready verdict inconclusive. The handoff on a ready page labels a
// refused waiver and a stale acceptance as not counted, never as if they counted.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { canonicalCaseHash } from '../../src/cases.ts';
import { caseRecord } from '../ts/support.ts';
import { setupCoordinator, writeJson } from '../fixtures/coordinator.ts';

const exec = promisify(execFile);
const CLI = join(import.meta.dirname, '../../src/cli.ts');
type Out = { code: number; out: Record<string, unknown> };
async function cli(args: string[], env: Record<string, string> = {}): Promise<Out> {
  try {
    const r = await exec(process.execPath, [CLI, ...args], { timeout: 300_000, env: { ...process.env, ...env } });
    return { code: 0, out: JSON.parse(r.stdout.trim()) as Record<string, unknown> };
  } catch (e) {
    const r = e as { code: number; stdout: string; stderr: string; signal?: string };
    if (typeof r.code !== 'number') throw new Error(`${args.slice(0, 2).join(' ')} did not finish (${r.signal ?? 'no exit code'}): ${r.stderr}`);
    return { code: r.code, out: r.stdout.trim() ? JSON.parse(r.stdout.trim()) as Record<string, unknown> : { stderr: r.stderr } };
  }
}

test('two obligations on one test: red-checked, burned in and accepted with no reverify; refusals leave no trace; the handoff is the verdict\'s judgment', { timeout: 1_200_000 }, async () => {
  const f = await setupCoordinator('1.60.0', {
    prepare: async (suite) => {
      const record = caseRecord('REG-1', 'regression', { obligations: ['O1', 'O2'] });
      record.fixture = 'home';
      record.approval!.hash = canonicalCaseHash(record);
      writeJson(join(suite, '.test-lab/cases/regression/REG-1.json'), record);
      const t = { suite: 'e2e', file: 'tests/home.spec.ts', titlePath: ['heading'] };
      writeJson(join(suite, '.test-lab/ledger.json'), { schema: 1, mappings: ['O1', 'O2'].map((o) => ({ obligation: { case: 'REG-1', step: 'S1', obligation: o }, test: t, configuration: 'desktop@1440', layer: 'served' })) });
      writeFileSync(join(suite, 'tests/home.spec.ts'), `import {test,expect} from '@playwright/test';import {bindCase,caseStep} from '../support/test-lab/case-step';import {registerActorProbe} from '../support/test-lab/actor-probe';registerActorProbe({path:'actor',roleField:'role'});test('heading',bindCase('REG-1'),async({page})=>{await page.goto('/');await caseStep(page,{case:'REG-1',step:'S1',obligation:'O1'},'title',async()=>{await expect(page).toHaveTitle('Generic fixture');});await caseStep(page,{case:'REG-1',step:'S1',obligation:'O2'},'heading',async()=>{await expect(page.getByRole('heading')).toHaveText('Generic fixture');});});`);
    },
  });
  const env = { TEST_LAB_DATA: join(f.dir, 'journal-data') };
  try {
    await f.g(f.suite, ['config', 'user.name', 'Quinn QA']);
    const run = ['--suite-root', f.suite, '--app-root', f.app, '--env', 'local', '--adapter', join(f.suite, 'adapter.ts')];
    const reg = ['--suite', 'e2e', '--file', 'tests/home.spec.ts', '--title', 'heading'];
    const ob = (o: string) => ['--case', 'REG-1', '--step', 'S1', '--obligation', o, '--configuration', 'desktop@1440'];
    const recipes = () => readdirSync(join(f.suite, '.test-lab/recipes')).filter((n) => n.endsWith('.json')).sort();
    writeFileSync(join(f.dir, 'title.json'), JSON.stringify({ hypothesis: 'the page title template regresses', technique: 'adapter', mutation: { target: 'title' } }));
    writeFileSync(join(f.dir, 'heading.json'), JSON.stringify({ hypothesis: 'the heading template regresses', technique: 'adapter', mutation: { target: 'heading' } }));
    writeFileSync(join(f.dir, 'other.json'), JSON.stringify({ hypothesis: 'another heading fault', technique: 'adapter', mutation: { target: 'heading', variant: 2 } }));
    writeFileSync(join(f.dir, 'wrong-adapter.ts'), `console.log(JSON.stringify({schema:1,appRoot:${JSON.stringify(f.suite)},exists:true,published:true,structureObservation:null,status:'[]',lastImportAt:null}));`);
    const wrong = ['--suite-root', f.suite, '--app-root', f.app, '--env', 'local', '--adapter', join(f.dir, 'wrong-adapter.ts')];

    // A red check refused before it runs (the site serves the wrong root) writes no recipe.
    const seeded = recipes();
    const refusedFirst = await cli(['redcheck', ...wrong, ...reg, ...ob('O1'), '--recipe', join(f.dir, 'title.json')], env);
    assert.equal(refusedFirst.code, 4);
    assert.deepEqual(recipes(), seeded, 'a refused attempt leaves no recipe');

    // Each obligation against its own fault, one after the other, then a burn-in and QA acceptance. No
    // reverify: the second red check does not stale the first.
    const red1 = await cli(['redcheck', ...run, ...reg, ...ob('O1'), '--recipe', join(f.dir, 'title.json')], env);
    assert.equal(red1.code, 0, JSON.stringify(red1.out));
    const red2 = await cli(['redcheck', ...run, ...reg, ...ob('O2'), '--recipe', join(f.dir, 'heading.json')], env);
    assert.equal(red2.code, 0, JSON.stringify(red2.out));
    const digests = ['red1', 'red2'].map((_, i) => (JSON.parse(readFileSync(join(f.suite, String([red1, red2][i]!.out['record'])), 'utf8')) as { behaviorDigest: string }).behaviorDigest);
    assert.equal(digests[0], digests[1], 'both red checks are at the same behavior digest');
    assert.equal((await cli(['burnin', ...run, ...reg, '--configuration', 'desktop@1440'], env)).code, 0);
    const accepted = await cli(['accept', '--suite-root', f.suite, '--case', 'REG-1', ...reg, '--as', 'qa'], env);
    assert.equal(accepted.code, 0, JSON.stringify(accepted.out));
    const green = await cli(['run', ...run, '--no-work'], env);
    assert.equal(green.out['verdict'], 'ready', JSON.stringify(green.out));

    // A refused attempt with a new recipe, after the verdict was green: no recipe, still ready.
    const afterGreen = recipes();
    const refused = await cli(['redcheck', ...wrong, ...reg, ...ob('O2'), '--recipe', join(f.dir, 'other.json')], env);
    assert.equal(refused.code, 4);
    assert.deepEqual(recipes(), afterGreen);
    const still = await cli(['run', ...run, '--no-work'], env);
    assert.equal(still.out['verdict'], 'ready', JSON.stringify(still.out));

    // A waiver recorded in the QA role by someone the trusted base doesn't list, and an acceptance for an
    // earlier behavior digest. The verdict refuses both; the handoff must say so, on a ready page.
    const evidenceDir = join(f.suite, '.test-lab/evidence');
    const current = readdirSync(evidenceDir).find((n) => n.startsWith('accept-REG-1-'))!;
    const stale = { ...(JSON.parse(readFileSync(join(evidenceDir, current), 'utf8')) as Record<string, unknown>), id: 'accept-REG-1-stale', behaviorDigest: `sha256:${'0'.repeat(64)}`, at: '2026-10-01T00:00:00.000Z' };
    writeJson(join(evidenceDir, 'accept-REG-1-stale.json'), stale);
    const dispositions = JSON.parse(readFileSync(join(f.suite, '.test-lab/dispositions.json'), 'utf8')) as { schema: 1; records: unknown[] };
    const record = JSON.parse(readFileSync(join(f.suite, '.test-lab/cases/regression/REG-1.json'), 'utf8')) as Parameters<typeof canonicalCaseHash>[0];
    dispositions.records.push({ kind: 'sensitivity-waived', id: 'waive-REG-1-S1-O1-dana', case: 'REG-1', step: 'S1', obligation: 'O1', caseHash: canonicalCaseHash(record), by: 'Dana Dev', role: 'qa', standIn: false, at: '2026-10-18T00:00:00.000Z', reason: 'no faithful mutation' });
    writeJson(join(f.suite, '.test-lab/dispositions.json'), dispositions);
    const page = await cli(['run', ...run, '--no-work'], env);
    assert.equal(page.out['verdict'], 'ready', JSON.stringify(page.out));
    const md = readFileSync(join(String(page.out['runDir']), 'verdict.md'), 'utf8');
    const lines = md.split('\n');
    const staleLine = lines.find((l) => l.includes('accepted by') && l.includes('on 2026-10-01'));
    assert.ok(staleLine, md);
    assert.match(staleLine, /not counted: the test changed since it was accepted/);
    const currentLine = lines.find((l) => l.includes('accepted by') && !l.includes('on 2026-10-01'));
    assert.match(String(currentLine), /counted as current on desktop@1440/);
    const waiverLine = lines.find((l) => l.includes('waived by Dana Dev'));
    assert.ok(waiverLine, md);
    assert.match(waiverLine, /not counted: /);
    assert.doesNotMatch(waiverLine, /counted as waived/);
  } finally { await f.cleanup(); }
});
