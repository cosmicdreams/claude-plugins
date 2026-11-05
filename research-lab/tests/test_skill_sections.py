"""Every research-lab skill exposes the same sections, so callers can extract them by heading."""

import pathlib
import re
import unittest

SKILLS = pathlib.Path(__file__).resolve().parents[1] / "skills"
REQUIRED = ("## Input contract", "## Preflight", "## Suggest next")
SKILL_REF = re.compile(r"`research-lab:([a-z-]+)`")


def section(text, heading):
    """Return the body under an exact level-2 heading, up to the next level-2 heading."""
    match = re.search(rf"^{re.escape(heading)}\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    return match.group(1) if match else None


class SkillSectionsTest(unittest.TestCase):
    def skill_files(self):
        files = sorted(SKILLS.glob("*/SKILL.md"))
        self.assertTrue(files, "no research-lab skills found")
        return files

    def test_required_headings_appear_exactly_once(self):
        for path in self.skill_files():
            lines = path.read_text().splitlines()
            for heading in REQUIRED:
                with self.subTest(skill=path.parent.name, heading=heading):
                    self.assertEqual(lines.count(heading), 1)

    def test_suggest_next_opens_with_never_auto_invoke(self):
        for path in self.skill_files():
            with self.subTest(skill=path.parent.name):
                body = section(path.read_text(), "## Suggest next") or ""
                self.assertEqual(body.strip().partition("\n")[0], "Never auto-invoke.")

    def test_suggest_next_names_only_existing_skills(self):
        names = {path.parent.name for path in self.skill_files()}
        for path in self.skill_files():
            body = section(path.read_text(), "## Suggest next") or ""
            for target in SKILL_REF.findall(body):
                with self.subTest(skill=path.parent.name, target=target):
                    self.assertIn(target, names)


if __name__ == "__main__":
    unittest.main()
