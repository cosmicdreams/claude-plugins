import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadavg, tmpdir } from 'node:os';
import { VERSIONS } from './harness.ts';
import { setupCoordinator, writeJson } from '../fixtures/coordinator.ts';
import { coordinate } from '../../src/coordinator.ts';
import { commandAdapter } from '../../src/local-adapter.ts';
import { stageKit } from '../../src/staging.ts';
import { hashOf } from '../../src/canonical.ts';
import { canonicalCaseHash } from '../../src/cases.ts';
import { setHash } from '../../src/regression.ts';
import { certifyCoordinator } from '../fixtures/coordinator-evidence.ts';
import { sourceBindingHash } from '../../src/persistence.ts';
import { readInvocation } from '../../src/run-observation.ts';
import type { CaseRecord, Profile } from '../../src/model.ts';
type Fixture=Awaited<ReturnType<typeof setupCoordinator>>;
const exec=promisify(execFile);
async function invoke(f:Fixture,extra:Partial<Parameters<typeof coordinate>[0]>={}):Promise<Awaited<ReturnType<typeof coordinate>>> {
  if(extra.adapter||extra.signal)return coordinate({operation:'run',appRoot:f.app,suiteRoot:f.suite,environment:'local',noWork:true,adapter:commandAdapter(join(f.suite,'adapter.ts'),f.app),...extra});
  const invokedAt=Date.now(),load=loadavg();
  const args=[join(import.meta.dirname,'../../src/cli.ts'),'run','--app-root',f.app,'--suite-root',f.suite,'--env','local','--no-work','--adapter',join(f.suite,'adapter.ts')];
  if(extra.environmentValues){const inputs=join(f.dir,'inputs.json');writeJson(inputs,extra.environmentValues);args.push('--inputs',inputs);}
  let stdout:string;try{stdout=(await exec(process.execPath,args,{timeout:180000})).stdout;}catch(e){const error=e as {stdout:string;stderr:string;code?:unknown;signal?:unknown;killed?:unknown};
    const diagnostic=join(tmpdir(),'test-lab-pw-diagnostics',`${new Date().toISOString().replace(/[:.]/g,'-')}-multisuite-cli.json`);mkdirSync(join(tmpdir(),'test-lab-pw-diagnostics'),{recursive:true});writeJson(diagnostic,{elapsedMs:Date.now()-invokedAt,loadBefore:load,loadAfter:loadavg(),timeoutMs:180000,stdout:error.stdout,stderr:error.stderr,code:error.code,signal:error.signal,killed:error.killed});
    assert.ok(error.stdout,`CLI produced no output; diagnostics: ${diagnostic}; ${error.stderr}`);stdout=error.stdout;}
  const summary=JSON.parse(stdout.trim());const file=JSON.parse(readFileSync(join(summary.runDir,'verdict.json'),'utf8'));return {...summary,verdict:file.verdict,file};
}
const manifest=(r:Awaited<ReturnType<typeof coordinate>>)=>JSON.parse(readFileSync(join(r.runDir,'manifest.json'),'utf8'));
async function addSuites(suite:string,profile:Profile,record:CaseRecord,names:string[]) {
  const ledger=JSON.parse(readFileSync(join(suite,'.test-lab/ledger.json'),'utf8'));const config=readFileSync(join(suite,'playwright.config.ts'),'utf8');
  for(const [i,name] of names.entries()) {
    const id=`suite${i+2}`,root=join(suite,id),caseId=`REG-${i+2}`;mkdirSync(root);mkdirSync(join(root,'tests'));copyFileSync(join(suite,'teardown.ts'),join(root,'teardown.ts'));
    writeJson(join(suite,`.test-lab/cases/regression/${caseId}.json`),{...record,id:caseId});profile.regression.push(caseId);
    let spec=readFileSync(join(suite,'tests/home.spec.ts'),'utf8').replaceAll('REG-1',caseId).replaceAll('process.env.FIRST_HEADING',"'Generic fixture'");
    if(name)spec=spec.replace("'Generic fixture');",`process.env.${name});`);
    writeFileSync(join(root,'tests/home.spec.ts'),spec);writeFileSync(join(root,'playwright.config.ts'),name?config:config.replace('process.env.BASE_URL',JSON.stringify(profile.environments[0]!.baseUrl)));
    profile.suites.push({id,config:`${id}/playwright.config.ts`,declaredEnvironmentInputs:name?[{name:'BASE_URL',classification:'nonsecret',readers:['playwright.config.ts']},{name,classification:'nonsecret',readers:['tests/home.spec.ts']}]:[]});
    profile.classification.push({...profile.classification[0]!,id:`onboard-${id}`,target:{suite:id}});ledger.mappings.push({...ledger.mappings[0],obligation:{...ledger.mappings[0].obligation,case:caseId},test:{...ledger.mappings[0].test,suite:id}});await stageKit(suite,`${id}/playwright.config.ts`);
  }
  writeJson(join(suite,'.test-lab/profile.json'),profile);writeJson(join(suite,'.test-lab/ledger.json'),ledger);
}
for(const version of VERSIONS)test(`multiple suites get exact input projections for every invocation on ${version}`,async()=>{
  const f=await setupCoordinator(version,{prepare:async(suite,profile,record)=>{
    const spec=join(suite,'tests/home.spec.ts');writeFileSync(spec,readFileSync(spec,'utf8').replace("'Generic fixture');",'process.env.FIRST_HEADING);'));profile.suites[0]!.declaredEnvironmentInputs!.push({name:'FIRST_HEADING',classification:'nonsecret',readers:['tests/home.spec.ts']});await addSuites(suite,profile,record,['SECOND_HEADING','']);
  }});
  try {
    const environmentValues={FIRST_HEADING:{state:'set' as const,value:'Generic fixture'},SECOND_HEADING:{state:'set' as const,value:'Generic fixture'}};
    const result=await invoke(f,{environmentValues});assert.equal(result.verdict.rule,7,result.summary);const m=manifest(result);assert.equal(m.invocations.length,9);
    for(const [id,expected] of [['e2e',['BASE_URL','FIRST_HEADING']],['suite2',['BASE_URL','SECOND_HEADING']],['suite3',[]]] as const) {
      const suite=m.observations.at(-1).suites.find((s:{suite:string})=>s.suite===id);assert.ok(suite?.run);
      for(const i of m.invocations.filter((i:{suite:string})=>i.suite===id))assert.deepEqual(readInvocation({id:'read',suite:id,dir:i.dir}).begin!.environmentInputs?.declarations.map(d=>d.name).sort()??[],expected);
      assert.ok(suite.afterDigests.behavior.every(([,d]:[string,{status:string}])=>d.status==='resolved'));
    }
    for(const values of [{...environmentValues,EXTRA:{state:'unset' as const}},{FIRST_HEADING:environmentValues.FIRST_HEADING}]) {const refused=await invoke(f,{environmentValues:values});assert.equal(refused.exitCode,4,refused.summary);assert.match(refused.summary,/input|value/);assert.equal(manifest(refused).invocations.length,0);}
    const owned=await invoke(f,{environmentValues:{...environmentValues,BASE_URL:{state:'set',value:'http://127.0.0.1:1'}}});assert.equal(owned.exitCode,4);assert.match(owned.summary,/planner|BASE_URL/);
  }catch(error){
    const diagnostic=join(tmpdir(),'test-lab-pw-diagnostics',`${new Date().toISOString().replace(/[:.]/g,'-')}-multisuite-${version}`);mkdirSync(diagnostic,{recursive:true});cpSync(f.dir,join(diagnostic,'fixture'),{recursive:true});writeJson(join(diagnostic,'failure.json'),{error:String(error),load:loadavg()});throw error;
  }finally{await f.cleanup();}
});
for(const version of VERSIONS)test(`declarative required skips are Not ready without actor witnesses on ${version}`,async()=>{
  const f=await setupCoordinator(version);
  try {
    const file=join(f.suite,'tests/home.spec.ts'),text=readFileSync(file,'utf8');
    for(const method of ['skip','fixme']) {writeFileSync(file,text.replace("test('heading'",`test.${method}('heading'`));const r=await invoke(f);assert.equal(r.exitCode,2,r.summary);assert.equal(r.verdict.rule,5);const obs=readInvocation({id:'skip',suite:'e2e',dir:manifest(r).observations.at(-1).suites[0].run.dir});assert.equal(obs.tests[0]!.results[0]!.actorProbes?.length??0,0);assert.equal(f.state.bodyRequests,0);assert.equal(r.verdict.required[0]!.outcome,'skipped');}
    writeFileSync(file,text.replace("registerActorProbe({path:'actor',roleField:'role'});",''));const missing=await invoke(f);assert.equal(missing.exitCode,3);assert.equal(missing.verdict.rule,3);assert.match(missing.summary,/actor observation missing/);
    writeFileSync(file,text.replace("registerActorProbe({path:'actor',roleField:'role'});","test.beforeEach(async()=>{throw new Error('before actor setup failed');});"));const failed=await invoke(f);assert.equal(failed.exitCode,3);assert.match(failed.summary,/actor observation missing/);assert.ok(failed.verdict.failures.length>0);
  }finally{await f.cleanup();}
});
for(const version of VERSIONS)test(`later suite exception retains earlier failures in all artifacts on ${version}`,async()=>{
  const f=await setupCoordinator(version,{prepare:async(suite,profile,record)=>addSuites(suite,profile,record,[''])});
  try {
    f.state.mutant=true;const local=join(f.suite,'suite2/node_modules/@playwright/test');mkdirSync(local,{recursive:true});writeJson(join(local,'package.json'),{name:'@playwright/test',exports:{'.':'./missing.js'}});
    const r=await invoke(f);assert.notEqual(r.exitCode,0);assert.ok(r.verdict.failures.some(t=>t.test.suite==='e2e'),r.summary);assert.ok(r.verdict.required.some(c=>c.case==='REG-1'&&c.outcome==='failed'));assert.ok(r.verdict.required.some(c=>c.case==='REG-2'&&c.outcome==='not-run'));
    for(const file of ['verdict.json','verdict.md','verdict.html'])assert.match(readFileSync(join(r.runDir,file),'utf8'),/home.spec.ts/);
    const m=manifest(r);assert.ok(m.invocations.some((i:{suite:string;purpose:string})=>i.suite==='e2e'&&i.purpose==='run'));assert.ok(existsSync(join(m.observations.at(-1).suites[0].run.dir,'steps.jsonl')));
  }finally{await f.cleanup();}
});
const raw={id:1,suite_id:1,title:'Generic heading',custom_steps:'Open the served page',custom_expected:'The heading reads Generic fixture',priority_id:7};
export function sourceFiles(suite:string,record:CaseRecord,stale=true) {
  const source={schema:1,source:'testrail',project:1,complete:true,fetchedAt:stale?'2000-01-01T00:00:00Z':new Date().toISOString(),priorities:[{id:7,name:'Short Regression'}],suites:[{id:1,cases:[raw]}]},fields={case:record.id,sourceCase:1,suite:1,rawHash:hashOf(raw),caseHash:record.approval!.hash};
  writeJson(join(suite,'.test-lab/sources/current.json'),source);writeJson(join(suite,'.test-lab/source.json'),{schema:1,snapshot:'sources/current.json',cases:[{...fields,approval:{...record.approval!,hash:sourceBindingHash(1,fields)}}]});
}
for(const version of VERSIONS)test(`trusted source association survives provenance relabel/removal on ${version}`,async()=>{
  const f=await setupCoordinator(version,{prepare:async(suite,_profile,record)=>{record.provenance={draftedFrom:'testrail',independentRefs:['testrail:project:1:suite:1:case:1'],selfDerivedAcceptedBy:null};writeJson(join(suite,'.test-lab/cases/regression/REG-1.json'),record);sourceFiles(suite,record);}});
  try {
    for(const refs of [f.record.provenance.independentRefs,['ticket:generic-independent']]) {writeJson(join(f.suite,'.test-lab/cases/regression/REG-1.json'),{...f.record,provenance:{...f.record.provenance,draftedFrom:'ticket',independentRefs:refs}});const r=await invoke(f);assert.equal(r.exitCode,3);assert.match(r.summary,/snapshot is stale/,r.summary);assert.equal(manifest(r).invocations.length,0);}
    rmSync(join(f.suite,'.test-lab/source.json'));const removed=await invoke(f);assert.notEqual(removed.exitCode,0);assert.match(removed.summary,/source|provenance/);
  }finally{await f.cleanup();}
});
test('already aborted coordinator starts no adapters and pending custom adapters are bounded',async()=>{
  const f=await setupCoordinator('1.60.0');
  try {
    const marker=join(f.suite,'adapter-started');writeFileSync(join(f.suite,'adapter.cjs'),`require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');setInterval(()=>{},1000);`);const controller=new AbortController();controller.abort();
    const canceled=await invoke(f,{signal:controller.signal,adapter:commandAdapter(join(f.suite,'adapter.cjs'),f.app),timeoutMs:50});assert.equal(canceled.exitCode,3);assert.equal(existsSync(marker),false);
    let calls=0;const custom={name:'bounded fixture',identity:async()=>{calls++;return new Promise<never>(()=>{});},fixture:async()=>{throw new Error('must not follow canceled identity');}};
    const before=Date.now(),bounded=await invoke(f,{adapter:custom,timeoutMs:50});assert.equal(bounded.exitCode,3);assert.equal(calls,1);assert.ok(Date.now()-before<5000);assert.match(readFileSync(join(bounded.runDir,'manifest.json'),'utf8'),/timeout/);
    calls=0;assert.equal((await invoke(f,{adapter:custom,signal:controller.signal,timeoutMs:50})).exitCode,3);assert.equal(calls,0);
  }finally{await f.cleanup();}
});

