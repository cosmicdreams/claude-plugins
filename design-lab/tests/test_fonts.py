"""The font step: which family a site really renders, what Figma has, and what the build draws."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import fonts  # noqa: E402


def text_node(family, weight="400", style="normal", text="Words"):
    return {"path": "/p", "tag": "p", "text": text,
            "computed": {"fontFamily": family, "fontWeight": weight, "fontStyle": style}}


class Site(unittest.TestCase):
    """A repository and a run folder of their own: a theme with self-hosted faces, a Google Fonts
    link, an Adobe Fonts kit, an open-licence font and an icon font."""

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.repo, self.run = root / "repo", root / "run"
        theme = self.repo / "docroot/themes/custom/site"
        (theme / "fonts/suisse").mkdir(parents=True)
        (theme / "fonts/open").mkdir(parents=True)
        for name in ("SuisseIntl-Light", "SuisseIntl-Regular", "SuisseIntl-RegularItalic", "SuisseIntl-Semibold"):
            (theme / f"fonts/suisse/{name}.woff2").write_bytes(b"x")
        (theme / "fonts/open/Assistant.ttf").write_bytes(b"x")
        (theme / "fonts/open/OFL.txt").write_text("SIL Open Font License, Version 1.1")
        (theme / "css").mkdir()
        (theme / "css/fonts.css").write_text("""
