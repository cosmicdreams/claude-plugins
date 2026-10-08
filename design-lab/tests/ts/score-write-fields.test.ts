import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as S from '../../src/score-run.ts';
import type { RunComparison } from '../../src/score-run.ts';
import type { Json } from '../../src/run-metrics.ts';

// Never the person's real home, Claude configuration or design-lab folder.
const scratch = mkdtempSync('/tmp/design-lab-score-fields-');
process.env['HOME'] = join(scratch, 'home');
process.env['DESIGN_LAB_HOME'] = join(scratch, 'design-lab-home');
delete process.env['CLAUDE_CONFIG_DIR'];
let root = '';
beforeEach(() => {
  root = mkdtempSync(join(scratch, 'case-'));
});

const write = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};
const lines = (path: string, records: unknown[]): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
};
const noServer = async () => ({ stopped: false, pid: null });
const stubRender = async () => '<html>report</html>';

/** A manifest as 0.14 wrote it: no run identity block. */
function project(extra: Json = {}): Json {
  return {
    schemaVersion: 1,
    standardVersion: '4.0.0',
    pluginVersion: '0.14.0',
    createdAt: '2026-01-05T10:00:00+00:00',
    repository: { root: '/repo/mytheme', commit: 'abc1234def', dirty: false },
    target: { figmaFileKey: 'KEY1', figmaUrl: 'https://www.figma.com/design/KEY1' },
    decisions: { componentSource: 'sdc', tokenSource: 'css-custom-properties', usageSource: 'none' },
    phases: {
      discovery: { status: 'complete', updatedAt: '2026-01-05T10:00:01+00:00' },
      plan: { status: 'approved', updatedAt: '2026-01-05T10:20:00+00:00' },
    },
    artifacts: {},
    ...extra,
  };
}

/** Scores and writes the run through the real writeScore(); the scorecard is written only when it validates. */
const scoreRun = (run: string, options: Partial<S.WriteScoreOptions> = {}): Promise<S.WriteScoreResult> =>
  S.writeScore(run, { warn: () => {}, out: join(root, 'out'), render: stubRender, stopServer: noServer, ...options });

// 1. No project.json: identity reason, and the cost section's reason (the same not-measured shape).
void test('writeScore accepts a run with no project.json (identity and cost reasons)', async () => {
  const run = join(root, 'run');
  mkdirSync(run, { recursive: true });
  const result = await scoreRun(run);
  assert.deepEqual(result.errors, []);
  assert.equal(result.code, 0);
});

// 2. No components, plan or index files: library reason.
void test('writeScore accepts a run with no components, plan or index (library reason)', async () => {
  const run = join(root, 'run');
  write(join(run, 'project.json'), project());
  const result = await scoreRun(run);
  assert.deepEqual(result.errors, []);
  assert.equal(result.code, 0);
});

// 3. --compare with a second run, not a shared build: repeatability levelNote and minScore.
void test('writeScore accepts --compare repeatability (levelNote and minScore)', async () => {
  const run = join(root, 'run'),
    other = join(root, 'other');
  write(join(run, 'project.json'), project());
  write(join(other, 'project.json'), project());
  const compareRuns = async (): Promise<RunComparison> => ({
    summary: { score: 98.5, total_nodes: 10, identical_nodes: 9, matched_nodes: 10, category_counts: {} },
    artifacts: {},
    page_differences: {},
    pages: { order_equal: true },
  });
  const result = await scoreRun(run, { compare: [other], compareRuns });
  assert.deepEqual(result.errors, []);
  assert.equal(result.code, 0);
  const repeatability = result.scorecard.sections.repeatability;
  assert.ok('levelNote' in repeatability);
  assert.match(repeatability.levelNote, /beyond timestamps/);
  assert.equal(repeatability.minScore, 98.5);
});

