"""Tests for test-lab:assess-accessibility's reducer, export reader and template sampler.

Fixture CSV headers are the literal headers Screaming Frog SEO Spider 25.1.0 wrote on
2026-11-24, including the UTF-8 byte-order mark.
"""
import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "skills" / "assess-accessibility" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import assess  # noqa: E402
import compare  # noqa: E402
import criteria as C  # noqa: E402
import frog_inputs  # noqa: E402
import templates  # noqa: E402

ORIGIN = "https://demo.ddev.site"
INTERNAL = ["Address", "Content Type", "Status Code", "Status", "Indexability", "Indexability Status",
            "Title 1", "Crawl Depth", "body_class 1"] + [f"{c} 1" for c in frog_inputs.INVENTORY]
A11Y = ["Address", "Content Type", "Status Code", "Status", "Indexability", "Indexability Status",
        "All Violations", "Best Practice Violations", "WCAG 2.0 A Violations", "WCAG 2.0 AA Violations",
        "WCAG 2.0 AAA Violations", "WCAG 2.1 A Violations", "WCAG 2.1 AA Violations", "WCAG 2.2 AA Violations",
        "PSI Request Status"]
ISSUE = ["Issue", "Address", "Location on Page", "Guidelines", "User Impact", "Priority", "Issue Description",
         "How To Fix", "Help URL"]
PAGES = {"/": ("path-frontpage", 0), "/news/a": ("page-node-type-article", 1),
         "/news/b": ("page-node-type-article", 1), "/about": ("page-node-type-page", 1)}


def write(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in header})


def help_url(rule):
    return f"https://dequeuniversity.com/rules/axe/4.10/{rule}?application=ScreamingFrog"


def make_export(folder, violations=(), incomplete=(), inventory=None, axe_ran=True, extra_inventory=None):
    folder = Path(folder)
    inv = {c: "0" for c in frog_inputs.INVENTORY} if inventory is None else inventory
    rows = []
    for path, (body, depth) in PAGES.items():
        r = {"Address": ORIGIN + path, "Content Type": "text/html; charset=utf-8", "Status Code": "200",
             "Status": "OK", "Title 1": f"Title {path}", "Crawl Depth": str(depth), "body_class 1": body}
        r.update({f"{k} 1": v for k, v in inv.items()})
        if extra_inventory and path in extra_inventory:
            r.update({f"{k} 1": v for k, v in extra_inventory[path].items()})
        rows.append(r)
    rows.append({"Address": ORIGIN + "/logo.png", "Content Type": "image/png", "Status Code": "200"})
    write(folder / "internal_all.csv", INTERNAL, rows)
    write(folder / "accessibility_all.csv", A11Y,
          [{"Address": ORIGIN + p, "All Violations": "0" if axe_ran else ""} for p in PAGES])
    write(folder / "all_violations.csv", ISSUE, list(violations))
    write(folder / "all_incomplete.csv", ISSUE, list(incomplete))
    return folder


def violation(rule, path="/", guidelines="WCAG 2.1 AA", impact="Serious", issue=None):
    return {"Issue": issue or rule, "Address": ORIGIN + path, "Guidelines": guidelines, "User Impact": impact,
            "Help URL": help_url(rule)}


def pages_doc():
    reps, skipped = templates.choose(frog_inputs.load(TMP.name)["pages"], 25)
    return {"origin": ORIGIN, "pages": reps, "templates_not_sampled": skipped, "pages_covered_by_sampled_templates": 4}


def check_rows(criterion, result="pass", browsers=("chromium", "firefox", "webkit"), paths=None):
    paths = paths or ["/", "/news/a", "/about"]
    return [{"criterion": criterion, "check": "c", "page": p, "browser": b, "viewport": "desktop", "result": result,
             "evidence": "{}"} for p in paths for b in browsers]


def run(violations=(), incomplete=(), checks=(), findings=(), manual=None, **kw):
    make_export(TMP.name, violations, incomplete, **kw)
    report = assess.reduce(frog_inputs.load(TMP.name), pages_doc(), list(checks), list(findings), manual or {})
    return report, {r["id"]: r for r in report["criteria"]}


TMP = None


class Base(unittest.TestCase):
    def setUp(self):
        global TMP
        TMP = tempfile.TemporaryDirectory()

    def tearDown(self):
        TMP.cleanup()


