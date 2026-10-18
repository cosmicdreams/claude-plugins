// Evidence (plan §4, §6): whether each required case's tests are verified (a red check inside the right
// obligation's step, and a burn-in, at the test's current behavior and toolchain digests and the run's
// material effective configuration) or waived, and accepted by the case's owner at the current digest and
// case hash.
//
// A receipt is a pointer, never a conclusion. It names the raw step ledgers of the runs it summarises, by
// path and content hash, and every judgment (where the mutated run failed, whether setup passed, whether
// the restored run passed, how many clean repeats the burn-in ran, which browser ran it) is recomputed
// from those ledgers each time the receipt is read. A missing or altered ledger, a missing recipe or an
// unreadable record leaves the case unverified; nothing in the ledger of mappings can stand in for it.

import { canonicalDeclarations, observationProblems, sameBindings, validObservation, type EnvironmentBinding, type EnvironmentInputDeclaration } from '../kit/environment-inputs.ts';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize as normalizePath, relative } from 'node:path';

import { canonicalJson, sha256 } from './canonical.ts';
import { canonicalCaseHash, caseProblems, configurationProblems, isSelfDerived } from './cases.ts';
import { behaviorKey, effectiveConfig, materialOf, type DigestReport, type EffectiveConfig } from './digest.ts';
import { ownerRoleHolds, waiverFor } from './dispositions.ts';
import {
  obligationKey,
  sameTest,
  testKey,
  type AcceptanceRecord,
  type BurnInRecord,
  type CaseRecord,
  type Configuration,
  type Disposition,
  type EnvironmentIdentity,
  type EvidenceRecord,
  type LedgerRef,
  type Mapping,
  type MaterialConfig,
  type MaterialField,
  type ObligationRef,
  type RedCheckRecord,
  type Roles,
  type Track,
} from './model.ts';
import { innermostCarrying, matchesConfiguration, observedOf } from './normalize.ts';
import { validEnvironment, browsersOf, latestExpected, playwrightOutcome, readInvocation, runStatus, type InvocationObservation, type ObservedTest } from './run-observation.ts';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);

function validTest(v: unknown): boolean {
  return isObject(v) && str(v['suite']) && str(v['file']) && strings(v['titlePath']);
}

function validRef(v: unknown): boolean {
  return isObject(v) && str(v['path']) && str(v['sha256']) && /^[0-9a-f]{64}$/.test(v['sha256']);
}

function validObligation(v: unknown): boolean {
  return isObject(v) && str(v['case']) && str(v['step']) && str(v['obligation']);
}

function validRecord(v: unknown): v is EvidenceRecord {
  if (!isObject(v) || !str(v['id']) || !str(v['at'])) return false;
  switch (v['kind']) {
    case 'red-check':
      return (
        validEnvironment(v['environment']) &&
        validObligation(v['obligation']) &&
        validTest(v['test']) &&
        str(v['configuration']) &&
        str(v['recipeHash']) &&
        str(v['behaviorDigest']) &&
        str(v['toolchainDigest']) &&
        validRef(v['mutated']) &&
        validRef(v['restored']) &&
        strings(v['appliesTo'])
      );
    case 'burn-in':
      return (
        validEnvironment(v['environment']) &&
        validTest(v['test']) &&
        str(v['configuration']) &&
        str(v['behaviorDigest']) &&
        str(v['toolchainDigest']) &&
        validRef(v['run']) &&
        strings(v['appliesTo'])
      );
    case 'acceptance':
      return (
        validTest(v['test']) &&
        str(v['case']) &&
        str(v['caseHash']) &&
        str(v['behaviorDigest']) &&
        str(v['by']) &&
        (v['role'] === 'qa' || v['role'] === 'developer') &&
        typeof v['standIn'] === 'boolean'
      );
    default:
      return false;
  }
}

