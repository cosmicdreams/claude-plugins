"""Offline published-copy fixtures and deterministic reducer checks."""

import json
import sys
import unittest
from unittest import mock
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import extract_voice
import published_pages


HOME = '''<html><head><title>Welcome to North Star</title><meta name="description" content="Join North Star"></head>
<body><header><h1>Hidden Site Heading</h1></header><main><h1>Find Your Path</h1>
<p>You can join North Star today. Your next step begins here.</p><p>North Star helps every neighbor.</p>
<a href="/join">Join Now</a><button>LEARN MORE</button><ul><li>First item</li></ul></main>
<footer>Ignore this</footer></body></html>'''
SECOND = '''<html><head><title>Programs at North Star</title></head><body><main><h1>Find your path</h1>
<p>We help North Star members. You can visit North Star.</p><a>Learn more</a></main></body></html>'''
THIRD = '''<html><head><title>Contact North Star</title><meta name="description" content="Contact us"></head>
<body><main><p>North-Star members can apply today.</p><a>Apply Now</a></main></body></html>'''


class VoiceTests(unittest.TestCase):
    def test_parser_uses_main_and_preserves_authored_labels(self):
        page = extract_voice.parse_page(HOME)
        self.assertEqual(page["headings"]["1"], ["Find Your Path"])
        self.assertEqual(page["labels"], ["Join Now", "LEARN MORE"])
        self.assertNotIn("Ignore this", page["text"])
        self.assertNotIn("Hidden Site Heading", page["text"])

    def test_reducer_reports_core_sections_and_is_byte_stable(self):
        pages = [("/third", 200, THIRD), ("/", 200, HOME), ("/bad", 404, ""),
                 ("/second", 200, SECOND)]
        args = (pages, "North Star", "2026-09-23T12:00:00+00:00")
        first = extract_voice.build_voice(*args)
        second = extract_voice.build_voice(*args)
        serialize = lambda value: json.dumps(value, indent=2, ensure_ascii=False).encode()
        self.assertEqual(serialize(first), serialize(second))
        self.assertEqual(first["positioning"]["address"], "/")
        self.assertEqual(first["corpus"]["pagesFetched"], 3)
        self.assertEqual(first["corpus"]["pagesFailed"], ["/bad"])
        self.assertEqual(first["evidence"]["allCapsCallToActionShare"]["numerator"], 1)
        self.assertEqual(first["headlines"]["noH1"], ["/third"])
        self.assertTrue(first["nameForms"]["multipleForms"])
        self.assertTrue(all(len(row["evidence"]["quotes"]) <= 2 for row in first["rules"]))
        self.assertTrue(all("numerator" in row["evidence"] for row in first["rules"]))
        sections = {row["section"] for row in first["rules"] if row["kind"] == "OBSERVED"}
        self.assertEqual(sections, {"Voice", "Naming & terminology", "Headlines", "Calls to action", "Readability", "Search"})
        self.assertEqual(len(first["stats"]), 5)
        self.assertTrue(all(set(tile) == {"value", "label", "qualifier"} for tile in first["stats"]))
        self.assertTrue(all(isinstance(tile["value"], str) for tile in first["stats"]))

    def test_positioning_skips_stats_and_uses_long_paragraphs(self):
        html = '''<body><main><h1>Welcome to the community</h1><div class="stats"><p>20+</p><p>20</p></div>
        <p>Our students work together to build robots for the community.</p>
        <figure><p>This caption has enough words to appear but is not body prose.</p></figure>
        <p>Every season gives new members a chance to learn and lead.</p></main></body>'''
        result = extract_voice.build_voice([("/", 200, html)], "Community", "2026-09-23T12:00:00+00:00")
        self.assertEqual(result["positioning"]["paragraphs"], [
            "Our students work together to build robots for the community.",
            "Every season gives new members a chance to learn and lead."])

    def test_positioning_falls_back_to_long_prose_sentences(self):
        html = '''<body><main><h1>Welcome</h1><p>20+</p>
        <blockquote>Students design robots together and share what they learn. New members can practice skills with experienced teammates.</blockquote>
        </main></body>'''
        result = extract_voice.build_voice([("/", 200, html)], "Team", "2026-09-23T12:00:00+00:00")
        self.assertEqual(result["positioning"]["paragraphs"], [
            "Students design robots together and share what they learn.",
            "New members can practice skills with experienced teammates."])

    def test_templated_data_does_not_enter_vocabulary(self):
        robot = '''<body class="page-node-type-robot"><main><h1>Robot archive</h1>
        <table><tr><th>Quick Facts Name</th><td>Size X X</td><td>Weight LBS</td></tr></table>
        <p>Students build creative machines together every season.</p></main></body>'''
        article = '''<body class="page-node-type-article"><main><h1>Our team</h1>
        <p>Students build creative machines together every season.</p></main></body>'''
        pages = [(f"/{year}-robot", 200, robot) for year in (2022, 2023, 2024)]
        pages.append(("/team", 200, article))
        result = extract_voice.build_voice(pages, "Team", "2026-09-23T12:00:00+00:00")
        phrases = {item["phrase"] for item in result["vocabulary"]["phrases"]}
        self.assertIn("students build creative", phrases)
        self.assertFalse(any("size" in phrase or "weight" in phrase or "quick facts" in phrase for phrase in phrases))
        robot_only = extract_voice.build_voice(pages[:-1], "Team", "2026-09-23T12:00:00+00:00")
        self.assertEqual(robot_only["vocabulary"]["phrases"], [])

    def test_project_config_and_bounded_homepage_addresses(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "repo"
            (repo / "config" / "sync").mkdir(parents=True)
            (repo / "config" / "sync" / "system.site.yml").write_text(
                "name: 'North Star'\npage:\n  front: /node/2\n")
            (root / "project.json").write_text(json.dumps({"repository": {"root": str(repo)}}))
            configured_root, name, front = published_pages.site_config(root)
            self.assertEqual((configured_root, name, front), (repo.resolve(), "North Star", "/node/2"))
            aliases = [("/node/3", "/other"), ("/node/2", "/welcome")]
            with mock.patch.object(published_pages, "sqlq_rows", return_value=aliases):
                self.assertEqual(published_pages.addresses(repo, front, 2), ["/", "/welcome"])

    def test_body_fallback_excludes_navigation(self):
        page = extract_voice.parse_page('<body><nav>Navigation</nav><p>Useful copy.</p><footer>End</footer></body>')
        self.assertEqual(page["text"], "Useful copy.")


if __name__ == "__main__":
    unittest.main()
