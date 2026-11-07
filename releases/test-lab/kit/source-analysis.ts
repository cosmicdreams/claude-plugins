// Static scan of one spec, support or config file with the TypeScript parser (it reads JavaScript too).
// It finds what the file loads and reads, so the behavior digest covers it, and flags what it can't
// follow, so the affected tests stay unverified instead of the digest silently shrinking (plan §4).

import { dirname, isAbsolute, join, resolve } from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

export type FsRead = { call: string; path: string | null; line: number };

export type EnvironmentRead = { name: string | null; line: number; access?: 'write' };

export type FileScan = {
  /** Runtime module specifiers loaded with a literal: imports, re-exports, require() and import(). */
  imports: string[];
  /** Explicitly erased TypeScript dependencies, never traversed as runtime loads. */
  typeImports: string[];
  /** Environment data used by this source. Values are never read or persisted by the scanner. */
  environmentReads: EnvironmentRead[];
  /** Syntax or escaping bindings whose runtime inputs cannot be established. */
  problems: string[];
  /** Lines with an import() or require() of a computed path. */
  computedImports: number[];
  /** Filesystem reads, with the path when it can be resolved statically. */
  reads: FsRead[];
  /** A `*.use({ storageState })` call: a role set below the project, which caseStep can't observe. */
  setsStorageState: boolean;
  /** The config sets `snapshotPathTemplate`, so baselines can't be found by convention. */
  setsSnapshotTemplate: boolean;
};

const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const READS = new Set([
  'readFileSync',
  'readFile',
  'createReadStream',
  'readdirSync',
  'readdir',
  'opendir',
  'opendirSync',
  'existsSync',
  'statSync',
  'stat',
  'lstatSync',
  'lstat',
  'access',
  'accessSync',
  'readlinkSync',
  'readlink',
  'glob',
  'globSync',
]);

function kindOf(file: string): ts.ScriptKind {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.(ts|mts|cts)$/.test(file)) return ts.ScriptKind.TS;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.json$/.test(file)) return ts.ScriptKind.JSON;
  return ts.ScriptKind.JS;
}

function literal(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** A path expression made only of literals, __dirname, import.meta.dirname and path.join/resolve. */
function staticPath(node: ts.Expression, file: string, cwd: string, pathFunction: (node: ts.Expression) => 'join' | 'resolve' | null, unbound: (node: ts.Identifier) => boolean): string | null {
  const text = literal(node);
  if (text !== null) return isAbsolute(text) ? text : resolve(cwd, text);
  if (ts.isIdentifier(node) && (node.text === '__dirname' || node.text === '__filename') && unbound(node))
    return node.text === '__dirname' ? dirname(file) : file;
  if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && (node.name.text === 'dirname' || node.name.text === 'filename'))
    return node.name.text === 'dirname' ? dirname(file) : file;
  if (ts.isCallExpression(node)) {
    const fn = pathFunction(node.expression);
    if ((fn === 'join' || fn === 'resolve') && node.arguments.length > 0) {
      const parts: string[] = [];
      for (const [i, arg] of node.arguments.entries()) {
        const part = i === 0 ? staticPath(arg, file, cwd, pathFunction, unbound) : literal(arg);
        if (part === null) return null;
        parts.push(part);
      }
      return (fn === 'join' ? join : resolve)(...(parts as [string, ...string[]]));
    }
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && unbound(node.expression)) {
    const [first, second] = node.arguments ?? [];
    const rel = literal(first);
    if (rel !== null && second !== undefined && ts.isPropertyAccessExpression(second) && ts.isMetaProperty(second.expression) && second.expression.keywordToken === ts.SyntaxKind.ImportKeyword && second.name.text === 'url') {
      try { return fileURLToPath(new URL(rel, pathToFileURL(file))); } catch { return null; }
    }
  }
  return null;
}

