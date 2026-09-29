import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from PIL import Image, ImageDraw  # noqa: E402

import figma_compare  # noqa: E402


class CompareTests(unittest.TestCase):
    def specimen(self, shift=0, missing=False):
        img = Image.new("RGB", (300, 200), "white")
        d = ImageDraw.Draw(img)
        d.rectangle((10, 10, 110, 60), fill="black")                      # variant
        if not missing:
            d.rectangle((10 + shift, 110, 110 + shift, 160), fill="black")  # capture
        return img

    def run_case(self, img):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "s.png"
            img.save(p)
            geo = {"variants": [{"label": "Mobile", "x": 0, "y": 0, "width": 150, "height": 80}],
                   "captures": [{"label": "Mobile", "x": 0, "y": 100, "width": 150, "height": 80}]}
            return figma_compare.compare(p, geo)

    def test_identical_pair_passes(self):
        out = self.run_case(self.specimen())
        self.assertTrue(out["pass"])
        self.assertEqual(out["pairs"][0]["changed"], 0)

    def test_missing_content_fails(self):
        self.assertFalse(self.run_case(self.specimen(missing=True))["pass"])

    def test_shift_is_measured(self):
        out = self.run_case(self.specimen(shift=20))
        self.assertGreater(out["pairs"][0]["ratio"], 0.06)



class CorrectedMetricTests(unittest.TestCase):
    """The corrected metric counts height difference, unmatched area and per-channel colour."""

    def compare(self, img, variant, capture, corrected):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "s.png"
            img.save(p)
            geo = {"variants": [dict(label="Mobile", **variant)],
                   "captures": [dict(label="Mobile", **capture)]}
            return figma_compare.compare(p, geo, corrected=corrected)

    def test_short_master_passes_original_but_fails_corrected(self):
        img = Image.new("RGB", (200, 200), "white")
        d = ImageDraw.Draw(img)
        d.rectangle((0, 0, 99, 49), fill="black")           # Figma: 50 tall
        d.rectangle((0, 100, 99, 149), fill="black")        # live: same top 50 ...
        d.rectangle((0, 150, 99, 179), fill="navy")          # ... plus 30 more the master lacks
        variant = {"x": 0, "y": 0, "width": 100, "height": 50}
        capture = {"x": 0, "y": 100, "width": 100, "height": 80}
        original = self.compare(img, variant, capture, corrected=False)
        corrected = self.compare(img, variant, capture, corrected=True)
        self.assertTrue(original["pass"])
        self.assertNotIn("metric", original)                 # original output shape unchanged
        self.assertFalse(corrected["pass"])
        self.assertEqual(corrected["metric"], "corrected")
        pair = corrected["pairs"][0]
        self.assertEqual((pair["width"], pair["height"]), (100, 80))
        self.assertEqual(pair["changed"], 100 * 30)
        self.assertEqual(pair["heightDelta"], 30)

    def test_tolerance_applies_per_channel(self):
        img = Image.new("RGB", (100, 100), (100, 100, 100))
        ImageDraw.Draw(img).rectangle((0, 50, 99, 99), fill=(160, 100, 100))   # red channel +60
        box = {"x": 0, "y": 0, "width": 100, "height": 50}
        other = {"x": 0, "y": 50, "width": 100, "height": 50}
        self.assertTrue(self.compare(img, box, other, corrected=False)["pass"])   # greyscale hides it
        corrected = self.compare(img, box, other, corrected=True)
        self.assertFalse(corrected["pass"])
        self.assertEqual(corrected["pairs"][0]["ratio"], 1.0)

    def test_identical_pair_passes_both(self):
        img = Image.new("RGB", (100, 100), "white")
        box = {"x": 0, "y": 0, "width": 100, "height": 50}
        other = {"x": 0, "y": 50, "width": 100, "height": 50}
        self.assertTrue(self.compare(img, box, other, corrected=True)["pass"])


if __name__ == "__main__":
    unittest.main()
