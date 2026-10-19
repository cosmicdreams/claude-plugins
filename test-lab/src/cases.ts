// Cases (plan §3): the canonical hash an approval binds to, and whether a case is approved as it stands.
// The hash covers preconditions, obligations, applicable configurations and fixture: any edit to those
// clears the approval, and the tests mapped to the case become stale.

import { hashOf } from './canonical.ts';
import { ownerRoleHolds } from './dispositions.ts';
import type { CaseRecord, Configuration, Roles } from './model.ts';

export function canonicalCaseHash(record: CaseRecord): string {
  return hashOf({
    preconditions: record.preconditions.trim(),
    steps: record.steps.map((s) => ({
      id: s.id,
      text: s.text.trim(),
      obligations: s.obligations.map((o) => ({ id: o.id, text: o.text.trim(), layer: o.layer })),
    })),
    configurations: [...record.configurations].sort(),
    fixture: record.fixture,
    ...(record.sourcePolicy===undefined?{}:{sourcePolicy:record.sourcePolicy}),
  });
}

/** Structural validity is independent of approval: identities must preserve the denominator. */
export function caseProblems(record: CaseRecord): string[] {
  const problems: string[] = [];
  const text = (value: unknown, name: string) => {
    if (typeof value !== 'string' || value.trim() === '') problems.push(`empty or invalid ${name}`);
  };
  text(record.id, 'case ID'); text(record.title, 'case title'); text(record.preconditions, 'preconditions');
  if (!Array.isArray(record.configurations) || record.configurations.length === 0) problems.push('no applicable configurations');
  else {
    for (const c of record.configurations) text(c, 'configuration ID');
    if (new Set(record.configurations).size !== record.configurations.length) problems.push('duplicate configuration IDs');
  }
  if (!Array.isArray(record.steps) || record.steps.length === 0) return [...problems, 'no steps or obligations'];
  const steps = new Set<string>();
  for (const s of record.steps) {
    text(s.id, 'step ID'); text(s.text, 'step text');
    if (steps.has(s.id)) problems.push(`duplicate step ID ${s.id}`);
    steps.add(s.id);
    if (!Array.isArray(s.obligations) || s.obligations.length === 0) { problems.push(`step ${s.id} has no obligations`); continue; }
    const obligations = new Set<string>();
    for (const o of s.obligations) {
      text(o.id, 'obligation ID'); text(o.text, 'obligation text');
      if (obligations.has(o.id)) problems.push(`duplicate obligation ID ${s.id}/${o.id}`);
      obligations.add(o.id);
      if (o.layer !== 'served' && o.layer !== 'synthetic') problems.push(`invalid obligation layer ${s.id}/${o.id}`);
    }
  }
  return problems;
}

/** A profile matrix must have unique identities and observable, nonempty tuple dimensions. */
export function configurationProblems(configurations: Configuration[]): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const c of configurations) {
    if (names.has(c.id)) problems.push(`duplicate configuration ID ${c.id}`);
    names.add(c.id);
    if ([c.id, c.project, c.role].some((s) => typeof s !== 'string' || s.trim() === '')) problems.push('empty configuration identity/project/role');
    if (c.viewport !== null && (![c.viewport.width, c.viewport.height].every((n) => Number.isSafeInteger(n) && n > 0))) problems.push(`invalid viewport in ${c.id}`);
  }
  return problems;
}

/** Why a case is not approved as it stands, or null when its owner approved exactly this content. */
export function approvalProblem(record: CaseRecord, roles: Roles, configurations?: Configuration[]): string | null {
  const invalid = caseProblems(record);
  if (configurations !== undefined) {
    invalid.push(...configurationProblems(configurations));
    for (const id of record.configurations) if (!configurations.some((c) => c.id === id)) invalid.push(`undeclared configuration ${id}`);
  }
  if (invalid.length > 0) return invalid.join('; ');
  if (record.approval === null) return 'unapproved';
  const role = ownerRoleHolds(roles, record.track, record.approval);
  if (role !== null) return `approval refused: ${role}`;
  if (record.approval.hash !== canonicalCaseHash(record)) return 'edited since its approval';
  // A case drafted from its own test is circular unless something independent backs it (§3).
  const p = record.provenance;
  if (p.draftedFrom === 'existing-test' && p.independentRefs.length === 0) {
    if (p.selfDerivedAcceptedBy === null) return 'drafted from its own test with no independent reference and not accepted as self-derived';
    const why = ownerRoleHolds(roles, record.track, p.selfDerivedAcceptedBy);
    if (why !== null) return `self-derived acceptance refused: ${why}`;
  }
  return null;
}

/** A case drafted from its own test, accepted as such, with no independent reference. */
export function isSelfDerived(record: CaseRecord): boolean {
  return record.provenance.draftedFrom === 'existing-test' && record.provenance.independentRefs.length === 0;
}

export function obligationsOf(record: CaseRecord): { step: string; obligation: string }[] {
  return record.steps.flatMap((s) => s.obligations.map((o) => ({ step: s.id, obligation: o.id })));
}

/**
 * The required set's own validity (rule 1): every required case has a record on the right track, and its
 * owner approved exactly its current content. An unapproved or edited case can't be in the required set.
 */
export function requiredSetProblems(required: { regression: string[]; addendum: string[] }, cases: Map<string, CaseRecord>, roles: Roles, configurations?: Configuration[]): string[] {
  const problems: string[] = [];
  const requiredIds = [...required.regression, ...required.addendum];
  if (new Set(requiredIds).size !== requiredIds.length) problems.push('duplicate required case IDs');
  for (const [key, record] of cases) if (record.id !== key) problems.push(`case map key ${key} differs from record ID ${record.id}`);
  for (const [track, ids] of [['regression', required.regression], ['addendum', required.addendum]] as const) {
    for (const id of ids) {
      const record = cases.get(id);
      if (record === undefined) problems.push(`required ${track} case ${id} has no case record`);
      else if (record.track !== track) problems.push(`case ${id} is required as ${track} but its track is ${record.track}`);
      else if (record.priorityDefaulted === true) problems.push(`required ${track} case ${id} has an Undefined source priority: it is tagged @p3 by default and can never be required until QA assigns a priority`);
      else {
        const why = approvalProblem(record, roles, configurations);
        if (why !== null) problems.push(`required ${track} case ${id} is not approved as it stands: ${why}`);
      }
    }
  }
  return problems;
}
