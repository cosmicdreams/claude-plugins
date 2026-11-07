import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { stageSuite, VERSIONS, runPlaywright } from './harness.ts';
import { execute, probeInvocation, planSuite } from '../../src/run-plan.ts';
import { readInvocation } from '../../src/run-observation.ts';
import { readLedgerRef, judgeRedCheck } from '../../src/evidence.ts';
import { effectiveClassification } from '../../src/dispositions.ts';
import * as S from '../ts/support.ts';

for(const version of VERSIONS) {
  for(const depth of [1,2]) test(`R2-1 ${version} dependency depth ${depth} cannot widen a selected exclusion`,async()=>{
    const projects=depth===1?"{name:'desktop',dependencies:['setup']},{name:'setup',testMatch:'auth.setup.ts'}":"{name:'desktop',dependencies:['setup']},{name:'setup',testMatch:'auth.setup.ts',dependencies:['bootstrap']},{name:'bootstrap',testMatch:'bootstrap.setup.ts'}";
    const s=stageSuite(version,{'playwright.config.ts':`import {defineConfig} from '@playwright/test'; export default defineConfig({testDir:'./tests',projects:[${projects}]});`,
      'tests/prod.spec.ts':"import {test} from '@playwright/test'; import {appendFileSync} from 'node:fs'; appendFileSync(process.env.LOADED_MARKER!,'LOADED'); test('prod',()=>{});",
      'tests/auth.setup.ts':"import {test} from '@playwright/test'; test('auth',()=>{});",
      'tests/bootstrap.setup.ts':"import {test} from '@playwright/test'; test('bootstrap',()=>{});"});
    try {
      const marker=join(s.root,'marker'),rules=effectiveClassification([{id:'exclude',target:{suite:'example',project:'desktop',glob:'tests/prod.spec.ts'},from:null,to:'excluded',by:S.QA,role:'qa',standIn:true,at:'2026-10-09',reason:'production'}],S.ROLES).rules;
      const input={suite:'example',config:join(s.root,'playwright.config.ts'),rules,environment:{...S.ENVIRONMENT,baseUrlEnv:'BASE_URL'},runDir:join(s.root,'run'),reporter:join(s.root,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[]};
      const probe=probeInvocation(input);await execute(probe,{inherit:{...process.env,LOADED_MARKER:marker}});
      const begin=readInvocation({id:probe.id,suite:'example',dir:probe.dir}).begin;assert.ok(begin);
      const plan=planSuite(input,begin,'discover');if(plan.ok)await execute(plan.invocation,{inherit:{...process.env,LOADED_MARKER:marker}});
      assert.equal(existsSync(marker),false,'dependency union loaded production module');
      if(plan.ok) {const discovered=readInvocation({id:plan.invocation.id,suite:'example',dir:plan.invocation.dir});assert.equal(discovered.tests.some(t=>t.declaration.project==='desktop' && t.declaration.file==='tests/prod.spec.ts'),false);}
    } finally {s.cleanup();}
  });
  test(`R2-5 ${version} scoped baseURL/custom fixture overrides fail closed before loading or receipts`,async()=>{
    for(const scoped of ["test.use({baseURL:process.env.SCOPED_URL});","const custom=test.extend({variant:['strong',{option:true}]}); custom.use({variant:process.env.VARIANT});"]) {
      const s=stageSuite(version,{'playwright.config.ts':"import {defineConfig} from '@playwright/test'; export default defineConfig({testDir:'./tests',testMatch:'scope.spec.ts',projects:[{name:'desktop',use:{baseURL:'http://127.0.0.1:4180'}}]});",
        'tests/scope.spec.ts':`import {test} from '@playwright/test';import {appendFileSync} from 'node:fs';${scoped} appendFileSync(process.env.LOADED_MARKER!,'LOADED');test('scope',()=>{});`});
      try {
        const marker=join(s.root,'marker'),input={suite:'example',config:join(s.root,'playwright.config.ts'),rules:[],environment:{...S.ENVIRONMENT,baseUrlEnv:'BASE_URL'},runDir:join(s.root,'run'),reporter:join(s.root,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[]};
        const probe=probeInvocation(input);await execute(probe,{inherit:{...process.env,LOADED_MARKER:marker}});const begin=readInvocation({id:probe.id,suite:'example',dir:probe.dir}).begin;assert.ok(begin);
        const plan=planSuite(input,begin,'discover');if(plan.ok)await execute(plan.invocation,{inherit:{...process.env,LOADED_MARKER:marker}});
        assert.equal(existsSync(marker),false);assert.equal(plan.ok,false);
        const dir=join(s.root,'bypass');await runPlaywright(s.root,dir,['--list'],{LOADED_MARKER:marker,SCOPED_URL:'https://production.invalid',VARIANT:'weakened'});
        const obs=readInvocation({id:'bypass',suite:'example',dir});assert.ok(obs.begin);assert.equal(obs.tests.length,1);
        assert.equal(readLedgerRef(dir,S.ledgerRef(dir,'steps.jsonl')).ok,false,'direct Playwright run cannot certify unobserved scope');
      } finally {s.cleanup();}
    }
  });
  test(`R2-7 ${version} actual soft sibling failures verify neither obligation`,async()=>{
    const s=stageSuite(version,{'playwright.config.ts':"import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',testMatch:'siblings.spec.ts',workers:1,projects:[{name:'desktop',use:{viewport:{width:1440,height:900},baseURL:'http://127.0.0.1:4180'}}]});",
      'tests/siblings.spec.ts':"import {test,expect} from '@playwright/test';import {caseStep} from '../support/test-lab/case-step';test('siblings',async({page})=>{for(const obligation of ['O1','O2'])await caseStep(page,{case:'C1',step:'S1',obligation},obligation,async()=>{expect.soft(process.env.MUTATE==='1'?false:true).toBe(true);});});"});
    try{
      const mutated=await runPlaywright(s.root,join(s.root,'mutated'),[],{MUTATE:'1'}),restored=await runPlaywright(s.root,join(s.root,'restored'),[]);assert.equal(mutated.status,1);assert.equal(restored.status,0);
      const steps=readInvocation({id:'m',suite:'example',dir:mutated.dir}).tests[0]?.results[0]?.steps;
      assert.equal(steps?.filter(s=>s.ids?.obligation && s.status==='failed').length,2);
      const ref={case:'C1',step:'S1',obligation:'O1'},recipes=join(s.root,'recipes'),r=S.redCheck(s.root,recipes,ref,{suite:'example',file:'tests/siblings.spec.ts',titlePath:['siblings']},'desktop@1440',{mutated:'mutated/steps.jsonl',restored:'restored/steps.jsonl'});
      assert.notEqual(judgeRedCheck(s.root,r,S.CONFIGS[0]!,false,recipes),null);
    }finally{s.cleanup();}
  });
}

for(const version of VERSIONS) test(`R2-1 ${version} empty/duplicate project selection never falls back to all projects`,async()=>{
  const s=stageSuite(version,{'playwright.config.ts':"import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',projects:[{name:'desktop'},{name:'production'}]});",
    'tests/prod.spec.ts':"import {test} from '@playwright/test';import {appendFileSync} from 'node:fs';appendFileSync(process.env.LOADED_MARKER!,'LOADED');test('prod',()=>{});"});
  try {
    const input={suite:'example',config:join(s.root,'playwright.config.ts'),rules:[],environment:{...S.ENVIRONMENT,baseUrlEnv:'BASE_URL'},runDir:join(s.root,'run'),reporter:join(s.root,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[]};
    const probe=probeInvocation(input);await execute(probe);const begin=readInvocation({id:probe.id,suite:'example',dir:probe.dir}).begin;assert.ok(begin);
    for(const projects of [[],['desktop','desktop']])assert.equal(planSuite({...input,projects},begin,'discover').ok,false);
  }finally{s.cleanup();}
});

for(const version of VERSIONS) test(`R2-1 ${version} effective governed override is preserved inside an excluded glob`,async()=>{
  const s=stageSuite(version,{'playwright.config.ts':"import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',testMatch:'important.spec.ts',projects:[{name:'desktop'}]});",
    'tests/important.spec.ts':"import {test} from '@playwright/test';test('important',()=>{});"});
  try{
    const changes=[{id:'exclude',target:{suite:'example',glob:'tests/**'},from:null,to:'excluded',by:S.QA,role:'qa',standIn:true,at:'2026-10-09',reason:'excluded scratch'},{id:'reopen',target:{suite:'example',glob:'tests/important.spec.ts'},from:null,to:'governed',by:S.QA,role:'qa',standIn:true,at:'2026-10-09',reason:'governed exception'}] as const;
    const input={suite:'example',config:join(s.root,'playwright.config.ts'),rules:effectiveClassification([...changes],S.ROLES).rules,environment:{...S.ENVIRONMENT,baseUrlEnv:'BASE_URL'},runDir:join(s.root,'run'),reporter:join(s.root,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[]};
    const probe=probeInvocation(input);await execute(probe);const begin=readInvocation({id:probe.id,suite:'example',dir:probe.dir}).begin;assert.ok(begin);
    const plan=planSuite(input,begin,'discover');assert.ok(plan.ok,plan.ok?'':plan.refusals.join(';'));await execute(plan.invocation);
    assert.equal(readInvocation({id:plan.invocation.id,suite:'example',dir:plan.invocation.dir}).tests.some(t=>t.declaration.file==='tests/important.spec.ts'),true);
  }finally{s.cleanup();}
});

for(const version of VERSIONS) test(`R2-1 ${version} an allowed spec cannot import an excluded module`,async()=>{
  const s=stageSuite(version,{'playwright.config.ts':"import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',testMatch:'entry.spec.ts',projects:[{name:'desktop'}]});",
    'tests/entry.spec.ts':"import './prod.spec';import {test} from '@playwright/test';test('entry',()=>{});",
    'tests/prod.spec.ts':"import {appendFileSync} from 'node:fs';appendFileSync(process.env.LOADED_MARKER!,'LOADED');"});
  try{
    const marker=join(s.root,'marker'),rules=effectiveClassification([{id:'exclude',target:{suite:'example',project:'desktop',glob:'tests/prod.spec.ts'},from:null,to:'excluded',by:S.QA,role:'qa',standIn:true,at:'2026-10-09',reason:'production'}],S.ROLES).rules;
    const input={suite:'example',config:join(s.root,'playwright.config.ts'),rules,environment:{...S.ENVIRONMENT,baseUrlEnv:'BASE_URL'},runDir:join(s.root,'run'),reporter:join(s.root,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[]};
    const probe=probeInvocation(input);await execute(probe,{inherit:{...process.env,LOADED_MARKER:marker}});const begin=readInvocation({id:probe.id,suite:'example',dir:probe.dir}).begin;assert.ok(begin);
    const plan=planSuite(input,begin,'discover');if(plan.ok)await execute(plan.invocation,{inherit:{...process.env,LOADED_MARKER:marker}});
    assert.equal(existsSync(marker),false);assert.equal(plan.ok,false);
  }finally{s.cleanup();}
});
