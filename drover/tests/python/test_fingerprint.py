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


class TestFingerprintStructured(unittest.TestCase):
    def test_watchdog_includes_type_in_key(self):
        a = fp.fingerprint_structured("watchdog", "undefined index bar", type_="php")
        b = fp.fingerprint_structured("watchdog", "undefined index bar", type_="cron")
        self.assertNotEqual(a, b)

    def test_watchdog_stable_across_instances(self):
        msg = "Notice: Undefined index foo in line 42"
        a = fp.fingerprint_structured("watchdog", msg, type_="php")
        b = fp.fingerprint_structured("watchdog", msg, type_="php")
        self.assertEqual(a, b)

    def test_php_uses_module_relative_file(self):
        a = fp.fingerprint_structured(
            "php", "Uncaught TypeError", level="error",
            file="/var/www/html/modules/custom/foo/src/Bar.php",
        )
        b = fp.fingerprint_structured(
            "php", "Uncaught TypeError", level="error",
            file="/tmp/build123/modules/custom/foo/src/Bar.php",
        )
        self.assertEqual(a, b)

    def test_php_line_number_ignored(self):
        a = fp.fingerprint_structured(
            "php", "Uncaught X in Foo.php on line 10", level="error",
            file="modules/foo/Foo.php",
        )
        b = fp.fingerprint_structured(
            "php", "Uncaught X in Foo.php on line 99", level="error",
            file="modules/foo/Foo.php",
        )
        self.assertEqual(a, b)

    def test_apache_strips_client_and_pid(self):
        a = fp.fingerprint_structured(
            "apache", "[client 10.0.0.1:12345] [pid 321] AH00054: something",
            level="error",
        )
        b = fp.fingerprint_structured(
            "apache", "[client 10.0.0.2:99999] [pid 7] AH00054: something",
            level="error",
        )
        self.assertEqual(a, b)

    def test_result_is_12_hex(self):
        h = fp.fingerprint_structured("watchdog", "x", type_="php")
        self.assertEqual(len(h), 12)
        int(h, 16)

    def test_unknown_source_falls_through(self):
        h = fp.fingerprint_structured("custom", "anything")
        self.assertEqual(len(h), 12)


class TestIsNoise(unittest.TestCase):
    """Coverage for sprint-etd — the is_noise() helper used by watchers
    when `DROVER_NOISE_FILTER=1` is set on a low-trust DDEV environment.
    Patterns mirror those documented in triage-procedure.md Step 3."""

    # --- real errors that must always pass through (never treated as noise) ---

    def test_php_fatal_is_not_noise(self):
        self.assertFalse(fp.is_noise("PHP Fatal error: Uncaught TypeError in /module.php on line 42"))

    def test_php_warning_in_custom_module_is_not_noise(self):
        self.assertFalse(fp.is_noise(
            "PHP Warning: Undefined variable in /var/www/web/modules/custom/foo/foo.module on line 10"
        ))

    def test_watchdog_error_is_not_noise(self):
        self.assertFalse(fp.is_noise(
            "Mon 2026/04/14 | php | Exception: cannot load entity in EntityManager.php"
        ))

    # --- documented noise patterns ---

    def test_guzzle_missing_file_is_noise(self):
        self.assertTrue(fp.is_noise(
            "GuzzleHttp\\Exception\\ConnectException 404 for /sites/default/files/photo.jpg"
        ))

    def test_file_get_contents_missing_file_is_noise(self):
        self.assertTrue(fp.is_noise(
            "PHP Warning: file_get_contents(/sites/default/files/missing.pdf): Failed to open stream"
        ))

    def test_memcache_refused_is_noise(self):
        self.assertTrue(fp.is_noise(
            "MemcachedException: Connection refused to memcache host"
        ))

    def test_redis_refused_is_noise(self):
        self.assertTrue(fp.is_noise(
            "RedisException: connect failed to redis on localhost:6379"
        ))

    def test_solr_refused_is_noise(self):
        self.assertTrue(fp.is_noise(
            "Solr HTTP 503 — ECONNREFUSED to solr on localhost:8983"
        ))

    def test_drupal_core_notice_is_noise(self):
        self.assertTrue(fp.is_noise(
            "Notice: Undefined index in core/lib/Drupal/Core/Entity/EntityForm.php on line 120"
        ))

    def test_wp_uploads_404_is_noise(self):
        self.assertTrue(fp.is_noise(
            "PHP Warning: file_get_contents(/wp-content/uploads/2025/05/missing.jpg): Failed to open stream"
        ))

    # --- boundary cases ---

    def test_refused_in_non_cache_context_is_not_noise(self):
        # "Connection refused" NOT against known-noise backends is a real error.
        self.assertFalse(fp.is_noise("cURL error 7: Connection refused to api.payments.example.com"))

    def test_contrib_module_in_sites_default_files_still_noise(self):
        # /sites/default/files/ 404s are noise regardless of which contrib module triggered.
        self.assertTrue(fp.is_noise(
            "GuzzleHttp error: 404 sites/default/files/imagecache/thumb/x.jpg"
        ))


if __name__ == "__main__":
    unittest.main()
