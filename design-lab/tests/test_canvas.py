"""Canvas extraction and placement semantics, without a running DDEV site."""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from artifact_contracts import validate
from detect import detect
from extract_canvas import extract as extract_canvas
from extract_canvas_usage import (build_usage, template_rows, PLACEMENTS_SQL,
                                  parse_sqlq_rows, scan_theme_templates, merge_canvas_usage)
from extract_drupal_usage import merge_usage, TIERS
from find_rendered_components import parse_components, public_paths, summarize_pages, enrich_usage
from extract_sdc import extract as extract_sdc, mini_yaml
from scaffold_configs import sdc_selector

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "canvas-site"


def fixture_site(test):
    """A private copy of the Canvas fixture site, so no path above it can matter."""
    folder = tempfile.TemporaryDirectory()
    test.addCleanup(folder.cleanup)
    return Path(shutil.copytree(FIXTURE, Path(folder.name) / "site"))


class CanvasTest(unittest.TestCase):
    def test_sqlq_headerless_tab_rows_keep_first_row_and_empty_columns(self):
        sample = ("page\t0\t1\t3\ten\t0\t\t\tuuid-1\tsdc.kingtec.site-header\tv1\t{}\t\n"
                  "page\t0\t2\t3\ten\t1\tparent-uuid\tcontent\tuuid-2\t"
                  "sdc.kingtec.photo-slide\tv1\t{}\tSlide\n")
        rows = parse_sqlq_rows(sample, 13)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][2], "1")
        self.assertEqual(rows[0][6:8], ["", ""])
        self.assertEqual(rows[0][-1], "")
        self.assertEqual(rows[1][9], "sdc.kingtec.photo-slide")
        self.assertEqual(parse_sqlq_rows("/page/1\t/home\n/page/2\t/resources\n", 2),
                         [["/page/1", "/home"], ["/page/2", "/resources"]])
        with self.assertRaises(ValueError):
            parse_sqlq_rows("bad\trow\n", 13)

    def test_twig_references_and_canvas_merge_preserve_structural_count(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            theme = root / "web/themes/custom/demo"
            (theme / "templates/layout").mkdir(parents=True)
            (theme / "components/parent").mkdir(parents=True)
            (theme / "templates/layout/page.html.twig").write_text(
                "{% include 'demo:site-header' %}\n", encoding="utf-8")
            (theme / "components/parent/parent.twig").write_text(
                "{% embed 'demo:photo-slide' %}{% endembed %}\n"
                "{% source 'demo:photo-slide' %}\n", encoding="utf-8")
            components = {"components": [
                {"id": "sdc.demo.site-header", "sourceSdcId": "demo:site-header"},
                {"id": "sdc.demo.photo-slide", "sourceSdcId": "demo:photo-slide"}]}
            refs = scan_theme_templates(root, components)
            self.assertEqual(refs["demo:site-header"][0]["line"], 1)
            self.assertTrue(refs["demo:site-header"][0]["global"])
            self.assertEqual(len(refs["demo:photo-slide"]), 2)
            rows = {"placements": [["page", "0", "2", "3", "en", "0", "parent",
                                    "content", "uuid", "sdc.demo.photo-slide", "v1", "{}", ""]],
                    "pages": [["2", "3"]], "aliases": [["/page/2", "/resources"]],
                    "templates": [], "twig_refs": refs}
            document = build_usage(components, rows, {"approot": str(root)})
            merged = merge_canvas_usage(components, document)
            header, photo = merged["components"]
            self.assertEqual(header["category"], TIERS["high"])
            self.assertEqual(photo["usage"]["structuralReferences"], 1)
            self.assertEqual(photo["category"], TIERS["structural"])
            self.assertEqual(photo["usage"]["exampleCandidates"], ["/resources"])

    def test_rendered_markers_paths_and_example_fallback(self):
        html = ("<div data-component-id='demo:site-header'></div>"
                "<section data-component-id='demo:photo-slide'>"
                "<img data-component-id='demo:photo-slide'></section>")
        self.assertEqual(parse_components(html),
                         {"demo:site-header": 1, "demo:photo-slide": 2})
        paths = public_paths([["/node/9", "/nine"], ["/page/2", "/resources"],
                              ["/page/1", "/home"], ["/node/2", "/two"]], 3)
        self.assertEqual(paths, ["/home", "/resources", "/two"])
        components = {"components": [{"id": "sdc.demo.photo-slide",
                                       "sourceSdcId": "demo:photo-slide"}]}
        evidence = summarize_pages([("/b", 200, html), ("/a", 200, html),
                                    ("/offline", 0, html)], components)
        self.assertEqual(evidence["sdc.demo.photo-slide"]["renderedInstances"], 4)
        generic = {"components": [{"id": "photo-slide", "sourceRef":
                   "web/themes/custom/demo/components/photo-slide/photo-slide.component.yml"}]}
        self.assertEqual(summarize_pages([("/a", 200, html)], generic)["photo-slide"]
                         ["renderedInstances"], 2)
        document = {"source": {}, "usage": {"sdc.demo.photo-slide": {
            "placements": 0, "structuralRefs": 0, "pages": 0, "exampleCandidates": []}}}
        enrich_usage(document, evidence, {"baseUrl": "https://example.test"})
        self.assertEqual(document["usage"]["sdc.demo.photo-slide"]["exampleCandidates"],
                         ["/a", "/b"])

    def test_yaml_subset_handles_indented_and_indentless_lists(self):
        data = mini_yaml("props:\n  required:\n  - image\n  examples:\n    - src: /a.png\n      alt: Logo\n", "fixture.yml")
        self.assertEqual(data["props"]["required"], ["image"])
        self.assertEqual(data["props"]["examples"], [{"src": "/a.png", "alt": "Logo"}])

    def test_sdc_extraction_parses_every_component_with_list_accepts(self):
        result = extract_sdc(str(fixture_site(self)))
        self.assertEqual(len(result["components"]), 3)
        self.assertEqual(result["problems"], [])
        self.assertEqual(validate(result, "components"), [])
        showcase = next(c for c in result["components"] if c["id"] == "program-showcase")
        self.assertEqual(showcase["slots"], [{"name": "body", "label": "Body", "accepts": ["*"]}])

    def test_canvas_inventory_and_detection(self):
        site = fixture_site(self)
        result = extract_canvas(str(site))
        # The unregistered SDC has no Canvas registration, so authors cannot place it.
        self.assertEqual([c["id"] for c in result["components"]],
                         ["sdc.demo.photo-slide", "sdc.demo.program-showcase"])
        self.assertEqual(result["problems"], [])
        self.assertEqual(validate(result, "components"), [])
        photo = next(c for c in result["components"] if c["id"] == "sdc.demo.photo-slide")
        self.assertEqual(photo["sourceSdcId"], "demo:photo-slide")
        self.assertTrue(photo["componentVersion"])
        image = next(f for f in photo["fields"] if f["name"] == "image")
        self.assertEqual(image["canvasFieldType"], "entity_reference")
        self.assertTrue(image["required"])
        self.assertIn("canvas.component.sdc.demo.photo-slide", image["provenance"]["kind"])
        self.assertEqual(photo["folder"], "Content")
        detected = detect(str(site))
        self.assertEqual(detected["recommended"]["component"], "canvas")
        self.assertEqual(detected["recommended"]["usage"], "canvas-db")

    def test_template_nodes_skip_disabled_templates_and_root_selector(self):
        site = fixture_site(self)
        rows = template_rows(site)
        self.assertEqual(len(rows), 2)
        self.assertEqual({row[2] for row in rows}, {"program", "season"})
        theme = site / "web/themes/custom/demo"
        self.assertEqual(sdc_selector(str(theme), "photo-slide")[0], ".demo-slide")
        # The macro's markup is not the root; the section after it is.
        self.assertEqual(sdc_selector(str(theme), "program-showcase")[0], ".demo-program")

    def test_published_current_page_rows_templates_and_non_sdc(self):
        self.assertIn("p.revision_id=c.revision_id", PLACEMENTS_SQL)
        self.assertIn("p.status=1", PLACEMENTS_SQL)
        self.assertIn("c.deleted=0", PLACEMENTS_SQL)
        counts = {"formatted-section": 82, "content-column": 30,
                  "external-embed": 17, "reference-image": 11, "sponsor-logo": 11,
                  "document-preview": 10, "profile-card": 8, "photo-slide": 7,
                  "program-link": 7, "impact-figure": 6, "content-grid": 6,
                  "gallery-photo": 6, "contact-social-link": 5, "logo-row": 4,
                  "faq-item": 4, "image-story": 3, "source-grid": 3,
                  "program-links": 2, "sponsor-section": 2, "impact-grid": 1,
                  "contact-layout": 1, "photo-carousel": 1, "photo-gallery": 1,
                  "event-countdown": 1, "event-results": 1, "faq-group": 1,
                  "weekly-schedule": 1}
        components = {"components": [{"id": "sdc.kingtec." + name, "fields": [],
            "slots": [], "defects": [], "label": name, "sourceRef": name} for name in counts]}
        placements = []
        for name, count in counts.items():
            for index in range(count):
                # The joined query has already excluded unpublished and old revisions.
                parent = "parent-uuid" if name == "content-column" and index < 20 else ""
                placements.append(["page", "0", str(index % 16 + 1), "3", "en", str(index),
                    parent, "content" if parent else "", "uuid", "sdc.kingtec." + name,
                    "version", "{}", ""])
        for identifier in ("block.kingtec_contact_form", "js.bullseye"):
            placements.append(["page", "0", "1", "3", "en", "0", "", "", "uuid",
                               identifier, "", "{}", ""])
        rows = {"placements": placements, "pages": [[str(i), "3"] for i in range(1, 17)],
                "aliases": [["/page/1", "/welcome"]],
                "templates": [["sdc.kingtec.program-link", "node.program.full", "program",
                               "config/sync/canvas.content_template.node.program.full.yml"]]}
        result = build_usage(components, rows, {"approot": "/fixture"})
        self.assertEqual(validate(result, "usage"), [])
        self.assertEqual(result["source"]["population"]["publishedPages"], 16)
        self.assertEqual(result["usage"]["sdc.kingtec.formatted-section"]["placements"], 82)
        column = result["usage"]["sdc.kingtec.content-column"]
        self.assertEqual((column["placements"], column["structuralRefs"]), (10, 20))
        self.assertEqual(column["pages"], 16)
        self.assertIn("/welcome", column["exampleCandidates"])
        link = result["usage"]["sdc.kingtec.program-link"]
        self.assertEqual((link["placements"], link["templatePlacements"]), (8, 1))
        self.assertEqual(link["templateBundles"], ["program"])
        self.assertEqual(result["usage"]["js.bullseye"]["placements"], 1)
        self.assertEqual(result["problems"][0]["evidence"],
                         ["block.kingtec_contact_form", "js.bullseye"])
        merged = merge_usage(components, result)
        section = next(c for c in merged["components"] if c["id"].endswith("formatted-section"))
        self.assertEqual(section["category"], TIERS["high"])


if __name__ == "__main__":
    unittest.main()
