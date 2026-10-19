// Digests over real files (plan §4): evidence binds to inputs only. Editing what a test can assert through
// moves exactly the right digest; writing outputs moves none; what the scan can't follow leaves the test
// unresolved rather than shrinking the digest.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';

import { scanFile } from '../../src/imports.ts';
import type { BeginRecord } from '../../kit/records.ts';
import { behaviorKey, computeDigests, type DigestContext, type DigestReport } from '../../src/digest.ts';
import type { CaseRecord, DeclaredInput } from '../../src/model.ts';
import { Ledger, caseRecord, project, tmp } from './support.ts';

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

const FILES: Record<string, string> = {
  'package-lock.json': '{"lockfileVersion":3}',
  'support/test-lab/records.ts': 'export const KIT = 1;',
  'playwright.config.ts': "import { defineConfig } from '@playwright/test';\nimport { appearance } from './support/appearance';\nexport default defineConfig({ use: appearance() });\n",
  'support/appearance.ts': "export const appearance = () => ({ colorScheme: 'light' as const });\n",
  'pages/accordion.ts': "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nexport const css = () => readFileSync(join(__dirname, '../theme/accordion.css'), 'utf8');\n",
  'theme/accordion.css': '.title { font-family: Georgia; }\n',
  'tests/accordion.spec.ts': "import { test } from '@playwright/test';\nimport { css } from '../pages/accordion';\ntest('a', async () => { css(); });\n",
  'tests/home.spec.ts': "import { test } from '@playwright/test';\ntest('h', async () => {});\n",
  'node_modules/@playwright/test/package.json': '{"name":"@playwright/test"}',
};

type Setup = { root: string; ctx: DigestContext; digests: () => DigestReport };

function setup(options: { declared?: DeclaredInput[]; extra?: Record<string, string>; use?: Record<string, unknown>; cases?: CaseRecord[] } = {}): Setup {
  const root = tmp('test-lab-digest-');
  write(root, { ...FILES, ...options.extra });
  const ledger = new Ledger();
  ledger.projects = [project('desktop', { testDir: join(root, 'tests'), snapshotDir: join(root, 'tests'), outputDir: join(root, 'test-results'), use: { browserName: 'chromium', headless: true, ...options.use } })];
  ledger.test('a', { file: 'tests/accordion.spec.ts', titlePath: ['a'], cases: ['C1'] }).test('h', { file: 'tests/home.spec.ts', titlePath: ['h'] });
  const begin: BeginRecord = { ...ledger.begin(), rootDir: root, configFile: join(root, 'playwright.config.ts') };
  const cases = new Map((options.cases ?? [caseRecord('C1', 'regression')]).map((c) => [c.id, c]));
  const ctx: DigestContext = {
    suite: 'e2e',
    suiteRoot: root,
    begin,
    cases,
    ledger: [],
    declaredInputs: options.declared ?? [{ reader: 'pages/accordion.ts', paths: ['theme/**/*.css'], read: 0 }],
    declaredBaselines: [],
    kitDir: join(root, 'support/test-lab'),
  };
  return { root, ctx, digests: () => computeDigests(ctx) };
}

const ACC = behaviorKey({suite:'e2e', file:'tests/accordion.spec.ts', titlePath:['a']}, 'desktop');
const HOME = behaviorKey({suite:'e2e', file:'tests/home.spec.ts', titlePath:['h']}, 'desktop');
const digestOf = (r: DigestReport, key: string) => {
  const d = r.behavior.get(key);
  assert.ok(d !== undefined && d.status === 'resolved', JSON.stringify(d));
  return d.digest;
};

