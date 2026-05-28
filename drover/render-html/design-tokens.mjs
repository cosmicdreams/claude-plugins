// design-tokens.mjs — load DESIGN.md, parse YAML frontmatter, resolve
// {token.path} references, and expose a tokens object plus a CSS-var
// stylesheet that templates can include.

import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const REF_RE = /^\{([^}]+)\}$/;

export function loadDesign(designMdPath) {
  const raw = readFileSync(designMdPath, "utf8");
  const m = raw.match(FRONTMATTER_RE);
  if (!m) {
    throw new Error(`no YAML frontmatter in ${designMdPath}`);
  }
  const tokens = yaml.load(m[1]);
  return resolveRefs(tokens);
}

// Walk every string value; if it matches `{a.b.c}`, replace with the
// value at tokens.a.b.c. Object references (e.g. {typography.body-md})
// are inlined as nested objects. Two passes so references-to-references
// settle.
function resolveRefs(tokens) {
  const root = tokens;
  function getByPath(p) {
    return p.split(".").reduce((acc, k) => acc?.[k], root);
  }
  function walk(node) {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    if (typeof node === "string") {
      const ref = node.match(REF_RE);
      if (ref) {
        const resolved = getByPath(ref[1].trim());
        return resolved === undefined ? node : resolved;
      }
    }
    return node;
  }
  // Two passes — values that resolve to references resolve on the second pass.
  let out = walk(tokens);
  out = walk(out);
  return out;
}

// Generate CSS custom properties for the brand tokens. Templates use
// these via `var(--color-primary)`, `var(--space-md)`, etc.
export function cssVariables(tokens) {
  const lines = [":root {"];
  const push = (name, value) => lines.push(`  --${name}: ${value};`);

  for (const [k, v] of Object.entries(tokens.colors || {})) {
    push(`color-${k}`, v);
  }
  for (const [k, v] of Object.entries(tokens.spacing || {})) {
    push(`space-${k}`, v);
  }
  for (const [k, v] of Object.entries(tokens.rounded || {})) {
    push(`rounded-${k}`, v);
  }
  for (const [name, t] of Object.entries(tokens.typography || {})) {
    if (!t || typeof t !== "object") continue;
    if (t.fontFamily) push(`font-${name}-family`, t.fontFamily);
    if (t.fontSize) push(`font-${name}-size`, t.fontSize);
    if (t.fontWeight) push(`font-${name}-weight`, t.fontWeight);
    if (t.lineHeight) push(`font-${name}-line-height`, t.lineHeight);
    if (t.letterSpacing) push(`font-${name}-tracking`, t.letterSpacing);
    if (t.fontFeature) push(`font-${name}-feature`, t.fontFeature);
  }
  lines.push("}");
  return lines.join("\n");
}

