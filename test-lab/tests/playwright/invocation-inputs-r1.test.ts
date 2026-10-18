import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type EnvironmentInputDeclaration } from '../../kit/environment-inputs.ts';
import { sha256 } from '../../src/canonical.ts';
import { canonicalCaseHash } from '../../src/cases.ts';
import { behaviorKey, computeDigests, effectiveConfig } from '../../src/digest.ts';
import { evaluateCase, readLedgerRef } from '../../src/evidence.ts';
import type { EvidenceRecord } from '../../src/model.ts';
import { browsersOf, readInvocation, runStatus } from '../../src/run-observation.ts';
import { execute, planSuite, probeInvocation, type SuitePlanInput } from '../../src/run-plan.ts';
import { startSite } from '../fixtures/site/server.ts';
import * as S from '../ts/support.ts';
import { stageSuite, VERSIONS } from './harness.ts';

for (const version of VERSIONS) test(`invocation R1 ${version} mixed suite certifies independent behavior and retains begin faults`, async () => {
  const site = await startSite();
  const declarations: EnvironmentInputDeclaration[] = [{name:'EXPECTED_FONT',classification:'nonsecret',readers:['tests/font.spec.ts']}];
  const independent = {suite:'example',file:'tests/rows.spec.ts',titlePath:['rows']};
  const dependent = {suite:'example',file:'tests/font.spec.ts',titlePath:['font']};
  const s = stageSuite(version, {
    'playwright.config.ts': `import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',testMatch:['rows.spec.ts','font.spec.ts'],workers:1,projects:[{name:'desktop',use:{baseURL:'${site.url}',viewport:{width:1440,height:900}}}]});`,
    'tests/rows.spec.ts': "import {test,expect} from '@playwright/test';import {caseStep} from '../support/test-lab/case-step';test('rows',async({page})=>{await page.goto('/accordion');await caseStep(page,{case:'C1',step:'S1',obligation:'O1'},'rows font',async()=>{await expect(page.locator('.accordion__item').first()).toHaveCSS('font-family',/Arial/)})});",
    'tests/font.spec.ts': "import {test,expect} from '@playwright/test';test('font',async({page})=>{await page.goto('/accordion');await expect(page.locator('.accordion__title')).toHaveCSS('font-family',new RegExp(process.env.EXPECTED_FONT!))});",
  });
  try {
    const input = (label:string,value:string):SuitePlanInput => ({suite:'example',config:join(s.root,'playwright.config.ts'),rules:[],environment:{...S.ENVIRONMENT,baseUrl:site.url,baseUrlEnv:'BASE_URL'},runDir:join(s.root,label),reporter:join(s.root,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[],declaredEnvironmentInputs:declarations,environmentValues:{EXPECTED_FONT:{state:'set',value}}});
    const run = async (label:string,value:string,repeats=1) => {
      const request = {...input(label,value),extraArgs:repeats===1?[]:['--repeat-each',String(repeats),'--fail-on-flaky-tests']};
      const probe = probeInvocation(request), probed = await execute(probe), begin = readInvocation(probe).begin;
      assert.ok(begin,probed.stdout+probed.stderr);
      const plan = planSuite(request,begin); assert.ok(plan.ok,JSON.stringify(plan));
      const done = await execute(plan.invocation), obs = readInvocation(plan.invocation);
      assert.ok(obs.begin,done.stdout+done.stderr); assert.deepEqual(obs.problems,[]);
      return {done,obs,inv:plan.invocation};
    };
    const report = (obs:ReturnType<typeof readInvocation>) => {
      assert.ok(obs.begin);
      return computeDigests({suite:'example',suiteRoot:s.root,begin:obs.begin,cases:new Map(),ledger:[],recipes:[],declaredInputs:[],declaredEnvironmentInputs:declarations,declaredBaselines:[],kitDir:join(s.root,'support/test-lab')});
    };
    const restored = await run('restored','Georgia'); assert.equal(restored.done.status,0,restored.done.stdout+restored.done.stderr);
    const burn = await run('burn','serif',5); assert.equal(burn.done.status,0,burn.done.stdout+burn.done.stderr);
    site.setAccordionMutation('rows');
    const mutated = await run('mutated','serif'); site.setAccordionMutation('');
    assert.equal(mutated.done.status,1); assert.equal(runStatus({invocations:[mutated.obs]}).complete,true);
    const digests = report(restored.obs), d = digests.behavior.get(behaviorKey(independent,'desktop'));
    assert.ok(d?.status==='resolved',JSON.stringify(d)); assert.deepEqual(d.environmentInputs,{declarations,bindings:[]});
    const used = digests.behavior.get(behaviorKey(dependent,'desktop')); assert.ok(used?.status==='resolved');
    const changed = await run('changed','serif'); assert.equal(changed.done.status,0,changed.done.stdout+changed.done.stderr);
    const later = report(changed.obs), laterUsed = later.behavior.get(behaviorKey(dependent,'desktop')), laterIndependent = later.behavior.get(behaviorKey(independent,'desktop'));
    assert.ok(laterUsed?.status==='resolved'); assert.notEqual(used.digest,laterUsed.digest);
    assert.ok(laterIndependent?.status==='resolved'); assert.equal(d.digest,laterIndependent.digest);
    assert.ok(digests.toolchain.status==='resolved');
    const evidenceDir = join(s.root,'.test-lab/evidence'), recipesDir = join(s.root,'.test-lab/recipes');
    mkdirSync(evidenceDir,{recursive:true}); mkdirSync(recipesDir,{recursive:true});
    const keep = (inv:{dir:string},name:string) => {copyFileSync(join(inv.dir,'steps.jsonl'),join(evidenceDir,name));return S.ledgerRef(evidenceDir,name);};
    const mutatedRef = keep(mutated.inv,'mutated.jsonl'), restoredRef = keep(restored.inv,'restored.jsonl'), burnRef = keep(burn.inv,'burn.jsonl');
    const record = S.caseRecord('C1','regression',{obligations:['O1']}), mapping = {obligation:{case:'C1',step:'S1',obligation:'O1'},test:independent,configuration:'desktop@1440',layer:'served' as const};
    const recipe = JSON.stringify({format:1,obligation:mapping.obligation,technique:'seeded-site-mutant',mutation:'rows'}), recipeHash = sha256(recipe);
    writeFileSync(join(recipesDir,recipeHash+'.json'),recipe);
    const bound = {behaviorDigest:d.digest,toolchainDigest:digests.toolchain.digest,environment:{...S.ENVIRONMENT,baseUrl:site.url},appliesTo:[],at:'2026-10-09'};
    const records:EvidenceRecord[] = [
      {kind:'red-check',id:'red',test:independent,configuration:'desktop@1440',obligation:mapping.obligation,recipeHash:'sha256:'+recipeHash,mutated:mutatedRef,restored:restoredRef,...bound},
      {kind:'burn-in',id:'burn',test:independent,configuration:'desktop@1440',run:burnRef,...bound},
      {kind:'acceptance',id:'accept',test:independent,case:'C1',caseHash:canonicalCaseHash(record),behaviorDigest:d.digest,by:S.QA,role:'qa',standIn:true,at:'2026-10-09'},
    ];
    const ctx = {evidenceDir,recipesDir,records,digests,environment:bound.environment,effective:effectiveConfig(restored.obs.begin!,browsersOf(restored.obs)),configurations:S.CONFIGS,ledger:[mapping],dispositions:[],roles:S.ROLES,materialFields:['browserName' as const]};
    assert.equal(evaluateCase(record,'regression',ctx).status,'verified');
    const reevaluated = evaluateCase(record,'regression',{...ctx,digests:later});
    assert.equal(reevaluated.status,'verified',JSON.stringify(reevaluated));
    const dependentRecord = S.caseRecord('C2','regression',{obligations:['O1']});
    const dependentContext = {...ctx,records:[S.acceptance(dependentRecord,dependent,{behaviorDigest:used.digest})],ledger:[{...mapping,obligation:{case:'C2',step:'S1',obligation:'O1'},test:dependent}]};
    assert.equal(evaluateCase(dependentRecord,'regression',dependentContext).mappings[0]?.acceptance,'current');
    assert.equal(evaluateCase(dependentRecord,'regression',{...dependentContext,digests:later}).mappings[0]?.acceptance,'stale');
    // Ordinary reporter read failures at begin cannot be erased by its clean final observation.
    for (const fault of ['missing-coordinator','diagnostic'] as const) {
      const name = fault+'.jsonl', file = join(evidenceDir,name);
      const rows = readFileSync(join(evidenceDir,'mutated.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
      if (fault==='missing-coordinator') rows[0].environmentInputs.processes=[];
      else rows[0].environmentInputs.problems=['missing or unreadable pre-load environment observation'];
      writeFileSync(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
      const badRef = S.ledgerRef(evidenceDir,name), bad = readInvocation({...mutated.inv,suite:'example'},file);
      assert.ok(bad.tests.some(t=>t.declaration.file===independent.file&&t.results[0]?.status==='failed'));
      assert.equal(runStatus({invocations:[bad]}).complete,false);
      assert.equal(readLedgerRef(evidenceDir,badRef).ok,false);
      assert.equal(report(bad).behavior.get(behaviorKey(independent,'desktop'))?.status,'unresolved');
      const evaluation = evaluateCase(record,'regression',{...ctx,records:records.map(r=>r.kind==='red-check'?{...r,mutated:badRef}:r)});
      assert.equal(evaluation.mappings[0]?.sensitivity,'unverified');
    }
  } finally {s.cleanup();await site.close();}
});
