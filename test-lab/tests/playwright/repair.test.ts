import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { effectiveClassification } from '../../src/dispositions.ts';
import { judgeBurnIn } from '../../src/evidence.ts';
import { sha256 } from '../../src/canonical.ts';
import { execute, planSuite, probeInvocation } from '../../src/run-plan.ts';
import { readInvocation } from '../../src/run-observation.ts';
import { stageSuite, VERSIONS, runPlaywright } from './harness.ts';
import { CONFIGS, ROLES, QA, burnIn } from '../ts/support.ts';

for (const version of VERSIONS) {
  test(`R1-1 ${version} heterogeneous exclusions refuse before module loading`, async () => {
    const s = stageSuite(version, {
      'playwright.config.ts': "import {defineConfig} from '@playwright/test'; export default defineConfig({testDir:'./tests',projects:[{name:'desktop'},{name:'mobile'}]});",
      'tests/prod.spec.ts': "import {test} from '@playwright/test'; import {appendFileSync} from 'node:fs'; appendFileSync(process.env.LOADED_MARKER!, 'LOADED'); test('production',()=>{});",
    });
    try {
      const marker = join(s.root, 'loaded');
      const rules = effectiveClassification([{ id: 'exclude', target: {suite:'example',project:'desktop',glob:'tests/prod.spec.ts'}, from:null,to:'excluded',by:QA,role:'qa',standIn:true,at:'2026-10-09',reason:'production'}], ROLES).rules;
      const input = {suite:'example',config:join(s.root,'playwright.config.ts'),rules,environment:{id:'local',kind:'local-candidate' as const,baseUrl:'http://127.0.0.1:4180',baseUrlEnv:'BASE_URL'},runDir:join(s.root,'run'),reporter:join(s.root,'support/test-lab/reporter.ts'),projects:['desktop','mobile'],secretOptions:[]};
      const probe = probeInvocation(input);
      await execute(probe, {inherit:{...process.env, LOADED_MARKER:marker}});
      const begin = readInvocation({id:probe.id,suite:'example',dir:probe.dir}).begin;
      assert.ok(begin);
      const plan = planSuite(input, begin, 'discover');
      if (plan.ok) await execute(plan.invocation, {inherit:{...process.env,LOADED_MARKER:marker}});
      assert.equal(existsSync(marker), false, 'an unsafe discovery loaded the excluded production module');
      assert.equal(plan.ok, false, 'heterogeneous per-project file filters require separate invocations');
    } finally { s.cleanup(); }
  });

  test(`R1-1 ${version} caller file arguments cannot widen exclusion filters`, async () => {
    const s = stageSuite(version, {
      'playwright.config.ts': "import {defineConfig} from '@playwright/test'; export default defineConfig({testDir:'./tests',projects:[{name:'desktop'}]});",
      'tests/prod.spec.ts': "import {test} from '@playwright/test'; import {appendFileSync} from 'node:fs'; appendFileSync(process.env.LOADED_MARKER!, 'LOADED'); test('production',()=>{});",
    });
    try {
      const marker=join(s.root,'loaded');
      const rules=effectiveClassification([{id:'exclude',target:{suite:'example',glob:'tests/prod.spec.ts'},from:null,to:'excluded',by:QA,role:'qa',standIn:true,at:'2026-10-09',reason:'production'}],ROLES).rules;
      const input={suite:'example',config:join(s.root,'playwright.config.ts'),rules,environment:{id:'local',kind:'local-candidate' as const,baseUrl:'http://127.0.0.1:4180',baseUrlEnv:'BASE_URL'},runDir:join(s.root,'run'),reporter:join(s.root,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[],extraArgs:['tests/prod.spec.ts']};
      const probe=probeInvocation(input);
      await execute(probe,{inherit:{...process.env,LOADED_MARKER:marker}});
      const begin=readInvocation({id:probe.id,suite:'example',dir:probe.dir}).begin;
      assert.ok(begin);
      const plan=planSuite(input,begin,'discover');
      if(plan.ok) await execute(plan.invocation,{inherit:{...process.env,LOADED_MARKER:marker}});
      assert.equal(existsSync(marker),false,'caller arguments widened the permitted file filters');
      assert.equal(plan.ok,false);
    } finally {s.cleanup();}
  });

  test(`R1-8 ${version} real five-repeat teardown-error burn-in is refused`, async () => {
    const s = stageSuite(version, {
      'playwright.config.ts': "import {defineConfig} from '@playwright/test'; export default defineConfig({testDir:'./tests',testMatch:'clean.spec.ts',workers:1,globalTeardown:'./support/global-teardown.ts',projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}}]});",
      'tests/clean.spec.ts': "import {test} from '@playwright/test'; import {caseStep} from '../support/test-lab/case-step'; test('clean',async ({page})=>{ await caseStep(page,{case:'C1',step:'S1',obligation:'O1'},'target',async()=>{}); });",
    });
    try {
      const dir = join(s.root,'burn');
      const run = await runPlaywright(s.root, dir, ['--repeat-each','5','--fail-on-flaky-tests'], {EXAMPLE_TEARDOWN_THROWS:'1'});
      assert.equal(run.status, 1, run.stdout+run.stderr);
      const obs = readInvocation({id:'burn',suite:'example',dir});
      assert.equal(obs.completion?.finalStatus, 'failed');
      assert.ok(obs.errors.length > 0);
      assert.equal(obs.tests.length, 5);
      const record = burnIn(dir, {suite:'example',file:'tests/clean.spec.ts',titlePath:['clean']}, 'desktop@1440','steps.jsonl');
      assert.equal(record.run.sha256, sha256(readFileSync(join(dir,'steps.jsonl'))));
      assert.notEqual(judgeBurnIn(dir, record, CONFIGS[0]!, false, [{case:'C1',step:'S1',obligation:'O1'}]), null);
    } finally { s.cleanup(); }
  });
}
