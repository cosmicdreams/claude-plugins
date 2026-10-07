import { existsSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { slotAccepts } from './build-artifacts.ts';
import type { Component, ComponentPlan, Usage } from './build-artifacts.ts';
import type { BuildRecord } from './generated/build-record.ts';
const TIER_ORDER = ['High Use', 'Medium Use', 'Low Use', 'Structural Only', 'Retirement Candidates'].map(t => 'Components — ' + t);
export const structuralRefs = (u: Usage): number | null => u.structuralRefs ?? u.structuralReferences ?? null;
export function tierOf(c: Component, high = 50, medium = 10): string {
  const u = c.usage; if (!u || ['unavailable', 'unknown', 'partial'].includes(u.status ?? '') || u.placements == null) return 'Components — Untiered';
  if (TIER_ORDER.includes(u.tier ?? '')) return u.tier!;
  const p = u.placements || 0, s = structuralRefs(u) || 0;
  return TIER_ORDER[p >= high ? 0 : p >= medium ? 1 : p >= 1 ? 2 : s >= 1 ? 3 : 4]!;
}
type Receipt = BuildRecord & { _unreadable?: string; verdict?: string; deferred?: unknown[]; unsupported?: unknown[]; built?: BuildRecord['built'] & { variants?: number } };
export function readRecord(builds: string, c: Component): Receipt | null {
  for (const name of [c.machineName, c.id.replaceAll(':', '__').replaceAll('/', '_'), c.id.replaceAll(':', '_').replaceAll('/', '_')]) {
    if (!name) continue; const p = resolve(builds, name + '.json'); if (!existsSync(p)) continue;
    try { return JSON.parse(readFileSync(p, 'utf8')) as Receipt; } catch (error) { return { _unreadable: `${basename(p)}: ${String(error)}` } as Receipt; }
  }
  return null;
}
export function whyNotBuilt(rec: Receipt | null, planned?: ComponentPlan): string {
  if (planned && planned.verdict !== 'build') return planned.refuseReason || ({ map: 'mapped as a subcomponent of a larger visual asset', document: 'documented source entity; not a placeable visual asset', refuse: 'not eligible for a trustworthy visual build' } as Record<string, string>)[planned.verdict] || 'not in visual build scope';
  if (!rec) return 'not attempted'; if (rec._unreadable) return 'build record unreadable — ' + rec._unreadable;
  if (rec.verdict === 'refuse') return 'refused by the planner' + (rec.built?.variants ? ` — would be ${rec.built.variants.toLocaleString('en-US')} variants` : '');
  const failed = Object.entries(rec.assertions ?? {}).filter(([, v]) => !!v && typeof v === 'object' && 'verdict' in v && v.verdict === 'fail').map(([k]) => k).sort();
  return failed.length ? `build failed — ${failed.length} assertion(s): ${failed.join(', ')}` : 'build record exists but records no Figma node';
}
export function rowFor(c: Component, rec: Receipt | null, high = 50, medium = 10, planned?: ComponentPlan) {
  const figma = rec?.figma, node = figma?.componentSetId || figma?.componentId || null, card = figma?.documentationCardId ?? null;
  return { id: c.id, machineName: c.machineName || c.id.split(':').at(-1)!, label: c.label || c.id, tier: tierOf(c, high, medium), placements: c.usage?.placements ?? null, structuralRefs: structuralRefs(c.usage ?? {}), built: !!node, type: planned?.libraryRole || 'unclassified', status: node ? 'Built' : ({ map: 'Mapped', document: 'Documentation only', refuse: 'Not built' } as Record<string, string>)[planned?.verdict ?? ''] || 'Not attempted', figma: { pageId: figma?.pageId ?? null, componentNodeId: node, documentationCardId: card }, componentLinkTarget: node, documentationLinkTarget: card, reason: node ? null : whyNotBuilt(rec, planned), deferred: rec?.deferred?.length ?? 0, unsupported: rec?.unsupported?.length ?? 0 };
}
export function buildIndex(comps: Component[], builds: string, high = 50, medium = 10, plans: Record<string, ComponentPlan> = {}, now = new Date()) {
  const rank = (t: string): number => { const i = TIER_ORDER.indexOf(t); return i < 0 ? TIER_ORDER.length : i; }, rows = comps.map(c => rowFor(c, readRecord(builds, c), high, medium, plans[c.id])).sort((a, b) => rank(a.tier) - rank(b.tier) || (b.placements || 0) - (a.placements || 0) || (a.machineName < b.machineName ? -1 : a.machineName > b.machineName ? 1 : 0));
  const byTier = Object.fromEntries(TIER_ORDER.map(t => { const held = rows.filter(r => r.tier === t); return [t, { components: held.length, built: held.filter(r => r.built).length }]; }));
  const seen = new Map<string, string[]>(); for (const r of rows) seen.set(r.machineName, [...seen.get(r.machineName) ?? [], r.id]);
  const clashes = [...seen].filter(([, ids]) => ids.length > 1), problems = clashes.length ? [{ check: 'machine-name-collision', detail: `${clashes.length} machine name(s) are used by more than one component, so they cannot each be named "machine_name — Human Label": ${clashes.sort(([a], [b]) => a < b ? -1 : 1).slice(0, 5).map(([n, ids]) => `${n} (${ids.join(', ')})`).join('; ')}` }] : [];
  return { standardVersion: '3.0.0', generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), thresholds: { high, medium, default: high === 50 && medium === 10 }, totals: { components: rows.length, built: rows.filter(r => r.built).length, notBuilt: rows.filter(r => !r.built).length, byTier }, rows, notBuilt: rows.filter(r => !r.built).map(r => ({ id: r.id, machineName: r.machineName, label: r.label, tier: r.tier, reason: r.reason })), problems };
}
