import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import * as sdc from '../../src/extract-sdc.ts';
import { pyJson } from './python-oracle.ts';

// Enum values as the Python extractor sees them: str(v).replace('_', ' ').replace('-', ' ').title().
const VALUES: unknown[] = [
  'éclair', 'ÉCLAIR', '123abc', 'don\'t', 'o\'neil', 'hyphen-case', 'snake_case-mix', 'ça va', 'émile zola',
  'ΟΔΟΣ', 'ΑΣ', 'ΣΑΣ', 'ΑΣ-ΒΣ', 'Σ', 'straße', 'ǆemal', 'ŉa', 'Ǉljubljana', 'x y  z', '1st place', 'ab3cd', '', 'already Title',
  null, true, false, 1.5, 'a-', '-a', 'ÿes',
];

test('pyTitle matches Python str.title() for accented, digit-prefixed, apostrophe and hyphenated text', () => {
  const expected = pyJson<string[]>(`print(json.dumps([str(v).title() for v in _input['values']]))`, { values: VALUES.filter((v) => typeof v === 'string') });
  const strings = VALUES.filter((v): v is string => typeof v === 'string');
  assert.deepEqual(strings.map(sdc.pyTitle), expected);
});

test('option labels follow Python label normalisation before title casing', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'design-lab-title-'));
  try {
    const path = resolve(dir, 'component.yml');
    writeFileSync(path, `props:\n  properties:\n    flavour:\n      type: string\n      enum: ${JSON.stringify(VALUES)}\n`);
    const expected = pyJson<string[]>(
      `print(json.dumps([str(v).replace('_', ' ').replace('-', ' ').title() for v in _input['values']]))`,
      { values: VALUES },
    );
    const field = sdc.extractComponent(path, dir).fields.find((f: { name: string }) => f.name === 'flavour');
    assert.deepEqual(field.options.map((o: { label: string }) => o.label), expected);
    assert.equal(field.options[0].value, 'éclair');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit spot checks from the report: éclair, 123abc, don\'t, hyphen-case', () => {
  assert.equal(sdc.pyTitle('éclair'), 'Éclair');
  assert.equal(sdc.pyTitle('123abc'), '123Abc');
  assert.equal(sdc.pyTitle("don't"), "Don'T");
  assert.equal(sdc.pyTitle('hyphen case'), 'Hyphen Case');
});