describe('the behavior digest moves with what a test can assert through', () => {
  test('both tests resolve, and the declared stylesheet is an input of the accordion test only', () => {
    const s = setup();
    const r = s.digests();
    digestOf(r, ACC);
    digestOf(r, HOME);
    const acc = r.behavior.get(ACC);
    assert.ok(acc?.status === 'resolved' && acc.inputs.some((i) => i.path === 'theme/accordion.css'));
  });

  test('a helper weakened after acceptance moves the digest of the tests importing it only', () => {
    const s = setup();
    const before = s.digests();
    write(s.root, { 'pages/accordion.ts': "export const css = () => '.title { font-family: Georgia; }';\n" });
    const after = s.digests();
    assert.notEqual(digestOf(before, ACC), digestOf(after, ACC));
    assert.equal(digestOf(before, HOME), digestOf(after, HOME));
  });

  test('a theme stylesheet read from disk changed after acceptance moves the reader\'s digest', () => {
    const s = setup();
    const before = digestOf(s.digests(), ACC);
    write(s.root, { 'theme/accordion.css': '.title { font-family: Arial; }\n' });
    assert.notEqual(before, digestOf(s.digests(), ACC));
  });

  test('a helper loaded only by the config moves every test\'s digest', () => {
    const s = setup();
    const before = s.digests();
    write(s.root, { 'support/appearance.ts': "export const appearance = () => ({ colorScheme: 'dark' as const });\n" });
    const after = s.digests();
    assert.notEqual(digestOf(before, ACC), digestOf(after, ACC));
    assert.notEqual(digestOf(before, HOME), digestOf(after, HOME));
  });

  test('a fixture option value moves the digest; the base URL does not', () => {
    const a = setup({ use: { accordionVariant: 'compact' } });
    const b = setup({ use: { accordionVariant: 'wide' } });
    const c = setup({ use: { accordionVariant: 'compact', baseURL: 'http://elsewhere' } });
    // Different temporary folders hash the same relative inputs, so the digests are comparable.
    assert.notEqual(digestOf(a.digests(), HOME), digestOf(b.digests(), HOME));
    assert.equal(digestOf(a.digests(), HOME), digestOf(c.digests(), HOME));
  });

  test('editing the bound case\'s content moves the digest; an unbound test is unaffected', () => {
    const s = setup();
    const before = s.digests();
    const edited = caseRecord('C1', 'regression');
    s.ctx.cases = new Map([['C1', { ...edited, preconditions: 'A different precondition.' }]]);
    const after = s.digests();
    assert.notEqual(digestOf(before, ACC), digestOf(after, ACC));
    assert.equal(digestOf(before, HOME), digestOf(after, HOME));
  });

  test('a mutation recipe is not a behavior input: adding one leaves the digest (each red check binds its own recipe)', () => {
    const s = setup();
    const before = digestOf(s.digests(), ACC);
    write(s.root, { [`.test-lab/recipes/${'a'.repeat(64)}.json`]: '{"format":1,"test":{"suite":"e2e","file":"tests/accordion.spec.ts","titlePath":["a"]}}' });
    assert.equal(before, digestOf(s.digests(), ACC));
  });
});

describe('outputs are never inputs', () => {
  test('writing results, evidence, an acceptance and reports moves no digest', () => {
    const s = setup();
    const before = s.digests();
    write(s.root, {
      '.test-lab/evidence/acc-C1.json': '{"kind":"acceptance"}',
      '.test-lab/ledger.json': '[]',
      '.test-lab/runs/r1/steps.jsonl': '{}\n',
      'test-results/a/trace.zip': 'zip',
      'playwright-report/index.html': '<html>',
      '.auth/editor.json': '{"cookies":[]}',
    });
    const after = s.digests();
    assert.equal(digestOf(before, ACC), digestOf(after, ACC));
    assert.equal(digestOf(before, HOME), digestOf(after, HOME));
    assert.deepEqual(before.toolchain, after.toolchain);
  });

  test('a new spec written beside a verified test leaves its digest alone', () => {
    const s = setup();
    const before = digestOf(s.digests(), ACC);
    write(s.root, { 'tests/new.spec.ts': "import { test } from '@playwright/test';\ntest('n', async () => {});\n" });
    assert.equal(before, digestOf(s.digests(), ACC));
  });
});

