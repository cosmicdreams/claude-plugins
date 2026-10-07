import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Build,makeServer,pluginVersion,SEEN_FILE} from '../../src/figma-runner.ts';
import type {DriverLike} from '../../src/figma-runner.ts';
import {writeOnChange} from '../../src/build-artifacts.ts';

async function fixture(t: {after(fn:()=>void):void}) {
  const root=mkdtempSync('/tmp/design-lab-work-');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const state={fileKey:'FILE',buildId:'G1',runtime:'mock',steps:[{id:'images:a'}],done:[] as string[]};
  const save=()=>writeOnChange(resolve(root,'figma/state.json'),state);save();
  const image=resolve(root,'asset.bin');writeFileSync(image,'oracle image'); let commits=0;
  const driver:DriverLike={next:async()=>state.done.length?{kind:'done'}:{kind:'upload',step:'images:a',nodeIds:['0:1'],scaleMode:'FILL',files:[{file:image,contentType:'image/png'}]},record:async step=>{commits++;state.done.push(step);save();return {recorded:step,remaining:0};},recordScreenshot:async()=>{throw Error('unused');}};
  let build=new Build(root,{driver,echo:false}), server=makeServer(new Map([['FILE',build]]),'test',{ctx:{home:resolve(root,'home'),port:0}}), port=await server.listen(0);
  t.after(()=>{void server.close();});
  const call=async(path:string,work:Record<string,unknown>={},body?:unknown,key='FILE',client='C1')=>{
    const query=new URLSearchParams({fileKey:key,token:'test',version:pluginVersion(),client,i:'0',...Object.fromEntries(Object.entries(work).filter(([k])=>['step','generation','stepToken'].includes(k)).map(([k,v])=>[k,String(v)]))});
    const response=await fetch(`http://127.0.0.1:${port}${path}?${query}`,body===undefined?{}:{method:'POST',body:JSON.stringify(body)});
    const text=await response.text();return {status:response.status,text,json:()=>JSON.parse(text)};
  };
  return {root,state,save,call,commits:()=>commits,restart:async()=>{await server.close();build=new Build(root,{driver,echo:false});server=makeServer(new Map([['FILE',build]]),'test',{ctx:{home:resolve(root,'home'),port:0}});port=await server.listen(0);}};
}
test('overlapping clients receive only one issued step with persisted identity',async t=>{
  const h=await fixture(t);const [a,b]=await Promise.all([h.call('/next'),h.call('/next',{},undefined,'FILE','C2')]);
  assert.deepEqual([a.json().kind,b.json().kind].sort(),['upload','wait']);
  const work=a.json().kind==='upload'?a.json():b.json();assert.ok(work.stepToken);assert.ok(work.generation);
  assert.equal((await h.call('/file',{...work,stepToken:'wrong'})).status,409);
  assert.equal((await h.call('/record',work,{statuses:[200]},'FILE','C2')).status,409);
});
test('retarget rejects every route through the original map key',async t=>{
  const h=await fixture(t),work=(await h.call('/next')).json();h.state.fileKey='NEWFILE';h.state.buildId='G2';h.save();
  for(const route of ['/next','/file','/record','/error']) assert.equal((await h.call(route,work,route==='/record'?{statuses:[200]}:route==='/error'?{step:work.step,message:'old'}:undefined)).status,404,route);
  assert.equal((await h.call('/next',{},undefined,'NEWFILE')).json().kind,'upload');assert.equal(h.commits(),0);
});
test('re-init rejects old file, record, error and heartbeat tokens without completing new work',async t=>{
  const h=await fixture(t),old=(await h.call('/next')).json();h.state.buildId='G2';h.save();
  const current=(await h.call('/next')).json();assert.notEqual(current.stepToken,old.stepToken);
  for(const route of ['/file','/record','/error','/heartbeat']) assert.equal((await h.call(route,old,route==='/record'?{statuses:[200]}:route==='/error'?{step:old.step,message:'old'}:undefined)).status,409,route);
  assert.equal(h.commits(),0);assert.equal((await h.call('/record',current,{statuses:[200]})).status,200);
});
test('restart during upload recovers files and committed record retries are digest-idempotent',async t=>{
  const h=await fixture(t),work=(await h.call('/next')).json();await h.restart();
  const file=await h.call('/file',work);assert.equal(file.status,200,file.text);assert.equal(file.text,'oracle image');
  const body={__designLabTiming:{durationMs:8},result:{statuses:[200]}};
  const first=await h.call('/record',work,body);assert.equal(first.status,200,first.text);await h.restart();
  const retry=await h.call('/record',work,body);assert.equal(retry.status,200,retry.text);assert.deepEqual(retry.json(),first.json());assert.equal(h.commits(),1);
  assert.equal((await h.call('/record',work,{statuses:[0]})).status,409);
});
test('record journal recovers a crash after driver commit and before acknowledgement',async t=>{
  const h=await fixture(t),work=(await h.call('/next')).json();
  assert.equal((await h.call('/record',work,{statuses:[200]})).status,200);
  const path=resolve(h.root,'figma/runner-work.json'),ledger=JSON.parse(readFileSync(path,'utf8'));
  const ack=ledger.completed[work.stepToken];delete ledger.completed[work.stepToken];
  ledger.active={step:{...work,files:[]},client:'C1',token:work.stepToken,intent:{digest:ack.digest,result:{statuses:[200]},out:ack.out}};
  writeOnChange(path,ledger);await h.restart();assert.equal((await h.call('/record',work,{statuses:[200]})).status,200);assert.equal(h.commits(),1);
});
test('active token heartbeats renew lastSeen and stale tokens cannot renew it',async t=>{
  const h=await fixture(t),work=(await h.call('/next')).json(),path=resolve(h.root,'figma',SEEN_FILE);
  writeFileSync(path,'2000-01-01T00:00:00Z\n');assert.equal((await h.call('/heartbeat',work)).status,200);assert.notEqual(readFileSync(path,'utf8').trim(),'2000-01-01T00:00:00Z');
  writeFileSync(path,'2000-01-01T00:00:00Z\n');assert.equal((await h.call('/heartbeat',{...work,stepToken:'bad'})).status,409);assert.equal(readFileSync(path,'utf8').trim(),'2000-01-01T00:00:00Z');
});
