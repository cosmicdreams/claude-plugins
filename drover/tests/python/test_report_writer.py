"""Unit tests for drover.scripts.report_writer (slice 7).

Covers input construction, output validation, and the coverage
summary helper. The actual LLM call is tested via a stub runner.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import unittest
from datetime import date

HERE = pathlib.Path(__file__).resolve()
SCRIPTS = HERE.parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location(
    "drover_report_writer", SCRIPTS / "report_writer.py",
)
rw = importlib.util.module_from_spec(spec)
sys.modules["drover_report_writer"] = rw
spec.loader.exec_module(rw)


SAMPLE_AGG = {
    "events_total": 1000,
    "groups": [
        {"fingerprint": "abc123", "channel": "entity_embed",
         "severity": "warning", "count": 700,
         "summary": "Invalid display settings",
         "first_seen": "2026-04-01T00:00:00+00:00",
         "last_seen": "2026-04-30T00:00:00+00:00",
         "samples": ["raw1", "raw2"]},
        {"fingerprint": "def456", "channel": "simple_cron",
         "severity": "error", "count": 200,
         "summary": "Database error",
         "first_seen": "2026-04-02T00:00:00+00:00",
         "last_seen": "2026-04-29T00:00:00+00:00",
         "samples": ["raw3"]},
        {"fingerprint": "ghi789", "channel": "php",
         "severity": "critical", "count": 100,
         "summary": "Uncaught exception",
         "first_seen": "2026-04-15T00:00:00+00:00",
         "last_seen": "2026-04-15T00:00:00+00:00",
         "samples": ["raw4"]},
    ],
    "by_severity": {"warning": 700, "error": 200, "critical": 100},
    "by_channel": {"entity_embed": 700, "simple_cron": 200, "php": 100},
    "by_day": {},
}


# --- Section catalogue ----------------------------------------------------

class SectionCatalogTests(unittest.TestCase):
    def test_known_sections_have_required_fields(self):
        for sid, spec_ in rw.KNOWN_SECTIONS.items():
            self.assertEqual(spec_.id, sid)
            self.assertIn(spec_.audience, {"stakeholder", "dev"})
            self.assertGreater(spec_.max_words, 0)

    def test_template_grouping(self):
        client = rw.all_sections_for_template("monthly-client")
        ids = {s.id for s in client}
        self.assertIn("executive_summary", ids)
        self.assertIn("top_issues", ids)
        triage = rw.all_sections_for_template("triage-brief")
        ids2 = {s.id for s in triage}
        self.assertIn("triage_brief", ids2)


# --- Coverage summary ----------------------------------------------------

class CoverageSummaryTests(unittest.TestCase):
    def test_full_coverage(self):
        cov = {
            "2026-04-01": {
                "prod.drupal-watchdog": {"state": "present"},
                "prod.apache-error": {"state": "present"},
            },
            "2026-04-02": {
                "prod.drupal-watchdog": {"state": "present"},
                "prod.apache-error": {"state": "present"},
            },
        }
        out = rw.coverage_summary(
            cov, env="prod",
            types=["drupal-watchdog", "apache-error"],
            from_date=date(2026, 4, 1), to_date=date(2026, 4, 2),
        )
        self.assertEqual(out["expected_days"], 4)
        self.assertEqual(out["present_days"], 4)
        self.assertEqual(out["missing_or_failed"], [])

    def test_partial_coverage(self):
        cov = {
            "2026-04-01": {
                "prod.drupal-watchdog": {"state": "present"},
            },
            "2026-04-02": {
                "prod.drupal-watchdog": {
                    "state": "fetch-failed", "reason": "timeout",
                },
            },
        }
        out = rw.coverage_summary(
            cov, env="prod",
            types=["drupal-watchdog"],
            from_date=date(2026, 4, 1), to_date=date(2026, 4, 3),
        )
        self.assertEqual(out["expected_days"], 3)
        self.assertEqual(out["present_days"], 1)
        self.assertEqual(len(out["missing_or_failed"]), 2)
        states = {m["state"] for m in out["missing_or_failed"]}
        self.assertEqual(states, {"fetch-failed", "pending"})


# --- Input builder -------------------------------------------------------

class BuildInputTests(unittest.TestCase):
    def test_executive_summary_trims_to_top_n(self):
        section = rw.KNOWN_SECTIONS["executive_summary"]
        payload = rw.build_section_input(
            section,
            project="pncb", env="prod", month_label="April 2026",
            from_date=date(2026, 4, 1), to_date=date(2026, 4, 30),
            aggregation=SAMPLE_AGG,
            coverage={"expected_days": 30, "present_days": 30,
                      "missing_or_failed": []},
        )
        self.assertEqual(payload["section"]["id"], "executive_summary")
        # default top_n trimming = 10; here we only have 3 groups
        self.assertEqual(len(payload["aggregation"]["groups"]), 3)
        self.assertEqual(payload["aggregation"]["events_total"], 1000)
        self.assertIn("by_severity", payload["aggregation"])

    def test_top_issues_uses_top_n_from_extra(self):
        section = rw.KNOWN_SECTIONS["top_issues"]
        # Inject extra top_n=2
        section.extra["top_n"] = 2
        payload = rw.build_section_input(
            section,
            project="pncb", env="prod", month_label="x",
            from_date=date(2026, 4, 1), to_date=date(2026, 4, 30),
            aggregation=SAMPLE_AGG,
            coverage={"expected_days": 30, "present_days": 30,
                      "missing_or_failed": []},
        )
        self.assertEqual(len(payload["aggregation"]["groups"]), 2)
        # Restore default
        section.extra["top_n"] = 5

    def test_disappeared_passed_through(self):
        section = rw.KNOWN_SECTIONS["trend_narrative"]
        agg = {**SAMPLE_AGG,
               "disappeared_from_prior": [
                   {"fingerprint": "old", "summary": "gone issue",
                    "prior_count": 30}
               ]}
        payload = rw.build_section_input(
            section,
            project="x", env="y", month_label="z",
            from_date=date(2026, 4, 1), to_date=date(2026, 4, 30),
            aggregation=agg,
            coverage={"expected_days": 30, "present_days": 30,
                      "missing_or_failed": []},
        )
        self.assertEqual(
            len(payload["aggregation"]["disappeared_from_prior"]), 1,
        )


# --- Validator ------------------------------------------------------------

class ValidateOutputTests(unittest.TestCase):
    def test_valid_executive_summary(self):
        out = rw.validate_agent_output(
            "executive_summary",
            json.dumps({
                "summary": "April had X events",
                "highlights": ["a", "b"],
            }),
        )
        self.assertEqual(out["summary"], "April had X events")

    def test_missing_required_key_raises(self):
        with self.assertRaises(rw.AgentOutputError):
            rw.validate_agent_output(
                "executive_summary",
                json.dumps({"summary": "x"}),  # missing 'highlights'
            )

    def test_invalid_json_raises(self):
        with self.assertRaises(rw.AgentOutputError):
            rw.validate_agent_output(
                "executive_summary", "not json",
            )

    def test_strips_code_fences(self):
        text = '```json\n{"summary": "x", "highlights": []}\n```'
        out = rw.validate_agent_output("executive_summary", text)
        self.assertEqual(out["summary"], "x")

    def test_dict_input_works(self):
        out = rw.validate_agent_output(
            "executive_summary",
            {"summary": "x", "highlights": ["a"]},
        )
        self.assertEqual(out["highlights"], ["a"])

    def test_self_reported_error_passes_through(self):
        out = rw.validate_agent_output(
            "executive_summary",
            json.dumps({"error": "events_total not present"}),
        )
        self.assertIn("error", out)

    def test_non_object_raises(self):
        with self.assertRaises(rw.AgentOutputError):
            rw.validate_agent_output(
                "executive_summary", json.dumps([1, 2, 3]),
            )


# --- synthesize_section with stub runner ---------------------------------

class SynthesizeSectionTests(unittest.TestCase):
    def test_runner_called_with_payload_and_output_validated(self):
        captured = {}

        def stub_runner(agent_name, payload):
            captured["agent"] = agent_name
            captured["payload"] = payload
            return json.dumps({
                "summary": "Synthetic prose for tests.",
                "highlights": ["h1"],
            })

        section = rw.KNOWN_SECTIONS["executive_summary"]
        payload = rw.build_section_input(
            section,
            project="pncb", env="prod", month_label="April 2026",
            from_date=date(2026, 4, 1), to_date=date(2026, 4, 30),
            aggregation=SAMPLE_AGG,
            coverage={"expected_days": 30, "present_days": 30,
                      "missing_or_failed": []},
        )
        out = rw.synthesize_section(
            "executive_summary", payload, runner=stub_runner,
        )
        self.assertEqual(captured["agent"], "drover:report-writer")
        self.assertEqual(out["summary"], "Synthetic prose for tests.")

    def test_runner_returning_invalid_json_propagates_error(self):
        def stub_runner(agent_name, payload):
            return "not json at all"
        section = rw.KNOWN_SECTIONS["coverage_caveat"]
        payload = rw.build_section_input(
            section,
            project="x", env="y", month_label="z",
            from_date=date(2026, 4, 1), to_date=date(2026, 4, 30),
            aggregation={"events_total": 0, "groups": [],
                         "by_severity": {}, "by_channel": {},
                         "by_day": {}},
            coverage={"expected_days": 30, "present_days": 30,
                      "missing_or_failed": []},
        )
        with self.assertRaises(rw.AgentOutputError):
            rw.synthesize_section(
                "coverage_caveat", payload, runner=stub_runner,
            )


# --- Agent definition file exists ----------------------------------------

class AgentDefinitionFileTests(unittest.TestCase):
    def test_agent_md_exists(self):
        agent_md = HERE.parents[2] / "agents" / "report-writer.md"
        self.assertTrue(agent_md.exists(), str(agent_md))

    def test_agent_md_has_frontmatter_name(self):
        agent_md = HERE.parents[2] / "agents" / "report-writer.md"
        text = agent_md.read_text()
        self.assertIn("name: drover:report-writer", text)
        self.assertIn("---", text)


if __name__ == "__main__":
    unittest.main()
