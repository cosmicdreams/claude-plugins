import { describe, expect, test } from 'claude-code/testing';

import {
  afterFill,
  barOf,
  compactOf,
  percentOf,
  durationOf,
  failureOf,
  figmaUrlOf,
  isDown,
  needsYouOf,
  scoresOf,
  stagesOf,
  toneOf,
  runnerLine,
  stepsLine,
  preflightPassed,
  RECAP_LIMIT,
  plainOf,
  RUNNER_ABSENT_MS,
  SERVER_FRESH_MS,
  statusOf,
  summaryOf,
} from '../../hooks/mod/model';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const PROJECT = {
  run: { siteLabel: 'Example site' },
  createdAt: ago(3_600_000),
  phases: {
    capture: { status: 'complete' },
    plan: { status: 'approved' },
    components: { status: 'pending' },
    verify: { status: 'pending' },
    preflight: { status: 'complete', updatedAt: ago(41 * 60_000) },
  },
};

// The scorecard of this build, as score_run.ts stamps it.
const SCORED = { run: { buildCreatedAt: PROJECT.createdAt } };

const progress = (fields: Record<string, unknown> = {}) => ({
  state: 'building',
  stepsDone: 112,
  stepsTotal: 158,
  stepKind: 'use_figma',
  message: null,
  inflight: false,
  lastSeen: ago(5_000),
  at: ago(2_000),
  serverPid: 1,
  ...fields,
});

const summary = (raw: Parameters<typeof summaryOf>[1]) => summaryOf('/runs/example', raw, NOW);

describe('summaryOf', () => {
  test('copied preflight uses this run creation for elapsed time and has no inherited pass time', () => {
    for (const inherited of [true, false]) {
      const project = {
        ...PROJECT,
        phases: {
          ...PROJECT.phases,
          preflight: {
            status: 'complete',
            from: '/source',
            sourceUpdatedAt: ago(90_000_000),
            ...(inherited ? { updatedAt: ago(90_000_000) } : {}),
          },
        },
      };
      const s = summary({ project });
      expect(s.startedAt).toBe(PROJECT.createdAt);
      expect(s.preflight?.at).toBeNull();
      expect(statusOf(s, NOW)).toContain('1h');
    }
  });

  test('a building run shows its steps, its runner and its current phase', () => {
    const s = summary({ project: PROJECT, progress: progress() });
    expect(s.current).toBe('components');
    expect(s.runner?.connected).toBe(true);
    expect(statusOf(s, NOW)).toBe('steps 112/158 · runner connected · 41m');
    expect(plainOf(s)).toContain('steps 112/158, use_figma');
    expect(isDown(s)).toBe(false);
  });

  test('a runner gone quiet is down, and says for how long', () => {
    const s = summary({ project: PROJECT, progress: progress({ lastSeen: ago(RUNNER_ABSENT_MS + 180_000) }) });
    expect(s.runner?.connected).toBe(false);
    expect(isDown(s)).toBe(true);
    expect(plainOf(s)).toContain('runner not seen for 5m');
  });

  test('a slow step in flight counts as connected while the server beats', () => {
    const s = summary({ project: PROJECT, progress: progress({ lastSeen: ago(300_000), inflight: true }) });
    expect(s.runner?.connected).toBe(true);
  });

  test('a stale heartbeat overrides in flight', () => {
    const s = summary({
      project: PROJECT,
      progress: progress({ lastSeen: ago(300_000), inflight: true, at: ago(SERVER_FRESH_MS + 1) }),
    });
    expect(s.runner?.serverAlive).toBe(false);
    expect(s.runner?.connected).toBe(false);
    expect(isDown(s)).toBe(true);
  });

  test('the blocker comes from the phase log and clears when the runner returns', () => {
    const phaseLog = [
      JSON.stringify({ phase: 'components', status: 'running' }),
      JSON.stringify({ phase: 'components', status: 'stopped', message: 'Open Figma desktop and start the runner.' }),
      '',
    ].join('\n');
    const stopped = summary({ project: PROJECT, phaseLog, progress: progress({ lastSeen: ago(300_000) }) });
    expect(stopped.blocker).toBe('Open Figma desktop and start the runner.');
    const back = summary({ project: PROJECT, phaseLog, progress: progress() });
    expect(back.blocker).toBeNull();
  });

  test('a finished run clears the status line and is never down', () => {
    const s = summary({
      project: PROJECT,
      progress: progress({ lastSeen: ago(900_000) }),
      completion: '# done',
      scorecard: SCORED,
    });
    expect(statusOf(s, NOW)).toBeUndefined();
    expect(isDown(s)).toBe(false);
  });

  test('a half-written phase log line is skipped, and a missing project says so', () => {
    const s = summary({
      project: PROJECT,
      phaseLog: '{"phase": "capture", "status": "stopped", "message": "x"}\n{"phase": ',
    });
    expect(s.blocker).toBe('x');
    expect(plainOf(summary({}))).toContain('No design-lab run in /runs/example');
  });
});

