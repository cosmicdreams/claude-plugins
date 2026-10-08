import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { sharedRequire } from '../../src/runtime.ts';
import * as S from '../../src/score-run.ts';
import { counts, coverageSentence } from '../../src/library-counts.ts';
import { tokens, elapsedTime, obj } from '../../src/run-metrics.ts';
import type { Json } from '../../src/run-metrics.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;

// Never the person's real home, Claude configuration or design-lab folder.
const scratch = mkdtempSync('/tmp/design-lab-score-test-');
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
const quiet = { warn: () => {} };
const noServer = async () => ({ stopped: false, pid: null });
const stubRender = async () => '<html>report</html>';

/** A manifest as 0.14 wrote it: no run identity block. */
function legacyProject<E extends object = Record<never, never>>(extra: E = {} as E) {
  return {
    schemaVersion: 1 as const,
    standardVersion: '4.0.0',
    pluginVersion: '0.14.0',
    createdAt: '2026-01-05T10:00:00+00:00',
    repository: { root: '/repo/mytheme', commit: 'abc1234def', dirty: false },
    target: { figmaFileKey: 'KEY1', figmaUrl: 'https://www.figma.com/design/KEY1' },
    decisions: { componentSource: 'sdc', tokenSource: 'css-custom-properties', usageSource: 'none' },
    phases: {
      discovery: { status: 'complete', updatedAt: '2026-01-05T10:00:01+00:00' },
      plan: { status: 'approved', updatedAt: '2026-01-05T10:20:00+00:00' },
      verify: { status: 'pending' },
    },
    artifacts: {},
    ...extra,
  };
}

/** One component, card, measured at two widths; its master is 30 px too short at mobile. */
async function makeRun(base: string): Promise<string> {
  const run = join(base, 'run');
  write(join(run, 'project.json'), legacyProject());
  write(join(run, 'components.json'), {
    components: [
      { id: 'mytheme.card', label: 'Card' },
      { id: 'mytheme.old', label: 'Old' },
    ],
  });
  write(join(run, 'plan.json'), {
    plans: [
      { id: 'mytheme.card', verdict: 'build', variants: 3, properties: [{ field: 'title' }] },
      { id: 'mytheme.old', verdict: 'refuse', variants: 1, properties: [] },
    ],
  });
  write(join(run, 'index.json'), {
    totals: { components: 2, built: 1, notBuilt: 1 },
    rows: [],
    notBuilt: [{ id: 'mytheme.old', label: 'Old', reason: 'retired' }],
  });
  write(join(run, 'figma/state.json'), {
    standardVersion: '4.1.0',
    planned: ['mytheme.card'],
    done: ['build:mytheme.card', 'block:mytheme.card'],
    siteUrl: 'https://mytheme.ddev.site',
    runtime: 'abc123',
  });
  write(join(run, 'foundation.json'), { pages: { Cover: '0:1' }, collections: { Core: { variables: 12 } } });
  write(join(run, 'figma/dump/Cover.json'), {
    page: 'Cover',
    pageIndex: 0,
    nodes: [{ path: 'Cover#0' }, { path: 'Cover#0/A#0' }],
  });
  const pixels = Buffer.alloc(400 * 300 * 3, 255);
  const rect = (x0: number, y0: number, x1: number, y1: number, rgb: number[]) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pixels.set(rgb, (y * 400 + x) * 3);
  };
  rect(0, 0, 99, 49, [0, 0, 0]);
  rect(0, 100, 99, 149, [0, 0, 0]);
  rect(0, 150, 99, 179, [0, 0, 128]);
  rect(200, 0, 299, 49, [0, 0, 0]);
  rect(200, 100, 299, 149, [0, 0, 0]);
  mkdirSync(join(run, 'figma/compare'), { recursive: true });
  await sharp(pixels, { raw: { width: 400, height: 300, channels: 3 } })
    .png()
    .toFile(join(run, 'figma/compare/mytheme.card.png'));
  write(join(run, 'figma/results/block_mytheme.card.json'), {
    geometry: {
      variants: [
        { label: 'Card · Mobile · 100px', x: 0, y: 0, width: 100, height: 50 },
        { label: 'Card', x: 200, y: 0, width: 100, height: 50 },
      ],
      captures: [
        { label: 'Capture · Mobile 100px', x: 0, y: 100, width: 100, height: 80 },
        { label: 'Capture · Desktop 100px', x: 200, y: 100, width: 100, height: 50 },
      ],
    },
  });
  writeFileSync(
    join(run, 'figma/runner.log'),
    '2026-01-05T11:00:00 serving pages (1/3)\n2026-01-05T11:00:02 recorded pages (2 remaining)\n' +
      '2026-01-05T11:00:02 serving build:mytheme.card (2/3)\n2026-01-05T11:00:12 recorded build:mytheme.card (1 remaining)\n' +
      '2026-01-05T11:00:12 error: nothing is not the current step\n2026-01-06T09:00:00 serving dump:Cover\n2026-01-06T09:00:01 recorded dump:Cover\n',
  );
  return run;
}

/** A synthetic Claude configuration folder: main session, one subagent and an unrelated session. */
function session(config: string, id = 'sess-1'): string {
  const project = join(config, 'projects/-repo-mytheme'),
    main = join(project, `${id}.jsonl`);
  const turn = (mid: string, model: string, usage: Json, tools = 0) => ({
    type: 'assistant',
    timestamp: '2020-01-01T00:00:00Z',
    sessionId: id,
    message: {
      id: mid,
      model,
      usage,
      content: Array.from({ length: tools }, (_, i) => ({ type: 'tool_use', id: `${mid}-t${i}` })),
    },
  });
  const big = { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 };
  const small = { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 };
  lines(main, [
    turn('a', 'claude-opus-5-5', big, 2),
    turn('a', 'claude-opus-5-5', big, 2),
    turn('b', 'claude-opus-5-5', big, 1),
  ]);
  lines(join(project, id, 'subagents/agent-1.jsonl'), [turn('c', 'claude-haiku-4-5-20251001', small, 1)]);
  lines(join(project, 'other-session.jsonl'), [turn('z', 'claude-fable-5-1', big)]);
  return main;
}

