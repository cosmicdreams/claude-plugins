#!/usr/bin/env node
/**
 * drover dashboard server
 * Zero-dependency Node.js HTTP server — Datadog/Splunk-style observability dashboard
 * for the drover error monitoring pipeline.
 *
 * Usage: node server.js --db <path> --state <path> [--config <path>] [--port 3749]
 * Port:  3749
 * Requires: Node.js >=18, bd CLI in PATH
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../../.claude-plugin/plugin.json'), 'utf8')).version || '';
  } catch { return ''; }
})();
const { execFileSync, execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);
const { URL } = require('url');

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

// Boolean flags (no value follows). Every other --key consumes the next
// argv token as its value.
const BOOL_FLAGS = new Set(['all-projects']);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (BOOL_FLAGS.has(key)) {
      args[key] = true;
    } else if (i + 1 < argv.length) {
      args[key] = argv[++i];
    }
  }
  return args;
}

const args = parseArgs(process.argv);

// --all-projects (or no --db) enables virtual-central mode: walk projects.json,
// open every registered project's .beads/drover.db, merge cards with a
// project tag. --db is an override for single-project mode (unchanged).
const ALL_PROJECTS = args['all-projects'] === true || !args.db;

if (!ALL_PROJECTS && !args.db) {
  console.error('Usage: node server.js [--all-projects] [--db <path>] --state <path> [--config <path>] [--port 3749]');
  process.exit(1);
}

const DB_PATH = args.db || '';
const STATE_PATH = args.state || '';
const CONFIG_PATH = args.config || '';
const PORT = parseInt(args.port || '3749', 10);

// In single-project mode, the db must exist. In all-projects mode we
// resolve boards lazily per request so new projects added mid-session
// show up on the next tick.
if (!ALL_PROJECTS) {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`drover.db not found at: ${DB_PATH}`);
    console.error('Run /drover:setup first to initialize the board.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANES = [
  { id: 'lane-triage',          label: 'TRIAGE',          hidden: false },
  { id: 'lane-ready',          label: 'READY',           hidden: false },
  { id: 'lane-implementing',   label: 'IMPLEMENTING',    hidden: false },
  { id: 'lane-awaiting-review', label: 'AWAITING REVIEW', hidden: false },
  { id: 'lane-done',           label: 'DONE',            hidden: true  },
  { id: 'lane-closed',         label: 'CLOSED',          hidden: true  },
];

const LANE_ORDER = LANES.map(l => l.id);
const SEVERITY_ICONS = {
  emergency: '\u{1F6A8}', critical: '\u{1F534}', alert: '\u{1F7E0}',
  error: '\u{1F7E1}', warning: '\u{1F535}', notice: '\u26AA', info: '\u26AA', debug: '\u26AA',
};

const CACHE_TTL = 5000; // 5 seconds
let ticketCache = { data: null, ts: 0 };

// ---------------------------------------------------------------------------
// DDEV Instance Management
// ---------------------------------------------------------------------------

const DDEV_POLL_INTERVAL = 15000; // 15 seconds
let ddevCache = { instances: [], ts: 0 };
const ddevActions = new Map(); // project -> 'starting' | 'stopping'

// Build the set of DDEV project names relevant to this drover instance.
// In virtual-central mode we show ALL running ddev instances — the user is
// watching every project so filtering by registered names would hide
// worktree instances (AHRI-626, AHRI-d11-upgrade, etc.) that aren't
// individually registered. Return null to signal "no filter, show all".
// In single-project mode, restrict to what the config declares.
function getRelevantDdevProjects() {
  if (ALL_PROJECTS) return null;
  const names = new Set();
  const config = fetchConfig();
  if (config && Array.isArray(config.environments)) {
    for (const env of config.environments) {
      if (env.ddev_project) names.add(env.ddev_project);
    }
  }
  if (config && config.ddev_management && Array.isArray(config.ddev_management.instances)) {
    for (const inst of config.ddev_management.instances) {
      if (inst.ddev_project || inst.name) names.add(inst.ddev_project || inst.name);
    }
  }
  return names.size > 0 ? names : null;
}

function fetchDdevInstances() {
  const now = Date.now();
  if (ddevCache.instances.length && (now - ddevCache.ts) < DDEV_POLL_INTERVAL) {
    return applyActionStates(ddevCache.instances);
  }
  try {
    const output = execFileSync('ddev', ['list', '-A', '--json-output'], {
      encoding: 'utf8', timeout: 10000
    });
    const parsed = JSON.parse(output);
    // ddev list -A --json-output returns { raw: [...] }
    const raw = parsed.raw || parsed || [];
    const relevantProjects = getRelevantDdevProjects();
    const instances = (Array.isArray(raw) ? raw : []).map(item => ({
      name: item.name || '',
      status: normalizeDdevStatus(item.status || ''),
      type: item.type || '',
      approot: item.approot || '',
      httpUrl: item.httpurl || '',
      httpsUrl: item.httpsurl || '',
    })).filter(i => {
      if (!i.name) return false;
      // If we have a config with known projects, filter to those
      if (relevantProjects) return relevantProjects.has(i.name);
      return true;
    });

    ddevCache = { instances, ts: now };
    return applyActionStates(instances);
  } catch (err) {
    // If ddev is not installed or fails, return empty
    if (ddevCache.instances.length) return applyActionStates(ddevCache.instances);
    return [];
  }
}

function normalizeDdevStatus(raw) {
  const s = String(raw).toLowerCase();
  if (s.includes('running') || s.includes('ok')) return 'running';
  if (s.includes('stopped') || s.includes('exited')) return 'stopped';
  if (s.includes('paused')) return 'stopped';
  if (s.includes('starting')) return 'starting';
  return 'stopped';
}

function applyActionStates(instances) {
  return instances.map(i => {
    const action = ddevActions.get(i.name);
    if (action) return { ...i, status: action };
    return i;
  });
}

// Log buffers for DDEV operations: Map<project, {lines:[], status:'running'|'done'|'error', startedAt}>
const ddevLogs = new Map();
const DDEV_LOG_MAX_LINES = 500;

function appendDdevLog(project, line, stream) {
  let buf = ddevLogs.get(project);
  if (!buf) {
    buf = { lines: [], status: 'running', startedAt: Date.now() };
    ddevLogs.set(project, buf);
  }
  const elapsed = ((Date.now() - buf.startedAt) / 1000).toFixed(1);
  const entry = { ts: elapsed, text: line, stream };
  buf.lines.push(entry);
  if (buf.lines.length > DDEV_LOG_MAX_LINES) buf.lines.shift();
  broadcast('ddev-log', { project, ...entry });
}

function finishDdevLog(project, success) {
  const buf = ddevLogs.get(project);
  if (buf) {
    buf.status = success ? 'done' : 'error';
    const label = success ? 'completed successfully' : 'failed';
    appendDdevLog(project, project + ' ' + label, success ? 'ok' : 'stderr');
  }
  broadcast('ddev-log-done', { project, success });
}

function spawnDdevCommand(project, args, actionState) {
  // Init log buffer
  ddevLogs.set(project, { lines: [], status: 'running', startedAt: Date.now() });
  ddevActions.set(project, actionState);
  broadcast('ddev-status', fetchDdevInstances());

  const child = spawn('ddev', args, { timeout: 180000 });
  let remainder = { stdout: '', stderr: '' };

  function processLines(stream, chunk) {
    const text = remainder[stream] + chunk;
    const lines = text.split('\n');
    remainder[stream] = lines.pop(); // keep incomplete last line
    for (const line of lines) {
      if (line.trim()) appendDdevLog(project, line, stream);
    }
  }

  child.stdout.on('data', (data) => processLines('stdout', data.toString()));
  child.stderr.on('data', (data) => processLines('stderr', data.toString()));

  child.on('close', (code) => {
    // Flush remainders
    if (remainder.stdout.trim()) appendDdevLog(project, remainder.stdout, 'stdout');
    if (remainder.stderr.trim()) appendDdevLog(project, remainder.stderr, 'stderr');

    const success = code === 0;
    ddevActions.delete(project);
    ddevCache.ts = 0;
    finishDdevLog(project, success);
    const updated = fetchDdevInstances();
    broadcast('ddev-status', updated);
  });

  child.on('error', (err) => {
    ddevActions.delete(project);
    ddevCache.ts = 0;
    appendDdevLog(project, 'Process error: ' + err.message, 'stderr');
    finishDdevLog(project, false);
    broadcast('ddev-status', fetchDdevInstances());
  });
}

function handleDdevStart(project) {
  spawnDdevCommand(project, ['start', project], 'starting');
}

function handleDdevStop(project) {
  spawnDdevCommand(project, ['stop', project], 'stopping');
}

// Poll DDEV status periodically and broadcast changes
let lastDdevJson = '';
setInterval(() => {
  ddevCache.ts = 0; // force refresh
  const instances = fetchDdevInstances();
  const json = JSON.stringify(instances);
  if (json !== lastDdevJson) {
    lastDdevJson = json;
    broadcast('ddev-status', instances);
  }
}, DDEV_POLL_INTERVAL);

// ---------------------------------------------------------------------------
// Data Layer
// ---------------------------------------------------------------------------

// Resolve the set of boards to query. In single-project mode this is a
// one-entry array wrapping DB_PATH; in all-projects mode it's every
// registered project from projects.json (resolved on each call so
// add-project registrations surface without restart).
function currentBoards() {
  if (ALL_PROJECTS) {
    const boards = projectsModule.listBoards();
    // Also include the launch-directory's board (passed via --config) even
    // when it hasn't been registered with /drover:add-project yet. Without
    // this, running /drover:dashboard from a project directory that isn't in
    // projects.json produces a blank dashboard — confusing for first-time use.
    if (CONFIG_PATH) {
      const configProjectDir = path.dirname(path.dirname(CONFIG_PATH));
      const configDb = projectsModule.findBeadsDb(configProjectDir);
      if (configDb && !boards.some(b => b.dbPath === configDb)) {
        const name = path.basename(configProjectDir);
        boards.push({ project: name, path: configProjectDir, dbPath: configDb });
      }
    }
    return boards;
  }
  // Single-project mode: derive a stable label from the --db path.
  const dir = path.dirname(DB_PATH);
  const project = path.basename(path.dirname(dir));
  return [{ project: project || 'project', path: path.dirname(dir), dbPath: DB_PATH }];
}

// sprint-56q: Query a single bd board. Returns { rows } on success or
// { error } on any failure — extracted so Promise.all can fan out board
// queries in parallel. Per-board 5s timeout keeps one stuck db from
// blocking the whole page load.
async function queryBoard(board) {
  try {
    const { stdout } = await execFileP('bd', [
      'list', '-l', 'board-drover', '--db', board.dbPath, '--json', '--flat'
    ], { encoding: 'utf8', timeout: 5000 });
    let rows;
    try {
      rows = JSON.parse(stdout || '[]');
    } catch {
      return { project: board.project, error: 'invalid JSON from bd' };
    }
    if (!Array.isArray(rows)) {
      const msg = (rows && rows.error) ? rows.error : 'non-array response from bd';
      return { project: board.project, error: msg };
    }
    return { project: board.project, rows };
  } catch (err) {
    return { project: board.project, error: err.message };
  }
}

// sprint-56q: parallel board fetch. Previously N sequential execFileSync
// calls stalled first paint for seconds as more projects registered.
// Now execFile + Promise.all so overall latency is max-over-boards, not
// sum-over-boards.
async function fetchTickets() {
  const now = Date.now();
  if (ticketCache.data && (now - ticketCache.ts) < CACHE_TTL) {
    return ticketCache.data;
  }
  const boards = currentBoards();
  // sprint-2g8: project registry map for hostname resolution. Built once
  // per fetchTickets so we don't re-read projects.json per ticket.
  const projectRegistry = new Map();
  try {
    for (const p of projectsModule.listProjects()) {
      if (p && p.name) projectRegistry.set(p.name, p);
    }
  } catch { /* silent — hostname enrichment is best-effort */ }

  const results = await Promise.all(boards.map(queryBoard));
  const merged = [];
  const boardErrors = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const b = boards[i];
    if (r.error) {
      boardErrors.push({ project: r.project, message: r.error });
      continue;
    }
    const proj = projectRegistry.get(b.project) || null;
    for (const t of r.rows) {
      t.project = b.project;
      // `bd list --json` returns the issue body under `description`, but the
      // dashboard (server-side solution parser + client-side parseCardClient)
      // historically reads `ticket.body`. Alias here so both code paths see
      // the same content without each having to probe both field names.
      if (!t.body && t.description) t.body = t.description;
      const envLabels = (t.labels || [])
        .filter(l => typeof l === 'string' && l.startsWith('env-'))
        .map(l => l.replace('env-', ''));
      t.hostnames = projectsModule.resolveCardHostnames({ project: b.project, envLabels }, proj);
      merged.push(t);
    }
  }
  // If everything failed AND there was nothing to show, return an error
  // object (the UI renders that). Otherwise return the (possibly partial)
  // list — a broken PNCB db should not hide AHRI's cards.
  if (!merged.length && boardErrors.length) {
    return { error: boardErrors.map(e => `${e.project}: ${e.message}`).join('\n') };
  }
  if (boardErrors.length) {
    console.warn('fetchTickets: partial errors:', JSON.stringify(boardErrors));
  }
  ticketCache = { data: merged, ts: now };
  return merged;
}

function parseField(body, pattern, fallback) {
  if (fallback === undefined) fallback = '';
  const m = body && body.match(pattern);
  return m ? m[1].trim() : fallback;
}

// sprint-0r3/sprint-wgy dashboard integration — parse the Projected/Actual
// Solution blocks written by drover:implementer and /drover:solution.
// Returns { projected, actual } where each is either null or an object with
// the block's structured fields. Source is the concatenation of ticket body
// and notes because implementer historically appended via --append-notes
// but older cards may have it in body.
function parseSolutionBlocks(ticket) {
  const text = ((ticket.body || '') + '\n' + (ticket.notes || ''));
  return {
    projected: extractSolutionBlock(text, 'Projected'),
    actual: extractSolutionBlock(text, 'Actual'),
  };
}

function extractSolutionBlock(text, kind) {
  // Match "### Projected" or "### Actual" headers followed by field lines.
  // Block ends at the next "### " header or end of text.
  const headerRe = new RegExp('###\\s+' + kind + '\\b([\\s\\S]*?)(?=\\n###\\s+|$)', 'i');
  const m = text.match(headerRe);
  if (!m) return null;
  const section = m[1];
  const fields = {};
  // Parse bullet lines like `- **key:** value`. Use matchAll (not .exec)
  // to walk all occurrences; the hook treats regex.exec as a shell-exec
  // false positive.
  for (const fm of section.matchAll(/-\s+\*\*([a-z_]+):\*\*\s*(.+)/gi)) {
    fields[fm[1].toLowerCase()] = fm[2].trim();
  }
  const whenMatch = section.match(/\(written:\s*([^,)]+)(?:,\s*by:\s*([^)]+))?\)/);
  if (whenMatch) {
    fields.written_at = whenMatch[1].trim();
    if (whenMatch[2]) fields.written_by = whenMatch[2].trim();
  }
  return Object.keys(fields).length ? fields : null;
}

function formatAge(dateStr) {
  if (!dateStr) return '?';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function parseCard(ticket) {
  const labels = ticket.labels || [];
  const body = ticket.body || '';

  const severityLabel = (labels.find(l => l.startsWith('severity-')) || '').replace('severity-', '') || 'unknown';
  const envLabels = labels.filter(l => l.startsWith('env-')).map(l => l.replace('env-', ''));
  const fp = parseField(body, /\*\*Fingerprint:\*\*\s+`([a-f0-9]+)`/, '[unknown]');
  const occurrences = parseField(body, /\*\*Total Occurrences:\*\*\s+(\d+)/, '0');
  const worktree = parseField(body, /\*\*Worktree:\*\*\s+(\S+)/);
  const assignee = parseField(body, /\*\*Assignee:\*\*\s+(\S+)/);
  const firstSeen = parseField(body, /\*\*First seen:\*\*\s+(.+)/);
  const lastSeen = parseField(body, /\*\*Last seen:\*\*\s+(.+)/);

  // Extract stack trace lines
  const stackMatch = body.match(/## Stack Trace\n```[\s\S]*?\n([\s\S]*?)```/);
  const stack = stackMatch ? stackMatch[1].trim().split('\n').filter(Boolean) : [];

  // Extract triage log entries from notes
  const notes = ticket.notes || '';
  const triageLog = notes.split('\n').filter(Boolean).map(line => {
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:]+Z?):\s*(.*)/);
    if (tsMatch) return { ts: tsMatch[1].slice(5, 16).replace('T', ' '), msg: tsMatch[2] };
    return { ts: '', msg: line };
  }).filter(entry => entry.msg);

  const solution = parseSolutionBlocks(ticket);

  return {
    id: ticket.id || '[unknown]',
    title: ticket.title || '[untitled]',
    // sprint-0r3: carry through the board's project tag so the UI can
    // group / badge cards by source project in virtual-central mode.
    project: ticket.project || '',
    // sprint-2g8: server-attached hostnames so the card row/modal show
    // pncb.prod.acquia-sites.com instead of just "production".
    hostnames: Array.isArray(ticket.hostnames) ? ticket.hostnames : [],
    // sprint-wgy dashboard integration — structured Projected/Actual
    // solution blocks rendered in the card modal.
    projected: solution.projected,
    actual: solution.actual,
    lane: labels.find(l => l.startsWith('lane-')) || 'lane-triage',
    severityLabel,
    severityIcon: SEVERITY_ICONS[severityLabel] || '\u26AA',
    envLabels,
    fp,
    occurrences: parseInt(occurrences) || 0,
    worktree,
    assignee,
    firstSeen,
    lastSeen,
    age: formatAge(ticket.created_at),
    stack,
    triageLog,
    createdAt: ticket.created_at || '',
  };
}

function fetchTimeline() {
  if (!STATE_PATH || !fs.existsSync(STATE_PATH)) return [];
  try {
    const lines = fs.readFileSync(STATE_PATH, 'utf8').trim().split('\n').filter(Boolean);
    return lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(entry => entry && entry.cycle_summary);
  } catch {
    return [];
  }
}

