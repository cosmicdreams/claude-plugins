import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureProfile, writeJson } from '../fixtures/coordinator.ts';
import { caseRecord, tmp } from './support.ts';
import { inside, loadPersisted, parseCase, parseEvidence, parseProfile, parseSourceIndex, parseTransition } from '../../src/persistence.ts';
import { main } from '../../src/cli.ts';

test('closed schemas refuse malformed nested provenance, approvals, records and profile matrices',()=>{
  const c=caseRecord('REG-1','regression');
  assert.throws(()=>parseCase({...c,provenance:{...c.provenance,independentRefs:'ticket'}}),/array/);
  assert.throws(()=>parseCase({...c,approval:{...c.approval,standIn:'true'}}),/boolean/);
  assert.throws(()=>parseCase({...c,configurationDependent:'false'}),/boolean/);
  const profile=fixtureProfile();assert.deepEqual(parseProfile(profile),profile);
  assert.throws(()=>parseProfile({...profile,configurations:[{...profile.configurations[0],viewport:{width:0,height:900}}]}),/viewport/);
  assert.throws(()=>parseProfile({...profile,regression:['REG-1','REG-1']}),/duplicate/);
  assert.throws(()=>parseProfile({...profile,suites:[{id:'e2e',config:'../another/playwright.config.ts'}]}),/relative path/);
  assert.throws(()=>parseProfile({...profile,unknownTrustedConclusion:true}),/unknown field/);
  assert.throws(()=>parseEvidence({kind:'acceptance',id:'a',test:{suite:'s',file:'../outside',titlePath:['a']}}),/path/);
  assert.throws(()=>parseTransition({id:'t',kind:'scope',by:'Q',role:'qa',standIn:true,at:'2026-10-09',reason:'change',baseCommit:'x',setBefore:'wrong',setAfter:'wrong',delta:[],supersedes:[]}),/SHA-256/);
  const binding={case:'REG-1',sourceCase:1,suite:1,rawHash:'a'.repeat(64),caseHash:'b'.repeat(64)};
  assert.throws(()=>parseSourceIndex({schema:1,snapshot:'sources/current.json',cases:[binding]}),/approval/,'a current raw hash alone cannot establish an owner-approved source reading');
  const signed={...binding,approval:c.approval};
  assert.throws(()=>parseSourceIndex({schema:1,snapshot:'sources/current.json',cases:[signed,signed]}),/duplicate case binding/);
});
test('a missing mappings/dispositions contract cannot silently become an empty list; malformed evidence is reported',()=>{
  const root=tmp('test-lab-persistence-');
  try {
    writeJson(join(root,'.test-lab/profile.json'),fixtureProfile());
    writeJson(join(root,'.test-lab/local.json'),{schema:1,applicationBase:{remote:'origin',branch:'main',maxAgeHours:24},healthPath:'health',actorProbe:{path:'actor',roleField:'role'},database:{source:null,pulledAt:null}});
    for(const d of ['cases/regression','cases/addendum','cases/drafts','recipes','evidence'])mkdirSync(join(root,'.test-lab',d),{recursive:true});
    writeJson(join(root,'.test-lab/cases/regression/REG-1.json'),caseRecord('REG-1','regression'));
    assert.throws(()=>loadPersisted(root),/ledger/);
    writeJson(join(root,'.test-lab/ledger.json'),{schema:1,mappings:[]});assert.throws(()=>loadPersisted(root),/dispositions/);
    writeJson(join(root,'.test-lab/dispositions.json'),{schema:1,records:[]});writeJson(join(root,'.test-lab/evidence/bad.json'),{verified:true});
    const read=loadPersisted(root);assert.equal(read.evidence.length,0);assert.match(read.evidenceProblems.join(),/unsupported record/);
    writeJson(join(root,'.test-lab/cases/drafts/REG-2.json'),caseRecord('REG-2','regression'));
    assert.throws(()=>loadPersisted(root),/must leave the drafts folder/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('canonical boundary supports nonexistent descendants through /var aliases and refuses a linked external corpus',()=>{
  const root=tmp('test-lab-path-');const outside=tmp('test-lab-other-');
  try{assert.ok(inside(root,'new/folder').endsWith('/new/folder'));symlinkSync(outside,join(root,'linked'),'dir');assert.throws(()=>inside(root,'linked/new-file'),/leaves/);}
  finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
test('source CLI imports only complete dated known snapshots and leaves existing output untouched',async()=>{
  const root=tmp('test-lab-source-cli-');
  try {
    const source=join(root,'source.json');const output=join(root,'imported');
    const snapshot={schema:1,source:'testrail',project:1,fetchedAt:'2026-10-09T00:00:00Z',complete:true,priorities:[{id:7,name:'Short Regression'}],suites:[{id:1,cases:[{id:1,title:'Generic case',priority_id:7,custom_steps:'Open',custom_expected:'Heading visible'}]}]};
    writeJson(source,{...snapshot,complete:false});assert.equal(await main(['source','--snapshot',source,'--output',output]),4);
    writeJson(source,{...snapshot,fetchedAt:'yesterday'});assert.equal(await main(['source','--snapshot',source,'--output',output]),4);
    writeJson(source,snapshot);assert.equal(await main(['source','--snapshot',source,'--output',output]),0);
    const before=readFileSync(join(output,'drafts.json'),'utf8');assert.equal(JSON.parse(before).drafts[0].record.approval,null);
    assert.equal(await main(['source','--snapshot',source,'--output',output]),4);assert.equal(readFileSync(join(output,'drafts.json'),'utf8'),before);
    writeFileSync(source,'{"schema":1,"source":"unknown"}');assert.equal(await main(['source','--snapshot',source,'--output',join(root,'bad')]),4);
  }finally{rmSync(root,{recursive:true,force:true});}
});