class ExportReader(Base):
    def test_missing_export_is_an_error_not_zero_issues(self):
        make_export(TMP.name)
        (Path(TMP.name) / "all_incomplete.csv").unlink()
        with self.assertRaisesRegex(frog_inputs.ExportError, "all_incomplete.csv"):
            frog_inputs.load(TMP.name)

    def test_blank_accessibility_counts_mean_axe_did_not_run(self):
        make_export(TMP.name, axe_ran=False)
        with self.assertRaisesRegex(frog_inputs.ExportError, "axe did not run"):
            frog_inputs.load(TMP.name)

    def test_only_html_200_pages_count(self):
        make_export(TMP.name)
        self.assertEqual(len(frog_inputs.load(TMP.name)["pages"]), 4)

    def test_rule_id_and_criteria_parsing(self):
        self.assertEqual(frog_inputs.rule_id(help_url("color-contrast")), "color-contrast")
        self.assertEqual(frog_inputs.criteria_in("WCAG 2.1 AA, 1.4.3, 1.4.10"), ["1.4.10", "1.4.3"])
        self.assertEqual(frog_inputs.criteria_in("WCAG 2.1 AA"), [])


class Templates(Base):
    def test_drupal_body_class_groups_and_picks_shallowest(self):
        make_export(TMP.name)
        reps, skipped = templates.choose(frog_inputs.load(TMP.name)["pages"], 25)
        self.assertEqual({r["template"]: r["count"] for r in reps},
                         {"node:article": 2, "front": 1, "node:page": 1})
        self.assertEqual(skipped, [])

    def test_limit_reports_unsampled_templates(self):
        make_export(TMP.name)
        reps, skipped = templates.choose(frog_inputs.load(TMP.name)["pages"], 1)
        self.assertEqual([r["template"] for r in reps], ["node:article"])
        self.assertEqual(len(skipped), 2)


class Reducer(Base):
    def test_every_run_has_fifty_rows(self):
        report, _ = run()
        self.assertEqual(len(report["criteria"]), 50)
        self.assertEqual(sum(report["summary"].values()), 50)

    def test_axe_violation_fails_mapped_criterion_with_page_breadth(self):
        _, rows = run([violation("color-contrast", "/"), violation("color-contrast", "/about")])
        r = rows["1.4.3"]
        self.assertEqual(r["status"], "not_compliant")
        self.assertEqual(r["pages_affected"], 2)
        self.assertEqual(r["severity"], "High")

    def test_guidelines_column_overrides_rule_map(self):
        _, rows = run([violation("color-contrast", guidelines="WCAG 2.1 AA 1.4.11")])
        self.assertEqual(rows["1.4.11"]["status"], "not_compliant")
        self.assertNotEqual(rows["1.4.3"]["status"], "not_compliant")

    def test_best_practice_rule_is_only_a_lead(self):
        _, rows = run([violation("empty-heading", guidelines="Best Practice")])
        self.assertEqual(rows["2.4.6"]["status"], "needs_manual_check")
        self.assertIn("empty-heading", rows["2.4.6"]["evidence"])

    def test_axe_incomplete_is_a_lead_not_a_failure(self):
        _, rows = run(incomplete=[violation("color-contrast")])
        self.assertEqual(rows["1.4.3"]["status"], "needs_manual_check")
        self.assertIn("could not decide", rows["1.4.3"]["evidence"])

    def test_clean_automated_results_never_pass_page_titled(self):
        _, rows = run()
        self.assertEqual(rows["2.4.2"]["status"], "needs_manual_check")

    def test_parsing_passes_by_the_standard(self):
        _, rows = run([violation("duplicate-id", guidelines="WCAG 2.0 A 4.1.1")])
        self.assertEqual(rows["4.1.1"]["status"], "compliant")

    def test_language_of_page_passes_site_wide(self):
        _, rows = run()
        self.assertEqual(rows["3.1.1"]["status"], "compliant")
        _, rows = run([violation("html-has-lang", "/about")])
        self.assertEqual(rows["3.1.1"]["status"], "not_compliant")

    def test_media_criteria_not_applicable_only_when_inventory_proves_absence(self):
        _, rows = run()
        self.assertEqual(rows["1.2.2"]["status"], "not_applicable")
        _, rows = run(extra_inventory={"/about": {"video": "1"}})
        self.assertEqual(rows["1.2.2"]["status"], "needs_manual_check")
        _, rows = run(inventory={})
        self.assertEqual(rows["1.2.2"]["status"], "needs_manual_check")

    def test_decisive_check_needs_every_template_in_three_browsers(self):
        _, rows = run(checks=check_rows("1.3.4"))
        self.assertEqual(rows["1.3.4"]["status"], "compliant")
        _, rows = run(checks=check_rows("1.3.4", browsers=("chromium", "firefox")))
        self.assertEqual(rows["1.3.4"]["status"], "needs_manual_check")
        _, rows = run(checks=check_rows("1.3.4", paths=["/", "/news/a"]))
        self.assertEqual(rows["1.3.4"]["status"], "needs_manual_check")
        _, rows = run(checks=check_rows("1.3.4") + check_rows("1.3.4", "inconclusive", ("webkit",), ["/"]))
        self.assertEqual(rows["1.3.4"]["status"], "needs_manual_check")

    def test_non_decisive_passing_check_is_a_lead(self):
        _, rows = run(checks=check_rows("2.4.7"))
        self.assertEqual(rows["2.4.7"]["status"], "needs_manual_check")
        self.assertIn("Browser checks passed", rows["2.4.7"]["evidence"])

    def test_browser_check_failure_fails_unless_dismissed(self):
        fail = check_rows("2.4.7", "fail", ("firefox",), ["/about"])
        _, rows = run(checks=fail)
        self.assertEqual(rows["2.4.7"]["status"], "not_compliant")
        self.assertEqual(rows["2.4.7"]["templates_affected"], 1)
        manual = {"dismissals": [{"criterion": "2.4.7", "page": "/about", "reason": "iframe"}]}
        _, rows = run(checks=fail, manual=manual)
        self.assertEqual(rows["2.4.7"]["status"], "needs_manual_check")
        self.assertIn("dismissed", rows["2.4.7"]["evidence"])

    def test_open_findings_fail_closed_ones_do_not(self):
        f = [{"key": "T-1", "summary": "Focus lost", "criteria": ["2.4.3"], "severity": "Critical", "status": "Open"},
             {"key": "T-2", "summary": "Fixed", "criteria": ["2.4.4"], "status": "Done"}]
        _, rows = run(findings=f)
        self.assertEqual(rows["2.4.3"]["status"], "not_compliant")
        self.assertEqual(rows["2.4.3"]["severity"], "Critical")
        self.assertEqual(rows["2.4.4"]["status"], "needs_manual_check")

    def test_manual_review_decides_and_automated_failure_wins_conflicts(self):
        manual = {"reviews": [{"criterion": "2.4.2", "verdict": "pass", "reviewer": "R", "date": "2026-11-24"},
                              {"criterion": "1.4.3", "verdict": "pass", "reviewer": "R", "date": "2026-11-24"}]}
        report, rows = run([violation("color-contrast")], manual=manual)
        self.assertEqual(rows["2.4.2"]["status"], "compliant")
        self.assertEqual(rows["1.4.3"]["status"], "not_compliant")
        self.assertEqual(len(report["manual_conflicts"]), 1)

    def test_score_never_claims_conformance_from_automation(self):
        report, _ = run(checks=sum((check_rows(sc) for sc in C.DECISIVE_CHECKS), []))
        s = report["score"]
        self.assertEqual(s["verdict"], "Conformance not established")
        self.assertEqual(s["failing"], 0)
        self.assertLess(s["proven"], 25)
        self.assertEqual(s["assurance"], round(s["proven"] / 50, 2))

    def test_any_failure_means_does_not_conform(self):
        report, _ = run([violation("image-alt")])
        self.assertEqual(report["score"]["verdict"], "Does not conform")

    def test_all_manual_passes_conform(self):
        manual = {"reviews": [{"criterion": c, "verdict": "pass", "reviewer": "R", "date": "2026-11-24"} for c in C.IDS]}
        report, _ = run(manual=manual)
        self.assertEqual(report["score"]["verdict"], "Conforms")