function fetchConfig() {
  if (!CONFIG_PATH || !fs.existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchHealth() {
  const tickets = await fetchTickets();
  if (tickets.error) return { error: tickets.error };

  const cards = Array.isArray(tickets) ? tickets.map(parseCard) : [];
  const config = fetchConfig();
  const timeline = fetchTimeline();
  const lastCycle = timeline.length ? timeline[timeline.length - 1] : null;

  // Derive environments from ticket labels or config
  const envSet = new Set();
  cards.forEach(c => c.envLabels.forEach(e => envSet.add(e)));
  if (config && config.environments) {
    config.environments.forEach(e => envSet.add(e.name));
  }

  const envHealth = {};
  for (const env of envSet) {
    const envCards = cards.filter(c => c.envLabels.includes(env) && !['lane-done', 'lane-closed'].includes(c.lane));
    const critCount = envCards.filter(c => ['emergency', 'critical'].includes(c.severityLabel)).length;
    const warnCount = envCards.filter(c => ['alert', 'error', 'warning'].includes(c.severityLabel)).length;

    let status = 'ok';
    let statusLabel = 'Healthy';
    if (critCount > 0) { status = 'crit'; statusLabel = 'Critical'; }
    else if (warnCount > 0) { status = 'warn'; statusLabel = 'Warning'; }

    envHealth[env] = {
      name: env,
      status,
      statusLabel,
      count: envCards.length,
      critCount,
      warnCount,
    };
  }

  return {
    environments: envHealth,
    lastCycle: lastCycle ? lastCycle.cycle_summary : null,
    lastCycleTs: lastCycle ? lastCycle.ts : null,
    totalOpen: cards.filter(c => !['lane-done', 'lane-closed'].includes(c.lane)).length,
    totalReady: cards.filter(c => c.lane === 'lane-ready').length,
    totalInflight: cards.filter(c => c.lane === 'lane-implementing').length,
  };
}

// ---------------------------------------------------------------------------
// HTTP Helpers
// ---------------------------------------------------------------------------

function jsonResponse(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

// Debounced watchers
let boardDebounce = null;
let stateDebounce = null;

function setupWatchers() {
  // sprint-0r3: fan out file watchers. In all-projects mode we register
  // one fs.watch per registered project's .beads/ directory so any write
  // (triage-created ticket, user-closed card, etc) pushes an SSE update
  // to the dashboard regardless of which project the user's "currently
  // looking at". Critical for the "I'm viewing AHRI but PNCB just got
  // a new error" case — without fan-out the card would only appear on
  // next manual refresh.
  const boards = currentBoards();
  const watchedDirs = new Set();
  for (const b of boards) {
    const beadsDir = path.dirname(b.dbPath);
    if (watchedDirs.has(beadsDir)) continue;
    watchedDirs.add(beadsDir);
    try {
      fs.watch(beadsDir, { persistent: false }, () => {
        if (boardDebounce) clearTimeout(boardDebounce);
        boardDebounce = setTimeout(() => {
          ticketCache = { data: null, ts: 0 }; // invalidate cache
          broadcast('board-update', {
            ts: new Date().toISOString(),
            project: b.project,
          });
        }, 500);
      });
    } catch {
      console.warn(`Could not watch .beads/ directory for ${b.project}`);
    }
  }

  // Watch state file for cycle completions
  if (STATE_PATH && fs.existsSync(STATE_PATH)) {
    try {
      fs.watchFile(STATE_PATH, { interval: 2000, persistent: false }, () => {
        if (stateDebounce) clearTimeout(stateDebounce);
        stateDebounce = setTimeout(() => {
          broadcast('cycle-complete', { ts: new Date().toISOString() });
        }, 500);
      });
    } catch {
      console.warn('Could not watch state file');
    }
  }
}

// SSE heartbeat
setInterval(() => {
  for (const client of sseClients) {
    try { client.write(': heartbeat\n\n'); } catch { sseClients.delete(client); }
  }
}, 30000);

// ---------------------------------------------------------------------------
// T2: Auto-ingestion — arm the umbrella watcher on dashboard launch so
// /drover:dashboard is a one-shot entry point ("open the dashboard, data
// flows in"). Without this, the dashboard renders cold cards only — the
// umbrella only ran when explicitly armed elsewhere (harness monitor,
// /drover:watch, /loop).
//
// Contract:
//   - Dashboard owns one umbrella child. PID recorded at DASHBOARD_UMBRELLA_PID
//     so a second dashboard launch doesn't double-spawn.
//   - Umbrella stdout lines (format: "[key] NEW <fp> <sev> <src> <env> <msg>")
//     are parsed and routed to `bd create` in the project's drover.db.
//   - Per-project / per-source ingestion status is tracked in memory and
//     exposed via /api/ingestion/status so the UI can render the
//     "Listening for stream messages…" empty state on Pulse tiles.
//   - SIGINT/SIGTERM kills the umbrella + child watchers; no orphans.
//   - If a non-dashboard-owned umbrella is already running we log a
//     warning but proceed with our own spawn because its stdout is
//     captured by the harness, not by us. De-duplication at the bd-level
//     (fingerprint uniqueness) prevents duplicate cards.
// ---------------------------------------------------------------------------

const DASHBOARD_UMBRELLA_PID_FILE = path.join(process.env.HOME || '/tmp', '.claude', 'drover.umbrella.dashboard.pid');
const INGEST_STATE_DIR = path.join(
  process.env.CLAUDE_PLUGIN_DATA
    || path.join(process.env.HOME || '/tmp', '.claude/plugins/data/drover-fallback'),
  'dashboard-ingest-state'
);

let umbrellaChild = null;
// Map<project-name, { armed, firstEventTs, eventCount, sources }>
const ingestionStatus = new Map();
let ingestionArmedAt = null;
// Reverse lookups: key (ddev:<name> | acquia:<env.uuid>) -> {project, source, dbPath, envLabel, alias, trustLevel}
const ingestionKeyIndex = new Map();

function buildIngestionIndex() {
  ingestionKeyIndex.clear();
  ingestionStatus.clear();
  let projects = [];
  try { projects = projectsModule.listProjects() || []; } catch { projects = []; }
  for (const p of projects) {
    if (!p || !p.path) continue;
    const dbPath = projectsModule.findBeadsDb(p.path);
    if (!dbPath) continue;
    const projName = p.name || p.ddev_project || path.basename(p.path);
    ingestionStatus.set(projName, {
      project: projName,
      path: p.path,
      armed: true,
      firstEventTs: null,
      lastEventTs: null,
      eventCount: 0,
      sources: {},
    });
    const ddevName = p.ddev_project || p.name;
    if (ddevName) {
      ingestionKeyIndex.set(`ddev:${ddevName}`, {
        project: projName, source: 'ddev', dbPath,
        envLabel: ddevName, alias: ddevName, trustLevel: 'low',
      });
    }
    const parentUuid = (p.acquia && p.acquia.app_uuid) || '';
    for (const e of (p.acquia && p.acquia.environments) || []) {
      const envName = e.env || e.name || '';
      const appUuid = e.app_uuid || parentUuid;
      const alias = e.alias || (envName && p.name ? `${p.name}.${envName}` : envName);
      if (appUuid && envName) {
        ingestionKeyIndex.set(`acquia:${envName}.${appUuid}`, {
          project: projName, source: `acquia:${envName}`, dbPath,
          envLabel: envName, alias, trustLevel: e.trust_level || 'medium',
        });
      }
    }
  }
}

function markEvent(key) {
  const meta = ingestionKeyIndex.get(key);
  if (!meta) return null;
  const st = ingestionStatus.get(meta.project);
  if (!st) return meta;
  const now = new Date().toISOString();
  if (!st.firstEventTs) st.firstEventTs = now;
  st.lastEventTs = now;
  st.eventCount++;
  const srcKey = meta.source;
  if (!st.sources[srcKey]) st.sources[srcKey] = { count: 0, firstTs: now, lastTs: now };
  st.sources[srcKey].count++;
  st.sources[srcKey].lastTs = now;
  return meta;
}

// Fingerprint-existence cache per db (session-scoped).
const ingestExistingFp = new Map(); // dbPath -> Set<fp>

async function getExistingFingerprints(dbPath) {
  if (ingestExistingFp.has(dbPath)) return ingestExistingFp.get(dbPath);
  const set = new Set();
  try {
    const { stdout } = await execFileP('bd', [
      'list', '-l', 'board-drover', '--db', dbPath, '--json', '--flat'
    ], { encoding: 'utf8', timeout: 10000 });
    const cards = JSON.parse(stdout || '[]');
    if (Array.isArray(cards)) {
      for (const c of cards) {
        const body = c.description || c.body || '';
        const m = body.match(/\*\*Fingerprint:\*\*\s+`([a-f0-9]+)`/);
        if (m) set.add(m[1]);
      }
    }
  } catch { /* treat as empty */ }
  ingestExistingFp.set(dbPath, set);
  return set;
}

// Parse one umbrella stdout line.
//   [<kind>:<id>] NEW <fp> <severity> <source> <env> <message...>
//   [<kind>:<id>] THRESH <fp> count=<n> <severity> <source> <env>
async function handleUmbrellaLine(rawLine) {
  const line = rawLine.trim();
  if (!line) return;
  const m = line.match(/^\[([^\]]+)\]\s+(.+)$/);
  if (!m) return;
  const key = m[1];
  const payload = m[2];

  if (payload.startsWith('NEW ')) {
    const parts = payload.slice(4).split(' ');
    if (parts.length < 5) return;
    const fp = parts[0];
    const sev = parts[1];
    const src = parts[2];
    const msg = parts.slice(4).join(' ').slice(0, 200);
    const meta = markEvent(key);
    if (!meta) return;
    try {
      const existing = await getExistingFingerprints(meta.dbPath);
      if (existing.has(fp)) return;
      const sevLabel = SEV_LABEL_MAP[sev] || 'error';
      const title = `[${(sev || 'error').toUpperCase()}] ${src || 'source'}: ${msg || '(no message)'}`;
      const body =
        `**Fingerprint:** \`${fp}\`\n` +
        `**Total Occurrences:** 1\n` +
        `**Source:** ${src || 'unknown'}\n` +
        `**Ingested via:** dashboard live stream\n\n` +
        `## Error Message\n${msg || '(no message)'}\n`;
      const labels = `board-drover,lane-triage,severity-${sevLabel},source-${src || 'unknown'},env-${meta.envLabel},trust-${meta.trustLevel}`;
      await execFileP('bd', ['create', title, '--db', meta.dbPath, '--labels', labels, '--description', body],
        { encoding: 'utf8', timeout: 8000 });
      existing.add(fp);
      ticketCache = { data: null, ts: 0 };
      broadcast('board-update', { ts: new Date().toISOString(), project: meta.project, via: 'live-ingest' });
      broadcast('ingest-event', { ts: new Date().toISOString(), project: meta.project, source: meta.source, fp });
      console.log(`[ingest] NEW ${fp} ${sev} ${src} -> bd card in project=${meta.project}`);
    } catch (err) {
      console.warn(`[ingest] bd create failed for fp=${fp}: ${err.message}`);
    }
    return;
  }

  if (payload.startsWith('THRESH ')) {
    markEvent(key);
    broadcast('ingest-event', { ts: new Date().toISOString(), key, kind: 'threshold' });
  }
}

function readExistingDashboardPid() {
  try {
    if (!fs.existsSync(DASHBOARD_UMBRELLA_PID_FILE)) return 0;
    const pid = parseInt(fs.readFileSync(DASHBOARD_UMBRELLA_PID_FILE, 'utf8').trim(), 10);
    if (!pid) return 0;
    try { process.kill(pid, 0); return pid; } catch { return 0; }
  } catch { return 0; }
}

function detectExternalUmbrellas(ownPid) {
  try {
    const out = execFileSync('pgrep', ['-f', 'umbrella-watch.sh'], { encoding: 'utf8', timeout: 3000 });
    return out.split('\n').map(s => parseInt(s.trim(), 10)).filter(p => p && p !== ownPid);
  } catch { return []; }
}

function startAutoIngestion() {
  try { fs.mkdirSync(path.dirname(DASHBOARD_UMBRELLA_PID_FILE), { recursive: true }); } catch {}
  try { fs.mkdirSync(INGEST_STATE_DIR, { recursive: true }); } catch {}

  buildIngestionIndex();
  if (ingestionKeyIndex.size === 0) {
    console.log('[ingest] no registered projects with bd boards; umbrella not armed');
    return;
  }

  const existing = readExistingDashboardPid();
  if (existing) {
    console.log(`[ingest] dashboard-owned umbrella already alive (pid=${existing}); not double-arming`);
    ingestionArmedAt = new Date().toISOString();
    return;
  }

  const plugin = path.resolve(__dirname, '../../');
  const umbrella = path.join(plugin, 'scripts/monitors/umbrella-watch.sh');
  if (!fs.existsSync(umbrella)) {
    console.warn(`[ingest] umbrella-watch.sh not found at ${umbrella}; auto-arm disabled`);
    return;
  }

  const external = detectExternalUmbrellas(process.pid);
  if (external.length > 0) {
    console.log(`[ingest] note: ${external.length} external umbrella watcher(s) running (pids=${external.join(',')}); spawning dashboard-owned child for live UI events. bd fingerprint dedup prevents duplicate cards.`);
  }

  const env = Object.assign({}, process.env, {
    DROVER_STATE_DIR: INGEST_STATE_DIR,
    DROVER_UMBRELLA_LOG: path.join(process.env.HOME || '/tmp', '.claude', 'drover.umbrella.dashboard.log'),
    DROVER_UMBRELLA_POLL: process.env.DROVER_UMBRELLA_POLL || '15',
    DROVER_NOTIFY_DISABLE: '1',
  });

  try {
    umbrellaChild = spawn('bash', [umbrella], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
  } catch (err) {
    console.warn(`[ingest] failed to spawn umbrella: ${err.message}`);
    umbrellaChild = null;
    return;
  }

  try { fs.writeFileSync(DASHBOARD_UMBRELLA_PID_FILE, String(umbrellaChild.pid) + '\n'); } catch {}
  ingestionArmedAt = new Date().toISOString();
  console.log(`[ingest] umbrella armed (pid=${umbrellaChild.pid}); state-dir=${INGEST_STATE_DIR}; projects=${ingestionStatus.size}`);

  let carry = '';
  umbrellaChild.stdout.on('data', chunk => {
    const combined = carry + chunk.toString('utf8');
    const lines = combined.split('\n');
    carry = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      handleUmbrellaLine(line).catch(err => console.warn(`[ingest] handler error: ${err.message}`));
    }
  });

  umbrellaChild.stderr.on('data', chunk => {
    const text = chunk.toString('utf8').trim();
    if (text) console.log(`[ingest stderr] ${text.split('\n').slice(0, 3).join(' | ')}`);
  });

  umbrellaChild.on('exit', (code, signal) => {
    console.log(`[ingest] umbrella exited code=${code} signal=${signal || ''}`);
    umbrellaChild = null;
    try { fs.unlinkSync(DASHBOARD_UMBRELLA_PID_FILE); } catch {}
  });
}

function stopAutoIngestion() {
  if (umbrellaChild && !umbrellaChild.killed) {
    try { umbrellaChild.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      if (umbrellaChild && !umbrellaChild.killed) {
        try { umbrellaChild.kill('SIGKILL'); } catch {}
      }
    }, 2000).unref();
  }
  try { fs.unlinkSync(DASHBOARD_UMBRELLA_PID_FILE); } catch {}
}

function ingestionStatusSnapshot() {
  const projects = {};
  for (const [k, v] of ingestionStatus.entries()) {
    projects[k] = {
      project: v.project,
      armed: v.armed,
      firstEventTs: v.firstEventTs,
      lastEventTs: v.lastEventTs,
      eventCount: v.eventCount,
      sources: v.sources,
    };
  }
  return {
    armedAt: ingestionArmedAt,
    umbrellaPid: umbrellaChild && umbrellaChild.pid || 0,
    umbrellaAlive: !!(umbrellaChild && !umbrellaChild.killed),
    projects,
  };
}

process.on('SIGINT', () => { stopAutoIngestion(); process.exit(0); });
process.on('SIGTERM', () => { stopAutoIngestion(); process.exit(0); });
process.on('exit', () => { stopAutoIngestion(); });

// ---------------------------------------------------------------------------
// Project registration (/api/projects, /api/projects/add)
// ---------------------------------------------------------------------------

const projectsModule = require('./projects.js');

async function handleAddProject(req, res) {
  // readBody already parses the body; no second JSON.parse.
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return jsonResponse(res, 400, { status: 'error', message: 'invalid JSON body' });
  }
  if (!body) body = {};

  let targetPath = body.path;
  if (!targetPath) {
    if (process.platform !== 'darwin') {
      return jsonResponse(res, 400, { status: 'error', message: 'path required on non-macOS' });
    }
    targetPath = projectsModule.pickFolderMacOS();
    if (!targetPath) return jsonResponse(res, 200, { status: 'canceled' });
  }

  // sprint-nto: validate the selection has a DDEV config before handing off
  // to add-project.sh. Rejecting here lets us return a single clear error
  // instead of a confusing shell failure in the dashboard toast.
  if (!projectsModule.hasDdevConfig(targetPath)) {
    return jsonResponse(res, 400, {
      status: 'error',
      message: `No .ddev/config.yaml found in ${targetPath} — drover projects require a DDEV configuration.`,
    });
  }

  const result = projectsModule.addProject(targetPath);
  const code = result.status === 'error' ? 400 : 200;
  return jsonResponse(res, code, result);
}

// sprint-nto: GET /api/projects/discover
// Returns a list of running DDEV projects that are not yet registered
// with drover so the UI can offer a checkbox-style picker instead of
// forcing the user through a generic folder dialog.
async function handleDiscoverProjects(req, res) {
  const registered = projectsModule.listProjects();
  const regNames = new Set(registered.map(p => p && (p.ddev_project || p.name)).filter(Boolean));
  let unregistered = [];
  try {
    const { stdout } = await execFileP('ddev', ['list', '-A', '--json-output'], { encoding: 'utf8', timeout: 10000 });
    const parsed = JSON.parse(stdout);
    const raw = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.raw) ? parsed.raw : []);
    unregistered = raw
      .filter(i => i && i.name && (i.status || '').toLowerCase().includes('running') && !regNames.has(i.name))
      .map(i => ({ name: i.name, approot: i.approot || '' }));
  } catch { /* ddev unavailable — return empty list */ }
  return jsonResponse(res, 200, { running_unregistered: unregistered });
}

function listProjects() { return projectsModule.listProjects(); }

// GET /api/backfill/log-types?alias=ahri.prod
// Returns available Acquia log types for an environment so the backfill
// modal can show checkboxes instead of a freehand comma-delimited field.
// Cache log types per alias for the server session — types don't change.
const logTypesCache = new Map();

