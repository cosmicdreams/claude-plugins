"""Offline contracts for the measured-tree and Figma delivery pipeline."""

import contextlib
import copy
import hashlib
import io
import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(SCRIPTS))
import fetch_images
import figma_build
import render_payload
import responsive
import spec_to_tree


def node(path, x, y, width=20, height=10, *, tag="div", classes=(), **computed):
    return {"path": path, "tag": tag, "classes": list(classes),
            "box": {"x": x, "y": y, "width": width, "height": height},
            "computed": {"display": "block", "backgroundColor": "transparent", **computed},
            "declared": {}}


def tree_of(nodes, label="Example"):
    return spec_to_tree.build({"component": label, "machineName": "example",
                               "measurements": {"desktop:default": {"nodes": nodes}}}, label)["breakpoints"][0]["tree"]


def expand_like_builder(compacted):
    """Python equivalent of render/build_responsive.js expand()."""
    styles = compacted["styles"]

    def walk(original):
        n = copy.deepcopy(original)
        if "ts" in n:
            n["text"] = {**styles[n.pop("ts")], "characters": n.pop("chars")}
        if "layout" in n:
            t, r, b, l = n["layout"].pop("pad", [0, 0, 0, 0])
            n["layout"]["padding"] = {"top": t, "right": r, "bottom": b, "left": l}
        if "children" in n:
            n["children"] = [walk(c) for c in n["children"]]
        return n

    return walk(compacted["tree"])


