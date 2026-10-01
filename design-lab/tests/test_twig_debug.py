"""Twig debug markers, embedded-component markers, and the order usage tries them in."""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import extract_drupal_rendering
import extract_drupal_usage
import scaffold_configs
import twig_debug


def render(hook, suggestions, body):
    names = "\n".join(f"   * {name}" for name in suggestions)
    return (f"<!-- THEME DEBUG -->\n<!-- THEME HOOK: '{hook}' -->\n"
            f"<!-- FILE NAME SUGGESTIONS:\n{names}\n-->\n"
            f"<!-- 💡 BEGIN CUSTOM TEMPLATE OUTPUT from 'themes/x/{suggestions[0]}' -->\n"
            f"{body}\n<!-- END CUSTOM TEMPLATE OUTPUT from 'themes/x/{suggestions[0]}' -->\n")


PAGE = ("<html><body>"
        + render("paragraph", ["paragraph--cards--default.html.twig", "paragraph--cards.html.twig",
                               "paragraph.html.twig"], '<div data-component-id="kinetic:cards">a</div>')
        + render("paragraph", ["paragraph--cards.html.twig", "paragraph.html.twig"],
                 '<div data-component-id="kinetic:cards">b</div>')
        + render("block", ["block--cards.html.twig", "block.html.twig"],
                 '<div class="block--cards"><div data-component-id="kinetic:cards">c</div></div>')
        + render("paragraph", ["paragraph--link-default.html.twig", "paragraph.html.twig"],
                 "<a href='/x'>x</a>")
        + "</body></html>")


class TwigDebugTest(unittest.TestCase):
    def test_suggestion_uses_drupal_hyphens(self):
        self.assertEqual(twig_debug.suggestion("paragraph:link_default"),
                         ("paragraph", "paragraph--link-default.html.twig"))
        self.assertEqual(twig_debug.root_selector("block:cards"),
                         '[data-design-lab-root="block:cards"]')

    def test_count_matches_the_bundle_hook_only(self):
        self.assertTrue(twig_debug.enabled(PAGE))
        self.assertFalse(twig_debug.enabled("<html></html>"))
        self.assertEqual(twig_debug.count(PAGE, "paragraph:cards"), 2)
        self.assertEqual(twig_debug.count(PAGE, "block:cards"), 1)
        self.assertEqual(twig_debug.count(PAGE, "paragraph:link_default"), 1)
        self.assertEqual(twig_debug.count(PAGE, "paragraph:text"), 0)

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_page_scripts_are_valid_javascript(self):
        for script in (twig_debug.tag_script("paragraph:cards"),
                       twig_debug.reveal_script('[data-component-id="kinetic:cards"]')):
            self.assertNotIn("%(", script)
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as handle:
                handle.write(script)
            result = subprocess.run(["node", "--check", handle.name],
                                    capture_output=True, text=True)
            Path(handle.name).unlink()
            self.assertEqual(result.returncode, 0, result.stderr)


class RenderingMarkerTest(unittest.TestCase):
    def test_root_sdc_requires_the_embed_before_any_markup(self):
        self.assertEqual(extract_drupal_rendering.root_sdc(
            "{# docs <div> #}\n{% embed 'kinetic:cards' with {x: 1} %}{% endembed %}"),
            "kinetic:cards")
        self.assertIsNone(extract_drupal_rendering.root_sdc(
            "<section>{% embed 'kinetic:cards' %}{% endembed %}</section>"))
        self.assertIsNone(extract_drupal_rendering.root_sdc("<div>{{ content }}</div>"))

    def test_include_matches_function_and_tag_forms(self):
        found = extract_drupal_rendering.INCLUDE.findall(
            "{{ include('kinetic:button') }} {% embed 'kinetic:card' %} {%- include \"kinetic:link\" %}")
        self.assertEqual([m[0] + ":" + m[1] if m[0] else m[2] + ":" + m[3] for m in found],
                         ["kinetic:button", "kinetic:card", "kinetic:link"])


