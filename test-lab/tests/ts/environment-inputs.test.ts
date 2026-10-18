import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { behaviorKey, computeDigests, type DigestContext } from '../../src/digest.ts';
import { sha256 } from '../../src/canonical.ts';
import * as S from './support.ts';

const declarations = [{ name: 'EXPECTED_FONT', classification: 'nonsecret' as const, readers: ['tests/accordion.spec.ts'] }];
function fixture(value: string | undefined) {
  const root = S.tmp('declared-env-'); mkdirSync(join(root, 'tests')); mkdirSync(join(root, 'kit'));
  writeFileSync(join(root, 'package-lock.json'), '{}'); writeFileSync(join(root, 'kit/kit.ts'), 'export const kit=1;');
  writeFileSync(join(root, S.TEST_A.file), 'const expected=process.env.EXPECTED_FONT;');
  const bindings = [{ name: 'EXPECTED_FONT', state: value === undefined ? 'unset' : 'set', ...(value === undefined ? {} : { hash: sha256(value) }) }];
  const declared = structuredClone(declarations);
  const environmentInputs = { version: 1, invocation: 'actual-child', phase: 'complete', declarations:declared, bindings, problems: [], processes: [{ pid: 123, bindings, changed: [], closed: true }], workers: 0 };
  const begin = { ...new S.Ledger().test('t', { file: S.TEST_A.file, titlePath: S.TEST_A.titlePath }).begin(), rootDir: root, configFile: null, environmentInputs };
  const ctx = { suite: 'e2e', suiteRoot: root, begin, cases: new Map(), ledger: [], recipes: [], declaredInputs: [], declaredEnvironmentInputs: declared, declaredBaselines: [], kitDir: join(root, 'kit') } as DigestContext;
  return { ctx, digest: () => computeDigests(ctx).behavior.get(behaviorKey(S.TEST_A, 'desktop')) };
}
test('declared nonsecret invocation values resolve and unset differs from empty', () => {
  const digests = [undefined, '', 'Georgia', 'Arial'].map(value => { const d = fixture(value).digest(); assert.equal(d?.status, 'resolved'); return d?.status === 'resolved' ? d.digest : ''; });
  assert.equal(new Set(digests).size, 4);
});
test('parent process values cannot substitute for observed invocation bindings', () => {
  const s = fixture('Georgia'), before = s.digest(); const previous = process.env['EXPECTED_FONT'];
  try { process.env['EXPECTED_FONT'] = 'parent-only'; const after = s.digest(); assert.equal(after?.status, 'resolved'); assert.deepEqual(after, before); }
  finally { if (previous === undefined) delete process.env['EXPECTED_FONT']; else process.env['EXPECTED_FONT'] = previous; }
});
test('declarations cannot leak to another reader', () => {
  const s = fixture('Georgia'); writeFileSync(join(s.ctx.suiteRoot, S.TEST_A.file), "import '../helper';"); writeFileSync(join(s.ctx.suiteRoot, 'helper.ts'), 'const expected=process.env.EXPECTED_FONT;');
  assert.equal(s.digest()?.status, 'unresolved');
});

import { readFileSync } from 'node:fs';
import { canonicalDeclarations, declarationProblems, bindingsOf, valueProblems, parseRequest, type EnvironmentInputDeclaration, type EnvironmentInputObservation } from '../../kit/environment-inputs.ts';
import { evaluateCase, judgeRedCheck, readLedgerRef } from '../../src/evidence.ts';
import { readInvocation, runStatus } from '../../src/run-observation.ts';
import { normalize } from '../../src/normalize.ts';
import type { LedgerRef } from '../../src/model.ts';