describe('afterFill', () => {
  test('filled is done; no prompt box sends; anything else explains', () => {
    expect(afterFill({ isFilled: true })).toBe('done');
    expect(afterFill({ isFilled: false, refusal: 'no_composer' })).toBe('submit');
    expect(afterFill({ isFilled: false, refusal: 'dialog' })).toBe('explain');
    expect(afterFill({ isFilled: false })).toBe('explain');
    expect(afterFill(undefined)).toBe('explain');
  });
});

describe('recap', () => {
  test('the completion message is the recap, cut with a note only if it outgrows Markdown', () => {
    expect(summary({ project: PROJECT, completion: 'design-lab finished.\n', scorecard: SCORED }).recap).toBe(
      'design-lab finished.',
    );
    const long = summary({ project: PROJECT, completion: 'x'.repeat(RECAP_LIMIT + 10), scorecard: SCORED }).recap ?? '';
    expect(long.length).toBeLessThan(10_000);
    expect(long).toContain('benchmark/completion.md');
  });

  test("an earlier build's recap is not this one's, and an unstamped one counts once the benchmark is complete", () => {
    const earlier = { run: { buildCreatedAt: ago(90_000_000) } };
    expect(summary({ project: PROJECT, completion: '# done', scorecard: earlier }).hasRecap).toBe(false);
    expect(summary({ project: PROJECT, completion: '# done' }).hasRecap).toBe(false);
    const benchmarked = { ...PROJECT, phases: { ...PROJECT.phases, benchmark: { status: 'complete' } } };
    expect(summary({ project: benchmarked, completion: '# done' }).hasRecap).toBe(true);
  });
});

describe('preflight checklist', () => {
  const RUNNING = {
    ...PROJECT,
    phases: { ...PROJECT.phases, preflight: { status: 'running', updatedAt: ago(60_000) } },
  };
  const check = (id: string, status: string, message: string | null = null) => ({
    id,
    label: `the ${id}`,
    status,
    message,
    dependsOn: [],
    at: ago(1_000),
  });
  const list = (...checks: ReturnType<typeof check>[]) => ({ pass: ago(5_000), at: ago(1_000), ready: null, checks });

  test('the list is whatever preflight wrote, in its order, and the status line counts it', () => {
    const s = summary({
      project: RUNNING,
      preflightChecks: list(
        check('site', 'done'),
        check('runner', 'needs-you', 'Start the runner.'),
        check('cover', 'waiting'),
      ),
    });
    expect(s.preflight?.checks?.map((c) => c.id)).toEqual(['site', 'runner', 'cover']);
    expect(statusOf(s, NOW)).toContain('preflight 1/3');
    expect(plainOf(s)).toContain('! the runner: Start the runner.');
    expect(plainOf(s)).toContain('· the cover');
    expect(preflightPassed(s)).toBe(false);
  });

  test('a passed preflight folds to one line; a checklist older than the recorded phase is not shown', () => {
    const passed = {
      ...PROJECT,
      phases: { ...PROJECT.phases, preflight: { status: 'complete', updatedAt: ago(2_000) } },
    };
    const done = summary({ project: passed, preflightChecks: list(check('site', 'done'), check('runner', 'done')) });
    expect(preflightPassed(done)).toBe(true);
    const old = { ...list(check('site', 'needs-you')), at: ago(90_000_000) };
    expect(summary({ project: passed, preflightChecks: old }).preflight?.checks).toBeNull();
    expect(summary({ project: passed, preflightChecks: '{"checks": [' }).preflight?.checks).toBeNull();
  });
});

