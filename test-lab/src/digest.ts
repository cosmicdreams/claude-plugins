// Evidence binds to inputs only (plan §4): a behavior digest per test, a toolchain digest per suite and an
// effective-configuration record per run, computed from an explicit input manifest that never holds an
// output. Anything the scan can't resolve leaves the affected tests unresolved, and so unverified: the
// digest never shrinks to what it could see.
//
// The resolved configuration comes from Playwright itself: the step reporter's begin record, written by a
// `playwright test --list` invocation (src/run-plan.ts), carries every project's resolved `use` (secrets
// replaced by their presence), its dependencies, and every test with its file.

import { canonicalDeclarations, declarationProblems, observationProblems, validObservation, type EnvironmentBinding, type EnvironmentInputDeclaration } from '../kit/environment-inputs.ts';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { ANALYSIS_VERSION, KIT_VERSION, type BeginRecord, type ProjectRecord } from '../kit/records.ts';
import { hashOf, sha256 } from './canonical.ts';
import { matchesGlob } from './glob.ts';
import { scanFile, type FileScan } from './imports.ts';
import {
  testKey,
  type CaseRecord,
  type DeclaredInput,
  type MaterialConfig,
  type Mapping,
  type TestIdentity,
} from './model.ts';
import { isOutput } from './outputs.ts';
import { canonicalCaseHash } from './cases.ts';

export const RULES_VERSION = 'none';
export const RECIPE_FORMAT_VERSION = 1;

/** `use` keys that identify the environment or the artifacts, not what a test asserts. */
const NOT_BEHAVIOR = new Set(['baseURL', 'headless', 'channel', 'trace', 'video', 'screenshot']);
const ARTIFACT_USE = ['trace', 'video', 'screenshot'];
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

export type InputEntry = { path: string; hash: string };

export type BehaviorDigest =
  | { status: 'resolved'; test: TestIdentity; project: string; digest: string; inputs: InputEntry[]; environmentInputs?: { declarations: EnvironmentInputDeclaration[]; bindings: EnvironmentBinding[] } }
  | { status: 'unresolved'; test: TestIdentity; project: string; reasons: string[] };

export type ToolchainDigest = { status: 'resolved'; digest: string; inputs: InputEntry[] } | { status: 'unresolved'; reasons: string[] };

export type RecipeRef = { hash: string; test: TestIdentity };

export type DigestContext = {
  suite: string;
  /** The folder holding the config: paths in the manifest are relative to it. */
  suiteRoot: string;
  begin: BeginRecord;
  cases: Map<string, CaseRecord>;
  ledger: Mapping[];
  recipes: RecipeRef[];
  declaredInputs: DeclaredInput[];
  declaredEnvironmentInputs?: EnvironmentInputDeclaration[];
  declaredBaselines: string[];
  /** Where the kit was copied in the suite. */
  kitDir: string;
};

type Closure = { files: Map<string, string>; reasons: string[]; scans: Map<string, FileScan>; environment: Map<string, EnvironmentBinding> };

const rel = (root: string, abs: string) => relative(root, abs).split(sep).join('/');

function resolveRelative(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  const candidates = [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => join(base, `index${e}`))];
  // TypeScript ESM style: './helper.js' written for './helper.ts'.
  const js = /\.(m|c)?jsx?$/.exec(spec);
  if (js !== null) {
    const stem = base.slice(0, -js[0].length);
    candidates.push(...['.ts', '.tsx', '.mts', '.cts'].map((e) => stem + e));
  }
  return candidates.find((c) => lstatSync(c, { throwIfNoEntry: false })?.isFile() === true) ?? null;
}

function packageInstalled(from: string, spec: string): boolean {
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] ?? spec);
  if (name.startsWith('node:')) return true;
  for (let dir = dirname(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules', name))) return true;
    if (dirname(dir) === dir) return false;
  }
}

const BUILTINS = new Set(['fs', 'path', 'os', 'url', 'util', 'crypto', 'child_process', 'http', 'https', 'net', 'stream', 'events', 'assert', 'buffer', 'zlib', 'fs/promises', 'readline', 'process', 'timers', 'worker_threads']);

function walkFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, out);
    else if (entry.isFile()) out.push(abs);
  }
}

