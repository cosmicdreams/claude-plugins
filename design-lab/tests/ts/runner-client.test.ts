import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { stripTemplate } from '../../src/render-payload.ts';
import { pluginRoot } from '../../src/runtime.ts';

const client = stripTemplate(readFileSync(resolve(pluginRoot, 'runner/code.ts'), 'utf8'));
const cache = stripTemplate(readFileSync(resolve(pluginRoot, 'scripts/render/_cache.ts'), 'utf8'));
type GlobalMode = 'persistent' | 'nonpersistent' | 'absent' | 'protected';
interface RecordBody {
  __designLabTiming: { durationMs: number };
  result: Record<string, unknown>;
}
async function runClient(builds: string[], mode: GlobalMode = 'persistent', returns = true) {
  const calls = { fonts: 0, loads: 0, variables: 0, collections: 0 };
  const records: { step: string; body: RecordBody }[] = [],
    errors: unknown[] = [];
  let tick = 0;
  let complete!: (message: string) => void;
  const completion = new Promise<string>((done) => {
    complete = done;
  });
  const code =
    `${cache}\nawait DL_API.fonts(); await DL_API.loadFont({family:'Inter',style:'Regular'}); await DL_API.variables(); await DL_API.collections();\n` +
    (returns
      ? `return {fonts:1,buildId:typeof globalThis === 'undefined' ? null : (globalThis.__designLabBuildCache?.buildId ?? null)};`
      : '');
  const queue = builds.map((buildId, i) => ({
    kind: 'use_figma',
    step: 'test:' + i,
    buildId,
    code,
    done: i,
    total: builds.length,
  }));
  const figma = {
    fileKey: 'fake-file',
    ui: { postMessage: (_message: string) => undefined },
    showUI: (_html: string, _options: unknown) => undefined,
    closePlugin: (message: string) => complete(message),
    clientStorage: { getAsync: async () => 'saved-token' },
    listAvailableFontsAsync: async () => {
      calls.fonts++;
      return [{ fontName: { family: 'Inter', style: 'Regular' } }];
    },
    loadFontAsync: async () => {
      calls.loads++;
    },
    variables: {
      getLocalVariablesAsync: async () => {
        calls.variables++;
        return [];
      },
      getLocalVariableCollectionsAsync: async () => {
        calls.collections++;
        return [];
      },
    },
  };
  const context = createContext({ figma, Date: { now: () => ++tick * 7 }, setTimeout, clearTimeout });
  if (mode === 'absent') new Script('globalThis = undefined;').runInContext(context);
  if (mode === 'protected')
    new Script(
      'Object.defineProperty(globalThis,"__designLabBuildCache",{value:undefined,writable:false});',
    ).runInContext(context);
  context['fetch'] = async (value: string, init?: { body?: string }) => {
    const url = new URL(value);
    assert.equal(url.origin, 'http://localhost:8765');
    assert.equal(url.searchParams.get('fileKey'), 'fake-file');
    assert.equal(url.searchParams.get('token'), 'saved-token');
    assert.equal(url.searchParams.get('version'), 'source');
    let response: unknown;
    if (url.pathname === '/next') {
      if (mode === 'nonpersistent') new Script('delete globalThis.__designLabBuildCache;').runInContext(context);
      response = queue.shift() ?? { kind: 'done' };
    } else if (url.pathname === '/record') {
      assert.ok(init?.body);
      records.push({ step: url.searchParams.get('step')!, body: JSON.parse(init.body) as RecordBody });
      response = { recorded: url.searchParams.get('step') };
    } else if (url.pathname === '/error') {
      errors.push(JSON.parse(init?.body ?? '{}'));
      response = {};
    } else throw new Error('unexpected fake route ' + url.pathname);
    return { status: 200, text: async () => JSON.stringify(response) };
  };
  new Script(client).runInContext(context);
  const closed = await completion;
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(closed, `design-lab: build complete (${builds.length} steps this session)`);
  assert.equal(records.length, builds.length);
  for (const [i, record] of records.entries()) {
    assert.equal(record.step, 'test:' + i);
    assert.equal(record.body.__designLabTiming.durationMs, 7);
    assert.deepEqual(Object.keys(record.body).sort(), ['__designLabTiming', 'result']);
  }
  return { calls, records };
}

