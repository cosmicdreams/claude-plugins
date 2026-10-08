import { oracleScript, oracleExecutable } from './oracle.ts';
/** Real repository oracle comparisons. Reads sites/runs; all generated artifacts live in /tmp. */
import { mkdtempSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { writeJson, validate } from '../../src/contracts.ts';
import { pluginRoot } from '../../src/runtime.ts';
import { detect } from '../../src/detect.ts';
import { planComponent, writePlanJson } from '../../src/plan.ts';
import { build } from '../../src/plan-variables.ts';
import type { TokenInput } from '../../src/plan-variables.ts';
import type { Components } from '../../src/generated/components.ts';
import type { ArtifactKind } from '../../src/contracts.ts';
import type { RenderingSignals, CaptureSignals } from '../../src/plan.ts';

import { portableManifest } from './portable.ts';

const home = homedir();
export const sites = [
  ['pncb', join(home, '.design/pncb/2026-10-06')],
  ['definitivehc', join(home, 'Sites/DEFINITIVEHC/design/2026-10-05')],
  ...['massport', 'kingtec', 'americas-credit-unions'].map((name) => [
    name,
    join(home, 'Tools/design-lab-corpus', name),
  ]),
] as string[][];
interface Manifest {
  repository: { root: string };
  decisions: {
    componentSource: string;
    tokenSource: string;
    usageSource: string;
    sitestudioConfig?: string | null;
  };
  standardVersion: string;
}
interface Result {
  site: string;
  root: string;
  artifacts: Record<string, { status: string; diff?: string[]; reason?: string }>;
  timings: { ts: Record<string, number>; python: Record<string, number> };
}
const componentModules: Record<string, string> = {
  canvas: 'extract-canvas',
  'drupal-authoring': 'extract-drupal-authoring',
  paragraphs: 'extract-paragraphs',
  sdc: 'extract-sdc',
  sitestudio: 'extract-sitestudio',
};
const tokenModules: Record<string, string> = {
  'css-custom-properties': 'extract-tokens-cssvars',
  'sass-source': 'extract-tokens-sass',
  'sass-sourcemap': 'extract-tokens-sourcemap',
  'sitestudio-styles': 'extract-tokens-sitestudio',
};
export const ignoredFields = [
  '/generatedAt',
  '/components/*/usage/measuredAt',
  '/usage/*/examples/*/verifiedAt',
  '/components/*/usage/examples/*/verifiedAt',
];
export function normalize(value: unknown, path = ''): unknown {
  if (Array.isArray(value)) return value.map((v, i) => normalize(v, `${path}/${i}`));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            !(path === '' && k === 'generatedAt') &&
            !(/^\/components\/\d+\/usage$/.test(path) && k === 'measuredAt') &&
            !(/^\/(?:usage\/[^/]+|components\/\d+\/usage)\/examples\/\d+$/.test(path) && k === 'verifiedAt'),
        )
        .map(([k, v]) => [k, normalize(v, `${path}/${k}`)]),
    );
  if (path === '/toolVersion' && value === 'design-lab 0.23.2') return 'design-lab 0.24.0';
  return value;
}
export function differences(a: unknown, b: unknown, path = ''): string[] {
  if (Object.is(a, b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b))
    return [`${path || '/'}: ${JSON.stringify(a)?.slice(0, 160)} != ${JSON.stringify(b)?.slice(0, 160)}`];
  const aa = a as Record<string, unknown>,
    bb = b as Record<string, unknown>;
  return [...new Set([...Object.keys(aa), ...Object.keys(bb)])]
    .sort()
    .flatMap((k) =>
      k in aa && k in bb
        ? differences(aa[k], bb[k], `${path}/${k}`)
        : [`${path}/${k}: ${k in aa ? 'missing TS' : 'missing Python'}`],
    )
    .slice(0, 50);
}
export async function main(rootArg?: string, usage = false): Promise<void> {
  portableManifest();
  const output = rootArg ? resolve(rootArg) : mkdtempSync(join(tmpdir(), 'design-lab-p3-equivalence-'));
  if (!/^\/(private\/)?tmp\//.test(output)) throw new Error('equivalence output must be under /tmp');
  mkdirSync(output, { recursive: true });
  const results: Result[] = [];
  for (const [name, frozen] of sites) {
    if (!name || !frozen) continue;
    const project = JSON.parse(readFileSync(join(frozen, 'project.json'), 'utf8')) as Manifest;
    const siteRoot = project.repository.root;
    const result: Result = {
      site: name,
      root: siteRoot,
      artifacts: {},
      timings: { ts: {}, python: {} },
    };
    results.push(result);
    if (!existsSync(siteRoot)) {
      for (const name of ['detection', 'components', 'tokens', 'render-evidence', 'plan', 'variable-plan'])
        result.artifacts[name] = {
          status: 'mismatch',
          reason: 'required site repository missing',
        };
      continue;
    }
    const siteOut = join(output, name),
      py = join(siteOut, 'python'),
      ts = join(siteOut, 'ts');
    mkdirSync(ts, { recursive: true });
    const capturesFile = join(frozen, 'capture-evidence.json');
    const captures = existsSync(capturesFile)
      ? (JSON.parse(readFileSync(capturesFile, 'utf8')).captures as Record<string, CaptureSignals>)
      : {};
    const request = {
      root: siteRoot,
      decisions: project.decisions,
      standardVersion: project.standardVersion,
      captures,
      output: py,
    };
    const reqFile = join(siteOut, 'request.json');
    writeJson(reqFile, request);
    const python = oracleExecutable;
    const oracle = spawnSync(python, [oracleScript('discovery-oracle.py'), reqFile], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      maxBuffer: 10 * 1024 * 1024,
    });
    if (oracle.status !== 0) throw new Error(`${name} Python oracle failed: ${oracle.stderr}`);
    result.timings.python = JSON.parse(readFileSync(join(py, 'timings-core.json'), 'utf8')) as Record<string, number>;
    const save = <T>(artifact: string, operation: () => T): T => {
      const started = performance.now(),
        doc = operation();
      if (artifact === 'plan')
        writePlanJson(join(ts, artifact + '.json'), doc as import('../../src/generated/plan.ts').Plan);
      else writeJson(join(ts, artifact + '.json'), doc);
      result.timings.ts[artifact] = (performance.now() - started) / 1000;
      const errors = validate(artifact as ArtifactKind, doc);
      if (errors.length) throw new Error(`${name} invalid ${artifact}: ${errors.join('; ')}`);
      return doc;
    };
    const detection = save('detection', () => detect(siteRoot));
    const config =
      project.decisions.sitestudioConfig === undefined
        ? (detection['siteStudio'] as { configDir?: string } | undefined)?.configDir
        : project.decisions.sitestudioConfig;
    const comp = (await import(
      pathToFileURL(join(pluginRoot, 'src', componentModules[project.decisions.componentSource]! + '.ts')).href
    )) as { extract(root: string, config?: string | null): Components };
    const tok = (await import(
      pathToFileURL(join(pluginRoot, 'src', tokenModules[project.decisions.tokenSource]! + '.ts')).href
    )) as { extract(root: string, config?: string | null): TokenInput };
    const components = save('components', () =>
      project.decisions.componentSource === 'sitestudio'
        ? comp.extract(siteRoot, config ?? null)
        : comp.extract(siteRoot),
    );
    const tokens = save('tokens', () =>
      project.decisions.tokenSource === 'sitestudio-styles'
        ? tok.extract(siteRoot, config ?? null)
        : tok.extract(siteRoot),
    );
    let rendering: { items?: Record<string, RenderingSignals> } = {};
    if (project.decisions.componentSource === 'drupal-authoring') {
      const module = await import('../../src/extract-drupal-rendering.ts');
      rendering = save('render-evidence', () => module.extract(siteRoot, components));
    } else
      result.artifacts['render-evidence'] = {
        status: 'skipped',
        reason: 'workflow emits render-evidence only for drupal-authoring',
      };
    save('plan', () => ({
      standardVersion: project.standardVersion,
      generatedAt: new Date().toISOString(),
      maxVariants: 64,
      plans: components.components.map((c) => planComponent(c, rendering.items?.[c.id], captures[c.id])),
    }));
    save('variable-plan', () => build(tokens));
    for (const artifact of ['detection', 'components', 'tokens', 'render-evidence', 'plan', 'variable-plan']) {
      if (result.artifacts[artifact]?.status === 'skipped') continue;
      const diff = differences(
        normalize(JSON.parse(readFileSync(join(py, artifact + '.json'), 'utf8'))),
        normalize(JSON.parse(readFileSync(join(ts, artifact + '.json'), 'utf8'))),
      );
      result.artifacts[artifact] = {
        status: diff.length ? 'mismatch' : 'match',
        ...(diff.length ? { diff } : {}),
      };
    }
    console.log(name, JSON.stringify(result.artifacts));
    if (usage) console.log('usage acceptance is run separately after core parity');
    writeJson(join(output, 'summary.json'), { ignoredFields, results });
  }
  const strict = spawnSync(oracleExecutable, [oracleScript('discovery-compare.py'), output], { encoding: 'utf8' });
  console.log(strict.stdout);
  if (strict.status !== 0) throw new Error('strict discovery manifest acceptance failed: ' + strict.stderr);
  console.log('equivalence scratch:', output);
  if (results.some((r) => Object.values(r.artifacts).some((a) => a.status === 'mismatch'))) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
  await main(process.argv[2]);
