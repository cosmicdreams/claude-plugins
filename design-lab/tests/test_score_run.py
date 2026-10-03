"""Scorer sections, run identity, schema churn and the benchmark step, on small synthetic runs."""
import contextlib
import datetime as dt
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
# The person's design-lab folder, for these tests only: never the real ~/.design-lab.
os.environ["DESIGN_LAB_HOME"] = tempfile.mkdtemp(prefix="design-lab-home-")
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
    write(run / "figma" / "state.json", {"standardVersion": "4.1.0", "planned": ["mytheme.card"],
                                         "done": ["build:mytheme.card", "block:mytheme.card"],
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
        self.assertIsNone(sections["cost"]["clock"]["wallSeconds"])       # no benchmark step recorded
        self.assertIn("benchmark", sections["cost"]["clock"]["notShownBecause"])
        self.assertEqual(sections["cost"]["working"]["status"], "not-measured")
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
        write(self.run_dir / "figma" / "state.json", {"planned": ["a", "b"], "done": ["build:a", "block:a", "build:b"]})
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

    def test_every_refused_count_matches_the_coverage_gap(self):
        self.test_coverage_counts_eligible_components_and_placements()      # the same five components
        write(self.run_dir / "plan.json", {"plans": [
            {"id": "a", "verdict": "build", "libraryRole": "component"},
            {"id": "b", "verdict": "refuse", "libraryRole": "component", "refuseReason": "no capture"},
            {"id": "c", "verdict": "refuse", "libraryRole": "component", "refuseReason": "no capture"},
            {"id": "d", "verdict": "refuse", "libraryRole": "retirement"},
            {"id": "e", "verdict": "refuse", "libraryRole": "retirement"}]})
        out = self.root / "out"
        with contextlib.redirect_stdout(io.StringIO()):
            score_run.main([str(self.run_dir), "--out", str(out)])
        card = json.loads((out / "scorecard.json").read_text())
        refused = card["sections"]["coverage"]["gap"]["refused"]
        self.assertEqual((refused, card["sections"]["library"]["components"]["refused"]), (2, 2))
        html = re.sub(r"<[^>]+>", " ", (out / "report.html").read_text())
        message = (out / "completion.md").read_text()
        for text in (html, message):
            found = [int(n) for n in re.findall(r"(\d+)\s+refused by the plan", text)]
            self.assertTrue(found)
            self.assertEqual(set(found), {refused}, found)
            self.assertIn("2 retirement candidates", text)

    def test_benchmark_step_splits_time_and_tokens(self):
        config = self.root / "config"
        self.session(config)
        write(self.run_dir / "project.json", legacy_project(run={
            "startedAt": "2019-12-31T23:00:00+00:00", "claude": {"configDir": str(config)}}))
        (self.run_dir / "phase-log.jsonl").write_text(
            json.dumps({"at": "2019-12-31T23:30:00+00:00", "phase": "plan", "status": "complete"}) + "\n"
            + json.dumps({"at": "2019-12-31T23:59:00+00:00", "phase": "benchmark", "status": "running"}) + "\n"
            + json.dumps({"at": "2020-01-01T00:10:00+00:00", "phase": "benchmark", "status": "complete"}) + "\n")
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
        self.assertEqual(cost["clock"]["wallSeconds"], 4200)             # init 23:00 to benchmark end 00:10
        self.assertEqual((cost["clock"]["libraryWallSeconds"], cost["clock"]["benchmarkWallSeconds"]), (3540, 660))
        self.assertEqual(cost["clock"]["benchmarkEndSource"], "phase log")
        model = cost["model"]
        self.assertEqual([(r["name"], r["turns"]) for r in model["production"]["byModel"]],
                         [("Opus 5.5", 1), ("Haiku 4.5", 1)])
        self.assertEqual([(r["name"], r["turns"], r["total"]) for r in model["benchmark"]["byModel"]],
                         [("Opus 5.5", 1, 100)])
        self.assertEqual(card["headline"]["effort"]["benchmarkTokensByModel"], [{"name": "Opus 5.5", "total": 100}])

    def test_first_scoring_fixes_the_benchmark_end(self):
        write(self.run_dir / "project.json", legacy_project(run={"startedAt": "2026-01-05T10:00:00+00:00"}))
        start = dt.datetime.now(dt.timezone.utc).replace(microsecond=0) - dt.timedelta(minutes=2)
        (self.run_dir / "phase-log.jsonl").write_text(
            json.dumps({"at": start.isoformat(), "phase": "benchmark", "status": "running"}) + "\n")
        with contextlib.redirect_stdout(io.StringIO()):
            score_run.main([str(self.run_dir)])
        log = [json.loads(line) for line in (self.run_dir / "phase-log.jsonl").read_text().splitlines()]
        self.assertEqual((log[-1]["phase"], log[-1]["status"]), ("benchmark", "complete"))
        first = json.loads((self.run_dir / "benchmark" / "scorecard.json").read_text())["sections"]["cost"]["clock"]
        self.assertEqual(first["benchmarkEnd"], score_run.iso(score_run.parse_time(log[-1]["at"])))
        self.assertIsNotNone(first["wallSeconds"])
        written = dt.datetime.fromtimestamp((self.run_dir / "benchmark" / "report.html").stat().st_mtime,
                                            dt.timezone.utc)
        ended = score_run.parse_time(first["benchmarkEnd"])       # the end is when the report was finished
        self.assertLess(abs((ended - written).total_seconds()), 2)
        self.assertIn(first["benchmarkEnd"][:16].replace("T", " ")[:10], log[-1]["at"])
        with contextlib.redirect_stdout(io.StringIO()):                 # a re-score never moves the end
            score_run.main([str(self.run_dir)])
        again = json.loads((self.run_dir / "benchmark" / "scorecard.json").read_text())["sections"]["cost"]["clock"]
        self.assertEqual((again["benchmarkEnd"], again["wallSeconds"], again["benchmarkEndSource"]),
                         (first["benchmarkEnd"], first["wallSeconds"], "phase log"))
        self.assertEqual(sum(1 for line in (self.run_dir / "phase-log.jsonl").read_text().splitlines()
                             if '"complete"' in line), 1)

    def test_rescoring_keeps_the_first_benchmark(self):
        import os
        env = {**os.environ, "DESIGN_LAB_HOME": str(self.root / "home")}
        repo = self.root / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        ws = self.root / "w"

        def run(*args):
            return subprocess.run([sys.executable, str(WORKFLOW), *args], env=env, capture_output=True, text=True)

        def score():
            done = subprocess.run([sys.executable, str(SCRIPTS / "score_run.py"), str(ws), "--no-html"],
                                  env=env, capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            return json.loads((ws / "benchmark" / "scorecard.json").read_text())["sections"]["cost"]["clock"]
        self.assertEqual(run("init", "--repo", str(repo), "--workspace", str(ws)).returncode, 0)
        write(ws / "components.json", {"components": [{"id": "a", "label": "A"}]})
        self.assertEqual(run("record", "--project", str(ws), "--phase", "benchmark", "--status", "running").returncode, 0)
        first = score()
        self.assertEqual(first["benchmarkEndSource"], "this scoring")
        time.sleep(1.1)
        # A re-score that marks a new start, as an older skill said to: the start is ignored.
        again = run("record", "--project", str(ws), "--phase", "benchmark", "--status", "running")
        self.assertIn("ignored", again.stdout)
        second = score()
        self.assertEqual((second["benchmarkStart"], second["benchmarkEnd"], second["wallSeconds"]),
                         (first["benchmarkStart"], first["benchmarkEnd"], first["wallSeconds"]))
        # Even a start written straight into the log never moves the first pair.
        with open(ws / "phase-log.jsonl", "a") as log:
            log.write(json.dumps({"at": "2099-01-01T00:00:00+00:00", "phase": "benchmark", "status": "running"}) + "\n")
        self.assertEqual(score()["wallSeconds"], first["wallSeconds"])

    def test_the_first_scoring_stops_the_runs_server(self):
        from unittest import mock
        import figma_runner
        write(self.run_dir / "project.json", legacy_project(run={"startedAt": "2026-01-05T10:00:00+00:00"}))
        start = dt.datetime.now(dt.timezone.utc).replace(microsecond=0) - dt.timedelta(minutes=1)
        (self.run_dir / "phase-log.jsonl").write_text(
            json.dumps({"at": start.isoformat(), "phase": "benchmark", "status": "running"}) + "\n")
        with mock.patch.object(figma_runner, "stop_server", return_value={"stopped": True, "pid": 9}) as stop, \
                contextlib.redirect_stdout(io.StringIO()):
            score_run.main([str(self.run_dir), "--no-html"])
            score_run.main([str(self.run_dir), "--no-html"])       # a re-score leaves any server alone
        stop.assert_called_once()

    def test_an_ambiguous_current_session_is_named_in_the_report(self):
        folder = self.root / "transcripts"
        for name in ("older", "newer"):
            write_transcript(folder / f"{name}.jsonl", [entry("prompt", "2026-01-05T10:00:00Z", session=name),
                                                        entry("reply", "2026-01-05T10:00:10Z", session=name)])
            time.sleep(0.01)
        write(self.run_dir / "project.json", legacy_project(run={
            "startedAt": "2026-01-05T10:00:00+00:00", "claude": {"transcripts": str(folder)}}))
        out = self.root / "out"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as said:
            score_run.main([str(self.run_dir), "--session", "current", "--out", str(out)])
        self.assertIn("--session current chose newer", said.getvalue())
        card = json.loads((out / "scorecard.json").read_text())
        self.assertIn("newest of 2 sessions", card["sections"]["cost"]["developer"]["sessionWarning"])
        self.assertIn("Which session was scored.", (out / "report.html").read_text())

    def test_a_run_scored_before_without_an_end_shows_no_wall_time(self):
        write(self.run_dir / "project.json", legacy_project(run={"startedAt": "2026-01-05T10:00:00+00:00"}))
        (self.run_dir / "phase-log.jsonl").write_text(
            json.dumps({"at": "2026-01-05T12:00:00+00:00", "phase": "benchmark", "status": "running"}) + "\n")
        write(self.run_dir / "benchmark" / "scorecard.json", {"scored": "before the scorer recorded ends"})
        with contextlib.redirect_stdout(io.StringIO()):
            score_run.main([str(self.run_dir)])
        clock = json.loads((self.run_dir / "benchmark" / "scorecard.json").read_text())["sections"]["cost"]["clock"]
        self.assertIsNone(clock["wallSeconds"])
        self.assertIn("end was not recorded", clock["notShownBecause"])
        self.assertNotIn('"complete"', (self.run_dir / "phase-log.jsonl").read_text())

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
        project = json.loads((self.run_dir / "project.json").read_text())
        self.assertEqual(card["run"]["buildCreatedAt"], project.get("createdAt"),
                         "the scorecard names the build it scored")
        self.assertTrue((out / "completion.md").is_file())
        self.assertEqual([p.name for p in out.iterdir() if p.name.endswith(".tmp")], [],
                         "atomic writes leave no temporary files behind")
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            score_run.main([str(self.run_dir), "--out", str(self.run_dir / "score")])


def entry(kind, at, session="sess-w", sidechain=False, **extra):
    """One transcript record, shaped like Claude Code's own."""
    base = {"timestamp": at, "sessionId": session, "isSidechain": sidechain}
    if kind == "prompt":
        return {**base, "type": "user", "message": {"role": "user", "content": extra.get("text", "Build it")}}
    if kind == "result":
        return {**base, "type": "user", "toolUseResult": {"stdout": "ok"},
                "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": "ok"}]}}
    if kind in ("step", "reply"):
        content = [{"type": "tool_use", "id": f"t-{at}", "name": "Bash",
                    "input": {"command": extra.get("command", "ls")}}] if kind == "step" else [{"type": "text", "text": "Done."}]
        return {**base, "type": "assistant", "message": {"id": f"m-{at}-{session}", "model": extra.get("model", "claude-opus-5-5"),
                                                        "usage": {"input_tokens": 10, "output_tokens": 5},
                                                        "content": content}}
    if kind == "ask":          # the shape of a real question to the person
        return {**base, "type": "assistant", "message": {"id": f"m-{at}", "model": "claude-opus-5-5",
                "usage": {"input_tokens": 1, "output_tokens": 1},
                "content": [{"type": "tool_use", "id": "ask-1", "name": extra.get("tool", "AskUserQuestion"),
                             "input": {"questions": [{"question": "Approve the plan?"}]}, "caller": {}}]}}
    if kind == "answer":
        return {**base, "type": "user", "permissionMode": extra.get("mode", "bypassPermissions"),
                "toolUseResult": {"answers": {"Approve the plan?": "Yes"}, "questions": []},
                "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "ask-1",
                                                         "content": "User has answered your questions"}]}}
    if kind == "meta":
        return {**base, "type": "user", "isMeta": True, "message": {"role": "user", "content": "<system-reminder>x"}}
    if kind == "limit":        # the shape of a real usage-limit record
        return {**base, "type": "assistant", "isApiErrorMessage": True, "error": "rate_limit", "apiErrorStatus": 429,
                "quotaLimits": {"status": "rejected", "resetsAt": extra["resets"], "rateLimitType": "five_hour"},
                "message": {"id": f"m-{at}", "model": "<synthetic>", "content": [
                    {"type": "text", "text": "You've hit your session limit · resets 11am"}]}}
    if kind == "overloaded":   # the shape of a real overload retry record
        return {**base, "type": "system", "subtype": "api_error", "level": "error", "retryInMs": 536, "retryAttempt": 1,
                "error": {"status": 529, "formatted": "529 Overloaded",
                          "message": '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'}}
    raise ValueError(kind)


