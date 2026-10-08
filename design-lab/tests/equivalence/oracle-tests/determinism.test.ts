import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { hashLayout } from '../../../src/determinism.ts';
import { pyJson } from './python-oracle.ts';

// Each case is raw JSON text, so -0, -0.0, 1e400 and emoji keys reach both parsers unchanged.
// Expected values come from scripts/determinism.py run on the same text.
const PY = `
import json
from determinism import canonical_hash
results = {}
for name, text in _input['cases'].items():
    try:
        results[name] = {'hash': canonical_hash(json.loads(text))}
    except Exception as error:
        results[name] = {'error': type(error).__name__, 'message': str(error)}
print(json.dumps(results))
`;

function tsHash(name: string, text: string): { hash?: string; error?: string } {
  const dir = mkdtempSync(resolve(tmpdir(), 'design-lab-determinism-'));
  try {
    const path = resolve(dir, `${name}.json`);
    writeFileSync(path, text);
    return { hash: hashLayout(path) };
  } catch (error) {
    return { error: (error as Error).message };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CASES: Record<string, string> = {
  integerNegativeZero: '{"a":-0}',
  integerZero: '{"a":0}',
  floatNegativeZero: '{"a":-0.0}',
  floatsAndExponents: '{"a":1e16,"b":1.0,"c":0.0001,"d":1e-5,"e":1.5e300}',
  bigInteger: '{"a":12345678901234567890123}',
  keysEmojiAndReplacement: '{"\\uFFFD":1,"\\ud83d\\ude00":2,"":3,"z":4}',
  keysRawEmoji: '{"😀":1,"�":2,"":3,"Z":4,"é":5}',
  overflowPositive: '{"x":1e400}',
  overflowNegative: '{"x":-1e400}',
  overflowNested: '{"list":[{"deep":[1e400]}]}',
  overflowInIgnoredKey: '{"generatedAt":1e400,"x":1}',
  nanLiteral: '{"x":NaN}',
};
const REFERENCE = pyJson<Record<string, { hash?: string; error?: string; message?: string }>>(PY, { cases: CASES });

function assertSameHash(name: string): void {
  const expected = REFERENCE[name]!;
  assert.ok(expected.hash !== undefined, `Python must accept ${name}`);
  assert.equal(tsHash(name, CASES[name]!).hash, expected.hash, `${name}: canonical hash differs from Python`);
}

void test('integer -0 hashes like integer 0 in the Python reference and in TypeScript', () => {
  assert.equal(REFERENCE['integerNegativeZero']!.hash, REFERENCE['integerZero']!.hash);
  assertSameHash('integerNegativeZero');
});

void test('float -0.0 keeps its sign, and its hash differs from integer 0', () => {
  assertSameHash('floatNegativeZero');
  assert.notEqual(tsHash('f', CASES['floatNegativeZero']!).hash, tsHash('i', CASES['integerZero']!).hash);
});

void test('object keys sort by code point, so U+FFFD precedes an emoji and "" sorts first', () => {
  assertSameHash('keysEmojiAndReplacement');
  assertSameHash('keysRawEmoji');
});

void test('floats, exponents and big integers keep their Python canonical form', () => {
  assertSameHash('floatsAndExponents');
  assertSameHash('bigInteger');
});

void test('out-of-range floats are rejected with the Python error message, including nested values', () => {
  for (const name of ['overflowPositive', 'overflowNegative', 'overflowNested']) {
    const expected = REFERENCE[name]!;
    assert.match(expected.message ?? '', /Out of range float values are not JSON compliant/, name);
    const actual = tsHash(name, CASES[name]!);
    assert.equal(actual.hash, undefined, `${name} must be rejected`);
    assert.equal(actual.error, expected.message, `${name}: error text differs from Python`);
  }
});

void test('an out-of-range float under an ignored key is accepted, as Python drops that key first', () => {
  assert.equal(REFERENCE['overflowInIgnoredKey']!.hash !== undefined, true);
  assertSameHash('overflowInIgnoredKey');
});

void test('NaN literals are rejected by both implementations', () => {
  assert.notEqual(REFERENCE['nanLiteral']!.error, undefined);
  assert.notEqual(tsHash('nan', CASES['nanLiteral']!).error, undefined);
});