/** One transcript record, shaped like Claude Code's own. */
function entry(kind: string, at: string, extra: Json = {}): Json {
  const sessionId = extra['session'] ?? 'sess-w',
    base = { timestamp: at, sessionId, isSidechain: !!extra['sidechain'] };
  switch (kind) {
    case 'prompt':
      return { ...base, type: 'user', message: { role: 'user', content: extra['text'] ?? 'Build it' } };
    case 'result':
      return {
        ...base,
        type: 'user',
        toolUseResult: { stdout: 'ok' },
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
      };
    case 'step':
    case 'reply':
      return {
        ...base,
        type: 'assistant',
        message: {
          id: `m-${at}-${sessionId}`,
          model: extra['model'] ?? 'claude-opus-5-5',
          usage: { input_tokens: 10, output_tokens: 5 },
          content:
            kind === 'step'
              ? [{ type: 'tool_use', id: `t-${at}`, name: 'Bash', input: { command: extra['command'] ?? 'ls' } }]
              : [{ type: 'text', text: 'Done.' }],
        },
      };
    case 'ask':
      return {
        ...base,
        type: 'assistant',
        message: {
          id: `m-${at}`,
          model: 'claude-opus-5-5',
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [
            {
              type: 'tool_use',
              id: 'ask-1',
              name: extra['tool'] ?? 'AskUserQuestion',
              input: { questions: [{ question: 'Approve the plan?' }] },
              caller: {},
            },
          ],
        },
      };
    case 'answer':
      return {
        ...base,
        type: 'user',
        permissionMode: extra['mode'] ?? 'bypassPermissions',
        toolUseResult: { answers: { 'Approve the plan?': 'Yes' }, questions: [] },
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'ask-1', content: 'User has answered your questions' }],
        },
      };
    case 'meta':
      return { ...base, type: 'user', isMeta: true, message: { role: 'user', content: '<system-reminder>x' } };
    case 'limit':
      return {
        ...base,
        type: 'assistant',
        isApiErrorMessage: true,
        error: 'rate_limit',
        apiErrorStatus: 429,
        quotaLimits: { status: 'rejected', resetsAt: extra['resets'], rateLimitType: 'five_hour' },
        message: {
          id: `m-${at}`,
          model: '<synthetic>',
          content: [{ type: 'text', text: "You've hit your session limit · resets 11am" }],
        },
      };
    case 'overloaded':
      return {
        ...base,
        type: 'system',
        subtype: 'api_error',
        level: 'error',
        retryInMs: 536,
        retryAttempt: 1,
        error: {
          status: 529,
          formatted: '529 Overloaded',
          message: '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
        },
      };
  }
  throw new Error(kind);
}

// ---------------------------------------------------------------------------- sections

test('accuracy keeps the original metric and adds the corrected one', async () => {
  const run = await makeRun(root),
    card = await S.score(run, quiet);
  assert.deepEqual(S.validateScorecard(card), []);
  const acc = card.sections['accuracy'];
  assert.equal(acc['status'], 'measured');
  assert.equal(acc!['overall']!['original']!['pass']!, 2); // height ignored
  assert.equal(acc!['overall']!['corrected']!['pass']!, 1); // mobile now fails
  assert.equal(acc!['byBreakpoint']!['mobile']!['heightDelta']!['over10px']!, 1);
  const pair = acc!['pairs']!.find!((p) => p['breakpoint'] === 'mobile');
  assert.deepEqual([pair!['figmaHeight']!, pair!['liveHeight']!], [50, 80]);
  assert.ok(card.headline.highlights.some((h) => h.startsWith('Biggest single gap: Card at mobile is 30 px shorter')));
});

test('missing evidence is not measured, with a reason', async () => {
  const sections = (await S.score(await makeRun(root), quiet)).sections;
  for (const name of ['conformance', 'schemaChurn'] as const) {
    assert.equal(sections[name]['status'], 'not-measured');
    assert.ok(sections[name]['reason']);
  }
  assert.ok(!('interventions' in sections['cost']));
  assert.equal(sections['cost']['clock']['wallSeconds'], null); // no benchmark step recorded
  assert.match(sections['cost']['clock']['notShownBecause'] ?? '', /benchmark/);
  assert.equal(sections['cost']['working']['status'], 'not-measured');
  assert.equal(sections['cost']['model']['status'], 'not-measured');
  assert.equal(sections['repeatability']['status'], 'not-measured');
  assert.equal(sections['foundationsVoice']['status'], 'scored-later');
  assert.equal(sections['blindedJudgement']['criteria'].length, 4);
});

test('runner sessions, step time and errors come from the runner log', async () => {
  const runner = obj((await S.score(await makeRun(root), quiet)).sections['cost']['runner']);
  assert.equal(runner!['sessions']!.length!, 2);
  assert.deepEqual([runner!['sessions']![0]!['steps']!, runner!['sessions']![0]!['seconds']!], [2, 12]);
  assert.equal(runner['errors'], 1);
  assert.equal(runner!['secondsByKind']!['build']!, 10);
});

test('schema churn: a recorded change, and a confirmed absence of one', async () => {
  const run = await makeRun(root);
  write(
    join(run, 'project.json'),
    legacyProject({
      run: { schemaChurn: { changed: true, changes: [{ at: '2026-01-05T10:40:00+00:00', text: 'new slot kind' }] } },
    }),
  );
  let churn = (await S.score(run, quiet)).sections['schemaChurn'];
  assert.deepEqual(
    [churn['status'], churn['changed'], churn['changes']![0]!['text']],
    ['measured', true, 'new slot kind'],
  );
  write(join(run, 'project.json'), legacyProject({ run: { schemaChurn: { changed: false } } }));
  churn = (await S.score(run, quiet)).sections['schemaChurn'];
  assert.deepEqual([churn['status'], churn['changed']], ['measured', false]);
});

