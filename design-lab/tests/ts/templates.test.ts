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
  loadFont(font: { family: string; style: string }): Promise<void>;
  variables(): Promise<unknown[]>;
  collections(): Promise<unknown[]>;
  invalidateVariables(): void;
  createVariable(name: string, collection: unknown, type: string): unknown;
  createCollection(name: string): unknown;
}
function fixture(persistent = true, globalAvailable = true) {
  const calls = { fonts: 0, loads: 0, variables: 0, collections: 0 };
  let failLoad = false;
  const variables: { id: string }[] = [];
  const collections: { id: string; name: string; remove(): void; getSharedPluginData(): string }[] = [];
  const figma = {
    listAvailableFontsAsync: async () => {
      calls.fonts++;
      return [{ fontName: { family: 'Inter', style: 'Regular' } }];
    },
    loadFontAsync: async () => {
      calls.loads++;
      if (failLoad) throw new Error('missing font');
    },
    variables: {
      getLocalVariablesAsync: async () => {
        calls.variables++;
        return [...variables];
      },
      getLocalVariableCollectionsAsync: async () => {
        calls.collections++;
        return [...collections];
      },
      createVariable: () => {
        const item = { id: 'variable-' + variables.length };
        variables.push(item);
        return item;
      },
      createVariableCollection: (name: string) => {
        const item = {
          id: 'collection-' + collections.length,
          name,
          getSharedPluginData: () => 'owned',
          remove: () => {
            collections.splice(collections.indexOf(item), 1);
          },
        };
        collections.push(item);
        return item;
      },
    },
    root: { children: [] },
    fileKey: 'test-file',
  };
  const context = createContext({ figma });
  if (persistent)
    new Script('globalThis.__designLabBuildCache = {buildId:"test-build",loadedFonts:new Map()};').runInContext(
      context,
    );
  if (!globalAvailable) new Script('globalThis = undefined;').runInContext(context);
  const execute = (code: string, args: unknown = {}) => {
    const fn = new Script(`(async function(ARGS){${cache}\n${code}\n})`).runInContext(context) as (
      args: unknown,
    ) => Promise<unknown>;
    return fn(args);
  };
  const api = async () => (await execute('return DL_API;')) as CacheApi;
  return {
    calls,
    execute,
    api,
    figma,
    variables,
    collections,
    fail: (value: boolean) => {
      failLoad = value;
    },
  };
}

test('Figma runner cache refreshes available fonts and reuses family/style loads across payloads', async () => {
  const f = fixture();
  const one = await f.api(),
    two = await f.api();
  assert.notEqual(await one.fonts(), await two.fonts());
  await one.fonts();
  await two.fonts();
  await Promise.all([
    one.loadFont({ family: 'Inter', style: 'Regular' }),
    two.loadFont({ family: 'Inter', style: 'Regular' }),
  ]);
  await two.loadFont({ family: 'Inter', style: 'Bold' });
  assert.equal(f.calls.fonts, 2);
  assert.equal(f.calls.loads, 2);
});

test('Figma font cache evicts rejected loads and allows a later retry', async () => {
  const f = fixture(),
    one = await f.api(),
    two = await f.api();
  f.fail(true);
  const failed = await Promise.allSettled([
    one.loadFont({ family: 'Inter', style: 'Regular' }),
    two.loadFont({ family: 'Inter', style: 'Regular' }),
  ]);
  assert.equal(failed.filter((v) => v.status === 'rejected').length, 2);
  assert.equal(f.calls.loads, 1);
  f.fail(false);
  await two.loadFont({ family: 'Inter', style: 'Regular' });
  assert.equal(f.calls.loads, 2);
});

test('Figma variable and collection snapshot includes creation without another inventory call', async () => {
  const f = fixture(),
    api = await f.api();
  assert.equal((await api.variables()).length, 0);
  assert.equal((await api.collections()).length, 0);
  await api.variables();
  await api.collections();
  assert.equal(f.calls.variables, 1);
  assert.equal(f.calls.collections, 1);
  api.createCollection('Core');
  assert.equal((await api.collections()).length, 1);
  api.createVariable('Color/Ink', {}, 'COLOR');
  assert.equal((await api.variables()).length, 1);
  assert.equal(f.calls.variables, 1);
  assert.equal(f.calls.collections, 1);
});

test('wipe invalidates cached removed collections before the next payload', async () => {
  const f = fixture(),
    api = await f.api();
  api.createCollection('Core');
  assert.equal((await api.collections()).length, 1);
  const wipe = stripTemplate(readFileSync(resolve(pluginRoot, 'scripts/render/wipe.ts'), 'utf8'));
  await f.execute(wipe, { fileKey: 'test-file', collections: ['Core'] });
  assert.equal((await (await f.api()).collections()).length, 0);
  assert.equal(f.calls.collections, 3);
});

