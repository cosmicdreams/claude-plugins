/** Shared run metrics for the benchmark and the evaluation ledger (port of src/run-metrics.ts). */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { counts, coverageSentence } from './library-counts.ts';
import { compareBoth as figmaCompare, THRESHOLD, TOLERANCE } from './figma-compare.ts';
import type { Geometry } from './build-artifacts.ts';
import { roundDecimal, roundEven } from './json.ts';

export const BREAKPOINTS = ['desktop', 'tablet', 'mobile'] as const;
// Open external JSON is narrowed before use; owned metrics have named shapes.
export type Json = Record<string, unknown>;
import type {Components} from './generated/components.ts';
import type {VerifyReport} from './generated/verify-report.ts';
import type {BuildRecord} from './generated/build-record.ts';
import type {Project} from './generated/project.ts';
import type {PartialArtifact} from './verify-inputs.ts';
export type ProjectView=PartialArtifact<Project>;
export type RatioSummary={pass:number;total:number;medianRatio:number|null;p75Ratio:number|null;maxRatio:number|null};
export type AccuracyPair={component:string;label:string;breakpoint:string;width:number|null;original:{ratio:number|null;pass:boolean|null};corrected:{ratio:number;pass:boolean}|null;heightDelta:number|null;widthDelta:number|null;figmaHeight?:number|null;liveHeight?:number|null;evidence:{specimen:string;geometry:string;index:number}|null};
export type AccuracySection={status:'measured'|'partial';source:string;threshold:number;tolerance:number;metrics:Record<'original'|'corrected',string>;overall:{original:RatioSummary;corrected:RatioSummary|null};byBreakpoint:Record<string,{original:RatioSummary;corrected:RatioSummary|null;heightDelta:{median:number|null;max:number|null;over10px:number}}> ;components:number;pairs:AccuracyPair[];reason?:string};
export type Accuracy=Omit<Partial<AccuracySection>,'status'>&{status?:'measured'|'partial'|'not-measured';reason?:string;howToMeasure?:string};

// ---------------------------------------------------------------------------- baseline value semantics

/** baseline truthiness: empty strings, lists and objects are false, as are 0, null and false. */
export function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return !!value;
}
/** baseline's `a or b or c`: the first truthy value, else the last one (undefined read as None). */
export function or<const V extends unknown[]>(...values: V): Exclude<V[number],undefined>|null {
  for (const value of values) if (truthy(value)) return value as Exclude<V[number],undefined>;
  return values.at(-1) as Exclude<V[number],undefined> ?? null;
}
/** baseline's dict view of a value that may not be an object: `x or {}` for documents read from disk. */
type Keys<T> = T extends unknown ? keyof T : never;
type Value<T,K extends PropertyKey> = T extends unknown ? K extends keyof T ? T[K] : never : never;
export type View<T> = {[K in Keys<T>]?:Value<T,K>};
export function obj<T extends object>(value:T|null|undefined):View<T>;
export function obj(value:unknown):Json;
export function obj(value:unknown):Json { return value && typeof value==='object' && !Array.isArray(value) ? value as Json : {}; }
export function list<T>(value:readonly T[]|null|undefined):T[];
export function list(value:unknown):unknown[];
export function list(value:unknown):unknown[] { return Array.isArray(value)?value:[]; }
/** str() of a scalar as baseline formats it in an f-string. */
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
/** f"{x:.Nf}", with baseline's even ties on the exact binary value. */
export const fixed = (value: number, digits: number): string => roundDecimal(Number(value), digits).toFixed(digits);
/** baseline's str.capitalize(). */
export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

// ---------------------------------------------------------------------------- files

export function readJson<T=unknown>(path: string): T|null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return null; }
}
/** Object lines of a JSON Lines file; blank, damaged and non-object lines are skipped. */
export function readJsonl<T extends object=Json>(path: string): T[] {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return []; }
  const entries:T[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) entries.push(value as T);
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

