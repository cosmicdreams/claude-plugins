// Human decisions and the roles that may make them (plan §3, §4, §5, §8). Every record is checked when it
// is read: a decision taken by someone outside the role it needs is refused, listed, and has no effect.
// The roles are always the base branch's, never the branch's own profile, so a branch can't grant itself
// the QA role (src/regression.ts gathers them).

import { canonicalJson } from './canonical.ts';
import { matchesGlob } from './glob.ts';
import {
  sameTest,
  testKey,
  type ClassificationChange,
  type ClassificationTarget,
  type Disposition,
  type LaneClass,
  type ObligationRef,
  type Quarantine,
  type RiskAcceptance,
  type RoleName,
  type Roles,
  type SensitivityWaiver,
  type TestIdentity,
  type Track,
} from './model.ts';

export type Refusal<T> = { record: T; reason: string };

/** Whether a record's claimed role holds: `qa` needs the profile's QA list, with the same stand-in flag. */
export function roleHolds(roles: Roles, record: { by: string; role: RoleName; standIn: boolean }): string | null {
  if (record.role === 'developer') return null;
  const person = roles.qa.find((p) => p.name === record.by);
  if (person === undefined) return `${record.by} does not hold the QA role`;
  if (person.standIn !== record.standIn) return `${record.by} holds the QA role ${person.standIn ? 'as a stand-in' : 'in full'}, and the record says otherwise`;
  return null;
}

/** The roles a case's owner decisions need: QA for a regression case, the developer (or QA) for an addendum case. */
export function ownerRoleHolds(roles: Roles, track: Track, record: { by: string; role: RoleName; standIn: boolean }): string | null {
  if (track === 'regression' && record.role !== 'qa') return 'a regression case needs someone in the QA role';
  return roleHolds(roles, record);
}

// --- Classification (§5) ---

export type ClassificationRule = { target: ClassificationTarget; lane: LaneClass; change: ClassificationChange };

const targetKey = (t: ClassificationTarget) => JSON.stringify([t.suite, t.project ?? null, t.glob ?? null]);

/** The lane a target had before a change, from the rules that cover it more broadly. */
function coveringLane(rules: Map<string, ClassificationRule>, target: ClassificationTarget): LaneClass | null {
  if (target.glob !== undefined) {
    const project = target.project === undefined ? undefined : rules.get(targetKey({ suite: target.suite, project: target.project }));
    if (project !== undefined) return project.lane;
  }
  if (target.glob !== undefined || target.project !== undefined) {
    return rules.get(targetKey({ suite: target.suite }))?.lane ?? null;
  }
  return null;
}

/**
 * Replays immutable baseline history first, then proposed changes in their supplied order. Only the
 * trusted baseline establishes onboarding. With no trusted baseline, new nonblocking classifications
 * need QA; an untrusted timestamp never grants an onboarding exception.
 */
export function effectiveClassification(changes: ClassificationChange[], roles: Roles, trustedBaseline: ClassificationChange[] = []) {
  const rules = new Map<string, ClassificationRule>();
  const refused: Refusal<ClassificationChange>[] = [];
  // The caller supplies immutable baseline history from Git; proposed dates never establish onboarding.
  const baseline = new Map(trustedBaseline.map((c) => [c.id, c]));
  const ordered = [...trustedBaseline, ...changes.filter((c) => !baseline.has(c.id))];
  for (const c of changes) if (baseline.has(c.id) && canonicalJson(c) !== canonicalJson(baseline.get(c.id)))
    refused.push({ record: c, reason: 'classification differs from trusted baseline history' });
  for (const change of ordered) {
    const key = targetKey(change.target);
    const own = rules.get(key);
    const current = own?.lane ?? null;
    if (change.from !== current) {
      refused.push({ record: change, reason: `it says the target was ${change.from ?? 'unclassified'}, and it was ${current ?? 'unclassified'}` });
      continue;
    }
    const before = current ?? coveringLane(rules, change.target);
    // A nonblocking broad rule may shadow a narrower governed glob of the same rank. Without a
    // complete path universe, glob intersection is not generally decidable here. Require QA whenever
    // any governed rule in an overlapping project domain could be affected; never infer disjointness.
    const possiblyGoverned = [...rules.values()].some((r) => r.lane === 'governed' &&
      r.target.suite === change.target.suite &&
      (r.target.project === undefined || change.target.project === undefined || r.target.project === change.target.project));
    if (!baseline.has(change.id) && change.to !== 'governed' && (before === null || before === 'governed' || possiblyGoverned)) {
      const why = change.role === 'qa' ? roleHolds(roles, change) : 'taking tests out of the governed lane needs the QA role; overlapping governed paths cannot be proven disjoint';
      if (why !== null) {
        refused.push({ record: change, reason: why });
        continue;
      }
    }
    rules.set(key, { target: change.target, lane: change.to, change });
  }
  return { rules: [...rules.values()], refused };
}