test('use_figma and absent globalThis each use isolated local caches', async () => {
  for (const globalAvailable of [true, false]) {
    const f = fixture(false, globalAvailable),
      one = await f.api(),
      two = await f.api();
    await one.fonts();
    await two.fonts();
    await one.loadFont({ family: 'Inter', style: 'Regular' });
    await two.loadFont({ family: 'Inter', style: 'Regular' });
    assert.equal(f.calls.fonts, 2);
    assert.equal(f.calls.loads, 2);
  }
});

test('stripped payload refreshes externally deleted, replaced and added inventories between steps', async () => {
  const f = fixture();
  f.variables.push({ id: 'old' });
  f.figma.variables.createVariableCollection('old');
  const inventory = 'return {v:await DL_API.variables(),c:await DL_API.collections(),f:await DL_API.fonts()};';
  const first = (await f.execute(inventory)) as { v: { id: string }[] };
  assert.equal(first.v[0]!.id, 'old');
  f.variables.splice(0, 1, { id: 'replacement' }, { id: 'addition' });
  f.collections.splice(0, 1);
  f.figma.variables.createVariableCollection('replacement');
  f.figma.listAvailableFontsAsync = async () => {
    f.calls.fonts++;
    return [{ fontName: { family: 'New', style: 'Regular' } }];
  };
  const second = (await f.execute(inventory)) as {
    v: { id: string }[];
    c: { name: string }[];
    f: { fontName: { family: string } }[];
  };
  assert.deepEqual(
    Array.from(second.v, (v) => v.id),
    ['replacement', 'addition'],
  );
  assert.deepEqual(
    Array.from(second.c, (v) => v.name),
    ['replacement'],
  );
  assert.equal(second.f[0]!.fontName.family, 'New');
  assert.deepEqual(f.calls, { variables: 2, collections: 2, fonts: 2, loads: 0 });
});

test('actual stripped variables payload reconciles external deletion, replacement and addition without duplicates', async () => {
  let serial = 0,
    reads = 0,
    collectionReads = 0;
  type Col = {
    id: string;
    name: string;
    modes: { modeId: string; name: string }[];
    renameMode: (id: string, name: string) => void;
    setSharedPluginData: () => void;
  };
  type Var = { id: string; name: string; variableCollectionId: string; setValueForMode: () => void };
  const collections: Col[] = [],
    variables: Var[] = [];
  const host = {
    getLocalVariableCollectionsAsync: async () => {
      collectionReads++;
      return [...collections];
    },
    getLocalVariablesAsync: async () => {
      reads++;
      return [...variables];
    },
    createVariableCollection: (name: string) => {
      const col: Col = {
        id: 'c' + serial++,
        name,
        modes: [{ modeId: 'm', name: 'Value' }],
        renameMode: (_id, name) => {
          col.modes[0]!.name = name;
        },
        setSharedPluginData: () => {},
      };
      collections.push(col);
      return col;
    },
    createVariable: (name: string, col: Col) => {
      const variable: Var = {
        id: 'v' + serial++,
        name,
        variableCollectionId: col.id,
        setValueForMode: () => {
          assert.ok(variables.includes(variable), 'deleted variable served');
        },
      };
      variables.push(variable);
      return variable;
    },
  };
  const context = createContext({ figma: { variables: host }, __designLabBuildCache: { loadedFonts: new Map() } });
  const body = stripTemplate(readFileSync(resolve(pluginRoot, 'scripts/render/variables.ts'), 'utf8'));
  const execute = new Script(`(async function(ARGS){${cache}\n${body}})`).runInContext(context) as (
    args: unknown,
  ) => Promise<{ created: number; updated: number }>;
  const args = {
    collections: {
      Core: {
        modes: ['Value'],
        variables: [
          { name: 'a', type: 'FLOAT', value: 1 },
          { name: 'b', type: 'FLOAT', value: 2 },
        ],
      },
    },
  };
  assert.equal((await execute(args)).created, 2);
  variables.splice(0);
  const replacement = host.createVariable('a', collections[0]!);
  host.createVariable('b', collections[0]!);
  assert.equal((await execute(args)).created, 0);
  assert.equal(variables[0], replacement);
  assert.equal(variables.length, 2);
  variables.splice(0, 1);
  assert.equal((await execute(args)).created, 1);
  assert.equal(variables.length, 2);
  variables.splice(0);
  collections.splice(0);
  const col = host.createVariableCollection('Core');
  host.createVariable('a', col);
  host.createVariable('b', col);
  assert.equal((await execute(args)).created, 0);
  assert.equal(collections.length, 1);
  assert.equal(variables.length, 2);
  assert.equal(reads, 4);
  assert.equal(collectionReads, 4);
});
