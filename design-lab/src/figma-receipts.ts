import type { Project } from './generated/project.ts';
/** Durable receipts from observed build results; absent measurements fail closed. */
import { existsSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { load, result, safe, slotAccepts, writeArtifactOnChange, writeOnChange, nullable } from './build-artifacts.ts';
import type { BuildResult, BuildState, Component, ComponentPlan } from './build-artifacts.ts';
import type { CaptureEvidence } from './generated/capture-evidence.ts';
import { plannedIds, recordedIds } from './library-counts.ts';
import { buildIndex } from './index-rows.ts';
import { componentPage, STANDARD_VERSION, BREAKPOINTS, repoRoot } from './build-content.ts';
import { canonicalJson } from './json.ts';
import { pluginRoot } from './runtime.ts';
import { validate, appendPhaseLog } from './contracts.ts';
import type { ArtifactKind } from './contracts.ts';
export const toolVersion = (): string =>
  'design-lab ' + (load<{ version?: string }>(pluginRoot, '.claude-plugin/plugin.json', {}).version || 'unknown');
const hash = (bytes: Buffer | string): string => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
export function surrogateCrops(build: BuildResult): string[] {
  const area = (build.width || 0) * (build.height || 0);
  return (build.images ?? [])
    .filter((i) => {
      if (!area || !i.src.startsWith('capture:')) return false;
      const box = /^capture:[^:]+:(.*)$/.exec(i.src)?.[1],
        [, , w, h] = (box ?? '').split(',').map(Number);
      return w! * h! >= 0.9 * area;
    })
    .map((i) => i.src);
}
export interface RenderingEvidence {
  parentRenders?: number;
  children?: Record<string, number>;
  page?: string;
}
export function slotRendering(e: RenderingEvidence | undefined, slot: Component['slots'][number]) {
  if (!e?.parentRenders) return { rendered: true };
  const counts = e.children ?? {},
    accepts = slotAccepts(slot.accepts).filter((c) => c in counts);
  if (accepts.some((c) => counts[c])) return { rendered: true, renderedAccepts: accepts.filter((c) => counts[c]) };
  if (accepts.length)
    return {
      rendered: false,
      renderedEvidence: `Twig debug on ${e.page ?? 'None'}: the parent rendered ${e.parentRenders} time(s) and no ${accepts.join(', ')} template ran inside it; the parent prints the field values itself.`,
    };
  return { rendered: true };
}
interface AuthoredField {
  field: string;
}
interface Relationship extends AuthoredField {
  rendered?: boolean;
  renderedAccepts?: string[];
}
export function missingNested(
  slots: Component['slots'],
  relationships: Relationship[],
  nestedIds: (string | undefined)[],
): string[] {
  const documented = new Map(relationships.map((r) => [r.field, r])),
    nested = new Set(nestedIds.filter(Boolean)),
    missing = new Set<string>();
  for (const s of slots) {
    const r = documented.get(s.name);
    if (r?.rendered === false) continue;
    let accepts = slotAccepts(s.accepts);
    if (r?.renderedAccepts?.length) accepts = accepts.filter((a) => r.renderedAccepts!.includes(a));
    if (accepts.includes('*')) {
      if (!nested.size) missing.add(s.name + ': any component');
    } else for (const a of accepts) if (!nested.has(a)) missing.add(a);
  }
  return [...missing].sort();
}
export function nativeComponent(
  build: BuildResult,
  block: BuildResult,
  fields: AuthoredField[],
  relationships: Relationship[],
  slots: Component['slots'],
) {
  const m = block.native ?? {},
    nested = m.nestedInstances ?? [],
    bySource = new Map<string, (string | null)[]>();
  for (const i of nested) {
    const source = i.sourceId || '';
    bySource.set(source, [...(bySource.get(source) ?? []), i.instanceId ?? null]);
  }
  const expected = [...fields, ...relationships].map((f) => f.field).sort();
  return {
    nodeType: m.nodeType ?? null,
    rootHasImageFill: m.rootHasImageFill ?? null,
    componentProperties: [],
    nestedInstances: [...bySource]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([source, ids]) => ({ sourceId: source || null, instanceNodeIds: ids })),
    validation: {
      nativeNode: ['COMPONENT', 'COMPONENT_SET'].includes(m.nodeType ?? '') && block.setId === build.componentId,
      noScreenshotSurrogate: m.rootHasImageFill === false && !surrogateCrops(build).length,
      authoringCoverage:
        Array.isArray(m.documentedFields) &&
        JSON.stringify([...m.documentedFields].sort()) === JSON.stringify(expected),
      relationshipCoverage:
        !!Object.keys(m).length &&
        !missingNested(
          slots,
          relationships,
          nested.map((i) => i.sourceId),
        ).length,
    },
  };
}
export interface ReceiptOutput {
  name: string;
  path: string;
  kind: ArtifactKind;
  phase: string;
}
export function generate(project: string, now = new Date()): ReceiptOutput[] {
  project = resolve(project);
  const state = load<BuildState>(project, 'figma/state.json');
  if (state.standardVersion !== STANDARD_VERSION) throw new Error('Figma state is not standard ' + STANDARD_VERSION);
  const pages = result(project, 'pages').pages!,
    variables = result(project, 'variables'),
    rendering = load<Record<string, RenderingEvidence>>(project, 'capture/relationships.json', {}),
    inventory = load<{ components: Component[] }>(project, 'components.json').components,
    comps = new Map(inventory.map((c) => [c.id, c])),
    plans = Object.fromEntries(
      load<{ plans: ComponentPlan[] }>(project, 'plan.json', { plans: [] }).plans.map((p) => [p.id, p]),
    ),
    captures = load<CaptureEvidence>(project, 'capture-evidence.json').captures,
    repo = repoRoot(project),
    version = toolVersion();
  const outputs: ReceiptOutput[] = [
    { name: 'foundation', path: resolve(project, 'foundation.json'), kind: 'foundation', phase: 'foundation' },
  ];
  writeOnChange(outputs[0]!.path, {
    standardVersion: STANDARD_VERSION,
    toolVersion: version,
    figmaFileKey: state.fileKey,
    pages,
    collections: variables.collections ?? {},
    validation: { errors: [...(variables.unplanned ?? []), ...(variables.aliasMisses ?? [])] },
  });
  const recorded = recordedIds(state);
  for (const cid of plannedIds(state).filter((cid) => recorded.has(cid))) {
    const c = comps.get(cid)!,
      plan = plans[cid],
      tree = load<import('./generated/tree.ts').Tree>(project, `figma/trees/${cid}.json`),
      build = result(project, 'build:' + cid),
      block = result(project, 'block:' + cid),
      upload = result(project, 'evidence:' + cid),
      imagesUpload = result(project, 'images:' + cid),
      ev = captures[cid];
    const images = Object.fromEntries(
        (ev?.images ?? [])
          .filter((i) => (i.state || 'default') === 'default')
          .map((i) => [(i.viewport ?? '').toLowerCase(), i]),
      ),
      missingBreakpoints = BREAKPOINTS.filter((bp) => !images[bp]),
      bpEvidence = Object.fromEntries(
        BREAKPOINTS.filter((bp) => images[bp]).map((bp) => [
          bp,
          { captureFile: images[bp]!.file, viewportWidth: images[bp]!.width ?? null, state: 'default' },
        ]),
      );
    const ids = block.evidenceIds ?? [],
      shots: Record<string, string> = {};
    (block.geometry?.captures ?? []).forEach((box, i) => {
      const bp = /\b(mobile|tablet|desktop)\b/i.exec(box.label ?? '')?.[1]?.toLowerCase();
      if (bp && ids[i]) shots[bp] = ids[i]!;
    });
    const statuses = upload.statuses ?? [],
      raw = load<BuildResult>(project, `figma/results/${safe('compare:' + cid)}.json`, {}),
      outcomes: Record<string, string> = {};
    let comparison: { verdict: string; breakpoints: Record<string, string>; metrics?: BuildResult };
    if ('pairs' in raw) {
      (raw.pairs ?? []).forEach((pair, i) => {
        const bp = /\b(mobile|tablet|desktop)\b/i.exec(pair.label ?? '')?.[1]?.toLowerCase() ?? BREAKPOINTS[i];
        if (bp) outcomes[bp] = pair.pass ? 'pass' : 'fail';
      });
      comparison = {
        verdict: raw.pass && BREAKPOINTS.every((bp) => outcomes[bp] === 'pass') ? 'pass' : 'fail',
        breakpoints: Object.fromEntries(BREAKPOINTS.map((bp) => [bp, outcomes[bp] ?? 'not-run'])),
        metrics: raw,
      };
    } else
      comparison = {
        verdict: 'not-run',
        breakpoints: Object.fromEntries(BREAKPOINTS.map((bp) => [bp, 'not-run'])),
        ...(existsSync(resolve(project, `figma/results/${safe('compare:' + cid)}.json`)) ? { metrics: raw } : {}),
      };
    const fields = c.fields.map((f) => ({
        field: f.name,
        kind: f.kind,
        required: !!f.required,
        default: nullable(f.default),
        options: nullable(f.options),
        figmaTreatment: plan?.properties.find((p) => p.field === f.name)?.treatment ?? 'as rendered',
      })),
      relationships = c.slots.map((s) => ({
        field: s.name,
        accepts: slotAccepts(s.accepts),
        cardinality: s.cardinality || 0,
        required: !!s.required,
        ...slotRendering(rendering[cid], s),
      })),
      anatomy = {
        fields,
        relationships,
        ...(!fields.length && !relationships.length
          ? { emptyReason: 'No authored fields or relationships in the source.' }
          : {}),
      };
    const source = resolve(repo, c.sourceRef || ''),
      hasSource = existsSync(source) && statSync(source).isFile(),
      sourceHash = hasSource ? hash(readFileSync(source)) : hash(canonicalJson(c));
    const bound = build.bound ?? 0,
      literal = build.literal ?? 0,
      fellBack = build.fellBack ?? [],
      variableCount = build.variables ?? 0,
      expectedVariables = Object.assign({}, tree.variables, ...(tree.alternates ?? []).map((a) => a.variables)),
      imageStatuses = imagesUpload.statuses ?? [],
      imageCount = build.images?.length ?? 0,
      imageManifest = load<{ src: string; error?: string }[]>(
        project,
        `figma/images/${cid.split('.').at(-1)}/images.json`,
        [],
      ),
      imageFailures = imageManifest.filter((m) => m.error).map((m) => ({ src: m.src, error: m.error })),
      geo = block.geometry ?? {},
      blockPass =
        block.setId === build.componentId &&
        !!block.specimenId &&
        geo.variants?.length === 3 &&
        geo.captures?.length === 3,
      imagePass = imageStatuses.length === imageCount && imageStatuses.every((s) => s === 200);
    /* A receipt is written whether or not the evidence is complete: receiptErrors() then refuses to register an
       incomplete one, so this literal is deliberately not typed as BuildRecord (nulls and gaps are the signal). */
    const record = {
      standardVersion: STANDARD_VERSION,
      toolVersion: version,
      id: cid,
      figma: {
        fileKey: state.fileKey,
        pageId: pages[componentPage(c)],
        pageName: componentPage(c),
        documentationCardId: block.docId,
        blockId: block.blockId,
        componentId: build.componentId,
      },
      built: {
        variables: variableCount,
        created: build.created ?? 0,
        bindings: bound,
        literals: literal,
        fellBack,
        collectionId: build.collectionId ?? null,
        fonts: build.fonts ?? {},
        missingFonts: build.missingFonts ?? [],
        standIns: build.standIns ?? {},
        styleFallbacks: build.styleFallbacks ?? {},
        iconText: build.iconText ?? {},
        nestedMismatch: build.nestedMismatch ?? [],
        images: build.images ?? [],
        svgFailures: build.svgFailures ?? [],
      },
      documentation: { anatomy, breakpointScreenshots: shots },
      nativeComponent: nativeComponent(build, block, fields, relationships, c.slots),
      visualEvidence: {
        path: ev?.path ?? null,
        captureFiles: BREAKPOINTS.filter((bp) => images[bp]).map((bp) => images[bp]!.file),
        states: ['default'],
        breakpoints: bpEvidence,
        comparison,
      },
      assertions: {
        component: {
          verdict: build.componentId && blockPass ? 'pass' : 'fail',
          componentId: build.componentId ?? null,
          geometry: geo,
        },
        variables: {
          verdict:
            variableCount === Object.keys(expectedVariables).length &&
            (!Object.keys(tree.variables).length || (bound > 0 && build.collectionId))
              ? 'pass'
              : 'fail',
          count: variableCount,
          collectionId: build.collectionId ?? null,
        },
        bindings: { verdict: fellBack.length ? 'fail' : 'pass', bound, literal, fellBack },
        'image-upload': {
          verdict: imagePass ? 'pass' : 'fail',
          statuses: imageStatuses,
          expected: imageCount,
          failed: imageFailures,
        },
        'breakpoint-evidence': { verdict: missingBreakpoints.length ? 'fail' : 'pass', missing: missingBreakpoints },
        'evidence-upload': {
          verdict:
            statuses.length === ids.length && ids.length === 3 && statuses.every((s) => s === 200) ? 'pass' : 'fail',
          statuses,
        },
        'visual-comparison': { verdict: comparison.verdict, breakpoints: comparison.breakpoints },
      },
      sourceRef: c.sourceRef ?? null,
      sourceHash,
      sourceHashBasis: hasSource ? 'sourceRef' : 'components.json entry',
    };
    const path = resolve(project, `builds/${cid.replaceAll(':', '__').replaceAll('/', '_')}.json`);
    writeOnChange(path, record);
    outputs.push({ name: 'build:' + cid, path, kind: 'build-record', phase: 'components' });
  }
  const index = buildIndex(inventory, resolve(project, 'builds'), 50, 10, plans, now);
  index.standardVersion = STANDARD_VERSION;
  const path = resolve(project, 'index.json');
  writeArtifactOnChange('index', path, index);
  outputs.push({ name: 'index', path, kind: 'index', phase: 'index' });
  return outputs;
}
/** Writer-policy checks supplement the structural schemas, as in the baseline oracle. */
export function receiptErrors(kind: ArtifactKind, value: unknown): string[] {
  const errors = validate(kind, value);
  if (errors.length) return errors;
  if (kind === 'foundation') {
    const f = value as { pages: object; collections: object; validation: { errors: unknown[] } };
    if (!Object.keys(f.pages).length) errors.push('pages must be non-empty');
    if (!Object.keys(f.collections).length) errors.push('collections must be non-empty');
    if (f.validation.errors.length) errors.push('validation.errors must be empty');
  } else if (kind === 'index') {
    const index = value as { rows: { id: string }[]; totals: { components: number } };
    if (new Set(index.rows.map((r) => r.id)).size !== index.rows.length) errors.push('duplicate index row ids');
    if (index.totals.components !== index.rows.length) errors.push('totals.components must equal row count');
  } else if (kind === 'build-record') {
    const r = value as import('./generated/build-record.ts').BuildRecord;
    if (!(r.figma.componentSetId || r.figma.componentId)) errors.push('figma must identify a component');
    const e = r.visualEvidence;
    if (!e || !String(e.path || '').startsWith('/')) errors.push('visualEvidence.path must be root-relative');
    if (!e || (e.captureFiles?.length ?? 0) < 3) errors.push('visualEvidence needs three capture files');
    for (const bp of ['desktop', 'tablet', 'mobile'] as const) {
      const breakpoint = e?.breakpoints?.[bp] as { captureFile?: string; viewportWidth?: number } | undefined;
      if (!breakpoint?.captureFile || !breakpoint.viewportWidth) errors.push('visualEvidence missing ' + bp);
      if (!r.documentation.breakpointScreenshots?.[bp]) errors.push('documentation missing screenshot ' + bp);
      if (e?.comparison?.verdict === 'pass' && e.comparison.breakpoints?.[bp] !== 'pass')
        errors.push('passing comparison must pass ' + bp);
    }
    const anatomy = r.documentation.anatomy;
    if (!anatomy?.fields?.length && !anatomy?.relationships?.length && !anatomy?.emptyReason)
      errors.push('empty anatomy must give emptyReason');
    for (const rel of anatomy?.relationships ?? [])
      if (!Array.isArray(rel.accepts) || !rel.accepts.length || rel.accepts.some((a) => !a))
        errors.push('relationship accepts must be a non-empty array');
    if (!['COMPONENT', 'COMPONENT_SET'].includes(r.nativeComponent.nodeType ?? ''))
      errors.push('native component must be COMPONENT or COMPONENT_SET');
    if (r.nativeComponent.rootHasImageFill !== false) errors.push('native component cannot be a screenshot');
    if (!Object.keys(r.assertions ?? {}).length) errors.push('assertions must be non-empty');
  }
  return errors;
}
type Registry = Project;
export function componentCoverage(project: string, registry: Registry) {
  const planReceipt = registry.artifacts['plan'];
  let planAvailable = false;
  const expected = new Set<string>(),
    built = new Set<string>(),
    invalid: string[] = [];
  if (planReceipt?.kind === 'plan' && planReceipt.valid)
    try {
      const plan = load<{ plans: { id: string; verdict: string }[] }>(project, planReceipt.path ?? '');
      for (const p of plan.plans) if (p.verdict === 'build') expected.add(p.id);
      planAvailable = true;
    } catch {}
  for (const [name, artifact] of Object.entries(registry.artifacts))
    if (artifact.kind === 'build-record')
      try {
        const target = resolve(project, artifact.path ?? ''),
          bytes = readFileSync(target),
          r = JSON.parse(bytes.toString()) as { id: string; assertions: Record<string, { verdict: string }> };
        if (
          receiptErrors('build-record', r).length ||
          Object.values(r.assertions).some((a) => a.verdict !== 'pass') ||
          !artifact.valid ||
          artifact.sha256 !== hash(bytes)
        )
          invalid.push(name);
        else built.add(r.id);
      } catch {
        invalid.push(name);
      }
  return {
    planAvailable,
    expected: expected.size,
    built: [...built].filter((id) => expected.has(id)).length,
    missing: [...expected].filter((id) => !built.has(id)).sort(),
    unexpected: [...built].filter((id) => !expected.has(id)).sort(),
    invalid: invalid.sort(),
  };
}
export function registerOutputs(project: string, outputs: ReceiptOutput[], now = new Date()) {
  project = realpathSync(project);
  const path = resolve(project, 'project.json'),
    registry = load<Registry>(project, 'project.json'),
    registered: string[] = [],
    invalid: Record<string, string[]> = {};
  registry.artifacts ??= {};
  registry.phases ??= {};
  const at = now.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const git = (...args: string[]): string | null => {
    try {
      return execFileSync('git', ['-C', pluginRoot, ...args], {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch {
      return null;
    }
  };
  const commit = git('ls-files', '--error-unmatch', '.claude-plugin/plugin.json') ? git('rev-parse', 'HEAD') : null,
    status = commit ? git('status', '--porcelain', '--', '.') : null;
  const producedBy = {
    pluginDir: realpathSync(pluginRoot),
    toolVersion: toolVersion(),
    commit,
    dirty: status === null ? null : !!status,
  };
  for (const output of outputs) {
    const target = realpathSync(output.path),
      bytes = readFileSync(target),
      value: unknown = JSON.parse(bytes.toString()),
      errors = receiptErrors(output.kind, value);
    if (errors.length) {
      invalid[output.name] = errors;
      continue;
    }
    registry.artifacts[output.name] = {
      path: relative(project, target),
      kind: output.kind,
      sha256: hash(bytes),
      valid: true,
      errors: [],
      updatedAt: at,
      producedBy,
    };
    if (output.phase === 'components') {
      const coverage = componentCoverage(project, registry);
      registry.phases['components'] = {
        status:
          coverage.planAvailable && !coverage.missing.length && !coverage.unexpected.length && !coverage.invalid.length
            ? 'complete'
            : 'running',
        updatedAt: at,
        detail: coverage,
      };
    } else registry.phases[output.phase] = { status: 'complete', updatedAt: at, detail: { artifact: output.name } };
    writeArtifactOnChange('project', path, registry);
    appendPhaseLog(resolve(project, 'phase-log.jsonl'), {
      at,
      phase: output.phase,
      status: registry.phases[output.phase]?.status ?? 'complete',
    });
    registered.push(output.name);
  }
  return { registered, invalid };
}
export const receipts = (project: string) => registerOutputs(project, generate(project));
