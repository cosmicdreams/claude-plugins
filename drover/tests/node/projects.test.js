'use strict';
// Tests for tools/dashboard/projects.js — no HTTP server required.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const projects = require('../../tools/dashboard/projects.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drover-proj-'));
}

test('projectsFilePath honors DROVER_PROJECTS_FILE', () => {
  const orig = process.env.DROVER_PROJECTS_FILE;
  process.env.DROVER_PROJECTS_FILE = '/tmp/explicit.json';
  try {
    assert.equal(projects.projectsFilePath(), '/tmp/explicit.json');
  } finally {
    if (orig === undefined) delete process.env.DROVER_PROJECTS_FILE;
    else process.env.DROVER_PROJECTS_FILE = orig;
  }
});

test('listProjects returns [] when file missing', () => {
  const dir = tmpdir();
  const orig = process.env.DROVER_PROJECTS_FILE;
  process.env.DROVER_PROJECTS_FILE = path.join(dir, 'nope.json');
  try {
    assert.deepEqual(projects.listProjects(), []);
  } finally {
    if (orig === undefined) delete process.env.DROVER_PROJECTS_FILE;
    else process.env.DROVER_PROJECTS_FILE = orig;
    fs.rmSync(dir, { recursive: true });
  }
});

test('listProjects reads a valid projects file', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'projects.json');
  fs.writeFileSync(file, JSON.stringify([{ name: 'a', path: '/a' }]));
  const orig = process.env.DROVER_PROJECTS_FILE;
  process.env.DROVER_PROJECTS_FILE = file;
  try {
    const out = projects.listProjects();
    assert.equal(Array.isArray(out), true);
    assert.equal(out[0].name, 'a');
  } finally {
    if (orig === undefined) delete process.env.DROVER_PROJECTS_FILE;
    else process.env.DROVER_PROJECTS_FILE = orig;
    fs.rmSync(dir, { recursive: true });
  }
});

test('addProject returns script output as parsed JSON', () => {
  // Stub runner that returns a canned JSON string instead of running a script.
  const fakeRunner = () => '{"status":"added","name":"fakeproj","path":"/tmp/x"}';
  const result = projects.addProject('/tmp/x', { runner: fakeRunner, scriptPath: '/usr/bin/true' });
  assert.equal(result.status, 'added');
  assert.equal(result.name, 'fakeproj');
});

test('addProject returns error status when script fails with JSON stdout', () => {
  const err = Object.assign(new Error('boom'), {
    stdout: '{"status":"error","message":"no .ddev"}',
  });
  const fakeRunner = () => { throw err; };
  const result = projects.addProject('/nope', { runner: fakeRunner, scriptPath: '/usr/bin/true' });
  assert.equal(result.status, 'error');
  assert.match(result.message, /no \.ddev/);
});

test('addProject returns generic error when stdout is not JSON', () => {
  const err = Object.assign(new Error('bad'), { stdout: 'raw text', stderr: 'oops' });
  const fakeRunner = () => { throw err; };
  const result = projects.addProject('/nope', { runner: fakeRunner, scriptPath: '/usr/bin/true' });
  assert.equal(result.status, 'error');
  assert.match(result.message, /oops/);
});

test('parseBackfillOutput extracts event count and NEW/THRESH tallies', () => {
  const raw = [
    'NEW aaaa error php pncb.prod oh no',
    'NEW bbbb notice watchdog pncb.prod another',
    'THRESH aaaa count=50 error php pncb.prod',
    'BACKFILL done env=pncb.prod events=200',
  ].join('\n');
  const r = projects.parseBackfillOutput(raw);
  assert.equal(r.status, 'done');
  assert.equal(r.events, 200);
  assert.equal(r.new_fingerprints, 2);
  assert.equal(r.threshold_hits, 1);
});

test('backfill returns error object when alias missing', () => {
  assert.equal(projects.backfill('').status, 'error');
});

test('backfill dispatches to script and parses output', () => {
  const fakeRunner = () => 'NEW x error php pncb.prod msg\nBACKFILL done env=pncb.prod events=1\n';
  const r = projects.backfill('pncb.prod', { runner: fakeRunner, scriptPath: '/usr/bin/true' });
  assert.equal(r.status, 'done');
  assert.equal(r.events, 1);
  assert.equal(r.new_fingerprints, 1);
});

test('backfillAsync returns error when alias missing', () => {
  assert.equal(projects.backfillAsync('').status, 'error');
});

test('backfillAsync returns queued immediately without blocking', () => {
  const calls = [];
  const fakeSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { pid: 4242, unref() {} };
  };
  const dir = tmpdir();
  const r = projects.backfillAsync('pncb.prod', {
    logTypes: 'php-error',
    scriptPath: '/usr/bin/true',
    logDir: dir,
    spawner: fakeSpawn,
    nowFn: () => '2026-04-21T15-30-00',
  });
  assert.equal(r.status, 'queued');
  assert.equal(r.alias, 'pncb.prod');
  assert.equal(r.pid, 4242);
  assert.match(r.log, /drover-backfill-pncb\.prod-2026-04-21T15-30-00\.log$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, '/usr/bin/true');
  assert.deepEqual(calls[0].args, ['pncb.prod', 'php-error']);
  assert.equal(calls[0].opts.detached, true);
  // stdout + stderr must share an fd so interleaving is preserved in the log.
  assert.equal(calls[0].opts.stdio[0], 'ignore');
  assert.equal(calls[0].opts.stdio[1], calls[0].opts.stdio[2]);
  // The log file must actually exist (opened with fs.openSync + 'a').
  assert.ok(fs.existsSync(r.log));
});

test('backfillAsync sanitizes unsafe alias characters so log stays in logDir', () => {
  const fakeSpawn = () => ({ pid: 1, unref() {} });
  const dir = tmpdir();
  const r = projects.backfillAsync('pncb/../etc/passwd', {
    scriptPath: '/usr/bin/true',
    logDir: dir,
    spawner: fakeSpawn,
    nowFn: () => 'ts',
  });
  // No path separators survived — the basename cannot escape logDir.
  assert.ok(!r.log.slice(dir.length + 1).includes('/'));
  // Resolved path must still live inside logDir (no ../ escape).
  assert.ok(path.resolve(r.log).startsWith(path.resolve(dir)));
});

test('backfillAsync surfaces spawn failure as error status', () => {
  const dir = tmpdir();
  const throwingSpawn = () => { throw new Error('ENOENT'); };
  const r = projects.backfillAsync('pncb.prod', {
    scriptPath: '/nonexistent',
    logDir: dir,
    spawner: throwingSpawn,
    nowFn: () => 'ts',
  });
  assert.equal(r.status, 'error');
  assert.match(r.message, /spawn failed/);
});

test('pickFolderMacOS returns null when runner throws', () => {
  const throwingRunner = () => { throw new Error('user canceled'); };
  assert.equal(projects.pickFolderMacOS({ runner: throwingRunner }), null);
});

test('pickFolderMacOS strips trailing slash', () => {
  const fakeRunner = () => '/Users/me/project/\n';
  assert.equal(projects.pickFolderMacOS({ runner: fakeRunner }), '/Users/me/project');
});
