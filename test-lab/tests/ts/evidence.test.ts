// Evidence receipts (plan §4, §6): every judgment recomputed from the raw ledgers a receipt names, never
// taken from the receipt; bound to the current digests, case hash and material effective configuration;
// transferred to another configuration only where the receipt names it explicitly and the bindings match.

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { loadEvidence, evaluateCase, judgeRedCheck, judgeBurnIn, type EvidenceContext } from '../../src/evidence.ts';
import type { CaseRecord, Disposition, EvidenceRecord, Mapping, SensitivityWaiver } from '../../src/model.ts';
import { sameTest, testKey, obligationKey } from '../../src/model.ts';
import { canonicalCaseHash } from '../../src/cases.ts';
import {
  Ledger, caseSteps, ids, ledgerRef,
  ENVIRONMENT, CONFIGS,
  DEV,
  QA,
  ROLES,
  TEST_A,
  acceptance,
  burnIn,
  caseRecord,
  digests,
  effective,
  redCheck,
  tmp,
  writeEvidenceLedgers,
} from './support.ts';

type World = { record: CaseRecord; ctx: EvidenceContext; dir: string; recipes: string };

function rows(caseId: string, configs: string[], obligations = ['O1', 'O2'], layer: 'served' | 'synthetic' = 'served'): Mapping[] {
  return configs.flatMap((c) => obligations.map((o) => ({ obligation: { case: caseId, step: 'S1', obligation: o }, test: TEST_A, configuration: c, layer })));
}

/** A regression case on desktop@1440 with a red check per obligation, a burn-in and QA's acceptance. */
function world(options: { track?: 'regression' | 'addendum'; configs?: string[] } = {}): World {
  const dir = tmp('test-lab-evidence-');
  const recipes = join(dir, '..', `${dir.split('/').pop() ?? 'x'}-recipes`);
  const configs = options.configs ?? ['desktop@1440'];
  const record = caseRecord('C1', options.track ?? 'regression', { configurations: configs });
  const records: EvidenceRecord[] = [];
  for (const o of ['O1', 'O2']) {
    const paths = writeEvidenceLedgers(dir, 'C1', TEST_A, 'desktop@1440', { failIn: o });
    records.push(redCheck(dir, recipes, { case: 'C1', step: 'S1', obligation: o }, TEST_A, 'desktop@1440', paths));
    if (o === 'O1') records.push(burnIn(dir, TEST_A, 'desktop@1440', paths.burn));
  }
  records.push(acceptance(record, TEST_A));
  const ctx: EvidenceContext = {
    evidenceDir: dir,
    recipesDir: recipes,
    records,
    digests: digests([TEST_A]),
    environment: ENVIRONMENT,
    effective: effective(),
    configurations: CONFIGS,
    ledger: rows('C1', configs),
    dispositions: [],
    roles: ROLES,
    materialFields: ['browserName', 'browserVersion', 'channel', 'headless', 'retries'],
  };
  return { record, ctx, dir, recipes };
}

const reasons = (e: ReturnType<typeof evaluateCase>) => e.mappings.flatMap((m) => m.reasons).join(' | ');

