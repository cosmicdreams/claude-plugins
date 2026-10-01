"""Capture configuration and orchestration without a browser."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import capture_all
import scaffold_configs


class CaptureAllTest(unittest.TestCase):
    def fixture(self, root):
        workspace = root / "workspace"
        workspace.mkdir()
        components = [
            {"id": "sdc.demo.zeta", "machineName": "zeta", "label": "Zeta",
             "usage": {"renderedExamples": ["/home", "/other"],
                       "exampleCandidates": ["/candidate"]}},
            {"id": "sdc.demo.alpha", "machineName": "alpha", "label": "Alpha",
             "usage": {"examples": [{"path": "/verified", "status": 200}],
                       "renderedExamples": ["/rendered"]}},
            {"id": "sdc.demo.empty", "machineName": "empty", "label": "Empty",
             "usage": {"examples": [], "renderedExamples": [], "exampleCandidates": []}},
        ]
        (workspace / "components.json").write_text(json.dumps({
            "source": {"strategy": "canvas"}, "components": components}), encoding="utf-8")
        return workspace

    def test_scaffold_prefers_first_populated_example_source_and_sdc_selector(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = self.fixture(root)
            out = root / "configs"
            args = ["scaffold_configs.py", str(workspace / "components.json"),
                    "--out", str(out), "--site-url", "https://demo.ddev.site",
                    "--canonical-base-url", "https://demo.example"]
            with patch.object(sys, "argv", args):
                self.assertEqual(scaffold_configs.main(), 0)
            alpha = json.loads((out / "sdc.demo.alpha.json").read_text())
            zeta = json.loads((out / "sdc.demo.zeta.json").read_text())
            self.assertEqual(alpha["path"], "/verified")
            self.assertEqual(zeta["path"], "/home")
            self.assertEqual(zeta["verificationUrl"], "https://demo.ddev.site/home")
            self.assertEqual(zeta["linkUrl"], "https://demo.example/home")
            self.assertEqual(zeta["rootSelector"], '[data-component-id="demo:zeta"]')
            self.assertEqual(zeta["nth"], 0)
            self.assertIsNone(json.loads((out / "sdc.demo.empty.json").read_text())["path"])
            self.assertEqual(scaffold_configs.first_example({
                "renderedExamples": [], "exampleCandidates": ["/candidate", "/later"]}),
                {"path": "/candidate"})

    def fake_runner(self, workspace, calls, visible=None, measure_fails=()):
        """Stand in for the node scripts. `visible` maps a component id to the page the
        selector check finds it on (None: found nowhere); `measure_fails` lists pages
        where measurement errors."""
        visible = visible or {}

        def fake_run(command, cwd=None):
            label = Path(command[1]).name
            calls.append((label, Path(cwd) if cwd else None))
            if label == "scaffold_configs.py":
                with patch.object(sys, "argv", ["scaffold_configs.py", *command[2:]]):
                    scaffold_configs.main()
            elif label == "check_selectors.mjs":
                checks = json.loads(Path(command[3]).read_text())
                rows = []
                for item in checks:
                    chosen = visible.get(item["componentId"], item["pages"][0]["path"])
                    rows.append({"componentId": item["componentId"], "chosen": chosen,
                                 "pages": [{"path": page["path"], "matches": 0, "visible": 0}
                                           for page in item["pages"]]})
                Path(command[5]).write_text(json.dumps(rows))
            elif label == "measure.mjs":
                cfg = json.loads(Path(command[3]).read_text())
                calls[-1] = (label, cfg["path"])
                out = Path(command[5]) / (cfg["machineName"] + ".spec.json")
                bad = cfg["path"] in measure_fails
                out.write_text(json.dumps({"measurements": {
                    f"{vp}:default": ({"error": "no element"} if bad else {"nodes": [1]})
                    for vp in ("desktop", "tablet", "mobile")}}))
            elif label == "capture.mjs":
                out = Path(command[command.index("--out") + 1])
                wanted = command[command.index("--only-ids") + 1]
                rows = []
                for config in sorted((workspace / "capture/configs").glob("*.json")):
                    cfg = json.loads(config.read_text())
                    if cfg["componentId"] != wanted:
                        continue
                    for viewport in ("Desktop", "Tablet", "Mobile"):
                        name = f"{cfg['machineName']}__{viewport.lower()}.png"
                        (out / name).write_bytes(b"png")
                        rows.append({"componentId": cfg["componentId"],
                                     "machine": cfg["machineName"], "file": name,
                                     "path": cfg["path"],
                                     "verificationUrl": cfg["verificationUrl"],
                                     "linkUrl": cfg["linkUrl"],
                                     "selector": cfg["rootSelector"],
                                     "viewport": viewport, "state": "default",
                                     "width": 100, "height": 50})
                (out / "index.json").write_text(json.dumps(rows))
            elif label == "assemble_capture_evidence.py":
                with patch.object(sys, "argv", ["assemble_capture_evidence.py", *command[2:]]):
                    from assemble_capture_evidence import main
                    self.assertEqual(main(), 0)
            return type("Result", (), {"returncode": 0, "stdout": "", "stderr": ""})()
        return fake_run

    def argv(self, workspace, root, *extra):
        return ["--project", str(workspace), "--site-url", "https://demo.ddev.site",
                "--canonical-base-url", "https://demo.example", "--theme-root", str(root),
                "--node-cwd", str(root), "--scale", "1", *extra]

    def run_capture(self, workspace, root, *extra, **fake):
        calls = []
        with patch.object(capture_all, "run", side_effect=self.fake_runner(workspace, calls, **fake)):
            code = capture_all.main(self.argv(workspace, root, *extra))
        return code, [name for name, _ in calls], calls

    def test_runner_checks_then_measures_and_captures_each_component_and_registers(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = self.fixture(root)
            code, names, calls = self.run_capture(workspace, root)
            self.assertEqual(code, 1)
            self.assertEqual(names, [
                "scaffold_configs.py", "check_selectors.mjs", "measure.mjs", "capture.mjs",
                "measure.mjs", "capture.mjs", "assemble_capture_evidence.py", "workflow.py"])
            evidence = json.loads((workspace / "capture-evidence.json").read_text())
            self.assertEqual(list(evidence["captures"]), ["sdc.demo.alpha", "sdc.demo.zeta"])
            self.assertEqual(evidence["problems"], [{
                "componentId": "sdc.demo.empty", "detail": capture_all.NO_EVIDENCE}])
            # Files are named by component id, so equal machine names cannot collide.
            capture = workspace / "capture"
            self.assertTrue((capture / "measurements/sdc.demo.alpha.spec.json").is_file())
            self.assertTrue((capture / "shots/sdc.demo.alpha__desktop.png").is_file())
            self.assertEqual(json.loads((capture / "records/sdc.demo.alpha.json").read_text())
                             ["status"], "complete")

    def test_second_run_skips_complete_components_and_keeps_their_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = self.fixture(root)
            self.run_capture(workspace, root)
            code, names, _ = self.run_capture(workspace, root)
            self.assertEqual(names, ["scaffold_configs.py", "assemble_capture_evidence.py",
                                     "workflow.py"])
            evidence = json.loads((workspace / "capture-evidence.json").read_text())
            self.assertEqual(list(evidence["captures"]), ["sdc.demo.alpha", "sdc.demo.zeta"])

    def test_changed_config_makes_the_recorded_outcome_stale(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = self.fixture(root)
            self.run_capture(workspace, root)
            document = json.loads((workspace / "components.json").read_text())
            document["components"][1]["usage"]["examples"] = [{"path": "/moved", "status": 200}]
            (workspace / "components.json").write_text(json.dumps(document))
            _, names, calls = self.run_capture(workspace, root)
            self.assertEqual([c for c in calls if c[0] == "measure.mjs"],
                             [("measure.mjs", "/moved")])

    def test_only_redoes_the_named_component(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = self.fixture(root)
            self.run_capture(workspace, root)
            _, names, _ = self.run_capture(workspace, root, "--only", "sdc.demo.zeta", "--fresh")
            self.assertEqual(names.count("measure.mjs"), 1)
            with self.assertRaises(SystemExit):
                self.run_capture(workspace, root, "--only", "sdc.demo.missing")

    def test_selector_check_failure_skips_measurement_and_check_mode_captures_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = self.fixture(root)
            code, names, _ = self.run_capture(workspace, root, "--check",
                                              visible={"sdc.demo.zeta": None})
            self.assertEqual(code, 1)
            self.assertEqual(names, ["scaffold_configs.py", "check_selectors.mjs"])
            code, names, _ = self.run_capture(workspace, root, visible={"sdc.demo.zeta": None})
            self.assertEqual(names.count("measure.mjs"), 1)
            evidence = json.loads((workspace / "capture-evidence.json").read_text())
            detail = {p["componentId"]: p["detail"] for p in evidence["problems"]}
            self.assertIn("no visible match", detail["sdc.demo.zeta"])

    def test_without_the_check_fallback_stops_at_max_pages(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = self.fixture(root)
            document = json.loads((workspace / "components.json").read_text())
            document["components"][1]["usage"]["examples"] = [
                {"path": f"/p{n}", "status": 200} for n in range(6)]
            (workspace / "components.json").write_text(json.dumps(document))
            _, _, calls = self.run_capture(
                workspace, root, "--no-check", "--only", "sdc.demo.alpha",
                measure_fails={f"/p{n}" for n in range(6)})
            # Each page gets one retry only when the script itself fails, so one call each.
            self.assertEqual([c[1] for c in calls if c[0] == "measure.mjs"],
                             ["/p0", "/p1", "/p2"])

if __name__ == "__main__":
    unittest.main()


class DerivedChildTest(unittest.TestCase):
    def test_a_tagged_child_gets_its_parents_subtree_and_crop(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            measurements, shots, records = (root / name for name in ("m", "s", "r"))
            for d in (measurements, shots, records):
                d.mkdir()
            by_id = {"block:p": {"id": "block:p", "slots": [{"accepts": ["paragraph:c"]}]},
                     "paragraph:c": {"id": "paragraph:c", "label": "C", "machineName": "c"}}
            nodes = lambda: [{"path": "/div[0]", "box": {"x": 0, "y": 0, "width": 100, "height": 60}, "attributes": {}},
                             {"path": "/div[0]/div[1]", "box": {"x": 10, "y": 20, "width": 30, "height": 20},
                              "attributes": {"data-design-lab-child": "paragraph:c"}},
                             {"path": "/div[0]/div[1]/p[2]", "box": {"x": 12, "y": 22, "width": 5, "height": 5}, "attributes": {}}]
            (measurements / "block__p.spec.json").write_text(json.dumps({"path": "/x", "measurements": {
                f"{vp}:default": {"nodes": nodes()} for vp in capture_all.VIEWPORTS}}))
            rows = []
            for vp in capture_all.VIEWPORTS:
                Image.new("RGB", (100, 60), "white").save(shots / f"block__p__{vp}.png")
                rows.append({"componentId": "block:p", "file": f"block__p__{vp}.png", "viewport": vp.title(),
                             "state": "default", "width": 100, "height": 60})
            (records / "block__p.json").write_text(json.dumps({"status": "complete", "configHash": "h", "rows": rows}))
            out = capture_all.derive_children(by_id, set(by_id), [(None, {"componentId": "block:p"}, "h")],
                                              records, measurements, shots, 1)
            self.assertEqual(list(out), ["paragraph:c"])
            self.assertEqual({r["derivedFrom"] for r in out["paragraph:c"]}, {"block:p"})
            with Image.open(shots / "paragraph__c__desktop.png") as crop:
                self.assertEqual(crop.size, (30, 20))
            spec = json.loads((measurements / "paragraph__c.spec.json").read_text())
            sub = spec["measurements"]["desktop:default"]["nodes"]
            self.assertEqual([(n["path"], n["box"]["x"], n["box"]["y"]) for n in sub],
                             [("/div[1]", 0, 0), ("/div[1]/p[2]", 2, 2)])


class NestedPlanTest(unittest.TestCase):
    def test_a_rendered_subcomponent_is_built_and_a_data_only_one_is_mapped(self):
        import plan
        component = {"id": "paragraph:c", "label": "C", "fields": [], "slots": [],
                     "containedBy": ["block:p"], "usage": {"placements": 0, "structuralReferences": 3}}
        capture = {"images": [{"viewport": v, "state": "default"} for v in ("Desktop", "Tablet", "Mobile")]}
        rendered = plan.plan_component(component, None, capture, nested_renders=3)
        printed = plan.plan_component(component, None, capture, nested_renders=0)
        self.assertEqual(printed["libraryRole"], "subcomponent")
        self.assertEqual((rendered["verdict"], printed["verdict"]), ("build", "map"))


class RecordKeyTest(unittest.TestCase):
    def test_a_script_rewrite_that_does_the_same_keeps_the_record(self):
        old = {"componentId": "x", "states": [{"name": "default", "setup": "(a)", "setupKey": {"own": "reveal"}}]}
        new = {**old, "states": [{"name": "default", "setup": "(() => a)()", "setupKey": {"own": "reveal"}}]}
        self.assertEqual(capture_all.config_hash(old, 1), capture_all.config_hash(new, 1))
        changed = {**old, "states": [{"name": "default", "setup": "(a)", "setupKey": {"own": "template"}}]}
        self.assertNotEqual(capture_all.config_hash(old, 1), capture_all.config_hash(changed, 1))
        with tempfile.TemporaryDirectory() as folder:
            record = Path(folder) / "x.json"
            plain = {**old, "states": [{"name": "default", "setup": "(a)"}]}
            record.write_text(json.dumps({"status": "complete",
                                          "configHash": capture_all.legacy_hash(plain, 1)}))
            digest = capture_all.config_hash(old, 1)
            self.assertTrue(capture_all.record_is_current(record, digest, capture_all.legacy_hash(old, 1)))
            self.assertEqual(json.loads(record.read_text())["configHash"], digest)
