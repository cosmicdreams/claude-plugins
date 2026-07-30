"""Unit tests for drover.pull (slice 2).

Covers path conventions, coverage ledger I/O, the atomic gunzip writer,
and the pull_one orchestrator with a mocked AcquiaClient. Live-API
end-to-end coverage is out of scope here — see /tmp/verify-slice-1.py
or the slice-2 integration recon for that.
"""
from __future__ import annotations

import gzip
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
import urllib.request
from datetime import date, datetime, timedelta, timezone
from unittest import mock

HERE = pathlib.Path(__file__).resolve()
PULL_PATH = HERE.parents[2] / "scripts" / "pull.py"


def load_pull():
    spec = importlib.util.spec_from_file_location("drover_pull", PULL_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pull = load_pull()


class CanonicalPathTests(unittest.TestCase):
    def test_path_shape(self):
        root = pathlib.Path("/x/proj")
        p = pull.canonical_path(
            root, date(2026, 4, 3), "prod", "drupal-watchdog",
        )
        self.assertEqual(
            p,
            pathlib.Path(
                "/x/proj/2026/04/2026-04-03.prod.drupal-watchdog.log.gz"
            ),
        )

    def test_zero_padded_month(self):
        p = pull.canonical_path(
            pathlib.Path("/x"), date(2026, 1, 5), "stage", "php-error",
        )
        self.assertIn("/2026/01/", str(p))


class CoverageLedgerTests(unittest.TestCase):
    def test_round_trip(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            cov = pull.load_coverage(root)
            self.assertEqual(cov, {})

            pull.mark_coverage(
                cov, date(2026, 4, 3), "prod", "drupal-watchdog",
                state="present", bytes=12345,
            )
            pull.save_coverage(root, cov)

            cov2 = pull.load_coverage(root)
            entry = cov2["2026-04-03"]["prod.drupal-watchdog"]
            self.assertEqual(entry["state"], "present")
            self.assertEqual(entry["bytes"], 12345)
            self.assertIn("updated_at", entry)

    def test_mark_overwrites_same_key(self):
        cov = {}
        pull.mark_coverage(
            cov, date(2026, 4, 3), "prod", "x",
            state="fetch-failed", reason="timeout",
        )
        pull.mark_coverage(
            cov, date(2026, 4, 3), "prod", "x",
            state="present", bytes=99,
        )
        self.assertEqual(cov["2026-04-03"]["prod.x"]["state"], "present")
        self.assertEqual(cov["2026-04-03"]["prod.x"]["bytes"], 99)
        self.assertNotIn("reason", cov["2026-04-03"]["prod.x"])

    def test_save_is_atomic(self):
        """The .tmp file is renamed into place; on partial-write the
        canonical path stays untouched."""
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            (root / ".drover").mkdir()
            target = root / ".drover" / "coverage.json"
            target.write_text(json.dumps({"existing": True}))

            cov = {"replaced": True}
            pull.save_coverage(root, cov)

            self.assertEqual(json.load(open(target)), {"replaced": True})
            # No leftover tmp file
            tmp = target.with_suffix(".tmp")
            self.assertFalse(tmp.exists())


class FilePresentTests(unittest.TestCase):
    def test_missing_returns_false(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertFalse(
                pull.file_present_and_complete(
                    pathlib.Path(td) / "nope.log"
                )
            )

    def test_empty_returns_false(self):
        with tempfile.TemporaryDirectory() as td:
            p = pathlib.Path(td) / "empty.log"
            p.touch()
            self.assertFalse(pull.file_present_and_complete(p))

    def test_nonempty_returns_true(self):
        with tempfile.TemporaryDirectory() as td:
            p = pathlib.Path(td) / "ok.log"
            p.write_text("data")
            self.assertTrue(pull.file_present_and_complete(p))


class DownloadAtomicTests(unittest.TestCase):
    def test_stores_gzipped_bytes(self):
        with tempfile.TemporaryDirectory() as td:
            payload = b"hello world\n" * 100
            gz_src = pathlib.Path(td) / "src.gz"
            with gzip.open(gz_src, "wb") as fh:
                fh.write(payload)
            expected_gz = gz_src.read_bytes()

            dest = pathlib.Path(td) / "out" / "stored.log.gz"
            gz_size = pull.download_atomic(f"file://{gz_src}", dest)

            self.assertEqual(gz_size, len(expected_gz))
            self.assertEqual(dest.read_bytes(), expected_gz)
            stragglers = [
                p for p in dest.parent.iterdir()
                if p.name.startswith(".drover-pull-")
            ]
            self.assertEqual(stragglers, [])

    def test_failure_leaves_dest_untouched(self):
        with tempfile.TemporaryDirectory() as td:
            dest = pathlib.Path(td) / "dest.log.gz"
            with self.assertRaises(Exception):
                pull.download_atomic(
                    "file:///nonexistent/path/that/does/not/exist.gz",
                    dest,
                )
            self.assertFalse(dest.exists())


class PullOneTests(unittest.TestCase):
    def _build_client(self, *, completed_after: int = 1, payload: bytes | None = None):
        """Build a stand-in AcquiaClient that supports the 3-step flow."""
        if payload is None:
            payload = b"Apr  3 00:00:00 sample log line\n" * 5
        gz = io.BytesIO()
        with gzip.GzipFile(fileobj=gz, mode="wb") as gzf:
            gzf.write(payload)
        gz_bytes = gz.getvalue()

        client = mock.MagicMock()
        client.request_log_download.return_value = {
            "_links": {
                "notification": {"href": "https://example/notif/abc"},
            },
        }
        statuses = (["in-progress"] * (completed_after - 1)) + ["completed"]
        client.check_log_download.side_effect = [
            {"status": s} for s in statuses
        ]
        return client, gz_bytes, payload

    def _patch_url_open(self, gz_bytes: bytes):
        """Replace urllib.request.urlretrieve with a function that drops
        gz_bytes at the destination, ignoring the URL."""
        def fake_urlretrieve(url, dest):
            with open(dest, "wb") as fh:
                fh.write(gz_bytes)
            return dest, None
        return mock.patch.object(
            pull.urllib.request, "urlretrieve", side_effect=fake_urlretrieve,
        )

    def test_short_circuits_when_file_present(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            day = date(2026, 4, 3)
            local = pull.canonical_path(root, day, "prod", "drupal-watchdog")
            local.parent.mkdir(parents=True)
            local.write_text("already here\n")

            client = mock.MagicMock()
            result = pull.pull_one(
                client, "env-id", "prod", "drupal-watchdog", day, root,
            )
            self.assertEqual(result["state"], "present")
            self.assertGreater(result["bytes"], 0)
            self.assertFalse(result["fetched"])
            client.request_log_download.assert_not_called()

    def test_full_flow_writes_canonical_file(self):
        client, gz_bytes, payload = self._build_client()
        client.get_log_download_url.return_value = "https://s3/whatever.gz"

        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            day = date(2026, 4, 3)
            with self._patch_url_open(gz_bytes):
                result = pull.pull_one(
                    client, "env-id", "prod", "drupal-watchdog", day, root,
                    poll_interval_s=0,
                )
            self.assertEqual(result["state"], "present")
            self.assertGreater(result["bytes"], 0)
            self.assertTrue(result["fetched"])
            self.assertIn("notification_uuid", result)

            local = pull.canonical_path(
                root, day, "prod", "drupal-watchdog",
            )
            self.assertTrue(local.exists())
            self.assertEqual(local.read_bytes(), gz_bytes)
            client.request_log_download.assert_called_once_with(
                "env-id", "drupal-watchdog",
                from_iso="2026-04-03T00:00:00+00:00",
                to_iso="2026-04-03T23:59:59+00:00",
            )

    def test_failed_notification_raises_pull_error(self):
        client = mock.MagicMock()
        client.request_log_download.return_value = {
            "_links": {"notification": {"href": "https://x/n"}},
        }
        client.check_log_download.return_value = {"status": "failed"}

        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            with self.assertRaises(pull.PullError):
                pull.pull_one(
                    client, "env-id", "prod", "drupal-watchdog",
                    date(2026, 4, 3), root, poll_interval_s=0,
                )

    def test_missing_notification_url_raises_pull_error(self):
        client = mock.MagicMock()
        client.request_log_download.return_value = {"_links": {}}

        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            with self.assertRaises(pull.PullError):
                pull.pull_one(
                    client, "env-id", "prod", "drupal-watchdog",
                    date(2026, 4, 3), root, poll_interval_s=0,
                )


class DateRangeTests(unittest.TestCase):
    def test_single_day(self):
        d = date(2026, 4, 3)
        self.assertEqual(pull.date_range(d, d), [d])

    def test_three_days(self):
        r = pull.date_range(date(2026, 4, 1), date(2026, 4, 3))
        self.assertEqual(
            r,
            [date(2026, 4, 1), date(2026, 4, 2), date(2026, 4, 3)],
        )

    def test_inverted_returns_empty(self):
        r = pull.date_range(date(2026, 4, 3), date(2026, 4, 1))
        self.assertEqual(r, [])

    def test_month_crossing(self):
        r = pull.date_range(date(2026, 3, 30), date(2026, 4, 2))
        self.assertEqual(len(r), 4)


class ResolveTargetEnvsTests(unittest.TestCase):
    def setUp(self):
        self.manifest = {"acquia": {"envs": [
            {"name": "dev", "env_id": "1"},
            {"name": "prod", "env_id": "2"},
        ]}}

    def test_named(self):
        envs = pull.resolve_target_envs(self.manifest, "prod")
        self.assertEqual(len(envs), 1)
        self.assertEqual(envs[0]["name"], "prod")

    def test_all(self):
        envs = pull.resolve_target_envs(self.manifest, "all")
        self.assertEqual(len(envs), 2)

    def test_missing_lists_available(self):
        with self.assertRaises(ValueError) as ctx:
            pull.resolve_target_envs(self.manifest, "stage")
        self.assertIn("dev", str(ctx.exception))
        self.assertIn("prod", str(ctx.exception))

    def test_all_with_no_envs_raises(self):
        with self.assertRaises(ValueError):
            pull.resolve_target_envs({"acquia": {"envs": []}}, "all")


class ResolveDatesTests(unittest.TestCase):
    def _ns(self, **kw):
        defaults = dict(
            date=None, from_=None, to=None,
            daily=False, backfill=False, backfill_days=None,
        )
        defaults.update(kw)
        import argparse as _a
        return _a.Namespace(**defaults)

    def test_explicit_date(self):
        d = pull.resolve_dates(self._ns(date="2026-04-03"))
        self.assertEqual(d, [date(2026, 4, 3)])

    def test_range(self):
        d = pull.resolve_dates(self._ns(from_="2026-04-01", to="2026-04-03"))
        self.assertEqual(len(d), 3)

    def test_daily_returns_yesterday(self):
        d = pull.resolve_dates(self._ns(daily=True))
        self.assertEqual(len(d), 1)
        # Within 1 day of "yesterday" — clock-tolerant
        today = datetime.now(timezone.utc).date()
        self.assertIn(d[0], [today - timedelta(days=1), today - timedelta(days=2)])

    def test_backfill_default_30(self):
        d = pull.resolve_dates(self._ns(backfill=True))
        self.assertEqual(len(d), 30)
        # Latest day should be yesterday — never includes today
        today = datetime.now(timezone.utc).date()
        self.assertEqual(d[-1], today - timedelta(days=1))

    def test_backfill_custom_window(self):
        d = pull.resolve_dates(self._ns(backfill=True, backfill_days=7))
        self.assertEqual(len(d), 7)

    def test_zero_modes_raises(self):
        with self.assertRaises(ValueError):
            pull.resolve_dates(self._ns())

    def test_two_modes_raises(self):
        with self.assertRaises(ValueError):
            pull.resolve_dates(
                self._ns(date="2026-04-03", daily=True),
            )


class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.envs = [{
            "name": "prod",
            "env_id": "env-id",
            "types": ["drupal-watchdog", "php-error"],
        }]
        # use timedelta in tests
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_dry_run_makes_no_calls(self):
        client = mock.MagicMock()
        summary = pull.reconcile(
            client, self.root, self.envs, None,
            [date(2026, 4, 1), date(2026, 4, 2)],
            dry_run=True, rate_limit_s=0,
        )
        client.request_log_download.assert_not_called()
        # 2 days * 2 types = 4 tuples, all "would fetch"
        self.assertEqual(summary["total"], 4)
        self.assertEqual(summary["skipped"], 4)
        self.assertEqual(summary["fetched"], 0)
        # Coverage file should NOT have been written
        self.assertFalse(pull.coverage_path(self.root).exists())

    def test_dry_run_counts_present(self):
        # Pre-create one file so dry-run reports it as present
        local = pull.canonical_path(
            self.root, date(2026, 4, 1), "prod", "drupal-watchdog",
        )
        local.parent.mkdir(parents=True)
        local.write_text("data\n")

        client = mock.MagicMock()
        summary = pull.reconcile(
            client, self.root, self.envs, None,
            [date(2026, 4, 1)], dry_run=True, rate_limit_s=0,
        )
        # 1 day * 2 types = 2 tuples, 1 present + 1 skipped
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["present"], 1)
        self.assertEqual(summary["skipped"], 1)

    def test_failure_records_fetch_failed(self):
        client = mock.MagicMock()
        client.request_log_download.return_value = {
            "_links": {"notification": {"href": "https://x/n"}},
        }
        client.check_log_download.return_value = {"status": "failed"}

        summary = pull.reconcile(
            client, self.root, self.envs, ["drupal-watchdog"],
            [date(2026, 4, 1)],
            rate_limit_s=0, retries=0, poll_interval_s=0,
        )
        self.assertEqual(summary["failed"], 1)
        cov = pull.load_coverage(self.root)
        entry = cov["2026-04-01"]["prod.drupal-watchdog"]
        self.assertEqual(entry["state"], "fetch-failed")
        self.assertIn("reason", entry)

    def test_erroring_status_check_surfaces_cause(self):
        # A status check that raises on every attempt used to be swallowed
        # by `except Exception: pass`, so the day burned the full deadline
        # and reported a bare "poll deadline exceeded" with the real cause
        # discarded. The recorded reason must name the underlying error.
        client = mock.MagicMock()
        client.request_log_download.return_value = {
            "_links": {"notification": {"href": "https://x/n"}},
        }
        client.check_log_download.side_effect = ConnectionResetError(
            "connection reset by peer"
        )

        summary = pull.reconcile(
            client, self.root, self.envs, ["drupal-watchdog"],
            [date(2026, 4, 1)],
            rate_limit_s=0, retries=0, poll_interval_s=0,
            poll_deadline_s=0.05,
        )
        self.assertEqual(summary["failed"], 1)
        entry = pull.load_coverage(self.root)["2026-04-01"][
            "prod.drupal-watchdog"
        ]
        self.assertEqual(entry["state"], "fetch-failed")
        self.assertIn("ConnectionResetError", entry["reason"])
        self.assertIn("connection reset by peer", entry["reason"])

    def test_stale_status_not_reused_after_check_error(self):
        # An errored check knows nothing about the snapshot's state, so it
        # must not leave a prior "in-progress" value standing in `status`.
        client = mock.MagicMock()
        client.request_log_download.return_value = {
            "_links": {"notification": {"href": "https://x/n"}},
        }
        calls = {"n": 0}

        def one_good_then_errors(*_args, **_kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                return {"status": "in-progress"}
            raise TimeoutError("read timed out")

        client.check_log_download.side_effect = one_good_then_errors

        summary = pull.reconcile(
            client, self.root, self.envs, ["drupal-watchdog"],
            [date(2026, 4, 1)],
            rate_limit_s=0, retries=0, poll_interval_s=0,
            poll_deadline_s=0.05,
        )
        self.assertEqual(summary["failed"], 1)
        reason = pull.load_coverage(self.root)["2026-04-01"][
            "prod.drupal-watchdog"
        ]["reason"]
        self.assertIn("TimeoutError", reason)
        self.assertNotIn("in-progress", reason)

    def test_retry_succeeds_after_transient(self):
        # First attempt fails (notification status=failed),
        # second attempt succeeds (notification status=completed)
        import gzip as _gz, io as _io
        payload = b"hello\n" * 10
        gz_buf = _io.BytesIO()
        with _gz.GzipFile(fileobj=gz_buf, mode="wb") as g:
            g.write(payload)
        gz_bytes = gz_buf.getvalue()

        client = mock.MagicMock()
        client.request_log_download.return_value = {
            "_links": {"notification": {"href": "https://x/n"}},
        }
        # Sequence: failed (attempt 1), completed (attempt 2)
        client.check_log_download.side_effect = [
            {"status": "failed"},
            {"status": "completed"},
        ]
        client.get_log_download_url.return_value = "https://s3/a.gz"

        def fake_urlretrieve(url, dest):
            with open(dest, "wb") as fh:
                fh.write(gz_bytes)
        with mock.patch.object(
            pull.urllib.request, "urlretrieve", side_effect=fake_urlretrieve,
        ):
            summary = pull.reconcile(
                client, self.root, self.envs, ["drupal-watchdog"],
                [date(2026, 4, 1)],
                rate_limit_s=0, retries=1, poll_interval_s=0,
            )

        self.assertEqual(summary["fetched"], 1)
        self.assertEqual(summary["failed"], 0)
        self.assertEqual(client.request_log_download.call_count, 2)

    def test_concurrent_reconcile_success(self):
        import gzip as _gz, io as _io
        payload = b"hello\n" * 10
        gz_buf = _io.BytesIO()
        with _gz.GzipFile(fileobj=gz_buf, mode="wb") as g:
            g.write(payload)
        gz_bytes = gz_buf.getvalue()

        client = mock.MagicMock()
        client.request_log_download.return_value = {
            "_links": {"notification": {"href": "https://x/n"}},
        }
        client.check_log_download.return_value = {"status": "completed"}
        client.get_log_download_url.return_value = "https://s3/a.gz"

        def fake_urlretrieve(url, dest):
            with open(dest, "wb") as fh:
                fh.write(gz_bytes)
        with mock.patch.object(
            pull.urllib.request, "urlretrieve", side_effect=fake_urlretrieve,
        ):
            summary = pull.reconcile(
                client, self.root, self.envs, ["drupal-watchdog"],
                [date(2026, 4, 1)],
                rate_limit_s=0, retries=0, poll_interval_s=0, concurrency=2
            )

        self.assertEqual(summary["fetched"], 1)
        self.assertEqual(summary["failed"], 0)
        cov = pull.load_coverage(self.root)
        self.assertEqual(cov["2026-04-01"]["prod.drupal-watchdog"]["state"], "present")


class ParseArgsTests(unittest.TestCase):
    def test_parse_concurrency(self):
        args = pull.parse_args(["--concurrency", "8"])
        self.assertEqual(args.concurrency, 8)

    def test_parse_concurrency_default(self):
        args = pull.parse_args([])
        self.assertEqual(args.concurrency, 4)


class FindEnvTests(unittest.TestCase):
    def test_finds_named_env(self):
        manifest = {"acquia": {"envs": [
            {"name": "dev", "env_id": "1"},
            {"name": "prod", "env_id": "2"},
        ]}}
        env = pull.find_env(manifest, "prod")
        self.assertEqual(env["env_id"], "2")

    def test_unknown_env_lists_available(self):
        manifest = {"acquia": {"envs": [{"name": "prod"}]}}
        with self.assertRaises(ValueError) as ctx:
            pull.find_env(manifest, "stage")
        self.assertIn("prod", str(ctx.exception))


_MON_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _gz(payload: bytes) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as g:
        g.write(payload)
    return buf.getvalue()


def _apache_access_gz(day: date, n: int = 5) -> bytes:
    mon = _MON_ABBR[day.month - 1]
    line = (
        f"1.2.3.4 - - [{day.day:02d}/{mon}/{day.year}:00:00:01 +0000] "
        f'"GET / HTTP/1.1" 200 1\n'
    )
    return _gz(line.encode() * n)


class DominantMonthDayTests(unittest.TestCase):
    def _write(self, td, payload: bytes, name="f.log.gz"):
        p = pathlib.Path(td) / name
        p.write_bytes(_gz(payload))
        return p

    def test_apache_access(self):
        with tempfile.TemporaryDirectory() as td:
            p = self._write(
                td, b"1.2.3.4 - - [10/May/2026:00:00:01 +0000] x\n" * 3
            )
            self.assertEqual(pull.dominant_month_day(p), (5, 10))

    def test_apache_error(self):
        with tempfile.TemporaryDirectory() as td:
            p = self._write(td, b"[Tue Apr 03 00:00:33.123456 2026] [error] x\n" * 3)
            self.assertEqual(pull.dominant_month_day(p), (4, 3))

    def test_php_error(self):
        with tempfile.TemporaryDirectory() as td:
            p = self._write(td, b"[03-Apr-2026 00:00:33 UTC] PHP Warning: x\n" * 3)
            self.assertEqual(pull.dominant_month_day(p), (4, 3))

    def test_drupal_watchdog_syslog(self):
        with tempfile.TemporaryDirectory() as td:
            p = self._write(td, b"Apr  3 00:00:00 host drupal: x\n" * 3)
            self.assertEqual(pull.dominant_month_day(p), (4, 3))

    def test_unparseable_returns_none(self):
        with tempfile.TemporaryDirectory() as td:
            p = self._write(td, b"hello world\n" * 3)
            self.assertIsNone(pull.dominant_month_day(p))

    def test_dominant_beats_minority_spillover(self):
        # A few UTC-midnight spillover lines from the prior day must not win.
        payload = (
            b"1.2.3.4 - - [30/Apr/2026:23:59:59 +0000] x\n" * 2
            + b"1.2.3.4 - - [01/May/2026:00:00:01 +0000] x\n" * 100
        )
        with tempfile.TemporaryDirectory() as td:
            p = self._write(td, payload)
            self.assertEqual(pull.dominant_month_day(p), (5, 1))


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.envs = [{"name": "prod", "env_id": "env-id",
                      "types": ["apache-access"]}]

    def tearDown(self):
        self.tmp.cleanup()

    def test_stale_snapshot_rejected(self):
        """A download whose dominant date != requested day is rejected."""
        client = mock.MagicMock()
        client.request_log_download.return_value = {
            "_links": {"notification": {"href": "https://x/n"}},
        }
        client.check_log_download.return_value = {"status": "completed"}
        client.get_log_download_url.return_value = "https://s3/stale.gz"
        # Requested 2026-04-02 but Acquia hands back an 04-01 snapshot.
        stale = _apache_access_gz(date(2026, 4, 1))

        def fake_urlretrieve(url, dest):
            with open(dest, "wb") as fh:
                fh.write(stale)
        with mock.patch.object(
            pull.urllib.request, "urlretrieve", side_effect=fake_urlretrieve,
        ):
            summary = pull.reconcile(
                client, self.root, self.envs, ["apache-access"],
                [date(2026, 4, 2)],
                rate_limit_s=0, retries=0, poll_interval_s=0, concurrency=1,
            )
        self.assertEqual(summary["fetched"], 0)
        self.assertEqual(summary["failed"], 1)
        cov = pull.load_coverage(self.root)
        entry = cov["2026-04-02"]["prod.apache-access"]
        self.assertEqual(entry["state"], "fetch-failed")
        self.assertIn("snapshot-mismatch", entry["reason"])
        # The mislabeled file must NOT be left on disk.
        self.assertIsNone(
            pull.find_log_file(self.root, date(2026, 4, 2), "prod", "apache-access")
        )

    def test_serial_per_day_yields_distinct_files(self):
        """Multi-day single-type pull serializes create→download per day,
        so each day gets its own (most-recent) snapshot — distinct files."""
        days = [date(2026, 4, 1), date(2026, 4, 2), date(2026, 4, 3)]
        events = []
        holder = {"day": None}

        def req(env_id, log_type, from_iso=None, to_iso=None):
            d = date.fromisoformat(from_iso[:10])
            holder["day"] = d
            events.append(("create", d))
            return {"_links": {"notification": {"href": f"https://x/{d}"}}}

        def dl(env_id, log_type):
            events.append(("download", holder["day"]))
            return f"https://s3/{holder['day']}.gz"

        client = mock.MagicMock()
        client.request_log_download.side_effect = req
        client.check_log_download.return_value = {"status": "completed"}
        client.get_log_download_url.side_effect = dl

        def fake_urlretrieve(url, dest):
            # "most recent" snapshot == the day of the last create.
            with open(dest, "wb") as fh:
                fh.write(_apache_access_gz(holder["day"]))
        with mock.patch.object(
            pull.urllib.request, "urlretrieve", side_effect=fake_urlretrieve,
        ):
            summary = pull.reconcile(
                client, self.root, self.envs, ["apache-access"], days,
                rate_limit_s=0, retries=0, poll_interval_s=0, concurrency=4,
            )

        self.assertEqual(summary["fetched"], 3)
        self.assertEqual(summary["failed"], 0)
        # Strict alternation proves no batching of creates ahead of downloads.
        self.assertEqual(
            events,
            [("create", days[0]), ("download", days[0]),
             ("create", days[1]), ("download", days[1]),
             ("create", days[2]), ("download", days[2])],
        )
        # All three files present and byte-distinct.
        md5s = set()
        for d in days:
            f = pull.find_log_file(self.root, d, "prod", "apache-access")
            self.assertIsNotNone(f)
            md5s.add(pull.file_md5(f))
        self.assertEqual(len(md5s), 3)

    def test_duplicate_md5_rejected(self):
        """If two days come back byte-identical (the stale-snapshot bug),
        the duplicate is rejected rather than written as present."""
        client = mock.MagicMock()
        client.request_log_download.return_value = {
            "_links": {"notification": {"href": "https://x/n"}},
        }
        client.check_log_download.return_value = {"status": "completed"}
        client.get_log_download_url.return_value = "https://s3/same.gz"
        # No parseable date → date-check is inconclusive; md5 guard catches it.
        same = _gz(b"no-date payload\n" * 5)

        def fake_urlretrieve(url, dest):
            with open(dest, "wb") as fh:
                fh.write(same)
        with mock.patch.object(
            pull.urllib.request, "urlretrieve", side_effect=fake_urlretrieve,
        ):
            summary = pull.reconcile(
                client, self.root, self.envs, ["apache-access"],
                [date(2026, 4, 1), date(2026, 4, 2)],
                rate_limit_s=0, retries=0, poll_interval_s=0, concurrency=1,
            )
        self.assertEqual(summary["fetched"], 1)
        self.assertEqual(summary["failed"], 1)
        cov = pull.load_coverage(self.root)
        self.assertEqual(
            cov["2026-04-01"]["prod.apache-access"]["state"], "present"
        )
        dup = cov["2026-04-02"]["prod.apache-access"]
        self.assertEqual(dup["state"], "fetch-failed")
        self.assertIn("snapshot-mismatch", dup["reason"])


class ResolveDatesTodayExclusionTests(unittest.TestCase):
    def _ns(self, **kw):
        import argparse as _a
        defaults = dict(date=None, from_=None, to=None,
                        daily=False, backfill=False, backfill_days=None)
        defaults.update(kw)
        return _a.Namespace(**defaults)

    def test_from_to_clamps_today(self):
        today = datetime.now(timezone.utc).date()
        yesterday = today - timedelta(days=1)
        d = pull.resolve_dates(
            self._ns(from_=yesterday.isoformat(), to=today.isoformat())
        )
        self.assertEqual(d[-1], yesterday)
        self.assertNotIn(today, d)


if __name__ == "__main__":
    unittest.main()
