import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { stripTemplate } from '../../src/render-payload.ts';
import { pluginRoot } from '../../src/runtime.ts';
import { validate, validateRunnerRecord } from '../../src/contracts.ts';
import type { RunnerStep } from '../../src/generated/runner-step.ts';

void test(
  'the actual runner sends conforming queries, results and errors for every wire operation',
  { timeout: 5000 },
  async () => {
    const base: RunnerStep[] = [
      { kind: 'use_figma', step: 'build', code: "return {componentId:'1:1',created:1};" },
      { kind: 'dump', step: 'verify:root', code: 'return {pages:[],collections:[]};' },
      {
        kind: 'check',
        step: 'preflight',
        code: "return {fileKey:'fake',fileName:'Test',pages:0,empty:true,preflightCover:false,fonts:{}};",
      },
      { kind: 'skip', step: 'skip', reason: 'no images' },
      {
        kind: 'upload',
        step: 'images',
        nodeIds: ['image'],
        files: [{ file: '/tmp/fake.png', contentType: 'image/png' }],
        scaleMode: 'FILL',
      },
      { kind: 'screenshot', step: 'compare', nodeId: 'image', out: '/tmp/compare.png' },
      {
        kind: 'upload',
        step: 'failed-image',
        nodeIds: ['missing'],
        files: [{ file: '/tmp/missing.png', contentType: 'image/png' }],
        scaleMode: 'FILL',
      },
    ];
    const steps = base.map((step) => ({ ...step, generation: 'generation', stepToken: 'token' }));
    const kinds: string[] = [],
      errors: unknown[] = [],
      queries: string[] = [];
    let current: RunnerStep | undefined;
    let done!: (value: string) => void;
    const closed = new Promise<string>((resolve) => {
      done = resolve;
    });
    const image = { fills: [], exportAsync: async () => new Uint8Array([1, 2, 3]) };
    const context = createContext({
      setTimeout,
      clearTimeout,
      figma: {
        fileKey: 'fake',
        ui: { postMessage() {} },
        showUI() {},
        closePlugin: done,
        clientStorage: { getAsync: async () => 'saved' },
        getNodeByIdAsync: async (id: string) => (id === 'image' ? image : null),
        createImage: () => ({ hash: 'image-hash' }),
        base64Encode: () => 'AQID',
      },
      fetch: async (value: string, init?: { body?: string }) => {
        const url = new URL(value),
          path = url.pathname;
        assert.deepEqual(validate('runner-request', Object.fromEntries(url.searchParams)), []);
        queries.push(path);
        let response: unknown;
        if (path === '/next') {
          current = steps.shift();
          response = current ?? { kind: 'done' };
          assert.deepEqual(validate('runner-step', response), []);
        } else if (path === '/file') return { status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
        else if (path === '/record') {
          const body = JSON.parse(init!.body!) as { result: unknown };
          assert.ok(current && current.kind !== 'wait' && current.kind !== 'done');
          assert.deepEqual(validateRunnerRecord(current.kind, body.result), []);
          kinds.push(current.kind);
          response = { recorded: current.step };
          assert.deepEqual(validate('runner-record-response', response), []);
        } else if (path === '/error') {
          const error: unknown = JSON.parse(init!.body!);
          assert.deepEqual(validate('runner-error', error), []);
          errors.push(error);
          response = {};
          assert.deepEqual(validate('runner-error-response', response), []);
        } else throw new Error('unexpected route ' + path);
        return { status: 200, text: async () => JSON.stringify(response) };
      },
    });
    new Script(stripTemplate(readFileSync(resolve(pluginRoot, 'runner/code.ts'), 'utf8'))).runInContext(context);
    assert.equal(await closed, 'design-lab: build complete (6 steps this session)');
    assert.deepEqual(kinds, ['use_figma', 'dump', 'check', 'skip', 'upload', 'screenshot']);
    assert.equal(errors.length, 1);
    assert.ok(queries.includes('/file'));
    assert.ok(queries.includes('/error'));
  },
);
