// The run plan (plan §8). `run` never builds a shell string: each Playwright invocation is a typed argv,
// working directory and environment, and the plan records every exclusion with its reason.
//
// Excluded tests can't execute during discovery or setup:
// - an excluded suite is never invoked, not even to list its tests;
// - the project graph is read by a config-only probe (`--list --no-deps` with a file filter that matches
//   nothing), which loads the config and no spec;
// - an excluded project is never selected, and a selected project that depends on it (or tears down
//   through it) is refused, since Playwright would run the dependency;
// - when a selected project has a path-glob exclusion, the invocation names its files explicitly, so the
//   excluded files are never loaded (a path exclusion in a dependency project is refused: Playwright never
//   filters a dependency's files);
// - after discovery, any listed test that is still excluded refuses the run.
//
// Every reporter is named with --reporter (the locked releases have no --add-reporter), the report
// locations are set inside the invocation's own folder, overriding the shell, and the report server
// never opens. The base-URL variable is set from the profile, overriding the shell, and recorded.

import { ownProcessGroup, stopProcessTree } from './process-tree.ts';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { ENVIRONMENT_INPUTS_ENV, bindingsOf, canonicalDeclarations, declarationProblems, observationProblems, sameBindings, validObservation, valueProblems, type EnvironmentInputDeclaration, type EnvironmentInputValue } from '../kit/environment-inputs.ts';
import { optionClosureProblems } from '../kit/option-safety.ts';
import { ENVIRONMENT_ENV, SECRET_OPTIONS_ENV, STEP_OUTPUT_ENV, type BeginRecord, type ProjectRecord } from '../kit/records.ts';
import { laneClassOf, type ClassificationRule } from './dispositions.ts';
import type { EnvironmentDef } from './model.ts';
import { HTML_REPORT_DIR, JSON_REPORT, LEDGER_FILE } from './run-observation.ts';

export const NO_MATCH = '__test_lab_config_only_probe__';

export type Invocation = {
  id: string;
  suite: string;
  purpose: 'probe' | 'discover' | 'run';
  cwd: string;
  argv: string[];
  /** Variables the plan sets, overriding the shell. Only names and these non-secret values are recorded. */
  env: Record<string, string | undefined>;
  /** The folder its three reports go to. */
  dir: string;
};

export type Exclusion = { suite: string; project?: string; glob?: string; reason: string };

export type SuitePlanInput = {
  suite: string;
  /** The config file, absolute. */
  config: string;
  rules: ClassificationRule[];
  environment: EnvironmentDef;
  runDir: string;
  /** The kit's step reporter in the suite, absolute. */
  reporter: string;
  /** The projects the tier selects in this suite. */
  projects: string[];
  /** Custom `use` options whose values are secrets. */
  secretOptions: string[];
  declaredEnvironmentInputs?: EnvironmentInputDeclaration[];
  /** Explicit values for this operation. BASE_URL is supplied by the target plan, never inherited. */
  environmentValues?: Record<string, EnvironmentInputValue>;
  extraArgs?: string[];
  /** Exact suite-relative files selected from validated mappings. Intersect, never widen exclusions. */
  selectedFiles?: string[];
};

export type SuitePlan =
  | { ok: true; invocation: Invocation; exclusions: Exclusion[] }
  | { ok: false; refusals: string[]; exclusions: Exclusion[] };

/** The Playwright CLI the suite itself resolves: never a global or npx-fetched one. */
export function playwrightCli(cwd: string): string {
  const require = createRequire(join(cwd, 'package.json'));
  return join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
}

function reportEnv(dir: string): Record<string, string> {
  return {
    [STEP_OUTPUT_ENV]: join(dir, LEDGER_FILE),
    PLAYWRIGHT_JSON_OUTPUT_FILE: join(dir, JSON_REPORT),
    PLAYWRIGHT_HTML_OUTPUT_DIR: join(dir, HTML_REPORT_DIR),
    PLAYWRIGHT_HTML_OPEN: 'never',
  };
}

