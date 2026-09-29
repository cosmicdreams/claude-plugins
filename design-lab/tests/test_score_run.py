"""Scorer sections, run identity, schema churn and the benchmark step, on small synthetic runs."""
import contextlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
from PIL import Image, ImageDraw  # noqa: E402

import score_run  # noqa: E402

WORKFLOW = SCRIPTS / "workflow.py"


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def legacy_project(**extra):
    """A manifest as 0.14 wrote it: no run identity block."""
    return {"schemaVersion": 1, "standardVersion": "4.0.0", "pluginVersion": "0.14.0",
            "createdAt": "2026-01-05T10:00:00+00:00",
            "repository": {"root": "/repo/mytheme", "commit": "abc1234def", "dirty": False},
            "target": {"figmaFileKey": "KEY1", "figmaUrl": "https://www.figma.com/design/KEY1"},
            "decisions": {"componentSource": "sdc", "tokenSource": "css-custom-properties",
                          "usageSource": "none"},
            "phases": {"discovery": {"status": "complete", "updatedAt": "2026-01-05T10:00:01+00:00"},
                       "plan": {"status": "approved", "updatedAt": "2026-01-05T10:20:00+00:00"},
                       "verify": {"status": "pending"}},
            "artifacts": {}, **extra}


def make_run(root: Path, short_master=True) -> Path:
    """One component, card, measured at two widths; its master is 30 px too short at mobile."""
    run = root / "run"
    write(run / "project.json", legacy_project())
    write(run / "components.json", {"components": [{"id": "mytheme.card", "label": "Card"},
                                                   {"id": "mytheme.old", "label": "Old"}]})
    write(run / "plan.json", {"plans": [
        {"id": "mytheme.card", "verdict": "build", "variants": 3, "properties": [{"field": "title"}]},
        {"id": "mytheme.old", "verdict": "refuse", "variants": 1, "properties": []}]})
    write(run / "index.json", {"totals": {"components": 2, "built": 1, "notBuilt": 1, "byTier": {
        "Components — High Use": {"components": 1, "built": 1},
        "Components — Retirement Candidates": {"components": 1, "built": 0}}},
        "rows": [], "notBuilt": [{"id": "mytheme.old", "label": "Old", "reason": "retired"}]})
    write(run / "figma" / "state.json", {"standardVersion": "4.1.0", "built": ["mytheme.card"],
                                         "siteUrl": "https://mytheme.ddev.site", "runtime": "abc123"})
    write(run / "foundation.json", {"pages": {"Cover": "0:1"},
                                    "collections": {"Core": {"variables": 12}}})
    write(run / "figma" / "dump" / "Cover.json", {"page": "Cover", "pageIndex": 0,
                                                  "nodes": [{"path": "Cover#0"}, {"path": "Cover#0/A#0"}]})
    img = Image.new("RGB", (400, 300), "white")
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 99, 49), fill="black")                 # mobile master, 50 tall
    d.rectangle((0, 100, 99, 149), fill="black")              # mobile live, 80 tall
    d.rectangle((0, 150, 99, 179), fill="navy")
    d.rectangle((200, 0, 299, 49), fill="black")              # desktop master and live match
    d.rectangle((200, 100, 299, 149), fill="black")
    (run / "figma" / "compare").mkdir(parents=True)
    img.save(run / "figma" / "compare" / "mytheme.card.png")
    write(run / "figma" / "results" / "block_mytheme.card.json", {"geometry": {
        "variants": [{"label": "Card · Mobile · 100px", "x": 0, "y": 0, "width": 100, "height": 50},
                     {"label": "Card", "x": 200, "y": 0, "width": 100, "height": 50}],
        "captures": [{"label": "Capture · Mobile 100px", "x": 0, "y": 100, "width": 100,
                      "height": 80 if short_master else 50},
                     {"label": "Capture · Desktop 100px", "x": 200, "y": 100, "width": 100, "height": 50}]}})
    (run / "figma" / "runner.log").write_text(
        "2026-01-05T11:00:00 serving pages (1/3)\n"
        "2026-01-05T11:00:02 recorded pages (2 remaining)\n"
        "2026-01-05T11:00:02 serving build:mytheme.card (2/3)\n"
        "2026-01-05T11:00:12 recorded build:mytheme.card (1 remaining)\n"
        "2026-01-05T11:00:12 error: nothing is not the current step\n"
        "2026-01-06T09:00:00 serving dump:Cover\n"
        "2026-01-06T09:00:01 recorded dump:Cover\n", encoding="utf-8")
    return run


class ScoreRunTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run_dir = make_run(self.root)

    def test_scorecard_matches_schema(self):
        card = score_run.score(self.run_dir)
        self.assertEqual(score_run.validate_scorecard(card), [])

    def test_schema_check_rejects_a_bad_status(self):
        card = score_run.score(self.run_dir)
        card["sections"]["conformance"]["status"] = "great"
        self.assertTrue(any("conformance" in e for e in score_run.validate_scorecard(card)))
        del card["sections"]["conformance"]
        self.assertTrue(score_run.validate_scorecard(card))

    def test_library_counts(self):
        lib = score_run.score(self.run_dir)["sections"]["library"]
        self.assertEqual(lib["components"], {"found": 2, "planned": 1, "built": 1, "notBuilt": 1,
                                             "refused": 1})
        self.assertEqual((lib["variants"], lib["variables"], lib["pages"], lib["nodes"]), (3, 12, 1, 2))
        # No usage tier in this fixture: every component is Untiered, counted by library_counts.
        self.assertIn({"tier": "Untiered", "components": 2, "built": 1}, lib["tiers"])

    def test_accuracy_keeps_original_and_adds_corrected(self):
        acc = score_run.score(self.run_dir)["sections"]["accuracy"]
        self.assertEqual(acc["status"], "measured")
        self.assertEqual(acc["overall"]["original"]["pass"], 2)       # height ignored
        self.assertEqual(acc["overall"]["corrected"]["pass"], 1)      # mobile now fails
        mobile = acc["byBreakpoint"]["mobile"]
        self.assertEqual(mobile["heightDelta"]["over10px"], 1)
        pair = next(p for p in acc["pairs"] if p["breakpoint"] == "mobile")
        self.assertEqual((pair["figmaHeight"], pair["liveHeight"]), (50, 80))

    def test_missing_evidence_is_not_measured_with_a_reason(self):
        sections = score_run.score(self.run_dir)["sections"]
        for name in ("conformance", "schemaChurn"):
            self.assertEqual(sections[name]["status"], "not-measured")
            self.assertTrue(sections[name]["reason"])
        self.assertNotIn("interventions", sections["cost"])
        self.assertIsNone(sections["cost"]["clock"]["totalSeconds"])      # no benchmark step recorded
        self.assertEqual(sections["cost"]["model"]["status"], "not-measured")
        self.assertEqual(sections["repeatability"]["status"], "not-measured")
        self.assertEqual(sections["foundationsVoice"]["status"], "scored-later")
        self.assertEqual(len(sections["blindedJudgement"]["criteria"]), 4)

    def test_empty_directory_still_produces_a_valid_scorecard(self):
        empty = self.root / "empty"
        empty.mkdir()
        card = score_run.score(empty)
        self.assertEqual(score_run.validate_scorecard(card), [])
        for name in ("identity", "library", "accuracy", "conformance"):
            self.assertEqual(card["sections"][name]["status"], "not-measured")

    def test_runner_sessions_and_steps(self):
        runner = score_run.score(self.run_dir)["sections"]["cost"]["runner"]
        self.assertEqual(len(runner["sessions"]), 2)
        self.assertEqual(runner["sessions"][0]["steps"], 2)
        self.assertEqual(runner["sessions"][0]["seconds"], 12)
        self.assertEqual(runner["errors"], 1)
        self.assertEqual(runner["secondsByKind"]["build"], 10)

    def test_recorded_schema_change(self):
        write(self.run_dir / "project.json", legacy_project(run={"schemaChurn": {
            "changed": True, "changes": [{"at": "2026-01-05T10:40:00+00:00", "text": "new slot kind"}]}}))
        churn = score_run.score(self.run_dir)["sections"]["schemaChurn"]
        self.assertEqual((churn["status"], churn["changed"]), ("measured", True))
        self.assertEqual(churn["changes"][0]["text"], "new slot kind")

    def test_confirmed_no_schema_change(self):
        write(self.run_dir / "project.json", legacy_project(run={"schemaChurn": {"changed": False}}))
        churn = score_run.score(self.run_dir)["sections"]["schemaChurn"]
        self.assertEqual((churn["status"], churn["changed"]), ("measured", False))

    def test_transcript_tokens_are_deduplicated_and_windowed(self):
        folder = self.root / "transcripts"
        folder.mkdir()
        usage = {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 100}
        lines = [
            {"type": "assistant", "timestamp": "2026-01-05T10:05:00Z", "sessionId": "s1",
             "message": {"id": "m1", "model": "claude-test", "usage": usage,
                         "content": [{"type": "tool_use", "id": "t1"}]}},
            {"type": "assistant", "timestamp": "2026-01-05T10:05:01Z", "sessionId": "s1",   # same message, streamed
             "message": {"id": "m1", "model": "claude-test", "usage": usage,
                         "content": [{"type": "tool_use", "id": "t1"}]}},
            {"type": "assistant", "timestamp": "2025-12-01T10:00:00Z", "sessionId": "s0",   # outside the window
             "message": {"id": "m0", "model": "claude-test", "usage": usage, "content": []}},
            {"type": "user", "timestamp": "2026-01-05T10:06:00Z", "message": {}},
        ]
        (folder / "s1.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")
        model = score_run.score(self.run_dir, transcripts=folder)["sections"]["cost"]["model"]
        self.assertEqual(model["status"], "measured")
        self.assertEqual((model["assistantMessages"], model["toolCalls"], model["sessions"]), (1, 1, 1))
        self.assertEqual(model["tokens"]["total"], 115)

    def session(self, config: Path, session_id="sess-1"):
        """A synthetic Claude configuration folder: main session plus one subagent transcript."""
        project = config / "projects" / "-repo-mytheme"
        main = project / f"{session_id}.jsonl"
        sub = project / session_id / "subagents" / "agent-1.jsonl"

        def turn(mid, model, usage, tools=0):
            return json.dumps({"type": "assistant", "timestamp": "2020-01-01T00:00:00Z", "sessionId": session_id,
                               "message": {"id": mid, "model": model, "usage": usage,
                                           "content": [{"type": "tool_use", "id": f"{mid}-t{i}"} for i in range(tools)]}})
        big = {"input_tokens": 10, "output_tokens": 20, "cache_creation_input_tokens": 30,
               "cache_read_input_tokens": 40}
        small = {"input_tokens": 1, "output_tokens": 2, "cache_creation_input_tokens": 3,
                 "cache_read_input_tokens": 4}
        main.parent.mkdir(parents=True)
        main.write_text("\n".join([turn("a", "claude-opus-5-5", big, 2), turn("a", "claude-opus-5-5", big, 2),
                                    turn("b", "claude-opus-5-5", big, 1)]) + "\n", encoding="utf-8")
        sub.parent.mkdir(parents=True)
        sub.write_text(turn("c", "claude-haiku-4-5-20251001", small, 1) + "\n", encoding="utf-8")
        (project / "other-session.jsonl").write_text(turn("z", "claude-fable-5-1", big) + "\n", encoding="utf-8")
        return main

    def test_friendly_model_names(self):
        for raw, name in (("claude-opus-5-5", "Opus 5.5"), ("claude-sonnet-5-5", "Sonnet 5.5"),
                          ("claude-fable-5-1", "Fable 5.1"), ("claude-haiku-4-5-20251001", "Haiku 4.5"),
                          ("claude-opus-5-5[1m]", "Opus 5.5"), ("some-other-model", "some-other-model")):
            self.assertEqual(score_run.friendly_model(raw), name)

    def test_tokens_by_model_for_a_named_session(self):
        config = self.root / "config"
        self.session(config)
        write(self.run_dir / "project.json", legacy_project(run={"claude": {"configDir": str(config)}}))
        card = score_run.score(self.run_dir, session="sess-1")
        self.assertEqual(score_run.validate_scorecard(card), [])
        model = card["sections"]["cost"]["model"]
        self.assertEqual(model["status"], "measured")
        self.assertEqual(model["files"], 2)                       # main plus subagent, not the other session
        self.assertEqual(model["configDirs"], [str(config.resolve())])
        opus, haiku = model["byModel"]
        self.assertEqual((opus["name"], opus["input"], opus["output"], opus["cacheWrite"], opus["cacheRead"]),
                         ("Opus 5.5", 20, 40, 60, 80))
        self.assertEqual((opus["total"], opus["turns"], opus["toolCalls"]), (200, 2, 3))
        self.assertEqual((haiku["name"], haiku["total"], haiku["turns"], haiku["toolCalls"]), ("Haiku 4.5", 10, 1, 1))
        self.assertEqual(model["tokens"]["total"], 210)
        self.assertEqual(card["headline"]["effort"]["tokensByModel"][0], {"name": "Opus 5.5", "total": 200})

    def test_transcript_files_bring_their_subagents(self):
        main = self.session(self.root / "config")
        model = score_run.score(self.run_dir, transcripts=[main])["sections"]["cost"]["model"]
        self.assertEqual([r["name"] for r in model["byModel"]], ["Opus 5.5", "Haiku 4.5"])
        self.assertNotIn("caveat", model)

    def test_unknown_session_is_not_measured(self):
        model = score_run.score(self.run_dir, session="no-such-session")["sections"]["cost"]["model"]
        self.assertEqual(model["status"], "not-measured")

    def test_coverage_counts_eligible_components_and_placements(self):
        def comp(cid, placements=0, refs=0):
            return {"id": cid, "label": cid.upper(), "usage": {"placements": placements, "structuralRefs": refs}}
        write(self.run_dir / "components.json", {"components": [
            comp("a", 6, 1), comp("b"), comp("c", 2, 3), comp("d"), comp("e")]})
        write(self.run_dir / "plan.json", {"plans": [
            {"id": "a", "verdict": "build", "libraryRole": "component"},
            {"id": "b", "verdict": "build", "libraryRole": "component"},              # failed
            {"id": "c", "verdict": "refuse", "libraryRole": "component", "refuseReason": "no capture"},
            {"id": "d", "verdict": "refuse", "libraryRole": "retirement"},
            {"id": "e", "verdict": "refuse", "libraryRole": "schema-only"}]})
        write(self.run_dir / "figma" / "state.json", {"built": ["a"]})
        # usage.json also saw something outside the inventory; it must not enter the totals
        write(self.run_dir / "usage.json", {"usage": {"a": {"placements": 6, "structuralRefs": 1},
                                                      "stray.script": {"placements": 5, "structuralRefs": 0}}})
        card = score_run.score(self.run_dir)
        cov = card["sections"]["coverage"]
        self.assertEqual((cov["found"], cov["eligible"], cov["built"], cov["ratio"]), (5, 3, 1, 0.3333))
        self.assertEqual(cov["gap"], {"refused": 1, "failed": 1, "unplanned": 0})
        self.assertEqual(cov["excluded"], {"retirement": 1, "schema-only": 1, "not-visual": 0})
        self.assertEqual(cov["usageWeighted"]["ratio"], 0.75)
        self.assertEqual((cov["usageWeighted"]["structuralCovered"], cov["usageWeighted"]["structuralRefs"]), (1, 4))
        self.assertEqual(cov["outsideInventory"], [{"id": "stray.script", "placements": 5, "structural": 0}])
        self.assertEqual(card["headline"]["coverage"]["placements"], 0.75)
        self.assertEqual(cov["summary"], "Built 1 of 3 components it could have built (33%).")

    def test_benchmark_step_splits_time_and_tokens(self):
        config = self.root / "config"
        self.session(config)
        write(self.run_dir / "project.json", legacy_project(run={
            "startedAt": "2019-12-31T23:00:00+00:00", "claude": {"configDir": str(config)}}))
        (self.run_dir / "phase-log.jsonl").write_text(
            json.dumps({"at": "2019-12-31T23:30:00+00:00", "phase": "plan", "status": "complete"}) + "\n"
            + json.dumps({"at": "2019-12-31T23:59:00+00:00", "phase": "benchmark", "status": "running"}) + "\n")
        # move one Opus turn after the benchmark start
        main = next((config / "projects").glob("*/sess-1.jsonl"))
        lines = main.read_text().splitlines()
        lines[-1] = lines[-1].replace("2020-01-01T00:00:00Z", "2020-01-01T00:05:00Z")
        lines[:-1] = [l.replace("2020-01-01T00:00:00Z", "2019-12-31T23:40:00Z") for l in lines[:-1]]
        main.write_text("\n".join(lines) + "\n")
        sub = next((config / "projects").glob("*/sess-1/subagents/*.jsonl"))
        sub.write_text(sub.read_text().replace("2020-01-01T00:00:00Z", "2019-12-31T23:45:00Z"))
        card = score_run.score(self.run_dir, session="sess-1")
        self.assertEqual(score_run.validate_scorecard(card), [])
        cost = card["sections"]["cost"]
        self.assertEqual(cost["clock"]["librarySeconds"], 3540)          # 23:00 to 23:59
        self.assertGreater(cost["clock"]["totalSeconds"], cost["clock"]["librarySeconds"])
        model = cost["model"]
        self.assertEqual([(r["name"], r["turns"]) for r in model["production"]["byModel"]],
                         [("Opus 5.5", 1), ("Haiku 4.5", 1)])
        self.assertEqual([(r["name"], r["turns"], r["total"]) for r in model["benchmark"]["byModel"]],
                         [("Opus 5.5", 1, 100)])
        self.assertEqual(card["headline"]["effort"]["benchmarkTokensByModel"], [{"name": "Opus 5.5", "total": 100}])

    def test_completion_message_fills_every_placeholder(self):
        out = self.root / "out"
        with contextlib.redirect_stdout(io.StringIO()):
            score_run.main([str(self.run_dir), "--out", str(out)])
        message = (out / "completion.md").read_text()
        self.assertNotRegex(message, r"\{[a-z_]+\}")
        self.assertIn("[benchmark report](file://", message)
        self.assertIn("Figma file: https://www.figma.com/design/KEY1", message)
        self.assertIn("Coverage: built 1 of 2 buildable components (50%)", message)
        self.assertIn("Not measured this run:", message)

    def test_default_output_is_the_runs_benchmark_folder(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(score_run.main([str(self.run_dir)]), 0)
        self.assertTrue((self.run_dir / "benchmark" / "report.html").is_file())
        self.assertTrue((self.run_dir / "benchmark" / "completion.md").is_file())

    def test_repeatability_against_a_copy(self):
        other = self.root / "other"
        shutil.copytree(self.run_dir, other)
        rep = score_run.score(self.run_dir, compare=[other])["sections"]["repeatability"]
        self.assertEqual(rep["status"], "measured")
        row = rep["comparisons"][0]
        self.assertEqual(row["score"], 100)
        self.assertEqual(row["accuracyAgreement"]["sameVerdict"], 2)

    def test_incidental_differences_ignore_paths_links_and_times(self):
        swaps = [("/a/run-1", "/a/run-2"), ("KEY1", "KEY2")]
        self.assertTrue(score_run.incidental({"path": "/x/measuredAt", "a": "1", "b": "2"}, swaps))
        self.assertTrue(score_run.incidental({"path": "/f", "a": "/a/run-1/s.png", "b": "/a/run-2/s.png"}, swaps))
        self.assertTrue(score_run.incidental(
            {"path": "/documentationLinks/0", "a": "https://www.figma.com/design/KEY1?node-id=1-2",
             "b": "https://www.figma.com/design/KEY2?node-id=9-9"}, swaps))
        self.assertFalse(score_run.incidental({"path": "/hash", "a": "sha256:1", "b": "sha256:2"}, swaps))

    def test_main_writes_scorecard_and_report_outside_the_run(self):
        out = self.root / "out"
        with open(self.root / "stdout.txt", "w") as sink:
            saved, sys.stdout = sys.stdout, sink
            try:
                code = score_run.main([str(self.run_dir), "--site-label", "Example site", "--out", str(out)])
            finally:
                sys.stdout = saved
        self.assertEqual(code, 0)
        html = (out / "report.html").read_text(encoding="utf-8")
        self.assertIn("Example site", html)
        self.assertIn("Not measured", html)
        self.assertIn("data:image/webp;base64,", html)
        self.assertNotIn("http://", html.replace("http://www.w3.org", ""))   # no external assets
        card = json.loads((out / "scorecard.json").read_text())
        self.assertEqual(card["run"]["siteLabel"], "Example site")
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            score_run.main([str(self.run_dir), "--out", str(self.run_dir / "score")])


class CoverBreakdownTest(unittest.TestCase):
    def test_four_categories_count_each_built_component_once(self):
        import library_counts
        rows = [
            {"tier": "High Use", "built": True},     # placed on pages and also nested: counts once, as High
            {"tier": "Medium Use", "built": True},
            {"tier": "Low Use", "built": True},
            {"tier": "Structural Only", "built": True},
            {"tier": "Untiered", "built": True},
            {"tier": "Retirement Candidates", "built": True},
            {"tier": "Low Use", "built": False},
        ]
        breakdown = library_counts.cover_breakdown(rows)
        self.assertEqual([b["tier"] for b in breakdown], ["High Use", "Medium Use", "Low Use", "Other"])
        self.assertEqual([b["built"] for b in breakdown], [1, 1, 1, 3])
        self.assertEqual(sum(b["built"] for b in breakdown), 6)


class WorkflowCaptureTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        self.ws = self.root / "ws"

    def workflow(self, *args, check=True):
        return subprocess.run([sys.executable, str(WORKFLOW), *args], text=True,
                              capture_output=True, check=check)

    def test_init_records_run_identity_and_phase_log(self):
        self.workflow("init", "--repo", str(self.repo), "--workspace", str(self.ws),
                      "--site-label", "Example site", "--site-url", "https://mytheme.ddev.site",
                      "--operator", "A. Person", "--model", "claude-test")
        project = json.loads((self.ws / "project.json").read_text())
        run = project["run"]
        self.assertEqual((run["siteLabel"], run["siteUrl"], run["operator"]),
                         ("Example site", "https://mytheme.ddev.site", "A. Person"))
        self.assertEqual(run["claude"]["model"], "claude-test")
        self.assertTrue(run["claude"]["transcripts"].startswith(run["claude"]["configDir"]))
        self.assertEqual(run["plugin"]["version"], project["pluginVersion"])
        log = [json.loads(line) for line in (self.ws / "phase-log.jsonl").read_text().splitlines()]
        self.assertEqual(log[0]["phase"], "init")
        self.assertIn('"valid": true', self.workflow("validate", "--project", str(self.ws)).stdout)

    def test_note_command_is_gone(self):
        self.workflow("init", "--repo", str(self.repo), "--workspace", str(self.ws))
        self.assertNotEqual(self.workflow("note", "x", "--project", str(self.ws), check=False).returncode, 0)
        self.assertFalse((self.ws / "interventions.jsonl").exists())

    def test_schema_change_is_recorded_through_identity(self):
        self.workflow("init", "--repo", str(self.repo), "--workspace", str(self.ws))
        self.workflow("identity", "--project", str(self.ws), "--schema-change", "added a slot kind",
                      "--schema-change", "renamed a field")
        churn = json.loads((self.ws / "project.json").read_text())["run"]["schemaChurn"]
        self.assertTrue(churn["changed"])
        self.assertEqual([c["text"] for c in churn["changes"]], ["added a slot kind", "renamed a field"])
        self.assertNotEqual(self.workflow("identity", "--project", str(self.ws), "--no-schema-change",
                                          "--schema-change", "x", check=False).returncode, 0)

    def test_benchmark_phase_can_be_recorded(self):
        self.workflow("init", "--repo", str(self.repo), "--workspace", str(self.ws))
        self.workflow("record", "--project", str(self.ws), "--phase", "benchmark", "--status", "running")
        log = [json.loads(l) for l in (self.ws / "phase-log.jsonl").read_text().splitlines()]
        self.assertEqual((log[-1]["phase"], log[-1]["status"]), ("benchmark", "running"))

    def test_identity_upgrades_a_legacy_manifest(self):
        self.ws.mkdir()
        write(self.ws / "project.json", legacy_project())
        self.workflow("identity", "--project", str(self.ws), "--site-label", "Example site",
                      "--no-schema-change")
        project = json.loads((self.ws / "project.json").read_text())
        self.assertTrue(project["run"]["recordedLate"])
        self.assertEqual(project["run"]["startedAt"], "2026-01-05T10:00:00+00:00")
        self.assertFalse(project["run"]["schemaChurn"]["changed"])
        self.assertEqual(project["pluginVersion"], "0.14.0")      # original manifest fields untouched


if __name__ == "__main__":
    unittest.main()
