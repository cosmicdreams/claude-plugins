// `test-lab check`: QA's automation standard (automation/CLAUDE.md), ported as rules.json and checked
// syntactically with the pinned parser. Advisory only: a finding never enters the verdict, and a rule
// that flags a clean example suite is a checker bug. Each rule records its source section and quote,
// the commit it was ported from and how it is checked; when the current standard is supplied, a rule
// whose quote no longer appears is reported as drifted.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { ts } from '../parser.ts';

type Node = import('typescript').Node;
type SourceFile = import('typescript').SourceFile;
type CallExpression = import('typescript').CallExpression;
type Expression = import('typescript').Expression;

export type RuleKind = 'standard' | 'settlement' | 'proposal';
export type Rule = {
  id: string;
  kind: RuleKind;
  title: string;
  source: { section: string; quote: string };
  check: { applies: string; how: string };
  exceptions: string[];
  blocking: false;
};
export type RuleSet = {
  schema: 1;
  standard: { owner: string; path: string; portedFrom: string; portedAt: string; sha256: string; drift: string };
  rules: Rule[];
};
export type Finding = { rule: string; file: string; line: number; message: string };
/** What the checker knows about a case from the corpus: its priority tag and declared viewport widths. */
export type CorpusCase = { id: string; tag: 'p1' | 'p2' | 'p3' | 'p4' | null; defaulted: boolean; widths: number[] };
export type CheckReport = {
  schema: 1;
  advisory: true;
  suiteRoot: string;
  standard: { portedFrom: string; status: 'not-checked' | 'unchanged' | 'changed'; driftedRules: string[]; warning: string | null };
  files: { spec: number; page: number; fixture: number; config: number };
  findings: Finding[];
  notChecked: string[];
};

const RULES_FILE = new URL('../../rules.json', import.meta.url);

