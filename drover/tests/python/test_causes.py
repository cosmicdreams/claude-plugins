"""Unit tests for drover.scripts.causes (slice 11.5)."""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).resolve()
SCRIPTS = HERE.parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location(
    "drover_causes", SCRIPTS / "causes.py",
)
causes = importlib.util.module_from_spec(spec)
sys.modules["drover_causes"] = causes
spec.loader.exec_module(causes)


def _g(*, summary="", channel=None, severity="unknown", samples=None):
    return {
        "summary": summary,
        "channel": channel,
        "severity": severity,
        "samples": samples or [],
    }


class DiagnoseTests(unittest.TestCase):
    def test_unknown_returns_undiagnosed(self):
        cause = causes.diagnose(_g(summary="A totally novel error nobody has seen"))
        self.assertEqual(cause.confidence, "low")
        self.assertIsNone(cause.pattern_id)
        self.assertIn("Undiagnosed", cause.title)

    # --- Drupal patterns -------------------------------------------------

    def test_entity_embed_missing_display(self):
        cause = causes.diagnose(_g(
            summary='Invalid display settings encountered. '
                    'Could not process following settings for entity '
                    'type "media" with the uuid "abc"',
            channel="entity_embed",
        ))
        self.assertEqual(
            cause.pattern_id, "drupal-entity-embed-missing-display",
        )
        self.assertEqual(cause.confidence, "high")
        self.assertIn("display", cause.title.lower())

    def test_database_syntax_error(self):
        cause = causes.diagnose(_g(
            summary='Drupal\\Core\\Database\\DatabaseExceptionWrapper: '
                    'SQLSTATE[42000]: Syntax error or access violation: '
                    '1064 You have an error in your SQL syntax',
            channel="simple_cron",
        ))
        self.assertEqual(
            cause.pattern_id, "drupal-database-syntax-error",
        )
        self.assertIn("MySQL", cause.explanation)

    def test_database_missing_table(self):
        cause = causes.diagnose(_g(
            summary='SQLSTATE[42S02]: Base table or view not found',
        ))
        self.assertEqual(
            cause.pattern_id, "drupal-database-missing-table",
        )

    def test_database_connection_refused(self):
        cause = causes.diagnose(_g(
            summary='SQLSTATE[HY000] [2002] Connection refused',
        ))
        self.assertEqual(
            cause.pattern_id, "drupal-database-connection-refused",
        )

    def test_database_server_gone_away(self):
        cause = causes.diagnose(_g(
            summary='SQLSTATE[HY000]: General error: 2006 MySQL server has gone away',
        ))
        self.assertEqual(
            cause.pattern_id, "drupal-database-connection-refused",
        )

    def test_acquia_solr_flood(self):
        cause = causes.diagnose(_g(
            summary='Solr endpoint unreachable or returned unexpected '
                    'response code (code: 429, body: Flood protection '
                    'has blocked this Solr request)',
            channel="search_api",
        ))
        self.assertEqual(
            cause.pattern_id, "acquia-solr-flood-protection",
        )

    def test_login_attempt_failed(self):
        cause = causes.diagnose(_g(
            summary='Login attempt failed from 138.199.33.239.',
            channel="user",
        ))
        self.assertEqual(
            cause.pattern_id, "drupal-login-attempt-failed",
        )
        self.assertIn("credential", cause.title.lower())

    def test_access_denied(self):
        cause = causes.diagnose(_g(
            summary='Path: /admin. Drupal\\Core\\Http\\Exception\\'
                    'CacheableAccessDeniedHttpException',
            channel="access denied",
        ))
        self.assertEqual(cause.pattern_id, "drupal-access-denied")

    def test_cron_rerun_attempt(self):
        cause = causes.diagnose(_g(
            summary='Attempting to re-run The File Replace module cron '
                    'cron while it is already running',
            channel="simple_cron",
        ))
        self.assertEqual(
            cause.pattern_id, "drupal-cron-rerun-attempt",
        )

    def test_php_memory_exhausted(self):
        cause = causes.diagnose(_g(
            summary='PHP Fatal error:  Allowed memory size of 268435456 '
                    'bytes exhausted (tried to allocate 32 bytes)',
        ))
        self.assertEqual(
            cause.pattern_id, "php-memory-exhausted",
        )

    def test_php_timeout(self):
        cause = causes.diagnose(_g(
            summary='Maximum execution time of 30 seconds exceeded',
        ))
        self.assertEqual(
            cause.pattern_id, "php-timeout-exceeded",
        )

    def test_route_not_found(self):
        cause = causes.diagnose(_g(
            summary='Symfony\\Component\\Routing\\Exception\\'
                    'RouteNotFoundException: No route found for "/foo"',
        ))
        self.assertEqual(
            cause.pattern_id, "drupal-route-not-found",
        )

    def test_cache_backend_unavailable(self):
        cause = causes.diagnose(_g(
            summary='Cache backend "default" was unavailable',
        ))
        self.assertEqual(
            cause.pattern_id, "drupal-cache-backend-unavailable",
        )

    def test_php_uncaught_exception(self):
        cause = causes.diagnose(_g(
            summary='PHP Fatal error: Uncaught TypeError in /var/x.php on line 7',
        ))
        self.assertEqual(
            cause.pattern_id, "php-fatal-uncaught-exception",
        )

    def test_apache_child_process_died(self):
        cause = causes.diagnose(_g(
            summary='AH00045: child process 12345 still did not exit, '
                    'sending a SIGTERM',
        ))
        self.assertEqual(
            cause.pattern_id, "apache-child-process-died",
        )

    # --- Channel constraints ---------------------------------------------

    def test_channel_constraint_filters_pattern(self):
        # entity_embed pattern requires channel=entity_embed; same
        # message on a different channel shouldn't match.
        cause = causes.diagnose(_g(
            summary='Invalid display settings encountered',
            channel="something_else",
        ))
        self.assertNotEqual(
            cause.pattern_id, "drupal-entity-embed-missing-display",
        )

    # --- Renderer --------------------------------------------------------

    def test_to_markdown_includes_all_fields(self):
        cause = causes.Cause(
            title="Title",
            explanation="Explanation goes here.",
            suggested_fix="Do X.",
            confidence="medium",
            pattern_id="x",
        )
        md = cause.to_markdown()
        self.assertIn("Likely cause", md)
        self.assertIn("Title", md)
        self.assertIn("Explanation", md)
        self.assertIn("Do X", md)
        self.assertIn("medium", md)


if __name__ == "__main__":
    unittest.main()