// Compose a small inline stylesheet from the tokens — base typography,
// the page layout, severity pill colors, chart-bar shape. Kept here
// (not in a .css file) so the renderer stays self-contained for now;
// move out when component count grows.
export function baseStylesheet(tokens) {
  const c = tokens.colors || {};
  const cp = tokens.components || {};
  const sev = cp["severity-pill"] || {};
  const cb = cp["chart-bar"] || {};
  return `
${cssVariables(tokens)}

:root {
  /* Severity Pill Light Mode Defaults */
  --color-severity-critical-bg: ${sev.criticalBg || "#FBE2EA"};
  --color-severity-critical-text: ${sev.criticalText || c["severity-critical"]};
  --color-severity-error-bg: ${sev.errorBg || c["tint-blue"]};
  --color-severity-error-text: ${sev.errorText || c["severity-error"]};
  --color-severity-warning-bg: ${sev.warningBg || c["tint-yellow"]};
  --color-severity-warning-text: ${sev.warningText || "#7A5C00"};
  --color-severity-notice-bg: ${sev.noticeBg || c["tint-mint"]};
  --color-severity-notice-text: ${sev.noticeText || c["severity-notice"]};
  --color-severity-info-bg: ${sev.infoBg || c["surface-alt"]};
  --color-severity-info-text: ${sev.infoText || c["severity-info"]};
  --color-severity-unknown-bg: ${sev.unknownBg || c["surface-alt"]};
  --color-severity-unknown-text: ${sev.unknownText || c["severity-unknown"]};
}

/* Dark Mode Variable Overrides */
:root[data-theme="dark"] {
  --color-surface: #0E0F12;
  --color-surface-alt: #16181D;
  --color-border: #232731;
  --color-text-strong: #F8FAFC;
  --color-text: #E2E8F0;
  --color-text-soft: #94A3B8;
  --color-text-muted: #64748B;
  --color-primary: #121829;
  --color-secondary: #3B82F6;
  --color-tint-blue: #171E30;
  --color-tint-yellow: #2D2106;
  --color-tint-mint: #063121;
  
  --color-severity-critical: #F43F5E;
  --color-severity-error: #60A5FA;
  --color-severity-warning: #FBBF24;
  --color-severity-notice: #34D399;
  --color-severity-info: #94A3B8;
  --color-severity-unknown: #64748B;

  --color-trend-up: #F43F5E;
  --color-trend-down: #10B981;
  --color-trend-flat: #64748B;
  --color-trend-new: #60A5FA;

  --color-severity-critical-bg: #4C0519;
  --color-severity-critical-text: #FDA4AF;
  --color-severity-error-bg: #1E3A8A;
  --color-severity-error-text: #93C5FD;
  --color-severity-warning-bg: #451A03;
  --color-severity-warning-text: #FCD34D;
  --color-severity-notice-bg: #064E3B;
  --color-severity-notice-text: #6EE7B7;
  --color-severity-info-bg: #334155;
  --color-severity-info-text: #CBD5E1;
  --color-severity-unknown-bg: #334155;
  --color-severity-unknown-text: #94A3B8;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-surface: #0E0F12;
    --color-surface-alt: #16181D;
    --color-border: #232731;
    --color-text-strong: #F8FAFC;
    --color-text: #E2E8F0;
    --color-text-soft: #94A3B8;
    --color-text-muted: #64748B;
    --color-primary: #121829;
    --color-secondary: #3B82F6;
    --color-tint-blue: #171E30;
    --color-tint-yellow: #2D2106;
    --color-tint-mint: #063121;
    
    --color-severity-critical: #F43F5E;
    --color-severity-error: #60A5FA;
    --color-severity-warning: #FBBF24;
    --color-severity-notice: #34D399;
    --color-severity-info: #94A3B8;
    --color-severity-unknown: #64748B;

    --color-trend-up: #F43F5E;
    --color-trend-down: #10B981;
    --color-trend-flat: #64748B;
    --color-trend-new: #60A5FA;

    --color-severity-critical-bg: #4C0519;
    --color-severity-critical-text: #FDA4AF;
    --color-severity-error-bg: #1E3A8A;
    --color-severity-error-text: #93C5FD;
    --color-severity-warning-bg: #451A03;
    --color-severity-warning-text: #FCD34D;
    --color-severity-notice-bg: #064E3B;
    --color-severity-notice-text: #6EE7B7;
    --color-severity-info-bg: #334155;
    --color-severity-info-text: #CBD5E1;
    --color-severity-unknown-bg: #334155;
    --color-severity-unknown-text: #94A3B8;
  }
}

@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }

/* Theme transition properties */
html.theme-transition,
html.theme-transition *,
html.theme-transition *:before,
html.theme-transition *:after {
  transition: background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease !important;
  transition-delay: 0s !important;
}

body {
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-body-md-family);
  font-size: var(--font-body-md-size);
  font-weight: var(--font-body-md-weight);
  line-height: var(--font-body-md-line-height);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  transition: background-color 0.3s ease, color 0.3s ease;
}

.page {
  max-width: 8.5in;
  margin: 0 auto;
  background: var(--color-surface);
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.05);
}

.page-header {
  background: var(--color-primary);
  color: #FFFFFF;
  padding: var(--space-lg) var(--space-xxl);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-lg);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.page-header__brand {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.page-header__logo { height: 28px; width: auto; display: block; filter: brightness(0) invert(1); }
.page-header__title {
  font-size: var(--font-body-sm-size);
  letter-spacing: var(--font-label-tracking);
  text-transform: uppercase;
  opacity: 0.85;
}
.page-header__actions {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.page-header__meta {
  font-size: var(--font-body-sm-size);
  opacity: 0.85;
}
.theme-toggle-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #FFFFFF;
  padding: 6px 10px;
  border-radius: var(--rounded-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s, border-color 0.2s, transform 0.1s;
}
.theme-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.4);
}
.theme-toggle-btn:active {
  transform: scale(0.95);
}
.theme-toggle-btn .sun-icon,
.theme-toggle-btn .moon-icon {
  display: none;
}
html[data-theme="dark"] .theme-toggle-btn .sun-icon { display: block; }
html:not([data-theme="dark"]) .theme-toggle-btn .moon-icon { display: block; }

@media (prefers-color-scheme: dark) {
  html:not([data-theme="light"]) .theme-toggle-btn .sun-icon { display: block; }
  html:not([data-theme="light"]) .theme-toggle-btn .moon-icon { display: none; }
}

.page-body { padding: var(--space-xxl); }

.display {
  font-family: var(--font-display-family);
  font-size: var(--font-display-size);
  font-weight: var(--font-display-weight);
  line-height: var(--font-display-line-height);
  letter-spacing: var(--font-display-tracking);
  color: var(--color-primary);
  margin: 0 0 var(--space-sm) 0;
}
.subtitle {
  font-size: var(--font-body-lg-size);
  line-height: var(--font-body-lg-line-height);
  color: var(--color-text-muted);
  margin: 0 0 var(--space-xl) 0;
}

h2.section {
  font-family: var(--font-h2-family);
  font-size: var(--font-h2-size);
  font-weight: var(--font-h2-weight);
  line-height: var(--font-h2-line-height);
  letter-spacing: var(--font-h2-tracking);
  color: var(--color-secondary);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-sm);
  margin: var(--space-xl) 0 var(--space-md) 0;
}

h3 {
  font-family: var(--font-h3-family);
  font-size: var(--font-h3-size);
  font-weight: var(--font-h3-weight);
  line-height: var(--font-h3-line-height);
  margin: var(--space-md) 0 var(--space-sm) 0;
  color: var(--color-text-strong);
}

p { margin: 0 0 var(--space-md) 0; }

.metric-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--space-md);
  margin: var(--space-md) 0 var(--space-xl) 0;
}
.metric-card {
  background: var(--color-tint-blue);
  color: var(--color-text-strong);
  border-radius: var(--rounded-lg);
  padding: var(--space-lg);
  border: 1px solid var(--color-border);
}
.metric-card__label {
  font-family: var(--font-label-family);
  font-size: var(--font-label-size);
  font-weight: var(--font-label-weight);
  letter-spacing: var(--font-label-tracking);
  text-transform: uppercase;
  color: var(--color-text-soft);
  opacity: 0.8;
  margin: 0 0 var(--space-sm) 0;
}
.metric-card__value {
  font-family: var(--font-metric-family);
  font-size: var(--font-metric-size);
  font-weight: var(--font-metric-weight);
  line-height: var(--font-metric-line-height);
  letter-spacing: var(--font-metric-tracking);
  font-feature-settings: 'tnum' 1;
  color: var(--color-primary);
  margin: 0;
}
.metric-card__hint {
  margin-top: var(--space-sm);
  font-size: var(--font-body-sm-size);
  color: var(--color-text-muted);
}

.coverage-banner {
  background: var(--color-tint-yellow);
  color: var(--color-severity-warning-text);
  border-radius: var(--rounded-md);
  padding: var(--space-md);
  margin: var(--space-md) 0 var(--space-lg) 0;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  border: 1px solid var(--color-border);
}
.coverage-banner__icon { font-size: 1.2em; }

.severity-pill {
  display: inline-block;
  border-radius: var(--rounded-pill);
  padding: 2px var(--space-sm);
  font-family: var(--font-label-family);
  font-size: var(--font-label-size);
  font-weight: var(--font-label-weight);
  letter-spacing: var(--font-label-tracking);
  text-transform: uppercase;
  line-height: 1.6;
  vertical-align: middle;
}
.severity-pill--critical { background: var(--color-severity-critical-bg); color: var(--color-severity-critical-text); }
.severity-pill--error    { background: var(--color-severity-error-bg); color: var(--color-severity-error-text); }
.severity-pill--warning  { background: var(--color-severity-warning-bg); color: var(--color-severity-warning-text); }
.severity-pill--notice   { background: var(--color-severity-notice-bg); color: var(--color-severity-notice-text); }
.severity-pill--info     { background: var(--color-severity-info-bg); color: var(--color-severity-info-text); }
.severity-pill--unknown  { background: var(--color-severity-unknown-bg); color: var(--color-severity-unknown-text); }

@keyframes chart-grow {
  from { width: 0; }
}

.chart {
  display: grid;
  grid-template-columns: 14em 1fr 5em;
  gap: var(--space-sm);
  align-items: center;
  margin: var(--space-sm) 0 var(--space-lg) 0;
  font-size: var(--font-body-sm-size);
  padding: var(--space-xs);
  border-radius: var(--rounded-sm);
  transition: background-color 0.15s ease, transform 0.15s ease;
  position: relative;
}
.chart:hover {
  background-color: var(--color-surface-alt);
  transform: translateX(4px);
}
.chart__label { color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chart__bar-track {
  background: ${cb.trackColor || c["surface-alt"]};
  height: ${cb.height || "22px"};
  border-radius: var(--rounded-sm);
  overflow: hidden;
}
.chart__bar-fill {
  background: var(--color-primary);
  height: 100%;
  border-radius: var(--rounded-sm) 0 0 var(--rounded-sm);
  animation: chart-grow 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.chart__bar-fill--accent { background: var(--color-secondary); }
.chart__value { color: var(--color-text-muted); text-align: right; font-variant-numeric: tabular-nums; }

/* Interactive tooltips for charts */
.chart-tooltip {
  position: absolute;
  background: var(--color-surface);
  color: var(--color-text-strong);
  border: 1px solid var(--color-border);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--rounded-md);
  font-size: var(--font-body-sm-size);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: 1000;
  transform: translateY(10px);
  max-width: 320px;
}
.chart-tooltip.visible {
  opacity: 1;
  transform: translateY(0);
}

.ticket-card {
  background: var(--color-tint-blue);
  border-left: 4px solid var(--color-primary);
  border-radius: var(--rounded-md);
  padding: var(--space-md);
  margin: var(--space-md) 0;
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  border-right: 1px solid var(--color-border);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.ticket-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}
.ticket-card__title {
  font-family: var(--font-h3-family);
  font-size: var(--font-h3-size);
  font-weight: var(--font-h3-weight);
  color: var(--color-primary);
  margin: 0 0 var(--space-xs) 0;
}
.ticket-card__meta {
  font-family: var(--font-label-family);
  font-size: var(--font-label-size);
  font-weight: var(--font-label-weight);
  letter-spacing: var(--font-label-tracking);
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: 0 0 var(--space-sm) 0;
}
.ticket-card__desc { margin: 0; font-size: var(--font-body-sm-size); color: var(--color-text); }
.ticket-card__sample {
  font-family: var(--font-mono-family);
  font-size: var(--font-mono-size);
  color: var(--color-text-soft);
  background: var(--color-surface);
  padding: var(--space-sm);
  border-radius: var(--rounded-sm);
  margin: var(--space-sm) 0 0 0;
  overflow-x: auto;
  white-space: pre;
  border: 1px solid var(--color-border);
}

/* Card highlight flash keyframe */
@keyframes flash-highlight {
  0% {
    box-shadow: 0 0 0 4px var(--color-secondary);
    border-color: var(--color-secondary);
  }
  100% {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }
}
.ticket-card.highlighted,
.triage-card.highlighted,
.jira-card.highlighted {
  animation: flash-highlight 1.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* Filter Control Panel */
.filter-panel {
  background: var(--color-surface-alt);
  border: 1px solid var(--color-border);
  border-radius: var(--rounded-md);
  padding: var(--space-md);
  margin-bottom: var(--space-lg);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  align-items: center;
}
.filter-panel__group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  flex: 1 1 200px;
}
.filter-panel__label {
  font-family: var(--font-label-family);
  font-size: var(--font-label-size);
  font-weight: 600;
  letter-spacing: var(--font-label-tracking);
  text-transform: uppercase;
  color: var(--color-text-soft);
}
.filter-panel__input,
.filter-panel__select {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-strong);
  padding: 8px 12px;
  border-radius: var(--rounded-sm);
  font-family: var(--font-body-sm-family);
  font-size: var(--font-body-sm-size);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.filter-panel__input:focus,
.filter-panel__select:focus {
  border-color: var(--color-secondary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}
.filter-panel__stats {
  font-size: var(--font-body-sm-size);
  color: var(--color-text-muted);
  font-weight: 500;
  margin-top: auto;
  padding-bottom: 8px;
}

.footer {
  background: var(--color-surface-alt);
  color: var(--color-text-muted);
  padding: var(--space-md) var(--space-xxl);
  font-size: var(--font-body-sm-size);
  display: flex;
  justify-content: space-between;
  gap: var(--space-md);
  border-top: 1px solid var(--color-border);
}

@page {
  size: Letter portrait;
  margin: 0;
}
@media print {
  /* ── Color fidelity ────────────────────────────────────────────── */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* ── Page chrome ───────────────────────────────────────────────── */
  body { background: white; }
  .page { max-width: none; margin: 0; box-shadow: none; }
  .theme-toggle-btn, .filter-panel { display: none !important; }

  /* ── Kill all animations ───────────────────────────────────────── */
  /* Bar-chart bars animate from width:0 to their inline-style width  */
  /* on load. A PDF snapshot mid-animation produces partial bars —    */
  /* same root cause as the "incomplete donut circle" problem. With   */
  /* animation:none the bar snaps to its final inline-style width     */
  /* immediately; no special width override is needed.                */
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }

  /* ── Intentional section page breaks ───────────────────────────── */
  /* Every h2.section marks a distinct report chapter. Force a fresh  */
  /* page so section headings never appear buried at the bottom of    */
  /* the prior section. Metric summary stays on page 1; sections      */
  /* follow on subsequent pages.                                       */
  .page-body h2.section {
    break-before: page;
    page-break-before: always;
  }

  /* ── Heading orphan prevention ─────────────────────────────────── */
  h2, h3, h4 {
    break-after: avoid;
    page-break-after: avoid;
  }

  /* ── Cards: never split across a page boundary ─────────────────── */
  /* Multi-column grid cards overlap when a grid row is split at a    */
  /* page boundary. break-inside:avoid keeps each card whole.         */
  .ticket-card,
  .metric-card,
  .triage-card,
  .jira-card,
  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* ── Code / log-sample blocks ──────────────────────────────────── */
  /* overflow-x:auto is interactive-only; in print, wrap long lines   */
  /* so they don't run off the page edge or produce a scrollbar       */
  /* artifact in the rendered PDF.                                     */
  .ticket-card__sample,
  pre,
  code {
    white-space: pre-wrap !important;
    overflow: visible !important;
    word-break: break-all;
  }
}
`;
}

