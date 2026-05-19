"""Unit tests for drover.scripts.report (slice 8)."""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from datetime import date

HERE = pathlib.Path(__file__).resolve()
SCRIPTS = HERE.parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location(
    "drover_report", SCRIPTS / "report.py",
)
report = importlib.util.module_from_spec(spec)
sys.modules["drover_report"] = report
spec.loader.exec_module(report)


# --- Helpers --------------------------------------------------------------

def _make_project(td: pathlib.Path, *, project_name: str = "pncb"):
    """Bootstrap a project tree with a manifest, a coverage ledger,
    and one drupal-watchdog log file."""
    (td / ".drover").mkdir(parents=True)
    (td / ".drover" / "manifest.json").write_text(json.dumps({
        "project": project_name,
        "hosting": "drupal-acquia",
        "acquia": {
            "app_uuid": "u",
            "app_name": "Test Project",
            "envs": [{
                "name": "prod",
                "env_id": "e",
                "default_domain": "x",
                "types": ["drupal-watchdog"],
            }],
        },
    }))
    (td / "2026" / "04").mkdir(parents=True)
    log = td / "2026" / "04" / "2026-04-15.prod.drupal-watchdog.log"
    log.write_text(
        "Apr 15 00:00:00 host pncb: "
        "https://x.org|1|entity_embed|1.2.3.4|/path|0||"
        "Invalid display settings encountered.\n"
        "Apr 15 00:01:00 host pncb: "
        "https://x.org|1|entity_embed|1.2.3.4|/path|0||"
        "Invalid display settings encountered.\n"
        "Apr 15 00:02:00 host pncb: "
        "https://x.org|1|simple_cron|||/cron|0||Cron run completed\n"
    )
    (td / ".drover" / "coverage.json").write_text(json.dumps({
        "2026-04-15": {
            "prod.drupal-watchdog": {
                "state": "present",
                "bytes": 100,
                "updated_at": "2026-04-15T01:00:00+00:00",
            },
        },
    }))


# --- Date helpers ---------------------------------------------------------

class MonthHelpersTests(unittest.TestCase):
    def test_parse_month_april(self):
        f, t = report.parse_month("2026-04")
        self.assertEqual(f, date(2026, 4, 1))
        self.assertEqual(t, date(2026, 4, 30))

    def test_parse_month_december(self):
        f, t = report.parse_month("2026-12")
        self.assertEqual(t, date(2026, 12, 31))

    def test_parse_month_february_leap(self):
        f, t = report.parse_month("2024-02")
        self.assertEqual(t, date(2024, 2, 29))

    def test_prior_month_jan(self):
        self.assertEqual(report.prior_month(2026, 1), (2025, 12))

    def test_prior_month_normal(self):
        self.assertEqual(report.prior_month(2026, 5), (2026, 4))


# --- Format helpers -------------------------------------------------------

class FormatTests(unittest.TestCase):
    def test_int_thousands(self):
        self.assertEqual(report._fmt_int(12345), "12,345")

    def test_pct_signs(self):
        self.assertEqual(report._fmt_pct(12.3), "+12.3%")
        self.assertEqual(report._fmt_pct(-5.5), "-5.5%")
        self.assertEqual(report._fmt_pct(0), "0.0%")
        self.assertEqual(report._fmt_pct(None), "—")

    def test_trend_arrow(self):
        self.assertEqual(report._trend_arrow({"is_new": True}), "🆕")
        self.assertEqual(report._trend_arrow({"delta_count": 5}), "↑")
        self.assertEqual(report._trend_arrow({"delta_count": -5}), "↓")
        self.assertEqual(report._trend_arrow({"delta_count": 0}), "·")
        self.assertEqual(report._trend_arrow(None), "")

    def test_truncate(self):
        self.assertEqual(report._truncate("hello", 10), "hello")
        self.assertEqual(report._truncate("hello world", 5), "hell…")


# --- generate_report end-to-end (no AI) ---------------------------------