test('coverage counts eligible components and usage-weighted placements', async () => {
  const run = await makeRun(root);
  const comp = (id: string, placements = 0, refs = 0) => ({
    id,
    label: id.toUpperCase(),
    usage: { placements, structuralRefs: refs },
  });
  write(join(run, 'components.json'), {
    components: [comp('a', 6, 1), comp('b'), comp('c', 2, 3), comp('d'), comp('e')],
  });
  write(join(run, 'plan.json'), {
    plans: [
      { id: 'a', verdict: 'build', libraryRole: 'component' },
      { id: 'b', verdict: 'build', libraryRole: 'component' },
      { id: 'c', verdict: 'refuse', libraryRole: 'component', refuseReason: 'no capture' },
      { id: 'd', verdict: 'refuse', libraryRole: 'retirement' },
      { id: 'e', verdict: 'refuse', libraryRole: 'schema-only' },
    ],
  });
  write(join(run, 'figma/state.json'), { planned: ['a', 'b'], done: ['build:a', 'block:a', 'build:b'] });
  // usage.json also saw something outside the inventory; it must not enter the totals
  write(join(run, 'usage.json'), {
    usage: { a: { placements: 6, structuralRefs: 1 }, 'stray.script': { placements: 5, structuralRefs: 0 } },
  });
  const card = await S.score(run, quiet),
    cov = { ...card.sections.coverage, usageWeighted: obj(card.sections.coverage.usageWeighted) };
  assert.deepEqual([cov['found'], cov['eligible'], cov['built'], cov['ratio']], [5, 3, 1, 0.3333]);
  assert.deepEqual(cov['gap'], { refused: 1, failed: 1, unplanned: 0 });
  assert.deepEqual(cov['excluded'], { retirement: 1, 'schema-only': 1, 'not-visual': 0 });
  assert.equal(cov!['usageWeighted']!['ratio']!, 0.75);
  assert.deepEqual([cov!['usageWeighted']!['structuralCovered']!, cov!['usageWeighted']!['structuralRefs']!], [1, 4]);
  assert.deepEqual(cov['outsideInventory'], [{ id: 'stray.script', placements: 5, structural: 0 }]);
  assert.equal(card.headline.coverage!['placements'], 0.75);
  assert.equal(cov['summary'], 'Built 1 of 3 components it could have built (33%).');

  // Every refused count matches the coverage gap: retirement is not refusal.
  write(join(run, 'plan.json'), {
    plans: [
      { id: 'a', verdict: 'build', libraryRole: 'component' },
      { id: 'b', verdict: 'refuse', libraryRole: 'component', refuseReason: 'no capture' },
      { id: 'c', verdict: 'refuse', libraryRole: 'component', refuseReason: 'no capture' },
      { id: 'd', verdict: 'refuse', libraryRole: 'retirement' },
      { id: 'e', verdict: 'refuse', libraryRole: 'retirement' },
    ],
  });
  const out = join(root, 'out'),
    result = await S.writeScore(run, { ...quiet, out, render: stubRender, stopServer: noServer });
  const written = JSON.parse(readFileSync(join(out, 'scorecard.json'), 'utf8')),
    refused = written.sections.coverage.gap.refused;
  assert.deepEqual([refused, written.sections.library.components.refused], [2, 2]);
  const found = [...result.message!.matchAll(/(\d+)\s+refused by the plan/g)].map((m) => Number(m[1]));
  assert.deepEqual(new Set(found), new Set([2]));
  assert.match(result.message!, /2 retirement candidates/);
});

test('a build that stopped after the cover built nothing; built needs both receipts', () => {
  const workspace = (state: Json) => {
    const w = mkdtempSync(join(root, 'w-'));
    write(join(w, 'components.json'), {
      components: [
        { id: 'a', label: 'A', usage: { tier: 'High Use' } },
        { id: 'b', label: 'B', usage: { tier: 'Low Use' } },
      ],
    });
    write(join(w, 'plan.json'), {
      plans: [
        { id: 'a', verdict: 'build' },
        { id: 'b', verdict: 'build' },
      ],
    });
    write(join(w, 'figma/state.json'), state);
    return w;
  };
  const steps = ['pages', 'build:a', 'block:a', 'build:b', 'block:b', 'cover'].map((id) => ({ id }));
  for (const key of ['planned', 'built']) {
    // `built` is what older state files called the plan
    const c = counts(workspace({ [key]: ['a', 'b'], steps, done: ['pages'] }))!;
    assert.deepEqual([c.built, c.eligible], [0, 2]);
    assert.deepEqual(
      c.coverBreakdown.map((r) => r.built),
      [0, 0, 0, 0],
    );
  }
  const c = counts(workspace({ planned: ['a', 'b'], steps, done: ['pages', 'build:a', 'block:a', 'build:b'] }))!;
  assert.equal(c.built, 1);
  assert.equal(coverageSentence(c), 'Built 1 of 2 components it could have built (50%).');
});

test('incidental differences ignore paths, links and times but not hashes', () => {
  const swaps: [string, string][] = [
    ['/a/run-1', '/a/run-2'],
    ['KEY1', 'KEY2'],
  ];
  assert.ok(S.incidental({ path: '/x/measuredAt', a: '1', b: '2' }, swaps));
  assert.ok(S.incidental({ path: '/f', a: '/a/run-1/s.png', b: '/a/run-2/s.png' }, swaps));
  assert.ok(
    S.incidental(
      {
        path: '/documentationLinks/0',
        a: 'https://www.figma.com/design/KEY1?node-id=1-2',
        b: 'https://www.figma.com/design/KEY2?node-id=9-9',
      },
      swaps,
    ),
  );
  assert.ok(!S.incidental({ path: '/hash', a: 'sha256:1', b: 'sha256:2' }, swaps));
});

test('shared cost metrics keep the recorded values', () => {
  const cost = { model: { status: 'measured', tokens: 23 }, clock: { wallSeconds: 12 } };
  write(join(root, 'benchmark/scorecard.json'), { sections: { cost } });
  assert.equal(tokens(root), 23);
  assert.deepEqual(elapsedTime(root), { clock: cost.clock });
});

test('copied phases are not scoring checkpoints, and the phase log times only this run', () => {
  const project = legacyProject({
    phases: {
      preflight: { status: 'complete', from: '/source', updatedAt: '2020-01-01T00:00:00Z' },
      foundation: { status: 'complete', updatedAt: '2026-01-05T10:01:00Z' },
    },
  });
  const fallback = S.phaseTimings(root, project)!;
  assert.equal(fallback['spanSeconds'], 60);
  assert.deepEqual(
    fallback['checkpoints'].map((r) => r['phase']),
    ['foundation'],
  );
  lines(join(root, 'phase-log.jsonl'), [
    { at: '2026-01-05T09:00:00+00:00', phase: 'init', status: 'complete' },
    { at: '2026-01-05T10:00:05+00:00', phase: 'foundation', status: 'complete' },
  ]);
  const timings = S.phaseTimings(root, project)!;
  assert.equal(timings['source'], 'phase log');
  assert.deepEqual(
    timings!['phases']!.map!((r) => r['phase']),
    ['foundation'],
  );
  assert.equal(timings['totalSeconds'], 5);
});

