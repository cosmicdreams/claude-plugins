"""Unit tests for drover.scripts.jira_recs (slice 11)."""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from dataclasses import asdict

HERE = pathlib.Path(__file__).resolve()
SCRIPTS = HERE.parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location(
    "drover_jira_recs", SCRIPTS / "jira_recs.py",
)
jira_recs = importlib.util.module_from_spec(spec)
sys.modules["drover_jira_recs"] = jira_recs
spec.loader.exec_module(jira_recs)


def _g(**kw):
    """Synthesize a minimal aggregation group dict."""
    return {
        "fingerprint": kw.get("fp", "abc123def456"),
        "channel": kw.get("channel", "entity_embed"),
        "severity": kw.get("severity", "warning"),
        "count": kw.get("count", 100),
        "summary": kw.get("summary", "Something went wrong"),
        "first_seen": kw.get("first_seen", "2026-04-01T00:00:00+00:00"),
        "last_seen": kw.get("last_seen", "2026-04-30T00:00:00+00:00"),
        "samples": kw.get("samples", ["raw line"]),
    }


# --- Priority heuristic ---------------------------------------------------

class PrioritySuggestionTests(unittest.TestCase):
    def test_critical_severity_always_p0(self):
        self.assertEqual(
            jira_recs._suggest_priority("critical", 1, 100_000),
            "P0",
        )
        self.assertEqual(
            jira_recs._suggest_priority("emergency", 1, 100_000),
            "P0",
        )

    def test_error_with_high_share_is_p0(self):
        self.assertEqual(
            jira_recs._suggest_priority("error", 10_000, 100_000), "P0",
        )

    def test_error_with_low_share_is_p1(self):
        self.assertEqual(
            jira_recs._suggest_priority("error", 100, 100_000), "P1",
        )

    def test_unknown_severity_with_high_volume_escalates(self):
        # 30% share -> P1 even with unknown severity
        self.assertEqual(
            jira_recs._suggest_priority(
                "unknown", 30_000, 100_000,
            ),
            "P1",
        )

    def test_unknown_severity_with_low_volume_is_p3(self):
        self.assertEqual(
            jira_recs._suggest_priority(
                "unknown", 10, 100_000,
            ),
            "P3",
        )


# --- Title cleanup --------------------------------------------------------

class TitleSuggestionTests(unittest.TestCase):
    def test_strips_request_ids_and_urls(self):
        title = jira_recs._suggest_title(
            "user",
            'Login attempt failed from 1.2.3.4. '
            'request_id="v-abcd-1234-efgh-5678" reading https://example.com/x',
        )
        self.assertNotIn("request_id", title)
        self.assertNotIn("https://", title)

    def test_truncates_long_summaries(self):
        long_summary = "x" * 500
        title = jira_recs._suggest_title("ch", long_summary)
        self.assertLessEqual(len(title), 110)
        self.assertTrue(title.endswith("…"))

    def test_prepends_channel_when_present(self):
        self.assertEqual(
            jira_recs._suggest_title("simple_cron", "Cron failed"),
            "[simple_cron] Cron failed",
        )

    def test_no_channel(self):
        self.assertEqual(
            jira_recs._suggest_title(None, "X happened"),
            "X happened",
        )

    def test_empty_summary_falls_back(self):
        self.assertEqual(
            jira_recs._suggest_title(None, ""),
            "Application error",
        )


# --- from_groups ----------------------------------------------------------

class FromGroupsTests(unittest.TestCase):
    def test_filters_by_min_count(self):
        groups = [_g(count=200, fp="big"), _g(count=10, fp="tiny")]
        specs = jira_recs.from_groups(
            groups, project_slug="x", env="prod",
            month_label="April 2026", total_events=210,
            min_count=50,
        )
        self.assertEqual(len(specs), 1)
        self.assertEqual(specs[0].fingerprint, "big")

    def test_caps_at_top_n(self):
        groups = [_g(count=1000 - i, fp=f"fp{i}") for i in range(10)]
        specs = jira_recs.from_groups(
            groups, project_slug="x", env="prod",
            month_label="April 2026", total_events=10_000,
            top_n=3,
        )
        self.assertEqual(len(specs), 3)

    def test_label_set_includes_drover_metadata(self):
        groups = [_g(count=200, fp="x", channel="user", severity="error")]
        specs = jira_recs.from_groups(
            groups, project_slug="pncb", env="prod",
            month_label="April 2026", total_events=1000,
        )
        labels = specs[0].labels
        self.assertIn("drover-suggested", labels)
        self.assertIn("drover-project-pncb", labels)
        self.assertIn("drover-env-prod", labels)
        self.assertIn("drover-channel-user", labels)
        self.assertIn("drover-severity-error", labels)

    def test_channel_with_special_chars_slugified(self):
        groups = [_g(count=200, channel="access denied", severity="notice")]
        specs = jira_recs.from_groups(
            groups, project_slug="x", env="prod",
            month_label="April 2026", total_events=1000,
        )
        labels = specs[0].labels
        self.assertIn("drover-channel-access-denied", labels)

    def test_extra_labels_appended(self):
        groups = [_g(count=200)]
        specs = jira_recs.from_groups(
            groups, project_slug="x", env="prod",
            month_label="April 2026", total_events=1000,
            extra_labels=["report-monthly-client", "drover-2.0"],
        )
        self.assertIn("report-monthly-client", specs[0].labels)
        self.assertIn("drover-2.0", specs[0].labels)


# --- Renderer -------------------------------------------------------------

class RenderMarkdownTests(unittest.TestCase):
    def test_empty_specs_emits_no_tickets_line(self):
        out = jira_recs.render_markdown([])
        self.assertIn("No tickets recommended", out)

    def test_renders_table_and_details(self):
        specs = [
            jira_recs.TicketSpec(
                fingerprint="abc", title="[user] failed login",
                description="Body text.", priority="P1",
                labels=["drover-suggested"],
                channel="user", severity="error", count=500,
            ),
        ]
        out = jira_recs.render_markdown(specs)
        self.assertIn("| # | Priority | Title", out)
        self.assertIn("**P1**", out)
        self.assertIn("[user] failed login", out)
        self.assertIn("Body text.", out)
        self.assertIn("`drover-suggested`", out)


# --- Sidecar I/O ----------------------------------------------------------

class SidecarTests(unittest.TestCase):
    def test_writes_json_and_returns_path(self):
        with tempfile.TemporaryDirectory() as td:
            report = pathlib.Path(td) / "april.md"
            report.write_text("# Report\n")
            specs = [
                jira_recs.TicketSpec(
                    fingerprint="abc", title="t", description="d",
                    priority="P0", labels=["x"],
                ),
            ]
            sidecar = jira_recs.write_sidecar(specs, report)
            self.assertEqual(
                sidecar.name, "april.md.tickets.json",
            )
            data = json.loads(sidecar.read_text())
            self.assertEqual(data[0]["fingerprint"], "abc")


if __name__ == "__main__":
    unittest.main()