class GenerateReportTests(unittest.TestCase):
    def test_monthly_client_renders(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            md, summary, _tickets = report.generate_report(
                root, env="prod", month="2026-04",
                template="monthly-client",
                prior_month_str=None,
            )
            self.assertIn("# pncb — Application Error Report", md)
            self.assertIn("April 2026", md)
            self.assertIn("Top issues", md)
            self.assertIn("Severity distribution", md)
            self.assertEqual(summary["events_total"], 3)
            self.assertGreaterEqual(summary["groups_total"], 1)

    def test_triage_brief_renders(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            md, summary, _tickets = report.generate_report(
                root, env="prod", month="2026-04",
                template="triage-brief",
            )
            self.assertIn("Triage Brief", md)
            self.assertIn("entity_embed", md)
            # Sample raw line should appear in fenced block
            self.assertIn("Sample lines", md)

    def test_jira_ready_renders(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            md, summary, _tickets = report.generate_report(
                root, env="prod", month="2026-04",
                template="jira-ready",
            )
            self.assertIn("JIRA-Ready Issues", md)
            self.assertIn("Title:", md)
            self.assertIn("Drover fingerprint:", md)

    def test_unknown_template_raises(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            with self.assertRaises(ValueError):
                report.generate_report(
                    root, env="prod", month="2026-04",
                    template="bogus",
                )

    def test_missing_manifest_raises(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(FileNotFoundError):
                report.generate_report(
                    pathlib.Path(td), env="prod", month="2026-04",
                )

    def test_unknown_env_raises(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            with self.assertRaises(ValueError):
                report.generate_report(
                    root, env="stage", month="2026-04",
                )

    def test_zero_events_renders_clean_summary(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            # Look at a different month so logs aren't picked up
            md, summary, _tickets = report.generate_report(
                root, env="prod", month="2026-05",
            )
            self.assertEqual(summary["events_total"], 0)
            self.assertIn("No application errors", md)

    def test_partial_coverage_surfaces_warning(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            # Add a fetch-failed entry for a day we expect
            cov = json.loads(
                (root / ".drover" / "coverage.json").read_text(),
            )
            cov["2026-04-16"] = {
                "prod.drupal-watchdog": {
                    "state": "fetch-failed", "reason": "timeout",
                },
            }
            (root / ".drover" / "coverage.json").write_text(json.dumps(cov))
            md, summary, _tickets = report.generate_report(
                root, env="prod", month="2026-04",
            )
            self.assertIn("⚠ **Coverage:", md)
            self.assertIn("Days affected by retrieval gaps", md)
            self.assertLess(summary["coverage_pct"], 100.0)

    def test_prior_month_delta_when_data_exists(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            # Add a March log file with a copy of the same entity_embed
            # error to establish prior-month baseline.
            (root / "2026" / "03").mkdir(parents=True)
            (root / "2026" / "03" /
             "2026-03-15.prod.drupal-watchdog.log").write_text(
                "Mar 15 00:00:00 host pncb: "
                "https://x.org|1|entity_embed|1.2.3.4|/path|0||"
                "Invalid display settings encountered.\n"
            )
            md, summary, _tickets = report.generate_report(
                root, env="prod", month="2026-04",
                prior_month_str="2026-03",
            )
            # Trend column should now show direction
            self.assertTrue(
                "↑" in md or "·" in md or "🆕" in md,
                "prior data should populate trend column",
            )


# --- Stakeholder templates -------------------------------------------------

class RootCauseSummaryTests(unittest.TestCase):
    def test_renders_with_logo_and_pareto_headline(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            md, summary, tickets = report.generate_report(
                root, env="prod", month="2026-04",
                template="root-cause-summary", prior_month_str=None,
            )
            # Velir logo is embedded as data URI
            self.assertIn("data:image/png;base64,", md)
            self.assertIn("Root-Cause Summary", md)
            # Pareto-style headline
            self.assertIn("Headline", md)
            self.assertIn("Pareto", md)
            # Bar chart with channel labels
            self.assertIn("Top issues by share of volume", md)
            # Per-issue detail
            self.assertIn("What each top issue is", md)
            self.assertIn("Representative message", md)
            # JIRA recommendations + sidecar count
            self.assertIn("Recommended JIRA tickets", md)
            # Empty data set still renders something
            self.assertEqual(summary["events_total"], 3)
            self.assertEqual(summary["template"], "root-cause-summary")

    def test_no_tickets_flag_hides_section(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            md, summary, tickets = report.generate_report(
                root, env="prod", month="2026-04",
                template="root-cause-summary",
                include_tickets=False,
            )
            self.assertNotIn("Recommended JIRA tickets", md)
            self.assertEqual(tickets, [])


class CalendarBoundaryTests(unittest.TestCase):
    def test_renders_channel_bar_chart(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            md, summary, _ = report.generate_report(
                root, env="prod", month="2026-04",
                template="calendar-boundary", prior_month_str=None,
            )
            self.assertIn("data:image/png;base64,", md)
            self.assertIn("Calendar Window Report", md)
            self.assertIn("Events by channel", md)
            self.assertIn("Events by severity", md)
            # Channel chart includes the channels we put in the fixture
            self.assertIn("entity_embed", md)
            self.assertIn("simple_cron", md)
            # Daily volume chart
            self.assertIn("Daily volume", md)
            # JIRA recommendations
            self.assertIn("Recommended JIRA tickets", md)


def _make_busy_project(td: pathlib.Path):
    """Project fixture with enough events to cross the JIRA-recommendation
    min_count threshold (default 50)."""
    _make_project(td)
    log = (td / "2026" / "04" /
           "2026-04-15.prod.drupal-watchdog.log")
    extra_lines = []
    for i in range(60):
        extra_lines.append(
            f"Apr 15 00:{i:02d}:00 host pncb: "
            f"https://x.org|1|entity_embed|1.2.3.4|/path|0||"
            f"Invalid display settings encountered.\n"
        )
    log.write_text(log.read_text() + "".join(extra_lines))


class CliSidecarTests(unittest.TestCase):
    def test_cli_writes_sidecar_for_stakeholder_template(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_busy_project(root)
            rc = report.cli_main([
                "--project", str(root),
                "--month", "2026-04",
                "--template", "root-cause-summary",
                "--no-prior",
            ])
            self.assertEqual(rc, 0)
            md_path = root / "reports" / "2026-04-root-cause-summary.md"
            sidecar = md_path.with_suffix(".md.tickets.json")
            self.assertTrue(md_path.exists())
            self.assertTrue(sidecar.exists())
            data = json.loads(sidecar.read_text())
            self.assertGreaterEqual(len(data), 1)

    def test_cli_no_tickets_skips_sidecar(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_busy_project(root)
            rc = report.cli_main([
                "--project", str(root),
                "--month", "2026-04",
                "--template", "root-cause-summary",
                "--no-prior", "--no-tickets",
            ])
            self.assertEqual(rc, 0)
            md_path = root / "reports" / "2026-04-root-cause-summary.md"
            sidecar = md_path.with_suffix(".md.tickets.json")
            self.assertTrue(md_path.exists())
            self.assertFalse(sidecar.exists())


# --- CLI smoke test ------------------------------------------------------

class CliTests(unittest.TestCase):
    def test_cli_writes_report_to_default_path(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            rc = report.cli_main([
                "--project", str(root),
                "--env", "prod",
                "--month", "2026-04",
                "--no-prior",
            ])
            self.assertEqual(rc, 0)
            out = root / "reports" / "2026-04-monthly-client.md"
            self.assertTrue(out.exists())

    def test_cli_aborts_on_missing_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            rc = report.cli_main([
                "--project", td, "--env", "prod", "--month", "2026-04",
                "--no-prior",
            ])
            self.assertEqual(rc, 2)


# --- generate_data: structured aggregate for the HTML renderer -----------

class GenerateDataTests(unittest.TestCase):
    def _data(self, root):
        return report.generate_data(
            root, env="prod", month="2026-04", prior_month_str=None,
        )

    def test_schema_and_top_level_shape(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            data = self._data(root)
            self.assertEqual(
                data["drover_schema_version"],
                report.DROVER_DATA_SCHEMA_VERSION,
            )
            for key in (
                "generated_at", "meta", "coverage", "totals",
                "groups", "groups_collapsed", "disappeared_from_prior",
                "tickets",
            ):
                self.assertIn(key, data)

    def test_totals_match_generate_report(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            data = self._data(root)
            self.assertEqual(data["totals"]["events_total"], 3)
            self.assertGreaterEqual(data["totals"]["groups_total"], 1)
            self.assertEqual(data["meta"]["project"], "pncb")
            self.assertEqual(data["meta"]["env"], "prod")
            self.assertEqual(data["meta"]["month_label"], "April 2026")

    def test_json_serializable(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            data = self._data(root)
            # The CLI writes with default=str; the dict must round-trip.
            blob = json.dumps(data, indent=2, sort_keys=True, default=str)
            self.assertEqual(json.loads(blob)["totals"]["events_total"], 3)

    def test_deterministic(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            a = self._data(root)
            b = self._data(root)
            # generated_at is a wall-clock stamp; everything else is
            # a pure function of the logs on disk.
            a.pop("generated_at")
            b.pop("generated_at")
            self.assertEqual(
                json.dumps(a, sort_keys=True, default=str),
                json.dumps(b, sort_keys=True, default=str),
            )

    def test_no_tickets_flag(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            data = report.generate_data(
                root, env="prod", month="2026-04",
                prior_month_str=None, include_tickets=False,
            )
            self.assertEqual(data["tickets"], [])


class CliJsonFormatTests(unittest.TestCase):
    def test_cli_format_json_writes_json(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root)
            rc = report.cli_main([
                "--project", str(root),
                "--env", "prod",
                "--month", "2026-04",
                "--no-prior",
                "--format", "json",
            ])
            self.assertEqual(rc, 0)
            out = root / "reports" / "2026-04.json"
            self.assertTrue(out.exists())
            data = json.loads(out.read_text())
            self.assertEqual(
                data["drover_schema_version"],
                report.DROVER_DATA_SCHEMA_VERSION,
            )
            self.assertEqual(data["totals"]["events_total"], 3)


if __name__ == "__main__":
    unittest.main()
