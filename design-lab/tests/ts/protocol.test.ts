import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Script,createContext} from 'node:vm';
import {stripTemplate} from '../../src/render-payload.ts';
import {pluginRoot} from '../../src/runtime.ts';
import {PORT,RETRY_MS,WAIT_MS,HEARTBEAT_SECONDS,SERVER_FRESH_MS,RUNNER_ABSENT_MS,PROGRESS_STATES,STEP_KINDS} from '../../src/protocol.ts';
import {PORT as ServerPort,WAIT_MS as ServerWait,HEARTBEAT_SECONDS as ServerHeartbeat} from '../../src/figma-runner.ts';
import {reviewedSeams,restoreSeams} from '../equivalence/typed-seams-parity.ts';
import {modContract} from '../../scripts/generate-mod-contract.ts';
import {variableCollections,requiredValue} from '../../src/figma-args.ts';
import {assertNever} from '../../src/assert-never.ts';
const client=stripTemplate(readFileSync(resolve(pluginRoot,'runner/code.ts'),'utf8'));
test('stripped runner carries the exact shared protocol literals with no runtime imports',()=>{
 assert.deepEqual([ServerPort,ServerWait,ServerHeartbeat],[PORT,WAIT_MS,HEARTBEAT_SECONDS]);
 assert.ok(client.includes(`const SERVER = 'http://localhost:${PORT}';`));
 assert.ok(client.includes(`const RETRY_MS = ${RETRY_MS};`));
 assert.equal(client.split(`setTimeout(pulse, ${HEARTBEAT_SECONDS*1000})`).length-1,2);
 assert.doesNotMatch(client,/\b(?:PROTOCOL_PORT|PROTOCOL_RETRY_MS|HEARTBEAT_SECONDS|import)\b/);
 assert.equal(SERVER_FRESH_MS,3*HEARTBEAT_SECONDS*1000);
 assert.equal(RUNNER_ABSENT_MS,120_000);
 assert.deepEqual(Object.keys(PROGRESS_STATES),['waiting','preflight','building','done','failed']);
 assert.deepEqual(Object.keys(STEP_KINDS),['wait','done','check','dump','use_figma','upload','screenshot','skip']);
 const manifest=JSON.parse(readFileSync(resolve(pluginRoot,'runner/manifest.json'),'utf8'));
 assert.ok(JSON.stringify(manifest.networkAccess).includes(String(PORT)));
});
test('mod manifest contract is derived, self-contained and current',()=>{
 const source=readFileSync(resolve(pluginRoot,'types/index.d.ts'),'utf8');
 assert.equal(source,modContract());
 assert.doesNotMatch(source,/\bimport\b|export[^\n]*\bfrom\b/);
});
test('literal reviewed seam substitutions fail on an unreviewed executable edit',()=>{
 assert.doesNotThrow(()=>restoreSeams(client,'runner'));
 assert.throws(()=>restoreSeams(client.replace('case \'upload\': result = await upload(step);','case \'upload\': result = {};'),'runner'),/present exactly/);
});
test('exhaustive runner dispatch preserves every previously reachable work variant',async()=>{
 const edit=reviewedSeams.runner[0]!;
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor as new(...args:string[])=> (...args:unknown[])=>Promise<unknown>;
 const make=(dispatch:string)=>new AsyncFunction('step','upload','screenshot','AsyncFunction','assertNever',`let result;\n${dispatch}\nreturn result;`);
 const before=make(edit.previous),after=make(edit.current);
 for(const kind of ['use_figma','dump','check','upload','screenshot']) {
  const step={kind,code:'return {answer:42};'},upload=async()=>({statuses:[200]}),screenshot=async()=>({png:'AAAA'});
  assert.deepEqual(await after(step,upload,screenshot,AsyncFunction,assertNever),await before(step,upload,screenshot,AsyncFunction,assertNever),kind);
 }
 const error=async()=>{throw new Error('host failure');};
 for(const kind of ['upload','screenshot']) {
  const args=[{kind},error,error,AsyncFunction,assertNever];
  await assert.rejects(()=>after(...args),/host failure/);
  await assert.rejects(()=>before(...args),/host failure/);
 }
 assert.deepEqual(await after({kind:'skip'},null,null,AsyncFunction,assertNever),{});
 await assert.rejects(()=>before({kind:'skip'},null,null,AsyncFunction,assertNever),/unknown step kind skip/);
});
test('exhaustive expand preserves all five node kinds, style reuse and bound padding',()=>{
 const current=reviewedSeams.responsive[0]!.current,previous=reviewedSeams.responsive[0]!.previous;
 const args={styles:[{family:'Inter',weight:400,size:16}],tree:{kind:'frame',name:'root',source:'/root',layout:{pad:[{var:'space'},2,0,0]},children:[
  {kind:'text',name:'text',source:'/text',ts:0,chars:'Hello'},
  {kind:'image',name:'image',source:'/image',src:'/photo.png'},
  {kind:'svg',name:'svg',source:'/svg',svg:'<svg/>'},
  {kind:'instance',name:'instance',source:'/instance',instanceOf:'child'},
 ]}};
 const execute=(code:string)=>{const context=createContext({ARGS:structuredClone(args),assertNever});new Script(`${code}\nexpand(ARGS.tree);`).runInContext(context);return JSON.parse(JSON.stringify(context['ARGS']));};
 assert.deepEqual(execute(current),execute(previous));
});
test('invalid variable scopes and absent producer identities fail before entering Figma',()=>{
 assert.throws(()=>variableCollections({Core:{modes:['Value'],variables:[{name:'Spacing/Test',type:'FLOAT',scopes:['FONT_SZE']} ]}}),/invalid Figma scope.*FONT_SZE/);
 assert.equal(requiredValue(0,'width'),0);
 assert.throws(()=>requiredValue(undefined,'componentId for card'),/missing componentId for card/);
});
