import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { scanFile } from '../../src/imports.ts';
import { behaviorKey, computeDigests, type DigestContext } from '../../src/digest.ts';
import { evaluateCase, readLedgerRef } from '../../src/evidence.ts';
import { optionClosureProblems } from '../../kit/option-safety.ts';
import { readInvocation, runStatus } from '../../src/run-observation.ts';
import * as S from './support.ts';

function suite(source: string, helper?: string) {
  const root = S.tmp('r6-inputs-');
  mkdirSync(join(root, 'kit'));
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'kit/kit.ts'), 'export const kit=1;');
  writeFileSync(join(root, 'package-lock.json'), '{}');
  writeFileSync(join(root, S.TEST_A.file), source);
  if (helper !== undefined) writeFileSync(join(root, 'helper.ts'), helper);
  const begin = { ...new S.Ledger().test('t', { file: S.TEST_A.file, titlePath: S.TEST_A.titlePath }).begin(), rootDir: root, configFile: null };
  const ctx: DigestContext = { suite: 'e2e', suiteRoot: root, begin, cases: new Map(), ledger: [], declaredInputs: [], declaredBaselines: [], kitDir: join(root, 'kit') };
  return { root, ctx, digest: () => computeDigests(ctx) };
}

const environmentForms = [
  "const expected=process.env.EXPECTED_FONT;",
  "const p=process;const environment=p['env'];const alias=environment;const expected=alias['EXPECTED_FONT'];",
  "import proc from 'node:process';const {env:environment}=proc;const {EXPECTED_FONT:expected}=environment;",
  "import {env as environment} from 'node:process';const expected=environment.EXPECTED_FONT;",
  "const {env:{EXPECTED_FONT:expected}}=process;",
  "let environment;environment=process.env;const expected=environment.EXPECTED_FONT;",
  "const environment=process.env;const {EXPECTED_FONT:expected='Arial'}=environment;",
  "const environment=process.env;const expected=environment[getName()];",
  "const environment=process.env;const expected=Object.values(environment);",
  "export const environment=process.env;",
  "const environment=process.env;export {environment};",
  "const environment=process.env;const {EXPECTED_FONT:expected,...remaining}=environment;",
  "const environment=require('node:process').env;const expected=environment.EXPECTED_FONT;",
];
for (const source of environmentForms) test(`R6-1 environment behavior stays unresolved through ordinary aliases: ${source}`, () => {
  const s = suite(source);
  const digest = s.digest().behavior.get(behaviorKey(S.TEST_A, 'desktop'));
  assert.equal(digest?.status, 'unresolved');
  assert.ok(digest?.status === 'unresolved' && digest.reasons.some(r => /environment.*invocation/.test(r)), JSON.stringify(digest));
});

test('R6-1 a changed invocation environment cannot retain verified evidence or current acceptance', () => {
  const s = suite("import {expected} from '../helper';const asserted=expected;", 'export const expected=process.env.EXPECTED_FONT;');
  // Receipts/acceptance formerly used the resolved, value-blind digest. Keep those exact claims while
  // evaluating the same files under two invocation values and a disagreeing parent process.
  const initial = s.digest();
  const d = initial.behavior.get(behaviorKey(S.TEST_A, 'desktop'));
  const oldBehavior = d?.status === 'resolved' ? d.digest : 'sha256:pre-r6-value-blind';
  assert.equal(initial.toolchain.status, 'resolved');
  if (initial.toolchain.status !== 'resolved') return;
  const record = S.caseRecord('C1', 'regression', { obligations: ['O1'] });
  const paths = S.writeEvidenceLedgers(s.root, 'C1', S.TEST_A, 'desktop@1440', { obligations: ['O1'] });
  const ref = { case: 'C1', step: 'S1', obligation: 'O1' }, recipesDir = join(s.root, 'recipes');
  const bound = { behaviorDigest: oldBehavior, toolchainDigest: initial.toolchain.digest };
  const records = [S.redCheck(s.root, recipesDir, ref, S.TEST_A, 'desktop@1440', paths, bound), S.burnIn(s.root, S.TEST_A, 'desktop@1440', paths.burn, bound), S.acceptance(record, S.TEST_A, bound)];
  const parent = process.env['EXPECTED_FONT'];
  try {
    for (const invocationValue of [undefined, '', 'Georgia', 'Arial']) {
      if (invocationValue === undefined) delete process.env['EXPECTED_FONT']; else process.env['EXPECTED_FONT'] = invocationValue;
      const report = s.digest();
      const evidence = evaluateCase(record, 'regression', { evidenceDir: s.root, recipesDir, records, digests: report, environment: S.ENVIRONMENT, effective: S.effective(), configurations: S.CONFIGS, ledger: [{ obligation: ref, test: S.TEST_A, configuration: 'desktop@1440', layer: 'served' }], dispositions: [], roles: S.ROLES, materialFields: ['browserName'] });
      assert.equal(evidence.status, 'insufficient', `invocation ${JSON.stringify(invocationValue)} cannot reuse value-blind verification`);
      assert.equal(evidence.mappings[0]?.acceptance, 'stale');
      assert.equal(evidence.mappings[0]?.sensitivity, 'unverified');
      assert.ok(!JSON.stringify(report).includes('Georgia') && !JSON.stringify(report).includes('Arial'));
    }
  } finally { if (parent === undefined) delete process.env['EXPECTED_FONT']; else process.env['EXPECTED_FONT'] = parent; }
});