async function handleLogTypes(req, res, url) {
  const alias = url.searchParams.get('alias') || '';
  if (!alias) return jsonResponse(res, 400, { error: 'alias required' });

  if (logTypesCache.has(alias)) {
    return jsonResponse(res, 200, { log_types: logTypesCache.get(alias) });
  }

  // Resolve alias → app_uuid + env_name from projects.json
  const projects = projectsModule.listProjects();
  let appUuid, envName;
  for (const p of projects) {
    for (const e of (p.acquia && p.acquia.environments) || []) {
      if (e.alias === alias) {
        appUuid = e.app_uuid || (p.acquia && p.acquia.app_uuid) || '';
        envName = e.env || e.name || '';
        break;
      }
    }
    if (appUuid) break;
  }
  if (!appUuid || !envName) return jsonResponse(res, 404, { error: `alias not found: ${alias}` });

  // Call Acquia API via Python helper — 30s timeout (two API calls + startup).
  const apiScript = path.join(__dirname, '../../scripts/monitors/acquia_api.py');
  try {
    const { stdout } = await execFileP('python3', ['-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("acquia_api", "${apiScript.replace(/\\/g, '\\\\')}")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
c = mod.AcquiaClient()
env_id = c.resolve_env_id("${appUuid}", "${envName}")
logs = c._get(f"/environments/{env_id}/logs")
items = logs.get("_embedded", {}).get("items", [])
print(json.dumps([{"type": i["type"], "label": i.get("label", i["type"]), "available": i.get("flags", {}).get("available", False)} for i in items]))
`], { encoding: 'utf8', timeout: 30000 });
    const types = JSON.parse(stdout.trim());
    logTypesCache.set(alias, types);
    return jsonResponse(res, 200, { log_types: types });
  } catch (e) {
    return jsonResponse(res, 500, { error: 'Acquia API error: ' + e.message });
  }
}

// sprint-ydz: GET /api/backfill/progress?log=<path>
// SSE endpoint that streams the backfill log file line-by-line to the
// dashboard modal. Sends existing content immediately, then tails new lines
// via fs.watch. Closes when the log emits BACKFILL done / BACKFILL error or
// when the client disconnects. 15-min hard ceiling.
function handleBackfillProgress(req, res, url) {
  const logPath = url.searchParams.get('log') || '';
  const logDir = process.env.DROVER_BACKFILL_LOG_DIR || '/private/tmp';
  if (!projectsModule.isValidBackfillLogPath(logPath, logDir)) {
    return jsonResponse(res, 400, { status: 'error', message: 'invalid log path' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(': progress-connected\n\n');

  let position = 0;
  let closed = false;
  let carry = '';

  function emit(event, data) {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      closed = true;
    }
  }

  function readNew() {
    if (closed) return;
    fs.stat(logPath, (err, stat) => {
      if (err || closed) return;
      if (stat.size < position) {
        // File truncated/rotated — restart from the top.
        position = 0;
        carry = '';
      }
      if (stat.size === position) return;
      const stream = fs.createReadStream(logPath, { start: position, end: stat.size - 1 });
      let chunk = '';
      stream.on('data', d => { chunk += d.toString('utf8'); });
      stream.on('end', () => {
        position = stat.size;
        const combined = carry + chunk;
        const lines = combined.split('\n');
        carry = lines.pop(); // last partial line
        for (const line of lines) {
          if (!line) continue;
          const phase = projectsModule.classifyBackfillLine(line);
          emit('line', { line, phase });
          if (phase === 'DONE') {
            emit('done', { status: 'done' });
            closed = true;
            try { res.end(); } catch {}
            return;
          }
        }
      });
      stream.on('error', () => { /* ignore transient read errors */ });
    });
  }

  readNew();

  let watcher;
  try {
    watcher = fs.watch(logPath, { persistent: false }, () => readNew());
  } catch (e) {
    emit('error', { message: `watch failed: ${e.message}` });
  }
  // Poll as a safety net — fs.watch on macOS can miss append events.
  const poll = setInterval(readNew, 1000);
  const ceiling = setTimeout(() => {
    emit('timeout', { message: 'progress stream ceiling reached (15m)' });
    closed = true;
    try { res.end(); } catch {}
  }, 15 * 60 * 1000);

  function cleanup() {
    closed = true;
    clearInterval(poll);
    clearTimeout(ceiling);
    if (watcher) { try { watcher.close(); } catch {} }
  }
  req.on('close', cleanup);
  res.on('close', cleanup);
}

async function handleBackfill(req, res) {
  // readBody already JSON.parses the request body and returns the parsed
  // object. A previous version of this handler ran JSON.parse() again on
  // that object, which coerced to "[object Object]" and failed with
  // "invalid JSON body" on every click of the dashboard Backfill button.
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return jsonResponse(res, 400, { status: 'error', message: 'invalid JSON body' });
  }
  if (!body || !body.alias) {
    return jsonResponse(res, 400, { status: 'error', message: 'alias is required' });
  }
  // Async: spawn detached, return immediately. The Acquia log-download
  // flow can take minutes (archive creation + polling + download);
  // blocking the user's click for that duration produced no progress
  // feedback. Full stdout/stderr streams to the returned log path so the
  // user can tail it or a future SSE endpoint can relay progress.
  const result = projectsModule.backfillAsync(body.alias, { logTypes: body.log_types });
  const code = result.status === 'error' ? 400 : 200;
  return jsonResponse(res, code, result);
}

// ---------------------------------------------------------------------------
// POST /api/triage  { log: "/path/to/backfill.log", alias: "ahri.prod" }
// Reads NEW lines from a completed backfill log and creates bd cards so
// errors appear in the dashboard without requiring /drover:triage skill.
// ---------------------------------------------------------------------------

const SEV_LABEL_MAP = { emergency:'emergency', critical:'critical', alert:'alert',
  error:'error', warning:'warning', notice:'notice', info:'info', debug:'debug' };

async function handleTriage(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return jsonResponse(res, 400, { error: 'invalid JSON body' });
  }
  const { log: logPath, alias } = body || {};
  if (!logPath || !alias) return jsonResponse(res, 400, { error: 'log and alias required' });

  // Resolve alias → project board
  const projects = projectsModule.listProjects();
  let dbPath, projectName, envType, trustLevel;
  for (const p of projects) {
    for (const e of (p.acquia && p.acquia.environments) || []) {
      if (e.alias === alias) {
        const db = projectsModule.findBeadsDb(p.path);
        if (db) { dbPath = db; projectName = p.name; envType = 'acquia'; trustLevel = e.trust_level || 'medium'; }
        break;
      }
    }
    if (dbPath) break;
    // Also check ddev environments for local alias
    for (const e of (p.drover_config && p.drover_config.environments) || []) {
      if ((e.name === alias || e.ddev_project === alias) && e.type === 'ddev') {
        const db = projectsModule.findBeadsDb(p.path);
        if (db) { dbPath = db; projectName = p.name; envType = 'ddev'; trustLevel = e.trust_level || 'low'; }
        break;
      }
    }
    if (dbPath) break;
  }
  if (!dbPath) return jsonResponse(res, 404, { error: `no board found for alias: ${alias}` });

  // Parse NEW lines from the backfill log
  let logContent;
  try { logContent = fs.readFileSync(logPath, 'utf8'); } catch (e) {
    return jsonResponse(res, 400, { error: `cannot read log: ${e.message}` });
  }

  const newLines = logContent.split('\n').filter(l => l.startsWith('NEW '));
  if (!newLines.length) return jsonResponse(res, 200, { created: 0, message: 'no NEW events found' });

  // Fetch existing fingerprints to avoid duplicates
  let existing = new Set();
  try {
    const { stdout } = await execFileP('bd', ['list', '-l', 'board-drover', '--db', dbPath, '--json', '--flat'],
      { encoding: 'utf8', timeout: 10000 });
    const cards = JSON.parse(stdout || '[]');
    if (Array.isArray(cards)) {
      for (const c of cards) {
        // bd emits the issue body under `description`; keep `body` as a
        // fallback for callers that already normalized it.
        const cBody = c.description || c.body || '';
        const m = cBody.match(/\*\*Fingerprint:\*\*\s+`([a-f0-9]+)`/);
        if (m) existing.add(m[1]);
      }
    }
  } catch { /* if board query fails, proceed anyway */ }

  // Build occurrence counts. Preferred source is the acquia-state JSON
  // that backfill.sh writes — it carries the true count per fingerprint
  // across the entire log. Fall back to the NEW/THRESH-line aggregation
  // for environments without a readable state file (tests, fresh installs).
  const logLines = logContent.split('\n');
  const occCounts = new Map();
  const rawSamples = new Map();
  const threshRe = /^THRESH\s+([0-9a-f]+)\s+count=(\d+)/;
  for (const l of logLines) {
    if (l.startsWith('NEW ')) {
      const parts = l.slice(4).split(' ');
      const fp = parts[0];
      if (!fp) continue;
      occCounts.set(fp, (occCounts.get(fp) || 0) + 1);
      if (!rawSamples.has(fp)) rawSamples.set(fp, parts.slice(4).join(' '));
    } else if (l.startsWith('THRESH ')) {
      const m = l.match(threshRe);
      if (m) {
        const n = parseInt(m[2], 10);
        if (!Number.isNaN(n)) occCounts.set(m[1], Math.max(occCounts.get(m[1]) || 0, n));
      }
    }
  }
  // Overlay true state-file counts when available. This is authoritative —
  // NEW/THRESH only emit at threshold crossings, so an error seen 14 times
  // (below the NEW+THRESH=50 default threshold) shows up as 1 in the log
  // aggregation but 14 in the state file.
  try {
    const stateDir = process.env.DROVER_STATE_DIR
      || path.join(process.env.CLAUDE_PLUGIN_DATA
        || path.join(process.env.HOME || '/tmp', '.claude/plugins/data/drover-fallback'),
        'acquia-state');
    const stateFile = path.join(stateDir, `${alias}.json`);
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      for (const [fp, entry] of Object.entries(state || {})) {
        if (entry && typeof entry === 'object' && typeof entry.count === 'number') {
          // State is authoritative: use max(state, log-aggregated) so a
          // stale state file never downgrades a fresh THRESH count.
          occCounts.set(fp, Math.max(occCounts.get(fp) || 0, entry.count));
        }
      }
    }
  } catch { /* state file unreadable — keep log-derived counts */ }

  let created = 0, skipped = 0;
  const envLabel = alias.includes('.') ? alias.split('.').pop() : alias;
  const envName = alias;

  // De-dupe NEW lines by fingerprint within a single backfill run — a
  // collapsed-fingerprint set can still emit multiple NEWs when the state
  // file was wiped before the run.
  const seenInRun = new Set();
  for (const line of newLines) {
    // Format: NEW <fp> <severity> <source> <env> <message...>
    const parts = line.slice(4).split(' ');
    if (parts.length < 5) continue;
    const [fp, sev, src, , ...msgParts] = parts;
    const msg = msgParts.join(' ').slice(0, 200);
    if (seenInRun.has(fp)) { skipped++; continue; }
    seenInRun.add(fp);
    if (existing.has(fp)) { skipped++; continue; }

    const occ = occCounts.get(fp) || 1;
    const rawSample = (rawSamples.get(fp) || msg).slice(0, 500);
    const sevLabel = SEV_LABEL_MAP[sev] || 'error';
    const title = `[${sev.toUpperCase()}] ${src}: ${msg}`;
    const body =
      `**Fingerprint:** \`${fp}\`\n` +
      `**Total Occurrences:** ${occ}\n` +
      `**Source:** ${src}\n\n` +
      `## Error Message\n${msg}\n\n` +
      `## Raw Log Line\n\`\`\`\n${rawSample}\n\`\`\`\n`;
    const labels = `board-drover,lane-triage,severity-${sevLabel},source-${src},env-${envLabel},trust-${trustLevel}`;

    try {
      // `bd create` takes --description for the issue body; --body is not
      // a valid flag and was silently dropped, leaving every card with an
      // empty body and breaking client-side fingerprint/occurrence parsing.
      await execFileP('bd', ['create', title, '--db', dbPath, '--labels', labels, '--description', body],
        { encoding: 'utf8', timeout: 8000 });
      existing.add(fp);
      created++;
    } catch { /* skip cards that fail */ }
  }

  ticketCache = { data: null, ts: 0 }; // invalidate so dashboard refreshes
  broadcast('board-update', { ts: new Date().toISOString(), project: projectName });
  return jsonResponse(res, 200, { created, skipped, total: newLines.length });
}

// ---------------------------------------------------------------------------
// Resolve the project-scoped Beads database for a ticket.
//
// Each registered project maintains its own .beads/drover.db; virtual-central
// mode aggregates cards from N boards and stamps ticket.project at fetch time
// (see fetchTickets → rows.map → t.project = b.project). Every bd mutation
// (move, solution, close) must target the card's source db — otherwise the
// shell command ran with --db "" and bd failed with "no issue found matching".
//
// Returns a board object { project, dbPath } or null when resolution fails.
// Callers MUST handle null rather than falling back to an empty --db.
// ---------------------------------------------------------------------------

function resolveBoardForTicket(ticket) {
  const boards = currentBoards();
  if (ticket && ticket.project) {
    const hit = boards.find(b => b.project === ticket.project);
    if (hit && hit.dbPath) return hit;
  }
  if (DB_PATH) {
    return { project: (ticket && ticket.project) || 'project', dbPath: DB_PATH };
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST /api/move
// ---------------------------------------------------------------------------

async function handleMove(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return jsonResponse(res, 400, { error: 'Invalid JSON' });
  }

  const { id, toLane } = body;
  if (!id || !toLane) {
    return jsonResponse(res, 400, { error: 'Missing id or toLane' });
  }

  // Validate toLane
  if (!LANES.find(l => l.id === toLane)) {
    return jsonResponse(res, 400, { error: 'Invalid lane: ' + toLane });
  }

  // Find current lane from cached ticket
  const tickets = await fetchTickets();
  if (tickets.error) return jsonResponse(res, 500, { error: tickets.error });

  const ticket = (Array.isArray(tickets) ? tickets : []).find(t => t.id === id);
  if (!ticket) return jsonResponse(res, 404, { error: 'Ticket not found: ' + id });

  const currentLane = (ticket.labels || []).find(l => l.startsWith('lane-'));
  if (!currentLane) return jsonResponse(res, 400, { error: 'Ticket has no lane label' });
  if (currentLane === toLane) return jsonResponse(res, 200, { ok: true, message: 'Already in that lane' });

  const board = resolveBoardForTicket(ticket);
  if (!board) {
    return jsonResponse(res, 500, {
      error: 'Cannot resolve source board for ticket ' + id
           + (ticket.project ? ' (project=' + ticket.project + ')' : ' (no project tag)')
           + ' — no matching registered project and no --db override configured',
    });
  }

  const now = new Date().toISOString();
  const note = now + ': Moved from ' + currentLane + ' to ' + toLane + ' via dashboard';

  try {
    execFileSync('bd', [
      'update', id,
      '--db', board.dbPath,
      '--remove-label', currentLane,
      '--add-label', toLane,
      '--append-notes', note,
    ], { encoding: 'utf8', timeout: 5000 });
    ticketCache = { data: null, ts: 0 }; // invalidate
    return jsonResponse(res, 200, { ok: true, project: board.project });
  } catch (err) {
    return jsonResponse(res, 500, { error: 'bd update failed: ' + err.message });
  }
}

// sprint-wgy dashboard integration — record Actual solution from the modal.
// Finds which board the ticket lives on (critical for virtual-central mode),
// appends a structured ### Actual block via bd update --append-notes,
// moves the ticket to lane-done, closes it, and invalidates cache.
async function handleSolution(req, res, ticketId) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return jsonResponse(res, 400, { status: 'error', message: 'invalid JSON body' });
  }
  const { root_cause, fix_summary, fix_commit_sha, divergence } = body || {};
  if (!root_cause || !fix_summary) {
    return jsonResponse(res, 400, { status: 'error', message: 'root_cause and fix_summary required' });
  }

  // Locate the ticket across all boards so we know which db to update.
  const tickets = await fetchTickets();
  if (tickets && tickets.error && !Array.isArray(tickets)) {
    return jsonResponse(res, 500, { status: 'error', message: tickets.error });
  }
  const ticket = (Array.isArray(tickets) ? tickets : []).find(t => t.id === ticketId);
  if (!ticket) {
    return jsonResponse(res, 404, { status: 'error', message: 'Ticket not found: ' + ticketId });
  }
  const board = resolveBoardForTicket(ticket);
  if (!board) {
    return jsonResponse(res, 500, {
      status: 'error',
      message: 'Cannot resolve source board for ticket ' + ticketId
             + (ticket.project ? ' (project=' + ticket.project + ')' : ' (no project tag)'),
    });
  }

  const now = new Date().toISOString();
  const actualBlock = [
    '',
    '### Actual  (written: ' + now + ', by: user)',
    '- **root_cause:** ' + root_cause,
    '- **fix_summary:** ' + fix_summary,
    '- **fix_commit_sha:** ' + (fix_commit_sha || 'none'),
    (divergence ? '- **divergence:** ' + divergence : '- **divergence:** n/a (no Projected block)'),
    '- **effectiveness:** verified',
    '- **verified_at:** ' + now,
    '- **captured_by:** user',
    '- **evidence:** dashboard-modal',
  ].join('\n');

  const currentLane = (ticket.labels || []).find(l => l.startsWith('lane-')) || 'lane-triage';

  try {
    execFileSync('bd', [
      'update', ticketId,
      '--db', board.dbPath,
      '--append-notes', actualBlock,
    ], { encoding: 'utf8', timeout: 5000 });
    // Move to lane-done and close.
    if (currentLane !== 'lane-done' && currentLane !== 'lane-closed') {
      execFileSync('bd', [
        'update', ticketId,
        '--db', board.dbPath,
        '--remove-label', currentLane,
        '--add-label', 'lane-done',
        '--append-notes', now + ': Solution captured via dashboard; lane-done.',
      ], { encoding: 'utf8', timeout: 5000 });
    }
    ticketCache = { data: null, ts: 0 };
    return jsonResponse(res, 200, { status: 'ok', id: ticketId, project: ticket.project });
  } catch (err) {
    return jsonResponse(res, 500, {
      status: 'error',
      message: 'bd update failed: ' + ((err.stderr && err.stderr.toString()) || err.message),
    });
  }
}

// ---------------------------------------------------------------------------
// HTML Builder
// ---------------------------------------------------------------------------

function buildHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>drover \u2014 ops dashboard</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="mask-icon" href="/favicon.svg" color="#FF453A">
<style>
  :root {
    --bg:        #0C0D10;
    --bg2:       #0F1014;
    --surface:   #15161C;
    --surface2:  #1C1D25;
    --surface3:  #22232D;
    --border:    #252730;
    --border2:   #2E3140;
    --text:      #F2F2F7;
    --text2:     #DCDCE4;
    --muted:     #7C7F8E;
    --muted2:    #4A4D5A;
    --muted3:    #363842;
    --crit:      #FF453A;
    --crit2:     #FF6961;
    --warn:      #FFB340;
    --ok:        #32D74B;
    --info:      #5E5CE6;
    --info2:     #7B7AFF;
    --crit-dim:  rgba(255, 69, 58,  0.10);
    --warn-dim:  rgba(255, 179, 64, 0.10);
    --ok-dim:    rgba(50, 215, 75,  0.08);
    --info-dim:  rgba(94, 92, 230,  0.10);
    --mono:    'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
    --display: system-ui, -apple-system, 'Segoe UI', sans-serif;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--display);
    font-size: 14px;
    line-height: 1.5;
    min-height: 100vh;
    overflow-x: hidden;
  }

  body::before {
    content: '';
    position: fixed; inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E");
    pointer-events: none; z-index: 0;
  }

  .shell { position: relative; z-index: 1; display: flex; flex-direction: column; min-height: 100vh; }

  .skip { position:absolute; left:-999px; top:4px; z-index:200; font-family:var(--mono); font-size:12px; padding:4px 12px; background:var(--info); color:#fff; border-radius:4px; }
  .skip:focus { left:12px; }

  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 24px; border-bottom: 1px solid var(--border);
    background: var(--surface);
    animation: fade-down 0.35s ease both;
  }
  .topbar-left { display: flex; align-items: center; gap: 18px; }

  .wordmark {
    font-family: var(--display); font-weight: 800; font-size: 17px;
    letter-spacing: -0.01em;
  }
  .wordmark em { font-style: normal; color: var(--crit); }
  .version-badge {
    font-family: var(--mono); font-size: 10px; font-weight: 500;
    color: var(--muted2); letter-spacing: 0.03em;
  }

  .live-badge {
    display: flex; align-items: center; gap: 6px;
    font-family: var(--mono); font-size: 10px; font-weight: 500;
    color: var(--ok); letter-spacing: 0.1em; text-transform: uppercase;
  }
  .live-dot {
    width: 6px; height: 6px; border-radius: 50%; background: var(--ok);
    box-shadow: 0 0 6px var(--ok);
    animation: pulse-dot 2s ease-in-out infinite;
  }
  @keyframes pulse-dot {
    0%,100% { opacity:1; transform:scale(1); }
    50%      { opacity:0.35; transform:scale(0.6); }
  }

  .topbar-right { display: flex; align-items: center; gap: 10px; }
  .ts { font-family: var(--mono); font-size: 11px; color: var(--muted2); margin-right: 4px; }

  .btn {
    font-family: var(--display); font-size: 12px; font-weight: 600;
    padding: 5px 13px; border-radius: 6px; cursor: pointer;
    letter-spacing: 0.01em; transition: all 0.15s ease;
    border: 1px solid var(--border2);
  }
  .btn:focus-visible { outline: 2px solid var(--info2); outline-offset: 2px; }
  .btn-ghost { background: var(--surface2); color: var(--muted); }
  .btn-ghost:hover { border-color: var(--info); color: var(--text2); background: var(--surface3); }
  .btn-primary { background: var(--info-dim); color: var(--info2); border-color: rgba(94,92,230,0.35); }
  .btn-primary:hover { background: rgba(94,92,230,0.2); color: var(--text); }
  .btn-primary.loading { opacity: 0.5; pointer-events: none; }

  .toast {
    position: fixed; bottom: 24px; right: 24px;
    background: var(--surface2); border: 1px solid var(--border2);
    border-radius: 8px; padding: 10px 18px;
    font-family: var(--mono); font-size: 12px; color: var(--ok);
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    transform: translateY(20px); opacity: 0;
    transition: transform 0.2s ease, opacity 0.2s ease;
    z-index: 100;
  }
  .toast.show { transform: translateY(0); opacity: 1; }

  .pulse {
    padding: 20px 24px 18px;
    display: flex; flex-direction: column; gap: 14px;
    animation: fade-up 0.45s 0.08s ease both;
  }

  .section-label {
    font-family: var(--mono); font-size: 9px; font-weight: 600;
    letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted3);
    display: flex; align-items: center; gap: 10px;
  }
  .section-label::after { content:''; flex:1; height:1px; background: linear-gradient(to right, var(--border), transparent); }

  .env-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px; }

  .env-tile {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px 16px 12px;
    position: relative; overflow: hidden;
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    cursor: default;
  }
  .env-tile:hover { transform: translateY(-2px); }
  .env-tile::before {
    content:''; position:absolute; left:0; top:0; bottom:0;
    width:3px; border-radius:10px 0 0 10px;
  }

  .env-tile.crit { border-color: rgba(255,69,58,0.25); background: linear-gradient(135deg, var(--crit-dim), var(--surface)); }
  .env-tile.crit::before { background: var(--crit); box-shadow: 0 0 14px var(--crit); }
  .env-tile.crit:hover { box-shadow: 0 4px 20px rgba(255,69,58,0.12); }
  .env-tile.warn { border-color: rgba(255,179,64,0.25); background: linear-gradient(135deg, var(--warn-dim), var(--surface)); }
  .env-tile.warn::before { background: var(--warn); box-shadow: 0 0 14px var(--warn); }
  .env-tile.warn:hover { box-shadow: 0 4px 20px rgba(255,179,64,0.1); }
  .env-tile.ok   { border-color: rgba(50,215,75,0.2); background: linear-gradient(135deg, var(--ok-dim), var(--surface)); }
  .env-tile.ok::before { background: var(--ok); box-shadow: 0 0 14px var(--ok); }
  .env-tile.ok:hover { box-shadow: 0 4px 20px rgba(50,215,75,0.08); }

  .env-tile-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }

  .env-name {
    font-family: var(--display); font-size: 13px; font-weight: 700;
    letter-spacing: 0.04em; text-transform: uppercase;
  }

  .env-status-badge {
    font-family:var(--mono); font-size:9px; font-weight:600;
    padding:2px 7px; border-radius:4px; letter-spacing:0.08em; text-transform:uppercase;
  }
  .crit .env-status-badge { background:var(--crit-dim); color:var(--crit); border:1px solid rgba(255,69,58,0.25); }
  .warn .env-status-badge { background:var(--warn-dim); color:var(--warn); border:1px solid rgba(255,179,64,0.25); }
  .ok   .env-status-badge { background:var(--ok-dim);   color:var(--ok);   border:1px solid rgba(50,215,75,0.2); }

  .env-tile-body { display:flex; align-items:flex-end; justify-content:space-between; }

  .env-count-wrap { display:flex; align-items:baseline; gap:8px; }
  .env-count { font-family:var(--mono); font-size:34px; font-weight:600; line-height:1; }
  .crit .env-count { color:var(--crit); }
  .warn .env-count { color:var(--warn); }
  .ok   .env-count { color:var(--ok); }

  .env-delta { font-family:var(--mono); font-size:11px; font-weight:500; padding-bottom:3px; }
  .env-delta.up { color:var(--crit2); }
  .env-delta.dn { color:var(--ok); }
  .env-delta.flat { color:var(--muted2); }

  .env-right { display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
  .env-meta-label { font-family:var(--mono); font-size:9px; color:var(--muted2); }

  .env-spark { width:64px; height:20px; }

  .env-sev-pills { display:flex; gap:4px; }
  .sev-pill { font-family:var(--mono); font-size:9px; padding:1px 5px; border-radius:3px; }
  .sev-pill.c { background:var(--crit-dim); color:var(--crit); }
  .sev-pill.w { background:var(--warn-dim); color:var(--warn); }
  .sev-pill.i { background:var(--info-dim); color:var(--info); }
  /* T2: "Listening for stream messages…" state on Pulse tiles — distinguishes
     "armed + no events yet" from "healthy / 0 open" so a quiet project isn't
     mistaken for a broken monitor. */
  .sev-pill.listening {
    background: rgba(94,92,230,0.14); color: #9e9cff;
    letter-spacing:0.02em;
    animation: listening-pulse 2.2s ease-in-out infinite;
  }
  @keyframes listening-pulse {
    0%,100% { opacity: 0.75; }
    50%     { opacity: 1;    }
  }

  .pulse-bottom { display:grid; grid-template-columns:1fr 300px; gap:10px; }

  .card {
    background:var(--surface); border:1px solid var(--border);
    border-radius:10px; padding:14px 16px;
  }
  .card-title {
    font-family:var(--display); font-size:11px; font-weight:700;
    letter-spacing:0.06em; text-transform:uppercase; color:var(--muted);
    margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;
  }

  .time-tabs { display:flex; gap:4px; }
  .time-tab {
    font-family:var(--mono); font-size:9px; font-weight:500; padding:2px 7px;
    border-radius:4px; border:1px solid transparent;
    background:transparent; color:var(--muted2); cursor:pointer;
    transition:all 0.12s;
  }
  .time-tab.active { border-color:var(--info); color:var(--info2); background:var(--info-dim); }
  .time-tab:hover:not(.active) { color:var(--muted); background:var(--surface2); }

  .chart-wrap { position:relative; }
  .chart-svg { width:100%; height:80px; overflow:visible; }

  .chart-axis-labels {
    display:flex; justify-content:space-between;
    font-family:var(--mono); font-size:8px; color:var(--muted3);
    margin-top:4px; padding:0 4px;
  }

  .chart-tooltip {
    position:absolute; pointer-events:none;
    background:var(--surface3); border:1px solid var(--border2);
    border-radius:5px; padding:4px 8px;
    font-family:var(--mono); font-size:10px; color:var(--text);
    box-shadow:0 4px 12px rgba(0,0,0,0.4);
    opacity:0; transition:opacity 0.1s;
    white-space:nowrap;
  }
  .chart-tooltip.vis { opacity:1; }

  .cycle-ts { font-family:var(--mono); font-size:9px; color:var(--muted2); margin-bottom:10px; display:block; }
  .cycle-stats { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
  .stat-tile {
    background:var(--surface2); border:1px solid var(--border);
    border-radius:8px; padding:10px 10px 8px;
  }
  .stat-row { display:flex; align-items:baseline; gap:6px; }
  .stat-num { font-family:var(--mono); font-size:20px; font-weight:600; line-height:1; }
  .stat-num.new  { color:var(--crit); }
  .stat-num.aug  { color:var(--warn); }
  .stat-num.skip { color:var(--muted2); }
  .stat-num.boost{ color:var(--info2); }
  .stat-label { font-family:var(--mono); font-size:9px; color:var(--muted2); margin-top:4px; letter-spacing:0.06em; text-transform:uppercase; }

  .divider {
    height:3px;
    background: linear-gradient(to right,
      var(--crit) 0%, var(--crit) 20%,
      var(--warn) 20%, var(--warn) 45%,
      var(--info) 45%, var(--info) 65%,
      var(--muted3) 65%, var(--muted3) 100%
    );
    opacity:0.4;
  }

  .pivot {
    flex:1; display:grid; grid-template-columns:180px 1fr;
    min-height:0; background:var(--bg2);
    animation: fade-up 0.45s 0.2s ease both;
  }

  .sidebar { border-right:1px solid var(--border); padding:12px 0; overflow-y:auto; background:var(--bg); }
  .sidebar-section { padding:0 12px 12px; border-bottom:1px solid var(--border); margin-bottom:2px; }
  .sidebar-section:last-child { border-bottom:none; }
  .sidebar-section-title {
    font-family:var(--mono); font-size:9px; font-weight:600;
    letter-spacing:0.12em; text-transform:uppercase; color:var(--muted3);
    padding-top:10px; margin-bottom:6px;
  }

  .filter-header { display:flex; justify-content:space-between; align-items:center; padding:8px 12px 6px; }
  .filter-count { font-family:var(--mono); font-size:9px; color:var(--muted2); }
  .filter-clear {
    font-family:var(--mono); font-size:9px; color:var(--info);
    cursor:pointer; background:none; border:none; padding:0;
    opacity:0.7; transition:opacity 0.12s;
  }
  .filter-clear:hover { opacity:1; }

  .filter-chip {
    display:flex; align-items:center; justify-content:space-between;
    padding:4px 7px; border-radius:5px; cursor:pointer;
    margin-bottom:1px; border:1px solid transparent;
    transition:all 0.1s ease;
  }
  .filter-chip:hover { background:var(--surface2); border-color:var(--border); }
  .filter-chip:focus-visible { outline:2px solid var(--info2); outline-offset:1px; }
  .filter-chip.sel { background:var(--info-dim); border-color:rgba(94,92,230,0.25); }

  .chip-label { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--muted); }
  .filter-chip.sel .chip-label { color:var(--info2); }
  .chip-dot { width:5px; height:5px; border-radius:50%; flex-shrink:0; }
  .chip-count { font-family:var(--mono); font-size:10px; color:var(--muted3); }
  .filter-chip.sel .chip-count { color:var(--info); }

  .errors-main { display:flex; flex-direction:column; overflow:hidden; }

  .table-toolbar {
    display:flex; align-items:center; justify-content:space-between;
    padding:8px 16px; border-bottom:1px solid var(--border);
    background:var(--surface); flex-shrink:0;
  }
  .toolbar-left { display:flex; align-items:center; gap:10px; }
  .search-box {
    display:flex; align-items:center; gap:7px;
    background:var(--surface2); border:1px solid var(--border);
    border-radius:6px; padding:5px 11px; width:260px;
    transition:border-color 0.15s, box-shadow 0.15s;
  }
  .search-box:focus-within { border-color:var(--info); box-shadow:0 0 0 3px var(--info-dim); }
  .search-icon { font-size:11px; color:var(--muted3); }
  .search-input {
    background:transparent; border:none; outline:none;
    font-family:var(--mono); font-size:11px; color:var(--text); width:100%;
  }
  .search-input::placeholder { color:var(--muted3); }
  .result-count { font-family:var(--mono); font-size:10px; color:var(--muted2); }

  .table-wrap { overflow-y:auto; flex:1; position:relative; }
  .table-wrap::before {
    content:''; position:sticky; top:32px; left:0; right:0;
    display:block; height:8px; z-index:3; pointer-events:none;
    background:linear-gradient(to bottom, rgba(12,13,16,0.6), transparent);
  }

  table { width:100%; border-collapse:collapse; }
  thead { position:sticky; top:0; z-index:4; background:var(--surface); }

  th {
    font-family:var(--mono); font-size:9px; font-weight:600;
    letter-spacing:0.12em; text-transform:uppercase; color:var(--muted3);
    padding:7px 12px; text-align:left; border-bottom:1px solid var(--border);
    white-space:nowrap; cursor:pointer; user-select:none;
    transition:color 0.12s;
  }
  th:hover { color:var(--muted); }
  th.sort-active { color:var(--info2); }

  tbody tr {
    border-bottom:1px solid var(--border); cursor:pointer;
    transition:background 0.08s;
    animation:row-in 0.2s ease both;
  }
  tbody tr:hover { background:rgba(28,29,37,0.7); }
  tbody tr.expanded { background:var(--surface2); }
  tbody tr:focus-visible { outline:2px solid var(--info2); outline-offset:-2px; }

  td { padding:8px 12px; vertical-align:middle; }

  .sev-badge {
    display:inline-flex; align-items:center; gap:4px;
    font-family:var(--mono); font-size:9px; font-weight:600;
    padding:3px 6px; border-radius:4px; white-space:nowrap; letter-spacing:0.05em;
  }
  .sev-badge.crit { background:var(--crit-dim); color:var(--crit); }
  .sev-badge.warn { background:var(--warn-dim); color:var(--warn); }
  .sev-badge.info { background:var(--info-dim); color:var(--info2); }
  .sev-dot { width:4px; height:4px; border-radius:50%; background:currentColor; }

  .err-title-wrap { display:flex; align-items:center; gap:8px; }
  .expand-chevron {
    width:14px; height:14px; flex-shrink:0;
    fill:none; stroke:var(--muted3); stroke-width:2;
    transition:transform 0.15s ease, stroke 0.15s;
  }
  .expanded .expand-chevron { transform:rotate(90deg); stroke:var(--info2); }

  .err-title { font-size:12px; color:var(--text2); font-weight:500; }
  .err-fp { font-family:var(--mono); font-size:9px; color:var(--muted3); margin-top:1px; letter-spacing:0.06em; padding-left:22px; }

  .num { font-family:var(--mono); font-size:12px; color:var(--text2); }

  .env-tags { display:flex; gap:3px; flex-wrap:wrap; }
  .env-tag {
    font-family:var(--mono); font-size:9px; padding:1px 5px;
    border-radius:3px; border:1px solid var(--border);
    background:var(--surface2); color:var(--muted);
  }
  a.env-tag.env-host {
    color:var(--info2); text-decoration:none;
    border-color:rgba(64,156,255,0.25);
  }
  a.env-tag.env-host:hover {
    color:#fff; border-color:var(--info2);
    background:rgba(64,156,255,0.12);
  }
  .modal-host-link { color:var(--info2); text-decoration:none; }
  .modal-host-link:hover { text-decoration:underline; }

  .backfill-phase {
    font-family:var(--mono); font-size:10px; font-weight:600;
    padding:2px 7px; border-radius:10px; letter-spacing:0.05em;
    background:var(--surface2); color:var(--muted); border:1px solid var(--border);
  }
  .backfill-phase.queued, .backfill-phase.starting { background:var(--surface2); color:var(--muted); }
  .backfill-phase.archiving, .backfill-phase.polling, .backfill-phase.downloading {
    background:var(--info-dim); color:var(--info2); border-color:rgba(64,156,255,0.25);
  }
  .backfill-phase.parsing { background:var(--warn-dim); color:var(--warn); border-color:rgba(255,179,64,0.25); }
  .backfill-phase.done { background:var(--ok-dim); color:var(--ok); border-color:rgba(50,215,75,0.25); }
  .backfill-phase.timeout, .backfill-phase.disconnected, .backfill-phase.reconnect {
    background:var(--crit-dim); color:var(--crit); border-color:rgba(255,69,58,0.25);
  }

  .age-cell { font-family:var(--mono); font-size:10px; color:var(--muted); white-space:nowrap; }

  .expand-row td { padding:0; border-bottom:1px solid var(--border2); }
  .expand-body {
    padding:14px 18px 14px 34px;
    display:grid; grid-template-columns:1fr 260px; gap:18px;
    background:var(--surface2); border-top:1px solid var(--border);
    animation:expand-in 0.18s ease both;
  }
  @keyframes expand-in {
    from { opacity:0; max-height:0; }
    to   { opacity:1; max-height:400px; }
  }

  .expand-card-title {
    font-family:var(--display); font-size:10px; font-weight:700;
    letter-spacing:0.08em; text-transform:uppercase; color:var(--muted); margin-bottom:6px;
  }

  .expand-err-msg {
    font-family:var(--mono); font-size:12px; line-height:1.6;
    color:var(--text); word-break:break-word;
    padding:8px 10px; margin-bottom:12px;
    background:var(--surface3); border:1px solid var(--border);
    border-radius:6px;
  }

  .stack-block {
    background:var(--bg); border:1px solid var(--border);
    border-radius:6px; padding:10px 12px;
    font-family:var(--mono); font-size:10px; line-height:1.8;
    max-height:160px; overflow-y:auto;
  }
  .stack-line-err  { color:var(--crit); font-weight:600; display:block; }
  .stack-line-file { color:var(--info2); display:block; padding-left:10px; }
  .stack-line-num  { color:var(--warn); }
  .stack-line-at   { color:var(--muted3); }

  .triage-log { font-family:var(--mono); font-size:10px; line-height:1.7; }
  .triage-entry { display:flex; gap:8px; padding:3px 0; border-bottom:1px solid var(--border); }
  .triage-entry:last-child { border-bottom:none; }
  .triage-ts  { color:var(--muted3); white-space:nowrap; flex-shrink:0; }
  .triage-msg { color:var(--muted); }
  .triage-msg.promoted { color:var(--ok); }

  @keyframes fade-up   { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes fade-down { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
  @keyframes row-in    { from{opacity:0} to{opacity:1} }

  .view-dashboard, .view-board { display:contents; }
  .view-dashboard.hidden, .view-board.hidden { display:none; }

  .btn.active-view { background:var(--info-dim); color:var(--info2); border-color:rgba(94,92,230,0.35); }

  .board-wrap {
    flex:1; display:flex; flex-direction:column; overflow:hidden;
    animation: fade-up 0.35s ease both;
  }

  .board-summary {
    display:flex; align-items:center; gap:16px;
    padding:12px 24px;
    background:var(--surface); border-bottom:1px solid var(--border);
  }

  .board-stat {
    display:flex; align-items:center; gap:6px;
    font-family:var(--mono); font-size:11px;
  }
  .board-stat-num { font-weight:600; color:var(--text); }
  .board-stat-label { color:var(--muted2); }
  .board-stat-sep { color:var(--muted3); }

  .board-toggle-closed {
    margin-left:auto;
    font-family:var(--mono); font-size:10px; color:var(--info);
    background:none; border:none; cursor:pointer;
    opacity:0.7; transition:opacity 0.12s;
  }
  .board-toggle-closed:hover { opacity:1; }

  .board-columns {
    flex:1; display:flex; gap:0; overflow-x:auto;
    padding:16px 16px 16px 24px;
  }

  .board-col {
    min-width:230px; max-width:280px; flex:1;
    display:flex; flex-direction:column;
    border-right:1px solid var(--border);
    padding-right:12px; margin-right:12px;
  }
  .board-col:last-child { border-right:none; margin-right:0; padding-right:0; }

  .col-header {
    display:flex; align-items:center; justify-content:space-between;
    margin-bottom:10px; flex-shrink:0;
  }

  .col-title {
    font-family:var(--mono); font-size:9px; font-weight:600;
    letter-spacing:0.14em; text-transform:uppercase; color:var(--muted2);
  }

  .col-count {
    font-family:var(--mono); font-size:10px; font-weight:500;
    color:var(--muted3); min-width:18px; height:18px;
    display:flex; align-items:center; justify-content:center;
    background:var(--surface2); border-radius:4px;
  }

  .col-header-indicator {
    width:100%; height:3px; border-radius:2px; margin-bottom:10px; flex-shrink:0;
  }

  .col-cards {
    display:flex; flex-direction:column; gap:6px;
    overflow-y:auto; flex:1; padding-bottom:8px;
  }

  .bcard {
    background:var(--surface2); border:1px solid var(--border);
    border-radius:8px; padding:10px 12px;
    position:relative; overflow:hidden;
    cursor:grab;
    transition:transform 0.12s, border-color 0.12s, box-shadow 0.12s;
    animation:card-in 0.25s ease both;
  }
  .bcard:hover { transform:translateY(-1px); border-color:var(--border2); box-shadow:0 4px 16px rgba(0,0,0,0.3); }
  .bcard:active { cursor:grabbing; }
  .bcard.dragging { opacity:0.4; transform:scale(0.96); }

  @keyframes card-in {
    from { opacity:0; transform:translateY(4px); }
    to   { opacity:1; transform:translateY(0); }
  }

  .bcard::before {
    content:''; position:absolute; left:0; top:0; bottom:0;
    width:3px; border-radius:8px 0 0 8px;
  }
  .bcard.sev-crit::before { background:var(--crit); box-shadow:0 0 8px var(--crit); }
  .bcard.sev-warn::before { background:var(--warn); box-shadow:0 0 8px var(--warn); }
  .bcard.sev-info::before { background:var(--info); }

  .bcard-header { display:flex; align-items:flex-start; justify-content:space-between; gap:6px; }

  .bcard-title {
    font-size:12px; font-weight:500; color:var(--text2);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    margin-bottom:6px; padding-left:4px; flex:1;
  }

  .bcard-actions { display:flex; gap:2px; flex-shrink:0; }

  .bcard-btn {
    width:22px; height:22px; border-radius:4px;
    background:transparent; border:1px solid transparent;
    color:var(--muted3); cursor:pointer; font-size:12px;
    display:flex; align-items:center; justify-content:center;
    transition:all 0.1s;
  }
  .bcard-btn:hover { background:var(--surface3); border-color:var(--border); color:var(--muted); }
  .bcard-btn.advance:hover { color:var(--ok); border-color:rgba(50,215,75,0.3); background:var(--ok-dim); }

  .bcard-meta {
    display:flex; align-items:center; gap:6px; flex-wrap:wrap;
    padding-left:4px;
  }

  .bcard-fp {
    font-family:var(--mono); font-size:9px; color:var(--muted2);
    background:var(--surface3); padding:1px 5px; border-radius:3px;
  }
  .bcard-occ { font-family:var(--mono); font-size:9px; font-weight:500; color:var(--muted); }
  .bcard-env {
    font-family:var(--mono); font-size:9px; padding:1px 5px;
    border-radius:3px; border:1px solid var(--border);
    background:var(--surface); color:var(--muted2);
  }
  .bcard-age { font-family:var(--mono); font-size:9px; color:var(--muted3); margin-left:auto; }

  .bcard-assignee {
    display:flex; align-items:center; gap:5px;
    margin-top:8px; padding-top:6px; border-top:1px solid var(--border);
  }
  .bcard-assignee-dot {
    width:6px; height:6px; border-radius:50%; background:var(--ok);
    animation:pulse-dot 2s ease-in-out infinite;
  }
  .bcard-assignee-name { font-family:var(--mono); font-size:9px; color:var(--ok); }
  .bcard-worktree {
    font-family:var(--mono); font-size:8px; color:var(--muted3);
    margin-top:3px; padding-left:11px;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }

  .col-cards.drag-over {
    background:var(--info-dim);
    border:1px dashed rgba(94,92,230,0.4);
    border-radius:6px;
    min-height:60px;
  }

  .col-empty {
    font-family:var(--mono); font-size:10px; color:var(--muted3);
    font-style:italic; padding:8px 4px;
  }

  .modal-backdrop {
    position:fixed; inset:0; z-index:50;
    background:rgba(0,0,0,0.6); backdrop-filter:blur(4px);
    display:none; align-items:center; justify-content:center;
    animation:modal-bg-in 0.15s ease;
  }
  .modal-backdrop.open { display:flex; }
  @keyframes modal-bg-in { from{opacity:0} to{opacity:1} }

  .modal {
    background:var(--surface); border:1px solid var(--border2);
    border-radius:12px; width:580px; max-height:80vh;
    overflow-y:auto; box-shadow:0 16px 64px rgba(0,0,0,0.6);
    animation:modal-in 0.2s ease both;
  }
  @keyframes modal-in {
    from { opacity:0; transform:translateY(12px) scale(0.97); }
    to   { opacity:1; transform:translateY(0) scale(1); }
  }

  .modal-header {
    padding:16px 20px 12px; border-bottom:1px solid var(--border);
    display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
  }
  .modal-title {
    font-family:var(--display); font-size:15px; font-weight:700;
    color:var(--text); line-height:1.4; word-break:break-word; flex:1;
  }
  .modal-close {
    width:28px; height:28px; border-radius:6px;
    background:var(--surface2); border:1px solid var(--border);
    color:var(--muted); cursor:pointer; font-size:14px;
    display:flex; align-items:center; justify-content:center;
    transition:all 0.1s; flex-shrink:0;
  }
  .modal-close:hover { background:var(--surface3); color:var(--text); }

  .modal-body { padding:16px 20px; }
  /* sprint-wgy: Solution section styling */
  .solution-row { margin-bottom:12px; }
  .solution-sub-title { font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:var(--muted2); margin-bottom:6px; }
  .solution-fields { background:var(--surface-alt); border-radius:4px; padding:8px 10px; font-family:var(--mono); font-size:11px; }
  .solution-field { display:flex; gap:8px; padding:2px 0; }
  .solution-key { color:var(--muted2); min-width:120px; }
  .solution-val { color:var(--text); word-break:break-word; }
  .solution-empty { font-style:italic; color:var(--muted2); font-size:12px; padding:4px 0; }
  .solution-form { background:var(--surface-alt); border-radius:4px; padding:12px; margin-top:6px; }
  .solution-field-wrap { margin-bottom:10px; }
  .solution-field-label { display:block; font-size:11px; text-transform:uppercase; color:var(--muted2); margin-bottom:4px; }
  .solution-field-input { width:100%; padding:6px 8px; background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:3px; font-family:var(--mono); font-size:12px; box-sizing:border-box; }
  .solution-field-input:focus { outline:none; border-color:var(--primary); }
  .solution-form-btns { display:flex; gap:8px; justify-content:flex-end; margin-top:6px; }
  .solution-add-btn { margin-top:4px; }

  .modal-section { margin-bottom:16px; }
  .modal-section:last-child { margin-bottom:0; }
  .modal-section-title {
    font-family:var(--mono); font-size:9px; font-weight:600;
    letter-spacing:0.12em; text-transform:uppercase;
    color:var(--muted3); margin-bottom:6px;
  }

  .modal-meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .modal-meta-item {
    background:var(--surface2); border:1px solid var(--border);
    border-radius:6px; padding:8px 10px;
  }
  .modal-meta-label {
    font-family:var(--mono); font-size:9px; color:var(--muted2);
    text-transform:uppercase; letter-spacing:0.08em; margin-bottom:3px;
  }
  .modal-meta-value { font-family:var(--mono); font-size:12px; color:var(--text2); }
  .modal-meta-value.sev-crit { color:var(--crit); }
  .modal-meta-value.sev-warn { color:var(--warn); }
  .modal-meta-value.sev-info { color:var(--info2); }

  .modal-err-msg {
    font-family:var(--mono); font-size:11px; line-height:1.6;
    color:var(--text2); word-break:break-word;
    padding:10px 12px; background:var(--surface2); border:1px solid var(--border);
    border-radius:6px;
  }

  .modal-stack {
    font-family:var(--mono); font-size:10px; line-height:1.8;
    padding:10px 12px; background:var(--bg); border:1px solid var(--border);
    border-radius:6px; max-height:140px; overflow-y:auto;
  }

  .modal-log { font-family:var(--mono); font-size:10px; }
  .modal-log-entry {
    display:flex; gap:8px; padding:4px 0;
    border-bottom:1px solid var(--border);
  }
  .modal-log-entry:last-child { border-bottom:none; }

  .modal-footer {
    padding:12px 20px 16px; border-top:1px solid var(--border);
    display:flex; align-items:center; justify-content:space-between; gap:10px;
  }
  .modal-move-wrap { display:flex; align-items:center; gap:8px; }
  .modal-move-label { font-family:var(--mono); font-size:10px; color:var(--muted2); }
  .modal-move-select {
    font-family:var(--mono); font-size:11px;
    background:var(--surface2); border:1px solid var(--border2);
    color:var(--text2); border-radius:5px; padding:4px 8px;
    cursor:pointer;
  }
  .modal-move-select:focus { border-color:var(--info); outline:none; box-shadow:0 0 0 3px var(--info-dim); }

  .modal-btn-group { display:flex; gap:6px; }

  .empty-state {
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding:48px 24px; color:var(--muted2);
  }
  .empty-state-icon { font-size:32px; margin-bottom:12px; opacity:0.4; }
  .empty-state-msg { font-family:var(--mono); font-size:12px; text-align:center; }

  ::-webkit-scrollbar { width:5px; height:5px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:var(--muted3); border-radius:3px; }
  ::-webkit-scrollbar-thumb:hover { background:var(--muted2); }

  /* DDEV Instance Management Panel */
  .ddev-panel {
    padding:12px 24px 8px;
    animation: fade-up 0.35s ease both;
  }
  .ddev-panel.collapsed .ddev-tiles { display:none; }
  .ddev-panel.collapsed .ddev-warn { display:none; }

  .ddev-header {
    display:flex; align-items:center; justify-content:space-between;
    margin-bottom:8px;
  }
  .ddev-header-left { display:flex; align-items:center; gap:10px; }
  .ddev-header-label {
    font-family:var(--mono); font-size:9px; font-weight:600;
    letter-spacing:0.18em; text-transform:uppercase; color:var(--muted3);
  }
  .ddev-header-summary {
    font-family:var(--mono); font-size:10px; color:var(--muted2);
  }
  .ddev-collapse-btn {
    font-family:var(--mono); font-size:9px; color:var(--info);
    background:none; border:none; cursor:pointer;
    opacity:0.7; transition:opacity 0.12s;
  }
  .ddev-collapse-btn:hover { opacity:1; }

  /* Collapsed inline summary */
  .ddev-inline-summary {
    display:none; align-items:center; gap:8px;
    font-family:var(--mono); font-size:10px;
  }
  .ddev-panel.collapsed .ddev-inline-summary { display:flex; }
  .ddev-inline-dot {
    width:6px; height:6px; border-radius:50%;
    display:inline-block;
  }
  .ddev-inline-dot.running { background:var(--ok); box-shadow:0 0 4px var(--ok); }
  .ddev-inline-dot.stopped { background:var(--muted3); }
  .ddev-inline-dot.starting, .ddev-inline-dot.stopping { background:var(--info); }
  .ddev-inline-dot.error { background:var(--crit); }
  .ddev-inline-name { color:var(--muted); }

  .ddev-tiles { display:flex; flex-wrap:wrap; gap:8px; }

  .ddev-tile {
    width:120px; height:120px; flex-shrink:0;
    background:var(--surface); border:1px solid var(--border);
    border-radius:8px; padding:12px 12px 10px;
    position:relative; overflow:hidden;
    display:flex; flex-direction:column; justify-content:space-between;
    transition:transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }
  .ddev-tile:hover { transform:translateY(-1px); }
  .ddev-tile::before {
    content:''; position:absolute; left:0; top:0; bottom:0;
    width:3px; border-radius:8px 0 0 8px;
    transition:background 0.15s, box-shadow 0.15s;
  }

  .ddev-tile.running { border-color:rgba(50,215,75,0.2); background:linear-gradient(135deg, var(--ok-dim), var(--surface)); }
  .ddev-tile.running::before { background:var(--ok); box-shadow:0 0 10px var(--ok); }
  .ddev-tile.running:hover { box-shadow:0 3px 16px rgba(50,215,75,0.08); }

  .ddev-tile.stopped { border-color:var(--border); }
  .ddev-tile.stopped::before { background:var(--muted3); }

  .ddev-tile.starting { border-color:rgba(94,92,230,0.25); background:linear-gradient(135deg, var(--info-dim), var(--surface)); }
  .ddev-tile.starting::before { background:var(--info); box-shadow:0 0 10px var(--info); }

  .ddev-tile.stopping { border-color:rgba(255,179,64,0.25); background:linear-gradient(135deg, var(--warn-dim), var(--surface)); }
  .ddev-tile.stopping::before { background:var(--warn); box-shadow:0 0 10px var(--warn); }

  .ddev-tile.error { border-color:rgba(255,69,58,0.25); background:linear-gradient(135deg, var(--crit-dim), var(--surface)); }
  .ddev-tile.error::before { background:var(--crit); box-shadow:0 0 10px var(--crit); }

  .ddev-tile-footer { margin-top:auto; }
  .ddev-tile-namerow { display:flex; align-items:flex-start; gap:5px; margin-top:2px; }
  .ddev-dot {
    width:7px; height:7px; border-radius:50%; flex-shrink:0;
  }
  .ddev-tile.running .ddev-dot {
    background:var(--ok); box-shadow:0 0 6px var(--ok);
    animation:pulse-dot 2s ease-in-out infinite;
  }
  .ddev-tile.stopped .ddev-dot {
    background:transparent; border:1.5px solid var(--muted2);
  }
  .ddev-tile.error .ddev-dot { background:var(--crit); }

  @keyframes spin-ring { to { transform:rotate(360deg); } }
  .ddev-spinner {
    width:7px; height:7px;
    border:1.5px solid var(--info2);
    border-top-color:transparent;
    border-radius:50%;
    animation:spin-ring 0.8s linear infinite;
    flex-shrink:0;
  }
  .ddev-tile.stopping .ddev-spinner {
    border-color:var(--warn);
    border-top-color:transparent;
  }

  .ddev-name {
    font-family:var(--mono); font-size:9px; font-weight:500;
    letter-spacing:0.06em; text-transform:uppercase; color:var(--muted);
    word-break:break-all; line-height:1.3;
  }

  .ddev-tile-body { display:flex; flex-direction:column; align-items:stretch; gap:0; }
  .ddev-state {
    font-family:var(--mono); font-size:9px; font-weight:500;
    letter-spacing:0.06em; text-transform:uppercase;
  }
  .ddev-tile.running .ddev-state { color:var(--ok); }
  .ddev-tile.stopped .ddev-state { color:var(--muted); }
  .ddev-tile.starting .ddev-state { color:var(--info2); }
  .ddev-tile.stopping .ddev-state { color:var(--warn); }
  .ddev-tile.error .ddev-state { color:var(--crit); }

  .ddev-action {
    font-family:var(--mono); font-size:11px; font-weight:700;
    padding:12px 10px; border-radius:6px; cursor:pointer;
    letter-spacing:0.08em; text-transform:uppercase; text-align:center;
    transition:all 0.12s; border:1px solid; width:100%;
  }
  .ddev-action.start-btn {
    background:var(--ok-dim); color:var(--ok); border-color:rgba(50,215,75,0.25);
  }
  .ddev-action.start-btn:hover { background:rgba(50,215,75,0.22); border-color:rgba(50,215,75,0.4); }
  .ddev-action.stop-btn {
    background:var(--surface2); color:var(--crit2); border-color:var(--crit); border-width:1.5px;
  }
  .ddev-action.stop-btn:hover { background:var(--crit-dim); color:var(--crit); }
  .ddev-action.confirm-btn {
    background:var(--crit-dim); color:var(--crit); border-color:rgba(255,69,58,0.35);
    animation:fade-up 0.15s ease both;
  }
  .ddev-action:disabled { opacity:0.4; pointer-events:none; }
  .ddev-tile.starting .ddev-action { border-color:var(--info); color:var(--info2); background:var(--info-dim); opacity:0.8; }
  .ddev-tile.stopping .ddev-action { border-color:var(--warn); color:var(--warn); background:var(--warn-dim); opacity:0.8; }

  .ddev-warn {
    display:flex; align-items:center; gap:6px;
    margin-top:6px; padding:4px 10px;
    background:var(--warn-dim); border:1px solid rgba(255,179,64,0.2);
    border-radius:5px;
    font-family:var(--mono); font-size:10px; color:var(--warn);
    animation:fade-down 0.25s ease both;
  }
  .ddev-warn-icon { font-size:11px; }

  /* DDEV Terminal Log */
  .ddev-term {
    background:var(--bg); border:1px solid var(--border);
    border-radius:8px; margin-top:8px;
    overflow:hidden;
    animation:fade-up 0.25s ease both;
    max-height:200px;
    display:flex; flex-direction:column;
  }
  .ddev-term.hidden { display:none; }
  .ddev-term-header {
    display:flex; align-items:center; justify-content:space-between;
    padding:5px 10px; background:var(--surface);
    border-bottom:1px solid var(--border); flex-shrink:0;
  }
  .ddev-term-tabs { display:flex; gap:2px; }
  .ddev-term-tab {
    font-family:var(--mono); font-size:9px; font-weight:500;
    padding:2px 8px; border-radius:4px; border:1px solid transparent;
    background:transparent; color:var(--muted2); cursor:pointer;
    transition:all 0.1s; letter-spacing:0.04em;
  }
  .ddev-term-tab.active { background:var(--info-dim); color:var(--info2); border-color:rgba(94,92,230,0.3); }
  .ddev-term-tab:hover:not(.active) { color:var(--muted); background:var(--surface2); }
  .ddev-term-tab .tab-dot {
    display:inline-block; width:5px; height:5px; border-radius:50%;
    margin-right:4px; vertical-align:middle;
  }
  .ddev-term-tab .tab-dot.running { background:var(--info); animation:pulse-dot 2s ease-in-out infinite; }
  .ddev-term-tab .tab-dot.done { background:var(--ok); }
  .ddev-term-tab .tab-dot.error { background:var(--crit); }

  .ddev-term-controls { display:flex; gap:4px; }
  .ddev-term-dismiss {
    font-family:var(--mono); font-size:9px; color:var(--muted3);
    background:none; border:none; cursor:pointer; padding:2px 6px;
    border-radius:3px; transition:all 0.1s;
  }
  .ddev-term-dismiss:hover { color:var(--muted); background:var(--surface2); }

  .ddev-term-body {
    overflow-y:auto; flex:1; padding:6px 0;
    max-height:150px;
  }
  .ddev-term-line {
    font-family:var(--mono); font-size:10px; line-height:1.5;
    padding:0 10px; display:flex; gap:8px;
    white-space:pre-wrap; word-break:break-all;
  }
  .ddev-term-ts {
    color:var(--muted3); flex-shrink:0; min-width:36px; text-align:right;
    user-select:none;
  }
  .ddev-term-text { color:var(--muted); }
  .ddev-term-text.stderr { color:var(--warn); }
  .ddev-term-text.ok { color:var(--ok); font-weight:600; }
</style>
</head>
<body>
<a class="skip" href="#tbody">Skip to errors</a>
<div class="shell">

  <header class="topbar">
    <div class="topbar-left">
      <span class="wordmark">dro<em>v</em>er</span>
      ${PLUGIN_VERSION ? `<span class="version-badge">v${PLUGIN_VERSION}</span>` : ''}
      <span class="live-badge"><span class="live-dot"></span>live</span>
    </div>
    <div class="topbar-right">
      <span class="ts" id="clock"></span>
      <button class="btn btn-ghost active-view" id="btn-dashboard" onclick="switchView('dashboard')">&#9783; Dashboard</button>
      <button class="btn btn-ghost" id="btn-board" onclick="switchView('board')">&#8862; Board</button>
      <button class="btn btn-ghost" id="btn-add-project" onclick="addProjectPrompt()" title="Register a DDEV project with drover">+ Add Project</button>
      <button class="btn btn-ghost" id="btn-backfill" onclick="backfillPrompt()" title="Pull historical Acquia logs for an environment">Backfill</button>
    </div>
  </header>

  <section class="ddev-panel" id="ddev-panel" aria-label="DDEV instances" style="display:none">
    <div class="ddev-header">
      <div class="ddev-header-left">
        <span class="ddev-header-label">DDEV Instances</span>
        <span class="ddev-header-summary" id="ddev-summary"></span>
        <div class="ddev-inline-summary" id="ddev-inline"></div>
      </div>
      <button class="ddev-collapse-btn" id="ddev-collapse-btn" onclick="toggleDdevPanel()">&#9660;</button>
    </div>
    <div class="ddev-tiles" id="ddev-tiles"></div>
    <div id="ddev-warn-wrap"></div>
    <div class="ddev-term hidden" id="ddev-term">
      <div class="ddev-term-header">
        <div class="ddev-term-tabs" id="ddev-term-tabs"></div>
        <div class="ddev-term-controls">
          <button class="ddev-term-dismiss" onclick="dismissDdevTerm()" title="Dismiss">\u2715</button>
        </div>
      </div>
      <div class="ddev-term-body" id="ddev-term-body"></div>
    </div>
  </section>

  <div class="view-dashboard" id="view-dashboard">
  <section class="pulse" aria-label="Environment health overview">
    <div class="section-label">Pulse</div>
    <div class="env-tiles" id="env-tiles"></div>

    <div class="pulse-bottom">
      <div class="card">
        <div class="card-title">
          Error volume
          <div class="time-tabs">
            <button class="time-tab active" aria-pressed="true">24h</button>
            <button class="time-tab" aria-pressed="false">7d</button>
            <button class="time-tab" aria-pressed="false">30d</button>
          </div>
        </div>
        <div class="chart-wrap">
          <svg class="chart-svg" viewBox="0 0 600 80" preserveAspectRatio="none" role="img" aria-label="Error volume over time">
            <defs>
              <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#5E5CE6" stop-opacity="0.3"/>
                <stop offset="100%" stop-color="#5E5CE6" stop-opacity="0"/>
              </linearGradient>
              <linearGradient id="lGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="#5E5CE6" stop-opacity="0.35"/>
                <stop offset="55%" stop-color="#5E5CE6"/>
                <stop offset="100%" stop-color="#FF453A"/>
              </linearGradient>
            </defs>
            <line x1="0" y1="20" x2="600" y2="20" stroke="#1C1D25" stroke-width="1"/>
            <line x1="0" y1="40" x2="600" y2="40" stroke="#1C1D25" stroke-width="1"/>
            <line x1="0" y1="60" x2="600" y2="60" stroke="#1C1D25" stroke-width="1"/>
            <path id="area-path" fill="url(#aGrad)"/>
            <path id="line-path" fill="none" stroke="url(#lGrad)" stroke-width="1.5" stroke-linejoin="round"/>
            <g id="chart-dots"></g>
          </svg>
          <div class="chart-tooltip" id="chart-tip"></div>
          <div class="chart-axis-labels" id="chart-axis"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Last triage cycle</div>
        <span class="cycle-ts" id="cycle-ts">No triage data yet</span>
        <div class="cycle-stats" id="cycle-stats"></div>
      </div>
    </div>
  </section>

  <div class="divider" aria-hidden="true"></div>

  <div class="pivot" aria-label="Error investigation">
    <aside class="sidebar" aria-label="Filters">
      <div class="filter-header">
        <span class="filter-count" id="filter-count">none</span>
        <button class="filter-clear" id="filter-clear" onclick="clearFilters()" style="display:none">clear all</button>
      </div>
      <div id="sidebar-filters"></div>
    </aside>

    <div class="errors-main">
      <div class="table-toolbar">
        <div class="toolbar-left">
          <div class="search-box">
            <span class="search-icon" aria-hidden="true">&#8981;</span>
            <input class="search-input" placeholder="search errors, fingerprints, environments&#8230;" id="search" autocomplete="off" aria-label="Search errors">
          </div>
          <span class="result-count" id="result-count">0 errors</span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead id="err-thead">
            <tr>
              <th data-sort="sev" style="width:60px">Sev</th>
              <th data-sort="title">Error</th>
              <th data-sort="project" style="width:90px">Project</th>
              <th data-sort="occ" style="width:90px;text-align:right">Occ</th>
              <th data-sort="env" style="width:100px">Env</th>
              <th data-sort="age" class="sort-active" style="width:72px">Age &#8595;</th>
              <th data-sort="lane" style="width:72px">Lane</th>
            </tr>
          </thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    </div>
  </div>

  </div>

  <div class="view-board hidden" id="view-board">
    <div class="board-wrap">
      <div class="board-summary" id="board-summary"></div>
      <div class="board-columns" id="board-columns"></div>
    </div>
  </div>

</div>

<div class="modal-backdrop" id="board-modal">
  <div class="modal" id="modal-content"></div>
</div>

<div class="toast" id="toast" role="alert"></div>

<script>
// ========================================================================
// DOM helpers
// ========================================================================
function el(tag,cls){ var e=document.createElement(tag); if(cls) e.className=cls; return e; }
function txt(tag,cls,t){ var e=el(tag,cls); e.textContent=t; return e; }
function svgEl(tag,attrs){
  var e=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(var k in attrs) if(attrs.hasOwnProperty(k)) e.setAttribute(k,attrs[k]);
  return e;
}
function removeChildren(node){ while(node.firstChild) node.removeChild(node.firstChild); }

// ========================================================================
// State
// ========================================================================
var ALL_CARDS = [];
var HEALTH = {};
var TIMELINE = [];
var INGESTION = {};
var currentView = 'dashboard';
var showClosedLanes = false;
var activeFilters = { sev: {}, env: {} };

var LANES = [
  { id:'lane-triage', label:'TRIAGE', color:'var(--muted3)' },
  { id:'lane-ready', label:'READY', color:'var(--info)' },
  { id:'lane-implementing', label:'IMPLEMENTING', color:'var(--warn)' },
  { id:'lane-awaiting-review', label:'AWAITING REVIEW', color:'var(--ok)' },
  { id:'lane-done', label:'DONE', color:'var(--muted3)', hidden:true },
  { id:'lane-closed', label:'CLOSED', color:'var(--muted3)', hidden:true },
];

var LANE_ORDER = LANES.map(function(l){return l.id;});
function nextLane(id){ var i=LANE_ORDER.indexOf(id); return i<LANE_ORDER.length-1?LANE_ORDER[i+1]:null; }
function laneLabel(id){ var l=LANES.find(function(x){return x.id===id;}); return l?l.label:id; }

var SEV_MAP = {
  emergency:'crit', critical:'crit', alert:'warn', error:'warn', warning:'warn',
  notice:'info', info:'info', debug:'info', unknown:'info',
};
var SEV_LABEL = { crit:'CRIT', warn:'WARN', info:'INFO' };
var SEV_COLOR = { crit:'var(--crit)', warn:'var(--warn)', info:'var(--info)' };

function countKeys(obj) { var n=0; for(var k in obj) if(obj.hasOwnProperty(k)&&obj[k]) n++; return n; }

// ========================================================================
// Data fetching
// ========================================================================
function fetchAll() {
  return Promise.all([
    fetch('/api/board').then(function(r){return r.json();}),
    fetch('/api/health').then(function(r){return r.json();}),
    fetch('/api/timeline').then(function(r){return r.json();}),
    fetch('/api/ingestion/status').then(function(r){return r.json();}).catch(function(){return null;})
  ]).then(function(results) {
    var board = results[0];
    HEALTH = results[1];
    TIMELINE = results[2];
    INGESTION = results[3] || {};

    if (Array.isArray(board)) {
      ALL_CARDS = board.map(parseCardClient);
    } else {
      ALL_CARDS = [];
    }
    renderAll();
  }).catch(function(err) {
    console.error('Fetch error:', err);
  });
}

function parseCardClient(ticket) {
  var labels = ticket.labels || [];
  var body = ticket.body || '';
  var notes = ticket.notes || '';

  var sevRaw = (labels.find(function(l){return l.startsWith('severity-');})||'').replace('severity-','') || 'unknown';
  var envLabels = labels.filter(function(l){return l.startsWith('env-');}).map(function(l){return l.replace('env-','');});
  var fpMatch = body.match(/\\*\\*Fingerprint:\\*\\*\\s+\`([a-f0-9]+)\`/);
  var fp = fpMatch ? fpMatch[1] : '[unknown]';
  var occMatch = body.match(/\\*\\*Total Occurrences:\\*\\*\\s+(\\d+)/);
  var occ = occMatch ? parseInt(occMatch[1]) : 0;
  var worktreeMatch = body.match(/\\*\\*Worktree:\\*\\*\\s+(\\S+)/);
  var assigneeMatch = body.match(/\\*\\*Assignee:\\*\\*\\s+(\\S+)/);

  var stackMatch = body.match(/## Stack Trace\\n\`\`\`[\\s\\S]*?\\n([\\s\\S]*?)\`\`\`/);
  var stack = stackMatch ? stackMatch[1].trim().split('\\n').filter(Boolean) : [];

  var triageLog = notes.split('\\n').filter(Boolean).map(function(line) {
    var m = line.match(/^(\\d{4}-\\d{2}-\\d{2}T[\\d:]+Z?):\\s*(.*)/);
    if (m) return { ts: m[1].slice(5,16).replace('T',' '), msg: m[2] };
    return { ts:'', msg:line };
  }).filter(function(e){return e.msg;});

  var lane = labels.find(function(l){return l.startsWith('lane-');}) || 'lane-triage';

  // sprint-wgy dashboard integration — parse Projected/Actual from the
  // combined body + notes so refreshes via SSE don't lose structured data.
  var solText = body + '\\n' + notes;
  var projected = extractSolutionBlockClient(solText, 'Projected');
  var actual = extractSolutionBlockClient(solText, 'Actual');

  return {
    id: ticket.id || '',
    title: ticket.title || '[untitled]',
    // sprint-0r3: virtual-central tag.
    project: ticket.project || '',
    // sprint-2g8: hostnames attached by server (pass-through).
    hostnames: Array.isArray(ticket.hostnames) ? ticket.hostnames : [],
    // sprint-wgy: structured solution blocks (null when absent).
    projected: ticket.projected || projected,
    actual: ticket.actual || actual,
    lane: lane,
    sev: SEV_MAP[sevRaw] || 'info',
    sevRaw: sevRaw,
    envs: envLabels,
    fp: fp, occ: occ,
    worktree: worktreeMatch ? worktreeMatch[1] : '',
    assignee: assigneeMatch ? assigneeMatch[1] : '',
    age: formatAgeClient(ticket.created_at),
    stack: stack, triageLog: triageLog,
  };
}

function extractSolutionBlockClient(text, kind) {
  var headerRe = new RegExp('###\\\\s+' + kind + '\\\\b([\\\\s\\\\S]*?)(?=\\\\n###\\\\s+|$)', 'i');
  var m = text.match(headerRe);
  if (!m) return null;
  var section = m[1];
  var fields = {};
  var fieldRe = /-\\s+\\*\\*([a-z_]+):\\*\\*\\s*(.+)/gi;
  var fm;
  while ((fm = fieldRe.exec(section)) !== null) {
    fields[fm[1].toLowerCase()] = fm[2].trim();
  }
  var whenMatch = section.match(/\\(written:\\s*([^,)]+)(?:,\\s*by:\\s*([^)]+))?\\)/);
  if (whenMatch) {
    fields.written_at = whenMatch[1].trim();
    if (whenMatch[2]) fields.written_by = whenMatch[2].trim();
  }
  return Object.keys(fields).length ? fields : null;
}

function formatAgeClient(dateStr) {
  if (!dateStr) return '?';
  var diff = Date.now() - new Date(dateStr).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  return Math.floor(hrs / 24) + 'd';
}

// ========================================================================
// Mini sparkline SVG
// ========================================================================
function miniSparkSVG(pts, w, h, color) {
  var s = svgEl('svg',{width:w,height:h,viewBox:'0 0 '+w+' '+h});
  if(!pts||!pts.length) return s;
  var max = Math.max.apply(null, pts.concat([1])), pad=1;
  var xs = pts.map(function(_,i){ return pad+(i/(pts.length-1))*(w-pad*2); });
  var ys = pts.map(function(v){ return h-pad-(v/max)*(h-pad*2); });
  var d = 'M'+xs[0]+','+ys[0];
  for(var i=1;i<xs.length;i++) d += ' L'+xs[i]+','+ys[i];
  s.appendChild(svgEl('path',{d:d,fill:'none',stroke:color,'stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round'}));
  return s;
}

// ========================================================================
// Render all
// ========================================================================
function renderAll() {
  renderEnvTiles();
  renderCycleStats();
  renderTimeline();
  renderFilters();
  renderTable();
  if (currentView === 'board') renderBoard();
}

// ========================================================================
// Environment tiles
// ========================================================================
function renderEnvTiles() {
  var wrap = document.getElementById('env-tiles');
  removeChildren(wrap);

  var envs = HEALTH.environments || {};
  var envNames = Object.keys(envs);

  if (envNames.length === 0) {
    var empty = el('div','empty-state');
    var icon = el('div','empty-state-icon');
    icon.textContent = '\\u25C9';
    empty.appendChild(icon);
    empty.appendChild(txt('div','empty-state-msg','No environments found'));
    wrap.appendChild(empty);
    return;
  }

  // T2: is live ingestion armed but not yet producing events? If so,
  // empty tiles render "Listening for stream messages…" instead of the
  // default "0 open" green pill, which was ambiguous between "healthy"
  // and "ingest is broken". Wording mirrors Acquia Cloud's own log-stream
  // UI (spec §4.12.a).
  var ingestionArmed = !!(INGESTION && INGESTION.umbrellaAlive);
  var totalIngestEvents = 0;
  if (INGESTION && INGESTION.projects) {
    for (var pname in INGESTION.projects) {
      if (INGESTION.projects[pname] && INGESTION.projects[pname].eventCount) {
        totalIngestEvents += INGESTION.projects[pname].eventCount;
      }
    }
  }
  var listeningNoEvents = ingestionArmed && totalIngestEvents === 0;

  envNames.forEach(function(name, idx) {
    var env = envs[name];
    var tile = el('div','env-tile ' + env.status);
    tile.style.animationDelay = (idx*60)+'ms';
    tile.style.animation = 'fade-up 0.35s ease both';

    var header = el('div','env-tile-header');
    header.appendChild(txt('span','env-name',name));
    header.appendChild(txt('span','env-status-badge',env.statusLabel));
    tile.appendChild(header);

    var body = el('div','env-tile-body');
    var countWrap = el('div','env-count-wrap');
    countWrap.appendChild(txt('span','env-count',String(env.count)));
    body.appendChild(countWrap);

    var right = el('div','env-right');
    var pills = el('div','env-sev-pills');
    if (env.critCount > 0) pills.appendChild(txt('span','sev-pill c',env.critCount+' crit'));
    if (env.warnCount > 0) pills.appendChild(txt('span','sev-pill w',env.warnCount+' warn'));
    if (env.critCount === 0 && env.warnCount === 0) {
      if (env.count === 0 && listeningNoEvents) {
        var pill = txt('span','sev-pill listening','Listening for stream messages…');
        pill.title = 'Umbrella watcher is armed; no new events yet in this dashboard session.';
        pills.appendChild(pill);
      } else {
        pills.appendChild(txt('span','sev-pill i','0 open'));
      }
    }
    right.appendChild(pills);
    body.appendChild(right);
    tile.appendChild(body);
    wrap.appendChild(tile);
  });
}

// ========================================================================
// Cycle stats
// ========================================================================
function renderCycleStats() {
  var wrap = document.getElementById('cycle-stats');
  var tsEl = document.getElementById('cycle-ts');
  removeChildren(wrap);

  var cycle = HEALTH.lastCycle;
  if (!cycle) {
    tsEl.textContent = 'No triage data yet';
    wrap.appendChild(txt('div','empty-state-msg','Run /drover:watch to start'));
    return;
  }

  tsEl.textContent = HEALTH.lastCycleTs || '';

  var stats = [
    { num: cycle.new_errors||0, cls:'new', label:'New errors' },
    { num: cycle.augmented||0, cls:'aug', label:'Augmented' },
    { num: cycle.promoted||0, cls:'skip', label:'Promoted' },
    { num: cycle.cross_env_boosts||0, cls:'boost', label:'Cross-env' },
  ];

  stats.forEach(function(c) {
    var tile = el('div','stat-tile');
    var row = el('div','stat-row');
    row.appendChild(txt('span','stat-num '+c.cls, String(c.num)));
    tile.appendChild(row);
    tile.appendChild(txt('div','stat-label',c.label));
    wrap.appendChild(tile);
  });
}

// ========================================================================
// Timeline chart
// ========================================================================
function renderTimeline() {
  var axisEl = document.getElementById('chart-axis');
  removeChildren(axisEl);

  if (!TIMELINE.length) {
    drawChartPath([0]);
    axisEl.appendChild(txt('span','','no data'));
    return;
  }

  var pts = TIMELINE.map(function(e){ return (e.cycle_summary||{}).new_errors || 0; });
  drawChartPath(pts);

  if (TIMELINE.length >= 2) {
    axisEl.appendChild(txt('span','',TIMELINE[0].ts ? TIMELINE[0].ts.slice(11,16) : ''));
    axisEl.appendChild(txt('span','',TIMELINE[TIMELINE.length-1].ts ? TIMELINE[TIMELINE.length-1].ts.slice(11,16) : 'now'));
  } else {
    axisEl.appendChild(txt('span','','now'));
  }

  var svgE = document.querySelector('.chart-svg');
  var tip = document.getElementById('chart-tip');
  var chartWrap = document.querySelector('.chart-wrap');

  svgE.onmousemove = function(ev) {
    var rect = svgE.getBoundingClientRect();
    var xRatio = (ev.clientX-rect.left)/rect.width;
    var idx = Math.round(xRatio*(pts.length-1));
    if (idx<0||idx>=pts.length) return;

    var dotsG = document.getElementById('chart-dots');
    var circles = dotsG.querySelectorAll('circle');
    for(var ci=0;ci<circles.length;ci++){
      circles[ci].setAttribute('r',ci===idx?'4':'0');
      circles[ci].setAttribute('opacity',ci===idx?'1':'0');
    }

    var ts = TIMELINE[idx] && TIMELINE[idx].ts ? TIMELINE[idx].ts.slice(11,16) : '';
    tip.textContent = ts + ' \\u2014 ' + pts[idx] + ' new';
    tip.classList.add('vis');
    var W=600;
    var xs_i = 4+(idx/(pts.length-1))*(W-8);
    var tipX = (xs_i/W)*chartWrap.clientWidth;
    tip.style.left = Math.min(tipX-30, chartWrap.clientWidth-120)+'px';
    tip.style.top = '-4px';
  };

  svgE.onmouseleave = function() {
    var dotsG = document.getElementById('chart-dots');
    var circles = dotsG.querySelectorAll('circle');
    for(var ci=0;ci<circles.length;ci++){circles[ci].setAttribute('r','0');circles[ci].setAttribute('opacity','0');}
    tip.classList.remove('vis');
  };
}

function drawChartPath(pts) {
  var W=600, H=80, pad=4;
  var max = Math.max.apply(null, pts.concat([1]));
  var xs = pts.map(function(_,i){ return pad+(i/Math.max(pts.length-1,1))*(W-pad*2); });
  var ys = pts.map(function(v){ return H-pad-(v/max)*(H-pad*2); });
  var d = 'M'+xs[0]+','+ys[0];
  for(var i=1;i<xs.length;i++){var cx=(xs[i]+xs[i-1])/2;d+=' C'+cx+','+ys[i-1]+' '+cx+','+ys[i]+' '+xs[i]+','+ys[i];}
  document.getElementById('line-path').setAttribute('d',d);
  document.getElementById('area-path').setAttribute('d',d+' L'+xs[xs.length-1]+','+H+' L'+xs[0]+','+H+' Z');

  var dotsG = document.getElementById('chart-dots');
  removeChildren(dotsG);
  pts.forEach(function(v,i){
    var c = svgEl('circle',{cx:xs[i],cy:ys[i],r:0,fill:'#5E5CE6',opacity:0});
    c.dataset.idx=i; c.dataset.val=v;
    dotsG.appendChild(c);
  });
}

// ========================================================================
// Sidebar filters
// ========================================================================
function renderFilters() {
  var wrap = document.getElementById('sidebar-filters');
  removeChildren(wrap);

  // Severity
  var sevSection = el('div','sidebar-section');
  sevSection.appendChild(txt('div','sidebar-section-title','Severity'));
  var sevCounts = {};
  ALL_CARDS.forEach(function(c){ sevCounts[c.sev] = (sevCounts[c.sev]||0)+1; });
  ['crit','warn','info'].forEach(function(sev) {
    if (!sevCounts[sev]) sevCounts[sev] = 0;
    var chip = el('div','filter-chip' + (activeFilters.sev[sev]?' sel':''));
    chip.tabIndex = 0;
    chip.setAttribute('role','checkbox');
    chip.setAttribute('aria-checked', !!activeFilters.sev[sev]);
    var label = el('span','chip-label');
    var dot = el('span','chip-dot');
    dot.style.background = SEV_COLOR[sev];
    label.appendChild(dot);
    label.appendChild(document.createTextNode(' '+(SEV_LABEL[sev]||sev)));
    chip.appendChild(label);
    chip.appendChild(txt('span','chip-count',String(sevCounts[sev])));
    chip.onclick = (function(s){ return function(){ toggleFilter('sev', s, this); }; })(sev);
    sevSection.appendChild(chip);
  });
  wrap.appendChild(sevSection);

  // Environment
  var envSection = el('div','sidebar-section');
  envSection.appendChild(txt('div','sidebar-section-title','Environment'));
  var envCounts = {};
  ALL_CARDS.forEach(function(c){ c.envs.forEach(function(e){ envCounts[e] = (envCounts[e]||0)+1; }); });
  Object.keys(envCounts).sort().forEach(function(env) {
    var chip = el('div','filter-chip' + (activeFilters.env[env]?' sel':''));
    chip.tabIndex = 0;
    chip.setAttribute('role','checkbox');
    chip.setAttribute('aria-checked', !!activeFilters.env[env]);
    var label = el('span','chip-label');
    label.appendChild(document.createTextNode(env));
    chip.appendChild(label);
    chip.appendChild(txt('span','chip-count',String(envCounts[env])));
    chip.onclick = (function(e){ return function(){ toggleFilter('env', e, this); }; })(env);
    envSection.appendChild(chip);
  });
  wrap.appendChild(envSection);

  updateFilterCount();
}

function toggleFilter(type, val, chip) {
  if (activeFilters[type][val]) {
    delete activeFilters[type][val];
    chip.classList.remove('sel');
    chip.setAttribute('aria-checked','false');
  } else {
    activeFilters[type][val] = true;
    chip.classList.add('sel');
    chip.setAttribute('aria-checked','true');
  }
  updateFilterCount();
  renderTable();
}

function updateFilterCount() {
  var n = countKeys(activeFilters.sev) + countKeys(activeFilters.env);
  document.getElementById('filter-count').textContent = n ? n+' active' : 'none';
  document.getElementById('filter-clear').style.display = n ? 'block' : 'none';
}

function clearFilters() {
  activeFilters.sev = {};
  activeFilters.env = {};
  var chips = document.querySelectorAll('.filter-chip.sel');
  for(var i=0;i<chips.length;i++){chips[i].classList.remove('sel');chips[i].setAttribute('aria-checked','false');}
  updateFilterCount();
  renderTable();
}

// ========================================================================
// Error table
// ========================================================================
// Sort state — default age descending so newest errors appear first.
var sortCol = 'age';
var sortDir = -1; // -1 = descending, 1 = ascending

var SEV_ORDER = {crit:0, warn:1, info:2};

function cardSortKey(c, col) {
  if (col === 'sev')     return SEV_ORDER[c.sev] !== undefined ? SEV_ORDER[c.sev] : 9;
  if (col === 'occ')     return c.occ;
  if (col === 'age')     return c.createdAt ? -new Date(c.createdAt).getTime() : 0;
  if (col === 'title')   return (c.title || '').toLowerCase();
  if (col === 'project') return (c.project || '').toLowerCase();
  if (col === 'env')     return (c.envs || []).join(',').toLowerCase();
  if (col === 'lane')    return (c.lane || '').toLowerCase();
  return 0;
}

function updateSortHeaders() {
  var ths = document.querySelectorAll('#err-thead th[data-sort]');
  ths.forEach(function(th) {
    var col = th.getAttribute('data-sort');
    var label = th.textContent.replace(/[↑↓\s]+$/, '').trim();
    th.textContent = label + (col === sortCol ? (' ' + (sortDir === -1 ? '↓' : '↑')) : '');
    th.classList.toggle('sort-active', col === sortCol);
  });
}

function getFilteredCards() {
  var cards = ALL_CARDS;
  if (countKeys(activeFilters.sev) > 0) {
    cards = cards.filter(function(c){ return activeFilters.sev[c.sev]; });
  }
  if (countKeys(activeFilters.env) > 0) {
    cards = cards.filter(function(c){ return c.envs.some(function(e){ return activeFilters.env[e]; }); });
  }
  var q = (document.getElementById('search').value||'').toLowerCase();
  if (q) {
    cards = cards.filter(function(c){ return c.title.toLowerCase().indexOf(q)!==-1 || c.fp.indexOf(q)!==-1 || c.envs.some(function(e){return e.indexOf(q)!==-1;}); });
  }
  var col = sortCol, dir = sortDir;
  return cards.slice().sort(function(a, b) {
    var ka = cardSortKey(a, col), kb = cardSortKey(b, col);
    if (ka < kb) return -dir;
    if (ka > kb) return dir;
    return 0;
  });
}

function renderTable() {
  var tbody = document.getElementById('tbody');
  removeChildren(tbody);
  var cards = getFilteredCards();
  document.getElementById('result-count').textContent = cards.length + ' errors';

  if (cards.length === 0) {
    var tr = el('tr');
    var td = el('td');
    td.colSpan = 6;
    td.style.textAlign = 'center';
    td.style.padding = '32px';
    var empty = el('div','empty-state');
    var icon = el('div','empty-state-icon');
    icon.textContent = '\\u25C9';
    empty.appendChild(icon);
    empty.appendChild(txt('div','empty-state-msg','No errors found'));
    td.appendChild(empty);
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  cards.forEach(function(c,i) {
    var rows = buildRow(c, i);
    tbody.appendChild(rows[0]);
    tbody.appendChild(rows[1]);
  });
}

function buildRow(c, i) {
  var tr = el('tr');
  tr.style.animationDelay = (i*20)+'ms';
  tr.tabIndex = 0;

  // Sev
  var sevTd = el('td');
  var badge = el('span','sev-badge '+c.sev);
  badge.appendChild(el('span','sev-dot'));
  badge.appendChild(document.createTextNode(' '+(SEV_LABEL[c.sev]||c.sev)));
  sevTd.appendChild(badge); tr.appendChild(sevTd);

  // Title
  var titleTd = el('td');
  var titleWrap = el('div','err-title-wrap');
  var chevSvg = svgEl('svg',{'class':'expand-chevron',viewBox:'0 0 16 16',width:14,height:14});
  chevSvg.appendChild(svgEl('path',{d:'M6 4l4 4-4 4'}));
  titleWrap.appendChild(chevSvg);
  titleWrap.appendChild(txt('span','err-title',c.title));
  titleTd.appendChild(titleWrap);
  titleTd.appendChild(txt('div','err-fp','fp:'+c.fp));
  tr.appendChild(titleTd);

  // Project (virtual-central mode shows where the card came from;
  // single-project mode reuses the label for consistency).
  var projTd = el('td');
  if (c.project) projTd.appendChild(txt('span','env-tag', c.project));
  tr.appendChild(projTd);

  // Occ
  var occTd = txt('td','num',c.occ.toLocaleString());
  occTd.style.textAlign = 'right';
  tr.appendChild(occTd);

  // Envs — sprint-2g8: show hostname when resolved (Acquia default_domain
  // or <ddev_project>.ddev.site), fall back to bare env label otherwise.
  var envTd = el('td');
  var envWrap = el('div','env-tags');
  var hostByEnv = {};
  (c.hostnames || []).forEach(function(h){ if (h && h.env) hostByEnv[h.env] = h; });
  c.envs.forEach(function(env){
    var host = hostByEnv[env];
    if (host && host.url) {
      var a = document.createElement('a');
      a.href = host.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'env-tag env-host';
      a.title = host.url;
      a.textContent = env + ' · ' + host.domain;
      a.addEventListener('click', function(e){ e.stopPropagation(); });
      envWrap.appendChild(a);
    } else {
      envWrap.appendChild(txt('span','env-tag',env));
    }
  });
  envTd.appendChild(envWrap); tr.appendChild(envTd);

  // Age
  tr.appendChild(txt('td','age-cell',c.age));

  // Lane
  tr.appendChild(txt('td','age-cell',laneLabel(c.lane)));

  // Expand row
  var exTr = el('tr','expand-row');
  exTr.style.display = 'none';
  var exTd = document.createElement('td');
  exTd.colSpan = 6;

  var body = el('div','expand-body');
  var stackPanel = el('div');
  stackPanel.appendChild(txt('div','expand-card-title','Error'));
  stackPanel.appendChild(txt('div','expand-err-msg',c.title));

  if (c.stack.length) {
    stackPanel.appendChild(txt('div','expand-card-title','Stack trace'));
    var stackBlock = el('div','stack-block');
    c.stack.forEach(function(line,li) {
      if (li===0) { stackBlock.appendChild(txt('span','stack-line-err',line)); }
      else {
        var row = el('span','stack-line-file');
        row.appendChild(txt('span','stack-line-at','  at '));
        var parts = line.match(/^(.+):(\\d+)$/);
        if (parts) {
          row.appendChild(document.createTextNode(parts[1]+':'));
          row.appendChild(txt('span','stack-line-num',parts[2]));
        } else {
          row.appendChild(document.createTextNode(line));
        }
        stackBlock.appendChild(row);
      }
    });
    stackPanel.appendChild(stackBlock);
  }

  body.appendChild(stackPanel);

  var logPanel = el('div');
  logPanel.appendChild(txt('div','expand-card-title','Triage log'));
  if (c.triageLog.length) {
    var logWrap = el('div','triage-log');
    c.triageLog.forEach(function(t) {
      var entry = el('div','triage-entry');
      entry.appendChild(txt('span','triage-ts',t.ts));
      entry.appendChild(txt('span','triage-msg',t.msg));
      logWrap.appendChild(entry);
    });
    logPanel.appendChild(logWrap);
  } else {
    logPanel.appendChild(txt('div','triage-msg','No log entries'));
  }
  body.appendChild(logPanel);

  exTd.appendChild(body); exTr.appendChild(exTd);

  function toggle() {
    var isOpen = exTr.style.display !== 'none';
    var allExpand = document.querySelectorAll('.expand-row');
    for(var j=0;j<allExpand.length;j++) allExpand[j].style.display='none';
    var allRows = document.querySelectorAll('tbody tr:not(.expand-row)');
    for(var j=0;j<allRows.length;j++) allRows[j].classList.remove('expanded');
    if (!isOpen) { exTr.style.display=''; tr.classList.add('expanded'); }
  }
  tr.addEventListener('click', toggle);
  tr.addEventListener('keydown', function(ev){ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); toggle(); }});

  return [tr, exTr];
}

// ========================================================================
// Board view
// ========================================================================
function renderBoard() {
  var summary = document.getElementById('board-summary');
  removeChildren(summary);

  var open = ALL_CARDS.filter(function(c){return ['lane-done','lane-closed'].indexOf(c.lane)===-1;}).length;
  var ready = ALL_CARDS.filter(function(c){return c.lane==='lane-ready';}).length;
  var inflight = ALL_CARDS.filter(function(c){return c.lane==='lane-implementing';}).length;

  [{n:open,l:'Open'},{n:ready,l:'Ready'},{n:inflight,l:'In-flight'}].forEach(function(s,i){
    if(i>0) summary.appendChild(txt('span','board-stat-sep','\\u00b7'));
    var stat = el('span','board-stat');
    stat.appendChild(txt('span','board-stat-num',String(s.n)));
    stat.appendChild(txt('span','board-stat-label',s.l));
    summary.appendChild(stat);
  });

  var toggleBtn = el('button','board-toggle-closed');
  toggleBtn.textContent = showClosedLanes ? 'Hide done/closed' : 'Show done/closed';
  toggleBtn.addEventListener('click',function(){showClosedLanes=!showClosedLanes;renderBoard();});
  summary.appendChild(toggleBtn);

  var cols = document.getElementById('board-columns');
  removeChildren(cols);

  var visibleLanes = showClosedLanes ? LANES : LANES.filter(function(l){return !l.hidden;});

  visibleLanes.forEach(function(lane) {
    var laneCards = ALL_CARDS.filter(function(c){return c.lane===lane.id;});
    var col = el('div','board-col');

    var indicator = el('div','col-header-indicator');
    indicator.style.background = lane.color;
    indicator.style.opacity = laneCards.length>0?'0.8':'0.2';
    col.appendChild(indicator);

    var header = el('div','col-header');
    header.appendChild(txt('span','col-title',lane.label));
    header.appendChild(txt('span','col-count',String(laneCards.length)));
    col.appendChild(header);

    var cardsWrap = el('div','col-cards');
    cardsWrap.dataset.lane = lane.id;

    cardsWrap.addEventListener('dragover', function(ev){
      ev.preventDefault();
      ev.dataTransfer.dropEffect='move';
      this.classList.add('drag-over');
    });
    cardsWrap.addEventListener('dragleave', function(ev){
      if(!this.contains(ev.relatedTarget)) this.classList.remove('drag-over');
    });
    cardsWrap.addEventListener('drop', (function(laneId){ return function(ev){
      ev.preventDefault();
      this.classList.remove('drag-over');
      var id = ev.dataTransfer.getData('text/plain');
      if(id) apiMoveTicket(id, laneId);
    };})(lane.id));

    if(laneCards.length===0){
      cardsWrap.appendChild(txt('div','col-empty','No tickets'));
    } else {
      laneCards.forEach(function(c,ti) {
        var card = el('div','bcard sev-'+c.sev);
        card.style.animationDelay = (ti*40)+'ms';
        card.draggable = true;
        card.dataset.id = c.id;

        card.addEventListener('dragstart', (function(cardId){ return function(ev){
          ev.dataTransfer.setData('text/plain', cardId);
          ev.dataTransfer.effectAllowed='move';
          var self=this;
          requestAnimationFrame(function(){self.classList.add('dragging');});
        };})(c.id));
        card.addEventListener('dragend', function(){
          this.classList.remove('dragging');
          var overs = document.querySelectorAll('.col-cards.drag-over');
          for(var j=0;j<overs.length;j++) overs[j].classList.remove('drag-over');
        });

        card.addEventListener('click', (function(cardData){ return function(ev){
          if(ev.target.classList.contains('bcard-btn')) return;
          openBoardModal(cardData);
        };})(c));

        var headerDiv = el('div','bcard-header');
        headerDiv.appendChild(txt('div','bcard-title',c.title));

        var actions = el('div','bcard-actions');
        var nl = nextLane(c.lane);
        if(nl){
          var advBtn = el('button','bcard-btn advance');
          advBtn.textContent = '\\u2192';
          advBtn.title = 'Move to '+laneLabel(nl);
          advBtn.addEventListener('click', (function(cardId, nextL){ return function(ev){ ev.stopPropagation(); apiMoveTicket(cardId, nextL); };})(c.id, nl));
          actions.appendChild(advBtn);
        }
        headerDiv.appendChild(actions);
        card.appendChild(headerDiv);

        var meta = el('div','bcard-meta');
        meta.appendChild(txt('span','bcard-fp','fp:'+c.fp.slice(0,8)));
        meta.appendChild(txt('span','bcard-occ',c.occ.toLocaleString()+'x'));
        c.envs.forEach(function(env){ meta.appendChild(txt('span','bcard-env',env)); });
        meta.appendChild(txt('span','bcard-age',c.age));
        card.appendChild(meta);

        if(c.assignee){
          var assignee = el('div','bcard-assignee');
          assignee.appendChild(el('span','bcard-assignee-dot'));
          assignee.appendChild(txt('span','bcard-assignee-name',c.assignee));
          card.appendChild(assignee);
        }
        if(c.worktree){
          card.appendChild(txt('div','bcard-worktree',c.worktree));
        }

        cardsWrap.appendChild(card);
      });
    }
    col.appendChild(cardsWrap);
    cols.appendChild(col);
  });
}

// ========================================================================
// API: move ticket
// ========================================================================
function apiMoveTicket(id, toLane) {
  fetch('/api/move', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({id:id, toLane:toLane})
  }).then(function(res){ return res.json(); }).then(function(data) {
    if (data.ok) {
      showToast('Moved to '+laneLabel(toLane));
      fetchAll();
    } else {
      showToast('Error: '+(data.error||'unknown'));
    }
  }).catch(function(){ showToast('Network error'); });
}

// ========================================================================
// Board modal
// ========================================================================
function openBoardModal(c) {
  var modal = document.getElementById('modal-content');
  removeChildren(modal);

  var SEV_LABELS = {crit:'Critical',warn:'Warning',info:'Info'};

  var header = el('div','modal-header');
  header.appendChild(txt('div','modal-title', c.title));
  var closeBtn = el('button','modal-close');
  closeBtn.textContent = '\\u2715';
  closeBtn.addEventListener('click', closeBoardModal);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  var body = el('div','modal-body');

  var metaSec = el('div','modal-section');
  metaSec.appendChild(txt('div','modal-section-title','Details'));
  var metaGrid = el('div','modal-meta-grid');

  var items = [
    {label:'Severity', value:SEV_LABELS[c.sev]||c.sev, cls:'sev-'+c.sev},
    {label:'Fingerprint', value:c.fp},
    {label:'Occurrences', value:c.occ.toLocaleString()},
    {label:'Environments', value:c.envs.join(', ')||'unknown'},
    {label:'Age', value:c.age},
    {label:'Lane', value:laneLabel(c.lane)},
  ];
  if(c.project) items.push({label:'Project', value:c.project});
  if(c.assignee) items.push({label:'Assigned', value:c.assignee});
  if(c.worktree) items.push({label:'Worktree', value:c.worktree});

  items.forEach(function(item) {
    var mi = el('div','modal-meta-item');
    mi.appendChild(txt('div','modal-meta-label',item.label));
    mi.appendChild(txt('div','modal-meta-value'+(item.cls?' '+item.cls:''), item.value));
    metaGrid.appendChild(mi);
  });
  // sprint-2g8: list clickable hostnames (one per env) so the user can
  // jump straight to the affected site from the modal.
  if (c.hostnames && c.hostnames.length) {
    var hostMi = el('div','modal-meta-item');
    hostMi.appendChild(txt('div','modal-meta-label','Hostnames'));
    var hostVal = el('div','modal-meta-value');
    c.hostnames.forEach(function(h, idx){
      if (idx > 0) hostVal.appendChild(document.createTextNode(', '));
      var a = document.createElement('a');
      a.href = h.url; a.target = '_blank'; a.rel = 'noopener';
      a.className = 'modal-host-link';
      a.textContent = h.env + ':' + h.domain;
      hostVal.appendChild(a);
    });
    hostMi.appendChild(hostVal);
    metaGrid.appendChild(hostMi);
  }
  metaSec.appendChild(metaGrid);
  body.appendChild(metaSec);

  var errSec = el('div','modal-section');
  errSec.appendChild(txt('div','modal-section-title','Error message'));
  errSec.appendChild(txt('div','modal-err-msg',c.title));
  body.appendChild(errSec);

  // sprint-wgy: Solution section (Projected + Actual). Always shown so the
  // user can always record an Actual even when no Projected exists.
  var solSec = el('div','modal-section');
  solSec.appendChild(txt('div','modal-section-title','Solution'));

  var projRow = el('div','solution-row');
  projRow.appendChild(txt('div','solution-sub-title',
    'Projected ' + (c.projected ? '(' + (c.projected.written_by || 'agent') + ')' : '(not yet run)')));
  if (c.projected) {
    var projList = el('div','solution-fields');
    ['hypothesis','proposed_fix','confidence','reasoning','fix_commit_sha','effectiveness']
      .forEach(function(k){
        if (c.projected[k]) {
          var row = el('div','solution-field');
          row.appendChild(txt('span','solution-key', k + ':'));
          row.appendChild(txt('span','solution-val', c.projected[k]));
          projList.appendChild(row);
        }
      });
    projRow.appendChild(projList);
  } else {
    projRow.appendChild(txt('div','solution-empty',
      'No projected solution. drover:implementer has not run on this ticket.'));
  }
  solSec.appendChild(projRow);

  var actRow = el('div','solution-row');
  actRow.appendChild(txt('div','solution-sub-title',
    'Actual ' + (c.actual ? '(' + (c.actual.written_by || 'user') + ')' : '(not yet recorded)')));
  if (c.actual) {
    var actList = el('div','solution-fields');
    ['root_cause','fix_summary','fix_commit_sha','divergence','effectiveness','captured_by','verified_at']
      .forEach(function(k){
        if (c.actual[k]) {
          var row = el('div','solution-field');
          row.appendChild(txt('span','solution-key', k + ':'));
          row.appendChild(txt('span','solution-val', c.actual[k]));
          actList.appendChild(row);
        }
      });
    actRow.appendChild(actList);
  } else {
    var formHolder = el('div','solution-form-holder');
    var addBtn = el('button','btn btn-primary solution-add-btn');
    addBtn.textContent = 'Record Actual solution';
    addBtn.addEventListener('click', function(){
      formHolder.removeChild(addBtn);
      formHolder.appendChild(buildActualForm(c, formHolder));
    });
    formHolder.appendChild(addBtn);
    actRow.appendChild(formHolder);
  }
  solSec.appendChild(actRow);

  body.appendChild(solSec);

  if(c.stack && c.stack.length){
    var stackSec = el('div','modal-section');
    stackSec.appendChild(txt('div','modal-section-title','Stack trace'));
    var stackBlock = el('div','modal-stack');
    c.stack.forEach(function(line,li) {
      if(li===0){ stackBlock.appendChild(txt('span','stack-line-err',line)); }
      else {
        var row = el('span','stack-line-file');
        row.appendChild(txt('span','stack-line-at','  at '));
        var parts = line.match(/^(.+):(\\d+)$/);
        if(parts){
          row.appendChild(document.createTextNode(parts[1]+':'));
          row.appendChild(txt('span','stack-line-num',parts[2]));
        } else {
          row.appendChild(document.createTextNode(line));
        }
        stackBlock.appendChild(row);
      }
    });
    stackSec.appendChild(stackBlock);
    body.appendChild(stackSec);
  }

  if(c.triageLog && c.triageLog.length){
    var logSec = el('div','modal-section');
    logSec.appendChild(txt('div','modal-section-title','Triage log'));
    var logWrap = el('div','modal-log');
    c.triageLog.forEach(function(entry) {
      var row = el('div','modal-log-entry');
      row.appendChild(txt('span','triage-ts',entry.ts));
      row.appendChild(txt('span','triage-msg',entry.msg));
      logWrap.appendChild(row);
    });
    logSec.appendChild(logWrap);
    body.appendChild(logSec);
  }

  modal.appendChild(body);

  var footer = el('div','modal-footer');
  var moveWrap = el('div','modal-move-wrap');
  moveWrap.appendChild(txt('span','modal-move-label','Move to'));
  var select = el('select','modal-move-select');
  var defaultOpt = document.createElement('option');
  defaultOpt.value = ''; defaultOpt.textContent = 'Select lane...';
  select.appendChild(defaultOpt);
  LANES.forEach(function(lane) {
    if(lane.id===c.lane) return;
    var opt = document.createElement('option');
    opt.value = lane.id; opt.textContent = lane.label;
    select.appendChild(opt);
  });
  select.addEventListener('change', function(){
    if(this.value){ apiMoveTicket(c.id, this.value); closeBoardModal(); }
  });
  moveWrap.appendChild(select);
  footer.appendChild(moveWrap);

  var btnGroup = el('div','modal-btn-group');
  var dashBtn = el('button','btn btn-ghost');
  dashBtn.textContent = '\\u2190 Dashboard';
  dashBtn.addEventListener('click', function(){ closeBoardModal(); switchView('dashboard'); });
  btnGroup.appendChild(dashBtn);

  var nl = nextLane(c.lane);
  if(nl){
    var advBtn = el('button','btn btn-primary');
    advBtn.textContent = laneLabel(nl)+' \\u2192';
    advBtn.addEventListener('click', function(){ apiMoveTicket(c.id, nl); closeBoardModal(); });
    btnGroup.appendChild(advBtn);
  }
  footer.appendChild(btnGroup);

  modal.appendChild(footer);
  document.getElementById('board-modal').classList.add('open');
}

// sprint-wgy: build an inline form for the Actual solution. Mirrors the
// /drover:solution skill's prompted fields (root_cause, fix_summary,
// fix_commit_sha, divergence). POSTs to /api/cards/:id/solution and
// refreshes the board.
function buildActualForm(c, holder) {
  var form = el('div','solution-form');

  function field(id, label, placeholder, multiline) {
    var wrap = el('div','solution-field-wrap');
    var l = el('label','solution-field-label'); l.textContent = label; l.setAttribute('for', id);
    wrap.appendChild(l);
    var inp = multiline ? el('textarea','solution-field-input') : el('input','solution-field-input');
    inp.id = id;
    if (!multiline) inp.type = 'text';
    if (placeholder) inp.placeholder = placeholder;
    if (multiline) inp.rows = 2;
    wrap.appendChild(inp);
    return wrap;
  }

  form.appendChild(field('sol-root-cause', 'Root cause', 'One or two sentences, general audience — no project paths or customer names.', true));
  form.appendChild(field('sol-fix-summary', 'Fix summary', 'What you actually changed.', true));
  form.appendChild(field('sol-fix-sha', 'Fix commit SHA (or "none")', 'abc1234'));
  if (c.projected) {
    var divWrap = el('div','solution-field-wrap');
    var dl = el('label','solution-field-label'); dl.textContent = 'Divergence from projected';
    dl.setAttribute('for','sol-divergence');
    divWrap.appendChild(dl);
    var divSel = el('select','solution-field-input');
    divSel.id = 'sol-divergence';
    ['none','minor','major'].forEach(function(v){
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      divSel.appendChild(o);
    });
    divWrap.appendChild(divSel);
    form.appendChild(divWrap);
  }

  var btnRow = el('div','solution-form-btns');
  var cancelBtn = el('button','btn btn-ghost'); cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', function(){
    removeChildren(holder);
    var readd = el('button','btn btn-primary solution-add-btn');
    readd.textContent = 'Record Actual solution';
    readd.addEventListener('click', function(){
      holder.removeChild(readd);
      holder.appendChild(buildActualForm(c, holder));
    });
    holder.appendChild(readd);
  });
  var saveBtn = el('button','btn btn-primary'); saveBtn.textContent = 'Save + close ticket';
  saveBtn.addEventListener('click', function(){
    var payload = {
      root_cause:    document.getElementById('sol-root-cause').value.trim(),
      fix_summary:   document.getElementById('sol-fix-summary').value.trim(),
      fix_commit_sha:document.getElementById('sol-fix-sha').value.trim() || 'none',
    };
    var divEl = document.getElementById('sol-divergence');
    if (divEl) payload.divergence = divEl.value;
    if (!payload.root_cause || !payload.fix_summary) {
      showToast('Root cause and fix summary are required.');
      return;
    }
    saveBtn.disabled = true; saveBtn.textContent = 'Saving\\u2026';
    fetch('/api/cards/' + encodeURIComponent(c.id) + '/solution', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    }).then(function(r){ return r.json(); }).then(function(resp){
      if (resp.status === 'ok') {
        showToast('Actual solution saved. Ticket ' + c.id + ' closed.');
        closeBoardModal();
        fetchAll();
      } else {
        saveBtn.disabled = false; saveBtn.textContent = 'Save + close ticket';
        showToast('Save failed: ' + (resp.message || 'unknown'));
      }
    }).catch(function(e){
      saveBtn.disabled = false; saveBtn.textContent = 'Save + close ticket';
      showToast('Request failed: ' + e.message);
    });
  });
  btnRow.appendChild(cancelBtn); btnRow.appendChild(saveBtn);
  form.appendChild(btnRow);
  return form;
}

function closeBoardModal(){
  document.getElementById('board-modal').classList.remove('open');
}

document.getElementById('board-modal').addEventListener('click', function(ev){
  if(ev.target===this) closeBoardModal();
});
document.addEventListener('keydown', function(ev){
  if(ev.key==='Escape') closeBoardModal();
});

// ========================================================================
// Project registration
// ========================================================================
// sprint-nto: Add Project modal — offers three paths: pick from
// running-but-unregistered DDEV instances (the primary happy path),
// paste a project path, or fall back to a native folder picker.
// Server validates the selection has .ddev/config.yaml before writing.
function addProjectPrompt() {
  showAddProjectModal();
}

function showAddProjectModal() {
  var content = document.getElementById('modal-content');
  removeChildren(content);

  var header = document.createElement('div'); header.className = 'modal-header';
  var title = document.createElement('div'); title.className = 'modal-title'; title.textContent = 'Add Project';
  var closeBtn = document.createElement('button'); closeBtn.className = 'modal-close'; closeBtn.textContent = '✕';
  closeBtn.onclick = closeBoardModal;
  header.appendChild(title); header.appendChild(closeBtn);

  var body = document.createElement('div'); body.className = 'modal-body';

  // Section 1: running DDEV projects not yet registered.
  var sec1 = document.createElement('div'); sec1.className = 'modal-section';
  var lbl1 = document.createElement('div'); lbl1.className = 'modal-section-title';
  lbl1.textContent = 'Running DDEV projects (not yet registered)';
  sec1.appendChild(lbl1);
  var runList = document.createElement('div'); runList.id = 'add-proj-running';
  runList.style.fontFamily = 'var(--mono)'; runList.style.fontSize = '11px';
  runList.appendChild(document.createTextNode('Loading…'));
  sec1.appendChild(runList);
  body.appendChild(sec1);

  // Section 2: paste-path + folder-picker fallback.
  var sec2 = document.createElement('div'); sec2.className = 'modal-section';
  var lbl2 = document.createElement('div'); lbl2.className = 'modal-section-title';
  lbl2.textContent = 'Or paste a project path';
  sec2.appendChild(lbl2);
  var row = document.createElement('div');
  row.style.display = 'flex'; row.style.gap = '8px';
  var inp = document.createElement('input'); inp.id = 'add-proj-path'; inp.type = 'text';
  inp.placeholder = '/Users/you/Sites/example'; inp.style.flex = '1'; inp.style.padding = '8px';
  var pasteBtn = document.createElement('button'); pasteBtn.className = 'btn btn-primary';
  pasteBtn.textContent = 'Add'; pasteBtn.onclick = function(){ submitAddProject(inp.value.trim()); };
  var pickerBtn = document.createElement('button'); pickerBtn.className = 'btn';
  pickerBtn.textContent = 'Pick folder…';
  pickerBtn.onclick = function(){ submitAddProject(''); };
  row.appendChild(inp); row.appendChild(pasteBtn); row.appendChild(pickerBtn);
  sec2.appendChild(row);
  var hint = document.createElement('div');
  hint.style.fontSize = '10px'; hint.style.color = 'var(--muted2)'; hint.style.marginTop = '6px';
  hint.textContent = 'The selected folder must contain .ddev/config.yaml.';
  sec2.appendChild(hint);
  body.appendChild(sec2);

  content.appendChild(header); content.appendChild(body);
  document.getElementById('board-modal').classList.add('open');

  // Load the running-unregistered list.
  fetch('/api/projects/discover').then(function(r){ return r.json(); }).then(function(d){
    removeChildren(runList);
    var arr = (d && d.running_unregistered) || [];
    if (!arr.length) {
      var empty = document.createElement('div');
      empty.style.color = 'var(--muted2)'; empty.style.fontStyle = 'italic';
      empty.textContent = 'No unregistered running DDEV projects.';
      runList.appendChild(empty);
      return;
    }
    arr.forEach(function(p){
      var line = document.createElement('div');
      line.style.display = 'flex'; line.style.alignItems = 'center';
      line.style.justifyContent = 'space-between'; line.style.padding = '4px 0';
      line.style.borderBottom = '1px solid var(--border2)';
      var info = document.createElement('div');
      info.appendChild(document.createTextNode(p.name));
      var sub = document.createElement('div');
      sub.style.fontSize = '9px'; sub.style.color = 'var(--muted2)';
      sub.textContent = p.approot;
      info.appendChild(sub);
      var addBtn = document.createElement('button'); addBtn.className = 'btn btn-primary';
      addBtn.textContent = 'Add';
      addBtn.onclick = (function(path){ return function(){ submitAddProject(path); }; })(p.approot);
      line.appendChild(info); line.appendChild(addBtn);
      runList.appendChild(line);
    });
  }).catch(function(e){
    removeChildren(runList);
    var err = document.createElement('div');
    err.style.color = 'var(--crit)';
    err.textContent = 'Discovery failed: ' + e.message;
    runList.appendChild(err);
  });
}

function submitAddProject(projectPath) {
  var payload = projectPath ? { path: projectPath } : {};
  fetch('/api/projects/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then(function(r){ return r.json().then(function(b){ return { b: b, status: r.status }; }); })
    .then(function(x){
      var b = x.b || {};
      if (b.status === 'canceled') { showToast('Add project canceled'); return; }
      if (b.status === 'added')   { showToast('Added ' + b.name); closeBoardModal(); if (typeof fetchAll === 'function') fetchAll(); return; }
      if (b.status === 'exists')  { showToast((b.name || 'project') + ' already registered'); closeBoardModal(); return; }
      showToast('Add project failed: ' + (b.message || 'unknown'));
    })
    .catch(function(e){ showToast('Request failed: ' + e.message); });
}

function backfillPrompt() {
  fetch('/api/projects')
    .then(function(r){ return r.json(); })
    .then(function(list) {
      var seen = new Set();
      var envs = [];
      (list || []).forEach(function(p) {
        ((p.acquia && p.acquia.environments) || []).forEach(function(e) {
          if (e.alias && !seen.has(e.alias)) {
            seen.add(e.alias);
            envs.push(e.alias);
          }
        });
      });
      if (envs.length === 0) return showToast('No Acquia envs registered. Add a project first.');
      showBackfillModal(envs);
    });
}

function showBackfillModal(envs) {
  var content = document.getElementById('modal-content');
  removeChildren(content);

  var header = el('div','modal-header');
  header.appendChild(txt('div','modal-title','Backfill Acquia logs'));
  var closeBtn = el('button','modal-close'); closeBtn.textContent = '\u2715';
  closeBtn.onclick = closeBackfillModal;
  header.appendChild(closeBtn);

  var body = el('div','modal-body');

  var sec1 = el('div','modal-section');
  sec1.appendChild(txt('div','modal-section-title','Environment'));
  var sel = document.createElement('select');
  sel.id = 'backfill-env'; sel.style.width = '100%'; sel.style.padding = '8px';
  envs.forEach(function(a) {
    var opt = document.createElement('option'); opt.value = a; opt.textContent = a; sel.appendChild(opt);
  });
  sec1.appendChild(sel);
  body.appendChild(sec1);

  var sec2 = el('div','modal-section');
  sec2.appendChild(txt('div','modal-section-title','Log types'));
  var logTypeWrap = el('div'); logTypeWrap.id = 'backfill-log-types';
  logTypeWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:8px;';
  sec2.appendChild(logTypeWrap);
  body.appendChild(sec2);

  var sec3 = el('div','modal-section'); sec3.style.textAlign = 'right';
  var cancel = el('button','btn'); cancel.textContent = 'Cancel'; cancel.onclick = closeBackfillModal;
  var go = el('button','btn btn-primary'); go.id = 'backfill-go'; go.textContent = 'Run Backfill';
  go.onclick = runBackfill; go.disabled = true;
  sec3.appendChild(cancel); sec3.appendChild(go);
  body.appendChild(sec3);

  content.appendChild(header); content.appendChild(body);
  document.getElementById('board-modal').classList.add('open');

  function loadLogTypes(alias) {
    go.disabled = true;
    removeChildren(logTypeWrap);
    logTypeWrap.appendChild(document.createTextNode('Loading\u2026'));
    fetch('/api/backfill/log-types?alias=' + encodeURIComponent(alias))
      .then(function(r){ return r.json(); })
      .then(function(d){
        removeChildren(logTypeWrap);
        var types = (d && d.log_types) || [];
        if (!types.length) { logTypeWrap.appendChild(document.createTextNode('No log types found')); return; }
        types.forEach(function(t){
          var row = el('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:2px 0;';
          var cb = document.createElement('input'); cb.type = 'checkbox';
          cb.id = 'lt-' + t.type; cb.value = t.type;
          cb.checked = t.available; cb.disabled = !t.available;
          var lbl = document.createElement('label'); lbl.htmlFor = 'lt-' + t.type;
          lbl.style.fontFamily = 'var(--mono)'; lbl.style.fontSize = '11px';
          lbl.style.color = t.available ? 'var(--text)' : 'var(--muted2)';
          lbl.textContent = t.label + (t.available ? '' : ' \u2014 unavailable');
          row.appendChild(cb); row.appendChild(lbl); logTypeWrap.appendChild(row);
        });
        go.disabled = false;
      })
      .catch(function(e){
        removeChildren(logTypeWrap);
        logTypeWrap.appendChild(document.createTextNode('Could not load log types: ' + e.message));
      });
  }

  sel.addEventListener('change', function(){ loadLogTypes(sel.value); });
  loadLogTypes(sel.value);
}
function closeBackfillModal() {
  document.getElementById('board-modal').classList.remove('open');
}

function runBackfill() {
  var alias = document.getElementById('backfill-env').value;
  var checked = Array.from(document.querySelectorAll('#backfill-log-types input[type=checkbox]:checked'));
  var logTypes = checked.map(function(cb){ return cb.value; }).join(',');
  var go = document.getElementById('backfill-go');
  if (go) { go.disabled = true; go.textContent = "Queuing\u2026"; }
  fetch('/api/projects/backfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias: alias, log_types: logTypes })
  })
    .then(function(r) { return r.json(); })
    .then(function(body) {
      if (body.status === 'queued') {
        // sprint-ydz: swap the form for a live progress panel instead of
        // firing a toast and closing — the user can now watch
        // archive-create -> poll -> download -> parse -> done.
        showBackfillProgress(alias, body.log);
        return;
      } else if (body.status === 'done') {
        // Legacy sync path — still handled for tests / CLI fallback.
        showToast('Backfilled ' + alias + ': ' + body.events + ' events, ' +
                  body.new_fingerprints + ' new, ' + body.threshold_hits + ' thresholds');
      } else {
        showToast('Backfill failed: ' + (body.message || 'unknown'));
      }
      closeBackfillModal();
    })
    .catch(function(e) { showToast('Request failed: ' + e.message); closeBackfillModal(); });
}

// sprint-ydz: swap the backfill modal body for a streaming progress panel.
// Subscribes to /api/backfill/progress?log=<path> (SSE) and appends each
// line as it arrives. A state badge reflects the last classified phase.
function showBackfillProgress(alias, logPath) {
  var content = document.getElementById('modal-content');
  var oldBody = content.querySelector('.modal-body');
  if (oldBody) oldBody.parentNode.removeChild(oldBody);

  var body = document.createElement('div'); body.className = 'modal-body';

  var status = document.createElement('div'); status.className = 'modal-section';
  var row = document.createElement('div');
  row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '10px';
  var aliasLbl = document.createElement('div');
  aliasLbl.style.fontFamily = 'var(--mono)'; aliasLbl.style.fontSize = '12px';
  aliasLbl.textContent = alias;
  var badge = document.createElement('span');
  badge.id = 'backfill-phase'; badge.className = 'backfill-phase queued';
  badge.textContent = 'QUEUED';
  row.appendChild(aliasLbl); row.appendChild(badge);
  status.appendChild(row);

  var logLbl = document.createElement('div');
  logLbl.style.marginTop = '6px'; logLbl.style.fontSize = '10px'; logLbl.style.color = 'var(--muted2)';
  logLbl.textContent = logPath;
  status.appendChild(logLbl);

  var pre = document.createElement('pre');
  pre.id = 'backfill-log';
  pre.style.maxHeight = '360px'; pre.style.overflow = 'auto';
  pre.style.fontFamily = 'var(--mono)'; pre.style.fontSize = '11px';
  pre.style.background = 'var(--surface2)'; pre.style.padding = '10px';
  pre.style.border = '1px solid var(--border)'; pre.style.borderRadius = '4px';
  pre.style.margin = '12px 0 0';
  pre.style.whiteSpace = 'pre-wrap';

  var foot = document.createElement('div'); foot.className = 'modal-section'; foot.style.textAlign = 'right';
  var dismiss = document.createElement('button'); dismiss.className = 'btn';
  dismiss.textContent = 'Close'; dismiss.onclick = closeBackfillModal;
  foot.appendChild(dismiss);

  body.appendChild(status);
  body.appendChild(pre);
  body.appendChild(foot);
  content.appendChild(body);

  var url = '/api/backfill/progress?log=' + encodeURIComponent(logPath);
  var es = new EventSource(url);
  function setPhase(phase) {
    badge.className = 'backfill-phase ' + phase.toLowerCase();
    badge.textContent = phase;
  }
  setPhase('STARTING');
  es.addEventListener('line', function(ev){
    try {
      var d = JSON.parse(ev.data);
      pre.appendChild(document.createTextNode(d.line + '\\n'));
      pre.scrollTop = pre.scrollHeight;
      if (d.phase) setPhase(d.phase);
    } catch (_) {}
  });
  es.addEventListener('done', function(){
    setPhase('TRIAGING');
    es.close();
    // Auto-triage: convert backfill NEW events into board cards so errors
    // appear in the dashboard without a separate manual step.
    fetch('/api/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log: logPath, alias: alias })
    })
      .then(function(r){ return r.json(); })
      .then(function(d){
        setPhase('DONE');
        var msg = d.created + ' new errors added to board';
        if (d.skipped) msg += ' (' + d.skipped + ' already known)';
        pre.appendChild(document.createTextNode('TRIAGE: ' + msg + '\\n'));
        pre.scrollTop = pre.scrollHeight;
        if (typeof fetchAll === 'function') fetchAll();
      })
      .catch(function(e){
        setPhase('DONE');
        pre.appendChild(document.createTextNode('TRIAGE failed: ' + e.message + '\\n'));
      });
  });
  es.addEventListener('timeout', function(){ setPhase('TIMEOUT'); es.close(); });
  es.onerror = function(){ /* eventsource auto-reconnect; show soft state */ setPhase('RECONNECT'); };

  var backdrop = document.getElementById('board-modal');
  if (backdrop) {
    var obs = new MutationObserver(function(){
      if (!backdrop.classList.contains('open')) { try { es.close(); } catch (_) {} obs.disconnect(); }
    });
    obs.observe(backdrop, { attributes: true, attributeFilter: ['class'] });
  }
}

// ========================================================================
// View switching
// ========================================================================
function switchView(view) {
  currentView = view;
  var dashEl = document.getElementById('view-dashboard');
  var boardEl = document.getElementById('view-board');
  var btnDash = document.getElementById('btn-dashboard');
  var btnBoard = document.getElementById('btn-board');

  if(view==='board'){
    dashEl.classList.add('hidden');
    boardEl.classList.remove('hidden');
    btnBoard.classList.add('active-view');
    btnDash.classList.remove('active-view');
    renderBoard();
  } else {
    boardEl.classList.add('hidden');
    dashEl.classList.remove('hidden');
    btnDash.classList.add('active-view');
    btnBoard.classList.remove('active-view');
  }
}

// ========================================================================
// Toast
// ========================================================================
var toastTimer;
function showToast(msg){
  var t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.classList.remove('show');},3000);
}

// ========================================================================
// Search
// ========================================================================
document.getElementById('search').addEventListener('input', renderTable);

// Column sort — click to sort, click again to reverse.
document.getElementById('err-thead').addEventListener('click', function(ev) {
  var th = ev.target.closest('th[data-sort]');
  if (!th) return;
  var col = th.getAttribute('data-sort');
  if (col === sortCol) {
    sortDir = -sortDir;
  } else {
    sortCol = col;
    // Numeric columns default descending (highest first);
    // text columns default ascending.
    sortDir = (col === 'occ' || col === 'sev' || col === 'age') ? -1 : 1;
  }
  updateSortHeaders();
  renderTable();
});
updateSortHeaders();

// ========================================================================
// Clock
// ========================================================================
function updateClock(){
  var n=new Date();
  document.getElementById('clock').textContent=n.toISOString().slice(0,10)+' \\u00b7 '+n.toTimeString().slice(0,8);
}
setInterval(updateClock,1000);updateClock();

// ========================================================================
// Time tabs (placeholder for future time-range filtering)
// ========================================================================
var timeTabs = document.querySelectorAll('.time-tab');
for(var ti=0;ti<timeTabs.length;ti++){
  timeTabs[ti].addEventListener('click',function(){
    for(var j=0;j<timeTabs.length;j++){timeTabs[j].classList.remove('active');timeTabs[j].setAttribute('aria-pressed','false');}
    this.classList.add('active');this.setAttribute('aria-pressed','true');
  });
}

// ========================================================================
// DDEV Instance Management
// ========================================================================
var DDEV_INSTANCES = [];
var ddevPanelCollapsed = false;
var ddevConfirmTimers = {};
var MAX_CONCURRENT_WARNING = 3;

function fetchDdevStatus() {
  return fetch('/api/ddev/status').then(function(r){ return r.json(); }).then(function(data) {
    if (Array.isArray(data)) {
      DDEV_INSTANCES = data;
      renderDdevPanel();
    }
  }).catch(function(err){ console.warn('DDEV fetch error:', err); });
}

function renderDdevPanel() {
  var panel = document.getElementById('ddev-panel');
  var tiles = document.getElementById('ddev-tiles');
  var summary = document.getElementById('ddev-summary');
  var inlineSummary = document.getElementById('ddev-inline');
  var warnWrap = document.getElementById('ddev-warn-wrap');

  if (!DDEV_INSTANCES.length) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';

  var running = DDEV_INSTANCES.filter(function(i){ return i.status==='running'; }).length;
  var total = DDEV_INSTANCES.length;
  summary.textContent = running + ' of ' + total + ' running';

  // Inline summary (shown when collapsed)
  removeChildren(inlineSummary);
  DDEV_INSTANCES.forEach(function(inst) {
    var dot = el('span','ddev-inline-dot '+inst.status);
    inlineSummary.appendChild(dot);
    inlineSummary.appendChild(txt('span','ddev-inline-name',inst.name.replace(/-main$/i,'')));
  });

  // Tiles
  removeChildren(tiles);
  DDEV_INSTANCES.forEach(function(inst, idx) {
    var tile = el('div','ddev-tile '+inst.status);
    tile.style.animationDelay = (idx*50)+'ms';
    tile.style.animation = 'fade-up 0.3s ease both';
    tile.setAttribute('role','status');
    tile.setAttribute('aria-label', inst.name+' DDEV instance: '+inst.status);

    // Top: action button + status
    var body = el('div','ddev-tile-body');
    if (inst.status === 'running') {
      var stopBtn = el('button','ddev-action stop-btn');
      stopBtn.textContent = 'Stop';
      stopBtn.setAttribute('aria-label','Stop '+inst.name+' DDEV instance');
      stopBtn.addEventListener('click', (function(name){ return function(ev){
        ev.stopPropagation();
        ddevConfirmStop(name, this);
      };})(inst.name));
      body.appendChild(stopBtn);
    } else if (inst.status === 'stopped') {
      var startBtn = el('button','ddev-action start-btn');
      startBtn.textContent = 'Start';
      startBtn.setAttribute('aria-label','Start '+inst.name+' DDEV instance');
      startBtn.addEventListener('click', (function(name){ return function(ev){
        ev.stopPropagation();
        ddevStartInstance(name);
      };})(inst.name));
      body.appendChild(startBtn);
    } else if (inst.status === 'error') {
      var retryBtn = el('button','ddev-action start-btn');
      retryBtn.textContent = 'Retry';
      retryBtn.setAttribute('aria-label','Retry '+inst.name+' DDEV instance');
      retryBtn.addEventListener('click', (function(name){ return function(ev){
        ev.stopPropagation();
        ddevStartInstance(name);
      };})(inst.name));
      body.appendChild(retryBtn);
    } else {
      var disBtn = el('button','ddev-action stop-btn');
      disBtn.textContent = inst.status === 'starting' ? 'Starting\u2026' : 'Stopping\u2026';
      disBtn.disabled = true;
      body.appendChild(disBtn);
    }
    tile.appendChild(body);

    // Bottom: status + dot + name
    var footer = el('div','ddev-tile-footer');
    footer.appendChild(txt('span','ddev-state',inst.status));
    var nameRow = el('div','ddev-tile-namerow');
    if (inst.status === 'starting' || inst.status === 'stopping') {
      nameRow.appendChild(el('span','ddev-spinner'));
    } else {
      nameRow.appendChild(el('span','ddev-dot'));
    }
    nameRow.appendChild(txt('span','ddev-name',inst.name.replace(/-main$/i,'')));
    footer.appendChild(nameRow);
    tile.appendChild(footer);

    tiles.appendChild(tile);
  });

  // Resource warning
  removeChildren(warnWrap);
  if (running >= MAX_CONCURRENT_WARNING && running === total) {
    var warn = el('div','ddev-warn');
    warn.appendChild(txt('span','ddev-warn-icon','\u26A0'));
    warn.appendChild(txt('span','',running+' of '+total+' instances running \u2014 monitor laptop resources'));
    warnWrap.appendChild(warn);
  }
}

function ddevStartInstance(name) {
  fetch('/api/ddev/start', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({project:name})
  }).then(function(r){ return r.json(); }).then(function(data) {
    if (data.ok) showToast('Starting '+name+'\u2026');
    else showToast('Error: '+(data.error||'unknown'));
  }).catch(function(){ showToast('Network error'); });
}

function ddevConfirmStop(name, btn) {
  if (ddevConfirmTimers[name]) {
    // Second click — actually stop
    clearTimeout(ddevConfirmTimers[name]);
    delete ddevConfirmTimers[name];
    ddevStopInstance(name);
    return;
  }
  // First click — show confirmation
  btn.textContent = 'Confirm?';
  btn.className = 'ddev-action confirm-btn';
  ddevConfirmTimers[name] = setTimeout(function() {
    delete ddevConfirmTimers[name];
    btn.textContent = 'Stop';
    btn.className = 'ddev-action stop-btn';
  }, 3000);
}

function ddevStopInstance(name) {
  fetch('/api/ddev/stop', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({project:name})
  }).then(function(r){ return r.json(); }).then(function(data) {
    if (data.ok) showToast('Stopping '+name+'\u2026');
    else showToast('Error: '+(data.error||'unknown'));
  }).catch(function(){ showToast('Network error'); });
}

function toggleDdevPanel() {
  var panel = document.getElementById('ddev-panel');
  var btn = document.getElementById('ddev-collapse-btn');
  ddevPanelCollapsed = !ddevPanelCollapsed;
  if (ddevPanelCollapsed) {
    panel.classList.add('collapsed');
    btn.textContent = '\u25B8 Expand';
  } else {
    panel.classList.remove('collapsed');
    btn.textContent = '\u25BE';
  }
}

// ========================================================================
// DDEV Terminal Log
// ========================================================================
var ddevTermLogs = {}; // project -> {lines:[], status:'running'|'done'|'error'}
var ddevTermActiveTab = null;
var ddevTermAutoScroll = true;
var ddevTermVisible = false;

function showDdevTerm(project) {
  var term = document.getElementById('ddev-term');
  term.classList.remove('hidden');
  ddevTermVisible = true;
  ddevTermActiveTab = project;
  renderDdevTermTabs();
  renderDdevTermBody();
}

function dismissDdevTerm() {
  // Only dismiss the active tab; if others remain, switch to them
  if (ddevTermActiveTab && ddevTermLogs[ddevTermActiveTab]) {
    var status = ddevTermLogs[ddevTermActiveTab].status;
    if (status === 'done' || status === 'error') {
      delete ddevTermLogs[ddevTermActiveTab];
    }
  }
  var remaining = Object.keys(ddevTermLogs);
  if (remaining.length > 0) {
    ddevTermActiveTab = remaining[0];
    renderDdevTermTabs();
    renderDdevTermBody();
  } else {
    document.getElementById('ddev-term').classList.add('hidden');
    ddevTermVisible = false;
    ddevTermActiveTab = null;
  }
}

function renderDdevTermTabs() {
  var tabsEl = document.getElementById('ddev-term-tabs');
  removeChildren(tabsEl);
  var projects = Object.keys(ddevTermLogs);
  if (projects.length <= 1) {
    // Single project — show label instead of tabs
    if (projects.length === 1) {
      var label = el('span','ddev-term-tab active');
      var dot = el('span','tab-dot '+(ddevTermLogs[projects[0]].status||'running'));
      label.appendChild(dot);
      label.appendChild(document.createTextNode(projects[0]));
      tabsEl.appendChild(label);
    }
    return;
  }
  projects.forEach(function(proj) {
    var tab = el('button','ddev-term-tab'+(proj===ddevTermActiveTab?' active':''));
    var dot = el('span','tab-dot '+(ddevTermLogs[proj].status||'running'));
    tab.appendChild(dot);
    tab.appendChild(document.createTextNode(proj));
    tab.addEventListener('click', function(){ ddevTermActiveTab=proj; renderDdevTermTabs(); renderDdevTermBody(); });
    tabsEl.appendChild(tab);
  });
}

function renderDdevTermBody() {
  var bodyEl = document.getElementById('ddev-term-body');
  removeChildren(bodyEl);
  var log = ddevTermLogs[ddevTermActiveTab];
  if (!log) return;
  log.lines.forEach(function(entry) {
    var line = el('div','ddev-term-line');
    line.appendChild(txt('span','ddev-term-ts',entry.ts+'s'));
    var textCls = 'ddev-term-text';
    if (entry.stream === 'stderr') textCls += ' stderr';
    if (entry.stream === 'ok') textCls += ' ok';
    line.appendChild(txt('span',textCls,entry.text));
    bodyEl.appendChild(line);
  });
  if (ddevTermAutoScroll) {
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }
}

function appendDdevTermLine(project, entry) {
  if (!ddevTermLogs[project]) {
    ddevTermLogs[project] = { lines: [], status: 'running' };
  }
  ddevTermLogs[project].lines.push(entry);
  if (ddevTermLogs[project].lines.length > 500) ddevTermLogs[project].lines.shift();

  // Auto-show terminal when a process starts
  if (!ddevTermVisible) {
    showDdevTerm(project);
  } else if (!ddevTermActiveTab) {
    ddevTermActiveTab = project;
    renderDdevTermTabs();
  }

  // If this is the active tab, append the line directly (no full re-render)
  if (project === ddevTermActiveTab) {
    var bodyEl = document.getElementById('ddev-term-body');
    var line = el('div','ddev-term-line');
    line.appendChild(txt('span','ddev-term-ts',entry.ts+'s'));
    var textCls = 'ddev-term-text';
    if (entry.stream === 'stderr') textCls += ' stderr';
    if (entry.stream === 'ok') textCls += ' ok';
    line.appendChild(txt('span',textCls,entry.text));
    bodyEl.appendChild(line);
    if (ddevTermAutoScroll) bodyEl.scrollTop = bodyEl.scrollHeight;
  } else {
    // Update tab dot if needed
    renderDdevTermTabs();
  }
}

function handleDdevLogDone(project, success) {
  if (ddevTermLogs[project]) {
    ddevTermLogs[project].status = success ? 'done' : 'error';
    renderDdevTermTabs();
  }
}

// Auto-scroll: stop if user scrolls up, resume if at bottom
(function() {
  var bodyEl = document.getElementById('ddev-term-body');
  bodyEl.addEventListener('scroll', function() {
    var atBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 20;
    ddevTermAutoScroll = atBottom;
  });
})();

// On SSE reconnect, fetch existing log buffers for any active operations
function fetchDdevLogs() {
  DDEV_INSTANCES.forEach(function(inst) {
    if (inst.status === 'starting' || inst.status === 'stopping') {
      fetch('/api/ddev/logs?project='+encodeURIComponent(inst.name))
        .then(function(r){ return r.json(); })
        .then(function(data) {
          if (data.lines && data.lines.length) {
            ddevTermLogs[inst.name] = { lines: data.lines, status: data.status };
            if (!ddevTermVisible) showDdevTerm(inst.name);
            else { renderDdevTermTabs(); renderDdevTermBody(); }
          }
        }).catch(function(){});
    }
  });
}

// ========================================================================
// SSE: live updates
// ========================================================================
function connectSSE() {
  var evtSource = new EventSource('/events');
  evtSource.addEventListener('board-update', function(){ fetchAll(); });
  evtSource.addEventListener('cycle-complete', function(){ fetchAll(); });
  evtSource.addEventListener('ingest-event', function(){ fetchAll(); });
  evtSource.addEventListener('ddev-status', function(ev){
    try {
      DDEV_INSTANCES = JSON.parse(ev.data);
      renderDdevPanel();
    } catch(e) {}
  });
  evtSource.addEventListener('ddev-log', function(ev){
    try {
      var d = JSON.parse(ev.data);
      appendDdevTermLine(d.project, { ts:d.ts, text:d.text, stream:d.stream });
    } catch(e) {}
  });
  evtSource.addEventListener('ddev-log-done', function(ev){
    try {
      var d = JSON.parse(ev.data);
      handleDdevLogDone(d.project, d.success);
    } catch(e) {}
  });
  evtSource.onerror = function() {
    evtSource.close();
    setTimeout(function(){ connectSSE(); fetchDdevLogs(); }, 5000);
  };
}

// ========================================================================
// Init
// ========================================================================
Promise.all([fetchAll(), fetchDdevStatus()]).then(function(){ connectSSE(); });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS headers for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    // SSE endpoint
    if (pathname === '/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // Project registration endpoints (GET list, POST add)
    if (pathname === '/api/projects' && req.method === 'GET') {
      return jsonResponse(res, 200, listProjects());
    }

    if (pathname === '/api/projects/add' && req.method === 'POST') {
      return handleAddProject(req, res);
    }

    // sprint-nto: running-but-unregistered DDEV discovery for the picker.
    if (pathname === '/api/projects/discover' && req.method === 'GET') {
      return await handleDiscoverProjects(req, res);
    }

    if (pathname === '/api/projects/backfill' && req.method === 'POST') {
      return handleBackfill(req, res);
    }

    // sprint-ydz: SSE tail of a backfill log file.
    if (pathname === '/api/backfill/progress' && req.method === 'GET') {
      return handleBackfillProgress(req, res, url);
    }

    if (pathname === '/api/triage' && req.method === 'POST') {
      return await handleTriage(req, res);
    }

    if (pathname === '/api/backfill/log-types' && req.method === 'GET') {
      return await handleLogTypes(req, res, url);
    }

    // API endpoints
    if (pathname === '/api/board' && req.method === 'GET') {
      const tickets = await fetchTickets();
      return jsonResponse(res, 200, tickets);
    }

    if (pathname === '/api/timeline' && req.method === 'GET') {
      const timeline = fetchTimeline();
      return jsonResponse(res, 200, timeline);
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      const health = await fetchHealth();
      return jsonResponse(res, 200, health);
    }

    // T2: live ingestion status — per-project armed / event counts so the
    // UI can render the "Listening for stream messages…" empty state.
    if (pathname === '/api/ingestion/status' && req.method === 'GET') {
      return jsonResponse(res, 200, ingestionStatusSnapshot());
    }

    if (pathname === '/api/move' && req.method === 'POST') {
      return await handleMove(req, res);
    }

    // sprint-wgy: /api/cards/:id/solution — record Actual solution + close.
    const solMatch = pathname.match(/^\/api\/cards\/([^/]+)\/solution$/);
    if (solMatch && req.method === 'POST') {
      return await handleSolution(req, res, decodeURIComponent(solMatch[1]));
    }

    // DDEV management endpoints
    if (pathname === '/api/ddev/status' && req.method === 'GET') {
      const instances = fetchDdevInstances();
      return jsonResponse(res, 200, instances);
    }

    if (pathname === '/api/ddev/start' && req.method === 'POST') {
      let body;
      try { body = await readBody(req); } catch (e) {
        return jsonResponse(res, 400, { error: 'Invalid JSON' });
      }
      const { project } = body;
      if (!project) return jsonResponse(res, 400, { error: 'Missing project' });

      // Verify the project exists in DDEV
      const instances = fetchDdevInstances();
      const inst = instances.find(i => i.name === project);
      if (!inst) return jsonResponse(res, 404, { error: 'DDEV project not found: ' + project });
      if (inst.status === 'running') return jsonResponse(res, 200, { ok: true, message: 'Already running' });
      if (inst.status === 'starting') return jsonResponse(res, 200, { ok: true, message: 'Already starting' });

      // Fire and forget — SSE will push updates
      handleDdevStart(project);
      return jsonResponse(res, 200, { ok: true });
    }

    if (pathname === '/api/ddev/stop' && req.method === 'POST') {
      let body;
      try { body = await readBody(req); } catch (e) {
        return jsonResponse(res, 400, { error: 'Invalid JSON' });
      }
      const { project } = body;
      if (!project) return jsonResponse(res, 400, { error: 'Missing project' });

      const instances = fetchDdevInstances();
      const inst = instances.find(i => i.name === project);
      if (!inst) return jsonResponse(res, 404, { error: 'DDEV project not found: ' + project });
      if (inst.status === 'stopped') return jsonResponse(res, 200, { ok: true, message: 'Already stopped' });
      if (inst.status === 'stopping') return jsonResponse(res, 200, { ok: true, message: 'Already stopping' });

      handleDdevStop(project);
      return jsonResponse(res, 200, { ok: true });
    }

    if (pathname === '/api/ddev/logs' && req.method === 'GET') {
      const project = url.searchParams.get('project');
      if (!project) return jsonResponse(res, 400, { error: 'Missing project param' });
      const buf = ddevLogs.get(project);
      if (!buf) return jsonResponse(res, 200, { lines: [], status: 'idle' });
      return jsonResponse(res, 200, { lines: buf.lines, status: buf.status });
    }

    // Favicon: drover wordmark V in drover-red, capped by Velir's green/blue
    // chevron. Split-palette attribution mark (candidate V3).
    if (pathname === '/favicon.svg' && req.method === 'GET') {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#0C0D10"/><g transform="translate(0 6.34) scale(1.0385)"><path d="M0 0H15.2L32.06 34H16.85Z" fill="#FF453A"/><path d="M30.75 0L38.49 15.77L23.01 0Z" fill="#10E992"/><path d="M38.49 15.77L30.75 0L46.22 0Z" fill="#0051FF"/></g></svg>`;
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(svg),
        'Cache-Control': 'public, max-age=86400',
      });
      return res.end(svg);
    }

    // Default: serve HTML dashboard
    if (pathname === '/' && req.method === 'GET') {
      const html = buildHtml();
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
      });
      return res.end(html);
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');

  } catch (err) {
    console.error('Request error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

server.listen(PORT, '127.0.0.1', () => {
  console.log(`drover dashboard listening on http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
  if (STATE_PATH) console.log(`State: ${STATE_PATH}`);
  if (CONFIG_PATH) console.log(`Config: ${CONFIG_PATH}`);
  setupWatchers();
  // sprint-56q: warm the ticket cache at startup so the first /api/board
  // request paints from cache instead of paying full bd-list latency.
  fetchTickets().catch(err => {
    console.warn('initial fetchTickets prefetch failed:', err.message);
  });
  // T2: auto-arm the umbrella watcher so opening the dashboard starts
  // live ingestion without requiring a separate /drover:watch invocation.
  // Can be disabled for tests via DROVER_DISABLE_AUTOINGEST=1.
  if (!process.env.DROVER_DISABLE_AUTOINGEST) {
    try { startAutoIngestion(); }
    catch (err) { console.warn('auto-ingest startup failed:', err.message); }
  } else {
    console.log('[ingest] auto-ingest disabled via DROVER_DISABLE_AUTOINGEST');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    console.error(`Check: lsof -i:${PORT}`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
