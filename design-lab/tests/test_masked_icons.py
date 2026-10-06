"""Icons drawn as CSS masks over a background colour are built as their SVG shape, not a box."""
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
