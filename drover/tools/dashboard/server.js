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
const { execFileSync, execFile, spawn } = require('child_process');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2);
      args[key] = argv[++i];
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.db) {
  console.error('Usage: node server.js --db <path> --state <path> [--config <path>] [--port 3749]');
  process.exit(1);
}

const DB_PATH = args.db;
const STATE_PATH = args.state || '';
const CONFIG_PATH = args.config || '';
const PORT = parseInt(args.port || '3749', 10);

// Verify DB exists
if (!fs.existsSync(DB_PATH)) {
  console.error(`drover.db not found at: ${DB_PATH}`);
  console.error('Run /drover:setup first to initialize the board.');
  process.exit(1);
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

// Build the set of DDEV project names relevant to this drover instance
function getRelevantDdevProjects() {
  const config = fetchConfig();
  if (!config || !config.environments) return null; // null = show all
  const names = new Set();
  for (const env of config.environments) {
    if (env.ddev_project) names.add(env.ddev_project);
  }
  // Also include any projects listed in ddev_management.instances
  if (config.ddev_management && Array.isArray(config.ddev_management.instances)) {
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

function fetchTickets() {
  const now = Date.now();
  if (ticketCache.data && (now - ticketCache.ts) < CACHE_TTL) {
    return ticketCache.data;
  }
  try {
    const output = execFileSync('bd', [
      'list', '-l', 'board-drover', '--db', DB_PATH, '--json', '--flat'
    ], { encoding: 'utf8', timeout: 5000 });
    const data = JSON.parse(output || '[]');
    ticketCache = { data, ts: now };
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

function parseField(body, pattern, fallback) {
  if (fallback === undefined) fallback = '';
  const m = body && body.match(pattern);
  return m ? m[1].trim() : fallback;
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

  return {
    id: ticket.id || '[unknown]',
    title: ticket.title || '[untitled]',
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

function fetchHealth() {
  const tickets = fetchTickets();
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
  // Watch .beads/ directory for board changes
  const beadsDir = require('path').dirname(DB_PATH);
  try {
    fs.watch(beadsDir, { persistent: false }, () => {
      if (boardDebounce) clearTimeout(boardDebounce);
      boardDebounce = setTimeout(() => {
        ticketCache = { data: null, ts: 0 }; // invalidate cache
        broadcast('board-update', { ts: new Date().toISOString() });
      }, 500);
    });
  } catch {
    console.warn('Could not watch .beads/ directory');
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
// Project registration (/api/projects, /api/projects/add)
// ---------------------------------------------------------------------------

const projectsModule = require('./projects.js');

async function handleAddProject(req, res) {
  let body = {};
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (e) {
    return jsonResponse(res, 400, { status: 'error', message: 'invalid JSON body' });
  }

  let targetPath = body.path;
  if (!targetPath) {
    if (process.platform !== 'darwin') {
      return jsonResponse(res, 400, { status: 'error', message: 'path required on non-macOS' });
    }
    targetPath = projectsModule.pickFolderMacOS();
    if (!targetPath) return jsonResponse(res, 200, { status: 'canceled' });
  }

  const result = projectsModule.addProject(targetPath);
  const code = result.status === 'error' ? 400 : 200;
  return jsonResponse(res, code, result);
}

function listProjects() { return projectsModule.listProjects(); }

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
  const tickets = fetchTickets();
  if (tickets.error) return jsonResponse(res, 500, { error: tickets.error });

  const ticket = (Array.isArray(tickets) ? tickets : []).find(t => t.id === id);
  if (!ticket) return jsonResponse(res, 404, { error: 'Ticket not found: ' + id });

  const currentLane = (ticket.labels || []).find(l => l.startsWith('lane-'));
  if (!currentLane) return jsonResponse(res, 400, { error: 'Ticket has no lane label' });
  if (currentLane === toLane) return jsonResponse(res, 200, { ok: true, message: 'Already in that lane' });

  const now = new Date().toISOString();
  const note = now + ': Moved from ' + currentLane + ' to ' + toLane + ' via dashboard';

  try {
    execFileSync('bd', [
      'update', id,
      '--db', DB_PATH,
      '--remove-label', currentLane,
      '--add-label', toLane,
      '--append-notes', note,
    ], { encoding: 'utf8', timeout: 5000 });
    ticketCache = { data: null, ts: 0 }; // invalidate
    return jsonResponse(res, 200, { ok: true });
  } catch (err) {
    return jsonResponse(res, 500, { error: 'bd update failed: ' + err.message });
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
      <span class="live-badge"><span class="live-dot"></span>live</span>
    </div>
    <div class="topbar-right">
      <span class="ts" id="clock"></span>
      <button class="btn btn-ghost active-view" id="btn-dashboard" onclick="switchView('dashboard')">&#9783; Dashboard</button>
      <button class="btn btn-ghost" id="btn-board" onclick="switchView('board')">&#8862; Board</button>
      <button class="btn btn-ghost" id="btn-add-project" onclick="addProjectPrompt()" title="Register a DDEV project with drover">+ Add Project</button>
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
          <thead>
            <tr>
              <th style="width:60px">Sev</th>
              <th>Error</th>
              <th class="sort-active" style="width:90px;text-align:right">Occ &#8595;</th>
              <th style="width:100px">Env</th>
              <th style="width:72px">Age</th>
              <th style="width:72px">Lane</th>
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
    fetch('/api/timeline').then(function(r){return r.json();})
  ]).then(function(results) {
    var board = results[0];
    HEALTH = results[1];
    TIMELINE = results[2];

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

  return {
    id: ticket.id || '',
    title: ticket.title || '[untitled]',
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
    if (env.critCount === 0 && env.warnCount === 0) pills.appendChild(txt('span','sev-pill i','0 open'));
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
  return cards.sort(function(a,b){ return b.occ - a.occ; });
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

  // Occ
  var occTd = txt('td','num',c.occ.toLocaleString());
  occTd.style.textAlign = 'right';
  tr.appendChild(occTd);

  // Envs
  var envTd = el('td');
  var envWrap = el('div','env-tags');
  c.envs.forEach(function(env){ envWrap.appendChild(txt('span','env-tag',env)); });
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
  if(c.assignee) items.push({label:'Assigned', value:c.assignee});
  if(c.worktree) items.push({label:'Worktree', value:c.worktree});

  items.forEach(function(item) {
    var mi = el('div','modal-meta-item');
    mi.appendChild(txt('div','modal-meta-label',item.label));
    mi.appendChild(txt('div','modal-meta-value'+(item.cls?' '+item.cls:''), item.value));
    metaGrid.appendChild(mi);
  });
  metaSec.appendChild(metaGrid);
  body.appendChild(metaSec);

  var errSec = el('div','modal-section');
  errSec.appendChild(txt('div','modal-section-title','Error message'));
  errSec.appendChild(txt('div','modal-err-msg',c.title));
  body.appendChild(errSec);

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
function addProjectPrompt() {
  var btn = document.getElementById('btn-add-project');
  if (btn) { btn.disabled = true; btn.textContent = 'Picking…'; }
  fetch('/api/projects/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  })
    .then(function(r) { return r.json().then(function(body) { return { status: r.status, body: body }; }); })
    .then(function(r) {
      var b = r.body || {};
      if (b.status === 'canceled') { alert('Add project: canceled.'); return; }
      if (b.status === 'added')   { alert('Added ' + b.name + '\\n' + (b.path || '')); return; }
      if (b.status === 'exists')  { alert((b.name || 'project') + ' is already registered.'); return; }
      alert('Could not add project: ' + (b.message || 'unknown error'));
    })
    .catch(function(e) { alert('Request failed: ' + e.message); })
    .finally(function() {
      if (btn) { btn.disabled = false; btn.textContent = '+ Add Project'; }
    });
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

    // API endpoints
    if (pathname === '/api/board' && req.method === 'GET') {
      const tickets = fetchTickets();
      return jsonResponse(res, 200, tickets);
    }

    if (pathname === '/api/timeline' && req.method === 'GET') {
      const timeline = fetchTimeline();
      return jsonResponse(res, 200, timeline);
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      const health = fetchHealth();
      return jsonResponse(res, 200, health);
    }

    if (pathname === '/api/move' && req.method === 'POST') {
      return await handleMove(req, res);
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
