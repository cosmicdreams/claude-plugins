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
        self.assertFalse(figma_build.media_applies("@media print", 800))
        self.assertIsNone(figma_build.media_applies("@media (orientation: landscape)", 800))

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


class ReviewFollowUpTests(unittest.TestCase):
    """Findings from the expert review of pull request 80."""

    def project(self, plan, label="PNCB"):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder)
        (folder / "variable-plan.json").write_text(json.dumps(plan))
        (folder / "project.json").write_text(json.dumps({"run": {"siteLabel": label}}))
        return folder

    def test_extractor_keeps_media_modes_in_source_order(self):
        theme = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, theme)
        (theme / "css").mkdir()
        (theme / "t.libraries.yml").write_text("global:\n  css:\n    theme:\n      css/tokens.css: {}\n")
        (theme / "css" / "tokens.css").write_text(
            ":root { --font-size-h1: 32px; }\n"
            "@media (min-width: 768px) { :root { --font-size-h1: 40px; } }\n"
            "@media (min-width: 1200px) { :root { --font-size-h1: 48px; } }\n")
        modes = extract_tokens_cssvars.extract(str(theme))["modes"]
        self.assertEqual(modes, ["Value", "@media (min-width: 768px)", "@media (min-width: 1200px)"])

    def test_cascade_last_match_wins_across_px_breakpoints(self):
        modes = ["Value", "@media (min-width: 768px)", "@media (min-width: 1200px)"]
        plan = {"collections": {"Type": {"modes": modes, "variables": [
            {"name": "type/h1", "type": "FLOAT",
             "valuesByMode": {"Value": 32, modes[1]: 40, modes[2]: 48}}]}}}
        bp = figma_build.variables_args(self.project(plan))["collections"]["PNCB Breakpoint"]
        self.assertEqual(bp["variables"][0]["valuesByMode"],
                         {"Desktop 1400px": 48, "Tablet 800px": 40, "Mobile 375px": 32})

    def test_media_query_syntax(self):
        applies = figma_build.media_applies
        self.assertTrue(applies("@media (max-width:600px), (min-width:1200px)", 1400))
        self.assertFalse(applies("@media (max-width:600px), (min-width:1200px)", 800))
        self.assertTrue(applies("@media (48rem <= width < 64rem)", 800))
        self.assertFalse(applies("@media (48rem <= width < 64rem)", 1400))
        self.assertTrue(applies("@media screen and (min-width: 40em)", 800))
        self.assertFalse(applies("@media print", 800))
        self.assertIsNone(applies("@media (prefers-color-scheme: dark)", 800))

    def test_site_studio_breakpoints_fold_through_their_cascade(self):
        plan = {"collections": {"Type": {"modes": ["xl", "md", "sm"], "variables": [
            {"name": "type/h2", "type": "FLOAT", "valuesByMode": {"xl": 48, "md": 42, "sm": 36}}]}}}
        out = figma_build.variables_args(self.project(plan))["collections"]
        self.assertEqual(list(out), ["PNCB Breakpoint"])
        self.assertEqual(out["PNCB Breakpoint"]["variables"][0]["valuesByMode"],
                         {"Desktop 1400px": 48, "Tablet 800px": 42, "Mobile 375px": 36})

    def test_other_axis_keeps_its_own_branded_collection_with_readable_modes(self):
        plan = {"collections": {
            "Core": {"modes": ["Value"], "variables": [{"name": "color/a", "type": "COLOR", "hex": "#000"}]},
            "Scheme": {"modes": ["Value", "@media (prefers-color-scheme: dark)"], "variables": [
                {"name": "color/bg", "type": "COLOR", "valuesByMode": {"Value": "#fff", "@media (prefers-color-scheme: dark)": "#000"}}]},
            "Primitives": {"modes": ["Value"], "variables": [{"name": "color/b", "type": "COLOR", "hex": "#111"}]}}}
        out = figma_build.variables_args(self.project(plan))["collections"]
        self.assertEqual(sorted(out), ["PNCB Core", "PNCB Primitives", "PNCB Scheme"])
        self.assertEqual(out["PNCB Scheme"]["modes"], ["Value", "Dark"])
        self.assertEqual(out["PNCB Scheme"]["variables"][0]["valuesByMode"], {"Value": "#fff", "Dark": "#000"})
        rep = verify.Report()
        verify.check_mode_naming({"collections": [{"name": n, "modes": c["modes"]} for n, c in out.items()]}, rep)
        self.assertEqual(rep.findings, [])

    def test_query_only_token_never_writes_null(self):
        modes = ["Value", "@media (max-width: 600px)"]
        plan = {"collections": {"Type": {"modes": modes, "variables": [
            {"name": "type/small", "type": "FLOAT", "valuesByMode": {modes[1]: 12}}]}}}
        bp = figma_build.variables_args(self.project(plan))["collections"]["PNCB Breakpoint"]
        self.assertNotIn(None, bp["variables"][0]["valuesByMode"].values())

    def test_wipe_names_only_collections_this_run_emitted(self):
        plan = {"collections": {"Core": {"modes": ["Value"], "variables": []}}}
        names = figma_build.emitted_collections(self.project(plan))
        self.assertEqual(sorted(names), ["PNCB Breakpoint", "PNCB Core"])
        source = (SCRIPTS / "figma_build.py").read_text()
        self.assertNotIn("verify\" / \"state.json\"", source.split("def cmd_init", 1)[1].split("def ", 1)[0])

    def test_collapsed_collection_is_single_mode_whatever_its_mode_was_called(self):
        out = {"collections": {
            "Colour": {"modes": ["Value"], "variables": [{"name": "color/a", "type": "COLOR", "hex": "#000"}]},
            "Spacing": {"modes": ["xl", "md"], "variables": [
                {"name": "space/a", "type": "FLOAT", "valuesByMode": {"xl": 8, "md": 8}}]}}}
        plan_variables._consolidate_single_mode_collections(out)
        self.assertEqual(list(out["collections"]), ["Core"])

    def test_a_dark_scheme_collection_is_not_a_second_breakpoint_collection(self):
        rep = verify.Report()
        state = {"collections": [{"name": "PNCB Breakpoint", "modes": ["Desktop 1400px", "Mobile 375px"]},
                                 {"name": "PNCB Scheme", "modes": ["Value", "Dark"]}],
                 "collectionStrategyReason": "x"}
        verify.check_collection_strategy(state, "PNCB", rep)
        self.assertEqual(rep.findings, [])

    def test_rebuild_of_a_pre_023_run_still_clears_its_unbranded_collections(self):
        plan = {"collections": {"Type": {"modes": ["xl", "md"], "variables": []},
                                "Spacing": {"modes": ["Value"], "variables": []}}}
        folder = self.project(plan, label="Acme")
        names = set(figma_build.emitted_collections(folder)) | set({}.get("emittedCollections") or []) \
            | figma_build.legacy_collections(folder)
        self.assertTrue({"Type", "Spacing", "Core", "Core Breakpoint"} <= names)
        source = (SCRIPTS / "figma_build.py").read_text()
        self.assertIn("legacy_collections(project)", source.split('if sid == "wipe":', 1)[1].split("elif", 1)[0])

    def test_width_and_another_axis_in_one_collection_split_by_variable(self):
        modes = ["Value", "@media (min-width: 768px)", "@media (prefers-color-scheme: dark)"]
        plan = {"collections": {"Mixed": {"modes": modes, "variables": [
            {"name": "type/h1", "type": "FLOAT", "valuesByMode": {"Value": 32, modes[1]: 48}},
            {"name": "color/bg", "type": "COLOR", "codeName": "--bg",
             "valuesByMode": {"Value": "#fff", modes[2]: "#000"}}]}}}
        out = figma_build.variables_args(self.project(plan, label="Acme"))["collections"]
        self.assertEqual([v["name"] for v in out["Acme Breakpoint"]["variables"]], ["type/h1"])
        self.assertEqual(out["Acme Breakpoint"]["variables"][0]["valuesByMode"],
                         {"Desktop 1400px": 48, "Tablet 800px": 48, "Mobile 375px": 32})
        self.assertEqual(out["Acme Mixed Dark"]["modes"], ["Value", "Dark"])
        self.assertEqual([(v["name"], v["valuesByMode"]) for v in out["Acme Mixed Dark"]["variables"]],
                         [("color/bg", {"Value": "#fff", "Dark": "#000"})])
        rep = verify.Report()
        verify.check_collection_strategy({"collections": [{"name": n, "modes": c["modes"]} for n, c in out.items()],
                                          "collectionStrategyReason": "x"}, "Acme", rep)
        self.assertEqual(rep.findings, [])

    def test_a_variable_varying_on_both_axes_keeps_the_collection_whole(self):
        modes = ["Value", "@media (min-width: 768px)", "@media (prefers-color-scheme: dark)"]
        plan = {"collections": {"Mixed": {"modes": modes, "variables": [
            {"name": "t/a", "type": "FLOAT", "valuesByMode": {"Value": 1, modes[1]: 2, modes[2]: 3}}]}}}
        out = figma_build.variables_args(self.project(plan, label="Acme"))["collections"]
        self.assertEqual(list(out), ["Acme Mixed"])
        self.assertEqual(out["Acme Mixed"]["variables"][0]["valuesByMode"], {"Value": 1, "Min-width 768px": 2, "Dark": 3})

    def test_variables_template_keys_variables_by_collection(self):
        src = (SCRIPTS / "render" / "variables.js").read_text()
        self.assertIn("for (const { variable, spec, modeId } of entries)", src)
        self.assertIn("if (!byName[v.name]) byName[v.name] = entry;", src)

    def test_percentage_rgb(self):
        self.assertEqual(figma_build.expand_hex("rgb(100% 0% 0%)"), "#ff0000")


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
