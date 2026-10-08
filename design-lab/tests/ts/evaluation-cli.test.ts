import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pluginRoot } from '../../src/runtime.ts';
import { verifyFromFiles } from '../../src/verify.ts';
import { validate } from '../../src/contracts.ts';
import { hashLayout } from '../../src/determinism.ts';
import { evaluate, waitForBuild } from '../../src/rebuild.ts';
const write = (path: string, data: unknown) => {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
};
const cli = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [resolve(pluginRoot, 'scripts/evaluation.ts'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

void test('run-mode verification honors explicit waivers and output paths', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-verify-cli-'));
  try {
    write(resolve(root, 'figma/verify/state.json'), {});
    const report = verifyFromFiles(root, { out: resolve(root, 'baseline.json') }),
      waivers = resolve(root, 'waivers.json'),
      out = resolve(root, 'requested.json');
    write(waivers, {
      waivers: report.open.map((f) => ({ check: f.check, scope: f.scope, reason: 'approved fixture' })),
    });
    const result = cli(['verify', '--run', root, '--waivers', waivers, '--out', out]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).open, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('determinism CLI accepts check and uses the original numeric JSON tokens', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-determinism-cli-'));
  try {
    const layout = resolve(root, 'layout.json'),
      expected = resolve(root, 'hash.txt');
    writeFileSync(layout, '{"width":10.0,"children":[]}');
    writeFileSync(expected, hashLayout(layout));
    const pass = cli(['determinism', 'check', layout, expected]);
    assert.equal(pass.status, 0, pass.stderr);
    assert.equal(JSON.parse(pass.stdout).pass, true);
    writeFileSync(layout, '{"width":11.0,"children":[]}');
    const fail = cli(['determinism', 'check', layout, expected]);
    assert.equal(fail.status, 1, fail.stderr);
    assert.equal(JSON.parse(fail.stdout).pass, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('rebuild waiting trusts a completed injected dump instead of reading live state', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-wait-'));
  try {
    let dumpCalls = 0;
    await waitForBuild(root, 1, 0, {
      status: () => ({ next: null }),
      dumpStep: () => {
        dumpCalls++;
        return null;
      },
      sleep: async () => {
        throw new Error('should finish immediately');
      },
    });
    assert.equal(dumpCalls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('in-process evaluation records failed quality and still produces the benchmark', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-evaluate-'));
  try {
    write(resolve(root, 'project.json'), {
      schemaVersion: 1,
      standardVersion: '4.1.0',
      pluginVersion: '1.0',
      repository: { root, commit: null, dirty: false },
      decisions: {},
      phases: {},
      artifacts: {},
    });
    write(resolve(root, 'components.json'), { components: [] });
    write(resolve(root, 'plan.json'), { plans: [] });
    write(resolve(root, 'capture-evidence.json'), { captures: {} });
    write(resolve(root, 'figma/state.json'), {
      standardVersion: '4.1.0',
      fileKey: 'scratch',
      steps: [],
      done: [],
      planned: [],
    });
    write(resolve(root, 'figma/results/pages.json'), { pages: {} });
    write(resolve(root, 'figma/results/variables.json'), { collections: {} });
    write(resolve(root, 'figma/verify/root.json'), {});
    const result = await evaluate(root),
      project = JSON.parse(readFileSync(resolve(root, 'project.json'), 'utf8'));
    assert.equal(result.quality, 'failed');
    assert.equal(project.phases.verify.status, 'failed');
    assert.equal(project.phases.verify.detail.execution, 'finished');
    assert.equal(project.artifacts.verifyReport.valid, true);
    const card = JSON.parse(readFileSync(result.scorecard, 'utf8'));
    assert.deepEqual(validate('scorecard', card), []);
    assert.match(readFileSync(resolve(root, 'benchmark/report.html'), 'utf8'), /<!DOCTYPE html>/i);
    assert.match(readFileSync(resolve(root, 'benchmark/completion.md'), 'utf8'), /report/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('comparison CLI writes Markdown and scoreboard rows remain streamable JSONL', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-evaluation-cli-'));
  try {
    const a = resolve(root, 'a'),
      b = resolve(root, 'b'),
      markdown = resolve(root, 'comparison.md');
    mkdirSync(resolve(a, 'figma'), { recursive: true });
    mkdirSync(resolve(b, 'figma'), { recursive: true });
    const result = cli(['compare-runs', a, b, '--md', markdown]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(markdown, 'utf8'), /# Repeatability across runs/);
    const ledger = resolve(root, 'ledger.jsonl'),
      config = resolve(root, 'config.json');
    writeFileSync(ledger, '{"site":"first"}\n{"site":"second"}\n');
    write(config, {
      corpus: resolve(root, 'corpus'),
      scoreboard: { ledger, dashboard: resolve(root, 'dashboard.html') },
    });
    const rows = cli(['scoreboard', 'rows'], { DESIGN_LAB_CONFIG: config });
    assert.equal(rows.status, 0, rows.stderr);
    assert.deepEqual(
      rows.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).site),
      ['first', 'second'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
