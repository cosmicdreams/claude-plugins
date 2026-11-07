import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonicalCaseHash, approvalProblem, requiredSetProblems } from '../../src/cases.ts';
import { effectiveClassification, laneClassOf, waiverFor } from '../../src/dispositions.ts';
import { evaluateCase, judgeBurnIn, judgeRedCheck, readLedgerRef, type EvidenceContext } from '../../src/evidence.ts';
import { computeDigests } from '../../src/digest.ts';
import { scanFile } from '../../src/imports.ts';
import { readInvocation, runStatus } from '../../src/run-observation.ts';
import type { CaseRecord, ClassificationChange, ObligationRef, SensitivityWaiver } from '../../src/model.ts';
import * as S from './support.ts';

const ref: ObligationRef = {case:'C1', step:'S1', obligation:'O1'};
function world() {
  const dir=S.tmp('test-lab-r2-'), recipes=join(dir,'recipes');
  const record=S.caseRecord('C1','regression',{obligations:['O1']});
  const paths=S.writeEvidenceLedgers(dir,'C1',S.TEST_A,'desktop@1440',{obligations:['O1']});
  const red=S.redCheck(dir,recipes,ref,S.TEST_A,'desktop@1440',paths);
  const ctx: EvidenceContext={evidenceDir:dir,recipesDir:recipes,records:[red,S.burnIn(dir,S.TEST_A,'desktop@1440',paths.burn),S.acceptance(record,S.TEST_A)],digests:S.digests([S.TEST_A]),environment:S.ENVIRONMENT,effective:S.effective(),configurations:S.CONFIGS,ledger:[{obligation:ref,test:S.TEST_A,configuration:'desktop@1440',layer:'served'}],dispositions:[],roles:S.ROLES,materialFields:['browserName','browserVersion','channel','headless','retries']};
  return {dir,recipes,record,paths,red,ctx};
}
function persist(dir:string,file:string,records:unknown[]) { writeFileSync(join(dir,file),records.map(r=>JSON.stringify(r)).join('\n')+'\n'); return S.ledgerRef(dir,file); }

for(const kind of ['obligation','step','case-id','empty-id','empty-text','empty-config','duplicate-config'] as const) test(`R2-2 rejects ambiguous case denominator: ${kind}`,()=>{
  const w=world(),c=w.record;
  if(kind==='obligation') c.steps[0]!.obligations.push({...c.steps[0]!.obligations[0]!,text:'a different expectation'});
  if(kind==='step') c.steps.push({...c.steps[0]!,text:'a different action'});
  if(kind==='case-id') c.id='different-from-map-key';
  if(kind==='empty-id') c.steps[0]!.obligations[0]!.id=' ';
  if(kind==='empty-text') c.steps[0]!.obligations[0]!.text=' ';
  if(kind==='empty-config') c.configurations=[' '];
  if(kind==='duplicate-config') c.configurations.push(c.configurations[0]!);
  c.approval!.hash=canonicalCaseHash(c);
  const problems=requiredSetProblems({regression:['C1'],addendum:[]},new Map([['C1',c]]),S.ROLES);
  assert.ok(problems.length>0,'approval must not legitimize an ambiguous denominator');
  assert.equal(evaluateCase(c,'regression',w.ctx).status,'insufficient');
});
test('R2-2 distinct steps may reuse an obligation ID; repeated required case IDs may not',()=>{
  const c=S.caseRecord('C1','regression',{obligations:['O1']});
  c.steps.push({...c.steps[0]!,id:'S2'}); c.approval!.hash=canonicalCaseHash(c);
  assert.equal(approvalProblem(c,S.ROLES),null);
  assert.ok(requiredSetProblems({regression:['C1','C1'],addendum:[]},new Map([['C1',c]]),S.ROLES).length>0);
});

