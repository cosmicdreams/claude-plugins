import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonicalCaseHash } from '../../src/cases.ts';
import { main } from '../../src/cli.ts';
import { commandAdapter } from '../../src/local-adapter.ts';
import { readBaseRef } from '../../src/regression-git.ts';
import { stopProcessTree, ownProcessGroup } from '../../src/process-tree.ts';
import { caseRecord, tmp } from './support.ts';
import { fixtureProfile, writeJson } from '../fixtures/coordinator.ts';
const pause=(ms:number)=>new Promise<void>(done=>setTimeout(done,ms));
const snapshot={schema:1,source:'testrail',project:1,complete:true,fetchedAt:new Date().toISOString(),priorities:[{id:7,name:'Short Regression'}],suites:[{id:1,cases:[{id:1,suite_id:1,title:'Heading',priority_id:7,custom_steps:'Open',custom_expected:'Heading'}]}]};

test('source policy participates in owner approval and behavior hashes, independent references alone do not',()=>{
  const record=caseRecord('REG-1','regression');
  const bound={...record,sourcePolicy:{association:{source:'testrail' as const,project:1,suite:1,case:1},reason:'QA binds the approved reading'}};
  assert.notEqual(canonicalCaseHash(bound),canonicalCaseHash(record));
  assert.notEqual(canonicalCaseHash({...bound,sourcePolicy:{association:null,reason:'QA replaces this source'}}),canonicalCaseHash(bound));
  assert.equal(canonicalCaseHash({...record,provenance:{...record.provenance,independentRefs:['testrail:project:1:suite:1:case:1']}}),canonicalCaseHash(record));
});

