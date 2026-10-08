import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildTrees, specFileFor } from './figma-build.ts';
import * as content from './build-content.ts';
import type { WidthReport } from './property-compare.ts';
import { compare as propertyCompare } from './property-compare.ts';

export interface Tier1Options {
  buildTrees?: typeof buildTrees;
  components?: typeof content.components;
  plans?: typeof content.plans;
  compare?: typeof propertyCompare;
  tempRoot?: string;
}
const metricNames = ['geometry', 'fontSize', 'textAlignment', 'textRunCount', 'imagesPresent'] as const;
export function replay(runPath: string, label?: string, options: Tier1Options = {}) {
  const run = resolve(runPath),
    components = (options.components ?? content.components)(run),
    plan = (options.plans ?? content.plans)(run),
    reports: Record<string, Record<string, WidthReport> | { status: 'unmeasured'; reason: string }> = {},
    temp = mkdtempSync(join(options.tempRoot ?? tmpdir(), 'design-lab-tier1-'));
  let built: { id: string }[];
  try {
    built = (options.buildTrees ?? buildTrees)(run, temp);
    for (const component of components) {
      if (plan[component.id]?.verdict !== 'build') continue;
      const treePath = resolve(temp, component.id + '.json'),
        specPath = specFileFor(resolve(run, 'capture/measurements'), component);
      if (!existsFile(treePath) || !specPath) {
        reports[component.id] = { status: 'unmeasured', reason: 'no usable matching measurement' };
        continue;
      }
      reports[component.id] = (options.compare ?? propertyCompare)(
        JSON.parse(readFileSync(treePath, 'utf8')),
        JSON.parse(readFileSync(specPath, 'utf8')),
      );
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  const totals: Record<string, { passed: number; total: number; unmeasured: number }> = Object.fromEntries(
    metricNames.map((name) => [name, { passed: 0, total: 0, unmeasured: 0 }]),
  );
  let widths = 0;
  for (const report of Object.values(reports)) {
    if ('status' in report && report.status === 'unmeasured') continue;
    for (const width of Object.values(report)) {
      if (!width || typeof width === 'string' || width.status !== 'measured') continue;
      widths++;
      for (const name of metricNames)
        for (const key of ['passed', 'total', 'unmeasured'] as const) totals[name]![key] += width[name][key];
    }
  }
  const site = label || run.split(/[\\/]/).at(-1)!;
  const summary =
    `${site}: ${built!.length}/${Object.keys(reports).length} components rebuilt; ${widths} widths; ` +
    metricNames
      .map((name) => `${name} ${totals[name]!.passed}/${totals[name]!.total} (${totals[name]!.unmeasured} unmeasured)`)
      .join('; ');
  return { site, tier: 1, components: reports, metrics: totals, summary };
}
function existsFile(path: string): boolean {
  return existsSync(path);
}
