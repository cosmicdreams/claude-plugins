import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, validateRunnerRecord } from '../../src/contracts.ts';
import type { TreeNode } from '../../src/generated/tree.ts';
const root = { component: 'card', machineName: 'card', label: 'Card', measured: [], modes: [], fallbacks: [], notes: [], widths: {}, variables: {} };
const node = { kind: 'frame', name: 'Card', source: '/card', sizing: 'FIXED' };
test('runner records cannot use a permissive branch to evade specialized validation', () => {
  for (const bad of [{ pgn: 'base64' }, { page: 42, pageIndex: 'bad', nodes: 'oops', _ids: false }]) {
    assert.ok(validate('runner-record', bad).length);
    for (const kind of ['use_figma', 'screenshot', 'dump', 'check', 'skip', 'upload'] as const) assert.ok(validateRunnerRecord(kind, bad).length);
  }
  assert.deepEqual(validateRunnerRecord('screenshot', { png: 'abc' }), []);
  assert.deepEqual(validateRunnerRecord('skip', {}), []);
  assert.deepEqual(validateRunnerRecord('upload', { statuses: [200, 0] }), []);
  assert.deepEqual(validateRunnerRecord('use_figma', { componentId: '1:1', images: [], created: 1 }), []);
  for (const [kind, body] of [['screenshot', {}], ['skip', { png: 'abc' }], ['upload', { componentId: '1:1' }], ['use_figma', { png: 'abc' }], ['use_figma', {}], ['check', { rootId: '1:1' }], ['dump', { rootId: '1:1' }]] as const) assert.ok(validateRunnerRecord(kind, body).length);
});
test('each dump and preflight contract is selected by the expected operation', () => {
  const check = { fileKey: 'test', fileName: 'Test', pages: 0, empty: true, preflightCover: false, fonts: { Inter: ['Regular'] } };
  const tree = { page: 'Cover', pageIndex: 0, nodes: [], _ids: { page: '0:1', nodes: {} } };
  const page = { page: { id: '0:1', name: 'Cover', children: 0 }, components: [], cards: [], breakpointFrames: [], exampleInvalidNodes: [], breakpointCollection: null };
  const getting = { gettingStarted: { sections: [], indexRowCount: null, knownGapsText: null, thresholdsText: null, indexHeadings: [], indexNodeLinks: [] } };
  assert.deepEqual(validateRunnerRecord('check', check), []);
  assert.deepEqual(validateRunnerRecord('dump', { pages: [{ id: '0:1', name: 'Cover' }], collections: [] }), []);
  assert.deepEqual(validateRunnerRecord('dump', tree, 'tree'), []);
  assert.deepEqual(validateRunnerRecord('dump', page, 'page'), []);
  assert.deepEqual(validateRunnerRecord('dump', getting, 'getting-started'), []);
  assert.ok(validateRunnerRecord('dump', check).length);
  assert.ok(validateRunnerRecord('check', tree).length);
  assert.ok(validateRunnerRecord('dump', tree, 'page').length);
});
test('tree node discriminators require their payloads, including nested and alternate nodes', () => {
  for (const [kind, field, payload] of [['text', 'text', { characters: 'Hello', family: 'Inter', size: 16, weight: 400 }], ['image', 'src', '/a.png'], ['svg', 'svg', '<svg/>'], ['instance', 'instanceOf', 'card']] as const) {
    const child = { ...node, kind, [field]: payload };
    assert.deepEqual(validate('tree', { ...root, tree: child }), []);
    assert.ok(validate('tree', { ...root, tree: { ...node, kind } }).length);
    assert.ok(validate('tree', { ...root, tree: { ...node, children: [{ ...node, kind }] } }).length);
    assert.ok(validate('tree', { ...root, tree: node, alternates: [{ label: 'Alternate', variables: {}, tree: { ...node, kind } }] }).length);
  }
  // Historical automatic text labels omit measured dimensions. Frames with instanceOf
  // keep their measured fallback tree instead of being forced to change discriminator.
  assert.deepEqual(validate('tree', { ...root, tree: { ...node, instanceOf: 'child' } }), []);
});
test('every directly assigned tree enum rejects unknown values', () => {
  for (const invalid of [{ sizing: 'TYPO' }, { fit: 'TYPO' }, { layout: { mode: 'TYPO' } }, { layout: { mode: 'HORIZONTAL', primaryAlign: 'TYPO' } }, { layout: { mode: 'VERTICAL', counterAlign: 'TYPO' } }, { effects: [{ type: 'TYPO', color: { hex: '#fff' }, x: 0, y: 0, blur: 0, spread: 0 }] }]) assert.ok(validate('tree', { ...root, tree: { ...node, ...invalid } }).length);
  for (const field of ['align', 'case']) assert.ok(validate('tree', { ...root, tree: { ...node, kind: 'text', text: { characters: 'x', family: 'Inter', weight: 400, size: 12, [field]: 'TYPO' } } }).length);
});
function narrowing(value: TreeNode): void {
  if (value.kind === 'text') { const characters: string = value.text.characters; void characters; }
  // @ts-expect-error text nodes require text
  const invalid: TreeNode = { kind: 'text', name: 'x', source: '/x', sizing: 'FIXED' };
  // @ts-expect-error Figma layout enums are constrained
  const mode: TreeNode = { kind: 'frame', name: 'x', source: '/x', sizing: 'FIXED', layout: { mode: 'TYPO' } };
  void invalid; void mode;
}
void narrowing;
