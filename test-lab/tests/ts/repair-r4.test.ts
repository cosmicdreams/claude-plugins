import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { scanFile } from '../../src/imports.ts';
import { computeDigests } from '../../src/digest.ts';
import { normalize } from '../../src/normalize.ts';
import { evaluateCase, judgeBurnIn, judgeRedCheck, readLedgerRef } from '../../src/evidence.ts';
import { readInvocation, runStatus } from '../../src/run-observation.ts';
import { probeInvocation } from '../../src/run-plan.ts';
import { effectiveClassification } from '../../src/dispositions.ts';
import { decide } from '../../src/verdict.ts';
import type { CaseRecord, ObligationRef, Track } from '../../src/model.ts';
import * as S from './support.ts';

const ref: ObligationRef = { case: 'C1', step: 'S1', obligation: 'O1' };
const acquisitionFlows = [
  "import {getBuiltinModule as builtin} from 'node:process';const load=builtin('module').createRequire(__filename);load('./helper.cjs');",
  "import * as proc from 'node:process';const {getBuiltinModule:acquire}=proc;acquire('fs').readFileSync('hidden.txt');",
  "import proc from 'process';const read=proc.getBuiltinModule('fs').readFileSync;read('hidden.txt');",
  "const proc=process;const load=proc.getBuiltinModule('module').createRequire(__filename);load('./helper.cjs');",
  "let proc;proc=process;const {getBuiltinModule:acquire}=proc;acquire('fs').readFileSync('hidden.txt');",
  "const {getBuiltinModule:acquire}=require('process');const read=acquire('fs').readFileSync;read('hidden.txt');",
  "const proc=process;proc['getBuiltinModule']('module').createRequire(__filename)('./helper.cjs');",
  "const proc=process;const key=process.env.KEY!;proc[key]('fs').readFileSync('hidden.txt');",
  "const proc=process;const {binding}=proc;binding('fs');",
  "import {mainModule as m} from 'node:process';m.require('./helper.cjs');",
  "const holder={process};holder.process.getBuiltinModule('fs');",
  "function acquire(){return process}acquire().getBuiltinModule('fs');",
  "const proc=true?process:process;proc.getBuiltinModule('fs');",
  "const proc=process||process;proc.getBuiltinModule('fs');",
  "const proc=process;const load=proc.getBuiltinModule('module').createRequire(__filename);const api=load('@playwright/test').test;Reflect.get(api,'use')({baseURL:process.env.SCOPED_URL});",
  "Reflect.get(()=>{},'constructor')('return require')()('./helper.cjs');",
  "const reflect=Reflect;const {get:acquire}=reflect;acquire(()=>{},process.env.KEY!);",
  "const object=Object;const {getPrototypeOf:acquire}=object;acquire(()=>{}).constructor('return require')();",
  "Object.getOwnPropertyDescriptor(()=>{},'constructor');",
  "const {constructor:compile}=()=>{};compile('return require')();",
  "const key=process.env.KEY!;const compile=(()=>{})[key];compile('return require')();",
  "import {runInNewContext as execute} from 'node:vm';execute(process.env.CODE!);",
  "import {execFileSync as execute} from 'node:child_process';execute(process.execPath,['-e',process.env.CODE!]);",
  "import {Worker} from 'node:worker_threads';new Worker(process.env.CODE!,{eval:true});",
  "import inspector from 'node:inspector';new inspector.Session();",
];
for (const flow of acquisitionFlows) test(`R4-1 capability acquisition refuses before trust: ${flow}`, () => {
  const scan = scanFile('/suite/spec.ts', flow, '/suite');
  assert.ok(scan.problems.length > 0, 'acquisition must carry an actionable refusal');
  const dir = S.tmp('r4-acquisition-'); mkdirSync(join(dir, 'kit'));
  writeFileSync(join(dir, 'kit/kit.ts'), 'export const kit=1;'); writeFileSync(join(dir, 'package-lock.json'), '{}');
  writeFileSync(join(dir, 'spec.ts'), flow); writeFileSync(join(dir, 'helper.cjs'), "module.exports='strong';"); writeFileSync(join(dir, 'hidden.txt'), 'strong');
  const begin = { ...new S.Ledger().test('t', { file: 'spec.ts', titlePath: ['t'] }).begin(), rootDir: dir, configFile: null };
  const ctx = { suite: 'e2e', suiteRoot: dir, begin, cases: new Map<string, CaseRecord>(), ledger: [], recipes: [], declaredInputs: [], declaredBaselines: [], kitDir: join(dir, 'kit') };
  assert.equal(computeDigests(ctx).behavior.values().next().value?.status, 'unresolved');
  writeFileSync(join(dir, 'hidden.txt'), 'weakened'); writeFileSync(join(dir, 'helper.cjs'), "module.exports='weakened';");
  assert.equal(computeDigests(ctx).behavior.values().next().value?.status, 'unresolved');
});