describe('the digest never shrinks to what it could see', () => {
  test('an undeclared filesystem read leaves the test unresolved', () => {
    const s = setup({ declared: [] });
    const acc = s.digests().behavior.get(ACC);
    assert.equal(acc?.status, 'unresolved');
    assert.match(acc?.status === 'unresolved' ? acc.reasons.join(' ') : '', /readFileSync\(\) reads a computed path|not a declared input/);
    assert.equal(s.digests().behavior.get(HOME)?.status, 'resolved');
  });

  test('a dynamic import of a computed path leaves the test unresolved', () => {
    const s = setup({ extra: { 'tests/home.spec.ts': "import { test } from '@playwright/test';\nconst name = 'x';\ntest('h', async () => { await import(`./${name}`); });\n" } });
    const home = s.digests().behavior.get(HOME);
    assert.equal(home?.status, 'unresolved');
  });

  test('an import that resolves to nothing leaves the test unresolved', () => {
    const s = setup({ extra: { 'tests/home.spec.ts': "import { test } from '@playwright/test';\nimport { gone } from '../pages/gone';\ntest('h', async () => { gone(); });\n" } });
    assert.equal(s.digests().behavior.get(HOME)?.status, 'unresolved');
  });
});

describe('the toolchain digest', () => {
  test('a lockfile change moves the toolchain digest and no behavior digest', () => {
    const s = setup();
    const before = s.digests();
    write(s.root, { 'package-lock.json': '{"lockfileVersion":3,"packages":{"x":{}}}' });
    const after = s.digests();
    assert.notDeepEqual(before.toolchain, after.toolchain);
    assert.equal(digestOf(before, ACC), digestOf(after, ACC));
  });

  test('workers and timeouts move the toolchain digest only', () => {
    const s = setup();
    const before = s.digests();
    s.ctx.begin = { ...s.ctx.begin, workers: 4 };
    const after = s.digests();
    assert.notDeepEqual(before.toolchain, after.toolchain);
    assert.equal(digestOf(before, HOME), digestOf(after, HOME));
  });

  test('a suite without the kit has no toolchain digest', () => {
    const s = setup();
    s.ctx.kitDir = join(s.root, 'support/nowhere');
    assert.equal(s.digests().toolchain.status, 'unresolved');
  });
});

// Review R1 finding 2: declarations authorize each static read for this reader only.
test('R1-2 one declared input does not hide an undeclared second read', () => {
  const s = setup({ extra: {
    'pages/accordion.ts': "import { readFileSync } from 'node:fs'; readFileSync('theme/accordion.css'); readFileSync('hidden.txt');",
    'hidden.txt': 'assertion input',
  } });
  const d = s.digests().behavior.get(ACC);
  assert.equal(d?.status, 'unresolved');
  assert.match(d?.status === 'unresolved' ? d.reasons.join(' ') : '', /hidden.txt.*not a declared input/);
  write(s.root, { 'hidden.txt': 'changed assertion input' });
  assert.equal(s.digests().behavior.get(ACC)?.status, 'unresolved');
});

test('R1-2 destructured CommonJS fs reads participate in the manifest', () => {
  assert.equal(scanFile('/suite/a.js', "const {readFileSync: read}=require('node:fs'); read('hidden.txt');", '/suite').reads.length, 1);
  const s = setup({ extra: {
    'pages/accordion.ts': "const {readFileSync: read}=require('node:fs'); export const css=()=>read('theme/accordion.css');",
  } });
  const before = digestOf(s.digests(), ACC);
  write(s.root, { 'theme/accordion.css': 'changed' });
  assert.notEqual(digestOf(s.digests(), ACC), before);
});

test('R1-2 a reader declaration does not exempt multiple computed reads', () => {
  const s=setup({extra:{'pages/accordion.ts': "import {readFileSync} from 'node:fs'; export const css=(a,b)=>{readFileSync(a);readFileSync(b);};"}});
  assert.equal(s.digests().behavior.get(ACC)?.status,'unresolved');
});

test('R1-2 computed-read declarations bind each call independently, including two on one line', () => {
  const s=setup({declared:[{reader:'pages/accordion.ts',paths:['theme/accordion.css'],read:0}],extra:{'pages/accordion.ts': "import {readFileSync} from 'node:fs'; export const css=(a,b)=>{readFileSync(a);readFileSync(b);};",'hidden.txt':'hidden'}});
  assert.equal(s.digests().behavior.get(ACC)?.status,'unresolved');
  s.ctx.declaredInputs.push({reader:'pages/accordion.ts',paths:['hidden.txt'],read:1});
  const before=digestOf(s.digests(),ACC);
  write(s.root,{'hidden.txt':'changed'});
  assert.notEqual(digestOf(s.digests(),ACC),before);
});
