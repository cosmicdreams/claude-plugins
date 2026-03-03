#!/usr/bin/env node
/**
 * Kanban Board UI Server
 * Zero external Node.js dependencies — built-ins only on the server.
 * marked.js served locally from marked.min.js (no CDN).
 *
 * Usage:
 *   node server.js --dir <path> [--name <string>] [--lanes <csv>] [--port <n>]
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

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

if (!args.dir) {
  console.error('Error: --dir <path> is required');
  console.error('Usage: node server.js --dir <path> [--name <string>] [--lanes <csv>] [--port <n>]');
  process.exit(1);
}

const BOARD_DIR = path.resolve(args.dir);
const BOARD_NAME = args.name || 'Kanban Board';
const PORT = parseInt(args.port || '3748', 10);

// Load marked.js from the same directory as this script (no CDN required)
const MARKED_JS = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, 'marked.min.js'), 'utf8');
  } catch (e) {
    // Fallback: minimal pass-through if file is missing
    return 'window.marked={parse:function(t){return"<pre>"+t.replace(/&/g,"&amp;").replace(/</g,"&lt;")+"</pre>";}}';
  }
})();

// ---------------------------------------------------------------------------
// Lane Discovery
// ---------------------------------------------------------------------------

function discoverLanes() {
  if (args.lanes) {
    return args.lanes.split(',').map(s => s.trim()).filter(Boolean);
  }
  try {
    const entries = fs.readdirSync(BOARD_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
  } catch (e) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Markdown / Frontmatter Parsing
// ---------------------------------------------------------------------------

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: text };
  const fm = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { fm, body: match[2] };
}

function parseBody(body) {
  const lines = body.split('\n');
  let title = '';
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (!title && line.startsWith('# ')) {
      title = line.slice(2).trim();
      continue;
    }
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), content: '' };
    } else if (current) {
      current.content += line + '\n';
    }
  }
  if (current) sections.push(current);
  sections.forEach(s => { s.content = s.content.trimEnd(); });
  return { title, sections };
}

function serializeCard({ fm, title, sections }) {
  const fmLines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
  const body = [
    `# ${title}`,
    '',
    ...sections.flatMap(s => [`## ${s.heading}`, s.content, ''])
  ].join('\n');
  return `---\n${fmLines}\n---\n\n${body.trimEnd()}\n`;
}

function parseCard(filePath, lane, file) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { fm, body } = parseFrontmatter(raw);
  const { title, sections } = parseBody(body);
  return { file, lane, fm, title, sections, raw };
}

// ---------------------------------------------------------------------------
// Lane Display Name
// ---------------------------------------------------------------------------

function laneDisplayName(dir) {
  return dir
    .replace(/^\d+_/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Retro Date Detection
// ---------------------------------------------------------------------------

const RETRO_RE = /^retro-(\d{8})/;

function formatRetroDate(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const year = d.slice(0, 4);
  const month = parseInt(d.slice(4, 6), 10) - 1;
  const day = parseInt(d.slice(6, 8), 10);
  return `${months[month]} ${day}, ${year}`;
}

// ---------------------------------------------------------------------------
// Board Data
// ---------------------------------------------------------------------------

function readBoardData(lanes) {
  const result = [];
  const allRetroDates = new Set();

  for (const lane of lanes) {
    const laneDir = path.join(BOARD_DIR, lane);
    const cards = [];
    let files = [];
    try {
      files = fs.readdirSync(laneDir).filter(f => f.endsWith('.md')).sort();
    } catch (e) {
      // Lane directory missing or unreadable — skip
    }
    for (const file of files) {
      const m = file.match(RETRO_RE);
      if (m) allRetroDates.add(m[1]);
      try {
        const card = parseCard(path.join(laneDir, file), lane, file);
        cards.push(card);
      } catch (e) {
        // Skip unreadable cards
      }
    }
    result.push({ id: lane, displayName: laneDisplayName(lane), cards });
  }

  const retroDates = allRetroDates.size > 0
    ? Array.from(allRetroDates).sort().reverse()
    : null;

  return {
    boardName: BOARD_NAME,
    lanes: result,
    retroDates,
  };
}

// ---------------------------------------------------------------------------
// HTTP Helpers
// ---------------------------------------------------------------------------

function jsonResponse(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
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

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

function handleData(res) {
  const lanes = discoverLanes();
  const data = readBoardData(lanes);
  jsonResponse(res, 200, data);
}

async function handleMove(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return jsonResponse(res, 400, { error: 'Invalid JSON' });
  }
  const { file, fromLane, toLane } = body;
  if (!file || !fromLane || !toLane) {
    return jsonResponse(res, 400, { error: 'Missing fields' });
  }
  // Prevent path traversal
  const src = path.join(BOARD_DIR, fromLane, file);
  const dst = path.join(BOARD_DIR, toLane, file);
  if (!src.startsWith(BOARD_DIR) || !dst.startsWith(BOARD_DIR)) {
    return jsonResponse(res, 400, { error: 'Invalid path' });
  }
  try {
    fs.mkdirSync(path.join(BOARD_DIR, toLane), { recursive: true });
    fs.renameSync(src, dst);
    const card = parseCard(dst, toLane, file);
    jsonResponse(res, 200, { success: true, card });
  } catch (e) {
    jsonResponse(res, 500, { error: e.message });
  }
}

async function handleEdit(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return jsonResponse(res, 400, { error: 'Invalid JSON' });
  }
  const { file, lane, title, sections, fm: fmUpdates } = body;
  if (!file || !lane) {
    return jsonResponse(res, 400, { error: 'Missing fields' });
  }
  const filePath = path.join(BOARD_DIR, lane, file);
  if (!filePath.startsWith(BOARD_DIR)) {
    return jsonResponse(res, 400, { error: 'Invalid path' });
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { fm: existingFm, body: existingBody } = parseFrontmatter(raw);
    const { title: existingTitle, sections: existingSections } = parseBody(existingBody);

    const mergedFm = { ...existingFm, ...(fmUpdates || {}) };

    const mergedSections = [...existingSections];
    if (sections) {
      for (const incoming of sections) {
        const idx = mergedSections.findIndex(s => s.heading === incoming.heading);
        if (idx >= 0) {
          mergedSections[idx] = { ...mergedSections[idx], content: incoming.content };
        } else {
          mergedSections.push(incoming);
        }
      }
    }

    const newTitle = title !== undefined ? title : existingTitle;
    const serialized = serializeCard({ fm: mergedFm, title: newTitle, sections: mergedSections });
    fs.writeFileSync(filePath, serialized, 'utf8');
    jsonResponse(res, 200, { success: true, card: { file, lane, fm: mergedFm, title: newTitle, sections: mergedSections } });
  } catch (e) {
    jsonResponse(res, 500, { error: e.message });
  }
}

async function handleComment(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return jsonResponse(res, 400, { error: 'Invalid JSON' });
  }
  const { file, lane, comment } = body;
  if (!file || !lane || !comment) {
    return jsonResponse(res, 400, { error: 'Missing fields' });
  }
  const filePath = path.join(BOARD_DIR, lane, file);
  if (!filePath.startsWith(BOARD_DIR)) {
    return jsonResponse(res, 400, { error: 'Invalid path' });
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const today = new Date().toISOString().slice(0, 10);
    const bullet = `- [${today}] ${comment}`;

    const { fm, body: existingBody } = parseFrontmatter(raw);
    const { title, sections } = parseBody(existingBody);

    const commentsIdx = sections.findIndex(s => s.heading === 'Comments');
    if (commentsIdx >= 0) {
      sections[commentsIdx].content = sections[commentsIdx].content
        ? sections[commentsIdx].content + '\n' + bullet
        : bullet;
    } else {
      sections.push({ heading: 'Comments', content: bullet });
    }

    const serialized = serializeCard({ fm, title, sections });
    fs.writeFileSync(filePath, serialized, 'utf8');
    jsonResponse(res, 200, { success: true });
  } catch (e) {
    jsonResponse(res, 500, { error: e.message });
  }
}

async function handleDelete(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return jsonResponse(res, 400, { error: 'Invalid JSON' });
  }
  const { file, lane } = body;
  if (!file || !lane) {
    return jsonResponse(res, 400, { error: 'Missing fields' });
  }
  const filePath = path.join(BOARD_DIR, lane, file);
  if (!filePath.startsWith(BOARD_DIR)) {
    return jsonResponse(res, 400, { error: 'Invalid path' });
  }
  try {
    fs.unlinkSync(filePath);
    jsonResponse(res, 200, { success: true });
  } catch (e) {
    jsonResponse(res, 500, { error: e.message });
  }
}

// ---------------------------------------------------------------------------
// Changelog helpers
// ---------------------------------------------------------------------------

function getSection(sections, heading) {
  const s = (sections || []).find(s => s.heading.toLowerCase() === heading.toLowerCase());
  if (!s || !s.content) return '';
  const text = s.content.replace(/^#{1,6}\s+/gm, '').replace(/[*_`]/g, '').trim();
  return text.length > 200 ? text.slice(0, 197) + '...' : text;
}

function writeChangelog(entries) {
  const changelogPath = path.join(BOARD_DIR, 'CHANGELOG.md');
  const today = new Date().toISOString().slice(0, 10);

  const entryLines = entries.flatMap(e => {
    const id = e.fm.id || e.file.replace('.md', '');
    const title = e.title || id;
    const meta = [
      e.fm.target   && ('Target: '   + e.fm.target),
      e.fm.category && ('Category: ' + e.fm.category),
      e.fm.priority && ('Priority: ' + e.fm.priority),
      e.fm.effort   && ('Effort: '   + e.fm.effort),
    ].filter(Boolean).join(' | ');

    const finding = getSection(e.sections, 'Finding');
    const rec     = getSection(e.sections, 'Recommendation');

    const lines = ['### ' + id + ' — ' + title];
    if (meta) lines.push('_' + meta + '_');
    lines.push('');
    if (finding) lines.push('**Finding:** ' + finding);
    if (rec)     lines.push('**Recommendation:** ' + rec);
    lines.push('');
    lines.push('---');
    lines.push('');
    return lines;
  });

  const section = ['## ' + today, '', ...entryLines].join('\n');

  let existing = '';
  try { existing = fs.readFileSync(changelogPath, 'utf8'); } catch (e) { /* new file */ }

  let newContent;
  if (!existing) {
    newContent = '# Retrospective Actions Changelog\n\n' + section + '\n';
  } else if (existing.startsWith('# ')) {
    // Insert new date section right after the title heading
    const firstNewline = existing.indexOf('\n');
    newContent = existing.slice(0, firstNewline + 1) + '\n' + section + '\n' + existing.slice(firstNewline + 1).trimStart() + '\n';
  } else {
    newContent = section + '\n\n' + existing;
  }

  fs.writeFileSync(changelogPath, newContent, 'utf8');
  return changelogPath;
}