export function loadRules(file: URL | string = RULES_FILE): RuleSet {
  const value = JSON.parse(readFileSync(file, 'utf8')) as RuleSet;
  if (value.schema !== 1 || !Array.isArray(value.rules)) throw new Error('rules.json: unsupported schema');
  const ids = new Set<string>();
  for (const r of value.rules) {
    if (typeof r.id !== 'string' || ids.has(r.id)) throw new Error(`rules.json: missing or duplicate rule ID ${String(r.id)}`);
    ids.add(r.id);
    if (!['standard', 'settlement', 'proposal'].includes(r.kind) || !r.source?.quote || !r.source.section || !r.check?.how || r.blocking !== false)
      throw new Error(`rules.json: rule ${r.id} lacks its kind, source, check or advisory flag`);
  }
  return value;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Which rules' quoted text the current standard no longer contains. */
export function standardDrift(rules: RuleSet, text: string | null): CheckReport['standard'] {
  if (text === null) return { portedFrom: rules.standard.portedFrom, status: 'not-checked', driftedRules: [], warning: null };
  const hash = createHash('sha256').update(text).digest('hex');
  const body = squash(text);
  const drifted = rules.rules.filter((r) => !body.includes(squash(r.source.quote)) || !new RegExp(`^#{2,3} ${r.source.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(text)).map((r) => r.id);
  const changed = hash !== rules.standard.sha256;
  return { portedFrom: rules.standard.portedFrom, status: changed ? 'changed' : 'unchanged', driftedRules: drifted, warning: changed ? `${rules.standard.drift}${drifted.length ? ` Drifted: ${drifted.join(', ')}.` : ' No quoted rule text moved.'}` : null };
}

function files(root: string, dir: string, test: (rel: string) => boolean): string[] {
  const out: string[] = [];
  const base = join(root, dir);
  if (!existsSync(base)) return out;
  const visit = (abs: string) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const path = join(abs, e.name);
      const rel = relative(root, path).split(sep).join('/');
      if (rel.startsWith('support/test-lab')) continue;
      if (e.isDirectory()) visit(path);
      else if (e.isFile() && test(rel)) out.push(rel);
    }
  };
  visit(base);
  return out.sort();
}

function parse(root: string, rel: string): SourceFile {
  const text = readFileSync(join(root, rel), 'utf8');
  const kind = /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : /\.[cm]?ts$/.test(rel) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
}

function each(node: Node, visit: (n: Node) => void): void {
  visit(node);
  node.forEachChild((child) => each(child, visit));
}

const lineOf = (sf: SourceFile, node: Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/** Name of a call's callee: `a.b.c(...)` gives ['a','b','c']. */
function calleePath(e: Expression): string[] {
  if (ts.isIdentifier(e)) return [e.text];
  if (ts.isPropertyAccessExpression(e)) return [...calleePath(e.expression), e.name.text];
  if (ts.isCallExpression(e)) return calleePath(e.expression);
  if (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) return calleePath(e.expression);
  return ['?'];
}
const methodName = (call: CallExpression): string | null => ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : ts.isIdentifier(call.expression) ? call.expression.text : null;

/** A comment directly above the statement holding `node`, or on its own line. */
function explained(sf: SourceFile, node: Node): boolean {
  let statement: Node = node;
  while (statement.parent && !ts.isBlock(statement.parent) && !ts.isSourceFile(statement.parent) && !ts.isObjectLiteralExpression(statement.parent) && !ts.isClassDeclaration(statement.parent)) statement = statement.parent;
  const text = sf.getFullText();
  if ((ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? []).length > 0) return true;
  const end = statement.getEnd();
  const lineEnd = text.indexOf('\n', end);
  return /\/\/|\/\*/.test(text.slice(end, lineEnd < 0 ? undefined : lineEnd));
}

const READS = new Set(['textContent', 'innerText', 'innerHTML', 'inputValue', 'getAttribute', 'isVisible', 'isHidden', 'isChecked', 'isEnabled', 'isDisabled', 'isEditable', 'count', 'allTextContents', 'allInnerTexts']);
function awaitedRead(e: Node): boolean {
  let found = false;
  each(e, (n) => {
    if (ts.isAwaitExpression(n)) {
      let inner: Expression = n.expression;
      while (ts.isParenthesizedExpression(inner) || ts.isNonNullExpression(inner)) inner = inner.expression;
      if (ts.isCallExpression(inner)) { const m = methodName(inner); if (m !== null && READS.has(m)) found = true; }
    }
  });
  return found;
}
function identifiers(e: Node): Set<string> {
  const out = new Set<string>();
  each(e, (n) => { if (ts.isIdentifier(n) && !(n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) out.add(n.text); });
  return out;
}

const CASE_ID = /^(C\d+|[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+-\d+)\b/;
const TEST_MODIFIERS = new Set(['only', 'skip', 'fixme', 'fail', 'slow']);

type Declared = { call: CallExpression; title: string; tags: string[]; fn: Node };

function stringValue(e: Node | undefined): string | null {
  if (e === undefined) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  return null;
}
function tagsOf(details: Node | undefined): string[] {
  if (details === undefined || !ts.isObjectLiteralExpression(details)) return [];
  const out: string[] = [];
  for (const p of details.properties) {
    if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) || p.name.text !== 'tag') continue;
    const v = p.initializer;
    if (ts.isArrayLiteralExpression(v)) for (const x of v.elements) { const s = stringValue(x); if (s !== null) out.push(s); }
    else { const s = stringValue(v); if (s !== null) out.push(s); }
  }
  return out;
}
const isFunction = (n: Node | undefined): boolean => n !== undefined && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));

/** `test('title', details?, fn)` and its modifier forms; never describe, hooks, step or use. */
function declaration(call: CallExpression, testName: string): Declared | null {
  const path = calleePath(call.expression);
  if (path[0] !== testName || path.length > 2 || (path.length === 2 && !TEST_MODIFIERS.has(path[1]!))) return null;
  const title = stringValue(call.arguments[0]);
  const fn = call.arguments[call.arguments.length - 1];
  if (title === null || !isFunction(fn)) return null;
  const details = call.arguments.length === 3 ? call.arguments[1] : undefined;
  const titleTags = title.match(/@[\w-]+/g) ?? [];
  return { call, title, tags: [...tagsOf(details), ...titleTags], fn: fn! };
}
function describeTags(node: Node, testName: string): string[] {
  const out: string[] = [];
  for (let n: Node | undefined = node.parent; n; n = n.parent) {
    if (!ts.isCallExpression(n)) continue;
    const path = calleePath(n.expression);
    if (path[0] === testName && path[1] === 'describe') {
      const title = stringValue(n.arguments[0]) ?? '';
      out.push(...(title.match(/@[\w-]+/g) ?? []), ...(n.arguments.length === 3 ? tagsOf(n.arguments[1]) : []));
    }
  }
  return out;
}
function enclosingDeclaration(node: Node, testName: string): Declared | null {
  for (let n: Node | undefined = node.parent; n; n = n.parent) if (ts.isCallExpression(n)) { const d = declaration(n, testName); if (d !== null && d.fn !== node) return d; }
  return null;
}
function enclosingDescribeCases(node: Node, testName: string): string[] {
  for (let n: Node | undefined = node.parent; n; n = n.parent) {
    if (!ts.isCallExpression(n)) continue;
    const path = calleePath(n.expression);
    if (path[0] === testName && path[1] === 'describe') {
      const ids: string[] = [];
      each(n, (x) => { if (ts.isCallExpression(x)) { const d = declaration(x, testName); if (d !== null) ids.push(...caseIds(d.title)); } });
      return ids;
    }
  }
  return [];
}
const caseIds = (title: string) => title.match(/\bC\d+\b|\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+-\d+\b/g) ?? [];

/** `if ((page.viewportSize()?.width ?? 0) < N) { test.skip(); return; }`: the guard and its width. */
function viewportGuard(sf: SourceFile, call: CallExpression): { width: number; documented: boolean } | null {
  for (let n: Node | undefined = call.parent; n; n = n.parent) {
    if (ts.isIfStatement(n)) {
      const condition = n.expression.getText(sf);
      const m = /viewportSize\(\)[\s\S]*?<\s*([\d_]+)/.exec(condition);
      if (m === null) return null;
      const text = sf.getFullText();
      const inner = text.slice(n.getFullStart(), n.getEnd());
      const documented = (ts.getLeadingCommentRanges(text, n.getFullStart()) ?? []).length > 0 || /\/\/|\/\*/.test(inner);
      return { width: Number(m[1]!.replaceAll('_', '')), documented };
    }
    if (ts.isFunctionLike(n)) return null;
  }
  return null;
}

function importsOf(sf: SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    const from = s.moduleSpecifier.text;
    const clause = s.importClause;
    if (clause?.name) map.set(clause.name.text, from);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const e of clause.namedBindings.elements) map.set(e.name.text, from);
  }
  return map;
}
const fromBase = (spec: string) => /(^|\/)fixtures\/base(\.[cm]?[jt]s)?$/.test(spec);

function checkSpec(sf: SourceFile, gaps: string | null, corpus: Map<string, CorpusCase> | null, out: Finding[]): void {
  const file = sf.fileName;
  const add = (rule: string, node: Node, message: string) => out.push({ rule, file, line: lineOf(sf, node), message });
  const imports = importsOf(sf);
  // QA-BASE-IMPORT
  const testFrom = imports.get('test');
  if (testFrom === undefined || !fromBase(testFrom)) out.push({ rule: 'QA-BASE-IMPORT', file, line: 1, message: `imports test from ${testFrom ?? 'nowhere'}, not fixtures/base` });
  let usesExpect = false;
  each(sf, (n) => { if (ts.isIdentifier(n) && n.text === 'expect' && !ts.isImportSpecifier(n.parent)) usesExpect = true; });
  const expectFrom = imports.get('expect');
  if (usesExpect && (expectFrom === undefined || !fromBase(expectFrom))) out.push({ rule: 'QA-BASE-IMPORT', file, line: 1, message: `uses expect imported from ${expectFrom ?? 'nowhere'}, not fixtures/base` });
  const testName = 'test';
  const reads = new Map<Node, Set<string>>();
  each(sf, (n) => {
    // QA-NO-NEW-PAGE
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression)) {
      const from = imports.get(n.expression.text);
      if ((from !== undefined && /(^|\/)pages(\/|$)/.test(from)) || /Page$/.test(n.expression.text)) add('QA-NO-NEW-PAGE', n, `new ${n.expression.text}(...) in a spec; expose it as a fixture in fixtures/base.ts`);
    }
    if (ts.isVariableDeclaration(n) && n.initializer && awaitedRead(n.initializer) && ts.isIdentifier(n.name)) {
      let scope: Node = n;
      while (scope.parent && !ts.isFunctionLike(scope)) scope = scope.parent;
      const set = reads.get(scope) ?? new Set<string>();
      set.add(n.name.text); reads.set(scope, set);
    }
    if (!ts.isCallExpression(n)) return;
    const path = calleePath(n.expression);
    // QA-WEB-FIRST
    if ((path[0] === 'expect' && path.length === 1) || (path[0] === 'expect' && path[1] === 'soft' && path.length === 2)) {
      const arg = n.arguments[0];
      if (arg !== undefined) {
        let flagged = awaitedRead(arg);
        if (!flagged) {
          const ids = identifiers(arg);
          for (let scope: Node | undefined = n; scope; scope = scope.parent) {
            const set = reads.get(scope);
            if (set && [...set].some((v) => ids.has(v))) { flagged = true; break; }
          }
        }
        if (flagged) add('QA-WEB-FIRST', n, 'asserts a value already read from the page; assert on the locator so the assertion retries');
      }
    }
    // QA-TITLE-TAGS
    const d = declaration(n, testName);
    if (d !== null) {
      const tags = [...d.tags, ...describeTags(n, testName)];
      if (!CASE_ID.test(d.title)) add('QA-TITLE-TAGS', n, `title "${d.title}" does not start with its case ID`);
      if (!tags.includes('@regression')) add('QA-TITLE-TAGS', n, `"${d.title}" lacks @regression`);
      const priorities = [...new Set(tags.filter((t) => /^@p[1-4]$/.test(t)))];
      const priorityLike = [...new Set(tags.filter((t) => /^@p\d+$/.test(t)))];
      if (priorities.length !== 1 || priorityLike.length !== 1) add('QA-TITLE-TAGS', n, `"${d.title}" needs exactly one priority tag from @p1-@p4; has ${priorityLike.join(', ') || 'none'}`);
      else if (corpus !== null) {
        for (const id of caseIds(d.title)) {
          const c = corpus.get(id);
          if (c?.tag && `@${c.tag}` !== priorities[0]) add('QA-TITLE-TAGS', n, `"${d.title}" is tagged ${priorities[0]} but ${id}'s priority label maps to @${c.tag}${c.defaulted ? ' (defaulted: the priority was Undefined)' : ''}`);
        }
      }
    }
    // QA-SKIP-GAP, TL-MOBILE-GUARD, TL-KNOWN-FAILURE
    if (path[0] === testName && path.length === 2 && ['skip', 'fixme', 'fail'].includes(path[1]!) ) {
      const own = d !== null ? d : null;
      const enclosing = own ?? enclosingDeclaration(n, testName);
      const ids = enclosing !== null ? caseIds(enclosing.title) : enclosingDescribeCases(n, testName);
      const guard = own === null && path[1] === 'skip' ? viewportGuard(sf, n) : null;
      if (path[1] === 'fail' && own === null) {
        const reason = stringValue(n.arguments[1]);
        if (reason === null) add('QA-SKIP-GAP', n, 'test.fail() needs a reason string as its second argument');
      }
      if (guard !== null && guard.documented) {
        if (corpus !== null) for (const id of ids) {
          const c = corpus.get(id);
          const narrow = c?.widths.filter((w) => w < guard.width) ?? [];
          if (narrow.length) add('TL-MOBILE-GUARD', n, `${id} declares width ${narrow.join(', ')} but this guard skips below ${guard.width}; the case must declare that configuration not applicable`);
        }
      } else {
        const numbers = ids.map((id) => id.replace(/^C/, ''));
        const documented = gaps !== null && ids.length > 0 && numbers.some((x) => new RegExp(`(^|[^0-9])C?${x}([^0-9]|$)`).test(gaps));
        if (!documented) add('QA-SKIP-GAP', n, `test.${path[1]} ${ids.length ? `for ${ids.join(', ')} ` : ''}has no COVERAGE-GAPS.md entry${guard !== null ? ' (a viewport guard needs a comment naming its companion coverage)' : ''}`);
      }
      if (path[1] === 'fail' && corpus !== null) for (const id of ids) if (corpus.has(id)) add('TL-KNOWN-FAILURE', n, `${id} is a corpus case; a test.fail spec never counts toward ready`);
    }
  });
}

