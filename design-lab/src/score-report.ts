/** Self-contained benchmark report, preserving the baseline oracle's text, charts and styles. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sharedRequire } from './runtime.ts';
import { roundEven } from './json.ts';
import { resizeRgb } from './report-images.ts';
import { COVER_GROUND, COVER_LABELS, TIER_COLORS } from './library-counts.ts';
import { flattenRgbaOverWhite } from './figma-compare.ts';
import type { Scorecard } from './generated/scorecard.ts';
import { compact, day, duration, esc, fixed, floatString, num, own, pct, pyStr, sixDigits, sortedBy, splitDuration, stamp } from './report-format.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;

type Sections = Scorecard['sections'];
interface Explained { reason?: string; howToMeasure?: string }
/** Fields score-run writes that the closed scorecard schema does not declare yet. The report reads them. */
interface Undeclared {
  identity: Explained;
  library: Explained;
  repeatability: { levelNote?: string };
  cost: { developer?: { sessionWarning?: string }; model?: { caveat?: string | null } };
}
export type ReportSections = { [K in keyof Sections]: K extends keyof Undeclared ? Sections[K] & Undeclared[K] : Sections[K] };
/** The scorecard as the report reads it: every Scorecard, plus the undeclared fields above. */
export type ReportCard = Omit<Scorecard, 'sections'> & { sections: ReportSections };

type Coverage = ReportSections['coverage'];
type Library = ReportSections['library'];
type Accuracy = ReportSections['accuracy'];
type Pair = NonNullable<Accuracy['pairs']>[number];
type Cost = ReportSections['cost'];
type Runner = NonNullable<Cost['runner']>;
type Working = NonNullable<Cost['working']>;
type ModelUsage = NonNullable<Cost['model']>;
type Metric = 'original' | 'corrected';
interface Measure { ratio?: number; pass?: boolean }
/** The part of a section the "not measured" panel reads. */
interface Absence { status?: string; reason?: string; howToMeasure?: string }
/** One side of a figma/live thumbnail pair, as an embedded WebP data URI. */
export interface Thumbnail { src: string; w: number; h: number; cropped: boolean }
/** Desktop thumbnails by component, in pair order. */
export type Thumbnails = Map<string, Partial<Record<'figma' | 'live', Thumbnail>>>;

/** An object read from JSON counts as present only when it has a key, as in the baseline. */
const hasEntries = (value: object | null | undefined): value is object => value != null && Object.keys(value).length > 0;
const measureOf = (pair: Pair, metric: Metric): Measure | undefined => (metric === 'corrected' ? pair.corrected : pair.original) ?? undefined;
const plural = (n: number | undefined, word: string): string => `${word}${n !== 1 ? 's' : ''}`;

const BREAKPOINT_NAMES: Readonly<Record<string, string>> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };
const bpName = (name: string): string => own(BREAKPOINT_NAMES, name) ?? name;
const BP_ORDER: Readonly<Record<string, number>> = { desktop: 0, tablet: 1, mobile: 2 };
const RATIO_EDGES = [0.02, 0.04, 0.06, 0.09, 0.12, 0.18, 0.25, 0.35, 0.5] as const;
const HEIGHT_EDGES = [1, 2, 5, 10, 25, 50, 100] as const;
const BINS = [[0.02, 'q5', 'under 2%'], [0.06, 'q4', '2–6%'], [0.12, 'q3', '6–12%'], [0.25, 'q2', '12–25%'], [9.0, 'q1', 'over 25%']] as const;
const THUMB_WIDTH = 520;
const THUMB_MAX_HEIGHT = 300;
const STATUS: Readonly<Record<string, readonly [string, string]>> = {
  measured: ['Measured', '●'], partial: ['Partly measured', '◐'], 'not-measured': ['Not measured', '○'], 'scored-later': ['Scored later', '◌'],
};

interface Box { x: number; y: number; width: number; height: number }
interface GeometryFile { geometry?: { variants?: Box[]; captures?: Box[] } }
interface Canvas { data: Buffer; width: number; height: number }
async function specimenOverWhite(path: string): Promise<Canvas> {
  const decoded = await sharp(path).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: Buffer.from(flattenRgbaOverWhite(decoded.data)), width: decoded.info.width, height: decoded.info.height };
}
async function thumbnail(canvas: Canvas, box: Box): Promise<Thumbnail> {
  const x = roundEven(box.x), y = roundEven(box.y), w = roundEven(box.width), h = roundEven(box.height);
  if (w <= 0 || h <= 0) throw new Error('invalid thumbnail crop');
  // Pillow permits out-of-bounds crops and pads them black.
  const raw = Buffer.alloc(w * h * 3);
  for (let row = 0; row < h; row++) {
    const sy = y + row, left = Math.max(0, x), right = Math.min(canvas.width, x + w);
    if (sy < 0 || sy >= canvas.height || right <= left) continue;
    canvas.data.copy(raw, (row * w + left - x) * 3, (sy * canvas.width + left) * 3, (sy * canvas.width + right) * 3);
  }
  const scale = Math.min(1, THUMB_WIDTH / Math.max(1, w)), width = Math.max(1, roundEven(w * scale)), height = Math.max(1, roundEven(h * scale));
  const shown = Math.min(height, THUMB_MAX_HEIGHT);
  const bytes = await sharp(resizeRgb(raw, w, h, width, height, shown), { raw: { width, height: shown, channels: 3 } }).webp({ quality: 72, effort: 5 }).toBuffer();
  return { src: 'data:image/webp;base64,' + bytes.toString('base64'), w: width, h: shown, cropped: height > THUMB_MAX_HEIGHT };
}
/** Figma and live crops of each component's specimen screenshot at one breakpoint. */
export async function thumbnails(runDir: string, pairs: readonly Pair[], breakpoint: string): Promise<Thumbnails> {
  const wanted = new Map<string, Pair>();
  for (const p of pairs) if (p.breakpoint === breakpoint && p.evidence) wanted.set(p.component, p);
  const result: Thumbnails = new Map();
  for (const [component, pair] of wanted) {
    const ev = pair.evidence ?? {};
    // Geometry-file read errors deliberately propagate, matching the oracle.
    if (ev.geometry === undefined) throw new Error(`comparison evidence for ${component} names no geometry file`);
    const doc: GeometryFile = JSON.parse(readFileSync(resolve(runDir, ev.geometry), 'utf8'));
    const geometry = doc.geometry ?? {};
    const variant = ev.index === undefined ? undefined : geometry.variants?.[ev.index];
    const capture = ev.index === undefined ? undefined : geometry.captures?.[ev.index];
    if (!variant || !capture || ev.specimen === undefined) continue;
    let canvas: Canvas;
    try { canvas = await specimenOverWhite(resolve(runDir, ev.specimen)); } catch { continue; }
    result.set(component, { figma: await thumbnail(canvas, variant), live: await thumbnail(canvas, capture) });
  }
  return result;
}

export function coverageStrip(cov: Coverage): string {
  if (cov.status !== 'measured') return '';
  const labels = cov.reasonLabels ?? {}, gap = cov.gap ?? {}, items = cov.items ?? [];
  const label = (k: string | undefined): string | undefined => own(labels, k) ?? k;
  const isGap = (reason: string | undefined): boolean => Object.hasOwn(gap, String(reason));
  const breakdown: { tier?: string; built?: number | undefined }[] = cov.coverBreakdown?.length ? cov.coverBreakdown : [{ tier: 'Other', built: cov.built }];
  const squares: string[] = [];
  for (const row of breakdown) {
    const name = own(COVER_LABELS, row.tier) ?? row.tier;
    const square = `<span class="c-built" style="background:${pyStr(own(TIER_COLORS, row.tier))}" data-tier="${esc(row.tier)}" title="built · ${esc(name)}"></span>`;
    squares.push(...Array.from({ length: row.built ?? 0 }, () => square));
  }
  for (const item of sortedBy(items, item => !isGap(item.reason))) {
    const kind = isGap(item.reason) ? 'c-gap' : item.reason === 'retirement' ? 'c-out c-retire' : 'c-out';
    squares.push(`<span class="${kind}" title="${esc(item.label)}: ${esc(own(labels, item.reason))}"></span>`);
  }
  const notBuilt = Object.entries(gap).filter(([, n]) => n).map(([k, n]) => `${n} ${pyStr(label(k))}`);
  const notCounted = Object.entries(cov.excluded ?? {}).filter(([, n]) => n)
    .map(([k, n]) => `<span class="key ${k === 'retirement' ? 'key-retire' : 'key-out'}"></span>${n} ${esc(label(k))}${n !== 1 && k === 'retirement' ? 's' : ''}`);
  const parts = breakdown.map(row => `<span class="key" style="--k:${pyStr(own(TIER_COLORS, row.tier))}"></span><b>${pyStr(row.built)}</b> ${esc(own(COVER_LABELS, row.tier) ?? row.tier)}`);
  if (notBuilt.length) parts.push('<span class="key key-gap"></span>not built: ' + notBuilt.map(esc).join('; '));
  if (notCounted.length) parts.push('not counted: ' + notCounted.join('; '));
  const usage = cov.usageWeighted ?? {};
  let weighted = '';
  if (usage.placements) {
    weighted = `<p class="cov-w">Built components carry <b>${num(usage.covered)} of ${num(usage.placements)}</b> placements on the site (<b>${fixed((usage.ratio ?? 0) * 100, 0)}%</b>)`
      + (usage.structuralRefs ? ` and ${num(usage.structuralCovered)} of ${num(usage.structuralRefs)} nested uses` : '') + '.</p>';
    const outside = cov.outsideInventory ?? [];
    if (outside.length) {
      const placements = outside.reduce((n, o) => n + (o.placements ?? 0), 0), nested = outside.reduce((n, o) => n + (o.structural ?? 0), 0);
      const disclosure = ` The usage scan also saw ${outside.length} ${plural(outside.length, 'item')} outside the inventory (${placements} ${plural(placements, 'placement')}, ${nested} ${plural(nested, 'nested use')}), not counted here.</p>`;
      weighted = weighted.replace('</p>', () => disclosure);
    }
  }
  return `<div class="cov" role="img" aria-label="${esc(cov.summary)}" style="--ground:${COVER_GROUND}"><div class="cov-sq" aria-hidden="true">${squares.join('')}</div><p class="cov-k">${parts.join(' · ')}</p></div>${weighted}`;
}

