// Smoke tests for the HTML renderer. Run with `npm test` (node --test).
// Requires deps installed (npm ci) — render-core statically imports them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "fixtures", "sample.json");
const FIXTURE_LOW = resolve(HERE, "fixtures", "low-coverage.json");
const FIXTURE_SUPPLEMENTARY = resolve(HERE, "fixtures", "supplementary.json");

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

function renderWithCoverage(coverage, template) {
  const data = JSON.parse(readFileSync(FIXTURE, "utf8"));
  data.coverage = coverage;
  const dir = mkdtempSync(join(tmpdir(), "drover-cov-"));
  const dataPath = join(dir, "cov.json");
  const out = join(dir, "out.html");
  writeFileSync(dataPath, JSON.stringify(data));
  run(["--data", dataPath, "--out", out, ...(template ? ["--template", template] : [])]);
  const html = readFileSync(out, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return html;
}

test("suppresses the coverage banner only when coverage is complete", () => {
  const html = renderWithCoverage({
    expected_days: 30, present_days: 30, coverage_pct: 100, missing_or_failed: [],
  });
  assert.ok(!BANNER_DIV.test(html), "complete coverage must not show the warning banner");
});

test("warns on a single missing file even at 98.9% coverage", () => {
  const html = renderWithCoverage({
    expected_days: 90, present_days: 89, coverage_pct: 98.89,
    missing_or_failed: [{ date: "2026-04-12", log_type: "php-error", state: "fetch-failed" }],
  });
  assert.ok(BANNER_DIV.test(html),
    "any non-present expected entry must surface a coverage caveat");
});

for (const template of ["monthly-client", "root-cause-summary", "calendar-boundary",
                        "triage-brief", "jira-ready"]) {
  test(`${template}: surfaces a coverage gap just under 100%`, () => {
    const html = renderWithCoverage({
      expected_days: 90, present_days: 89, coverage_pct: 98.89,
      missing_or_failed: [{ date: "2026-04-12", log_type: "php-error", state: "fetch-failed" }],
    }, template);
    assert.ok(BANNER_DIV.test(html),
      `${template} must not claim complete coverage when a file is missing`);
  });
}

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

test("stakeholder templates render supplementary php detail without ranking it", () => {
  for (const template of [
    "monthly-client", "root-cause-summary", "calendar-boundary",
  ]) {
    const html = renderToTmp(["--template", template], FIXTURE_SUPPLEMENTARY);
    assert.match(html, /Supplementary detail \(php-error\)/);
    assert.match(html, /PHP frame noise/);
    assert.match(html, /Actionable watchdog failure/);
    assert.ok(
      !/Top issues this month[\s\S]*PHP frame noise[\s\S]*Supplementary detail/.test(html),
      `${template} must not rank the php group among top issues`,
    );
    if (template === "root-cause-summary") {
      assert.match(html, /top 1 issues account for 9\.1%/i);
      assert.match(html, /Pareto cut:[\s\S]*1[\s\S]*9%/i);
    }
  }
});

test("older schema without supplementary groups omits the section", () => {
  for (const template of [
    "monthly-client", "root-cause-summary", "calendar-boundary",
  ]) {
    const html = renderToTmp(["--template", template], FIXTURE);
    assert.doesNotMatch(html, /Supplementary detail \(php-error\)/);
  }
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

// --- Report defaults: branding, theme, and print ---------------------------
// These pin behaviour a new user gets with no flags and no project config.

test("brands every report with the bundled Velir logo, no flags required", () => {
  const html = renderToTmp();
  assert.match(html, /class="page-header__logo"/, "logo <img> must be present");
  assert.match(html, /src="data:image\/png;base64,/, "logo must be inlined");
});

test("fails loudly when an explicit --logo does not exist", () => {
  assert.throws(
    () => renderToTmp(["--logo", "/nonexistent/velir.png"]),
    /--logo file not found/,
    "a bad --logo must abort, never silently drop the brand",
  );
});

test("light is the default; dark is opt-in only", () => {
  const html = renderToTmp();
  // An automatic prefers-color-scheme block would hand dark-OS readers a
  // dark report — and a dark PDF — without them ever choosing it.
  const auto = html.match(/@media \(prefers-color-scheme: dark\)\s*\{/g) || [];
  assert.equal(auto.length, 0, "no automatic dark-mode media block");
  assert.match(html, /\[data-theme="dark"\]/, "explicit dark theme still available");
});

test("print forces light even when dark is toggled on", () => {
  const html = renderToTmp();
  const printBlock = html.slice(html.indexOf("@media print"));
  assert.match(
    printBlock,
    /:root\[data-theme="dark"\]/,
    "print must re-declare light values over the dark theme",
  );
  // Severity pills carry their own token pairs; missing them left the pills
  // dark-filled in a dark-exported PDF while every other surface was light.
  assert.match(printBlock, /--color-severity-error-bg/);
  assert.match(printBlock, /--color-surface:/);
});

test("sections flow instead of forcing one page each", () => {
  const html = renderToTmp();
  const printBlock = html.slice(html.indexOf("@media print"));
  assert.ok(
    !/\.page-body h2\.section\s*\{[^}]*break-before:\s*page/.test(printBlock),
    "forced per-section page breaks leave short sections on mostly-empty pages",
  );
});

test("footer credits Velir without naming internal tooling", () => {
  const html = renderToTmp();
  assert.match(html, /Prepared by Velir/);
  assert.ok(!/Prepared by Velir · drover/.test(html), "tool name would confuse a client");
});

// Chart labels come from attacker-influenceable parsed log content.
const XSS_PAYLOAD = '</strong><img src=x onerror=alert(document.domain)>';

function renderWithHostileChannel(template) {
  const data = JSON.parse(readFileSync(FIXTURE, "utf8"));
  for (const g of data.groups ?? []) g.channel = XSS_PAYLOAD;
  for (const g of data.groups_collapsed ?? []) g.channel = XSS_PAYLOAD;
  data.totals = data.totals ?? {};
  data.totals.by_channel = { [XSS_PAYLOAD]: 999 };
  const dir = mkdtempSync(join(tmpdir(), "drover-xss-"));
  const dataPath = join(dir, "hostile.json");
  const out = join(dir, "out.html");
  writeFileSync(dataPath, JSON.stringify(data));
  run(["--data", dataPath, "--out", out, "--template", template]);
  const html = readFileSync(out, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return html;
}

for (const template of ["root-cause-summary", "calendar-boundary"]) {
  test(`${template}: hostile channel reaches the DOM only as escaped attribute text`, () => {
    const html = renderWithHostileChannel(template);
    assert.match(html, /data-label="[^"]*&lt;img/,
      "label should be present, HTML-escaped, in the data-label attribute");
    assert.ok(!/<img\s+src=x\s+onerror/i.test(html),
      "payload must not appear as a parsed element");
  });
}

// getAttribute decodes escaped labels. Exercise the builder's decoded input.
test("shared tooltip builder never parses label text as markup", () => {
  const partial = readFileSync(
    resolve(HERE, "..", "templates", "partials", "chart-tooltip-script.hbs"), "utf8"
  );
  const js = partial.replace(/^[\s\S]*?<script>/, "").replace(/<\/script>[\s\S]*$/, "");
  const created = [];
  const htmlAssignments = [];
  function makeNode(tag) {
    const node = {
      tagName: tag, style: {}, children: [],
      _text: "", _html: "",
      appendChild(c) { this.children.push(c); return c; },
      get textContent() { return this._text; },
      set textContent(v) { this._text = v; this.children.length = 0; },
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = v; htmlAssignments.push(v); },
    };
    created.push(node);
    return node;
  }
  const documentStub = {
    createElement: (t) => makeNode(t),
    createTextNode: (t) => ({ nodeType: 3, data: String(t) }),
  };
  const windowStub = {};
  new Function("window", "document", js)(windowStub, documentStub);
  const T = windowStub.droverTooltip;
  assert.ok(T, "partial must expose window.droverTooltip");
  const tooltip = makeNode("div");
  T.set(tooltip, [T.el("strong", XSS_PAYLOAD), T.br(), T.text("Volume: 12 events")]);
  assert.equal(htmlAssignments.length, 0, "builder must never assign innerHTML");
  assert.ok(!created.some((n) => /img/i.test(n.tagName)),
    "payload must not become an element");
  const strong = tooltip.children.find((c) => c.tagName === "strong");
  assert.equal(strong.textContent, XSS_PAYLOAD,
    "payload must survive as inert text, proving it was never parsed");
});

for (const template of ["root-cause-summary", "calendar-boundary", "cloudflare-summary"]) {
  test(`${template}: no tooltip handler assigns attribute data to innerHTML`, () => {
    const src = readFileSync(
      resolve(HERE, "..", "templates", `${template}.hbs`), "utf8"
    );
    assert.ok(!/\.innerHTML\s*=/.test(src),
      "tooltips must be built with textContent / DOM nodes, not innerHTML");
  });
}

test("chart templates share one tooltip builder (no drift)", () => {
  for (const t of ["root-cause-summary", "calendar-boundary", "cloudflare-summary"]) {
    const src = readFileSync(resolve(HERE, "..", "templates", `${t}.hbs`), "utf8");
    assert.match(src, /{{> chart-tooltip-script}}/,
      `${t} must include the shared injection-safe tooltip partial`);
  }
});

test("signal tiers survive incomplete coverage and hostile supplementary text", () => {
  const data = JSON.parse(readFileSync(FIXTURE_SUPPLEMENTARY, "utf8"));
  data.coverage = {
    expected_days: 90, present_days: 89, coverage_pct: 98.89,
    missing_or_failed: [{date: "2026-04-12", log_type: "php-error", state: "fetch-failed"}],
  };
  data.supplementary_groups[0].summary = "PHP frame noise " + XSS_PAYLOAD;
  const dir = mkdtempSync(join(tmpdir(), "drover-tiers-"));
  try {
    const dataPath = join(dir, "input.json");
    writeFileSync(dataPath, JSON.stringify(data));
    for (const template of ["monthly-client", "root-cause-summary", "calendar-boundary"]) {
      const out = join(dir, template + ".html");
      run(["--data", dataPath, "--out", out, "--template", template]);
      const html = readFileSync(out, "utf8");
      assert.match(html, BANNER_DIV);
      assert.match(html, /Actionable watchdog failure/);
      assert.match(html, /Supplementary detail \(php-error\)/);
      assert.match(html, /PHP frame noise/);
      assert.doesNotMatch(html, /<img\s+src=x\s+onerror/i);
      assert.doesNotMatch(html, /Top issues this month[\s\S]*PHP frame noise[\s\S]*Supplementary detail/);
      if (template === "root-cause-summary") {
        assert.match(html, /top 1 issues account for 9\.1%/i);
      }
    }
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// --- Report charts and incident brief (monthly-client) ---------------------
// Geometry is pure and unit-tested; the rendered checks pin the wiring, the
// accessibility text, and the escaping of log-derived labels.

const FIXTURE_CHARTS = resolve(HERE, "fixtures", "charts.json");
const { donutSegments, lineChartGeometry, dailyVolume, buildIncidentBrief } =
  await import("../render-core.mjs");

function renderVariant(mutate, template = "monthly-client", fixture = FIXTURE_CHARTS) {
  const data = JSON.parse(readFileSync(fixture, "utf8"));
  mutate(data);
  const dir = mkdtempSync(join(tmpdir(), "drover-charts-"));
  try {
    const dataPath = join(dir, "input.json");
    const out = join(dir, "out.html");
    writeFileSync(dataPath, JSON.stringify(data));
    run(["--data", dataPath, "--out", out, "--template", template]);
    return readFileSync(out, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("donutSegments: empty, absent, and zero-total input draw nothing", () => {
  assert.deepEqual(donutSegments([]), []);
  assert.deepEqual(donutSegments(undefined), []);
  assert.deepEqual(donutSegments([{ label: "php", value: 0 }, { label: "cron", value: 0 }]), []);
  assert.deepEqual(donutSegments([{ label: "php", value: "not a number" }]), []);
});

test("donutSegments: one channel at 100% is a single full ring", () => {
  const segs = donutSegments([{ label: "php", value: 42 }]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].share, "100.0");
  assert.equal(segs[0].slot, "1");
  assert.equal(segs[0].value, "42");
  assert.equal(segs[0].offset, "25.00", "first segment starts at twelve o'clock");
  assert.equal(Number(segs[0].dash) + Number(segs[0].gap), 100);
});

test("donutSegments: sorts by value, folds past the ramp and under minShare into Other", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g"].map((label, i) => ({ label, value: 100 - i * 10 }));
  items.push({ label: "tiny", value: 1 });
  const segs = donutSegments(items, { minShare: 1 });
  assert.deepEqual(segs.map((s) => s.label), ["a", "b", "c", "d", "e", "Other"]);
  assert.deepEqual(segs.map((s) => s.slot), ["1", "2", "3", "4", "5", "other"]);
  const shareSum = segs.reduce((s, x) => s + Number(x.share), 0);
  assert.ok(Math.abs(shareSum - 100) < 0.3, `shares must cover the whole ring, got ${shareSum}`);
  // offsets march backwards from 25 by the preceding cumulative share
  assert.equal(segs[0].offset, "25.00");
  assert.ok(Number(segs[1].offset) < 25);
  for (const s of segs) assert.ok(!/NaN/.test(JSON.stringify(s)));
});

test("lineChartGeometry: no points draws nothing", () => {
  assert.equal(lineChartGeometry([]), null);
  assert.equal(lineChartGeometry(undefined), null);
  assert.equal(lineChartGeometry([{ label: "Events", slot: 1, points: [] }]), null);
});

test("lineChartGeometry: a single day is centred with no NaN", () => {
  const geo = lineChartGeometry([{ label: "Events", slot: 1, points: [{ label: "04-01", value: 40 }] }]);
  assert.equal(geo.series.length, 1);
  assert.equal(geo.series[0].points, "360.0,6.0");
  assert.equal(geo.series[0].markers.length, 1);
  assert.deepEqual(geo.xLabels, ["04-01"]);
  assert.equal(geo.peak.value, "40");
  assert.ok(!/NaN/.test(JSON.stringify(geo)));
});

test("lineChartGeometry: zero totals sit on the baseline and report a zero peak", () => {
  const pts = ["04-01", "04-02", "04-03"].map((label) => ({ label, value: 0 }));
  const geo = lineChartGeometry(pts, { width: 100, height: 50 });
  assert.equal(geo.series[0].points, "6.0,44.0 50.0,44.0 94.0,44.0");
  assert.equal(geo.peak.value, "0");
  assert.equal(geo.maxLabel, "1");
  assert.ok(!/NaN/.test(JSON.stringify(geo)));
});

test("lineChartGeometry: scales to the peak, keeps endpoints and peak as markers", () => {
  const pts = [10, 20, 80, 20, 10].map((value, i) => ({ label: `04-0${i + 1}`, value }));
  const geo = lineChartGeometry(pts, { width: 100, height: 50 });
  const coords = geo.series[0].points.split(" ").map((p) => p.split(",").map(Number));
  assert.equal(coords.length, 5);
  for (const [x, y] of coords) {
    assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 50, `point ${x},${y} outside the viewBox`);
  }
  assert.equal(coords[2][1], 6, "peak touches the top padding");
  assert.deepEqual(geo.series[0].markers.map((m) => m.label), ["04-01", "04-03", "04-05"]);
  assert.deepEqual(geo.xLabels, ["04-01", "04-03", "04-05"]);
  assert.equal(geo.gridlines.length, 4);
  assert.match(geo.ariaSummary, /5 points from 04-01 to 04-05, peak 80 on 04-03/);
});

test("dailyVolume: reads object and scalar day entries, quarantines undated events", () => {
  const { dailyPoints, undatedEvents, peakDay } = dailyVolume({
    "2026-04-02": { total: 5, severities: { warning: 5 } },
    "2026-04-01": 3,
    "2026-04-03": { severities: { error: 2, notice: 9 } },
    unknown: { total: 7, severities: { warning: 7 } },
  });
  assert.deepEqual(dailyPoints, [
    { label: "04-01", value: 3 }, { label: "04-02", value: 5 }, { label: "04-03", value: 11 },
  ]);
  assert.equal(undatedEvents, 7);
  assert.deepEqual(peakDay, { date: "2026-04-03", value: 11 });
  assert.deepEqual(dailyVolume(undefined), { dailyPoints: [], undatedEvents: 0, peakDay: null });
});

test("incident brief: every row traces to a number the aggregation supplied", () => {
  const data = JSON.parse(readFileSync(FIXTURE_CHARTS, "utf8"));
  const brief = buildIncidentBrief(data, {
    topGroup: data.groups_collapsed[0], topShare: "39.2",
    peakDay: { date: "2026-04-16", value: 210 },
  });
  assert.equal(brief.eyebrow, "Month in brief");
  assert.match(brief.headline, /^1,562 application errors in April 2026; the largest single issue accounted for 39\.2% of them\.$/);
  const byLabel = Object.fromEntries(brief.rows.map((r) => [r.label, r.value]));
  assert.match(byLabel.Volume, /^1,562 events across 23 distinct issues\.$/);
  assert.match(byLabel["Busiest day"], /^2026-04-16 — 210 events \(13\.4% of the month\)\.$/);
  assert.match(byLabel["Leading issue"], /Undefined index: field_hero/);
  assert.match(byLabel["Leading issue"], /612 events \(39\.2% of the month\)/);
  assert.match(byLabel["Leading issue"], /severity warning · channel php · up 13% versus the prior month\.$/);
  assert.match(byLabel.Severity, /^3 critical · 1[\d,]* error · 1[\d,]* warning · \d+ notice\.$/);
  assert.match(byLabel.Coverage, /^58 of 60 expected log files retrieved \(96\.7%\)\. Totals understate the true volume\.$/);
});

test("incident brief: omitted rows when their source is absent, omitted entirely with no events", () => {
  const brief = buildIncidentBrief({ totals: { events_total: 9 } }, {});
  assert.deepEqual(brief.rows.map((r) => r.label), ["Volume"]);
  assert.equal(brief.rows[0].value, "9 events.");
  assert.equal(brief.headline, "9 application errors.");
  assert.equal(buildIncidentBrief({ totals: { events_total: 0, groups_total: 0 } }, {}), null);
  assert.equal(buildIncidentBrief({ totals: {} }, {}), null);
  assert.equal(buildIncidentBrief({}, {}), null);
  assert.equal(buildIncidentBrief({ totals: { events_total: "many" } }, {}), null);
});

test("monthly-client: renders the brief, the line chart, and the donut from real data", () => {
  const html = renderToTmp(["--template", "monthly-client"], FIXTURE_CHARTS);
  // Brief sits after the metric cards and before the severity bars.
  const brief = html.indexOf('<section class="incident-brief"');
  assert.ok(brief > 0, "incident brief must render");
  assert.ok(brief > html.indexOf('class="metric-row"'), "brief must follow the metric cards");
  assert.ok(brief < html.indexOf("Severity breakdown"), "brief must precede the severity bars");
  assert.match(html, /1,562 application errors in April 2026/);
  assert.match(html, /Busiest day/);
  assert.match(html, /2026-04-16 — 210 events/);

  // Line chart: title/desc, real-text axis, peak in words.
  assert.match(html, /<svg class="chart-line__svg"[^>]*role="img"[^>]*aria-label="Daily event volume: 30 points from 04-01 to 04-30, peak 210 on 04-16"/);
  assert.match(html, /<title>Daily event volume<\/title>\s*<desc>30 points from 04-01 to 04-30, peak 210 on 04-16<\/desc>/);
  assert.match(html, /<polyline class="chart-line__path" points="[\d., ]+"/);
  assert.match(html, /<span class="chart-line__axis-label">04-01<\/span>/);
  assert.match(html, /Peak 210 on 04-16\./);
  assert.match(html, /A further 7 events carried no parseable timestamp/);

  // Donut: title/desc, legend rows carry label, count, and share as text.
  assert.match(html, /<svg class="chart-donut__svg"[^>]*role="img"[^>]*aria-label="Events by channel · php 53\.1%/);
  assert.match(html, /<title>Events by channel<\/title>\s*<desc>php 830 \(53\.1%\);/);
  assert.match(html, /<span class="chart-donut__legend-label">php<\/span>\s*<span class="chart-donut__legend-value">830 <span class="chart-donut__legend-share">\(53\.1%\)/);
  assert.match(html, /<span class="chart-donut__legend-label">Other<\/span>/, "channels past the ramp fold into Other");
  assert.doesNotMatch(html, /--color-series-6/, "no sixth hue is ever generated");
  assert.match(html, /<text class="chart-donut__total"[^>]*>1,562<\/text>/);

  // Dark mode keeps the series identity: every slot used has a dark override.
  const darkBlock = html.slice(html.indexOf('[data-theme="dark"]'), html.indexOf("@media print"));
  for (const slot of ["1", "2", "3", "4", "5", "other"]) {
    assert.match(darkBlock, new RegExp(`--color-series-${slot}:`), `dark theme must define series-${slot}`);
  }
  assert.doesNotMatch(html, /NaN/);
});

test("monthly-client: charts and brief are omitted when their data is absent", () => {
  const html = renderVariant((d) => {
    d.totals.events_total = 0;
    d.totals.groups_total = 0;
    d.totals.by_channel = {};
    d.totals.by_day = {};
    d.totals.by_severity = {};
    d.groups = [];
    d.groups_collapsed = [];
  });
  assert.doesNotMatch(html, /<section class="incident-brief"/);
  assert.doesNotMatch(html, /<svg class="chart-line__svg"/);
  assert.doesNotMatch(html, /<svg class="chart-donut__svg"/);
  assert.doesNotMatch(html, /NaN/);
});

test("monthly-client: a single day draws no trend line but still briefs the day", () => {
  const html = renderVariant((d) => {
    d.totals.by_day = { "2026-04-16": { total: 1562, severities: { warning: 1562 } } };
  });
  assert.doesNotMatch(html, /<svg class="chart-line__svg"/, "one point is not a trend");
  assert.match(html, /2026-04-16 — 1,562 events \(100\.0% of the month\)/);
  assert.doesNotMatch(html, /NaN/);
});

test("monthly-client: one channel at 100% renders a single labelled segment", () => {
  const html = renderVariant((d) => { d.totals.by_channel = { php: 1562 }; });
  const segs = html.match(/<circle class="chart-donut__seg"/g) || [];
  assert.equal(segs.length, 1);
  assert.match(html, /<title>php: 1,562 \(100\.0%\)<\/title>/);
  assert.doesNotMatch(html, /chart-donut__legend-label">Other</);
});

test("monthly-client: older payloads without by_day or by_channel still render", () => {
  const html = renderToTmp(["--template", "monthly-client"], FIXTURE);
  assert.match(html, /<section class="incident-brief"/);
  assert.doesNotMatch(html, /<svg class="chart-line__svg"/, "sample.json has one day only");
  assert.match(html, /<svg class="chart-donut__svg"/);
  assert.doesNotMatch(html, /NaN/);
});

// Chart labels, issue summaries, and fingerprints come from parsed log
// content. Nothing on this page may reach the DOM unescaped.
test("monthly-client: hostile log text never renders as markup in the brief or charts", () => {
  const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const html = renderVariant((d) => {
    for (const g of [...d.groups, ...d.groups_collapsed]) {
      g.summary = `Undefined index ${hostile}`;
      g.fingerprint = hostile;
      g.channel = hostile;
      g.samples = [hostile];
    }
    d.totals.by_channel = { [hostile]: 900, php: 662 };
    d.totals.by_day[hostile] = { total: 4, severities: { warning: 4 } };
    d.meta.month_label = `April ${hostile}`;
    d.tickets[0].title = hostile;
    d.tickets[0].description = hostile;
    d.tickets[0].sample = hostile;
  });
  assert.doesNotMatch(html, /<script>alert\(1\)/);
  assert.doesNotMatch(html, /<img\s+src=x\s+onerror/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, "payload survives only as escaped text");
  // and it reached every surface it was supposed to, escaped
  assert.match(html, /incident-brief__value">Undefined index &lt;script&gt;/);
  assert.match(html, /chart-donut__legend-label">&lt;script&gt;/);
  assert.match(html, /aria-label="Events by channel · &lt;script&gt;/);
  assert.match(html, /<title>&lt;script&gt;alert\(1\)&lt;\/script&gt;&lt;img src&#x3D;x onerror&#x3D;alert\(2\)&gt;: 900/);
  assert.match(html, /A further 11 events carried no parseable timestamp/,
    "a non-date day key joins the 7 already undated, never plotted");
  // The only unescaped values in this template are renderer-generated.
  const src = readFileSync(resolve(HERE, "..", "templates", "monthly-client.hbs"), "utf8");
  assert.deepEqual(src.match(/\{\{\{[^}]+\}\}\}/g), ["{{{css}}}"]);
  for (const partial of ["chart-donut", "chart-line", "incident-brief"]) {
    const p = readFileSync(resolve(HERE, "..", "templates", "partials", `${partial}.hbs`), "utf8");
    assert.doesNotMatch(p, /\{\{\{/, `${partial} must not use unescaped output`);
  }
});

test("chart partials are static: no script, no tooltip handler", () => {
  for (const partial of ["chart-donut", "chart-line", "incident-brief"]) {
    const p = readFileSync(resolve(HERE, "..", "templates", "partials", `${partial}.hbs`), "utf8");
    assert.doesNotMatch(p, /<script/i, `${partial} must render identically in the PDF`);
  }
});