describe('a receipt is recomputed from its ledgers', () => {
  test('a complete set of receipts verifies the case', () => {
    const w = world();
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.equal(e.status, 'verified', reasons(e));
  });

  test('a missing ledger file leaves the case unverified', () => {
    const w = world();
    const red = w.ctx.records.find((r) => r.kind === 'red-check');
    assert.ok(red !== undefined && red.kind === 'red-check');
    rmSync(join(w.dir, red.mutated.path));
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.equal(e.status, 'insufficient');
    assert.match(reasons(e), /is missing/);
  });

  test('a ledger altered after its receipt was written is not trusted', () => {
    const w = world();
    const red = w.ctx.records.find((r) => r.kind === 'red-check');
    assert.ok(red !== undefined && red.kind === 'red-check');
    appendFileSync(join(w.dir, red.restored.path), '');
    writeFileSync(join(w.dir, red.restored.path), 'tampered\n');
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.equal(e.status, 'insufficient');
    assert.match(reasons(e), /changed since the receipt was written/);
  });

  test('a receipt path that climbs out of the evidence folder is refused', () => {
    const w = world();
    w.ctx.records = w.ctx.records.map((r) => (r.kind === 'burn-in' ? { ...r, run: { ...r.run, path: '../elsewhere.jsonl' } } : r));
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.match(reasons(e), /leaves the evidence folder/);
  });

  test('a mutation that failed in O2 does not verify O1', () => {
    const w = world();
    const paths = writeEvidenceLedgers(w.dir, 'C1', TEST_A, 'desktop@1440', { failIn: 'O2', tag: 'wrong-step' });
    w.ctx.records = w.ctx.records.map((r) => (r.kind === 'red-check' && r.obligation.obligation === 'O1' ? redCheck(w.dir, w.recipes, r.obligation, TEST_A, 'desktop@1440', paths) : r));
    const e = evaluateCase(w.record, 'regression', w.ctx);
    const o1 = e.mappings.find((m) => m.ref.obligation === 'O1');
    assert.equal(o1?.sensitivity, 'unverified');
    assert.match(o1?.reasons.join(' ') ?? '', /failed inside O2, not O1/);
  });

  test('a test claiming two obligations but asserting one: the rows-only mutation leaves it passing, so O2 stays unverified', () => {
    const w = world();
    // The mutated "run" for O2 shows the test passing: nothing asserted the rows.
    const paths = writeEvidenceLedgers(w.dir, 'C1', TEST_A, 'desktop@1440', { failIn: 'none', tag: 'no-assertion' });
    w.ctx.records = w.ctx.records.map((r) => (r.kind === 'red-check' && r.obligation.obligation === 'O2' ? redCheck(w.dir, w.recipes, r.obligation, TEST_A, 'desktop@1440', { mutated: paths.restored, restored: paths.restored }) : r));
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.equal(e.mappings.find((m) => m.ref.obligation === 'O1')?.sensitivity, 'verified');
    const o2 = e.mappings.find((m) => m.ref.obligation === 'O2');
    assert.equal(o2?.sensitivity, 'unverified');
    assert.match(o2?.reasons.join(' ') ?? '', /did not fail under the mutation/);
  });

  test('setup failing under the mutation disqualifies the red check', () => {
    const w = world();
    const paths = writeEvidenceLedgers(w.dir, 'C1', TEST_A, 'desktop@1440', { failIn: 'O1', setupFails: true, tag: 'setup' });
    w.ctx.records = w.ctx.records.map((r) => (r.kind === 'red-check' && r.obligation.obligation === 'O1' ? redCheck(w.dir, w.recipes, r.obligation, TEST_A, 'desktop@1440', paths) : r));
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.match(reasons(e), /setup did not pass under the mutation/);
  });

  test('a restored run that did not pass disqualifies the red check', () => {
    const w = world();
    const paths = writeEvidenceLedgers(w.dir, 'C1', TEST_A, 'desktop@1440', { failIn: 'O1', tag: 'restored-fails' });
    w.ctx.records = w.ctx.records.map((r) => (r.kind === 'red-check' && r.obligation.obligation === 'O1' ? redCheck(w.dir, w.recipes, r.obligation, TEST_A, 'desktop@1440', { mutated: paths.mutated, restored: paths.mutated }) : r));
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.match(reasons(e), /did not pass cleanly once the mutation was removed/);
  });

  test('a missing or altered mutation recipe disqualifies the red check', () => {
    const w = world();
    const red = w.ctx.records.find((r) => r.kind === 'red-check');
    assert.ok(red !== undefined && red.kind === 'red-check');
    writeFileSync(join(w.recipes, `${red.recipeHash.replace('sha256:', '')}.json`), '{"obligation":{"case":"C1","step":"S1","obligation":"O1"},"weakened":true}');
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.match(reasons(e), /mutation recipe .* changed/);
  });

  test('a burn-in of four repeats is not a burn-in', () => {
    const w = world();
    const paths = writeEvidenceLedgers(w.dir, 'C1', TEST_A, 'desktop@1440', { repeats: 4, tag: 'short' });
    w.ctx.records = w.ctx.records.map((r) => (r.kind === 'burn-in' ? burnIn(w.dir, TEST_A, 'desktop@1440', paths.burn) : r));
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.match(reasons(e), /fewer than five/);
  });
});