/** Reads every `*.json` record under the evidence folder. Unreadable or invalid files are listed, never used. */
export function loadEvidence(dir: string): { records: EvidenceRecord[]; problems: string[] } {
  const records: EvidenceRecord[] = [];
  const problems: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true, encoding: 'utf8' });
  } catch {
    return { records, problems: [`no evidence folder at ${dir}`] };
  }
  for (const name of entries.filter((e) => e.endsWith('.json')).sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown;
      if (validRecord(parsed)) records.push(parsed);
      else problems.push(`${name}: not a valid evidence record`);
    } catch (error) {
      problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { records, problems };
}

// --- Ledgers behind receipts ---

export type LedgerRead = { ok: true; invocation: InvocationObservation; effective: EffectiveConfig } | { ok: false; reason: string };

/** Reads a receipt's ledger: inside the evidence folder, present, unchanged since the receipt, complete. */
export function readLedgerRef(evidenceDir: string, ref: LedgerRef): LedgerRead {
  if (isAbsolute(ref.path) || normalizePath(ref.path).startsWith('..')) return { ok: false, reason: `ledger path ${ref.path} leaves the evidence folder` };
  const file = join(evidenceDir, ref.path);
  if (relative(evidenceDir, file).startsWith('..')) return { ok: false, reason: `ledger path ${ref.path} leaves the evidence folder` };
  if (!existsSync(file)) return { ok: false, reason: `ledger ${ref.path} is missing` };
  const actual = sha256(readFileSync(file));
  if (actual !== ref.sha256) return { ok: false, reason: `ledger ${ref.path} changed since the receipt was written` };
  const invocation = readInvocation({ id: ref.path, suite: '', dir: dirname(file) }, file);
  const status = runStatus({ invocations: [invocation] });
  // A red check's mutated run legitimately ends `failed`; anything else wrong with the ledger disqualifies it.
  const problems = status.problems.filter((p) => p.kind !== 'unexplained-status' || invocation.completion?.finalStatus !== 'failed');
  const fatal = problems;
  if (fatal.length > 0 || invocation.begin === null) return { ok: false, reason: `ledger ${ref.path} is incomplete or invalid (${fatal.map((p) => p.kind).join(', ') || 'no begin record'})` };
  return { ok: true, invocation, effective: effectiveConfig(invocation.begin, browsersOf(invocation)) };
}

/** Accountable occurrences: matching tuples plus unknown same-test/project tuples, never known outside ones. */
function runsOf(inv: InvocationObservation, test: { file: string; titlePath: string[] }, config: Configuration, roleHidden: boolean): ObservedTest[] {
  return inv.tests.filter(
    (t) =>
      t.declaration.file === test.file &&
      JSON.stringify(t.declaration.titlePath) === JSON.stringify(test.titlePath) &&
      t.declaration.project === config.project &&
      (roleHidden || observedOf(t) === null || matchesConfiguration(observedOf(t), t.declaration.project, config, roleHidden)),
  );
}

/** Whether every test of the project's setup dependencies passed in this ledger. */
function setupPassed(inv: InvocationObservation, project: string): string | null {
  const begin = inv.begin;
  if (begin === null) return 'no begin record';
  const byName = new Map(begin.projects.map((p) => [p.name, p]));
  const deps = new Set<string>();
  if (!byName.has(project)) return `unknown project ${project}`;
  const visit = (name: string) => {
    for (const d of byName.get(name)?.dependencies ?? []) if (!deps.has(d)) { deps.add(d); visit(d); }
  };
  visit(project);
  for (const dependency of deps) {
    if (!byName.has(dependency)) return `unknown setup dependency ${dependency}`;
    const tests = inv.tests.filter(t => t.declaration.project === dependency);
    if (tests.length === 0) return `setup dependency ${dependency} has no represented tests`;
    for (const t of tests) {
      const first = t.results[0];
      if (t.declaration.expectedStatus !== 'passed' || latestExpected(t) !== 'passed' || t.results.length !== 1 || first?.retry !== 0 || first.status !== 'passed' || first.expectedStatus !== 'passed' || first.errors.length > 0 || first.steps.some(s => s.status !== 'passed') || t.end?.outcome !== 'expected')
        return `setup test ${t.declaration.titlePath.join(' › ')} did not actually pass cleanly on its first attempt`;
    }
  }
  if (inv.errors.length > 0) return `the run reported ${inv.errors.length} run-level error(s)`;
  return null;
}

