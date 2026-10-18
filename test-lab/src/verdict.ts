// The verdict (plan §2): a fixed function of recomputed facts, never of a model, the mod or a stored
// conclusion. Rules apply top to bottom and the first that matches decides:
//
//   1 not evaluable  the regression set is undeclared or empty, the profile is invalid, or the scope
//                    (QA's transitions, the work binding, the scope log and its journal) can't be trusted
//   2 inconclusive   build identity unknown, or changed during the run
//   3 inconclusive   the run did not complete or end cleanly, or a required fixture is missing
//   4 inconclusive   the outage breaker tripped
//   5 not ready      any required case, on any applicable configuration, is anything but passed; or any
//                    executed test in a required lane is anything but passed
//   6 not ready      any governed test failed or was flaky with no live risk acceptance
//   7 inconclusive   any required case lacks verified or waived sensitivity evidence, or an acceptance is stale
//   8 ready          with every named exception listed
//
// Every page lists every failure seen, whatever the verdict, so an inconclusive run never hides one.

import type { BreakerResult } from './breaker.ts';
import { acceptedRisk } from './dispositions.ts';
import type { CaseEvidence } from './evidence.ts';
import type { FixtureCheck } from './fixtures.ts';
import type { IdentityResult } from './identity.ts';
import { testKey, type RiskAcceptance } from './model.ts';
import type { Failure, NormalizedRun, Outcome, RequiredCaseResult } from './normalize.ts';
import type { RegressionCheck } from './regression.ts';
import type { RunProblem, RunStatus } from './run-observation.ts';
import type { ScopeEvent, WorkCheck, WorkResolution } from './work.ts';

export type VerdictKind = 'not-evaluable' | 'inconclusive' | 'not-ready' | 'ready';
export type Rule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type VerdictInput = {
  profileProblems: string[];
  regression: RegressionCheck;
  work: { resolution: WorkResolution; check: WorkCheck | null };
  identity: IdentityResult;
  /** Required cases the profile marks as configuration-dependent: configuration drift gates only these. */
  configurationDependent: string[];
  runStatus: RunStatus;
  fixtures: FixtureCheck[];
  requiredFixtures: string[];
  breaker: BreakerResult;
  normalized: NormalizedRun;
  riskAcceptances: RiskAcceptance[];
  evidence: CaseEvidence[];
};

export type Verdict = {
  verdict: VerdictKind;
  rule: Rule;
  reasons: string[];
  /** Every failure seen in every lane, with the risk acceptance that cleared it, if any. */
  failures: (Failure & { acceptance: string | null })[];
  /** Named exceptions on a ready page (and listed on every other page too). */
  exceptions: string[];
  scopeChanges: ScopeEvent[];
  required: RequiredCaseResult[];
  outside: string[];
};

const NOT_PASSED: Outcome[] = ['failed', 'flaky', 'skipped', 'expected-failure', 'not-run'];

function describeRunProblem(p: RunProblem): string {
  switch (p.kind) {
    case 'ledger-missing':
      return `invocation ${p.invocation} left no step ledger`;
    case 'ledger-invalid':
      return `invocation ${p.invocation}'s ledger is invalid: ${p.detail}`;
    case 'completion-missing':
      return `invocation ${p.invocation} has no completion record (interrupted)`;
    case 'interrupted':
      return `invocation ${p.invocation} was interrupted`;
    case 'timed-out':
      return `invocation ${p.invocation} hit its global timeout`;
    case 'run-error':
      return `invocation ${p.invocation} reported a run-level error: ${p.error.message.split('\n')[0] ?? ''}`;
    case 'no-tests':
      return `invocation ${p.invocation} ran no tests`;
    case 'unexplained-status':
      return `invocation ${p.invocation} ended ${p.finalStatus}, and no test result explains it`;
  }
}

