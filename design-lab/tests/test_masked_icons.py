"""Icons drawn as CSS masks over a background colour are built as their SVG shape, not a box."""
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import responsive
import spec_to_tree

ARROW = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 11h12z"/></svg>'


def node(path, x, y, width, height, **extra):
    computed = {"display": "block", "backgroundColor": "transparent", **extra.pop("computed", {})}
    return {"path": path, "tag": "span", "classes": [], "box": {"x": x, "y": y, "width": width, "height": height},
            "computed": computed, "declared": {}, **extra}


class MaskedIconTests(unittest.TestCase):
    def test_mask_takes_the_background_colour(self):
        svg = spec_to_tree.masked_icon_svg(node("/a", 0, 0, 24, 24, maskSvg=ARROW,
                                                computed={"backgroundColor": "rgb(28, 110, 107)"}))
        self.assertIn('fill="#1c6e6b"', svg)
        self.assertIn("<path", svg)

    def test_painted_shapes_are_recoloured_and_none_stays_unpainted(self):
        source = '<svg viewBox="0 0 2 2"><path fill="#000" stroke="none" d="M0 0h1"/><g style="fill: red"/></svg>'
        svg = spec_to_tree.masked_icon_svg(node("/a", 0, 0, 2, 2, maskSvg=source,
                                                computed={"backgroundColor": "rgba(255, 0, 0, 0.5)"}))
        self.assertIn('fill="#ff0000"', svg)
        self.assertIn('stroke="none"', svg)
        self.assertIn("fill:#ff0000", svg)
        self.assertIn('opacity="0.5"', svg)

    def test_no_mask_or_no_colour_is_not_an_icon(self):
        self.assertIsNone(spec_to_tree.masked_icon_svg(node("/a", 0, 0, 2, 2)))
        self.assertIsNone(spec_to_tree.masked_icon_svg(node("/a", 0, 0, 2, 2, maskSvg=ARROW)))

    def recolour(self, source, box=(24, 24), colour="rgb(28, 110, 107)"):
        return spec_to_tree.masked_icon_svg(node("/a", 0, 0, *box, maskSvg=source,
                                                 computed={"backgroundColor": colour}))

    def test_style_block_without_trailing_semicolon_keeps_the_svg_whole(self):
        svg = self.recolour('<svg viewBox="0 0 24 24"><style>.a{fill:#000}</style><path class="a"/></svg>')
        self.assertIn(".a{fill:#1c6e6b}</style>", svg)
        self.assertTrue(svg.endswith("</svg>"))
        self.assertIn('<path class="a"/>', svg)

    def test_single_quotes_comments_and_xml_declaration(self):
        svg = self.recolour("<?xml version='1.0'?><!-- made with <svg> tool -->"
                            "<svg viewBox='0 0 24 24'><path fill='#fff' d='M0 0'/></svg>")
        self.assertTrue(svg.startswith("<svg"))
        self.assertIn('fill="#1c6e6b" d=', svg)
        self.assertNotIn("#fff", svg)

    def test_html_page_is_not_an_icon(self):
        self.assertIsNone(self.recolour("<!DOCTYPE html><html><body><svg><path/></svg>Log in</body></html>"))

    def test_root_takes_the_measured_box_and_keeps_its_drawing_size(self):
        svg = self.recolour('<svg width="40" height="20"><path/></svg>', box=(24, 24))
        self.assertIn('width="24.0" height="24.0"', svg)
        self.assertIn('viewBox="0 0 40 20"', svg)
        self.assertNotIn('width="40"', svg)

    def test_byte_order_mark_and_percentage_sizes(self):
        svg = self.recolour('\ufeff<svg width="100%" height="100%"><path/></svg>')
        self.assertTrue(svg.startswith("<svg"))
        self.assertNotIn("viewBox", svg)

    def test_masked_element_with_children_or_text_keeps_its_frame(self):
        masked = node("/a", 0, 0, 10, 10, maskSvg=ARROW, computed={"backgroundColor": "rgb(0, 0, 0)"})
        self.assertIsNone(spec_to_tree.masked_leaf(masked, has_children=True))
        self.assertIsNone(spec_to_tree.masked_leaf({**masked, "text": "Wave"}, has_children=False))
        self.assertIsNotNone(spec_to_tree.masked_leaf(masked, has_children=False))

    def test_mask_url_parsing(self):
        if not shutil.which("node"):
            self.skipTest("node is not installed")
        src = (Path(__file__).resolve().parents[1] / "scripts" / "measure.mjs").read_text()
        body = src[src.index("export function maskUrl"):src.index("const maskCache")].replace("export ", "")
        script = body + """
console.log(JSON.stringify([
  maskUrl('url("data:image/svg+xml;utf8,<svg><g transform=\\'rotate(45)\\'/></svg>")'),
  maskUrl("url('https://x.org/a b.svg')"),
  maskUrl('url(https://x.org/a.svg)'),
  maskUrl('url("a\\\\"b.svg")'),
  maskUrl('none')]));"""
        out = __import__("json").loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
        self.assertEqual(out[0], "data:image/svg+xml;utf8,<svg><g transform='rotate(45)'/></svg>")
        self.assertEqual(out[1], "https://x.org/a b.svg")
        self.assertEqual(out[2], "https://x.org/a.svg")
        self.assertEqual(out[3], 'a"b.svg')
        self.assertIsNone(out[4])

    def test_responsive_build_draws_the_icon_as_svg(self):
        measurements = {}
        for bp in ("desktop", "tablet", "mobile"):
            root = node("/div[0]", 0, 0, 100, 24, computed={"display": "flex"})
            icon = node("/div[0]/span[0]", 0, 0, 24, 24, maskSvg=ARROW,
                        computed={"backgroundColor": "rgb(28, 110, 107)"})
            measurements[f"{bp}:default"] = {"nodes": [root, icon]}
        built = responsive.build({"component": "Link", "machineName": "link", "measurements": measurements}, "Link")
        icon = built["tree"]["children"][0]
        self.assertEqual(icon["kind"], "svg")
        self.assertIn('fill="#1c6e6b"', icon["svg"])


if __name__ == "__main__":
    unittest.main()