function binOf(ratio: number | undefined): string {
  if (ratio !== undefined) for (const [limit, name] of BINS) if (ratio <= limit) return name;
  return 'q1';
}

function statusTag(status: string): string {
  const [label, glyph] = own(STATUS, status) ?? [status, '·'];
  return `<span class="tag tag-${esc(status)}"><span aria-hidden="true">${glyph}</span> ${esc(label)}</span>`;
}

function section(ident: string, title: string, status: string, lead: string, body: string): string {
  return `<section class="sec" id="${ident}" aria-labelledby="${ident}-h"><header class="sec-head"><h2 id="${ident}-h">${esc(title)}</h2>${statusTag(status)}</header><p class="lead">${lead}</p>${body}</section>`;
}

export function absent(title: string, part: Absence): string {
  const how = part.howToMeasure;
  return `<div class="absent" role="note"><p class="absent-t">${esc(title)}</p><p>${esc(part.reason || 'No evidence for this run.')}</p>`
    + (how ? `<p class="how"><span>Next run:</span> ${esc(how)}</p>` : '') + '</div>';
}

/** Pairs by component, then by breakpoint; a later pair for the same width replaces an earlier one. */
function byComponent(pairs: readonly Pair[]): Map<string, Map<string, Pair>> {
  const components = new Map<string, Map<string, Pair>>();
  for (const p of pairs) {
    const widths = components.get(p.component) ?? new Map<string, Pair>();
    components.set(p.component, widths.set(p.breakpoint, p));
  }
  return components;
}
const ratioSum = (widths: ReadonlyMap<string, Pair>, metric: Metric): number => [...widths.values()].reduce((n, p) => n + (measureOf(p, metric)?.ratio ?? 0), 0);
const passCount = (widths: ReadonlyMap<string, Pair>, metric: Metric): number => [...widths.values()].filter(p => measureOf(p, metric)?.pass).length;

export function field(accuracy: Accuracy): string {
  const pairs = accuracy.pairs ?? [];
  const metric: Metric = hasEntries(pairs[0]?.corrected) ? 'corrected' : 'original';
  const components = byComponent(pairs);
  const rows = ['desktop', 'tablet', 'mobile'].filter(b => [...components.values()].some(widths => widths.has(b)));
  const fails = (widths: ReadonlyMap<string, Pair>): boolean[] => rows.map(b => { const p = widths.get(b); return !(p && measureOf(p, metric)?.pass); });
  const order = sortedBy(components, ([, widths]) => {
    const verdicts = fails(widths);
    return [verdicts.filter(Boolean).length, verdicts, ratioSum(widths, metric) / Math.max(1, widths.size)];
  });
  const cell = 30, gap = 4, labelW = 86, width = labelW + order.length * (cell + gap), height = rows.length * (cell + gap);
  const out = [`<svg class="field-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="field-t field-d"><title id="field-t">Closeness to the live site, every component at every width</title><desc id="field-d">${esc(fieldDesc(accuracy, metric))}</desc>`];
  rows.forEach((name, r) => {
    const y = r * (cell + gap);
    out.push(`<text class="f-row" x="${labelW - 12}" y="${floatString(y + cell / 2 + 4)}" text-anchor="end">${bpName(name)}</text>`);
    order.forEach(([, widths], c) => {
      const pair = widths.get(name), x = labelW + c * (cell + gap);
      if (pair === undefined) {
        out.push(`<rect class="f-none" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3"/>`);
        return;
      }
      const value = measureOf(pair, metric);
      const tip = `${pyStr(pair.label)} · ${bpName(name)} ${pyStr(pair.width)}px · ${pct(value?.ratio, 1)} of pixels differ`
        + (metric === 'corrected' ? ` (original measure ${pct(pair.original.ratio, 1)})` : '')
        + (pair.heightDelta ? ` · ${num(pair.heightDelta)}px height difference` : '')
        + (value?.pass ? ' · within tolerance' : '');
      out.push(`<g class="f-cell" tabindex="0" data-tip="${esc(tip)}"><rect class="${binOf(value?.ratio)}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3"/>`
        + (value?.pass ? `<path class="f-check" d="M${x + 9} ${y + 15.5}l4.5 4.5 8-9"/>` : '') + '</g>');
    });
  });
  out.push('</svg>');
  const legend = BINS.map(([, name, text]) => `<li><span class="sw ${name}"></span>${esc(text)}</li>`).join('');
  return out.join('') + `<div class="field-key"><p class="mono">Pixels that differ from the live capture</p><ul class="bins">${legend}</ul><p class="mono key-note"><svg width="14" height="12" aria-hidden="true"><path class="f-check key" d="M1 6l4 4 8-9"/></svg> within the ${pct(accuracy.threshold, 0)} tolerance</p></div>`;
}

function fieldDesc(accuracy: Accuracy, metric: Metric): string {
  const parts = Object.entries(accuracy.byBreakpoint ?? {}).map(([name, value]) => {
    const m: { pass?: number; total?: number; medianRatio?: number } = value[metric] ?? {};
    return `${bpName(name)}: ${pyStr(m.pass)} of ${pyStr(m.total)} within tolerance, median ${pct(m.medianRatio, 1)} of pixels differ`;
  });
  return parts.join('; ') + '.';
}

function passBars(accuracy: Accuracy): string {
  const rows = Object.entries(accuracy.byBreakpoint ?? {});
  if (!rows.length) return '';
  const total = Math.max(...rows.map(([, value]) => value.original?.total ?? 0)) || 1;
  const barH = 12, gap = 4, groupGap = 22, labelW = 70, plotW = 330, height = rows.length * (2 * barH + gap + groupGap);
  const out = [`<svg class="bars" viewBox="0 0 ${labelW + plotW + 90} ${height}" role="img" aria-labelledby="pb-t"><title id="pb-t">Widths within tolerance, original and corrected measure, by breakpoint</title>`];
  out.push(`<line class="axis" x1="${labelW}" x2="${labelW}" y1="0" y2="${height - groupGap + 6}"/>`);
  rows.forEach(([name, value], i) => {
    const y = i * (2 * barH + gap + groupGap);
    out.push(`<text class="axis-l" x="${labelW - 12}" y="${y + barH + 5}" text-anchor="end">${bpName(name)}</text>`);
    (['original', 'corrected'] as const).forEach((metric, j) => {
      const m = value[metric];
      if (!hasEntries(m)) return;
      // A bar narrower than its 2px minimum keeps the baseline's integer coordinates.
      const w = Math.max(2, ((m.pass ?? 0) / total) * plotW), by = y + j * (barH + gap), right = labelW + w + 8;
      out.push(`<g tabindex="0" data-tip="${bpName(name)}, ${metric} measure: ${pyStr(m.pass)} of ${pyStr(m.total)} within tolerance"><path class="bar ${metric}" d="${barPath(labelW, by, w, barH, 4, w > 2)}"/><text class="val" x="${w > 2 ? floatString(right) : String(right)}" y="${by + barH - 2}">${pyStr(m.pass)}<tspan class="of"> of ${pyStr(m.total)}</tspan></text></g>`);
    });
  });
  out.push('</svg>');
  return out.join('');
}

function barPath(x: number, y: number, w: number, h: number, r = 4, wFloat = false): string {
  const radius = Math.min(r, w / 2, h / 2), rFloat = radius !== r, rs = rFloat ? floatString(radius) : String(radius), d = w - radius, ds = wFloat || rFloat ? floatString(d) : String(d), v = h - 2 * radius;
  return `M${x} ${y}h${ds}a${rs} ${rs} 0 0 1 ${rs} ${rs}v${rFloat ? floatString(v) : v}a${rs} ${rs} 0 0 1 -${rs} ${rs}h-${ds}z`;
}