/** The red check's own judgment, recomputed from its two ledgers. Null when it holds. */
export function judgeRedCheck(evidenceDir: string, r: RedCheckRecord, config: Configuration, roleHidden: boolean, recipesDir: string, environmentInputs?: { declarations: EnvironmentInputDeclaration[]; bindings: EnvironmentBinding[] }): string | null {
  const recipe = join(recipesDir, `${r.recipeHash.replace(/^sha256:/, '')}.json`);
  if (!existsSync(recipe)) return `mutation recipe ${r.recipeHash} is missing`;
  if (`sha256:${sha256(readFileSync(recipe))}` !== r.recipeHash) return `mutation recipe ${r.recipeHash} changed`;
  try {
    const parsed = JSON.parse(readFileSync(recipe, 'utf8')) as { obligation?: unknown };
    if (!isObject(parsed.obligation) || obligationKey(parsed.obligation as ObligationRef) !== obligationKey(r.obligation))
      return 'the mutation recipe targets a different obligation';
  } catch {
    return 'the mutation recipe is not JSON';
  }
  const mutated = readLedgerRef(evidenceDir, r.mutated);
  if (!mutated.ok) return `mutated run: ${mutated.reason}`;
  const restored = readLedgerRef(evidenceDir, r.restored);
  if (!restored.ok) return `restored run: ${restored.reason}`;
  const mi = mutated.invocation.begin?.environmentInputs, ri = restored.invocation.begin?.environmentInputs;
  if (environmentInputs !== undefined) {
    // A computed projection permits unrelated values to differ; every suite observation must
    // still be valid and bound to the same declarations. Without it, retain full comparison.
    const why = behaviorEnvironmentProblem(evidenceDir,[r.mutated,r.restored],environmentInputs);
    if (why !== null) return why;
  } else if (mi !== undefined || ri !== undefined) {
    if (!validObservation(mi) || !validObservation(ri) || JSON.stringify(canonicalDeclarations(mi.declarations)) !== JSON.stringify(canonicalDeclarations(ri.declarations)) || !sameBindings(mi.bindings,ri.bindings)) return 'mutation and restoration have different behavior environment inputs';
  }
  const mutatedEnvironment = ledgerEnvironment(mutated, r.environment, config.project);
  if (mutatedEnvironment !== null) return mutatedEnvironment;
  const restoredEnvironment = ledgerEnvironment(restored, r.environment, config.project);
  if (restoredEnvironment !== null) return restoredEnvironment;
  const mutatedRuns = runsOf(mutated.invocation, r.test, config, roleHidden);
  if (mutatedRuns.length !== 1) return `the mutated run holds ${mutatedRuns.length} result(s) for this test on ${config.id}, not one`;
  const m = mutatedRuns[0] as ObservedTest;
  if (!matchesConfiguration(observedOf(m), m.declaration.project, config, roleHidden)) return 'the mutated target configuration was never observed';
  const setup = setupPassed(mutated.invocation, m.declaration.project);
  if (setup !== null) return `setup did not pass under the mutation: ${setup}`;
  if (playwrightOutcome(m.results, latestExpected(m)) !== 'unexpected') return 'the test did not fail under the mutation';
  if (m.results.length !== 1 || m.results[0]?.retry !== 0 || latestExpected(m) !== 'passed') return 'the mutation needs one first-attempt unexpected failure';
  const first = m.results[0];
  const failures = mutated.invocation.tests.flatMap((t) => t.results.flatMap((r) => {
    const failed = r.steps.filter((s) => s.status === 'failed');
    // Ancestors repeat the descendant's failure. Siblings and distinct full tuples remain independent.
    return failed.filter((s) => !failed.some((d) => d.path.length > s.path.length && s.path.every((n, i) => d.path[i] === n)));
  }));
  if (failures.length > 1) return 'the mutation failed multiple independent obligation steps; it verifies none individually';
  const at = failures[0] ?? null;
  if (at === null || at.ids === null) return 'the mutation failed outside any obligation\'s step';
  const own = innermostCarrying(first?.steps ?? [], r.obligation);
  if (own.some(s => s.status === 'skipped')) return 'the mutation skipped an independent occurrence of its target obligation';
  if (obligationKey({ case: at.ids.case, step: at.ids.step, obligation: at.ids.obligation ?? '' }) !== obligationKey(r.obligation) || !own.some((s) => s.path.length === at.path.length && s.path.every((n, i) => n === at.path[i]) && s.status === 'failed'))
    return `the mutation failed inside ${at.ids.obligation ?? 'a step with no obligation'}, not ${r.obligation.obligation}`;
  const restoredRuns = runsOf(restored.invocation, r.test, config, roleHidden);
  if (restoredRuns.length !== 1) return `the restored run holds ${restoredRuns.length} result(s) for this test on ${config.id}, not one`;
  const back = restoredRuns[0] as ObservedTest;
  if (!matchesConfiguration(observedOf(back), back.declaration.project, config, roleHidden)) return 'the restored target configuration was never observed';
  if (playwrightOutcome(back.results, latestExpected(back)) !== 'expected' || latestExpected(back) !== 'passed' || back.results.some((x) => x.retry > 0))
    return 'the test did not pass cleanly once the mutation was removed';
  const target = innermostCarrying(back.results[0]?.steps ?? [], r.obligation);
  if (target.length === 0 || target.some((s) => s.status !== 'passed')) return 'the restored target obligation did not actually pass';
  const clean = cleanRun(restored.invocation);
  if (clean !== null) return `restored run: ${clean}`;
  return null;
}

