// Evidence commands (plan §6 steps 5–6, §4 reverify): `redcheck`, `burnin` and `reverify`. Each runs the
// selected test through the same planner, staged kit and reporter as `run`, against the served local
// site, and writes a receipt only when the core's own judgment of the raw ledgers holds. A receipt
// claims nothing a ledger can't show: the verdict re-judges every receipt each time it is read.
//
// Mutations happen in the application, never in the test: a recipe's fault is applied through the
// explicit local adapter (`mutate`, then `restore`), so the test's own inputs and digests are the same in
// the mutated, restored and verdict runs. The application's content manifest must be back to what it was
// before the restored run counts.
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { canonicalJson, sha256 } from './canonical.ts';
import { hostProblems, walk } from './coordinator.ts';
import { behaviorKey, computeDigests, type BehaviorDigest } from './digest.ts';
import { effectiveClassification, laneClassOf } from './dispositions.ts';
import { judgeBurnIn, judgeRedCheck } from './evidence.ts';
import { repoTop } from './git.ts';
import { compareManifests, contentManifest } from './identity.ts';
import { adapterOperation, type LocalAdapter } from './local-adapter.ts';
import type { BurnInRecord, Configuration, EnvironmentDef, ObligationRef, RedCheckRecord, TestIdentity } from './model.ts';
import { operationInputs } from './operation-inputs.ts';
import { inside, loadPersisted, parseEvidence, parseRecipe, type Persisted } from './persistence.ts';
import { execute, planSuite, probeInvocation, pulledIn, type SuitePlanInput } from './run-plan.ts';
import { readInvocation } from './run-observation.ts';
import { stagedKitProblems } from './staging.ts';
import { probeHealth } from './breaker.ts';
import { currentBranch } from './work.ts';
import type { EnvironmentInputValue } from '../kit/environment-inputs.ts';

export type CertifyContext = { suiteRoot: string; appRoot: string; environment: string; adapter: LocalAdapter; environmentValues?: Record<string, EnvironmentInputValue>; timeoutMs?: number };

type Prepared = {
  state: Persisted;
  environment: EnvironmentDef;
  configuration: Configuration;
  behavior: Extract<BehaviorDigest, { status: 'resolved' }>;
  toolchain: string;
  roleHidden: boolean;
  runDir: string;
  run: (name: string, extra?: string[]) => Promise<string>;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const recordId = (...parts: string[]) => parts.join('-').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 120);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