test('font counts follow the build, naming the font it drew', () => {
  write(join(root, 'fonts.json'), {
    figmaChecked: true,
    families: [
      { family: "Suisse Int'l", components: 54, standIn: { family: 'Inter' } },
      { family: 'Arial', components: 3 },
    ],
  });
  assert.match(S.fontsPhrase(root), /Inter \(a stand-in, by default, in 54 components\)/);
  for (const name of ['a', 'b'])
    write(join(root, `figma/results/build_${name}.json`), { standIns: { "Suisse Int'l": 'Inter' } });
  write(join(root, 'figma/results/build_c.json'), { standIns: {} });
  assert.match(S.fontsPhrase(root), /Inter \(a stand-in, by default, in 2 components\)/);
  for (const name of ['a', 'b'])
    write(join(root, `figma/results/build_${name}.json`), { standIns: { "Suisse Int'l": 'Arimo' } });
  assert.match(S.fontsPhrase(root), /Suisse Int'l drawn in Arimo/);
});

// ---------------------------------------------------------------------------- tokens

test('transcript tokens are deduplicated and windowed', async () => {
  const run = await makeRun(root),
    folder = join(root, 'transcripts');
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 };
  lines(join(folder, 's1.jsonl'), [
    {
      type: 'assistant',
      timestamp: '2026-01-05T10:05:00Z',
      sessionId: 's1',
      message: { id: 'm1', model: 'claude-test', usage, content: [{ type: 'tool_use', id: 't1' }] },
    },
    {
      type: 'assistant',
      timestamp: '2026-01-05T10:05:01Z',
      sessionId: 's1',
      message: { id: 'm1', model: 'claude-test', usage, content: [{ type: 'tool_use', id: 't1' }] },
    },
    {
      type: 'assistant',
      timestamp: '2025-12-01T10:00:00Z',
      sessionId: 's0',
      message: { id: 'm0', model: 'claude-test', usage, content: [] },
    },
    { type: 'user', timestamp: '2026-01-05T10:06:00Z', message: {} },
  ]);
  const model = (await S.score(run, { ...quiet, transcripts: folder })).sections['cost']['model'];
  assert.equal(model['status'], 'measured');
  assert.deepEqual([model['assistantMessages'], model['toolCalls'], model['sessions']], [1, 1, 1]);
  assert.equal(model!['tokens']!['total']!, 115);
  assert.ok(model['caveat']);
});

test('friendly model names', () => {
  for (const [raw, name] of [
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-5-5', 'Sonnet 5.5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['claude-opus-5-5[1m]', 'Opus 5.5'],
    ['some-other-model', 'some-other-model'],
  ]) {
    assert.equal(S.friendlyModel(raw!), name);
  }
});

test('a named session counts only itself and its subagents, by model; an unknown one is not measured', async () => {
  const run = await makeRun(root),
    config = join(root, 'config');
  session(config);
  write(join(run, 'project.json'), legacyProject({ run: { claude: { configDir: config } } }));
  const card = await S.score(run, { ...quiet, session: 'sess-1' });
  assert.deepEqual(S.validateScorecard(card), []);
  const model = card.sections['cost']['model'];
  assert.equal(model['files'], 2); // main plus subagent, not the other session
  assert.deepEqual(model['configDirs'], [S.realpath(config)]);
  const [opus, haiku] = model['byModel']!;
  assert.deepEqual(
    [
      opus!.name!,
      opus!.input!,
      opus!.output!,
      opus!.cacheWrite!,
      opus!.cacheRead!,
      opus!.total!,
      opus!.turns!,
      opus!.toolCalls!,
    ],
    ['Opus 5.5', 20, 40, 60, 80, 200, 2, 3],
  );
  assert.deepEqual([haiku!.name!, haiku!.total!, haiku!.turns!, haiku!.toolCalls!], ['Haiku 4.5', 10, 1, 1]);
  assert.equal(model!['tokens']!['total']!, 210);
  assert.deepEqual(card.headline.effort['tokensByModel'], [
    { name: 'Opus 5.5', total: 200 },
    { name: 'Haiku 4.5', total: 10 },
  ]);
  const unknown = (await S.score(run, { ...quiet, session: 'no-such-session' })).sections['cost']['model'];
  assert.equal(unknown['status'], 'not-measured');
});

test('the benchmark step splits wall time and tokens', async () => {
  const run = await makeRun(root),
    config = join(root, 'config'),
    main = session(config);
  write(
    join(run, 'project.json'),
    legacyProject({ run: { startedAt: '2019-12-31T23:00:00+00:00', claude: { configDir: config } } }),
  );
  lines(join(run, 'phase-log.jsonl'), [
    { at: '2019-12-31T23:30:00+00:00', phase: 'plan', status: 'complete' },
    { at: '2019-12-31T23:59:00+00:00', phase: 'benchmark', status: 'running' },
    { at: '2020-01-01T00:10:00+00:00', phase: 'benchmark', status: 'complete' },
  ]);
  const text = readFileSync(main, 'utf8').trim().split('\n');
  writeFileSync(
    main,
    [
      ...text.slice(0, -1).map((l) => l.replace('2020-01-01T00:00:00Z', '2019-12-31T23:40:00Z')),
      text.at(-1)!.replace('2020-01-01T00:00:00Z', '2020-01-01T00:05:00Z'),
    ].join('\n') + '\n',
  );
  const sub = join(dirname(main), 'sess-1/subagents/agent-1.jsonl');
  writeFileSync(sub, readFileSync(sub, 'utf8').replace('2020-01-01T00:00:00Z', '2019-12-31T23:45:00Z'));
  const card = await S.score(run, { ...quiet, session: 'sess-1' }),
    cost = card.sections['cost'];
  assert.deepEqual(S.validateScorecard(card), []);
  assert.deepEqual(
    [
      cost.clock.wallSeconds,
      cost.clock.libraryWallSeconds,
      cost.clock.benchmarkWallSeconds,
      cost.clock.benchmarkEndSource,
    ],
    [4200, 3540, 660, 'phase log'],
  );
  assert.deepEqual(
    cost!.model!.production!.byModel!.map!((r) => [r['name'], r['turns']]),
    [
      ['Opus 5.5', 1],
      ['Haiku 4.5', 1],
    ],
  );
  assert.deepEqual(
    cost!.model!.benchmark!.byModel!.map!((r) => [r['name'], r['turns'], r['total']]),
    [['Opus 5.5', 1, 100]],
  );
  assert.deepEqual(card.headline.effort['benchmarkTokensByModel'], [{ name: 'Opus 5.5', total: 100 }]);
});

