import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { behaviorKey, computeDigests } from '../../src/digest.ts';
import { execute, planSuite, probeInvocation } from '../../src/run-plan.ts';
import { readInvocation } from '../../src/run-observation.ts';
import { stageSuite, VERSIONS } from './harness.ts';
import * as S from '../ts/support.ts';

const declarations = [
  { name: 'BASE_URL', classification: 'nonsecret' as const, readers: ['playwright.config.ts'] },
  { name: 'EXPECTED_FONT', classification: 'nonsecret' as const, readers: ['tests/expected.ts'] },
];
const identity = { suite: 'example', file: 'tests/entry.spec.ts', titlePath: ['entry'] };
for (const version of VERSIONS) test(`declared environment ${version} binds actual config and worker invocation values`, async () => {
  const s = stageSuite(version, {
    'playwright.config.ts': "import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',testMatch:'entry.spec.ts',workers:1,use:{baseURL:process.env.BASE_URL},projects:[{name:'desktop'}]});",
    'tests/entry.spec.ts': "import {test,expect} from '@playwright/test';import {expected} from './expected';test('entry',()=>{expect(expected).toBe('Georgia')});",
    'tests/expected.ts': 'export const expected=process.env.EXPECTED_FONT;',
  });
  try {
    const input = { suite: 'example', config: join(s.root, 'playwright.config.ts'), rules: [], environment: { ...S.ENVIRONMENT, baseUrlEnv: 'BASE_URL' }, runDir: join(s.root, 'planned'), reporter: join(s.root, 'support/test-lab/reporter.ts'), projects: ['desktop'], secretOptions: [], declaredEnvironmentInputs: declarations, environmentValues: { EXPECTED_FONT: { state: 'set' as const, value: 'Georgia' } } };
    const probe = probeInvocation(input); const probed = await execute(probe); assert.ok([0,1].includes(probed.status ?? -1), probed.stderr);
    const begin = readInvocation(probe).begin; assert.ok(begin, probed.stdout + probed.stderr);
    const plan = planSuite(input, begin); assert.equal(plan.ok, true, JSON.stringify(plan)); if (!plan.ok) return;
    const done = await execute(plan.invocation, { inherit: { ...process.env, EXPECTED_FONT: 'parent-value' } });
    assert.equal(done.status, 0, done.stdout + done.stderr);
    const obs = readInvocation(plan.invocation); assert.ok(obs.begin);
    const d = computeDigests({ suite: 'example', suiteRoot: s.root, begin: obs.begin, cases: new Map(), ledger: [], recipes: [], declaredInputs: [], declaredEnvironmentInputs: declarations, declaredBaselines: [], kitDir: join(s.root, 'support/test-lab') } as Parameters<typeof computeDigests>[0]).behavior.get(behaviorKey(identity, 'desktop'));
    assert.equal(d?.status, 'resolved', JSON.stringify(d));
  } finally { s.cleanup(); }
});

import { readFileSync, writeFileSync } from 'node:fs';
import { runStatus } from '../../src/run-observation.ts';
import { evaluateCase } from '../../src/evidence.ts';
import { bindingsOf, type EnvironmentInputValue } from '../../kit/environment-inputs.ts';
import type { SuitePlanInput } from '../../src/run-plan.ts';

