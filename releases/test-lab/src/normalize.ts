import { caseProblems, configurationProblems } from './cases.ts';
// Result normalization (plan §2): every executed test is placed in one lane and given one outcome, and
// every required case gets an outcome per declared configuration and obligation. Outcomes come from
// Playwright's own outcome algorithm and the expected status, never from the raw status or the exit code.

import type { StepAttachment, StepRecord } from '../kit/records.ts';
import { hashOf } from './canonical.ts';
import { laneClassOf, type ClassificationRule } from './dispositions.ts';
import {
  obligationKey,
  sameTest,
  testKey,
  type CaseRecord,
  type Configuration,
  type Mapping,
  type ObligationRef,
  type Quarantine,
  type TestIdentity,
  type Track,
  type Viewport,
} from './model.ts';
import { latestExpected, playwrightOutcome, type ObservedTest, type RunObservation } from './run-observation.ts';

export type Outcome = 'passed' | 'failed' | 'flaky' | 'skipped' | 'expected-failure' | 'not-run';
export type Lane = 'required-regression' | 'required-addendum' | 'governed' | 'quarantined' | 'legacy' | 'visual' | 'excluded' | 'outside';

export const BLOCKING_LANES: readonly Lane[] = ['required-regression', 'required-addendum', 'governed'];

/** Worst first: the order a combined outcome takes. */
const SEVERITY: Outcome[] = ['failed', 'flaky', 'not-run', 'skipped', 'expected-failure', 'passed'];
export const worst = (outcomes: Outcome[]): Outcome =>
  outcomes.reduce<Outcome>((a, b) => (SEVERITY.indexOf(a) <= SEVERITY.indexOf(b) ? a : b), 'passed');

/** What a test really ran under, from its caseStep attachments; null if it recorded none or changed mid-test. */
export type ObservedConfig = { project: string; viewport: Viewport | null; role: string; browser: { name: string; version: string } | null };

export type Failure = {
  test: TestIdentity;
  project: string;
  invocation: string;
  lane: Lane;
  outcome: Outcome;
  message: string;
  stepPath: number[] | null;
  obligation: string | null;
  signature: string;
  /** Failures that are build failures, never outages (§8): an HTTP 5xx page or a locator timeout. */
  classPrefill: 'application error' | null;
};

export type NormalizedTest = {
  test: TestIdentity;
  project: string;
  invocation: string;
  lane: Lane;
  outcome: Outcome;
  observed: ObservedConfig | null;
  boundCases: string[];
  failure: Failure | null;
  quarantine: Quarantine | null;
};

export type ObligationResult = { ref: ObligationRef; outcome: Outcome; tests: string[]; reason: string | null };

export type RequiredCaseResult = {
  case: string;
  track: Track;
  priority: string;
  configuration: string;
  outcome: Outcome;
  obligations: ObligationResult[];
  quarantined: boolean;
};

export type NormalizeInput = {
  run: RunObservation;
  configurations: Configuration[];
  cases: Map<string, CaseRecord>;
  required: { regression: string[]; addendum: string[] };
  ledger: Mapping[];
  classification: ClassificationRule[];
  liveQuarantines: Quarantine[];
  quarantinesOnRequired: Quarantine[];
  /** Files whose describe blocks set storageState: their role can't be observed until the after-setup probe. */
  roleOverrideFiles: Set<string>;
};

export type NormalizedRun = { tests: NormalizedTest[]; required: RequiredCaseResult[]; problems: string[] };

function outcomeOf(test: ObservedTest): Outcome {
  const expected = latestExpected(test);
  const completed = test.results.filter((r) => r.status !== 'interrupted' && !(r.status === 'skipped' && expected !== 'skipped'));
  if (completed.length === 0) return 'not-run';
  switch (playwrightOutcome(test.results, expected)) {
    case 'skipped':
      return 'skipped';
    case 'expected':
      return expected === 'failed' ? 'expected-failure' : expected === 'skipped' ? 'skipped' : 'passed';
    case 'unexpected':
      return 'failed';
    case 'flaky':
      return 'flaky';
  }
}

function idsOf(steps: StepRecord[]): StepAttachment[] {
  return steps.flatMap((s) => (s.ids === null ? [] : [s.ids]));
}

