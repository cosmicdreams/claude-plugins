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
from datetime import date, timezone
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
                "/x/proj/2026/04/2026-04-03.prod.drupal-watchdog.log"
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


class DownloadAtomicGunzipTests(unittest.TestCase):
    def test_gunzip_writes_decoded_bytes(self):
        with tempfile.TemporaryDirectory() as td:
            # Create a fake gzipped payload available via a file:// URL
            payload = b"hello world\n" * 100
            gz_src = pathlib.Path(td) / "src.gz"
            with gzip.open(gz_src, "wb") as fh:
                fh.write(payload)

            dest = pathlib.Path(td) / "out" / "decoded.log"
            gz_size, decoded = pull.download_atomic_gunzip(
                f"file://{gz_src}", dest,
            )

            self.assertGreater(gz_size, 0)
            self.assertEqual(decoded, len(payload))
            self.assertEqual(dest.read_bytes(), payload)
            # No leftover staging files
            stragglers = [
                p for p in dest.parent.iterdir()
                if p.name.startswith(".drover-pull-")
                or p.name.endswith(".tmp")
            ]
            self.assertEqual(stragglers, [])

    def test_failure_leaves_dest_untouched(self):
        with tempfile.TemporaryDirectory() as td:
            dest = pathlib.Path(td) / "dest.log"
            with self.assertRaises(Exception):
                pull.download_atomic_gunzip(
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
            self.assertEqual(result["bytes"], len(payload))
            self.assertTrue(result["fetched"])
            self.assertIn("notification_uuid", result)
            self.assertIn("gz_bytes", result)

            local = pull.canonical_path(
                root, day, "prod", "drupal-watchdog",
            )
            self.assertTrue(local.exists())
            self.assertEqual(local.read_bytes(), payload)
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


if __name__ == "__main__":
    unittest.main()
