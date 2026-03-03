#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let filePath = './.brainstorm.json';
let port = 3747;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) filePath = args[++i];
  if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
}

const resolvedFile = path.resolve(filePath);

// ---------------------------------------------------------------------------
// Verify file exists and is readable/writable
// ---------------------------------------------------------------------------
if (!fs.existsSync(resolvedFile)) {
  console.error(`Error: File not found: ${resolvedFile}`);
  process.exit(1);
}

try {
  fs.accessSync(resolvedFile, fs.constants.R_OK | fs.constants.W_OK);
} catch (e) {
  console.error(`Error: Cannot read/write file: ${resolvedFile}`);
  process.exit(1);
}

try {
  JSON.parse(fs.readFileSync(resolvedFile, 'utf8'));
} catch (e) {
  console.error(`Error: Invalid JSON in file: ${resolvedFile}\n${e.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Open browser (cross-platform, no shell injection)
// ---------------------------------------------------------------------------
function openBrowser(url) {
  const platform = process.platform;
  let cmd, args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  execFile(cmd, args, (err) => {
    if (err) {
      console.log(`(Could not auto-open browser. Visit ${url} manually.)`);
    }
  });
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ---------------------------------------------------------------------------
// HTML template generator
// ---------------------------------------------------------------------------
function buildHtml(data) {
  const { session, ideas, annotations: savedAnnotations } = data;
  const ideaIds = (ideas || []).map(i => i.id);
  const annotationsJson = JSON.stringify(savedAnnotations || {});
  const dataJson = JSON.stringify(data);

  const ideaCardsHtml = (ideas || []).map((idea) => {
    const badge = escapeHtml(idea.id);
    const title = escapeHtml(idea.title);
    const description = escapeHtml(idea.description);

    const prosHtml = (idea.pros || []).map(p =>
      `<li>${escapeHtml(p)}</li>`
    ).join('');

    const consHtml = (idea.cons || []).map(c =>
      `<li>${escapeHtml(c)}</li>`
    ).join('');

    const risksHtml = (idea.risks || []).map(r =>
      `<li>${escapeHtml(r)}</li>`
    ).join('');

    const combineSection = ideaIds.length >= 2 ? `
      <div class="combine-section">
        <div class="combine-label">Combine with:</div>
        <div class="combine-checkboxes">
          ${ideaIds.filter(id => id !== idea.id).map(id =>
            `<label class="combine-check">
              <input type="checkbox" data-idea="${escapeHtml(idea.id)}" data-target="${escapeHtml(id)}" onchange="onCombineChange('${escapeHtml(idea.id)}', '${escapeHtml(id)}', this.checked)">
              <span>${escapeHtml(id)}</span>
            </label>`
          ).join('')}
        </div>
      </div>` : '';

    return `
      <div class="card" id="card-${badge}" data-id="${badge}">
        <div class="card-header">
          <div class="badge" id="badge-${badge}">${badge}</div>
          <h2 class="card-title">${title}</h2>
        </div>
        <p class="card-description">${description}</p>

        ${prosHtml ? `
        <div class="collapsible open" id="pros-section-${badge}">
          <button class="collapsible-toggle" onclick="toggleSection('pros-section-${badge}')">
            <span class="toggle-icon">&#9662;</span>
            <span class="section-icon pros-icon">&#10003;</span> Pros
          </button>
          <div class="collapsible-body">
            <ul class="bullet-list pros-list">${prosHtml}</ul>
          </div>
        </div>` : ''}

        ${consHtml ? `
        <div class="collapsible open" id="cons-section-${badge}">
          <button class="collapsible-toggle" onclick="toggleSection('cons-section-${badge}')">
            <span class="toggle-icon">&#9662;</span>
            <span class="section-icon cons-icon">&#10007;</span> Cons
          </button>
          <div class="collapsible-body">
            <ul class="bullet-list cons-list">${consHtml}</ul>
          </div>
        </div>` : ''}

        ${risksHtml ? `
        <div class="collapsible open" id="risks-section-${badge}">
          <button class="collapsible-toggle" onclick="toggleSection('risks-section-${badge}')">
            <span class="toggle-icon">&#9662;</span>
            <span class="section-icon risks-icon">&#9888;</span> Risks
          </button>
          <div class="collapsible-body">
            <ul class="bullet-list risks-list">${risksHtml}</ul>
          </div>
        </div>` : ''}

        <div class="rating-group">
          <button class="rating-btn strong-btn" id="btn-strong-${badge}" onclick="setRating('${badge}', 'strong')">Strong &#10003;</button>
          <button class="rating-btn consider-btn" id="btn-consider-${badge}" onclick="setRating('${badge}', 'consider')">Consider</button>
          <button class="rating-btn skip-btn" id="btn-skip-${badge}" onclick="setRating('${badge}', 'skip')">Skip &#10007;</button>
        </div>

        ${combineSection}

        <div class="notes-section">
          <textarea
            class="notes-textarea"
            id="notes-${badge}"
            placeholder="What do you like? What would you change?"
            oninput="onNotesChange('${badge}', this.value)"
          ></textarea>
        </div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Brainstorm Canvas</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --strong-color: #059669;
      --strong-bg: #ecfdf5;
      --strong-border: #a7f3d0;
      --consider-color: #d97706;
      --consider-bg: #fffbeb;
      --consider-border: #fcd34d;
      --skip-color: #dc2626;
      --skip-bg: #fef2f2;
      --skip-border: #fca5a5;
      --default-border: #e5e7eb;
      --indigo: #4f46e5;
      --indigo-hover: #4338ca;
      --body-bg: #f5f4f2;
      --card-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--body-bg);
      color: #111827;
      min-height: 100vh;
      padding-bottom: 60px;
    }

    /* ---- Header ---- */
    .header {
      background: white;
      border-bottom: 1px solid var(--default-border);
      padding: 20px 32px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }

    .header-inner {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .header-left {
      flex: 1;
      min-width: 0;
    }

    .header-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 20px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 4px;
    }

    .header-topic {
      font-size: 15px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 4px;
    }

    .header-context {
      font-size: 13px;
      color: #9ca3af;
      line-height: 1.5;
    }

    .progress-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      color: #6b7280;
      background: #f3f4f6;
      border: 1px solid var(--default-border);
      border-radius: 20px;
      padding: 6px 14px;
      white-space: nowrap;
      transition: all 0.3s;
      flex-shrink: 0;
    }

    .progress-badge.complete {
      color: var(--strong-color);
      background: var(--strong-bg);
      border-color: var(--strong-border);
    }

    /* ---- Main content ---- */
    .main {
      max-width: 1200px;
      margin: 32px auto;
      padding: 0 32px;
    }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 24px;
    }

    /* ---- Cards ---- */
    .card {
      background: white;
      border-radius: 12px;
      box-shadow: var(--card-shadow);
      padding: 24px;
      border-left: 3px solid var(--default-border);
      transition: all 0.2s;
    }

    .card.rated-strong {
      border-left-color: var(--strong-color);
      background: linear-gradient(to right, var(--strong-bg) 0%, white 60px);
    }

    .card.rated-consider {
      border-left-color: var(--consider-color);
      background: linear-gradient(to right, var(--consider-bg) 0%, white 60px);
    }

    .card.rated-skip {
      border-left-color: var(--skip-color);
      background: linear-gradient(to right, var(--skip-bg) 0%, white 60px);
      opacity: 0.6;
      filter: saturate(0.5);
    }

    .card.rated-skip:hover {
      opacity: 0.8;
      filter: saturate(0.7);
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
    }

    .badge {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #e5e7eb;
      color: #374151;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      font-weight: 700;
      transition: all 0.2s;
    }

    .card.rated-strong .badge { background: var(--strong-color); color: white; }
    .card.rated-consider .badge { background: var(--consider-color); color: white; }
    .card.rated-skip .badge { background: var(--skip-color); color: white; }

    .card-title {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
      line-height: 1.4;
      padding-top: 4px;
    }

    .card-description {
      font-size: 14px;
      line-height: 1.7;
      color: #4b5563;
      margin-top: 8px;
      margin-bottom: 16px;
    }

    /* ---- Collapsible sections ---- */
    .collapsible {
      margin-bottom: 10px;
      border-radius: 8px;
      overflow: hidden;
    }

    .collapsible-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      background: #f9fafb;
      border: 1px solid #f3f4f6;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: #374151;
      text-align: left;
      transition: background 0.15s;
    }

    .collapsible-toggle:hover { background: #f3f4f6; }

    .toggle-icon {
      font-size: 12px;
      transition: transform 0.2s;
      color: #9ca3af;
      display: inline-block;
    }

    .collapsible:not(.open) .toggle-icon {
      transform: rotate(-90deg);
    }

    .collapsible-body {
      overflow: hidden;
      max-height: 600px;
      transition: max-height 0.25s ease;
    }

    .collapsible:not(.open) .collapsible-body {
      max-height: 0;
    }

    .section-icon { font-size: 13px; }
    .pros-icon { color: var(--strong-color); }
    .cons-icon { color: var(--skip-color); }
    .risks-icon { color: var(--consider-color); }

    .bullet-list {
      list-style: none;
      padding: 8px 10px 10px 10px;
    }

    .bullet-list li {
      font-size: 13px;
      line-height: 1.6;
      color: #374151;
      padding: 2px 0 2px 16px;
      position: relative;
    }

    .bullet-list li::before {
      content: '\\2022';
      position: absolute;
      left: 4px;
    }

    .pros-list { background: #f0fdf4; border-radius: 0 0 8px 8px; }
    .pros-list li::before { color: var(--strong-color); }

    .cons-list { background: #fef2f2; border-radius: 0 0 8px 8px; }
    .cons-list li::before { color: var(--skip-color); }

    .risks-list { background: #fffbeb; border-radius: 0 0 8px 8px; }
    .risks-list li::before { color: var(--consider-color); }

    /* ---- Rating buttons ---- */
    .rating-group {
      display: flex;
      gap: 8px;
      margin-top: 18px;
    }

    .rating-btn {
      flex: 1;
      padding: 8px 6px;
      border-radius: 8px;
      border: 2px solid var(--default-border);
      background: white;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      color: #6b7280;
      white-space: nowrap;
    }

    .rating-btn:hover { border-color: #9ca3af; color: #374151; }

    .rating-btn.strong-btn.active {
      background: var(--strong-color);
      border-color: var(--strong-color);
      color: white;
    }
    .rating-btn.strong-btn:not(.active):hover {
      border-color: var(--strong-border);
      color: var(--strong-color);
      background: var(--strong-bg);
    }

    .rating-btn.consider-btn.active {
      background: var(--consider-color);
      border-color: var(--consider-color);
      color: white;
    }
    .rating-btn.consider-btn:not(.active):hover {
      border-color: var(--consider-border);
      color: var(--consider-color);
      background: var(--consider-bg);
    }

    .rating-btn.skip-btn.active {
      background: var(--skip-color);
      border-color: var(--skip-color);
      color: white;
    }
    .rating-btn.skip-btn:not(.active):hover {
      border-color: var(--skip-border);
      color: var(--skip-color);
      background: var(--skip-bg);
    }

    .rating-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* ---- Combine section ---- */
    .combine-section {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #f3f4f6;
    }

    .combine-label {
      font-size: 12px;
      font-weight: 600;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }

    .combine-checkboxes {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .combine-check {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 13px;
      font-weight: 600;
      color: #374151;
      cursor: pointer;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid var(--default-border);
      background: #f9fafb;
      transition: all 0.15s;
      user-select: none;
    }

    .combine-check:hover { background: #f3f4f6; border-color: #d1d5db; }

    .combine-check input[type="checkbox"] {
      width: 14px;
      height: 14px;
      cursor: pointer;
      accent-color: var(--indigo);
    }

    /* ---- Notes textarea ---- */
    .notes-section { margin-top: 14px; }

    .notes-textarea {
      width: 100%;
      min-height: 72px;
      padding: 10px 12px;
      border: 1px solid var(--default-border);
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
      line-height: 1.6;
      color: #374151;
      resize: vertical;
      transition: border-color 0.15s, box-shadow 0.15s;
      background: #fafafa;
    }

    .notes-textarea:focus {
      outline: none;
      border-color: var(--indigo);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
      background: white;
    }

    .notes-textarea::placeholder { color: #d1d5db; }
    .notes-textarea:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ---- Footer ---- */
    .footer {
      background: white;
      border-top: 1px solid var(--default-border);
      padding: 28px 32px;
      margin-top: 40px;
    }

    .footer-inner {
      max-width: 1200px;
      margin: 0 auto;
    }

    .footer-label {
      font-size: 14px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 10px;
    }

    .summary-textarea {
      width: 100%;
      min-height: 100px;
      padding: 12px 14px;
      border: 1px solid var(--default-border);
      border-radius: 10px;
      font-size: 14px;
      font-family: inherit;
      line-height: 1.7;
      color: #374151;
      resize: vertical;
      transition: border-color 0.15s, box-shadow 0.15s;
      background: #fafafa;
      margin-bottom: 20px;
    }

    .summary-textarea:focus {
      outline: none;
      border-color: var(--indigo);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
      background: white;
    }

    .summary-textarea::placeholder { color: #d1d5db; }
    .summary-textarea:disabled { opacity: 0.5; cursor: not-allowed; }

    .cta-wrapper {
      display: flex;
      justify-content: center;
    }

    .cta-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 36px;
      background: var(--indigo);
      color: white;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 2px 8px rgba(79, 70, 229, 0.25);
    }

    .cta-btn:hover {
      background: var(--indigo-hover);
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35);
      transform: translateY(-1px);
    }

    .cta-btn:active {
      transform: translateY(0);
      box-shadow: 0 1px 4px rgba(79, 70, 229, 0.2);
    }

    .cta-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .cta-btn.saving {
      pointer-events: none;
    }

    .cta-btn.saving::after {
      content: '';
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.4);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin-left: 4px;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .completion-message {
      display: none;
      text-align: center;
      padding: 16px 24px;
      background: var(--strong-bg);
      border: 1px solid var(--strong-border);
      border-radius: 10px;
      max-width: 400px;
      width: 100%;
      font-size: 15px;
      color: var(--strong-color);
      font-weight: 500;
      line-height: 1.6;
    }

    .completion-message strong { font-weight: 700; }

    /* ---- Responsive ---- */
    @media (max-width: 600px) {
      .header { padding: 16px 20px; }
      .main { padding: 0 16px; margin: 20px auto; }
      .footer { padding: 20px 20px; }
      .cards-grid { grid-template-columns: 1fr; gap: 16px; }
    }
  </style>
</head>
<body>

<header class="header">
  <div class="header-inner">
    <div class="header-left">
      <div class="header-brand">&#x1F9E0; Brainstorm</div>
      <div class="header-topic">Topic: ${escapeHtml(session && session.topic ? session.topic : '')}</div>
      ${session && session.context ? `<div class="header-context">${escapeHtml(session.context)}</div>` : ''}
    </div>
    <div class="progress-badge" id="progress-badge">
      <span id="progress-text">0 / ${(ideas || []).length} rated</span>
    </div>
  </div>
</header>

<main class="main">
  <div class="cards-grid" id="cards-grid">
    ${ideaCardsHtml}
  </div>
</main>

<footer class="footer">
  <div class="footer-inner">
    <div class="footer-label">Overall direction</div>
    <textarea
      id="summary-textarea"
      class="summary-textarea"
      placeholder="What direction feels right? Note any combinations, modifications, or constraints Claude should know about."
    ></textarea>
    <div class="cta-wrapper">
      <button class="cta-btn" id="cta-btn" onclick="handleComplete()">
        Complete &amp; Return to Claude &#x2192;
      </button>
      <div class="completion-message" id="completion-message">
        &#x2705; Annotations saved. Return to Claude and say <strong>synthesize</strong> to continue.
      </div>
    </div>
  </div>
</footer>

<script>
  // ---------------------------------------------------------------------------
  // Initial data injected from server
  // ---------------------------------------------------------------------------
  var IDEAS = ${JSON.stringify(ideas || [])};
  var IDEA_IDS = IDEAS.map(function(i) { return i.id; });
  var TOTAL = IDEA_IDS.length;
  var SAVED_DATA = ${dataJson};

  // State mirrors JSON annotations: { [ideaId]: { rating, notes, combineWith } }
  var state = ${annotationsJson};

  // Ensure every idea has an entry
  IDEA_IDS.forEach(function(id) {
    if (!state[id]) state[id] = { rating: null, notes: '', combineWith: [] };
    if (!state[id].combineWith) state[id].combineWith = [];
  });

  // ---------------------------------------------------------------------------
  // Restore saved state on load
  // ---------------------------------------------------------------------------
  function restoreState() {
    IDEA_IDS.forEach(function(id) {
      var ann = state[id];
      if (!ann) return;
      if (ann.rating) applyRatingVisual(id, ann.rating);
      if (ann.notes) {
        var el = document.getElementById('notes-' + id);
        if (el) el.value = ann.notes;
      }
      if (ann.combineWith && ann.combineWith.length) {
        ann.combineWith.forEach(function(targetId) {
          var cb = document.querySelector(
            'input[data-idea="' + id + '"][data-target="' + targetId + '"]'
          );
          if (cb) cb.checked = true;
        });
      }
    });

    if (SAVED_DATA.summary) {
      var summaryEl = document.getElementById('summary-textarea');
      if (summaryEl) summaryEl.value = SAVED_DATA.summary;
    }

    if (SAVED_DATA.status === 'annotated') {
      showCompletionState();
    }

    updateProgress();
  }

  // ---------------------------------------------------------------------------
  // Rating
  // ---------------------------------------------------------------------------
  function setRating(ideaId, rating) {
    if (!state[ideaId]) state[ideaId] = { rating: null, notes: '', combineWith: [] };
    // Toggle off if same rating clicked again
    if (state[ideaId].rating === rating) {
      state[ideaId].rating = null;
      applyRatingVisual(ideaId, null);
    } else {
      state[ideaId].rating = rating;
      applyRatingVisual(ideaId, rating);
    }
    updateProgress();
  }

  function applyRatingVisual(ideaId, rating) {
    var card = document.getElementById('card-' + ideaId);
    if (!card) return;

    card.classList.remove('rated-strong', 'rated-consider', 'rated-skip');

    ['strong', 'consider', 'skip'].forEach(function(r) {
      var btn = document.getElementById('btn-' + r + '-' + ideaId);
      if (btn) btn.classList.remove('active');
    });

    if (rating) {
      card.classList.add('rated-' + rating);
      var activeBtn = document.getElementById('btn-' + rating + '-' + ideaId);
      if (activeBtn) activeBtn.classList.add('active');
    }
  }

  // ---------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------
  function onNotesChange(ideaId, value) {
    if (!state[ideaId]) state[ideaId] = { rating: null, notes: '', combineWith: [] };
    state[ideaId].notes = value;
  }

  // ---------------------------------------------------------------------------
  // Combine with
  // ---------------------------------------------------------------------------
  function onCombineChange(ideaId, targetId, checked) {
    if (!state[ideaId]) state[ideaId] = { rating: null, notes: '', combineWith: [] };
    if (!state[ideaId].combineWith) state[ideaId].combineWith = [];
    if (checked) {
      if (state[ideaId].combineWith.indexOf(targetId) === -1) {
        state[ideaId].combineWith.push(targetId);
      }
    } else {
      state[ideaId].combineWith = state[ideaId].combineWith.filter(function(id) {
        return id !== targetId;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Progress counter
  // ---------------------------------------------------------------------------
  function updateProgress() {
    var rated = IDEA_IDS.filter(function(id) {
      return state[id] && state[id].rating;
    }).length;
    var badge = document.getElementById('progress-badge');
    var text = document.getElementById('progress-text');
    if (text) text.textContent = rated + ' / ' + TOTAL + ' rated';
    if (badge) {
      if (rated === TOTAL && TOTAL > 0) {
        badge.classList.add('complete');
      } else {
        badge.classList.remove('complete');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Collapsible toggle
  // ---------------------------------------------------------------------------
  function toggleSection(sectionId) {
    var section = document.getElementById(sectionId);
    if (section) section.classList.toggle('open');
  }

  // ---------------------------------------------------------------------------
  // Show completion state (disable all inputs)
  // ---------------------------------------------------------------------------
  function showCompletionState() {
    var btn = document.getElementById('cta-btn');
    var msg = document.getElementById('completion-message');
    if (btn) btn.style.display = 'none';
    if (msg) msg.style.display = 'block';
    document.querySelectorAll('button, textarea, input').forEach(function(el) {
      el.disabled = true;
    });
  }

  // ---------------------------------------------------------------------------
  // Complete & save
  // ---------------------------------------------------------------------------
  function handleComplete() {
    var btn = document.getElementById('cta-btn');
    var summaryEl = document.getElementById('summary-textarea');
    var summary = summaryEl ? summaryEl.value : '';

    btn.textContent = 'Saving\u2026';
    btn.classList.add('saving');
    btn.disabled = true;

    // Flush notes from DOM to state
    IDEA_IDS.forEach(function(id) {
      var notesEl = document.getElementById('notes-' + id);
      if (notesEl && state[id]) {
        state[id].notes = notesEl.value;
      }
    });

    var payload = { annotations: state, summary: summary };

    fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function(data) {
      if (!data.success) throw new Error('Save returned success=false');
      showCompletionState();
    }).catch(function(err) {
      btn.classList.remove('saving');
      btn.textContent = 'Complete & Return to Claude \u2192';
      btn.disabled = false;
      alert('Save failed: ' + err.message + '\\nPlease try again.');
    });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  restoreState();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const method = req.method;
  const urlPath = req.url.split('?')[0];

  // GET /
  if (method === 'GET' && urlPath === '/') {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(resolvedFile, 'utf8'));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error reading JSON file: ' + e.message);
      return;
    }
    const html = buildHtml(data);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(html);
    return;
  }

  // GET /data
  if (method === 'GET' && urlPath === '/data') {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(resolvedFile, 'utf8'));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify(data));
    return;
  }

  // POST /save
  if (method === 'POST' && urlPath === '/save') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }));
        return;
      }

      let data;
      try {
        data = JSON.parse(fs.readFileSync(resolvedFile, 'utf8'));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Could not read file: ' + e.message }));
        return;
      }

      data.annotations = payload.annotations || {};
      data.summary = payload.summary || '';
      data.status = 'annotated';

      try {
        fs.writeFileSync(resolvedFile, JSON.stringify(data, null, 2), 'utf8');
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Could not write file: ' + e.message }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));

      // Clean shutdown after browser receives response
      setTimeout(() => {
        console.log('\n\u2705 Done! Return to Claude and say "synthesize".');
        server.close(() => process.exit(0));
      }, 800);
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
server.listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}`;
  console.log('\n\u1F9E0 Brainstorm canvas ready');
  console.log(`   ${url}`);
  console.log('\nAnnotate your ideas in the browser.');
  console.log('Click "Complete & Return to Claude" when done.\n');
  openBrowser(url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Error: Port ${port} is already in use. Try --port <other_port>`);
  } else {
    console.error(`Server error: ${err.message}`);
  }
  process.exit(1);
});
