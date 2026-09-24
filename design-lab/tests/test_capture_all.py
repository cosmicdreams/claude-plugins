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

    def test_runner_orders_measurements_then_one_capture_and_registers_problems(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = self.fixture(root)
            calls = []

            def fake_run(command, cwd=None):
                label = Path(command[1]).name if command[0] != "node" else Path(command[1]).name
                calls.append((label, Path(cwd) if cwd else None))
                if label == "scaffold_configs.py":
                    with patch.object(sys, "argv", ["scaffold_configs.py", *command[2:]]):
                        scaffold_configs.main()
                elif label == "measure.mjs":
                    cfg = json.loads(Path(command[3]).read_text())
                    out = Path(command[5]) / (cfg["machineName"] + ".spec.json")
                    out.write_text(json.dumps({"measurements": {
                        f"{vp}:default": {"nodes": [1]} for vp in
                        ("desktop", "tablet", "mobile")}}))
                elif label == "capture.mjs":
                    shots = Path(command[5])
                    rows = []
                    for config in sorted((workspace / "capture/configs").glob("*.json")):
                        cfg = json.loads(config.read_text())
                        for viewport in ("Desktop", "Tablet", "Mobile"):
                            name = f"{cfg['machineName']}__{viewport.lower()}.png"
                            (shots / name).write_bytes(b"png")
                            rows.append({"componentId": cfg["componentId"],
                                         "machine": cfg["machineName"], "file": name,
                                         "path": cfg["path"],
                                         "verificationUrl": cfg["verificationUrl"],
                                         "linkUrl": cfg["linkUrl"],
                                         "selector": cfg["rootSelector"],
                                         "viewport": viewport, "state": "default",
                                         "width": 100, "height": 50})
                    (shots / "index.json").write_text(json.dumps(rows))
                elif label == "assemble_capture_evidence.py":
                    with patch.object(sys, "argv", ["assemble_capture_evidence.py", *command[2:]]):
                        from assemble_capture_evidence import main
                        self.assertEqual(main(), 0)
                return type("Result", (), {"returncode": 0, "stdout": "", "stderr": ""})()

            argv = ["--project", str(workspace), "--site-url", "https://demo.ddev.site",
                    "--canonical-base-url", "https://demo.example", "--theme-root", str(root),
                    "--node-cwd", str(root), "--scale", "1"]
            with patch.object(capture_all, "run", side_effect=fake_run):
                self.assertEqual(capture_all.main(argv), 1)
            self.assertEqual([name for name, _ in calls], [
                "scaffold_configs.py", "measure.mjs", "measure.mjs", "capture.mjs",
                "assemble_capture_evidence.py", "workflow.py"])
            self.assertTrue(all(cwd == root for name, cwd in calls if name.endswith(".mjs")))
            evidence = json.loads((workspace / "capture-evidence.json").read_text())
            self.assertEqual(list(evidence["captures"]), ["sdc.demo.alpha", "sdc.demo.zeta"])
            self.assertEqual(evidence["problems"], [{
                "componentId": "sdc.demo.empty", "detail": capture_all.NO_EVIDENCE}])


if __name__ == "__main__":
    unittest.main()
