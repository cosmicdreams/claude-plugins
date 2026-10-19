import { ownProcessGroup, stopProcessTree } from '../../src/process-tree.ts';
// The kit and the core against the real reporter output of each supported Playwright release (plan §6,
// §8, phase 0): caseStep and the step reporter round-trip case, step and obligation IDs, nesting,
// duplicate titles, skips, failures and run-level errors through the actual file; the run plan sets
// every reporter, the report locations and the base URL; excluded tests never load; and a red check,
// restored run and burn-in written by Playwright itself verify through receipts.
//
// Needs `npm ci` in tests/playwright/pw-<version> and that version's Chromium; it fails, never skips,
// when either is missing.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { sha256 } from '../../src/canonical.ts';
import { canonicalCaseHash } from '../../src/cases.ts';
import { behaviorKey, computeDigests, effectiveConfig } from '../../src/digest.ts';
import { evaluateCase } from '../../src/evidence.ts';
import { evaluateIdentity } from '../../src/identity.ts';
import type { CaseRecord, ClassificationChange, Configuration, EnvironmentDef, EvidenceRecord, Mapping } from '../../src/model.ts';
import { normalize } from '../../src/normalize.ts';
import { effectiveClassification } from '../../src/dispositions.ts';
import { browsersOf, readInvocation, runStatus, type InvocationObservation } from '../../src/run-observation.ts';
import { excludedListed, execute, planSuite, probeInvocation, type Invocation, type SuitePlanInput } from '../../src/run-plan.ts';
import { startSite, type FixtureSite } from '../fixtures/site/server.ts';
import { installed, stageSuite, VERSIONS, type Version } from './harness.ts';

let site: FixtureSite;
before(async () => {
  site = await startSite();
});
after(async () => {
  await site.close();
});

const QA = { name: 'Quinn QA', standIn: true };
const ROLES = { qa: [QA] };
const CONFIGS: Configuration[] = [
  { id: 'desktop@1440', project: 'desktop', viewport: { width: 1440, height: 900 }, role: 'anonymous' },
  { id: 'desktop@900', project: 'desktop', viewport: { width: 900, height: 900 }, role: 'anonymous' },
  { id: 'desktop@1280', project: 'desktop', viewport: { width: 1280, height: 720 }, role: 'anonymous' },
];

function caseOf(id: string, configurations: string[], steps: Record<string, string[]>): CaseRecord {
  const record: CaseRecord = {
    id,
    aliases: [],
    track: 'regression',
    title: id,
    preconditions: 'The fixture page is published.',
    steps: Object.entries(steps).map(([sid, obs]) => ({ id: sid, text: sid, obligations: obs.map((o) => ({ id: o, text: o, layer: 'served' as const })) })),
    priority: 'p1',
    configurations,
    refs: ['EXAMPLE-1'],
    fixture: null,
    configurationDependent: false,
    provenance: { draftedFrom: 'ticket', independentRefs: ['EXAMPLE-1'], selfDerivedAcceptedBy: null },
    approval: null,
  };
  record.approval = { by: QA.name, role: 'qa', standIn: true, on: '2026-10-09', hash: canonicalCaseHash(record) };
  return record;
}

