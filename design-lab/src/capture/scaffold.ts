import { readFileSync, existsSync, globSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import * as twig from './twig.ts';
import type { CaptureConfig } from './types.ts';
export interface Example { path?: string; url?: string; marker?: string; markerKind?: string; [key: string]: unknown }
export interface Usage { examples?: (string | Example)[]; renderedExamples?: (string | Example)[]; exampleCandidates?: (string | Example)[];
  placements?: number; globallyExcluded?: boolean; excluded?: boolean; [key: string]: unknown }
export interface Component { id: string; machineName?: string; label?: string; sourceRef?: string; isCustomComponent?: boolean;
  globallyExcluded?: boolean; excluded?: boolean; usage?: Usage; slots?: { accepts?: string[]; [key: string]: unknown }[]; [key: string]: unknown }
export interface ComponentDocument { source?: { strategy?: string; root?: string }; components?: Component[] }
export function firstExample(usage: Usage, avoid: ReadonlySet<string> = new Set()): Example | null {
  for (const key of ['examples', 'renderedExamples', 'exampleCandidates'] as const) {
    const found = (usage[key] ?? []).map(item => typeof item === 'string' ? { path: item } : item).filter(item => item.path);
    if (found.length) return found.find(item => !avoid.has(item.path!)) ?? found[0]!;
  }
  return null;
}
export function componentSelector(id: string, strategy?: string): string | null {
  if (['sdc', 'canvas'].includes(strategy ?? '') && id.startsWith('sdc.')) {
    const [, namespace, ...machine] = id.split('.');
    if (namespace && machine.join('.')) return `[data-component-id="${namespace}:${machine.join('.')}"]`;
  }
  return null;
}
export function templateSelector(theme: string | undefined, machine: string): [string | null, string | null] {
  if (!theme || !existsSync(theme)) return [null, null];
  const clean = machine.replaceAll('_', '-');
  for (const pattern of [`templates/**/paragraph--${clean}.html.twig`, `templates/**/paragraph--component--${clean}.html.twig`, `templates/**/${clean}.html.twig`]) {
    for (const path of globSync(pattern, { cwd: theme })) {
      let body: string; try { body = readFileSync(resolve(theme, path), 'utf8'); } catch { continue; }
      if (body.includes('{{ attributes') || body.includes('{{attributes')) return [`.paragraph--type--${clean}`, 'attributes printed'];
      const block = /{%\s*block\s+content\s*%}([\s\S]*?){%\s*endblock/.exec(body)?.[1] ?? body;
      const root = /<(\w+)([^>]*)>/.exec(block);
      if (root) {
        const cls = /\bclass\s*=\s*"([^"{}]+)"/.exec(root[2]!);
        return cls ? ['.' + cls[1]!.split(/\s+/)[0], `root class in ${basename(path)}`]
          : [null, `root <${root[1]}> in ${basename(path)} carries no class; needs a structural selector`];
      }
      const embed = /{%\s*embed\s+'([\w.-]+):([\w-]+)'/.exec(body);
      if (embed) return ['.c-' + embed[2], 'single directory component embed'];
    }
  }
  return [null, null];
}
export function sdcSelector(theme: string | undefined, machine: string): [string | null, string | null] {
  if (!theme || !existsSync(theme)) return [null, null];
  for (const path of globSync(`components/**/${machine}.twig`, { cwd: theme })) {
    const body = readFileSync(resolve(theme, path), 'utf8').replace(/{%\s*macro\b[\s\S]*?{%\s*endmacro\s*%}/g, '');
    const root = /<[a-zA-Z][^>]*>/.exec(body)?.[0];
    if (!root) continue;
    const match = /\bclass\s*=\s*["']([^"']+)/.exec(root) ?? /\baddClass\(\s*["']([^"']+)/.exec(root);
    if (match) return ['.' + match[1]!.split(/\s+/)[0], 'root class in ' + basename(path)];
  }
  return [null, null];
}
export function customSelector(repository: string, source: string): [string | null, string | null] {
  try {
    const definition = resolve(repository, source);
    const template = /^template: (.+)$/m.exec(readFileSync(definition, 'utf8'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
    if (!template) return [null, null];
    const body = readFileSync(resolve(dirname(definition), template), 'utf8').replace(/{#[\s\S]*?#}/g, '');
    const root = /<[a-zA-Z][^>]*>/.exec(body)?.[0];
    const match = root ? /\bclass\s*=\s*["']([a-zA-Z_][a-zA-Z0-9_-]*)(?=[\s"'])/.exec(root) : null;
    return match ? ['.' + match[1], 'root class in custom component template'] : [null, null];
  } catch (error) { if ((error as NodeJS.ErrnoException).code) return [null, null]; throw error; }
}
export function ownScript(id: string, markerKind: string | undefined, selector: string, children: string[]): string {
  const own = markerKind === 'template' ? twig.tagScript(id) : twig.revealScript(selector);
  const script = twig.childTagScripts(children);
  return script ? '(() => { const own = ' + own.trim() + '; ' + script + ' return own; })()' : '(' + own.trim() + ')';
}
export type ScaffoldConfig = Omit<CaptureConfig, 'path' | 'verificationUrl' | 'linkUrl' | 'rootSelector'> & {
  componentId: string; machineName: string; path: string | null; verificationUrl: string | null; linkUrl: string | null; rootSelector: string | null;
};
export function scaffold(doc: ComponentDocument, options: { siteUrl?: string; canonicalBaseUrl: string; themeRoot?: string }): ScaffoldConfig[] {
  const strategy = doc.source?.strategy, sdc = ['sdc', 'canvas'].includes(strategy ?? ''), parentPages = new Map<string, Set<string>>();
  for (const parent of doc.components ?? []) {
    const page = firstExample(parent.usage ?? {})?.path;
    for (const slot of parent.slots ?? []) for (const child of slot.accepts ?? []) if (page && child !== parent.id) {
      if (!parentPages.has(child)) parentPages.set(child, new Set()); parentPages.get(child)!.add(page);
    }
  }
  return [...doc.components ?? []].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(c => {
    const id = c.id, machine = c.machineName || id.split(':').at(-1)!;
    const example = firstExample(c.usage ?? {}, parentPages.get(id));
    const children = [...new Set((c.slots ?? []).flatMap(s => s.accepts ?? []).filter(cid => cid !== '*' && cid !== id))].sort();
    const marker = example?.marker;
    let kind = example?.markerKind, sel = componentSelector(id, strategy), why: string | null = sel ? 'Drupal SDC component id' : null;
    if (!sel && strategy === 'sitestudio' && !c.isCustomComponent) { kind = 'template'; sel = twig.rootSelector(id); why = 'Site Studio template marker'; }
    if (!sel) {
      sel = marker ? kind === 'class' ? '.' + marker : kind === 'id' ? '#' + marker : kind === 'component' ? `[data-component-id="${marker}"]` : kind === 'template' ? twig.rootSelector(id) : null : null;
      why = sel ? 'unique rendered usage marker' : null;
    }
    if (!sel && c.isCustomComponent) [sel, why] = customSelector(doc.source?.root ?? '', c.sourceRef ?? '');
    if (!sel && !c.isCustomComponent) [sel, why] = sdc ? sdcSelector(options.themeRoot, machine) : templateSelector(options.themeRoot, machine);
    const path = example?.path ?? null;
    const cfg: ScaffoldConfig = {
      component: c.label || machine, componentId: id, machineName: machine, source: { sourceRef: c.sourceRef ?? null }, path,
      verificationUrl: options.siteUrl && path ? new URL(path.replace(/^\/+/, ''), options.siteUrl.replace(/\/+$/, '') + '/').href : example?.url ?? null,
      linkUrl: path ? new URL(path.replace(/^\/+/, ''), options.canonicalBaseUrl.replace(/\/+$/, '') + '/').href : null,
      rootSelector: sel, nth: 0,
      states: sel ? [{ name: 'default', setup: ownScript(id, kind, sel, children), setupKey: { own: kind === 'template' ? 'template' : 'reveal', children: children.filter(cid => cid.includes(':') && !cid.startsWith('sdc.')) } }] : [{ name: 'default' }],
    };
    if (!sel) {
      cfg.rootSelector = sdc || c.isCustomComponent ? null : '.paragraph--type--' + machine.replaceAll('_', '-');
      cfg['_selectorIsAGuess'] = sdc || c.isCustomComponent ? 'No root class could be read from the SDC Twig template.' : 'The default paragraph wrapper. Verify it: a component with its own template usually emits no bundle class.';
    } else if (why) cfg['_selectorFrom'] = why;
    if (sel === null && why) cfg['_selectorNote'] = why;
    return cfg;
  });
}
