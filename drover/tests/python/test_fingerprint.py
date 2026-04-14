"""Tests for drover/scripts/fingerprint.py — stdlib unittest, no deps."""
import importlib.util
import io
import json
import pathlib
import sys
import unittest
from contextlib import redirect_stdout

HERE = pathlib.Path(__file__).resolve()
SCRIPT = HERE.parents[2] / "scripts" / "fingerprint.py"

spec = importlib.util.spec_from_file_location("fingerprint", SCRIPT)
fp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fp)


class TestClassify(unittest.TestCase):
    def test_fatal_is_error(self):
        self.assertEqual(fp.classify("PHP Fatal error: something"), "error")

    def test_uncaught_is_error(self):
        self.assertEqual(fp.classify("Uncaught TypeError x"), "error")

    def test_warning(self):
        self.assertEqual(fp.classify("PHP Warning: x"), "warning")

    def test_notice(self):
        self.assertEqual(fp.classify("Notice: Undefined index"), "notice")

    def test_deprecated_maps_to_notice(self):
        self.assertEqual(fp.classify("Deprecated: thing"), "notice")

    def test_no_error_keyword_returns_none(self):
        self.assertIsNone(fp.classify("127.0.0.1 GET / 200"))

    def test_severity_order_error_beats_notice(self):
        # A line mentioning both should classify at the highest severity.
        self.assertEqual(
            fp.classify("Fatal error: Notice chain broken"), "error"
        )


class TestSourceOf(unittest.TestCase):
    def test_watchdog_pipe_format(self):
        self.assertEqual(
            fp.source_of("Sun, 2026/04/14 - 14:55 | php | Notice: x"),
            "watchdog",
        )

    def test_php_error(self):
        self.assertEqual(
            fp.source_of("[php:error] [pid 1] Uncaught"), "php"
        )

    def test_apache_error(self):
        self.assertEqual(fp.source_of("[error] AH00xxx"), "apache")

    def test_other_falls_back(self):
        self.assertEqual(fp.source_of("something else error"), "other")


class TestFingerprintStability(unittest.TestCase):
    def test_same_error_different_timestamps_same_hash(self):
        a = "Sun, 2026/04/14 - 14:55 | php | Notice: Undefined index: bar in Drupal\\foo\\Baz->render() (line 123 of /app/web/modules/bar.module)."
        b = "Sun, 2026/04/14 - 14:56 | php | Notice: Undefined index: bar in Drupal\\foo\\Baz->render() (line 123 of /app/web/modules/bar.module)."
        self.assertEqual(fp.fingerprint(a), fp.fingerprint(b))

    def test_same_error_different_ips_same_hash(self):
        a = "[error] 10.0.0.1 Uncaught TypeError in /app/web/foo.php:42"
        b = "[error] 192.168.1.99 Uncaught TypeError in /app/web/foo.php:42"
        self.assertEqual(fp.fingerprint(a), fp.fingerprint(b))

    def test_same_error_different_line_numbers_same_hash(self):
        a = "Fatal error: Uncaught X in /app/foo.php on line 42"
        b = "Fatal error: Uncaught X in /app/foo.php on line 999"
        self.assertEqual(fp.fingerprint(a), fp.fingerprint(b))

    def test_different_errors_different_hash(self):
        a = "Fatal error: Uncaught TypeError in /app/foo.php"
        b = "Fatal error: Uncaught ValueError in /app/foo.php"
        self.assertNotEqual(fp.fingerprint(a), fp.fingerprint(b))

    def test_fingerprint_is_12_hex_chars(self):
        h = fp.fingerprint("Fatal error: anything")
        self.assertEqual(len(h), 12)
        int(h, 16)  # must parse as hex


class TestProcess(unittest.TestCase):
    def test_non_error_line_returns_none(self):
        self.assertIsNone(fp.process("127.0.0.1 - - [date] \"GET / 200\""))

    def test_blank_line_returns_none(self):
        self.assertIsNone(fp.process(""))
        self.assertIsNone(fp.process("\n"))

    def test_error_line_returns_dict_with_required_keys(self):
        r = fp.process("PHP Fatal error: Uncaught X in /a/b.php on line 1")
        self.assertIsNotNone(r)
        for k in ("fingerprint", "severity", "source", "message"):
            self.assertIn(k, r)

    def test_message_truncated_to_200(self):
        long = "Fatal error: " + ("x" * 500)
        r = fp.process(long)
        self.assertLessEqual(len(r["message"]), 200)


class TestMainStdin(unittest.TestCase):
    def test_emits_json_per_error_line_only(self):
        lines = [
            "PHP Fatal error: Uncaught A in /a/b.php on line 1",
            "127.0.0.1 - - [date] \"GET / 200\"",
            "Notice: Undefined index: bar",
        ]
        sys.stdin = io.StringIO("\n".join(lines) + "\n")
        buf = io.StringIO()
        try:
            with redirect_stdout(buf):
                fp.main()
        finally:
            sys.stdin = sys.__stdin__
        out_lines = [l for l in buf.getvalue().splitlines() if l.strip()]
        self.assertEqual(len(out_lines), 2)  # skipped the access log
        for l in out_lines:
            json.loads(l)  # every line is valid JSON


if __name__ == "__main__":
    unittest.main()
