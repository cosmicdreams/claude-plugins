import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Spec } from '../../src/generated/spec.ts';
import { LookupError, at, lastOf, pick, required } from '../../src/lookup.ts';
import { GeometryError, Merge, build } from '../../src/responsive.ts';

const spec = (): Spec =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/sponsor-logo.spec.json'), 'utf8')) as Spec;

test('checked lookups name what was missing', () => {
  assert.equal(at(['a', 'b'], 1, 'letters'), 'b');
  assert.throws(
    () => at(['a'], 3, 'letters'),
    (e: Error) => e instanceof LookupError && e.message === 'letters: no entry 3 in 1',
  );
  assert.throws(() => lastOf([], 'row'), /row: empty/);
  assert.throws(() => pick({ a: 1 }, 'b', 'widths'), /widths: no entry "b"/);
  assert.equal(pick({ a: 0 }, 'a', 'widths'), 0);
  assert.throws(() => required(null, 'the page id'), /the page id is missing/);
  assert.equal(required(0, 'zero'), 0);
});

test('a missing measured node reports its breakpoint and path', () => {
  const merge = new Merge(spec(), 'Logo', 'logo');
  const bp = merge.bps[0]!;
  assert.throws(
    () => merge.nodeAt(bp, 'html[0]/nowhere[9]'),
    (e: Error) =>
      e instanceof GeometryError &&
      e.breakpoint === bp &&
      e.path === 'html[0]/nowhere[9]' &&
      e.message.includes('html[0]/nowhere[9]') &&
      e.message.includes(bp),
  );
  assert.equal(merge.maybeNode(bp, 'html[0]/nowhere[9]'), undefined);
  assert.throws(() => merge.table('watch'), /measured nodes: no entry "watch"/);
  assert.throws(() => merge.refBp('html[0]/nowhere[9]'), /visible in none of the measured breakpoints/);
});

test('a spec without a machine name is rejected with the component named', () => {
  const broken = spec();
  broken.machineName = null;
  assert.throws(
    () => build(broken, 'Logo'),
    (e: Error) => e instanceof GeometryError && e.message.includes(broken.component),
  );
});
