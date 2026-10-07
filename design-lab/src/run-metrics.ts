/** Shared run metrics for the benchmark and the evaluation ledger (port of scripts/run_metrics.py). */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { counts, coverageSentence } from './library-counts.ts';
import { compareBoth as figmaCompare, THRESHOLD, TOLERANCE } from './figma-compare.ts';
import type { Geometry } from './build-artifacts.ts';
import { roundDecimal, roundEven } from './json.ts';

export const BREAKPOINTS = ['desktop', 'tablet', 'mobile'] as const;
// Scorecard sections are open JSON documents; the scorecard schema checks their shape.
export type Json = Record<string, any>;

// ---------------------------------------------------------------------------- Python value semantics

/** Python truthiness: empty strings, lists and objects are false, as are 0, null and false. */
export function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return !!value;
}
/** Python's `a or b or c`: the first truthy value, else the last one (undefined read as None). */
export function or(...values: unknown[]): any {
  for (const value of values) if (truthy(value)) return value;
  return values.at(-1) ?? null;
}
/** Python's dict view of a value that may not be an object: `x or {}` for documents read from disk. */
export const obj = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
export const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
/** str() of a scalar as Python formats it in an f-string. */
export function pyStr(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : JSON.stringify(value);
}
/** f"{n:,}": thousands separators. */
export function commas(value: unknown): string {
  const [whole = '', fraction] = String(value).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction);
}
/** f"{x:.Nf}", with Python's even ties on the exact binary value. */
export const fixed = (value: number, digits: number): string => roundDecimal(Number(value), digits).toFixed(digits);
/** Python's str.capitalize(). */
export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

// ---------------------------------------------------------------------------- files

export function readJson(path: string): any {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
/** Object lines of a JSON Lines file; blank, damaged and non-object lines are skipped. */
export function readJsonl(path: string): Json[] {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return []; }
  const entries: Json[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) entries.push(value as Json);
    } catch { /* a damaged line */ }
  }
  return entries;
}
export const isFile = (path: string): boolean => { try { return statSync(path).isFile(); } catch { return false; } };
export const isDir = (path: string): boolean => { try { return statSync(path).isDirectory(); } catch { return false; } };
/** Path.glob(pattern) in one folder, sorted, where the pattern is a prefix and suffix around one `*`. */
export function globSorted(folder: string, prefix: string, suffix: string): string[] {
  let names: string[];
  try { names = readdirSync(folder); } catch { return []; }
  return names.filter(n => n.length >= prefix.length + suffix.length && n.startsWith(prefix) && n.endsWith(suffix))
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map(n => resolve(folder, n));
}
export const stem = (name: string, suffix: string): string => name.slice(0, name.length - suffix.length);

// ---------------------------------------------------------------------------- statistics

export function notMeasured(reason: string, how?: string | null, extra: Json = {}): Json {
  return { status: 'not-measured', reason, ...(how ? { howToMeasure: how } : {}), ...extra };
}
/** statistics.median rounded to four places; None for no values. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b), middle = Math.floor(ordered.length / 2);
  const value = ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
  return roundDecimal(value, 4);
}
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, roundEven(q * (ordered.length - 1))));
  return roundDecimal(ordered[index]!, 4);
}
const maxOf = (values: number[]): number | null => values.length ? values.reduce((a, b) => b > a ? b : a) : null;

// ---------------------------------------------------------------------------- coverage

/** Built out of what the run could have built; every number from library-counts, the module the
 * Figma Cover and Getting Started page are drawn from. */
export function scoreCoverage(runDir: string): Json {
  const c = counts(runDir);
  if (c === null) return notMeasured('no components.json, so nothing says what the source holds');
  if (!c.builtKnown) {
    return notMeasured('no Figma build state, index or build records, so nothing says what was built',
      'let the build write its receipts (figma_build.py receipts)');
  }
  const section: Json = {
    status: 'measured', found: c.found, eligible: c.eligible, built: c.built,
    ratio: c.ratio, gap: c.gap, excluded: c.excluded,
    reasonLabels: c.reasonLabels, summary: coverageSentence(c),
    items: c.notBuilt.map(r => ({ id: r.id, label: r.label, reason: r.status, detail: r.detail })),
    byTier: c.byTier, coverBreakdown: c.coverBreakdown,
    outsideInventory: c.outsideInventory,
  };
  const p = c.placements;
  section['usageWeighted'] = p.total
    ? { placements: p.total, covered: p.covered, ratio: p.ratio, structuralRefs: c.structural.total, structuralCovered: c.structural.covered }
    : notMeasured('no usage placements were recorded for this run');
  return section;
}

// ---------------------------------------------------------------------------- conformance