for (const bad of [null, {}, 'not an array', [{...declarations[0], classification:'secret'}], [{...declarations[0],name:'AUTH_TOKEN'}], [{...declarations[0],name:'NODE_OPTIONS'}], [{...declarations[0],name:'EXPECTED_FONT', extra:true}], [...declarations,...declarations], [{...declarations[0],readers:[]}], [{...declarations[0],readers:['tests/**']}], [{...declarations[0],readers:['../helper.ts']}], [{...declarations[0],readers:['/suite/spec.ts']}], [{...declarations[0],readers:['tests/../helper.ts']}], [{...declarations[0],readers:['helper.ts','helper.ts']}]] ) test(`invalid environment declaration fails closed: ${JSON.stringify(bad)}`, () => {
  assert.ok(declarationProblems(bad).length > 0);
  const s = fixture('Georgia'); s.ctx.declaredEnvironmentInputs = bad as EnvironmentInputDeclaration[];
  assert.equal(s.digest()?.status, 'unresolved');
});
for (const values of [null, [], {}, {EXPECTED_FONT:{state:'present'}}, {EXPECTED_FONT:{state:'unset',value:''}}, {EXPECTED_FONT:{state:'set'}}, {EXPECTED_FONT:{state:'set',value:1}}, {EXPECTED_FONT:{state:'set',value:'x\0y'}}, {EXPECTED_FONT:{state:'set',value:'Georgia'}, UNDECLARED:{state:'set',value:'outside'}}]) test(`invalid invocation values reject: ${JSON.stringify(values)}`, () => assert.ok(valueProblems(declarations as EnvironmentInputDeclaration[],values).length > 0));

test('declaration and value bindings are deterministic across ordering', () => {
  const ds: EnvironmentInputDeclaration[] = [{name:'BASE_URL',classification:'nonsecret',readers:['config.ts','helper.ts']},...declarations as EnvironmentInputDeclaration[]];
  const values = {BASE_URL:{state:'set' as const,value:'http://localhost'},EXPECTED_FONT:{state:'set' as const,value:''}};
  assert.deepEqual(bindingsOf(ds,values),bindingsOf([...ds].reverse(),values));
  assert.deepEqual(canonicalDeclarations(ds),canonicalDeclarations([...ds].reverse().map(d=>({...d,readers:[...d.readers].reverse()}))));
});
for (const source of ['const e=process.env;const value=e[getName()];','const value=Object.values(process.env);', 'const {EXPECTED_FONT,...rest}=process.env;', 'process.env.EXPECTED_FONT="Georgia";', 'delete process.env.EXPECTED_FONT;', 'process.env={EXPECTED_FONT:"Georgia"};']) test(`declared inputs never exempt unsupported environment source: ${source}`, () => {
  const s=fixture('Georgia'); writeFileSync(join(s.ctx.suiteRoot,S.TEST_A.file),source); assert.equal(s.digest()?.status,'unresolved');
});
for (const change of ['missing','pending','changed','process-value','missing-process','duplicate-process','declaration-scope'] as const) test(`missing/conflicting invocation observation refuses behavior: ${change}`, () => {
  const s=fixture('Georgia'); const o=s.ctx.begin.environmentInputs!;
  if(change==='missing') delete s.ctx.begin.environmentInputs;
  if(change==='pending') o.phase='begin';
  if(change==='changed') o.processes[0]!.changed=['EXPECTED_FONT'];
  if(change==='process-value') o.processes[0]!.bindings=bindingsOf(o.declarations,{EXPECTED_FONT:{state:'set',value:'other'}});
  if(change==='missing-process') o.processes=[];
  if(change==='duplicate-process') o.processes.push(o.processes[0]!);
  if(change==='declaration-scope') o.declarations[0]!.readers=['helper.ts'];
  assert.equal(s.digest()?.status,'unresolved');
});