void test(
  'actual runner client refreshes inventories and retains loaded fonts within a build',
  { timeout: 5000 },
  async () => {
    const r = await runClient(['A', 'A']);
    assert.deepEqual(r.calls, { fonts: 2, loads: 1, variables: 2, collections: 2 });
    assert.deepEqual(
      r.records.map((v) => v.body.result['buildId']),
      ['A', 'A'],
    );
  },
);

void test('actual runner client resets every cache when the build identity changes', { timeout: 5000 }, async () => {
  const r = await runClient(['A', 'A', 'B', 'B']);
  assert.deepEqual(r.calls, { fonts: 4, loads: 2, variables: 4, collections: 4 });
  assert.deepEqual(
    r.records.map((v) => v.body.result['buildId']),
    ['A', 'A', 'B', 'B'],
  );
});

for (const mode of ['nonpersistent', 'absent', 'protected'] as const) {
  void test(`actual runner client gracefully uses local caches with ${mode} globals`, { timeout: 5000 }, async () => {
    const r = await runClient(['A', 'A'], mode);
    assert.deepEqual(r.calls, { fonts: 2, loads: 2, variables: 2, collections: 2 });
  });
}

void test(
  'actual runner client sends an empty result and finite per-step duration for an undefined return',
  { timeout: 5000 },
  async () => {
    const r = await runClient(['A'], 'persistent', false);
    assert.deepEqual(r.records[0]!.body, { __designLabTiming: { durationMs: 7 }, result: {} });
  },
);

void test('actual stripped client heartbeats a long active step with its issued token and stops after record', async () => {
  let finish!: () => void, close!: () => void;
  const pending = new Promise<void>((r) => {
      finish = r;
    }),
    closed = new Promise<void>((r) => {
      close = r;
    });
  const timers = new Map<number, () => Promise<void>>();
  let id = 0,
    records = 0;
  const pulses: URL[] = [];
  const step = {
    kind: 'use_figma',
    step: 'slow',
    generation: 'G',
    stepToken: 'T',
    buildId: 'B',
    done: 0,
    total: 1,
    code: 'await figma.slow();return {};',
  };
  const context = createContext({
    Date,
    Math,
    figma: {
      fileKey: 'FILE',
      slow: () => pending,
      clientStorage: { getAsync: async () => 'token' },
      showUI: () => {},
      ui: { postMessage: () => {} },
      closePlugin: () => close(),
    },
    setTimeout: (fn: () => Promise<void>, ms: number) => {
      assert.equal(ms, 10000);
      timers.set(++id, fn);
      return id;
    },
    clearTimeout: (n: number) => {
      timers.delete(n);
    },
    fetch: async (value: string) => {
      const url = new URL(value);
      let body: unknown = {};
      if (url.pathname === '/next') body = records ? { kind: 'done' } : step;
      else if (url.pathname === '/heartbeat') pulses.push(url);
      else if (url.pathname === '/record') {
        records++;
        assert.equal(url.searchParams.get('stepToken'), 'T');
      } else throw Error('unexpected ' + url.pathname);
      return { status: 200, text: async () => JSON.stringify(body) };
    },
  });
  new Script(client).runInContext(context);
  await new Promise((r) => setImmediate(r));
  assert.equal(timers.size, 1, 'heartbeat scheduled while payload is awaiting the host');
  const pulse = [...timers.values()][0]!;
  // Thirteen scheduled intervals represent 130 seconds of host execution.
  for (let i = 0; i < 13; i++) await pulse();
  assert.equal(pulses.length, 13);
  for (const [key, value] of Object.entries({ step: 'slow', generation: 'G', stepToken: 'T' }))
    assert.equal(pulses[0]!.searchParams.get(key), value);
  assert.ok(pulses[0]!.searchParams.get('client'));
  finish();
  await closed;
  // Invoke a callback already queued before cancellation: it must send nothing.
  await pulse();
  assert.equal(pulses.length, 13);
  assert.equal(records, 1);
});