describe('a runner that is not needed yet', () => {
  test('before the build an absent runner is idle, not missing, and its last word is not repeated', () => {
    const s = summary({
      project: PROJECT,
      progress: progress({
        state: 'waiting',
        stepsDone: null,
        stepsTotal: null,
        message: 'Connected. Waiting for the build to start.',
        lastSeen: ago(300_000),
      }),
    });
    expect(runnerLine(s.runner)).toBe('runner idle until the build');
    expect(stepsLine(s.runner)).toBeNull();
    expect(statusOf(s, NOW)).toContain('runner idle until the build');
    expect(isDown(s)).toBe(false);
  });

  test("the build's wait for the runner says what to do, with nothing to press", () => {
    const waiting = JSON.stringify({
      phase: 'connect',
      status: 'waiting',
      message: 'Open the file and start the design-lab runner.',
    });
    const s = summary({ project: PROJECT, phaseLog: `${waiting}\n` });
    expect(s.waiting).toBe('Open the file and start the design-lab runner.');
    expect(s.blocker).toBeNull();
    expect(plainOf(s)).toContain('Needs you: Open the file');
  });

  test('while the build waits for it, the runner is awaited, not idle', () => {
    const waiting = JSON.stringify({ phase: 'connect', status: 'waiting', message: 'Start the design-lab runner.' });
    const s = summary({
      project: PROJECT,
      phaseLog: `${waiting}\n`,
      progress: progress({
        state: 'waiting',
        stepsDone: null,
        stepsTotal: null,
        lastSeen: ago(600_000),
        message: 'Connected. Waiting for the build to start.',
      }),
    });
    expect(runnerLine(s.runner)).toBe('waiting for the runner to start');
    expect(stepsLine(s.runner)).toBeNull();
    expect(isDown(s)).toBe(false);
  });
});

describe("the pane's figures", () => {
  test('a bar fills in proportion and never overflows', () => {
    expect(barOf(5, 10, 10)).toEqual({ filled: '━━━━━', empty: '━━━━━' });
    expect(barOf(20, 10, 10).empty).toBe('');
    expect(barOf(0, 0, 10).filled).toBe('');
  });

  test('a share short of the whole never reads as 100%', () => {
    expect(percentOf(200, 201)).toBe(99);
    expect(percentOf(201, 201)).toBe(100);
    expect(percentOf(48, 58)).toBe(83);
  });

  test('times and token counts read short', () => {
    expect(durationOf(40)).toBe('40s');
    expect(durationOf(13_435), 'rounded to the minute, as the recap rounds it').toBe('3h 44m');
    expect(compactOf(40_013_109)).toBe('40.0M');
    expect(compactOf(563_519)).toBe('564K');
  });

  test('a scorecard without a headline has no figures; one with gives each it holds', () => {
    expect(scoresOf({ run: {} })).toBeNull();
    const s = scoresOf({ headline: { coverage: { built: 48, eligible: 58 } } });
    expect(s?.built).toBe(48);
    expect(s?.tokens).toBeNull();
  });

  test('the header word follows the run', () => {
    expect(toneOf(summary({ project: PROJECT, progress: progress() })).label).toBe('Building');
    expect(
      toneOf(summary({ project: PROJECT, progress: progress({ lastSeen: ago(RUNNER_ABSENT_MS + 60_000) }) })).label,
    ).toBe('Needs you');
    // The runner is done once the Figma build is over; verification and scoring still have to run.
    const built = {
      ...PROJECT,
      phases: { ...PROJECT.phases, components: { status: 'complete' }, index: { status: 'complete' } },
    };
    expect(toneOf(summary({ project: built, progress: progress({ state: 'done' }) })).label).toBe('Verifying');
  });

  test('the status line stays until the recap is written', () => {
    const s = summary({ project: PROJECT, progress: progress({ state: 'done', lastSeen: ago(600_000) }) });
    expect(statusOf(s, NOW)).toBeDefined();
    expect(statusOf(s, NOW)).toContain('Figma build finished');
  });

  test('a Figma link at the end of a sentence leaves the full stop behind', () => {
    expect(figmaUrlOf('see https://www.figma.com/design/abc.')).toBe('https://www.figma.com/design/abc');
  });
});