async function prepare(ctx: CertifyContext, test: TestIdentity, configurationId: string, purpose: string): Promise<Prepared> {
  const suiteRoot = realpathSync(ctx.suiteRoot);
  const appRoot = realpathSync(ctx.appRoot);
  for (const [label, root] of [['suite checkout', suiteRoot], ['application worktree', appRoot]] as const) {
    const top = await repoTop(root);
    if (top === null || realpathSync(top) !== root) throw new Error(`the ${label} must be its Git checkout's root`);
  }
  if (suiteRoot === appRoot) throw new Error('name the suite checkout and the application worktree separately (they are the same folder here)');
  const branch = await currentBranch(suiteRoot);
  if (branch === null || branch === 'main' || branch === 'master') throw new Error('evidence is written on a dedicated suite branch, never main, master or a detached checkout');
  const state = loadPersisted(suiteRoot, { applicationRoot: appRoot });
  const environment = state.profile.environments.find((e) => e.id === ctx.environment);
  if (environment === undefined || environment.kind !== 'local-candidate') throw new Error('red checks and burn-ins run against an explicitly selected local-candidate environment');
  const configuration = state.profile.configurations.find((c) => c.id === configurationId);
  if (configuration === undefined) throw new Error(`configuration ${configurationId} is not declared`);
  const definition = state.profile.suites.find((s) => s.id === test.suite);
  if (definition === undefined) throw new Error(`no suite ${test.suite}`);
  const config = inside(suiteRoot, definition.config);
  const rules = effectiveClassification(state.profile.classification, state.profile.roles, state.profile.classification).rules;
  // The site must be serving this application worktree: the adapter's real root, never the suite checkout.
  const site = adapterOperation(ctx.adapter, ctx.timeoutMs === undefined ? {} : { timeoutMs: ctx.timeoutMs });
  try {
    const served = realpathSync((await site.call((c) => ctx.adapter.identity(c))).appRoot);
    if (served !== appRoot) throw new Error(`the local site serves ${served}, not the application worktree ${appRoot}; refused`);
  } finally { site.dispose(); }
  const health = await probeHealth(new URL(state.local.healthPath, `${environment.baseUrl.replace(/\/+$/, '')}/`).href);
  if (!health.reachable) throw new Error('the local site is not reachable');
  const kit = join(dirname(config), 'support/test-lab');
  const statics = [...stagedKitProblems(kit), ...hostProblems(state.profile, environment, definition.id, config, rules, [config], ['\0', configuration.project])];
  if (statics.length > 0) throw new Error(statics.join('; '));
  const inputs = operationInputs([definition], environment, ctx.environmentValues ?? {});
  if (inputs.problems.length > 0) throw new Error(inputs.problems.join('; '));
  const runDir = inside(suiteRoot, `.test-lab/runs/${purpose}-${stamp()}-${randomUUID()}`);
  mkdirSync(runDir, { recursive: true });
  const grep = `(?:^|\\s)${escape(test.titlePath.join(' '))}$`;
  const base = (name: string, extra: string[] = []): SuitePlanInput => ({ suite: definition.id, config, rules, environment, runDir: join(runDir, name), reporter: join(kit, 'reporter.ts'), projects: [configuration.project], secretOptions: state.profile.secretOptions, declaredEnvironmentInputs: definition.declaredEnvironmentInputs ?? [], environmentValues: inputs.projections.get(definition.id) ?? {}, selectedFiles: [test.file], extraArgs: ['--grep', grep, ...extra] });
  const probe = probeInvocation(base('probe'));
  await execute(probe, { timeoutMs: ctx.timeoutMs ?? 600_000, inherit: scrubbed() });
  const probed = readInvocation(probe);
  if (probed.begin === null || probed.completion === null) throw new Error(`the config probe failed: ${probed.problems.join('; ')}`);
  if (probed.begin.projects.find((p) => p.name === configuration.project)?.use['baseURL'] !== environment.baseUrl) throw new Error('the resolved baseURL differs from the selected environment');
  // The same host scan a verdict run makes: config, global setup and teardown, and every non-excluded
  // file of the projects that would run. A literal host outside this target refuses before any spec loads.
  const running = pulledIn(probed.begin.projects, [configuration.project]);
  const sources = [config, ...probed.begin.globalSetup, ...probed.begin.globalTeardown, ...probed.begin.projects.filter((p) => running.has(p.name)).flatMap((p) => walk(p.testDir).filter((file) => laneClassOf(rules, definition.id, p.name, relative(dirname(config), file)) !== 'excluded'))];
  const hosts = hostProblems(state.profile, environment, definition.id, config, rules, sources, [...running]);
  if (hosts.length > 0) throw new Error(hosts.join('; '));
  const discover = planSuite(base('discover'), probed.begin, 'discover');
  if (!discover.ok) throw new Error(discover.refusals.join('; '));
  await execute(discover.invocation, { timeoutMs: ctx.timeoutMs ?? 600_000, inherit: scrubbed() });
  const discovered = readInvocation(discover.invocation);
  if (discovered.begin === null || !discovered.begin.tests.some((t) => t.project === configuration.project && t.file === test.file && canonicalJson(t.titlePath) === canonicalJson(test.titlePath)))
    throw new Error(`discovery did not list ${test.file} › ${test.titlePath.join(' › ')} under project ${configuration.project}`);
  const digests = computeDigests({ suite: definition.id, suiteRoot: dirname(config), begin: discovered.begin, cases: state.cases, ledger: state.ledger, declaredInputs: state.profile.declaredInputs, declaredEnvironmentInputs: definition.declaredEnvironmentInputs ?? [], declaredBaselines: state.profile.declaredBaselines, kitDir: kit });
  const behavior = digests.behavior.get(behaviorKey(test, configuration.project));
  if (behavior === undefined || behavior.status !== 'resolved') throw new Error(`the test's behavior digest is unresolved: ${behavior?.status === 'unresolved' ? behavior.reasons.join('; ') : 'not in the resolved suite'}`);
  if (digests.toolchain.status !== 'resolved') throw new Error(`the suite's toolchain digest is unresolved: ${digests.toolchain.reasons.join('; ')}`);
  const begin = discovered.begin;
  return {
    state, environment, configuration, behavior, toolchain: digests.toolchain.digest, roleHidden: digests.roleOverrideFiles.has(`${test.suite}::${test.file}`), runDir,
    async run(name, extra = []) {
      const planned = planSuite(base(name, extra), begin, 'run');
      if (!planned.ok) throw new Error(planned.refusals.join('; '));
      await execute(planned.invocation, { timeoutMs: ctx.timeoutMs ?? 600_000, inherit: scrubbed() });
      return planned.invocation.dir;
    },
  };
}