test('same-commit linked-worktree fetch refreshes its own FETCH_HEAD with no reflog movement',async()=>{
  const dir=tmp('test-lab-fetch-linked-');const run=(cwd:string,args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd,encoding:'utf8'}).trim();
  try {
    const seed=join(dir,'seed');mkdirSync(seed);run(seed,['init','-b','fixture-seed']);writeFileSync(join(seed,'input'),'fixture');run(seed,['add','.']);run(seed,['commit','-m','test: fixture']);run(seed,['branch','main']);
    const remote=join(dir,'remote.git');run(dir,['clone','--bare',seed,remote]);const local=join(dir,'local');run(dir,['clone',remote,local]);run(local,['fetch','origin','main']);
    const common=resolve(local,run(local,['rev-parse','--git-common-dir']));
    const linked=join(dir,'linked');run(local,['worktree','add','-b','fixture-linked',linked]);
    const old=new Date('2000-01-01T00:00:00Z');utimesSync(join(common,'FETCH_HEAD'),old,old);
    // Remove only the disposable fixture's ref log to isolate same-commit FETCH_HEAD freshness.
    rmSync(join(common,'logs/refs/remotes/origin/main'),{force:true});
    const before=await readBaseRef(linked,'origin','main');assert.ok(before.fetchedAt===null||before.fetchedAt.getTime()===old.getTime());
    run(linked,['fetch','origin','main']);
    const path=resolve(linked,run(linked,['rev-parse','--git-path','FETCH_HEAD']));assert.notEqual(path,join(common,'FETCH_HEAD'));
    const after=await readBaseRef(linked,'origin','main');assert.equal(after.commit,before.commit);assert.ok(after.fetchedAt!==null&&Date.now()-after.fetchedAt.getTime()<10000);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

for(const branch of ['main','master'])test(`source refuses ${branch} and symlinked destinations before any creation`,async()=>{
  const dir=tmp('test-lab-source-guard-');
  try {
    const repo=join(dir,'repo');mkdirSync(repo);execFileSync('git',['init','-b',branch],{cwd:repo,stdio:'ignore'});
    const file=join(dir,'snapshot.json');writeFileSync(file,JSON.stringify(snapshot));const link=join(dir,'alias');symlinkSync(repo,link,'dir');
    for(const output of [join(repo,'new-import'),join(link,'new-import')]) {
      assert.equal(await main(['source','--snapshot',file,'--output',output]),4);assert.equal(existsSync(output),false);
    }
    execFileSync('git',['checkout','-b','fixture-source'],{cwd:repo,stdio:'ignore'});
    const output=join(link,'approved-import');assert.equal(await main(['source','--snapshot',file,'--output',output]),0);assert.ok(existsSync(join(realpathSync(repo),'approved-import/drafts.json')));
    assert.equal(await main(['source','--snapshot',file,'--output',output]),4);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

for(const command of ['source','stage-kit'])for(const extra of [['--tier','full'],['--no-work'],['--timeout-ms','1'],['--adapter','ignored']])test(`${command} rejects irrelevant ${extra[0]} before writing`,async()=>{
  const dir=tmp('test-lab-command-options-');
  try {
    const file=join(dir,'snapshot.json');writeFileSync(file,JSON.stringify(snapshot));const output=join(dir,'import');
    if(command==='stage-kit'){execFileSync('git',['init','-b','fixture-stage'],{cwd:dir,stdio:'ignore'});writeJson(join(dir,'.test-lab/profile.json'),fixtureProfile());}
    const args=command==='source'?['--snapshot',file,'--output',output]:['--suite-root',dir,'--suite','e2e'];
    assert.equal(await main([command,...args,...extra]),4);assert.equal(existsSync(output),false);assert.equal(existsSync(join(dir,'support/test-lab')),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

for(const mode of ['abort','timeout'])test(`command adapter ${mode} stops its owned descendant and preserves unrelated process`,async()=>{
  const dir=tmp('test-lab-adapter-tree-');const controller=new AbortController();
  const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:ownProcessGroup,stdio:'ignore'});
  let adapterPromise:Promise<unknown>|undefined;
  try {
    const script=join(dir,'adapter.cjs');const pidFile=join(dir,'child.pid');const beats=join(dir,'beats');
    writeFileSync(script,`const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const child=spawn(process.execPath,['-e',${JSON.stringify(`const {appendFileSync}=require('node:fs');setInterval(()=>appendFileSync(${JSON.stringify(beats)},'x'),20);`)}],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`);
    const adapter=commandAdapter(script,dir);
    // New contract: coordinator supplies operation cancellation and a finite timeout to every call.
    // The timeout leaves room for two Node start-ups under a loaded full gate; the test proves the
    // descendant was beating before the timeout fired, so the timeout path is the one exercised.
    adapterPromise=adapter.identity({signal:controller.signal,timeoutMs:mode==='timeout'?3000:5000});
    let outcome:unknown='pending';
    const settled=adapterPromise.then(()=>null,e=>e).then(e=>(outcome=e));
    for(let i=0;i<200&&!existsSync(beats)&&outcome==='pending';i++)await pause(20);
    assert.ok(existsSync(beats),`the adapter's descendant never became ready; the call ended first with: ${String(outcome)}`);
    assert.equal(outcome,'pending','the call ended before its descendant was ready');
    if(mode==='abort')controller.abort();
    // The exact reason, and any cleanup-verification failure is reported, never a pass.
    assert.match(String(await settled),mode==='abort'?/^Error: local adapter operation interrupted\/aborted$/:/^Error: local adapter timeout$/);
    const count=readFileSync(beats,'utf8').length;await pause(100);assert.equal(readFileSync(beats,'utf8').length,count);
    assert.doesNotThrow(()=>process.kill(unrelated.pid!,0));
  }finally {
    controller.abort();await adapterPromise?.catch(()=>{});
    if(existsSync(join(dir,'child.pid'))){try{process.kill(Number(readFileSync(join(dir,'child.pid'),'utf8')),'SIGKILL');}catch{}}
    await stopProcessTree(unrelated);rmSync(dir,{recursive:true,force:true});
  }
});

test('nested coordinator locks and run artifacts never change the suite input manifest',async()=>{
  const dir=tmp('test-lab-nested-outputs-');
  try {
    execFileSync('git',['init','-b','fixture-output'],{cwd:dir,stdio:'ignore'});
    const {contentManifest}=await import('../../src/identity.ts');const before=await contentManifest(dir);
    mkdirSync(join(dir,'second/.test-lab/runs/run'),{recursive:true});writeFileSync(join(dir,'second/.test-lab/operation.lock'),'owned');writeFileSync(join(dir,'second/.test-lab/runs/run/manifest.json'),'{}');
    const after=await contentManifest(dir);assert.equal(after.digest,before.digest);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('source association policy follows QA versus developer ownership and stales legacy approval',async()=>{
  const {approvalProblem}=await import('../../src/cases.ts');const {ROLES}=await import('./support.ts');const {parseCase}=await import('../../src/persistence.ts');
  for(const track of ['regression','addendum'] as const) {
    const original=caseRecord('OWNER-1',track),bound={...original,sourcePolicy:{association:{source:'testrail' as const,project:1,suite:1,case:1},reason:'Owner approves this association'},approval:{...original.approval!}};
    assert.equal(approvalProblem(bound,ROLES),'edited since its approval');bound.approval.hash=canonicalCaseHash(bound);assert.equal(approvalProblem(parseCase(bound),ROLES),null);
    if(track==='regression')assert.match(approvalProblem({...bound,approval:{...bound.approval,by:'Dana Dev',role:'developer',standIn:false}},ROLES)??'',/QA role|qa role/);
    const detached={...bound,sourcePolicy:{association:null,reason:'Owner explicitly changes the source'}};assert.equal(approvalProblem(detached,ROLES),'edited since its approval');
  }
});
test('source eligibility is trusted/approved policy, never every independent reference',async()=>{
  const {requiredSourceAssociations}=await import('../../src/source-policy.ts');const record=caseRecord('REG-1','regression');
  record.provenance.independentRefs=['testrail:project:1:suite:1:case:1'];
  assert.equal(requiredSourceAssociations(new Set([record.id]),new Map([[record.id,record]]),new Map(),null).associations.size,0);
  const baseline=new Map([[record.id,{source:'testrail' as const,project:1,suite:1,case:1}]]);
  const retained=requiredSourceAssociations(new Set([record.id]),new Map([[record.id,record]]),baseline,null);assert.equal(retained.associations.size,1);
  const removed={...record,sourcePolicy:{association:null,reason:'Approved independent local requirement'}};
  assert.equal(requiredSourceAssociations(new Set([record.id]),new Map([[record.id,removed]]),baseline,null).associations.size,0);
});
test('selected input union rejects extras/missing/conflicts and preserves shared names and empty suites',async()=>{
  const {operationInputs}=await import('../../src/operation-inputs.ts');const environment={id:'local',kind:'local-candidate' as const,baseUrl:'http://127.0.0.1:4180',baseUrlEnv:'BASE_URL'};
  const d=(name:string)=>({name,classification:'nonsecret' as const,readers:['tests/a.ts']});
  const suites=[{id:'one',config:'one/config.ts',declaredEnvironmentInputs:[d('SHARED'),d('FIRST'),d('BASE_URL')]},{id:'two',config:'two/config.ts',declaredEnvironmentInputs:[d('SHARED'),d('SECOND')]},{id:'empty',config:'empty/config.ts'}];
  const values={SHARED:{state:'unset' as const},FIRST:{state:'set' as const,value:''},SECOND:{state:'set' as const,value:'second'}};
  const result=operationInputs(suites,environment,values);assert.deepEqual(result.problems,[]);assert.deepEqual(Object.keys(result.projections.get('one')!).sort(),['BASE_URL','FIRST','SHARED']);assert.deepEqual(Object.keys(result.projections.get('two')!).sort(),['SECOND','SHARED']);assert.deepEqual(result.projections.get('empty'),{});
  assert.ok(operationInputs(suites,environment,{...values,EXTRA:{state:'unset'}}).problems.length>0);assert.ok(operationInputs(suites,environment,{FIRST:values.FIRST}).problems.some(p=>p.includes('SHARED')));
  assert.ok(operationInputs(suites,environment,{...values,BASE_URL:{state:'unset'}}).problems.some(p=>p.includes('planner-owned')));
  assert.deepEqual(operationInputs(suites,environment,{...values,BASE_URL:{state:'set',value:environment.baseUrl}}).problems,[]);
  const conflict=[...suites,{id:'conflict',config:'conflict/config.ts',declaredEnvironmentInputs:[{...d('SHARED'),classification:'secret' as never}]}];assert.ok(operationInputs(conflict,environment,values).problems.some(p=>p.includes('conflicting')));
});