describe('stages', () => {
  test('the twelve phases fold into five stages, the current one open', () => {
    const project = {
      ...PROJECT,
      phases: {
        preflight: { status: 'complete' },
        discovery: { status: 'complete' },
        inventory: { status: 'complete', detail: { components: 155 } },
        plan: { status: 'approved', detail: { build: 48 } },
        connect: { status: 'complete' },
        components: { status: 'running' },
        verify: { status: 'pending' },
        benchmark: { status: 'pending' },
      },
    };
    const stages = stagesOf(summary({ project, progress: progress() }));
    expect(stages.map((stage) => `${stage.label}:${stage.state}`)).toEqual([
      'Preflight:done',
      'Discovery:done',
      'Build:active',
      'Verify:pending',
      'Report:pending',
    ]);
    expect(stages[1]!.note).toBe('155 found · 48 planned');
    expect(stages[2]!.note).toBe('71%');
    expect(toneOf(summary({ project, progress: progress() })).label).toBe('Building');
  });

  test('stages copied from an earlier run read as reused', () => {
    const project = {
      ...PROJECT,
      phases: {
        discovery: { status: 'complete', from: '/earlier' },
        plan: { status: 'approved', from: '/earlier' },
        components: { status: 'running' },
      },
    };
    expect(stagesOf(summary({ project })).find((stage) => stage.id === 'discovery')?.state).toBe('reused');
  });
});

describe('preflight before it records a phase', () => {
  // What workflow.ts init seeds: no preflight entry until preflight passes.
  const INIT = Object.fromEntries(
    ['discovery', 'inventory', 'usage', 'capture', 'tokens', 'plan', 'foundation', 'components', 'index', 'verify'].map(
      (name) => [name, { status: 'pending' }],
    ),
  );
  const fresh = (phases: Record<string, unknown> = {}) => ({ ...PROJECT, phases: { ...INIT, ...phases } });
  const checks = (done: number, total: number) => ({
    at: ago(1_000),
    checks: Array.from({ length: total }, (_, i) => ({
      id: `c${i}`,
      label: `check ${i}`,
      status: i < done ? 'done' : 'checking',
      message: null,
      dependsOn: [],
    })),
  });

  test('a live preflight shows as the active stage before it records a phase', () => {
    const s = summary({ project: fresh(), preflightChecks: checks(2, 5) });
    const stages = stagesOf(s);
    expect(stages.slice(0, 2).map((stage) => `${stage.label}:${stage.state}`)).toEqual([
      'Preflight:active',
      'Discovery:pending',
    ]);
    expect(stages[0]!.note).toBe('2 of 5 checks');
    expect(toneOf(s).label).toBe('Preflight');
  });

  test('preflight still running after discovery starts', () => {
    const s = summary({ project: fresh({ discovery: { status: 'running' } }) });
    const stages = stagesOf(s);
    expect(stages.slice(0, 2).map((stage) => `${stage.label}:${stage.state}`)).toEqual([
      'Preflight:active',
      'Discovery:active',
    ]);
    expect(toneOf(s).label).toBe('Preflight');
  });

  test('a figma-build run does not invent a preflight', () => {
    const project = {
      ...PROJECT,
      phases: {
        discovery: { status: 'complete', from: '/earlier' },
        plan: { status: 'approved', from: '/earlier' },
        components: { status: 'pending' },
      },
    };
    expect(summary({ project }).phases.some((phase) => phase.name === 'preflight')).toBe(false);
  });
});