async function handleArchive(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return jsonResponse(res, 400, { error: 'Invalid JSON' });
  }
  const { file, lane, bulk } = body;
  if (!lane) {
    return jsonResponse(res, 400, { error: 'Missing lane' });
  }
  if (!bulk && !file) {
    return jsonResponse(res, 400, { error: 'Missing file or bulk flag' });
  }

  const laneDir = path.join(BOARD_DIR, lane);
  if (!laneDir.startsWith(BOARD_DIR)) {
    return jsonResponse(res, 400, { error: 'Invalid path' });
  }

  let files;
  if (bulk) {
    try {
      files = fs.readdirSync(laneDir).filter(f => f.endsWith('.md'));
    } catch (e) {
      return jsonResponse(res, 500, { error: e.message });
    }
  } else {
    files = [file];
  }

  if (files.length === 0) {
    return jsonResponse(res, 200, { success: true, archived: 0 });
  }

  const entries = [];
  const toDelete = [];
  for (const f of files) {
    const filePath = path.join(laneDir, f);
    if (!filePath.startsWith(BOARD_DIR)) continue;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const { fm, body: cardBody } = parseFrontmatter(raw);
      const { title, sections } = parseBody(cardBody);
      entries.push({ file: f, fm, title, sections });
      toDelete.push(filePath);
    } catch (e) {
      // Skip unreadable cards
    }
  }

  const changelogPath = writeChangelog(entries);
  for (const fp of toDelete) {
    try { fs.unlinkSync(fp); } catch (e) { /* ignore */ }
  }

  jsonResponse(res, 200, { success: true, archived: entries.length, changelogPath });
}

