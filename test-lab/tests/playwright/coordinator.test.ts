import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSIONS } from './harness.ts';
import { setupCoordinator, writeJson } from '../fixtures/coordinator.ts';
import { coordinate } from '../../src/coordinator.ts';
import { commandAdapter } from '../../src/local-adapter.ts';
import { behaviorKey } from '../../src/digest.ts';
import { hashOf, sha256 } from '../../src/canonical.ts';
import { canonicalCaseHash } from '../../src/cases.ts';
import { setHash } from '../../src/regression.ts';
import { sourceBindingHash } from '../../src/persistence.ts';
import { acceptance, caseRecord } from '../ts/support.ts';
import { recordScopeChange, repoKeyOf } from '../../src/work.ts';
import { execute, planSuite, probeInvocation } from '../../src/run-plan.ts';
import { readInvocation } from '../../src/run-observation.ts';
import { effectiveClassification } from '../../src/dispositions.ts';
const exec=promisify(execFile);const cli=join(import.meta.dirname,'../../src/cli.ts');
async function invoke(f:Awaited<ReturnType<typeof setupCoordinator>>,command='run',extra:string[]=[]) {
  const args=[cli,command,'--app-root',f.app,'--suite-root',f.suite,'--env','local','--no-work',...(command==='verify'?[]:['--adapter',join(f.suite,'adapter.ts')]),...extra];
  try {const r=await exec(process.execPath,args,{timeout:180000,env:process.env});return {code:0,result:JSON.parse(r.stdout.trim())};}
  catch(e){const r=e as {code:number;stdout:string;stderr:string};assert.ok(r.stdout,r.stderr);return {code:r.code,result:JSON.parse(r.stdout.trim())};}
}
for(const version of VERSIONS)test(`executable cross-repository composition on Playwright ${version}`,async()=>{
  const f=await setupCoordinator(version);
  try {
    const initial=await invoke(f);assert.equal(initial.code,3,JSON.stringify(initial.result));assert.equal(initial.result.rule,7);
    const manifest=JSON.parse(readFileSync(join(initial.result.runDir,'manifest.json'),'utf8'));
    assert.equal(manifest.before.application.root,f.app);assert.equal(manifest.before.suite.root,f.suite);
    assert.equal(manifest.after.application.digest,manifest.before.application.digest);
    const run=manifest.observations.at(-1).suites[0];const digests=run.afterDigests;
    const behavior=digests.behavior.find(([key]:[string,unknown])=>key===behaviorKey(f.test,'desktop'))[1];assert.equal(behavior.status,'resolved');
    assert.ok(behavior.environmentInputs);assert.equal(digests.toolchain.status,'resolved');
    const restored=readInvocation({id:'fresh',suite:'e2e',dir:run.run.dir});
    assert.equal(restored.tests[0]!.results[0]!.actorProbes?.[0]?.actual,'anonymous');
    assert.ok(restored.artifacts.html&&restored.artifacts.json&&restored.completion);
    const evidence=join(f.suite,'.test-lab/evidence');mkdirSync(join(evidence,'ledgers'));
    const keep=(dir:string,name:string)=>{const to=join(evidence,'ledgers',name);copyFileSync(join(dir,'steps.jsonl'),to);return {path:`ledgers/${name}`,sha256:sha256(readFileSync(to))};};
    // Genuine fixture mutation/restoration and five repeats, through the same public planner and staged kit.
    const rules=effectiveClassification(f.profile.classification,f.profile.roles,f.profile.classification).rules;
    const plannedRun=async(name:string,repeat=false)=>{
      const input={suite:'e2e',config:join(f.suite,'playwright.config.ts'),rules,environment:f.profile.environments[0]!,runDir:join(f.suite,'.test-lab/runs',name),reporter:join(f.suite,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[],declaredEnvironmentInputs:f.profile.suites[0]!.declaredEnvironmentInputs!,environmentValues:{},selectedFiles:['tests/home.spec.ts'],extraArgs:['--grep','(?:^|\\s)heading$',...(repeat?['--repeat-each','5','--fail-on-flaky-tests']:[])]};
      const probe=probeInvocation(input);await execute(probe);const p=readInvocation(probe);assert.ok(p.begin);
      const planned=planSuite(input,p.begin);assert.ok(planned.ok);await execute(planned.invocation);return planned.invocation.dir;
    };
    f.state.mutant=true;const mutant=await plannedRun('mutant');f.state.mutant=false;
    const restoredDir=await plannedRun('restored');const burn=await plannedRun('burn',true);
    const binding={environment:{id:'local',kind:'local-candidate',baseUrl:f.url},behaviorDigest:behavior.digest,toolchainDigest:digests.toolchain.digest,configuration:'desktop@1440',test:f.test,appliesTo:[],at:new Date().toISOString()};
    writeJson(join(evidence,'red.json'),{...binding,kind:'red-check',id:'red',obligation:f.obligation,recipeHash:f.recipeHash,mutated:keep(mutant,'mutant.jsonl'),restored:keep(restoredDir,'restored.jsonl')});
    writeJson(join(evidence,'burn.json'),{...binding,kind:'burn-in',id:'burn',run:keep(burn,'burn.jsonl')});
    writeJson(join(evidence,'acceptance.json'),acceptance(f.record,f.test,{behaviorDigest:behavior.digest,at:new Date().toISOString()}));
    const ready=await invoke(f);assert.equal(ready.code,0,JSON.stringify(ready.result));assert.equal(ready.result.verdict,'ready');
    writeJson(join(evidence,'invalid.json'),{kind:'acceptance',id:'unvalidated'});const malformed=await invoke(f);assert.equal(malformed.code,3);assert.match(malformed.result.summary,/persisted evidence unavailable\/invalid/);rmSync(join(evidence,'invalid.json'));
    assert.match(readFileSync(join(ready.result.runDir,'verdict.md'),'utf8'),/addendum is empty/);
    mkdirSync(join(f.suite,'excluded'));writeFileSync(join(f.suite,'excluded/playwright.config.ts'),`import {writeFileSync} from 'node:fs';writeFileSync('excluded-loaded.txt','loaded');throw new Error('excluded config must not load');`);
    const excluded={...f.profile,suites:[...f.profile.suites,{id:'excluded',config:'excluded/playwright.config.ts'}],classification:[...f.profile.classification,{id:'exclude-generic',target:{suite:'excluded'},from:null,to:'excluded',by:'Quinn QA',role:'qa',standIn:true,at:'2026-10-09',reason:'never execute this fixture suite'}]};
    writeJson(join(f.suite,'.test-lab/profile.json'),excluded);const exclude=await invoke(f);assert.equal(exclude.code,0,JSON.stringify(exclude.result));assert.equal(existsSync(join(f.suite,'excluded-loaded.txt')),false);writeJson(join(f.suite,'.test-lab/profile.json'),f.profile);
    f.state.mutant=true;const red=await invoke(f);assert.equal(red.code,2,JSON.stringify(red.result));assert.equal(red.result.rule,5);f.state.mutant=false;
    f.state.missing=true;const missing=await invoke(f);assert.equal(missing.code,3);assert.equal(missing.result.rule,3);f.state.missing=false;
    f.state.actor='editor';const role=await invoke(f);assert.equal(role.code,3,JSON.stringify(role.result));assert.match(role.result.summary,/actor/);f.state.actor='anonymous';
    f.state.teardown=true;const teardown=await invoke(f);assert.equal(teardown.code,3);assert.equal(teardown.result.rule,3);f.state.teardown=false;
    f.state.editDuringRun=true;const edited=await invoke(f);assert.equal(edited.code,3);assert.equal(edited.result.rule,2);writeFileSync(join(f.app,'template.txt'),'Generic fixture');
    rmSync(join(evidence,'acceptance.json'));const stale=await invoke(f);assert.equal(stale.code,3);assert.equal(stale.result.rule,7);
    const empty={...f.profile,regression:[]};writeJson(join(f.suite,'.test-lab/profile.json'),empty);const invalid=await invoke(f);assert.equal(invalid.code,4);assert.equal(invalid.result.rule,1);writeJson(join(f.suite,'.test-lab/profile.json'),f.profile);
    const preflight=await invoke(f,'preflight');assert.equal(preflight.code,3);assert.match(preflight.result.summary,/no completed fast run/);
    const requests=f.state.httpRequests;const verify=await invoke(f,'verify');assert.equal(verify.code,0,JSON.stringify(verify.result));assert.match(verify.result.summary,/readiness was not evaluated/);assert.equal(f.state.httpRequests,requests);
    // Missing operation dependencies cannot become a green default.
    const unavailable=await coordinate({operation:'run',appRoot:f.app,suiteRoot:f.suite,environment:'local',noWork:true});assert.equal(unavailable.verdict.verdict,'inconclusive');assert.match(unavailable.summary,/worktree was not confirmed/);
    const wrong=await coordinate({operation:'run',appRoot:f.app,suiteRoot:f.suite,environment:'local',noWork:true,adapter:{...commandAdapter(join(f.suite,'adapter.ts'),f.app),identity:async()=>({appRoot:f.suite})}});assert.equal(wrong.verdict.rule,2);
  }finally{await f.cleanup();}
});

test('CLI requires a fresh source snapshot and source-to-reading provenance without changing QA scope',async()=>{
  const f=await setupCoordinator('1.60.0');
  try {
    const raw={id:1,suite_id:1,title:'Generic heading',custom_steps:'Open the served page',custom_expected:'The heading reads Generic fixture',priority_id:7};
    const source={schema:1,source:'testrail',project:1,complete:true,fetchedAt:'2000-01-01T00:00:00Z',priorities:[{id:7,name:'Short Regression'}],suites:[{id:1,cases:[raw]}]};
    const record={...f.record,sourcePolicy:{association:{source:'testrail' as const,project:1,suite:1,case:1},reason:'QA binds this reading to its independent source'},approval:{...f.record.approval!},provenance:{draftedFrom:'testrail' as const,independentRefs:['testrail:project:1:suite:1:case:1'],selfDerivedAcceptedBy:null}};
    record.approval.hash=canonicalCaseHash(record);
    const beforeSet=new Map([['REG-1',f.record.approval!.hash]]);const afterSet=new Map([['REG-1',record.approval.hash]]);
    writeJson(join(f.suite,'.test-lab/transitions/bind-source.json'),{id:'bind-source',kind:'approval',baseCommit:(await f.g(f.suite,['rev-parse','origin/main'])).stdout.trim(),setBefore:setHash(beforeSet),setAfter:setHash(afterSet),delta:[{case:'REG-1',before:f.record.approval!.hash,after:record.approval.hash}],supersedes:[],by:record.approval.by,role:record.approval.role,standIn:record.approval.standIn,at:new Date().toISOString(),reason:'QA explicitly approves the source association policy'});
    const binding=(sourceCase=1,rawHash=hashOf(raw))=>{
      const fields={case:'REG-1',sourceCase,suite:1,rawHash,caseHash:record.approval.hash};
      return {...fields,approval:{...f.record.approval!,hash:sourceBindingHash(1,fields)}};
    };
    writeJson(join(f.suite,'.test-lab/cases/regression/REG-1.json'),record);
    writeJson(join(f.suite,'.test-lab/sources/current.json'),source);
    writeJson(join(f.suite,'.test-lab/source.json'),{schema:1,snapshot:'sources/current.json',cases:[binding()]});
    const stale=await invoke(f);assert.equal(stale.code,3);assert.equal(stale.result.rule,3);assert.match(stale.result.summary,/snapshot is stale/);
    writeJson(join(f.suite,'.test-lab/sources/current.json'),{...source,fetchedAt:new Date().toISOString()});
    const fresh=await invoke(f);assert.equal(fresh.code,3);assert.equal(fresh.result.rule,7,JSON.stringify(fresh.result));
    writeJson(join(f.suite,'.test-lab/source.json'),{schema:1,snapshot:'sources/current.json',cases:[binding(2)]});
    const changed=await invoke(f);assert.equal(changed.code,3);assert.equal(changed.result.rule,3);assert.match(changed.result.summary,/provenance/);
    writeJson(join(f.suite,'.test-lab/source.json'),{schema:1,snapshot:'sources/current.json',cases:[binding()]});
    writeJson(join(f.suite,'.test-lab/cases/regression/REG-1.json'),{...record,provenance:{...record.provenance,independentRefs:['testrail:project:2:suite:1:case:1']}});
    const unrelated=await invoke(f);assert.equal(unrelated.code,3);assert.equal(unrelated.result.rule,3);assert.match(unrelated.result.summary,/provenance/);
    writeJson(join(f.suite,'.test-lab/cases/regression/REG-1.json'),record);
    const rawChanged={...raw,custom_expected:'A changed requirement'};
    writeJson(join(f.suite,'.test-lab/sources/current.json'),{...source,fetchedAt:new Date().toISOString(),suites:[{id:1,cases:[rawChanged]}]});
    const unsignedRefresh={...binding(),rawHash:hashOf(rawChanged)};
    writeJson(join(f.suite,'.test-lab/source.json'),{schema:1,snapshot:'sources/current.json',cases:[unsignedRefresh]});
    const refreshed=await invoke(f);assert.equal(refreshed.code,3);assert.match(refreshed.result.summary,/provenance/);
    const wrongOwner={...binding(1,hashOf(rawChanged)),approval:{...binding(1,hashOf(rawChanged)).approval,by:'Dana Dev',role:'developer',standIn:false}};
    writeJson(join(f.suite,'.test-lab/source.json'),{schema:1,snapshot:'sources/current.json',cases:[wrongOwner]});
    const refused=await invoke(f);assert.equal(refused.code,3);assert.match(refused.result.summary,/provenance/);
  }finally{await f.cleanup();}
});

test('cross-repository work binds to the application branch and journal while QA stores its addendum',async()=>{
  const f=await setupCoordinator('1.60.0');const previous=process.env['TEST_LAB_DATA'];
  try {
    process.env['TEST_LAB_DATA']=join(f.dir,'journal-data');
    await f.g(f.app,['branch','-m','fixture-work-branch']);
    await f.g(f.app,['config','branch.fixture-work-branch.test-lab-work','WORK-1']);
    await f.g(f.suite,['config','branch.fixture-candidate.test-lab-work','WRONG-QA-WORK']);
    const key=await repoKeyOf(f.app);const at=new Date().toISOString();
    recordScopeChange(f.suite,key,{id:'start',kind:'start',ticket:'WORK-1',by:'Dana Dev',role:'developer',standIn:false,reason:'generic application work',at},'fixture-work-branch');
    const record=caseRecord('ADD-1','addendum',{obligations:['O1']});writeJson(join(f.suite,'.test-lab/cases/addendum/ADD-1.json'),record);
    recordScopeChange(f.suite,key,{id:'add',kind:'add',ticket:'WORK-1',case:'ADD-1',by:'Dana Dev',role:'developer',standIn:false,reason:'independent generic work case',at},'fixture-work-branch');
    const args=[cli,'run','--app-root',f.app,'--suite-root',f.suite,'--env','local','--adapter',join(f.suite,'adapter.ts')];
    let result:{code:number;stdout:string};
    try{const r=await exec(process.execPath,args,{env:process.env,timeout:180000});result={code:0,stdout:r.stdout};}catch(e){result=e as {code:number;stdout:string};}
    const summary=JSON.parse(result.stdout);assert.equal(result.code,2,JSON.stringify(summary));assert.equal(summary.rule,5);
    const manifest=JSON.parse(readFileSync(join(summary.runDir,'manifest.json'),'utf8'));
    const observed=manifest.observations.find((o:{work?:unknown})=>o.work)?.work;
    assert.equal(observed.applicationRoot,f.app);assert.equal(observed.branch,'fixture-work-branch');assert.equal(observed.resolution.ticket,'WORK-1');assert.equal(observed.check.ok,true);assert.deepEqual(observed.check.addendum,['ADD-1']);
    assert.match(readFileSync(join(summary.runDir,'verdict.md'),'utf8'),/ADD-1/);
  }finally{if(previous===undefined)delete process.env['TEST_LAB_DATA'];else process.env['TEST_LAB_DATA']=previous;await f.cleanup();}
});

for(const version of VERSIONS)test(`after-setup browser actor uses actual login state on ${version}`,async()=>{
  const f=await setupCoordinator(version,{authenticated:true});
  try {
    const result=await invoke(f);assert.equal(result.code,3,JSON.stringify(result.result));assert.equal(result.result.rule,7,JSON.stringify(result.result));
    assert.ok(f.state.loginRequests>0);assert.equal(f.state.actorBeforeLogin,false);
    const manifest=JSON.parse(readFileSync(join(result.result.runDir,'manifest.json'),'utf8'));
    const suite=manifest.observations.at(-1).suites[0];const run=readInvocation({id:'role',suite:'e2e',dir:suite.run.dir});
    const actual=run.tests.find(t=>t.declaration.project==='desktop')!.results[0]!.actorProbes![0]!;
    assert.equal(actual.expected,'editor');assert.equal(actual.actual,'editor');assert.equal(actual.ok,true);
    f.state.actor='wrong-role';const before=f.state.bodyRequests;const wrong=await invoke(f);assert.equal(wrong.code,3);assert.match(wrong.result.summary,/actor role\/host/);assert.equal(f.state.bodyRequests,before);
  }finally{await f.cleanup();}
});

test('CLI interrupt finalizes an inconclusive verdict and terminates only its owned Playwright tree',async()=>{
  const f=await setupCoordinator('1.60.0');
  try{
    f.state.slow=true;
    const child=spawn(process.execPath,[cli,'run','--app-root',f.app,'--suite-root',f.suite,'--env','local','--no-work','--adapter',join(f.suite,'adapter.ts')],{stdio:['ignore','pipe','pipe']});
    let stdout='';let stderr='';child.stdout.on('data',b=>stdout+=String(b));child.stderr.on('data',b=>stderr+=String(b));
    await new Promise<void>(done=>{const deadline=setTimeout(()=>{clearInterval(timer);done();},15000);const timer=setInterval(()=>{if(f.state.bodyRequests>0){clearInterval(timer);clearTimeout(deadline);done();}},30);});
    // Wait for the body via its server observation, not a manufactured ledger.
    child.kill('SIGINT');const code=await new Promise<number|null>(done=>child.on('close',done));
    assert.equal(code,3,stderr);const result=JSON.parse(stdout.trim());assert.equal(result.verdict,'inconclusive');
    const manifest=JSON.parse(readFileSync(join(result.runDir,'manifest.json'),'utf8'));assert.ok(manifest.invocations.some((i:{purpose:string})=>i.purpose==='run'));
    assert.match(result.summary,/signal|completion|interrupted/);
    // An interrupt is never reported as a changed worktree, and its run problem is always recorded.
    assert.doesNotMatch(result.summary,/worktree changed/);assert.ok(manifest.problems.some((p:string)=>/operation interrupted/.test(p)),JSON.stringify(manifest.problems));
    const controller=new AbortController();controller.abort();const before=f.state.bodyRequests;
    const canceled=await coordinate({operation:'run',appRoot:f.app,suiteRoot:f.suite,environment:'local',noWork:true,adapter:commandAdapter(join(f.suite,'adapter.ts'),f.app),signal:controller.signal});
    assert.equal(canceled.exitCode,3);assert.equal(canceled.verdict.verdict,'inconclusive');assert.equal(f.state.bodyRequests,before);
    assert.match(readFileSync(join(canceled.runDir,'manifest.json'),'utf8'),/operation interrupted/);
  }finally{await f.cleanup();}
});