function cleanRun(invocation: InvocationObservation): string | null {
  const status = runStatus({ invocations: [invocation] });
  if (!status.complete || invocation.completion?.finalStatus !== 'passed' || invocation.tests.some((t) => latestExpected(t) !== 'passed' || t.results.length !== 1 || t.results[0]?.status !== 'passed' || t.results[0]?.retry !== 0)) return 'the evidence run did not end cleanly with first-attempt passes';
  for (const project of new Set(invocation.tests.map(t => t.declaration.project))) {
    const setup = setupPassed(invocation, project);
    if (setup !== null) return setup;
  }
  return null;
}

/** The burn-in's own judgment: at least five clean first-attempt passes of the test on the configuration. */
export function judgeBurnIn(evidenceDir: string, r: BurnInRecord, config: Configuration, roleHidden: boolean, requiredObligations: ObligationRef[]): string | null {
  if (!Array.isArray(requiredObligations) || requiredObligations.length === 0 || !requiredObligations.every(validObligation)) return 'the burn-in needs explicit full obligation identities to prove';
  const ledger = readLedgerRef(evidenceDir, r.run);
  if (!ledger.ok) return ledger.reason;
  const environment = ledgerEnvironment(ledger, r.environment, config.project);
  if (environment !== null) return environment;
  const clean = cleanRun(ledger.invocation);
  if (clean !== null) return clean;
  const runs = runsOf(ledger.invocation, r.test, config, roleHidden);
  if (runs.length < 5) return `the burn-in ran the test ${runs.length} time(s) on ${config.id}, fewer than five`;
  const bad = runs.filter((t) => latestExpected(t) !== 'passed' || t.results.length !== 1 || t.results[0]?.status !== 'passed' || t.results[0].steps.some((s) => s.ids?.obligation != null && s.status !== 'passed'));
  if (bad.length > 0) return `${bad.length} of ${runs.length} repeats did not pass on the first attempt`;
  for (const [index, t] of runs.entries()) for (const ref of requiredObligations) {
    const witnesses = innermostCarrying(t.results[0]?.steps ?? [], ref);
    if (witnesses.length === 0 || witnesses.some((s) => s.status !== 'passed' || s.ids === null || !matchesConfiguration({project:s.ids.project,viewport:s.ids.viewport,role:s.ids.role.name,browser:s.ids.browser},t.declaration.project,config,roleHidden)))
      return `repeat ${index + 1} has no actual passing witness for ${obligationKey(ref)} on ${config.id}`;
  }
  return null;
}

