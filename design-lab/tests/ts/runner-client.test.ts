import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { stripTemplate } from '../../src/render-payload.ts';
import { pluginRoot } from '../../src/runtime.ts';
import { assertRunnerClientParity } from '../equivalence/runner-client-parity.ts';

const client = stripTemplate(readFileSync(resolve(pluginRoot,'runner/code.ts'),'utf8'));
const cache = stripTemplate(readFileSync(resolve(pluginRoot,'scripts/render/_cache.ts'),'utf8'));
type GlobalMode = 'persistent'|'nonpersistent'|'absent'|'protected';
interface RecordBody {__designLabTiming:{durationMs:number};result:Record<string,unknown>}
async function runClient(builds:string[], mode:GlobalMode='persistent', returns=true) {
  const calls = {fonts:0,loads:0,variables:0,collections:0};
  const records: {step:string;body:RecordBody}[] = [], errors:unknown[] = [];
  let tick = 0;
  let complete!: (message:string)=>void;
  const completion = new Promise<string>(done => {complete=done;});
  const code = `${cache}\nawait DL_API.fonts(); await DL_API.loadFont({family:'Inter',style:'Regular'}); await DL_API.variables(); await DL_API.collections();\n` +
    (returns ? `return {fonts:1,buildId:typeof globalThis === 'undefined' ? null : (globalThis.__designLabBuildCache?.buildId ?? null)};` : '');
  const queue = builds.map((buildId,i)=>({kind:'use_figma',step:'test:'+i,buildId,code,done:i,total:builds.length}));
  const figma = {
    fileKey:'fake-file',
    ui:{postMessage: (_message:string)=>undefined},
    showUI: (_html:string,_options:unknown)=>undefined,
    closePlugin: (message:string)=>complete(message),
    clientStorage:{getAsync:async()=> 'saved-token'},
    listAvailableFontsAsync:async()=>{calls.fonts++;return [{fontName:{family:'Inter',style:'Regular'}}];},
    loadFontAsync:async()=>{calls.loads++;},
    variables:{
      getLocalVariablesAsync:async()=>{calls.variables++;return [];},
      getLocalVariableCollectionsAsync:async()=>{calls.collections++;return [];},
    },
  };
  const context = createContext({figma,Date:{now:()=>++tick*7},setTimeout});
  if (mode==='absent') new Script('globalThis = undefined;').runInContext(context);
  if (mode==='protected') new Script('Object.defineProperty(globalThis,"__designLabBuildCache",{value:undefined,writable:false});').runInContext(context);
  context['fetch'] = async (value:string,init?:{body?:string}) => {
    const url = new URL(value);
    assert.equal(url.origin,'http://localhost:8765'); assert.equal(url.searchParams.get('fileKey'),'fake-file');
    assert.equal(url.searchParams.get('token'),'saved-token'); assert.equal(url.searchParams.get('version'),'source');
    let response:unknown;
    if (url.pathname==='/next') {
      if (mode==='nonpersistent') new Script('delete globalThis.__designLabBuildCache;').runInContext(context);
      response=queue.shift() ?? {kind:'done'};
    } else if (url.pathname==='/record') {
      assert.ok(init?.body); records.push({step:url.searchParams.get('step')!,body:JSON.parse(init.body) as RecordBody}); response={recorded:url.searchParams.get('step')};
    } else if (url.pathname==='/error') {errors.push(JSON.parse(init?.body ?? '{}'));response={};}
    else throw new Error('unexpected fake route '+url.pathname);
    return {status:200,text:async()=>JSON.stringify(response)};
  };
  new Script(client).runInContext(context);
  const closed = await completion;
  assert.equal(errors.length,0,JSON.stringify(errors));
  assert.equal(closed,`design-lab: build complete (${builds.length} steps this session)`);
  assert.equal(records.length,builds.length);
  for (const [i,record] of records.entries()) {
    assert.equal(record.step,'test:'+i);
    assert.equal(record.body.__designLabTiming.durationMs,7);
    assert.deepEqual(Object.keys(record.body).sort(),['__designLabTiming','result']);
  }
  return {calls,records};
}

test('stripped runner client matches the oracle except the reviewed cache and timing code',()=>{
  assert.deepEqual(assertRunnerClientParity(),{runner:1,cache:true,timing:true});
});

test('actual runner client retains font and variable caches within a build', {timeout:5000},async()=>{
  const r=await runClient(['A','A']);
  assert.deepEqual(r.calls,{fonts:1,loads:1,variables:1,collections:1});
  assert.deepEqual(r.records.map(v=>v.body.result['buildId']),['A','A']);
});

test('actual runner client resets every cache when the build identity changes', {timeout:5000},async()=>{
  const r=await runClient(['A','A','B','B']);
  assert.deepEqual(r.calls,{fonts:2,loads:2,variables:2,collections:2});
  assert.deepEqual(r.records.map(v=>v.body.result['buildId']),['A','A','B','B']);
});

for (const mode of ['nonpersistent','absent','protected'] as const) {
  test(`actual runner client gracefully uses local caches with ${mode} globals`,{timeout:5000},async()=>{
    const r=await runClient(['A','A'],mode);
    assert.deepEqual(r.calls,{fonts:2,loads:2,variables:2,collections:2});
  });
}

test('actual runner client sends an empty result and finite per-step duration for an undefined return',{timeout:5000},async()=>{
  const r=await runClient(['A'],'persistent',false);
  assert.deepEqual(r.records[0]!.body,{__designLabTiming:{durationMs:7},result:{}});
});
