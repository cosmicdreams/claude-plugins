// test-lab check: every ported rule has a passing fixture (the clean suite, including the standard's own
// exceptions) and a failing fixture (one edit to the clean suite). Optional: zero unexpected findings on
// exported example suites named by TEST_LAB_QA_EXAMPLES with a triage file TEST_LAB_QA_TRIAGE.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { checkSuite, loadRules, standardDrift, type CorpusCase } from '../../src/check/check.ts';
import { runCommand } from '../../src/commands.ts';

const CLEAN = join(import.meta.dirname, '../fixtures/check/clean');

function variant(edit: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'test-lab-check-'));
  cpSync(CLEAN, root, { recursive: true });
  edit(root);
  return root;
}
function replace(root: string, file: string, from: string, to: string): void {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  assert.ok(text.includes(from), `${file} lacks ${from}`);
  writeFileSync(path, text.replace(from, to));
}
function only(root: string, rule: string, corpus: CorpusCase[] | null = null): void {
  try {
    const report = checkSuite({ suiteRoot: root, corpus });
    assert.ok(report.findings.length > 0, `expected a ${rule} finding`);
    assert.deepEqual([...new Set(report.findings.map((f) => f.rule))], [rule], JSON.stringify(report.findings, null, 2));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('test-lab check: rules.json', () => {
  it('every rule records its source, check, advisory flag and the ported commit', () => {
    const rules = loadRules();
    assert.match(rules.standard.portedFrom, /^[0-9a-f]{40}$/);
    for (const r of rules.rules) {
      assert.ok(r.source.section && r.source.quote && r.check.how, r.id);
      assert.equal(r.blocking, false);
    }
    for (const id of ['TL-RETRIES-ZERO', 'TL-MOBILE-GUARD', 'TL-KNOWN-FAILURE', 'TL-UNDEFINED-PRIORITY', 'TL-CASESTEP-PROPOSAL'])
      assert.ok(rules.rules.some((r) => r.id === id), id);
  });
  it('drift: an unchanged standard is unchanged; a removed quote names its rule', () => {
    const rules = loadRules();
    const text = rules.rules.map((r) => `## ${r.source.section}\n${r.source.quote}\n`).join('\n');
    const changed = standardDrift(rules, text);
    assert.equal(changed.status, 'changed'); // the hash is of the real file, not this synthetic one
    assert.deepEqual(changed.driftedRules, []);
    const without = standardDrift(rules, text.replace(rules.rules.find((r) => r.id === 'QA-NO-WAIT-TIMEOUT')!.source.quote, 'waits are fine'));
    assert.deepEqual(without.driftedRules, ['QA-NO-WAIT-TIMEOUT']);
    assert.match(without.warning ?? '', /QA-NO-WAIT-TIMEOUT/);
    assert.equal(standardDrift(rules, null).status, 'not-checked');
  });
});

describe('test-lab check: passing fixtures', () => {
  it('the clean suite, with the standard\'s own exceptions, has no findings', () => {
    const report = checkSuite({ suiteRoot: CLEAN });
    assert.deepEqual(report.findings, []);
    assert.equal(report.advisory, true);
    assert.deepEqual(report.files, { spec: 1, page: 2, fixture: 1, config: 1 });
  });
  it('a matching corpus adds no findings', () => {
    const corpus: CorpusCase[] = [{ id: 'C1001', tag: 'p2', defaulted: false, widths: [1440] }, { id: 'C1002', tag: 'p3', defaulted: true, widths: [1440, 1280] }];
    assert.deepEqual(checkSuite({ suiteRoot: CLEAN, corpus }).findings, []);
  });
});

describe('test-lab check: the command and the proposal boundary', () => {
  it('`test-lab check --json` reports the clean suite as advisory with no findings', async () => {
    const out = await runCommand(['check', '--suite', CLEAN, '--json']);
    assert.equal(out.exitCode, 0);
    assert.deepEqual((out.output as { findings: unknown[] }).findings, []);
    assert.equal((out.output as { advisory: boolean }).advisory, true);
  });
  it('TL-CASESTEP-PROPOSAL: a spec without caseStep() or the kit is never flagged; that is a proposal to QA, not a rule', () => {
    const spec = readFileSync(join(CLEAN, 'tests/footer.spec.ts'), 'utf8');
    assert.doesNotMatch(spec, /caseStep|support\/test-lab/);
    assert.deepEqual(checkSuite({ suiteRoot: CLEAN }).findings, []);
    assert.equal(loadRules().rules.find((r) => r.id === 'TL-CASESTEP-PROPOSAL')?.check.applies, 'none');
  });
  it('a changed standard warns, naming the rules whose quoted text moved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-lab-standard-'));
    try {
      const rules = loadRules();
      writeFileSync(join(dir, 'CLAUDE.md'), rules.rules.filter((r) => r.id !== 'QA-NO-PARTIAL-CLASS').map((r) => `## ${r.source.section}\n${r.source.quote}\n`).join('\n'));
      const out = await runCommand(['check', '--suite', CLEAN, '--standard', join(dir, 'CLAUDE.md'), '--json']);
      const standard = (out.output as { standard: { status: string; driftedRules: string[]; warning: string } }).standard;
      assert.equal(standard.status, 'changed');
      assert.deepEqual(standard.driftedRules, ['QA-NO-PARTIAL-CLASS']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('test-lab check: failing fixtures, one per rule', () => {
  it('QA-BASE-IMPORT: test imported from @playwright/test', () => only(variant((r) => replace(r, 'tests/footer.spec.ts', "from '../fixtures/base'", "from '@playwright/test'")), 'QA-BASE-IMPORT'));
  it('QA-NO-NEW-PAGE: a page object constructed in the spec', () => only(variant((r) => {
    replace(r, 'tests/footer.spec.ts', "import { test, expect } from '../fixtures/base';", "import { test, expect } from '../fixtures/base';\nimport { FooterPage } from '../pages/FooterPage';");
    replace(r, 'tests/footer.spec.ts', "await footer.goto('/about');", "await new FooterPage(page).goto('/about');");
  }), 'QA-NO-NEW-PAGE'));
  it('QA-READONLY-LOCATORS: a getter for a parameterless locator', () => only(variant((r) => replace(r, 'pages/FooterPage.ts', '  /** Parameterized', "  get copyright() { return this.footer.getByText('Copyright'); }\n\n  /** Parameterized")), 'QA-READONLY-LOCATORS'));
  it('QA-READONLY-LOCATORS: a mutable exposed locator property', () => only(variant((r) => replace(r, 'pages/FooterPage.ts', 'readonly links: Locator;', 'links: Locator;')), 'QA-READONLY-LOCATORS'));
  it('QA-NO-WAIT-TIMEOUT: an unexplained wait', () => only(variant((r) => replace(r, 'tests/footer.spec.ts', "    // The banner animates in on a fixed 300 ms debounce with no event to wait for.\n", '')), 'QA-NO-WAIT-TIMEOUT'));
  it('QA-WAIT-FOR-FUNCTION-ARG: options passed as the page argument', () => only(variant((r) => replace(r, 'tests/footer.spec.ts', ', null, { timeout: 5_000 })', ', { timeout: 5_000 })')), 'QA-WAIT-FOR-FUNCTION-ARG'));
  it('QA-WEB-FIRST: an assertion on text already read out', () => only(variant((r) => replace(r, 'tests/footer.spec.ts', "await expect(footer.logo).toHaveAttribute('href', '/');", "const href = await footer.logo.getAttribute('href');\n    expect(href).toBe('/');")), 'QA-WEB-FIRST'));
  it('QA-WEB-FIRST: an awaited read inside expect()', () => only(variant((r) => replace(r, 'tests/footer.spec.ts', 'await expect.poll(async () => footer.links.count()).toBeGreaterThan(1);', 'expect(await footer.links.count()).toBeGreaterThan(1);')), 'QA-WEB-FIRST'));
  it('QA-NO-PARTIAL-CLASS: a [class*= selector', () => only(variant((r) => replace(r, 'tests/footer.spec.ts', '[class="Footer_footer__a1"]', '[class*="Footer_footer"]')), 'QA-NO-PARTIAL-CLASS'));
  it('QA-TITLE-TAGS: no case ID', () => only(variant((r) => replace(r, 'tests/footer.spec.ts', "'C1001 - Verify", "'Verify")), 'QA-TITLE-TAGS'));
  it('QA-TITLE-TAGS: no @regression', () => only(variant((r) => replace(r, 'tests/footer.spec.ts', "{ tag: ['@regression', '@p2'] }", "{ tag: ['@p2'] }")), 'QA-TITLE-TAGS'));
  it('QA-TITLE-TAGS: a priority tag outside @p1-@p4', () => only(variant((r) => replace(r, 'tests/footer.spec.ts', "'@regression', '@p2'", "'@regression', '@p5'")), 'QA-TITLE-TAGS'));
  it('QA-TITLE-TAGS: a tag that is not the priority label\'s (priority_id 3, "2 - Short Regression", is @p2)', () =>
    only(variant(() => {}), 'QA-TITLE-TAGS', [{ id: 'C1001', tag: 'p1', defaulted: false, widths: [1440] }]));
  it('QA-SKIP-GAP: a test.fail with no gap entry', () => only(variant((r) => writeFileSync(join(r, 'COVERAGE-GAPS.md'), '# Coverage gaps\n')), 'QA-SKIP-GAP'));
  it('QA-SKIP-GAP: a test.fail with no reason', () => only(variant((r) => replace(r, 'tests/footer.spec.ts', "test.fail(true, 'No live alert banner instance: the site-wide flag is off');", 'test.fail();')), 'QA-SKIP-GAP'));
  it('QA-SKIP-GAP: an undocumented viewport guard is a silent skip', () => only(variant((r) => replace(r, 'tests/footer.spec.ts', '    // Desktop-only: the footer menu collapses on mobile (< 768px).\n    // C1003 covers the mobile layout.\n', '')), 'QA-SKIP-GAP'));
  it('QA-CONFIG-BASELINE: an undocumented deviation', () => only(variant((r) => replace(r, 'playwright.config.ts', 'workers: 1,', 'workers: 4,')), 'QA-CONFIG-BASELINE'));
  it('QA-CONFIG-BASELINE: a missing baseline setting', () => only(variant((r) => replace(r, 'playwright.config.ts', "    video: 'retain-on-failure',\n", '')), 'QA-CONFIG-BASELINE'));
  it('QA-BROWSER-PROJECTS: a missing named project', () => only(variant((r) => replace(r, 'playwright.config.ts', "    { name: 'tablet-ipad', use: { ...devices['iPad (gen 7)'] } },\n", '')), 'QA-BROWSER-PROJECTS'));
  it('QA-SUITE-LAYOUT: no COVERAGE-GAPS.md', () => {
    const root = variant((r) => rmSync(join(r, 'COVERAGE-GAPS.md')));
    try {
      const rules = new Set(checkSuite({ suiteRoot: root }).findings.map((f) => f.rule));
      assert.ok(rules.has('QA-SUITE-LAYOUT'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('TL-MOBILE-GUARD: a guard that skips a configuration the case declares', () =>
    only(variant(() => {}), 'TL-MOBILE-GUARD', [{ id: 'C1002', tag: 'p3', defaulted: false, widths: [1440, 390] }]));
  it('TL-KNOWN-FAILURE: a test.fail spec bound to a corpus case', () =>
    only(variant(() => {}), 'TL-KNOWN-FAILURE', [{ id: 'C1004', tag: 'p3', defaulted: false, widths: [1440] }]));
});

const examples = process.env['TEST_LAB_QA_EXAMPLES'];
const triage = process.env['TEST_LAB_QA_TRIAGE'];
describe('test-lab check: QA example suites (optional)', { skip: examples === undefined || triage === undefined ? 'set TEST_LAB_QA_EXAMPLES and TEST_LAB_QA_TRIAGE' : false }, () => {
  it('every finding on each triaged suite is a recorded true departure; none is a checker bug', () => {
    const t = JSON.parse(readFileSync(triage!, 'utf8')) as { suites: { folder: string; truePositives: { rule: string; file: string; line: number }[] }[] };
    assert.ok(t.suites.length >= 2);
    for (const s of t.suites) {
      const root = join(examples!, s.folder);
      assert.ok(existsSync(root), root);
      const seen = checkSuite({ suiteRoot: root }).findings.map((f) => `${f.rule} ${f.file}:${f.line}`).sort();
      assert.deepEqual(seen, s.truePositives.map((f) => `${f.rule} ${f.file}:${f.line}`).sort(), s.folder);
    }
  });
});