/** Files matching a glob relative to the suite root (which may climb with `../`). */
export function expandGlob(root: string, glob: string): string[] {
  const parts = glob.split('/');
  const fixed: string[] = [];
  for (const p of parts) {
    if (/[*?{]/.test(p)) break;
    fixed.push(p);
  }
  const base = resolve(root, ...fixed);
  if (fixed.length === parts.length) return lstatSync(base, { throwIfNoEntry: false })?.isFile() === true ? [base] : [];
  const rest = parts.slice(fixed.length).join('/');
  const found: string[] = [];
  walkFiles(base, found);
  return found.filter((f) => matchesGlob(rel(base, f), rest)).sort();
}

class Scanner {
  private readonly scans = new Map<string, FileScan>();
  private readonly ctx: DigestContext;
  readonly excluded: Set<string>;
  constructor(ctx: DigestContext, excluded: Set<string>) {
    this.ctx = ctx;
    this.excluded = excluded;
  }

  scan(file: string): FileScan {
    let s = this.scans.get(file);
    if (s === undefined) {
      s = scanFile(file, readFileSync(file, 'utf8'), this.ctx.suiteRoot);
      this.scans.set(file, s);
    }
    return s;
  }

  /** The import closure of `entry`, with declared external inputs, as suite-relative paths and hashes. */
  closure(entries: string[]): Closure {
    const files = new Map<string, string>();
    const reasons: string[] = [];
    const scans = new Map<string, FileScan>();
    const environment = new Map<string, EnvironmentBinding>();
    const declarations = this.ctx.declaredEnvironmentInputs ?? [];
    const observation = this.ctx.begin.environmentInputs;
    const valid = declarationProblems(declarations).length === 0 && validObservation(observation) && observationProblems(observation).length === 0 && JSON.stringify(canonicalDeclarations(declarations)) === JSON.stringify(canonicalDeclarations(observation.declarations));
    const stack = [...entries];
    const root = this.ctx.suiteRoot;
    while (stack.length > 0) {
      const abs = realpathSync(stack.pop() as string);
      const path = rel(root, abs);
      if (files.has(path)) continue;
      if (isOutput(path)) {
        this.excluded.add(path);
        continue;
      }
      files.set(path, sha256(readFileSync(abs)));
      if (!/\.(m|c)?[jt]sx?$/.test(abs)) continue;
      const scan = this.scan(abs);
      scans.set(path, scan);
      reasons.push(...scan.problems.map((p) => `${path}:${p}`));
      // Exact source scope and actual finalized invocation observations are both required. Neither
      // a declaration nor the parent environment grants an exemption to unsupported analysis.
      for (const read of scan.environmentReads) {
        const d = declarations.find(d => d.name === read.name && d.readers.includes(path));
        const binding = valid ? observation!.bindings.find(b => b.name === read.name) : undefined;
        if (read.access === 'write' || read.name === null || d === undefined || binding === undefined) reasons.push(`${path}:${read.line} environment input ${read.name ?? '<dynamic or whole environment>'} has no supported invocation-value binding; environment-dependent behavior cannot be certified`);
        else environment.set(JSON.stringify([path,d.name]),binding);
      }
      for (const spec of scan.imports) {
        if (spec.startsWith('.') || spec.startsWith('/')) {
          const target = resolveRelative(abs, spec);
          if (target === null) reasons.push(`${path} imports ${spec}, which could not be resolved`);
          else stack.push(target);
        } else if (!BUILTINS.has(spec) && !packageInstalled(abs, spec)) {
          reasons.push(`${path} imports ${spec}, which is neither a relative file nor an installed package`);
        }
      }
      for (const line of scan.computedImports) reasons.push(`${path}:${line} loads a computed path`);
      const declared = this.ctx.declaredInputs.filter((d) => matchesGlob(path, d.reader));
      for (const [index, read] of scan.reads.entries()) {
        const declarations = declared.filter((d) => d.read === undefined || d.read === index);
        if (read.path === null && declarations.some((d) => d.read === index)) continue;
        if (read.path === null) {
          reasons.push(`${path}:${read.line} ${read.call}() reads a computed path; declare it in the profile's declared inputs`);
          continue;
        }
        const target = rel(root, read.path);
        const listed = declarations.some((d) => d.paths.some((g) => matchesGlob(target, g)));
        if (!listed) reasons.push(`${path}:${read.line} ${read.call}() reads ${target}, which is not a declared input`);
        else if (existsSync(read.path) && lstatSync(read.path).isFile()) files.set(target, sha256(readFileSync(read.path)));
        else reasons.push(`${path}:${read.line} reads ${target}, which does not exist`);
      }
      for (const d of declared) {
        for (const glob of d.paths) {
          const matched = expandGlob(root, glob);
          if (matched.length === 0) reasons.push(`declared input ${glob} (read by ${path}) matches no file`);
          for (const f of matched) {
            const p = rel(root, f);
            if (isOutput(p)) this.excluded.add(p);
            else files.set(p, sha256(readFileSync(f)));
          }
        }
      }
    }
    return { files, reasons, scans, environment };
  }
}

function behaviorUse(project: ProjectRecord): Record<string, unknown> {
  return Object.fromEntries(Object.entries(project.use).filter(([k]) => !NOT_BEHAVIOR.has(k)));
}

/** A project and every project it depends on, transitively, in a stable order. */
function withDependencies(begin: BeginRecord, name: string): ProjectRecord[] {
  const byName = new Map(begin.projects.map((p) => [p.name, p]));
  const out: ProjectRecord[] = [];
  const seen = new Set<string>();
  const visit = (n: string) => {
    if (seen.has(n)) return;
    seen.add(n);
    const p = byName.get(n);
    if (p === undefined) return;
    for (const d of p.dependencies) visit(d);
    out.push(p);
  };
  visit(name);
  return out;
}

export type DigestReport = {
  behavior: Map<string, BehaviorDigest>;
  toolchain: ToolchainDigest;
  /** Every file hashed into any digest, and every output the scan met and left out. */
  manifest: { inputs: InputEntry[]; excluded: string[] };
  /** Files that set storageState below the project (see normalize). */
  roleOverrideFiles: Set<string>;
};

export const behaviorKey = (test: TestIdentity, project: string) => JSON.stringify([test.suite, test.file, test.titlePath, project]);

export function computeDigests(ctx: DigestContext): DigestReport {
  // Reporter roots are canonical; retain that identity through aliases such as macOS /var or
  // a suite symlink so dependency and declared-reader paths use the same manifest denominator.
  const declarationErrors = declarationProblems(ctx.declaredEnvironmentInputs ?? []);
  ctx = { ...ctx, declaredEnvironmentInputs:declarationErrors.length === 0 ? ctx.declaredEnvironmentInputs ?? [] : [], suiteRoot: realpathSync(ctx.suiteRoot), kitDir: existsSync(ctx.kitDir) ? realpathSync(ctx.kitDir) : ctx.kitDir };
  const excluded = new Set<string>();
  const scanner = new Scanner(ctx, excluded);
  const root = ctx.suiteRoot;
  const all = new Map<string, string>();
  const configFile = ctx.begin.configFile;
  const roleOverrideFiles = new Set<string>();

  // Shared by every test of the config: what the config loads (not the config file itself), and the
  // global setup and teardown modules with their closures.
  const configReasons: string[] = [...declarationErrors];
  const observedInputs = ctx.begin.environmentInputs;
  if ((ctx.declaredEnvironmentInputs!.length > 0 || observedInputs !== undefined) &&
    (!validObservation(observedInputs) || observationProblems(observedInputs).length > 0 || JSON.stringify(canonicalDeclarations(ctx.declaredEnvironmentInputs!)) !== JSON.stringify(canonicalDeclarations(observedInputs.declarations))))
    configReasons.push('missing or invalid suite environment invocation observation');
  let configEnvironment = new Map<string, EnvironmentBinding>();
  let configClosure = new Map<string, string>();
  let snapshotTemplate = false;
  if (configFile !== null) {
    const c = scanner.closure([configFile]);
    configClosure = new Map([...c.files].filter(([p]) => p !== rel(root, configFile)));
    configReasons.push(...c.reasons);
    configEnvironment = c.environment;
    snapshotTemplate = scanner.scan(configFile).setsSnapshotTemplate;
  }
  const globals = scanner.closure([...ctx.begin.globalSetup, ...ctx.begin.globalTeardown].map((p) => resolve(root, p)));
  configReasons.push(...globals.reasons);

  const behavior = new Map<string, BehaviorDigest>();
  for (const t of ctx.begin.tests) {
    const test: TestIdentity = { suite: ctx.suite, file: t.file, titlePath: t.titlePath };
    const key = behaviorKey(test, t.project);
    if (behavior.has(key)) continue;
    const reasons = [...configReasons, ...(t.optionSafety?.version === ANALYSIS_VERSION ? t.optionSafety.problems : ['missing or unsupported input-aware AST option safety binding'])];
    const projects = withDependencies(ctx.begin, t.project);
    if (projects.length === 0) reasons.push(`project ${t.project} is not in the resolved configuration`);
    // The spec's closure, and every setup project's test files.
    const setupFiles = ctx.begin.tests
      .filter((s) => s.project !== t.project && projects.some((p) => p.name === s.project))
      .map((s) => resolve(ctx.begin.rootDir, s.file));
    const spec = resolve(ctx.begin.rootDir, t.file);
    const closure = scanner.closure([spec, ...new Set(setupFiles)]);
    reasons.push(...closure.reasons);
    if (scanner.scan(spec).setsStorageState) roleOverrideFiles.add(`${ctx.suite}::${t.file}`);
    // Baselines by Playwright's default template, or the profile's declared baselines.
    const baselines = new Map<string, string>();
    if (snapshotTemplate && ctx.declaredBaselines.length === 0) reasons.push('the config sets snapshotPathTemplate and the profile declares no baselines');
    const own = projects.at(-1);
    if (own !== undefined) {
      const snapDir = join(own.snapshotDir, `${relative(own.testDir, spec)}-snapshots`);
      const found: string[] = [];
      walkFiles(snapDir, found);
      for (const f of found) baselines.set(rel(root, f), sha256(readFileSync(f)));
    }
    for (const glob of ctx.declaredBaselines) for (const f of expandGlob(root, glob)) baselines.set(rel(root, f), sha256(readFileSync(f)));
    // The cases it is bound to, by canonical hash, and their mutation recipes.
    const mapped = ctx.ledger.filter((m) => testKey(m.test) === testKey(test)).map((m) => m.obligation.case);
    const annotated = t.annotations.filter((a) => a.type === 'case' && a.description !== undefined).map((a) => a.description as string);
    const caseHashes = [...new Set([...mapped, ...annotated])].sort().map((id) => {
      const record = ctx.cases.get(id);
      return { id, hash: record === undefined ? 'absent' : canonicalCaseHash(record) };
    });
    const recipes = ctx.recipes.filter((r) => testKey(r.test) === testKey(test)).map((r) => r.hash).sort();
    const files = new Map([...closure.files, ...configClosure, ...globals.files, ...baselines]);
    for (const [p, h] of files) all.set(p, h);
    const inputs = [...files].map(([path, hash]) => ({ path, hash })).sort((a, b) => a.path.localeCompare(b.path));
    if (reasons.length > 0) {
      behavior.set(key, { status: 'unresolved', test, project: t.project, reasons });
      continue;
    }
    const resolved = projects.map((p) => ({ name: p.name, use: behaviorUse(p) }));
    const environment = [...new Map([...closure.environment,...configEnvironment,...globals.environment])].sort(([a],[b])=>a < b ? -1 : a > b ? 1 : 0);
    const digest = hashOf({ environment, analysis: ANALYSIS_VERSION, test: testKey(test), project: t.project, inputs, resolved, cases: caseHashes, recipes });
    const bindings = [...new Map(environment.map(([,binding]) => [binding.name,binding])).values()].sort((a,b)=>a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    // Explicit empty projections prove independence within a declared suite. Absence retains the
    // old no-declaration path and cannot stand in for a newer invocation's protocol evidence.
    behavior.set(key, { status: 'resolved', test, project: t.project, digest, inputs, ...(observedInputs === undefined && ctx.declaredEnvironmentInputs!.length === 0 ? {} : {environmentInputs:{declarations:canonicalDeclarations(ctx.declaredEnvironmentInputs ?? []),bindings}}) });
  }

  const toolchain = toolchainDigest(ctx);
  if (toolchain.status === 'resolved') for (const e of toolchain.inputs) all.set(e.path, e.hash);
  return {
    behavior,
    toolchain,
    manifest: { inputs: [...all].map(([path, hash]) => ({ path, hash })).sort((a, b) => a.path.localeCompare(b.path)), excluded: [...excluded].sort() },
    roleOverrideFiles,
  };
}

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'];

/** The suite's toolchain: lockfile, kit, rule set, recipe format and the config's non-semantic settings. */
export function toolchainDigest(ctx: DigestContext): ToolchainDigest {
  const reasons: string[] = [];
  const inputs: InputEntry[] = [];
  let lock: string | null = null;
  for (let dir = realpathSync(ctx.suiteRoot); lock === null; dir = dirname(dir)) {
    lock = LOCKFILES.map((f) => join(dir, f)).find((f) => existsSync(f)) ?? null;
    if (dirname(dir) === dir) break;
  }
  if (lock === null) reasons.push('no lockfile found for the suite');
  else inputs.push({ path: rel(ctx.suiteRoot, lock), hash: sha256(readFileSync(lock)) });
  const kitFiles: string[] = [];
  walkFiles(ctx.kitDir, kitFiles);
  if (kitFiles.length === 0) reasons.push(`the kit is not installed at ${rel(ctx.suiteRoot, ctx.kitDir)}`);
  for (const f of kitFiles.sort()) inputs.push({ path: rel(ctx.suiteRoot, f), hash: sha256(readFileSync(f)) });
  if (reasons.length > 0) return { status: 'unresolved', reasons };
  const b = ctx.begin;
  const settings = {
    workers: b.workers,
    reporters: b.reporters.map((r) => (isAbsolute(r) ? rel(ctx.suiteRoot, r) : r)),
    globalTimeout: b.globalTimeout,
    maxFailures: b.maxFailures,
    fullyParallel: b.fullyParallel,
    projects: b.projects.map((p) => ({
      name: p.name,
      timeout: p.timeout,
      repeatEach: p.repeatEach,
      outputDir: rel(ctx.suiteRoot, p.outputDir),
      artifacts: Object.fromEntries(ARTIFACT_USE.map((k) => [k, p.use[k] ?? null])),
    })),
  };
  return {
    status: 'resolved',
    inputs,
    digest: hashOf({ analysis: ANALYSIS_VERSION, inputs, kit: KIT_VERSION, rules: RULES_VERSION, recipeFormat: RECIPE_FORMAT_VERSION, playwright: b.playwright, settings }),
  };
}

export type EffectiveConfig = {
  playwright: string;
  workers: number;
  projects: (MaterialConfig & { name: string; baseURL: string | null })[];
};

/** What Playwright actually resolved for the run, without secrets; the browser version comes from caseStep. */
export function effectiveConfig(begin: BeginRecord, browsers: Map<string, { name: string; version: string }>): EffectiveConfig {
  return {
    playwright: begin.playwright,
    workers: begin.workers,
    projects: begin.projects.map((p) => {
      const use = p.use;
      const observable = begin.tests.filter((t) => t.project === p.name).every((t) => t.optionSafety?.version === ANALYSIS_VERSION && t.optionSafety.problems.length === 0);
      const browser = browsers.get(p.name) ?? null;
      return {
        name: p.name,
        browserName: browser?.name ?? (typeof use['browserName'] === 'string' ? use['browserName'] : null),
        browserVersion: browser?.version ?? null,
        channel: observable && typeof use['channel'] === 'string' ? use['channel'] : null,
        headless: !observable ? null : typeof use['headless'] === 'boolean' ? use['headless'] : true,
        retries: observable ? p.retries : null,
        baseURL: observable && typeof use['baseURL'] === 'string' ? use['baseURL'] : null,
      };
    }),
  };
}

export function materialOf(config: EffectiveConfig, project: string): MaterialConfig | null {
  const p = config.projects.find((x) => x.name === project);
  if (p === undefined) return null;
  return { browserName: p.browserName, browserVersion: p.browserVersion, channel: p.channel, headless: p.headless, retries: p.retries };
}