@font-face { font-family: "Suisse Int'l"; src: url(../fonts/suisse/SuisseIntl-Light.woff2) format("woff2"); font-weight: 300; }
@font-face { font-family: "Suisse Int'l"; src: url(../fonts/suisse/SuisseIntl-Regular.woff2); font-weight: 400; }
@font-face { font-family: "Suisse Int'l"; src: url(../fonts/suisse/SuisseIntl-RegularItalic.woff2); font-weight: 400; font-style: italic; }
@font-face { font-family: "Suisse Int'l"; src: url(../fonts/suisse/SuisseIntl-Semibold.woff2); font-weight: 500; }
@font-face { font-family: Assistant; src: url(../fonts/open/Assistant.ttf); font-weight: 200 800; }
""")
        (theme / "templates").mkdir()
        (theme / "templates/html.html.twig").write_text(
            '<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;700&amp;family=Work+Sans:wght@700" rel="stylesheet">')
        (theme / "site.info.yml").write_text("libraries:\n  - '//use.typekit.net/abc1234.css'\n")
        nodes = [text_node('"Suisse Int\'l", sans-serif', "500"), text_node('"Suisse Int\'l", sans-serif', "700"),
                 text_node('"Suisse Int\'l", sans-serif', "400", "italic"),
                 text_node("Poppins, Arial, sans-serif"),            # Poppins has no source anywhere
                 text_node("Figtree, sans-serif", "700"),
                 text_node("freight-text-pro, serif", "400", "italic"),
                 text_node("Assistant, sans-serif", "450"),
                 text_node("icomoon", "400", text="")]
        (self.run / "capture/measurements").mkdir(parents=True)
        (self.run / "capture/measurements/card.spec.json").write_text(json.dumps(
            {"measurements": {"desktop:default": {"nodes": nodes}}}))
        self.kit = {"Freight Text Pro": {"cssNames": ["freight-text-pro"], "slug": "freight-text", "variations": ["n4", "i4"]}}

    def plan(self, figma):
        original = fonts.adobe_kit
        fonts.adobe_kit = lambda kit, timeout=8: self.kit if kit == "abc1234" else {}
        try:
            return fonts.finalise(fonts.plan(self.run, self.repo, None, figma))
        finally:
            fonts.adobe_kit = original


class PlanTests(Site):
    FIGMA = {"Inter": ["Regular", "Italic", "Medium", "SemiBold", "Bold"], "Arial": ["Regular", "Bold"],
             "Figtree": ["Regular", "Bold"], "Source Serif 4": ["Regular", "Italic"], "Assistant": ["Regular", "Bold"],
             "Helvetica": ["Regular"]}

    def test_the_family_the_visitor_sees_and_where_it_comes_from(self):
        doc = self.plan(None)
        by = {f["family"]: f for f in doc["families"]}
        self.assertEqual({f: by[f]["source"] for f in ("Suisse Int'l", "Arial", "Figtree", "Freight Text Pro", "Assistant")},
                         {"Suisse Int'l": "self-hosted", "Arial": "system", "Figtree": "google",
                          "Freight Text Pro": "adobe", "Assistant": "self-hosted"})
        self.assertEqual([u["family"] for u in doc["unrendered"]], ["Poppins"], "a family with no source is skipped, as the browser skips it")
        self.assertEqual(doc["icons"], ["icomoon"], "icon fonts are not text")
        self.assertEqual(doc["build"]["stacks"]["Poppins, Arial, sans-serif"], "Arial")
        self.assertFalse(doc["figmaChecked"])

    def test_faces_follow_the_file_served_not_the_weight_number(self):
        faces = self.plan(None)["build"]["families"]["suisseintl"]["faces"]
        self.assertEqual(faces["500|0"], "SemiBold", "weight 500 serves the Semibold file")
        self.assertEqual(faces["700|0"], "SemiBold", "an unserved 700 is drawn with the heaviest served face, as browsers do")
        self.assertEqual(faces["400|1"], "Italic")

    def test_a_missing_family_gets_a_stand_in_by_genre_and_a_route(self):
        doc = self.plan(self.FIGMA)
        by = {f["family"]: f for f in doc["families"]}
        suisse, freight = by["Suisse Int'l"], by["Freight Text Pro"]
        self.assertEqual((suisse["available"], suisse["standIn"]["family"], suisse["route"]["kind"], suisse["route"]["foundry"]),
                         (False, "Inter", "commercial", "Swiss Typefaces"))
        self.assertEqual((freight["standIn"]["family"], freight["route"]["kind"]), ("Source Serif 4", "adobe-fonts"),
                         "a serif stands in for a serif, never a sans italic")
        self.assertIn("https://fonts.adobe.com/fonts/freight-text", " ".join(freight["route"]["steps"]))
        self.assertTrue(by["Figtree"]["available"])
        self.assertTrue(by["Assistant"]["available"])
        lines = "\n".join(fonts.summary_lines(doc))
        self.assertIn("the build uses Inter instead, by default", lines)
        self.assertIn("Styles the site uses: Italic, SemiBold", lines)
        self.assertIn("do not install them unless the licence says you may", lines)

    def test_an_open_licence_font_can_be_installed_from_the_site(self):
        figma = {k: v for k, v in self.FIGMA.items() if k != "Assistant"}
        assistant = next(f for f in self.plan(figma)["families"] if f["family"] == "Assistant")
        self.assertEqual((assistant["route"]["kind"], assistant["route"]["licence"]), ("open-licence", "OFL"))

    def test_a_trial_name_is_the_same_family(self):
        figma = {**self.FIGMA, "Suisse Intl Trial": ["Regular", "Semibold"]}
        suisse = next(f for f in self.plan(figma)["families"] if f["family"] == "Suisse Int'l")
        self.assertEqual((suisse["available"], suisse["figmaFamily"]), (True, "Suisse Intl Trial"))
        self.assertNotIn("standIn", suisse)


class BuildFontTests(Site):
    """The build's font section, run in node with a stand-in Figma, against a plan made above."""

    def resolve(self, plan, figma, texts, axes=None):
        if not shutil.which("node"):
            self.skipTest("node is not installed")
        source = (SCRIPTS / "render/build_responsive.js").read_text()
        start = source.index("/* ---- Fonts: the run's font plan")
        section = source[start:source.index("const codeVars = {};", start)]
        harness = """
const ARGS = { fonts: PLAN };
const report = { fonts: {}, missingFonts: [], standIns: {}, styleFallbacks: {} };
globalThis.figma = {
  listAvailableFontsAsync: async () => Object.entries(FIGMA).flatMap(([family, styles]) => styles.map((style) => ({ fontName: { family, style } }))),
  getFontFamilyVariationAxes: async (family) => (AXES[family] || null),
};
const main = async () => {
SECTION
  const out = [];
  for (const t of TEXTS) out.push(await resolveFont(t));
  console.log(JSON.stringify({ out, report }));
};
main();
""".replace("PLAN", json.dumps(plan)).replace("FIGMA", json.dumps(figma)).replace("AXES", json.dumps(axes or {})) \
            .replace("TEXTS", json.dumps(texts)).replace("SECTION", section)
        done = subprocess.run(["node", "-e", harness], capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout)

    def text(self, stack, weight, italic=False):
        return {"stack": stack, "family": fonts.stack_of(stack)[0], "weight": weight, "italic": italic}

    def test_a_missing_family_is_drawn_in_its_stand_in_with_the_face_it_serves(self):
        plan = self.plan(PlanTests.FIGMA)["build"]
        r = self.resolve(plan, PlanTests.FIGMA, [self.text('"Suisse Int\'l", sans-serif', 500),
                                                  self.text('"Suisse Int\'l", sans-serif', 700),
                                                  self.text("freight-text-pro, serif", 400, True)])
        self.assertEqual([(f["family"], f["style"]) for f in r["out"]],
                         [("Inter", "SemiBold"), ("Inter", "SemiBold"), ("Source Serif 4", "Italic")])
        self.assertEqual(r["report"]["standIns"], {"Suisse Int'l": "Inter", "freight-text-pro": "Source Serif 4"})

    def test_once_installed_the_real_face_is_used_not_the_nearest_weight(self):
        figma = {**PlanTests.FIGMA, "Suisse Intl Trial": ["Light", "Regular", "Italic", "Medium", "Semibold", "Bold"]}
        plan = self.plan(figma)["build"]
        r = self.resolve(plan, figma, [self.text('"Suisse Int\'l", sans-serif', 500)])
        self.assertEqual((r["out"][0]["family"], r["out"][0]["style"]), ("Suisse Intl Trial", "Semibold"),
                         "500 is the Semibold file on this site, not Medium")
        self.assertEqual(r["report"]["missingFonts"], [])

    def test_a_never_served_first_family_is_skipped_and_a_variable_font_draws_the_exact_weight(self):
        plan = self.plan(PlanTests.FIGMA)["build"]
        r = self.resolve(plan, PlanTests.FIGMA, [self.text("Poppins, Arial, sans-serif", 400),
                                                  self.text("Assistant, sans-serif", 450)],
                         axes={"Assistant": [{"tag": "wght", "min": 200, "max": 800}]})
        self.assertEqual((r["out"][0]["family"], r["out"][0]["style"]), ("Arial", "Regular"))
        self.assertEqual(r["out"][1]["variationSettings"], {"wght": 450})

    def test_without_a_plan_names_still_match_and_a_style_fallback_is_recorded(self):
        figma = {"Articulat CF": ["Regular", "Bold"], "Inter": ["Regular"]}
        r = self.resolve(None, figma, [{"stack": "articulat-cf", "family": "articulat-cf", "weight": 600, "italic": False}])
        self.assertEqual(r["out"][0]["family"], "Articulat CF")
        self.assertIn("articulat-cf 600", r["report"]["styleFallbacks"])


if __name__ == "__main__":
    unittest.main()