export function decide(input: VerdictInput): Verdict {
  const n = input.normalized;
  const failures = n.tests
    .filter((t) => t.failure !== null)
    .map((t) => {
      const f = t.failure as Failure;
      const r = t.lane === 'governed' ? acceptedRisk(input.riskAcceptances, f.test, f.project, f.signature) : null;
      return { ...f, acceptance: r?.id ?? null };
    });
  const scopeChanges = input.work.check?.events ?? [];
  const outside = n.tests.filter((t) => t.lane === 'outside').map((t) => `${testKey(t.test)} [${t.project}]: ${t.outcome}`);
  const exceptions = exceptionsOf(input, failures);
  const verdict = (kind: VerdictKind, rule: Rule, reasons: string[]): Verdict => ({
    verdict: kind,
    rule,
    reasons,
    failures,
    exceptions,
    scopeChanges,
    required: n.required,
    outside,
  });

  // Rule 1.
  const r1: string[] = [...input.profileProblems];
  if (input.regression.set.length === 0) r1.push('QA\'s regression set is undeclared or empty: an addendum alone can\'t make a verdict');
  r1.push(...input.regression.problems);
  const res = input.work.resolution;
  if (res.status === 'unresolved') r1.push(`which work this run judges is unresolved: ${res.reason}${res.suggestion === null ? '' : ` (did you mean ${res.suggestion}?)`}`);
  if (res.status === 'bound' && input.work.check === null) r1.push(`work ${res.ticket} has no declaration`);
  if (input.work.check !== null && !input.work.check.ok) r1.push(...input.work.check.problems.map((p) => `work: ${p.kind}${'detail' in p ? `: ${p.detail}` : ''}`));
  for (const id of [...input.regression.set, ...(input.work.check?.addendum ?? [])])
    if (!n.required.some((c) => c.case === id)) r1.push(`required case ${id} is missing from the normalized denominator`);
  r1.push(...n.problems.filter((p) => p.startsWith('required case')));
  if (r1.length > 0) return verdict('not-evaluable', 1, r1);

  // Rule 2.
  const r2 = [...input.identity.unknown, ...input.identity.notEvaluable];
  const dependent = new Set(input.configurationDependent);
  if (input.identity.configDrift.length > 0) {
    const gated = n.required.filter((c) => dependent.has(c.case)).map((c) => c.case);
    if (gated.length > 0)
      r2.push(`configuration differs from the code (${input.identity.configDrift.join(', ')}), and these required cases depend on it: ${[...new Set(gated)].join(', ')}`);
  }
  if (r2.length > 0) return verdict('inconclusive', 2, r2);

  // Rule 3.
  const r3 = input.runStatus.problems.map(describeRunProblem);
  const requiredFixtures = new Set(input.requiredFixtures);
  for (const f of input.fixtures) if (requiredFixtures.has(f.fixture) && f.existence === 'missing') r3.push(`required fixture ${f.fixture} is missing: ${f.detail}`);
  if (r3.length > 0) return verdict('inconclusive', 3, r3);

  // Rule 4.
  if (input.breaker.tripped) return verdict('inconclusive', 4, [`environment problem: ${input.breaker.reason}`]);

  // Rule 5.
  const r5: string[] = [];
  for (const c of n.required) {
    if (c.outcome === 'passed') continue;
    const why = c.obligations.filter((o) => o.outcome !== 'passed').map((o) => `${o.ref.obligation} ${o.outcome}${o.reason === null ? '' : ` (${o.reason})`}`);
    r5.push(`required ${c.track} case ${c.case} on ${c.configuration} is ${c.outcome}${c.quarantined ? ' (a quarantine on a required case never takes effect)' : ''}: ${why.join('; ')}`);
  }
  for (const t of n.tests) {
    if ((t.lane === 'required-regression' || t.lane === 'required-addendum') && NOT_PASSED.includes(t.outcome))
      r5.push(`${testKey(t.test)} [${t.project}], in the ${t.lane} lane, is ${t.outcome}`);
  }
  if (r5.length > 0) return verdict('not-ready', 5, [...new Set(r5)]);

  // Rule 6.
  const r6 = n.tests
    .filter((t) => t.lane === 'governed' && (t.outcome === 'failed' || t.outcome === 'flaky'))
    .filter((t) => t.failure === null || acceptedRisk(input.riskAcceptances, t.failure.test, t.failure.project, t.failure.signature) === null)
    .map((t) => `governed test ${testKey(t.test)} [${t.project}] is ${t.outcome}, with no live risk acceptance${t.failure === null ? '' : `: ${t.failure.message.split('\n')[0] ?? ''}`}`);
  if (r6.length > 0) return verdict('not-ready', 6, r6);

  // Rule 7.
  const requiredIds = new Set([...input.regression.set, ...(input.work.check?.addendum ?? []), ...n.required.map((c) => c.case)]);
  const r7: string[] = [];
  for (const id of requiredIds) {
    const e = input.evidence.find((x) => x.case === id);
    if (e === undefined) r7.push(`required case ${id} has no evidence evaluation`);
    else if (e.status === 'insufficient') {
      const why = [...e.problems, ...e.mappings.flatMap((m) => (m.sensitivity === 'unverified' || m.acceptance !== 'current' ? [`${m.ref.obligation} on ${m.configuration}: ${m.reasons.join('; ') || `${m.sensitivity}, acceptance ${m.acceptance}`}`] : []))];
      r7.push(`required case ${id} lacks verified or waived evidence, or a current acceptance: ${why.join(' | ')}`);
    }
  }
  if (r7.length > 0) return verdict('inconclusive', 7, r7);

  return verdict('ready', 8, ['every rule above held']);
}

function exceptionsOf(input: VerdictInput, failures: (Failure & { acceptance: string | null })[]): string[] {
  const out: string[] = [];
  const res = input.work.resolution;
  if (res.status === 'none') out.push('run with --no-work: the addendum is empty');
  else if (input.work.check !== null && input.work.check.addendum.length === 0) out.push('the addendum is empty');
  if (input.work.check?.uncheckedBefore !== null && input.work.check?.uncheckedBefore !== undefined)
    out.push(`scope history before ${input.work.check.uncheckedBefore} was taken from the committed log, not checked`);
  for (const e of input.evidence) {
    if (e.status === 'waived') out.push(`case ${e.case}: sensitivity waived, not verified`);
    if (e.status === 'developer-attested') out.push(`case ${e.case}: developer-attested (self-derived and waived), not verified`);
  }
  for (const f of failures) if (f.acceptance !== null) out.push(`risk acceptance ${f.acceptance} clears ${testKey(f.test)} [${f.project}]`);
  for (const t of input.normalized.tests) {
    if (t.lane === 'quarantined') out.push(`quarantined ${testKey(t.test)} [${t.project}]: ${t.outcome} (${t.quarantine?.ticket ?? ''})`);
    if ((t.lane === 'legacy' || t.lane === 'visual') && t.outcome !== 'passed') out.push(`${t.lane} ${testKey(t.test)} [${t.project}]: ${t.outcome}`);
  }
  for (const c of input.identity.checks) if (c.status === 'not-checked' || c.status === 'declared') out.push(`identity ${c.name}: ${c.status} (${c.detail})`);
  if (input.identity.configDrift.length > 0) out.push(`configuration drift (gates only configuration-dependent cases): ${input.identity.configDrift.join(', ')}`);
  for (const f of input.fixtures) if (f.existence === 'not-established') out.push(`fixture ${f.fixture}: existence not established (${f.detail})`);
  for (const f of input.fixtures) if (f.structure !== null) out.push(`fixture ${f.fixture}: structure "${f.structure}" is observed by its spec, not by preflight`);
  return out;
}