const readers=[
  "import fs = require('node:fs'); fs.readFileSync('hidden.txt');",
  "require('node:fs').readFileSync('hidden.txt');",
  "import fs from 'node:fs'; const {readFileSync: read}=fs; read('hidden.txt');",
  "import * as fs from 'fs'; let read; read=fs.readFileSync; read('hidden.txt');",
  "import {promisify} from 'node:util'; import {readFile} from 'node:fs'; const read=promisify(readFile); read('hidden.txt');",
  "import fs from 'node:fs'; const {promises:p}=fs; const alias=p; alias['readFile']('hidden.txt');",
];
for(const [i,text] of readers.entries()) test(`R2-3 filesystem reader binding variant ${i}`,()=>{
  const dir=S.tmp('r2-input-'); mkdirSync(join(dir,'support'),{recursive:true});
  writeFileSync(join(dir,'spec.ts'),text);writeFileSync(join(dir,'hidden.txt'),'one');writeFileSync(join(dir,'package-lock.json'),'{}');writeFileSync(join(dir,'support/kit.ts'),'export const kit=1');
  const begin={...new S.Ledger().test('t',{file:'spec.ts',titlePath:['t']}).begin(),rootDir:dir,configFile:null};
  const ctx={suite:'e2e',suiteRoot:dir,begin,cases:new Map<string,CaseRecord>(),ledger:[],recipes:[],declaredInputs:[],declaredBaselines:[],kitDir:join(dir,'support')};
  assert.equal(computeDigests(ctx).behavior.values().next().value?.status,'unresolved','a hidden read cannot disappear');
  const scan=scanFile(join(dir,'spec.ts'),text,dir);
  assert.ok(scan.reads.length>0,'common aliases must identify the read');
  ctx.declaredInputs=[{reader:'spec.ts',paths:['hidden.txt']}] as never[];
  const a=computeDigests(ctx).behavior.values().next().value;
  writeFileSync(join(dir,'hidden.txt'),'two');
  const b=computeDigests(ctx).behavior.values().next().value;
  assert.ok(a?.status==='resolved' && b?.status==='resolved');assert.notEqual(a.digest,b.digest);
});
test('R2-3 unsupported filesystem escape and re-export stay unresolved despite declarations',()=>{
  for(const text of ["import fs from 'node:fs'; sendElsewhere(fs);", "export {readFileSync as input} from 'node:fs';", "import fs from 'node:fs'; fs[process.env.METHOD!]('hidden.txt');"]){
    const scan=scanFile('/suite/a.ts',text,'/suite');
    assert.ok('problems' in scan && Array.isArray(scan.problems) && scan.problems.length>0,'untracked fs binding must fail closed');
  }
});

const classification=(id:string,target:ClassificationChange['target'],to:ClassificationChange['to']):ClassificationChange=>({id,target,from:null,to,by:S.DEV,role:'developer',standIn:false,at:'2000-01-01',reason:'classification'});
for(const glob of ['tests/**','**/important/**','tests/{important,other}/**','tests/important/failing.spec.ts']) test(`R2-4 broad/shaped glob cannot shadow trusted governed path: ${glob}`,()=>{
  const base=[classification('suite',{suite:'e2e'},'legacy'),classification('governed',{suite:'e2e',glob:'tests/important/**'},'governed')];
  const change=classification('demote',{suite:'e2e',glob},'excluded');
  const result=effectiveClassification([change],S.ROLES,base);
  assert.equal(result.refused.length,1);assert.equal(laneClassOf(result.rules,'e2e','desktop','tests/important/failing.spec.ts'),'governed');
  const qa=effectiveClassification([{...change,by:S.QA,role:'qa',standIn:true}],S.ROLES,base);
  assert.equal(qa.refused.length,0);
});

for(const option of ["test.use({baseURL:process.env.SCOPED_URL});", "test.use({variant:process.env.VARIANT});", "test.use(options);", "const use=test.use; use({baseURL:'https://prod.invalid'});", "const t=test.extend({variant:['strong',{option:true}]});"]) test(`R2-5 unobservable effective scope: ${option}`,()=>{
  const dir=S.tmp('r2-scope-');mkdirSync(join(dir,'node_modules/@playwright/test'),{recursive:true});writeFileSync(join(dir,'node_modules/@playwright/test/package.json'),'{}');mkdirSync(join(dir,'kit'));writeFileSync(join(dir,'kit/kit.ts'),'export const kit=1;');writeFileSync(join(dir,'package-lock.json'),'{}');
  writeFileSync(join(dir,'spec.ts'),`import {test} from '@playwright/test'; ${option} test('t',()=>{});`);
  const begin={...new S.Ledger().test('t',{file:'spec.ts',titlePath:['t']}).begin(),rootDir:dir,configFile:null};
  const d=computeDigests({suite:'e2e',suiteRoot:dir,begin,cases:new Map(),ledger:[],recipes:[],declaredInputs:[],declaredBaselines:[],kitDir:join(dir,'kit')});
  assert.equal(d.behavior.values().next().value?.status,'unresolved');
});