export function observedOf(test: ObservedTest): ObservedConfig | null {
  const last = test.results.at(-1);
  if (last === undefined) return null;
  const ids = idsOf(last.steps);
  const first = ids[0];
  if (first === undefined) return null;
  const same = ids.every(
    (i) => i.project === first.project && JSON.stringify(i.viewport) === JSON.stringify(first.viewport) && i.role.name === first.role.name,
  );
  if (!same) return null;
  return { project: first.project, viewport: first.viewport, role: first.role.name, browser: first.browser };
}

/** Whether a result's observed configuration is the declared one. The role must be observable, not assumed. */
export function matchesConfiguration(observed: ObservedConfig | null, project: string, config: Configuration, roleHidden: boolean): boolean {
  if (observed === null || project !== config.project || observed.project !== config.project) return false;
  if (config.viewport === null || observed.viewport === null) {
    if (config.viewport !== observed.viewport) return false;
  } else if (observed.viewport.width !== config.viewport.width || observed.viewport.height !== config.viewport.height) return false;
  if (roleHidden) return false;
  return observed.role === config.role;
}

const ANSI = /\u001b\[[0-9;]*m/g;

/** The first line of a message with ANSI codes, numbers and quoted values that vary between runs removed. */
export function normalizeMessage(message: string): string {
  const first = message.replace(ANSI, '').split('\n').find((l) => l.trim() !== '') ?? '';
  return first.replace(/\d+(\.\d+)?/g, 'N').replace(/\s+/g, ' ').trim();
}

const APPLICATION = [/\b5\d\d\b/, /locator\.[a-zA-Z]+: Timeout/i, /expect\(.*\)\.[a-zA-Z]+.*failed/i, /Timed out \d+ms waiting for expect/i];

function failureOf(test: ObservedTest, lane: Lane, outcome: Outcome): Failure | null {
  if (outcome !== 'failed' && outcome !== 'flaky') return null;
  const result = test.results.find((r) => r.status !== r.expectedStatus && r.status !== 'skipped' && r.status !== 'interrupted');
  if (result === undefined) return null;
  const innermost = deepestFailure(result.steps);
  const message = result.errors[0]?.message ?? (result.status === result.expectedStatus ? '' : `status ${result.status}, expected ${result.expectedStatus}`);
  const signature = hashOf({ step: innermost?.path ?? null, message: normalizeMessage(message) });
  return {
    test: { ...testIdentityOf(test) },
    project: test.declaration.project,
    invocation: test.invocation,
    lane,
    outcome,
    message,
    stepPath: innermost?.path ?? null,
    obligation: innermost?.ids?.obligation ?? null,
    signature,
    classPrefill: APPLICATION.some((re) => re.test(message.replace(ANSI, ''))) ? 'application error' : null,
  };
}

const testIdentityOf = (test: ObservedTest): TestIdentity => test.identity;

/** The steps that carry an obligation's ID, innermost only: a nested step's error also marks its parents. */
export function innermostCarrying(steps: StepRecord[], ref: ObligationRef): StepRecord[] {
  const carrying = steps.filter((s) => s.ids?.case === ref.case && s.ids.step === ref.step && s.ids.obligation === ref.obligation);
  // Only a structural carrying ancestor repeats a descendant. A deeper sibling is independent,
  // so it must never hide this occurrence's skip/failure in normalization or evidence callers.
  return carrying.filter((s) => !carrying.some((d) => d.path.length > s.path.length && s.path.every((n, i) => d.path[i] === n)));
}

/** The innermost failed step of a result, and the obligation it carries: the deepest failing obligation. */
export function deepestFailure(steps: StepRecord[]): StepRecord | null {
  return steps.filter((s) => s.status === 'failed').reduce<StepRecord | null>((a, s) => (a === null || s.depth > a.depth ? s : a), null);
}

/**
 * The obligation's own outcome in a test. A test that did not pass never gives a passing witness for any
 * of its obligations: the obligation is failed when its own innermost step failed, and otherwise takes the
 * test's outcome. A passing test covers an obligation only when the innermost step carrying it passed.
 */
function obligationOutcome(test: ObservedTest, testOutcome: Outcome, ref: ObligationRef): { outcome: Outcome; reason: string | null } {
  const last = test.results.at(-1);
  const innermost = innermostCarrying(last?.steps ?? [], ref);
  if (testOutcome !== 'passed') {
    if (innermost.some((s) => s.status === 'failed')) return { outcome: 'failed', reason: null };
    const at = last === undefined ? null : deepestFailure(last.steps);
    return { outcome: testOutcome, reason: at?.ids?.obligation != null ? `the test failed in ${at.ids.obligation}` : `the test was ${testOutcome}` };
  }
  if (innermost.length === 0) return { outcome: 'not-run', reason: 'no step carries this obligation' };
  if (innermost.some((s) => s.status === 'failed')) return { outcome: 'failed', reason: null };
  if (innermost.some((s) => s.status === 'skipped')) return { outcome: 'skipped', reason: 'the obligation\'s step skipped' };
  return { outcome: 'passed', reason: null };
}

export function normalize(input: NormalizeInput): NormalizedRun {
  const problems: string[] = configurationProblems(input.configurations).map((p) => `required case configuration: ${p}`);
  const allRequired = [...input.required.regression, ...input.required.addendum];
  if (new Set(allRequired).size !== allRequired.length) problems.push('required case identities are duplicated');
  for (const [key, record] of input.cases) if (key !== record.id) problems.push(`required case record ${key} has mismatched ID ${record.id}`);
  const configById = new Map(input.configurations.map((c) => [c.id, c]));
  const requiredTrack = new Map<string, Track>();
  for (const id of input.required.regression) requiredTrack.set(id, 'regression');
  for (const id of input.required.addendum) if (!requiredTrack.has(id)) requiredTrack.set(id, 'addendum');

  const executed = input.run.invocations.flatMap((inv) => inv.tests);
  // An identity outside the persisted graph is unknown, rather than an observable outside tuple.
  // Keep such failures in a blocking lane while runStatus reports the invalid ledger under rule 3.
  const invalidProjects = new Set(input.run.invocations.flatMap(inv => inv.tests.filter(t =>
    !inv.begin?.projects.some(p => p.name === t.declaration.project) ||
    t.results.some(r => r.steps.some(s => s.ids !== null && s.ids.project !== t.declaration.project)),
  )));
  const observed = new Map(executed.map((t) => [t, invalidProjects.has(t) ? null : observedOf(t)]));

  const tests: NormalizedTest[] = executed.map((t) => {
    const outcome = outcomeOf(t);
    const obs = observed.get(t) ?? null;
    const roleHidden = input.roleOverrideFiles.has(`${t.identity.suite}::${t.identity.file}`);
    const annotated = t.declaration.annotations.filter((a) => a.type === 'case' && a.description !== undefined).map((a) => a.description as string);
    const mappings = input.ledger.filter((m) => sameTest(m.test, t.identity));
    const named = [...new Set([...annotated, ...mappings.map((m) => m.obligation.case)])];
    // A case ID with no case record can't declare configurations, so it can't move a test out of the
    // blocking lane: the test stays governed and the unknown ID is a problem.
    for (const id of named) if (!input.cases.has(id)) problems.push(`${testKey(t.identity)} names case ${id}, which has no case record`);
    const boundCases = named.filter((id) => input.cases.has(id));
    const classOf = laneClassOf(input.classification, t.identity.suite, t.declaration.project, t.identity.file);
    let lane: Lane;
    // A tuple counts for a case only when some declared configuration of a case it is bound to matches it.
    const declaredTuples = boundCases.flatMap((id) => (input.cases.get(id)?.configurations ?? []).map((c) => ({ id, config: configById.get(c) })));
    const matching = declaredTuples.filter((d) => d.config !== undefined && matchesConfiguration(obs, t.declaration.project, d.config, roleHidden));
    // A result goes outside the verdict only when its tuple is known and no bound case declares it. A test
    // whose configuration can't be observed (it failed before its first caseStep, or its role is set in a
    // describe block) stays in a blocking lane: an unknown tuple never escapes.
    const knowable = obs !== null && !roleHidden;
    const accountable = knowable ? matching : declaredTuples.filter(d => d.config?.project === t.declaration.project);
    if (classOf !== 'governed') lane = classOf;
    else if (boundCases.length > 0 && matching.length === 0 && knowable) lane = 'outside';
    else if (accountable.some((d) => requiredTrack.get(d.id) === 'regression')) lane = 'required-regression';
    else if (accountable.some((d) => requiredTrack.get(d.id) === 'addendum')) lane = 'required-addendum';
    else lane = 'governed';
    const quarantine = lane === 'governed' ? (input.liveQuarantines.find((q) => sameTest(q.test, t.identity)) ?? null) : null;
    if (quarantine !== null) lane = 'quarantined';
    return { test: t.identity, project: t.declaration.project, invocation: t.invocation, lane, outcome, observed: obs, boundCases, failure: failureOf(t, lane, outcome), quarantine };
  });

  const required: RequiredCaseResult[] = [];
  for (const [caseId, track] of requiredTrack) {
    const record = input.cases.get(caseId);
    if (record === undefined) {
      problems.push(`required case ${caseId} has no approved case record`);
      continue;
    }
    const invalid = caseProblems(record);
    if (invalid.length > 0) {
      problems.push(...invalid.map((p) => `required case ${caseId}: ${p}`));
      problems.push(`required case ${caseId} has invalid content or configurations`);
      required.push({ case: caseId, track, priority: record.priority, configuration: '', outcome: 'not-run', obligations: [], quarantined: false });
      continue;
    }
    const quarantined = input.quarantinesOnRequired.some((q) => input.ledger.some((m) => m.obligation.case === caseId && sameTest(m.test, q.test)));
    for (const configId of record.configurations) {
      const config = configById.get(configId);
      if (config === undefined) problems.push(`required case ${caseId}: undeclared configuration ${configId}`);
      const obligations: ObligationResult[] = [];
      for (const step of record.steps) {
        for (const ob of step.obligations) {
          const ref: ObligationRef = { case: caseId, step: step.id, obligation: ob.id };
          if (config === undefined) {
            obligations.push({ ref, outcome: 'not-run', tests: [], reason: `configuration ${configId} is not declared in the profile` });
            continue;
          }
          const mapped = input.ledger.filter((m) => m.configuration === configId && obligationKey(m.obligation) === obligationKey(ref));
          if (mapped.length === 0) {
            obligations.push({ ref, outcome: 'not-run', tests: [], reason: 'no test claims this obligation on this configuration' });
            continue;
          }
          const outcomes: Outcome[] = [];
          const keys: string[] = [];
          let reason: string | null = null;
          for (const m of mapped) {
            keys.push(testKey(m.test));
            if (laneClassOf(input.classification, m.test.suite, config.project, m.test.file) !== 'governed') {
              outcomes.push('not-run');
              reason = 'its test is not in a governed suite, so it can\'t count as coverage';
              continue;
            }
            const roleHidden = input.roleOverrideFiles.has(`${m.test.suite}::${m.test.file}`);
            const runs = executed.filter(
              (t) => sameTest(t.identity, m.test) && matchesConfiguration(observed.get(t) ?? null, t.declaration.project, config, roleHidden),
            );
            // Every same-test/project occurrence is accountable, even alongside matching passes.
            // An unobserved tuple can't prove it ran outside this required configuration. A known
            // different tuple still stays outside; an unknown pass supplies no passing witness.
            const unknown = executed.filter((t) => sameTest(t.identity, m.test) && t.declaration.project === config.project && (roleHidden || (observed.get(t) ?? null) === null));
            if (unknown.length > 0 || runs.length === 0) {
              const seen = unknown.map((t) => outcomeOf(t)).map((o) => (o === 'passed' ? 'not-run' : o));
              outcomes.push(seen.length === 0 ? 'not-run' : worst(seen));
              reason = roleHidden
                ? 'its role is set in a describe block and can\'t be observed before the after-setup role probe'
                : seen.length > 0
                  ? 'the test ran, but its configuration was never observed (no caseStep reached)'
                  : 'no result for this test under this configuration';
            }
            for (const run of runs) {
              const own = obligationOutcome(run, outcomeOf(run), ref);
              outcomes.push(own.outcome);
              reason ??= own.reason;
            }
          }
          const outcome = worst(outcomes);
          obligations.push({ ref, outcome, tests: keys, reason: outcome === 'passed' ? null : reason });
        }
      }
      const outcome = quarantined ? worst([...obligations.map((o) => o.outcome), 'not-run']) : worst(obligations.map((o) => o.outcome));
      if (obligations.length === 0) problems.push(`required case ${caseId} has no obligations`);
      required.push({
        case: caseId,
        track,
        priority: record.priority,
        configuration: configId,
        outcome: obligations.length === 0 ? 'not-run' : outcome,
        obligations,
        quarantined,
      });
    }
  }
  return { tests, required, problems };
}