function checkCommon(sf: SourceFile, out: Finding[]): void {
  const file = sf.fileName;
  each(sf, (n) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && /\[class\*=/.test(n.text))
      out.push({ rule: 'QA-NO-PARTIAL-CLASS', file, line: lineOf(sf, n), message: 'partial class selector [class*=...]; pin the full class name or use a semantic locator' });
    if (!ts.isCallExpression(n)) return;
    const m = methodName(n);
    if (m === 'waitForTimeout' && !explained(sf, n)) out.push({ rule: 'QA-NO-WAIT-TIMEOUT', file, line: lineOf(sf, n), message: 'waitForTimeout without a comment explaining why no event-driven wait is possible' });
    if (m === 'waitForFunction' && n.arguments.length === 2) {
      const second = n.arguments[1]!;
      if (ts.isObjectLiteralExpression(second) && second.properties.length > 0 && second.properties.every((p) => p.name !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && ['timeout', 'polling'].includes(p.name.text)))
        out.push({ rule: 'QA-WAIT-FOR-FUNCTION-ARG', file, line: lineOf(sf, n), message: 'waitForFunction(fn, { timeout }) passes the options as the page argument; use waitForFunction(fn, null, { timeout })' });
    }
  });
}

function returnsLocator(sf: SourceFile, body: Node | undefined): boolean {
  if (body === undefined) return false;
  let found = false;
  each(body, (n) => {
    if (ts.isReturnStatement(n) && n.expression) {
      const text = n.expression.getText(sf);
      if (/\.(locator|getBy[A-Z]\w*|frameLocator)\(|\.(first|last|nth|filter)\(/.test(text)) found = true;
    }
  });
  return found;
}
function reassignedOutsideConstructor(sf: SourceFile, prop: import('typescript').PropertyDeclaration): boolean {
  const name = prop.name.getText(sf);
  const owner = prop.parent;
  let found = false;
  each(owner, (n) => {
    if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isPropertyAccessExpression(n.left) || n.left.expression.kind !== ts.SyntaxKind.ThisKeyword || n.left.name.getText(sf) !== name) return;
    for (let p: Node | undefined = n.parent; p && p !== owner; p = p.parent) if (ts.isConstructorDeclaration(p)) return;
    found = true;
  });
  return found;
}
function checkPage(sf: SourceFile, out: Finding[]): void {
  const file = sf.fileName;
  each(sf, (n) => {
    if (ts.isGetAccessorDeclaration(n) && n.parameters.length === 0) {
      const typed = n.type !== undefined && /\bLocator\b/.test(n.type.getText(sf));
      if (typed || returnsLocator(sf, n.body)) out.push({ rule: 'QA-READONLY-LOCATORS', file, line: lineOf(sf, n), message: `getter ${n.name.getText(sf)} returns a locator; make it a readonly property assigned in the constructor` });
    }
    if (ts.isPropertyDeclaration(n) && n.type !== undefined && /^Locator(\[\])?$/.test(n.type.getText(sf).trim())) {
      const modifiers = ts.getModifiers(n) ?? [];
      const readonly = modifiers.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);
      // A private or protected scope that a method reassigns (a mobile/desktop navigation scope) is
      // internal state, not one of the page object's exposed locators.
      const hidden = modifiers.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword) || ts.isPrivateIdentifier(n.name);
      if (!readonly && !(hidden && reassignedOutsideConstructor(sf, n))) out.push({ rule: 'QA-READONLY-LOCATORS', file, line: lineOf(sf, n), message: `locator property ${n.name.getText(sf)} is not readonly` });
    }
  });
}

