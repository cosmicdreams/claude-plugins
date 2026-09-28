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


if __name__ == "__main__":
    unittest.main()
