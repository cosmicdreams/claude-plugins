import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { stripTemplate } from '../../src/render-payload.ts';
import { pluginRoot } from '../../src/runtime.ts';

const cache = stripTemplate(readFileSync(resolve(pluginRoot, 'scripts/render/_cache.ts'), 'utf8'));
interface CacheApi {
 fonts(): Promise<unknown[]>;
 loadFont(font: {family:string;style:string}): Promise<void>;
 variables(): Promise<unknown[]>;
 collections(): Promise<unknown[]>;
 invalidateVariables(): void;
 createVariable(name:string, collection:unknown, type:string): unknown;
 createCollection(name:string): unknown;
}
function fixture(persistent = true, globalAvailable = true) {
  const calls = { fonts:0, loads:0, variables:0, collections:0 };
  let failLoad = false;
  const variables: {id:string}[] = [];
  const collections: {id:string;name:string;remove():void;getSharedPluginData():string}[] = [];
  const figma = {
    listAvailableFontsAsync: async () => { calls.fonts++; return [{fontName:{family:'Inter',style:'Regular'}}]; },
    loadFontAsync: async () => { calls.loads++; if (failLoad) throw new Error('missing font'); },
    variables: {
      getLocalVariablesAsync: async () => { calls.variables++; return [...variables]; },
      getLocalVariableCollectionsAsync: async () => { calls.collections++; return [...collections]; },
      createVariable: () => { const item = {id:'variable-' + variables.length}; variables.push(item); return item; },
      createVariableCollection: (name:string) => {
        const item = {id:'collection-' + collections.length,name,getSharedPluginData:()=> 'owned',remove:()=>{
          collections.splice(collections.indexOf(item),1);
        }}; collections.push(item); return item;
      },
    },
    root: {children:[]},
    fileKey: 'test-file',
  };
  const context = createContext({ figma });
  if (persistent) new Script('globalThis.__designLabBuildCache = {buildId:"test-build",loadedFonts:new Map()};').runInContext(context);
  if (!globalAvailable) new Script('globalThis = undefined;').runInContext(context);
  const execute = (code:string, args:unknown = {}) => {
    const fn = new Script(`(async function(ARGS){${cache}\n${code}\n})`).runInContext(context) as (args:unknown)=>Promise<unknown>;
    return fn(args);
  };
  const api = async () => await execute('return DL_API;') as CacheApi;
  return {calls,execute,api,fail:(value:boolean)=>{failLoad=value;}};
}

test('Figma runner cache reuses available fonts and family/style loads across payloads', async () => {
  const f = fixture();
  const one = await f.api(), two = await f.api();
  assert.equal(await one.fonts(), await two.fonts());
  await Promise.all([one.loadFont({family:'Inter',style:'Regular'}),two.loadFont({family:'Inter',style:'Regular'})]);
  await two.loadFont({family:'Inter',style:'Bold'});
  assert.equal(f.calls.fonts,1); assert.equal(f.calls.loads,2);
});

test('Figma font cache evicts rejected loads and allows a later retry', async () => {
  const f = fixture(), one = await f.api(), two = await f.api();
  f.fail(true);
  const failed = await Promise.allSettled([one.loadFont({family:'Inter',style:'Regular'}),two.loadFont({family:'Inter',style:'Regular'})]);
  assert.equal(failed.filter(v => v.status === 'rejected').length,2);
  assert.equal(f.calls.loads,1);
  f.fail(false);
  await two.loadFont({family:'Inter',style:'Regular'});
  assert.equal(f.calls.loads,2);
});

test('Figma variable and collection cache invalidates on creation', async () => {
  const f = fixture(), api = await f.api();
  assert.equal((await api.variables()).length,0); assert.equal((await api.collections()).length,0);
  await api.variables(); await api.collections();
  assert.equal(f.calls.variables,1); assert.equal(f.calls.collections,1);
  api.createCollection('Core');
  assert.equal((await api.collections()).length,1);
  api.createVariable('Color/Ink',{},'COLOR');
  assert.equal((await api.variables()).length,1);
  assert.equal(f.calls.variables,2); assert.equal(f.calls.collections,2);
});

test('wipe invalidates cached removed collections before the next payload', async () => {
  const f = fixture(), api = await f.api();
  api.createCollection('Core');
  assert.equal((await api.collections()).length,1);
  const wipe = stripTemplate(readFileSync(resolve(pluginRoot,'scripts/render/wipe.ts'),'utf8'));
  await f.execute(wipe,{fileKey:'test-file',collections:['Core']});
  assert.equal((await (await f.api()).collections()).length,0);
  assert.equal(f.calls.collections,2);
});

test('use_figma and absent globalThis each use isolated local caches', async () => {
  for (const globalAvailable of [true,false]) {
    const f = fixture(false,globalAvailable), one = await f.api(), two = await f.api();
    await one.fonts(); await two.fonts();
    await one.loadFont({family:'Inter',style:'Regular'}); await two.loadFont({family:'Inter',style:'Regular'});
    assert.equal(f.calls.fonts,2); assert.equal(f.calls.loads,2);
  }
});