/** Validate profile/command serialization before passing any values to the child. */
function invocationInputs(input: Pick<SuitePlanInput, 'environment' | 'secretOptions' | 'reporter' | 'declaredEnvironmentInputs' | 'environmentValues'>): { env: Record<string,string | undefined>; bindings: ReturnType<typeof bindingsOf>; declarations: EnvironmentInputDeclaration[] } {
  const declarations = input.declaredEnvironmentInputs ?? [];
  const problems = declarationProblems(declarations);
  if (problems.length > 0) throw new Error(problems.join('; '));
  if (declarations.some(d => input.secretOptions.some(s => s.toUpperCase() === d.name))) throw new Error('secret options cannot be declared as environment behavior inputs');
  if (input.environmentValues !== undefined && (input.environmentValues === null || typeof input.environmentValues !== 'object' || Array.isArray(input.environmentValues))) throw new Error('invocation values must be an object');
  const values = { ...(input.environmentValues ?? {}) };
  const target = declarations.find(d => d.name === input.environment.baseUrlEnv);
  if (target !== undefined) {
    const supplied = values[target.name];
    if (supplied !== undefined && (supplied.state !== 'set' || supplied.value !== input.environment.baseUrl)) throw new Error('declared base URL input conflicts with the target environment');
    values[target.name] = { state:'set',value:input.environment.baseUrl };
  }
  problems.push(...valueProblems(declarations, values));
  if (problems.length > 0) throw new Error(problems.join('; '));
  if (declarations.length === 0) return { env:{}, bindings:[], declarations:[] };
  const request = { version:1, invocation:randomUUID(), declarations:canonicalDeclarations(declarations), values };
  const env: Record<string,string | undefined> = { [ENVIRONMENT_INPUTS_ENV]:JSON.stringify(request) };
  for (const d of declarations) env[d.name] = values[d.name]!.state === 'unset' ? undefined : (values[d.name] as {value:string}).value;
  return { env, bindings:bindingsOf(declarations,values), declarations:canonicalDeclarations(declarations) };
}

/** Whether a whole suite is excluded: never invoked. */
export function suiteExcluded(rules: ClassificationRule[], suite: string): Exclusion | null {
  const own = rules.find((r) => r.target.suite === suite && r.target.project === undefined && r.target.glob === undefined);
  return own?.lane === 'excluded' ? { suite, reason: own.change.reason } : null;
}

/** The config-only probe: loads the config, lists no spec, and writes the project graph to its ledger. */
export function probeInvocation(input: Pick<SuitePlanInput, 'suite' | 'config' | 'environment' | 'runDir' | 'reporter' | 'secretOptions' | 'rules'> & Partial<Pick<SuitePlanInput, 'projects' | 'declaredEnvironmentInputs' | 'environmentValues'>>): Invocation {
  const inputs = invocationInputs(input);
  const cwd = dirname(input.config);
  const whole = suiteExcluded(input.rules, input.suite);
  if (whole !== null) throw new Error(`config-only probe refused before loading: suite ${input.suite} is excluded: ${whole.reason}`);
  const root = existsSync(cwd) ? realpathSync(cwd) : cwd;
  // A project execution label owns its tests, not every shared config/helper. Before the graph is
  // known, genuine path exclusions in ANY project still protect the config closure from loading.
  // Project-only rules are enforced after the probe by selection/dependency/teardown validation.
  const pathRules = input.rules.filter(r => r.target.project === undefined || r.target.glob !== undefined);
  const projects = new Set(['\u0000', ...(input.projects ?? []), ...pathRules.flatMap(r => r.target.suite === input.suite && r.target.project !== undefined ? [r.target.project] : [])]);
  const problems = optionClosureProblems([input.config], file => {
    const actual = existsSync(file) ? realpathSync(file) : file;
    const path = relative(root, actual).split(sep).join('/');
    return [...projects].some(project => laneClassOf(pathRules, input.suite, project, path) === 'excluded');
  });
  if (problems.length > 0) throw new Error(`config-only probe refused before loading:\n${problems.join('\n')}`);
  const dir = join(input.runDir, `${input.suite}-probe`);
  return {
    id: `${input.suite}-probe`,
    suite: input.suite,
    purpose: 'probe',
    cwd,
    // --no-deps: Playwright never applies a file filter to dependency projects, so without it a project's
    // dependencies' spec files would load even here.
    argv: [process.execPath, playwrightCli(cwd), 'test', '--config', input.config, '--list', '--no-deps', '--reporter', input.reporter, NO_MATCH],
    env: { [input.environment.baseUrlEnv]: input.environment.baseUrl, [ENVIRONMENT_ENV]: JSON.stringify({id: input.environment.id, kind: input.environment.kind, baseUrl: input.environment.baseUrl}), ...reportEnv(dir), [SECRET_OPTIONS_ENV]: input.secretOptions.join(','), ...inputs.env },
    dir,
  };
}