// ---------------------------------------------------------------------------
// HTML Page
// Note: The client-side JS in this page uses DOM methods (textContent,
// createElement, setAttribute) for all user-supplied data. The marked.parse()
// calls are intentional: section content is markdown authored by the user
// and displayed in a read-only preview — this is the explicit purpose of
// including marked.js. No user data is concatenated into innerHTML strings.
// ---------------------------------------------------------------------------

function buildHtml() {
  // CSS and JS are embedded inline (no external files required).
  // The HTML string itself contains no user data — it is a static template.
  const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: #e2e8f0;
  --text: #1e293b;
  --muted: #64748b;
  --radius: 8px;
  --shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06);
  --shadow-lg: 0 10px 25px rgba(0,0,0,0.1), 0 4px 10px rgba(0,0,0,0.06);
  interpolate-size: allow-keywords; /* Baseline 2025: enables height:auto transitions */
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

#header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  position: sticky;
  top: 0;
  z-index: 10;
  box-shadow: var(--shadow);

  h1 {
    font-size: 17px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

#header-spacer { flex: 1; }

/* :has() — Baseline 2023: hide filter when not a retro board (JS sets data-is-retro on body) */
#retro-filter {
  font-size: 13px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
body:not([data-is-retro]) #retro-filter { display: none; }

#card-count {
  font-size: 13px;
  color: var(--muted);
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 4px 10px;
  border-radius: 99px;
}

#board-container {
  flex: 1;
  overflow-x: auto;
  padding: 20px;
}

/* --lane-count set by JS via style.setProperty so CSS owns the layout declaration */
#board {
  display: grid;
  grid-template-columns: repeat(var(--lane-count, 4), minmax(280px, 1fr));
  gap: 16px;
  align-items: start;
  min-height: calc(100vh - 120px);
}

.lane {
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 200px;
  box-shadow: var(--shadow);
}