for(const waiver of [false,true]) test(`R2-6 parent-only burn-in cannot ${waiver?'waive':'verify'} an obligation`,()=>{
  const w=world(),l=new S.Ledger();
  for(let i=0;i<5;i++)l.test('t'+i,{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t'+i,{status:'passed',steps:S.caseSteps('C1','desktop@1440',{})});
  l.write(w.dir,{file:'parent.jsonl'});
  const burn=S.burnIn(w.dir,S.TEST_A,'desktop@1440','parent.jsonl');
  assert.notEqual(judgeBurnIn(w.dir,burn,S.CONFIGS[0]!,false,[ref]),null);
  w.ctx.records=[...(waiver?[]:[w.red]),burn,S.acceptance(w.record,S.TEST_A)];
  if(waiver)w.ctx.dispositions=[{kind:'sensitivity-waived',id:'w',case:'C1',step:'S1',obligation:'O1',caseHash:canonicalCaseHash(w.record),by:S.QA,role:'qa',standIn:true,at:'2026-10-09',reason:'no mutation'}];
  assert.equal(evaluateCase(w.record,'regression',w.ctx).status,'insufficient');
});
test('R2-7 multiple independently failing siblings verify none; propagated parents still allowed',()=>{
  const w=world();
  new S.Ledger().test('t',{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t',{status:'failed',steps:S.caseSteps('C1','desktop@1440',{O1:'failed',O2:'failed'})}).write(w.dir,{file:'siblings.jsonl'});
  assert.notEqual(judgeRedCheck(w.dir,{...w.red,mutated:S.ledgerRef(w.dir,'siblings.jsonl')},S.CONFIGS[0]!,false,w.recipes),null);
  assert.equal(judgeRedCheck(w.dir,w.red,S.CONFIGS[0]!,false,w.recipes),null);
});
test('R2-8 waivers bind complete tuples and old short IDs fail closed',()=>{
  const c=S.caseRecord('C1','regression',{obligations:['O1']});
  const waiver:SensitivityWaiver={kind:'sensitivity-waived',id:'w',case:'C1',step:'S1',obligation:'O1',caseHash:canonicalCaseHash(c),by:S.QA,role:'qa',standIn:true,at:'2026-10-09',reason:'cannot mutate S1'};
  assert.equal(waiverFor([waiver],S.ROLES,'regression',{...ref,step:'S2'},canonicalCaseHash(c)).waiver,null);
  assert.equal(waiverFor([waiver],S.ROLES,'regression',ref,canonicalCaseHash(c)).waiver?.id,'w');
  const old={...waiver} as Record<string,unknown>;delete old['step'];
  const r=waiverFor([old as unknown as SensitivityWaiver],S.ROLES,'regression',ref,canonicalCaseHash(c));assert.equal(r.waiver,null);assert.ok(r.refused.length>0);
});

for(const variant of ['lost-error','lost-result','old-kit','duplicate-test','duplicate-outcome','duplicate-result','outcome-counter','negative-counter','contradictory-pass'] as const) test(`R2-9 raw ledger refuses ${variant} while preserving failures`,()=>{
  const w=world();
  let records=new S.Ledger().test('t',{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t',{status:'failed',steps:S.caseSteps('C1','desktop@1440',{O1:'failed'})}).records() as unknown as Record<string,any>[];
  if(variant==='lost-error'){records.at(-1)!['errors']=1;}
  if(variant==='lost-result')records=records.filter(r=>r['type']!=='result');
  if(variant==='old-kit')records[0]!['kit']='0.1.0';
  if(variant==='duplicate-test')records[0]!['tests'].push({...records[0]!['tests'][0]});
  if(variant==='duplicate-outcome')records.splice(-1,0,{...records.find(r=>r['type']==='test')!});
  if(variant==='duplicate-result')records.splice(2,0,{...records[1]!});
  if(variant==='outcome-counter')records.find(r=>r['type']==='test')!['results']=2;
  if(variant==='negative-counter')records.at(-1)!['errors']=-1;
  if(variant==='contradictory-pass')records.at(-1)!['finalStatus']='passed';
  const ledger=persist(w.dir,'bad.jsonl',records);
  assert.equal(readLedgerRef(w.dir,ledger).ok,false);
  const obs=readInvocation({id:'bad',suite:'e2e',dir:w.dir},join(w.dir,'bad.jsonl'));
  assert.equal(runStatus({invocations:[obs]}).complete,false);
  if(variant!=='lost-result' && variant!=='old-kit')assert.ok(obs['tests'].some(t=>t['results'].some(r=>r.status==='failed')));
});

test('R2-5 indirect and escaped scoped APIs cannot bypass the conservative boundary',()=>{
  for(const text of ["import {test as t} from '@playwright/test'; t[process.env.API!]({baseURL:process.env.URL});", "import {test as t} from '@playwright/test';const {use:configure}=t;configure({baseURL:process.env.URL});", "test['u'+'se']({baseURL:process.env.URL});", "test['\\u0075se']({baseURL:process.env.URL});", "`${test.use({baseURL:process.env.URL})}`;"]){
    const scan=scanFile('/suite/s.ts',text,'/suite');assert.ok(scan.problems.length>0, text);
  }
});
test('R2-3 filesystem exports and bound readers cannot escape import analysis',()=>{
  for(const text of ["import {readFileSync} from 'node:fs';export const input=readFileSync;", "import fs from 'node:fs';const read=fs.readFileSync.bind(fs);read('hidden.txt');", "import fs from 'node:fs'; helper.read=fs.readFileSync;", "import fs from 'node:fs';fs.readFileSync.call(null,'hidden.txt');"]){
    assert.ok(scanFile('/suite/s.ts',text,'/suite').problems.length>0,text);
  }
});

test('R2-6 every repeat must prove every mapped full tuple, even when short IDs repeat',()=>{
  const w=world();
  const required=[ref,{...ref,step:'S2'}];
  for(const missing of ['one-repeat','wrong-step','wrong-case']) {
    const l=new S.Ledger();
    for(let i=0;i<5;i++) {
      const steps=S.caseSteps('C1','desktop@1440',{O1:'passed'});
      if(missing!=='one-repeat' || i!==4)steps.push(...S.caseSteps(missing==='wrong-case'?'C2':'C1','desktop@1440',{O1:'passed'}).map(s=>({...s,path:[2,...s.path.slice(1)],ids:s.ids===null?null:{...s.ids,step:missing==='wrong-step'?'S3':'S2'}})));
      l.test('t'+i,{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t'+i,{status:'passed',steps});
    }
    l.write(w.dir,{file:missing+'.jsonl'});
    assert.notEqual(judgeBurnIn(w.dir,S.burnIn(w.dir,S.TEST_A,'desktop@1440',missing+'.jsonl'),S.CONFIGS[0]!,false,required),null);
  }
});
test('R2-8 a full-tuple waiver for S1 cannot waive the distinct S2 expectation',()=>{
  const w=world();w.record.steps.push({...w.record.steps[0]!,id:'S2'});w.record.approval!.hash=canonicalCaseHash(w.record);
  const l=new S.Ledger();
  for(let i=0;i<5;i++)l.test('t'+i,{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t'+i,{status:'passed',steps:[...S.caseSteps('C1','desktop@1440',{O1:'passed'}),...S.caseSteps('C1','desktop@1440',{O1:'passed'}).map(s=>({...s,path:[2,...s.path.slice(1)],ids:s.ids===null?null:{...s.ids,step:'S2'}}))]});
  l.write(w.dir,{file:'both.jsonl'});
  w.ctx.records=[S.burnIn(w.dir,S.TEST_A,'desktop@1440','both.jsonl'),S.acceptance(w.record,S.TEST_A)];
  w.ctx.ledger.push({...w.ctx.ledger[0]!,obligation:{...ref,step:'S2'}});
  w.ctx.dispositions=[{kind:'sensitivity-waived',id:'w',case:'C1',step:'S1',obligation:'O1',caseHash:canonicalCaseHash(w.record),by:S.QA,role:'qa',standIn:true,at:'2026-10-09',reason:'cannot mutate S1'}];
  const e=evaluateCase(w.record,'regression',w.ctx);
  assert.equal(e.mappings.find(m=>m.ref.step==='S1')?.sensitivity,'waived');assert.equal(e.mappings.find(m=>m.ref.step==='S2')?.sensitivity,'unverified');assert.equal(e.status,'insufficient');
});
test('R2-9 legitimate interrupted-run failures remain visible without completion',()=>{
  const w=world(),file='interrupted.jsonl';
  new S.Ledger().test('t',{file:S.TEST_A.file,titlePath:S.TEST_A.titlePath}).result('t',{status:'failed',steps:S.caseSteps('C1','desktop@1440',{O1:'failed'})}).error('worker exited').write(w.dir,{file,complete:false});
  const obs=readInvocation({id:'i',suite:'e2e',dir:w.dir},join(w.dir,file));
  assert.equal(obs.tests[0]?.results[0]?.status,'failed');assert.equal(obs.errors[0]?.message,'worker exited');assert.equal(obs.completion,null);assert.equal(runStatus({invocations:[obs]}).complete,false);
});

test('R2-5 reflected test APIs are unobservable before any module loads',()=>{
  for(const text of ["Reflect.get(test,process.env.API)({baseURL:process.env.URL});", "const t=test;Object.values(t)[0]({baseURL:process.env.URL});"])
    assert.ok(scanFile('/suite/s.ts',text,'/suite').problems.length>0,text);
});

test('R2-3 shorthand and class-property filesystem escapes remain unresolved',()=>{
  for(const text of ["import {readFileSync} from 'node:fs';const adapter={readFileSync};adapter.readFileSync('hidden.txt');", "import fs from 'node:fs';class Reader {input=fs.readFileSync;}new Reader().input('hidden.txt');"])
    assert.ok(scanFile('/suite/s.ts',text,'/suite').problems.length>0,text);
});