/** Projects a selected project pulls in: its dependencies and their teardowns, transitively. */
export function pulledIn(projects: ProjectRecord[], selected: string[]): Set<string> {
  const byName = new Map(projects.map((p) => [p.name, p]));
  const out = new Set<string>();
  const visit = (name: string) => {
    if (out.has(name)) return;
    out.add(name);
    const p = byName.get(name);
    for (const d of p?.dependencies ?? []) visit(d);
    if (p?.teardown) visit(p.teardown);
  };
  for (const s of selected) visit(s);
  return out;
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile() && /\.(m|c)?[jt]sx?$/.test(entry.name)) out.push(abs);
  }
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Extra arguments may tune execution, but never change the planned config, projects or file filters. */
function extraArgumentProblems(args: string[]): string[] {
  const values = new Set(['--grep', '--grep-invert', '--repeat-each', '--retries', '--timeout', '--global-timeout', '--workers', '--max-failures']);
  const flags = new Set(['--fail-on-flaky-tests', '--headed']);
  const problems: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const equals = arg.indexOf('=');
    const name = equals < 0 ? arg : arg.slice(0, equals);
    if (values.has(name)) {
      const value = equals < 0 ? args[++i] : arg.slice(equals + 1);
      if (value === undefined || value === '' || value.startsWith('-')) problems.push(`missing or ambiguous value for ${name}`);
    } else if (!flags.has(arg)) problems.push(`extra argument ${arg} is not an execution option; config, project and file selection belong to the run plan`);
  }
  return problems;
}

/**
 * Plans one suite's run from the probe's ledger. Refuses when an excluded project would run as a
 * dependency, and names files explicitly when a selected project carries a path-glob exclusion.
 */