.lane-header {
  padding: 10px 14px;
  border-radius: var(--radius) var(--radius) 0 0;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;

  h2 {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  &[data-lane-index="0"] { background: #fef3c7; }
  &[data-lane-index="1"] { background: #dbeafe; }
  &[data-lane-index="2"] { background: #dcfce7; }
  &[data-lane-index="3"] { background: #f3e8ff; }
  &[data-lane-index="4"] { background: #fce7f3; }
  &[data-lane-index="5"] { background: #ecfdf5; }
  &[data-lane-index="6"] { background: #fffbeb; }
}

.lane-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  background: rgba(0,0,0,0.07);
  padding: 2px 7px;
  border-radius: 99px;
}

.lane-cards {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  max-height: calc(100vh - 180px);

  &::-webkit-scrollbar { width: 5px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 10px 12px;
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.1s;
  box-shadow: var(--shadow);

  &:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }

  &.done-card {
    opacity: 0.82;
    .card-actions { opacity: 0.6; }
  }
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 7px;
  border-radius: 99px;
  color: #fff;
  text-transform: uppercase;
  background: #9ca3af;

  &[data-category="IMPROVE"]    { background: #3b82f6; }
  &[data-category="WORKFLOW"]   { background: #8b5cf6; }
  &[data-category="FIX"]        { background: #ef4444; }
  &[data-category="FEATURE"]    { background: #10b981; }
  &[data-category="PROCESS"]    { background: #f59e0b; }
  &[data-category="KEEP-DOING"] { background: #14b8a6; }
  &[data-category="LEARN"]      { background: #6b7280; }
}

.priority-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #9ca3af;

  &[data-priority="critical"] { background: #dc2626; }
  &[data-priority="high"]     { background: #f97316; }
  &[data-priority="medium"],
  &[data-priority="normal"]   { background: #eab308; }
  &[data-priority="low"]      { background: #22c55e; }
}

.priority-label {
  font-size: 11px;
  color: var(--muted);
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 5px;
  text-wrap: balance; /* Baseline 2024: nicer multi-line title breaks */
}

.card-preview {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 8px;
}

.card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.card-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 3px 9px;
  font-size: 12px;
  cursor: pointer;
  color: var(--muted);
  transition: background 0.12s, color 0.12s, border-color 0.12s;

  &:hover:not(:disabled) {
    background: var(--bg);
    color: var(--text);
    border-color: #94a3b8;
  }
  &:disabled { opacity: 0.35; cursor: not-allowed; }
}

/* View Transitions — each card animates to its new lane position */
@keyframes vt-fade-in  { from { opacity: 0; transform: scale(0.97); } }
@keyframes vt-fade-out { to   { opacity: 0; transform: scale(0.97); } }
::view-transition-old(root),
::view-transition-new(root) { animation: none; }

#move-to-select {
  font-size: 13px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  min-width: 140px;
  font-family: inherit;
  transition: border-color 0.12s;

  &:focus {
    outline: none;
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.12);
  }
}

.btn-close {
  color: #0d9488;
  border-color: #99f6e4;

  &:hover:not(:disabled) {
    background: #f0fdf9;
    color: #0f766e;
    border-color: #5eead4;
  }
}

.lane-close-all {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid #99f6e4;
  background: #f0fdf9;
  color: #0d9488;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  white-space: nowrap;
  margin-left: 6px;

  &:hover { background: #ccfbf1; border-color: #5eead4; }
}

#close-btn {
  font-size: 13px;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 6px;
  border: none;
  background: #ccfbf1;
  color: #0f766e;
  cursor: pointer;
  transition: background 0.12s;
  display: none;

  &:hover { background: #99f6e4; }
}

#modal {
  border: none;
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  background: var(--surface);
  width: calc(100vw - 40px);
  max-width: 720px;
  max-height: 90vh;
  padding: 0;
  overflow: hidden;
  opacity: 1;
  transform: translateY(0);
  transition: opacity 0.2s, transform 0.2s,
              display  0.2s allow-discrete,
              overlay  0.2s allow-discrete;

  &[open] { display: flex; flex-direction: column; }
  @starting-style { &[open] { opacity: 0; transform: translateY(12px); } }

  &[data-lane$="done"] #close-btn { display: inline-block; }

  &::backdrop {
    background: rgba(15,23,42,0.55);
    backdrop-filter: blur(2px);
    transition: background 0.2s, backdrop-filter 0.2s,
                display 0.2s allow-discrete,
                overlay 0.2s allow-discrete;
  }
  @starting-style { &::backdrop { background: transparent; backdrop-filter: blur(0); } }
}

#modal-header {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg);
}

#modal-file {
  font-size: 12px;
  color: var(--muted);
  font-family: monospace;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#modal-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--muted);
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
  transition: color 0.1s;

  &:hover { color: var(--text); }
}

#modal-body {
  overflow-y: auto;
  flex: 1;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;

  &::-webkit-scrollbar { width: 5px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;

  label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  input, select, textarea {
    font-size: 14px;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: inherit;
    color: var(--text);
    background: var(--surface);
    transition: border-color 0.12s, box-shadow 0.12s;
    width: 100%;

    &:focus {
      outline: none;
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99,102,241,0.12);
    }
  }
}

.fm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.section-heading-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
  background: var(--bg);
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
}

.section-block {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;

  textarea {
    border: none;
    border-radius: 0;
    padding: 10px 12px;
    min-height: 90px;
    field-sizing: content;
    resize: vertical;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 12px;
    background: var(--surface);
    width: 100%;
    display: block;
    color: var(--text);

    &:focus {
      outline: none;
      box-shadow: 0 0 0 2px #6366f1 inset;
    }
  }
}

.section-preview {
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  font-size: 13px;
  line-height: 1.6;
  background: #fafbfc;
  min-height: 40px;

  p { margin: 0 0 8px; }
  p:last-child { margin-bottom: 0; }
  ul, ol { padding-left: 20px; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 11.5px; }
  pre {
    background: #f1f5f9;
    padding: 10px 12px;
    border-radius: 5px;
    overflow-x: auto;
    font-size: 12px;
    code { background: none; padding: 0; }
  }
  h1, h2, h3 { margin: 10px 0 6px; font-size: 14px; }
  a { color: #6366f1; }
}

.comment-heading-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
  background: var(--bg);
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
}

.comment-block {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;

  textarea {
    width: 100%;
    border: none;
    border-radius: 0;
    padding: 10px 12px;
    font-family: inherit;
    font-size: 13px;
    min-height: 70px;
    resize: vertical;
    color: var(--text);
    background: var(--surface);
    display: block;

    &:focus {
      outline: none;
      box-shadow: 0 0 0 2px #6366f1 inset;
    }
  }
}

.comment-submit {
  display: block;
  width: 100%;
  padding: 8px;
  background: #f1f5f9;
  border: none;
  border-top: 1px solid var(--border);
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  transition: background 0.12s;

  &:hover { background: #e2e8f0; }
}

#modal-footer {
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg);
  flex-wrap: wrap;
}

.modal-lane-btn {
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  transition: background 0.12s;
  font-weight: 500;

  &:hover:not(:disabled) { background: #f1f5f9; }
  &:disabled { opacity: 0.35; cursor: not-allowed; }
}

#modal-footer-spacer { flex: 1; }

#save-btn {
  font-size: 13px;
  font-weight: 600;
  padding: 7px 18px;
  border-radius: 6px;
  border: none;
  background: #6366f1;
  color: #fff;
  cursor: pointer;
  transition: background 0.12s;

  &:hover { background: #4f46e5; }
}

#delete-btn {
  font-size: 13px;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 6px;
  border: none;
  background: #fee2e2;
  color: #b91c1c;
  cursor: pointer;
  transition: background 0.12s;

  &:hover { background: #fecaca; }
}

#toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  translate: -50% 0;
  margin: 0;
  border: none;
  background: #1e293b;
  color: #fff;
  font-size: 13px;
  padding: 9px 18px;
  border-radius: 8px;
  box-shadow: var(--shadow-md);
  pointer-events: none;
  transition: opacity 0.2s, translate 0.2s,
              display 0.2s allow-discrete,
              overlay 0.2s allow-discrete;

  &:popover-open { opacity: 1; translate: -50% 0; }
  @starting-style { &:popover-open { opacity: 0; translate: -50% 20px; } }
}

.lane-empty {
  font-size: 12px;
  color: var(--muted);
  text-align: center;
  padding: 24px 10px;
}
`;

  const JS = `
(function () {
  'use strict';

  // ── Color config ─────────────────────────────────────────────────────────

  // ── Safe DOM helpers ─────────────────────────────────────────────────────
  // All user-controlled strings are set via textContent or value,
  // never concatenated into innerHTML. The only innerHTML assignments are
  // for the marked.js preview (explicit feature) and static structural HTML.

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'class') e.className = v;
        else if (k === 'style') e.style.cssText = v;
        else e.setAttribute(k, v);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(c => {
        if (c == null) return;
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else e.appendChild(c);
      });
    }
    return e;
  }

  function txt(str) {
    return document.createTextNode(String(str == null ? '' : str));
  }

  function toast(msg, duration) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.showPopover();
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.hidePopover(), duration || 2500);
  }

  function cardPreviewText(card) {
    for (const s of card.sections || []) {
      const text = (s.content || '').replace(/[#*\`_\\[\\]]/g, '').trim();
      if (text) return text.slice(0, 80);
    }
    return '';
  }

  function formatRetroDate(d) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[parseInt(d.slice(4,6),10)-1] + ' ' + parseInt(d.slice(6,8),10) + ', ' + d.slice(0,4);
  }

  // ── State ────────────────────────────────────────────────────────────────

  let boardData = null;
  let selectedRetroDate = 'all';
  let currentCard = null;

  // ── Data fetch ───────────────────────────────────────────────────────────

  async function fetchData() {
    const res = await fetch('/data');
    boardData = await res.json();
  }

  // ── Filter ───────────────────────────────────────────────────────────────

  function filteredCards(lane) {
    if (selectedRetroDate === 'all') return lane.cards;
    const dateStr = selectedRetroDate;
    return lane.cards.filter(c => {
      const m = c.file.match(/^retro-(\\d{8})/);
      return !m || m[1] === dateStr;
    });
  }

  function totalVisible() {
    if (!boardData) return 0;
    return boardData.lanes.reduce((n, l) => n + filteredCards(l).length, 0);
  }

  // ── Board render ─────────────────────────────────────────────────────────

  function renderBoard() {
    const board = document.getElementById('board');
    const lanes = boardData.lanes;
    board.style.setProperty('--lane-count', lanes.length);

    // Clear existing content safely
    while (board.firstChild) board.removeChild(board.firstChild);

    lanes.forEach((lane, laneIdx) => {
      const cards = filteredCards(lane);


      const laneEl = el('div', { class: 'lane', 'data-lane-id': lane.id });

      // Lane header
      const header = el('div', {
        class: 'lane-header',
        'data-lane-index': String(laneIdx % 7),
      });
      const h2 = el('h2');
      h2.textContent = lane.displayName;
      const countBadge = el('span', { class: 'lane-count' });
      countBadge.textContent = String(cards.length);
      header.appendChild(h2);
      header.appendChild(countBadge);
      if (isDoneLane(lane.id) && cards.length > 0) {
        const closeAllBtn = el('button', {
          class: 'lane-close-all',
          title: 'Write all done cards to CHANGELOG.md and remove',
        });
        closeAllBtn.textContent = 'Close All';
        closeAllBtn.addEventListener('click', e => { e.stopPropagation(); archiveAll(lane.id, cards.length); });
        header.appendChild(closeAllBtn);
      }
      laneEl.appendChild(header);

      const cardsEl = el('div', { class: 'lane-cards', role: 'list' });

      if (cards.length === 0) {
        const empty = el('div', { class: 'lane-empty' });
        empty.textContent = 'No cards';
        cardsEl.appendChild(empty);
      } else {
        cards.forEach(card => {
          cardsEl.appendChild(buildCard(card, laneIdx));
        });
      }

      laneEl.appendChild(cardsEl);
      board.appendChild(laneEl);
    });

    const countEl = document.getElementById('card-count');
    countEl.textContent = totalVisible() + ' cards';
  }

  function buildCard(card, laneIdx) {
    const cardEl = el('div', {
      class: 'card' + (isDoneLane(card.lane) ? ' done-card' : ''),
      'data-file': card.file,
      'data-lane': card.lane,
      role: 'listitem',
      tabindex: '0',
    });
    cardEl.setAttribute('aria-label', card.title || card.file);
    // Unique view-transition-name lets the browser animate the card to its new lane
    cardEl.style.viewTransitionName = 'card-' + card.file.replace(/[^a-zA-Z0-9]/g, '-');

    // Meta row
    const meta = el('div', { class: 'card-meta' });
    const cat = card.fm && card.fm.category ? card.fm.category.toUpperCase() : '';
    const pri = card.fm && card.fm.priority ? card.fm.priority : '';

    if (cat) {
      const badge = el('span', { class: 'badge', 'data-category': cat });
      badge.textContent = cat;
      meta.appendChild(badge);
    }
    if (pri) {
      const dot = el('span', {
        class: 'priority-dot',
        'data-priority': pri.toLowerCase(),
        title: pri,
      });
      const priLabel = el('span', { class: 'priority-label' });
      priLabel.textContent = pri;
      meta.appendChild(dot);
      meta.appendChild(priLabel);
    }
    cardEl.appendChild(meta);

    // Title
    const titleEl = el('div', { class: 'card-title' });
    titleEl.textContent = card.title || card.file;
    cardEl.appendChild(titleEl);

    // Preview
    const preview = cardPreviewText(card);
    if (preview) {
      const previewEl = el('div', { class: 'card-preview' });
      previewEl.textContent = preview;
      cardEl.appendChild(previewEl);
    }

    // Actions
    const actions = el('div', { class: 'card-actions' });

    const editBtn = el('button', {
      class: 'card-btn btn-edit',
      'aria-label': 'Edit card',
      title: 'Edit card',
    });
    editBtn.textContent = '\u270e';

    if (isDoneLane(card.lane)) {
      const closeBtn = el('button', {
        class: 'card-btn btn-close',
        'aria-label': 'Close card to changelog',
        title: 'Write to CHANGELOG.md and close',
      });
      closeBtn.textContent = '\u2713';
      actions.appendChild(closeBtn);
      actions.appendChild(editBtn);
      closeBtn.addEventListener('click', e => { e.stopPropagation(); archiveCard(card); });
    } else {
      const advBtn = el('button', {
        class: 'card-btn btn-advance',
        'aria-label': 'Advance to next lane',
        title: 'Advance to next lane',
      });
      advBtn.textContent = '\u2192';
      actions.appendChild(advBtn);
      actions.appendChild(editBtn);
      advBtn.addEventListener('click', e => { e.stopPropagation(); advanceCard(card, laneIdx); });
    }

    cardEl.appendChild(actions);

    // Events
    cardEl.addEventListener('click', e => {
      if (!e.target.classList.contains('card-btn')) openModal(card, laneIdx);
    });
    cardEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(card, laneIdx); }
    });
    editBtn.addEventListener('click', e => { e.stopPropagation(); openModal(card, laneIdx); });

    return cardEl;
  }

  // ── Advance card ─────────────────────────────────────────────────────────

  async function advanceCard(card, laneIdx) {
    const lanes = boardData.lanes;
    if (laneIdx >= lanes.length - 1) return;
    const toLane = lanes[laneIdx + 1].id;
    try {
      const res = await fetch('/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: card.file, fromLane: card.lane, toLane }),
      });
      const data = await res.json();
      if (data.success) {
        toast('Moved to ' + lanes[laneIdx + 1].displayName);
        await refreshWithTransition();
      } else {
        toast('Error: ' + String(data.error || 'unknown'));
      }
    } catch (e) {
      toast('Network error');
    }
  }

  // ── Done-lane detection ───────────────────────────────────────────────────

  function isDoneLane(laneId) {
    return /done$/i.test(laneId);
  }

  // ── Archive (close → changelog) ───────────────────────────────────────────

  async function archiveViaApi(payload, confirmMsg, successMsg) {
    if (!confirm(confirmMsg)) return;
    try {
      const res = await fetch('/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast(typeof successMsg === 'function' ? successMsg(data) : successMsg);
        await refreshWithTransition();
      } else {
        toast('Error: ' + String(data.error || 'unknown'));
      }
    } catch (e) { toast('Network error'); }
  }

  function archiveCard(card) {
    const label = card.title || card.file;
    return archiveViaApi(
      { file: card.file, lane: card.lane },
      'Close "' + label + '"?\\n\\nThis writes the card to CHANGELOG.md and removes it from the board.',
      'Closed \u2192 CHANGELOG.md'
    );
  }

  function archiveAll(laneId, count) {
    return archiveViaApi(
      { lane: laneId, bulk: true },
      'Close all ' + count + ' card' + (count === 1 ? '' : 's') + ' in Done?\\n\\nThis writes all cards to CHANGELOG.md and removes them from the board.',
      data => 'Closed ' + data.archived + ' card' + (data.archived === 1 ? '' : 's') + ' \u2192 CHANGELOG.md'
    );
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  async function refreshBoard() {
    await fetchData();
    updateRetroFilter();
    renderBoard();
  }

  async function refreshWithTransition() {
    if (document.startViewTransition) {
      await document.startViewTransition(async () => { await refreshBoard(); }).finished;
    } else {
      await refreshBoard();
    }
  }

  // ── Retro filter ──────────────────────────────────────────────────────────

  function updateRetroFilter() {
    const sel = document.getElementById('retro-filter');
    if (!boardData || !boardData.retroDates) {
      document.body.removeAttribute('data-is-retro');
      return;
    }
    document.body.dataset.isRetro = '';
    const prev = sel.value;
    while (sel.firstChild) sel.removeChild(sel.firstChild);

    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All retros';
    sel.appendChild(allOpt);

    (boardData.retroDates || []).forEach(d => {
      const count = boardData.lanes.reduce((n, l) => {
        return n + l.cards.filter(c => c.file.startsWith('retro-' + d)).length;
      }, 0);
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = formatRetroDate(d) + ' (' + count + ' cards)';
      sel.appendChild(opt);
    });

    if (prev && Array.from(sel.options).some(o => o.value === prev)) {
      sel.value = prev;
      selectedRetroDate = prev;
    } else {
      selectedRetroDate = 'all';
    }
  }

  document.getElementById('retro-filter').addEventListener('change', function () {
    selectedRetroDate = this.value;
    renderBoard();
  });

  // ── Modal ─────────────────────────────────────────────────────────────────

  const FM_SELECT_FIELDS = {
    priority: ['Critical', 'High', 'Normal', 'Low'],
    category: ['IMPROVE', 'WORKFLOW', 'FIX', 'FEATURE', 'PROCESS', 'KEEP-DOING', 'LEARN'],
    effort: ['S', 'M', 'L'],
  };

  function openModal(card, laneIdx) {
    currentCard = { card, laneIdx };
    const modal = document.getElementById('modal');
    modal.dataset.lane = card.lane;
    populateModal(card, laneIdx);
    modal.showModal();
    document.getElementById('modal-close').focus();
  }

  function closeModal() {
    document.getElementById('modal').close();
  }

  function populateModal(card, laneIdx) {
    // File path display (textContent only)
    document.getElementById('modal-file').textContent = card.lane + '/' + card.file;

    // Populate "Move to…" select with all lanes except the current one
    const lanes = boardData.lanes;
    const moveSel = document.getElementById('move-to-select');
    while (moveSel.firstChild) moveSel.removeChild(moveSel.firstChild);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Move to\u2026';
    moveSel.appendChild(placeholder);
    lanes.forEach((lane, i) => {
      if (i === laneIdx) return;
      const opt = document.createElement('option');
      opt.value = lane.id;
      opt.textContent = lane.displayName;
      moveSel.appendChild(opt);
    });

    // Clear body
    const body = document.getElementById('modal-body');
    while (body.firstChild) body.removeChild(body.firstChild);

    // Title field
    const titleGroup = el('div', { class: 'field-group' });
    const titleLabel = el('label', { for: 'edit-title' });
    titleLabel.textContent = 'Title';
    const titleInput = el('input', { type: 'text', id: 'edit-title' });
    titleInput.value = card.title || '';
    titleGroup.appendChild(titleLabel);
    titleGroup.appendChild(titleInput);
    body.appendChild(titleGroup);

    // Frontmatter fields
    const fm = card.fm || {};
    const fmKeys = Object.keys(fm);
    if (fmKeys.length > 0) {
      const fmGrid = el('div', { class: 'fm-grid' });
      fmKeys.forEach(key => {
        const val = fm[key] || '';
        const group = el('div', { class: 'field-group' });
        const label = el('label', { for: 'fm-' + key });
        label.textContent = key;
        group.appendChild(label);

        const opts = FM_SELECT_FIELDS[key.toLowerCase()];
        if (opts) {
          const sel = el('select', { id: 'fm-' + key });
          sel.dataset.fmKey = key;
          let matched = false;
          opts.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o;
            opt.textContent = o;
            if (o.toLowerCase() === val.toLowerCase()) { opt.selected = true; matched = true; }
            sel.appendChild(opt);
          });
          if (!matched && val) {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            opt.selected = true;
            sel.insertBefore(opt, sel.firstChild);
          }
          group.appendChild(sel);
        } else {
          const input = el('input', { type: 'text', id: 'fm-' + key });
          input.dataset.fmKey = key;
          input.value = val;
          group.appendChild(input);
        }
        fmGrid.appendChild(group);
      });
      body.appendChild(fmGrid);
    }

    // Body sections
    (card.sections || []).forEach((section, i) => {
      const block = el('div', { class: 'section-block' });

      const headingLabel = el('div', { class: 'section-heading-label' });
      headingLabel.textContent = section.heading;
      block.appendChild(headingLabel);

      const ta = el('textarea');
      ta.dataset.sectionIdx = String(i);
      ta.dataset.sectionHeading = section.heading;
      ta.value = section.content;
      block.appendChild(ta);

      // marked.js preview — intentional HTML rendering of user-authored markdown
      const preview = el('div', { class: 'section-preview' });
      function updatePreview() {
        // marked.parse() returns trusted HTML from user-authored markdown
        // This is the explicit purpose of the section preview feature.
        try { preview.innerHTML = marked.parse(ta.value || ''); }
        catch(err) { preview.textContent = ta.value; }
      }
      updatePreview();
      ta.addEventListener('input', updatePreview);
      block.appendChild(preview);

      body.appendChild(block);
    });

    // Comment block
    const commentBlock = el('div', { class: 'comment-block' });
    const commentLabel = el('div', { class: 'comment-heading-label' });
    commentLabel.textContent = 'Add Comment';
    commentBlock.appendChild(commentLabel);

    const commentTA = el('textarea', { id: 'comment-text', placeholder: 'Add a comment...' });
    commentBlock.appendChild(commentTA);

    const commentSubmit = el('button', { class: 'comment-submit', id: 'comment-submit-btn' });
    commentSubmit.textContent = 'Add Comment';
    commentBlock.appendChild(commentSubmit);
    body.appendChild(commentBlock);

    commentSubmit.addEventListener('click', async () => {
      const text = commentTA.value.trim();
      if (!text) return;
      try {
        const res = await fetch('/comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: card.file, lane: card.lane, comment: text }),
        });
        const data = await res.json();
        if (data.success) {
          commentTA.value = '';
          toast('Comment added');
          await refreshBoard();
          // Re-find card after refresh and update modal
          if (currentCard) {
            const lane = boardData.lanes.find(l => l.id === card.lane);
            if (lane) {
              const updated = lane.cards.find(c => c.file === card.file);
              if (updated) { currentCard.card = updated; populateModal(updated, currentCard.laneIdx); }
            }
          }
        } else {
          toast('Error: ' + String(data.error || 'unknown'));
        }
      } catch (e) { toast('Network error'); }
    });
  }

  function collectModalEdits() {
    const titleInput = document.getElementById('edit-title');
    const title = titleInput ? titleInput.value : '';

    const fm = {};
    document.querySelectorAll('[data-fm-key]').forEach(e => { fm[e.dataset.fmKey] = e.value; });

    const sections = [];
    document.querySelectorAll('[data-section-idx]').forEach(ta => {
      sections.push({ heading: ta.dataset.sectionHeading, content: ta.value });
    });

    return { title, fm, sections };
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  document.getElementById('save-btn').addEventListener('click', async () => {
    if (!currentCard) return;
    const { card } = currentCard;
    const { title, fm, sections } = collectModalEdits();
    try {
      const res = await fetch('/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: card.file, lane: card.lane, title, fm, sections }),
      });
      const data = await res.json();
      if (data.success) { toast('Saved'); closeModal(); await refreshBoard(); }
      else toast('Error: ' + String(data.error || 'unknown'));
    } catch (e) { toast('Network error'); }
  });

  // ── Close → Changelog ─────────────────────────────────────────────────────

  document.getElementById('close-btn').addEventListener('click', async () => {
    if (!currentCard) return;
    const { card } = currentCard;
    const label = card.title || card.file;
    if (!confirm('Close "' + label + '"?\\n\\nThis writes the card to CHANGELOG.md and removes it from the board.')) return;
    try {
      const res = await fetch('/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: card.file, lane: card.lane }),
      });
      const data = await res.json();
      if (data.success) { toast('Closed \u2192 CHANGELOG.md'); closeModal(); await refreshBoard(); }
      else toast('Error: ' + String(data.error || 'unknown'));
    } catch (e) { toast('Network error'); }
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  document.getElementById('delete-btn').addEventListener('click', async () => {
    if (!currentCard) return;
    const { card } = currentCard;
    if (!confirm('Delete ' + card.file + '? This cannot be undone.')) return;
    try {
      const res = await fetch('/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: card.file, lane: card.lane }),
      });
      const data = await res.json();
      if (data.success) { toast('Deleted'); closeModal(); await refreshBoard(); }
      else toast('Error: ' + String(data.error || 'unknown'));
    } catch (e) { toast('Network error'); }
  });

  // ── Modal lane move ───────────────────────────────────────────────────────

  async function moveCardFromModal(card, toLane) {
    try {
      const res = await fetch('/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: card.file, fromLane: card.lane, toLane }),
      });
      const data = await res.json();
      if (!data.success) { toast('Error: ' + String(data.error || 'unknown')); return; }
      const lane = boardData.lanes.find(l => l.id === toLane);
      toast('Moved to ' + (lane ? lane.displayName : toLane));
      closeModal();
      await refreshWithTransition();
    } catch (e) { toast('Network error'); }
  }

  document.getElementById('move-to-select').addEventListener('change', function () {
    if (!currentCard || !this.value) return;
    const toLane = this.value;
    this.value = '';
    moveCardFromModal(currentCard.card, toLane);
  });

  // ── Close modal ───────────────────────────────────────────────────────────
  // <dialog> handles: Escape key, focus trap, aria-modal, ::backdrop

  document.getElementById('modal-close').addEventListener('click', closeModal);

  // Close on backdrop click (click lands on the <dialog> element itself, not its children)
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target === document.getElementById('modal')) closeModal();
  });

  // Clean up state whenever the dialog closes (covers Escape key too)
  document.getElementById('modal').addEventListener('close', () => {
    currentCard = null;
  });

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    await fetchData();
    document.getElementById('board-title').textContent = boardData.boardName;
    document.title = boardData.boardName + ' \u2014 Kanban';
    updateRetroFilter();
    renderBoard();
  }

  init().catch(err => {
    const board = document.getElementById('board');
    const msg = el('p', { style: 'color:red;padding:20px' });
    msg.textContent = 'Failed to load board: ' + String(err);
    board.appendChild(msg);
  });

})();
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kanban Board</title>
<script src="/marked.js"><\/script>
<style>${CSS}</style>
</head>
<body>