const BASELINE: { path: string[]; value: string }[] = [
  { path: ['testDir'], value: "'./tests'" },
  { path: ['fullyParallel'], value: 'false' },
  { path: ['forbidOnly'], value: '!!process.env.CI' },
  { path: ['retries'], value: 'process.env.CI?2:0' },
  { path: ['workers'], value: '1' },
  { path: ['timeout'], value: '60000' },
  { path: ['expect', 'timeout'], value: '10000' },
  { path: ['use', 'trace'], value: "'on-first-retry'" },
  { path: ['use', 'screenshot'], value: "'only-on-failure'" },
  { path: ['use', 'video'], value: "'retain-on-failure'" },
  { path: ['use', 'actionTimeout'], value: '15000' },
  { path: ['use', 'navigationTimeout'], value: '30000' },
];
export const BROWSER_PROJECTS = ['desktop-chrome', 'desktop-safari', 'desktop-edge', 'mobile-iphone', 'mobile-android', 'desktop-firefox', 'tablet-ipad'] as const;
const canonicalValue = (text: string) => text.replace(/\s+/g, '').replaceAll('"', "'").replace(/(\d)_(?=\d)/g, '$1');

function configObject(sf: SourceFile): import('typescript').ObjectLiteralExpression | null {
  let found: import('typescript').ObjectLiteralExpression | null = null;
  each(sf, (n) => {
    if (found === null && ts.isCallExpression(n) && calleePath(n.expression).at(-1) === 'defineConfig' && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) found = n.arguments[0];
  });
  if (found === null) for (const s of sf.statements) if (ts.isExportAssignment(s) && ts.isObjectLiteralExpression(s.expression)) found = s.expression;
  return found;
}
function property(obj: import('typescript').ObjectLiteralExpression, name: string): import('typescript').PropertyAssignment | null {
  for (const p of obj.properties) if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) return p;
  return null;
}
function checkConfig(sf: SourceFile, out: Finding[]): void {
  const file = sf.fileName;
  const config = configObject(sf);
  if (config === null) { out.push({ rule: 'QA-CONFIG-BASELINE', file, line: 1, message: 'no defineConfig({...}) object literal to check' }); return; }
  const text = sf.getFullText();
  for (const b of BASELINE) {
    let obj: import('typescript').ObjectLiteralExpression | null = config;
    let p: import('typescript').PropertyAssignment | null = null;
    for (const [i, key] of b.path.entries()) {
      p = obj === null ? null : property(obj, key);
      if (p === null) break;
      if (i < b.path.length - 1) obj = ts.isObjectLiteralExpression(p.initializer) ? p.initializer : null;
    }
    const name = b.path.join('.');
    if (p === null) { out.push({ rule: 'QA-CONFIG-BASELINE', file, line: lineOf(sf, config), message: `${name} is missing (baseline ${b.value})` }); continue; }
    if (canonicalValue(p.initializer.getText(sf)) === canonicalValue(b.value)) continue;
    const commented = (ts.getLeadingCommentRanges(text, p.getFullStart()) ?? []).length > 0;
    if (!commented) out.push({ rule: 'QA-CONFIG-BASELINE', file, line: lineOf(sf, p), message: `${name} is ${p.initializer.getText(sf)}, baseline ${b.value}, with no comment explaining the deviation` });
  }
  const projects = property(config, 'projects');
  const names: string[] = [];
  if (projects !== null && ts.isArrayLiteralExpression(projects.initializer))
    for (const e of projects.initializer.elements) if (ts.isObjectLiteralExpression(e)) { const n = property(e, 'name'); const s = n === null ? null : stringValue(n.initializer); if (s !== null) names.push(s); }
  const missing = BROWSER_PROJECTS.filter((x) => !names.includes(x));
  if (missing.length) out.push({ rule: 'QA-BROWSER-PROJECTS', file, line: projects === null ? lineOf(sf, config) : lineOf(sf, projects), message: `missing browser projects: ${missing.join(', ')}` });
}

