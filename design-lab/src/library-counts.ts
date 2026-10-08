import { resolve } from 'node:path';
import { roundDecimal } from './json.ts';
import { readOptional, jsonFiles } from './build-artifacts.ts';
import type { BuildState, Component, ComponentPlan } from './build-artifacts.ts';
export const TIERS = ['High Use', 'Medium Use', 'Low Use', 'Structural Only', 'Retirement Candidates'];
export const USE_TIERS = TIERS.slice(0, 3);
export const COVER_GROUND = '#001B67';
export const TIER_COLORS: Record<string, string> = {
  'High Use': '#FAD200',
  'Medium Use': '#00AEEF',
  'Low Use': '#00A457',
  Other: '#417DFC',
  'Retirement Candidates': '#B9003F',
};
export const COVER_LABELS: Record<string, string> = {
  'High Use': 'High use',
  'Medium Use': 'Medium use',
  'Low Use': 'Low use',
  Other: 'Other',
};
export const GAP_REASONS = {
  refused: 'refused by the plan',
  failed: 'planned but not built',
  unplanned: 'not in the plan',
};
export const EXCLUDED_REASONS = {
  retirement: 'retirement candidate',
  'schema-only': 'schema-only',
  'not-visual': 'mapped or documented, not built as a component',
};
export const shortTier = (tier?: string): string => (tier ?? '').replace('Components — ', '').trim() || 'Untiered';
export const placements = (c: Pick<Component, 'usage'>): number => Math.trunc(Number(c.usage?.placements || 0));
export const structural = (c: Pick<Component, 'usage'>): number =>
  Math.trunc(Number(c.usage?.structuralRefs ?? c.usage?.structuralReferences ?? 0));
export const plannedIds = (state: Partial<BuildState> & { built?: string[] }): string[] =>
  Array.isArray(state.planned) ? [...state.planned] : (state.built ?? []);
export const recordedIds = (state: Partial<BuildState> & { built?: string[] }): Set<string> =>
  new Set(plannedIds(state).filter((id) => state.done?.includes('build:' + id) && state.done.includes('block:' + id)));