def write_transcript(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")


class WorkingTimeTest(unittest.TestCase):
    """Working time and the two kinds of waiting, on small synthetic transcripts."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run_dir = make_run(self.root)
        self.config = self.root / "config"
        self.main = self.config / "projects" / "-repo" / "sess-w.jsonl"
        resets = int(dt.datetime(2026, 1, 5, 11, 0, tzinfo=dt.timezone.utc).timestamp())
        write_transcript(self.main, [
            entry("prompt", "2026-01-05T10:00:00Z"),
            entry("step", "2026-01-05T10:00:10Z"),                   # the model worked 10 s
            entry("result", "2026-01-05T10:01:10Z"),                 # the tool ran 60 s
            entry("reply", "2026-01-05T10:01:20Z"),                  # turn over
            entry("prompt", "2026-01-05T10:11:20Z", text="go on"),   # the person took 10 min
            entry("step", "2026-01-05T10:11:30Z"),
            entry("limit", "2026-01-05T10:12:00Z", resets=resets),   # limit until 11:00
            entry("prompt", "2026-01-05T11:30:00Z", text="continue"),  # the person came back at 11:30
            entry("reply", "2026-01-05T11:30:30Z"),
        ])
        # A subagent that worked 10:00:20 to 10:02:30, overlapping the main session's first turn.
        write_transcript(self.main.with_suffix("") / "subagents" / "agent-1.jsonl", [
            entry("prompt", "2026-01-05T10:00:20Z", sidechain=True, text="Inventory the components"),
            entry("step", "2026-01-05T10:00:50Z", sidechain=True),
            entry("result", "2026-01-05T10:02:00Z", sidechain=True),
            entry("reply", "2026-01-05T10:02:30Z", sidechain=True),
        ])
        write(self.run_dir / "project.json", legacy_project(run={"claude": {"configDir": str(self.config)}}))

    def test_working_spans_waits_and_subagent_overlap(self):
        card = score_run.score(self.run_dir, session="sess-w")
        self.assertEqual(score_run.validate_scorecard(card), [])
        work = card["sections"]["cost"]["working"]
        self.assertEqual(work["status"], "measured")
        self.assertEqual(work["spanSeconds"], 5430)                          # 10:00:00 to 11:30:30
        # 10:00:00-10:02:30 (main and subagent merged, counted once) + 10:11:20-10:12:00 + 11:30:00-11:30:30
        self.assertEqual(work["workingSeconds"], 150 + 40 + 30)
        self.assertEqual(work["waitingOnLimitsSeconds"], 48 * 60)            # 10:12 until the limit reset at 11:00
        self.assertEqual(work["waitingOnPersonSeconds"], 530 + 30 * 60)       # after each finished turn, and after the reset
        self.assertEqual(work["waitingOnServiceSeconds"], 0)
        self.assertEqual(work["workingSeconds"] + work["waitingOnPersonSeconds"] + work["waitingOnLimitsSeconds"]
                         + work["waitingOnServiceSeconds"], work["spanSeconds"])
        self.assertEqual(work["limitEvents"], 1)
        self.assertEqual(card["headline"]["effort"]["workingSeconds"], 220)

    def test_overload_counts_as_waiting_on_the_service(self):
        write_transcript(self.main, [
            entry("prompt", "2026-01-05T10:00:00Z"),
            entry("overloaded", "2026-01-05T10:00:05Z"),
            entry("reply", "2026-01-05T10:02:05Z"),
        ])
        (self.main.with_suffix("") / "subagents" / "agent-1.jsonl").unlink()
        work = score_run.score(self.run_dir, session="sess-w")["sections"]["cost"]["working"]
        self.assertEqual((work["workingSeconds"], work["waitingOnLimitsSeconds"], work["waitingOnServiceSeconds"],
                          work["waitingOnPersonSeconds"]), (5, 0, 120, 0))
        self.assertEqual((work["limitEvents"], work["serviceEvents"]), (0, 1))

    def test_a_question_to_the_person_is_waiting_not_working(self):
        write_transcript(self.main, [
            entry("prompt", "2026-01-05T10:00:00Z"),
            entry("ask", "2026-01-05T10:00:10Z"),                    # the plan goes up for approval
            entry("meta", "2026-01-05T10:00:30Z"),                   # a record between call and answer
            entry("answer", "2026-01-05T10:05:10Z", mode="default"),  # the person answered 5 min later
            entry("reply", "2026-01-05T10:05:20Z"),
        ])
        # A subagent still working during the question keeps its time as working.
        write_transcript(self.main.with_suffix("") / "subagents" / "agent-1.jsonl", [
            entry("prompt", "2026-01-05T10:01:00Z", sidechain=True),
            entry("reply", "2026-01-05T10:02:00Z", sidechain=True),
        ])
        out = self.root / "out"
        with contextlib.redirect_stdout(io.StringIO()):
            score_run.main([str(self.run_dir), "--session", "sess-w", "--out", str(out)])
        card = json.loads((out / "scorecard.json").read_text())
        work = card["sections"]["cost"]["working"]
        self.assertEqual((work["workingSeconds"], work["waitingOnPersonSeconds"]), (10 + 60 + 10, 300 - 60))
        self.assertEqual(work["questionsToPerson"], 1)
        self.assertEqual(work["developer"]["permissionModes"], {"default": 1})
        self.assertIs(work["fullAccess"], False)
        self.assertIn("did not run with full access", (out / "report.html").read_text())
        self.assertNotIn("permissionModes", (out / "report.html").read_text())

    def test_interruptions_after_the_preflight_go_ahead(self):
        write_transcript(self.main, [
            entry("prompt", "2026-01-05T10:00:00Z"),
            entry("reply", "2026-01-05T10:00:20Z"),                  # preflight asks for the answers: setup
            entry("prompt", "2026-01-05T10:00:25Z", text="here they are"),
            entry("step", "2026-01-05T10:00:40Z"),
            entry("result", "2026-01-05T10:05:00Z"),
            entry("ask", "2026-01-05T10:06:00Z"),                    # a question during capture
            entry("answer", "2026-01-05T10:07:00Z"),
            entry("reply", "2026-01-05T10:10:00Z"),                  # "done with capture, continue?"
            entry("prompt", "2026-01-05T10:20:00Z", text="continue"),
            entry("step", "2026-01-05T10:20:10Z"),
            entry("result", "2026-01-05T11:00:30Z"),
            entry("reply", "2026-01-05T11:05:00Z"),                  # the completion message: after the benchmark began
            entry("prompt", "2026-01-05T11:06:00Z", text="thanks"),
        ])
        (self.run_dir / "phase-log.jsonl").write_text("\n".join(json.dumps(e) for e in [
            {"at": "2026-01-05T10:00:30+00:00", "phase": "preflight", "status": "complete"},
            {"at": "2026-01-05T10:01:00+00:00", "phase": "capture", "status": "running"},
            {"at": "2026-01-05T10:15:00+00:00", "phase": "capture", "status": "complete"},
            {"at": "2026-01-05T11:00:00+00:00", "phase": "benchmark", "status": "running"}]) + "\n")
        write(self.run_dir / "project.json", legacy_project(run={"claude": {"configDir": str(self.config)}}, phases={
            "preflight": {"status": "complete", "detail": {"planApproval": "proposed"}}}))
        out = self.root / "out"
        with contextlib.redirect_stdout(io.StringIO()):
            score_run.main([str(self.run_dir), "--session", "sess-w", "--out", str(out)])
        card = json.loads((out / "scorecard.json").read_text())
        self.assertEqual(score_run.validate_scorecard(card), [])
        attended = card["sections"]["cost"]["unattended"]
        self.assertEqual((attended["count"], attended["ranUnattended"]), (2, False))
        self.assertEqual([(i["kind"], i["phase"]) for i in attended["interruptions"]],
                         [("question", "capture"), ("turn ended and waited for a prompt", "capture")])
        message = (out / "completion.md").read_text()
        self.assertIn("Ran unattended after preflight: no, 2 interruptions: a question during capture; "
                      "a turn that waited for a prompt during capture.", message)
        self.assertIn("2 interruptions after preflight.", (out / "report.html").read_text())

    def test_a_stop_for_the_runner_counts_as_an_interruption(self):
        write_transcript(self.main, [entry("prompt", "2026-01-05T10:00:00Z"), entry("step", "2026-01-05T10:00:40Z"),
                                     entry("result", "2026-01-05T10:30:00Z"), entry("reply", "2026-01-05T10:31:00Z")])
        (self.run_dir / "phase-log.jsonl").write_text("\n".join(json.dumps(e) for e in [
            {"at": "2026-01-05T10:00:30+00:00", "phase": "preflight", "status": "complete"},
            {"at": "2026-01-05T10:20:00+00:00", "phase": "components", "status": "stopped",
             "reason": "runner not connected"}]) + "\n")
        attended = score_run.score(self.run_dir, session="sess-w")["sections"]["cost"]["unattended"]
        self.assertEqual((attended["count"], attended["ranUnattended"]), (1, False))
        self.assertEqual(score_run.unattended_phrase(attended),
                         "no, 1 interruption: a stop, runner not connected during components")

    def test_an_unattended_run_says_so(self):
        write_transcript(self.main, [entry("prompt", "2026-01-05T10:00:00Z"), entry("step", "2026-01-05T10:00:40Z"),
                                     entry("result", "2026-01-05T10:30:00Z"), entry("reply", "2026-01-05T10:31:00Z")])
        (self.run_dir / "phase-log.jsonl").write_text(json.dumps(
            {"at": "2026-01-05T10:00:30+00:00", "phase": "preflight", "status": "complete"}) + "\n")
        attended = score_run.score(self.run_dir, session="sess-w")["sections"]["cost"]["unattended"]
        self.assertEqual((attended["count"], attended["ranUnattended"]), (0, True))
        self.assertEqual(score_run.unattended_phrase(attended), "yes")

    def test_benchmark_start_splits_working_time(self):
        (self.run_dir / "phase-log.jsonl").write_text(
            json.dumps({"at": "2026-01-05T11:30:00+00:00", "phase": "benchmark", "status": "running"}) + "\n")
        work = score_run.score(self.run_dir, session="sess-w")["sections"]["cost"]["working"]
        self.assertEqual(work["production"]["workingSeconds"], 190)
        self.assertEqual(work["benchmark"]["workingSeconds"], 30)
        for part in (work["production"], work["benchmark"]):
            self.assertEqual(part["workingSeconds"] + part["waitingOnPersonSeconds"] + part["waitingOnLimitsSeconds"]
                             + part["waitingOnServiceSeconds"], part["spanSeconds"])

    def test_without_a_transcript_only_measured_intervals_are_shown(self):
        out = self.root / "out"
        with contextlib.redirect_stdout(io.StringIO()):
            score_run.main([str(self.run_dir), "--out", str(out)])
        card = json.loads((out / "scorecard.json").read_text())
        self.assertEqual(card["sections"]["cost"]["working"]["status"], "not-measured")
        self.assertIsNone(card["headline"]["effort"]["workingSeconds"])
        self.assertEqual(card["headline"]["effort"]["buildSeconds"], 13)      # the runner's own log
        html = (out / "report.html").read_text()
        message = (out / "completion.md").read_text()
        for text in (html, message):
            self.assertNotIn("idle time", text)
            self.assertIn("Working time was not measured for this run" if text is html else
                          "working time was not measured for this run", text)
        self.assertIn("How time is measured", html)
        self.assertNotIn("design-lab took", html)


class ClaudeTokensTest(unittest.TestCase):
    """The report and the completion message count Claude's work, by Claude model, and never show tool input."""

    def test_only_claude_models_and_no_tool_input(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run_dir = make_run(root)
            config = root / "config"
            main = config / "projects" / "-repo" / "sess-x.jsonl"
            write_transcript(main, [
                entry("prompt", "2026-01-05T10:00:00Z", session="sess-x"),
                entry("step", "2026-01-05T10:00:10Z", session="sess-x",
                      command="example-cli run --model other-model-1"),
                entry("result", "2026-01-05T10:01:00Z", session="sess-x"),
                entry("reply", "2026-01-05T10:01:10Z", session="sess-x", model="other-model-1"),
                entry("reply", "2026-01-05T10:01:20Z", session="sess-x"),
            ])
            write(run_dir / "project.json", legacy_project(run={"claude": {"configDir": str(config),
                                                                             "model": "other-model-1"}}))
            out = root / "out"
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(score_run.main([str(run_dir), "--session", "sess-x", "--out", str(out)]), 0)
            card = json.loads((out / "scorecard.json").read_text())
            model = card["sections"]["cost"]["model"]
            self.assertEqual([r["name"] for r in model["byModel"]], ["Opus 5.5"])
            self.assertTrue(all(r["model"].startswith("claude-") for r in model["byModel"]))
            self.assertEqual(model["developer"]["unattributedEntries"], 1)
            html = re.sub(r"data:image/[a-z]+;base64,[A-Za-z0-9+/=]+", "", (out / "report.html").read_text())
            message = (out / "completion.md").read_text()
            for text in (html, message):
                for placeholder in ("other-model-1", "example-cli"):
                    self.assertNotIn(placeholder, text)
            self.assertNotIn("unattributedEntries", html)


class RecordedBuildTest(unittest.TestCase):
    """Built is what the build recorded, never what it planned."""

    def workspace(self, state):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        w = Path(temp.name)
        write(w / "components.json", {"components": [{"id": "a", "label": "A", "usage": {"tier": "High Use"}},
                                                     {"id": "b", "label": "B", "usage": {"tier": "Low Use"}}]})
        write(w / "plan.json", {"plans": [{"id": "a", "verdict": "build"}, {"id": "b", "verdict": "build"}]})
        write(w / "figma" / "state.json", state)
        return w

    def test_a_build_that_stopped_after_the_cover_built_nothing(self):
        import library_counts
        steps = [{"id": s} for s in ("pages", "build:a", "block:a", "build:b", "block:b", "cover")]
        for key in ("planned", "built"):                 # `built` is what older state files called the plan
            c = library_counts.counts(self.workspace({key: ["a", "b"], "steps": steps, "done": ["pages"]}))
            self.assertEqual((c["built"], c["eligible"]), (0, 2), key)
            self.assertEqual([r["built"] for r in c["coverBreakdown"]], [0, 0, 0, 0])
        c = library_counts.counts(self.workspace({"planned": ["a", "b"], "steps": steps,
                                                  "done": ["pages", "build:a", "block:a", "build:b"]}))
        self.assertEqual(c["built"], 1)                  # b has its master but not its block yet
        self.assertEqual(library_counts.coverage_sentence(c), "Built 1 of 2 components it could have built (50%).")


class MalformedTranscriptTest(unittest.TestCase):
    def test_a_line_whose_message_is_not_an_object_is_skipped(self):
        with tempfile.TemporaryDirectory() as temp:
            f = Path(temp) / "s.jsonl"
            f.write_text("\n".join(json.dumps(x) for x in [
                {"type": "user", "timestamp": "2026-09-29T10:00:00Z", "message": {"role": "user", "content": "hi"}},
                {"type": "assistant", "timestamp": "2026-09-29T10:00:05Z", "message": "truncated"},
                {"type": "user", "timestamp": "2026-09-29T10:00:06Z", "message": ["not", "an", "object"]},
                {"type": "user", "timestamp": "2026-09-29T10:00:07Z", "message": {"content": [{"type": "text", "text": 5}]}},
                {"type": "assistant", "timestamp": "2026-09-29T10:00:09Z",
                 "message": {"model": "claude-opus-5-5", "content": [{"type": "text", "text": "done"}],
                             "usage": {"output_tokens": 3}}}]) + "\n")
            self.assertEqual(score_run.working_time([f], None, None)["status"], "measured")
            usage = score_run.transcript_usage([f], None, None)
            self.assertEqual((usage["assistantMessages"], usage["tokens"]["output"]), (1, 3))


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

    def preflight(self, handshake, **answers):
        """workflow.py preflight in this process, with the runner handshake standing in for Figma."""
        import argparse
        from unittest import mock
        import workflow
        values = {"project": str(self.ws), "site_url": self.site, "public_url": None,
                  "figma_url": "https://www.figma.com/design/KEY9/Library", "site_label": "Example site",
                  "operator": "A. Person", "model": None, "ddev_root": None, "plan_approval": "proposed",
                  "usage_fallback": "stop", "runner_timeout": 1} | answers
        out = io.StringIO()
        with mock.patch.object(workflow, "runner_handshake", return_value=dict(handshake)) as called, \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            try:
                workflow.preflight_command(argparse.Namespace(**values))
                code = 0
            except SystemExit as stop:
                code = stop.code
        return code, json.loads(out.getvalue()), called

    def start_site(self):
        import http.server
        import threading
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        self.site = f"http://127.0.0.1:{server.server_address[1]}/"

    def test_preflight_gives_the_go_ahead_only_with_a_drawn_cover(self):
        self.start_site()
        self.workflow("init", "--repo", str(self.repo), "--workspace", str(self.ws))
        proof = {"ok": True, "runnerConnected": True, "fileKey": "KEY9", "fileKeyMatches": True, "empty": True,
                 "writable": True, "coverPageId": "0:1", "coverId": "1:2", "font": "IBM Plex Sans",
                 "fontLoaded": True, "pluginData": True, "at": "2026-01-05T10:00:00+00:00", "token": "t"}
        code, ready, _ = self.preflight(proof)
        self.assertEqual(code, 0)
        self.assertEqual(ready["message"], "I have everything I need; it's safe to let this run to completion.")
        log = [json.loads(l) for l in (self.ws / "phase-log.jsonl").read_text().splitlines()]
        self.assertEqual((log[-1]["phase"], log[-1]["status"], log[-1]["at"]), ("preflight", "complete", ready["goAheadAt"]))
        project = json.loads((self.ws / "project.json").read_text())
        self.assertEqual(project["target"]["figmaFileKey"], "KEY9")
        self.assertEqual(project["target"]["preflight"]["coverPageId"], "0:1")
        self.assertEqual(project["target"]["preflight"]["fileUrl"], "https://www.figma.com/design/KEY9/Library")
        self.assertTrue(project["target"]["preflight"]["fontLoaded"])
        runner = project["phases"]["preflight"]["detail"]["checks"]["runner"]
        self.assertTrue(runner["writable"] and runner["empty"] and runner["fileKeyMatches"])
        self.assertEqual((project["run"]["siteLabel"], project["run"]["operator"]), ("Example site", "A. Person"))

    def test_preflight_records_no_go_ahead_on_any_failure(self):
        self.start_site()
        self.workflow("init", "--repo", str(self.repo), "--workspace", str(self.ws))
        failures = ["no runner connected within 1 seconds; open the target file",
                    "the runner is open in a different file ('Other', key OTHER)",
                    "the runner's token was rejected; paste the token",
                    "the target file 'Library' is not empty (3 page(s))",
                    "the name-only Cover could not be drawn: IBM Plex Sans could not load and the fallback failed",
                    "the Cover page could not be created: read-only file"]
        for failure in failures:
            code, answer, _ = self.preflight({"ok": False, "failure": failure, "token": "t"})
            self.assertEqual(code, 1, failure)
            self.assertFalse(answer["ready"])
            self.assertIn(failure, answer["missing"])
            self.assertNotIn('"preflight"', (self.ws / "phase-log.jsonl").read_text())
            self.assertNotIn("preflight", json.loads((self.ws / "project.json").read_text())["target"])
        # Other answers missing: every problem is listed together, still with no go-ahead.
        code, answer, called = self.preflight({"ok": True}, site_url="http://127.0.0.1:9/", figma_url=None)
        self.assertEqual((code, len(answer["missing"])), (1, 2))       # site not answering, no Figma file
        called.assert_not_called()
        self.assertNotIn('"preflight"', (self.ws / "phase-log.jsonl").read_text())

    def test_an_absent_runner_stops_the_build_with_what_to_do_first(self):
        import datetime as dt
        from unittest import mock
        import figma_runner
        import workflow
        self.ws.mkdir()
        project = legacy_project(target={"figmaFileKey": "KEY9", "figmaUrl": "https://www.figma.com/design/KEY9/Library"},
                                 phases={"foundation": {"status": "complete"}, "components": {"status": "running"}})
        write(self.ws / "project.json", project)
        with mock.patch.object(figma_runner, "ensure_server", return_value={"alive": True}):
            stopped = workflow.await_runner(self.ws, project, minutes=0.002, poll=0.01)
            self.assertFalse(stopped["connected"])
            self.assertTrue(stopped["message"].startswith(
                "Open Figma desktop, open https://www.figma.com/design/KEY9/Library, and start the design-lab runner. "
                "The build writes the component library into that file through the runner, and it has not connected for "))
            log = [json.loads(l) for l in (self.ws / "phase-log.jsonl").read_text().splitlines()]
            self.assertEqual((log[-1]["phase"], log[-1]["status"], log[-1]["reason"]),
                             ("components", "stopped", "runner not connected"))
            # The runner asked for a step a moment ago: the build carries on where it stopped.
            (self.ws / "figma").mkdir(exist_ok=True)
            (self.ws / "figma" / figma_runner.SEEN_FILE).write_text(dt.datetime.now(dt.timezone.utc).isoformat())
            self.assertTrue(workflow.await_runner(self.ws, project, minutes=2, poll=0.01)["connected"])
            # A stale time, but the server is still answering a slow step the runner asked for.
            (self.ws / "figma" / figma_runner.SEEN_FILE).write_text("2026-01-01T00:00:00+00:00")
            with mock.patch.object(figma_runner, "server_status", return_value={"inflight": True}):
                answer = workflow.await_runner(self.ws, project, minutes=0.002, poll=0.01)
            self.assertEqual((answer["connected"], answer["inflight"]), (True, True))

    def test_plan_approval_follows_the_preflight_choice(self):
        self.ws.mkdir()
        for choice, approved in (("proposed", True), ("review", False)):
            write(self.ws / "project.json", legacy_project(phases={
                "plan": {"status": "awaiting-approval"},
                "preflight": {"status": "complete", "detail": {"planApproval": choice, "operator": "A. Person"}}}))
            result = self.workflow("approve", "--project", str(self.ws), "--from-preflight", check=False)
            self.assertEqual(result.returncode == 0, approved, result.stderr)
            if approved:
                plan = json.loads((self.ws / "project.json").read_text())["phases"]["plan"]
                self.assertEqual(plan["approvedBy"], "A. Person (preflight: build the plan as proposed)")
            else:
                self.assertIn("review", result.stderr)

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