for(const version of VERSIONS)test(`approved source policy certifies and explicit owner removal requires a QA transition on ${version}`,async()=>{
  const f=await setupCoordinator(version,{prepare:async(suite,_profile,record)=>{
    record.sourcePolicy={association:{source:'testrail',project:1,suite:1,case:1},reason:'QA approves this source association'};
    record.provenance.independentRefs=['testrail:project:1:suite:1:case:1'];record.approval!.hash=canonicalCaseHash(record);
    writeJson(join(suite,'.test-lab/cases/regression/REG-1.json'),record);sourceFiles(suite,record,false);
  }});
  try {
    await certifyCoordinator(f,()=>invoke(f));const ready=await invoke(f);assert.equal(ready.exitCode,0,ready.summary);
    sourceFiles(f.suite,f.record,true);
    for(const refs of [f.record.provenance.independentRefs,['ticket:independent']]) {
      const relabeled={...f.record,provenance:{...f.record.provenance,draftedFrom:'ticket',independentRefs:refs}};
      writeJson(join(f.suite,'.test-lab/cases/regression/REG-1.json'),relabeled);const stale=await invoke(f);assert.equal(stale.exitCode,3);assert.match(stale.summary,/snapshot is stale/);
    }
    const {sourcePolicy:_old,...removedPolicy}=f.record;writeJson(join(f.suite,'.test-lab/cases/regression/REG-1.json'),removedPolicy);assert.equal((await invoke(f)).exitCode,4);
    const independent:CaseRecord={...f.record,sourcePolicy:{association:null,reason:'QA replaces the retired external case with this local independent requirement'},provenance:{...f.record.provenance,draftedFrom:'ticket',independentRefs:['ticket:independent']},approval:{...f.record.approval!}};
    writeJson(join(f.suite,'.test-lab/cases/regression/REG-1.json'),independent);assert.equal((await invoke(f)).exitCode,4);
    independent.approval!.hash=canonicalCaseHash(independent);writeJson(join(f.suite,'.test-lab/cases/regression/REG-1.json'),independent);assert.equal((await invoke(f)).exitCode,4);
    const before=new Map([['REG-1',f.record.approval!.hash]]),after=new Map([['REG-1',independent.approval!.hash]]);
    writeJson(join(f.suite,'.test-lab/transitions/remove-source.json'),{id:'remove-source',kind:'approval',by:independent.approval!.by,role:'qa',standIn:true,at:new Date().toISOString(),reason:independent.sourcePolicy!.reason,baseCommit:(await f.g(f.suite,['rev-parse','origin/main'])).stdout.trim(),setBefore:setHash(before),setAfter:setHash(after),delta:[{case:'REG-1',before:f.record.approval!.hash,after:independent.approval!.hash}],supersedes:[]});
    const validRemoval=await invoke(f);assert.equal(validRemoval.verdict.rule,7,validRemoval.summary);assert.match(validRemoval.summary,/stale|acceptance|red check/);assert.doesNotMatch(validRemoval.summary,/snapshot is stale/);
    // Retiring the association cannot reuse the old behavior/evidence approval.
    assert.notEqual(independent.approval!.hash,f.record.approval!.hash);assert.equal(validRemoval.exitCode,3);
  }finally{await f.cleanup();}
});