/** Check one suite folder (QA's automation/<account>/ layout). Never edits anything. */
export function checkSuite(input: { suiteRoot: string; standardText?: string | null; corpus?: CorpusCase[] | null; rules?: RuleSet }): CheckReport {
  const rules = input.rules ?? loadRules();
  const root = input.suiteRoot;
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`suite root ${root} is not a folder`);
  const findings: Finding[] = [];
  const corpus = input.corpus ? new Map(input.corpus.map((c) => [c.id, c])) : null;
  const gapsFile = join(root, 'COVERAGE-GAPS.md');
  const gaps = existsSync(gapsFile) ? readFileSync(gapsFile, 'utf8') : null;
  for (const [rel, label] of [['fixtures/base.ts', 'fixtures/base.ts'], ['pages/BasePage.ts', 'pages/BasePage.ts'], ['tests', 'tests/'], ['COVERAGE-GAPS.md', 'COVERAGE-GAPS.md']] as const)
    if (!existsSync(join(root, rel))) findings.push({ rule: 'QA-SUITE-LAYOUT', file: label, line: 0, message: `${label} is missing` });
  const source = /\.[cm]?[jt]sx?$/;
  const specs = files(root, 'tests', (f) => /\.spec\.[cm]?[jt]sx?$/.test(f));
  const pages = files(root, 'pages', (f) => source.test(f));
  const fixtures = files(root, 'fixtures', (f) => source.test(f));
  const configs = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].filter((f) => existsSync(join(root, f)));
  if (configs.length === 0) findings.push({ rule: 'QA-SUITE-LAYOUT', file: 'playwright.config.ts', line: 0, message: 'playwright.config.ts is missing' });
  for (const f of specs) { const sf = parse(root, f); checkSpec(sf, gaps, corpus, findings); checkCommon(sf, findings); }
  for (const f of pages) { const sf = parse(root, f); checkPage(sf, findings); checkCommon(sf, findings); }
  for (const f of fixtures) checkCommon(parse(root, f), findings);
  for (const f of configs) checkConfig(parse(root, f), findings);
  const known = new Set(rules.rules.map((r) => r.id));
  for (const f of findings) if (!known.has(f.rule)) throw new Error(`checker produced finding for unknown rule ${f.rule}`);
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return {
    schema: 1, advisory: true, suiteRoot: root,
    standard: standardDrift(rules, input.standardText ?? null),
    files: { spec: specs.length, page: pages.length, fixture: fixtures.length, config: configs.length },
    findings,
    notChecked: [
      ...(corpus === null ? ['TL-MOBILE-GUARD, TL-KNOWN-FAILURE and the priority-label comparison in QA-TITLE-TAGS need a corpus (--corpus)'] : []),
      'TL-RETRIES-ZERO and TL-UNDEFINED-PRIORITY are enforced by the run plan and the verdict, not by check',
    ],
  };
}

export function renderCheck(report: CheckReport): string {
  const lines = [`test-lab check (advisory) · ${report.suiteRoot}`, `standard ported from ${report.standard.portedFrom}: ${report.standard.status}`];
  if (report.standard.warning) lines.push(`WARNING: ${report.standard.warning}`);
  lines.push(`files: ${report.files.spec} specs, ${report.files.page} page objects, ${report.files.fixture} fixtures, ${report.files.config} configs`);
  lines.push(report.findings.length === 0 ? 'no findings' : `${report.findings.length} finding${report.findings.length === 1 ? '' : 's'}:`);
  for (const f of report.findings) lines.push(`  ${f.rule} ${f.file}:${f.line} ${f.message}`);
  for (const n of report.notChecked) lines.push(`not checked: ${n}`);
  return `${lines.join('\n')}\n`;
}
