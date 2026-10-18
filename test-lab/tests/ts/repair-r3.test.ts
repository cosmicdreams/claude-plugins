import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { scanFile } from '../../src/imports.ts';
import { computeDigests } from '../../src/digest.ts';
import { innermostCarrying, normalize } from '../../src/normalize.ts';
import { evaluateCase, judgeBurnIn, judgeRedCheck, readLedgerRef } from '../../src/evidence.ts';
import { readInvocation, runStatus } from '../../src/run-observation.ts';
import { decide } from '../../src/verdict.ts';
import type { CaseRecord, ObligationRef } from '../../src/model.ts';
import * as S from './support.ts';

const ref: ObligationRef={case:'C1',step:'S1',obligation:'O1'};
function digestWorld(source:string) {
  const dir=S.tmp('r3-closure-');mkdirSync(join(dir,'kit'));
  writeFileSync(join(dir,'kit/kit.ts'),'export const kit=1;');writeFileSync(join(dir,'package-lock.json'),'{}');
  writeFileSync(join(dir,'spec.ts'),source);writeFileSync(join(dir,'helper.cjs'),'module.exports="strong";');writeFileSync(join(dir,'hidden.txt'),'strong');
  const begin={...new S.Ledger().test('t',{file:'spec.ts',titlePath:['t']}).begin(),rootDir:dir,configFile:null};
  return {dir,ctx:{suite:'e2e',suiteRoot:dir,begin,cases:new Map<string,CaseRecord>(),ledger:[],recipes:[],declaredInputs:[],declaredBaselines:[],kitDir:join(dir,'kit')}};
}
for(const loader of ["const load=require;load('./helper.cjs');", "import {createRequire} from 'node:module';const load=createRequire(import.meta.url);load('./helper.cjs');", "import * as m from 'node:module';const load=m.createRequire(import.meta.url);load('./helper.cjs');", "let load;load=require;load('./helper.cjs');"]) test(`R3-1 supported loader closure: ${loader}`,()=>{
  const w=digestWorld(loader),a=computeDigests(w.ctx).behavior.values().next().value;
  assert.equal(a?.status,'resolved');if(a?.status!=='resolved')return;
  assert.ok(a.inputs.some(i=>i.path==='helper.cjs'),'transitive module must be hashed');writeFileSync(join(w.dir,'helper.cjs'),'module.exports="weakened";');
  const b=computeDigests(w.ctx).behavior.values().next().value;assert.equal(b?.status,'resolved');if(b?.status==='resolved')assert.notEqual(a.digest,b.digest);
});
for(const flow of ["const load={require};load.require('./helper.cjs');", "const load=true?require:require;load('./helper.cjs');", "const load=require||require;load('./helper.cjs');", "const load=require??require;load('./helper.cjs');", "holder.load=require;holder.load('./helper.cjs');", "function loader(){return require}loader()('./helper.cjs');", "const load=()=>require;load()('./helper.cjs');", "consume(require);", "require.call(null,'./helper.cjs');", "module.require('./helper.cjs');", "const m=require('node:module');const {createRequire:make}=m;const load=make(import.meta.url);consume(load);"]) test(`R3-1 unsupported loader capability flow refuses: ${flow}`,()=>{
  assert.ok(scanFile('/suite/spec.ts',flow,'/suite').problems.length>0,flow);
  const w=digestWorld(flow);assert.equal(computeDigests(w.ctx).behavior.values().next().value?.status,'unresolved');
});
for(const flow of ["const read=true?fs.readFileSync:fs.readFileSync;read('hidden.txt');", "const read=fs.readFileSync||fs.readFileSync;read('hidden.txt');", "const read=fs.readFileSync??fs.readFileSync;read('hidden.txt');", "const f=true?fs:fs;f.readFileSync('hidden.txt');", "const f=fs||fs;f.readFileSync('hidden.txt');", "const f=fs??fs;f.readFileSync('hidden.txt');", "const {openSync,readSync}=fs;const fd=openSync('hidden.txt');readSync(fd,Buffer.alloc(10));"]) test(`R3-2 unknown filesystem flow never shrinks inputs: ${flow}`,()=>{
  const w=digestWorld(`import fs from 'node:fs';${flow}`),a=computeDigests(w.ctx).behavior.values().next().value;
  assert.equal(a?.status,'unresolved');writeFileSync(join(w.dir,'hidden.txt'),'weakened');assert.equal(computeDigests(w.ctx).behavior.values().next().value?.status,'unresolved');
});
for(const name of ['openSync','readSync','open','read','readv','readvSync','watch','watchFile']) test(`R3-2 unsupported named reader ${name} is accounted for`,()=>{
  assert.ok(scanFile('/suite/spec.ts',`import {${name}} from 'node:fs';${name}('hidden.txt');`,'/suite').problems.length>0);
});
for(const flow of ["const method='use';`${test[method]({baseURL:process.env.SCOPED_URL})}`;", "const testAPI={test};testAPI['test']['u'+'se']({baseURL:process.env.SCOPED_URL});", "const t=true?test:test;t.use({baseURL:process.env.URL});", "const t=test||test;t.use({baseURL:process.env.URL});", "function get(){return test}get().use({baseURL:process.env.URL});", "const use=test.use;use({viewport:{width:1440,height:900}});", "test.use({viewport:{width:1440,height:900}});" ]) test(`R3-3 scoped test API boundary: ${flow}`,()=>{
  const s=scanFile('/suite/s.ts',`import {test} from '@playwright/test';${flow}`,'/suite');
  if(flow==="test.use({viewport:{width:1440,height:900}});")assert.deepEqual(s.problems,[]);else assert.ok(s.problems.length>0,flow);
});

