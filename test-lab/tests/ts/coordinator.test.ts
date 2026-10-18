import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments } from '../../src/cli.ts';
import { coordinate } from '../../src/coordinator.ts';
import { tmp } from './support.ts';
import { rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

test('CLI never infers application/suite roots or silently selects work',()=>{
  assert.throws(()=>parseArguments(['run']),/app-root/);
  assert.throws(()=>parseArguments(['run','--app-root','/app']),/suite-root/);
  assert.throws(()=>parseArguments(['run','--app-root','/app','--suite-root','/suite','--env','local','--tier','full']),/fast/);
  assert.throws(()=>parseArguments(['run','--app-root','/app','--suite-root','/suite','--env','local','--work','A','--no-work']),/both/);
});
test('unreadable persisted contract emits a not-evaluable artifact instead of an implicit empty pass',async()=>{
  const dir=tmp('test-lab-coordinator-invalid-');
  try{
    const r=await coordinate({operation:'run',appRoot:dir,suiteRoot:dir,environment:'local',noWork:true});
    assert.equal(r.verdict.verdict,'not-evaluable');assert.equal(r.exitCode,4);
    assert.match(readFileSync(join(r.runDir,'verdict.html'),'utf8'),/NOT EVALUABLE/);
    assert.equal(JSON.parse(readFileSync(join(r.runDir,'manifest.json'),'utf8')).schema,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('reference checkout refuses artifact writes before creating the persisted run folder',async()=>{
  const dir=tmp('test-lab-coordinator-main-');
  try {
    execFileSync('git',['init','-b','main'],{cwd:dir,stdio:'ignore'});
    await assert.rejects(coordinate({operation:'verify',appRoot:dir,suiteRoot:dir,environment:'local',noWork:true}),/dedicated suite branch/);
    assert.equal(existsSync(join(dir,'.test-lab')),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
