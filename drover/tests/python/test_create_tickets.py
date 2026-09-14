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

class PartialRetryCliTests(unittest.TestCase):
    def test_legacy_partial_reason_is_not_promoted_or_guessed(self):
        for reason in (
            "created OK but sprint-assign failed: RuntimeError: down",
            "created OK but parent-link to PPS-1 failed: RuntimeError: down",
            "unknown older executor failure",
        ):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as td:
                root = pathlib.Path(td)
                sidecar = _make_project(root)
                results = sidecar.with_suffix(".created.json")
                row = {
                    "fingerprint": "fp1", "title": "T", "key": "PPS-100",
                    "url": "https://x.example/browse/PPS-100",
                    "status": "created-partial", "reason": reason,
                }
                results.write_text(json.dumps([row]))
                with mock.patch.object(ct.jira_api, "JiraClient") as factory:
                    with redirect_stdout(io.StringIO()):
                        status = ct.cli_main([
                            "--project", td, "--all", "--filter", "entity_embed",
                        ])
                    client = factory.return_value
                    client.create_issue.assert_not_called()
                    client.assign_sprint.assert_not_called()
                    client.link_issues.assert_not_called()
                self.assertEqual(status, 1)
                persisted = json.loads(results.read_text())[0]
                self.assertEqual(persisted["status"], "created-partial")
                self.assertEqual(persisted["reason"], reason)

    def test_retries_only_unresolved_operations_on_existing_issue(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            sidecar = _make_project(root)
            results = sidecar.with_suffix(".created.json")
            with mock.patch.object(ct.jira_api, "JiraClient") as factory:
                client = factory.return_value
                client.server = "https://x.example"
                client.search_issues.return_value = []
                client.create_issue.return_value = {"key": "PPS-100"}
                client.assign_sprint.side_effect = RuntimeError("sprint down")
                client.link_issues.side_effect = RuntimeError("link down")
                args = ["--project", td, "--all", "--filter", "entity_embed"]
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(ct.cli_main(args + ["--parent", "PPS-1"]), 1)
                    first = json.loads(results.read_text())[0]
                    self.assertEqual(set(first["pending_operations"]), {"sprint", "parent"})
                    self.assertEqual(ct.cli_main(args), 1)
                    self.assertEqual(json.loads(results.read_text())[0]["reason"], first["reason"])
                    client.assign_sprint.side_effect = None
                    self.assertEqual(ct.cli_main(args + ["--sprint", "none"]), 1)
                    partial = json.loads(results.read_text())[0]
                    self.assertEqual(set(partial["pending_operations"]), {"parent"})
                    self.assertIn("link down", partial["reason"])
                    self.assertNotIn("sprint down", partial["reason"])
                    client.assign_sprint.reset_mock()
                    client.link_issues.side_effect = None
                    self.assertEqual(ct.cli_main(args), 0)
                client.create_issue.assert_called_once()
                client.assign_sprint.assert_not_called()
                client.link_issues.assert_called_with(
                    from_key="PPS-100", to_key="PPS-1", link_type="Relates",
                )
                final = json.loads(results.read_text())[0]
                self.assertEqual(final["status"], "created")
                self.assertIsNone(final["reason"])
                self.assertEqual(final["pending_operations"], {})


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

    def test_sprint_failure_reports_partial_not_clean_success(self):
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
        self.assertEqual(out.status, "created-partial")
        self.assertEqual(out.key, "PPS-200")
        self.assertIn("sprint-assign failed", out.reason)

    def test_parent_link_failure_reports_partial(self):
        client = mock.MagicMock()
        client.server = "https://x.example"
        client.create_issue.return_value = {"key": "PPS-201"}
        client.link_issues.side_effect = RuntimeError("link api down")
        out = ct.create_one(
            client, self._spec(),
            project_key="PPS", issue_type="Chore",
            sprint_id=None, parent_key="PPS-1",
            priority_override=None,
        )
        self.assertEqual(out.status, "created-partial")
        self.assertEqual(out.key, "PPS-201")

    def test_clean_creation_still_reports_created(self):
        client = mock.MagicMock()
        client.server = "https://x.example"
        client.create_issue.return_value = {"key": "PPS-202"}
        out = ct.create_one(
            client, self._spec(),
            project_key="PPS", issue_type="Chore",
            sprint_id=12345, parent_key="PPS-1",
            priority_override=None,
        )
        self.assertEqual(out.status, "created")

    def test_fingerprint_label_is_attached_for_later_dedupe(self):
        client = mock.MagicMock()
        client.server = "https://x.example"
        client.create_issue.return_value = {"key": "PPS-203"}
        ct.create_one(
            client, self._spec(),
            project_key="PPS", issue_type="Chore",
            sprint_id=None, parent_key=None,
            priority_override=None,
        )
        labels = client.create_issue.call_args.kwargs["labels"]
        self.assertIn(ct.fingerprint_label(self._spec()["fingerprint"]), labels)

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

class BuildPlanTests(unittest.TestCase):
    def _spec(self, **kw):
        base = {
            "fingerprint": "fp1",
            "title": "[entity_embed] X",
            "description": "body",
            "priority": "P1",
            "labels": ["drover-suggested"],
        }
        base.update(kw)
        return base

    def test_minimal_plan_shape(self):
        plan = ct.build_plan(
            [self._spec()],
            project_key="PPS", issue_type="Chore",
            sprint_id=None, sprint_name=None,
            parent_key=None, priority_override=None,
        )
        self.assertEqual(plan["drover_plan_version"], 1)
        self.assertEqual(plan["context"]["project_key"], "PPS")
        self.assertEqual(plan["context"]["default_issue_type"], "Chore")
        self.assertEqual(len(plan["tickets"]), 1)
        t0 = plan["tickets"][0]
        self.assertEqual(t0["spec_fingerprint"], "fp1")
        self.assertEqual(t0["issue"]["project_key"], "PPS")
        self.assertEqual(t0["issue"]["type"], "Chore")
        self.assertEqual(t0["issue"]["priority"], "High")
        self.assertNotIn("sprint", t0)
        self.assertNotIn("parent", t0)

    def test_plan_includes_sprint_and_parent_when_set(self):
        plan = ct.build_plan(
            [self._spec()],
            project_key="PPS", issue_type="Chore",
            sprint_id=12345, sprint_name="2026.2",
            parent_key="PPS-99", priority_override=None,
        )
        t0 = plan["tickets"][0]
        self.assertEqual(t0["sprint"], {"id": 12345, "name": "2026.2"})
        self.assertEqual(
            t0["parent"], {"key": "PPS-99", "link_type": "Relates"},
        )

    def test_priority_override_in_plan(self):
        plan = ct.build_plan(
            [self._spec(priority="P3")],
            project_key="PPS", issue_type="Chore",
            sprint_id=None, sprint_name=None,
            parent_key=None, priority_override="Highest",
        )
        self.assertEqual(plan["tickets"][0]["issue"]["priority"], "Highest")

    def test_server_in_instance_block(self):
        plan = ct.build_plan(
            [self._spec()],
            project_key="PPS", issue_type="Chore",
            sprint_id=None, sprint_name=None,
            parent_key=None, priority_override=None,
            server="https://velir.atlassian.net",
        )
        self.assertEqual(
            plan["instance"]["server"], "https://velir.atlassian.net",
        )

    def test_unknown_priority_renders_as_none(self):
        plan = ct.build_plan(
            [self._spec(priority="weird")],
            project_key="PPS", issue_type="Chore",
            sprint_id=None, sprint_name=None,
            parent_key=None, priority_override=None,
        )
        self.assertIsNone(plan["tickets"][0]["issue"]["priority"])

    def test_plan_serializable(self):
        # The plan must round-trip through JSON without errors.
        plan = ct.build_plan(
            [self._spec(), self._spec(fingerprint="fp2")],
            project_key="PPS", issue_type="Chore",
            sprint_id=12345, sprint_name="2026.2",
            parent_key="PPS-99", priority_override=None,
        )
        text = json.dumps(plan, indent=2, sort_keys=True)
        round_tripped = json.loads(text)
        self.assertEqual(len(round_tripped["tickets"]), 2)


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

    def test_plan_mode_writes_file_no_api_calls(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            sidecar = _make_project(root)
            plan_path = root / "out.plan.json"
            with mock.patch.object(ct.jira_api, "JiraClient") as Cls:
                buf = io.StringIO()
                with redirect_stdout(buf):
                    rc = ct.cli_main([
                        "--project", str(root),
                        "--sidecar", str(sidecar),
                        "--plan", str(plan_path),
                    ])
                Cls.assert_not_called()
            self.assertEqual(rc, 0)
            self.assertTrue(plan_path.exists())
            plan = json.loads(plan_path.read_text())
            self.assertEqual(plan["drover_plan_version"], 1)
            self.assertEqual(len(plan["tickets"]), 2)
            self.assertEqual(plan["context"]["project_key"], "PPS")
            self.assertEqual(plan["context"]["default_sprint_id"], 18347)

    def test_plan_with_parent_emits_parent_block(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            sidecar = _make_project(root)
            plan_path = root / "p.json"
            with mock.patch.object(ct.jira_api, "JiraClient"):
                buf = io.StringIO()
                with redirect_stdout(buf):
                    ct.cli_main([
                        "--project", str(root),
                        "--sidecar", str(sidecar),
                        "--plan", str(plan_path),
                        "--parent", "PPS-327",
                    ])
            plan = json.loads(plan_path.read_text())
            for t in plan["tickets"]:
                self.assertEqual(t["parent"]["key"], "PPS-327")
                self.assertEqual(t["parent"]["link_type"], "Relates")

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


class DuplicatePreventionTests(unittest.TestCase):
    """Re-running against the same sidecar must not re-file tickets."""

    def test_cli_reuses_created_issues_and_preserves_unselected_sidecar_rows(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            sidecar = _make_project(root)
            results = sidecar.with_suffix(".created.json")
            results.write_text(json.dumps([{
                "fingerprint": "older-report", "status": "created", "key": "PPS-8",
            }]))
            client = mock.MagicMock()
            client.server = "https://fixture.invalid"
            client.search_issues.return_value = []
            client.create_issue.side_effect = [{"key": "PPS-9"}, {"key": "PPS-10"}]
            args = ["--project", str(root), "--sidecar", str(sidecar), "--all"]
            with mock.patch.object(ct.jira_api, "JiraClient", return_value=client):
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(ct.cli_main(args), 0)
                    self.assertEqual(ct.cli_main(args), 0)
            self.assertEqual(client.create_issue.call_count, 2)
            rows = {r["fingerprint"]: r for r in json.loads(results.read_text())}
            self.assertEqual(rows["older-report"]["key"], "PPS-8")
            self.assertEqual(rows["fp1"]["key"], "PPS-9")
            self.assertEqual(rows["fp2"]["key"], "PPS-10")

    def _rows(self, status):
        return [{
            "fingerprint": "abc123", "title": "t", "key": "PPS-9",
            "url": "https://x.example/browse/PPS-9", "status": status,
            "reason": None,
        }]

    def test_prior_created_ticket_is_recognized(self):
        with tempfile.TemporaryDirectory() as td:
            sidecar = pathlib.Path(td) / "r.md.tickets.json"
            sidecar.write_text("[]")
            sidecar.with_suffix(".created.json").write_text(
                json.dumps(self._rows("created")))
            self.assertIn("abc123", ct.load_prior_results(sidecar))

    def test_partially_created_ticket_still_counts_as_filed(self):
        with tempfile.TemporaryDirectory() as td:
            sidecar = pathlib.Path(td) / "r.md.tickets.json"
            sidecar.write_text("[]")
            sidecar.with_suffix(".created.json").write_text(
                json.dumps(self._rows("created-partial")))
            self.assertIn("abc123", ct.load_prior_results(sidecar))

    def test_failed_ticket_is_not_treated_as_filed(self):
        with tempfile.TemporaryDirectory() as td:
            sidecar = pathlib.Path(td) / "r.md.tickets.json"
            sidecar.write_text("[]")
            sidecar.with_suffix(".created.json").write_text(
                json.dumps([{
                    "fingerprint": "abc123", "title": "t", "key": None,
                    "url": None, "status": "create-failed", "reason": "boom",
                }]))
            self.assertEqual(ct.load_prior_results(sidecar), {})

    def test_missing_or_corrupt_sidecar_is_not_fatal(self):
        with tempfile.TemporaryDirectory() as td:
            sidecar = pathlib.Path(td) / "r.md.tickets.json"
            sidecar.write_text("[]")
            self.assertEqual(ct.load_prior_results(sidecar), {})
            sidecar.with_suffix(".created.json").write_text("{not json")
            self.assertEqual(ct.load_prior_results(sidecar), {})

    def test_existing_issue_found_by_fingerprint_label(self):
        client = mock.MagicMock()
        client.search_issues.return_value = [{"key": "PPS-42"}]
        found = ct.find_existing_issue(client, "PPS", "abc123")
        self.assertEqual(found["key"], "PPS-42")
        jql = client.search_issues.call_args.args[0]
        self.assertIn("drover-fp-abc123", jql)

    def test_failed_duplicate_probe_does_not_block_creation(self):
        client = mock.MagicMock()
        client.search_issues.side_effect = RuntimeError("search down")
        self.assertIsNone(ct.find_existing_issue(client, "PPS", "abc123"))


if __name__ == "__main__":
    unittest.main()
