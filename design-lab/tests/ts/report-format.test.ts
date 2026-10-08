import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pyStr,
  fixed,
  floatString,
  sixDigits,
  esc,
  num,
  pct,
  duration,
  splitDuration,
  day,
  compact,
  compareKeys,
  sortedBy,
  own,
} from '../../src/report-format.ts';
void test('scalars print as the baseline printed them', () => {
  assert.equal(pyStr(null), 'None');
  assert.equal(pyStr(undefined), 'None');
  assert.equal(pyStr(true), 'True');
  assert.equal(pyStr(false), 'False');
  assert.equal(pyStr(2.5), '2.5');
  assert.equal(pyStr(''), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
  assert.equal(esc(`<'&">`), '&lt;&#x27;&amp;&quot;&gt;');
});
void test('fixed point rounds the exact binary value with even ties', () => {
  assert.equal(fixed(0.125, 2), '0.12');
  assert.equal(fixed(0.375, 2), '0.38');
  assert.equal(fixed(2.675, 2), '2.67');
  assert.equal(fixed(2.5, 0), '2');
  assert.equal(fixed(3.5, 0), '4');
  assert.equal(fixed(-0, 1), '-0.0');
  assert.equal(fixed(Number.NaN, 1), 'NaN');
  assert.equal(fixed(1e-7, 3), '0.000');
  assert.equal(floatString(19), '19.0');
  assert.equal(floatString(19.5), '19.5');
  assert.equal(sixDigits(12.5), '12.5');
  assert.equal(sixDigits(1234567), '1234570');
});
void test('counts, shares, durations and dates keep the report formats', () => {
  assert.equal(num(1234567), '1,234,567');
  assert.equal(num(1234.25), '1,234.2');
  assert.equal(num(null), '–');
  assert.equal(pct(0.1234, 1), '12.3%');
  assert.equal(pct(undefined), '–');
  assert.equal(duration(89.9), '89 s');
  assert.equal(duration(90), '1 min 30 s');
  assert.equal(duration(120), '2 min');
  assert.equal(duration(7290), '2 h 2 min');
  assert.deepEqual(splitDuration(89.5), ['1', ' min 30 s']);
  assert.deepEqual(splitDuration(45), ['45', ' s']);
  assert.equal(day('2026-02-29T00:00:00Z'), '29 February 2026');
  assert.equal(day('not a date'), 'date not recorded');
  assert.equal(compact(999), '999');
  assert.equal(compact(1500), '1.5k');
  assert.equal(compact(25_000_000), '25M');
});
void test('sort keys order like tuples, and record lookups ignore inherited properties', () => {
  assert.equal(compareKeys([1, [true, false], 0.5], [1, [true, true], 0.1]), -1);
  assert.equal(compareKeys([1], [1, 0]), -1);
  assert.equal(compareKeys('b', 'a'), 1);
  assert.deepEqual(
    sortedBy(
      [
        { k: 2, n: 'a' },
        { k: 1, n: 'b' },
        { k: 2, n: 'c' },
      ],
      (x) => x.k,
    ).map((x) => x.n),
    ['b', 'a', 'c'],
  );
  assert.equal(own({ a: 'x' }, 'a'), 'x');
  assert.equal(own({ a: 'x' }, 'toString'), undefined);
  assert.equal(own({ undefined: 'u' }, undefined), 'u');
});