class Outputs(Base):
    def test_cli_writes_report_html_json_and_worksheet(self):
        make_export(TMP.name)
        out = Path(TMP.name) / "out"
        checks = Path(TMP.name) / "checks"
        checks.mkdir()
        (checks / "checks.json").write_text(json.dumps(check_rows("1.3.4")))
        pages = Path(TMP.name) / "pages.json"
        pages.write_text(json.dumps(pages_doc()))
        assess.main(["--frog", TMP.name, "--pages", str(pages), "--checks", str(checks), "--out", str(out),
                     "--site", "demo.ddev.site", "--run-date", "2026-11-24", "--meta", "/nonexistent"])
        html = (out / "report.html").read_text()
        self.assertIn("demo.ddev.site", html)
        self.assertIn("Conformance to WCAG 2.1 Level AA not yet established", html)
        self.assertEqual(html.count('class="tr-c '), 50)
        self.assertIn("## 2.4.2 Page Titled", (out / "manual-worksheet.md").read_text())
        self.assertEqual(len(json.loads((out / "report.json").read_text())["criteria"]), 50)

    def test_compare_reports_status_changes_and_coverage(self):
        before, _ = run([violation("color-contrast")])
        after, _ = run()
        for r in (before, after):
            r.update(site="demo", run_date="2026-11-24", baseline="")
        md = compare.markdown(before, after)
        self.assertIn("| 1.4.3 Contrast (Minimum) | Not compliant | Needs manual check |", md)
        self.assertIn("Pages crawled", md)


if __name__ == "__main__":
    unittest.main()
