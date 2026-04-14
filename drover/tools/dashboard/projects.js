'use strict';
// Project registration helpers for the drover dashboard server.
// Separate module so tests can require it without starting the HTTP server.

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

function projectsFilePath() {
  if (process.env.DROVER_PROJECTS_FILE) return process.env.DROVER_PROJECTS_FILE;
  const base = process.env.CLAUDE_PLUGIN_DATA
    || `${process.env.HOME}/.claude/plugins/data/drover-fallback`;
  return path.join(base, 'projects.json');
}

function listProjects() {
  const file = projectsFilePath();
  try {
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return { error: `failed to read projects: ${e.message}` };
  }
}

function pickFolderMacOS({ runner = childProcess.execFileSync } = {}) {
  try {
    const out = runner('osascript', [
      '-e',
      'POSIX path of (choose folder with prompt "Pick the main folder of the project to add to drover")'
    ], { encoding: 'utf8' }).trim();
    return out.replace(/\/$/, '');
  } catch (_) {
    return null;
  }
}

function addProject(targetPath, { scriptPath, runner = childProcess.execFileSync } = {}) {
  const script = scriptPath
    || process.env.DROVER_ADD_PROJECT_SCRIPT
    || path.resolve(__dirname, '..', '..', 'scripts', 'add-project.sh');
  try {
    const out = runner(script, [targetPath], { encoding: 'utf8' });
    return JSON.parse(out.trim());
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString().trim() : '';
    if (stdout) {
      try { return JSON.parse(stdout); } catch (_) { /* fall through */ }
    }
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    return { status: 'error', message: stderr || e.message };
  }
}

function parseBackfillOutput(out) {
  const lines = (out || '').trim().split('\n').filter(Boolean);
  const summary = lines.find(l => l.startsWith('BACKFILL done')) || '';
  const m = summary.match(/events=(\d+)/);
  const newCount = lines.filter(l => l.startsWith('NEW ')).length;
  const threshCount = lines.filter(l => l.startsWith('THRESH ')).length;
  return {
    status: summary ? 'done' : 'error',
    events: m ? parseInt(m[1], 10) : 0,
    new_fingerprints: newCount,
    threshold_hits: threshCount,
    summary,
  };
}

function backfill(alias, { logTypes, scriptPath, runner = childProcess.execFileSync } = {}) {
  if (!alias) return { status: 'error', message: 'alias required' };
  const script = scriptPath
    || process.env.DROVER_BACKFILL_SCRIPT
    || path.resolve(__dirname, '..', '..', 'scripts', 'backfill.sh');
  const args = [alias];
  if (logTypes) args.push(logTypes);
  try {
    const out = runner(script, args, { encoding: 'utf8' });
    return parseBackfillOutput(out);
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString() : '';
    return { status: 'error', message: (e.stderr && e.stderr.toString()) || e.message, output: stdout };
  }
}

module.exports = { projectsFilePath, listProjects, pickFolderMacOS, addProject, backfill, parseBackfillOutput };
