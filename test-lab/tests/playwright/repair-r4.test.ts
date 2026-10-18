import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { execute, planSuite, probeInvocation } from '../../src/run-plan.ts';
import { computeDigests } from '../../src/digest.ts';
import { judgeBurnIn, judgeRedCheck, readLedgerRef } from '../../src/evidence.ts';
import { normalize } from '../../src/normalize.ts';
import { readInvocation, runStatus } from '../../src/run-observation.ts';
import { effectiveClassification } from '../../src/dispositions.ts';
import * as S from '../ts/support.ts';
import { stageSuite, VERSIONS, runPlaywright } from './harness.ts';

const config = "import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',testMatch:'entry.spec.ts',workers:1,projects:[{name:'desktop',use:{viewport:{width:1440,height:900},baseURL:'http://127.0.0.1:4180'}}]});";
function inputFor(root: string) {
  return { suite: 'example', config: join(root, 'playwright.config.ts'), rules: effectiveClassification([], S.ROLES).rules, environment: { ...S.ENVIRONMENT, baseUrlEnv: 'BASE_URL' }, runDir: join(root, 'plan'), reporter: join(root, 'support/test-lab/reporter.ts'), projects: ['desktop'], secretOptions: [] };
}
const identity = { suite: 'example', file: 'tests/entry.spec.ts', titlePath: ['entry'] };
const ref = { case: 'C1', step: 'S1', obligation: 'O1' };
for (const version of VERSIONS) {
  for (const acquisition of [
    "import {getBuiltinModule as builtin} from 'node:process';const load=builtin('module').createRequire(__filename);",
    "const proc=process;const {getBuiltinModule:acquire}=proc;const load=acquire('module').createRequire(__filename);",
  ]) test(`R4-1 ${version} acquired loader refuses before excluded module executes: ${acquisition}`, async () => {
    const s = stageSuite(version, { 'playwright.config.ts': config, 'tests/entry.spec.ts': `import {test} from '@playwright/test';${acquisition}load('./prod-module.cjs');test('entry',()=>{});`, 'tests/prod-module.cjs': "require('node:fs').appendFileSync(process.env.LOADED_MARKER,'LOADED');module.exports='strong';" });
    try {
      const marker = join(s.root, 'marker'), input = inputFor(s.root);
      input.rules = effectiveClassification([{ id: 'exclude', target: { suite: 'example', project: 'desktop', glob: 'tests/prod-module.cjs' }, from: null, to: 'excluded', by: S.QA, role: 'qa', standIn: true, at: '2026-10-09', reason: 'production' }], S.ROLES).rules;
      const probe = probeInvocation(input); const p = await execute(probe); assert.equal(p.status, 1, 'the config-only no-match probe must report no tests, not a successful test run');
      const begin = readInvocation({ id: probe.id, suite: 'example', dir: probe.dir }).begin; assert.ok(begin);
      const plan = planSuite(input, begin, 'discover'); if (plan.ok) await execute(plan.invocation, { inherit: { ...process.env, LOADED_MARKER: marker } });
      assert.equal(existsSync(marker), false, 'excluded acquisition executed LOADED'); assert.equal(plan.ok, false);
      if (!plan.ok) assert.match(plan.refusals.join('\n'), /capability|acquisition/);
    } finally { s.cleanup(); }
  });

  test(`R4-1 ${version} process-acquired input changes execution but never gets a resolved stale digest`, async () => {
    const s = stageSuite(version, { 'package.json': JSON.stringify({ type: 'module' }), 'playwright.config.ts': config, 'tests/entry.spec.ts': "import {test,expect} from '@playwright/test';import {getBuiltinModule as builtin} from 'node:process';const read=builtin('fs').readFileSync;test('entry',()=>{const value=read(new URL('./hidden.txt',import.meta.url),'utf8');expect(value).toBe(process.env.EXPECTED_VALUE)});", 'tests/hidden.txt': 'strong' });
    try {
      for (const value of ['strong', 'weakened']) {
        writeFileSync(join(s.root, 'tests/hidden.txt'), value);
        const run = await runPlaywright(s.root, join(s.root, value), [], { EXPECTED_VALUE: value }); assert.equal(run.status, 0, run.stdout + run.stderr);
        const obs = readInvocation({ id: value, suite: 'example', dir: run.dir }); assert.ok(obs.begin); assert.equal(obs.tests[0]?.results[0]?.status, 'passed');
        assert.equal(computeDigests({ suite: 'example', suiteRoot: s.root, begin: obs.begin, cases: new Map(), ledger: [], recipes: [], declaredInputs: [], declaredBaselines: [], kitDir: join(s.root, 'support/test-lab') }).behavior.values().next().value?.status, 'unresolved');
        assert.equal(readLedgerRef(run.dir, S.ledgerRef(run.dir, 'steps.jsonl')).ok, false);
      }
    } finally { s.cleanup(); }
  });

  test(`R4-1 ${version} acquired/reflected test API cannot certify environment A while visiting B`, async () => {
    const servers = ['A', 'B'].map(body => createServer((_q, r) => r.end(body)));
    await Promise.all(servers.map(server => new Promise<void>(done => server.listen(0, '127.0.0.1', done))));
    const urls = servers.map(server => { const addr = server.address(); assert.ok(addr && typeof addr !== 'string'); return `http://127.0.0.1:${addr.port}`; });
    const s = stageSuite(version, { 'playwright.config.ts': config.replace(S.ENVIRONMENT.baseUrl, urls[0]!), 'tests/entry.spec.ts': "import {expect} from '@playwright/test';import {appendFileSync} from 'node:fs';const proc=process;const load=proc.getBuiltinModule('module').createRequire(__filename);const api=load('@playwright/test').test;Reflect.get(api,'use')({baseURL:process.env.SCOPED_URL});appendFileSync(process.env.LOADED_MARKER!,'LOADED');api('entry',async({page})=>{await page.goto('/');expect(await page.textContent('body')).toBe(process.env.EXPECTED_BODY)});" });
    try {
      const input = inputFor(s.root); input.environment.baseUrl = urls[0]!;
      const marker = join(s.root, 'marker'), probe = probeInvocation(input); await execute(probe);
      const begin = readInvocation({ id: probe.id, suite: 'example', dir: probe.dir }).begin; assert.ok(begin);
      const plan = planSuite(input, begin, 'discover'); if (plan.ok) await execute(plan.invocation, { inherit: { ...process.env, SCOPED_URL: urls[1]!, LOADED_MARKER: marker } });
      const observations = [];
      for (const [i, url] of urls.entries()) {
        const run = await runPlaywright(s.root, join(s.root, 'bypass' + i), [], { SCOPED_URL: url, EXAMPLE_BASE_URL: urls[0]!, EXPECTED_BODY: i === 0 ? 'A' : 'B', LOADED_MARKER: join(s.root, 'bypass-marker') });
        assert.equal(run.status, 0, run.stdout + run.stderr); const obs = readInvocation({ id: 'bypass' + i, suite: 'example', dir: run.dir }); assert.ok(obs.begin); assert.equal(obs.tests[0]?.results[0]?.status, 'passed'); observations.push(obs);
      }
      assert.equal(plan.ok, false); assert.equal(existsSync(marker), false);
      for (const obs of observations) {
        assert.equal(runStatus({ invocations: [obs] }).complete, false);
        assert.ok(obs.tests[0]?.declaration.optionSafety.problems.length);
        assert.equal(computeDigests({ suite: 'example', suiteRoot: s.root, begin: obs.begin!, cases: new Map(), ledger: [], recipes: [], declaredInputs: [], declaredBaselines: [], kitDir: join(s.root, 'support/test-lab') }).behavior.values().next().value?.status, 'unresolved');
      }
    } finally { s.cleanup(); await Promise.all(servers.map(server => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())))); }
  });

  test(`R4-1 ${version} executable reflection refuses before loading and leaves bypass evidence unverified`, async () => {
    const s = stageSuite(version, { 'playwright.config.ts': config, 'tests/entry.spec.ts': "import {test,expect} from '@playwright/test';import {appendFileSync} from 'node:fs';const compile=Reflect.get(()=>{},'constructor');const value=compile('return " + '"strong"' + "')();appendFileSync(process.env.LOADED_MARKER!,'LOADED');test('entry',()=>{expect(value).toBe('strong')});" });
    try {
      const input = inputFor(s.root), probe = probeInvocation(input), marker = join(s.root, 'marker'); await execute(probe);
      const begin = readInvocation({ id: probe.id, suite: 'example', dir: probe.dir }).begin; assert.ok(begin);
      const plan = planSuite(input, begin, 'discover'); if (plan.ok) await execute(plan.invocation, { inherit: { ...process.env, LOADED_MARKER: marker } });
      const run = await runPlaywright(s.root, join(s.root, 'bypass'), [], { LOADED_MARKER: join(s.root, 'bypass-marker') }); assert.equal(run.status, 0, run.stdout + run.stderr);
      const obs = readInvocation({ id: 'bypass', suite: 'example', dir: run.dir }); assert.equal(obs.tests[0]?.results[0]?.status, 'passed');
      assert.equal(plan.ok, false); assert.equal(existsSync(marker), false); assert.equal(readLedgerRef(run.dir, S.ledgerRef(run.dir, 'steps.jsonl')).ok, false);
    } finally { s.cleanup(); }
  });

  test(`R4-2 ${version} actual early skip is accountable beside an independent passing invocation`, async () => {
    const s = stageSuite(version, { 'playwright.config.ts': config, 'tests/entry.spec.ts': "import {test,expect} from '@playwright/test';import {caseStep} from '../support/test-lab/case-step';test('entry',async({page})=>{test.skip(process.env.MODE==='skip','independent skip');if(process.env.MODE==='unknown')return;await caseStep(page,{case:'C1',step:'S1',obligation:'O1'},'O1',async()=>{expect(process.env.MODE!=='mutate').toBe(true)});});" });
    try {
      const invocations = [];
      for (const mode of ['pass', 'skip', 'mutate', 'unknown']) {
        const run = await runPlaywright(s.root, join(s.root, mode), [], { MODE: mode }); assert.equal(run.status, mode === 'mutate' ? 1 : 0, run.stdout + run.stderr);
        invocations.push(readInvocation({ id: mode, suite: 'example', dir: run.dir }));
      }
      const record = S.caseRecord('C1', 'regression', { obligations: ['O1'] }), run = { invocations: invocations.slice(0, 2) };
      assert.equal(runStatus(run).complete, true); assert.equal(invocations[1]?.tests[0]?.results[0]?.status, 'skipped'); assert.equal(invocations[1]?.tests[0]?.results[0]?.steps.filter(s => s.ids !== null).length, 0);
      const norm = normalize({ run, configurations: S.CONFIGS, cases: new Map([['C1', record]]), required: { regression: ['C1'], addendum: [] }, ledger: [{ obligation: ref, test: identity, configuration: 'desktop@1440', layer: 'served' }], classification: [], liveQuarantines: [], quarantinesOnRequired: [], roleOverrideFiles: new Set() });
      const recipes = join(s.root, 'recipes'), red = S.redCheck(s.root, recipes, ref, identity, 'desktop@1440', { mutated: 'mutate/steps.jsonl', restored: 'pass/steps.jsonl' });
      assert.equal(judgeRedCheck(s.root, red, S.CONFIGS[0]!, false, recipes), null);
      // Real repeat-each represents separate occurrences of the same test in one receipt.
      const repeated = await runPlaywright(s.root, join(s.root, 'repeats'), ['--repeat-each=5'], { MODE: 'pass' }); assert.equal(repeated.status, 0);
      assert.equal(judgeBurnIn(s.root, S.burnIn(s.root, identity, 'desktop@1440', 'repeats/steps.jsonl'), S.CONFIGS[0]!, false, [ref]), null);
      assert.notEqual(judgeRedCheck(s.root, { ...red, restored: S.ledgerRef(s.root, 'unknown/steps.jsonl') }, S.CONFIGS[0]!, false, recipes), null);
      assert.equal(norm.required[0]?.outcome, 'skipped'); assert.equal(norm.tests[1]?.lane, 'required-regression');
    } finally { s.cleanup(); }
  });

  test(`R4-3 ${version} shared safe config allows desktop while excluding independent prod, but rejects helper paths`, async () => {
    const shared = "import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',workers:1,projects:[{name:'desktop',testMatch:'entry.spec.ts'},{name:'prod',testMatch:'prod.spec.ts'}]});";
    const s = stageSuite(version, { 'playwright.config.ts': shared, 'tests/entry.spec.ts': "import {test} from '@playwright/test';test('entry',()=>{});", 'tests/prod.spec.ts': "import {test} from '@playwright/test';import {appendFileSync} from 'node:fs';appendFileSync(process.env.LOADED_MARKER!,'LOADED');test('prod',()=>{});", 'prod-helper.ts': "import {appendFileSync} from 'node:fs';appendFileSync(process.env.LOADED_MARKER!,'LOADED');" });
    try {
      const input = inputFor(s.root), marker = join(s.root, 'marker');
      input.rules = effectiveClassification([{ id: 'prod', target: { suite: 'example', project: 'prod' }, from: null, to: 'excluded', by: S.QA, role: 'qa', standIn: true, at: '2026-10-09', reason: 'production' }], S.ROLES).rules;
      const probe = probeInvocation(input), p = await execute(probe, { inherit: { ...process.env, LOADED_MARKER: marker } }); assert.equal(p.status, 1, 'config-only probe selects zero tests');
      const begin = readInvocation({ id: probe.id, suite: 'example', dir: probe.dir }).begin; assert.ok(begin); assert.equal(begin.tests.length, 0);
      const plan = planSuite(input, begin); assert.equal(plan.ok, true); if (!plan.ok) return;
      const actual = await execute(plan.invocation, { inherit: { ...process.env, LOADED_MARKER: marker } }); assert.equal(actual.status, 0, actual.stdout + actual.stderr);
      const obs = readInvocation({ id: plan.invocation.id, suite: 'example', dir: plan.invocation.dir }); assert.deepEqual(obs.tests.map(t => t.declaration.project), ['desktop']); assert.equal(existsSync(marker), false);
      assert.equal(planSuite({ ...input, projects: ['prod'] }, begin).ok, false);
      assert.equal(planSuite(input, { ...begin, projects: begin.projects.map(p => p.name === 'desktop' ? { ...p, dependencies: ['prod'] } : p) }).ok, false);
      writeFileSync(join(s.root, 'playwright.config.ts'), "import './prod-helper';" + shared);
      input.rules.push(...effectiveClassification([{ id: 'helper', target: { suite: 'example', project: 'prod', glob: 'prod-helper.ts' }, from: null, to: 'excluded', by: S.QA, role: 'qa', standIn: true, at: '2026-10-09', reason: 'production helper' }], S.ROLES).rules);
      assert.throws(() => probeInvocation(input), /prod-helper.*excluded module/); assert.equal(existsSync(marker), false);
      assert.equal(JSON.parse(readFileSync(join(s.root, 'support/test-lab/node_modules/typescript/package.json'), 'utf8')).version, '6.0.3');
    } finally { s.cleanup(); }
  });
}