/** The most specific rule wins: a path glob, then a project, then the whole suite. Unclassified counts as governed. */
export function laneClassOf(rules: ClassificationRule[], suite: string, project: string, file: string): LaneClass {
  let best: { rank: number; lane: LaneClass } | null = null;
  for (const rule of rules) {
    const t = rule.target;
    if (t.suite !== suite) continue;
    if (t.project !== undefined && t.project !== project) continue;
    if (t.glob !== undefined && !matchesGlob(file, t.glob)) continue;
    const rank = (t.glob !== undefined ? 2 : 0) + (t.project !== undefined ? 1 : 0);
    if (best === null || rank > best.rank || rank === best.rank) best = { rank, lane: rule.lane };
  }
  return best?.lane ?? 'governed';
}

// --- Quarantine (§8) and risk acceptance (§2 rule 6) ---

const live = (expires: string, now: Date) => Number.isFinite(Date.parse(expires)) && Date.parse(expires) > now.getTime();

/**
 * Live quarantines: QA role, owner, ticket and an unexpired date, on a test outside the required set, within
 * the profile's cap (the earliest win). A quarantine on a required test never takes effect; it is returned
 * in `onRequired` so the verdict can treat the case as not passed.
 */
export function quarantines(dispositions: Disposition[], roles: Roles, now: Date, cap: number, required: (test: TestIdentity) => boolean) {
  const all = dispositions.filter((d): d is Quarantine => d.kind === 'quarantine');
  const refused: Refusal<Quarantine>[] = [];
  const onRequired = all.filter((q) => required(q.test));
  const valid: Quarantine[] = [];
  for (const q of all) {
    if (required(q.test)) {
      refused.push({ record: q, reason: 'a required case can\'t be quarantined; it must leave the required set first' });
      continue;
    }
    const why =
      q.role !== 'qa'
        ? 'a quarantine needs the QA role'
        : (roleHolds(roles, q) ??
          (q.owner.trim() === '' ? 'no owner' : q.ticket.trim() === '' ? 'no ticket' : !live(q.expires, now) ? 'expired' : null));
    if (why !== null) refused.push({ record: q, reason: why });
    else valid.push(q);
  }
  valid.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  for (const q of valid.slice(cap)) refused.push({ record: q, reason: `over the profile's cap of ${cap} quarantined tests` });
  return { live: valid.slice(0, cap), refused, onRequired };
}

export function riskAcceptances(dispositions: Disposition[], roles: Roles, now: Date) {
  const all = dispositions.filter((d): d is RiskAcceptance => d.kind === 'risk-acceptance');
  const refused: Refusal<RiskAcceptance>[] = [];
  const valid: RiskAcceptance[] = [];
  for (const r of all) {
    const why =
      r.role !== 'qa'
        ? 'a risk acceptance needs the QA role'
        : (roleHolds(roles, r) ??
          (r.owner.trim() === '' ? 'no owner' : r.signature.trim() === '' ? 'no failure signature' : !live(r.expires, now) ? 'expired' : null));
    if (why !== null) refused.push({ record: r, reason: why });
    else valid.push(r);
  }
  return { live: valid, refused };
}

export function acceptedRisk(live: RiskAcceptance[], test: TestIdentity, project: string, signature: string): RiskAcceptance | null {
  return live.find((r) => sameTest(r.test, test) && r.project === project && r.signature === signature) ?? null;
}

// --- Sensitivity waivers (§6 step 5) ---

/** A waiver counts only when the case's owner made it, against the case as it is now. */
export function waiverFor(
  dispositions: Disposition[],
  roles: Roles,
  track: Track,
  ref: ObligationRef,
  caseHash: string,
): { waiver: SensitivityWaiver | null; valid: SensitivityWaiver[]; refused: Refusal<SensitivityWaiver>[] } {
  const refused: Refusal<SensitivityWaiver>[] = [];
  const valid: SensitivityWaiver[] = [];
  for (const d of dispositions) {
    if (d.kind !== 'sensitivity-waived' || d.case !== ref.case || d.obligation !== ref.obligation) continue;
    if (typeof d.step !== 'string' || d.step.trim() === '') { refused.push({record:d, reason:'waiver has no full case/step/obligation identity'}); continue; }
    if (d.step !== ref.step) continue;
    const why = ownerRoleHolds(roles, track, d) ?? (d.caseHash !== caseHash ? 'the case changed after the waiver' : d.reason.trim() === '' ? 'no reason' : null);
    if (why !== null) refused.push({ record: d, reason: why });
    else valid.push(d);
  }
  return { waiver: valid[0] ?? null, valid, refused };
}

export { testKey };
