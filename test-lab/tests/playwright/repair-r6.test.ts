import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { behaviorKey, computeDigests } from '../../src/digest.ts';
import { evaluateCase } from '../../src/evidence.ts';
import { effectiveClassification } from '../../src/dispositions.ts';
import { execute, planSuite, probeInvocation } from '../../src/run-plan.ts';
import { readInvocation, runStatus } from '../../src/run-observation.ts';
import { runPlaywright, stageSuite, VERSIONS } from './harness.ts';
import * as S from '../ts/support.ts';

const config = "import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',testMatch:'entry.spec.ts',workers:1,use:{baseURL:process.env.BASE_URL},projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}}]});";
const identity = { suite: 'example', file: 'tests/entry.spec.ts', titlePath: ['entry'] };
const ref = { case: 'C1', step: 'S1', obligation: 'O1' };
for (const version of VERSIONS) {
  test(`R6-1 ${version} actual invocation env changes assertion behavior without certifying evidence`, async () => {
    const s = stageSuite(version, {
      'playwright.config.ts': config,
      'tests/entry.spec.ts': "import {test,expect} from '@playwright/test';import {expected} from './expected';import {caseStep} from '../support/test-lab/case-step';test('entry',async({page})=>{await caseStep(page,{case:'C1',step:'S1',obligation:'O1'},'O1',async()=>{expect('Georgia').toBe(expected())})});",
      'tests/expected.ts': "import {env as environment} from 'node:process';export const expected=()=>environment.EXPECTED_FONT;",
    });
    const parent = process.env['EXPECTED_FONT'];
    try {
      process.env['EXPECTED_FONT'] = 'parent-value-must-not-be-certified';
      const reports = [];
      for (const [i, value] of ['Georgia', 'Arial', '', undefined].entries()) {
        const invocation = await runPlaywright(s.root, join(s.root, 'env-' + i), [], { BASE_URL: S.ENVIRONMENT.baseUrl, ...(value === undefined ? {} : { EXPECTED_FONT: value }) });
        assert.equal(invocation.status, i === 0 ? 0 : 1, invocation.stdout + invocation.stderr);
        const observation = readInvocation({ id: String(i), suite: 'example', dir: invocation.dir });
        assert.ok(observation.begin);
        assert.equal(runStatus({ invocations: [observation] }).complete, true);
        assert.equal(observation.tests[0]?.results[0]?.status, i === 0 ? 'passed' : 'failed');
        assert.equal(observation.begin.projects[0]?.use['baseURL'], S.ENVIRONMENT.baseUrl);
        reports.push(computeDigests({ suite: 'example', suiteRoot: s.root, begin: observation.begin, cases: new Map(), ledger: [], recipes: [], declaredInputs: [], declaredBaselines: [], kitDir: join(s.root, 'support/test-lab') }));
      }
      const first = reports[0]!, d = first.behavior.get(behaviorKey(identity, 'desktop'));
      const old = d?.status === 'resolved' ? d.digest : 'sha256:pre-r6-value-blind';
      assert.equal(first.toolchain.status, 'resolved'); if (first.toolchain.status !== 'resolved') return;
      const record = S.caseRecord('C1', 'regression', { obligations: ['O1'] }), recipesDir = join(s.root, 'recipes');
      const paths = S.writeEvidenceLedgers(s.root, 'C1', identity, 'desktop@1440', { obligations: ['O1'] });
      const bindings = { behaviorDigest: old, toolchainDigest: first.toolchain.digest };
      const records = [S.redCheck(s.root, recipesDir, ref, identity, 'desktop@1440', paths, bindings), S.burnIn(s.root, identity, 'desktop@1440', paths.burn, bindings), S.acceptance(record, identity, bindings)];
      for (const report of reports) {
        const evidence = evaluateCase(record, 'regression', { evidenceDir: s.root, recipesDir, records, digests: report, environment: S.ENVIRONMENT, effective: S.effective(), configurations: S.CONFIGS, ledger: [{ obligation: ref, test: identity, configuration: 'desktop@1440', layer: 'served' }], dispositions: [], roles: S.ROLES, materialFields: ['browserName'] });
        assert.equal(evidence.status, 'insufficient');
        assert.equal(evidence.mappings[0]?.acceptance, 'stale');
        assert.equal(report.behavior.get(behaviorKey(identity, 'desktop'))?.status, 'unresolved');
        assert.ok(!JSON.stringify(report).includes('parent-value-must-not-be-certified'));
      }
    } finally { if (parent === undefined) delete process.env['EXPECTED_FONT']; else process.env['EXPECTED_FONT'] = parent; s.cleanup(); }
  });

  test(`R6-2 ${version} erased local/external types permit discovery and never load excluded helper`, async () => {
    const s = stageSuite(version, {
      'playwright.config.ts': config.replace('process.env.BASE_URL', JSON.stringify(S.ENVIRONMENT.baseUrl)),
      'tests/entry.spec.ts': "import {test,expect} from '@playwright/test';import type {Foo} from './excluded-helper';import type FooDefault from './excluded-helper';import type * as FooNamespace from './excluded-helper';import type FooEquals = require('./excluded-helper');import type {Stats} from 'node:fs';import type {BrowserContext} from 'playwright-core';import type {ReactNode} from 'ordinary-external-types';import {type Foo as Named} from './excluded-helper';export type {Foo as Exported} from './excluded-helper';export {type Foo as MixedType} from './excluded-helper';export type * from './excluded-helper';test('entry',()=>{const value:Foo={label:'safe'};expect(value.label).toBe('safe')});",
      'tests/excluded-helper.ts': "import {appendFileSync} from 'node:fs';appendFileSync(process.env.LOADED_MARKER!,'LOADED');export interface Foo{label:string};export const runtime='loaded';",
    });
    try {
      const marker = join(s.root, 'marker');
      // Observe public transpilation independently of the planner's own source analysis.
      const raw = await runPlaywright(s.root, join(s.root, 'raw'), [], { BASE_URL: S.ENVIRONMENT.baseUrl, LOADED_MARKER: marker });
      assert.equal(raw.status, 0, raw.stdout + raw.stderr); assert.equal(existsSync(marker), false);
      const rules = effectiveClassification([{ id: 'helper', target: { suite: 'example', glob: 'tests/excluded-helper.ts' }, from: null, to: 'excluded', by: S.QA, role: 'qa', standIn: true, at: '2026-10-09', reason: 'fixture helper excluded from runtime' }], S.ROLES).rules;
      const input = { suite: 'example', config: join(s.root, 'playwright.config.ts'), rules, environment: { ...S.ENVIRONMENT, baseUrlEnv: 'BASE_URL' }, runDir: join(s.root, 'planned'), reporter: join(s.root, 'support/test-lab/reporter.ts'), projects: ['desktop'], secretOptions: [] };
      const probe = probeInvocation(input); await execute(probe);
      const begin = readInvocation({ id: probe.id, suite: 'example', dir: probe.dir }).begin; assert.ok(begin);
      const plan = planSuite(input, begin); assert.equal(plan.ok, true, JSON.stringify(plan)); if (!plan.ok) return;
      const done = await execute(plan.invocation, { inherit: { ...process.env, LOADED_MARKER: marker } });
      assert.equal(done.status, 0, done.stdout + done.stderr); assert.equal(existsSync(marker), false);
      const obs = readInvocation({ id: plan.invocation.id, suite: 'example', dir: plan.invocation.dir });
      assert.equal(runStatus({ invocations: [obs] }).complete, true);
      assert.ok(obs.begin);
      const digest = computeDigests({ suite: 'example', suiteRoot: s.root, begin: obs.begin, cases: new Map(), ledger: [], recipes: [], declaredInputs: [], declaredBaselines: [], kitDir: join(s.root, 'support/test-lab') }).behavior.get(behaviorKey(identity, 'desktop'));
      assert.equal(digest?.status, 'resolved');
      assert.equal(JSON.parse(readFileSync(join(s.root, 'support/test-lab/node_modules/typescript/package.json'), 'utf8')).version, '6.0.3');
      // A real value in a mixed declaration restores the dependency and its path exclusion.
      for (const declaration of ["import {type Foo,runtime} from './excluded-helper';console.log(runtime);", "export {type Foo,runtime} from './excluded-helper';"]) {
        writeFileSync(join(s.root, 'tests/entry.spec.ts'), "import {test} from '@playwright/test';" + declaration + "test('entry',()=>{});");
        const mixed = planSuite(input, begin, 'discover'); assert.equal(mixed.ok, false);
        assert.ok(!mixed.ok && mixed.refusals.some(r => /excluded module/.test(r)));
        assert.equal(existsSync(marker), false);
      }
    } finally { s.cleanup(); }
  });
}