describe('bindings', () => {
  test('a helper weakened after acceptance moves the behavior digest: unverified and stale', () => {
    const w = world();
    w.ctx.digests = digests([TEST_A], { behavior: 'sha256:weakened' });
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.equal(e.status, 'insufficient');
    assert.ok(e.mappings.every((m) => m.sensitivity === 'unverified' && m.acceptance === 'stale'));
  });

  test('a toolchain change invalidates verification but the acceptance survives', () => {
    const w = world();
    w.ctx.digests = digests([TEST_A], { toolchain: 'sha256:new-lockfile' });
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.ok(e.mappings.every((m) => m.sensitivity === 'unverified' && m.acceptance === 'current'));
  });

  test('a different browser version now than in the receipt\'s own ledger invalidates verification', () => {
    const w = world();
    w.ctx.effective = effective({ name: 'chromium', version: '146.0.0.0' });
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.match(reasons(e), /browserVersion \(145\.0\.0\.0 then, 146\.0\.0\.0 now\)/);
  });

  test('the same files run headed instead of headless invalidate verification', () => {
    const w = world();
    w.ctx.effective = effective(undefined, { headless: false });
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.match(reasons(e), /headless \(true then, false now\)/);
  });

  test('an edited case stales the acceptance', () => {
    const w = world();
    const edited = { ...w.record, preconditions: 'Something else.' };
    edited.approval = { ...(w.record.approval as NonNullable<CaseRecord['approval']>), hash: canonicalCaseHash(edited) };
    const e = evaluateCase(edited, 'regression', w.ctx);
    assert.ok(e.mappings.every((m) => m.acceptance === 'stale'));
  });

  test('a regression acceptance made in the developer role does not count when read', () => {
    const w = world();
    w.ctx.records = w.ctx.records.map((r) => (r.kind === 'acceptance' ? { ...r, by: DEV, role: 'developer' as const, standIn: false } : r));
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.match(reasons(e), /needs someone in the QA role/);
  });

  test('a QA acceptance by someone no longer in the QA role does not count', () => {
    const w = world();
    w.ctx.roles = { qa: [{ name: 'Someone Else', standIn: false }] };
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.match(reasons(e), /does not hold the QA role/);
  });
});

describe('transfer to another configuration', () => {
  test('evidence never transfers by case ID alone', () => {
    const w = world({ configs: ['desktop@1440', 'desktop@900'] });
    const e = evaluateCase(w.record, 'regression', w.ctx);
    const at900 = e.mappings.filter((m) => m.configuration === 'desktop@900');
    assert.ok(at900.every((m) => m.sensitivity === 'unverified'));
    assert.match(at900[0]?.reasons.join(' ') ?? '', /is for desktop@1440 and does not name desktop@900/);
  });

  test('an explicit applicability on the same project and role transfers it', () => {
    const w = world({ configs: ['desktop@1440', 'desktop@900'] });
    w.ctx.records = w.ctx.records.map((r) => (r.kind === 'red-check' || r.kind === 'burn-in' ? { ...r, appliesTo: ['desktop@900'] } : r));
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.equal(e.status, 'verified', reasons(e));
  });

  test('a named configuration with another role is refused', () => {
    const w = world({ configs: ['desktop@1440', 'editor@1440'] });
    w.ctx.records = w.ctx.records.map((r) => (r.kind === 'red-check' || r.kind === 'burn-in' ? { ...r, appliesTo: ['editor@1440'] } : r));
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.match(reasons(e), /is for role anonymous, not editor/);
  });
});

