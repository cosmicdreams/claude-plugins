"""The option a captured instance renders, read from its classes; unknown is never guessed."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import figma_build


def options(*values):
    return [{"value": v, "label": v.replace("_", " ").title()} for v in values]


class VariantValuesTest(unittest.TestCase):
    def project(self, fields, axes, classes):
        root = Path(tempfile.mkdtemp())
        (root / "components.json").write_text(json.dumps({"components": [
            {"id": "block:x", "fields": [{"name": n, "options": o} for n, o in fields.items()]}]}))
        (root / "plan.json").write_text(json.dumps({"plans": [
            {"id": "block:x", "verdict": "build", "variantAxes": axes}]}))
        spec = root / "capture" / "measurements" / "block__x.spec.json"
        spec.parent.mkdir(parents=True)
        spec.write_text(json.dumps({"measurements": {"desktop:default": {"nodes": [
            {"classes": c} for c in classes]}}}))
        return root

    def test_classes_name_the_option_and_synonyms_count(self):
        root = self.project({"field_width": options("default", "narrow"),
                             "field_alignment": options("left", "right"),
                             "field_style": options("primary", "secondary")},
                            [{"field": "field_width", "label": "Width"},
                             {"field": "field_alignment", "label": "Alignment"},
                             {"field": "field_style", "label": "Style"}],
                            [["block"], ["width-default", "text-start", "banner-secondary"]])
        values = {v["axis"]: v["value"] for v in figma_build.variant_values(root, "block:x")}
        self.assertEqual(values, {"Width": "Default", "Alignment": "Left", "Style": "Secondary"})

    def test_generic_words_need_the_field_and_ambiguity_stays_unknown(self):
        root = self.project({"field_mask": options("none", "circle"),
                             "field_shape": options("circle", "square")},
                            [{"field": "field_mask", "label": "Mask"},
                             {"field": "field_shape", "label": "Shape"}],
                            [["d-none", "circle", "square"]])
        values = {v["axis"]: v for v in figma_build.variant_values(root, "block:x")}
        self.assertIsNone(values["Shape"]["value"])            # both options appear: ambiguous
        self.assertEqual(values["Mask"]["value"], "Circle")    # `d-none` does not count as none
        self.assertEqual(values["Shape"]["others"], ["Circle", "Square"])


if __name__ == "__main__":
    unittest.main()
