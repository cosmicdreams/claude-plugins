import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative as rel, resolve, sep } from 'node:path';
import { configDirs, docroot, readText, walk } from './discovery-io.ts';
import type { Detection } from './generated/detection.ts';
export type SiteStudioSummary = Required<NonNullable<Detection['siteStudio']>>;
export type Declared = SiteStudioSummary['declared'][number];
export type CustomComponentProblem = SiteStudioSummary['customComponentProblems'][number];
export interface Located {
  path: string | null;
  from: string | null;
  problem: string | null;
  declared: Declared[];
}
const SUFFIX = '.custom_component.yml',
  BLOCKED = new Set([
    'src',
    'lib',
    'vendor',
    'assets',
    'css',
    'files',
    'images',
    'js',
    'misc',
    'templates',
    'tests',
    'fixtures',
    'build',
    'dist',
    'node_modules',
  ]);
function phpCode(text: string): string {
  let out = '',
    quote = '',
    escape = false,
    line = false,
    block = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!,
      n = text[i + 1] ?? '';
    if (line) {
      if (c === '\n') {
        line = false;
        out += '\n';
      } else out += ' ';
      continue;
    }
    if (block) {
      if (c === '*' && n === '/') {
        out += '  ';
        i++;
        block = false;
      } else out += c === '\n' ? '\n' : ' ';
      continue;
    }
    if (quote) {
      out += c;
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      out += c;
      continue;
    }
    if (c === '/' && n === '/') {
      line = true;
      out += '  ';
      i++;
      continue;
    }
    if (c === '#') {
      line = true;
      out += ' ';
      continue;
    }
    if (c === '/' && n === '*') {
      block = true;
      out += '  ';
      i++;
      continue;
    }
    out += c;
  }
  return out;
}
function unquote(s: string): string | null {
  const t = s.trim();
  if (!/^(['"])[\s\S]*\1$/.test(t)) return null;
  const q = t[0]!,
    inside = t.slice(1, -1);
  if (q === '"' && inside.includes('$')) return null;
  return q === "'" ? inside.replace(/\\([\\'])/g, '$1') : inside.replace(/\\(.)/g, '$1');
}
function expressionTokens(expr: string): string[] | null {
  const tokens: string[] = [],
    part: string[] = [];
  let quote = '',
    i = 0;
  while (i < expr.length) {
    const c = expr[i]!;
    if (quote) {
      part.push(c);
      if (c === '\\' && i + 1 < expr.length) {
        part.push(expr[++i]!);
      } else if (c === quote) quote = '';
      i++;
    } else if (c === "'" || c === '"') {
      quote = c;
      part.push(c);
      i++;
    } else if (c === '.') {
      tokens.push(part.join('').trim());
      part.length = 0;
      i++;
    } else {
      part.push(c);
      i++;
    }
  }
  if (quote) return null;
  tokens.push(part.join('').trim());
  return tokens;
}
function statementEnd(code: string, start: number): number {
  let quote = '',
    escape = false;
  for (let i = start; i < code.length; i++) {
    const c = code[i]!;
    if (quote) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === quote) quote = '';
    } else if (c === "'" || c === '"') quote = c;
    else if (c === ';') return i;
  }
  return -1;
}
function locate(root: string, name: string): Declared[] {
  const web = docroot(root),
    siteRoot = join(web, 'sites');
  let siteDirs: string[] = [];
  try {
    siteDirs = readdirSync(siteRoot)
      .map((n) => join(siteRoot, n))
      .filter((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {}
  const dirs = siteDirs
    .flatMap((d) => {
      try {
        return readdirSync(d)
          .filter((n) => /^settings.*\.php$/.test(n) && n !== 'settings.ddev.php')
          .map((n) => join(d, n));
      } catch {
        return [];
      }
    })
    .sort();
  const out: Declared[] = [];
  const re = new RegExp('\\$settings\\s*\\[\\s*([\'\\"])(' + name + ')\\1\\s*\\]\\s*=(?!=)', 'g');
  for (const file of dirs) {
    const code = phpCode(readText(file));
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const start = m.index + m[0].length,
        end = statementEnd(code, start);
      if (end < 0) continue;
      const expr = code.slice(start, end).trim(),
        parts = expressionTokens(expr);
      let value = '',
        ok = !!parts?.length;
      for (const part0 of parts || []) {
        const part = part0.trim();
        let v = unquote(part);
        if (v !== null) value += v;
        else if (['$app_root', 'DRUPAL_ROOT'].includes(part)) {
          value += web;
        } else if (part === '__DIR__' || part === 'dirname(__FILE__)') {
          value += dirname(file);
        } else if (part === '$site_path') {
          value += rel(web, dirname(file));
        } else {
          ok = false;
          break;
        }
      }
      let p = ok ? resolve(value.startsWith('/') ? value : join(web, value)) : null;
      if (p?.startsWith('/var/www/html')) p = join(root, p.slice('/var/www/html'.length));
      out.push({
        file: rel(root, file).split(sep).join('/'),
        line: code.slice(0, m.index).split('\n').length,
        path: p,
        expression: expr,
        exists: !!p && existsSync(p) && statSync(p).isDirectory(),
      });
    }
  }
  return out;
}
export function configDir(root: string, folder?: string): Located {
  const abs = resolve(root);
  if (folder)
    return {
      path: resolve(folder),
      from: 'given',
      declared: [],
      problem: null,
    };
  const override = 'name the folder with workflow.ts select --sitestudio-config <folder>';
  for (const name of ['site_studio_sync', 'config_sync_directory']) {
    const found = locate(abs, name);
    if (!found.length) continue;
    const unread = found.find((x) => !x.path);
    if (unread)
      return {
        path: null,
        from: null,
        declared: found,
        problem: `$settings['${name}'] at ${unread.file}:${unread.line} is ${unread.expression}, which cannot be read without running PHP; ${override}`,
      };
    const resolved = found.filter((x): x is Declared & { path: string } => x.path !== null),
      paths = [...new Set(resolved.map((x) => x.path))].sort();
    if (paths.length > 1)
      return {
        path: null,
        from: null,
        declared: found,
        problem: `the settings give $settings['${name}'] ${paths.length} different values (${paths.map((p) => rel(abs, p)).join(', ')}), and which applies depends on the site and environment; ${override}`,
      };
    const item = resolved[0]!;
    if (!item.exists)
      return {
        path: null,
        from: null,
        declared: found,
        problem: `$settings['${name}'] at ${item.file}:${item.line} names ${rel(abs, item.path)}, which does not exist in this repository; ${override}`,
      };
    if (
      name === 'config_sync_directory' &&
      !readdirSync(item.path).some((n: string) => n.startsWith('cohesion_') && n.endsWith('.yml'))
    )
      return {
        path: null,
        from: null,
        declared: found,
        problem: `the site's settings name no Site Studio folder, and its Drupal configuration (${rel(abs, item.path)}) holds no Site Studio entities; ${override}`,
      };
    return {
      path: item.path,
      from: `${item.file}:${item.line} (${name})`,
      declared: found,
      problem: null,
    };
  }
  return {
    path: null,
    from: null,
    declared: [],
    problem: `the site's settings name no Site Studio configuration folder; ${override}`,
  };
}
function roots(web: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const kind of ['modules', 'themes']) {
    const base = join(web, kind, 'custom');
    for (const p of walk(base, { followSymlinks: true }).filter((x) => x.endsWith('.info.yml'))) {
      const ext = basename(p).slice(0, -9);
      if (!map.has(ext)) map.set(ext, dirname(p));
    }
  }
  return map;
}
function activeExtensions(root: string): Set<string> | null {
  const found = locate(resolve(root), 'config_sync_directory'),
    paths = [
      ...new Set(found.filter((x): x is Declared & { path: string } => x.exists && x.path !== null).map((x) => x.path)),
    ];
  if (paths.length !== 1) return null;
  const path = paths[0];
  if (!path) return null;
  const file = join(path, 'core.extension.yml');
  if (!existsSync(file)) return null;
  const text = readText(file);
  return new Set([...text.matchAll(/^  ([a-z0-9_]+):/gm)].map((m) => m[1]!));
}
function scan(folder: string): Map<string, string> {
  const out = new Map<string, string>(),
    seen = new Set<string>();
  const visit = (dir: string) => {
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || BLOCKED.has(e.name)) continue;
      const p = join(dir, e.name);
      try {
        const st = statSync(p);
        if (st.isDirectory()) visit(p);
        else if (st.isFile() && e.name.endsWith(SUFFIX)) {
          const n = e.name.slice(0, -SUFFIX.length);
          if (/^[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*$/.test(n)) out.set(n, p);
        }
      } catch {}
    }
  };
  visit(folder);
  return out;
}
export function customComponents(root: string): [string[], CustomComponentProblem[], boolean] {
  const abs = resolve(root),
    web = docroot(abs),
    active = activeExtensions(abs),
    exts = [...roots(web)].sort(([a], [b]) => a.localeCompare(b)),
    folders = exts.filter(([id]) => !active || active.has(id)).map(([, p]) => join(p, 'custom_components'));
  folders.push(join(web, 'custom_components'));
  const chosen = new Map<string, string>(),
    problems: CustomComponentProblem[] = [];
  for (const folder of folders) {
    if (!existsSync(folder)) continue;
    for (const [name, path] of scan(folder)) {
      const text = readText(path),
        missing = ['name', 'category'].filter((k) => !new RegExp('^' + k + ':', 'm').test(text));
      if (missing.length)
        problems.push({
          kind: 'invalid-custom-component',
          detail: `${rel(abs, path)}: missing ${missing.join(', ')}, so Site Studio refuses it`,
        });
      else if (chosen.has(name))
        problems.push({
          kind: 'duplicate-custom-component',
          detail:
            `${rel(abs, path)} is hidden by ${rel(abs, chosen.get(name)!)} , which Site Studio finds first for the name ${name}`.replace(
              '  ,',
              ',',
            ),
        });
      else chosen.set(name, path);
    }
  }
  return [[...chosen].sort(([a], [b]) => a.localeCompare(b)).map(([, p]) => p), problems, active !== null];
}
export function customComponentFiles(root: string): string[] {
  return customComponents(root)[0];
}
export function customComponentId(path: string): string {
  return basename(path).slice(0, -SUFFIX.length);
}
export function families(folder: string | null): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!folder || !existsSync(folder)) return counts;
  let names: string[] = [];
  try {
    names = readdirSync(folder);
  } catch {
    return counts;
  }
  for (const n of names) {
    const parts = n.split('.'),
      family = parts.slice(0, 2).join('.');
    if (n.startsWith('cohesion_') && n.endsWith('.yml') && parts.length >= 3)
      counts[family] = (counts[family] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
export function summary(root: string, folder?: string): SiteStudioSummary {
  const abs = resolve(root),
    located = folder ? configDir(abs, folder) : configDir(abs),
    counts = families(located.path),
    [custom, problems, activityKnown] = customComponents(abs);
  return {
    configDir: located.path,
    configFrom: located.from,
    problem: located.problem,
    declared: located.declared,
    families: counts,
    components: counts['cohesion_elements.cohesion_component'] || 0,
    customStyles: counts['cohesion_custom_styles.cohesion_custom_style'] || 0,
    customComponents: custom.map((p) => rel(abs, p).split(sep).join('/')),
    customComponentProblems: problems,
    customComponentsFromActiveExtensionsOnly: activityKnown,
  };
}