/** Why the receipt's material effective configuration differs from the current run's, or null. */
function materialDifference(then: MaterialConfig | null, now: MaterialConfig | null, fields: MaterialField[]): string | null {
  if (then === null) return 'the receipt\'s ledger has no effective configuration for this project';
  if (now === null) return 'the run has no effective configuration for this project';
  const diff = fields.filter((f) => then[f] !== now[f]);
  return diff.length === 0 ? null : `ran under a different ${diff.map((f) => `${f} (${String(then[f])} then, ${String(now[f])} now)`).join(', ')}`;
}

/**
 * Whether a receipt made on `made` may count for `target`. Evidence never transfers by case ID alone: the
 * target must be the receipt's own configuration, or one it explicitly names, on the same project and
 * role (only the viewport may differ), and the receipt's own ledger must show the same material fields as
 * the current run.
 */
export function transferProblem(made: Configuration | undefined, target: Configuration, appliesTo: string[]): string | null {
  if (made === undefined) return 'the receipt names a configuration the profile no longer declares';
  if (made.id === target.id) return null;
  if (!appliesTo.includes(target.id)) return `the receipt is for ${made.id} and does not name ${target.id}`;
  if (made.project !== target.project) return `the receipt is for project ${made.project}, not ${target.project}`;
  if (made.role !== target.role) return `the receipt is for role ${made.role}, not ${target.role}`;
  return null;
}

// --- Per case ---

export type MappingEvidence = {
  ref: ObligationRef;
  test: string;
  configuration: string;
  sensitivity: 'verified' | 'waived' | 'unverified';
  acceptance: 'current' | 'stale' | 'missing';
  reasons: string[];
};

export type CaseEvidence = {
  case: string;
  track: Track;
  /** verified: every obligation verified. waived: some waived, none missing. developer-attested: self-derived and waived. */
  status: 'verified' | 'waived' | 'developer-attested' | 'insufficient';
  mappings: MappingEvidence[];
  problems: string[];
};

export type EvidenceContext = {
  evidenceDir: string;
  recipesDir: string;
  records: EvidenceRecord[];
  digests: DigestReport;
  /** The current run's effective configuration. */
  effective: EffectiveConfig;
  environment: EnvironmentIdentity;
  configurations: Configuration[];
  ledger: Mapping[];
  dispositions: Disposition[];
  roles: Roles;
  materialFields: MaterialField[];
};