/** Index of the first bin edge a value does not exceed; past the last edge is the overflow bin. */
function binIndex(value: number | undefined, edges: readonly number[]): number {
  const index = value === undefined ? -1 : edges.findIndex(edge => value <= edge);
  return index < 0 ? edges.length : index;
}
interface Histogram<V extends number | undefined> {
  edges: readonly number[];
  thresholdBins?: number;
  title: string;
  edgeLabel: (edge: number) => string;
  tip: (value: V) => string;
  rows?: number;
}
function dotHistogram<V extends number | undefined>(values: readonly V[], { edges, thresholdBins, title, edgeLabel, tip, rows }: Histogram<V>): string {
  const labels = [`≤${edgeLabel(edges[0] ?? 0)}`, ...edges.slice(1).map((b, i) => `${edgeLabel(edges[i] ?? 0)}–${edgeLabel(b)}`), `>${edgeLabel(edges.at(-1) ?? 0)}`];
  const bins: V[][] = labels.map(() => []);
  for (const v of values) bins[binIndex(v, edges)]?.push(v);
  const width = 400, left = 2, dot = 6, col = (width - left * 2) / labels.length, cap = 9;
  const tallest = Math.min(cap, Math.max(1, rows || 0, ...bins.map(b => b.length)));
  const stack = tallest * (dot * 2 + 2), height = stack + 62, base = stack + 22;
  const counts = bins.flatMap((b, i) => b.length ? [`${b.length} at ${labels[i]}`] : []).join(', ');
  const out = [`<svg class="hist" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}: ${esc(counts)}">`];
  if (thresholdBins) out.push(`<rect class="pass-zone" x="${left}" y="0" width="${thresholdBins * col}" height="${base}" rx="4"/><text class="t-note" x="${left + 4}" y="14">within tolerance</text>`);
  out.push(`<line class="axis" x1="${left}" x2="${width - left}" y1="${base + 0.5}" y2="${base + 0.5}"/>`);
  bins.forEach((items, i) => {
    const cx = fixed(left + (i + 0.5) * col, 1), sorted = sortedBy(items, v => v);
    (items.length > cap ? sorted.slice(0, cap - 1) : sorted).forEach((v, k) => {
      const cy = base - dot - 2 - k * (dot * 2 + 2);
      out.push(`<circle class="dot" cx="${cx}" cy="${fixed(cy, 1)}" r="${dot - 0.5}" tabindex="0" data-tip="${esc(tip(v))}"/>`);
    });
    if (items.length > cap) {
      const cy = base - dot - 2 - (cap - 1) * (dot * 2 + 2);
      out.push(`<text class="cnt" x="${cx}" y="${fixed(cy + 4, 1)}" text-anchor="middle">+${items.length - cap + 1}</text>`);
    }
    out.push(`<text class="tick" x="${cx}" y="${base + 18}" text-anchor="middle">${esc(labels[i])}</text>`);
    if (items.length) out.push(`<text class="cnt" x="${cx}" y="${base + 36}" text-anchor="middle">${items.length}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}

function barList(items: readonly (readonly [string, number])[], { unitFmt, title }: { unitFmt: (value: number) => string; title: string }): string {
  if (!items.length) return '';
  const peak = Math.max(...items.map(([, v]) => v)) || 1;
  const row = 24, labelW = 150, plotW = 360;
  const out = [`<svg class="bars" viewBox="0 0 ${labelW + plotW + 80} ${items.length * row}" role="img" aria-label="${esc(title)}">`];
  items.forEach(([name, value], i) => {
    const y = i * row, w = Math.max(2, (value / peak) * plotW), right = labelW + w + 8;
    out.push(`<text class="axis-l" x="${labelW - 10}" y="${y + 15}" text-anchor="end">${esc(name)}</text><path class="bar corrected" d="${barPath(labelW, y + 5, w, 12, 4, w > 2)}"/><text class="val" x="${w > 2 ? floatString(right) : String(right)}" y="${y + 15}">${esc(unitFmt(value))}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}

function verdict(label: string, figure: string, unit: string, caption: string, state = 'measured'): string {
  return `<div class="v v-${state}"><p class="v-l">${esc(label)}</p><p class="v-n">${figure}<span class="v-u">${unit}</span></p><p class="v-c">${caption}</p></div>`;
}
const WAITS = [['waitingOnPersonSeconds', 'the person'], ['waitingOnLimitsSeconds', 'usage limits'], ['waitingOnServiceSeconds', 'the service']] as const;
const modelTotals = (rows: readonly { total?: number; name?: string }[]): string => rows.map(r => `${num(r.total)} ${esc(r.name)}`).join(', ');

function hero(card: ReportCard): string {
  const s = card.sections, head = card.headline, identity = s.identity.fields ?? {}, built = head.built, cov = s.coverage;
  const { corrected: corr, original: orig } = head.accuracy;
  let title: string;
  if (cov.status === 'measured' && cov.eligible) title = `Built ${pyStr(cov.built)} of ${cov.eligible} components it could have built (${fixed((cov.ratio ?? 0) * 100, 0)}%).`;
  else if (built.components) title = `${num(built.components)} components, rebuilt in Figma from the live site.`;
  else title = 'A design-lab run, scored.';
  const commit = (identity.repositoryCommit || '').slice(0, 7);
  const dek = `Built ${day(identity.startedAt)} with design-lab ${esc(identity.pluginVersion)}` + (commit ? ` from repository commit <code>${esc(commit)}</code>` : '')
    + '. Every figure on this page is measured from the evidence the run left behind; anything that was not recorded says so.';
  const yieldItems = [['components', built.components], ['variants', built.variants], ['variables', built.variables], ['pages', built.pages], ['Figma nodes', built.nodes]] as const;
  const yields = built.components ? yieldItems.filter(([, value]) => value).map(([label, value]) => `<div class="y"><dt>${esc(label)}</dt><dd>${num(value)}</dd></div>`).join('') : '';
  const blocks: string[] = [];
  if (hasEntries(corr)) {
    const medianMatch = corr.medianRatio != null ? 1 - corr.medianRatio : null;
    blocks.push(verdict('Faithful to the live site', pyStr(corr.pass), ` of ${pyStr(corr.total)}`, `widths within ${pct(s.accuracy.threshold)} of the live capture on the corrected measure; ${pyStr(orig?.pass)} of ${pyStr(orig?.total)} on the original. The typical width matches ${pct(medianMatch)} of live pixels.`));
  } else if (hasEntries(orig)) blocks.push(verdict('Faithful to the live site', pyStr(orig.pass), ` of ${pyStr(orig.total)}`, 'widths within tolerance on the original measure.'));
  else blocks.push(verdict('Faithful to the live site', '–', '', 'not measured for this run', 'none'));
  const runner: Runner = s.cost.runner ?? {}, working: Partial<Working> = s.cost.working ?? {}, made: Partial<NonNullable<Working['production']>> = working.production ?? {};
  const build = runner.steps ? `The Figma build itself took ${duration(runner.activeSeconds)} over ${num(runner.steps)} steps, with no model in the loop.` : 'No runner log for this run.';
  if (made.status === 'measured') {
    const waits = WAITS.filter(([k]) => made[k]).map(([k, what]) => `${duration(made[k])} waiting on ${what}`);
    const bench: Partial<NonNullable<Working['benchmark']>> = working.benchmark ?? {};
    const [figure, unit] = splitDuration(made.workingSeconds ?? 0);
    blocks.push(verdict('design-lab took', figure, unit, 'of working time to produce the library, when Claude or its tools were working'
      + (waits.length ? `; ${waits.join(', ')} not counted` : '') + (bench.status === 'measured' ? `. The benchmark took ${duration(bench.workingSeconds)} more` : '') + '. ' + build));
  } else if (runner.steps) {
    const [figure, unit] = splitDuration(runner.activeSeconds ?? 0);
    blocks.push(verdict('Figma build time', figure, unit, `${num(runner.steps)} steps written by the runner, no model in the loop. Working time was not measured for this run: score it with --session &lt;id&gt; to measure when Claude or its tools were working.`));
  } else blocks.push(verdict('Working time', '–', '', 'not measured for this run; score with --session &lt;id&gt; to measure when Claude or its tools were working', 'none'));
  const model: Partial<ModelUsage> = s.cost.model ?? {}, production = model.production?.byModel ?? [];
  const [top, ...others] = production;
  if (model.status === 'measured' && top) {
    const bench: Partial<NonNullable<ModelUsage['benchmark']>> = model.benchmark ?? {};
    const added = bench.status === 'measured' ? '; benchmarking added ' + (modelTotals(bench.byModel ?? []) || 'none') : '; benchmark tokens not separated';
    const caption = `Used ${num(top.total)} ${esc(top.name)} tokens to produce the library, ${num(top.output)} of them output` + (others.length ? '; also ' + modelTotals(others) : '') + added + '.';
    blocks.push(verdict(`${pyStr(top.name)} tokens`, compact(top.total), '', caption));
  } else blocks.push(verdict('Model tokens', '–', '', 'not measured for this run; score with --session &lt;id&gt; to count them by model', 'none'));
  if (s.repeatability.status === 'measured') {
    const scored = (s.repeatability.comparisons ?? []).filter(row => Object.hasOwn(row, 'score'));
    const ident = Math.min(...scored.map(row => row.identicalApartFromAddresses ?? 0)), total = Math.max(...scored.map(row => row.totalNodes ?? 0));
    blocks.push(verdict('Repeatable', fixed((ident / total) * 100, 2), '%', `of ${num(total)} nodes identical across ${scored.length + 1} runs, apart from each file's own links.`));
  } else blocks.push(verdict('Repeatable', '–', '', 'one run only; score with --compare after a second run', 'none'));
  const highs = head.highlights.filter(h => !h.startsWith('The Figma build ran')).map(h => `<li>${esc(h)}</li>`).join('');
  const fld = s.accuracy.pairs?.length ? `<figure class="field"><figcaption><span class="mono">Every width, every component</span><span>Most widths within tolerance first, grouped by which widths pass, then by closeness. Hover or focus a square for its numbers.</span></figcaption>${field(s.accuracy)}</figure>` : '';
  return `<section class="hero" aria-labelledby="hero-h"><p class="site">${esc(card.run.siteLabel)}</p><h1 id="hero-h">${esc(title)}</h1>${coverageStrip(cov)}<p class="dek">${dek}</p>`
    + (yields ? `<dl class="yield">${yields}</dl>` : '') + `<div class="verdicts">${blocks.join('')}</div>`
    + (highs ? `<ul class="highlights" aria-label="Highlights">${highs}</ul>` : '') + `${fld}</section>`;
}

type Step = readonly [className: string, count: number | null | undefined, text: string];
function librarySection(lib: Library, cov: Coverage): string {
  if (lib.status === 'not-measured') return section('library', 'What the run built', 'not-measured', 'Nothing to count.', absent('Library contents', lib));
  const comp = lib.components, labels = cov.reasonLabels ?? {};
  const label = (k: string | undefined): string | undefined => own(labels, k) ?? k;
  let steps: Step[];
  if (cov.status === 'measured') {
    const counted = (record: Readonly<Record<string, number>> | undefined) => Object.entries(record ?? {}).filter(([, n]) => n);
    steps = [['', cov.found, 'found in the source'],
      ...counted(cov.excluded).map(([k, n]): Step => ['muted', n, `${pyStr(label(k))}${n !== 1 && k === 'retirement' ? 's' : ''} not counted`]),
      ['', cov.eligible, 'it could have built'], ['', cov.built, 'built in Figma'],
      ...counted(cov.gap).map(([k, n]): Step => ['muted', n, label(k) ?? k])];
  } else steps = [['', comp?.found, 'found in the source'], ['', comp?.planned, 'planned to build'], ['', comp?.built, 'built in Figma'], ['muted', comp?.refused, 'refused by the plan']];
  const funnel = '<ol class="funnel">' + steps.map(([c, n, text]) => (c ? `<li class="${c}">` : '<li>') + `<b>${num(n)}</b> ${esc(text)}</li>`).join('') + '</ol>';
  const rows = lib.tierTable ?? [], found = rows.map(r => r.found ?? 0);
  const peak = (found.length ? Math.max(...found) : 0) || 1;
  const holds = (tiers: NonNullable<(typeof rows)[number]['holds']>): string => tiers.map(h => `${pyStr(h.tier)}: ${pyStr(h.built)} of ${pyStr(h.found)} built`).join('; ');
  const tierRows = rows.map(r => (r.counted ? '<tr>' : '<tr class="out">')
    + `<th scope="row"><span class="t-sw" style="background:${pyStr(r.color)}"></span>${esc(r.label)}`
    + (r.holds?.length ? `<span class="t-note">${esc(holds(r.holds))}</span>` : '') + (!r.counted ? '<span class="t-note">not counted</span>' : '')
    + `</th><td class="n">${num(r.built)}</td><td class="n">${num(r.found)}</td><td><span class="t-bar" style="--v:${floatString((r.built ?? 0) / peak)};--f:${floatString((r.found ?? 0) / peak)};--c:${pyStr(r.color)}"></span></td></tr>`).join('');
  const total = rows.filter(r => r.counted).reduce((n, r) => n + (r.built ?? 0), 0), totalFound = found.reduce((n, f) => n + f, 0);
  const tierTable = tierRows ? `<div class="tier-panel" style="--ground:${COVER_GROUND}"><table class="tbl tiers"><caption>By usage tier, as on the Cover</caption><thead><tr><th scope="col">Category</th><th scope="col" class="n">Built</th><th scope="col" class="n">Found</th><th scope="col"><span class="sr">Built out of found</span></th></tr></thead><tbody>${tierRows}<tr class="sum"><th scope="row">Total</th><td class="n">${num(total)}</td><td class="n">${num(totalFound)}</td><td></td></tr></tbody></table></div>` : '';
  const pages = (lib.pageNames ?? []).map(p => `<li>${esc(p)}</li>`).join('');
  const extras = [lib.voicePage ? 'a brand voice and language page' : '', lib.examplesPage ? 'an examples page assembled from real compositions' : ''].filter(Boolean);
  let notBuilt: string;
  if (cov.status === 'measured') {
    const why = (item: NonNullable<Coverage['items']>[number]): string => `<li><b>${esc(item.label)}</b> — ${esc(label(item.reason))}` + (item.detail ? `: ${esc(item.detail)}` : '') + '</li>';
    const gap = cov.gap ?? {}, items = cov.items ?? [];
    const gapItems = items.filter(i => Object.hasOwn(gap, String(i.reason))), outItems = items.filter(i => !Object.hasOwn(gap, String(i.reason)));
    notBuilt = (gapItems.length ? `<h3>Not built, and why</h3><ul class="plain">${gapItems.map(why).join('')}</ul>` : '')
      + (outItems.length ? `<h3 class="h-gap">Not counted, and why</h3><ul class="plain">${outItems.map(why).join('')}</ul>` : '');
  } else {
    const items = (lib.notBuiltReasons ?? []).map(i => `<li><b>${esc(i.label || i.id)}</b> — ${esc(i.reason)}</li>`).join('');
    notBuilt = items ? `<h3>Not built, and why</h3><ul class="plain">${items}</ul>` : '';
  }
  const lead = (comp?.built != null ? `${num(comp.built)} components with ` : `No build was recorded; the plan holds ${num(comp?.planned)} components with `)
    + `${num(lib.variants)} variants and ${num(lib.properties)} properties, bound to ${num(lib.variables)} variables` + (extras.length ? ', plus ' + extras.join(' and ') : '') + '.';
  const body = `<div class="two">${funnel}${tierTable}</div><div class="two"><div>` + (pages ? `<h3>Pages in the file</h3><ul class="chips">${pages}</ul>` : '') + '</div>'
    + (notBuilt ? `<div>${notBuilt}</div>` : '') + '</div>';
  return section('library', 'What the run built', 'measured', esc(lead), body);
}

const ratioTip = (v: number | undefined): string => pct(v, 1);
const heightTip = (v: number): string => `${sixDigits(v)} px`;
/** The tallest bin across the breakpoints, so every histogram shares one scale. */
function tallestBin(valuesByBreakpoint: readonly (readonly (number | undefined)[])[], edges: readonly number[]): number {
  const heights = valuesByBreakpoint.flatMap(values => {
    const counts = new Map<number, number>();
    for (const v of values) { const i = binIndex(v, edges); counts.set(i, (counts.get(i) ?? 0) + 1); }
    return [...counts.values()];
  });
  return Math.max(1, ...heights);
}

function accuracySection(acc: Accuracy, thumbs: Thumbnails): string {
  if (acc.status === 'not-measured') return section('accuracy', 'Accuracy against the live site', 'not-measured', 'No comparison evidence.', absent('Accuracy', acc));
  const corrected = acc.overall?.corrected, orig = acc.overall?.original, byBreakpoint = acc.byBreakpoint ?? {}, pairs = acc.pairs ?? [];
  const lead = 'Each component is compared with its live capture at every width. ' + (hasEntries(corrected)
    ? `${pyStr(corrected.pass)} of ${pyStr(corrected.total)} widths are within tolerance on the corrected measure, ${pyStr(orig?.pass)} of ${pyStr(orig?.total)} on the original one.`
    : `${pyStr(orig?.pass)} of ${pyStr(orig?.total)} widths are within tolerance on the original measure.`);
  const metrics = acc.metrics ?? {};
  const explain = `<dl class="defs"><div><dt><span class="key-sw original"></span>Original measure</dt><dd>${esc(own(metrics, 'original'))}</dd></div><div><dt><span class="key-sw corrected"></span>Corrected measure</dt><dd>${esc(own(metrics, 'corrected'))} A width passes when no more than ${pct(acc.threshold)} of its pixels differ by over ${esc(acc.tolerance)} levels.</dd></div></dl>`;
  const perBreakpoint = Math.floor((orig?.total ?? 0) / Math.max(1, Object.keys(byBreakpoint).length));
  const chart = `<figure class="chart"><figcaption><h3>Widths within tolerance</h3><p>Out of ${num(perBreakpoint)} components per breakpoint.</p></figcaption>${passBars(acc)}</figure>`;
  const metric: Metric = hasEntries(corrected) ? 'corrected' : 'original';
  const ratios = (subset: readonly Pair[]) => subset.map(p => measureOf(p, metric)?.ratio), heights = (subset: readonly Pair[]) => subset.map(p => p.heightDelta || 0);
  const groups = Object.keys(byBreakpoint).map(n => pairs.filter(p => p.breakpoint === n));
  const ratioRows = tallestBin(groups.map(ratios), RATIO_EDGES), heightRows = tallestBin(groups.map(heights), HEIGHT_EDGES);
  const passingBins = RATIO_EDGES.filter(e => e <= (acc.threshold ?? 0)).length;
  const multiples = Object.entries(byBreakpoint).map(([name, value]) => {
    const subset = pairs.filter(p => p.breakpoint === name), label = bpName(name);
    return `<div class="sm"><h4>${label}</h4><p class="sm-stat">Pixels that differ, percent · median <b>${pct(value[metric]?.medianRatio, 1)}</b></p>`
      + dotHistogram(ratios(subset), { edges: RATIO_EDGES, thresholdBins: passingBins, title: `${label}: components by share of pixels that differ`, edgeLabel: e => sixDigits(e * 100), tip: ratioTip, rows: ratioRows })
      + `<p class="sm-stat">Height difference, pixels · <b>${pyStr(value.heightDelta?.over10px)}</b> off by more than 10</p>`
      + dotHistogram(heights(subset), { edges: HEIGHT_EDGES, title: `${label}: components by height difference`, edgeLabel: sixDigits, tip: heightTip, rows: heightRows }) + '</div>';
  });
  const dist = `<figure class="chart"><figcaption><h3>How far off, at each breakpoint</h3><p>One dot per component. Top: share of pixels that differ (${metric} measure); the shaded bins are within tolerance. Bottom: height difference between the Figma component and the live element. The number under each bin counts its components.</p></figcaption><div class="smalls">${multiples.join('')}</div></figure>`;
  return section('accuracy', 'Accuracy against the live site', acc.status, esc(lead), `<div class="acc-top">${explain}${chart}</div>` + dist + galleryHtml(acc, thumbs, metric) + accuracyTable(acc, metric));
}

function accuracyTable(acc: Accuracy, metric: Metric): string {
  const pairs = acc.pairs ?? [], names = Object.keys(acc.byBreakpoint ?? {});
  // Rows are keyed by label and component together, as the baseline keyed them by that tuple.
  const comps = new Map<string, { label: string | null; component: string; widths: Map<string, Pair> }>();
  for (const p of pairs) {
    const label = p.label ?? null, id = JSON.stringify([label, p.component]);
    const row = comps.get(id) ?? { label, component: p.component, widths: new Map<string, Pair>() };
    comps.set(id, row); row.widths.set(p.breakpoint, p);
  }
  const head = names.map(n => `<th scope="col" class="n">${bpName(n)}</th>`).join('');
  const rows = sortedBy(comps.values(), row => [row.label, row.component]).map(({ label, widths }) => {
    const cells = names.map(n => {
      const p = widths.get(n);
      if (p === undefined) return '<td class="n">–</td>';
      const c = p.corrected;
      return `<td class="n">${pct(p.original.ratio, 1)} · ` + (hasEntries(c) ? `<b>${pct(c.ratio, 1)}</b> ` : '')
        + (measureOf(p, metric)?.pass ? '<span class="ok" aria-label="within tolerance">✓</span>' : '<span class="no" aria-label="outside tolerance">✕</span>')
        + `<br><span class="sub">height ${num(p.heightDelta)} px</span></td>`;
    });
    return `<tr><th scope="row">${esc(label)}</th>${cells.join('')}</tr>`;
  });
  return `<details class="data"><summary>Every comparison as a table (${pairs.length} widths)</summary><table class="tbl wide"><caption>Pixels that differ: original · <b>corrected</b>, with the verdict on the ${metric} measure</caption><thead><tr><th scope="col">Component</th>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></details>`;
}

function galleryHtml(acc: Accuracy, thumbs: Thumbnails, metric: Metric): string {
  if (!thumbs.size) return '';
  const comps = byComponent(acc.pairs ?? []);
  const widthsOf = (component: string): ReadonlyMap<string, Pair> => comps.get(component) ?? new Map<string, Pair>();
  const order = sortedBy(thumbs.keys(), c => [-passCount(widthsOf(c), metric), ratioSum(widthsOf(c), metric) / widthsOf(c).size]);
  function card(component: string): string {
    const widths = widthsOf(component), shots = thumbs.get(component) ?? {}, label = widths.values().next().value?.label;
    const chips = sortedBy(widths, ([n]) => own(BP_ORDER, n) ?? 9).map(([n, p]) => {
      const m = measureOf(p, metric);
      return `<li class="${m?.pass ? 'pass' : 'fail'}"><span>${pyStr(bpName(n).at(0))}</span>${pct(m?.ratio, 0)}<span class="sr"> of pixels differ at ${bpName(n)}${m?.pass ? ', within tolerance' : ''}</span></li>`;
    }).join('');
    const wide = (shots.figma?.w ?? 1) / Math.max(1, shots.figma?.h ?? 1) > 3.5;
    const img = (side: 'figma' | 'live', text: string): string => {
      const shot = shots[side];
      if (!shot) return '';
      return `<figure class="shot${shot.cropped ? ' cut' : ''}"><figcaption>${text}</figcaption><img src="${shot.src}" width="${shot.w}" height="${shot.h}" decoding="async" alt="${esc(label)}, ${text.toLowerCase()}, desktop width"></figure>`;
    };
    return `<article class="card${wide ? ' wide' : ''}"><div class="card-h"><h4>${esc(label)}</h4><ul class="chips-bp" aria-label="Pixels that differ by breakpoint">${chips}</ul></div><div class="pair">${img('figma', 'Figma')}${img('live', 'Live site')}</div></article>`;
  }
  const best = order.slice(0, 6), worst = order.length > 10 ? order.slice(-4) : [];
  const rest = order.filter(c => !best.includes(c) && !worst.includes(c));
  const parts = ['<div class="gallery-head"><h3>Side by side, at desktop width</h3><p>Figma component and live capture, cut from the same specimen screenshot the comparison measured. Chips give the share of pixels that differ at each breakpoint (D desktop, T tablet, M mobile); filled chips are within tolerance.</p></div>',
    `<h4 class="g-sub">Closest to the live site</h4><div class="gallery">${best.map(card).join('')}</div>`];
  if (worst.length) parts.push(`<h4 class="g-sub">Furthest from the live site</h4><div class="gallery">${worst.map(card).join('')}</div>`);
  if (rest.length) parts.push(`<details class="data more"><summary>Show the other ${rest.length} components</summary><div class="gallery">${rest.map(card).join('')}</div></details>`);
  return parts.join('');
}

function repeatSection(rep: ReportSections['repeatability']): string {
  if (rep.status === 'not-measured') return section('repeatability', 'Repeatability', 'not-measured', 'One run cannot show that a second would match.', absent('Repeatability', rep));
  const comparisons = rep.comparisons ?? [];
  const rows = comparisons.map(row => {
    if (Object.hasOwn(row, 'error')) return `<tr><th scope="row">${esc(row.run)}</th><td colspan="4">${esc(row.error)}</td></tr>`;
    const diffs = Object.entries(row.categoryCounts ?? {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}` + (k === 'docs' ? ' (file links)' : '')).join(', ') || 'none';
    const agree = row.accuracyAgreement;
    return `<tr><th scope="row">${esc(row.run)}</th><td class="n">${fixed(row.score ?? 0, 2)}</td><td class="n">${num(row.identicalApartFromAddresses)} of ${num(row.totalNodes)}</td><td>${esc(diffs)}</td><td>`
      + (hasEntries(agree) ? `${pyStr(agree.sameVerdict)} of ${pyStr(agree.pairs)} same verdict; ratios within ${pct(agree.maxRatioDifference, 2)}` : '–') + '</td></tr>';
  });
  const paths = new Map<string, Set<string | undefined>>();
  for (const row of comparisons) for (const d of row.artifactDifferences ?? []) {
    const artifact = String(d.artifact);
    paths.set(artifact, (paths.get(artifact) ?? new Set<string | undefined>()).add(d.path));
  }
  let note = esc(rep.levelNote);
  if (paths.size) note += ' Values that differ: ' + sortedBy(paths, ([name]) => name).map(([name, differing]) => `<code>${esc(name)}</code> ${differing.size}`).join('; ') + '.';
  const scored = comparisons.filter(row => Object.hasOwn(row, 'score'));
  const lead = scored.length ? `Compared node by node with ${scored.length} other ${plural(scored.length, 'run')} of the same site.` : 'The comparison could not run.';
  const body = `<table class="tbl wide"><caption>This run against each other run</caption><thead><tr><th scope="col">Other run</th><th scope="col" class="n">Score / 100</th><th scope="col" class="n">Nodes identical, apart from file links</th><th scope="col">Nodes that differ, by category</th><th scope="col">Accuracy results</th></tr></thead><tbody>${rows.join('')}</tbody></table><p class="note">${note} The score counts documentation links as differences because each file links to itself; the identical-node column does not.</p>`;
  return section('repeatability', 'Repeatability', rep.status, esc(lead), body);
}

/** One reporting interval of working time; the production part records no reason. */
interface Interval {
  status?: string;
  workingSeconds?: number;
  waitingOnPersonSeconds?: number;
  waitingOnLimitsSeconds?: number;
  waitingOnServiceSeconds?: number;
  reason?: string;
}
type TimeRow = readonly [label: string, seconds: number | null | undefined, description: string];
type TokenPart = NonNullable<ModelUsage['benchmark']> | NonNullable<ModelUsage['production']>;
const TOKEN_COLUMNS = ['input', 'output', 'cacheWrite', 'cacheRead', 'total'] as const;
const MODEL_COLUMNS = [...TOKEN_COLUMNS, 'turns', 'toolCalls'] as const;
function tokenTable(caption: string, part: Partial<TokenPart>): string {
  const rows = part.byModel ?? [];
  if (!rows.length) return `<p class="note">${esc(caption)}: no model turns.</p>`;
  const tokens = part.tokens ?? {};
  const body = rows.map(r => `<tr><th scope="row">${esc(r.name)}<span class="sub"> ${r.model !== r.name ? esc(r.model) : ''}</span></th>`
    + MODEL_COLUMNS.map(k => `<td class="n">${num(r[k])}</td>`).join('') + '</tr>').join('');
  const foot = '<tr class="sum"><th scope="row">All models</th>' + TOKEN_COLUMNS.map(k => `<td class="n">${num(tokens[k])}</td>`).join('')
    + `<td class="n">${num(part.turns)}</td><td class="n">${num(part.toolCalls)}</td></tr>`;
  return `<table class="tbl wide"><caption>${esc(caption)}</caption><thead><tr><th scope="col">Model</th><th scope="col" class="n">Input</th><th scope="col" class="n">Output</th><th scope="col" class="n">Cache write</th><th scope="col" class="n">Cache read</th><th scope="col" class="n">Total</th><th scope="col" class="n">Turns</th><th scope="col" class="n">Tool calls</th></tr></thead><tbody>${body}${foot}</tbody></table>`;
}
function interruption(kind: string): string {
  if (kind === 'question') return 'A question to the person';
  return kind.startsWith('stopped: ') ? 'The run stopped: ' + kind.slice(9) : 'A turn that ended and waited for a prompt';
}

export function costSection(cost: Cost): string {
  const runner: Runner = cost.runner ?? {}, parts: string[] = [];
  if (runner.status !== 'not-measured' && runner.sessions?.length) {
    const sessions = runner.sessions.map(s => `<li><b>${duration(s.seconds)}</b> · ${num(s.steps)} steps · from ${stamp(s.start)}</li>`).join('');
    const kinds = Object.entries(runner.secondsByKind ?? {}).filter(([, v]) => v >= 1);
    parts.push(`<div class="two"><div><h3>Runner sessions</h3><ul class="plain">${sessions}</ul><p class="note">${num(runner.errors)} errors and ${num(runner.skipped)} skipped steps logged. Times are the build machine's clock.</p></div><figure class="chart"><figcaption><h3>Where the build time went</h3><p>Seconds per kind of step.</p></figcaption>${barList(kinds, { unitFmt: v => fixed(v, 0) + ' s', title: 'Seconds of build time by kind of step' })}</figure></div>`);
  } else parts.push(absent('Runner timing', runner));
  const timings = cost.timings ?? {};
  if (timings.phases?.length) {
    const rows = timings.phases.map(r => `<tr><th scope="row">${esc(r.phase)}</th><td>${stamp(r.start)}</td><td>${stamp(r.end)}</td><td class="n">${duration(r.seconds)}</td></tr>`).join('');
    parts.push(`<table class="tbl"><caption>Time per phase</caption><thead><tr><th scope="col">Phase</th><th scope="col">Start</th><th scope="col">End</th><th scope="col" class="n">Wall clock</th></tr></thead><tbody>${rows}</tbody></table><p class="note">Each phase runs from the previous phase's end to its own; waiting is included, so these are not working time.</p>`);
  } else if (timings.checkpoints?.length) {
    const rows = timings.checkpoints.map(c => `<li><span class="mono">${stamp(c.at)}</span> ${esc(c.phase)} ${esc(c.status)}</li>`).join('');
    parts.push(`<div><h3>Phase checkpoints</h3><ul class="plain cols">${rows}</ul><p class="note">${esc(timings.note)}</p></div>`);
  }
  const clock = cost.clock, working: Partial<Working> = cost.working ?? {};
  const timeRows: TimeRow[] = [];
  if (working.status === 'measured') {
    const intervals: [string, Interval][] = [['To produce the library', working.production ?? {}], ['The benchmark', working.benchmark ?? {}]];
    for (const [caption, part] of intervals) {
      if (part.status !== 'measured') { timeRows.push([caption, null, part.reason || 'not measured']); continue; }
      timeRows.push([`${caption}: working`, part.workingSeconds, 'Claude or its tools working'],
        [`${caption}: waiting on the person`, part.waitingOnPersonSeconds, "the assistant had finished, or a tool was waiting for the person's answer"],
        [`${caption}: waiting on usage limits`, part.waitingOnLimitsSeconds, 'after a rate, session, usage or spend limit, until it reset'],
        [`${caption}: waiting on the service`, part.waitingOnServiceSeconds, 'the service was overloaded or unavailable']);
    }
  } else timeRows.push(['Working time', null, working.reason || 'not measured']);
  if (runner.steps) timeRows.push(['Figma build', runner.activeSeconds, `${num(runner.steps)} runner steps, no model in the loop`]);
  timeRows.push(['Wall time', clock?.wallSeconds, clock?.wallSeconds != null ? 'workflow.ts init to the end of the benchmark' : `not shown: ${clock?.notShownBecause || 'its ends were not recorded'}`],
    ['Scoring script alone', clock?.scorerSeconds, "this report's own computation"]);
  const approval = working.fullAccess === false ? "<p class=\"note\">This session did not run with full access throughout, so a tool span may include a wait for the person's approval, counted here as working time.</p>" : '';
  const how = working.status === 'measured' ? '' : `<p class="note"><b>Working time was not measured for this run.</b> To measure it, ${esc(working.howToMeasure || 'score with --session <id>')}.</p>`;
  parts.push('<div style="margin-bottom:32px"><h3>Time</h3><table class="tbl"><caption>Measured intervals</caption><tbody>'
    + timeRows.map(([n, v, d]) => `<tr><th scope="row">${esc(n)}</th><td class="n">${duration(v)}</td><td class="sub">${esc(d)}</td></tr>`).join('')
    + `</tbody></table>${how}${approval}<p class="note"><b>How time is measured.</b> ${esc(cost.definition)}</p></div>`);
  const attended: Partial<NonNullable<Cost['unattended']>> = cost.unattended ?? {};
  if (attended.status === 'measured') {
    const items = (attended.interruptions ?? []).map(i => `<li><span class="mono">${stamp(i.at)}</span> ${esc(interruption(i.kind))} during ${esc(i.phase)}` + (i.planned ? ' (the plan review chosen at preflight)' : '') + '</li>').join('');
    const headline = attended.ranUnattended ? 'Ran unattended after preflight: yes.' : `${pyStr(attended.count)} ${plural(attended.count, 'interruption')} after preflight.`;
    parts.push(`<div style="margin-bottom:32px"><h3>${esc(headline)}</h3>` + (items ? `<ul class="plain">${items}</ul>` : '')
      + `<p class="note">From the preflight go-ahead at ${stamp(attended.goAheadAt)} to the benchmark's start, every question the run asked the person and every turn that waited for a prompt. Waits before the go-ahead are setup.</p></div>`);
  } else parts.push(absent('Unattended after preflight', attended));
  const warning = cost.developer?.sessionWarning;
  if (warning) parts.push(`<p class="note"><b>Which session was scored.</b> ${esc(warning)}.</p>`);
  const model: Partial<ModelUsage> = cost.model ?? {};
  if (model.status === 'measured') {
    const bench: Partial<NonNullable<ModelUsage['benchmark']>> = model.benchmark ?? {};
    const tables = tokenTable('To produce the library', model.production ?? {}) + (bench.status === 'measured' ? tokenTable('Added by benchmarking', bench) : absent('Benchmark tokens', bench));
    const accounts = (model.configDirs ?? []).join(', ') || 'not known';
    parts.push(`<div><h3>Tokens by model</h3>${tables}<p class="note">From ${esc(model.source)}: ${num(model.files)} transcript file(s), main session and subagents together. Claude configuration folder (account): ${esc(accounts)}. Cache reads are prompt tokens served from cache and cost far less than the other kinds. ${esc(model.benchmarkNote)} ${esc(model.caveat)}</p></div>`);
  } else parts.push(absent('Model tokens and tool calls', model));
  const made: Interval = working.status === 'measured' ? working.production ?? {} : {};
  const lead = made.status === 'measured' ? `design-lab took ${duration(made.workingSeconds)} of working time to produce the library.`
    : runner.steps ? `The Figma build itself took ${duration(runner.activeSeconds)} across ${num(runner.steps)} steps; working time was not measured for this run.`
    : 'Timing evidence is incomplete for this run.';
  return section('cost', 'Time and tokens', cost.status, esc(lead), parts.join(''));
}

function conformanceSection(conf: ReportSections['conformance']): string {
  if (conf.status === 'not-measured') return section('conformance', 'Conformance to the library standard', 'not-measured', 'Whole-file verification was not run.', absent('Verification findings', conf));
  let body = '<dl class="yield small">' + Object.entries(conf.open ?? {}).map(([k, v]) => `<div class="y"><dt>${k} open</dt><dd>${num(v)}</dd></div>`).join('')
    + `<div class="y"><dt>waived</dt><dd>${num(conf.waived)}</dd></div><div class="y"><dt>checks passed</dt><dd>${num(conf.passed)}</dd></div></dl>`;
  if (conf.findings?.length) body += '<ul class="plain">' + conf.findings.map(f => `<li><span class="cat">${esc(f.severity)}</span> ${esc(f.check)}: ${esc(f.message)}</li>`).join('') + '</ul>';
  return section('conformance', 'Conformance to the library standard', 'measured', esc(conf.summary), body);
}

function churnSection(churn: ReportSections['schemaChurn']): string {
  if (churn.status === 'not-measured') return section('churn', 'Schema churn', 'not-measured', 'Whether this run needed a schema change was not recorded.', absent('Schema churn', churn));
  const items = (churn.changes ?? []).map(c => `<li>${esc(c.text)}</li>`).join('');
  return section('churn', 'Schema churn', 'measured', esc(churn.summary), items ? `<ul class="plain">${items}</ul>` : '');
}

function laterSection(fv: ReportSections['foundationsVoice'], blind: ReportSections['blindedJudgement'], pages: readonly string[]): string {
  const { min = 1, max = 5 } = hasEntries(blind.scale) ? blind.scale : {};
  const boxes = Array.from({ length: Math.max(0, max + 1 - min) }, (_, i) => `<span>${min + i}</span>`).join('');
  const criteria = blind.criteria.map(c => `<li><span>${esc(c.label)}</span><span class="scale" aria-label="not yet scored">${boxes}</span></li>`).join('');
  const targets = pages.filter(p => p.toLowerCase().startsWith('foundations'))
    .map(p => `<li><span>${esc(p.slice(p.lastIndexOf('—') + 1).trim())}</span><span class="pending">awaiting rubric</span></li>`).join('');
  const body = `<div class="two"><div class="later"><h3>Foundations and voice</h3><p>${esc(fv.reason)} The scorecard already has a slot for the rubric and its scores.</p>`
    + (targets ? `<ul class="rubric">${targets}</ul>` : '') + `</div><div class="later"><h3>Blinded visual judgement</h3><p>${esc(blind.reason)}</p><ul class="rubric">${criteria}</ul></div></div>`;
  return section('later', 'Judged by people', 'scored-later', 'Two parts of the benchmark need human eyes and are added after the run.', body);
}

function identitySection(ident: ReportSections['identity']): string {
  if (ident.status === 'not-measured') return section('identity', 'Run identity', 'not-measured', 'Nothing identifies this run.', absent('Run identity', ident));
  const f = ident.fields ?? {};
  const figmaBuild = [f.builtToStandard ? `standard ${f.builtToStandard}` : '', f.rendererRuntime ? `renderer runtime ${f.rendererRuntime}` : ''].filter(Boolean).join(' · ');
  const rows: [string, string | null | undefined][] = [['Site', f.siteLabel], ['Public address', f.publicAddress], ['Local site', f.siteUrl], ['Operator', f.operator],
    ['Started', f.startedAt ? day(f.startedAt) : null],
    ['design-lab', [f.pluginVersion, (f.pluginCommit || '').slice(0, 10)].filter(Boolean).join(' ')],
    ['Library standard', f.standardVersion],
    ['Figma build', figmaBuild || null],
    ['Repository commit', f.repositoryCommit ? f.repositoryCommit.slice(0, 12) + (f.repositoryDirty ? ' (uncommitted changes)' : '') : null],
    ['Figma file', f.figmaUrl], ['Claude configuration', f.claudeConfigDir],
    ['Model', (f.model || '').startsWith('claude-') ? f.model : null],
    ['Strategies', Object.entries(f.strategies ?? {}).filter(([, v]) => v).map(([k, v]) => `${k.replaceAll('Source', '')}: ${v}`).join(', ')]];
  if (hasEntries(f.rebuiltFrom)) rows.push(['Rebuilt inputs', `This run rebuilt an earlier run's capture and plan from ${pyStr(f.rebuiltFrom.run)}.`]);
  const items = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v ? esc(v) : '<span class=na>not recorded</span>'}</dd></div>`).join('');
  return section('identity', 'Run identity and provenance', ident.status, esc(ident.summary), `<dl class="sheet">${items}</dl><p class="note">This is the provenance the Figma Cover used to print. The file now keeps it as hidden plugin data (<code>designlab</code> / <code>provenance</code> on the document and the Cover) and no page shows it.</p>`);
}

const CSS = String.raw`
:root{color-scheme:light;
--paper:#f4f5f7;--surface:#ffffff;--ink:#14161b;--ink2:#474d59;--muted:#6b717d;--hair:#dadde3;--hair2:#e9ebef;
--accent:#2f3fb8;--orig:#7d828c;--corr:#2a78d6;--pass-zone:rgba(42,120,214,.08);
--q5:#0d366b;--q4:#1c5cab;--q3:#2a78d6;--q2:#5598e7;--q1:#86b6ef;--check:#ffffff;--none:#e9ebef;
--good:#0a7d0a;--bad:#c23434;--hatch:rgba(20,22,27,.05);
--display:"Avenir Next Condensed","Avenir Next","Helvetica Neue","Arial Narrow",system-ui,sans-serif;
--body:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
--mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;
--paper:#0e1014;--surface:#161a21;--ink:#eceef2;--ink2:#b4bac6;--muted:#8d93a0;--hair:#2b303a;--hair2:#20242c;
--accent:#9aa6ff;--orig:#7c828e;--corr:#3987e5;--pass-zone:rgba(57,135,229,.12);
--q5:#b7d3f6;--q4:#6da7ec;--q3:#3987e5;--q2:#256abf;--q1:#184f95;--check:#0e1014;--none:#20242c;
--good:#3fbf3f;--bad:#ef6b6b;--hatch:rgba(255,255,255,.04)}}
*{box-sizing:border-box}
html{background:var(--paper)}
body{margin:0;color:var(--ink);font:16px/1.55 var(--body);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.page{max-width:1180px;margin:0 auto;padding:28px 40px 80px}
code,.mono{font-family:var(--mono);font-size:.82em;letter-spacing:.01em}
a{color:var(--accent)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* masthead */
.mast{display:flex;justify-content:space-between;align-items:baseline;gap:24px;padding-bottom:14px;border-bottom:1px solid var(--ink)}
.mast p{margin:0;font:600 13px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase}
.mast dl{display:flex;gap:22px;margin:0;font:12px/1 var(--mono);color:var(--muted)}
.mast dl div{display:flex;gap:6px}.mast dd{margin:0;color:var(--ink2)}
/* hero */
.hero{padding:52px 0 8px}
.site{margin:0 0 10px;font:500 14px/1 var(--mono);color:var(--accent);letter-spacing:.04em}
h1{font:700 clamp(40px,5.6vw,68px)/.98 var(--display);letter-spacing:-.018em;margin:0;max-width:21ch;font-stretch:condensed}
.dek{max-width:64ch;color:var(--ink2);margin:20px 0 0;font-size:17px}
.yield{display:flex;flex-wrap:wrap;gap:0;margin:40px 0 0;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair)}
.yield .y{flex:1 1 140px;padding:18px 20px 16px 0;margin-right:20px;border-right:1px solid var(--hair)}
.yield .y:last-child{border-right:0}
.yield dt{font:12px/1.2 var(--mono);color:var(--muted);order:2}
.yield dd{margin:0 0 4px;font:600 46px/1 var(--display);letter-spacing:-.01em;font-variant-numeric:lining-nums}
.yield .y{display:flex;flex-direction:column}
.yield.small dd{font-size:30px}.yield.small{margin-top:10px}
.verdicts{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:34px}
.v{padding:0 22px 0 0;margin-right:22px;border-right:1px solid var(--hair)}
.v:last-child{border-right:0;margin-right:0}
.v-l{margin:0;font:600 12px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}
.v-n{margin:10px 0 6px;font:700 64px/.9 var(--display);letter-spacing:-.02em;color:var(--ink)}
.v-u{font:600 28px/1 var(--display);color:var(--muted);margin-left:4px;letter-spacing:0}
.v-c{margin:0;color:var(--ink2);font-size:14.5px;max-width:34ch}
.v-none .v-n{color:var(--muted)}
/* The coverage strip is drawn on the Cover's navy in both modes, so its category colors match the Cover. */
.cov{margin:22px 0 0;padding:18px 20px 14px;border-radius:12px;background:var(--ground);display:inline-block;max-width:100%}
.cov-sq{display:flex;flex-wrap:wrap;gap:4px;max-width:720px}
.cov-sq span{width:16px;height:16px;border-radius:3px}
.c-gap{box-shadow:inset 0 0 0 1.5px #E6E8FF}
.c-out{background:repeating-linear-gradient(135deg,rgba(230,232,255,.7) 0 1.5px,transparent 1.5px 4px)}
.c-out.c-retire{background:repeating-linear-gradient(135deg,#B9003F 0 2px,transparent 2px 4px);box-shadow:inset 0 0 0 1px #B9003F}
.cov-k{margin:12px 0 0;font:13px/1.6 var(--mono);color:#E6E8FF}.cov-k b{color:#fff;font-weight:600}
.cov-k .key{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:var(--k);vertical-align:-1px}
.cov-k .key-gap{background:none;box-shadow:inset 0 0 0 1.5px #E6E8FF}
.cov-k .key-out{background:repeating-linear-gradient(135deg,rgba(230,232,255,.7) 0 1.5px,transparent 1.5px 4px)}
.cov-k .key-retire{background:repeating-linear-gradient(135deg,#B9003F 0 2px,transparent 2px 4px);box-shadow:inset 0 0 0 1px #B9003F}
.cov,.cov *,.tier-panel,.tier-panel *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
/* The tier table sits on the Cover's navy too, so its category colors read exactly as on the Cover. */
.tier-panel{background:var(--ground);border-radius:12px;padding:16px 20px 8px;align-self:start}
.tbl.tiers caption{color:#E6E8FF}.tbl.tiers thead th{color:#AEB6E6}
.tbl.tiers th,.tbl.tiers td{color:#fff;border-top-color:rgba(230,232,255,.16)}
.tbl.tiers tr.out th,.tbl.tiers tr.out td{color:#AEB6E6}
.tbl.tiers tr.sum th,.tbl.tiers tr.sum td{border-top:1px solid rgba(230,232,255,.5)}
.t-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px}
tr.out .t-sw{background:repeating-linear-gradient(135deg,#B9003F 0 2px,transparent 2px 4px)!important;box-shadow:inset 0 0 0 1px #B9003F}
.t-note{display:block;margin:2px 0 0 18px;font:12px/1.4 var(--mono);color:#AEB6E6;font-weight:400}
.t-bar{display:block;height:8px;border-radius:4px;margin-top:6px;min-width:80px;position:relative;background:linear-gradient(90deg,rgba(230,232,255,.18) calc(var(--f)*100%),transparent 0)}
.t-bar::after{content:"";position:absolute;inset:0 auto 0 0;width:calc(var(--v)*100%);background:var(--c);border-radius:4px}
.h-gap{margin-top:20px}
.cov-w{margin:14px 0 0;font-size:16px;color:var(--ink2);max-width:72ch}.cov-w b{color:var(--ink)}
.tbl tr.sum th,.tbl tr.sum td{border-top:1px solid var(--ink2);font-weight:600}
.highlights{list-style:none;margin:40px 0 0;padding:0;columns:2;column-gap:36px}
.highlights li{break-inside:avoid;padding:12px 0 12px 26px;border-top:1px solid var(--hair);position:relative;font-size:15.5px}
.highlights li::before{content:"";position:absolute;left:0;top:19px;width:12px;height:2px;background:var(--ink)}
/* the field */
.field{margin:48px 0 0;padding:26px 28px 22px;background:var(--surface);border-radius:14px;box-shadow:0 0 0 1px var(--hair2)}
.field figcaption{display:flex;justify-content:space-between;gap:20px;align-items:baseline;margin-bottom:18px;color:var(--ink2);font-size:14px}
.field figcaption .mono{font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--ink)}
.field-svg{width:100%;height:auto;display:block;overflow:visible}
.f-row{font:12px var(--mono);fill:var(--ink2)}
.f-cell{cursor:default;outline:none}
.f-cell rect{transition:opacity .15s}
.f-cell:hover rect,.f-cell:focus rect{stroke:var(--ink);stroke-width:2}
.q5{fill:var(--q5)}.q4{fill:var(--q4)}.q3{fill:var(--q3)}.q2{fill:var(--q2)}.q1{fill:var(--q1)}.f-none{fill:var(--none)}
.f-check{fill:none;stroke:var(--check);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.f-check.key{stroke:var(--ink)}
.field-key{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center;margin-top:18px;color:var(--ink2);font-size:13px}
.field-key p{margin:0}
.bins{display:flex;gap:16px;list-style:none;margin:0;padding:0;font:12px var(--mono)}
.bins li{display:flex;align-items:center;gap:6px}
.sw{display:inline-block;width:14px;height:14px;border-radius:3px}
.sw.q5{background:var(--q5)}.sw.q4{background:var(--q4)}.sw.q3{background:var(--q3)}.sw.q2{background:var(--q2)}.sw.q1{background:var(--q1)}
.key-note{display:flex;align-items:center;gap:6px}
/* sections */
.toc{display:flex;flex-wrap:wrap;gap:6px 18px;margin:56px 0 0;padding:14px 0;border-top:1px solid var(--ink);border-bottom:1px solid var(--hair);font:13px var(--mono)}
.toc a{color:var(--ink2);text-decoration:none}.toc a:hover{color:var(--accent);text-decoration:underline}
.sec{padding:56px 0 8px;border-bottom:1px solid var(--hair)}
.sec-head{display:flex;justify-content:space-between;align-items:baseline;gap:20px}
h2{font:700 38px/1.05 var(--display);letter-spacing:-.01em;margin:0}
h3{font:600 17px/1.3 var(--body);margin:0 0 8px}
h4{font:600 12px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;margin:0 0 6px;color:var(--ink2)}
.lead{font-size:19px;line-height:1.45;max-width:62ch;color:var(--ink);margin:14px 0 28px}
.tag{font:600 11.5px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;color:var(--ink2);padding:6px 10px;border-radius:99px;box-shadow:inset 0 0 0 1px var(--hair)}
.tag-measured{color:var(--ink)}
.tag-not-measured,.tag-scored-later{color:var(--muted)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin:0 0 32px}
.note{color:var(--muted);font-size:13.5px;max-width:70ch}
.absent{margin:0 0 24px;padding:18px 22px;border-radius:10px;background:repeating-linear-gradient(135deg,var(--hatch) 0 2px,transparent 2px 9px),var(--surface);box-shadow:inset 0 0 0 1px var(--hair)}
.absent p{margin:0;color:var(--ink2);font-size:14.5px}
.absent .absent-t{font:600 12px/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink);margin-bottom:6px}
.absent .how{margin-top:8px;font-size:13.5px}.absent .how span{font-family:var(--mono);color:var(--muted)}
/* lists and tables */
.funnel{list-style:none;margin:0;padding:0}
.funnel li{display:flex;align-items:baseline;gap:14px;padding:10px 0;border-top:1px solid var(--hair2);color:var(--ink2)}
.funnel b{font:700 34px/1 var(--display);color:var(--ink);min-width:2.2ch;text-align:right}
.funnel .muted b{color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0}
.chips li{font:12.5px/1 var(--mono);padding:7px 10px;border-radius:6px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--hair)}
.plain{list-style:none;margin:0;padding:0}
.plain li{padding:7px 0;border-top:1px solid var(--hair2);font-size:14.5px;color:var(--ink2)}
.plain li b{color:var(--ink)}
.plain.cols{columns:2;column-gap:32px}
.cat{font:11.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-right:6px}
.tbl{border-collapse:collapse;width:100%;font-size:14px}
.tbl caption{text-align:left;font:600 12px/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);padding-bottom:8px}
.tbl th,.tbl td{text-align:left;padding:8px 10px 8px 0;border-top:1px solid var(--hair2);vertical-align:top}
.tbl thead th{font:12px var(--mono);color:var(--muted);border-top:0}
.tbl .n{text-align:right;font-variant-numeric:tabular-nums}
.tbl .sub{color:var(--muted);font-size:12px}
.tbl.wide{margin:6px 0 20px}
.meter{display:block;height:8px;border-radius:4px;background:var(--hair2);margin-top:6px;position:relative;min-width:80px}
.meter::after{content:"";position:absolute;inset:0 auto 0 0;width:calc(var(--v)*100%);background:var(--corr);border-radius:4px}
.ok{color:var(--good);font-weight:700}.no{color:var(--bad);font-weight:700}
details.data{margin:10px 0 32px}
details.data summary{cursor:pointer;font:13px var(--mono);color:var(--accent);padding:10px 0}
.defs{display:grid;grid-template-columns:1fr;gap:22px;margin:0 0 36px;align-content:start}
.acc-top{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:48px;align-items:start}
.defs dt{font-weight:600;display:flex;align-items:center;gap:8px}.defs dd{margin:4px 0 0;color:var(--ink2);font-size:14.5px}
.key-sw{width:18px;height:8px;border-radius:4px;display:inline-block}.key-sw.original{background:var(--orig)}.key-sw.corrected{background:var(--corr)}
/* charts */
.chart{margin:0 0 36px}
.chart figcaption p{margin:0 0 14px;color:var(--ink2);font-size:14px;max-width:70ch}
.bars{width:100%;max-width:700px;height:auto;display:block}
.bar.original{fill:var(--orig)}.bar.corrected{fill:var(--corr)}
.grid{stroke:var(--hair2);stroke-width:1}.axis{stroke:var(--hair);stroke-width:1}
.axis-l{font:12.5px var(--mono);fill:var(--ink2)}
.val{font:600 13px var(--body);fill:var(--ink)}.val .of{font-weight:400;fill:var(--muted)}
.smalls{display:grid;grid-template-columns:repeat(3,1fr);gap:30px}
.sm-stat{margin:0 0 4px;font-size:13px;color:var(--ink2)}
.hist{width:100%;height:auto;display:block;margin-bottom:12px}
.dot{fill:var(--corr);stroke:var(--surface);stroke-width:1.5}
.dot:hover,.dot:focus{stroke:var(--ink);outline:none}
.pass-zone{fill:var(--pass-zone)}.thresh{stroke:var(--ink2);stroke-width:1}
.t-note,.tick{font:12px var(--mono);fill:var(--muted)}.cnt{font:600 13px var(--mono);fill:var(--ink2)}.t-note{fill:var(--ink2)}
/* gallery */
.gallery-head p{color:var(--ink2);font-size:14px;margin:0 0 18px;max-width:72ch}
.gallery{display:grid;align-items:start;grid-template-columns:repeat(2,1fr);gap:18px;margin-bottom:28px}
.g-sub{margin:26px 0 12px}
.card{background:var(--surface);border-radius:12px;padding:14px 16px 16px;box-shadow:0 0 0 1px var(--hair2)}
.card-h{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}
.card h4{color:var(--ink);letter-spacing:.01em;text-transform:none;font:600 15px/1.3 var(--body);margin:0}
.chips-bp{display:flex;gap:5px;list-style:none;margin:0;padding:0;font:11.5px var(--mono);flex:none}
.chips-bp li{padding:4px 7px;border-radius:5px;background:var(--hair2);color:var(--ink2)}
.chips-bp li span:first-child{font-weight:700;margin-right:5px;color:var(--ink)}
.chips-bp li.pass{background:var(--corr);color:#fff}.chips-bp li.pass span:first-child{color:#fff}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
.card.wide .pair{grid-template-columns:1fr}
.shot{margin:0}.shot figcaption{font:10.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.shot img{display:block;width:100%;height:auto;border-radius:4px;box-shadow:0 0 0 1px var(--hair2);background:#fff}
.shot.cut{position:relative}.shot.cut::after{content:"";position:absolute;left:0;right:0;bottom:0;height:34px;background:linear-gradient(transparent,var(--surface))}
details.more summary{margin-bottom:14px}
/* later and identity */
.later{padding:20px 22px;border-radius:12px;background:var(--surface);box-shadow:0 0 0 1px var(--hair2)}
.later p{color:var(--ink2);font-size:14.5px}
.rubric{list-style:none;margin:12px 0 0;padding:0}
.rubric li{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-top:1px solid var(--hair2);font-size:14.5px}
.pending{font:11px var(--mono);color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.scale{display:flex;gap:4px}.scale span{width:24px;height:24px;border-radius:5px;display:grid;place-items:center;font:11px var(--mono);color:var(--muted);box-shadow:inset 0 0 0 1px var(--hair)}
.sheet{display:grid;grid-template-columns:repeat(2,1fr);gap:0 40px;margin:0 0 32px}
.sheet div{display:grid;grid-template-columns:170px 1fr;gap:12px;padding:9px 0;border-top:1px solid var(--hair2);font-size:14px}
.sheet dt{font:12px/1.6 var(--mono);color:var(--muted)}.sheet dd{margin:0;overflow-wrap:anywhere}
.na{color:var(--muted);font-style:italic}
footer.colophon{padding:36px 0 0;color:var(--muted);font:12px/1.7 var(--mono)}
/* tooltip */
.tip{position:fixed;z-index:10;pointer-events:none;max-width:300px;padding:8px 10px;border-radius:8px;background:var(--ink);color:var(--paper);font:12.5px/1.4 var(--body);box-shadow:0 6px 24px rgba(0,0,0,.18);opacity:0;transition:opacity .12s}
.tip.on{opacity:1}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media (max-width:860px){.page{padding:20px}.highlights{columns:1}.acc-top,.verdicts,.two,.defs,.highlights,.smalls,.sheet{grid-template-columns:1fr}
.v{border-right:0;margin:0 0 24px;padding:0}.mast{flex-direction:column}.mast dl{flex-wrap:wrap}
.gallery,.pair{grid-template-columns:1fr}.card-h{flex-wrap:wrap}.tbl.wide{display:block;overflow-x:auto}
.sec-head{flex-wrap:wrap}.field{padding:18px 14px;overflow-x:auto}.field-svg{min-width:640px}.plain.cols{columns:1}
.sheet div{grid-template-columns:120px 1fr}.yield .y{flex-basis:40%;border-right:0}}
@page{margin:14mm}
@media print{:root{color-scheme:light;--paper:#fff;--surface:#fff;--ink:#000;--ink2:#333;--muted:#555;--hair:#bbb;--hair2:#ddd;
--q5:#0d366b;--q4:#1c5cab;--q3:#2a78d6;--q2:#5598e7;--q1:#86b6ef;--check:#fff;--corr:#2a78d6;--orig:#7d828c}
.page{max-width:none;padding:0}.sec,.field,.card,.chart,.v,table,.absent{break-inside:avoid}
.toc,.tip,details.data summary{display:none}details.data{display:block}details.data>*{display:block}
.gallery{grid-template-columns:repeat(2,1fr)}.hero{padding-top:20px}}
`;

const JS = String.raw`
(function(){var t=document.createElement('div');t.className='tip';t.setAttribute('role','tooltip');document.body.appendChild(t);
function show(e){var el=e.target.closest('[data-tip]');if(!el){t.classList.remove('on');return}
t.textContent=el.getAttribute('data-tip');var r=el.getBoundingClientRect();var x=r.left+r.width/2,y=r.top;
t.style.left=Math.max(8,Math.min(window.innerWidth-310,x-150))+'px';t.style.top=Math.max(8,y-t.offsetHeight-10)+'px';t.classList.add('on')}
document.addEventListener('mouseover',show);document.addEventListener('focusin',show);
document.addEventListener('mouseout',function(e){if(e.target.closest('[data-tip]'))t.classList.remove('on')});
document.addEventListener('focusout',function(){t.classList.remove('on')});})();
`;

const TOC = [['library', 'What the run built'], ['accuracy', 'Accuracy'], ['repeatability', 'Repeatability'], ['cost', 'Time and tokens'], ['conformance', 'Conformance'], ['churn', 'Schema churn'], ['later', 'Judged by people'], ['identity', 'Identity and provenance']] as const;

/** The report page for a scorecard and its already cut thumbnails. */
export function renderReport(card: ReportCard, thumbs: Thumbnails): string {
  const s = card.sections, identity = s.identity.fields ?? {};
  const body = [`<header class="mast"><p>design-lab · run report</p><dl><div><dt>run</dt><dd>${esc(card.run.name)}</dd></div><div><dt>built</dt><dd>${esc(day(identity.startedAt))}</dd></div><div><dt>version</dt><dd>${esc(identity.pluginVersion || '–')}</dd></div><div><dt>scored</dt><dd>${esc(day(card.generatedAt))}</dd></div></dl></header>`,
    '<main>', hero(card), '<nav class="toc" aria-label="Sections">' + TOC.map(([id, title]) => `<a href="#${id}">${esc(title)}</a>`).join('') + '</nav>',
    librarySection(s.library, s.coverage), accuracySection(s.accuracy, thumbs), repeatSection(s.repeatability), costSection(s.cost),
    conformanceSection(s.conformance), churnSection(s.schemaChurn), laterSection(s.foundationsVoice, s.blindedJudgement, s.library.pageNames ?? []), identitySection(s.identity), '</main>',
    `<footer class="colophon">Generated by ${esc(card.generator)} (scripts/score_run.ts) on ${esc(day(card.generatedAt))}. The numbers come from scorecard.json beside this file; re-run the scorer to refresh them. Accuracy figures are recomputed from the run's specimen screenshots.</footer>`];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(card.run.siteLabel)} · design-lab run report</title><style>${CSS}</style></head><body><div class="page">${body.join('')}</div><script>${JS}</script></body></html>\n`;
}

/** The self-contained report for a scored run, with thumbnails cut from the run's specimen screenshots. */
export async function render(card: ReportCard, runDir: string): Promise<string> {
  const pairs = card.sections.accuracy.pairs ?? [];
  const thumbs: Thumbnails = hasEntries(pairs[0]?.evidence) ? await thumbnails(runDir, pairs, 'desktop') : new Map();
  return renderReport(card, thumbs);
}