export function scoreConformance(runDir: string, project: Json | null): Json {
  let reportPath: string | null = null;
  for (const artifact of Object.values(obj(obj(project)['artifacts']))) {
    if (obj(artifact)['kind'] === 'verify-report') reportPath = resolve(runDir, String(artifact['path']));
  }
  const report = readJson(reportPath ?? resolve(runDir, 'verify-report.json'));
  if (!truthy(report)) {
    const status = obj(obj(obj(project)['phases'])['verify'])['status'];
    return notMeasured(`no verification report; the verify phase is ${or(status, 'unrecorded')}`,
      'run design-lab:verify and register verify-report.json');
  }
  const open = list(report['open']), severities = new Map<string, number>();
  for (const item of open) { const key = or(obj(item)['severity'], 'unrated'); severities.set(key, (severities.get(key) ?? 0) + 1); }
  const main = ['blocker', 'major', 'minor'];
  return {
    status: 'measured',
    summary: `${open.length} open finding(s), ${list(report['waived']).length} waived.`,
    open: Object.fromEntries(main.map(s => [s, severities.get(s) ?? 0])),
    openOther: [...severities].filter(([k]) => !main.includes(k)).reduce((n, [, v]) => n + v, 0),
    waived: list(report['waived']).length,
    passed: list(report['passed']).length,
    inapplicable: list(report['inapplicable']).length,
    completeness: or(report['completeness'], {}),
    findings: open.slice(0, 40).map(item => ({ severity: item['severity'] ?? null, check: or(item['check'], item['id']),
      message: or(item['message'], item['detail']) })),
  };
}

// ---------------------------------------------------------------------------- accuracy

export function breakpointOf(label: string | null | undefined, index: number, count: number): string {
  const match = /(desktop|tablet|mobile)/i.exec(label || '');
  if (match) return match[1]!.toLowerCase();
  return count === 3 ? ['mobile', 'tablet', 'desktop'][index]! : `width-${index}`;
}

/** Both metrics recomputed from each component's specimen screenshot and recorded geometry. */
export async function accuracyPairs(runDir: string): Promise<Json[]> {
  const labels = new Map<unknown, unknown>(list(obj(readJson(resolve(runDir, 'components.json')))['components'])
    .map(c => [obj(c)['id'] ?? null, obj(c)['label'] ?? null]));
  const pairs: Json[] = [];
  for (const block of globSorted(resolve(runDir, 'figma/results'), 'block_', '.json')) {
    const name = block.slice(block.lastIndexOf('/') + 1), component = stem(name, '.json').slice('block_'.length);
    const specimen = resolve(runDir, 'figma/compare', `${component}.png`);
    const geometry = obj(obj(readJson(block))['geometry']) as Geometry & Json;
    if (!isFile(specimen) || !truthy(geometry.variants)) continue;
    const {original,corrected} = await figmaCompare(specimen, geometry);
    const captures = list(geometry.captures), variants = list(geometry.variants);
    for (let index = 0; index < Math.min(original.pairs.length, corrected.pairs.length); index++) {
      const old = original.pairs[index]!, now = corrected.pairs[index]!;
      const capture = obj(captures[index]), variant = obj(variants[index]);
      pairs.push({
        component, label: or(labels.get(component), component),
        breakpoint: breakpointOf(capture['label'] ?? '', index, captures.length),
        width: roundEven(or(capture['width'], now.width)),
        original: { ratio: old.ratio, pass: old.pass },
        corrected: { ratio: now.ratio, pass: now.pass },
        heightDelta: now.heightDelta, widthDelta: now.widthDelta ?? null,
        figmaHeight: variant['height'] ?? null, liveHeight: capture['height'] ?? null,
        evidence: { specimen: `figma/compare/${component}.png`, geometry: `figma/results/${name}`, index },
      });
    }
  }
  return pairs;
}

/** Fallback: the original-metric results already stored in build records. */
export function recordedPairs(runDir: string): Json[] {
  const pairs: Json[] = [];
  for (const record of globSorted(resolve(runDir, 'builds'), '', '.json')) {
    const data = obj(readJson(record)), id = or(data['id'], stem(record.slice(record.lastIndexOf('/') + 1), '.json'));
    const items = list(obj(obj(obj(data['visualEvidence'])['comparison'])['metrics'])['pairs']);
    items.forEach((raw, index) => {
      const pair = obj(raw);
      pairs.push({ component: id, label: id, breakpoint: breakpointOf(pair['label'] ?? '', index, items.length),
        width: pair['width'] ?? null, original: { ratio: pair['ratio'] ?? null, pass: pair['pass'] ?? null },
        corrected: null, heightDelta: pair['heightDelta'] ?? null, widthDelta: null, evidence: null });
    });
  }
  return pairs;
}

