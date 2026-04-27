"""Unit tests for drover.scripts.aggregate (slice 6)."""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import tempfile
import unittest
from datetime import date

HERE = pathlib.Path(__file__).resolve()
SCRIPTS = HERE.parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

# Load aggregate as a fresh module so monkey-patches don't leak
spec = importlib.util.spec_from_file_location(
    "drover_aggregate", SCRIPTS / "aggregate.py",
)
aggregate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aggregate)


def _make_event(*, ts=None, severity="error", channel="entity_embed",
                message="Invalid display settings encountered.",
                raw=None, fields=None):
    return {
        "ts": ts,
        "severity": severity,
        "channel": channel,
        "message": message,
        "raw": raw or "raw line",
        "fields": fields or {},
    }


class AggregateTests(unittest.TestCase):
    def test_groups_identical_messages(self):
        events = [
            _make_event(message="Invalid display settings."),
            _make_event(message="Invalid display settings."),
            _make_event(message="Invalid display settings."),
        ]
        out = aggregate.aggregate(events, "drupal-watchdog")
        self.assertEqual(out["events_total"], 3)
        self.assertEqual(len(out["groups"]), 1)
        self.assertEqual(out["groups"][0]["count"], 3)

    def test_distinct_messages_distinct_groups(self):
        events = [
            _make_event(message="Cache backend refused"),
            _make_event(message="Cache backend refused"),
            _make_event(message="Watchdog table missing"),
        ]
        out = aggregate.aggregate(events, "drupal-watchdog")
        self.assertEqual(len(out["groups"]), 2)
        self.assertEqual(out["groups"][0]["count"], 2)
        self.assertEqual(out["groups"][1]["count"], 1)

    def test_normalization_collapses_variable_uuids(self):
        # Messages differing only in UUID/IDs should fingerprint together
        # via v1's normalize() (which strips digits, hex tokens, etc.).
        msg = (
            "Invalid display settings encountered. "
            "Could not process settings for entity 'media' "
            "with the uuid \"%s\""
        )
        events = [
            _make_event(message=msg % "3dd63512-da90-4f5c-bb0a-023316876538"),
            _make_event(message=msg % "67355235-0bfe-4826-b4ce-e7381c8e98e0"),
            _make_event(message=msg % "a28d4092-8cd6-45ae-bab8-9cacaf0346f5"),
        ]
        out = aggregate.aggregate(events, "drupal-watchdog")
        self.assertEqual(len(out["groups"]), 1,
                         "uuid-only differences should collapse")
        self.assertEqual(out["groups"][0]["count"], 3)

    def test_severity_distribution(self):
        events = [
            _make_event(severity="error"),
            _make_event(severity="error"),
            _make_event(severity="warning"),
        ]
        out = aggregate.aggregate(events, "drupal-watchdog")
        self.assertEqual(out["by_severity"]["error"], 2)
        self.assertEqual(out["by_severity"]["warning"], 1)
        # majority severity on the group
        self.assertEqual(out["groups"][0]["severity"], "error")

    def test_channel_distribution(self):
        events = [
            _make_event(channel="entity_embed"),
            _make_event(channel="entity_embed"),
            _make_event(channel="simple_cron",
                        message="Cron complete in 1.2s"),
        ]
        out = aggregate.aggregate(events, "drupal-watchdog")
        self.assertEqual(out["by_channel"]["entity_embed"], 2)
        self.assertEqual(out["by_channel"]["simple_cron"], 1)

    def test_first_last_seen_set_from_ts(self):
        from datetime import datetime, timezone
        t1 = datetime(2026, 4, 3, 0, 0, 0, tzinfo=timezone.utc)
        t2 = datetime(2026, 4, 3, 23, 59, 0, tzinfo=timezone.utc)
        t_mid = datetime(2026, 4, 3, 12, 0, 0, tzinfo=timezone.utc)
        events = [
            _make_event(ts=t_mid),
            _make_event(ts=t1),
            _make_event(ts=t2),
        ]
        out = aggregate.aggregate(events, "drupal-watchdog")
        g = out["groups"][0]
        self.assertEqual(g["first_seen"], t1.isoformat())
        self.assertEqual(g["last_seen"], t2.isoformat())

    def test_samples_capped(self):
        events = [_make_event(raw=f"line {i}") for i in range(10)]
        out = aggregate.aggregate(events, "drupal-watchdog")
        self.assertEqual(
            len(out["groups"][0]["samples"]),
            aggregate.SAMPLE_LINES_PER_GROUP,
        )

    def test_groups_sorted_by_count_desc(self):
        events = (
            [_make_event(message="rare")] +
            [_make_event(message="medium")] * 5 +
            [_make_event(message="common")] * 100
        )
        out = aggregate.aggregate(events, "drupal-watchdog")
        counts = [g["count"] for g in out["groups"]]
        self.assertEqual(counts, sorted(counts, reverse=True))

    def test_php_event_uses_php_namespace(self):
        out_w = aggregate.aggregate(
            [_make_event(message="Same exact message")],
            "drupal-watchdog",
        )
        out_p = aggregate.aggregate(
            [_make_event(message="Same exact message",
                         channel="php",
                         fields={"php_level": "Fatal error"})],
            "php-error",
        )
        # Same message under different sources => different fingerprints
        self.assertNotEqual(
            out_w["groups"][0]["fingerprint"],
            out_p["groups"][0]["fingerprint"],
        )


