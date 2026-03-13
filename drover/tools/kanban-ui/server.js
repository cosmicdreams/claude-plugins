#!/usr/bin/env node
/**
 * drover kanban-ui server
 * Thin rendering layer over Beads — queries `bd list` on each page load.
 * Adapted from sprint/tools/kanban-ui/server.js.
 *
 * Usage: node server.js <abs_path_to_drover.db>
 * Port:  3748
 * Requires: Node.js >=18, bd CLI in PATH
 */

'use strict';

const http = require('http');
const { execFileSync } = require('child_process');
const { URL } = require('url');

const PORT = 3748;
const DB_PATH = process.argv[2];

if (!DB_PATH) {
  console.error('Usage: node server.js <absolute-path-to-.beads/drover.db>');
  process.exit(1);
}

// Verify DB exists
const fs = require('fs');
if (!fs.existsSync(DB_PATH)) {
  console.error(`drover.db not found at: ${DB_PATH}`);
  console.error('Run /drover:setup first to initialize the board.');
  process.exit(1);
}

const LANES = [
  { id: 'lane-triage',           label: 'TRIAGE',           hidden: false },
  { id: 'lane-ready',            label: 'READY',            hidden: false },
  { id: 'lane-implementing',     label: 'IMPLEMENTING',     hidden: false },
  { id: 'lane-awaiting-review',  label: 'AWAITING REVIEW',  hidden: false },
  { id: 'lane-done',             label: 'DONE',             hidden: true  },
  { id: 'lane-closed',           label: 'CLOSED',           hidden: true  },
];

const SEVERITY_ICONS = {
  emergency: '🚨', critical: '🔴', alert: '🟠',
  error: '🟡', warning: '🔵', notice: '⚪', info: '⚪', debug: '⚪',
};

function fetchTickets() {
  try {
    const output = execFileSync('bd', [
      'list', '-l', 'board-drover', '--db', DB_PATH, '--json'
    ], { encoding: 'utf8', timeout: 5000 });
    return JSON.parse(output || '[]');
  } catch (err) {
    return { error: err.message };
  }
}

function parseField(body, pattern, fallback = '') {
  const m = body && body.match(pattern);
  return m ? m[1].trim() : fallback;
}

function formatAge(dateStr) {
  if (!dateStr) return '?';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function parseCard(ticket) {
  const labels = ticket.labels || [];
  const body = ticket.body || '';

  const severityLabel = labels.find(l => l.startsWith('severity-'))?.replace('severity-', '') || 'unknown';
  const envLabels = labels.filter(l => l.startsWith('env-')).map(l => l.replace('env-', ''));
  const fp = parseField(body, /\*\*Fingerprint:\*\*\s+`([a-f0-9]+)`/, '[unknown]');
  const occurrences = parseField(body, /\*\*Total Occurrences:\*\*\s+(\d+)/, '?');
  const worktree = parseField(body, /\*\*Worktree:\*\*\s+(\S+)/);

  return {
    id: ticket.id || '[unknown]',
    title: ticket.title || '[untitled]',
    lane: labels.find(l => l.startsWith('lane-')) || 'lane-triage',
    severityLabel,
    severityIcon: SEVERITY_ICONS[severityLabel] || '⚪',
    envLabels,
    fp,
    occurrences,
    worktree,
    age: formatAge(ticket.created_at),
  };
}

function renderCard(card) {
  const envStr = card.envLabels.length ? card.envLabels.join(', ') : 'unknown';
  const worktreeRow = card.worktree
    ? `<div class="card-worktree">Worktree: ${escHtml(card.worktree)}</div>`
    : '';
  return `
    <div class="card severity-${escHtml(card.severityLabel)}">
      <div class="card-title">${card.severityIcon} ${escHtml(card.title.slice(0, 80))}</div>
      <div class="card-meta">
        <span class="fp">fp:${escHtml(card.fp.slice(0, 12))}</span>
        <span class="occ">${escHtml(String(card.occurrences))}x</span>
        <span class="envs">${escHtml(envStr)}</span>
        <span class="age">${escHtml(card.age)}</span>
      </div>
      ${worktreeRow}
    </div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderBoard(tickets, showAll) {
  if (tickets.error) {
    return `<div class="error">bd error: ${escHtml(tickets.error)}</div>`;
  }

  const cards = tickets.map(parseCard);
  const visibleLanes = showAll ? LANES : LANES.filter(l => !l.hidden);

  const columns = visibleLanes.map(lane => {
    const laneCards = cards.filter(c => c.lane === lane.id);
    const cardHtml = laneCards.length
      ? laneCards.map(renderCard).join('')
      : '<div class="empty">(none)</div>';
    return `
      <div class="column">
        <div class="column-header">${lane.label} <span class="count">(${laneCards.length})</span></div>
        <div class="column-cards">${cardHtml}</div>
      </div>`;
  }).join('');

  const open = cards.filter(c => !['lane-done','lane-closed'].includes(c.lane)).length;
  const ready = cards.filter(c => c.lane === 'lane-ready').length;
  const inflight = cards.filter(c => c.lane === 'lane-implementing').length;

  return `
    <div class="board-header">
      Open: ${open} &nbsp;|&nbsp; Ready: ${ready} &nbsp;|&nbsp; In-flight: ${inflight}
      ${showAll ? '' : ' &nbsp;|&nbsp; <a href="?all=1">show closed</a>'}
    </div>
    <div class="board">${columns}</div>`;
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: monospace; background: #1a1a1a; color: #e0e0e0; padding: 16px; }
  h1 { font-size: 1rem; color: #aaa; margin-bottom: 12px; }
  .board-header { margin-bottom: 12px; color: #888; font-size: 0.85rem; }
  .board-header a { color: #5af; }
  .board { display: flex; gap: 12px; overflow-x: auto; }
  .column { min-width: 260px; flex: 1; background: #252525; border-radius: 6px; padding: 10px; }
  .column-header { font-size: 0.75rem; font-weight: bold; color: #888; letter-spacing: 0.08em; margin-bottom: 8px; }
  .count { color: #555; }
  .column-cards { display: flex; flex-direction: column; gap: 8px; }
  .card { background: #2d2d2d; border-radius: 4px; padding: 8px 10px; border-left: 3px solid #555; }
  .card.severity-emergency { border-left-color: #ff3333; }
  .card.severity-critical   { border-left-color: #ff6600; }
  .card.severity-alert      { border-left-color: #ff9900; }
  .card.severity-error      { border-left-color: #ffcc00; }
  .card.severity-warning    { border-left-color: #3399ff; }
  .card-title { font-size: 0.82rem; color: #ddd; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-meta { font-size: 0.72rem; color: #666; display: flex; gap: 8px; flex-wrap: wrap; }
  .card-meta .fp { color: #888; font-family: monospace; }
  .card-worktree { font-size: 0.7rem; color: #555; margin-top: 4px; }
  .empty { font-size: 0.78rem; color: #444; font-style: italic; padding: 4px 0; }
  .error { color: #f55; background: #2a1a1a; padding: 12px; border-radius: 4px; }
`;

const REFRESH_META = '<meta http-equiv="refresh" content="30">';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const showAll = url.searchParams.has('all');

  const tickets = fetchTickets();
  const boardHtml = renderBoard(tickets, showAll);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>drover board</title>
  ${REFRESH_META}
  <style>${CSS}</style>
</head>
<body>
  <h1>🔴 drover board — auto-refreshes every 30s</h1>
  ${boardHtml}
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`drover kanban-ui listening on http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
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