<div id="header">
  <h1>&#128193; <span id="board-title"></span></h1>
  <div id="header-spacer"></div>
  <select id="retro-filter" style="display:none" aria-label="Filter by retro date"></select>
  <span id="card-count"></span>
</div>

<div id="board-container">
  <div id="board" role="main" aria-label="Kanban board"></div>
</div>

<dialog id="modal" aria-labelledby="modal-file">
  <div id="modal-header">
    <span id="modal-file"></span>
    <button id="modal-close" aria-label="Close modal">&times;</button>
  </div>
  <div id="modal-body" tabindex="-1"></div>
  <div id="modal-footer">
    <select id="move-to-select" aria-label="Move card to lane"><option value="">Move to\u2026</option></select>
    <div id="modal-footer-spacer"></div>
    <button id="close-btn">&#10003; Close &#8594; Changelog</button>
    <button id="delete-btn">Delete</button>
    <button id="save-btn">Save Changes</button>
  </div>
</dialog>

<div id="toast" popover="manual" role="status" aria-live="polite"></div>

<script>${JS}<\/script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  // Use WHATWG URL API (no deprecated url.parse)
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;

  if (req.method === 'GET' && pathname === '/') {
    const html = buildHtml();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(html);
    return;
  }

  if (req.method === 'GET' && pathname === '/marked.js') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'max-age=86400',
    });
    res.end(MARKED_JS);
    return;
  }

  if (req.method === 'GET' && pathname === '/data') {
    handleData(res);
    return;
  }

  if (req.method === 'POST' && pathname === '/move') {
    await handleMove(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/edit') {
    await handleEdit(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/comment') {
    await handleComment(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/delete') {
    await handleDelete(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/archive') {
    await handleArchive(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

if (!fs.existsSync(BOARD_DIR)) {
  console.error('Error: board directory does not exist: ' + BOARD_DIR);
  process.exit(1);
}

const startupLanes = discoverLanes();
const startupData = readBoardData(startupLanes);
const totalCards = startupData.lanes.reduce((n, l) => n + l.cards.length, 0);

server.listen(PORT, '127.0.0.1', () => {
  const arrow = '\u2192';
  console.log('');
  console.log('\uD83D\uDDC2  Kanban board ready');
  console.log('    http://localhost:' + PORT);
  console.log('');
  console.log('Board: ' + BOARD_NAME);
  console.log('Lanes: ' + startupLanes.join(' ' + arrow + ' '));
  console.log('Cards: ' + totalCards + ' total');
  console.log('');
  console.log('Press Ctrl+C to stop.');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error('Error: port ' + PORT + ' is already in use. Try --port <other>');
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