function repeated(status:'passed'|'failed'|'skipped') {
  const a=S.caseSteps('C1','desktop@1440',{O1:status})[1]!;
  const b=S.caseSteps('C1','desktop@1440',{O1:'passed'})[1]!;
  return [{...a,path:[1],depth:0},{...b,path:[2,0],depth:1}];
}
function evidenceWorld() {
  const dir=S.tmp('r3-evidence-'),recipes=join(dir,'recipes');const paths=S.writeEvidenceLedgers(dir,'C1',S.TEST_A,'desktop@1440',{obligations:['O1']});
  const red=S.redCheck(dir,recipes,ref,S.TEST_A,'desktop@1440',paths);return {dir,recipes,paths,red};
}
test('R3-4 structural carrying ancestors only; independent occurrences survive',()=>{
  const steps=repeated('skipped');assert.equal(innermostCarrying(steps,ref).length,2);
  assert.equal(innermostCarrying([...steps,{...steps[1]!,path:[1,0],depth:1}],ref).length,2);
});
test('R3-4 independent skipped occurrence blocks required current result and Ready',()=>{
  const w=evidenceWorld();const l=new S.Ledger().test('t',{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t',{status:'passed',steps:repeated('skipped')});
  l.write(w.dir);const run={invocations:[readInvocation({id:'i',suite:'e2e',dir:w.dir})]};
  const record=S.caseRecord('C1','regression',{obligations:['O1']}), ledger=[{obligation:ref,test:S.TEST_A,configuration:'desktop@1440',layer:'served' as const}];
  const norm=normalize({run,configurations:S.CONFIGS,cases:new Map([['C1',record]]),required:{regression:['C1'],addendum:[]},ledger,classification:[],liveQuarantines:[],quarantinesOnRequired:[],roleOverrideFiles:new Set()});assert.equal(norm.required[0]?.outcome,'skipped');
  const evidence=evaluateCase(record,'regression',{evidenceDir:w.dir,recipesDir:w.recipes,records:[w.red,S.burnIn(w.dir,S.TEST_A,'desktop@1440',w.paths.burn),S.acceptance(record,S.TEST_A)],digests:S.digests([S.TEST_A]),environment:S.ENVIRONMENT,effective:S.effective(),configurations:S.CONFIGS,ledger,dispositions:[],roles:S.ROLES,materialFields:['browserName']});
  assert.equal(evidence.status,'verified');
  const verdict=decide({profileProblems:[],regression:{ok:true,set:['C1'],base:{ref:'r',commit:'c',fetchedAt:null},problems:[]},work:{resolution:{status:'none',via:'flag'},check:null},identity:{checks:[],unknown:[],changed:[],configDrift:[],notEvaluable:[]},configurationDependent:[],runStatus:runStatus(run),fixtures:[],requiredFixtures:[],breaker:{tripped:false,reason:'',blocking:1,failures:0,connectionFailures:0,probe:null},normalized:norm,riskAcceptances:[],evidence:[evidence]});assert.equal(verdict.rule,5);
});
test('R3-4 independent skipped restoration and burn-in cannot support sensitivity',()=>{
  const w=evidenceWorld();new S.Ledger().test('t',{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t',{status:'passed',steps:repeated('skipped')}).write(w.dir,{file:'independent.jsonl'});
  assert.notEqual(judgeRedCheck(w.dir,{...w.red,restored:S.ledgerRef(w.dir,'independent.jsonl')},S.CONFIGS[0]!,false,w.recipes),null);
  const l=new S.Ledger();for(let i=0;i<5;i++)l.test('t'+i,{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t'+i,{status:'passed',steps:repeated(i===4?'skipped':'passed')});l.write(w.dir,{file:'repeat.jsonl'});
  assert.notEqual(judgeBurnIn(w.dir,S.burnIn(w.dir,S.TEST_A,'desktop@1440','repeat.jsonl'),S.CONFIGS[0]!,false,[ref]),null);
});
for(const status of ['expected-failure','skipped','flaky','unexpected-pass','not-run','missing-transitive','missing-all'] as const) test(`R3-5 intact setup proof rejects ${status}`,()=>{
  const w=evidenceWorld(),l=new S.Ledger();l.projects=[S.project('desktop',{dependencies:['setup']}),S.project('setup',{dependencies:['bootstrap']}),S.project('bootstrap')];
  if(status!=='missing-transitive' && status!=='missing-all')l.test('b',{file:'bootstrap.ts',titlePath:['bootstrap'],project:'bootstrap'}).result('b',{status:'passed'});
  if(status!=='missing-all'){
    l.test('s',{file:'setup.ts',titlePath:['login'],project:'setup',expectedStatus:status==='expected-failure'||status==='unexpected-pass'?'failed':status==='skipped'?'skipped':'passed'});
    if(status!=='not-run'){
      l.result('s',{status:status==='expected-failure'||status==='flaky'?'failed':status==='skipped'?'skipped':'passed'});
      if(status==='flaky')l.result('s',{status:'passed',retry:1});
    }
  }
  l.test('t',{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t',{status:'failed',steps:S.caseSteps('C1','desktop@1440',{O1:'failed'})}).write(w.dir,{file:'setup.jsonl'});
  assert.notEqual(judgeRedCheck(w.dir,{...w.red,mutated:S.ledgerRef(w.dir,'setup.jsonl')},S.CONFIGS[0]!,false,w.recipes),null);
});
for(const variant of ['missing-dependency','missing-teardown','dependency-cycle','teardown-cycle','duplicate-dependency','ghost-declaration','ghost-attachment','wrong-attachment'] as const) test(`R3-6 persisted graph rejects ${variant} and retains failures`,()=>{
  const dir=S.tmp('r3-graph-'),l=new S.Ledger().test('t',{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t',{status:'failed',steps:S.caseSteps('C1','desktop@1440',{O1:'failed'})});
  const records=l.records(),begin=records[0]!;assert.equal(begin.type,'begin');if(begin.type!=='begin')return;
  if(variant==='missing-dependency')begin.projects[0]!.dependencies=['missing'];
  if(variant==='missing-teardown')begin.projects[0]!.teardown='missing';
  if(variant==='dependency-cycle')begin.projects[0]!.dependencies=['desktop'];
  if(variant==='teardown-cycle')begin.projects[0]!.teardown='desktop';
  if(variant==='duplicate-dependency'){begin.projects.push(S.project('setup'));begin.projects[0]!.dependencies=['setup','setup'];}
  if(variant==='ghost-declaration') {begin.tests[0]!.project='ghost';for(const r of records)if(r.type==='result')for(const s of r.steps)if(s.ids)s.ids.project='ghost';}
  if(variant==='ghost-attachment'||variant==='wrong-attachment'){if(variant==='wrong-attachment')begin.projects.push(S.project('setup'));for(const r of records)if(r.type==='result')for(const s of r.steps)if(s.ids)s.ids.project=variant==='ghost-attachment'?'ghost':'setup';}
  writeFileSync(join(dir,'steps.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const obs=readInvocation({id:'i',suite:'e2e',dir});assert.equal(readLedgerRef(dir,S.ledgerRef(dir,'steps.jsonl')).ok,false);assert.equal(runStatus({invocations:[obs]}).complete,false);assert.ok(obs.tests.some(t=>t.results.some(r=>r.status==='failed')));
});

for(const file of ['spec.js','spec.cjs','spec.ts','spec.cts']) test(`R3-1 CommonJS synthesized loader symbols remain tracked in ${file}`,()=>{
  const scan=scanFile('/suite/'+file,"const load=require;const {readFileSync:read}=load('node:fs');load('./helper.cjs');read('hidden.txt');",'/suite');
  assert.deepEqual(scan.problems,[]);assert.ok(scan.imports.includes('./helper.cjs'));assert.equal(scan.reads.length,1);
});
test('R3-3 the AST observes deeply nested template expressions without refusing ordinary templates',()=>{
  assert.ok(scanFile('/suite/s.ts',"import {test} from '@playwright/test';const method='use';`outer ${`inner ${test[method]({baseURL:'http://other.invalid'})}`}`;",'/suite').problems.length>0);
  assert.deepEqual(scanFile('/suite/s.ts',"import {test} from '@playwright/test';for(const width of [1440,900])test.describe(`width ${width}`,()=>{test.use({viewport:{width,height:900}});test('t',()=>{})});",'/suite').problems,[]);
});
test('R3-3 old tokenizer safety claims are unverified, even with a clean source file',()=>{
  const w=digestWorld("export const input='static';");(w.ctx.begin.tests[0]!.optionSafety as unknown as {version:number}).version=1;
  assert.equal(computeDigests(w.ctx).behavior.values().next().value?.status,'unresolved');
});
for(const flow of ["globalThis.require('./helper.cjs');", "globalThis[process.env.LOADER!]('./helper.cjs');", "const load=process.getBuiltinModule('module').createRequire(import.meta.url);consume(load);", "eval(process.env.CODE!);", "new Function(process.env.CODE!)();", "const __filename=process.env.ORIGIN;import {createRequire} from 'node:module';const load=createRequire(__filename);load('./helper.cjs');", "export {require as load};"]) test(`R3 capability boundary refuses ambient/dynamic escape: ${flow}`,()=>{
  assert.ok(scanFile('/suite/s.ts',flow,'/suite').problems.length>0,flow);
});

test('R3-6 invalid project identity cannot hide a failure outside the verdict',()=>{
  const dir=S.tmp('r3-ghost-'),record=S.caseRecord('C1','regression',{obligations:['O1']});
  const steps=S.caseSteps('C1','desktop@1440',{O1:'failed'}).map(s=>({...s,ids:s.ids===null?null:{...s.ids,project:'ghost'}}));
  new S.Ledger().test('t',{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath,project:'ghost'}).result('t',{status:'failed',steps,error:'independent ghost failure'}).write(dir);
  const run={invocations:[readInvocation({id:'i',suite:'e2e',dir})]},norm=normalize({run,configurations:S.CONFIGS,cases:new Map([['C1',record]]),required:{regression:['C1'],addendum:[]},ledger:[{obligation:ref,test:S.TEST_A,configuration:'desktop@1440',layer:'served'}],classification:[],liveQuarantines:[],quarantinesOnRequired:[],roleOverrideFiles:new Set()});
  assert.equal(norm.tests[0]?.lane,'governed');
  const verdict=decide({profileProblems:[],regression:{ok:true,set:['C1'],base:{ref:'r',commit:'c',fetchedAt:null},problems:[]},work:{resolution:{status:'none',via:'flag'},check:null},identity:{checks:[],unknown:[],changed:[],configDrift:[],notEvaluable:[]},configurationDependent:[],runStatus:runStatus(run),fixtures:[],requiredFixtures:[],breaker:{tripped:false,reason:'',blocking:1,failures:1,connectionFailures:0,probe:null},normalized:norm,riskAcceptances:[],evidence:[]});
  assert.equal(verdict.rule,3);assert.equal(verdict.failures.length,1);assert.match(verdict.failures[0]!.message,/independent ghost failure/);
});

test('R3-4 a mutation cannot hide an independent skipped target behind its deeper failure',()=>{
  const w=evidenceWorld(),steps=repeated('skipped');steps[1]={...steps[1]!,status:'failed',error:{message:'O1 fails'}};
  new S.Ledger().test('t',{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t',{status:'failed',steps}).write(w.dir,{file:'skip-mutation.jsonl'});
  assert.notEqual(judgeRedCheck(w.dir,{...w.red,mutated:S.ledgerRef(w.dir,'skip-mutation.jsonl')},S.CONFIGS[0]!,false,w.recipes),null);
});

for(const flow of ["const ambient=globalThis;ambient['require']('./helper.cjs');", "const load=(function(){}).constructor('return require')();load('./helper.cjs');", "const load=Reflect.get(globalThis,'require');load('./helper.cjs');", "const invoke=Function;invoke('return require')()('./helper.cjs');"]) test(`R3-1 reflective/dynamic loader acquisition never becomes assumed safe: ${flow}`,()=>{
  assert.ok(scanFile('/suite/s.ts',flow,'/suite').problems.length>0,flow);
});

test('R3 closure uses one canonical root for real reporter paths and declared reads',()=>{
  const w=digestWorld("import fs from 'node:fs';const read=fs.readFileSync;const input=read('hidden.txt','utf8');const load=require;load('./helper.cjs');"),alias=join(S.tmp('r3-alias-'),'suite');
  symlinkSync(w.dir,alias,'dir');w.ctx.suiteRoot=alias;w.ctx.declaredInputs=[{reader:'spec.ts',paths:['hidden.txt']}] as never[];
  const a=computeDigests(w.ctx).behavior.values().next().value;assert.equal(a?.status,'resolved');if(a?.status!=='resolved')return;
  assert.ok(a.inputs.some(i=>i.path==='helper.cjs'));assert.ok(a.inputs.some(i=>i.path==='hidden.txt'));writeFileSync(join(w.dir,'helper.cjs'),'module.exports="weakened";');
  const b=computeDigests(w.ctx).behavior.values().next().value;if(b?.status==='resolved')assert.notEqual(a.digest,b.digest);else assert.fail('declared static closure remains resolvable');
});

test('R3-5 restored and burn-in ledgers need every transitive setup witness too',()=>{
  const w=evidenceWorld(),l=new S.Ledger();l.projects=[S.project('desktop',{dependencies:['setup']}),S.project('setup',{dependencies:['bootstrap']}),S.project('bootstrap')];
  l.test('t',{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t',{status:'passed',steps:S.caseSteps('C1','desktop@1440',{O1:'passed'})});l.write(w.dir,{file:'missing-restored-setup.jsonl'});
  assert.notEqual(judgeRedCheck(w.dir,{...w.red,restored:S.ledgerRef(w.dir,'missing-restored-setup.jsonl')},S.CONFIGS[0]!,false,w.recipes),null);
  for(let i=1;i<5;i++)l.test('t'+i,{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t'+i,{status:'passed',steps:S.caseSteps('C1','desktop@1440',{O1:'passed'})});l.write(w.dir,{file:'missing-repeat-setup.jsonl'});
  assert.notEqual(judgeBurnIn(w.dir,S.burnIn(w.dir,S.TEST_A,'desktop@1440','missing-repeat-setup.jsonl'),S.CONFIGS[0]!,false,[ref]),null);
});

test('R3-2 unknown path helpers and shadowed globals cannot masquerade as declared static reads',()=>{
  for(const source of ["import fs from 'node:fs';const paths={join:()=> 'hidden.txt'};fs.readFileSync(paths.join('visible.txt'));", "import fs from 'node:fs';import path from 'node:path';const __dirname=process.env.INPUT_ROOT!;fs.readFileSync(path.join(__dirname,'visible.txt'));", "import fs from 'node:fs';import {URL as NativeURL} from 'node:url';const URL=function(){return new NativeURL('hidden.txt',import.meta.url)};fs.readFileSync(new URL('visible.txt',import.meta.url));"]) {
    const w=digestWorld(source);writeFileSync(join(w.dir,'visible.txt'),'declared');w.ctx.declaredInputs=[{reader:'spec.ts',paths:['visible.txt']}] as never[];
    assert.equal(computeDigests(w.ctx).behavior.values().next().value?.status,'unresolved');
  }
});
test('R3-2 supported Node path namespace reads remain statically declared and useful',()=>{
  const w=digestWorld("import fs from 'node:fs';import path from 'node:path';fs.readFileSync(path.join(__dirname,'hidden.txt'));");w.ctx.declaredInputs=[{reader:'spec.ts',paths:['hidden.txt']}] as never[];
  assert.equal(computeDigests(w.ctx).behavior.values().next().value?.status,'resolved');
});

for(const flow of ["path.join=()=> 'hidden.txt';", "function mutate(p:any){p.join=()=> 'hidden.txt'}mutate(path);"]) test(`R3-2 path capability cannot be modified/escaped then assumed static: ${flow}`,()=>{
  const w=digestWorld(`import fs from 'node:fs';import path from 'node:path';${flow}fs.readFileSync(path.join('visible.txt'));`);writeFileSync(join(w.dir,'visible.txt'),'declared');w.ctx.declaredInputs=[{reader:'spec.ts',paths:['visible.txt']}] as never[];
  assert.equal(computeDigests(w.ctx).behavior.values().next().value?.status,'unresolved');
});