function inputFor(root:string, label:string, value:EnvironmentInputValue):SuitePlanInput {
  return { suite:'example',config:join(root,'playwright.config.ts'),rules:[],environment:{...S.ENVIRONMENT,baseUrlEnv:'BASE_URL'},runDir:join(root,label),reporter:join(root,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[],declaredEnvironmentInputs:declarations,environmentValues:{EXPECTED_FONT:value} };
}
const config = "import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',testMatch:'entry.spec.ts',workers:1,use:{baseURL:process.env.BASE_URL},projects:[{name:'desktop'}]});";
const spec = "import {test,expect} from '@playwright/test';import {expected} from './expected';test('entry',()=>{expect(expected).toBe('Georgia')});";
async function probe(input:SuitePlanInput) {
  const inv=probeInvocation(input), done=await execute(inv);const obs=readInvocation(inv);assert.ok(obs.begin,done.stdout+done.stderr);assert.deepEqual(obs.problems,[]);return obs.begin;
}
async function run(input:SuitePlanInput) {
  const begin=await probe(input);const planned=planSuite(input,begin);assert.ok(planned.ok,JSON.stringify(planned));
  const done=await execute(planned.invocation,{inherit:{...process.env,EXPECTED_FONT:'parent-only-value'}});const obs=readInvocation(planned.invocation);assert.ok(obs.begin);return {done,obs,inv:planned.invocation};
}
function digests(root:string, obs:ReturnType<typeof readInvocation>, ds=declarations) {
  assert.ok(obs.begin);return computeDigests({suite:'example',suiteRoot:root,begin:obs.begin,cases:new Map(),ledger:[],recipes:[],declaredInputs:[],declaredEnvironmentInputs:ds,declaredBaselines:[],kitDir:join(root,'support/test-lab')});
}
for(const version of VERSIONS) {
  test(`declared environment ${version} changed/set/unset/empty values have fresh worker bindings and stale acceptance`,async()=>{
    const s=stageSuite(version,{'playwright.config.ts':config,'tests/entry.spec.ts':spec,'tests/expected.ts':'export const expected=process.env.EXPECTED_FONT;'});
    try {
      const hashes=new Set<string>();let accepted='';
      for(const [i,value] of [{state:'set',value:'Georgia'},{state:'set',value:'Arial'},{state:'set',value:''},{state:'unset'}].entries()) {
        const result=await run(inputFor(s.root,'values-'+i,value as EnvironmentInputValue));assert.equal(result.done.status,i===0?0:1,result.done.stdout+result.done.stderr);assert.deepEqual(result.obs.problems,[]);
        const o=result.obs.begin!.environmentInputs!;assert.equal(o.phase,'complete');assert.equal(o.workers,1);assert.ok(o.processes.length>=2);assert.ok(o.processes.every(p=>p.closed&&p.changed.length===0));
        assert.deepEqual(o.bindings.filter(b=>b.name==='EXPECTED_FONT'),bindingsOf([declarations[1]!],{EXPECTED_FONT:value as EnvironmentInputValue}));
        assert.ok(!readFileSync(join(result.inv.dir,'steps.jsonl'),'utf8').includes('parent-only-value'));
        const report=digests(s.root,result.obs),d=report.behavior.get(behaviorKey(identity,'desktop'));assert.ok(d?.status==='resolved',JSON.stringify(d));hashes.add(d.digest);if(i===0)accepted=d.digest;
        const record=S.caseRecord('C1','regression',{obligations:['O1']});const evaluation=evaluateCase(record,'regression',{evidenceDir:s.root,recipesDir:s.root,records:[S.acceptance(record,identity,{behaviorDigest:accepted})],digests:report,environment:S.ENVIRONMENT,effective:S.effective(),configurations:S.CONFIGS,ledger:[{obligation:{case:'C1',step:'S1',obligation:'O1'},test:identity,configuration:'desktop@1440',layer:'served'}],dispositions:[],roles:S.ROLES,materialFields:['browserName']});
        assert.equal(evaluation.mappings[0]?.acceptance,i===0?'current':'stale');
      }
      assert.equal(hashes.size,4);
    } finally {s.cleanup();}
  });
  test(`declared environment ${version} changed values refuse stale probe/discovery and reprobe owns the new run`,async()=>{
    const s=stageSuite(version,{'playwright.config.ts':config,'tests/entry.spec.ts':spec,'tests/expected.ts':'export const expected=process.env.EXPECTED_FONT;'});
    try {
      const input=inputFor(s.root,'pipeline',{state:'set',value:'Georgia'}),begin=await probe(input);
      const changed={...input,environmentValues:{EXPECTED_FONT:{state:'set' as const,value:'Arial'}}};
      assert.equal(planSuite(changed,begin).ok,false);
      const discovery=planSuite(input,begin,'discover');assert.ok(discovery.ok);await execute(discovery.invocation);const discovered=readInvocation(discovery.invocation);assert.ok(discovered.begin);assert.deepEqual(discovered.problems,[]);
      assert.equal(planSuite(changed,discovered.begin).ok,false);
      const planned=planSuite(input,discovered.begin);assert.ok(planned.ok);
      // Mutating the invocation env cannot borrow its older expected bindings.
      planned.invocation.env['EXPECTED_FONT']='Arial';const done=await execute(planned.invocation);assert.equal(done.status,1);
      const observation=readInvocation(planned.invocation);assert.equal(runStatus({invocations:[observation]}).complete,false);assert.equal(digests(s.root,observation).behavior.get(behaviorKey(identity,'desktop'))?.status,'unresolved');assert.equal(observation.tests[0]?.results[0]?.status,'failed');
      const fresh=await run({...changed,runDir:join(s.root,'fresh')});assert.deepEqual(fresh.obs.problems,[]);assert.equal(digests(s.root,fresh.obs).behavior.get(behaviorKey(identity,'desktop'))?.status,'resolved');
    } finally {s.cleanup();}
  });
  test(`declared environment ${version} writes during execution remain invalid even after restoration`,async()=>{
    const s=stageSuite(version,{'playwright.config.ts':config,'tests/entry.spec.ts':spec.replace("expect(expected).toBe('Georgia')","process.env.EXPECTED_FONT='Arial';process.env.EXPECTED_FONT='Georgia';expect(expected).toBe('Georgia')"),'tests/expected.ts':'export const expected=process.env.EXPECTED_FONT;'});
    try {
      const result=await run(inputFor(s.root,'changed',{state:'set',value:'Georgia'}));assert.equal(result.done.status,0);assert.equal(runStatus({invocations:[result.obs]}).complete,false);assert.ok(result.obs.begin!.environmentInputs!.processes.some(p=>p.changed.includes('EXPECTED_FONT')));assert.equal(digests(s.root,result.obs).behavior.get(behaviorKey(identity,'desktop'))?.status,'unresolved');
    } finally {s.cleanup();}
  });
  test(`declared environment ${version} reader scope/dynamic/whole/undeclared/secret boundaries stay unresolved`,async()=>{
    const s=stageSuite(version,{'playwright.config.ts':config,'tests/entry.spec.ts':spec,'tests/expected.ts':'export const expected=process.env.EXPECTED_FONT;'});
    try {
      const result=await run(inputFor(s.root,'scope',{state:'set',value:'Georgia'}));assert.equal(result.done.status,0);
      assert.equal(digests(s.root,result.obs,[declarations[0]!,{...declarations[1]!,readers:['tests/entry.spec.ts']}]).behavior.get(behaviorKey(identity,'desktop'))?.status,'unresolved');
      for(const source of ["const e=process.env;const key='EXPECTED_FONT';export const expected=e[key];","export const expected=Object.values(process.env);","export const expected=process.env.OTHER_FONT;","export const expected=process.env.AUTH_TOKEN;"]) {
        writeFileSync(join(s.root,'tests/expected.ts'),source);assert.equal(digests(s.root,result.obs).behavior.get(behaviorKey(identity,'desktop'))?.status,'unresolved');
      }
      assert.throws(()=>probeInvocation({...inputFor(s.root,'secret',{state:'set',value:'Georgia'}),declaredEnvironmentInputs:[{name:'AUTH_TOKEN',classification:'nonsecret',readers:['tests/expected.ts']}]}),/invalid/);
    } finally {s.cleanup();}
  });
}

import { copyFileSync, mkdirSync } from 'node:fs';
import { startSite } from '../fixtures/site/server.ts';
import { sha256 } from '../../src/canonical.ts';
import { canonicalCaseHash } from '../../src/cases.ts';
import { effectiveConfig } from '../../src/digest.ts';
import { browsersOf } from '../../src/run-observation.ts';
import type { EvidenceRecord } from '../../src/model.ts';
for(const version of VERSIONS) test(`declared environment ${version} actual served red check/restoration/five-repeat burn-in bind the same inputs`,async()=>{
  const site=await startSite();
  const s=stageSuite(version,{
    'playwright.config.ts':config.replace("{name:'desktop'}","{name:'desktop',use:{viewport:{width:1440,height:900}}}"),
    'tests/entry.spec.ts':"import {test,expect} from '@playwright/test';import {caseStep} from '../support/test-lab/case-step';import {expected} from './expected';test('entry',async({page})=>{await page.goto('/accordion');await caseStep(page,{case:'C1',step:'S1',obligation:'O1'},'title font',async()=>{await expect(page.locator('.accordion__title')).toHaveCSS('font-family',new RegExp(expected!))})});",
    'tests/expected.ts':'export const expected=process.env.EXPECTED_FONT;',
  });
  try {
    const input=(label:string,value='Georgia')=>({...inputFor(s.root,label,{state:'set' as const,value}),environment:{...S.ENVIRONMENT,baseUrl:site.url,baseUrlEnv:'BASE_URL'}});
    const restored=await run(input('restored'));assert.equal(restored.done.status,0,restored.done.stdout+restored.done.stderr);
    const burn=await run({...input('burn'),extraArgs:['--repeat-each','5','--fail-on-flaky-tests']});assert.equal(burn.done.status,0,burn.done.stdout+burn.done.stderr);
    site.setAccordionMutation('title');const mutated=await run(input('mutated'));site.setAccordionMutation('');assert.equal(mutated.done.status,1);assert.equal(runStatus({invocations:[mutated.obs]}).complete,true);
    const evidenceDir=join(s.root,'.test-lab/evidence'),recipesDir=join(s.root,'.test-lab/recipes');mkdirSync(evidenceDir,{recursive:true});mkdirSync(recipesDir,{recursive:true});
    const keep=(inv:{dir:string},name:string)=>{copyFileSync(join(inv.dir,'steps.jsonl'),join(evidenceDir,name));return S.ledgerRef(evidenceDir,name);};
    const redRef=keep(mutated.inv,'mutated.jsonl'),restoredRef=keep(restored.inv,'restored.jsonl'),burnRef=keep(burn.inv,'burn.jsonl');
    const record=S.caseRecord('C1','regression',{obligations:['O1']}),mapping={obligation:{case:'C1',step:'S1',obligation:'O1'},test:identity,configuration:'desktop@1440',layer:'served' as const};
    const report=digests(s.root,restored.obs),d=report.behavior.get(behaviorKey(identity,'desktop'));assert.ok(d?.status==='resolved',JSON.stringify(d));assert.ok(report.toolchain.status==='resolved');
    const recipe=JSON.stringify({format:1,obligation:mapping.obligation,technique:'seeded-site-mutant',mutation:'title'}),recipeHash=sha256(recipe);writeFileSync(join(recipesDir,recipeHash+'.json'),recipe);
    const bound={behaviorDigest:d.digest,toolchainDigest:report.toolchain.digest,environment:{...S.ENVIRONMENT,baseUrl:site.url},appliesTo:[],at:'2026-10-09'};
    const records:EvidenceRecord[]=[{kind:'red-check',id:'red',test:identity,configuration:'desktop@1440',obligation:mapping.obligation,recipeHash:'sha256:'+recipeHash,mutated:redRef,restored:restoredRef,...bound},{kind:'burn-in',id:'burn',test:identity,configuration:'desktop@1440',run:burnRef,...bound},{kind:'acceptance',id:'accept',test:identity,case:'C1',caseHash:canonicalCaseHash(record),behaviorDigest:d.digest,by:S.QA,role:'qa',standIn:true,at:'2026-10-09'}];
    const ctx={evidenceDir,recipesDir,records,digests:report,environment:bound.environment,effective:effectiveConfig(restored.obs.begin!,browsersOf(restored.obs)),configurations:S.CONFIGS,ledger:[mapping],dispositions:[],roles:S.ROLES,materialFields:['browserName' as const]};
    const evaluation=evaluateCase(record,'regression',ctx);assert.equal(evaluation.status,'verified',JSON.stringify(evaluation));
    const changed=await run(input('other-input','Arial'));assert.equal(changed.done.status,1);const changedRef=keep(changed.inv,'other-input.jsonl');
    const borrowed=evaluateCase(record,'regression',{...ctx,records:records.map(r=>r.kind==='burn-in'?{...r,run:changedRef}:r)});assert.equal(borrowed.mappings[0]?.sensitivity,'unverified');
    const stale=evaluateCase(record,'regression',{...ctx,digests:digests(s.root,changed.obs)});assert.equal(stale.mappings[0]?.acceptance,'stale');
  } finally {s.cleanup();await site.close();}
});
