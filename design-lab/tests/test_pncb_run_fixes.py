"""Regression tests for the defects a full PNCB run (fully layered Drupal theme) surfaced in 0.22.0."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import extract_paragraphs
import extract_tokens_cssvars
import figma_build
import fonts
import plan_variables
import responsive
import scaffold_configs
import verify


def node(path, x, y, width=20, height=10, **computed):
    return {"path": path, "tag": "div", "classes": [],
            "box": {"x": x, "y": y, "width": width, "height": height},
            "computed": {"display": "block", "backgroundColor": "transparent", **computed},
            "declared": {}}


def grid_component(tracks_by_bp, child_width_by_bp, root_width_by_bp):
    measurements = {}
    for bp, tracks in tracks_by_bp.items():
        cw = child_width_by_bp[bp]
        columns = len(tracks.split()) if tracks else 1
        root = node("/div[0]", 0, 0, root_width_by_bp[bp], 50, display="grid",
                    **({"gridTemplateColumns": tracks} if tracks else {}))
        kids = [node(f"/div[0]/div[{i}]", (i % columns) * (cw + 10), (i // columns) * 20, cw, 10)
                for i in range(3)]
        measurements[f"{bp}:default"] = {"nodes": [root, *kids]}
    return responsive.build({"component": "Grid", "machineName": "grid",
                             "measurements": measurements}, "Grid")


class GridLayoutTests(unittest.TestCase):
    def test_one_track_at_every_width_is_a_vertical_stack(self):
        built = grid_component({"desktop": "300px", "tablet": "260px", "mobile": "200px"},
                               {"desktop": 300, "tablet": 260, "mobile": 200},
                               {"desktop": 300, "tablet": 260, "mobile": 200})
        self.assertEqual(built["tree"]["layout"]["mode"], "VERTICAL")
        self.assertFalse(built["tree"]["layout"].get("wrap"))

    def test_more_tracks_at_any_width_keeps_the_wrapping_row(self):
        built = grid_component({"desktop": "100px 100px 100px", "tablet": "80px 80px 80px",
                                "mobile": "300px"},
                               {"desktop": 100, "tablet": 80, "mobile": 300},
                               {"desktop": 320, "tablet": 260, "mobile": 300})
        self.assertEqual(built["tree"]["layout"]["mode"], "HORIZONTAL")
        self.assertTrue(built["tree"]["layout"]["wrap"])

    def test_unrecorded_tracks_never_guess_a_stack(self):
        self.assertIsNone(responsive.st.grid_tracks(node("/a", 0, 0, display="grid")))
        self.assertEqual(responsive.st.grid_tracks(node("/a", 0, 0)), 0)
        self.assertEqual(responsive.st.grid_tracks(
            node("/a", 0, 0, display="grid", gridTemplateColumns="1px 2px")), 2)


class TokenAndColourTests(unittest.TestCase):
    def test_hex_valued_text_token_is_a_colour(self):
        self.assertEqual(extract_tokens_cssvars.classify("--text-body", "#222222"), "color")
        self.assertEqual(extract_tokens_cssvars.classify("--text-lg", "1.25rem"), "font-size")

    def test_expand_hex_accepts_rgb_functions(self):
        self.assertEqual(figma_build.expand_hex("rgba(26,26,24,0.15)"), "#1a1a18")
        self.assertEqual(figma_build.expand_hex("rgb(10 20 30)"), "#0a141e")
        self.assertEqual(figma_build.expand_hex("#ABC"), "#aabbcc")

    def test_variables_template_reads_rgba(self):
        if not shutil.which("node"):
            self.skipTest("node is not installed")
        src = (SCRIPTS / "render" / "variables.js").read_text()
        start = src.index("const hex6")
        body = src[start:src.index("\n};", start) + 3].replace("const hex6", "globalThis.hex6")
        script = body + "\nconsole.log(JSON.stringify([hex6('rgba(26,26,24,0.15)'), hex6('rgb(0 0 255 / 50%)'), hex6('#ff0000')]));"
        out = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
        self.assertAlmostEqual(out[0]["a"], 0.15)
        self.assertAlmostEqual(out[1]["b"], 1.0)
        self.assertAlmostEqual(out[1]["a"], 0.5)
        self.assertEqual(out[2], {"r": 1, "g": 0, "b": 0, "a": 1})

    def test_quoted_ampersand_is_text_not_an_anchor(self):
        lines = extract_paragraphs._lines('value: "a &amp;copy b"\nformat: basic_html\n', "t.yml")
        self.assertEqual(len(lines), 2)
        with self.assertRaises(ValueError):
            extract_paragraphs._lines("value: &anchor x\n", "t.yml")


class CollectionTests(unittest.TestCase):
    def project(self, plan, label="PNCB"):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder)
        (folder / "variable-plan.json").write_text(json.dumps(plan))
        (folder / "project.json").write_text(json.dumps({"run": {"siteLabel": label}}))
        return folder

    def test_media_query_modes_fold_into_brand_breakpoint_modes(self):
        plan = {"collections": {
            "Core": {"modes": ["Value"], "variables": [{"name": "color/a", "type": "COLOR", "hex": "#000"}]},
            "Type": {"modes": ["Value", "@media (width < 48rem)"], "variables": [
                {"name": "type/size/h1", "type": "FLOAT", "valuesByMode": {"Value": 40, "@media (width < 48rem)": 28}},
                {"name": "type/size/body", "type": "FLOAT", "valuesByMode": {"Value": 16}}]}}}
        args = figma_build.variables_args(self.project(plan))["collections"]
        self.assertEqual(sorted(args), ["PNCB Breakpoint", "PNCB Core"])
        bp = args["PNCB Breakpoint"]
        self.assertEqual(bp["modes"], ["Desktop 1400px", "Tablet 800px", "Mobile 375px"])
        h1 = next(v for v in bp["variables"] if v["name"] == "type/size/h1")
        self.assertEqual(h1["valuesByMode"], {"Desktop 1400px": 40, "Tablet 800px": 40, "Mobile 375px": 28})
        body = next(v for v in bp["variables"] if v["name"] == "type/size/body")
        self.assertEqual(set(body["valuesByMode"].values()), {16})

    def test_no_brand_keeps_the_old_names(self):
        folder = self.project({"collections": {}}, label="")
        self.assertEqual(figma_build.breakpoint_collection(folder), "Core Breakpoint")
        self.assertEqual(figma_build.core_collection(folder), "Core")

    def test_media_applies(self):
        self.assertEqual([figma_build.media_applies("@media (width < 48rem)", w) for w in (1400, 800, 375)],
                         [False, False, True])
        self.assertTrue(figma_build.media_applies("@media (min-width: 768px)", 800))
        self.assertIsNone(figma_build.media_applies("@media print", 800))

    def test_unused_mode_collapses_into_core(self):
        out = {"collections": {
            "Colour": {"modes": ["Value"], "variables": [{"name": "color/a", "type": "COLOR", "hex": "#000"}]},
            "Spacing": {"modes": ["Value", "@media x"], "variables": [
                {"name": "space/a", "type": "FLOAT", "valuesByMode": {"Value": 2, "@media x": 2}}]},
            "Radius": {"modes": ["Value"], "variables": [{"name": "radius/a", "type": "FLOAT", "valuesByMode": {"Value": 4}}]}}}
        plan_variables._consolidate_single_mode_collections(out)
        self.assertEqual(list(out["collections"]), ["Core"])

    def test_verify_rejects_media_mode_names_and_a_second_modeful_collection(self):
        rep = verify.Report()
        state = {"collections": [{"name": "PNCB Breakpoint", "modes": ["Desktop 1400px", "Mobile 375px"]},
                                 {"name": "PNCB Type", "modes": ["Value", "@media (width < 48rem)"]}],
                 "collectionStrategyReason": "x"}
        verify.check_mode_naming(state, rep)
        verify.check_collection_strategy(state, "PNCB", rep)
        checks = {f["check"] for f in rep.findings}
        self.assertEqual(checks, {"mode-naming", "collection-strategy"})


class CaptureTests(unittest.TestCase):
    def test_child_avoids_its_parents_page(self):
        usage = {"examples": [{"path": "/parent-page"}, {"path": "/own-page"}]}
        self.assertEqual(scaffold_configs.first_example(usage, {"/parent-page"})["path"], "/own-page")
        self.assertEqual(scaffold_configs.first_example(usage)["path"], "/parent-page")
        self.assertEqual(scaffold_configs.first_example({"examples": [{"path": "/only"}]}, {"/only"})["path"], "/only")

    def test_apple_system_fonts_are_never_drawable(self):
        self.assertIn("sf pro", fonts.UNDRAWABLE)


if __name__ == "__main__":
    unittest.main()
