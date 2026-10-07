/** Cross-field acceptance rules, distinct from structural artifact contracts. */
import type { ArtifactKind } from './contracts.ts';
export function policyErrors(kind: ArtifactKind, value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const doc = value as Record<string, any>, errors: string[] = [];
  const unique = (rows: any[], label: string) => { const ids = new Set<string>(); for (const row of rows) if (row?.id) { if (ids.has(row.id)) errors.push(`${label}: duplicate id ${row.id}`); ids.add(row.id); } };
  if (kind === 'components') unique(doc.components ?? [], 'components');
  if (kind === 'plan') unique(doc.plans ?? [], 'plans');
  if (kind === 'index') { unique(doc.rows ?? [], 'index rows'); if (Number.isInteger(doc.totals?.components) && doc.totals.components !== doc.rows?.length) errors.push('totals.components must equal the number of rows'); }
  if (kind === 'capture-evidence') for (const [id, evidence] of Object.entries(doc.captures ?? {}) as [string, any][]) if (String(evidence.linkUrl ?? '').includes('.ddev.site')) errors.push(`captures[${id}].linkUrl must not use a DDEV hostname`);
  if (kind === 'foundation' && doc.validation?.errors?.length) errors.push('validation.errors must be empty');
  if (kind === 'build-record') {
    if (doc.visualEvidence?.comparison?.verdict === 'pass' && ['desktop', 'tablet', 'mobile'].some(name => doc.visualEvidence.comparison.breakpoints?.[name] !== 'pass')) errors.push('a passing comparison must pass all three breakpoints');
  }
  return errors;
}
