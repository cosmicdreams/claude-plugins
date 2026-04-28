"""Unit tests for drover.scripts.create_tickets (slice 12)."""
from __future__ import annotations

import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

HERE = pathlib.Path(__file__).resolve()
SCRIPTS = HERE.parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location(
    "drover_create_tickets", SCRIPTS / "create_tickets.py",
)
ct = importlib.util.module_from_spec(spec)
sys.modules["drover_create_tickets"] = ct
spec.loader.exec_module(ct)


def _make_project(td: pathlib.Path, *, with_jira: bool = True):
    (td / ".drover").mkdir(parents=True)
    manifest: dict = {
        "project": "pncb",
        "hosting": "drupal-acquia",
        "acquia": {
            "app_uuid": "u", "app_name": "Test",
            "envs": [{"name": "prod", "env_id": "e",
                      "default_domain": "x", "types": []}],
        },
    }
    if with_jira:
        manifest["jira"] = {
            "project_key": "PPS",
            "board_id": 845,
            "default_sprint_id": 18347,
            "default_issue_type": "Chore",
        }
    (td / ".drover" / "manifest.json").write_text(
        json.dumps(manifest, indent=2),
    )

    (td / "reports").mkdir()
    sidecar = td / "reports" / "2026-04-root-cause-summary.md.tickets.json"
    sidecar.write_text(json.dumps([
        {
            "fingerprint": "fp1",
            "title": "[entity_embed] Missing display",
            "description": "body...",
            "priority": "P1",
            "labels": ["drover-suggested", "drover-channel-entity-embed"],
            "channel": "entity_embed",
            "severity": "warning",
            "count": 31171,
        },
        {
            "fingerprint": "fp2",
            "title": "[simple_cron] Cron noise",
            "description": "body 2",
            "priority": "P2",
            "labels": ["drover-suggested"],
            "channel": "simple_cron",
            "severity": "unknown",
            "count": 1000,
        },
    ]))
    return sidecar


# --- Helpers --------------------------------------------------------------

class PriorityMappingTests(unittest.TestCase):
    def test_p_letters_map_to_jira_names(self):
        self.assertEqual(ct.jira_priority_from_drover("P0"), "Highest")
        self.assertEqual(ct.jira_priority_from_drover("P1"), "High")
        self.assertEqual(ct.jira_priority_from_drover("P2"), "Medium")
        self.assertEqual(ct.jira_priority_from_drover("P3"), "Low")
        self.assertEqual(ct.jira_priority_from_drover("P4"), "Lowest")

    def test_unknown_returns_none(self):
        self.assertIsNone(ct.jira_priority_from_drover(""))
        self.assertIsNone(ct.jira_priority_from_drover("urgent"))
        self.assertIsNone(ct.jira_priority_from_drover(None))  # type: ignore[arg-type]

    def test_lowercase_handled(self):
        self.assertEqual(ct.jira_priority_from_drover("p1"), "High")


class FilterSpecsTests(unittest.TestCase):
    def test_no_pattern_returns_all(self):
        specs = [{"title": "a"}, {"title": "b"}]
        self.assertEqual(ct.filter_specs(specs, None), specs)

    def test_regex_filter_case_insensitive(self):
        specs = [
            {"title": "[entity_embed] X"},
            {"title": "[simple_cron] Y"},
            {"title": "[user] Z"},
        ]
        out = ct.filter_specs(specs, "cron|user")
        self.assertEqual(len(out), 2)