class SpecToTreeTests(unittest.TestCase):
    def test_colors_and_css_variables(self):
        self.assertEqual(spec_to_tree.parse_color("rgb(12, 34, 255)"),
                         {"hex": "#0c22ff", "opacity": 1.0})
        self.assertEqual(spec_to_tree.parse_color("rgba(255, 0, 16, 0.25)"),
                         {"hex": "#ff0010", "opacity": 0.25})
        self.assertIsNone(spec_to_tree.parse_color("rgba(0, 0, 0, 0)"))
        self.assertIsNone(spec_to_tree.parse_color("transparent"))
        self.assertEqual(spec_to_tree.css_var("color: var( --kt-red, red)"), "--kt-red")
        self.assertIsNone(spec_to_tree.css_var("#ff0000"))
        styled = node("/div[0]", 0, 0, backgroundColor="rgb(12, 34, 56)")
        styled["declared"]["background-color"] = "var(--kt-surface)"
        self.assertEqual(spec_to_tree.style_of(styled)["fill"]["var"], "--kt-surface")

    def test_flex_gap_and_center_alignment(self):
        root = node("/div[0]", 0, 0, 100, 30, display="flex", justifyContent="center")
        kids = [node(f"/div[0]/span[{i}]", x, 0) for i, x in enumerate((10, 40, 70))]
        layout = spec_to_tree.infer_layout(root, kids)
        self.assertEqual((layout["mode"], layout["gap"], layout["primaryAlign"]),
                         ("HORIZONTAL", 10, "CENTER"))

    def test_grid_rows_wrap_and_counter_gap(self):
        root = node("/div[0]", 0, 0, 50, 28, display="grid")
        kids = [node(f"/div[0]/span[{i}]", x, y) for i, (x, y) in
                enumerate(((0, 0), (30, 0), (0, 18), (30, 18)))]
        layout = spec_to_tree.infer_layout(root, kids)
        self.assertEqual((layout["mode"], layout["wrap"], layout["gap"], layout["counterGap"]),
                         ("HORIZONTAL", True, 10, 8))

    def test_block_margin_absorbed_into_padding_and_unequal_gaps_get_spacers(self):
        root = node("/div[0]", 0, 0, 100, 100)
        kids = [node(f"/div[0]/p[{i}]", 0, y, 100, 10, tag="p")
                for i, y in enumerate((7, 22, 43))]
        layout = spec_to_tree.infer_layout(root, kids)
        self.assertEqual(layout["mode"], "VERTICAL")
        self.assertEqual(layout["padding"]["top"], 7)
        self.assertEqual(layout["spacers"], [5, 11])
        built = tree_of([root, *kids])
        self.assertEqual([(c["name"], c["height"]) for c in built["children"]
                          if c["name"] == "Spacer"], [("Spacer", 5), ("Spacer", 11)])

    def test_misaligned_children_fall_back_to_absolute(self):
        root = node("/div[0]", 0, 0, 100, 40, display="flex")
        kids = [node("/div[0]/i[0]", 0, 0), node("/div[0]/i[1]", 30, 7)]
        layout = spec_to_tree.infer_layout(root, kids)
        self.assertEqual(layout["mode"], "NONE")
        self.assertTrue(layout["fellBack"])

    def test_bem_name_and_wrapper_collapse(self):
        root = node("/div[0]", 0, 0, 100, 20, classes=("kt-stat",))
        wrapper = node("/div[0]/div[0]", 0, 0, 100, 20)
        value = node("/div[0]/div[0]/span[0]", 0, 0, 100, 20,
                     tag="span", classes=("kt-stat__value",))
        value["inlineText"] = "42"
        built = tree_of([root, wrapper, value])
        self.assertEqual([c["name"] for c in built["children"]], ["Value"])
        self.assertEqual(built["children"][0]["kind"], "text")

    def test_compact_round_trip_with_reused_styles_and_zero_padding(self):
        style = {"characters": "First", "family": "Inter", "size": 16,
                 "color": {"hex": "#123456", "opacity": 1}}
        original = {"kind": "frame", "name": "Root", "width": 100,
                    "layout": {"mode": "VERTICAL", "padding": {"top": 4, "right": 0,
                              "bottom": 2, "left": 1}, "gap": 0},
                    "children": [{"kind": "text", "text": style},
                                 {"kind": "frame", "layout": {"mode": "NONE", "padding":
                                  {"top": 0, "right": 0, "bottom": 0, "left": 0}},
                                  "children": [{"kind": "text", "text": {**style, "characters": "Second"}}]}]}
        compacted = spec_to_tree.compact(original)
        self.assertEqual(len(compacted["styles"]), 1)
        self.assertEqual(expand_like_builder(compacted), original)

    def test_copied_measurements_are_deterministic(self):
        for name in ("impact-figure", "sponsor-logo"):
            with self.subTest(fixture=name):
                spec = json.loads((FIXTURES / f"{name}.spec.json").read_text())
                first = spec_to_tree.build(spec, None)
                self.assertEqual(json.dumps(first, sort_keys=True),
                                 json.dumps(spec_to_tree.build(copy.deepcopy(spec), None), sort_keys=True))
                self.assertEqual([b["breakpoint"] for b in first["breakpoints"]],
                                 ["mobile", "tablet", "desktop"])
                self.assertTrue(all(b.get("tree") for b in first["breakpoints"]))