export function evaluateCase(record: CaseRecord, track: Track, ctx: EvidenceContext): CaseEvidence {
  const problems: string[] = [];
  const mappings: MappingEvidence[] = [];
  const invalid = [...caseProblems(record), ...configurationProblems(ctx.configurations)];
  if (invalid.length > 0) return {case:record.id,track,status:'insufficient',mappings,problems:invalid};
  const caseHash = canonicalCaseHash(record);
  const toolchain = ctx.digests.toolchain.status === 'resolved' ? ctx.digests.toolchain.digest : null;
  if (ctx.digests.toolchain.status === 'unresolved') problems.push(`toolchain digest unresolved: ${ctx.digests.toolchain.reasons.join('; ')}`);
  const configById = new Map(ctx.configurations.map((c) => [c.id, c]));

  for (const step of record.steps) {
    for (const ob of step.obligations) {
      const ref: ObligationRef = { case: record.id, step: step.id, obligation: ob.id };
      for (const configId of record.configurations) {
        const config = configById.get(configId);
        const rows = ctx.ledger.filter((m) => m.configuration === configId && obligationKey(m.obligation) === obligationKey(ref));
        if (rows.length === 0 || config === undefined) {
          mappings.push({ ref, test: '', configuration: configId, sensitivity: 'unverified', acceptance: 'missing', reasons: [config === undefined ? 'the configuration is not declared' : 'no test claims it'] });
          continue;
        }
        for (const m of rows) {
          const reasons: string[] = [];
          if (ob.layer === 'served' && m.layer !== 'served') reasons.push('a synthetic test can\'t prove a served obligation');
          const digest = ctx.digests.behavior.get(behaviorKey(m.test, config.project));
          const current = digest?.status === 'resolved' ? digest.digest : null;
          if (digest === undefined) reasons.push('the test is not in the resolved suite');
          else if (digest.status === 'unresolved') reasons.push(...digest.reasons.map((r) => `behavior digest unresolved: ${r}`));
          const roleHidden = ctx.digests.roleOverrideFiles.has(`${m.test.suite}::${m.test.file}`);
          const now = materialOf(ctx.effective, config.project);

          let verified = false;
          let burned = false;
          if (current !== null && toolchain !== null && reasons.length === 0) {
            const bound = (r: { behaviorDigest: string; toolchainDigest: string }) =>
              r.behaviorDigest !== current ? 'it is for an earlier behavior digest' : r.toolchainDigest !== toolchain ? 'it is for an earlier toolchain digest' : null;
            const checks = ctx.records.filter(
              (r): r is RedCheckRecord => r.kind === 'red-check' && obligationKey(r.obligation) === obligationKey(ref) && sameTest(r.test, m.test),
            );
            const red = checks.find((r) => {
              const made = configById.get(r.configuration);
              const why =
                bound(r) ??
                environmentProblem(ctx, r.environment, [r.mutated, r.restored], config.project) ??
                behaviorEnvironmentProblem(ctx.evidenceDir,[r.mutated,r.restored], digest?.status === 'resolved' ? digest.environmentInputs : undefined) ??
                transferProblem(made, config, r.appliesTo) ??
                judgeRedCheck(ctx.evidenceDir, r, made as Configuration, ctx.digests.roleOverrideFiles.has(`${r.test.suite}::${r.test.file}`), ctx.recipesDir, digest?.status === 'resolved' ? digest.environmentInputs : undefined) ??
                ledgerMaterial(ctx.evidenceDir, r.mutated, config.project, now, ctx.materialFields);
              if (why !== null) reasons.push(`red check ${r.id}: ${why}`);
              return why === null;
            });
            if (checks.length === 0) reasons.push('no red check');
            const burns = ctx.records.filter((r): r is BurnInRecord => r.kind === 'burn-in' && sameTest(r.test, m.test));
            const burn = burns.find((r) => {
              const made = configById.get(r.configuration);
              const why =
                bound(r) ??
                environmentProblem(ctx, r.environment, [r.run], config.project) ??
                behaviorEnvironmentProblem(ctx.evidenceDir,[r.run], digest?.status === 'resolved' ? digest.environmentInputs : undefined) ??
                transferProblem(made, config, r.appliesTo) ??
                judgeBurnIn(ctx.evidenceDir, r, made as Configuration, roleHidden, ctx.ledger.filter((row) => sameTest(row.test, m.test) && row.configuration === configId).map((row) => row.obligation)) ??
                ledgerMaterial(ctx.evidenceDir, r.run, config.project, now, ctx.materialFields);
              if (why !== null) reasons.push(`burn-in ${r.id}: ${why}`);
              return why === null;
            });
            if (burns.length === 0) reasons.push('no burn-in');
            burned = burn !== undefined;
            verified = red !== undefined && burned;
          }
          let sensitivity: MappingEvidence['sensitivity'] = verified ? 'verified' : 'unverified';
          if (!verified) {
            const w = waiverFor(ctx.dispositions, ctx.roles, track, ref, caseHash);
            for (const r of w.refused) reasons.push(`waiver refused: ${r.reason}`);
            // A waiver stands in for a red check; it can't make a synthetic test prove a served obligation.
            if (w.waiver !== null && burned && current !== null && toolchain !== null && !(ob.layer === 'served' && m.layer !== 'served')) sensitivity = 'waived';
          }

          const accepts = ctx.records.filter((r): r is AcceptanceRecord => r.kind === 'acceptance' && r.case === record.id && sameTest(r.test, m.test));
          let acceptance: MappingEvidence['acceptance'] = accepts.length === 0 ? 'missing' : 'stale';
          for (const a of accepts) {
            const why =
              ownerRoleHolds(ctx.roles, track, a) ??
              (a.caseHash !== caseHash ? 'the case changed since it was accepted' : current === null || a.behaviorDigest !== current ? 'the test changed since it was accepted' : null);
            if (why === null) acceptance = 'current';
            else reasons.push(`acceptance ${a.id}: ${why}`);
          }
          mappings.push({ ref, test: testKey(m.test), configuration: configId, sensitivity, acceptance, reasons: sensitivity === 'verified' && acceptance === 'current' ? [] : reasons });
        }
      }
    }
  }
  const sufficient = mappings.length > 0 && mappings.every((m) => m.sensitivity !== 'unverified' && m.acceptance === 'current') && problems.length === 0;
  const waived = mappings.some((m) => m.sensitivity === 'waived');
  const status: CaseEvidence['status'] = !sufficient
    ? 'insufficient'
    : waived && track === 'addendum' && isSelfDerived(record)
      ? 'developer-attested'
      : waived
        ? 'waived'
        : 'verified';
  return { case: record.id, track, status, mappings, problems };
}