export function builtIds(run: string): Set<string> | null {
  const state = readOptional<BuildState>(resolve(run, 'figma/state.json'));
  if (Array.isArray(state?.done)) return recordedIds(state);
  const index = readOptional<{ rows?: { id: string; built: boolean }[] }>(resolve(run, 'index.json'));
  if (index?.rows?.length) return new Set(index.rows.filter((r) => r.built && r.id).map((r) => r.id));
  const ids = jsonFiles(resolve(run, 'builds'))
    .map((f) => readOptional<{ id: string }>(f)?.id)
    .filter((id): id is string => !!id);
  return ids.length ? new Set(ids) : null;
}
export function classify(c: Component, plan: ComponentPlan | undefined, built: Set<string>): [string, string | null] {
  if (built.has(c.id)) return ['built', null];
  if (!plan) return ['unplanned', null];
  if (['retirement', 'schema-only'].includes(plan.libraryRole)) return [plan.libraryRole, plan.refuseReason ?? null];
  if (['map', 'document'].includes(plan.verdict)) return ['not-visual', plan.refuseReason ?? null];
  if (plan.verdict === 'refuse') return ['refused', plan.refuseReason ?? null];
  return ['failed', null];
}
export function counts(run: string, built?: Set<string> | string[]) {
  const inventory = readOptional<{ components: Component[] }>(resolve(run, 'components.json'))?.components ?? [];
  if (!inventory.length) return null;
  const plans = new Map(
    (readOptional<{ plans: ComponentPlan[] }>(resolve(run, 'plan.json'))?.plans ?? []).map((p) => [p.id, p]),
  );
  const known = built === undefined ? builtIds(run) : new Set(built),
    builtKnown = known !== null;
  const rows = inventory.map((c) => {
    const [status, detail] = classify(c, plans.get(c.id), known ?? new Set());
    return {
      id: c.id,
      label: c.label || c.id,
      tier: shortTier(c.usage?.tier),
      placements: placements(c),
      structural: structural(c),
      built: status === 'built',
      status,
      detail,
    };
  });
  const tally = (key: string): number => rows.filter((r) => r.status === key).length;
  const excluded = Object.fromEntries(Object.keys(EXCLUDED_REASONS).map((k) => [k, tally(k)])),
    gap = Object.fromEntries(Object.keys(GAP_REASONS).map((k) => [k, tally(k)]));
  const found = rows.length,
    builtN = tally('built'),
    eligible = found - Object.values(excluded).reduce((a, b) => a + b, 0);
  const sum = (field: 'placements' | 'structural', builtOnly = false): number =>
    rows.filter((r) => !builtOnly || r.built).reduce((a, r) => a + r[field], 0);
  const order = [...TIERS, ...[...new Set(rows.map((r) => r.tier).filter((t) => !TIERS.includes(t)))].sort()];
  const byTier = order.map((t) => {
    const inTier = rows.filter((r) => r.tier === t);
    return {
      tier: t,
      found: inTier.length,
      built: inTier.filter((r) => r.built).length,
      notBuilt: inTier.filter((r) => !r.built).length,
      placements: inTier.reduce((a, r) => a + r.placements, 0),
      structural: inTier.reduce((a, r) => a + r.structural, 0),
    };
  });
  const usage =
    readOptional<{ usage: Record<string, { placements?: number; structuralRefs?: number }> }>(
      resolve(run, 'usage.json'),
    )?.usage ?? {};
  const ids = new Set(rows.map((r) => r.id));
  const outsideInventory = Object.entries(usage)
    .filter(([id, v]) => v && typeof v === 'object' && !ids.has(id))
    .map(([id, v]) => ({
      id,
      placements: Math.trunc(Number(v.placements || 0)),
      structural: Math.trunc(Number(v.structuralRefs || 0)),
    }))
    .filter((r) => r.placements || r.structural);
  const coverBreakdown = [...USE_TIERS, 'Other'].map((t) => ({
    tier: t,
    built: rows.filter((r) => r.built && (t === 'Other' ? !USE_TIERS.includes(r.tier) : r.tier === t)).length,
  }));
  return {
    builtKnown,
    found,
    built: builtN,
    eligible,
    ratio: eligible ? roundDecimal(builtN / eligible, 4) : null,
    gap,
    excluded,
    reasonLabels: { ...GAP_REASONS, ...EXCLUDED_REASONS },
    notBuilt: rows.filter((r) => !r.built),
    placements: {
      total: sum('placements'),
      covered: sum('placements', true),
      ratio: sum('placements') ? roundDecimal(sum('placements', true) / sum('placements'), 4) : null,
    },
    structural: { total: sum('structural'), covered: sum('structural', true) },
    outsideInventory,
    tiered: rows.some((r) => TIERS.includes(r.tier)),
    byTier,
    coverBreakdown,
    components: rows,
  };
}
/** A tier's label or colour; every tier the tables are asked about is one of their own keys. */
function forTier(table: Record<string, string>, tier: string, what: string): string {
  const value = table[tier];
  if (value === undefined) throw new Error(`library-counts has no ${what} for tier "${tier}"`);
  return value;
}
export function tierTable(c: NonNullable<ReturnType<typeof counts>>) {
  const by = new Map(c.byTier.map((r) => [r.tier, r]));
  const rows = c.coverBreakdown.map((r) => {
    const held = c.byTier.filter(
      (t) => !USE_TIERS.includes(t.tier) && (t.tier !== 'Retirement Candidates' || t.built) && t.found,
    );
    return {
      tier: r.tier,
      label: forTier(COVER_LABELS, r.tier, 'label'),
      color: forTier(TIER_COLORS, r.tier, 'colour'),
      built: r.built,
      counted: true,
      found: r.tier === 'Other' ? held.reduce((n, t) => n + t.found, 0) : (by.get(r.tier)?.found ?? 0),
      ...(r.tier === 'Other' ? { holds: held.map((t) => ({ tier: t.tier, built: t.built, found: t.found })) } : {}),
    };
  });
  const retired = by.get('Retirement Candidates');
  if (retired?.found)
    rows.push({
      tier: retired.tier,
      label: 'Retirement candidates',
      color: forTier(TIER_COLORS, retired.tier, 'colour'),
      built: retired.built,
      found: retired.found,
      counted: false,
    });
  return rows;
}
export const coverageSentence = (c: NonNullable<ReturnType<typeof counts>>): string =>
  `Built ${c.built} of ${c.eligible} components it could have built${c.ratio === null ? '' : ` (${Math.round(c.ratio * 100)}%)`}.`;
