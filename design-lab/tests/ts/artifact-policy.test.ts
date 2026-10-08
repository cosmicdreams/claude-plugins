import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../../src/contracts.ts';
const fixture = (kind: string) => JSON.parse(readFileSync(new URL(`./fixtures/${kind}.json`, import.meta.url), 'utf8'));
void test('duplicate component identities fail even when the serialized rows differ', () => {
  const doc = fixture('components');
  doc.components = [doc.components[0], { ...doc.components[0], label: 'different label' }];
  assert.ok(validate('components', doc).some((e) => e.includes('duplicate id')));
});
void test('published capture documentation never links to a local DDEV hostname', () => {
  const doc = fixture('capture-evidence'),
    item = Object.values(doc.captures)[0] as { linkUrl?: string };
  item.linkUrl = 'https://fixture.ddev.site/example';
  assert.ok(validate('capture-evidence', doc).some((e) => e.includes('DDEV')));
});
void test('accepted build receipts require comparison evidence, native components and all breakpoints', () => {
  const doc = fixture('build-record');
  const a = structuredClone(doc);
  delete a.visualEvidence;
  assert.ok(validate('build-record', a).length);
  const b = structuredClone(doc);
  b.nativeComponent.nodeType = 'FRAME';
  b.nativeComponent.rootHasImageFill = true;
  assert.ok(validate('build-record', b).length);
  const c = structuredClone(doc);
  delete c.visualEvidence.breakpoints.tablet;
  assert.ok(validate('build-record', c).length);
  const d = structuredClone(doc);
  d.visualEvidence.comparison.verdict = 'pass';
  d.visualEvidence.comparison.breakpoints.mobile = 'fail';
  assert.ok(validate('build-record', d).some((e) => e.includes('all three')));
});