/** The shell environment, minus anything that could carry a test-lab protocol value in from outside. */
function scrubbed(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('TEST_LAB_') && k !== 'TEST_LAB_DATA') delete env[k];
  return env;
}

function keep(suiteRoot: string, dir: string, name: string): { path: string; sha256: string } {
  const evidence = inside(suiteRoot, '.test-lab/evidence');
  mkdirSync(join(evidence, 'ledgers'), { recursive: true });
  const to = join(evidence, 'ledgers', `${name}.jsonl`);
  copyFileSync(join(dir, 'steps.jsonl'), to);
  return { path: `ledgers/${name}.jsonl`, sha256: sha256(readFileSync(to)) };
}

export type RecipeInput = { hypothesis: string; technique: 'adapter'; mutation: Record<string, unknown> };

/** The recipe as stored: content-addressed, bound to one test and one obligation. */
export function recipeFor(test: TestIdentity, obligation: ObligationRef, input: RecipeInput): Record<string, unknown> {
  if (input.technique !== 'adapter') throw new Error('this version replays only application-side recipes through the local adapter (technique "adapter")');
  if (typeof input.hypothesis !== 'string' || input.hypothesis.trim() === '') throw new Error('a recipe states its fault hypothesis: the plausible regression it reproduces');
  const recipe = { format: 1, test, obligation, hypothesis: input.hypothesis, technique: input.technique, mutation: input.mutation };
  parseRecipe(recipe);
  return recipe;
}

export type RedCheckResult = { ok: true; record: string; runDir: string } | { ok: false; reason: string; runDir: string };