test('R4-1 ordinary process data aliases, direct hooks and viewport matrices remain supported', () => {
  for (const source of [
    "import proc from 'node:process';const p=proc;const {env,platform}=p;const url=env.BASE_URL;",
    "import {env as environment,platform} from 'node:process';const url=environment.BASE_URL;",
    "const p=process;const url=p['env'].BASE_URL;const platform=p.platform;",
    "import {test} from '@playwright/test';test.beforeEach(async({page})=>{await page.goto(process.env.BASE_URL!)});for(const width of [1440,900])test.describe(`${width}`,()=>{test.use({viewport:{width,height:900}});test('entry',()=>{})});",
    "const object=Object;const data=object.keys({a:1});const frozen=object.freeze({a:1});",
  ]) assert.deepEqual(scanFile('/suite/spec.ts', source, '/suite').problems, [], source);
});

test('R4-1 old acquisition-blind safety records cannot support historical receipts', () => {
  const dir = S.tmp('r4-old-analysis-'), l = new S.Ledger().test('t', { file: S.TEST_A.file, titlePath: S.TEST_A.titlePath }).result('t', { status: 'passed', steps: S.caseSteps('C1', 'desktop@1440', { O1: 'passed' }) });
  const records = l.records(); const begin = records[0]!; assert.equal(begin.type, 'begin'); if (begin.type !== 'begin') return;
  (begin.tests[0]!.optionSafety as unknown as { version: number }).version = 2;
  writeFileSync(join(dir, 'old.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  assert.equal(readLedgerRef(dir, S.ledgerRef(dir, 'old.jsonl')).ok, false);
  l.test('failed', { file: 'failed.spec.ts', titlePath: ['retained failure'] }).result('failed', { status: 'failed', error: 'retained independent failure' });
  const failedRecords = l.records(); const failedBegin = failedRecords[0]!; if (failedBegin.type !== 'begin') return;
  for (const t of failedBegin.tests) t.optionSafety.version = 2;
  writeFileSync(join(dir, 'old-failed.jsonl'), failedRecords.map(r => JSON.stringify(r)).join('\n') + '\n');
  const observation = readInvocation({ id: 'old', suite: 'e2e', dir }, join(dir, 'old-failed.jsonl'));
  assert.equal(runStatus({ invocations: [observation] }).complete, false);
  assert.equal(observation.tests.find(t => t.declaration.testId === 'failed')?.results[0]?.status, 'failed');
});

function world(track: Track = 'regression') {
  const dir = S.tmp('r4-occurrences-'), recipes = join(dir, 'recipes');
  const paths = S.writeEvidenceLedgers(dir, 'C1', S.TEST_A, 'desktop@1440', { obligations: ['O1'] });
  const red = S.redCheck(dir, recipes, ref, S.TEST_A, 'desktop@1440', paths);
  const record = S.caseRecord('C1', track, { obligations: ['O1'] });
  const ledger = [{ obligation: ref, test: S.TEST_A, configuration: 'desktop@1440', layer: 'served' as const }];
  return { dir, recipes, paths, red, record, ledger };
}
for (const track of ['regression', 'addendum'] as const) for (const unknown of ['skipped', 'passed', 'failed', 'expected-failure', 'flaky', 'not-run'] as const) test(`R4-2 ${track} matching pass cannot hide independent unknown ${unknown}`, () => {
  const w = world(track);
  new S.Ledger().test('t', { file: S.TEST_A.file, titlePath: S.TEST_A.titlePath }).result('t', { status: 'passed', steps: S.caseSteps('C1', 'desktop@1440', { O1: 'passed' }) }).write(w.dir, { file: 'pass.jsonl' });
  const l = new S.Ledger().test('t', { file: S.TEST_A.file, titlePath: S.TEST_A.titlePath, expectedStatus: unknown === 'expected-failure' ? 'failed' : unknown === 'skipped' ? 'skipped' : 'passed' });
  if (unknown !== 'not-run') l.result('t', { status: unknown === 'expected-failure' || unknown === 'flaky' ? 'failed' : unknown, steps: [] });
  if (unknown === 'flaky') l.result('t', { status: 'passed', retry: 1, steps: [] });
  l.write(w.dir, { file: 'unknown.jsonl' });
  const run = { invocations: ['pass', 'unknown'].map(id => readInvocation({ id, suite: 'e2e', dir: w.dir }, join(w.dir, id + '.jsonl'))) };
  const normalized = normalize({ run, configurations: S.CONFIGS, cases: new Map([['C1', w.record]]), required: { regression: track === 'regression' ? ['C1'] : [], addendum: track === 'addendum' ? ['C1'] : [] }, ledger: w.ledger, classification: [], liveQuarantines: [], quarantinesOnRequired: [], roleOverrideFiles: new Set() });
  assert.equal(normalized.required[0]?.outcome, unknown === 'passed' ? 'not-run' : unknown);
  assert.equal(normalized.tests[1]?.lane, `required-${track}`);
});

test('R4-2 Ready with valid existing evidence becomes rule 5 for an unknown independent skip', () => {
  const w = world();
  new S.Ledger().test('t', { file: S.TEST_A.file, titlePath: S.TEST_A.titlePath }).result('t', { status: 'passed', steps: S.caseSteps('C1', 'desktop@1440', { O1: 'passed' }) }).write(w.dir, { file: 'pass.jsonl' });
  new S.Ledger().test('t', { file: S.TEST_A.file, titlePath: S.TEST_A.titlePath, expectedStatus: 'skipped' }).result('t', { status: 'skipped', steps: [] }).write(w.dir, { file: 'skip.jsonl' });
  const run = { invocations: ['pass', 'skip'].map(id => readInvocation({ id, suite: 'e2e', dir: w.dir }, join(w.dir, id + '.jsonl'))) };
  assert.equal(runStatus(run).complete, true);
  const normalized = normalize({ run, configurations: S.CONFIGS, cases: new Map([['C1', w.record]]), required: { regression: ['C1'], addendum: [] }, ledger: w.ledger, classification: [], liveQuarantines: [], quarantinesOnRequired: [], roleOverrideFiles: new Set() });
  const evidence = evaluateCase(w.record, 'regression', { evidenceDir: w.dir, recipesDir: w.recipes, records: [w.red, S.burnIn(w.dir, S.TEST_A, 'desktop@1440', w.paths.burn), S.acceptance(w.record, S.TEST_A)], digests: S.digests([S.TEST_A]), environment: S.ENVIRONMENT, effective: S.effective(), configurations: S.CONFIGS, ledger: w.ledger, dispositions: [], roles: S.ROLES, materialFields: ['browserName'] });
  assert.equal(evidence.status, 'verified');
  assert.equal(decide({ profileProblems: [], regression: { ok: true, set: ['C1'], base: { ref: 'r', commit: 'c', fetchedAt: null }, problems: [] }, work: { resolution: { status: 'none', via: 'flag' }, check: null }, identity: { checks: [], unknown: [], changed: [], configDrift: [], notEvaluable: [] }, configurationDependent: [], runStatus: runStatus(run), fixtures: [], requiredFixtures: [], breaker: { tripped: false, reason: '', blocking: 2, failures: 0, connectionFailures: 0, probe: null }, normalized, riskAcceptances: [], evidence: [evidence] }).rule, 5);
});

test('R4-2 observable outside tuples stay outside and cannot poison exact configuration attribution', () => {
  const w = world(), l = new S.Ledger();
  l.test('a', { file: S.TEST_A.file, titlePath: S.TEST_A.titlePath }).result('a', { status: 'passed', steps: S.caseSteps('C1', 'desktop@1440', { O1: 'passed' }) });
  l.test('b', { file: S.TEST_A.file, titlePath: S.TEST_A.titlePath, expectedStatus: 'skipped' }).result('b', { status: 'skipped', steps: S.caseSteps('C1', 'desktop@900', { O1: 'skipped' }) }).write(w.dir);
  const normalized = normalize({ run: { invocations: [readInvocation({ id: 'i', suite: 'e2e', dir: w.dir })] }, configurations: S.CONFIGS, cases: new Map([['C1', w.record]]), required: { regression: ['C1'], addendum: [] }, ledger: w.ledger, classification: [], liveQuarantines: [], quarantinesOnRequired: [], roleOverrideFiles: new Set() });
  assert.equal(normalized.required[0]?.outcome, 'passed'); assert.equal(normalized.tests[1]?.lane, 'outside');
});

for (const stage of ['mutated', 'restored', 'burn'] as const) test(`R4-2 ${stage} receipt accounts for an independent unknown same-test occurrence`, () => {
  const w = world(), l = new S.Ledger();
  const count = stage === 'burn' ? 5 : 1;
  for (let i = 0; i < count; i++) l.test('t' + i, { file: S.TEST_A.file, titlePath: S.TEST_A.titlePath }).result('t' + i, { status: stage === 'mutated' ? 'failed' : 'passed', steps: S.caseSteps('C1', 'desktop@1440', { O1: stage === 'mutated' ? 'failed' : 'passed' }) });
  l.test('unknown', { file: S.TEST_A.file, titlePath: S.TEST_A.titlePath, expectedStatus: stage === 'mutated' ? 'skipped' : 'passed' }).result('unknown', { status: stage === 'mutated' ? 'skipped' : 'passed', steps: [] }).write(w.dir, { file: 'extra.jsonl' });
  if (stage === 'burn') assert.notEqual(judgeBurnIn(w.dir, S.burnIn(w.dir, S.TEST_A, 'desktop@1440', 'extra.jsonl'), S.CONFIGS[0]!, false, [ref]), null);
  else assert.notEqual(judgeRedCheck(w.dir, { ...w.red, [stage]: S.ledgerRef(w.dir, 'extra.jsonl') }, S.CONFIGS[0]!, false, w.recipes), null);
});

test('R4-3 a project execution exclusion does not classify shared config paths', () => {
  const dir = S.tmp('r4-project-config-'); writeFileSync(join(dir, 'package.json'), '{}'); writeFileSync(join(dir, 'playwright.config.ts'), "export default {projects:[{name:'desktop'},{name:'prod'}]};");
  // CLI resolution is needed to construct the probe, but it must never load the config.
  mkdirSync(join(dir, 'node_modules/@playwright/test'), { recursive: true }); writeFileSync(join(dir, 'node_modules/@playwright/test/package.json'), '{"name":"@playwright/test","version":"1.58.2"}');
  const rules = effectiveClassification([{ id: 'exclude', target: { suite: 'example', project: 'prod' }, from: null, to: 'excluded', by: S.QA, role: 'qa', standIn: true, at: '2026-10-09', reason: 'production' }], S.ROLES).rules;
  const input = { suite: 'example', config: join(dir, 'playwright.config.ts'), rules, environment: { ...S.ENVIRONMENT, baseUrlEnv: 'BASE_URL' }, runDir: join(dir, 'run'), reporter: join(dir, 'reporter.ts'), projects: ['desktop'], secretOptions: [] };
  assert.equal(probeInvocation(input).purpose, 'probe');
  writeFileSync(join(dir, 'playwright.config.ts'), "import './prod-helper.ts';export default {projects:[{name:'desktop'},{name:'prod'}]};"); writeFileSync(join(dir, 'prod-helper.ts'), 'export const value=1;');
  const pathRules = effectiveClassification([{ id: 'helper', target: { suite: 'example', project: 'prod', glob: 'prod-helper.ts' }, from: null, to: 'excluded', by: S.QA, role: 'qa', standIn: true, at: '2026-10-09', reason: 'production helper' }], S.ROLES).rules;
  assert.throws(() => probeInvocation({ ...input, rules: [...rules, ...pathRules] }), /prod-helper.*excluded module/);
});