export function notMeasured<E extends object = Record<never,never>>(reason: string, how?: string | null, extra: E = {} as E): {status:'not-measured';reason:string;howToMeasure?:string} & E {
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
const pUsage = (c:NonNullable<ReturnType<typeof counts>>) => c.placements.total ? {placements:c.placements.total,covered:c.placements.covered,ratio:c.placements.ratio,structuralRefs:c.structural.total,structuralCovered:c.structural.covered} : notMeasured('no usage placements were recorded for this run');
function scoreCoverageResult(runDir: string) {
  const c = counts(runDir);
  if (c === null) return notMeasured('no components.json, so nothing says what the source holds');
  if (!c.builtKnown) {
    return notMeasured('no Figma build state, index or build records, so nothing says what was built',
      'let the build write its receipts (figma_build.ts receipts)');
  }
  const section = {
    status: 'measured' as const, found: c.found, eligible: c.eligible, built: c.built,
    ratio: c.ratio, gap: c.gap, excluded: c.excluded,
    reasonLabels: c.reasonLabels, summary: coverageSentence(c),
    items: c.notBuilt.map(r => ({ id: r.id, label: r.label, reason: r.status, detail: r.detail })),
    byTier: c.byTier, coverBreakdown: c.coverBreakdown,
    outsideInventory: c.outsideInventory,
    usageWeighted:pUsage(c),
  };
  return section;
}

// ---------------------------------------------------------------------------- conformance

function scoreConformanceResult(runDir: string, project:ProjectView|null) {
  let reportPath: string | null = null;
  for (const artifact of Object.values(obj(obj(project)['artifacts']))) {
    if (obj(artifact)['kind'] === 'verify-report') reportPath = resolve(runDir, String(obj(artifact)['path']));
  }
  const report = readJson<Omit<PartialArtifact<VerifyReport>,'open'> & {open?:(PartialArtifact<VerifyReport['open'][number]> & {id?:string;message?:string})[]}>(reportPath ?? resolve(runDir, 'verify-report.json'));
  if (!report || !truthy(report)) {
    const status = obj(obj(obj(project)['phases'])['verify'])['status'];
    return notMeasured(`no verification report; the verify phase is ${or(status, 'unrecorded')}`,
      'run design-lab:verify and register verify-report.json');
  }
  const open = list(report['open']), severities = new Map<string, number>();
  for (const item of open) { const key = or(obj(item)['severity'], 'unrated')!; severities.set(key, (severities.get(key) ?? 0) + 1); }
  const main = ['blocker', 'major', 'minor'];
  return {
    status: 'measured' as const,
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
export async function accuracyPairs(runDir: string): Promise<AccuracyPair[]> {
  const labels = new Map<string|null,string|null>(list(obj(readJson<PartialArtifact<Components>>(resolve(runDir, 'components.json')))['components'])
    .map(c => [obj(c)['id'] ?? null, obj(c)['label'] ?? null]));
  const pairs: AccuracyPair[] = [];
  for (const block of globSorted(resolve(runDir, 'figma/results'), 'block_', '.json')) {
    const name = block.slice(block.lastIndexOf('/') + 1), component = stem(name, '.json').slice('block_'.length);
    const specimen = resolve(runDir, 'figma/compare', `${component}.png`);
    const geometry = obj(readJson<{geometry?:Geometry}>(block)).geometry ?? {} as Geometry;
    if (!isFile(specimen) || !truthy(geometry.variants)) continue;
    const {original,corrected} = await figmaCompare(specimen, geometry);
    const captures = list(geometry.captures), variants = list(geometry.variants);
    for (let index = 0; index < Math.min(original.pairs.length, corrected.pairs.length); index++) {
      const old = original.pairs[index]!, now = corrected.pairs[index]!;
      const capture = obj(captures[index]), variant = obj(variants[index]);
      pairs.push({
        component, label: or(labels.get(component), component)!,
        breakpoint: breakpointOf(capture['label'] ?? '', index, captures.length),
        width: roundEven(or(capture['width'], now.width)!),
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
export function recordedPairs(runDir: string): AccuracyPair[] {
  const pairs: AccuracyPair[] = [];
  for (const record of globSorted(resolve(runDir, 'builds'), '', '.json')) {
    const data = obj(readJson<PartialArtifact<BuildRecord>>(record)), id = or(data['id'], stem(record.slice(record.lastIndexOf('/') + 1), '.json'))!;
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

export function summarise(pairs: AccuracyPair[], metric: 'original' | 'corrected') {
  const rows = pairs.filter(p => truthy(p[metric])), ratios = rows.map(p => p[metric]!['ratio'] as number);
  return { pass: rows.filter(p => p[metric]!['pass']).length, total: rows.length,
    medianRatio: median(ratios), p75Ratio: quantile(ratios, 0.75), maxRatio: maxOf(ratios) };
}

async function scoreAccuracyResult(runDir: string) {
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
  const byBreakpoint: Record<string,{original:RatioSummary;corrected:RatioSummary|null;heightDelta:{median:number|null;max:number|null;over10px:number}}> = {};
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
  const section: AccuracySection = {
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

export function coverage(runDir: string) {
  const section = scoreCoverage(resolve(runDir));
  if (section['status'] !== 'measured') return section;
  return { built: section['built'], inventoried: section['found'], buildable: section['eligible'], ratio: section['ratio'],
    placementShare: ('ratio' in section.usageWeighted! ? section.usageWeighted.ratio : null) };
}
export async function correctedWidths(runDir: string, accuracy?: Awaited<ReturnType<typeof scoreAccuracy>>): Promise<RatioSummary | null> {
  const section = accuracy ?? await scoreAccuracy(resolve(runDir));
  return 'overall' in section ? section.overall?.corrected ?? null : null;
}
export async function originalWidths(runDir: string, accuracy?: Awaited<ReturnType<typeof scoreAccuracy>>): Promise<RatioSummary | null> {
  const section = accuracy ?? await scoreAccuracy(resolve(runDir));
  return 'overall' in section ? section.overall?.original ?? null : null;
}
export function openFindings(runDir: string) {
  const section = scoreConformance(resolve(runDir), readJson<ProjectView>(resolve(runDir, 'project.json')));
  return section['status'] === 'measured' ? { ...section['open'], other: section['openOther'] } : null;
}
type CostView=Partial<Pick<import('./score-run.ts').Cost,'clock'|'working'|'runner'|'model'>>;
const recordedCost = (runDir:string):CostView => obj(obj(readJson<{sections?:{cost?:CostView}}>(resolve(runDir,'benchmark/scorecard.json'))).sections).cost ?? {};
/** Recorded token totals: a later scoring's model is never recomputed for the ledger. */
export function tokens(runDir: string, cost?: CostView) {
  const model = obj((cost ?? recordedCost(runDir))['model']);
  return model['status'] === 'measured' ? model['tokens'] ?? null : null;
}
export function elapsedTime(runDir: string, cost?: CostView) {
  const section = cost ?? recordedCost(runDir);
  const kept = Object.fromEntries((['clock','working','runner'] as const).filter(k=>truthy(section[k])).map(k=>[k,section[k]]));
  return truthy(kept) ? kept : null;
}
export async function metrics(runDir: string) {
  const accuracy = await scoreAccuracy(resolve(runDir));
  return { coverage: coverage(runDir), correctedWidths: await correctedWidths(runDir, accuracy),
    originalWidths: await originalWidths(runDir, accuracy), openFindings: openFindings(runDir),
    tokens: tokens(runDir), time: elapsedTime(runDir) };
}

export function scoreCoverage(...args:Parameters<typeof scoreCoverageResult>):View<ReturnType<typeof scoreCoverageResult>> & {status:ReturnType<typeof scoreCoverageResult>['status']} { return scoreCoverageResult(...args); }

export function scoreConformance(...args:Parameters<typeof scoreConformanceResult>):View<ReturnType<typeof scoreConformanceResult>> & {status:ReturnType<typeof scoreConformanceResult>['status']} { return scoreConformanceResult(...args); }

export async function scoreAccuracy(...args:Parameters<typeof scoreAccuracyResult>):Promise<View<Awaited<ReturnType<typeof scoreAccuracyResult>>> & {status:Awaited<ReturnType<typeof scoreAccuracyResult>>['status']}> { return await scoreAccuracyResult(...args); }
