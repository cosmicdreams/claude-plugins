import re
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from process_lab import detect, gates, manifest


def kinds(command, tests=()):
    return [(m["detected_by"], m["certain"]) for m in detect.detect(command, tests)]


class SplittingTests(unittest.TestCase):
    def test_quoted_operators_stay_in_message(self):
        for message in (";", "Fix; PPS-1", "a && b", "x | y", "a || b"):
            found = detect.detect('git commit -m "' + message + '"')
            self.assertEqual(1, len(found), message)
            self.assertEqual(message, found[0]["message"])

    def test_single_quotes_and_escapes(self):
        self.assertEqual("it's; fine", detect.detect("git commit -m 'it'\\''s; fine'")[0]["message"])
        self.assertEqual([("pushed", True)], kinds("echo a\;b && git push"))

    def test_unbalanced_quotes_detect_nothing(self):
        self.assertEqual([], detect.detect('git commit -m "unterminated && git push'))

    def test_heredoc_substitution_is_one_segment(self):
        command = "git commit -m \"$(cat <<'EOF'\nfix: thing; PPS-9\n\nbody | more\nEOF\n)\""
        found = detect.detect(command)
        self.assertEqual(["commit"], [m["detected_by"] for m in found])
        self.assertIn("PPS-9", found[0]["message"])

    def test_dry_run_anywhere(self):
        self.assertEqual([], kinds("git commit -m PPS-123 --dry-run"))
        self.assertEqual([], kinds("git commit --dry-run -m PPS-123"))
        self.assertEqual([("commit", True)], kinds("git commit -m --dry-run"))


class BranchContextTests(unittest.TestCase):
    def test_git_branch_does_not_switch(self):
        found = detect.detect("git branch feature/PPS-456-other && git push")
        self.assertFalse(found[0]["switches"])

    def test_checkout_and_switch_do(self):
        found = detect.detect("git checkout feature/PPS-7-x && git push")
        self.assertEqual("branch-switched", found[0]["detected_by"])
        self.assertTrue(found[0]["switches"])
        self.assertTrue(detect.detect("git switch -c feature/PPS-8-y")[0]["switches"])


class BoundedMatchTests(unittest.TestCase):
    def test_pathological_pattern_returns_quickly(self):
        pattern = re.compile(r"^a*a*a*a*a*a*a*a*a*a*a*a*b$")
        start = time.monotonic()
        result = manifest.bounded_fullmatch(pattern, "a" * 255)
        self.assertLess(time.monotonic() - start, 0.5)
        self.assertTrue(result)

    def test_ordinary_pattern(self):
        pattern = re.compile(r"^feature/PPS-\d+-[a-z-]+$")
        self.assertTrue(manifest.bounded_fullmatch(pattern, "feature/PPS-1-abc"))
        self.assertFalse(manifest.bounded_fullmatch(pattern, "main"))


class ParserWarningTests(unittest.TestCase):
    def test_include_macro_and_empty_row_warn(self):
        html = ("<table><tbody><tr><th>Gate</th><th>Detected by</th><th>Jira transition</th><th>Obligations</th></tr>"
                "<tr><td>Pushed</td><td>pushed</td><td>none</td><td><ac:structured-macro ac:name=\"include\">"
                "<ac:parameter ac:name=\"page\">Shared steps</ac:parameter></ac:structured-macro></td></tr></tbody></table>")
        parsed, warnings = gates.parse_page(html)
        self.assertEqual([], parsed[0]["obligations"])
        self.assertTrue(any("no obligations" in w for w in warnings))
        self.assertTrue(any("include" in w for w in warnings))


if __name__ == "__main__":
    unittest.main()
