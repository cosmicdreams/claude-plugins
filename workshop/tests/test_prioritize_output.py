"""Offline deterministic checks; no Jira, Slack or gws calls."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "prioritize_output", ROOT / "skills/prioritize/scripts/output.py")
output = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(output)


def item(key, action="REVIEW", scope="sprint", **extra):
    return dict(id=key, action=action, scope=scope, project="P", server_name="server",
                source=f"server {key}", summary=f"Summary {key}", **extra)


def fixture(items):
    return dict(today="2026-08-24", generated_at="2026-08-24T15:00:00Z",
                mode="on-demand", items=items, availability="unknown",
                counts=dict(committed_sprint=30, committed_release=2,
                            unplanned_backlog=40, unplanned_backlog_by_project={"server:P":40}),
                coverage=dict(slack="partial", jira="connected", calendar="connected",
                              work_calendar="not_connected", work_email="not_connected"))


class OutputTest(unittest.TestCase):
    def test_invalid_cli_input_preserves_both_artifacts(self):
        cases = [
            (("items", 0, "source"), None), (("items", 0, "summary"), 12),
            (("items", 0, "action"), "STALE"), (("items", 0, "scope"), []),
            (("items", 0, "stale"), "false"), (("items", 0, "overdue"), 1),
            (("items", 0, "due_date"), "2026-02-30"),
            (("items", 0, "detail"), None), (("items", 0, "url"), []),
            (("today",), "20260824"), (("generated_at",), "yesterday"),
            (("mode",), "daily"), (("items",), {}),
            (("next_id",), ""), (("next_id",), None),
            (("counts",), None), (("counts", "committed_sprint"), True),
            (("counts", "committed_release"), -1),
            (("counts", "unplanned_backlog"), "40"),
            (("counts", "unplanned_backlog_by_project"), []),
            (("counts", "unplanned_backlog_by_project"), {"P": 40}),
            (("counts", "unplanned_backlog_by_project"), {"server:P": 39}),
            (("counts", "unplanned_backlog_by_project"), {"server:P": 40.0}),
            (("quiet_sources",), "channel"), (("errors",), [None]),
            (("coverage",), {}), (("coverage", "jira"), "ok"),
            (("weights",), {"DUE": float("nan")}),
            (("weights",), {"scope": {"sprint": float("inf")}}),
            (("weights",), {"RESPOND": True}), (("weights",), []),
            (("availability",), []),
            (("availability",), {"free_hours_today": True}),
            (("availability",), {"next_meeting": {"title": "x", "start": "no"}}),
            (("availability",), {"next_free_block": {"start": "2026-08-24T15:00:00Z", "minutes": -1}}),
        ]
        for field in fixture([])["counts"]:
            cases.append((("counts", field), ...))
        cases.append((("counts",), ...))
        with tempfile.TemporaryDirectory() as directory:
            output.publish(output.canonical(fixture([item("saved")])), directory)
            paths = [Path(directory) / name for name in
                     ("workshop-prioritize.snapshot.json", "workshop-prioritize.brief.html")]
            before = [(p.read_bytes(), p.stat().st_mtime_ns) for p in paths]
            input_path = Path(directory) / "input.json"
            for keys, value in cases:
                with self.subTest(keys=keys, value=value):
                    data = fixture([item("bad")])
                    target = data
                    for key in keys[:-1]:
                        target = target[key]
                    if value is ...:
                        del target[keys[-1]]
                    else:
                        target[keys[-1]] = value
                    input_path.write_text(json.dumps(data))
                    run = subprocess.run(
                        [sys.executable, str(SPEC.origin), str(input_path),
                         "--data-path", directory], capture_output=True, text=True)
                    self.assertNotEqual(run.returncode, 0)
                    self.assertEqual(before, [(p.read_bytes(), p.stat().st_mtime_ns) for p in paths])

    def test_empty_availability_and_render_before_publish(self):
        data = fixture([item("one")])
        data["availability"] = {}
        result = output.canonical(data)
        self.assertEqual(result["availability"], {
            "free_hours_today": None, "next_meeting": None,
            "next_free_block": None, "work_calendar": "not_connected"})
        with patch.object(output, "terminal", side_effect=ValueError("render failed")), \
                patch.object(output, "atomic_write") as write:
            with self.assertRaises(ValueError):
                output.publish(result, "unused")
            write.assert_not_called()

    def test_actual_score_order_and_stable_ties(self):
        result = output.canonical(fixture([
            item("due", "DUE", "backlog", due_date="2026-08-23", stale=True),
            item("reply", "RESPOND"), item("review"), item("tie"),
            item("today", "DUE", "release", due_date="2026-08-24")]))
        self.assertEqual([i["id"] for i in result["items"]],
                         ["reply", "today", "due", "review", "tie"])
        self.assertEqual([i["score"] for i in result["items"]], [130, 110, 80, 70, 70])

    def test_deadlines_and_obligations_survive_all_caps(self):
        ordinary = [item(f"review{i}") for i in range(25)]
        mandatory = [item(f"due{i}", "DUE", "backlog", due_date="2026-08-24") for i in range(20)]
        mandatory += [item("reply", "RESPOND", "backlog"), item("block", "UNBLOCK", "backlog"),
                      item("merged", "RESPOND", "backlog", due_date="2026-08-23")]
        result = output.canonical(fixture(ordinary + mandatory))
        self.assertEqual(len(result["items"]), 48)
        self.assertTrue({i["id"] for i in mandatory} <= set(result["display"]["item_ids"]))
        self.assertGreater(len(result["display"]["item_ids"]), 15)
        self.assertEqual(result["omitted_count"], 0)
        self.assertEqual(result["counts"]["unplanned_backlog"], 40)

    def test_scope_slots_and_custom_weights(self):
        data = fixture([item("backlog", scope="backlog")] +
                       [item(f"planned{i}") for i in range(6)])
        # Even if a custom score favors backlog, ordinary project slots favor commitments.
        data["weights"] = {"scope": {"backlog": 100}}
        data["next_id"] = "planned0"
        result = output.canonical(data)
        self.assertNotIn("backlog", result["display"]["item_ids"])
        self.assertEqual(result["display"]["backlog_suppressed"], {"server:P": 1})
        self.assertEqual(result["items"][0]["id"], "backlog")

    def test_renderers_share_selection_and_escape_untrusted_text(self):
        data = fixture([item("safe", "RESPOND")])
        data["items"][0]["summary"] = '<script>alert("x")</script>{{HERO}}'
        data["items"][0]["url"] = "javascript:alert(1)"
        result = output.canonical(data)
        brief = output.html(result)
        self.assertNotIn('<script>alert("x")</script>', brief)
        self.assertIn("&lt;script&gt;", brief)
        self.assertIn("{{HERO}}", brief)
        self.assertNotIn("javascript:", brief)
        self.assertIn(result["items"][0]["source"], brief)
        self.assertIn(result["items"][0]["source"], output.terminal(result))
        self.assertIsNone(result["availability"]["free_hours_today"])
        self.assertEqual(result["coverage"]["calendar"], "connected")

    def test_schema_is_uniform_for_slack_and_jira(self):
        data = fixture([item("jira"), dict(id="ws:channel:123", action="RESPOND",
                                           source="ws #channel", summary="Reply",
                                           excerpt="Human request")])
        result = output.canonical(data)
        self.assertEqual(set(result["items"][0]), set(result["items"][1]))
        self.assertEqual(result["items"][0]["detail"], "Human request")
        self.assertIsNone(result["items"][0]["scope"])

    def test_artifacts_and_ambient_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            result = output.canonical(fixture([item("one")]))
            output.publish(result, directory)
            paths = list(Path(directory).iterdir())
            before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in paths}
            saved = json.loads((Path(directory) / "workshop-prioritize.snapshot.json").read_text())
            self.assertEqual(saved, result)
            data = fixture([])
            data["mode"] = "ambient"
            output.publish(output.canonical(data), directory)
            self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in paths})

    def test_cli_workflow(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.json"
            path.write_text(json.dumps(fixture([item("cli")])))
            run = subprocess.run([sys.executable, str(SPEC.origin), str(path),
                                  "--data-path", directory], check=True, capture_output=True, text=True)
            self.assertIn("NEXT →", run.stdout)
            snapshot = json.loads((Path(directory) / "workshop-prioritize.snapshot.json").read_text())
            self.assertEqual(snapshot["next"]["id"], "cli")
            self.assertTrue((Path(directory) / "workshop-prioritize.brief.html").is_file())

    def test_empty_partial_and_duplicate_input(self):
        data = fixture([])
        data["errors"] = ["Jira unavailable"]
        result = output.canonical(data)
        self.assertIsNone(result["next"])
        self.assertNotIn("Clean slate", output.terminal(result))
        self.assertIn("Jira unavailable", output.html(result))
        with self.assertRaises(ValueError):
            output.canonical(fixture([item("same"), item("same")]))

    def test_collection_instruction_contracts(self):
        # These assertions verify instructions, NOT live collection behavior.
        jira = (ROOT / "skills/prioritize/steps/03-fetch-jira.md").read_text()
        self.assertIn("Pass 0", jira)
        self.assertIn("sprint in openSprints()", jira)
        self.assertIn("fixVersion in unreleasedVersions()", jira)
        self.assertIn("BOTH Pass 1 and Pass 2", jira)
        self.assertIn("duedate <= endOfDay()", jira)
        self.assertNotIn("04-score-output.md", jira)
        self.assertNotIn("backlog_suppressed", jira)
        self.assertIn('"unplanned_backlog_by_project": { "velir:MWS": 22, "velir:PPS": 24 }', jira)
        self.assertIn("counts.unplanned_backlog_by_project", jira)
        self.assertIn("Do not refetch or", jira)
        self.assertIn("infer counts from attention-only candidates", jira)
        rank = (ROOT / "skills/prioritize/steps/05-rank-output.md").read_text()
        self.assertIn("step 3 coordinator's merged counts", rank)
        self.assertIn("refetching or inference from attention-only candidates", rank)
        slack = (ROOT / "skills/prioritize/steps/02-fetch-slack.md").read_text()
        self.assertIn("agent-slack unreads", slack)
        self.assertIn("bot_id", slack)
        calendar = (ROOT / "skills/prioritize/steps/04-fetch-availability.md").read_text()
        self.assertNotIn("gws +agenda", calendar)
        self.assertIn("nextPageToken", calendar)
        self.assertIn("explicit local UTC offset", calendar)


if __name__ == "__main__":
    unittest.main()