export function planSuite(input: SuitePlanInput, probe: BeginRecord, purpose: 'discover' | 'run' = 'run'): SuitePlan {
  const exclusions: Exclusion[] = [];
  let inputs: ReturnType<typeof invocationInputs>;
  try { inputs = invocationInputs(input); } catch { return { ok:false, refusals:['invalid declared nonsecret environment invocation inputs'], exclusions }; }
  if (inputs.declarations.length > 0 || probe.environmentInputs !== undefined) {
    const observed = probe.environmentInputs;
    if (!validObservation(observed) || observationProblems(observed).length > 0 || JSON.stringify(canonicalDeclarations(observed.declarations)) !== JSON.stringify(inputs.declarations) || !sameBindings(observed.bindings,inputs.bindings))
      return { ok:false, refusals:['environment inputs changed or are missing between probe/discovery and this invocation; probe again with current explicit values'], exclusions };
  }
  const refusals: string[] = extraArgumentProblems(input.extraArgs ?? []);
  // QA's CI config keeps `retries: process.env.CI ? 2 : 0`; test-lab never inherits it. Every run is
  // planned with --retries=0, and a caller can't ask for any other count (a pass on retry is never a pass).
  for (const [i, arg] of (input.extraArgs ?? []).entries()) {
    const value = arg === '--retries' ? input.extraArgs?.[i + 1] : arg.startsWith('--retries=') ? arg.slice('--retries='.length) : undefined;
    if (value !== undefined && value !== '0') refusals.push(`--retries ${value} refused: test-lab runs with --retries=0`);
  }
  if (input.projects.length === 0) refusals.push('select at least one explicit project; an empty selection would run every project');
  if (new Set(input.projects).size !== input.projects.length) refusals.push('duplicate selected project identities');
  if (new Set(probe.projects.map((p) => p.name)).size !== probe.projects.length) refusals.push('ambiguous project identities in resolved configuration');
  const whole = suiteExcluded(input.rules, input.suite);
  if (whole !== null) return { ok: false, refusals: [`suite ${input.suite} is excluded: ${whole.reason}`], exclusions: [whole] };
  const rootDir = probe.rootDir;
  const known = new Set(probe.projects.map((p) => p.name));
  for (const p of input.projects) if (!known.has(p)) refusals.push(`project ${p} is not in ${input.suite}'s configuration`);
  const projectRules = input.rules.filter((r) => r.target.suite === input.suite && r.target.project !== undefined && r.target.glob === undefined);
  const excludedProjects = new Set(projectRules.filter((r) => laneClassOf(input.rules, input.suite, r.target.project as string, '\u0000') === 'excluded').map((r) => r.target.project as string));
  for (const r of projectRules) if (excludedProjects.has(r.target.project as string)) exclusions.push({ suite: input.suite, project: r.target.project as string, reason: r.change.reason });
  for (const p of input.projects) if (excludedProjects.has(p)) refusals.push(`project ${p} is excluded and can't be selected`);
  for (const p of probe.projects) for (const dependency of [...p.dependencies, ...(p.teardown === null ? [] : [p.teardown])])
    if (!known.has(dependency)) refusals.push(`project ${p.name} references unknown dependency/teardown ${dependency}`);
  const running = pulledIn(probe.projects, input.projects);
  for (const p of running) if (excludedProjects.has(p) && !input.projects.includes(p)) refusals.push(`a selected project depends on excluded project ${p}, which Playwright would run`);

  const globRules = input.rules.filter((r) => r.target.suite === input.suite && r.target.glob !== undefined && r.lane === 'excluded');
  const globsFor = (project: string) => globRules.filter((r) => r.target.project === undefined || r.target.project === project);
  // Playwright applies no file filter to dependency projects, so a path exclusion there can't be kept
  // from loading: refuse rather than run it.
  for (const p of running)
    if (probe.projects.some((x) => running.has(x.name) && (x.dependencies.includes(p) || x.teardown === p)) && globsFor(p).length > 0)
      refusals.push(`dependency project ${p} has a path exclusion, and Playwright never filters a dependency's files`);
  let files: string[] = [];
  if ([...running].some((p) => globsFor(p).length > 0)) {
    // Name every candidate file except the excluded ones; Playwright intersects them with its own testMatch.
    // Each file is named in both its real and its as-configured form (a temporary or linked folder can
    // differ), anchored, so the filter can't match another file by suffix.
    const candidates = new Map<string, string>();
    const filters = new Map<string, string[]>();
    for (const p of probe.projects.filter((x) => running.has(x.name))) {
      const real = existsSync(p.testDir) ? realpathSync(p.testDir) : p.testDir;
      const found: string[] = [];
      const permitted: string[] = [];
      walk(real, found);
      for (const f of found) {
        const rel = relative(rootDir, f).split(sep).join('/');
        if (laneClassOf(input.rules, input.suite, p.name, rel) === 'excluded') continue;
        const forms = [...new Set([f, join(p.testDir, relative(real, f))])];
        const filter = `^(?:${forms.map(escape).join('|')})$`;
        // CLI filters belong only to explicitly selected projects. Dependency/teardown files run
        // unfiltered under their own testMatch; adding them here would widen every selected project.
        if (input.projects.includes(p.name)) candidates.set(f, filter);
        permitted.push(filter);
      }
      filters.set(p.name, permitted.sort());
    }
    const selectedFilters = input.projects.map((p) => JSON.stringify(filters.get(p) ?? []));
    if (new Set(selectedFilters).size > 1) refusals.push('selected projects have different permitted file filters; plan separate invocations before loading specs');
    for (const g of globRules) exclusions.push({ suite: input.suite, glob: g.target.glob as string, ...(g.target.project === undefined ? {} : { project: g.target.project }), reason: g.change.reason });
    files = [...candidates.values()].sort();
    if (files.length === 0) refusals.push(`every file of ${input.suite}'s selected projects is excluded`);
  }
  // Static preflight happens before importing any spec, including dependency/teardown specs. Public
  // reporter APIs cannot observe scoped baseURL/custom fixture options, so their presence refuses the
  // invocation. Config-only probes still load no specs.
  const sourceFiles = [input.config, ...probe.globalSetup, ...probe.globalTeardown];
  for (const p of probe.projects.filter((p) => running.has(p.name))) {
    const found: string[] = []; walk(p.testDir, found);
    for (const f of found) {
      const actual = realpathSync(f);
      const path = relative(rootDir, actual).split(sep).join('/');
      if (laneClassOf(input.rules, input.suite, p.name, path) !== 'excluded') sourceFiles.push(actual);
    }
  }
  refusals.push(...optionClosureProblems(sourceFiles, (file) => {
    const actual = existsSync(file) ? realpathSync(file) : file;
    const path = relative(rootDir, actual).split(sep).join('/');
    return [...running].some((project) => laneClassOf(input.rules, input.suite, project, path) === 'excluded');
  }));
  if (refusals.length > 0) return { ok: false, refusals, exclusions };
  const cwd = dirname(input.config);
  if (input.selectedFiles !== undefined) {
    const selected = input.selectedFiles.map(f=>resolve(cwd,f));
    if (selected.length === 0) return {ok:false,refusals:['mapped file selection is empty'],exclusions};
    const permitted=files.length===0?selected:selected.filter(f=>files.some(existing=>new RegExp(existing).test(f)));
    files=permitted.map(f=>`^${escape(f)}$`);
    if(files.length===0)return {ok:false,refusals:['every mapped file is excluded'],exclusions};
  }
  const dir = join(input.runDir, `${input.suite}-${purpose}`);
  return {
    ok: true,
    exclusions,
    invocation: {
      id: `${input.suite}-${purpose}`,
      suite: input.suite,
      purpose,
      cwd,
      argv: [
        process.execPath,
        playwrightCli(cwd),
        'test',
        '--config',
        input.config,
        ...(purpose === 'discover' ? ['--list'] : []),
        '--reporter',
        `${input.reporter},json,html`,
        ...input.projects.map((p) => `--project=${p}`),
        ...(purpose === 'run' ? ['--retries=0'] : []),
        ...(input.extraArgs ?? []).filter((a, i, all) => a !== '--retries' && !a.startsWith('--retries=') && all[i - 1] !== '--retries'),
        ...files,
      ],
      env: { [input.environment.baseUrlEnv]: input.environment.baseUrl, [ENVIRONMENT_ENV]: JSON.stringify({id: input.environment.id, kind: input.environment.kind, baseUrl: input.environment.baseUrl}), ...reportEnv(dir), [SECRET_OPTIONS_ENV]: input.secretOptions.join(','), ...inputs.env },
      dir,
    },
  };
}