class UsageMarkerOrderTest(unittest.TestCase):
    def document(self, *ids):
        return {"source": {}, "usage": {cid: {"exampleCandidates": ["/node/1"]} for cid in ids}}

    def enrich(self, page, ids, rendering):
        with patch.object(extract_drupal_usage, "_fetch_page", return_value=(200, page)):
            return extract_drupal_usage.enrich_examples(
                self.document(*ids), "https://site.ddev.site", rendering)

    def test_with_twig_debug_the_template_marker_beats_a_shared_component_id(self):
        rendering = {"items": {"paragraph:cards": {"rootSdc": "kinetic:cards"}}}
        result = self.enrich(PAGE, ["paragraph:cards", "block:cards"], rendering)
        cards = result["usage"]["paragraph:cards"]["examples"][0]
        self.assertEqual((cards["markerKind"], cards["instancesOnPage"]), ("template", 2))
        self.assertEqual(result["usage"]["block:cards"]["examples"][0]["markerKind"], "class")
        self.assertTrue(result["source"]["exampleVerification"]["twigDebug"])

    def test_without_twig_debug_the_component_id_is_used(self):
        page = '<div data-component-id="kinetic:cards">a</div>'
        rendering = {"items": {"paragraph:cards": {"rootSdc": "kinetic:cards"}}}
        result = self.enrich(page, ["paragraph:cards"], rendering)
        example = result["usage"]["paragraph:cards"]["examples"][0]
        self.assertEqual((example["markerKind"], example["marker"]), ("component", "kinetic:cards"))
        self.assertFalse(result["source"]["exampleVerification"]["twigDebug"])

    def test_scaffold_turns_each_marker_kind_into_a_selector_and_setup(self):
        for kind, marker, selector in (
                ("class", "block--cards", ".block--cards"),
                ("component", "kinetic:cards", '[data-component-id="kinetic:cards"]'),
                ("template", "paragraph--cards.html.twig", '[data-design-lab-root="paragraph:cards"]')):
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                components = root / "components.json"
                components.write_text(json.dumps({"source": {}, "components": [{
                    "id": "paragraph:cards", "machineName": "cards", "usage": {"examples": [{
                        "path": "/node/1", "marker": marker, "markerKind": kind}]}}]}))
                argv = ["scaffold_configs.py", str(components), "--out", str(root / "out"),
                        "--canonical-base-url", "https://example.org",
                        "--site-url", "https://site.ddev.site"]
                with patch.object(sys, "argv", argv):
                    scaffold_configs.main()
                cfg = json.loads((root / "out/paragraph__cards.json").read_text())
                self.assertEqual(cfg["rootSelector"], selector)
                setup = cfg["states"][0]["setup"]
                self.assertIn("data-design-lab-root" if kind == "template" else "revealed", setup)


if __name__ == "__main__":
    unittest.main()


class NestingTest(unittest.TestCase):
    def test_child_renders_are_counted_only_inside_the_parent(self):
        link = render("paragraph", ["paragraph--link-default.html.twig"], "<a>x</a>")
        page = ("<html>" + render("block", ["block--banner.html.twig"], "<div>" + link + link + "</div>")
                + link + render("block", ["block--text.html.twig"], "<p>t</p>") + "</html>")
        self.assertEqual(twig_debug.renders_within(page, "block:banner", ["paragraph:link_default"]),
                         {"parentRenders": 1, "children": {"paragraph:link_default": 2}})
        self.assertEqual(twig_debug.renders_within(page, "block:text", ["paragraph:link_default"]),
                         {"parentRenders": 1, "children": {"paragraph:link_default": 0}})

    def test_slot_is_data_only_with_proof_and_rendered_otherwise(self):
        import figma_receipts
        slot = {"name": "field_links", "accepts": ["paragraph:link_default"]}
        unseen = {"page": "/p", "parentRenders": 1, "children": {"paragraph:link_default": 0}}
        self.assertFalse(figma_receipts.slot_rendering(unseen, slot)["rendered"])
        seen = {**unseen, "children": {"paragraph:link_default": 2}}
        self.assertTrue(figma_receipts.slot_rendering(seen, slot)["rendered"])
        self.assertTrue(figma_receipts.slot_rendering(None, slot)["rendered"])
        self.assertTrue(figma_receipts.slot_rendering({**unseen, "parentRenders": 0}, slot)["rendered"])

    def test_children_are_built_before_parents(self):
        import figma_build
        comps = [{"id": "block:banner", "slots": [{"accepts": ["paragraph:link_default"]}]},
                 {"id": "block:text"}, {"id": "paragraph:link_default"}]
        order = figma_build.children_first([{"id": c["id"]} for c in comps], comps)
        self.assertEqual([b["id"] for b in order], ["paragraph:link_default", "block:banner", "block:text"])