/** Historical ledgers must show the same declared readers and values as current behavior inputs. */
function behaviorEnvironmentProblem(evidenceDir: string, refs: LedgerRef[], current: { declarations: EnvironmentInputDeclaration[]; bindings: EnvironmentBinding[] } | undefined): string | null {
  for (const ref of refs) {
    const ledger = readLedgerRef(evidenceDir,ref);
    if (!ledger.ok) return ledger.reason;
    const observed = ledger.invocation.begin?.environmentInputs;
    if (current === undefined) {
      // An absent projection is the older no-declaration path, not a proven empty projection.
      if (observed !== undefined && observed.declarations.length > 0) return 'receipt has behavior environment inputs absent from the current digest';
      continue;
    }
    if (!validObservation(observed) || observationProblems(observed).length > 0 || JSON.stringify(canonicalDeclarations(current.declarations)) !== JSON.stringify(canonicalDeclarations(observed.declarations)) || !sameBindings(current.bindings,observed.bindings.filter(b => current.bindings.some(c => c.name === b.name)))) return 'receipt behavior environment inputs differ or have no invocation binding';
  }
  return null;
}

/** The material fields a receipt's own ledger shows for the project, compared with the current run's. */
function ledgerMaterial(evidenceDir: string, ref: LedgerRef, project: string, now: MaterialConfig | null, fields: MaterialField[]): string | null {
  const ledger = readLedgerRef(evidenceDir, ref);
  if (!ledger.ok) return ledger.reason;
  return materialDifference(materialOf(ledger.effective, project), now, fields);
}

/** Target environment identity is separate; explicitly declared BASE_URL also binds behavior conservatively. */
function environmentProblem(ctx: EvidenceContext, environment: EnvironmentIdentity, refs: LedgerRef[], project: string): string | null {
  if (!validEnvironment(environment) || canonicalJson(environment) !== canonicalJson(ctx.environment)) return 'the receipt is for a different or unknown target environment';
  const now = ctx.effective.projects.find((p) => p.name === project);
  if (now?.baseURL !== ctx.environment.baseUrl) return 'the current effective baseURL does not match the target environment';
  for (const ref of refs) {
    const ledger = readLedgerRef(ctx.evidenceDir, ref);
    if (!ledger.ok) return ledger.reason;
    if (canonicalJson(ledger.invocation.begin?.environment) !== canonicalJson(environment) || ledger.effective.projects.find((p) => p.name === project)?.baseURL !== environment.baseUrl)
      return 'the receipt ledger does not match its target environment';
  }
  return null;
}

function ledgerEnvironment(ledger: Extract<LedgerRead, {ok:true}>, environment: EnvironmentIdentity, project: string): string | null {
  return !validEnvironment(environment) || canonicalJson(ledger.invocation.begin?.environment) !== canonicalJson(environment) || ledger.effective.projects.find((p) => p.name === project)?.baseURL !== environment.baseUrl
    ? 'the evidence ledger has an unknown or different target environment' : null;
}