function bindLedger(root:string, ref:LedgerRef, observation:EnvironmentInputObservation, legacy=false):LedgerRef {
  const path=join(root,ref.path), records=readFileSync(path,'utf8').trim().split('\n').map(l=>JSON.parse(l));
  records[0].rootDir = root;
  records[0].configFile = null;
  if (!legacy) {
    records[0].environmentInputs={...observation,phase:'begin',processes:[{...observation.processes[0],closed:false}],workers:0};
    for(const r of records) if(r.type==='result') r.workerIndex=0;
    records.splice(records.length-1,0,{type:'environment-inputs',observation:{...observation,workers:1,processes:[...observation.processes,{...observation.processes[0],pid:456}]}});
  }
  writeFileSync(path,records.map(r=>JSON.stringify(r)).join('\n')+'\n'); return S.ledgerRef(root,ref.path);
}
function evidenceWorld(independent = false) {
  const s=fixture('Georgia'), record=S.caseRecord('C1','regression',{obligations:['O1']}), ref={case:'C1',step:'S1',obligation:'O1'};
  if (independent) {
    writeFileSync(join(s.ctx.suiteRoot, S.TEST_A.file), 'const independent=1;');
    writeFileSync(join(s.ctx.suiteRoot, 'tests/font.spec.ts'), 'const expected=process.env.EXPECTED_FONT;');
    s.ctx.declaredEnvironmentInputs![0]!.readers = ['tests/font.spec.ts'];
    s.ctx.begin.environmentInputs!.declarations = structuredClone(s.ctx.declaredEnvironmentInputs!);
    s.ctx.begin.tests.push({...s.ctx.begin.tests[0]!, testId:'font', file:'tests/font.spec.ts', titlePath:['font']});
  }
  const paths=S.writeEvidenceLedgers(s.ctx.suiteRoot,'C1',S.TEST_A,'desktop@1440',{obligations:['O1']});
  s.ctx.cases.set(record.id,record);s.ctx.ledger=[{obligation:ref,test:S.TEST_A,configuration:'desktop@1440',layer:'served'}];
  const digest=computeDigests(s.ctx), d=digest.behavior.get(behaviorKey(S.TEST_A,'desktop'));assert.ok(d?.status==='resolved');assert.ok(digest.toolchain.status==='resolved');
  const bindings={behaviorDigest:d.digest,toolchainDigest:digest.toolchain.digest};const recipesDir=join(s.ctx.suiteRoot,'recipes');
  const red=S.redCheck(s.ctx.suiteRoot,recipesDir,ref,S.TEST_A,'desktop@1440',paths,bindings), burn=S.burnIn(s.ctx.suiteRoot,S.TEST_A,'desktop@1440',paths.burn,bindings);
  for(const key of ['mutated','restored'] as const) red[key]=bindLedger(s.ctx.suiteRoot,red[key],s.ctx.begin.environmentInputs!);
  burn.run=bindLedger(s.ctx.suiteRoot,burn.run,s.ctx.begin.environmentInputs!);
  const ctx={evidenceDir:s.ctx.suiteRoot,recipesDir,records:[red,burn,S.acceptance(record,S.TEST_A,bindings)],digests:digest,environment:S.ENVIRONMENT,effective:S.effective(),configurations:S.CONFIGS,ledger:s.ctx.ledger,dispositions:[],roles:S.ROLES,materialFields:['browserName' as const]};
  return {s,record,red,burn,ctx};
}
test('matching invocation-bound red check/restoration/burn-in verify, assertion input changes stale acceptance', () => {
  const w=evidenceWorld();assert.equal(evaluateCase(w.record,'regression',w.ctx).status,'verified');
  const changed=bindingsOf(w.s.ctx.begin.environmentInputs!.declarations,{EXPECTED_FONT:{state:'set',value:'Arial'}});w.s.ctx.begin.environmentInputs!.bindings=changed;w.s.ctx.begin.environmentInputs!.processes[0]!.bindings=changed;
  const result=evaluateCase(w.record,'regression',{...w.ctx,digests:computeDigests(w.s.ctx)});
  assert.equal(result.mappings[0]?.acceptance,'stale');assert.equal(result.mappings[0]?.sensitivity,'unverified');
});
for(const which of ['mutation','restoration','burn-in','legacy-burn-in'] as const) test(`receipt cannot borrow current behavior hash with different inputs: ${which}`,()=>{
  const w=evidenceWorld();const observation=structuredClone(w.s.ctx.begin.environmentInputs!);observation.bindings=bindingsOf(observation.declarations,{EXPECTED_FONT:{state:'set',value:'Arial'}});observation.processes[0]!.bindings=observation.bindings;
  const key=which==='mutation'?'mutated':'restored';
  if(which==='burn-in'||which==='legacy-burn-in') {
    if(which==='legacy-burn-in') {const path=join(w.s.ctx.suiteRoot,w.burn.run.path), rows=readFileSync(path,'utf8').trim().split('\n').map(l=>JSON.parse(l)).filter(r=>r.type!=='environment-inputs');delete rows[0].environmentInputs;writeFileSync(path,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');w.burn.run=S.ledgerRef(w.s.ctx.suiteRoot,w.burn.run.path);}
    else {const path=join(w.s.ctx.suiteRoot,w.burn.run.path), rows=readFileSync(path,'utf8').trim().split('\n').map(l=>JSON.parse(l));rows[0].environmentInputs={...observation,phase:'begin',processes:observation.processes.map(p=>({...p,closed:false}))};rows.find(r=>r.type==='environment-inputs').observation={...observation,workers:1,processes:[...observation.processes,{...observation.processes[0],pid:456}]};writeFileSync(path,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');w.burn.run=S.ledgerRef(w.s.ctx.suiteRoot,w.burn.run.path);}
  } else {const path=join(w.s.ctx.suiteRoot,w.red[key].path), rows=readFileSync(path,'utf8').trim().split('\n').map(l=>JSON.parse(l));rows[0].environmentInputs={...observation,phase:'begin',processes:observation.processes.map(p=>({...p,closed:false}))};rows.find(r=>r.type==='environment-inputs').observation={...observation,workers:1,processes:[...observation.processes,{...observation.processes[0],pid:456}]};writeFileSync(path,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');w.red[key]=S.ledgerRef(w.s.ctx.suiteRoot,w.red[key].path);assert.match(judgeRedCheck(w.ctx.evidenceDir,w.red,S.CONFIGS[0]!,false,w.ctx.recipesDir)??'',/environment inputs/);}
  const result=evaluateCase(w.record,'regression',w.ctx);assert.equal(result.status,'insufficient');assert.equal(result.mappings[0]?.acceptance,'current');
});
test('version 4 historical claims refuse but recorded failures remain visible',()=>{
  const w=evidenceWorld(), file=join(w.s.ctx.suiteRoot,w.red.mutated.path), records=readFileSync(file,'utf8').trim().split('\n').map(l=>JSON.parse(l));records[0].tests[0].optionSafety.version=4;
  writeFileSync(file,records.map(r=>JSON.stringify(r)).join('\n')+'\n');const ref=S.ledgerRef(w.s.ctx.suiteRoot,w.red.mutated.path);
  assert.equal(readLedgerRef(w.s.ctx.suiteRoot,ref).ok,false);assert.equal(readInvocation({id:'old',suite:'e2e',dir:w.s.ctx.suiteRoot},file).tests[0]?.results[0]?.status,'failed');
});

for(const source of [
  "const p=process;const e=p['env'];const alias=e;const expected=alias['EXPECTED_FONT'];",
  "import proc from 'node:process';const {env:e}=proc;const {EXPECTED_FONT:f}=e;",
  "import {env as e} from 'node:process';const expected=e.EXPECTED_FONT;",
  "const {env:{EXPECTED_FONT:f}}=process;",
  "let e;e=process.env;const expected=e.EXPECTED_FONT;",
  "const {EXPECTED_FONT:f='Georgia'}=process.env;",
]) test(`supported static environment aliases can use declared invocation binding: ${source}`,()=>{
  const s=fixture('Georgia');writeFileSync(join(s.ctx.suiteRoot,S.TEST_A.file),source);assert.equal(s.digest()?.status,'resolved');
});
for(const entry of ['config-helper','global-setup','global-teardown','transitive-setup'] as const) test(`declared values propagate through ${entry} closure`,()=>{
  const s=fixture('Georgia'),root=s.ctx.suiteRoot;writeFileSync(join(root,S.TEST_A.file),'const independent=1;');writeFileSync(join(root,'helper.ts'),'export const expected=process.env.EXPECTED_FONT;');
  s.ctx.declaredEnvironmentInputs![0]!.readers=['helper.ts'];s.ctx.begin.environmentInputs!.declarations=structuredClone(s.ctx.declaredEnvironmentInputs!);
  if(entry==='config-helper'){writeFileSync(join(root,'playwright.config.ts'),"import './helper';export default {};");s.ctx.begin.configFile=join(root,'playwright.config.ts');}
  if(entry==='global-setup')s.ctx.begin.globalSetup=[join(root,'helper.ts')];
  if(entry==='global-teardown')s.ctx.begin.globalTeardown=[join(root,'helper.ts')];
  if(entry==='transitive-setup'){
    const a=S.project('setup'),b=S.project('setup-2');a.dependencies=['setup-2'];s.ctx.begin.projects.unshift(a,b);s.ctx.begin.projects.find(p=>p.name==='desktop')!.dependencies=['setup'];
    s.ctx.begin.tests.push({...s.ctx.begin.tests[0]!,testId:'setup',project:'setup',file:'helper.ts'},{...s.ctx.begin.tests[0]!,testId:'setup-2',project:'setup-2',file:'helper.ts'});
  }
  const first=s.digest();assert.ok(first?.status==='resolved',JSON.stringify(first));
  const o=s.ctx.begin.environmentInputs!;o.bindings=bindingsOf(o.declarations,{EXPECTED_FONT:{state:'set',value:'Arial'}});o.processes[0]!.bindings=o.bindings;
  const changed=s.digest();assert.ok(changed?.status==='resolved');assert.notEqual(first.digest,changed.digest);
});
for(const variant of ['missing-completion','wrong-invocation','missing-worker','worker-count','malformed-binding','unknown-version','changed-after-begin'] as const)test(`persisted environment protocol rejects ${variant} while failures stay readable`,()=>{
  const w=evidenceWorld(),file=join(w.s.ctx.suiteRoot,w.red.mutated.path);let rows=readFileSync(file,'utf8').trim().split('\n').map(l=>JSON.parse(l));const end=rows.find(r=>r.type==='environment-inputs');
  if(variant==='missing-completion')rows=rows.filter(r=>r.type!=='environment-inputs');
  if(variant==='wrong-invocation')end.observation.invocation='another-child';
  if(variant==='missing-worker')for(const r of rows)if(r.type==='result')delete r.workerIndex;
  if(variant==='worker-count')end.observation.workers=0;
  if(variant==='malformed-binding')end.observation.bindings[0].hash='wrong';
  if(variant==='unknown-version')end.observation.version=2;
  if(variant==='changed-after-begin')end.observation.processes[1].changed=['EXPECTED_FONT'];
  writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');const ref=S.ledgerRef(w.s.ctx.suiteRoot,w.red.mutated.path);
  assert.equal(readLedgerRef(w.s.ctx.suiteRoot,ref).ok,false);assert.equal(readInvocation({id:'invalid',suite:'e2e',dir:w.s.ctx.suiteRoot},file).tests[0]?.results[0]?.status,'failed');
});

test('malformed invocation serialization refuses without echoing request data',()=>{
  assert.throws(()=>parseRequest('invalid-request-body'),error=>error instanceof Error && error.message==='invalid nonsecret environment invocation request');
});

function editReceipt(w: ReturnType<typeof evidenceWorld>, ref: LedgerRef, edit: (rows: any[]) => void): LedgerRef {
  const file = join(w.s.ctx.suiteRoot, ref.path);
  const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  edit(rows);
  writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return S.ledgerRef(w.s.ctx.suiteRoot, ref.path);
}

for (const variant of ['missing-process', 'diagnostics', 'process-binding', 'changed', 'duplicate-process', 'begin-workers', 'begin-phase', 'begin-closed', 'coordinator-identity'] as const) {
  test(`begin environment fault cannot be washed away by clean completion: ${variant}`, () => {
    const w = evidenceWorld();
    w.red.mutated = editReceipt(w, w.red.mutated, rows => {
      const initial = rows[0].environmentInputs;
      if (variant === 'missing-process') initial.processes = [];
      if (variant === 'diagnostics') initial.problems = ['missing or unreadable pre-load environment observation'];
      if (variant === 'process-binding') initial.processes[0].bindings = bindingsOf(initial.declarations, {EXPECTED_FONT:{state:'set',value:'Arial'}});
      if (variant === 'changed') initial.processes[0].changed = ['EXPECTED_FONT'];
      if (variant === 'duplicate-process') initial.processes.push(structuredClone(initial.processes[0]));
      if (variant === 'begin-workers') initial.workers = 1;
      if (variant === 'begin-phase') initial.phase = 'complete';
      if (variant === 'begin-closed') initial.processes[0].closed = true;
      if (variant === 'coordinator-identity') initial.processes[0].pid = 789;
    });
    const observed = readInvocation({id:'bad-begin',suite:'e2e',dir:w.s.ctx.suiteRoot}, join(w.s.ctx.suiteRoot,w.red.mutated.path));
    assert.equal(observed.tests[0]?.results[0]?.status, 'failed', 'recorded failures remain readable');
    const normalized = normalize({run:{invocations:[observed]},configurations:S.CONFIGS,cases:w.s.ctx.cases,required:{regression:[w.record.id],addendum:[]},ledger:w.s.ctx.ledger,classification:[],liveQuarantines:[],quarantinesOnRequired:[],roleOverrideFiles:new Set()});
    assert.equal(normalized.required[0]?.outcome,'failed');
    assert.equal(normalized.tests[0]?.lane,'required-regression');
    assert.ok(normalized.tests[0]?.failure, 'invalid protocol cannot hide the blocking failure');
    assert.equal(runStatus({invocations:[observed]}).complete, false);
    assert.equal(readLedgerRef(w.s.ctx.suiteRoot, w.red.mutated).ok, false);
    const result = evaluateCase(w.record, 'regression', w.ctx);
    assert.equal(result.mappings[0]?.sensitivity, 'unverified');
    assert.equal(result.mappings[0]?.acceptance, 'current');
    assert.ok(observed.begin);
    assert.equal(computeDigests({...w.s.ctx, begin:observed.begin}).behavior.get(behaviorKey(S.TEST_A,'desktop'))?.status, 'unresolved');
    if (variant === 'diagnostics') {
      assert.ok(observed.problems.some(p => p.includes('missing or unreadable pre-load environment observation')));
      assert.ok(observed.begin.environmentInputs?.problems.includes('missing or unreadable pre-load environment observation'));
    }
  });
}

test('legitimate open coordinator at begin becomes clean finalized evidence', () => {
  const w = evidenceWorld();
  assert.equal(readLedgerRef(w.s.ctx.suiteRoot,w.red.mutated).ok, true);
  assert.equal(evaluateCase(w.record,'regression',w.ctx).status, 'verified');
});

test('mixed declared suite gives its independent test an explicit empty projection and current acceptance', () => {
  const w = evidenceWorld(true);
  const independent = w.ctx.digests.behavior.get(behaviorKey(S.TEST_A,'desktop'));
  assert.ok(independent?.status === 'resolved');
  assert.deepEqual(independent.environmentInputs, {declarations:w.s.ctx.declaredEnvironmentInputs, bindings:[]});
  assert.equal(evaluateCase(w.record,'regression',w.ctx).status,'verified');
  const beforeFont = w.ctx.digests.behavior.get(behaviorKey({suite:'e2e',file:'tests/font.spec.ts',titlePath:['font']},'desktop'));
  assert.ok(beforeFont?.status === 'resolved');
  const observation = w.s.ctx.begin.environmentInputs!;
  observation.bindings = bindingsOf(observation.declarations,{EXPECTED_FONT:{state:'set',value:'Arial'}});
  observation.processes[0]!.bindings = observation.bindings;
  const changed = computeDigests(w.s.ctx);
  const afterFont = changed.behavior.get(behaviorKey({suite:'e2e',file:'tests/font.spec.ts',titlePath:['font']},'desktop'));
  assert.ok(afterFont?.status === 'resolved');
  assert.notEqual(afterFont.digest,beforeFont.digest);
  assert.equal(evaluateCase(w.record,'regression',{...w.ctx,digests:changed}).status,'verified');
  // Each receipt is a valid suite invocation, but unused values may differ across all three.
  w.red.restored = editReceipt(w, w.red.restored, rows => {
    rows[0].environmentInputs.bindings = observation.bindings;
    rows[0].environmentInputs.processes[0].bindings = observation.bindings;
    const final = rows.find(r => r.type === 'environment-inputs').observation;
    final.bindings = observation.bindings;
    for (const p of final.processes) p.bindings = observation.bindings;
  });
  assert.equal(evaluateCase(w.record,'regression',{...w.ctx,digests:changed}).status,'verified');
  assert.match(judgeRedCheck(w.ctx.evidenceDir,w.red,S.CONFIGS[0]!,false,w.ctx.recipesDir) ?? '', /different behavior environment inputs/, 'standalone judgment without a projection remains conservative');
});

for (const variant of ['begin-diagnostic', 'missing-begin-process', 'changed-worker', 'missing-completion', 'legacy', 'scope'] as const) {
  test(`independent test still refuses invalid suite protocol: ${variant}`, () => {
    const w = evidenceWorld(true);
    w.burn.run = editReceipt(w,w.burn.run,rows => {
      if (variant === 'begin-diagnostic') rows[0].environmentInputs.problems = ['pre-load observation failed'];
      if (variant === 'missing-begin-process') rows[0].environmentInputs.processes = [];
      if (variant === 'changed-worker') rows.find(r=>r.type==='environment-inputs').observation.processes[1].changed = ['EXPECTED_FONT'];
      if (variant === 'missing-completion' || variant === 'legacy') rows.splice(rows.findIndex(r=>r.type==='environment-inputs'),1);
      if (variant === 'legacy') delete rows[0].environmentInputs;
      if (variant === 'scope') {
        rows[0].environmentInputs.declarations[0].readers = ['other.ts'];
        rows.find(r=>r.type==='environment-inputs').observation.declarations[0].readers = ['other.ts'];
      }
    });
    const result = evaluateCase(w.record,'regression',w.ctx);
    assert.equal(result.mappings[0]?.sensitivity,'unverified');
    assert.equal(result.mappings[0]?.acceptance,'current');
    if (variant !== 'legacy' && variant !== 'scope') {
      const observed = readInvocation({id:'bad-empty',suite:'e2e',dir:w.s.ctx.suiteRoot},join(w.s.ctx.suiteRoot,w.burn.run.path));
      assert.ok(observed.begin);
      assert.equal(computeDigests({...w.s.ctx,begin:observed.begin}).behavior.get(behaviorKey(S.TEST_A,'desktop'))?.status,'unresolved');
    }
  });
}

test('an absent projection cannot borrow newer environment-bearing receipts', () => {
  const w = evidenceWorld(true);
  const digest = w.ctx.digests.behavior.get(behaviorKey(S.TEST_A,'desktop'));
  assert.ok(digest?.status === 'resolved');
  delete digest.environmentInputs;
  assert.equal(evaluateCase(w.record,'regression',w.ctx).mappings[0]?.sensitivity,'unverified');
});
