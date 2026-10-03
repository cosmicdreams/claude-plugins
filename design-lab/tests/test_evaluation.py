"""Replay isolation, offline image resolution and shared evaluation metrics."""
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import corpus
import fetch_images
import figma_build
import lab_config
import property_compare
import responsive
import run_metrics
import scoreboard
import score_run
import tier1
import tier2
import verify_inputs


def node(path="/div[0]", x=0, y=0, width=100, height=50, tag="div", **computed):
    return {"path": path, "tag": tag, "classes": [], "box": {"x": x, "y": y, "width": width, "height": height},
            "computed": {"display": "block", "visibility": "visible", "opacity": "1",
                         "fontSize": "16px", "fontWeight": "400", "textAlign": "left", **computed}}


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def fixture(path, legacy=False):
    component = {"id": "block:sample", "machineName": "sample", "label": "Sample", "sourceRef": "source/sample"}
    write(path / "components.json", {"components": [component]})
    write(path / "plan.json", {"plans": [{"id": component["id"], "verdict": "build"}]})
    write(path / "project.json", {"pluginVersion": "0.16.0", "run": {"plugin": {"version": "0.16.0", "commit": "saved-commit"}},
                                 "repository": {"root": str(path / "repository")}})
    spec = {"component": "Sample", "machineName": "sample", "source": {"sourceRef": component["sourceRef"]},
            "measurements": {f"{bp}:default": {"nodes": [node()]} for bp in ("desktop", "tablet", "mobile")}}
    write(path / "capture/measurements" / ("sample.spec.json" if legacy else "block__sample.spec.json"), spec)
    write(path / "capture-evidence.json", {"canonicalBaseUrl": "https://example.invalid", "captures": {"block:sample": {
        "images": [{"file": str(path / "capture/shots/sample.png")}]
    }}})
    (path / "capture/shots").mkdir(parents=True)
    (path / "capture/shots/sample.png").write_bytes(b"saved shot")
    images = path / "figma/images/block:sample"
    images.mkdir(parents=True)
    (images / "saved.png").write_bytes(b"saved image")
    write(images / "images.json", [{"src": "/saved.png", "file": str(images / "saved.png"), "contentType": "image/png"}])
    return spec


def snapshot(path):
    return {str(p.relative_to(path)): p.read_bytes() for p in path.rglob("*") if p.is_file()}


class EvaluationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        config = self.root / "config.json"
        write(config, {"corpus": str(self.root / "corpus"), "scoreboard": {
            "ledger": str(self.root / "ledger.jsonl"), "dashboard": str(self.root / "dashboard.html")}})
        self.environment = mock.patch.dict(os.environ, {"DESIGN_LAB_CONFIG": str(config)})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.config = config
        self.run = self.root / "run"
        self.spec = fixture(self.run)

    def test_config_missing_file_and_each_key(self):
        self.config.unlink()
        with self.assertRaisesRegex(ValueError, "configuration file.*corpus"):
            lab_config.load_config()
        for value, key in [({}, "corpus"), ({"corpus": "x"}, "scoreboard.ledger"),
                           ({"corpus": "x", "scoreboard": {"ledger": "x"}}, "scoreboard.dashboard")]:
            write(self.config, value)
            with self.assertRaisesRegex(ValueError, key):
                lab_config.load_config()

    def test_freeze_preserves_source_and_all_artifacts(self):
        before = snapshot(self.run)
        manifest = corpus.freeze(self.run, "site-a")
        frozen = self.root / "corpus/site-a"
        self.assertEqual(snapshot(self.run), before)
        for name, data in before.items():
            self.assertEqual((frozen / name).read_bytes(), data)
        self.assertEqual(manifest["pluginCommit"], "saved-commit")
        self.assertEqual(manifest["fileCount"], len(before))
        self.assertEqual(manifest["totalBytes"], sum(map(len, before.values())))
        self.assertEqual(set(manifest["artifacts"]), {name for name in before if name.endswith(".json")})
        self.assertEqual(manifest["artifacts"]["project.json"], corpus.sha256(self.run / "project.json"))
        with self.assertRaisesRegex(ValueError, "already exists"):
            corpus.freeze(self.run, "site-a")
        self.assertEqual(corpus.sites(), [frozen])

    def test_labels_cannot_escape_corpus(self):
        for label in ("..", "../outside", "/absolute", "a/b", "a\\b"):
            with self.assertRaises(ValueError):
                lab_config.site_path(label)

    def test_offline_images_make_zero_network_calls_and_do_not_read_source(self):
        frozen = self.root / "copied-images"
        frozen.mkdir()
        (frozen / "saved.png").write_bytes(b"copied bytes")
        write(frozen / "images.json", [{"src": "/saved.png", "file": str(self.run / "figma/images/block:sample/saved.png"),
                                        "contentType": "image/png"},
                                       {"src": "/missing.png", "file": str(self.run / "capture/shots/sample.png")}])
        tree = self.root / "tree.json"
        write(tree, {"tree": {"children": [{"kind": "image", "src": s} for s in
                                           ("/saved.png", "/missing.png", "/unknown.png")]}})
        with mock.patch.object(sys, "argv", ["fetch_images.py", str(tree), "--base-url", "https://example.invalid",
                                            "--fallback-base-url", "https://fallback.invalid", "--out", str(frozen), "--offline"]), \
             mock.patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden")) as network, \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(fetch_images.main(), 0)
        network.assert_not_called()
        items = {m["src"]: m for m in json.loads((frozen / "images.json").read_text())}
        self.assertEqual(items["/saved.png"]["file"], str(frozen / "saved.png"))
        self.assertIn("error", items["/missing.png"])
        self.assertIn("error", items["/unknown.png"])

    def test_tier1_fixture_is_read_only_and_uses_init_tree_path(self):
        before = snapshot(self.run)
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden")) as network, \
             mock.patch.object(figma_build, "build_trees", wraps=figma_build.build_trees) as builder:
            result = tier1.replay(self.run, "site-a")
        network.assert_not_called()
        builder.assert_called_once()
        self.assertEqual(snapshot(self.run), before)
        self.assertEqual(result["metrics"]["geometry"]["passed"], 12)
        self.assertEqual(result["metrics"]["geometry"]["total"], 12)
        trees = self.root / "trees"
        figma_build.build_trees(self.run, trees)
        self.assertEqual(json.loads((trees / "block:sample.json").read_text()), responsive.build(self.spec, "Sample", "block:sample"))

    def test_tier1_cli_corpus_and_direct_run(self):
        corpus.freeze(self.run, "site-a")
        for arguments in (["--run", str(self.run)], ["--site", "site-a"], ["--all"]):
            result = subprocess.run([sys.executable, str(SCRIPTS / "tier1.py"), *arguments], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)[0]["tier"], 1)
            self.assertIn("components rebuilt", result.stderr)

    def test_measurements_support_legacy_and_keep_qualified_ids(self):
        other = self.root / "legacy"
        fixture(other, legacy=True)
        self.assertEqual(set(verify_inputs.build_measurements(other)), {"block:sample"})
        self.assertEqual(verify_inputs.build_measurements(self.run)["block:sample"]["nodes"], self.spec["measurements"]["desktop:default"]["nodes"])

    def test_tier2_scratch_copy_relocates_and_never_changes_frozen_site(self):
        corpus.freeze(self.run, "site-a")
        site = self.root / "corpus/site-a"
        before = snapshot(site)
        workspace = tier2.prepare(site, "scratch-key")
        self.assertEqual(workspace.parent, site / "replays")
        for name, data in before.items():
            self.assertEqual((site / name).read_bytes(), data)
        evidence = json.loads((workspace / "capture-evidence.json").read_text())
        self.assertEqual(evidence["captures"]["block:sample"]["images"][0]["file"], str(workspace / "capture/shots/sample.png"))
        project = json.loads((workspace / "project.json").read_text())
        self.assertEqual(project["target"]["figmaFileKey"], "scratch-key")
        self.assertEqual(project["run"]["evaluationTier"], 2)
        self.assertEqual(json.loads((workspace / "figma/state.json").read_text()), {"fileKey": "scratch-key"})
        again = tier2.prepare(site, "scratch-key")
        self.assertNotEqual(workspace, again)
        self.assertFalse((again / "replays").exists())

    def test_scoreboard_and_benchmark_share_metrics_and_append_rows(self):
        write(self.run / "figma/state.json", {"planned": ["block:sample"], "done": ["build:block:sample"]})
        write(self.run / "verify-report.json", {"open": [{"severity": "major"}], "passed": ["sample"]})
        with mock.patch.object(run_metrics, "score_accuracy", return_value={"status": "not-measured"}):
            first = scoreboard.record(self.run, 2, "site-a")
            second = scoreboard.record(self.run, 3, "site-a")
        rows = [json.loads(line) for line in (self.root / "ledger.jsonl").read_text().splitlines()]
        self.assertEqual(rows, [first, second])
        self.assertEqual(first["coverage"]["built"], score_run.score_coverage(self.run)["built"])
        self.assertEqual(first["openFindings"]["major"], score_run.score_conformance(self.run, {})["open"]["major"])
        self.assertIsNone(first["correctedWidths"])
        self.assertIsNone(first["tokens"])
        self.assertTrue((self.root / "dashboard.html").exists())  # every record redraws the dashboard
        with self.assertRaises(ValueError):
            scoreboard.record(self.run, 1, "site-a")

    def test_init_marks_corpus_images_offline_and_keeps_the_rebuilt_tree(self):
        corpus.freeze(self.run, "site-a")
        site = self.root / "corpus/site-a"
        workspace = tier2.prepare(site, "scratch-key")
        result = subprocess.run([sys.executable, str(SCRIPTS / "figma_build.py"), "init",
                                 "--project", str(workspace), "--file-key", "scratch-key",
                                 "--site-url", "https://example.invalid", "--canonical-base-url", "https://example.invalid",
                                 "--rebuild"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        state = json.loads((workspace / "figma/state.json").read_text())
        self.assertTrue(state["offlineImages"])
        self.assertEqual(state["steps"][0]["id"], "wipe")
        self.assertEqual(json.loads((workspace / "figma/trees/block:sample.json").read_text()),
                         responsive.build(self.spec, "Sample", "block:sample"))

    def test_tier2_waits_for_dumps_after_build_and_reports_runner_errors(self):
        status = subprocess.CompletedProcess([], 0, json.dumps({"done": 2, "total": 2, "next": None}))
        with mock.patch.object(tier2, "command", return_value=status), \
             mock.patch.object(tier2.figma_runner.Build, "dump_step", side_effect=[{"step": "verify:root"}, None]) as dump, \
             mock.patch.object(tier2.time, "sleep") as sleep, contextlib.redirect_stderr(io.StringIO()):
            tier2.wait_for_build(self.run, 10)
        self.assertEqual(dump.call_count, 2)
        sleep.assert_called_once()
        (self.run / "figma/runner.log").write_text("2026-01-01T00:00:00 error: build failed\n")
        with mock.patch.object(tier2, "command", return_value=status), \
             mock.patch.object(tier2.figma_runner.Build, "dump_step", return_value={"step": "verify:root"}), \
             contextlib.redirect_stderr(io.StringIO()), self.assertRaisesRegex(RuntimeError, "build failed"):
            tier2.wait_for_build(self.run, 10)

    def test_tier2_verification_findings_do_not_prevent_scoring(self):
        write(self.run / "figma/verify/state.json", {})
        write(self.run / "tokens.json", {})
        write(self.run / "index.json", {})
        write(self.run / "waivers.json", {"waivers": []})
        write(self.run / "render-evidence.json", {})
        (self.run / "builds").mkdir()
        calls = []

        def execute(script, *args, **kwargs):
            calls.append((script, list(map(str, args))))
            if script == "verify.py":
                write(self.run / "verify-report.json", {"open": [{"severity": "major"}]})
                return subprocess.CompletedProcess([], 1, "findings")
            return subprocess.CompletedProcess([], 0, "")

        with mock.patch.object(tier2, "command", side_effect=execute):
            result = tier2.evaluate(self.run)
        self.assertEqual(result["verifyExit"], 1)
        self.assertEqual(calls[-1][0], "score_run.py")
        flags = next(args for script, args in calls if script == "verify.py")
        for name in ("measurements", "components", "tokens", "plan", "index", "waivers", "render-evidence",
                     "capture-evidence", "shots-dir", "builds"):
            self.assertIn("--" + name, flags)
        measured = json.loads((self.run / "figma/verify/measurements.json").read_text())
        self.assertIn("block:sample", measured)
        self.assertTrue((self.run / "figma/compare/corrected.json").exists())

    def test_shared_cost_metrics_keep_recorded_values(self):
        cost = {"model": {"status": "measured", "tokens": 23}, "clock": {"wallSeconds": 12}}
        write(self.run / "benchmark/scorecard.json", {"sections": {"cost": cost}})
        self.assertEqual(run_metrics.tokens(self.run), cost["model"]["tokens"])
        self.assertEqual(run_metrics.elapsed_time(self.run), {"clock": cost["clock"]})


class PropertyCompareTest(unittest.TestCase):
    def test_seeded_geometry_font_alignment_image_and_inline_loss(self):
        text = node("/div[0]/p[1]", width=100, height=20, tag="p", textAlign="center")
        text["inlineText"] = "Hello world"
        strong = node("/div[0]/p[1]/strong[2]", width=40, height=20, tag="strong", fontWeight="700")
        strong["text"] = "world"
        image = node("/div[0]/img[3]", y=20, width=100, height=30, tag="img")
        image["image"] = {"src": "/sample.png"}
        spec = {"measurements": {"desktop:default": {"nodes": [node(), text, strong, image]}}}
        tree = {"measured": ["desktop"], "variables": {}, "tree": {
            "kind": "frame", "source": "/div[0]", "width": 90, "height": 50, "layout": {"mode": "NONE"},
            "children": [{"kind": "text", "source": text["path"], "x": 4, "y": 0, "width": 100, "height": 20,
                          "text": {"characters": "Hello world", "size": 18, "align": "LEFT"}}]}}
        result = property_compare.compare(tree, spec)["desktop:default"]
        for metric in ("geometry", "fontSize", "textAlignment", "textRunCount", "imagesPresent"):
            self.assertLess(result[metric]["passed"], result[metric]["total"])
        self.assertTrue(result["textRunCount"]["checks"][0]["flattened"])

    def test_breakpoint_variables_and_missing_state_are_measured_honestly(self):
        tree = {"measured": ["desktop", "mobile"], "variables": {"width": {"values": {"Desktop": 100, "Mobile": 50}}},
                "tree": {"source": "/div[0]", "width": {"var": "width"}, "height": 50}}
        spec = {"measurements": {"desktop:default": {"nodes": [node()]},
                                 "mobile:default": {"nodes": [node(width=50)]},
                                 "desktop:expanded": {"nodes": [node()]}}}
        result = property_compare.compare(tree, spec)
        self.assertEqual(result["mobile:default"]["geometry"]["passed"], 4)
        self.assertEqual(result["desktop:expanded"]["status"], "unmeasured")

    def test_layout_positions_come_from_flow_not_saved_coordinates(self):
        root = {"width": 100, "height": 50, "layout": {"mode": "HORIZONTAL", "gap": 10}, "children": [
            {"width": 20, "height": 20, "source": "a", "x": 400},
            {"width": 30, "height": 20, "source": "b", "x": 900}]}
        rows = property_compare.layout_nodes(root)
        self.assertEqual([r["box"]["x"] for r in rows], [0, 0, 30])

    def test_missing_font_shaping_geometry_is_not_a_pass(self):
        rows = property_compare.layout_nodes({"width": 100, "height": 30, "layout": {"mode": "VERTICAL"},
                                             "children": [{"kind": "text", "source": "text"}]})
        check = property_compare.numeric_check("text", "height", 20, rows[1]["box"]["height"], 2)
        self.assertIsNone(check["pass"])
        self.assertEqual(property_compare.metric([check])["unmeasured"], 1)


if __name__ == "__main__":
    unittest.main()


class ScoreboardRenderTests(unittest.TestCase):
    def test_dashboard_reads_ledger_rows_and_names_unmeasured_values(self):
        import scoreboard_render
        rows = [{"timestamp": "2026-10-02T12:00:00Z", "site": "site-a", "pluginVersion": "0.16.0",
                 "pluginCommit": "abc12345", "tier": 2,
                 "coverage": {"placementShare": 0.82},
                 "correctedWidths": {"pass": 14, "total": 102},
                 "openFindings": {"blocker": 4, "major": 1}},
                {"timestamp": "2026-10-03T12:00:00Z", "site": "site-b", "pluginVersion": "0.17.0", "tier": 2}]
        values = {r["site"]: r["values"] for r in scoreboard_render.normalise(rows)}
        self.assertEqual(values["site-a"], {"fidelity": 13.7, "coverage": 82.0, "findings": 5})
        self.assertEqual(values["site-b"], {"fidelity": None, "coverage": None, "findings": None})
        page = scoreboard_render.render(rows)
        self.assertIn('"site-a"', page)
        self.assertNotIn("<script src", page)  # self-contained: no network assets
