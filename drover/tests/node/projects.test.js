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

test('pickFolderMacOS returns null when runner throws', () => {
  const throwingRunner = () => { throw new Error('user canceled'); };
  assert.equal(projects.pickFolderMacOS({ runner: throwingRunner }), null);
});

test('pickFolderMacOS strips trailing slash', () => {
  const fakeRunner = () => '/Users/me/project/\n';
  assert.equal(projects.pickFolderMacOS({ runner: fakeRunner }), '/Users/me/project');
});