/**
 * Capability-use boundary. Every reference to a known loader, filesystem reader or test API must be
 * consumed by an explicitly supported operation. Direct symbol aliases are followed to a fixed point;
 * object/array/conditional/logical/returned/argument/export flows are refused at their source reference.
 * Refusal does not depend on finding a later call, a method spelling, or a literal import string.
 * The same analysis feeds digest closure, pre-load exclusions and persisted reporter option safety.
 */
export { ANALYSIS_VERSION } from './records.ts';
export const PARSER_VERSION = '6.0.3'; // Pinned directly in kit/package.json and its lockfile.

export function scanFile(file: string, text: string, cwd: string): FileScan {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kindOf(file));
  const host = ts.createCompilerHost({ noResolve: true, noLib: true, allowJs: true });
  host.getSourceFile = (name) => name === file ? source : undefined;
  const program = ts.createProgram([file], { noResolve: true, noLib: true, allowJs: true }, host);
  const checker = program.getTypeChecker();
  const scan: FileScan = { imports: [], typeImports: [], environmentReads: [], problems: [], computedImports: [], reads: [], setsStorageState: false, setsSnapshotTemplate: false };
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const issue = (node: ts.Node, why: string) => scan.problems.push(`${lineOf(node)}: ${why}`);
  if (ts.version !== PARSER_VERSION) scan.problems.push(`unsupported source parser ${ts.version}; expected ${PARSER_VERSION}`);
  const diagnostics = program.getSyntacticDiagnostics(source);
  for (const d of diagnostics) scan.problems.push(`source parse error: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  type Capability = 'fs' | 'reader' | 'writer' | 'util' | 'promisify' | 'module' | 'createRequire' | 'loader' | 'playwright' | 'test' | 'describe' | 'testCall' | 'use' | 'unsafeOption' | 'ambient' | 'path' | 'pathJoin' | 'pathResolve' | 'pathCall' | 'process' | 'environment' | 'reflection' | 'object' | 'dataCall' | 'acquisition';
  const aliases = new Map<ts.Symbol, Capability>();
  const symbol = (node: ts.Node) => checker.getSymbolAtLocation(node);
  const bind = (node: ts.Identifier, cap: Capability) => {
    const s = symbol(node);
    if (s === undefined) { issue(node, 'unresolvable capability binding'); return; }
    const old = aliases.get(s);
    if (old !== undefined && old !== cap) issue(node, 'ambiguous capability alias assignment');
    aliases.set(s, cap);
  };
  const transparent = (node: ts.Node): node is ts.ParenthesizedExpression | ts.AsExpression | ts.TypeAssertion | ts.NonNullExpression | ts.AwaitExpression | ts.SatisfiesExpression =>
    ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node) || ts.isSatisfiesExpression(node);
  const unwrap = (node: ts.Expression): ts.Expression => transparent(node) ? unwrap(node.expression) : node;
  const member = (node: ts.Expression): { root: ts.Expression; name: string | null; direct: boolean } | null => {
    if (ts.isPropertyAccessExpression(node)) return { root: node.expression, name: node.name.text, direct: true };
    if (ts.isElementAccessExpression(node)) return { root: node.expression, name: literal(node.argumentExpression), direct: false };
    return null;
  };
  // Only these non-read filesystem members have no implicit assertion inputs. File-descriptor readers,
  // watchers, handles, syncBuiltinESMExports and unknown members remain unsupported, even when named.
  const writes = new Set(['appendFile', 'appendFileSync', 'writeFile', 'writeFileSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync', 'rename', 'renameSync', 'symlink', 'symlinkSync', 'chmod', 'chmodSync', 'chown', 'chownSync', 'close', 'closeSync']);
  const testCalls = new Set(['info', 'step', 'beforeAll', 'afterAll', 'beforeEach', 'afterEach', 'skip', 'fixme', 'fail', 'slow', 'setTimeout']);
  // Acquisition is a source capability, not a list of dangerous call spellings. Only modeled Node
  // namespaces and these passive utility modules enter the boundary. Other built-ins can execute
  // source, spawn code or obtain untracked I/O (vm, workers, inspector, child_process, wasi, sqlite,
  // etc.); importing them is unsupported even if their exports are renamed or destructured later.
  const builtins = new Set(builtinModules.map(s => s.replace(/^node:/, '')));
  const passiveBuiltins = new Set(['assert', 'assert/strict', 'buffer', 'console', 'constants', 'crypto', 'diagnostics_channel', 'events', 'os', 'perf_hooks', 'querystring', 'string_decoder', 'stream', 'stream/promises', 'stream/consumers', 'stream/web', 'timers', 'timers/promises', 'url', 'util/types']);
  const moduleCap = (spec: string): Capability | null => {
    const name = spec.replace(/^node:/, '');
    if (['path', 'path/posix', 'path/win32'].includes(name)) return 'path';
    if (FS_MODULES.has(spec)) return 'fs';
    if (name === 'process') return 'process';
    if (name === 'util') return 'util';
    if (name === 'module') return 'module';
    if (['@playwright/test', 'playwright/test'].includes(spec)) return 'playwright';
    return builtins.has(name) && !passiveBuiltins.has(name) ? 'acquisition' : null;
  };
  // These members expose data, not executable capabilities. Data may be aliased/destructured; a
  // process namespace itself still has to obey the same reference-consumption rules as fs/test.
  const processData = new Set(['env', 'platform', 'arch', 'version', 'versions', 'pid', 'ppid', 'execPath', 'argv', 'execArgv', 'exitCode', 'title', 'release', 'features', 'debugPort']);
  const dataMember = (root: Capability, name: string | null): boolean =>
    root === 'environment' || root === 'process' && processData.has(name ?? '') || root === 'path' && ['sep', 'delimiter'].includes(name ?? '') || root === 'module' && name === 'exports' || root === 'playwright' && ['expect', 'defineConfig', 'devices'].includes(name ?? '');
  const objectCalls = new Set(['keys', 'values', 'entries', 'fromEntries', 'is', 'hasOwn', 'assign', 'freeze', 'seal', 'preventExtensions', 'isFrozen', 'isSealed', 'isExtensible']);
  const memberCap = (root: Capability, name: string | null, direct: boolean): Capability | null => {
    if (root === 'environment') return null;
    if (root === 'process') return name === 'env' ? 'environment' : name === 'default' ? 'process' : dataMember(root, name) ? null : 'acquisition';
    if (root === 'reflection' || root === 'acquisition') return 'acquisition';
    if (root === 'object') return objectCalls.has(name ?? '') ? 'dataCall' : 'acquisition';
    if (root === 'path') return name === 'join' ? 'pathJoin' : name === 'resolve' ? 'pathResolve' : ['dirname', 'basename', 'extname', 'normalize', 'isAbsolute', 'relative', 'format', 'parse', 'matchesGlob', 'toNamespacedPath'].includes(name ?? '') ? 'pathCall' : null;
    if (root === 'fs') return name === 'promises' || name === 'default' ? 'fs' : name !== null && READS.has(name) ? 'reader' : name !== null && writes.has(name) ? 'writer' : null;
    if (root === 'util') return name === 'promisify' ? 'promisify' : null;
    if (root === 'module') return name === 'createRequire' ? 'createRequire' : null;
    if (root === 'playwright') return name === 'test' ? 'test' : null;
    if (root === 'test' || root === 'describe') {
      if (!direct) return null;
      if (name === 'use') return 'use';
      if (name === 'extend' || name === 'configure') return 'unsafeOption';
      if (name === 'describe') return 'describe';
      if (name === 'only' || name === 'serial' || name === 'parallel') return root;
      if (name !== null && testCalls.has(name)) return 'testCall';
    }
    if (root === 'testCall' && name === 'skip' && direct) return 'testCall';
    return null;
  };
  const capOf = (node: ts.Expression): Capability | null => {
    node = unwrap(node);
    if (ts.isIdentifier(node)) {
      const s = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : symbol(node), bound = s === undefined ? undefined : aliases.get(s);
      if (bound !== undefined) return bound;
      if (node.text === 'require' && (s === undefined || s.declarations === undefined)) return 'loader';
      // Conservative fallback for plain/fixture-imported APIs. Symbol-bound aliases still take priority.
      if (node.text === 'test') return 'test';
      if (node.text === 'module') return 'module';
      if (['globalThis', 'global'].includes(node.text)) return 'ambient';
      if (s?.declarations === undefined) {
        if (node.text === 'process') return 'process';
        if (node.text === 'Reflect') return 'reflection';
        if (node.text === 'Object') return 'object';
        if (['eval', 'Function', 'WebAssembly', 'Worker'].includes(node.text)) return 'acquisition';
      }
      return null;
    }
    const m = member(node);
    if (m !== null) {
      const root = capOf(m.root);
      return root === null ? null : memberCap(root, m.name, m.direct);
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || capOf(node.expression) === 'loader') {
        const spec = literal(node.arguments[0]); return spec === null ? null : moduleCap(spec);
      }
      if (capOf(node.expression) === 'createRequire') return 'loader';
      if (capOf(node.expression) === 'promisify' && node.arguments.length === 1 && capOf(node.arguments[0]!) === 'reader') return 'reader';
    }
    return null;
  };
  // Playwright's public TypeScript transform erases explicit type declarations/specifiers.
  // Empty named imports/exports and any real value specifier still represent runtime dependencies.
  const erasedModule = (node: ts.Node): boolean => {
    if (ts.isImportDeclaration(node)) {
      const c = node.importClause;
      return c?.isTypeOnly === true || c !== undefined && c.name === undefined && c.namedBindings !== undefined && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every(el => el.isTypeOnly);
    }
    if (ts.isExportDeclaration(node)) return node.isTypeOnly || node.exportClause !== undefined && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(el => el.isTypeOnly);
    return ts.isImportEqualsDeclaration(node) && node.isTypeOnly;
  };
  const nodes: ts.Node[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
    nodes.push(node);
    if (erasedModule(node) || (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) && node.isTypeOnly) return;
    ts.forEachChild(node, collect);
  }; collect(source);
  const environmentRead = (node: ts.Node, name: string | null) => scan.environmentReads.push({ name, line: lineOf(node) });
  const bindPattern = (name: ts.BindingName, cap: Capability) => {
    if (ts.isIdentifier(name)) { bind(name, cap); return; }
    if (cap === 'environment') {
      if (!ts.isObjectBindingPattern(name)) { environmentRead(name, null); return; }
      for (const el of name.elements) {
        const n = el.propertyName ?? el.name;
        environmentRead(el, el.dotDotDotToken === undefined && (ts.isIdentifier(n) || ts.isStringLiteral(n)) ? n.text : null);
      }
      return;
    }
    if (!ts.isObjectBindingPattern(name)) { issue(name, 'unsupported capability binding pattern'); return; }
    for (const el of name.elements) {
      const n = el.propertyName ?? el.name;
      if (cap === 'process' && (ts.isIdentifier(n) || ts.isStringLiteral(n)) && n.text === 'env') { bindPattern(el.name, 'environment'); continue; }
      if (el.dotDotDotToken !== undefined || el.initializer !== undefined || !ts.isIdentifier(el.name) || !(ts.isIdentifier(n) || ts.isStringLiteral(n))) { issue(el, 'unsupported capability destructuring'); continue; }
      const value = memberCap(cap, n.text, true);
      if (value === null && dataMember(cap, n.text)) continue;
      if (value === null || cap === 'test' || cap === 'describe') issue(el, 'unsupported capability member binding');
      else bind(el.name, value);
    }
  };
  for (const node of nodes) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      const spec = literal(node.moduleSpecifier);
      if (spec === null) { issue(node, 'unsupported module specifier'); continue; }
      if (erasedModule(node)) { scan.typeImports.push(spec); continue; }
      scan.imports.push(spec);
      const cap = moduleCap(spec);
      if (cap === 'acquisition') issue(node, `unmodeled builtin capability acquisition from ${spec}; use tracked static imports/readers and direct public test APIs`);
      if (ts.isExportDeclaration(node)) { if (cap !== null) issue(node, 'capability re-export cannot be followed across source boundaries'); continue; }
      const clause = node.importClause;
      if (clause === undefined || clause.isTypeOnly) continue;
      if (clause.name !== undefined && cap !== null) bind(clause.name, cap);
      const b = clause.namedBindings;
      if (b !== undefined && ts.isNamespaceImport(b) && cap !== null) bind(b.name, cap);
      if (b !== undefined && ts.isNamedImports(b)) for (const el of b.elements) {
        if (el.isTypeOnly) continue;
        const n = (el.propertyName ?? el.name).text;
        if (cap === null) { if (n === 'test') bind(el.name, 'test'); continue; }
        const value = memberCap(cap, n, true);
        if (value !== null) { bind(el.name, value); if (value === 'acquisition') issue(el, `unsupported ${cap} capability acquisition; use ordinary process data or tracked static imports/readers`); }
        else if (cap !== null && dataMember(cap, n)) continue;
        else if (cap === 'fs' || cap === 'module' || cap === 'path' && !['sep', 'delimiter'].includes(n)) issue(el, `unsupported ${cap} named member ${n}`);
      }
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const spec = literal(node.moduleReference.expression);
      if (node.isTypeOnly) { if (spec !== null) scan.typeImports.push(spec); continue; }
      if (spec === null) scan.computedImports.push(lineOf(node));
      else { scan.imports.push(spec); const cap = moduleCap(spec); if (cap !== null) bind(node.name, cap); }
    }
  }
  // Fixed-point symbol propagation handles declarations and assignments, including forward references.
  for (let pass = 0; pass <= nodes.length; pass++) {
    const before = new Map(aliases);
    for (const node of nodes) {
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        const cap = capOf(node.initializer); if (cap !== null) bindPattern(node.name, cap);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
        const cap = capOf(node.right); if (cap !== null) bind(node.left, cap);
      }
    }
    if (aliases.size === before.size && [...aliases].every(([s, cap]) => before.get(s) === cap)) break;
  }
  const widths = new Set<ts.Symbol>();
  for (const node of nodes) if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer) && (node.initializer.flags & ts.NodeFlags.Const) !== 0 && node.initializer.declarations.length === 1 && ts.isArrayLiteralExpression(node.expression) && node.expression.elements.length > 0 && node.expression.elements.every(n => ts.isNumericLiteral(n) && Number(n.text) > 0)) {
    const name = node.initializer.declarations[0]!.name;
    if (ts.isIdentifier(name)) { const s = symbol(name); if (s !== undefined) widths.add(s); }
  }
  const keyOf = (name: ts.PropertyName): string | null => ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
  const viewportOnly = (call: ts.CallExpression): boolean => {
    const arg = call.arguments[0];
    if (call.arguments.length !== 1 || arg === undefined || !ts.isObjectLiteralExpression(arg) || arg.properties.length !== 1) return false;
    const p = arg.properties[0]!;
    if (!ts.isPropertyAssignment(p) || keyOf(p.name) !== 'viewport' || !ts.isObjectLiteralExpression(p.initializer) || p.initializer.properties.length !== 2) return false;
    const seen = new Set<string>();
    for (const size of p.initializer.properties) {
      if (!ts.isPropertyAssignment(size) && !ts.isShorthandPropertyAssignment(size)) return false;
      const key = keyOf(size.name); if (key === null || !['width', 'height'].includes(key) || seen.has(key)) return false; seen.add(key);
      const value = ts.isPropertyAssignment(size) ? size.initializer : size.name;
      if (ts.isNumericLiteral(value) && Number(value.text) > 0) continue;
      const s = ts.isIdentifier(value) ? (ts.isShorthandPropertyAssignment(size) ? checker.getShorthandAssignmentValueSymbol(size) : symbol(value)) : undefined;
      if (key !== 'width' || s === undefined || !widths.has(s)) return false;
    }
    return true;
  };
  const isDeclarationName = (node: ts.Expression): boolean => {
    const p = node.parent;
    return (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isImportEqualsDeclaration(p) || ts.isNamespaceImport(p) || ts.isImportClause(p)) && p.name === node || ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isPropertyAccessExpression(p) && p.name === node || ts.isPropertyAssignment(p) && p.name === node;
  };
  const accounted = (node: ts.Expression, cap: Capability): boolean => {
    const p = node.parent;
    // Environment data remains ordinary executable data. Certification is refused separately by
    // the digest's input analysis; it is not a scoped-option/acquisition refusal.
    if (cap === 'environment') return true;
    if (transparent(p) && p.expression === node) return true;
    if (isDeclarationName(node)) return true;
    if (ts.isTypeOfExpression(p)) return true;
    if (ts.isCallExpression(p) && p.expression === node) return ['loader', 'reader', 'writer', 'createRequire', 'promisify', 'test', 'describe', 'testCall', 'use', 'unsafeOption', 'pathJoin', 'pathResolve', 'pathCall', 'dataCall'].includes(cap);
    if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === node) {
      const m = member(p)!; return capOf(p) !== null || dataMember(cap, m.name);
    }
    if (ts.isVariableDeclaration(p) && p.initializer === node) return (ts.isIdentifier(p.name) || ts.isObjectBindingPattern(p.name)) && !['use', 'unsafeOption', 'testCall', 'describe'].includes(cap);
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(p.left)) return p.left === node || p.right === node && !['use', 'unsafeOption', 'testCall', 'describe'].includes(cap);
    if (ts.isCallExpression(p) && cap === 'reader' && capOf(p.expression) === 'promisify' && p.arguments.length === 1) return true;
    return false;
  };
  for (const node of nodes) {
    if (ts.isCallExpression(node)) {
      const cap = capOf(node.expression);
      if (cap === 'loader' || node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = literal(node.arguments[0]);
        if (spec !== null && node.arguments.length === 1) scan.imports.push(spec);
        else { scan.computedImports.push(lineOf(node)); issue(node, 'computed or unsupported module load'); }
      }
      if (cap === 'createRequire') {
        const arg = node.arguments[0];
        const knownOrigin = arg !== undefined && (ts.isPropertyAccessExpression(arg) && ts.isMetaProperty(arg.expression) && arg.expression.keywordToken === ts.SyntaxKind.ImportKeyword && arg.name.text === 'url' || ts.isIdentifier(arg) && arg.text === '__filename' && symbol(arg)?.declarations === undefined);
        if (node.arguments.length !== 1 || !knownOrigin) issue(node, 'createRequire origin cannot establish module resolution');
      }
      if (cap === 'reader') { const arg = node.arguments[0]; scan.reads.push({ call: member(node.expression)?.name ?? node.expression.getText(source), path: arg === undefined ? null : staticPath(arg, file, cwd, node => capOf(node) === 'pathJoin' ? 'join' : capOf(node) === 'pathResolve' ? 'resolve' : null, node => symbol(node)?.declarations === undefined), line: lineOf(node) }); }
      const m = member(node.expression);
      // Unknown/custom APIs named use/extend/configure are conservative too. Config object properties
      // are data, and project.use read via test.info() is data; neither is a configurator call.
      if (cap === 'unsafeOption' || cap === 'use' || m !== null && ['use', 'extend', 'configure'].includes(m.name ?? '')) {
        if (cap !== 'use' || m?.direct !== true || !viewportOnly(node)) issue(node, 'unobservable scoped options: only direct declared viewport matrices are supported');
        const arg = node.arguments[0]; if (arg !== undefined && ts.isObjectLiteralExpression(arg) && arg.properties.some(p => p.name !== undefined && keyOf(p.name) === 'storageState')) scan.setsStorageState = true;
      }
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      const s = checker.getShorthandAssignmentValueSymbol(node);
      if (capOf(node.name) !== 'environment' && (s !== undefined && aliases.has(s) || capOf(node.name) !== null)) issue(node, 'capability shorthand escapes the analyzed aliases');
    }
    // Constructor/prototype descriptors and computed property acquisition are reflective routes even
    // when the receiver isn't already a tracked capability. No later invocation has to be recognized.
    if (ts.isBindingElement(node) && node.propertyName !== undefined && (keyOf(node.propertyName) === 'constructor' || ts.isComputedPropertyName(node.propertyName))) issue(node, 'reflective destructuring acquisition is outside capability analysis; use static data keys/direct APIs');
    if (ts.isExpression(node)) {
      if (isDeclarationName(node)) continue;
      if (ts.isIdentifier(node) && ['eval', 'Function'].includes(node.text)) issue(node, 'dynamic executable source is outside capability analysis');
      const ambient = member(node);
      if (ambient !== null && ts.isIdentifier(ambient.root)) {
        if (['globalThis', 'global'].includes(ambient.root.text) && (!ambient.direct || ['require', 'module'].includes(ambient.name ?? '')) || ambient.root.text === 'process' && ['getBuiltinModule', 'mainModule'].includes(ambient.name ?? ''))
          issue(node, 'ambient or reflective loader access is outside capability analysis');
      }
      const cap = capOf(node);
      if (cap === 'acquisition') issue(node, 'unsupported executable or builtin capability acquisition; use tracked static imports/readers and direct public test APIs');
      if (cap === 'ambient') issue(node, 'ambient global capabilities cannot be accounted for');
      if (ambient?.name === 'constructor') issue(node, 'reflective executable constructor is outside capability analysis');
      if (ts.isElementAccessExpression(node) && capOf(node.expression) !== 'environment' && literal(node.argumentExpression) === null && !ts.isNumericLiteral(node.argumentExpression)) issue(node, 'computed property acquisition is outside capability analysis; use static data keys/direct APIs');
      if (cap !== null && !accounted(node, cap)) issue(node, `unsupported ${cap} capability flow; inputs/options cannot be established`);
      const m = member(node);
      if (m !== null && capOf(m.root) === 'environment') {
        const p = node.parent;
        const writes = ts.isBinaryExpression(p) && p.left === node && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment || (ts.isDeleteExpression(p) || (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) && (ts.isDeleteExpression(p) ? p.expression === node : p.operand === node);
        scan.environmentReads.push({name:m.name,line:lineOf(node),...(writes ? {access:'write' as const} : {})});
      }
      if (cap === 'environment') {
        const p = node.parent;
        const follows = transparent(p) ||
          (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === node ||
          ts.isVariableDeclaration(p) && p.initializer === node ||
          ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(p.left);
        if (!follows) environmentRead(node, null);
      }
      if (m !== null && capOf(m.root) !== null && cap === null) {
        const root = capOf(m.root);
        if (root !== null && !dataMember(root, m.name)) issue(node, 'computed or unsupported capability member');
      }
    }
    if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) for (const d of node.declarationList.declarations) {
      if (d.initializer !== undefined && capOf(d.initializer) === 'environment') environmentRead(d, null);
      else if (d.initializer !== undefined && capOf(d.initializer) !== null) issue(d, 'exported capability binding is unresolved');
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.exportClause !== undefined && ts.isNamedExports(node.exportClause)) for (const el of node.exportClause.elements) {
      if (el.isTypeOnly) continue;
      const s = checker.getExportSpecifierLocalTargetSymbol(el);
      if (s !== undefined && aliases.get(s) === 'environment') environmentRead(el, null);
      else if (s !== undefined && aliases.has(s) || ['require', 'test', 'module'].includes((el.propertyName ?? el.name).text)) issue(el, 'capability alias re-export is unresolved');
    }
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && keyOf(node.name) === 'snapshotPathTemplate') scan.setsSnapshotTemplate = true;
  }
  scan.imports = [...new Set(scan.imports)];
  scan.typeImports = [...new Set(scan.typeImports)];
  scan.environmentReads = [...new Map(scan.environmentReads.map(r => [JSON.stringify(r), r])).values()];
  scan.problems = [...new Set(scan.problems)];
  return scan;
}
