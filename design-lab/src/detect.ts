import { basename, dirname, join, relative as rel, resolve } from 'node:path';
import { opendirSync, readdirSync, statSync } from 'node:fs';
import { configDirs, configSync as configSyncIo, docroot as findDocroot, readText, walk } from './discovery-io.ts';
import { summary as siteStudioSummary } from './sitestudio-source.ts';
import type { Detection, Strategy } from './generated/detection.ts';
export { configDirs, docroot } from './discovery-io.ts';
export const configSync = configSyncIo;
const GENERATED = /\/sites\/[^/]+\/files\//;
function osWalkFiles(root: string, skip: RegExp): string[] {
  const result: string[] = [];
  const visit = (dir: string) => {
    if (skip.test(dir.replaceAll('\\', '/'))) return;
    let d;
    try {
      d = opendirSync(dir);
    } catch {
      return;
    }
    const files: string[] = [],
      dirs: string[] = [];
    try {
      let entry;
      while ((entry = d.readSync())) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) dirs.push(p);
        else if (entry.isFile()) files.push(p);
      }
    } finally {
      d.closeSync();
    }
    result.push(...files);
    for (const child of dirs) visit(child);
  };
  visit(root);
  return result;
}
export function detect(root: string): Detection {
  const abs = resolve(root),
    web = findDocroot(abs),
    cfg = configSyncIo(abs),
    candidates = configDirs(abs);
  const notes: string[] = [];
  const out: Detection = {
    root: abs,
    docroot: web,
    configSync: cfg,
    configCandidates: candidates,
    componentSources: [],
    tokenSources: [],
    usageSources: [],
    notes,
    priorArt: priorArt(abs),
    recommended: {},
  };
  if (out.priorArt.length)
    notes.push(
      `PRIOR ART: ${out.priorArt.length} existing design-system artifact(s) found, starting with ${out.priorArt
        .slice(0, 4)
        .map((h) => h.path)
        .join(
          ', ',
        )}. Read references/prior-art.md and reconcile against them BEFORE extracting - the code is authoritative on values, existing work on organisation and naming.`,
    );
  const empty = candidates.filter((c) => !c.entityCount).map((c) => c.path);
  if (empty.length && cfg)
    notes.push(
      `Empty configuration director${empty.length === 1 ? 'y' : 'ies'} ignored: ${empty.join(', ')}. Using ${cfg}.`,
    );
  const configs = cfg ? directYml(cfg) : [];
  const files = walk(web),
    customThemeRoot = join(web, 'themes/custom');
  let customThemes: string[] = [];
  try {
    customThemes = readdirSync(customThemeRoot).filter((n) => {
      try {
        return statSync(join(customThemeRoot, n)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {}
  const canvas = configs.filter(
    (p) =>
      basename(p).startsWith('canvas.component.sdc.') &&
      customThemes.some((t) => basename(p).startsWith(`canvas.component.sdc.${t}.`)),
  );
  if (canvas.length)
    out.componentSources.push({
      strategy: 'canvas',
      count: canvas.length,
      evidence: 'Canvas authoring registrations joined to source SDC definitions',
    });
  const paras = configs.filter((p) => basename(p).startsWith('paragraphs.paragraphs_type.')),
    blocks = configs.filter((p) => basename(p).startsWith('block_content.type.'));
  if (paras.length && blocks.length)
    out.componentSources.push({
      strategy: 'drupal-authoring',
      count: paras.length + blocks.length,
      blocks: blocks.length,
      paragraphs: paras.length,
      evidence: 'editor-facing block_content and paragraph bundle entities; treat SDCs as their rendering layer',
    });
  if (paras.length > 2)
    out.componentSources.push({
      strategy: 'paragraphs',
      count: paras.length,
      evidence: 'paragraphs_type config entities',
    });
  else if (paras.length)
    notes.push(`${paras.length} paragraph type(s) present - too few to treat as the component source`);
  const ss = siteStudioSummary(abs),
    custom = ss.customComponents.length,
    uses = !!(
      (ss.families && Object.keys(ss.families).length) ||
      custom ||
      readText(join(abs, 'composer.json')).includes('acquia/cohesion')
    );
  if (uses) {
    out.siteStudio = ss;
    if (ss.problem) notes.push('Site Studio: ' + ss.problem + '.');
  }
  if (ss.components || custom)
    out.componentSources.push({
      strategy: 'sitestudio',
      count: ss.components + custom,
      configComponents: ss.components,
      customComponents: custom,
      evidence: `cohesion_component entities in ${ss.configFrom || 'no declared export'} and custom_component definitions in custom modules and themes`,
    });
  if (ss.customStyles)
    out.tokenSources.push({
      strategy: 'sitestudio-styles',
      count: ss.customStyles,
      evidence: `cohesion_custom_style entities in ${ss.configFrom}`,
    });
  const sdc = files.filter((p) => p.endsWith('.component.yml'));
  if (sdc.length) {
    let enums = 0,
      slots = 0;
    for (const p of sdc) {
      const t = readText(p);
      enums += Number(t.includes('enum:'));
      slots += Number(/^slots:/m.test(t));
    }
    out.componentSources.push({
      strategy: 'sdc',
      count: sdc.length,
      evidence: 'Single Directory Component definitions',
      withEnumProps: enums,
      withSlots: slots,
    });
  }
  const stories = files.filter((p) => /\.stories\./.test(p));
  if (stories.length) {
    notes.push(`${stories.length} Storybook stor(ies) found - usable as a usage signal`);
    out.usageSources.push({ strategy: 'storybook', count: stories.length });
  }
  for (const name of ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs']) {
    const p = walk(abs).find((p) => basename(p) === name);
    if (p) out.tokenSources.push({ strategy: 'tailwind', evidence: rel(abs, p) });
  }
  const libraryFiles = files.filter((p) => p.endsWith('.libraries.yml')),
    themeLibraries = libraryFiles.filter((p) => p.replaceAll('\\', '/').includes('/themes/')),
    loaded = new Set<string>();
  for (const p of themeLibraries.length ? themeLibraries : libraryFiles) {
    const body = readText(p);
    for (const m of body.matchAll(/^\s*([^\s:#][^:]*\.css)\s*:/gm)) {
      const href = m[1]!.trim();
      if (/^(https?:|\/\/)/.test(href)) continue;
      loaded.add(resolve(dirname(p), href.replace(/^\//, '')));
    }
  }
  let cssFiles = 0,
    cssLoaded = 0,
    cssValues = 0;
  const unloaded: { ref: string; customProperties: number }[] = [];
  for (const p of osWalkFiles(web, /(^|\/)(node_modules|vendor|\.git|\.design-lab|contrib|core)(\/|$)/)
    .filter((p) => p.endsWith('.css') && !GENERATED.test(p))
    .slice(0, 400)) {
    const vars = new Set(
      (
        readText(p)
          .slice(0, 60000)
          .match(/--[a-zA-Z0-9_-]+\s*:/g) || []
      ).map((x) => x.replace(/\s*:/, '')),
    );
    if (!vars.size) continue;
    cssFiles++;
    if (!loaded.size || loaded.has(resolve(p))) {
      cssLoaded++;
      cssValues += vars.size;
    } else if (vars.size >= 20) unloaded.push({ ref: rel(abs, p), customProperties: vars.size });
  }
  const maps: NonNullable<Strategy['maps']> = [];
  for (const p of files.filter((x) => x.endsWith('.css.map') && !GENERATED.test(x))) {
    try {
      const d = JSON.parse(readText(p));
      const contents = d.sourcesContent || [],
        n = contents.reduce((a: string[], c: string) => a.concat(c?.match(/^\s*\$[\w-]+\s*:/gm) || []), []).length;
      if (n)
        maps.push({
          ref: rel(abs, p),
          variables: n,
          sources: (d.sources || []).length,
        });
    } catch {}
  }
  if (maps.length)
    out.tokenSources.push({
      strategy: 'sass-sourcemap',
      variables: maps.reduce((a, b) => a + (b.variables ?? 0), 0),
      maps,
    });
  if (cssFiles)
    out.tokenSources.push({
      strategy: 'css-custom-properties',
      filesWithVars: cssFiles,
      filesLoadedByTheme: cssLoaded,
      variablesLoadedByTheme: cssValues,
    });
  if (unloaded.length)
    notes.push(
      `Ignoring ${unloaded.length} stylesheet(s) with many custom properties that no *.libraries.yml loads - likely scaffolding, not the design system: ${unloaded
        .slice(0, 3)
        .map((x) => `${x.ref} (${x.customProperties})`)
        .join(', ')}`,
    );
  let sassFiles = 0,
    sassValues = 0;
  for (const p of files.filter((x) => x.endsWith('.scss'))) {
    const n = readText(p).match(/^\s*\$[\w-]+\s*:/gm)?.length || 0;
    if (n) {
      sassFiles++;
      sassValues += n;
    }
  }
  if (sassValues)
    out.tokenSources.push({
      strategy: 'sass-source',
      files: sassFiles,
      variables: sassValues,
      evidence: 'source-authored Sass declarations',
    });
  if (cfg) {
    out.usageSources.push({
      strategy: 'drupal-db',
      evidence: 'requires a running database; counts real placements',
    });
    if (canvas.length)
      out.usageSources.push({
        strategy: 'canvas-db',
        evidence: 'published Canvas page placements and content templates',
      });
  }
  const ranks: Record<string, number> = {
    canvas: 0,
    'drupal-authoring': 1,
    sitestudio: 2,
    paragraphs: 3,
    sdc: 4,
  };
  if (
    (out.componentSources.find((s) => s.strategy === 'sitestudio')?.count || 0) >
    (out.componentSources.find((s) => s.strategy === 'drupal-authoring')?.count || 0)
  ) {
    ranks['sitestudio'] = 1;
    ranks['drupal-authoring'] = 2;
  }
  const comp = [...out.componentSources].sort(
    (a, b) => (ranks[a.strategy] ?? 9) - (ranks[b.strategy] ?? 9) || (b.count ?? 0) - (a.count ?? 0),
  )[0];
  const tr = (s: Strategy) =>
    s.strategy === 'sitestudio-styles'
      ? 0
      : s.strategy === 'sass-source'
        ? 1
        : s.strategy === 'css-custom-properties' && (s.variablesLoadedByTheme ?? 0) >= 20
          ? 2
          : s.strategy === 'sass-sourcemap'
            ? 3
            : s.strategy === 'tailwind'
              ? 4
              : s.strategy === 'css-custom-properties'
                ? 5
                : 9;
  const tok = [...out.tokenSources].sort((a, b) => tr(a) - tr(b))[0],
    ur: Record<string, number> = { 'canvas-db': 0, 'drupal-db': 1, storybook: 2 },
    usage = [...out.usageSources].sort((a, b) => (ur[a.strategy] ?? 9) - (ur[b.strategy] ?? 9))[0];
  out.recommended = {
    component: comp?.strategy ?? null,
    token: tok?.strategy ?? null,
    usage: usage?.strategy ?? null,
  };
  if (out.componentSources.length > 1) {
    const listed = out.componentSources.map((c) => `${c.strategy} (${c.count})`).join(', ');
    notes.push(
      `Multiple component sources present - ${listed}. Recommending ${out.recommended.component} because authoring vocabularies outrank rendering primitives; confirm only when repository evidence contradicts that relationship.`,
    );
  }
  return out;
}
function directYml(folder: string): string[] {
  try {
    return readdirSync(folder)
      .filter((n) => n.endsWith('.yml'))
      .map((n) => join(folder, n));
  } catch {
    return [];
  }
}
type PriorArt = { path: string; kind: 'directory' | 'file' };
function priorArt(root: string): PriorArt[] {
  const dirs = ['build', 'reports', 'analysis-reports', 'docs', 'design', '.storybook'],
    name = /(component[-_ ]?librar|design[-_ ]?system|figma|design[-_ ]?token)/i,
    skip = /(^|\/)(node_modules|vendor|\.git|\.design-lab|contrib|core)(\/|$)/,
    hits: PriorArt[] = [],
    visit = (base: string, depth: number, includeFiles: boolean, prune: boolean) => {
      if (depth > 3 || (prune && skip.test(base.replaceAll('\\', '/')))) return;
      let entries;
      try {
        entries = readdirSync(base, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(base, e.name);
        let directory = e.isDirectory(),
          file = e.isFile();
        if (e.isSymbolicLink()) {
          try {
            const st = statSync(p);
            directory = st.isDirectory();
            file = st.isFile();
          } catch {
            continue;
          }
        }
        if (directory) {
          if (name.test(e.name)) hits.push({ path: rel(root, p), kind: 'directory' });
          if (!e.isSymbolicLink()) visit(p, depth + 1, includeFiles, prune);
        } else if (includeFiles && file && name.test(e.name)) hits.push({ path: rel(root, p), kind: 'file' });
      }
    };
  for (const base of dirs) visit(join(root, base), 1, true, false);
  visit(root, 0, false, true);
  const seen = new Set<string>();
  return hits
    .sort((a, b) => a.path.localeCompare(b.path))
    .filter((h) => !seen.has(h.path) && !!seen.add(h.path))
    .slice(0, 40);
}