# --- File walker ----------------------------------------------------------

class AggregateFilesTests(unittest.TestCase):
    def test_walks_canonical_layout(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            day_dir = root / "2026" / "04"
            day_dir.mkdir(parents=True)
            # Plant one drupal-watchdog file with 2 events
            (day_dir / "2026-04-03.prod.drupal-watchdog.log").write_text(
                "Apr  3 00:00:00 host pncb: "
                "https://x.org|1|cron|||/cron|0||Cron run completed\n"
                "Apr  3 12:00:00 host pncb: "
                "https://x.org|1|access denied|1.2.3.4|/admin|0||"
                "Access denied for /admin\n"
            )
            agg = aggregate.aggregate_files(
                root, env="prod", types=["drupal-watchdog"],
                from_date=date(2026, 4, 3), to_date=date(2026, 4, 3),
            )
            self.assertEqual(agg["events_total"], 2)
            self.assertEqual(agg["metadata"]["files_read"], 1)
            self.assertEqual(agg["metadata"]["files_missing"], 0)
            self.assertEqual(len(agg["groups"]), 2)

    def test_missing_files_counted(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            agg = aggregate.aggregate_files(
                root, env="prod", types=["drupal-watchdog"],
                from_date=date(2026, 4, 1), to_date=date(2026, 4, 3),
            )
            self.assertEqual(agg["events_total"], 0)
            self.assertEqual(agg["metadata"]["files_read"], 0)
            self.assertEqual(agg["metadata"]["files_missing"], 3)


# --- MoM delta ------------------------------------------------------------

class DeltaTests(unittest.TestCase):
    def test_delta_marks_new_groups(self):
        from datetime import datetime, timezone
        t = datetime(2026, 4, 3, 0, 0, 0, tzinfo=timezone.utc).isoformat()

        prior = {
            "groups": [
                {"fingerprint": "fp-stable", "count": 100,
                 "severity": "error", "channel": "x",
                 "summary": "stable issue",
                 "samples": [], "severities": {"error": 100},
                 "first_seen": t, "last_seen": t, "days": {}},
                {"fingerprint": "fp-vanished", "count": 50,
                 "severity": "warning", "channel": "y",
                 "summary": "old issue",
                 "samples": [], "severities": {"warning": 50},
                 "first_seen": t, "last_seen": t, "days": {}},
            ],
        }
        current = {
            "groups": [
                {"fingerprint": "fp-stable", "count": 130,
                 "severity": "error", "channel": "x",
                 "summary": "stable issue",
                 "samples": [], "severities": {"error": 130},
                 "first_seen": t, "last_seen": t, "days": {}},
                {"fingerprint": "fp-new", "count": 20,
                 "severity": "critical", "channel": "z",
                 "summary": "new issue",
                 "samples": [], "severities": {"critical": 20},
                 "first_seen": t, "last_seen": t, "days": {}},
            ],
        }
        out = aggregate.delta(current, prior)
        by_fp = {g["fingerprint"]: g for g in out["groups"]}
        self.assertEqual(by_fp["fp-stable"]["delta"]["prior_count"], 100)
        self.assertEqual(by_fp["fp-stable"]["delta"]["delta_count"], 30)
        self.assertEqual(by_fp["fp-stable"]["delta"]["delta_pct"], 30.0)
        self.assertFalse(by_fp["fp-stable"]["delta"]["is_new"])
        self.assertTrue(by_fp["fp-new"]["delta"]["is_new"])
        self.assertIsNone(by_fp["fp-new"]["delta"]["delta_pct"])
        # Disappeared list
        self.assertEqual(len(out["disappeared_from_prior"]), 1)
        self.assertEqual(out["disappeared_from_prior"][0]["fingerprint"],
                         "fp-vanished")

    def test_delta_with_no_prior_passes_through(self):
        current = {"groups": [], "events_total": 0}
        self.assertIs(aggregate.delta(current, None), current)


# --- Live PNCB sanity check -----------------------------------------------

class LiveAggregateTests(unittest.TestCase):
    def test_pncb_april_3_aggregation(self):
        from pathlib import Path as _P
        live = _P("/tmp/drover-slice2-e2e")
        if not (live / "2026" / "04" /
                "2026-04-03.prod.drupal-watchdog.log").exists():
            self.skipTest("recon log not present")
        agg = aggregate.aggregate_files(
            live, env="prod", types=["drupal-watchdog"],
            from_date=date(2026, 4, 3), to_date=date(2026, 4, 3),
        )
        # Group count should be substantially smaller than event count
        # thanks to fingerprint normalization (uuids/IDs collapsed).
        # Empirically PNCB April-3 watchdog goes 2964 events -> ~380
        # groups (7-8x compression).
        self.assertGreater(agg["events_total"], 2000)
        self.assertLess(
            len(agg["groups"]),
            agg["events_total"] // 4,
            "expected at least 4x event-to-group compression",
        )
        # Top group should account for a large chunk of total events.
        top = agg["groups"][0]
        self.assertGreater(top["count"], 100)


if __name__ == "__main__":
    unittest.main()