const ACC = caseOf('EX-ACC-001', ['desktop@1440', 'desktop@900'], { S1: ['O1', 'O2'] });
const CASES = [
  ACC,
  caseOf('EX-HOME-001', ['desktop@1280'], { S1: ['O1'] }),
  caseOf('EX-HOME-002', ['desktop@1280'], { S1: ['O1'] }),
  caseOf('EX-HOME-003', ['desktop@1280'], { S1: ['O1'] }),
  caseOf('EX-NAV-001', ['desktop@1280'], { S1: ['O1', 'O2'] }),
];
const ACC_TESTS = [1440, 900].map((w) => ({ suite: 'example', file: 'tests/accordion.spec.ts', titlePath: [`accordion at ${w}`, 'component title is serif and item rows are sans-serif'] }));
const mappings: Mapping[] = [
  ...ACC_TESTS.flatMap((t, i) => ['O1', 'O2'].map((o) => ({ obligation: { case: ACC.id, step: 'S1', obligation: o }, test: t, configuration: i === 0 ? 'desktop@1440' : 'desktop@900', layer: 'served' as const }))),
  { obligation: { case: 'EX-HOME-001', step: 'S1', obligation: 'O1' }, test: { suite: 'example', file: 'tests/scenarios.spec.ts', titlePath: ['home heading is visible (flaky)'] }, configuration: 'desktop@1280', layer: 'served' },
  { obligation: { case: 'EX-HOME-002', step: 'S1', obligation: 'O1' }, test: { suite: 'example', file: 'tests/scenarios.spec.ts', titlePath: ['known defect: heading reads Welcome'] }, configuration: 'desktop@1280', layer: 'served' },
  { obligation: { case: 'EX-HOME-003', step: 'S1', obligation: 'O1' }, test: { suite: 'example', file: 'tests/scenarios.spec.ts', titlePath: ['skipped at runtime'] }, configuration: 'desktop@1280', layer: 'served' },
  ...['O1', 'O2'].map((o) => ({ obligation: { case: 'EX-NAV-001', step: 'S1', obligation: o }, test: { suite: 'example', file: 'tests/scenarios.spec.ts', titlePath: ['navigation link and heading'] }, configuration: 'desktop@1280', layer: 'served' as const })),
];

