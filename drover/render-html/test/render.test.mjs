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
