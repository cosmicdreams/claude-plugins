// Priority tags from the source's own priority metadata (QA standard, "Tags & Coverage"): the tag is
// the label's leading number, never the stored priority_id, which does not run in label order. A label
// with no number (Undefined) is tagged p3, marked defaulted, and can never be required.
export type PriorityTag = 'p1' | 'p2' | 'p3' | 'p4';
export type PriorityMapping = { id: number; label: string; tag: PriorityTag; defaulted: boolean; tier: 'smoke' | 'short' | 'full' | 'non-regression' | 'unassigned' };

const TIERS: Record<PriorityTag, PriorityMapping['tier']> = { p1: 'smoke', p2: 'short', p3: 'full', p4: 'non-regression' };

export function mapPriority(priority: { id: number; name: string }): PriorityMapping {
  const m = /^\s*([1-4])\s*[-:]\s*\S/.exec(priority.name);
  if (m === null) return { id: priority.id, label: priority.name, tag: 'p3', defaulted: true, tier: 'unassigned' };
  const tag = `p${m[1]}` as PriorityTag;
  return { id: priority.id, label: priority.name, tag, defaulted: false, tier: TIERS[tag] };
}

/** The mapping for a case's priority_id; an id the metadata doesn't list is treated as Undefined. */
export function priorityOf(id: unknown, priorities: { id: number; name: string }[]): PriorityMapping {
  const p = priorities.find((x) => x.id === id);
  return p === undefined ? { id: typeof id === 'number' ? id : 0, label: 'not in priority metadata', tag: 'p3', defaulted: true, tier: 'unassigned' } : mapPriority(p);
}
