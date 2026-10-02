"""Failures one real Drupal site exposed: an enabled module with no field table, Twig debug
comments that read as class markers, and captures taller than Figma accepts."""

import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import extract_drupal_usage  # noqa: E402
import figma_runner  # noqa: E402


class OptionalTableTests(unittest.TestCase):
    def test_layout_sections_skipped_when_table_is_absent(self):
        describe = subprocess.CompletedProcess(
            [], 0, json.dumps({"raw": {"status": "running", "name": "site"}}), "")
        queries = []

        def mysql(_root, _project, sql):
            queries.append(sql)
            return [["paragraphs_item_field_data"], ["node_field_data"]] if sql == "SHOW TABLES;" else []

        with mock.patch.object(extract_drupal_usage.subprocess, "run", return_value=describe), \
                mock.patch.object(extract_drupal_usage, "_mysql", side_effect=mysql):
            rows = extract_drupal_usage.collect_rows(tempfile.gettempdir())
        self.assertEqual(rows["layout_sections"], [])
        self.assertFalse(any("node__layout_builder__layout" in sql for sql in queries))


class ClassMarkerTests(unittest.TestCase):
    def test_template_file_name_in_a_debug_comment_is_not_a_class(self):
        html = ("<!-- THEME DEBUG -->\n<!-- THEME HOOK: 'block' -->\n"
                "<!-- BEGIN OUTPUT from 'themes/x/templates/block/block--icon-block.html.twig' -->\n"
                '<div class="block--block-content--type--icon-block">Icons</div>\n'
                "<!-- END OUTPUT from 'themes/x/templates/block/block--icon-block.html.twig' -->")
        document = {"usage": {"block:icon_block": {"exampleCandidates": ["/"]}}, "source": {}}
        with mock.patch.object(extract_drupal_usage, "_fetch_page", return_value=(200, html)):
            extract_drupal_usage.enrich_examples(document, "https://site.test")
        kinds = {e["markerKind"] for e in document["usage"]["block:icon_block"]["examples"]}
        self.assertNotIn("class", kinds)


class FigmaImageLimitTests(unittest.TestCase):
    def _png(self, size):
        from PIL import Image
        path = Path(tempfile.mkdtemp()) / "shot.png"
        Image.new("RGB", size, "white").save(path)
        return path

    def test_tall_capture_is_scaled_to_fit(self):
        from PIL import Image
        out = Image.open(io.BytesIO(figma_runner.fit_figma_image(self._png((375, 5148)))))
        self.assertEqual(max(out.size), figma_runner.FIGMA_IMAGE_LIMIT)
        self.assertAlmostEqual(out.width / out.height, 375 / 5148, places=2)

    def test_image_within_limit_is_unchanged(self):
        path = self._png((1400, 900))
        self.assertEqual(figma_runner.fit_figma_image(path), path.read_bytes())


if __name__ == "__main__":
    unittest.main()