describe('waivers', () => {
  const waiver = (record: CaseRecord, o: string, by: string, role: 'qa' | 'developer'): SensitivityWaiver => ({
    kind: 'sensitivity-waived',
    id: `w-${o}`,
    case: record.id,
    step: 'S1',
    obligation: o,
    caseHash: canonicalCaseHash(record),
    by,
    role,
    standIn: role === 'qa',
    at: '2026-10-09',
    reason: 'no faithful mutation exists',
  });

  function unverifiedWorld(track: 'regression' | 'addendum') {
    const w = world({ track });
    w.ctx.records = w.ctx.records.filter((r) => r.kind !== 'red-check');
    return w;
  }

  test('a QA waiver on a regression case counts as waived, never as verified', () => {
    const w = unverifiedWorld('regression');
    w.ctx.dispositions = [waiver(w.record, 'O1', QA, 'qa'), waiver(w.record, 'O2', QA, 'qa')];
    assert.equal(evaluateCase(w.record, 'regression', w.ctx).status, 'waived');
  });

  test('a developer waiver on a regression case is refused', () => {
    const w = unverifiedWorld('regression');
    w.ctx.dispositions = [waiver(w.record, 'O1', DEV, 'developer'), waiver(w.record, 'O2', DEV, 'developer')] as Disposition[];
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.equal(e.status, 'insufficient');
    assert.match(reasons(e), /waiver refused/);
  });

  test('a self-derived, waived addendum case is developer-attested', () => {
    const w = unverifiedWorld('addendum');
    const record: CaseRecord = { ...w.record, provenance: { draftedFrom: 'existing-test', independentRefs: [], selfDerivedAcceptedBy: null } };
    w.ctx.dispositions = [waiver(record, 'O1', DEV, 'developer'), waiver(record, 'O2', DEV, 'developer')];
    w.ctx.records = [...w.ctx.records.filter((r) => r.kind === 'burn-in'), acceptance(record, TEST_A)];
    assert.equal(evaluateCase(record, 'addendum', w.ctx).status, 'developer-attested');
  });

  test('a waiver cannot make a synthetic test prove a served obligation', () => {
    const w = unverifiedWorld('regression');
    w.ctx.ledger = rows('C1', ['desktop@1440'], ['O1', 'O2'], 'synthetic');
    w.ctx.dispositions = [waiver(w.record, 'O1', QA, 'qa'), waiver(w.record, 'O2', QA, 'qa')];
    const e = evaluateCase(w.record, 'regression', w.ctx);
    assert.equal(e.status, 'insufficient');
    assert.match(reasons(e), /synthetic test can't prove a served obligation/);
  });
});

// Review R1 findings 4, 5, 6, 8, 10: public receipt judgments over raw files.
test('R1-4 red waiver with acceptance still requires a burn-in', () => {
  const w = world();
  w.ctx.records = w.ctx.records.filter((r) => r.kind === 'acceptance');
  w.ctx.dispositions = ['O1', 'O2'].map((obligation) => ({ kind: 'sensitivity-waived', id: obligation, case: w.record.id, step: 'S1', obligation,
    caseHash: canonicalCaseHash(w.record), by: QA, role: 'qa', standIn: true, at: '2026-10-09', reason: 'no faithful mutation' }));
  const e = evaluateCase(w.record, 'regression', w.ctx);
  assert.equal(e.status, 'insufficient');
  assert.match(reasons(e), /burn-in/);
});

test('R1-5 propagated C1/S1/O1 failure cannot claim deepest C2/S1/O1', () => {
  const w = world();
  const red = w.ctx.records.find((r) => r.kind === 'red-check' && r.obligation.obligation === 'O1');
  assert.ok(red?.kind === 'red-check');
  const steps = [
    { path: [1], depth: 0, title: 'outer', status: 'failed' as const, error: { message: 'inner failure' }, ids: ids('C1', 'S1', 'O1') },
    { path: [1, 0], depth: 1, title: 'inner', status: 'failed' as const, error: { message: 'inner failure' }, ids: ids('C2', 'S1', 'O1') },
  ];
  new Ledger().test('t', { file: TEST_A.file, titlePath: TEST_A.titlePath }).result('t', { status: 'failed', steps }).write(w.dir, { file: 'cross-case.jsonl' });
  assert.notEqual(judgeRedCheck(w.dir, { ...red, mutated: ledgerRef(w.dir, 'cross-case.jsonl') }, CONFIGS[0]!, false, w.recipes), null);
});

test('R1-6 literal delimiter title cannot borrow nested title receipts or acceptance', () => {
  const w = world();
  const nested = { ...TEST_A, titlePath: ['outer', 'inner'] };
  const literal = { ...TEST_A, titlePath: ['outer › inner'] };
  w.ctx.records = [];
  for (const o of ['O1', 'O2']) {
    const paths = writeEvidenceLedgers(w.dir, 'C1', nested, 'desktop@1440', { failIn: o });
    w.ctx.records.push(redCheck(w.dir, w.recipes, { case: 'C1', step: 'S1', obligation: o }, nested, 'desktop@1440', paths));
    if (o === 'O1') w.ctx.records.push(burnIn(w.dir, nested, 'desktop@1440', paths.burn));
  }
  w.ctx.records.push(acceptance(w.record, nested));
  w.ctx.digests = digests([literal]);
  w.ctx.ledger = w.ctx.ledger.map((m) => ({ ...m, test: literal }));
  assert.equal(evaluateCase(w.record, 'regression', w.ctx).status, 'insufficient');
});

test('R1-8 burn-in with five passing results and teardown error is refused', () => {
  const w = world();
  const l = new Ledger();
  for (let i=0; i<5; i++) l.test(String(i), { file: TEST_A.file, titlePath: TEST_A.titlePath }).result(String(i), { status: 'passed', steps: caseSteps('C1', 'desktop@1440', { O1: 'passed', O2: 'passed' }) });
  l.error('global teardown threw').write(w.dir, { file: 'failed-burn.jsonl' });
  assert.notEqual(judgeBurnIn(w.dir, burnIn(w.dir, TEST_A, 'desktop@1440', 'failed-burn.jsonl'), CONFIGS[0]!, false, [{case:'C1',step:'S1',obligation:'O1'}]), null);
});

test('R1-8 restored target must actually pass, not skip inside a passing test', () => {
  const w = world();
  const red = w.ctx.records.find((r) => r.kind === 'red-check' && r.obligation.obligation === 'O1');
  assert.ok(red?.kind === 'red-check');
  new Ledger().test('t', { file: TEST_A.file, titlePath: TEST_A.titlePath }).result('t', { status: 'passed', steps: caseSteps('C1', 'desktop@1440', { O1: 'skipped', O2: 'passed' }) }).write(w.dir, { file: 'skip-restored.jsonl' });
  assert.notEqual(judgeRedCheck(w.dir, { ...red, restored: ledgerRef(w.dir, 'skip-restored.jsonl') }, CONFIGS[0]!, false, w.recipes), null);
});

test('R1-8 restored passing test does not excuse a run-level error', () => {
  const w = world();
  const red = w.ctx.records.find((r) => r.kind === 'red-check');
  assert.ok(red?.kind === 'red-check');
  new Ledger().test('t', { file: TEST_A.file, titlePath: TEST_A.titlePath }).result('t', { status: 'passed', steps: caseSteps('C1', 'desktop@1440', { O1: 'passed', O2: 'passed' }) }).error('teardown threw').write(w.dir, { file: 'error-restored.jsonl' });
  assert.notEqual(judgeRedCheck(w.dir, { ...red, restored: ledgerRef(w.dir, 'error-restored.jsonl') }, CONFIGS[0]!, false, w.recipes), null);
});

test('R1-10 changing target baseURL invalidates sensitivity while acceptance survives', () => {
  const w = world();
  w.ctx.effective = effective(undefined, { baseURL: 'http://127.0.0.1:9999' });
  const e = evaluateCase(w.record, 'regression', w.ctx);
  assert.equal(e.status, 'insufficient');
  assert.ok(e.mappings.every((m) => m.acceptance === 'current'));
  assert.match(reasons(e), /environment/);
});

test('R1-6 structural keys also separate delimiter-containing identity fields and obligation IDs', () => {
  assert.equal(sameTest({...TEST_A,titlePath:['outer › inner']},{...TEST_A,titlePath:['outer','inner']}),false);
  assert.notEqual(testKey({suite:'a::b',file:'c',titlePath:['d']}),testKey({suite:'a',file:'b::c',titlePath:['d']}));
  assert.notEqual(obligationKey({case:'C1/S1',step:'S2',obligation:'O1'}),obligationKey({case:'C1',step:'S1/S2',obligation:'O1'}));
});

test('R1-10 named environment identity cannot change even at the same baseURL', () => {
  const w = world();
  w.ctx.environment = {...w.ctx.environment,id:'other-target'};
  assert.equal(evaluateCase(w.record,'regression',w.ctx).status,'insufficient');
});

test('R1-4 waiver cannot excuse stale toolchain or unresolved behavior despite burn-in', () => {
  for (const change of ['behavior','toolchain'] as const) {
    const w=world();
    w.ctx.records=w.ctx.records.filter((r)=>r.kind!=='red-check');
    w.ctx.dispositions=['O1','O2'].map((obligation)=>({kind:'sensitivity-waived',id:obligation,case:w.record.id,step:'S1',obligation,caseHash:canonicalCaseHash(w.record),by:QA,role:'qa',standIn:true,at:'2026-10-09',reason:'no mutation'}));
    w.ctx.digests=digests([TEST_A],{[change]:'changed'});
    assert.equal(evaluateCase(w.record,'regression',w.ctx).status,'insufficient');
  }
});

test('R1-10 old receipts without environment bindings are invalid, never migrated', () => {
  const w=world();
  const red=w.ctx.records.find((r)=>r.kind==='red-check')!;
  const persisted: Record<string,unknown>={...red};
  delete persisted['environment'];
  const dir=join(w.dir,'old-records');
  mkdirSync(dir);
  writeFileSync(join(dir,'red.json'),JSON.stringify(persisted));
  const loaded=loadEvidence(dir);
  assert.deepEqual(loaded.records,[]);
  assert.match(loaded.problems.join(' '),/not a valid evidence record/);
});

test('R1-10 the raw ledger environment must match the receipt', () => {
  const w=world();
  const red=w.ctx.records.find((r)=>r.kind==='red-check');
  assert.ok(red?.kind==='red-check');
  const path=join(w.dir,red.restored.path);
  const lines=readFileSync(path,'utf8').trim().split('\n').map((s)=>JSON.parse(s));
  lines[0].environment.id='another-environment';
  writeFileSync(path,lines.map((s)=>JSON.stringify(s)).join('\n')+'\n');
  assert.notEqual(judgeRedCheck(w.dir,{...red,restored:ledgerRef(w.dir,red.restored.path)},CONFIGS[0]!,false,w.recipes),null);
});