test('R6-1 environment-dependent globals and setup helpers propagate unresolved inputs', () => {
  for (const entry of ['global', 'setup'] as const) {
    const s = suite('const constant=1;', 'export const expected=process.env.EXPECTED_FONT;');
    if (entry === 'global') s.ctx.begin.globalTeardown = [join(s.root, 'helper.ts')];
    else {
      s.ctx.begin.projects.unshift(S.project('setup'));
      s.ctx.begin.projects.find(p => p.name === 'desktop')!.dependencies = ['setup'];
      s.ctx.begin.tests.push({ ...s.ctx.begin.tests[0]!, testId: 'setup', project: 'setup', file: 'helper.ts' });
    }
    assert.equal(s.digest().behavior.get(behaviorKey(S.TEST_A, 'desktop'))?.status, 'unresolved');
  }
});

test('R6-1 previous safety version cannot certify receipts, but historical failures stay visible', () => {
  const root = S.tmp('r6-old-safety-');
  const l = new S.Ledger().test('t', { file: S.TEST_A.file, titlePath: S.TEST_A.titlePath }).result('t', { status: 'failed', error: 'visible old failure' });
  const records = l.records();
  const begin = records[0]!; assert.equal(begin.type, 'begin'); if (begin.type !== 'begin') return;
  begin.tests[0]!.optionSafety.version = 3;
  writeFileSync(join(root, 'old.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  assert.equal(readLedgerRef(root, S.ledgerRef(root, 'old.jsonl')).ok, false);
  const observation = readInvocation({ id: 'old', suite: 'e2e', dir: root }, join(root, 'old.jsonl'));
  assert.equal(runStatus({ invocations: [observation] }).complete, false);
  assert.equal(observation.tests[0]?.results[0]?.status, 'failed');
});

const erasedForms = [
  "import type {Foo} from './excluded-helper';const value=1;",
  "import type Foo from './excluded-helper';const value=1;",
  "import type * as Foo from './excluded-helper';const value=1;",
  "import {type Foo, type Bar as B} from './excluded-helper';const value=1;",
  "export type {Foo} from './excluded-helper';",
  "export type * from './excluded-helper';",
  "export {type Foo, type Bar as B} from './excluded-helper';",
  "import type Foo = require('./excluded-helper');",
  "import type {Foo} from 'ordinary-external-types';const value=1;",
  "import type {Worker} from 'node:worker_threads';const value=1;",
];
for (const source of erasedForms) test(`R6-2 erased imports/exports do not enter runtime closure: ${source}`, () => {
  const s = suite(source);
  writeFileSync(join(s.root, 'tests/excluded-helper.ts'), 'export const runtime=1;');
  const scan = scanFile(join(s.root, S.TEST_A.file), source, s.root);
  assert.deepEqual(scan.imports, []);
  assert.deepEqual(scan.problems, []);
  assert.deepEqual(optionClosureProblems([join(s.root, S.TEST_A.file)], file => file.endsWith('excluded-helper.ts')), []);
  const before = s.digest().behavior.get(behaviorKey(S.TEST_A, 'desktop'));
  assert.equal(before?.status, 'resolved');
  writeFileSync(join(s.root, 'tests/excluded-helper.ts'), 'export const runtime=2;');
  const after = s.digest().behavior.get(behaviorKey(S.TEST_A, 'desktop'));
  assert.ok(before?.status === 'resolved' && after?.status === 'resolved');
  assert.equal(before.digest, after.digest);
  assert.ok(!after.inputs.some(input => input.path === 'tests/excluded-helper.ts'));
});
for (const source of [
  "import {type Foo, runtime} from './excluded-helper';console.log(runtime);",
  "export {type Foo, runtime} from './excluded-helper';",
  "import './excluded-helper';",
  "import {} from './excluded-helper';",
  "export {} from './excluded-helper';",
]) test(`R6-2 real/mixed runtime dependencies retain exclusions: ${source}`, () => {
  const s = suite(source);
  writeFileSync(join(s.root, 'tests/excluded-helper.ts'), 'export const runtime=1;');
  assert.deepEqual(scanFile(join(s.root, S.TEST_A.file), source, s.root).imports, ['./excluded-helper']);
  assert.match(optionClosureProblems([join(s.root, S.TEST_A.file)], file => file.endsWith('excluded-helper.ts')).join(';'), /excluded module/);
});

// The shared scan reports names/unknown reads, but never the current parent-process values.
test('R6-1 shared AST input analysis distinguishes static names from dynamic/whole environment reads', () => {
  const staticScan = scanFile('/suite/spec.ts', "const p=process;const {env:e}=p;const {EXPECTED_FONT:f}=e;const g=e['EXPECTED_COLOR'];", '/suite');
  assert.deepEqual(new Set(staticScan.environmentReads.map(r => r.name)), new Set(['EXPECTED_FONT', 'EXPECTED_COLOR']));
  assert.deepEqual(staticScan.problems, []);
  const unknown = scanFile('/suite/spec.ts', "const e=process.env;const a=e[getName()];Object.keys(e);", '/suite');
  assert.ok(unknown.environmentReads.some(r => r.name === null));
  assert.deepEqual(unknown.problems, []);
  const types = scanFile('/suite/spec.ts', "type Expected=typeof process.env.EXPECTED_FONT;const value=1;", '/suite');
  assert.deepEqual(types.environmentReads, []);
});

test('R6-1 configuration environment remains executable but never becomes evidence certification', () => {
  const s = suite('const constant=1;');
  const config = join(s.root, 'playwright.config.ts');
  writeFileSync(config, "export default {use:{baseURL:process.env.BASE_URL},retries:Number(process.env.RETRIES??0)};");
  s.ctx.begin.configFile = config;
  assert.deepEqual(optionClosureProblems([config]), []);
  const report = s.digest();
  assert.equal(report.behavior.get(behaviorKey(S.TEST_A, 'desktop'))?.status, 'unresolved');
});
