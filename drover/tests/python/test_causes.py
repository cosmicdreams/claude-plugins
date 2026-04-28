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

    def test_cron_routine_startup_logs(self):
        cause = causes.diagnose(_g(
            summary='Starting execution of cron job cron.acquia_connector. '
                    'request_id="v-f03d1200-2d5e-11f1-8bd3-e3de4dc33db3"',
            channel="simple_cron",
        ))
        self.assertEqual(
            cause.pattern_id, "drupal-cron-routine-instrumentation",
        )

    def test_cron_routine_run_completed(self):
        cause = causes.diagnose(_g(
            summary='Cron run completed in 0.082s',
            channel="simple_cron",
        ))
        self.assertEqual(
            cause.pattern_id, "drupal-cron-routine-instrumentation",
        )

    def test_cron_routine_execution_took(self):
        # The other half of the routine pair — duration log emitted
        # AFTER each cron job completes.
        cause = causes.diagnose(_g(
            summary='Execution of cron job cron.node took 0.02ms. '
                    'request_id="v-2994357a-2db3-11f1-82a3-13a86d5cf5c9"',
            channel="simple_cron",
        ))
        self.assertEqual(
            cause.pattern_id, "drupal-cron-routine-instrumentation",
        )

    def test_cron_rerun_takes_precedence_over_routine(self):
        # The rerun-attempt pattern is listed first in PATTERNS so it
        # wins for the lock-contention message even though both
        # patterns target the simple_cron channel.
        cause = causes.diagnose(_g(
            summary='Attempting to re-run The Search API module cron '
                    'while it is already running',
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


class CollapseByCauseTests(unittest.TestCase):
    def _fp_group(self, fp, count, channel, summary, **kw):
        return {
            "fingerprint": fp,
            "channel": channel,
            "severity": kw.get("severity", "unknown"),
            "count": count,
            "summary": summary,
            "samples": kw.get("samples", []),
            "severities": kw.get("severities", {kw.get("severity", "unknown"): count}),
            "first_seen": kw.get("first_seen", "2026-04-01T00:00:00+00:00"),
            "last_seen": kw.get("last_seen", "2026-04-30T00:00:00+00:00"),
            "days": kw.get("days", {}),
        }

    def test_pncb_solr_dual_logging_collapses(self):
        """The exact PNCB pattern: same flood-protection error logged
        twice through search_api and acquia_search channels. Must
        collapse to one synthetic group."""
        groups = [
            self._fp_group(
                "fp-search-api", 883, "search_api",
                "Solr endpoint unreachable code: 429 body: Flood protection has blocked this Solr request",
            ),
            self._fp_group(
                "fp-acquia-search", 883, "acquia_search",
                "Flood protection has blocked this Solr request",
            ),
        ]
        out = causes.collapse_by_cause(groups)
        self.assertEqual(len(out), 1)
        merged = out[0]
        self.assertEqual(merged["count"], 1766)
        self.assertEqual(merged["member_count"], 2)
        self.assertEqual(
            sorted(merged["channels"]),
            ["acquia_search", "search_api"],
        )
        self.assertEqual(
            merged["cause_pattern_id"], "acquia-solr-flood-protection",
        )
        # Primary fingerprint is the highest-count member (tied -> first).
        self.assertEqual(
            sorted(merged["member_fingerprints"]),
            ["fp-acquia-search", "fp-search-api"],
        )

    def test_distinct_causes_do_not_collapse(self):
        groups = [
            self._fp_group(
                "fp-1", 100, "user",
                "Login attempt failed from 1.2.3.4",
            ),
            self._fp_group(
                "fp-2", 50, "simple_cron",
                "SQLSTATE[42000]: Syntax error",
            ),
        ]
        out = causes.collapse_by_cause(groups)
        self.assertEqual(len(out), 2)
        self.assertEqual({g["count"] for g in out}, {100, 50})

    def test_undiagnosed_groups_pass_through_uncollapsed(self):
        """Two unknown errors should NOT be merged together — we never
        conflate "we don't know" cases."""
        groups = [
            self._fp_group("fp-a", 100, "weird1", "Something opaque"),
            self._fp_group("fp-b", 50, "weird2", "Another opaque thing"),
        ]
        out = causes.collapse_by_cause(groups)
        self.assertEqual(len(out), 2)
        for g in out:
            self.assertIsNone(g["cause_pattern_id"])
            self.assertEqual(g["member_count"], 1)

    def test_first_last_seen_merged_correctly(self):
        groups = [
            self._fp_group(
                "fp-1", 50, "search_api",
                "Flood protection has blocked this Solr request",
                first_seen="2026-04-15T00:00:00+00:00",
                last_seen="2026-04-15T23:00:00+00:00",
            ),
            self._fp_group(
                "fp-2", 50, "acquia_search",
                "Flood protection has blocked this Solr request",
                first_seen="2026-04-01T00:00:00+00:00",
                last_seen="2026-04-30T00:00:00+00:00",
            ),
        ]
        out = causes.collapse_by_cause(groups)
        self.assertEqual(len(out), 1)
        self.assertEqual(
            out[0]["first_seen"], "2026-04-01T00:00:00+00:00",
        )
        self.assertEqual(
            out[0]["last_seen"], "2026-04-30T00:00:00+00:00",
        )

    def test_severities_merged(self):
        groups = [
            self._fp_group(
                "fp-1", 100, "search_api",
                "Flood protection has blocked this Solr request",
                severities={"error": 100},
            ),
            self._fp_group(
                "fp-2", 50, "acquia_search",
                "Flood protection has blocked this Solr request",
                severities={"warning": 50},
            ),
        ]
        out = causes.collapse_by_cause(groups)
        self.assertEqual(len(out), 1)
        merged_sev = out[0]["severities"]
        self.assertEqual(merged_sev["error"], 100)
        self.assertEqual(merged_sev["warning"], 50)
        # Majority wins
        self.assertEqual(out[0]["severity"], "error")

    def test_output_sorted_by_count_desc(self):
        # Build several pairs with different combined counts
        groups = [
            self._fp_group("a", 50, "user",
                           "Login attempt failed from 1.2.3.4"),
            self._fp_group("b", 100, "user",
                           "Login attempt failed from 5.6.7.8"),
            self._fp_group("c", 200, "simple_cron",
                           "SQLSTATE[42000]: Syntax error"),
        ]
        out = causes.collapse_by_cause(groups)
        counts = [g["count"] for g in out]
        self.assertEqual(counts, sorted(counts, reverse=True))


if __name__ == "__main__":
    unittest.main()