/** Tests a discovery listed that the classification excludes: any one of them refuses the run. */
export function excludedListed(rules: ClassificationRule[], suite: string, begin: BeginRecord): string[] {
  return begin.tests.filter((t) => laneClassOf(rules, suite, t.project, t.file) === 'excluded').map((t) => `${t.project} › ${t.file} › ${t.titlePath.join(' › ')}`);
}

export type Execution = { status: number | null; signal: string | null; stdout: string; stderr: string };

/** Runs an invocation with no shell: the shell's environment, then the plan's variables over it. */
export function execute(inv: Invocation, options: { timeoutMs?: number; inherit?: Record<string, string | undefined>; signal?: AbortSignal } = {}): Promise<Execution> {
  const [command, ...plannedArgs] = inv.argv as [string, ...string[]];
  const env = { ...(options.inherit ?? process.env), ...inv.env };
  // Ambient protocol/preloads cannot silently authorize inputs. The owned preload propagates to Node
  // workers via NODE_OPTIONS; the coordinator observes values before Playwright loads its config.
  delete env[ENVIRONMENT_INPUTS_ENV];
  const request = inv.env[ENVIRONMENT_INPUTS_ENV];
  if (request !== undefined) env[ENVIRONMENT_INPUTS_ENV] = request;
  const args = [...plannedArgs];
  if (request !== undefined) {
    const reporterArg = args[args.indexOf('--reporter') + 1];
    const reporter = reporterArg?.split(',')[0];
    if (reporter === undefined) throw new Error('environment inputs require the planned step reporter');
    const preload = join(dirname(reporter),'environment-preload.cjs');
    if (!existsSync(preload)) throw new Error('environment input preload is missing from the staged kit');
    // Observe before other preloads can read/change inputs, preserving all existing runtime/guard options.
    env['NODE_OPTIONS'] = `--require=${JSON.stringify(preload)} ${env['NODE_OPTIONS'] ?? ''}`.trim();
  }
  const child = spawn(command, args, { cwd: inv.cwd, env, detached:ownProcessGroup, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  let stopping: Promise<void> | null = null;
  const stop=()=>{stopping??=stopProcessTree(child);};
  const timer = setTimeout(stop, options.timeoutMs ?? 600_000);
  options.signal?.addEventListener('abort',stop,{once:true});
  if(options.signal?.aborted)stop();
  return new Promise((done, reject) =>
    { child.once('error',error=>{clearTimeout(timer);options.signal?.removeEventListener('abort',stop);reject(error);});child.on('close', async (status, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort',stop);
      try {await stopping;done({ status, signal, stdout, stderr });}catch(error){reject(error);}
    });},
  );
}
