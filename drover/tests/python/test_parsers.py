"""Unit tests for drover.scripts.parsers (slice 5).

Each parser runs against representative log samples drawn from the
PNCB prod April-3rd recon (drupal-watchdog) and from the canonical
Apache 2.4 / PHP error-log formats described in the docs. We don't
hit the network here.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest
from datetime import date

HERE = pathlib.Path(__file__).resolve()
PARSERS_PKG = HERE.parents[2] / "scripts" / "parsers"


def _load_pkg():
    """Import the parsers package without polluting sys.modules names
    that the rest of the suite might use."""
    pkg_init = PARSERS_PKG / "__init__.py"
    sys.path.insert(0, str(PARSERS_PKG.parent))  # so 'parsers' is top-level
    spec = importlib.util.spec_from_file_location(
        "drover_parsers", pkg_init,
        submodule_search_locations=[str(PARSERS_PKG)],
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["drover_parsers"] = mod
    # Give the relative imports inside the parsers a stable parent name.
    sys.modules["parsers"] = importlib.import_module("parsers")
    spec.loader.exec_module(mod)
    return mod


# Simpler load: import as a normal package via sys.path
sys.path.insert(0, str(PARSERS_PKG.parent))
import parsers  # noqa: E402
from parsers import (  # noqa: E402
    apache_error, drupal_watchdog, php_error,
)
from parsers.common import normalize_severity, parse_syslog_ts  # noqa: E402


# --- Common helpers -------------------------------------------------------

class CommonTests(unittest.TestCase):
    def test_severity_normalization(self):
        self.assertEqual(normalize_severity("Error"), "error")
        self.assertEqual(normalize_severity("WARNING"), "warning")
        self.assertEqual(normalize_severity("emergency"), "critical")
        self.assertEqual(normalize_severity("debug"), "info")
        self.assertEqual(normalize_severity(None), "unknown")
        self.assertEqual(normalize_severity("nonsense"), "unknown")

    def test_syslog_ts_uses_day_hint_year(self):
        ts = parse_syslog_ts("Apr  3 00:00:33", day_hint=date(2026, 4, 3))
        self.assertEqual(ts.year, 2026)
        self.assertEqual(ts.month, 4)
        self.assertEqual(ts.day, 3)

    def test_syslog_ts_invalid_returns_none(self):
        self.assertIsNone(parse_syslog_ts("nonsense"))

    def test_dispatch_parser_for(self):
        self.assertIs(parsers.parser_for("apache-error"),
                      apache_error.parse)
        self.assertIs(parsers.parser_for("drupal-watchdog"),
                      drupal_watchdog.parse)
        self.assertIs(parsers.parser_for("php-error"),
                      php_error.parse)
        with self.assertRaises(ValueError):
            parsers.parser_for("mystery")


# --- Drupal watchdog ------------------------------------------------------

DRUPAL_SAMPLES = """\
Apr  3 00:00:33 drupal-7fc4d489c7-98l2f pncb: https://www.pncb.org|1775174433|entity_embed|57.141.0.42|https://www.pncb.org/news/x||0||Invalid display settings encountered.
Apr  3 00:14:20 drupal-7fc4d489c7-jxzlz pncb: https://www.pncb.org|1775175260|simple_cron|||/cron-key/run||0||Cron run completed in 12.3s
Apr  3 00:14:21 drupal-x pncb: https://www.pncb.org|1775175261|access denied|1.2.3.4|/admin||0||Access denied for /admin
Apr  3 00:14:22 drupal-x pncb: https://www.pncb.org|1775175262|php|10.0.0.1|/error||0||Notice: Undefined index 'foo' in /file.php on line 7
"""


class DrupalWatchdogTests(unittest.TestCase):
    def test_parses_canonical_line(self):
        events = list(drupal_watchdog.parse(
            DRUPAL_SAMPLES, day_hint=date(2026, 4, 3),
        ))
        self.assertEqual(len(events), 4)
        e0 = events[0]
        self.assertEqual(e0["channel"], "entity_embed")
        self.assertEqual(e0["message"],
                         "Invalid display settings encountered.")
        self.assertEqual(e0["fields"]["ip"], "57.141.0.42")
        self.assertEqual(e0["fields"]["host"],
                         "drupal-7fc4d489c7-98l2f")
        self.assertEqual(e0["fields"]["program"], "pncb")
        self.assertEqual(e0["ts"].year, 2026)
        self.assertEqual(e0["ts"].day, 3)

    def test_severity_inference_from_channel(self):
        events = list(drupal_watchdog.parse(
            DRUPAL_SAMPLES, day_hint=date(2026, 4, 3),
        ))
        # entity_embed -> unknown (not in HIGH_SEVERITY_CHANNELS)
        self.assertEqual(events[0]["severity"], "unknown")
        # access denied -> notice
        self.assertEqual(events[2]["channel"], "access denied")
        self.assertEqual(events[2]["severity"], "notice")
        # php channel -> error
        self.assertEqual(events[3]["channel"], "php")
        self.assertEqual(events[3]["severity"], "error")

    def test_message_with_pipes_preserved(self):
        # Real PNCB lines often have pipes in URLs / messages
        sample = (
            "Apr  3 00:00:00 host pncb: "
            "https://x.org|1|t|ip|/req||0||"
            "Hello | with | pipes | inside\n"
        )
        events = list(drupal_watchdog.parse(
            sample, day_hint=date(2026, 4, 3),
        ))
        self.assertEqual(events[0]["message"],
                         "Hello | with | pipes | inside")

    def test_unparseable_line_yields_degraded_event(self):
        events = list(drupal_watchdog.parse(
            "completely malformed line\n",
            day_hint=date(2026, 4, 3),
        ))
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["fields"]["parse_error"],
                         "no_header_match")
        self.assertEqual(events[0]["raw"],
                         "completely malformed line")

    def test_continuation_lines_fold_into_prior_event(self):
        # Real PNCB pattern: SQL error message spans physical lines
        text = (
            "Apr  3 00:00:00 host pncb: "
            "https://x.org|1|database|||/path||0||SQL error: "
            "SELECT 'fm.fid' FROM\n"
            "\"file_managed\" WHERE x = 1\n"
            "ORDER BY fid\n"
            "Apr  3 00:00:01 host pncb: "
            "https://x.org|1|simple_cron|||/cron|0||Cron run completed\n"
        )
        events = list(drupal_watchdog.parse(
            text, day_hint=date(2026, 4, 3),
        ))
        self.assertEqual(len(events), 2)
        first = events[0]
        self.assertEqual(first["channel"], "database")
        self.assertIn("FROM", first["message"])
        self.assertIn("file_managed", first["message"])
        self.assertIn("ORDER BY fid", first["message"])
        self.assertEqual(first["fields"]["continuation_lines"], 2)
        # Second event is unaffected
        self.assertEqual(events[1]["channel"], "simple_cron")
        self.assertEqual(events[1]["message"], "Cron run completed")


# --- Apache error ---------------------------------------------------------

APACHE_SAMPLES = """\
[Tue Apr 03 00:00:33.123456 2026] [php:error] [pid 12345] [client 1.2.3.4:55555] PHP Fatal error: Uncaught Exception thrown
[Tue Apr 03 00:01:01.000000 2026] [core:warn] [pid 99] AH00045: child process 12345 still did not exit, sending a SIGTERM
[Tue Apr 03 00:02:02 2026] [proxy:error] [pid 8888] (70008)Partial results are valid but processing is incomplete: AH01084
[Tue Apr 03 00:03:03 2026] [mpm_event:notice] [pid 1] AH00489: Apache/2.4.62 (Ubuntu) configured -- resuming normal operations
not a real apache line
"""


class ApacheErrorTests(unittest.TestCase):
    def test_canonical_php_error(self):
        events = list(apache_error.parse(APACHE_SAMPLES))
        php = events[0]
        self.assertEqual(php["severity"], "error")
        self.assertEqual(php["channel"], "php")
        self.assertEqual(php["fields"]["module"], "php")
        self.assertEqual(php["fields"]["level"], "error")
        self.assertEqual(php["fields"]["pid"], "12345")
        self.assertEqual(php["fields"]["client"], "1.2.3.4:55555")
        self.assertTrue(php["fields"]["is_php_error"])
        self.assertIn("PHP Fatal error", php["message"])

    def test_apache_core_warning_not_php(self):
        events = list(apache_error.parse(APACHE_SAMPLES))
        core = events[1]
        self.assertEqual(core["channel"], "core")
        self.assertEqual(core["severity"], "warning")
        self.assertFalse(core["fields"]["is_php_error"])

    def test_microsecond_optional(self):
        events = list(apache_error.parse(APACHE_SAMPLES))
        # Line 3 has no .microseconds
        self.assertIsNotNone(events[2]["ts"])

    def test_unparseable_line(self):
        events = list(apache_error.parse(APACHE_SAMPLES))
        last = events[-1]
        self.assertEqual(last["fields"]["parse_error"], "no_lead_match")


# --- PHP error ------------------------------------------------------------

PHP_SAMPLES = """\
[03-Apr-2026 00:00:33 UTC] PHP Fatal error:  Uncaught TypeError in /var/www/x.php on line 7
[03-Apr-2026 00:00:33 UTC] PHP Stack trace:
[03-Apr-2026 00:00:33 UTC] PHP   1. {main}() /var/www/x.php:0
[03-Apr-2026 00:00:33 UTC] PHP   2. dosomething() /var/www/x.php:7
[03-Apr-2026 00:01:01 UTC] PHP Warning:  Undefined index in /var/www/y.php on line 3
[03-Apr-2026 00:02:02 UTC] PHP Notice:  trying access on null in /var/www/z.php on line 9
[03-Apr-2026 00:02:02 UTC] PHP Deprecated:  preg_replace() in /var/www/x.php on line 1
"""


class PhpErrorTests(unittest.TestCase):
    def test_fatal_with_stack_trace_folded(self):
        events = list(php_error.parse(PHP_SAMPLES))
        # 4 logical events: fatal + warning + notice + deprecated
        self.assertEqual(len(events), 4)
        fatal = events[0]
        self.assertEqual(fatal["severity"], "critical")
        self.assertEqual(fatal["fields"]["php_level"], "Fatal error")
        self.assertIn("stack_trace", fatal["fields"])
        self.assertEqual(len(fatal["fields"]["stack_trace"]), 2)
        # Raw text includes the continuation lines
        self.assertIn("Stack trace", fatal["raw"])
        self.assertIn("dosomething", fatal["raw"])

    def test_severity_levels(self):
        events = list(php_error.parse(PHP_SAMPLES))
        self.assertEqual(events[1]["severity"], "warning")
        self.assertEqual(events[2]["severity"], "notice")
        # Deprecated normalizes to "info" via SEVERITY_MAP
        self.assertEqual(events[3]["severity"], "info")

    def test_flat_format_no_timestamp(self):
        flat = "PHP Warning:  something happened in /file.php on line 1\n"
        events = list(php_error.parse(flat))
        self.assertEqual(len(events), 1)
        self.assertTrue(events[0]["fields"]["no_timestamp"])
        self.assertIsNone(events[0]["ts"])
        self.assertEqual(events[0]["severity"], "warning")


# --- Live drupal-watchdog file (when available) -------------------------

class LiveDrupalWatchdogTests(unittest.TestCase):
    """Sanity-check the parser against the recon file if it exists.
    Skipped on machines that haven't run the recon."""

    def test_pncb_april_3_parses(self):
        live = pathlib.Path(
            "/tmp/drover-slice2-e2e/2026/04/"
            "2026-04-03.prod.drupal-watchdog.log"
        )
        if not live.exists():
            self.skipTest("recon log not present")
        events = list(parsers.parse_file(
            live, "drupal-watchdog", day_hint=date(2026, 4, 3),
        ))
        # Expect thousands of events; every one parsed cleanly.
        self.assertGreater(len(events), 1000)
        unparsed = [e for e in events if "parse_error" in e.get("fields", {})]
        # At most a handful of malformed lines; well under 1%.
        self.assertLess(len(unparsed) / max(len(events), 1), 0.01)


if __name__ == "__main__":
    unittest.main()
