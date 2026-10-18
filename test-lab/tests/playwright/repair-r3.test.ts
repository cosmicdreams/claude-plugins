import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { execute, planSuite, probeInvocation } from '../../src/run-plan.ts';
import { computeDigests } from '../../src/digest.ts';
import { judgeRedCheck, readLedgerRef } from '../../src/evidence.ts';
import { normalize } from '../../src/normalize.ts';
import { readInvocation, runStatus } from '../../src/run-observation.ts';
import { effectiveClassification } from '../../src/dispositions.ts';
import * as S from '../ts/support.ts';
import { stageSuite, VERSIONS, runPlaywright } from './harness.ts';

const config="import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',testMatch:'entry.spec.ts',workers:1,projects:[{name:'desktop',use:{viewport:{width:1440,height:900},baseURL:'http://127.0.0.1:4180'}}]});";
for(const version of VERSIONS) {
  for(const loader of ["const load=require;", "import {createRequire} from 'node:module';const load=createRequire(import.meta.url);", "const load=true?require:require;"]) test(`R3-1 ${version} excluded module never loads via ${loader}`,async()=>{
    const s=stageSuite(version,{'playwright.config.ts':config,'tests/entry.spec.ts':`import {test} from '@playwright/test';${loader}load('./prod-module.cjs');test('entry',()=>{});`, 'tests/prod-module.cjs':"require('node:fs').appendFileSync(process.env.LOADED_MARKER,'LOADED');"});
    try {
      const marker=join(s.root,'marker'),rules=effectiveClassification([{id:'exclude',target:{suite:'example',project:'desktop',glob:'tests/prod-module.cjs'},from:null,to:'excluded',by:S.QA,role:'qa',standIn:true,at:'2026-10-09',reason:'production'}],S.ROLES).rules;
      const input={suite:'example',config:join(s.root,'playwright.config.ts'),rules,environment:{...S.ENVIRONMENT,baseUrlEnv:'BASE_URL'},runDir:join(s.root,'run'),reporter:join(s.root,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[]};
      const probe=probeInvocation(input);await execute(probe);const begin=readInvocation({id:probe.id,suite:'example',dir:probe.dir}).begin;assert.ok(begin);
      const plan=planSuite(input,begin,'discover');if(plan.ok)await execute(plan.invocation,{inherit:{...process.env,LOADED_MARKER:marker}});
      assert.equal(existsSync(marker),false,'excluded loader alias executed LOADED');assert.equal(plan.ok,false);
    }finally{s.cleanup();}
  });
  test(`R3-2 ${version} conditional reader cannot produce a resolved stale digest`,async()=>{
    const s=stageSuite(version,{'playwright.config.ts':config,'tests/entry.spec.ts':"import {test,expect} from '@playwright/test';import fs from 'node:fs';const read=true?fs.readFileSync:fs.readFileSync;test('entry',()=>{expect(read('hidden.txt','utf8')).toBeTruthy()});",'hidden.txt':'strong'});
    try{
      const run=await runPlaywright(s.root,join(s.root,'first'),[]);assert.equal(run.status,0,run.stderr+run.stdout);const obs=readInvocation({id:'first',suite:'example',dir:run.dir});assert.ok(obs.begin);
      const ctx={suite:'example',suiteRoot:s.root,begin:obs.begin,cases:new Map(),ledger:[],recipes:[],declaredInputs:[],declaredBaselines:[],kitDir:join(s.root,'support/test-lab')};
      const a=computeDigests(ctx).behavior.values().next().value;writeFileSync(join(s.root,'hidden.txt'),'weakened');const b=computeDigests(ctx).behavior.values().next().value;
      assert.equal(a?.status,'unresolved');assert.equal(b?.status,'unresolved');assert.equal(readLedgerRef(run.dir,S.ledgerRef(run.dir,'steps.jsonl')).ok,false);
    }finally{s.cleanup();}
  });
  for(const scoped of ["const method='use';`${test[method]({baseURL:process.env.SCOPED_URL})}`;", "const testAPI={test};testAPI['test']['u'+'se']({baseURL:process.env.SCOPED_URL});"]) test(`R3-3 ${version} indirect scoped URL cannot certify environment A: ${scoped}`,async()=>{
    const servers=[createServer((_q,r)=>r.end('A')),createServer((_q,r)=>r.end('B'))];
    await Promise.all(servers.map(server=>new Promise<void>(done=>server.listen(0,'127.0.0.1',done))));
    const urls=servers.map(server=>{const addr=server.address();assert.ok(addr && typeof addr!=='string');return `http://127.0.0.1:${addr.port}`});
    const s=stageSuite(version,{'playwright.config.ts':config.replace('http://127.0.0.1:4180',urls[0]!),'tests/entry.spec.ts':`import {test,expect} from '@playwright/test';import {appendFileSync} from 'node:fs';${scoped}appendFileSync(process.env.LOADED_MARKER!,'LOADED');test('entry',async({page})=>{await page.goto('/');expect(await page.textContent('body')).toBe(process.env.EXPECTED_BODY)});`});
    try{
      const marker=join(s.root,'marker'),input={suite:'example',config:join(s.root,'playwright.config.ts'),rules:[],environment:{...S.ENVIRONMENT,baseUrl:urls[0]!,baseUrlEnv:'BASE_URL'},runDir:join(s.root,'run'),reporter:join(s.root,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[]};
      const probe=probeInvocation(input);await execute(probe);const begin=readInvocation({id:probe.id,suite:'example',dir:probe.dir}).begin;assert.ok(begin);const plan=planSuite(input,begin,'discover');
      if(plan.ok)await execute(plan.invocation,{inherit:{...process.env,LOADED_MARKER:marker,SCOPED_URL:urls[1]!}});
      // Even bypassing the typed planner must leave the raw evidence unverified. Both real pages run.
      const observations=[];
      for(const [i,url] of urls.entries()) {
        const run=await runPlaywright(s.root,join(s.root,'bypass'+i),[],{SCOPED_URL:url,EXAMPLE_BASE_URL:urls[0]!,EXPECTED_BODY:i===0?'A':'B',LOADED_MARKER:join(s.root,'bypass-marker')});
        assert.equal(run.status,0,run.stderr+run.stdout);const obs=readInvocation({id:'b'+i,suite:'example',dir:run.dir});assert.ok(obs.begin);assert.equal(obs.tests[0]?.results[0]?.status,'passed');observations.push(obs);
      }
      assert.ok(readFileSync(join(s.root,'bypass-marker'),'utf8').includes('LOADED'));
      assert.equal(plan.ok,false,'typed preflight accepted hidden override');assert.equal(existsSync(marker),false);
      for(const obs of observations){assert.equal(runStatus({invocations:[obs]}).complete,false);assert.ok(obs.tests[0]?.declaration.optionSafety.problems.length);assert.equal(computeDigests({suite:'example',suiteRoot:s.root,begin:obs.begin!,cases:new Map(),ledger:[],recipes:[],declaredInputs:[],declaredBaselines:[],kitDir:join(s.root,'support/test-lab')}).behavior.values().next().value?.status,'unresolved');}
    }finally{s.cleanup();await Promise.all(servers.map(server=>new Promise<void>((done,reject)=>server.close(e=>e?reject(e):done()))));}
  });
  test(`R3-4 ${version} actual independent skip survives deeper passing sibling and restoration`,async()=>{
    const s=stageSuite(version,{'playwright.config.ts':config,'tests/entry.spec.ts':"import {test,expect} from '@playwright/test';import {caseStep} from '../support/test-lab/case-step';test('entry',async({page})=>{await caseStep(page,{case:'C1',step:'S1',obligation:'O1'},'independent',async step=>{step.skip(['skip','mixed'].includes(process.env.MODE??''));expect(process.env.MODE!=='mutate').toBe(true)});await test.step('wrapper',async()=>{await caseStep(page,{case:'C1',step:'S1',obligation:'O1'},'deep',async()=>{expect(process.env.MODE!=='mixed').toBe(true)})})});"});
    try{
      const mutated=await runPlaywright(s.root,join(s.root,'mutated'),[],{MODE:'mutate'}),restored=await runPlaywright(s.root,join(s.root,'restored'),[],{MODE:'skip'});assert.equal(mutated.status,1);assert.equal(restored.status,0);
      const obs=readInvocation({id:'r',suite:'example',dir:restored.dir}),steps=obs.tests[0]?.results[0]?.steps.filter(s=>s.ids?.obligation==='O1');assert.equal(steps?.length,2);assert.deepEqual(steps?.map(s=>s.status),['skipped','passed']);assert.ok(steps![1]!.depth>steps![0]!.depth);
      const identity={suite:'example',file:'tests/entry.spec.ts',titlePath:['entry']},norm=normalize({run:{invocations:[obs]},configurations:S.CONFIGS,cases:new Map([['C1',S.caseRecord('C1','regression',{obligations:['O1']})]]),required:{regression:['C1'],addendum:[]},ledger:[{obligation:{case:'C1',step:'S1',obligation:'O1'},test:identity,configuration:'desktop@1440',layer:'served'}],classification:[],liveQuarantines:[],quarantinesOnRequired:[],roleOverrideFiles:new Set()});
      const recipes=join(s.root,'recipes'),red=S.redCheck(s.root,recipes,{case:'C1',step:'S1',obligation:'O1'},identity,'desktop@1440',{mutated:'mutated/steps.jsonl',restored:'restored/steps.jsonl'});
      assert.equal(norm.required[0]?.outcome,'skipped');assert.notEqual(judgeRedCheck(s.root,red,S.CONFIGS[0]!,false,recipes),null);
      const mixed=await runPlaywright(s.root,join(s.root,'mixed'),[],{MODE:'mixed'});assert.equal(mixed.status,1);
      assert.notEqual(judgeRedCheck(s.root,{...red,mutated:S.ledgerRef(s.root,'mixed/steps.jsonl')},S.CONFIGS[0]!,false,recipes),null);
    }finally{s.cleanup();}
  });
  test(`R3-5 ${version} expected-failed setup does not establish intact login`,async()=>{
    const s=stageSuite(version,{'playwright.config.ts':"import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',workers:1,projects:[{name:'setup',testMatch:'auth.setup.ts'},{name:'desktop',testMatch:'entry.spec.ts',dependencies:['setup'],use:{viewport:{width:1440,height:900},baseURL:'http://127.0.0.1:4180'}}]});",'tests/auth.setup.ts':"import {test,expect} from '@playwright/test';test('login',()=>{test.fail(process.env.MODE==='mutate');expect(process.env.MODE!=='mutate').toBe(true)});",'tests/entry.spec.ts':"import {test,expect} from '@playwright/test';import {caseStep} from '../support/test-lab/case-step';test('entry',async({page})=>{await caseStep(page,{case:'C1',step:'S1',obligation:'O1'},'O1',async()=>{expect(process.env.MODE!=='mutate').toBe(true)})});"});
    try{
      const mutated=await runPlaywright(s.root,join(s.root,'mutated'),['--project=desktop'],{MODE:'mutate'}),restored=await runPlaywright(s.root,join(s.root,'restored'),['--project=desktop']);assert.equal(mutated.status,1);assert.equal(restored.status,0);
      const obs=readInvocation({id:'m',suite:'example',dir:mutated.dir});const setup=obs.tests.find(t=>t.declaration.project==='setup');assert.equal(setup?.results[0]?.status,'failed');assert.equal(setup?.results[0]?.expectedStatus,'failed');
      const recipes=join(s.root,'recipes'),red=S.redCheck(s.root,recipes,{case:'C1',step:'S1',obligation:'O1'},{suite:'example',file:'tests/entry.spec.ts',titlePath:['entry']},'desktop@1440',{mutated:'mutated/steps.jsonl',restored:'restored/steps.jsonl'});
      assert.notEqual(judgeRedCheck(s.root,red,S.CONFIGS[0]!,false,recipes),null);
    }finally{s.cleanup();}
  });
}

for(const version of VERSIONS) {
  test(`R3-1 ${version} real loader aliases and createRequire hash the loaded helper`,async()=>{
    for(const loader of ["const load=require;", "import {createRequire} from 'node:module';const load=createRequire(import.meta.url);"]) {
      const s=stageSuite(version,{'playwright.config.ts':config,'tests/entry.spec.ts':`import {test,expect} from '@playwright/test';${loader}const value=load('./helper.cjs');test('entry',()=>{expect(value).toBeTruthy()});`,'tests/helper.cjs':"module.exports='strong';",...(loader.startsWith('import')?{'package.json':JSON.stringify({type:'module',devDependencies:{'@playwright/test':version}})}:{})});
      try{
        const run=await runPlaywright(s.root,join(s.root,'first'),[]);assert.equal(run.status,0,run.stderr+run.stdout);const obs=readInvocation({id:'first',suite:'example',dir:run.dir});assert.ok(obs.begin);assert.equal(runStatus({invocations:[obs]}).complete,true);
        assert.equal(JSON.parse(readFileSync(join(s.root,'support/test-lab/node_modules/typescript/package.json'),'utf8')).version,'6.0.3','suite uses the kit-pinned compiler');
        const ctx={suite:'example',suiteRoot:s.root,begin:obs.begin,cases:new Map(),ledger:[],recipes:[],declaredInputs:[],declaredBaselines:[],kitDir:join(s.root,'support/test-lab')};
        const a=computeDigests(ctx).behavior.values().next().value;assert.equal(a?.status,'resolved');if(a?.status!=='resolved')return;assert.ok(a.inputs.some(i=>i.path==='tests/helper.cjs'));
        writeFileSync(join(s.root,'tests/helper.cjs'),"module.exports='weakened';");const b=computeDigests(ctx).behavior.values().next().value;assert.equal(b?.status,'resolved');if(b?.status==='resolved')assert.notEqual(a.digest,b.digest);
      }finally{s.cleanup();}
    }
  });
  test(`R3-3 ${version} a missing kit parser dependency cannot produce verified evidence`,async()=>{
    const s=stageSuite(version,{'playwright.config.ts':config,'tests/entry.spec.ts':"import {test} from '@playwright/test';test('entry',()=>{});"});
    try{
      rmSync(join(s.root,'support/test-lab/node_modules/typescript'),{recursive:true,force:true});
      const run=await runPlaywright(s.root,join(s.root,'missing-parser'),['--list']);assert.notEqual(run.status,0);assert.match(run.stderr,/typescript/);
      const obs=readInvocation({id:'missing',suite:'example',dir:run.dir});assert.equal(obs.begin,null);assert.equal(runStatus({invocations:[obs]}).complete,false);
    }finally{s.cleanup();}
  });
}

for(const version of VERSIONS) test(`R3-1 ${version} config-only probes cannot load excluded modules through an alias`,async()=>{
  const s=stageSuite(version,{'playwright.config.ts':"import {defineConfig} from '@playwright/test';const load=require;load('./tests/prod-module.cjs');export default defineConfig({testDir:'./tests',projects:[{name:'desktop'}]});",'tests/prod-module.cjs':"require('node:fs').appendFileSync(process.env.LOADED_MARKER,'LOADED');"});
  try{
    const marker=join(s.root,'marker'),rules=effectiveClassification([{id:'exclude',target:{suite:'example',project:'desktop',glob:'tests/prod-module.cjs'},from:null,to:'excluded',by:S.QA,role:'qa',standIn:true,at:'2026-10-09',reason:'production'}],S.ROLES).rules;
    const input={suite:'example',config:join(s.root,'playwright.config.ts'),rules,environment:{...S.ENVIRONMENT,baseUrlEnv:'BASE_URL'},runDir:join(s.root,'run'),reporter:join(s.root,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[]};
    let refusal:string|null=null;
    try{await execute(probeInvocation(input),{inherit:{...process.env,LOADED_MARKER:marker}})}catch(e){refusal=e instanceof Error?e.message:String(e)}
    assert.equal(existsSync(marker),false,'config probe executed an excluded module before preflight');assert.match(refusal??'',/refused before loading/);
  }finally{s.cleanup();}
});