export async function redcheck(ctx: CertifyContext, input: { test: TestIdentity; obligation: ObligationRef; configuration: string; recipe: Record<string, unknown> }): Promise<RedCheckResult> {
  if (ctx.adapter.mutate === undefined || ctx.adapter.restore === undefined) throw new Error('the local adapter has no mutate/restore actions; a red check needs both');
  const row = loadPersisted(ctx.suiteRoot, { applicationRoot: ctx.appRoot }).ledger.find((m) => canonicalJson(m.test) === canonicalJson(input.test) && canonicalJson(m.obligation) === canonicalJson(input.obligation) && m.configuration === input.configuration);
  if (row === undefined) throw new Error('the test is not adopted for that obligation on that configuration: run `test-lab adopt` first');
  const recipe = recipeFor(input.test, input.obligation, input.recipe as RecipeInput);
  const text = `${JSON.stringify(recipe, null, 2)}\n`;
  const recipeHash = `sha256:${sha256(text)}`;
  const recipePath = inside(ctx.suiteRoot, `.test-lab/recipes/${recipeHash.slice(7)}.json`);
  // Every refusal in prepare (branch, served root, health, host safety, discovery, digests) happens before
  // anything is written. The recipe is stored only for the attempt, and removed again if this attempt
  // created it and no receipt is written: a refused red check leaves the corpus as it found it.
  const p = await prepare(ctx, input.test, input.configuration, 'redcheck');
  let created = false;
  const refuse = (reason: string): RedCheckResult => { if (created) rmSync(recipePath, { force: true }); return { ok: false, reason, runDir: p.runDir }; };
  try {
    if (!existsSync(recipePath)) { mkdirSync(dirname(recipePath), { recursive: true }); writeFileSync(recipePath, text, { flag: 'wx' }); created = true; }
    const appRoot = realpathSync(ctx.appRoot);
    const before = await contentManifest(appRoot, { assetDirs: p.state.profile.generatedAssets });
    const site = adapterOperation(ctx.adapter, ctx.timeoutMs === undefined ? {} : { timeoutMs: ctx.timeoutMs });
    let mutated: string;
    try {
      await site.call((c) => ctx.adapter.mutate!(recipe, c));
      try { mutated = await p.run('mutated'); }
      finally { await site.call((c) => ctx.adapter.restore!(recipe, c)); }
    } finally { site.dispose(); }
    const after = await contentManifest(appRoot, { assetDirs: p.state.profile.generatedAssets });
    const left = compareManifests(before, after);
    if (left.length > 0) return refuse(`restoring the mutation left the application changed (${left.map((d) => d.path).join(', ')}); no receipt written`);
    const restored = await p.run('restored');
    const id = recordId('red', input.obligation.case, input.obligation.step, input.obligation.obligation, input.configuration, stamp());
    const record: RedCheckRecord = { kind: 'red-check', id, environment: { id: p.environment.id, kind: p.environment.kind, baseUrl: p.environment.baseUrl }, obligation: input.obligation, test: input.test, configuration: input.configuration, recipeHash, behaviorDigest: p.behavior.digest, toolchainDigest: p.toolchain, mutated: keep(ctx.suiteRoot, mutated, `${id}-mutated`), restored: keep(ctx.suiteRoot, restored, `${id}-restored`), appliesTo: [], at: new Date().toISOString() };
    parseEvidence(record);
    const evidenceDir = inside(ctx.suiteRoot, '.test-lab/evidence');
    const why = judgeRedCheck(evidenceDir, record, p.configuration, p.roleHidden, inside(ctx.suiteRoot, '.test-lab/recipes'), p.behavior.environmentInputs);
    if (why !== null) {
      for (const ref of [record.mutated, record.restored]) rmSync(join(evidenceDir, ref.path), { force: true });
      return refuse(why);
    }
    const path = `.test-lab/evidence/${id}.json`;
    writeFileSync(inside(ctx.suiteRoot, path), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
    return { ok: true, record: path, runDir: p.runDir };
  } catch (error) {
    if (created) rmSync(recipePath, { force: true });
    throw error;
  }
}

export async function burnin(ctx: CertifyContext, input: { test: TestIdentity; configuration: string; repeats?: number }): Promise<RedCheckResult> {
  const repeats = input.repeats ?? 5;
  if (!Number.isSafeInteger(repeats) || repeats < 5) throw new Error('a burn-in repeats the test at least five times');
  const p = await prepare(ctx, input.test, input.configuration, 'burnin');
  const obligations = p.state.ledger.filter((m) => canonicalJson(m.test) === canonicalJson(input.test) && m.configuration === input.configuration).map((m) => m.obligation);
  if (obligations.length === 0) throw new Error('the test is not adopted on that configuration: run `test-lab adopt` first');
  const dir = await p.run('burn-in', ['--repeat-each', String(repeats), '--fail-on-flaky-tests']);
  const id = recordId('burn', input.test.file, input.configuration, stamp());
  const record: BurnInRecord = { kind: 'burn-in', id, environment: { id: p.environment.id, kind: p.environment.kind, baseUrl: p.environment.baseUrl }, test: input.test, configuration: input.configuration, behaviorDigest: p.behavior.digest, toolchainDigest: p.toolchain, run: keep(ctx.suiteRoot, dir, id), appliesTo: [], at: new Date().toISOString() };
  parseEvidence(record);
  const evidenceDir = inside(ctx.suiteRoot, '.test-lab/evidence');
  const why = judgeBurnIn(evidenceDir, record, p.configuration, p.roleHidden, obligations);
  if (why !== null) { rmSync(join(evidenceDir, record.run.path), { force: true }); return { ok: false, reason: why, runDir: p.runDir }; }
  const path = `.test-lab/evidence/${id}.json`;
  writeFileSync(inside(ctx.suiteRoot, path), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  return { ok: true, record: path, runDir: p.runDir };
}

export type ReverifyItem = { test: TestIdentity; configuration: string; obligation: ObligationRef | null; why: string; result: RedCheckResult | null };

/**
 * Re-verification (§4): every red check and burn-in whose behavior or toolchain digest no longer matches
 * the test as it is now is replayed from its committed recipe, and the test burned in again. No model and
 * no person: a replay that no longer fails inside its obligation writes nothing, and the case stays
 * unverified. Material effective-configuration changes show on the verdict; replay them the same way.
 */
export async function reverify(ctx: CertifyContext): Promise<ReverifyItem[]> {
  const state = loadPersisted(ctx.suiteRoot, { applicationRoot: ctx.appRoot });
  const items: ReverifyItem[] = [];
  const seen = new Set<string>();
  const current = new Map<string, { behavior: string; toolchain: string } | string>();
  const digestOf = async (test: TestIdentity, configuration: string) => {
    const key = canonicalJson([test, configuration]);
    if (!current.has(key)) {
      try { const p = await prepare(ctx, test, configuration, 'reverify'); current.set(key, { behavior: p.behavior.digest, toolchain: p.toolchain }); rmSync(p.runDir, { recursive: true, force: true }); }
      catch (e) { current.set(key, e instanceof Error ? e.message : String(e)); }
    }
    return current.get(key)!;
  };
  const latest = (kind: 'red-check' | 'burn-in') => {
    const out = new Map<string, RedCheckRecord | BurnInRecord>();
    for (const r of state.evidence) if (r.kind === kind) {
      const key = canonicalJson([r.test, r.configuration, r.kind === 'red-check' ? r.obligation : null]);
      const prior = out.get(key);
      if (prior === undefined || prior.at < r.at) out.set(key, r);
    }
    return [...out.values()];
  };
  for (const r of latest('red-check') as RedCheckRecord[]) {
    const now = await digestOf(r.test, r.configuration);
    if (typeof now === 'string') { items.push({ test: r.test, configuration: r.configuration, obligation: r.obligation, why: `not replayable: ${now}`, result: null }); continue; }
    const recipePath = inside(ctx.suiteRoot, `.test-lab/recipes/${r.recipeHash.replace(/^sha256:/, '')}.json`);
    // Each red check binds its own recipe by content hash; a recipe edited in place stales that red check only.
    const recipeEdited = existsSync(recipePath) && `sha256:${sha256(readFileSync(recipePath))}` !== r.recipeHash;
    if (now.behavior === r.behaviorDigest && now.toolchain === r.toolchainDigest && !recipeEdited) continue;
    if (!existsSync(recipePath)) { items.push({ test: r.test, configuration: r.configuration, obligation: r.obligation, why: 'its recipe is missing', result: null }); continue; }
    const recipe = JSON.parse(readFileSync(recipePath, 'utf8')) as RecipeInput;
    const result = await redcheck(ctx, { test: r.test, obligation: r.obligation, configuration: r.configuration, recipe: { hypothesis: recipe.hypothesis, technique: recipe.technique, mutation: recipe.mutation } });
    items.push({ test: r.test, configuration: r.configuration, obligation: r.obligation, why: now.behavior !== r.behaviorDigest ? 'behavior digest moved' : now.toolchain !== r.toolchainDigest ? 'toolchain digest moved' : 'its recipe was edited', result });
    seen.add(canonicalJson([r.test, r.configuration]));
  }
  for (const r of latest('burn-in') as BurnInRecord[]) {
    const key = canonicalJson([r.test, r.configuration]);
    const now = await digestOf(r.test, r.configuration);
    if (typeof now === 'string') continue;
    if (!seen.has(key) && now.behavior === r.behaviorDigest && now.toolchain === r.toolchainDigest) continue;
    items.push({ test: r.test, configuration: r.configuration, obligation: null, why: seen.has(key) ? 'replayed red check needs a fresh burn-in' : 'behavior or toolchain digest moved', result: await burnin(ctx, { test: r.test, configuration: r.configuration }) });
  }
  return items;
}