describe('verification', () => {
  const FINISHED = {
    ...PROJECT,
    phases: {
      ...PROJECT.phases,
      components: { status: 'complete' },
      verify: { status: 'complete' },
      benchmark: { status: 'complete' },
    },
  };
  const report = (severities: string[], fields: Record<string, unknown> = {}) => ({
    generatedAt: ago(60_000),
    passed: ['a', 'b'],
    open: severities.map((severity) => ({ severity })),
    ...fields,
  });
  const verify = (s: ReturnType<typeof summary>) => stagesOf(s).find((stage) => stage.id === 'verify')!;

  test('open blockers flag Verify and the pill', () => {
    const open = [...Array(6).fill('blocker'), ...Array(2).fill('major'), ...Array(2).fill('minor')];
    const s = summary({ project: FINISHED, completion: '# done', scorecard: SCORED, verifyReport: report(open) });
    expect(verify(s).state).toBe('flagged');
    expect(verify(s).note).toBe('6 blockers · 2 major open');
    expect(toneOf(s)).toEqual({ label: 'Done · needs review', color: 'yellow' });
  });

  test('minor-only findings keep the check green and the note yellow', () => {
    const s = summary({
      project: FINISHED,
      completion: '# done',
      scorecard: SCORED,
      verifyReport: report(['minor', 'minor']),
    });
    expect(verify(s).state).toBe('done');
    expect(verify(s).note).toBe('2 minor open');
    expect(verify(s).noteColor).toBe('yellow');
    expect(toneOf(s)).toEqual({ label: 'Done', color: 'green' });
  });

  test('a finished run whose verify record never caught up is judged by its findings', () => {
    for (const status of ['pending', 'running']) {
      const project = { ...FINISHED, phases: { ...FINISHED.phases, verify: { status } } };
      const s = summary({ project, completion: '# done', scorecard: SCORED, verifyReport: report(['major']) });
      expect(verify(s).state, status).toBe('flagged');
      expect(toneOf(s), status).toEqual({ label: 'Done · needs review', color: 'yellow' });
    }
  });

  test("a report written before this run began is not this run's", () => {
    const s = summary({ project: FINISHED, verifyReport: report(['blocker'], { generatedAt: ago(90_000_000) }) });
    expect(s.findings).toBeNull();
    expect(verify(s).note).toBeNull();
  });

  test('the clean note counts waived checks, and a report with no passed list says nothing', () => {
    const s = summary({ project: FINISHED, verifyReport: report([], { waived: ['c'] }) });
    expect(verify(s).note).toBe('2 passed · 1 waived');
    expect(verify(s).noteColor).toBe('green');
    expect(summary({ project: FINISHED, verifyReport: { generatedAt: ago(60_000), open: [] } }).findings).toBeNull();
  });
});

