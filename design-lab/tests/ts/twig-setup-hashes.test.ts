import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CaptureConfig } from '../../src/capture/types.ts';
import { configHash, legacyHash } from '../../src/capture/run.ts';
import { ownScript } from '../../src/capture/scaffold.ts';
import { legacyOwnScript } from '../../src/capture/twig-legacy.ts';

// Recorded from the scaffold before its browser scripts became typed functions: the sha-256 of the
// baseline setup text and the three hashes a capture record could carry for that configuration.
interface Golden { id: string; kind: string | null; selector: string; children: string[]; setupSha256: string; configHash: string; legacyHash: string; legacyHashScale2: string }
const golden = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/twig-setup-hashes.json'), 'utf8')) as Golden[];
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const configFor = (g: Golden, setup: string): CaptureConfig => ({
  component: g.id, componentId: g.id, machineName: 'm', path: '/p', verificationUrl: 'http://x/p', linkUrl: 'http://y/p', rootSelector: g.selector, nth: 0,
  states: [{ name: 'default', setup, setupKey: { own: g.kind === 'template' ? 'template' : 'reveal', children: g.children.filter(c => c.includes(':') && !c.startsWith('sdc.')) } }],
});

for (const g of golden) test(`scaffolded setup keeps its stored capture hashes: ${g.id}`, () => {
  const own = g.kind === 'template' ? 'template' : 'reveal';
  assert.equal(sha(legacyOwnScript(g.id, own, g.selector, g.children)), g.setupSha256, 'frozen baseline text');
  const cfg = configFor(g, ownScript(g.id, g.kind ?? undefined, g.selector, g.children));
  assert.equal(configHash(cfg, 1), g.configHash);
  assert.equal(legacyHash(cfg, 1), g.legacyHash);
  assert.equal(legacyHash(cfg, 2), g.legacyHashScale2);
  // A configuration saved by an earlier version already holds the baseline text: it hashes as it did.
  assert.equal(legacyHash(configFor(g, legacyOwnScript(g.id, own, g.selector, g.children)), 1), g.legacyHash);
});

test('the browser runs typed functions, not the baseline text', () => {
  const g = golden[1]!;
  const setup = ownScript(g.id, g.kind ?? undefined, g.selector, g.children);
  assert.notEqual(sha(setup), g.setupSha256);
  assert.doesNotMatch(setup, /%\(\w+\)s/);
  assert.match(setup, /function tagRenders\(/);
});

test('an edited setup is hashed as written', () => {
  const g = golden[0]!;
  const cfg = configFor(g, '(() => 1)()');
  assert.notEqual(legacyHash(cfg, 1), g.legacyHash);
});
