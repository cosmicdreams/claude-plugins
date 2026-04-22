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
  // Synchronous variant — kept for tests and for any CLI path that wants
  // the fully-parsed result (events count, NEW/THRESH tallies). The
  // dashboard no longer uses this: it calls backfillAsync() so the
  // Acquia-polling latency doesn't block the user's click.
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

// Async backfill — spawn detached, redirect stdout/stderr to a per-job
// log file, and return immediately with { status: 'queued', log, pid }.
// Acquia log archive creation + polling + download can take many minutes;
// making the dashboard wait on that was blocking the user's click for the
// full duration with no progress. The log file lets the user (or a future
// SSE endpoint) tail progress independently.
//
// Overrides:
//   logDir:    where to place the log file (default /private/tmp)
//   spawner:   injection seam for tests (defaults to child_process.spawn)
//   nowFn:     timestamp generator for the log filename (tests control this)
function backfillAsync(alias, { logTypes, scriptPath, logDir, spawner, nowFn } = {}) {
  if (!alias) return { status: 'error', message: 'alias required' };
  const script = scriptPath
    || process.env.DROVER_BACKFILL_SCRIPT
    || path.resolve(__dirname, '..', '..', 'scripts', 'backfill.sh');
  const dir = logDir || process.env.DROVER_BACKFILL_LOG_DIR || '/private/tmp';
  const ts = (nowFn || (() => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)))();
  const safeAlias = String(alias).replace(/[^A-Za-z0-9._-]/g, '_');
  const logPath = path.join(dir, `drover-backfill-${safeAlias}-${ts}.log`);
  const args = [alias];
  if (logTypes) args.push(logTypes);

  let out, err;
  try {
    fs.mkdirSync(dir, { recursive: true });
    out = fs.openSync(logPath, 'a');
    err = out;  // same fd → stdout + stderr interleaved in the log
  } catch (e) {
    return { status: 'error', message: `cannot open log file ${logPath}: ${e.message}` };
  }

  const spawn = spawner || childProcess.spawn;
  let child;
  try {
    child = spawn(script, args, {
      detached: true,
      stdio: ['ignore', out, err],
      env: process.env,
    });
    child.unref();
  } catch (e) {
    try { fs.closeSync(out); } catch (_) {}
    return { status: 'error', message: `spawn failed: ${e.message}` };
  }

  // fs descriptors are inherited by the child; parent can close.
  try { fs.closeSync(out); } catch (_) {}

  return {
    status: 'queued',
    alias,
    log: logPath,
    pid: child.pid || null,
    message: `Backfill queued for ${alias}. Tail ${logPath} for progress.`,
  };
}

// Enumerate every registered project with a present .beads/drover.db file.
// Used by the dashboard's virtual-central view (sprint-0r3) to merge cards
// across projects and fan out file watchers for real-time cross-project
// updates — matches the pattern already used by recall-search.sh.
//
// Returns [{ project, path, dbPath }] in registration order, filtered to
// entries whose .beads/drover.db actually exists (so newly-added projects
// that have not yet run /drover:setup are silently skipped).
// Walk up from `dir` looking for a usable beads board. Supports two
// on-disk layouts seen in the wild:
//   1. `.beads/drover.db` exists (sqlite file OR dolt-backed directory)
//   2. `.beads/` itself is the db (dolt-only layout: config.yaml + dolt/
//      without a drover.db entry; bd's auto-discovery handles this)
// Also handles worktree-style repos where the project is registered at
// `/repo/worktrees/main` but the .beads directory lives at `/repo`.
function findBeadsDb(dir) {
  let cur = dir;
  const stop = process.env.HOME || '/';
  for (let i = 0; i < 6; i++) {
    const beadsDir = path.join(cur, '.beads');
    const droverDb = path.join(beadsDir, 'drover.db');
    if (fs.existsSync(droverDb)) return droverDb;
    // Dolt-only layout: no drover.db, but .beads has config.yaml + dolt/.
    if (fs.existsSync(beadsDir)) {
      const cfg = path.join(beadsDir, 'config.yaml');
      const dolt = path.join(beadsDir, 'dolt');
      if (fs.existsSync(cfg) && fs.existsSync(dolt)) return beadsDir;
    }
    const parent = path.dirname(cur);
    if (parent === cur || parent === stop) break;
    cur = parent;
  }
  return null;
}

// Union of ddev_project names across a projects list. Used by the dashboard
// in virtual-central mode to build the filter set for `ddev list -A`, so
// every registered project's ddev instance shows up — not just the one whose
// drover-config.json happened to be passed via --config. Pure so it stays
// testable; accepts any array (including a listProjects() result).
function ddevProjectNames(projectsList) {
  const out = new Set();
  if (!Array.isArray(projectsList)) return out;
  for (const p of projectsList) {
    if (p && typeof p === 'object' && p.ddev_project) out.add(p.ddev_project);
  }
  return out;
}

function listBoards() {
  return listProjects()
    .map(p => {
      const name = p.name || p.ddev_project;
      const dir = p.path;
      if (!name || !dir) return null;
      const dbPath = findBeadsDb(dir);
      if (!dbPath) return null;
      return { project: name, path: dir, dbPath };
    })
    .filter(Boolean);
}

module.exports = { projectsFilePath, listProjects, listBoards, ddevProjectNames, pickFolderMacOS, addProject, backfill, backfillAsync, parseBackfillOutput };