test('only Claude models are counted, and tool input never reaches the completion message', async () => {
  const run = await makeRun(root),
    config = join(root, 'config'),
    main = join(config, 'projects/-repo/sess-x.jsonl');
  const x = { session: 'sess-x' };
  lines(main, [
    entry('prompt', '2026-01-05T10:00:00Z', x),
    entry('step', '2026-01-05T10:00:10Z', { ...x, command: 'example-cli run --model other-model-1' }),
    entry('result', '2026-01-05T10:01:00Z', x),
    entry('reply', '2026-01-05T10:01:10Z', { ...x, model: 'other-model-1' }),
    entry('reply', '2026-01-05T10:01:20Z', x),
  ]);
  write(join(run, 'project.json'), legacyProject({ run: { claude: { configDir: config, model: 'other-model-1' } } }));
  const result = await S.writeScore(run, {
    ...quiet,
    session: 'sess-x',
    out: join(root, 'out'),
    render: stubRender,
    stopServer: noServer,
  });
  const model = result.scorecard.sections['cost']['model'];
  assert.deepEqual(
    model!['byModel']!.map!((r) => r['name']),
    ['Opus 5.5'],
  );
  assert.equal(model!['developer']!['unattributedEntries']!, 1);
  for (const hidden of ['other-model-1', 'example-cli']) assert.ok(!result.message!.includes(hidden));
});

test('a line whose message is not an object is skipped', () => {
  const f = join(root, 's.jsonl');
  lines(f, [
    { type: 'user', timestamp: '2026-09-29T10:00:00Z', message: { role: 'user', content: 'hi' } },
    { type: 'assistant', timestamp: '2026-09-29T10:00:05Z', message: 'truncated' },
    { type: 'user', timestamp: '2026-09-29T10:00:06Z', message: ['not', 'an', 'object'] },
    { type: 'user', timestamp: '2026-09-29T10:00:07Z', message: { content: [{ type: 'text', text: 5 }] } },
    {
      type: 'assistant',
      timestamp: '2026-09-29T10:00:09Z',
      message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'done' }], usage: { output_tokens: 3 } },
    },
  ]);
  assert.equal(S.workingTime([f], null, null)['status'], 'measured');
  const usage = S.transcriptUsage([f], null, null);
  assert.deepEqual([usage['assistantMessages'], usage['tokens']!['output']], [1, 3]);
});

// ---------------------------------------------------------------------------- the benchmark's end

