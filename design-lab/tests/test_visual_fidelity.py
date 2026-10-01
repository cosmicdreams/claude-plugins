"""What the live page draws reaches the build tree: wrappers, clipping, shapes, pseudo icons."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import figma_build
import figma_compare
import spec_to_tree
import verify

CHEVRON = ("url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' "
           "height='24'%3E%3Cpath d='M1 1L2 2'/%3E%3C/svg%3E\")")


def node(tag="div", width=100, height=50, **computed):
    base = {"display": "block", "visibility": "visible", "opacity": "1", "overflow": "visible"}
    return {"tag": tag, "path": "/" + tag, "box": {"x": 0, "y": 0, "width": width, "height": height},
            "computed": {**base, **computed}, "classes": []}


class ConversionPiecesTest(unittest.TestCase):
    def test_zero_size_wrapper_passes_through_but_hidden_does_not(self):
        self.assertTrue(spec_to_tree.passthrough(node("picture", 0, 0, display="inline")))
        self.assertTrue(spec_to_tree.passthrough(node(display="contents")))
        self.assertFalse(spec_to_tree.passthrough(node("picture", 0, 0, display="none")))
        self.assertFalse(spec_to_tree.passthrough(node()))

    def test_overflow_hidden_clips(self):
        self.assertTrue(spec_to_tree.style_of(node(overflow="hidden"))["clip"])
        self.assertTrue(spec_to_tree.style_of(node(overflow="clip visible"))["clip"])
        self.assertNotIn("clip", spec_to_tree.style_of(node()))

    def test_clip_path_shapes(self):
        circle = spec_to_tree.clip_shape("circle(50% at 50% 50%)", 100, 100)
        self.assertEqual((circle["kind"], circle["cx"], circle["cy"], circle["rx"]),
                         ("ellipse", 50, 50, 50))
        polygon = spec_to_tree.clip_shape("polygon(0% 0%, 100% 0%, 50px 100%)", 200, 80)
        self.assertEqual(polygon["points"], [(0, 0), (200, 0), (50, 80)])
        self.assertIsNone(spec_to_tree.clip_shape("inset(10px)", 10, 10))
        svg = spec_to_tree.shape_svg(circle, 100, 100, {"hex": "#9ED4D6", "opacity": 1})
        self.assertIn('<ellipse cx="50.0"', svg)
        self.assertIn('clip-path="url(#box)"', svg)

    def test_pseudo_element_images(self):
        link = node("a", fontSize="16px")
        link["before"] = {"content": CHEVRON, "width": "24px", "height": "24px",
                          "marginRight": "8px", "display": "inline-block"}
        icon = spec_to_tree.pseudo_image(link, "before")
        self.assertEqual((icon["width"], icon["height"], icon["gap"]), (24, 24, 8))
        self.assertTrue(icon["svg"].startswith("<svg"))
        link["after"] = {"content": '""', "backgroundImage": 'url("/icons/x.png")',
                         "width": "10px", "height": "10px", "marginLeft": "4px"}
        self.assertEqual(spec_to_tree.pseudo_image(link, "after")["src"], "/icons/x.png")
        link["after"] = {"content": '"→"'}
        self.assertIsNone(spec_to_tree.pseudo_image(link, "after"))


class ComparisonMaskTest(unittest.TestCase):
    def test_text_masks_make_glyph_differences_disappear(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            image = Image.new("RGB", (220, 50), "white")
            image.paste("black", (10, 10, 50, 30))     # "text" in the Figma variant
            image.paste("gray", (120, 10, 160, 30))    # different "text" in the capture
            png = root / "specimen.png"
            image.save(png)
            geometry = {"variants": [{"label": "x — X", "x": 0, "y": 0, "width": 100, "height": 50}],
                        "captures": [{"label": "Desktop", "x": 110, "y": 0, "width": 100, "height": 50}]}
            plain = figma_compare.compare(png, geometry)
            self.assertFalse(plain["pass"])
            masked = figma_compare.compare(png, geometry,
                                           masks=[[{"x": 10, "y": 10, "width": 40, "height": 20}]])
            self.assertTrue(masked["pass"])
            self.assertEqual(masked["pairs"][0]["ratioUnmasked"], plain["pairs"][0]["ratio"])

    def test_masks_come_from_the_live_text_at_each_breakpoint(self):
        with tempfile.TemporaryDirectory() as folder:
            project = Path(folder)
            measurements = project / "capture" / "measurements"
            measurements.mkdir(parents=True)
            text = {**node("p"), "text": "Hello", "box": {"x": 5, "y": 6, "width": 70, "height": 20}}
            (measurements / "block__x.spec.json").write_text(json.dumps({"measurements": {
                "desktop:default": {"nodes": [node(), text]},
                "mobile:default": {"nodes": [node()]}}}))
            masks = figma_build.text_masks(project, "block:x", {"variants": [
                {"label": "block:x — X · Mobile · 335px"}, {"label": "block:x — X"}]})
            self.assertEqual(masks, [[], [text["box"]]])


class FontsCheckTest(unittest.TestCase):
    def test_missing_families_are_reported_once(self):
        with tempfile.TemporaryDirectory() as folder:
            for name, built in (("a.json", {"missingFonts": ["freight-text-pro"]}),
                                ("b.json", {"fonts": {"articulat-cf 400": "Inter Regular",
                                                      "Inter 400": "Inter Regular"}}),
                                ("c.json", {"fonts": {"Lora 400": "Lora Regular"}})):
                (Path(folder) / name).write_text(json.dumps({"built": built}))
            report = verify.Report()
            verify.check_fonts_available(folder, report)
            self.assertEqual(len(report.findings), 1)
            self.assertEqual(report.findings[0]["evidence"],
                             ["articulat-cf (1 components)", "freight-text-pro (1 components)"])


if __name__ == "__main__":
    unittest.main()


def spec_node(path, x, y, width, height, tag="div", **computed):
    return {"path": path, "tag": tag, "classes": [], "box": {"x": x, "y": y, "width": width, "height": height},
            "computed": {"display": "block", "backgroundColor": "transparent", "position": "static",
                         "visibility": "visible", "opacity": "1", **computed}, "declared": {}}


class LayoutOrderTest(unittest.TestCase):
    def merge(self, per_bp):
        import responsive
        return responsive.build({"component": "X", "machineName": "x", "measurements": {
            f"{bp}:default": {"nodes": nodes} for bp, nodes in per_bp.items()}}, "X", "x")

    def test_a_child_that_moves_with_width_appears_in_two_slots(self):
        def stack(width, media_first):
            above, content, media = (30, 40, 100)
            ys = {"media": 0, "above": 100, "content": 130} if media_first else \
                 {"above": 0, "content": 30, "media": 90}
            return [spec_node("/div[0]", 0, 0, width, 200),
                    spec_node("/div[0]/div[1]", 0, ys["above"], width, above, backgroundColor="rgb(1, 2, 3)"),
                    spec_node("/div[0]/div[2]", 0, ys["content"], width, content, backgroundColor="rgb(4, 5, 6)"),
                    spec_node("/div[0]/div[3]", 0, ys["media"], width, media, backgroundColor="rgb(7, 8, 9)")]
        out = self.merge({"desktop": stack(1400, True), "mobile": stack(375, False)})
        self.assertEqual(out["fallbacks"], [])
        slots = out["tree"]["children"]
        self.assertEqual([s["source"].split("#")[0][-6:] for s in slots],
                         ["div[3]", "div[1]", "div[2]", "div[3]"])
        self.assertIn("visible", slots[0])
        self.assertIn("visible", slots[3])
        self.assertNotIn("visible", slots[1])
        self.assertEqual(slots[3]["layout"]["padding"]["top"], 20)   # 90 - (30 + 40), mobile only

    def test_positioned_overlap_is_faithful_and_drawn_in_stacking_order(self):
        nodes = [spec_node("/div[0]", 0, 0, 400, 200),
                 spec_node("/div[0]/div[1]", 300, 0, 100, 100, position="absolute", zIndex="1",
                           backgroundColor="rgb(1, 1, 1)"),
                 spec_node("/div[0]/div[2]", 0, 0, 400, 200, position="relative", zIndex="0",
                           backgroundColor="rgb(2, 2, 2)"),
                 spec_node("/div[0]/div[3]", 300, 150, 100, 50, position="absolute", zIndex="auto",
                           backgroundColor="rgb(3, 3, 3)")]
        out = self.merge({"desktop": nodes, "mobile": nodes})
        self.assertEqual(out["fallbacks"], [])
        order = [c["source"][-6:] for c in out["tree"]["children"]]
        self.assertEqual(order, ["div[2]", "div[3]", "div[1]"])  # z 0, z auto (later), z 1

    def test_inline_wrapper_without_text_passes_through(self):
        picture = spec_node("/p", 0, 78, 335, 28, tag="picture", display="inline")
        self.assertTrue(spec_to_tree.passthrough(picture, True))
        self.assertFalse(spec_to_tree.passthrough(picture, False))
        self.assertFalse(spec_to_tree.passthrough({**picture, "text": "Hi"}, True))
        self.assertFalse(spec_to_tree.passthrough(
            spec_node("/a", 0, 0, 50, 20, display="inline", backgroundColor="rgb(1, 2, 3)"), True))

    def test_pseudo_icon_rotation_turns_inside_the_svg(self):
        self.assertEqual(spec_to_tree.rotation("matrix(-1, 0, 0, -1, 0, 0)"), 180)
        self.assertEqual(spec_to_tree.rotation("none"), 0)
        link = node("a", fontSize="16px")
        link["before"] = {"content": CHEVRON, "width": "24px", "height": "24px",
                          "transform": "matrix(-1, 0, 0, -1, 0, 0)"}
        self.assertIn('<g transform="rotate(180.0 12.0 12.0)">', spec_to_tree.pseudo_image(link, "before")["svg"])