describe('needs you and failure', () => {
  test('a stopped runner with no stop entry still asks for the person, with the fallback text', () => {
    const s = summary({ project: PROJECT, progress: progress({ lastSeen: ago(RUNNER_ABSENT_MS + 60_000) }) });
    expect(s.blocker).toBeNull();
    expect(isDown(s)).toBe(true);
    expect(needsYouOf(s)).toEqual({
      message: 'The Figma runner has stopped. Reopen it in Figma desktop, then press Resume run.',
      canResume: true,
    });
  });

  test('a preflight check that needs the person turns the pill and the stage yellow', () => {
    const project = { ...PROJECT, phases: { discovery: { status: 'pending' } } };
    const s = summary({
      project,
      preflightChecks: {
        at: ago(1_000),
        checks: [
          { id: 'runner', label: 'Figma runner', status: 'needs-you', message: 'Start the runner.', dependsOn: [] },
        ],
      },
    });
    expect(toneOf(s)).toEqual({ label: 'Needs you', color: 'yellow' });
    expect(stagesOf(s)[0]!.state).toBe('stopped');
    expect(needsYouOf(s)).toEqual({ message: 'Figma runner: Start the runner.', canResume: false });
  });

  test('a failed phase that is not current shows red', () => {
    const project = {
      ...PROJECT,
      phases: {
        preflight: { status: 'complete' },
        discovery: { status: 'complete' },
        inventory: { status: 'failed' },
        usage: { status: 'running' },
      },
    };
    const phaseLog = `${JSON.stringify({ phase: 'inventory', status: 'failed', message: 'components.json did not validate.' })}\n`;
    const s = summary({ project, phaseLog });
    expect(s.current).toBe('usage');
    expect(stagesOf(s).find((stage) => stage.id === 'discovery')?.state).toBe('failed');
    expect(toneOf(s)).toEqual({ label: 'Failed', color: 'red' });
    expect(failureOf(s)?.text).toBe('Discovery stopped with an error: components.json did not validate.');
  });

  test('a failure outranks every request for the person, so nothing offers to resume into it', () => {
    const project = {
      ...PROJECT,
      phases: { preflight: { status: 'complete' }, inventory: { status: 'failed' }, components: { status: 'running' } },
    };
    const checks = {
      at: ago(1_000),
      checks: [{ id: 'runner', label: 'Figma runner', status: 'needs-you', message: 'Start it.', dependsOn: [] }],
    };
    const asking = summary({ project, preflightChecks: checks });
    expect(needsYouOf(asking)).toBeNull();
    expect(toneOf(asking).label).toBe('Failed');
    const gone = summary({ project, progress: progress({ lastSeen: ago(RUNNER_ABSENT_MS + 60_000) }) });
    expect(isDown(gone)).toBe(true);
    expect(needsYouOf(gone), 'no Resume run over a failed phase').toBeNull();
  });

  test('a runner that failed turns Build red', () => {
    const project = { ...PROJECT, phases: { ...PROJECT.phases, components: { status: 'running' } } };
    const s = summary({ project, progress: progress({ state: 'failed', message: 'The plugin closed.' }) });
    expect(stagesOf(s).find((stage) => stage.id === 'build')?.state).toBe('failed');
    expect(toneOf(s).label).toBe('Failed');
    expect(failureOf(s)?.text).toBe('Build stopped with an error: The plugin closed.');
  });
});

describe('flow order', () => {
  test('key order in project.json does not change the current phase', () => {
    const running = {
      ...PROJECT,
      phases: { preflight: { status: 'complete' }, verify: { status: 'pending' }, connect: { status: 'running' } },
    };
    expect(summary({ project: running }).current).toBe('connect');
    const due = {
      ...PROJECT,
      phases: { preflight: { status: 'complete' }, verify: { status: 'pending' }, connect: { status: 'pending' } },
    };
    expect(summary({ project: due }).current).toBe('connect');
    expect(summary({ project: due }).phases.map((phase) => phase.name)).toEqual(['preflight', 'connect', 'verify']);
  });

  test('a copied phase marked running does not take the current phase', () => {
    const project = {
      ...PROJECT,
      phases: {
        preflight: { status: 'complete', from: '/earlier' },
        discovery: { status: 'running', from: '/earlier' },
        components: { status: 'pending' },
      },
    };
    expect(summary({ project }).current).toBe('components');
  });

  test('a stage whose only phase was copied while running is not shown as reused', () => {
    const project = {
      ...PROJECT,
      phases: {
        preflight: { status: 'complete' },
        discovery: { status: 'running', from: '/earlier' },
        components: { status: 'pending' },
      },
    };
    expect(stagesOf(summary({ project })).find((stage) => stage.id === 'discovery')?.state).not.toBe('reused');
  });

  test('two running stages are both active', () => {
    const project = {
      ...PROJECT,
      phases: {
        preflight: { status: 'complete' },
        discovery: { status: 'running' },
        components: { status: 'running' },
      },
    };
    const s = summary({ project, progress: progress() });
    expect(stagesOf(s).map((stage) => stage.state)).toEqual(['done', 'active', 'active', 'pending', 'pending']);
  });
});
