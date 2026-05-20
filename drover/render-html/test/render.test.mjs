// Smoke tests for the HTML renderer. Run with `npm test` (node --test).
// Requires deps installed (npm ci) — render-core statically imports them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "fixtures", "sample.json");
const FIXTURE_LOW = resolve(HERE, "fixtures", "low-coverage.json");

const { run } = await import("../render-core.mjs");

function renderToTmp(extraArgs = [], data = FIXTURE) {
  const dir = mkdtempSync(join(tmpdir(), "drover-render-"));
  const out = join(dir, "out.html");
  run(["--data", data, "--out", out, ...extraArgs]);
  const html = readFileSync(out, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return html;
}

test("renders a self-contained HTML document", () => {
  const html = renderToTmp();
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<style>/);
  assert.ok(!/<link[^>]+stylesheet/i.test(html), "CSS must be inlined, not linked");
});

test("surfaces project, month, and totals", () => {
  const html = renderToTmp();
  assert.match(html, /pncb/);
  assert.match(html, /April 2026/);
  assert.match(html, /1,234/); // events_total, thousands-formatted
});

// `.coverage-banner` is always in the inlined CSS; the banner *div* is
// only emitted when coverage is low, so assert on the rendered markup.
const BANNER_DIV = /<div class="coverage-banner">/;

test("suppresses the coverage banner when coverage is healthy", () => {
  // Fixture is at 93.33% — above the 90% threshold — banner div absent.
  const html = renderToTmp();
  assert.ok(!BANNER_DIV.test(html), "healthy coverage must not show the warning banner");
});

test("shows the coverage banner with the figure when coverage is low", () => {
  const html = renderToTmp([], FIXTURE_LOW);
  assert.match(html, BANNER_DIV);
  assert.match(html, /60%|60\b/); // coverage_pct surfaced in the banner
});

test("includes the top issue and its ticket recommendation", () => {
  const html = renderToTmp();
  assert.match(html, /Undefined index foo/);
});

test("is deterministic for identical input", () => {
  assert.equal(renderToTmp(), renderToTmp());
});

test("renders root-cause-summary template cleanly", () => {
  const html = renderToTmp(["--template", "root-cause-summary"]);
  assert.match(html, /Root-Cause Summary/);
  assert.match(html, /Pareto cut:/);
  assert.match(html, /Fix undefined index/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /class="chart interactive-chart-row"/);
  assert.match(html, /id="issue-card-0"/);
});

test("renders calendar-boundary template cleanly", () => {
  const html = renderToTmp(["--template", "calendar-boundary"]);
  assert.match(html, /Calendar Window Report/);
  assert.match(html, /Events by channel/);
  assert.match(html, /Fix undefined index/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /data-type="channel"/);
  assert.match(html, /data-type="severity"/);
  assert.match(html, /data-type="daily"/);
});

test("renders triage-brief template cleanly", () => {
  const html = renderToTmp(["--template", "triage-brief"]);
  assert.match(html, /Triage Brief/);
  assert.match(html, /Top 25 Fingerprints/);
  assert.match(html, /Undefined index foo/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /class="filter-panel"/);
  assert.match(html, /id="search-input"/);
  assert.match(html, /id="severity-select"/);
  assert.match(html, /data-channel=/);
});

test("renders jira-ready template cleanly", () => {
  const html = renderToTmp(["--template", "jira-ready"]);
  assert.match(html, /JIRA-Ready Issues/);
  assert.match(html, /Copy Specs/);
  assert.match(html, /Undefined index foo/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /class="filter-panel"/);
  assert.match(html, /id="search-input"/);
  assert.match(html, /id="severity-select"/);
  assert.match(html, /data-severity=/);
});

// Drift guard: the theme-toggle handler is a shared partial, so it must
// render byte-identically in every template. This is the test that would
// have caught the pre-refactor copy-paste divergence.
const TEMPLATES = [
  "monthly-client", "root-cause-summary", "calendar-boundary",
  "triage-brief", "jira-ready",
];
// from the IIFE that owns the toggle button through its close
const TOGGLE_RE = /const btn = document\.getElementById\("theme-toggle"\);[\s\S]*?\}\)\(\);/;

test("theme-toggle handler is identical across all templates (no drift)", () => {
  const blocks = TEMPLATES.map((t) => {
    const html = renderToTmp(["--template", t]);
    const m = html.match(TOGGLE_RE);
    assert.ok(m, `theme-toggle handler not found in ${t}`);
    return m[0];
  });
  for (let i = 1; i < blocks.length; i++) {
    assert.equal(
      blocks[i], blocks[0],
      `theme-toggle handler in ${TEMPLATES[i]} differs from ${TEMPLATES[0]}`,
    );
  }
});
