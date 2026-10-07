/** Discover the fonts a site renders and plan how its components should draw them in Figma. */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Fonts } from './generated/fonts.ts';
import type { MeasuredNode, Spec } from './generated/spec.ts';
import type { Project } from './generated/project.ts';
import { roundEven } from './json.ts';
import { html5Entities } from './html-entities.ts';

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system', 'blinkmacsystemfont']);
const GENERIC_DRAWN: Record<string, string> = { serif: 'Times', 'sans-serif': 'Helvetica', monospace: 'Courier', 'system-ui': 'SF Pro', '-apple-system': 'SF Pro', blinkmacsystemfont: 'SF Pro', 'ui-sans-serif': 'SF Pro', 'ui-serif': 'New York', 'ui-monospace': 'SF Mono', cursive: 'Apple Chancery', fantasy: 'Papyrus' };
const ICON = /^(icomoon|fontawesome|font ?awesome( \d+)?( (free|pro|brands))?|fa[- ](solid|regular|brands|light)|glyphicons( halflings)?|material (icons|symbols)( \w+)?|dashicons|swiper-icons|slick|ionicons|feather|bootstrap-icons|remixicon|tabler-icons)$|(^|[\s_-])icons?($|[\s_-])/i;
const SYSTEM_NAMES: Record<string, string> = { arial: 'Arial', helvetica: 'Helvetica', 'helvetica neue': 'Helvetica Neue', times: 'Times', 'times new roman': 'Times New Roman', georgia: 'Georgia', verdana: 'Verdana', courier: 'Courier', 'courier new': 'Courier New', menlo: 'Menlo', monaco: 'Monaco', tahoma: 'Tahoma', 'trebuchet ms': 'Trebuchet MS', futura: 'Futura', 'gill sans': 'Gill Sans', optima: 'Optima', palatino: 'Palatino', avenir: 'Avenir', 'avenir next': 'Avenir Next', baskerville: 'Baskerville', didot: 'Didot', 'lucida grande': 'Lucida Grande', geneva: 'Geneva', 'arial black': 'Arial Black', 'american typewriter': 'American Typewriter', 'sf pro': 'SF Pro', 'sf mono': 'SF Mono', 'new york': 'New York' };
const STYLE_WORDS: [string, string, number][] = [['extralight', 'ExtraLight', 200], ['ultralight', 'ExtraLight', 200], ['semibold', 'SemiBold', 600], ['demibold', 'SemiBold', 600], ['extrabold', 'ExtraBold', 800], ['ultrabold', 'ExtraBold', 800], ['hairline', 'Thin', 100], ['thin', 'Thin', 100], ['light', 'Light', 300], ['book', 'Book', 400], ['regular', 'Regular', 400], ['normal', 'Regular', 400], ['medium', 'Medium', 500], ['demi', 'SemiBold', 600], ['heavy', 'Heavy', 900], ['black', 'Black', 900], ['bold', 'Bold', 700]];
const METRIC_COMPATIBLE: Record<string, string> = { arial: 'Arimo', helvetica: 'Arimo', 'helvetica neue': 'Arimo', 'times new roman': 'Tinos', times: 'Tinos', 'courier new': 'Cousine', courier: 'Cousine', calibri: 'Carlito', cambria: 'Caladea', georgia: 'Gelasio' };
const SYSTEM_RELATIVE: Record<string, string> = { courier: 'Courier New', 'courier new': 'Courier', times: 'Times New Roman', 'times new roman': 'Times', helvetica: 'Helvetica Neue', 'helvetica neue': 'Helvetica' };
const STAND_IN_BY_GENRE: Record<string, string> = { sans: 'Inter', serif: 'Source Serif 4', mono: 'Roboto Mono', condensed: 'Roboto Condensed' };
const UNDRAWABLE = new Set(['sf pro', 'sf pro text', 'sf pro display', 'sf pro rounded', 'sf compact', 'sf mono']);
const FOUNDRIES: [string, string, string][] = [['suisse', 'Swiss Typefaces', 'https://www.swisstypefaces.com/fonts/suisse/'], ['greta', 'Typotheque', 'https://www.typotheque.com/help/licensing/testing-fonts']];
const DESKTOP_FORMATS = new Set(['.ttf', '.otf']);
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', 'contrib', 'core', 'libraries', 'tests', 'test', 'dist-dev']);
const SCAN_SUFFIXES = new Set(['.css', '.twig', '.yml', '.yaml', '.html', '.scss', '.json']);
export const norm = (name: unknown): string => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function stackOf(css: string): string[] { return (css || '').match(/"[^"]*"|'[^']*'|[^,]+/g)?.map(p => p.trim().replace(/^['"]|['"]$/g, '').trim()).filter(Boolean) ?? []; }
export const italicOf = (style: unknown): boolean => /^(italic|oblique)/i.test(String(style ?? '').trim());
export function weightOf(value: unknown): number {
  const text = String(value ?? '').trim(), token = text.split(/\s+/)[0] ?? '';
  const digits = String.raw`\d(?:_?\d)*`, numeric = new RegExp(String.raw`^[+-]?(?:(?:${digits}(?:\.(?:${digits})?)?|\.${digits})(?:e[+-]?${digits})?|inf(?:inity)?|nan)$`, 'i').test(token);
  const number = numeric ? Number(token.replaceAll('_', '')) : Number.NaN;
  if (numeric && !Number.isFinite(number) && !Number.isNaN(number)) throw new RangeError('cannot convert an infinite font weight to an integer');
  return Number.isFinite(number) ? roundEven(number) : ({ normal: 400, bold: 700, lighter: 300, bolder: 700 } as Record<string, number>)[text.toLowerCase()] ?? 400;
}
export const isIcon = (name: string): boolean => ICON.test(name.trim());
export function rangesOf(css?: string | null): [number, number][] | null {
  if (!css) return null;
  const out: [number, number][] = [];
  for (let part of css.split(',')) { part = part.trim().toUpperCase().replace(/^U\+/, ''); if (part.includes('?')) out.push([parseInt(part.replaceAll('?', '0'), 16), parseInt(part.replaceAll('?', 'F'), 16)]); else if (part.includes('-')) { const [a, b] = part.split('-', 2); out.push([parseInt(a!, 16), parseInt(b!, 16)]); } else if (part) { const n = parseInt(part, 16); out.push([n, n]); } }
  return out.length ? out : null;
}
export function covers(ranges: readonly (readonly [number, number])[] | null | undefined, text: string): boolean { return !ranges?.length || [...text].filter(c => !/\s/u.test(c)).every(c => ranges.some(([a, b]) => a <= c.codePointAt(0)! && c.codePointAt(0)! <= b)); }

type Face = { family: string; weight: number; weightMax: number; variable: boolean; italic: boolean; file: string | null; exists: boolean; style: string; licence: string | null; desktop: boolean; ranges: [number, number][] | null; declaredIn: string };
type AdobeFamily = { cssNames: string[]; slug?: string; variations: string[] };
interface AdobePublishedResponse { kit?: { families?: { name?: string; css_names?: string[]; slug?: string; variations?: string[] }[] } }
type Sources = { faces: Record<string, Face[]>; google: string[]; kits: string[] };
type Rendered = Map<string, { components: Set<string>; chars: Set<string>; weight: number; italic: boolean }>;
export type AvailableFonts = Record<string, string[]>;
export interface FontOptions { run: string; repo: string; sitestudio?: string | null; figma: AvailableFonts | null; fetchAdobeKit?: (kit: string, timeout?: number) => Promise<Record<string, AdobeFamily> | null>; }

export function renderedText(run: string): Rendered {
  const used: Rendered = new Map(), folder = join(run, 'capture', 'measurements');
  if (!isDirectory(folder)) return used;
  for (const name of readdirSync(folder).filter(n => n.endsWith('.spec.json')).sort()) {
    let spec: Spec; try { spec = JSON.parse(readFileSync(join(folder, name), 'utf8')) as Spec; } catch { continue; }
    const component = name.slice(0, -'.spec.json'.length);
    for (const measurement of Object.values(spec.measurements ?? {})) {
      if (!('nodes' in measurement) || !Array.isArray(measurement.nodes)) continue;
      for (const node of measurement.nodes as MeasuredNode[]) {
      const text = node.text ?? '', computed = node.computed, css = computed.fontFamily;
      if (!text.trim() || !css) continue;
      const weight = weightOf(computed.fontWeight), italic = italicOf(computed.fontStyle), key = JSON.stringify([css, weight, italic]);
      const entry = used.get(key) ?? { components: new Set<string>(), chars: new Set<string>(), weight, italic };
      entry.components.add(component); for (const char of text) if (!/\s/u.test(char)) entry.chars.add(char); used.set(key, entry);
      }
    }
  }
  return used;
}
function walkFiles(root: string): string[] {
  if (!isDirectory(root)) return [];
  const out: string[] = [];
  const walk = (folder: string): void => { for (const entry of readdirSync(folder, { withFileTypes: true })) { if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(join(folder, entry.name)); } else if (SCAN_SUFFIXES.has(extname(entry.name)) && isFile(join(folder, entry.name)) && statSync(join(folder, entry.name)).size < 3_000_000) out.push(join(folder, entry.name)); } };
  walk(root); return out;
}
function isDirectory(path: string): boolean { try { return statSync(path).isDirectory(); } catch { return false; } }
function isFile(path: string): boolean { try { return statSync(path).isFile(); } catch { return false; } }
export function faceStyle(filename: string, weight: number, italic: boolean): string {
  const stem = norm(filename ? filename.replace(/\.[^.]*$/, '') : ''), named = STYLE_WORDS.find(([word]) => stem.includes(word))?.[1];
  const base = named ?? ({ 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' } as Record<number,string>)[roundEven(weight / 100) * 100] ?? 'Regular';
  return italic || stem.includes('italic') || stem.includes('oblique') ? (base === 'Regular' ? 'Italic' : `${base} Italic`) : base;
}
export function licenceOf(file: string): string | null {
  for (const name of ['OFL.txt', 'OFL', 'OFL.md', 'LICENSE.txt', 'LICENSE', 'LICENCE.txt']) { const candidate = join(dirname(file), name); if (!isFile(candidate)) continue; const text = readFileSync(candidate, 'utf8').slice(0, 4000); if (text.includes('SIL Open Font License') || name.startsWith('OFL')) return 'OFL'; if (text.includes('Apache License')) return 'Apache'; }
  return null;
}
export function unescape(text: string): string {
  return text.replaceAll('\\/', '/').replaceAll('\\"', '"').replaceAll('\\n', '\n').replace(/&(#(?:[xX][\da-fA-F]+|\d+);?|[A-Za-z][A-Za-z\d]*;?)/g, (match: string, reference: string) => {
    if (reference.startsWith('#')) return decodeNumericEntity(reference) ?? match;
    for (let length = reference.length; length > 0; length--) { const key = reference.slice(0, length), decoded = html5Entities[key]; if (decoded !== undefined) return decoded + reference.slice(length); }
    return match;
  });
}
const INVALID_CHARREFS: Record<number, string> = { 0: '\ufffd', 13: '\r', 128: '€', 129: '\u0081', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡', 136: 'ˆ', 137: '‰', 138: 'Š', 139: '‹', 140: 'Œ', 141: '\u008d', 142: 'Ž', 143: '\u008f', 144: '\u0090', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 152: '˜', 153: '™', 154: 'š', 155: '›', 156: 'œ', 157: '\u009d', 158: 'ž', 159: 'Ÿ' };
function decodeNumericEntity(reference: string): string | null {
  const number = reference[1]?.toLowerCase() === 'x' ? Number.parseInt(reference.slice(2).replace(/;$/, ''), 16) : Number.parseInt(reference.slice(1).replace(/;$/, ''), 10);
  if (Number.isNaN(number)) return null; if (Object.hasOwn(INVALID_CHARREFS, number)) return INVALID_CHARREFS[number]!;
  if (number > 0x10ffff || number >= 0xd800 && number <= 0xdfff) return '\ufffd';
  if (number >= 1 && number <= 8 || number === 11 || number >= 14 && number <= 31 || number === 0x7f || number >= 0xfdd0 && number <= 0xfdef || (number & 0xffff) >= 0xfffe) return '';
  return String.fromCodePoint(number);
}
export function declared(repo: string, sitestudio?: string | null): Sources {
  const web = ['docroot', 'web'].map(d => join(repo, d)).find(isDirectory) ?? repo;
  const roots = [join(web, 'themes/custom'), join(web, 'modules/custom'), join(web, 'sites/default/files/cohesion'), ...(sitestudio ? [sitestudio] : [])];
  const faces: Record<string, Face[]> = {}, google = new Set<string>(), kits = new Set<string>();
  for (const path of roots.flatMap(walkFiles)) {
    const text = unescape(readFileSync(path, 'utf8'));
    for (const [, block] of text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const familyRaw = block!.match(/font-family\s*:\s*([^;]+)/)?.[1]; if (!familyRaw) continue;
      const name = stackOf(familyRaw)[0]; if (!name) continue;
      const weightText = block!.match(/font-weight\s*:\s*([^;]+)/)?.[1], styleText = block!.match(/font-style\s*:\s*([^;]+)/)?.[1], rangeText = block!.match(/unicode-range\s*:\s*([^;]+)/)?.[1];
      const urls = [...block!.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(m => m[1]!); const source = urls.find(u => !u.startsWith('data:'));
      const remote = !!source && (source.startsWith('http:') || source.startsWith('https:') || source.startsWith('//')), local = source && !remote ? resolve(dirname(path), source.split(/[?#]/)[0]!) : null;
      const declaredWeights = weightText?.trim().split(/\s+/) ?? ['400'], low = weightOf(declaredWeights[0]), high = weightOf(declaredWeights.at(-1));
      const italic = italicOf(styleText ?? 'normal'), base = source ? basename(new URL(source, 'https://local.invalid').pathname) : '';
      const face: Face = { family: name, weight: low, weightMax: high, variable: high !== low, italic, file: local ?? source ?? null, exists: !!(local && isFile(local)) || remote, style: faceStyle(base || name, low, italic), licence: local && isFile(local) ? licenceOf(local) : null, desktop: DESKTOP_FORMATS.has(extname(base).toLowerCase()), ranges: rangesOf(rangeText), declaredIn: path };
      (faces[norm(name)] ??= []).push(face);
    }
    for (const [, query] of text.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s)<>]+)/g)) for (const values of new URLSearchParams(query!).getAll('family')) for (const item of values.split('|')) google.add((item.split(':')[0] ?? '').replaceAll('+', ' ').trim());
    for (const [, kit] of text.matchAll(/use\.typekit\.net\/([a-z0-9]+)\.(?:css|js)/g)) kits.add(kit!);
  }
  return { faces, google: [...google].sort(), kits: [...kits].sort() };
}
export async function adobeKit(kit: string, timeout = 8): Promise<Record<string, AdobeFamily> | null> {
  try {
    const response = await fetch(`https://typekit.com/api/v1/json/kits/${kit}/published`, { signal: AbortSignal.timeout(timeout * 1000) }); if (!response.ok) return null;
    const value = await response.json() as AdobePublishedResponse, out: Record<string, AdobeFamily> = {};
    for (const family of value.kit?.families ?? []) if (family.name) out[family.name] = { cssNames: family.css_names ?? [], slug: family.slug, variations: family.variations ?? [] };
    return out;
  } catch { return null; }
}
export async function kitsFor(run: string, ids: string[], fetcher = adobeKit): Promise<Record<string, Record<string, AdobeFamily> | null>> {
  const cachePath = join(run, 'fonts-kits.json'); let cache: Record<string, Record<string, AdobeFamily> | null> = {};
  try { cache = JSON.parse(readFileSync(cachePath, 'utf8')); } catch { /* cache is optional */ }
  const out: Record<string, Record<string, AdobeFamily> | null> = {};
  for (const kit of ids) { if (cache[kit] == null) { const fetched = await fetcher(kit); if (fetched !== null) cache[kit] = fetched; } out[kit] = cache[kit] ?? null; }
  if (Object.keys(cache).length) writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
  return out;
}
export function genre(stack: string[], family: string): string {
  const names = stack.join(' ').toLowerCase(); if (family.toLowerCase().includes('condensed')) return 'condensed'; if (names.includes('monospace') || family.toLowerCase().includes('mono')) return 'mono';
  const tail = stack.map(s => s.toLowerCase()).filter(s => GENERIC.has(s)); if (tail[0] === 'serif') return 'serif';
  if (['serif', 'text pro', 'garamond', 'caslon', 'freight text', 'georgia', 'times'].some(k => family.toLowerCase().includes(k)) && !family.toLowerCase().includes('sans')) return 'serif'; return 'sans';
}
export function cssMatch<T extends { weight: number; weightMax?: number; italic: boolean }>(faces: T[], weight: number, italic: boolean): T | null {
  if (!faces.length) return null; const same = faces.filter(f => f.italic === italic); const pool = same.length ? same : faces;
  const containing = pool.find(f => f.weight <= weight && weight <= (f.weightMax ?? f.weight)); if (containing) return containing;
  const weights = [...new Set(pool.flatMap(f => [f.weight, f.weightMax ?? f.weight]))].sort((a,b) => a-b), lighter = weights.filter(w => w < weight).reverse(), heavier = weights.filter(w => w > weight);
  const order = weight >= 400 && weight <= 500 ? [...heavier.filter(w => w <= 500), ...lighter, ...heavier.filter(w => w > 500)] : weight < 400 ? [...lighter, ...heavier] : [...heavier, ...lighter];
  const chosen = order[0]; return chosen === undefined ? pool[0]! : pool.find(f => f.weight <= chosen && chosen <= (f.weightMax ?? f.weight)) ?? pool[0]!;
}
export function availableFamily(family: string, figma: Record<string, string[]>): string | null {
  if (Object.hasOwn(figma, family)) return family; const byKey = new Map(Object.keys(figma).map(name => [norm(name), name])), key = norm(family), direct = byKey.get(key); if (direct) return direct;
  for (const suffix of ['trial', 'web', 'pro', 'std', 'text']) { const attached = byKey.get(key + suffix), stripped = key.endsWith(suffix) ? byKey.get(key.slice(0, -suffix.length)) : undefined; if (attached || stripped) return attached ?? stripped!; } return null;
}
function route(family: string, source: string, faces: Face[], adobe: (AdobeFamily & { kit?: string }) | undefined): NonNullable<Fonts['families'][number]['route']> {
  if (source === 'adobe') { const slug = adobe?.slug || family.toLowerCase().replaceAll(' ', '-'), kit = adobe?.kit; return { kind: 'adobe-fonts', steps: [`Open https://fonts.adobe.com/fonts/${slug} signed in with an Adobe account and activate ${family}` + (kit ? ` (it is served by the site's Adobe Fonts kit ${kit}).` : '.'), 'Quit and reopen Figma desktop, open the target file again and start the design-lab runner, then tell Claude, which connects again and redraws with the real font.'] }; }
  if (source === 'system') return { kind: 'figma-omits', steps: [], note: `${family} comes with macOS, but Figma desktop leaves it out of its font list, so there is nothing to install: the stand-in is the closest font Figma offers.` };
  if (source === 'google') return { kind: 'figma-problem', steps: [`${family} is a Google font, which Figma always has: check that the build runs in Figma desktop through the design-lab runner, then tell Claude, which connects again.`] };
  const covered = faces.filter(f => f.licence); if (faces.length && covered.length === faces.length) { const licence = covered[0]!.licence!, desktop = [...new Set(covered.filter(f => f.desktop).map(f => f.file ?? ''))].sort(), web = [...new Set(covered.filter(f => !f.desktop).map(f => f.file ?? ''))].sort(), steps: string[] = []; if (desktop.length) steps.push(`Open these files in Font Book and install them: ${desktop.slice(0,6).join(', ')}.`); if (web.length) steps.push(`These are web font files, which macOS cannot install as they are: convert each to TTF first (for example \`node -m fontTools.ttLib.woff2 decompress <file>\`, after \`node -m pip install fonttools brotli\`), then install the TTF files: ${web.slice(0,6).join(', ')}.`); steps.push('Quit and reopen Figma desktop, open the target file again and start the design-lab runner, then tell Claude, which connects again and redraws with the real font.'); return { kind: 'open-licence', licence, note: `${family} is under the ${licence} licence, which allows installing it.`, steps }; }
  const foundry = FOUNDRIES.find(([key]) => norm(family).includes(key)); return { kind: 'commercial', foundry: foundry?.[1] ?? null, steps: ['Ask the client (or the agency that set up its brand) for the desktop font files of ' + `${family} (the styles above) and install them with Font Book.`, foundry ? `Or get a desktop licence or trial from ${foundry[1]}: ${foundry[2]}.` : 'Or get a desktop licence or trial from its foundry.', 'Quit and reopen Figma desktop, open the target file again and start the design-lab runner, then tell Claude, which connects again and redraws with the real font. The site\'s own web font files are licensed for the website only: do not install them unless the licence says you may.'] };
}
type Choice = [string, string];
function choose(stack: string[], chars: Set<string>, sources: Sources, google: Set<string>, kitCss: Map<string, AdobeFamily & { name: string; kit: string }>, kitsUnread: boolean, unrendered: Record<string, { family: string; why: string }>, icons: Set<string>): Choice | null {
  for (const entry of stack) { const key = norm(entry); if (isIcon(entry)) { icons.add(entry); return ['icon', entry]; } if (GENERIC.has(entry.toLowerCase())) return ['system', GENERIC_DRAWN[entry.toLowerCase()] ?? 'Helvetica'];
    const faces = sources.faces[key]; if (faces?.some(f => f.exists)) { const ranges = faces.flatMap(f => f.ranges ?? [[0, 0x10ffff] as [number,number]]); if (!chars.size || [...chars].some(c => covers(ranges, c))) return ['self-hosted', faces[0]!.family]; continue; }
    if (google.has(key)) return ['google', entry]; if (kitCss.has(key)) return ['adobe', entry]; if (SYSTEM_NAMES[entry.toLowerCase()]) return ['system', SYSTEM_NAMES[entry.toLowerCase()]!]; if (kitsUnread && !faces) return ['adobe', entry];
    unrendered[entry] ??= { family: entry, why: 'declared in CSS with no source on the site, so browsers skip it and draw the next family in the stack' };
  } return null;
}
function sorted<T>(values: Iterable<T>, compare: (a:T,b:T)=>number): T[] { return [...values].sort(compare); }
export async function plan(options: FontOptions): Promise<Fonts> {
  const { run, repo, sitestudio, figma } = options, sources = declared(repo, sitestudio), kits = await kitsFor(run, sources.kits, options.fetchAdobeKit);
  const kitsUnread = Object.values(kits).some(v => v === null), kitCss = new Map<string, AdobeFamily & { name: string; kit: string }>();
  for (const [kit, families] of Object.entries(kits)) for (const [name, info] of Object.entries(families ?? {})) for (const css of [...info.cssNames, name]) kitCss.set(norm(css), { ...info, name, kit });
  const google = new Set(sources.google.map(norm)), families = new Map<string, { family: string; source: string; stack: string[]; components: Set<string>; uses: Set<string>; useValues: { weight:number; italic:boolean }[] }>(), unrendered: Record<string,{family:string;why:string}> = {}, icons = new Set<string>(), stacks: Fonts['build']['stacks'] = {};
  for (const [tuple, used] of renderedText(run)) {
    const [css] = JSON.parse(tuple) as [string, number, boolean], stack = stackOf(css), selected = choose(stack, used.chars, sources, google, kitCss, kitsUnread, unrendered, icons) ?? ['system', 'Times'] as Choice, [source, family] = selected;
    if (source === 'icon') { stacks[css] = { icon: family }; continue; } const stackRecord = stacks[css] ??= { family };
    if (source === 'self-hosted') { const faces = sources.faces[norm(family)] ?? [], ranges = faces.flatMap(f => f.ranges ?? [[0,0x10ffff] as [number,number]]); stackRecord.ranges = ranges.some(([a,b]) => a !== 0 || b !== 0x10ffff) ? ranges : null; if (stackRecord.ranges) { const idx = stack.findIndex(s => norm(s) === norm(family)), other = choose(stack.slice(idx + 1), new Set(), sources, google, kitCss, kitsUnread, {}, new Set()); stackRecord.otherwise = other?.[1] ?? 'Helvetica'; } }
    const key = norm(family), entry = families.get(key) ?? { family, source, stack, components: new Set<string>(), uses: new Set<string>(), useValues: [] }; for (const component of used.components) entry.components.add(component); const useKey = `${used.weight}|${Number(used.italic)}`; if (!entry.uses.has(useKey)) { entry.uses.add(useKey); entry.useValues.push({ weight: used.weight, italic: used.italic }); } families.set(key, entry);
  }
  const outFamilies: Fonts['families'] = [], build: Fonts['build'] = { families: {}, stacks, skip: sorted(Object.keys(unrendered).map(norm), (a,b)=>a.localeCompare(b)), icons: sorted([...icons].map(norm), (a,b)=>a.localeCompare(b)) };
  const entries = [...families].sort((a,b) => b[1].components.size - a[1].components.size);
  for (const [key, entry] of entries) {
    const family = entry.family, source = entry.source, faces = sources.faces[key] ?? [], adobe = kitCss.get(key), display = adobe?.name ?? family, figmaFamily = figma ? availableFamily(display, figma) : null; let selectedFigma = figmaFamily; if (UNDRAWABLE.has(display.toLowerCase())) selectedFigma = null;
    const faceMap: Record<string,string> = {}, variable: Record<string,number> = {};
    for (const {weight,italic} of entry.useValues.sort((a,b)=>a.weight-b.weight || Number(a.italic)-Number(b.italic))) { const served = cssMatch(faces, weight, italic), id = `${weight}|${Number(italic)}`; if (served?.variable) variable[id] = weight; else if (served) faceMap[id] = served.style; }
    const record: Fonts['families'][number] = { family: display, cssFamily: family, source, components: entry.components.size, uses: entry.useValues.sort((a,b)=>a.weight-b.weight || Number(a.italic)-Number(b.italic)).map(u=>({ weight:u.weight, italic:u.italic, face:faceMap[`${u.weight}|${Number(u.italic)}`] ?? null })), available: figma === null ? null : selectedFigma !== null, figmaFamily: selectedFigma };
    if (adobe) record.adobeKit = adobe.kit; if (source === 'adobe' && !adobe) record.note = 'the site\'s Adobe Fonts kit could not be read; treated as one of its families';
    let target = selectedFigma;
    if (figma !== null && selectedFigma === null) { const g = genre(entry.stack, display), relativeName = source === 'system' ? SYSTEM_RELATIVE[display.toLowerCase()] : undefined, relativeAvailable = relativeName ? availableFamily(relativeName, figma) : null, standIn = relativeAvailable ?? METRIC_COMPATIBLE[display.toLowerCase()] ?? STAND_IN_BY_GENRE[g]!; record.standIn = { family: standIn, default: true, reason: relativeAvailable ? `the same design as ${display} under its other macOS name` : METRIC_COMPATIBLE[display.toLowerCase()] ? `metric-compatible with ${display}` : `a ${g} family Figma always has; widths will differ from ${display}` }; record.route = route(display, source, faces, adobe); target = standIn; }
    outFamilies.push(record); build.families[key] = { family: target, standIn: !!record.standIn, faces: faceMap, variable, display };
  }
  return { families: outFamilies, unrendered: Object.values(unrendered).sort((a,b)=>a.family < b.family ? -1 : a.family > b.family ? 1 : 0), icons: [...icons].sort(), kits: Object.fromEntries(Object.entries(kits).map(([k,v])=>[k,v !== null])), figmaChecked: figma !== null, build };
}
export function summaryLines(document: Fonts): string[] {
  const families = document.families ?? []; if (!document.figmaChecked) return [`${families.length} font famil${families.length === 1 ? 'y' : 'ies'} rendered: ${families.map(f=>f.family).join(', ')}; Figma not checked yet (workflow.ts connect checks it).`];
  const missing = families.filter(f => f.standIn), out = [`${families.length - missing.length} of ${families.length} font famil${families.length === 1 ? 'y' : 'ies'} available to Figma` + (missing.length ? '.' : ': nothing to do.')];
  for (const f of missing) { const routeInfo = f.route, steps = routeInfo?.steps ?? [], standIn = f.standIn!; out.push(`- ${f.family} (in ${f.components} captured component(s)) is not available to Figma: the build uses ${standIn.family} instead, by default.` + (steps.length ? ' To use the real font:' : '')); const styles = [...new Set(f.uses.map(u=>u.face ?? `weight ${u.weight}` + (u.italic ? ' italic' : '')))].sort(); out.push(`    Styles the site uses: ${styles.join(', ')}.`); if (routeInfo?.note) out.push(`    ${routeInfo.note}`); out.push(...steps.map(step=>`    ${step}`)); }
  if (document.unrendered.length) out.push('Declared but never rendered (no source on the site): ' + document.unrendered.map(u=>u.family).join(', ') + '.'); if (document.icons.length) out.push('Icon fonts, drawn as text in the library: ' + document.icons.join(', ') + '.'); const unread = Object.entries(document.kits).filter(([,ok])=>!ok).map(([k])=>k); if (unread.length) out.push(`The Adobe Fonts kit ${unread.join(', ')} could not be read; its families are kept as the site's.`); return out;
}
export const finalise = <T>(document: T): T => JSON.parse(JSON.stringify(document)) as T;
export async function main(args = process.argv.slice(2)): Promise<number> {
  const runArg = args[0]; if (!runArg) { console.error('usage: fonts.ts <run folder>'); return 2; }
  const run = resolve(runArg), project = JSON.parse(readFileSync(join(run, 'project.json'), 'utf8')) as Project, fontPath = join(run, 'figma', 'available-fonts.json'), figma = existsSync(fontPath) ? JSON.parse(readFileSync(fontPath, 'utf8')) as AvailableFonts : null, sitestudioConfig = project.decisions?.['sitestudioConfig'], folder = typeof sitestudioConfig === 'string' ? sitestudioConfig : null;
  const document = finalise(await plan({ run, repo: resolve(project.repository.root), sitestudio: folder ? resolve(folder) : null, figma })); writeFileSync(join(run, 'fonts.json'), JSON.stringify(document, null, 2) + '\n'); console.log(summaryLines(document).join('\n')); return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
