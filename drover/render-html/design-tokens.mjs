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

@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }

body {
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-body-md-family);
  font-size: var(--font-body-md-size);
  font-weight: var(--font-body-md-weight);
  line-height: var(--font-body-md-line-height);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.page {
  max-width: 8.5in;
  margin: 0 auto;
  background: var(--color-surface);
}

.page-header {
  background: var(--color-primary);
  color: var(--color-surface);
  padding: var(--space-lg) var(--space-xxl);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-lg);
}
.page-header__brand {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.page-header__logo { height: 28px; width: auto; display: block; }
.page-header__title {
  font-size: var(--font-body-sm-size);
  letter-spacing: var(--font-label-tracking);
  text-transform: uppercase;
  opacity: 0.85;
}
.page-header__meta {
  font-size: var(--font-body-sm-size);
  opacity: 0.85;
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
  color: var(--color-text);
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
  color: var(--color-primary);
  border-radius: var(--rounded-lg);
  padding: var(--space-lg);
}
.metric-card__label {
  font-family: var(--font-label-family);
  font-size: var(--font-label-size);
  font-weight: var(--font-label-weight);
  letter-spacing: var(--font-label-tracking);
  text-transform: uppercase;
  color: var(--color-primary);
  opacity: 0.7;
  margin: 0 0 var(--space-sm) 0;
}
.metric-card__value {
  font-family: var(--font-metric-family);
  font-size: var(--font-metric-size);
  font-weight: var(--font-metric-weight);
  line-height: var(--font-metric-line-height);
  letter-spacing: var(--font-metric-tracking);
  font-feature-settings: 'tnum' 1;
  margin: 0;
}
.metric-card__hint {
  margin-top: var(--space-sm);
  font-size: var(--font-body-sm-size);
  color: var(--color-text-muted);
}

.coverage-banner {
  background: var(--color-tint-yellow);
  color: #7A5C00;
  border-radius: var(--rounded-md);
  padding: var(--space-md);
  margin: var(--space-md) 0 var(--space-lg) 0;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
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
.severity-pill--critical { background: ${sev.criticalBg || "#FBE2EA"}; color: ${sev.criticalText || c["severity-critical"]}; }
.severity-pill--error    { background: ${sev.errorBg || c["tint-blue"]}; color: ${sev.errorText || c["severity-error"]}; }
.severity-pill--warning  { background: ${sev.warningBg || c["tint-yellow"]}; color: ${sev.warningText || "#7A5C00"}; }
.severity-pill--notice   { background: ${sev.noticeBg || c["tint-mint"]}; color: ${sev.noticeText || c["severity-notice"]}; }
.severity-pill--info     { background: ${sev.infoBg || c["surface-alt"]}; color: ${sev.infoText || c["severity-info"]}; }
.severity-pill--unknown  { background: ${sev.unknownBg || c["surface-alt"]}; color: ${sev.unknownText || c["severity-unknown"]}; }

.chart {
  display: grid;
  grid-template-columns: 14em 1fr 5em;
  gap: var(--space-sm);
  align-items: center;
  margin: var(--space-sm) 0 var(--space-lg) 0;
  font-size: var(--font-body-sm-size);
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
}
.chart__bar-fill--accent { background: var(--color-secondary); }
.chart__value { color: var(--color-text-muted); text-align: right; font-variant-numeric: tabular-nums; }

.ticket-card {
  background: var(--color-tint-blue);
  border-left: 4px solid var(--color-primary);
  border-radius: var(--rounded-md);
  padding: var(--space-md);
  margin: var(--space-md) 0;
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
  color: var(--color-text-muted);
  background: var(--color-surface);
  padding: var(--space-sm);
  border-radius: var(--rounded-sm);
  margin: var(--space-sm) 0 0 0;
  overflow-x: auto;
  white-space: pre;
}

.footer {
  background: var(--color-surface-alt);
  color: var(--color-text-muted);
  padding: var(--space-md) var(--space-xxl);
  font-size: var(--font-body-sm-size);
  display: flex;
  justify-content: space-between;
  gap: var(--space-md);
}

@page {
  size: Letter portrait;
  margin: 0;
}
@media print {
  body { background: white; }
  .page { max-width: none; margin: 0; }
  h2.section { page-break-after: avoid; }
  .ticket-card, .metric-card { page-break-inside: avoid; }
}
`;
}
