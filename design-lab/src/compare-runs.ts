import type { TreeDump } from './generated/runner-record.ts';
type DumpNode = TreeDump['nodes'][number];
interface PageDifference {
  added: string[];
  removed: string[];
  changes: Record<string, Record<string, Difference[]>>;
}
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalize } from './determinism.ts';

export const ARTIFACTS = [
  'components.json',
  'tokens.json',
  'plan.json',
  'variable-plan.json',
  'capture-evidence.json',
  'figma/results/variables.json',
] as const;
export const CATEGORIES: Record<string, string[]> = {
  geometry: ['x', 'y', 'width', 'height'],
  layout: [
    'layoutMode',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'itemSpacing',
    'layoutSizingHorizontal',
    'layoutSizingVertical',
  ],
  style: ['fills', 'strokes', 'cornerRadius'],
  text: ['characters'],
  typography: ['fontName', 'fontSize', 'lineHeight', 'textStyle'],
  bindings: ['boundVariables', 'fills.boundVariables', 'strokes.boundVariables'],
  'properties/variants': ['componentPropertyDefinitions', 'variantProperties'],
  docs: ['description', 'documentationLinks'],
};
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
class JsonFloat extends Number {
  toJSON(): number {
    return Number(this);
  }
}
function readDump(path: string): TreeDump {
  return JSON.parse(readFileSync(path, 'utf8'), ((_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && /[.eE]/.test(context?.source ?? '') ? new JsonFloat(value) : value) as (
    key: string,
    value: unknown,
  ) => unknown);
}
export interface Difference {
  path: string;
  a: unknown;
  b: unknown;
}
export function differences(a: unknown, b: unknown, prefix = ''): Difference[] {
  if (a instanceof Number || b instanceof Number)
    return a instanceof JsonFloat && b instanceof JsonFloat && Object.is(Number(a), Number(b))
      ? []
      : [{ path: prefix || '/', a: a instanceof Number ? Number(a) : a, b: b instanceof Number ? Number(b) : b }];
  if (isRecord(a) && isRecord(b)) {
    const out: Difference[] = [];
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const path = prefix + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1');
      if (!(key in a) || !(key in b)) out.push({ path, a: a[key] ?? null, b: b[key] ?? null });
      else out.push(...differences(a[key], b[key], path));
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: Difference[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++)
      out.push(
        ...(i >= a.length || i >= b.length
          ? [{ path: prefix + '/' + i, a: a[i] ?? null, b: b[i] ?? null }]
          : differences(a[i], b[i], prefix + '/' + i)),
      );
    return out;
  }
  return Object.is(a, b) && typeof a === typeof b ? [] : [{ path: prefix || '/', a, b }];
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function artifactDiff(a: string, b: string, name: string) {
  const paths = [resolve(a, name), resolve(b, name)],
    present = paths.map(existsSync),
    sha256 = paths.map((path, i) =>
      present[i] ? createHash('sha256').update(readFileSync(path)).digest('hex') : null,
    );
  const result = { present, equal_bytes: false, sha256, normalized_equal: false, differences: [] as Difference[] };
  if (present.every(Boolean)) {
    result.equal_bytes = sha256[0] === sha256[1];
    if (result.equal_bytes) result.normalized_equal = true;
    else {
      result.differences = differences(normalize(readJson(paths[0]!)), normalize(readJson(paths[1]!)));
      result.normalized_equal = !result.differences.length;
    }
  } else if (present.some(Boolean))
    result.differences = [{ path: '/', a: present[0] ? 'present' : 'missing', b: present[1] ? 'present' : 'missing' }];
  else result.normalized_equal = true;
  return result;
}
interface Page {
  index: number | null;
  nodes: Record<string, DumpNode>;
}
function pages(root: string): Record<string, Page> {
  const folder = resolve(root, 'figma/dump'),
    out: Record<string, Page> = {};
  for (const file of existsSync(folder)
    ? readdirSync(folder)
        .filter((n) => n.endsWith('.json'))
        .sort()
    : []) {
    const path = resolve(folder, file),
      dump = readDump(path),
      name = dump.page ?? file.slice(0, -5),
      nodes = dump.nodes ?? [],
      keyed: Record<string, DumpNode> = {};
    if (!Array.isArray(dump.nodes)) throw new Error(`page dump nodes must be an explicit array: ${path}`);
    if (Object.hasOwn(out, name)) throw new Error(`duplicate page name ${JSON.stringify(name)} in ${folder}`);
    for (const node of nodes) {
      if (!node || typeof node.path !== 'string') throw new Error(`node path required in ${path}`);
      if (Object.hasOwn(keyed, node.path)) throw new Error(`duplicate node paths in ${path}`);
      keyed[node.path] = node;
    }
    out[name] = { index: dump.pageIndex ?? null, nodes: keyed };
  }
  return out;
}
function categoryValues(node: DumpNode, category: string): Record<string, unknown> {
  if (category === 'style')
    return {
      fills: (node.fills ?? []).map((paint) => omit(paint, 'boundVariables')),
      strokes: (node.strokes ?? []).map((paint) => omit(paint, 'boundVariables')),
      cornerRadius: node.cornerRadius ?? null,
    };
  if (category === 'bindings')
    return {
      boundVariables: node.boundVariables ?? null,
      fills: (node.fills ?? []).map((p) => p.boundVariables ?? null),
      strokes: (node.strokes ?? []).map((p) => p.boundVariables ?? null),
    };
  return Object.fromEntries((CATEGORIES[category] ?? []).map((key) => [key, node[key as keyof DumpNode] ?? null]));
}
function omit(value: object, ...keys: string[]): Record<string, unknown> {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([k]) => !excluded.has(k)));
}
/** A root page inventory proves completeness, including a verified file with zero pages. */
export function dumpEvidence(root: string): { complete: boolean; reason?: string } {
  const manifest = resolve(root, 'figma/verify/root.json'),
    merged = resolve(root, 'figma/verify/state.json');
  try {
    const file = existsSync(manifest) ? manifest : merged;
    if (!existsSync(file))
      return { complete: false, reason: 'no whole-file root inventory to establish complete dump evidence' };
    const document = readJson(file);
    const expected = isRecord(document) ? document['pages'] : undefined;
    if (
      !Array.isArray(expected) ||
      !expected.every((p: unknown): p is { name: string } => isRecord(p) && typeof p['name'] === 'string')
    )
      return { complete: false, reason: 'root inventory does not declare pages' };
    const actual = pages(root),
      names = expected.map((p) => p.name);
    if (
      new Set(names).size !== names.length ||
      names.length !== Object.keys(actual).length ||
      names.some((name: string) => !Object.hasOwn(actual, name))
    )
      return { complete: false, reason: 'page dumps do not cover the whole-file root inventory' };
    return { complete: true };
  } catch (error) {
    return { complete: false, reason: 'invalid dump evidence: ' + String(error) };
  }
}
export function compareRuns(a: string, b: string) {
  for (const root of [a, b])
    if (!existsSync(root) || !existsSync(resolve(root, 'figma')))
      throw new Error(`run directory and figma/ folder required: ${root}`);
  const artifacts = Object.fromEntries(ARTIFACTS.map((name) => [name, artifactDiff(a, b, name)])),
    artifactRatio = Object.values(artifacts).filter((i) => i.normalized_equal).length / ARTIFACTS.length;
  const pa = pages(a),
    pb = pages(b),
    ordered = (map: Record<string, Page>) =>
      Object.keys(map).sort(
        (x, y) =>
          (map[x]!.index === null ? 1 : 0) - (map[y]!.index === null ? 1 : 0) ||
          (map[x]!.index ?? 0) - (map[y]!.index ?? 0) ||
          (x < y ? -1 : x > y ? 1 : 0),
      );
  const orderA = ordered(pa),
    orderB = ordered(pb),
    pageReports: Record<string, PageDifference> = {},
    counts: Record<string, number> = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, 0])),
    exact: Record<string, number> = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, 0]));
  let total = 0,
    matchedCount = 0,
    identicalCount = 0;
  for (const name of [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort()) {
    const na = pa[name]?.nodes ?? {},
      nb = pb[name]?.nodes ?? {},
      keysA = Object.keys(na),
      keysB = Object.keys(nb),
      added = keysB.filter((k) => !Object.hasOwn(na, k)).sort(),
      removed = keysA.filter((k) => !Object.hasOwn(nb, k)).sort(),
      matched = keysA.filter((k) => Object.hasOwn(nb, k)).sort();
    total += new Set([...keysA, ...keysB]).size;
    matchedCount += matched.length;
    const changes: Record<string, Record<string, Difference[]>> = {};
    for (const path of matched) {
      const nodeChanges: Record<string, Difference[]> = {};
      for (const category of Object.keys(CATEGORIES)) {
        const delta = differences(categoryValues(na[path]!, category), categoryValues(nb[path]!, category));
        if (delta.length) {
          nodeChanges[category] = delta;
          counts[category] = (counts[category] ?? 0) + 1;
        } else exact[category] = (exact[category] ?? 0) + 1;
      }
      const covered = new Set([...Object.values(CATEGORIES).flat(), 'path']),
        other = differences(omit(na[path]!, ...covered), omit(nb[path]!, ...covered));
      if (other.length) {
        nodeChanges['other'] = other;
        counts['other'] = (counts['other'] ?? 0) + 1;
      }
      if (Object.keys(nodeChanges).length) changes[path] = nodeChanges;
      else identicalCount++;
    }
    pageReports[name] = { added, removed, changes };
  }
  const evidence = [a, b].map(dumpEvidence),
    complete = evidence.every((e) => e.complete);
  const denominator = total || 1,
    pageExact = JSON.stringify(orderA) === JSON.stringify(orderB);
  let ratios: Record<string, number> = {
    identical_node: identicalCount / denominator,
    geometry_exact: exact['geometry']! / denominator,
    text_exact: exact['text']! / denominator,
    binding_exact: exact['bindings']! / denominator,
  };
  let score =
    (100 *
      (artifactRatio +
        Number(pageExact) +
        matchedCount / denominator +
        Object.values(exact).reduce((x, y) => x + y, 0) / denominator)) /
    11;
  if (total === 0 && pageExact) {
    score = (100 * (artifactRatio + 10)) / 11;
    ratios = Object.fromEntries(Object.keys(ratios).map((k) => [k, 1]));
  }
  return {
    runs: [a, b],
    artifacts,
    pages: {
      a: orderA,
      b: orderB,
      order_equal: pageExact,
      added: Object.keys(pb)
        .filter((k) => !Object.hasOwn(pa, k))
        .sort(),
      removed: Object.keys(pa)
        .filter((k) => !Object.hasOwn(pb, k))
        .sort(),
    },
    page_differences: pageReports,
    summary: {
      score: complete ? Math.round(score * 100) / 100 : null,
      ...(!complete
        ? {
            reason: evidence
              .filter((e) => !e.complete)
              .map((e) => e.reason)
              .join('; '),
          }
        : {}),
      artifact_exact_ratio: Math.round(artifactRatio * 10000) / 10000,
      total_nodes: total,
      matched_nodes: matchedCount,
      identical_nodes: identicalCount,
      ratios: Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, Math.round(v * 10000) / 10000])),
      category_counts: counts,
    },
  };
}
export function compareMany(runs: string[]) {
  if (runs.length < 2) throw new Error('at least two run directories are required');
  const comparisons = runs.flatMap((a, i) => runs.slice(i + 1).map((b) => compareRuns(a, b)));
  const summary_matrix = Object.fromEntries(
    runs.map((a) => [
      a,
      Object.fromEntries(
        runs.map((b) => [
          b,
          a === b
            ? dumpEvidence(a).complete
              ? 100
              : null
            : comparisons.find((p) => p.runs.includes(a) && p.runs.includes(b))!.summary.score,
        ]),
      ),
    ]),
  );
  return { comparisons, summary_matrix };
}
export function renderPair(report: ReturnType<typeof compareRuns>): string {
  const [a, b] = report.runs,
    s = report.summary,
    lines = [
      `## ${a} ↔ ${b}`,
      '',
      s.score === null ? `Repeatability: **not measured** (${s.reason})` : `Repeatability: **${s.score}/100**`,
      `Nodes: ${s.identical_nodes} identical / ${s.total_nodes} total; ${s.matched_nodes} matched`,
      '',
      '### Artifacts',
      '',
    ];
  for (const [name, item] of Object.entries(report.artifacts) as [string, (typeof report.artifacts)[string]][]) {
    const status =
      item.present[0] === false && item.present[1] === false
        ? 'absent in both'
        : item.equal_bytes
          ? 'byte equal'
          : item.normalized_equal
            ? 'normalized equal'
            : `${item.differences.length} difference(s)`;
    lines.push(`- \`${name}\`: ${status} (SHA-256: ${item.sha256[0]}, ${item.sha256[1]})`);
    for (const c of item.differences) lines.push(`  - \`${c.path}\`: ${JSON.stringify(c.a)} → ${JSON.stringify(c.b)}`);
  }
  const p = report.pages;
  lines.push('', '### Pages', '', `A: ${p.a.join(', ') || '(none)'}`, `B: ${p.b.join(', ') || '(none)'}`, '');
  for (const [name, item] of Object.entries(report.page_differences)) {
    lines.push(
      `#### ${name}`,
      '',
      `Added: ${item.added.join(', ') || 'none'}; removed: ${item.removed.join(', ') || 'none'}`,
    );
    for (const [path, groups] of Object.entries(item.changes)) {
      lines.push(`- \`${path}\``);
      for (const [category, changes] of Object.entries(groups) as [string, Difference[]][])
        for (const c of changes)
          lines.push(`  - ${category} \`${c.path}\`: ${JSON.stringify(c.a)} → ${JSON.stringify(c.b)}`);
    }
    lines.push('');
  }
  lines.push(
    'Category counts: ' +
      Object.entries(s.category_counts)
        .map(([k, v]) => `${k} ${v}`)
        .join(', '),
    'Ratios: ' +
      Object.entries(s.ratios)
        .map(([k, v]) => `${k} ${v.toFixed(4)}`)
        .join(', '),
    '',
  );
  return lines.join('\n');
}
export function renderReport(runs: string[], report = compareMany(runs)): string {
  const lines = [
    '# Repeatability across runs',
    '',
    ...report.comparisons.map(renderPair),
    '## Summary matrix',
    '',
    `| Run | ${runs.join(' | ')} |`,
    `|---|${'---:|'.repeat(runs.length)}`,
  ];
  for (const a of runs)
    lines.push(`| ${a} | ${runs.map((b) => report.summary_matrix[a]![b]?.toFixed(2) ?? 'not measured').join(' | ')} |`);
  return lines.join('\n') + '\n';
}

/** baseline-facing operation name used by benchmark repeatability scoring. */
export const compare = compareRuns;