const env = (): EnvironmentDef => ({ id: 'local', kind: 'local-candidate', baseUrl: site.url, baseUrlEnv: 'EXAMPLE_BASE_URL' });
const SHELL = (extra: Record<string, string> = {}) => ({ PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', EXAMPLE_BASE_URL: 'http://wrong-host.invalid', ...extra });

function suiteInput(root: string, runDir: string, extra: Partial<SuitePlanInput> = {}): SuitePlanInput {
  return { suite: 'example', config: join(root, 'playwright.config.ts'), rules: [], environment: env(), runDir, reporter: join(root, 'support/test-lab/reporter.ts'), projects: ['desktop'], secretOptions: [], ...extra };
}

async function probe(input: SuitePlanInput, shell = SHELL()) {
  const inv = probeInvocation(input);
  await execute(inv, { inherit: shell });
  const obs = readInvocation({ id: inv.id, suite: input.suite, dir: inv.dir });
  assert.ok(obs.begin !== null, `the probe wrote no begin record: ${JSON.stringify(obs.problems)}`);
  return { inv, begin: obs.begin };
}

async function runPlan(input: SuitePlanInput, extraShell: Record<string, string> = {}, purpose: 'run' | 'discover' = 'run'): Promise<{ inv: Invocation; obs: InvocationObservation; stdout: string }> {
  const { begin } = await probe(input, SHELL(extraShell));
  const plan = planSuite(input, begin, purpose);
  assert.ok(plan.ok, plan.ok ? '' : plan.refusals.join('; '));
  const done = await execute(plan.invocation, { inherit: SHELL(extraShell), timeoutMs: 180_000 });
  const obs = readInvocation({ id: plan.invocation.id, suite: input.suite, dir: plan.invocation.dir });
  return { inv: plan.invocation, obs, stdout: done.stdout + done.stderr };
}

const ALL = 'flaky,expected-fail,unexpected-pass,runtime-skip,step-skip,governed-fail';

for (const version of VERSIONS) {
  describe(`Playwright ${version}`, { concurrency: false }, () => {
    test('is installed for the compatibility tests', () => assert.ok(installed(version as Version), `run npm ci in tests/playwright/pw-${version}`));

    test('the full scenario run round-trips every outcome through the real ledger', async () => {
      const s = stageSuite(version);
      try {
        const runDir = join(s.root, 'run');
        const { inv, obs, stdout } = await runPlan(suiteInput(s.root, runDir), { EXAMPLE_SCENARIOS: ALL, EXAMPLE_RETRIES: '1' });
        // All three reports, in the invocation's own folder, and no report server.
        for (const f of ['steps.jsonl', 'playwright.json', 'html/index.html']) assert.ok(existsSync(join(inv.dir, f)), f);
        assert.doesNotMatch(stdout, /Serving HTML report/);
        // The completion record is last, and the run's status is explained by its results.
        const lines = readFileSync(join(inv.dir, 'steps.jsonl'), 'utf8').trim().split('\n');
        assert.equal(JSON.parse(lines.at(-1) as string).type, 'completion');
        assert.equal(obs.completion?.finalStatus, 'failed');
        assert.deepEqual(runStatus({ invocations: [obs] }).problems, []);
        // The effective base URL is the profile's, though the shell pointed elsewhere.
        const id = evaluateIdentity({ environment: env(), appRoot: s.root, before: null, after: null, ddevDescribe: null, drushConfigStatus: null, knownConfigOverrides: [], effectiveBaseUrls: obs.begin?.projects.map((p) => String(p.use['baseURL'])) ?? [], database: { source: null, pulledAt: null }, buildProbe: null });
        assert.equal(id.checks.find((c) => c.name === 'base-url')?.status, 'matched');

        const n = normalize({
          run: { invocations: [obs] },
          configurations: CONFIGS,
          cases: new Map(CASES.map((c) => [c.id, c])),
          required: { regression: CASES.map((c) => c.id), addendum: [] },
          ledger: mappings,
          classification: [],
          liveQuarantines: [],
          quarantinesOnRequired: [],
          roleOverrideFiles: new Set(),
        });
        const outcome = (id: string, config: string) => n.required.find((r) => r.case === id && r.configuration === config)?.outcome;
        // Duplicate test titles in two describe blocks stay two tests, each at its own viewport.
        assert.equal(outcome(ACC.id, 'desktop@1440'), 'passed', JSON.stringify([n.required.filter((r) => r.case === ACC.id), n.tests.map((t) => [t.test, t.lane, t.outcome, t.observed])]));
        assert.equal(outcome(ACC.id, 'desktop@900'), 'passed');
        // The suite config asks for one retry; test-lab's planner always runs --retries=0 (phase 1), so the
        // test that passes only on retry fails on its single attempt.
        assert.ok(inv.argv.includes('--retries=0'));
        assert.ok(obs.begin?.projects.every((p) => p.retries === 0), JSON.stringify(obs.begin?.projects.map((p) => p.retries)));
        assert.equal(outcome('EX-HOME-001', 'desktop@1280'), 'failed');
        assert.equal(outcome('EX-HOME-002', 'desktop@1280'), 'expected-failure');
        assert.equal(outcome('EX-HOME-003', 'desktop@1280'), 'skipped');
        const nav = n.required.find((r) => r.case === 'EX-NAV-001');
        assert.equal(nav?.obligations.find((o) => o.ref.obligation === 'O1')?.outcome, 'passed');
        assert.equal(nav?.obligations.find((o) => o.ref.obligation === 'O2')?.outcome, 'skipped');
        assert.equal(nav?.outcome, 'skipped');
        const byTitle = (t: string) => n.tests.find((x) => x.test.titlePath.at(-1) === t);
        assert.equal(byTitle('known defect that is fixed')?.outcome, 'failed', 'an unexpected pass is a failure');
        assert.equal(byTitle('known defect that is fixed')?.lane, 'governed');
        assert.equal(byTitle('home heading reads Welcome')?.lane, 'governed');
        assert.equal(byTitle('home heading reads Welcome')?.failure?.classPrefill, 'application error');
        // The viewport each step really ran under, read from the page.
        const acc = obs.tests.find((t) => t.identity.titlePath[0] === 'accordion at 900');
        assert.deepEqual(acc?.results[0]?.steps.find((x) => x.ids !== null)?.ids?.viewport, { width: 900, height: 900 });
        assert.ok(browsersOf(obs).get('desktop')?.version);
      } finally {
        s.cleanup();
      }
    });

    test('a retry pass written by Playwright itself, outside the planner, still normalizes as flaky', async () => {
      const s = stageSuite(version);
      try {
        const input = suiteInput(s.root, join(s.root, 'run'));
        const { begin } = await probe(input, SHELL({ EXAMPLE_SCENARIOS: 'flaky' }));
        const plan = planSuite(input, begin, 'run');
        assert.ok(plan.ok);
        // Deliberately not the planner's argv: this models a suite run with QA's CI retries.
        const retried = { ...plan.invocation, argv: plan.invocation.argv.map((a) => (a === '--retries=0' ? '--retries=1' : a)) };
        await execute(retried, { inherit: SHELL({ EXAMPLE_SCENARIOS: 'flaky' }), timeoutMs: 180_000 });
        const obs = readInvocation({ id: retried.id, suite: input.suite, dir: retried.dir });
        const n = normalize({ run: { invocations: [obs] }, configurations: CONFIGS, cases: new Map(CASES.map((c) => [c.id, c])), required: { regression: ['EX-HOME-001'], addendum: [] }, ledger: mappings, classification: [], liveQuarantines: [], quarantinesOnRequired: [], roleOverrideFiles: new Set() });
        assert.equal(n.required.find((r) => r.case === 'EX-HOME-001')?.outcome, 'flaky');
      } finally {
        s.cleanup();
      }
    });

    test('the deepest failing obligation is credited, and the parent step carries the error too', async () => {
      const s = stageSuite(version);
      try {
        const { obs } = await runPlan(suiteInput(s.root, join(s.root, 'run')), { EXAMPLE_MUTATION: 'rows' });
        const result = obs.tests.find((t) => t.identity.titlePath[0] === 'accordion at 1440')?.results[0];
        const failed = result?.steps.filter((x) => x.status === 'failed') ?? [];
        assert.deepEqual(failed.map((x) => [x.depth, x.ids?.obligation ?? null]).sort(), [[0, null], [1, 'O2']]);
      } finally {
        s.cleanup();
      }
    });

    test('global teardown throwing while every test passes is a run-level error, and completion is still last', async () => {
      const s = stageSuite(version);
      try {
        const { obs } = await runPlan(suiteInput(s.root, join(s.root, 'run')), { EXAMPLE_TEARDOWN_THROWS: '1' });
        assert.equal(obs.completion?.finalStatus, 'failed');
        const problems = runStatus({ invocations: [obs] }).problems;
        assert.ok(problems.some((p) => p.kind === 'run-error' && /EXAMPLE_GLOBAL_TEARDOWN_ERROR/.test(p.error.message)), JSON.stringify(problems));
        assert.ok(obs.tests.every((t) => t.results.every((r) => r.status === 'passed')));
      } finally {
        s.cleanup();
      }
    });

    test('a global timeout and a killed run are both incomplete; results reached before them stay visible', async () => {
      const s = stageSuite(version);
      try {
        const timed = await runPlan(suiteInput(s.root, join(s.root, 'timed'), { extraArgs: ['--global-timeout=8000'] }), { EXAMPLE_SCENARIOS: 'slow' });
        assert.equal(timed.obs.completion?.finalStatus, 'timedout');
        assert.ok(runStatus({ invocations: [timed.obs] }).problems.some((p) => p.kind === 'timed-out'));

        const input = suiteInput(s.root, join(s.root, 'killed'));
        const { begin } = await probe(input);
        const plan = planSuite(input, begin);
        assert.ok(plan.ok);
        const [command, ...args] = plan.invocation.argv as [string, ...string[]];
        const child = spawn(command, args, { cwd: plan.invocation.cwd, detached:ownProcessGroup, env: { ...SHELL({ EXAMPLE_SCENARIOS: 'slow' }), ...plan.invocation.env }, stdio: 'ignore' });
        const ledger = join(plan.invocation.dir, 'steps.jsonl');
        for (let i = 0; i < 300 && !(existsSync(ledger) && readFileSync(ledger, 'utf8').includes('"type":"result"')); i++) await new Promise((r) => setTimeout(r, 100));
        await stopProcessTree(child);
        const obs = readInvocation({ id: plan.invocation.id, suite: 'example', dir: plan.invocation.dir });
        assert.equal(obs.completion, null);
        assert.ok(obs.tests.some((t) => t.results.some((r) => r.status === 'passed')), 'the earlier passes stay visible');
        assert.ok(runStatus({ invocations: [obs] }).problems.some((p) => p.kind === 'completion-missing'));
      } finally {
        s.cleanup();
      }
    });

    test('excluded projects and paths never load during discovery or the run', async () => {
      const prodSpec = "import { test } from '@playwright/test';\nimport { appendFileSync } from 'node:fs';\nappendFileSync(process.env.LOADED_MARKER!, 'loaded\\n');\ntest('purge the production cache', async () => {});\n";
      const config = (projects: string) =>
        `import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests', workers: 1, use: { baseURL: process.env.EXAMPLE_BASE_URL, httpCredentials: { username: 'u', password: 'secret-value' } }, projects: [${projects}] });\n`;
      const s = stageSuite(version, {
        'tests/prod/purge.spec.ts': prodSpec,
        'playwright.config.ts': config("{ name: 'desktop', testIgnore: /prod/ }, { name: 'prod', testMatch: /prod\\/.*\\.spec\\.ts/ }"),
        'playwright.dep.config.ts': config("{ name: 'prod', testMatch: /prod\\/.*\\.spec\\.ts/ }, { name: 'desktop', testIgnore: /prod/, dependencies: ['prod'] }"),
        'playwright.glob.config.ts': config("{ name: 'desktop' }"),
      });
      try {
        const marker = join(s.root, 'loaded.txt');
        const shell = { LOADED_MARKER: marker };
        const by = (to: ClassificationChange['to'], target: ClassificationChange['target']): ClassificationChange => ({ id: JSON.stringify(target), target, from: null, to, by: QA.name, role: 'qa', standIn: true, at: '2026-10-09', reason: 'writes to production' });

        // A whole excluded suite is never invoked, not even to list it.
        const suiteRules = effectiveClassification([by('excluded', { suite: 'example' })], ROLES).rules;
        const refused = planSuite(suiteInput(s.root, join(s.root, 'r0'), { rules: suiteRules }), (await probe(suiteInput(s.root, join(s.root, 'p0')), SHELL(shell))).begin);
        assert.equal(refused.ok, false);

        // An excluded project: the probe loads no spec, and the run selects only the governed project.
        const projectRules = effectiveClassification([by('governed', { suite: 'example' }), by('excluded', { suite: 'example', project: 'prod' })], ROLES).rules;
        const probed = await probe(suiteInput(s.root, join(s.root, 'p1')), SHELL(shell));
        assert.equal(existsSync(marker), false, 'the config-only probe loaded a spec');
        assert.deepEqual(probed.begin.projects.map((p) => p.name).sort(), ['desktop', 'prod']);
        assert.deepEqual(probed.begin.projects[0]?.use['httpCredentials'], { secret: true, present: true }, 'secret options are never written');
        const run = await runPlan(suiteInput(s.root, join(s.root, 'r1'), { rules: projectRules }), shell);
        assert.equal(existsSync(marker), false, 'an excluded project ran');
        assert.ok(run.obs.tests.length > 0);
        assert.deepEqual(excludedListed(projectRules, 'example', run.obs.begin as NonNullable<typeof run.obs.begin>), []);

        // A selected project that depends on an excluded one is refused before anything runs.
        const depInput = suiteInput(s.root, join(s.root, 'r2'), { rules: projectRules, config: join(s.root, 'playwright.dep.config.ts') });
        const depPlan = planSuite(depInput, (await probe(depInput, SHELL(shell))).begin);
        assert.equal(depPlan.ok, false);
        assert.match(depPlan.ok ? '' : depPlan.refusals.join(' '), /depends on excluded project prod/);
        assert.equal(existsSync(marker), false);

        // A path-glob exclusion inside a selected project: its files are never named, so never loaded.
        const globRules = effectiveClassification([by('governed', { suite: 'example' }), by('excluded', { suite: 'example', glob: 'tests/prod/**' })], ROLES).rules;
        const globInput = suiteInput(s.root, join(s.root, 'r3'), { rules: globRules, config: join(s.root, 'playwright.glob.config.ts') });
        const listed = await runPlan(globInput, shell, 'discover');
        assert.equal(existsSync(marker), false, 'discovery loaded an excluded file');
        assert.ok(listed.obs.begin !== null && listed.obs.begin.tests.length > 0);
        assert.deepEqual(excludedListed(globRules, 'example', listed.obs.begin), []);
        await runPlan(globInput, shell);
        assert.equal(existsSync(marker), false, 'the run loaded an excluded file');

        // Control: without the exclusion, the same discovery does load it.
        await runPlan(suiteInput(s.root, join(s.root, 'r4'), { config: join(s.root, 'playwright.glob.config.ts') }), shell, 'discover');
        assert.equal(existsSync(marker), true, 'the control should load the production spec');
      } finally {
        s.cleanup();
      }
    });

    test('a config that ignores the base-URL variable is caught by the effective base URL', async () => {
      const s = stageSuite(version, { 'playwright.hard.config.ts': "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests', use: { baseURL: 'http://127.0.0.1:9' }, projects: [{ name: 'desktop' }] });\n" });
      try {
        const { begin } = await probe(suiteInput(s.root, join(s.root, 'p'), { config: join(s.root, 'playwright.hard.config.ts') }));
        const id = evaluateIdentity({ environment: env(), appRoot: s.root, before: null, after: null, ddevDescribe: null, drushConfigStatus: null, knownConfigOverrides: [], effectiveBaseUrls: begin.projects.map((p) => String(p.use['baseURL'])), database: { source: null, pulledAt: null }, buildProbe: null });
        assert.equal(id.checks.find((c) => c.name === 'base-url')?.status, 'mismatch');
      } finally {
        s.cleanup();
      }
    });

    test('a red check, restored run and burn-in written by Playwright verify the accordion through receipts', async () => {
      // Certification uses environment-independent tests/helpers. Seed the served application fault
      // instead of allowing an unbound worker environment variable to control the test's behavior.
      const s = stageSuite(version, {
        'playwright.config.ts': `import {defineConfig} from '@playwright/test';import {appearance} from './support/helpers/appearance';export default defineConfig({testDir:'./tests',workers:1,timeout:15000,use:{baseURL:${JSON.stringify(site.url)},...appearance()},projects:[{name:'desktop',use:{browserName:'chromium',viewport:{width:1280,height:720}}}]});`,
        'support/helpers/accordion-page.ts': readFileSync(join(import.meta.dirname, 'suite/support/helpers/accordion-page.ts'), 'utf8').replace("process.env.EXAMPLE_MUTATION ?? ''", "''"),
      });
      try {
        const evidenceDir = join(s.root, '.test-lab', 'evidence');
        const recipesDir = join(s.root, '.test-lab', 'recipes');
        mkdirSync(join(evidenceDir, 'ledgers'), { recursive: true });
        mkdirSync(recipesDir, { recursive: true });
        const keep = (from: string, name: string) => {
          copyFileSync(join(from, 'steps.jsonl'), join(evidenceDir, 'ledgers', name));
          return { path: `ledgers/${name}`, sha256: sha256(readFileSync(join(evidenceDir, 'ledgers', name))) };
        };
        const title = ['--grep', 'accordion at 1440'];
        const restored = await runPlan(suiteInput(s.root, join(s.root, 'restored'), { extraArgs: title }));
        const burn = await runPlan(suiteInput(s.root, join(s.root, 'burn'), { extraArgs: [...title, '--repeat-each', '5', '--fail-on-flaky-tests'] }));
        const recipes: Record<string, string> = {};
        const mutated: Record<string, { path: string; sha256: string }> = {};
        for (const [o, mutation] of [['O1', 'title'], ['O2', 'rows']] as const) {
          site.setAccordionMutation(mutation);
          const m = await runPlan(suiteInput(s.root, join(s.root, `mutated-${o}`), { extraArgs: title }));
          site.setAccordionMutation('');
          mutated[o] = keep(m.inv.dir, `mutated-${o}.jsonl`);
          const recipe = JSON.stringify({ format: 1, obligation: { case: ACC.id, step: 'S1', obligation: o }, technique: 'seeded-site-mutant', mutation });
          const hash = sha256(recipe);
          writeFileSync(join(recipesDir, `${hash}.json`), recipe);
          recipes[o] = `sha256:${hash}`;
        }
        const restoredRef = keep(restored.inv.dir, 'restored.jsonl');
        const burnRef = keep(burn.inv.dir, 'burn.jsonl');
        const begin = restored.obs.begin as NonNullable<typeof restored.obs.begin>;
        const test = ACC_TESTS[0] as (typeof ACC_TESTS)[number];
        const digests = computeDigests({ suite: 'example', suiteRoot: s.root, begin, cases: new Map([[ACC.id, ACC]]), ledger: mappings, declaredInputs: [], declaredBaselines: [], kitDir: join(s.root, 'support/test-lab') });
        const key = behaviorKey(test, 'desktop');
        const behavior = digests.behavior.get(key);
        assert.ok(behavior?.status === 'resolved', JSON.stringify(behavior));
        assert.ok(digests.toolchain.status === 'resolved', JSON.stringify(digests.toolchain));
        const bound = { environment: { id: env().id, kind: env().kind, baseUrl: env().baseUrl }, behaviorDigest: behavior.digest, toolchainDigest: digests.toolchain.digest, appliesTo: [], at: '2026-10-09' };
        const records: EvidenceRecord[] = [
          ...(['O1', 'O2'] as const).map((o) => ({ kind: 'red-check' as const, id: `red-${o}`, obligation: { case: ACC.id, step: 'S1', obligation: o }, test, configuration: 'desktop@1440', recipeHash: recipes[o] as string, mutated: mutated[o] as { path: string; sha256: string }, restored: restoredRef, ...bound })),
          { kind: 'burn-in', id: 'burn', test, configuration: 'desktop@1440', run: burnRef, ...bound },
          { kind: 'acceptance', id: 'acc', test, case: ACC.id, caseHash: canonicalCaseHash(ACC), behaviorDigest: behavior.digest, by: QA.name, role: 'qa', standIn: true, at: '2026-10-09' },
        ];
        const accAt1440 = { ...ACC, configurations: ['desktop@1440'] };
        accAt1440.approval = { ...(ACC.approval as NonNullable<CaseRecord['approval']>), hash: canonicalCaseHash(accAt1440) };
        const ctx = {
          evidenceDir,
          recipesDir,
          records: records.map((r) => (r.kind === 'acceptance' ? { ...r, caseHash: canonicalCaseHash(accAt1440) } : r)),
          digests,
          environment: { id: env().id, kind: env().kind, baseUrl: env().baseUrl },
          effective: effectiveConfig(begin, browsersOf(restored.obs)),
          configurations: CONFIGS,
          ledger: mappings,
          dispositions: [],
          roles: ROLES,
          materialFields: ['browserName' as const, 'browserVersion' as const, 'channel' as const, 'headless' as const, 'retries' as const],
        };
        const e = evaluateCase(accAt1440, 'regression', ctx);
        assert.equal(e.status, 'verified', JSON.stringify(e.mappings.map((m) => m.reasons)));

        // The historical inverse fails in the title step first: it can stand for O1, never for O2.
        site.setAccordionMutation('inverse');
        const inverse = await runPlan(suiteInput(s.root, join(s.root, 'inverse'), { extraArgs: title }));
        site.setAccordionMutation('');
        const inverseRef = keep(inverse.inv.dir, 'inverse.jsonl');
        const swapped = evaluateCase(accAt1440, 'regression', { ...ctx, records: ctx.records.map((r) => (r.kind === 'red-check' && r.obligation.obligation === 'O2' ? { ...r, mutated: inverseRef } : r)) });
        assert.equal(swapped.mappings.find((m) => m.ref.obligation === 'O2')?.sensitivity, 'unverified');
      } finally {
        site.setAccordionMutation('');
        s.cleanup();
      }
    });
  });
}