// 4. --transcripts naming a folder: caveat on cost.model and cost.working.
void test('writeScore accepts --transcripts folders (caveat on model and working)', async () => {
  const run = join(root, 'run'),
    folder = join(root, 'transcripts');
  write(join(run, 'project.json'), project());
  lines(join(folder, 'session-a.jsonl'), [
    {
      type: 'assistant',
      timestamp: '2026-01-05T10:05:00+00:00',
      sessionId: 'session-a',
      message: { id: 'msg-1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [] },
    },
  ]);
  const result = await scoreRun(run, { transcripts: folder });
  assert.deepEqual(result.errors, []);
  assert.equal(result.code, 0);
  const model = result.scorecard.sections.cost.model;
  assert.equal(model.status, 'measured');
  assert.match(model.caveat ?? '', /every session in the folder/);
});

// 5. --session current with two sessions written during the run: cost.developer.sessionWarning.
void test('writeScore accepts --session current with several sessions (sessionWarning)', async () => {
  const run = join(root, 'run'),
    folder = join(root, 'transcripts');
  write(
    join(run, 'project.json'),
    project({ run: { startedAt: '2026-01-05T10:00:00+00:00', claude: { transcripts: folder } } }),
  );
  const record = [
    { type: 'user', timestamp: '2026-01-05T10:05:00+00:00', message: { role: 'user', content: 'build it' } },
  ];
  lines(join(folder, 'sess-a.jsonl'), record);
  lines(join(folder, 'sess-b.jsonl'), record);
  const result = await scoreRun(run, { session: 'current' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.code, 0);
  assert.match(result.scorecard.sections.cost.developer?.sessionWarning ?? '', /newest of 2 sessions/);
});

// Varied inputs for the other-writers check: the same writer on the paths that do not write these fields.
void test('writeScore accepts a measured library and a shared-build repeatability', async () => {
  const run = join(root, 'run'),
    other = join(root, 'other');
  write(join(run, 'project.json'), project());
  write(join(other, 'project.json'), project());
  write(join(run, 'components.json'), { components: [{ id: 'mytheme.card', label: 'Card' }] });
  write(join(run, 'plan.json'), {
    plans: [{ id: 'mytheme.card', verdict: 'build', variants: 3, properties: [{ field: 'title' }] }],
  });
  write(join(run, 'index.json'), { totals: { components: 1, built: 1, notBuilt: 0 }, rows: [], notBuilt: [] });
  const same = { present: [true, true], normalized_equal: true, differences: [] };
  const compareRuns = async (): Promise<RunComparison> => ({
    summary: { score: 100, total_nodes: 4, identical_nodes: 4, matched_nodes: 4, category_counts: {} },
    artifacts: { 'components.json': same, 'tokens.json': same, 'plan.json': same },
    page_differences: {},
    pages: { order_equal: true },
  });
  const result = await scoreRun(run, { compare: [other], compareRuns });
  assert.deepEqual(result.errors, []);
  assert.equal(result.code, 0);
  const repeatability = result.scorecard.sections.repeatability;
  assert.ok('levelNote' in repeatability);
  assert.match(repeatability.levelNote, /measures the Figma build/);
});

void test('writeScore accepts an explicit transcript file (no caveat)', async () => {
  const run = join(root, 'run'),
    file = join(root, 'transcripts', 'one.jsonl');
  write(join(run, 'project.json'), project());
  lines(file, [
    {
      type: 'assistant',
      timestamp: '2026-01-05T10:05:00+00:00',
      sessionId: 'one',
      message: { id: 'msg-1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [] },
    },
  ]);
  const result = await scoreRun(run, { transcripts: file });
  assert.deepEqual(result.errors, []);
  assert.equal(result.code, 0);
});

// The accuracy fields and identity fields the writer sets to null when its inputs are partial.
// Each case is written through the real writeScore() and must validate, or scoring exits 2.
const buildRecord = (run: string, pairs: unknown[]): void =>
  write(join(run, 'builds', 'card.json'), { id: 'card', visualEvidence: { comparison: { metrics: { pairs } } } });
const realRender = (options: Partial<S.WriteScoreOptions> = {}): Partial<S.WriteScoreOptions> => {
  const { render: _stub, ...rest } = { render: undefined, ...options };
  return rest;
};

void test('writeScore accepts accuracy recorded only in build records (no corrected measure, no height delta)', async () => {
  const run = join(root, 'run');
  write(join(run, 'project.json'), project());
  buildRecord(run, [{ label: 'desktop', ratio: 0.1, pass: true, width: 1200 }]);
  const result = await S.writeScore(run, {
    warn: () => {},
    out: join(root, 'out'),
    stopServer: noServer,
    ...realRender(),
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.code, 0);
  const accuracy = result.scorecard.sections.accuracy;
  assert.equal(accuracy.status, 'partial');
  assert.equal(accuracy.overall?.corrected, null);
  assert.equal(accuracy.byBreakpoint?.['desktop']?.corrected, null);
  assert.deepEqual(accuracy.byBreakpoint?.['desktop']?.heightDelta, { median: null, max: null, over10px: 0 });
  assert.equal(accuracy.pairs?.[0]?.widthDelta, null);
  assert.equal(accuracy.pairs?.[0]?.evidence, null);
});

void test('writeScore accepts a recorded comparison pair that has no ratio (null ratio summaries)', async () => {
  const run = join(root, 'run');
  write(join(run, 'project.json'), project());
  buildRecord(run, [{ label: 'desktop', pass: true, width: 1200, heightDelta: 3 }]);
  const result = await S.writeScore(run, {
    warn: () => {},
    out: join(root, 'out'),
    stopServer: noServer,
    ...realRender(),
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.code, 0);
  const original = result.scorecard.sections.accuracy.overall?.original;
  assert.deepEqual(original, { pass: 1, total: 1, medianRatio: null, p75Ratio: null, maxRatio: null });
  assert.deepEqual(result.scorecard.headline.accuracy.original, original);
});

void test('writeScore accepts a project manifest that predates run identity and a rebuild with a corpus label', async () => {
  const run = join(root, 'run');
  const { pluginVersion: _p, standardVersion: _s, repository, ...rest } = project() as Json & { repository: Json };
  const { dirty: _d, ...repo } = repository;
  write(join(run, 'project.json'), {
    ...rest,
    repository: repo,
    run: {
      startedAt: '2026-01-05T10:00:00+00:00',
      rebuiltFrom: { run: '/runs/earlier', createdAt: null, pluginVersion: null, corpusLabel: 'massport' },
    },
  });
  const result = await scoreRun(run);
  assert.deepEqual(result.errors, []);
  assert.equal(result.code, 0);
  const identity = result.scorecard.sections.identity;
  assert.ok('fields' in identity);
  assert.equal(identity.fields.pluginVersion, null);
  assert.equal(identity.fields.standardVersion, null);
  assert.equal(identity.fields.repositoryDirty, null);
  assert.equal(identity.fields.rebuiltFrom?.corpusLabel, 'massport');
});

void test('writeScore accepts a library with only a plan and a run with no benchmark step (null found, null until, no median step)', async () => {
  const run = join(root, 'run'),
    file = join(root, 'transcripts', 'one.jsonl');
  write(join(run, 'project.json'), project({ run: { startedAt: '2026-01-05T10:00:00+00:00' } }));
  write(join(run, 'plan.json'), {
    plans: [{ id: 'mytheme.card', verdict: 'build', variants: 3, properties: [{ field: 'title' }] }],
  });
  write(join(run, 'index.json'), { notBuilt: [{ id: 'mytheme.hero' }] });
  lines(join(run, 'phase-log.jsonl'), [{ at: '2026-01-05T10:01:00+00:00', phase: 'preflight', status: 'complete' }]);
  mkdirSync(join(run, 'figma'), { recursive: true });
  writeFileSync(join(run, 'figma', 'runner.log'), '2026-01-05T10:10:00+00:00 recorded block:card\n');
  // An assistant message without a timestamp: the transcript is measured but has no first or last message time.
  lines(file, [
    {
      type: 'assistant',
      sessionId: 'one',
      message: { id: 'msg-1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [] },
    },
  ]);
  const result = await scoreRun(run, { transcripts: file });
  assert.deepEqual(result.errors, []);
  assert.equal(result.code, 0);
  const { library, cost } = result.scorecard.sections;
  assert.ok('components' in library);
  assert.equal(library.components.found, null);
  assert.equal(library.components.notBuilt, null);
  assert.ok('runner' in cost && 'medianStepSeconds' in cost.runner);
  assert.equal(cost.runner.medianStepSeconds, null);
  assert.ok('until' in cost.unattended);
  assert.equal(cost.unattended.until, null);
  assert.equal(cost.model.firstMessage, null);
});
