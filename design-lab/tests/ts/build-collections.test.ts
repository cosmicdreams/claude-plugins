import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { variablesArgs, mediaApplies, expandHex } from '../../src/build-content.ts';
import { writeOnChange } from '../../src/build-artifacts.ts';
import type { VariableCollection } from '../../src/generated/variable-plan.ts';
function plan(t: { after(fn: () => void): void }, collections: Record<string, VariableCollection>) {
  const root = mkdtempSync('/tmp/design-lab-round2-collections-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeOnChange(resolve(root, 'project.json'), { run: { siteLabel: 'Acme' } });
  writeOnChange(resolve(root, 'variable-plan.json'), { collections });
  return variablesArgs(root).collections;
}
for (const [query, width, expected] of [
  ['@media (max-width:600px), (min-width:1200px)', 1400, true],
  ['@media (max-width:600px), (min-width:1200px)', 800, false],
  ['@media (48rem <= width < 64rem)', 800, true],
  ['@media (48rem <= width < 64rem)', 1400, false],
  ['@media screen and (min-width: 40em)', 800, true],
  ['@media print', 800, false],
  ['@media (prefers-color-scheme: dark)', 800, null],
] as const)
  test('width-query semantics: ' + query + ' at ' + width, () => assert.equal(mediaApplies(query, width), expected));
test('cascade keeps source order, independent axes, invariant tokens and aliases', (t) => {
  const modes = ['Value', '@media (min-width: 768px)', '@media (min-width: 1000px)'];
  const out = plan(t, {
    Type: {
      modes,
      variables: [{ name: 'type/size', type: 'FLOAT', valuesByMode: { Value: 12, [modes[1]!]: 20, [modes[2]!]: 28 } }],
    },
    Scheme: {
      modes: ['Value', '@media (prefers-color-scheme: dark)'],
      variables: [
        {
          name: 'color/bg',
          type: 'COLOR',
          valuesByMode: { Value: '#fff', '@media (prefers-color-scheme: dark)': '#000' },
        },
      ],
    },
    Space: {
      modes: ['Value'],
      variables: [
        { name: 'space/base', type: 'FLOAT', valuesByMode: { Value: 8 } },
        { name: 'space/alias', type: 'FLOAT', aliasOf: 'space/base' },
      ],
    },
  });
  assert.deepEqual(out['Acme Core']!.variables.find((v) => v.name === 'type/size')!.valuesByMode, {
    'Desktop 1400px': 28,
    'Tablet 800px': 20,
    'Mobile 375px': 12,
  });
  assert.deepEqual(out['Acme Scheme']!.modes, ['Value', 'Dark']);
  assert.equal(out['Acme Core']!.variables.find((v) => v.name === 'space/alias')!.aliasOf, 'space/base');
});
test('Site Studio ranges cascade down and query-only declarations never write null', (t) => {
  const out = plan(t, {
    Type: {
      modes: ['xl', 'md', 'sm'],
      variables: [{ name: 'type/size', type: 'FLOAT', valuesByMode: { xl: 48, md: 42, sm: 36 } }],
    },
    Only: {
      modes: ['Value', '@media (max-width:600px)'],
      variables: [{ name: 'type/query', type: 'FLOAT', valuesByMode: { '@media (max-width:600px)': 12 } }],
    },
  });
  assert.deepEqual(out['Acme Core']!.variables[0]!.valuesByMode, {
    'Desktop 1400px': 48,
    'Tablet 800px': 42,
    'Mobile 375px': 36,
  });
  assert.deepEqual(Object.values(out['Acme Core']!.variables[1]!.valuesByMode!), [12, 12, 12]);
});
test('mixed axes split by variable, while a variable on both axes preserves its collection', (t) => {
  const width = '@media (min-width:768px)',
    dark = '@media (prefers-color-scheme: dark)',
    modes = ['Value', width, dark];
  const split = plan(t, {
    Mixed: {
      modes,
      variables: [
        { name: 'size', type: 'FLOAT', valuesByMode: { Value: 32, [width]: 48 } },
        { name: 'color', type: 'COLOR', valuesByMode: { Value: '#fff', [dark]: '#000' } },
      ],
    },
  });
  assert.deepEqual(Object.keys(split), ['Acme Core', 'Acme Mixed Dark']);
  assert.equal(split['Acme Core']!.variables[0]!.name, 'size');
  assert.deepEqual(split['Acme Mixed Dark']!.modes, ['Value', 'Dark']);
  const both = plan(t, {
    Mixed: { modes, variables: [{ name: 'size', type: 'FLOAT', valuesByMode: { Value: 1, [width]: 2, [dark]: 3 } }] },
  });
  assert.deepEqual(Object.keys(both), ['Acme Mixed']);
  assert.equal(both['Acme Mixed']!.variables[0]!.valuesByMode!['Dark'], 3);
});
test('independent Core modes survive, duplicate names and generated-name collisions are refused', (t) => {
  const dark = '@media (prefers-color-scheme: dark)',
    col: VariableCollection = {
      modes: ['Value', dark],
      variables: [{ name: 'color', type: 'COLOR', valuesByMode: { Value: '#fff', [dark]: '#000' } }],
    };
  assert.deepEqual(Object.keys(plan(t, { Core: col })), ['Acme Core Dark']);
  assert.throws(() => plan(t, { Core: col, 'Core Dark': col }), /collision/);
  const base: VariableCollection = { modes: ['Value'], variables: [{ name: 'duplicate', type: 'FLOAT' }] };
  assert.throws(() => plan(t, { A: base, B: base }), /duplicate variable name/);
});
test('large consolidation preserves all aliases and rgba/percentage color values', (t) => {
  const out = plan(t, {
    A: {
      modes: ['Value'],
      variables: Array.from({ length: 300 }, (_, i) => ({
        name: 'space/' + i,
        type: 'FLOAT',
        valuesByMode: { Value: i },
        ...(i ? { aliasOf: 'space/0' } : {}),
      })),
    },
  });
  assert.equal(out['Acme Core']!.variables.length, 300);
  assert.equal(out['Acme Core']!.variables[299]!.aliasOf, 'space/0');
  assert.equal(expandHex('rgba(100%, 0%, 50%, .5)'), '#ff007f');
  assert.equal(expandHex('#AbC8'), '#abc8');
});