class FindDefaultSidecarTests(unittest.TestCase):
    def test_picks_most_recent(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            (root / "reports").mkdir()
            old = root / "reports" / "2026-03-x.md.tickets.json"
            new = root / "reports" / "2026-04-x.md.tickets.json"
            old.write_text("[]")
            new.write_text("[]")
            # touch new so it has a later mtime
            import os
            import time
            os.utime(old, (time.time() - 1000, time.time() - 1000))
            picked = ct.find_default_sidecar(root)
            self.assertEqual(picked, new)

    def test_returns_none_when_no_reports(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertIsNone(
                ct.find_default_sidecar(pathlib.Path(td)),
            )


class LoadSidecarTests(unittest.TestCase):
    def test_round_trip(self):
        with tempfile.TemporaryDirectory() as td:
            p = pathlib.Path(td) / "x.json"
            p.write_text('[{"title":"x","fingerprint":"f"}]')
            data = ct.load_sidecar(p)
            self.assertEqual(data[0]["title"], "x")

    def test_missing_raises(self):
        with self.assertRaises(FileNotFoundError):
            ct.load_sidecar(pathlib.Path("/nope/nope.json"))

    def test_non_list_raises(self):
        with tempfile.TemporaryDirectory() as td:
            p = pathlib.Path(td) / "x.json"
            p.write_text('{"not": "a list"}')
            with self.assertRaises(ValueError):
                ct.load_sidecar(p)


# --- create_one with mocked client ---------------------------------------

class CreateOneTests(unittest.TestCase):
    def _spec(self, **kw):
        base = {
            "fingerprint": "fp",
            "title": "T",
            "description": "D",
            "priority": "P1",
            "labels": ["x"],
        }
        base.update(kw)
        return base

    def test_happy_path(self):
        client = mock.MagicMock()
        client.server = "https://x.example"
        client.create_issue.return_value = {"key": "PPS-100"}
        out = ct.create_one(
            client, self._spec(),
            project_key="PPS", issue_type="Chore",
            sprint_id=12345, parent_key="PPS-1",
            priority_override=None,
        )
        self.assertEqual(out.status, "created")
        self.assertEqual(out.key, "PPS-100")
        self.assertEqual(out.url, "https://x.example/browse/PPS-100")
        client.create_issue.assert_called_once()
        client.assign_sprint.assert_called_once_with(["PPS-100"], 12345)
        client.link_issues.assert_called_once()

    def test_create_failure_records_reason(self):
        import jira_api
        client = mock.MagicMock()
        client.server = "https://x.example"
        client.create_issue.side_effect = jira_api.JiraAPIError(
            status=400, url="...", body='{"errors":{"foo":"bar"}}',
        )
        out = ct.create_one(
            client, self._spec(),
            project_key="PPS", issue_type="Chore",
            sprint_id=None, parent_key=None,
            priority_override=None,
        )
        self.assertEqual(out.status, "create-failed")
        self.assertIn("400", out.reason)

    def test_sprint_failure_does_not_fail_creation(self):
        client = mock.MagicMock()
        client.server = "https://x.example"
        client.create_issue.return_value = {"key": "PPS-200"}
        client.assign_sprint.side_effect = RuntimeError("sprint api down")
        out = ct.create_one(
            client, self._spec(),
            project_key="PPS", issue_type="Chore",
            sprint_id=12345, parent_key=None,
            priority_override=None,
        )
        self.assertEqual(out.status, "created")
        self.assertEqual(out.key, "PPS-200")
        self.assertIn("sprint-assign failed", out.reason)

    def test_priority_override_used(self):
        client = mock.MagicMock()
        client.server = "https://x.example"
        client.create_issue.return_value = {"key": "PPS-300"}
        ct.create_one(
            client, self._spec(priority="P3"),
            project_key="PPS", issue_type="Chore",
            sprint_id=None, parent_key=None,
            priority_override="Medium",
        )
        kwargs = client.create_issue.call_args.kwargs
        self.assertEqual(kwargs["priority"], "Medium")

    def test_priority_mapping_from_p_letters(self):
        client = mock.MagicMock()
        client.server = "https://x.example"
        client.create_issue.return_value = {"key": "PPS-301"}
        ct.create_one(
            client, self._spec(priority="P0"),
            project_key="PPS", issue_type="Chore",
            sprint_id=None, parent_key=None,
            priority_override=None,
        )
        kwargs = client.create_issue.call_args.kwargs
        self.assertEqual(kwargs["priority"], "Highest")


# --- CLI smoke tests -----------------------------------------------------

class CliTests(unittest.TestCase):
    def test_dry_run_makes_no_api_calls(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            sidecar = _make_project(root)
            with mock.patch.object(ct.jira_api, "JiraClient") as Cls:
                buf = io.StringIO()
                with redirect_stdout(buf):
                    rc = ct.cli_main([
                        "--project", str(root),
                        "--sidecar", str(sidecar),
                        "--dry-run",
                    ])
                Cls.assert_not_called()
            self.assertEqual(rc, 0)
            self.assertIn("dry-run", buf.getvalue())
            self.assertIn("entity_embed", buf.getvalue())

    def test_aborts_when_no_jira_block(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            _make_project(root, with_jira=False)
            buf = io.StringIO()
            err = io.StringIO()
            with redirect_stdout(buf):
                with mock.patch("sys.stderr", err):
                    rc = ct.cli_main([
                        "--project", str(root),
                        "--dry-run",
                    ])
            self.assertEqual(rc, 2)
            self.assertIn("project_key", err.getvalue())

    def test_filter_narrows_specs(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            sidecar = _make_project(root)
            buf = io.StringIO()
            with mock.patch.object(ct.jira_api, "JiraClient"):
                with redirect_stdout(buf):
                    ct.cli_main([
                        "--project", str(root),
                        "--sidecar", str(sidecar),
                        "--dry-run",
                        "--filter", "simple_cron",
                    ])
            text = buf.getvalue()
            self.assertIn("simple_cron", text)
            self.assertNotIn("entity_embed", text)


if __name__ == "__main__":
    unittest.main()
