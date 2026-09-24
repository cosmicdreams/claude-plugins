import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
from compare_runs import compare, main  # noqa: E402
from determinism import canonical_hash  # noqa: E402


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def node(path):
    return {"path": path, "type": "TEXT", "x": 0, "y": 0, "width": 20, "height": 10,
            "layoutMode": "NONE", "paddingTop": 0, "paddingRight": 0,
            "paddingBottom": 0, "paddingLeft": 0, "itemSpacing": 0,
            "layoutSizingHorizontal": "FIXED", "layoutSizingVertical": "FIXED",
            "fills": [{"type": "SOLID", "color": "#ff0000", "boundVariables": {"color": "Red"}}],
            "strokes": [], "cornerRadius": 0, "characters": "Hello",
            "fontName": {"family": "Inter", "style": "Regular"}, "fontSize": 12,
            "lineHeight": {"unit": "PIXELS", "value": 16}, "textStyle": "Body",
            "componentPropertyDefinitions": {}, "variantProperties": {},
            "description": "Description", "documentationLinks": ["https://example.org"],
            "boundVariables": {"width": "Spacing"}}


class CompareRunsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.a = Path(self.temp.name) / "a"
        self.b = Path(self.temp.name) / "b"
        for root in (self.a, self.b):
            write(root / "components.json", {"generatedAt": "date", "components": []})
            write(root / "figma" / "results" / "variables.json", {"variables": []})
            write(root / "figma" / "dump" / "Main.json", {"page": "Main", "pageIndex": 0,
                                                   "nodes": [node("Main#0/Label#0")],
                                                   "_ids": {"page": "different"}})

    def test_identical_runs_score_100_and_ignore_ids(self):
        result = compare(self.a, self.b)
        self.assertEqual(result["summary"]["score"], 100)
        self.assertEqual(result["summary"]["ratios"]["identical_node"], 1)
        self.assertEqual(result["page_differences"]["Main"]["changes"], {})

    def test_every_category_and_exact_scores(self):
        path = self.b / "figma" / "dump" / "Main.json"
        dump = json.loads(path.read_text())
        changed = dump["nodes"][0]
        changed.update(x=1, layoutMode="HORIZONTAL", cornerRadius=4,
                       characters="Goodbye", fontSize=14, description="Changed",
                       componentPropertyDefinitions={"Label": {"type": "TEXT"}},
                       boundVariables={"width": "Other"})
        changed["fills"][0]["boundVariables"] = {"color": "Blue"}
        write(path, dump)
        write(self.b / "components.json", {"generatedAt": "later", "components": [1]})
        result = compare(self.a, self.b)
        categories = result["page_differences"]["Main"]["changes"]["Main#0/Label#0"]
        self.assertEqual(set(categories), {"geometry", "layout", "style", "text",
                                           "typography", "bindings", "properties/variants", "docs"})
        self.assertEqual(result["summary"]["category_counts"], {key: 1 for key in categories})
        self.assertEqual(result["summary"]["score"], 25.76)
        self.assertEqual(result["summary"]["ratios"], {
            "identical_node": 0, "geometry_exact": 0, "text_exact": 0, "binding_exact": 0})
        self.assertEqual(result["artifacts"]["components.json"]["differences"],
                         [{"path": "/components/0", "a": None, "b": 1}])

    def test_missing_node_and_page_order(self):
        path = self.b / "figma" / "dump" / "Main.json"
        dump = json.loads(path.read_text())
        dump["nodes"].append(node("Main#0/Extra#0"))
        write(path, dump)
        result = compare(self.a, self.b)
        self.assertEqual(result["page_differences"]["Main"]["added"], ["Main#0/Extra#0"])
        self.assertEqual(result["summary"]["score"], 59.09)
        write(self.a / "figma" / "dump" / "Next.json", {"page": "Next", "pageIndex": 1, "nodes": []})
        write(self.b / "figma" / "dump" / "Next.json", {"page": "Next", "pageIndex": -1, "nodes": []})
        result = compare(self.a, self.b)
        self.assertFalse(result["pages"]["order_equal"])
        self.assertEqual(result["summary"]["score"], 50)

    def test_pages_come_from_runner_dumps_not_workspace_state(self):
        # figma_runner.py writes page dumps to figma/dump/; figma/ itself holds the build's
        # state and inbox, which are not pages and must not be compared as pages.
        for root in (self.a, self.b):
            write(root / "figma" / "state.json", {"fileKey": str(root), "done": []})
            write(root / "figma" / "inbox.json", {"componentId": str(root)})
        result = compare(self.a, self.b)
        self.assertEqual(result["pages"]["a"], ["Main"])
        self.assertEqual(result["summary"]["score"], 100)
        self.assertIn("figma/results/variables.json", result["artifacts"])
        self.assertNotIn("layout.json", result["artifacts"])
        self.assertTrue(result["artifacts"]["figma/results/variables.json"]["equal_bytes"])
        write(self.b / "figma" / "results" / "variables.json", {"variables": ["Extra"]})
        self.assertFalse(compare(self.a, self.b)["artifacts"]["figma/results/variables.json"]
                         ["normalized_equal"])

    def test_page_dump_hash_ignores_figma_node_ids(self):
        dump_a = json.loads((self.a / "figma" / "dump" / "Main.json").read_text())
        dump_b = dict(dump_a, _ids={"page": "another-file", "nodes": {"Main#0/Label#0": "9:9"}})
        self.assertEqual(canonical_hash(dump_a), canonical_hash(dump_b))

    def test_normalized_metadata_and_cli_outputs(self):
        write(self.b / "components.json", {"components": [], "generatedAt": "later"})
        self.assertTrue(compare(self.a, self.b)["artifacts"]["components.json"]["normalized_equal"])
        out = Path(self.temp.name) / "report.json"
        md = Path(self.temp.name) / "report.md"
        self.assertEqual(main([str(self.a), str(self.b), str(self.a), "--out", str(out),
                               "--md", str(md)]), 0)
        self.assertEqual(len(json.loads(out.read_text())["comparisons"]), 3)
        self.assertIn("Summary matrix", md.read_text())

    def test_layout_determinism_cli(self):
        one = {"generatedAt": "yesterday", "runId": "a", "items": [{"b": 2, "a": 1}]}
        two = {"items": [{"a": 1, "b": 2}], "generatedAt": "today", "runId": "b"}
        self.assertEqual(canonical_hash(one), canonical_hash(two))
        layout = Path(self.temp.name) / "layout.json"
        expected = Path(self.temp.name) / "expected.sha256"
        write(layout, two)
        expected.write_text(canonical_hash(one) + "\n")
        command = [sys.executable, str(SCRIPTS / "determinism.py"), "check", str(layout), str(expected)]
        self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
        expected.write_text("0" * 64)
        self.assertEqual(subprocess.run(command, capture_output=True).returncode, 1)


if __name__ == "__main__":
    unittest.main()