test('the first scoring fixes the benchmark end and stops the server; a re-score moves neither', async () => {
  const run = await makeRun(root);
  write(join(run, 'project.json'), legacyProject({ run: { startedAt: '2026-01-05T10:00:00+00:00' } }));
  const start = new Date(Math.floor(Date.now() / 1000) * 1000 - 120_000).toISOString().replace('.000Z', '+00:00');
  lines(join(run, 'phase-log.jsonl'), [{ at: start, phase: 'benchmark', status: 'running' }]);
  let stops = 0;
  const stopServer = async () => {
    stops += 1;
    return { stopped: true, pid: 9 };
  };
  const first = await S.writeScore(run, { ...quiet, render: stubRender, stopServer });
  const log = readFileSync(join(run, 'phase-log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.deepEqual([log.at(-1).phase, log.at(-1).status], ['benchmark', 'complete']);
  assert.ok(first.written.includes('stopped the runner server (process 9)'));
  const clock = JSON.parse(readFileSync(join(run, 'benchmark/scorecard.json'), 'utf8')).sections.cost.clock;
  assert.equal(clock.benchmarkEnd, S.iso(S.parseTime(log.at(-1).at)));
  assert.equal(clock.benchmarkEndSource, 'this scoring');
  assert.notEqual(clock.wallSeconds, null);
  // The end is when the report was finished.
  assert.ok(
    Math.abs(S.parseTime(clock.benchmarkEnd)! / 1000 - statSync(join(run, 'benchmark/report.html')).mtimeMs) < 2000,
  );
  const project = JSON.parse(readFileSync(join(run, 'project.json'), 'utf8'));
  assert.equal(project.phases.benchmark.status, 'complete');

  await S.writeScore(run, { ...quiet, render: stubRender, stopServer });
  const again = JSON.parse(readFileSync(join(run, 'benchmark/scorecard.json'), 'utf8')).sections.cost.clock;
  assert.deepEqual(
    [again.benchmarkEnd, again.wallSeconds, again.benchmarkEndSource],
    [clock.benchmarkEnd, clock.wallSeconds, 'phase log'],
  );
  assert.equal(
    readFileSync(join(run, 'phase-log.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('"complete"')).length,
    1,
  );
  assert.equal(stops, 1);
  // Even a later start written straight into the log never moves the first pair.
  writeFileSync(
    join(run, 'phase-log.jsonl'),
    readFileSync(join(run, 'phase-log.jsonl'), 'utf8') +
      JSON.stringify({ at: '2099-01-01T00:00:00+00:00', phase: 'benchmark', status: 'running' }) +
      '\n',
  );
  assert.equal((await S.score(run, quiet)).sections['cost']['clock']['wallSeconds'], clock.wallSeconds);
});

test('writeScore writes outside the run or into its benchmark folder only, atomically', async () => {
  const run = await makeRun(root),
    out = join(root, 'out');
  const result = await S.writeScore(run, {
    ...quiet,
    siteLabel: 'Example site',
    out,
    render: stubRender,
    stopServer: noServer,
  });
  assert.equal(result.code, 0);
  const card = JSON.parse(readFileSync(join(out, 'scorecard.json'), 'utf8'));
  assert.equal(card.run.siteLabel, 'Example site');
  assert.equal(card.run.buildCreatedAt, '2026-01-05T10:00:00+00:00');
  assert.deepEqual(readdirSync(out).sort(), ['completion.md', 'report.html', 'scorecard.json']);
  assert.ok(!/\{[a-z_]+\}/.test(result.message!));
  assert.match(result.message!, /Coverage: built 1 of 2 buildable components \(50%\)/);
  await assert.rejects(
    S.writeScore(run, { ...quiet, out: join(run, 'score'), render: stubRender, stopServer: noServer }),
    S.ScoreUsageError,
  );
});

test('an ambiguous current session is named for developers', async () => {
  const run = await makeRun(root),
    folder = join(root, 'transcripts');
  for (const name of ['older', 'newer']) {
    lines(join(folder, `${name}.jsonl`), [
      entry('prompt', '2026-01-05T10:00:00Z', { session: name }),
      entry('reply', '2026-01-05T10:00:10Z', { session: name }),
    ]);
    await new Promise((r) => setTimeout(r, 20));
  }
  write(
    join(run, 'project.json'),
    legacyProject({ run: { startedAt: '2026-01-05T10:00:00+00:00', claude: { transcripts: folder } } }),
  );
  const warned: string[] = [];
  const card = await S.score(run, { session: 'current', warn: (m) => warned.push(m) });
  assert.match(warned[0]!, /--session current chose newer/);
  assert.match(card.sections['cost']['developer']!['sessionWarning'] ?? '', /newest of 2 sessions/);
});

// ---------------------------------------------------------------------------- working time

async function workingRun(): Promise<{ run: string; config: string; main: string }> {
  const run = await makeRun(root),
    config = join(root, 'config'),
    main = join(config, 'projects/-repo/sess-w.jsonl');
  const resets = Date.UTC(2026, 0, 5, 11, 0) / 1000;
  lines(main, [
    entry('prompt', '2026-01-05T10:00:00Z'),
    entry('step', '2026-01-05T10:00:10Z'),
    entry('result', '2026-01-05T10:01:10Z'),
    entry('reply', '2026-01-05T10:01:20Z'),
    entry('prompt', '2026-01-05T10:11:20Z', { text: 'go on' }),
    entry('step', '2026-01-05T10:11:30Z'),
    entry('limit', '2026-01-05T10:12:00Z', { resets }),
    entry('prompt', '2026-01-05T11:30:00Z', { text: 'continue' }),
    entry('reply', '2026-01-05T11:30:30Z'),
  ]);
  // A subagent that worked 10:00:20 to 10:02:30, overlapping the main session's first turn.
  lines(join(config, 'projects/-repo/sess-w/subagents/agent-1.jsonl'), [
    entry('prompt', '2026-01-05T10:00:20Z', { sidechain: true, text: 'Inventory' }),
    entry('step', '2026-01-05T10:00:50Z', { sidechain: true }),
    entry('result', '2026-01-05T10:02:00Z', { sidechain: true }),
    entry('reply', '2026-01-05T10:02:30Z', { sidechain: true }),
  ]);
  write(join(run, 'project.json'), legacyProject({ run: { claude: { configDir: config } } }));
  return { run, config, main };
}
const subagent = (main: string) => join(main.replace(/\.jsonl$/, ''), 'subagents/agent-1.jsonl');
const cost = async (run: string) => (await S.score(run, { ...quiet, session: 'sess-w' })).sections['cost'];
const connectLog = (run: string, ...entries: Json[]) =>
  lines(join(run, 'phase-log.jsonl'), [
    { at: '2026-01-05T10:00:30+00:00', phase: 'preflight', status: 'complete' },
    ...entries,
    { at: '2026-01-05T11:00:00+00:00', phase: 'benchmark', status: 'running' },
  ]);

test('working spans, waits and subagent overlap partition the transcript span', async () => {
  const { run } = await workingRun(),
    card = await S.score(run, { ...quiet, session: 'sess-w' });
  assert.deepEqual(S.validateScorecard(card), []);
  const work = card.sections['cost']['working'];
  assert.equal(work.spanSeconds, 5430);
  assert.equal(work.workingSeconds, 150 + 40 + 30);
  assert.equal(work.waitingOnLimitsSeconds, 48 * 60);
  assert.equal(work.waitingOnPersonSeconds, 530 + 30 * 60);
  assert.equal(work.waitingOnServiceSeconds, 0);
  assert.equal(work.limitEvents, 1);
  assert.equal(card.headline.effort['workingSeconds'], 220);
});

test('an overload is waiting on the service', async () => {
  const { run, main } = await workingRun();
  lines(main, [
    entry('prompt', '2026-01-05T10:00:00Z'),
    entry('overloaded', '2026-01-05T10:00:05Z'),
    entry('reply', '2026-01-05T10:02:05Z'),
  ]);
  unlinkSync(subagent(main));
  const work = (await cost(run))['working'];
  assert.deepEqual(
    [work.workingSeconds, work.waitingOnLimitsSeconds, work.waitingOnServiceSeconds, work.waitingOnPersonSeconds],
    [5, 0, 120, 0],
  );
  assert.deepEqual([work.limitEvents, work.serviceEvents], [0, 1]);
});

test('a question to the person is waiting, not working, and partial access is recorded', async () => {
  const { run, main } = await workingRun();
  lines(main, [
    entry('prompt', '2026-01-05T10:00:00Z'),
    entry('ask', '2026-01-05T10:00:10Z'),
    entry('meta', '2026-01-05T10:00:30Z'),
    entry('answer', '2026-01-05T10:05:10Z', { mode: 'default' }),
    entry('reply', '2026-01-05T10:05:20Z'),
  ]);
  // A subagent still working during the question keeps its time as working.
  lines(subagent(main), [
    entry('prompt', '2026-01-05T10:01:00Z', { sidechain: true }),
    entry('reply', '2026-01-05T10:02:00Z', { sidechain: true }),
  ]);
  const work = (await cost(run))['working'];
  assert.deepEqual([work.workingSeconds, work.waitingOnPersonSeconds], [10 + 60 + 10, 300 - 60]);
  assert.equal(work.questionsToPerson, 1);
  assert.deepEqual(work!.developer!.permissionModes!, { default: 1 });
  assert.equal(work.fullAccess, false);
});

test('interruptions after the preflight go-ahead are counted with their phase', async () => {
  const { run, config, main } = await workingRun();
  lines(main, [
    entry('prompt', '2026-01-05T10:00:00Z'),
    entry('reply', '2026-01-05T10:00:20Z'),
    entry('prompt', '2026-01-05T10:00:25Z', { text: 'here they are' }),
    entry('step', '2026-01-05T10:00:40Z'),
    entry('result', '2026-01-05T10:05:00Z'),
    entry('ask', '2026-01-05T10:06:00Z'),
    entry('answer', '2026-01-05T10:07:00Z'),
    entry('reply', '2026-01-05T10:10:00Z'),
    entry('prompt', '2026-01-05T10:20:00Z', { text: 'continue' }),
    entry('step', '2026-01-05T10:20:10Z'),
    entry('result', '2026-01-05T11:00:30Z'),
    entry('reply', '2026-01-05T11:05:00Z'),
    entry('prompt', '2026-01-05T11:06:00Z', { text: 'thanks' }),
  ]);
  lines(join(run, 'phase-log.jsonl'), [
    { at: '2026-01-05T10:00:30+00:00', phase: 'preflight', status: 'complete' },
    { at: '2026-01-05T10:01:00+00:00', phase: 'capture', status: 'running' },
    { at: '2026-01-05T10:15:00+00:00', phase: 'capture', status: 'complete' },
    { at: '2026-01-05T11:00:00+00:00', phase: 'benchmark', status: 'running' },
  ]);
  write(
    join(run, 'project.json'),
    legacyProject({
      run: { claude: { configDir: config } },
      phases: { preflight: { status: 'complete', detail: { planApproval: 'proposed' } } },
    }),
  );
  const result = await S.writeScore(run, {
    ...quiet,
    session: 'sess-w',
    out: join(root, 'out'),
    render: stubRender,
    stopServer: noServer,
  });
  assert.equal(result.code, 0);
  const attended = result.scorecard.sections['cost']['unattended'];
  assert.deepEqual([attended.count, attended.ranUnattended], [2, false]);
  assert.deepEqual(
    attended!.interruptions!.map!((i) => [i['kind'], i['phase']]),
    [
      ['question', 'capture'],
      ['turn ended and waited for a prompt', 'capture'],
    ],
  );
  assert.match(
    result.message!,
    /Ran unattended after preflight: no, 2 interruptions: a question during capture; a turn that waited for a prompt during capture\./,
  );
});

test('a stop for the runner counts as an interruption', async () => {
  const { run, main } = await workingRun();
  lines(main, [
    entry('prompt', '2026-01-05T10:00:00Z'),
    entry('step', '2026-01-05T10:00:40Z'),
    entry('result', '2026-01-05T10:30:00Z'),
    entry('reply', '2026-01-05T10:31:00Z'),
  ]);
  lines(join(run, 'phase-log.jsonl'), [
    { at: '2026-01-05T10:00:30+00:00', phase: 'preflight', status: 'complete' },
    { at: '2026-01-05T10:20:00+00:00', phase: 'components', status: 'stopped', reason: 'runner not connected' },
  ]);
  const attended = (await cost(run))['unattended'];
  assert.deepEqual([attended.count, attended.ranUnattended], [1, false]);
  assert.equal(S.unattendedPhrase(attended), 'no, 1 interruption: a stop, runner not connected during components');
});

test('the wait for a runner connection is planned until it completes', async () => {
  const { run, main } = await workingRun();
  lines(main, [
    entry('prompt', '2026-01-05T10:00:00Z'),
    entry('reply', '2026-01-05T10:00:20Z'),
    entry('prompt', '2026-01-05T10:01:00Z', { text: 'answers' }),
    entry('ask', '2026-01-05T10:10:00Z'),
    entry('answer', '2026-01-05T10:11:00Z'),
    entry('reply', '2026-01-05T10:15:00Z'),
    entry('prompt', '2026-01-05T10:25:00Z', { text: 'runner started' }),
    entry('reply', '2026-01-05T10:26:00Z'),
  ]);
  connectLog(
    run,
    { at: '2026-01-05T10:05:00+00:00', phase: 'connect', status: 'waiting', reason: 'runner connection' },
    { at: '2026-01-05T10:25:00+00:00', phase: 'connect', status: 'complete' },
  );
  const attended = (await cost(run))['unattended'],
    questions = attended!.interruptions!.filter!((i) => i['kind'] === 'question');
  assert.equal(questions.length, 1);
  assert.equal(questions![0]!.planned!, true);
  assert.deepEqual([attended.count, attended.ranUnattended], [0, true]);
  assert.equal(S.unattendedPhrase(attended), 'yes');
});

test('a runner that never connects is an unplanned stop', async () => {
  const { run, main } = await workingRun();
  lines(main, [entry('prompt', '2026-01-05T10:00:00Z'), entry('reply', '2026-01-05T10:31:00Z')]);
  connectLog(
    run,
    { at: '2026-01-05T10:05:00+00:00', phase: 'connect', status: 'waiting' },
    { at: '2026-01-05T10:30:00+00:00', phase: 'connect', status: 'stopped', reason: 'runner not connected' },
  );
  const attended = (await cost(run))['unattended'];
  assert.equal(attended.count, 1);
  assert.equal(attended!.interruptions!.find!!((i) => String(i['kind']).startsWith('stopped:'))!.planned, false);
});

test("a failed connection closes its wait; a retry keeps the first attempt's", async () => {
  const { run, main } = await workingRun();
  lines(main, [
    entry('prompt', '2026-01-05T10:00:00Z'),
    entry('ask', '2026-01-05T10:10:00Z'),
    entry('answer', '2026-01-05T10:11:00Z'),
    entry('ask', '2026-01-05T10:40:00Z'),
    entry('answer', '2026-01-05T10:41:00Z'),
    entry('reply', '2026-01-05T10:50:00Z'),
  ]);
  connectLog(
    run,
    { at: '2026-01-05T10:05:00+00:00', phase: 'connect', status: 'waiting' },
    { at: '2026-01-05T10:30:00+00:00', phase: 'connect', status: 'stopped', reason: 'runner not connected' },
    { at: '2026-01-05T10:35:00+00:00', phase: 'capture', status: 'running' },
  );
  let attended = (await cost(run))['unattended'];
  assert.deepEqual(
    attended!.interruptions!.slice!(0, 3).map((i) => [i['kind'], i['planned']]),
    [
      ['question', true],
      ['stopped: runner not connected', false],
      ['question', false],
    ],
  );

  lines(main, [
    entry('prompt', '2026-01-05T10:00:00Z'),
    entry('ask', '2026-01-05T10:10:00Z'),
    entry('answer', '2026-01-05T10:11:00Z'),
    entry('ask', '2026-01-05T10:20:00Z'),
    entry('answer', '2026-01-05T10:21:00Z'),
    entry('reply', '2026-01-05T10:50:00Z'),
  ]);
  connectLog(
    run,
    { at: '2026-01-05T10:05:00+00:00', phase: 'connect', status: 'waiting' },
    { at: '2026-01-05T10:15:00+00:00', phase: 'connect', status: 'waiting' },
    { at: '2026-01-05T10:25:00+00:00', phase: 'connect', status: 'complete' },
  );
  attended = (await cost(run))['unattended'];
  assert.deepEqual(
    attended!.interruptions!.filter!((i) => i['kind'] === 'question').map((q) => q['planned']),
    [true, true],
  );
});

test('the wait ends when the connection completes, to the fraction of a second', async () => {
  const { run, main } = await workingRun();
  lines(main, [
    entry('prompt', '2026-01-05T10:00:00Z'),
    entry('ask', '2026-01-05T10:25:00.900Z'),
    entry('answer', '2026-01-05T10:26:00Z'),
    entry('reply', '2026-01-05T10:50:00Z'),
  ]);
  connectLog(
    run,
    { at: '2026-01-05T10:05:00+00:00', phase: 'connect', status: 'waiting' },
    { at: '2026-01-05T10:25:00+00:00', phase: 'connect', status: 'complete' },
  );
  assert.equal((await cost(run))['unattended'].interruptions!.find((i) => i['kind'] === 'question')!.planned, false);
});

test('the benchmark start splits working time', async () => {
  const { run } = await workingRun();
  lines(join(run, 'phase-log.jsonl'), [{ at: '2026-01-05T11:30:00+00:00', phase: 'benchmark', status: 'running' }]);
  const work = (await cost(run))['working'];
  assert.equal(work!.production!.workingSeconds!, 190);
  assert.equal(work!.benchmark!.workingSeconds!, 30);
  for (const part of [work.production, work.benchmark]) {
    assert.equal(
      part!.workingSeconds! +
        part!.waitingOnPersonSeconds! +
        part!.waitingOnLimitsSeconds! +
        part!.waitingOnServiceSeconds!,
      part!.spanSeconds!,
    );
  }
});

test('without a transcript only measured intervals are shown', async () => {
  const { run } = await workingRun();
  const result = await S.writeScore(run, {
    ...quiet,
    out: join(root, 'out'),
    render: stubRender,
    stopServer: noServer,
  });
  assert.equal(result.scorecard.sections['cost']['working']['status'], 'not-measured');
  assert.equal(result.scorecard.headline.effort['workingSeconds'], null);
  assert.equal(result.scorecard.headline.effort['buildSeconds'], 13); // the runner's own log
  assert.ok(!result.message!.includes('idle time'));
  assert.match(result.message!, /working time was not measured for this run/);
});

test('a rebuild, however its transcript is named, excludes other work in the conversation', async () => {
  const { run, config, main } = await workingRun();
  renameSync(main.replace(/\.jsonl$/, ''), join(root, 'held-subagents'));
  const records = [
    entry('prompt', '2026-01-05T09:00:00Z'),
    entry('reply', '2026-01-05T09:01:00Z'),
    entry('prompt', '2026-01-05T10:10:00Z'),
    entry('step', '2026-01-05T10:10:10Z'),
    entry('reply', '2026-01-05T10:11:00Z'),
    entry('prompt', '2026-01-05T12:00:00Z'),
    entry('reply', '2026-01-05T12:01:00Z'),
  ];
  lines(main, records);
  const project = legacyProject({
    run: {
      startedAt: '2026-01-05T10:10:00+00:00',
      rebuiltFrom: { run: '/old' },
      claude: { configDir: config, transcripts: dirname(main) },
    },
  });
  write(join(run, 'project.json'), project);
  const end = S.parseTime('2026-01-05T10:12:00Z')!;
  for (const [sessionId, transcripts] of [
    ['sess-w', null],
    ['current', null],
    [null, [main]],
    [null, [dirname(main)]],
  ] as const) {
    const c = S.scoreCost(run, project, transcripts as string[] | null, null, null, sessionId, [end, end], () => {});
    assert.equal(c!['model']!['tokens']!['total']!, 30, String(sessionId ?? transcripts));
    assert.equal(c['model']['assistantMessages'], 2);
    assert.equal(c['working']['workingSeconds'], 60);
  }
  // A conversation containing only this run has exactly the same totals as before.
  lines(main, records.slice(2, 5));
  const rebuilt = S.scoreCost(run, project, null, null, null, 'sess-w', [end, end]);
  const { rebuiltFrom, ...withoutRebuild } = project.run;
  Object.assign(project, { run: withoutRebuild });
  delete (project.run as { rebuiltFrom?: unknown }).rebuiltFrom;
  const full = S.scoreCost(run, project, null, null, null, 'sess-w', [end, end]);
  for (const key of ['tokens', 'byModel', 'assistantMessages', 'toolCalls', 'production', 'benchmark'] as const)
    assert.deepEqual(rebuilt['model'][key], full['model'][key]);
  assert.deepEqual(rebuilt['working'], full['working']);
});

test("ISO times keep baseline's naive-local and sub-second semantics", () => {
  assert.equal(S.parseTime('2026-01-05T10:25:00.900Z')! - S.parseTime('2026-01-05T10:25:00+00:00')!, 900_000);
  assert.equal(S.parseTime('2026-01-05T12:00:00+02:00'), S.parseTime('2026-01-05T10:00:00Z'));
  assert.equal(S.parseTime('2026-01-05T11:00:00'), new Date(2026, 0, 5, 11).getTime() * 1000);
  assert.equal(S.parseTime('2026-02-30T00:00:00Z'), null);
  assert.equal(S.iso(S.parseTime('2026-01-05T10:25:00.999Z')), '2026-01-05T10:25:00+00:00');
  assert.equal(S.formatG(30), '30');
  assert.equal(S.formatG(12.5), '12.5');
  assert.equal(S.humanDuration(150 * 60 + 90 * 60), '4 h 0 min');
  assert.equal(S.humanDuration(3600 + 90), '1 h 2 min'); // 1.5 minutes rounds to even
});

process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