class ResponsiveTests(unittest.TestCase):
    def test_three_column_grid_wraps_to_one_column_with_mode_widths(self):
        measurements = {}
        for bp, root_width, child_width, columns in (
                ("desktop", 320, 100, 3), ("tablet", 260, 80, 3),
                ("mobile", 300, 300, 1)):
            root = node("/div[0]", 0, 0, root_width, 10 if columns == 3 else 50,
                        display="grid")
            children = [node(f"/div[0]/div[{i}]", (i % columns) * (child_width + 10),
                             (i // columns) * 20, child_width, 10)
                        for i in range(3)]
            measurements[f"{bp}:default"] = {"nodes": [root, *children]}
        built = responsive.build({"component": "Grid", "machineName": "grid",
                                  "measurements": measurements}, "Grid")
        self.assertEqual(built["measured"], ["desktop", "tablet", "mobile"])
        self.assertEqual(built["modes"], ["Desktop", "Tablet", "Mobile"])
        self.assertEqual(built["widths"], {"Desktop": 320, "Tablet": 260, "Mobile": 300})
        self.assertEqual(built["tree"]["layout"]["mode"], "HORIZONTAL")
        self.assertTrue(built["tree"]["layout"]["wrap"])
        self.assertEqual(built["fallbacks"], [])
        for child in built["tree"]["children"]:
            variable = built["variables"][child["width"]["var"]]
            self.assertEqual(variable["type"], "FLOAT")
            self.assertEqual(variable["values"],
                             {"Desktop": 100, "Tablet": 80, "Mobile": 300})

    def test_hidden_mobile_child_uses_boolean_visible_variable(self):
        measurements = {}
        for bp, width in (("desktop", 100), ("tablet", 100), ("mobile", 50)):
            root = node("/div[0]", 0, 0, width, 10, display="flex")
            first = node("/div[0]/div[0]", 0, 0, 50, 10)
            second = node("/div[0]/div[1]", 50, 0, 50, 10,
                          display="none" if bp == "mobile" else "block")
            measurements[f"{bp}:default"] = {"nodes": [root, first, second]}
        built = responsive.build({"component": "Pair", "machineName": "pair",
                                  "measurements": measurements}, "Pair")
        hidden = next(child for child in built["tree"]["children"]
                      if child["source"] == "/div[0]/div[1]")
        self.assertEqual(built["variables"][hidden["visible"]["var"]],
                         {"type": "BOOLEAN", "values": {
                             "Desktop": True, "Tablet": True, "Mobile": False}})


class RenderPayloadTests(unittest.TestCase):
    @staticmethod
    def independent_fnv(text):
        units = text.encode("utf-16-le")
        value = 2166136261
        for i in range(0, len(units), 2):
            value = ((value ^ (units[i] + 256 * units[i + 1])) * 16777619) % (1 << 32)
        return f"{value:08x}"

    def test_fnv_known_vector_including_utf16(self):
        self.assertEqual(self.independent_fnv("hello"), "4f9f2cab")
        for sample in ("hello", "A😀é", ""):
            self.assertEqual(render_payload.fnv1a(sample), self.independent_fnv(sample))

    def test_literal_strips_defaults_and_integral_floats_recursively(self):
        args = {"source": "/spec", "tag": "div", "gap": 0, "italic": False,
                "width": 20.0, "children": [{"source": "/child", "height": 3.0,
                                             "opacity": 1, "text": "café"}]}
        self.assertEqual(render_payload.literal(args),
                         '{"children":[{"height":3,"text":"caf\\u00e9"}],"width":20}')
        self.assertEqual(render_payload.decoded(args),
                         '{"children":[{"height":3,"text":"café"}],"width":20}')
        self.assertEqual(args["children"][0]["height"], 3.0)

    def test_call_contains_literal_checksum_and_template_source(self):
        args = {"width": 12.0, "label": "Café"}
        code = render_payload.call_payload("pages", args)
        self.assertTrue(code.startswith(f"const ARGS = {render_payload.literal(args)};\n"))
        self.assertTrue(all(ord(ch) < 128 for ch in code), 'payload must be ASCII-only')
        self.assertIn("let __h = 0x811c9dc5; const __s = JSON.stringify(ARGS);", code)
        self.assertIn("__h ^= __s.charCodeAt(i)", code)
        self.assertIn(render_payload.fnv1a(render_payload.decoded(args)), code)
        self.assertIn("arguments were altered in transit", code)
        self.assertTrue(code.endswith(render_payload.templates()["pages"]))
        self.assertNotIn(render_payload.templates()["_kit"], code)

    def test_build_responsive_payload_omits_shared_kit(self):
        code = render_payload.call_payload("build_responsive", {})
        self.assertNotIn(render_payload.templates()["_kit"], code)
        self.assertNotIn("getSharedPluginData", code)
        self.assertTrue(code.endswith(render_payload.templates()["build_responsive"]))

    def test_component_block_payload_includes_shared_kit(self):
        code = render_payload.call_payload("component_block", {})
        self.assertIn(render_payload.templates()["_kit"], code)
        self.assertTrue(code.endswith(render_payload.templates()["component_block"]))

    def test_payloads_do_not_load_stored_runtime_or_evaluate_code(self):
        for template in render_payload.templates():
            if template.startswith("_"):
                continue
            with self.subTest(template=template):
                code = render_payload.call_payload(template, {})
                self.assertNotIn("getSharedPluginData('designlab', 'runtime')", code)
                self.assertNotIn("AsyncFunction", code)


class FigmaBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / "project"
        self.project.mkdir()
        repo = Path(self.temp.name) / "repo"
        (repo / "config/sync").mkdir(parents=True)
        (repo / "config/sync/system.site.yml").write_text("name: 'Test Org'\n")
        self.write("project.json", {"repository": {"root": str(repo)}})
        self.components = [
            {"id": "sdc.test.hero", "label": "Hero", "group": "Content", "description": "Introduction",
             "sourceRef": "components/hero/hero.yml", "fields": [{"name": "title", "kind": "text", "required": True}],
             "usage": {"tier": "High Use", "placements": 60, "structuralReferences": 2,
                       "renderedPages": 4, "examples": [{"path": "/home"}]}},
            {"id": "sdc.test.card", "label": "Card", "usage": {"tier": "Medium Use", "placements": 12}},
            {"id": "sdc.test.ghost", "label": "Ghost", "usage": {"tier": "Low Use", "placements": 1}},
        ]
        self.write("components.json", {"components": self.components})
        self.write("plan.json", {"plans": [{"id": "sdc.test.hero", "verdict": "build"},
                                           {"id": "sdc.test.card", "verdict": "map", "refuseReason": "nested in hero"},
                                           {"id": "sdc.test.ghost", "verdict": "refuse", "refuseReason": "no verified capture"}]})
        self.write("variable-plan.json", {"collections": {"Site": {"variables": [
            {"name": "Color/Red", "type": "COLOR", "hex": "#f00", "codeName": "--red"},
            {"name": "Typography/Body", "type": "STRING", "scopes": ["FONT_FAMILY"],
             "valuesByMode": {"Default": "Inter"}}]}}})
        measurements = {bp + ":default": {"nodes": [node("/div[0]", 0, 0, w, 50)]}
                        for bp, w in (("mobile", 375), ("tablet", 800), ("desktop", 1400))}
        self.write("capture/measurements/hero.spec.json",
                   {"component": "Hero", "machineName": "hero", "measurements": measurements})
        self.write("capture-evidence.json", {"captures": {"sdc.test.hero": {"images": [
            {"viewport": "desktop", "file": "/tmp/desktop.png", "width": 1400, "height": 300},
            {"viewport": "mobile", "file": "/tmp/mobile.png", "width": 375, "height": 500}]}}})
        ns = type("Args", (), {"project": str(self.project), "file_key": "file123",
                               "site_url": "https://local.test/", "canonical_base_url": "https://public.test/"})()
        with contextlib.redirect_stdout(io.StringIO()):
            figma_build.cmd_init(ns)
        self.state = json.loads((self.project / "figma/state.json").read_text())

    def write(self, name, value):
        path = self.project / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def result(self, step, value):
        self.write("figma/results/" + figma_build.safe(step) + ".json", value)

    def test_init_step_order_and_page_list(self):
        steps = [s["id"] for s in self.state["steps"]]
        self.assertEqual(steps, ["pages", "variables", "cover", "foundation:Color",
            "foundation:Typography", *["tier:" + t for t in figma_build.TIERS],
            "build:sdc.test.hero", "images:sdc.test.hero", "block:sdc.test.hero",
            "evidence:sdc.test.hero", "compare:sdc.test.hero", "getting-started"])
        self.assertEqual(self.state["built"], ["sdc.test.hero"])
        tree = json.loads((self.project / "figma/trees/sdc.test.hero.json").read_text())
        self.assertEqual(tree["label"], "Hero")
        self.assertEqual(tree["modes"], ["Desktop", "Tablet", "Mobile"])
        self.assertEqual(tree["measured"], ["desktop", "tablet", "mobile"])
        self.assertEqual(tree["widths"], {"Desktop": 1400, "Tablet": 800, "Mobile": 375})
        for key in ("variables", "fallbacks", "notes", "tree"):
            self.assertIn(key, tree)
        self.assertEqual(figma_build.page_list(self.project),
                         ["Cover", "Getting Started", "Foundations — Color", "Foundations — Typography",
                          *figma_build.TIER_PAGES])

    def test_next_pages_and_record_rejects_missing_ids_then_advances(self):
        ns = type("Args", (), {"project": str(self.project)})()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            figma_build.cmd_next(ns)
        payload = json.loads(out.getvalue())
        self.assertEqual(payload["kind"], "use_figma")
        self.assertEqual(payload["step"], "pages")
        self.assertIn("const ARGS = ", Path(payload["payload"]).read_text())
        self.write("empty.json", {})
        rec = type("Record", (), {"project": str(self.project), "step": "pages",
                                  "result": str(self.project / "empty.json")})()
        with self.assertRaisesRegex(SystemExit, "result has no pages"):
            figma_build.cmd_record(rec)
        self.assertEqual(json.loads((self.project / "figma/state.json").read_text())["done"], [])
        self.write("pages.json", {"pages": {"Cover": "page-1"}})
        rec.result = str(self.project / "pages.json")
        with contextlib.redirect_stdout(io.StringIO()):
            figma_build.cmd_record(rec)
        self.assertEqual(figma_build.pending(json.loads((self.project / "figma/state.json").read_text()))["id"],
                         self.state["steps"][1]["id"])
        rec.result = str(self.project / "empty.json")
        for step, required in (("build:sdc.test.hero", "componentId"),
                               ("block:sdc.test.hero", "blockId")):
            state = copy.deepcopy(self.state)
            step_index = [s["id"] for s in state["steps"]].index(step)
            state["done"] = [s["id"] for s in state["steps"][:step_index]]
            self.write("figma/state.json", state)
            rec.step = step
            with self.assertRaisesRegex(SystemExit, f"result has no {required}"):
                figma_build.cmd_record(rec)
            self.assertNotIn(step, json.loads((self.project / "figma/state.json").read_text())["done"])
            self.write("valid.json", {required: "figma-id"})
            rec.result = str(self.project / "valid.json")
            with contextlib.redirect_stdout(io.StringIO()):
                figma_build.cmd_record(rec)
            advanced = json.loads((self.project / "figma/state.json").read_text())
            self.assertIn(step, advanced["done"])
            self.assertEqual(figma_build.pending(advanced)["id"],
                             state["steps"][step_index + 1]["id"])
            rec.result = str(self.project / "empty.json")

    def test_tier_description_block_and_getting_started_content(self):
        pages = {name: f"page-{i}" for i, name in enumerate(figma_build.page_list(self.project))}
        self.result("pages", {"pages": pages})
        self.result("build:sdc.test.hero", {"componentId": "component-1"})
        self.result("block:sdc.test.hero", {"blockId": "block-1"})
        tier = figma_build.tier_args(self.project, self.state, "Retirement Candidates")
        self.assertIn("No component", tier["emptyLine"])
        self.assertEqual(tier["pageId"], pages["Components — Retirement Candidates"])
        description = figma_build.description(self.project, self.components[0])
        for fragment in ("Hero", "sdc.test.hero", "High Use", "60 author placements",
                         "2 structural references", "title (text)", "Breakpoint", "/home", "Documentation:"):
            self.assertIn(fragment, description)
        block = figma_build.block_args(self.project, self.state, "sdc.test.hero", 0)
        self.assertEqual(block["setId"], "component-1")
        self.assertEqual(block["doc"]["properties"],
                         [["Breakpoint", "MODE", "Desktop, Tablet, Mobile", "Desktop"]])
        self.assertEqual(block["collection"], "Breakpoint")
        self.assertEqual(block["columns"], [
            {"label": "Mobile · 375px", "width": 375, "mode": "Mobile 375px", "master": False},
            {"label": "Tablet · 800px", "width": 800, "mode": "Tablet 800px", "master": False},
            {"label": "Desktop · 1400px", "width": 1400, "mode": "Desktop 1400px", "master": True}])
        self.assertEqual(block["evidence"], [{"label": "Mobile 375px", "width": 375, "height": 500},
                                               {"label": "Desktop 1400px", "width": 1400, "height": 300}])
        self.assertNotRegex(json.dumps(block), r"\b20\d{2}-\d{2}-\d{2}\b")
        start = figma_build.getting_started_args(self.project, self.state)
        self.assertEqual(start["index"][0]["setId"], "component-1")
        gaps = "\n".join(start["gaps"])
        self.assertIn("Foundations — Spacing & Layout is omitted", gaps)
        self.assertIn("Foundations — Elevation & Shape is omitted", gaps)
        self.assertIn("no verified capture", gaps)
        self.assertEqual(start["title"], "Test Org component library")

    def test_images_step_skips_when_manifest_and_build_contain_no_images(self):
        cid = "sdc.test.hero"
        self.result(f"build:{cid}", {"componentId": "component-1", "images": []})

        def fake_run(args, **kwargs):
            out = Path(args[args.index("--out") + 1])
            out.mkdir(parents=True)
            (out / "images.json").write_text("[]")
            return mock.Mock(returncode=0)

        with mock.patch.object(figma_build.subprocess, "run", side_effect=fake_run) as run:
            value = figma_build.images_step(self.project, f"images:{cid}", cid, self.state)
        self.assertEqual(value, {"kind": "skip", "step": f"images:{cid}", "reason": "no images"})
        run.assert_called_once()

    def next_step(self, step):
        """Mark every step before `step` done and return what `next` emits for it."""
        state = copy.deepcopy(self.state)
        ids = [s["id"] for s in state["steps"]]
        state["done"] = ids[:ids.index(step)]
        self.write("figma/state.json", state)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            figma_build.cmd_next(type("Args", (), {"project": str(self.project)})())
        return json.loads(out.getvalue())

    def test_evidence_files_follow_the_drawn_columns(self):
        cid = "sdc.test.hero"
        # All three widths captured, but tablet was not measured: it has no column, so it
        # must not take the second rectangle's file.
        self.write("capture-evidence.json", {"captures": {cid: {"images": [
            {"viewport": bp, "file": f"/tmp/{bp}.png", "width": w, "height": 100}
            for bp, w in (("desktop", 1400), ("tablet", 800), ("mobile", 375))]}}})
        tree_path = self.project / "figma/trees" / f"{cid}.json"
        tree = json.loads(tree_path.read_text())
        tree["measured"] = ["desktop", "mobile"]
        tree_path.write_text(json.dumps(tree))
        pages = {name: f"page-{i}" for i, name in enumerate(figma_build.page_list(self.project))}
        self.result("pages", {"pages": pages})
        self.result(f"build:{cid}", {"componentId": "component-1"})
        block = figma_build.block_args(self.project, self.state, cid, 0)
        self.assertEqual([c["label"] for c in block["columns"]], ["Mobile · 375px", "Desktop · 1400px"])
        self.assertEqual([e["label"] for e in block["evidence"]], ["Mobile 375px", "Desktop 1400px"])
        self.result(f"block:{cid}", {"blockId": "block-1", "evidenceIds": ["r-mobile", "r-desktop"]})
        step = self.next_step(f"evidence:{cid}")
        self.assertEqual(step["nodeIds"], ["r-mobile", "r-desktop"])
        self.assertEqual([f["file"] for f in step["files"]], ["/tmp/mobile.png", "/tmp/desktop.png"])
        self.result(f"block:{cid}", {"blockId": "block-1", "evidenceIds": ["only-one"]})
        with self.assertRaisesRegex(SystemExit, "re-run the block step"):
            self.next_step(f"evidence:{cid}")

    def test_untiered_components_get_the_untiered_page(self):
        tiered = {"tier": "High Use"}
        self.assertEqual(figma_build.tier_names([{"usage": None}, {}]), ["Untiered"])
        self.assertEqual(figma_build.tier_names([{"usage": tiered}]), figma_build.TIERS)
        self.assertEqual(figma_build.tier_names([{"usage": tiered}, {"usage": {}}]),
                         [*figma_build.TIERS, "Untiered"])
        for c in self.components:
            c["usage"] = {k: v for k, v in c["usage"].items() if k != "tier"}
        self.write("components.json", {"components": self.components})
        ns = type("Args", (), {"project": str(self.project), "file_key": "file123",
                               "site_url": "https://local.test/", "canonical_base_url": "https://public.test/"})()
        with contextlib.redirect_stdout(io.StringIO()):
            figma_build.cmd_init(ns)
        state = json.loads((self.project / "figma/state.json").read_text())
        self.assertEqual([s["id"] for s in state["steps"] if s["id"].startswith("tier:")], ["tier:Untiered"])
        page_list = figma_build.page_list(self.project)
        self.assertEqual(page_list[-1], "Components — Untiered")
        self.assertNotIn("Components — High Use", page_list)
        pages = {name: f"page-{i}" for i, name in enumerate(page_list)}
        self.result("pages", {"pages": pages})
        args = figma_build.build_args(self.project, "sdc.test.hero", state)
        self.assertEqual(args["pageId"], pages["Components — Untiered"])
        self.assertEqual(args["id"], "sdc.test.hero")
        tier = figma_build.tier_args(self.project, state, "Untiered")
        self.assertIn("no tier", tier["thresholds"])
        self.result("build:sdc.test.hero", {"componentId": "component-1"})
        self.result("block:sdc.test.hero", {"blockId": "block-1"})
        start = figma_build.getting_started_args(self.project, state)
        self.assertEqual([row[0] for row in start["coverage"]["rows"]], ["Untiered"])

    def test_images_step_skips_failed_fetches_and_surfaces_fetch_errors(self):
        cid = "sdc.test.hero"
        self.result(f"build:{cid}", {"componentId": "component-1",
                                     "images": [{"id": "1:1", "src": "/gone.png"}]})

        def failed_fetch(args, **kwargs):
            out = Path(args[args.index("--out") + 1])
            out.mkdir(parents=True, exist_ok=True)
            (out / "images.json").write_text(json.dumps([{"src": "/gone.png", "error": "HTTPError: 404"}]))
            return mock.Mock(returncode=0)

        with mock.patch.object(figma_build.subprocess, "run", side_effect=failed_fetch) as run:
            value = figma_build.images_step(self.project, f"images:{cid}", cid, self.state)
        self.assertEqual(value["reason"], "no image could be fetched")
        self.assertEqual(run.call_args.kwargs["timeout"], 600)
        crashed = mock.Mock(returncode=1, stderr="Traceback: boom", stdout="")
        with mock.patch.object(figma_build.subprocess, "run", return_value=crashed), \
             self.assertRaisesRegex(SystemExit, "boom"):
            figma_build.images_step(self.project, f"images:{cid}", cid, self.state)

    def test_examples_map_rendered_ids_through_the_inventory(self):
        comps = [{"id": "canvas.hero", "sourceSdcId": "site:hero"},
                 {"id": "card", "sourceRef": "web/themes/custom/site/components/card/card.component.yml"}]
        ids = figma_build.component_ids(comps)
        self.assertEqual(figma_build.component_id("site:hero", ids), "canvas.hero")
        self.assertEqual(figma_build.component_id("site:card", ids), "card")
        self.assertEqual(figma_build.component_id("other:thing", ids), "sdc.other.thing")


class FetchImagesTests(unittest.TestCase):
    def test_sources_collect_nested_images_and_backgrounds(self):
        tree = {"kind": "frame", "backgroundImage": {"src": "/back.svg"}, "children": [
            {"kind": "image", "src": "/logo.png"},
            {"kind": "frame", "children": [{"kind": "image", "src": "/logo.png"}]}]}
        self.assertEqual(fetch_images.sources(tree, set()), {"/back.svg", "/logo.png"})

    def test_fetch_writes_sorted_manifest_with_stable_hash_names_without_network(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            tree = {"breakpoints": [{"tree": {"kind": "frame", "children": [
                {"kind": "image", "src": "/z.png"}, {"kind": "image", "src": "/a.png"},
                {"kind": "image", "src": "/z.png"}]}}]}
            tree_file = root / "tree.json"
            tree_file.write_text(json.dumps(tree))
            out = root / "out"
            with mock.patch.object(sys, "argv", ["fetch_images.py", str(tree_file),
                                                       "--base-url", "https://example.test", "--out", str(out)]), \
                 mock.patch.object(fetch_images, "fetch", return_value=(b"image bytes", "image/png")) as fetch, \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(fetch_images.main(), 0)
            manifest = json.loads((out / "images.json").read_text())
            self.assertEqual([m["src"] for m in manifest], ["/a.png", "/z.png"])
            self.assertEqual(fetch.call_count, 2)
            for m in manifest:
                stem = hashlib.sha256(m["src"].encode()).hexdigest()[:16]
                self.assertEqual(Path(m["file"]).name, stem + ".png")
                self.assertEqual(Path(m["file"]).read_bytes(), b"image bytes")
                self.assertEqual((m["contentType"], m["bytes"]), ("image/png", 11))


class FetchImagesFailureTests(unittest.TestCase):
    def run_fetch(self, fetch):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            tree_file = root / "tree.json"
            tree_file.write_text(json.dumps({"tree": {"kind": "frame", "children": [
                {"kind": "image", "src": "/a.png"}, {"kind": "image", "src": "/b.svg"},
                {"kind": "image", "src": "/c.png"}]}}))
            out = root / "out"
            with mock.patch.object(sys, "argv", ["fetch_images.py", str(tree_file),
                                                 "--base-url", "https://example.test", "--out", str(out)]), \
                 mock.patch.object(fetch_images, "fetch", side_effect=fetch), \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(fetch_images.main(), 0)
            return {m["src"]: m for m in json.loads((out / "images.json").read_text())}

    def test_one_missing_image_does_not_stop_the_rest(self):
        import urllib.error

        def fetch(url):
            if url.endswith("/a.png"):
                raise urllib.error.HTTPError(url, 404, "Not Found", {}, io.BytesIO())
            return b"bytes", "image/png" if url.endswith(".png") else "image/gif"
        manifest = self.run_fetch(fetch)
        self.assertIn("404", manifest["/a.png"]["error"])
        self.assertNotIn("file", manifest["/a.png"])
        self.assertEqual(manifest["/c.png"]["contentType"], "image/png")

    def test_svg_is_never_passed_through(self):
        manifest = self.run_fetch(lambda url: (b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml")
                                  if url.endswith(".svg") else (b"bytes", "image/png"))
        svg = manifest["/b.svg"]
        try:
            import cairosvg  # noqa: F401
        except ImportError:
            self.assertIn("cairosvg", svg["error"])
        else:
            self.assertEqual(svg["contentType"], "image/png")
        self.assertNotIn("image/svg+xml", {m.get("contentType") for m in manifest.values()})