export function summarise(pairs: Json[], metric: 'original' | 'corrected'): Json {
  const rows = pairs.filter(p => truthy(p[metric])), ratios = rows.map(p => p[metric]['ratio'] as number);
  return { pass: rows.filter(p => p[metric]['pass']).length, total: rows.length,
    medianRatio: median(ratios), p75Ratio: quantile(ratios, 0.75), maxRatio: maxOf(ratios) };
}

export async function scoreAccuracy(runDir: string): Promise<Json> {
  let pairs = await accuracyPairs(runDir), source = 'recomputed from specimen screenshots';
  if (!pairs.length) {
    pairs = recordedPairs(runDir);
    source = 'original metric as recorded in build records';
  }
  if (!pairs.length) {
    return notMeasured('no specimen screenshots (figma/compare) or comparison results',
      'let the runner finish its compare steps, which save both');
  }
  const present = new Set(pairs.map(p => p['breakpoint'] as string));
  const names: string[] = BREAKPOINTS.filter(b => present.has(b));
  names.push(...[...present].filter(b => !names.includes(b)).sort());
  const byBreakpoint: Json = {};
  for (const name of names) {
    const subset = pairs.filter(p => p['breakpoint'] === name);
    const heights = subset.filter(p => p['heightDelta'] !== null && p['heightDelta'] !== undefined).map(p => p['heightDelta'] as number);
    byBreakpoint[name] = {
      original: summarise(subset, 'original'),
      corrected: truthy(subset[0]!['corrected']) ? summarise(subset, 'corrected') : null,
      heightDelta: { median: median(heights), max: maxOf(heights), over10px: heights.filter(h => h > 10).length },
    };
  }
  const corrected = pairs[0]!['corrected'] !== null && pairs[0]!['corrected'] !== undefined;
  const section: Json = {
    status: corrected ? 'measured' : 'partial',
    source,
    threshold: THRESHOLD, tolerance: TOLERANCE,
    metrics: {
      original: 'Shared top-left area only; greyscale difference over the tolerance. Kept so earlier results stay comparable.',
      corrected: 'Larger of the two boxes; area only one side covers counts as changed; tolerance applied per colour channel.',
    },
    overall: { original: summarise(pairs, 'original'), corrected: corrected ? summarise(pairs, 'corrected') : null },
    byBreakpoint,
    components: new Set(pairs.map(p => p['component'])).size,
    pairs,
  };
  if (!corrected) section['reason'] = 'specimen screenshots are missing, so only the original metric is available';
  return section;
}

// ---------------------------------------------------------------------------- the evaluation ledger's metrics

export function coverage(runDir: string): Json {
  const section = scoreCoverage(resolve(runDir));
  if (section['status'] !== 'measured') return section;
  return { built: section['built'], inventoried: section['found'], buildable: section['eligible'], ratio: section['ratio'],
    placementShare: section['usageWeighted']['ratio'] ?? null };
}
export async function correctedWidths(runDir: string, accuracy?: Json): Promise<Json | null> {
  const section = accuracy ?? await scoreAccuracy(resolve(runDir));
  return obj(section['overall'])['corrected'] ?? null;
}
export async function originalWidths(runDir: string, accuracy?: Json): Promise<Json | null> {
  const section = accuracy ?? await scoreAccuracy(resolve(runDir));
  return obj(section['overall'])['original'] ?? null;
}
export function openFindings(runDir: string): Json | null {
  const section = scoreConformance(resolve(runDir), readJson(resolve(runDir, 'project.json')));
  return section['status'] === 'measured' ? { ...section['open'], other: section['openOther'] } : null;
}
const recordedCost = (runDir: string): Json => obj(obj(obj(readJson(resolve(runDir, 'benchmark/scorecard.json')))['sections'])['cost']);
/** Recorded token totals: a later scoring's model is never recomputed for the ledger. */
export function tokens(runDir: string, cost?: Json): any {
  const model = obj((cost ?? recordedCost(runDir))['model']);
  return model['status'] === 'measured' ? model['tokens'] ?? null : null;
}
export function elapsedTime(runDir: string, cost?: Json): Json | null {
  const section = cost ?? recordedCost(runDir);
  const kept = Object.fromEntries(['clock', 'working', 'runner'].filter(k => truthy(section[k])).map(k => [k, section[k]]));
  return truthy(kept) ? kept : null;
}
export async function metrics(runDir: string): Promise<Json> {
  const accuracy = await scoreAccuracy(resolve(runDir));
  return { coverage: coverage(runDir), correctedWidths: await correctedWidths(runDir, accuracy),
    originalWidths: await originalWidths(runDir, accuracy), openFindings: openFindings(runDir),
    tokens: tokens(runDir), time: elapsedTime(runDir) };
}
