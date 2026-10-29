"""Tests for the Cloud Classic log source and pull's platform dispatch.

The server is simulated: `ssh ls` answers from a fixture folder and `rsync`
copies the requested files out of it, so the whole path from listing to the
canonical day file runs without a network.
"""
from __future__ import annotations

import gzip
import importlib.util
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from unittest import mock

HERE = pathlib.Path(__file__).resolve()
SCRIPTS = HERE.parents[2] / "scripts"


def _load(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pull = _load("drover_pull_classic", SCRIPTS / "pull.py")
classic = sys.modules["classic_source"]

OCT = 10


def access(day: int, hhmm: str) -> str:
    return f'10.0.0.1 - - [{day:02d}/Oct/2026:{hhmm}:00 +0000] "GET /x HTTP/1.1" 200 5\n'


def write_gz(path: pathlib.Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt") as fh:
        fh.write(text)


def read_gz(path: pathlib.Path) -> str:
    with gzip.open(path, "rt") as fh:
        return fh.read()


class LineMonthDayTests(unittest.TestCase):
    def test_each_server_log_format(self):
        cases = {
            ("access", access(28, "06:26")): (OCT, 28),
            ("error", "[Wed Oct 28 06:26:28 2026] [error] [pid=1] x\n"): (OCT, 28),
            ("drupal-watchdog", "Oct  3 06:35:46 srv-7135 site[1]: http://default|1|php|\n"): (OCT, 3),
            ("php-errors", "[03-Oct-2026 06:26:28 America/Chicago] PHP Warning: x\n"): (OCT, 3),
            ("drupal-requests", "[27/Oct/2026:06:26:05 +0000] host GET /x http_code=200\n"): (OCT, 27),
        }
        for (stem, line), want in cases.items():
            self.assertEqual(classic.line_month_day(line, stem), want, line)

    def test_a_date_inside_a_continuation_line_is_not_a_timestamp(self):
        frame = "#0 /mnt/www/html/x.php(12): DateTime->__construct('28-Oct-2026')\n"
        self.assertIsNone(classic.line_month_day(frame, "php-errors"))
        self.assertIsNone(classic.line_month_day("  [28-Oct-2026 01:00:00 UTC] x\n", "php-errors"))


class FilesForDayTests(unittest.TestCase):
    def listing(self, *names):
        return classic.parse_listing(list(names))

    def test_day_spans_its_own_file_and_the_next(self):
        lst = self.listing(
            "access.log-20261027.gz", "access.log-20261028.gz",
            "access.log-20261029.gz", "access.log",
        )
        self.assertEqual(
            classic.files_for_day(lst, "access", date(2026, 10, 27)),
            ["access.log-20261027.gz", "access.log-20261028.gz"],
        )

    def test_none_until_the_server_rotates_past_the_day(self):
        lst = self.listing("access.log-20261028.gz", "access.log")
        self.assertIsNone(classic.files_for_day(lst, "access", date(2026, 10, 28)))

    def test_none_before_the_oldest_rotated_file_held(self):
        # Retention cleanup or a relaunch left only 10-28 onward.
        lst = self.listing("access.log-20261028.gz", "access.log-20261029.gz")
        self.assertIsNone(classic.files_for_day(lst, "access", date(2026, 10, 1)))
        self.assertIn("before 2026-10-28", classic.history_gap(lst, date(2026, 10, 1)))
        self.assertIsNotNone(classic.files_for_day(lst, "access", date(2026, 10, 28)))

    def test_log_empty_at_rotation_spans_days(self):
        # error.log had nothing at the 10-24 rotation, so 10-25 holds 10-23..10-25.
        lst = self.listing(
            "access.log-20261024.gz", "access.log-20261025.gz",
            "error.log-20261023.gz", "error.log-20261025.gz", "error.log",
        )
        self.assertEqual(
            classic.files_for_day(lst, "error", date(2026, 10, 23)),
            ["error.log-20261023.gz", "error.log-20261025.gz"],
        )

    def test_stem_not_rotated_since_falls_back_to_live_log(self):
        lst = self.listing(
            "access.log-20261029.gz", "php-errors.log-20261020.gz", "php-errors.log",
        )
        self.assertEqual(
            classic.files_for_day(lst, "php-errors", date(2026, 10, 27)),
            ["php-errors.log"],
        )


class WriteDayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_splits_across_rotation_and_midnight(self):
        a = self.root / "access.log-20261027.gz"
        b = self.root / "access.log-20261028.gz"
        write_gz(a, access(26, "07:00") + access(26, "23:59") + access(27, "00:00") + access(27, "06:20"))
        write_gz(b, access(27, "06:30") + access(27, "23:59") + access(28, "00:01"))
        dest = self.root / "out" / "day.log.gz"
        lines, size = classic.write_day([a, b], "access", date(2026, 10, 27), dest)
        self.assertEqual(lines, 4)
        self.assertEqual(
            read_gz(dest),
            access(27, "00:00") + access(27, "06:20") + access(27, "06:30") + access(27, "23:59"),
        )
        self.assertEqual(size, dest.stat().st_size)

    def test_continuation_lines_follow_their_entry(self):
        src = self.root / "php-errors.log"
        src.write_text(
            "[26-Oct-2026 23:59:00 UTC] PHP Fatal error: a\n#0 trace a\n"
            "[27-Oct-2026 00:00:01 UTC] PHP Fatal error: b\n"
            "#0 /x.php(3): DateTime->__construct('28-Oct-2026')\n#1 trace b"
        )
        dest = self.root / "day.log.gz"
        lines, _ = classic.write_day([src], "php-errors", date(2026, 10, 27), dest)
        self.assertEqual(lines, 3)
        self.assertEqual(
            read_gz(dest),
            "[27-Oct-2026 00:00:01 UTC] PHP Fatal error: b\n"
            "#0 /x.php(3): DateTime->__construct('28-Oct-2026')\n#1 trace b\n",
        )

    def test_empty_day_is_a_valid_empty_file(self):
        src = self.root / "error.log"
        src.write_text("")
        dest = self.root / "day.log.gz"
        self.assertEqual(classic.write_day([src], "error", date(2026, 10, 27), dest)[0], 0)
        self.assertEqual(read_gz(dest), "")
        self.assertTrue(pull.file_present_and_complete(dest))


class FakeServer:
    """Answers `ssh ... ls -1 <dir>` and `rsync ... host:<dir>/ <local>/`."""

    def __init__(self, folder: pathlib.Path):
        self.folder = folder
        self.calls: list[list[str]] = []

    def __call__(self, cmd, **kwargs):
        self.calls.append(cmd)
        if cmd[0] == "ssh":
            names = "\n".join(sorted(p.name for p in self.folder.iterdir()))
            return subprocess.CompletedProcess(cmd, 0, names + "\n", "")
        if cmd[0] == "rsync":
            wanted = [a.split("=", 1)[1] for a in cmd if a.startswith("--include=")]
            local = pathlib.Path(cmd[-1])
            for name in wanted:
                shutil.copy2(self.folder / name, local / name)
            return subprocess.CompletedProcess(cmd, 0, "", "")
        raise AssertionError(cmd)


def classic_client():
    client = mock.MagicMock()
    client.get_environment.return_value = {
        "platform": "cloud", "ssh_url": "site.prod@site.ssh.devcloud.acquia-sites.com",
    }
    client.list_servers.return_value = [
        {"name": "srv-1", "roles": ["web", "db"]},
        {"name": "bal-1", "roles": ["bal"]},
    ]
    return client


class ReconcileDispatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name) / "project"
        self.server = pathlib.Path(self.tmp.name) / "server"
        write_gz(self.server / "access.log-20261027.gz", access(26, "08:00") + access(27, "01:00"))
        write_gz(self.server / "access.log-20261028.gz", access(27, "12:00") + access(28, "02:00"))
        write_gz(self.server / "access.log-20261029.gz", access(28, "09:00"))
        (self.server / "access.log").write_text(access(29, "07:00"))
        self.envs = [{"name": "prod", "env_id": "env-id", "types": ["apache-access"]}]

    def tearDown(self):
        self.tmp.cleanup()

    def run_reconcile(self, client, fake):
        real = classic.ClassicRsyncSource

        def source(*args, **kwargs):
            return real(*args, run=fake, **kwargs)

        with mock.patch.dict(pull.PLATFORM_SOURCES, {"cloud": source}):
            return pull.reconcile(
                client, self.root, self.envs, None,
                [date(2026, 10, 27), date(2026, 10, 28)], rate_limit_s=0,
            )

    def test_cloud_classic_pulls_server_logs_not_api_snapshots(self):
        client, fake = classic_client(), FakeServer(self.server)
        summary = self.run_reconcile(client, fake)
        self.assertEqual((summary["fetched"], summary["failed"]), (2, 0))
        client.request_log_download.assert_not_called()
        self.assertEqual(
            fake.calls[0][-1], "ls -1 /var/log/sites/site.prod/logs/srv-1",
        )
        self.assertNotIn("bal-1", " ".join(" ".join(c) for c in fake.calls))
        day27 = pull.canonical_path(self.root, date(2026, 10, 27), "prod", "apache-access")
        self.assertEqual(read_gz(day27), access(27, "01:00") + access(27, "12:00"))
        cov = pull.load_coverage(self.root)["2026-10-28"]["prod.apache-access"]
        self.assertEqual(cov["state"], "present")
        self.assertEqual(cov["lines"], 2)

    def test_listing_failure_fails_every_tuple_with_the_reason(self):
        client = classic_client()

        def broken(cmd, **kwargs):
            return subprocess.CompletedProcess(cmd, 255, "", "Permission denied (publickey).")

        summary = self.run_reconcile(client, broken)
        self.assertEqual(summary["failed"], 2)
        cov = pull.load_coverage(self.root)["2026-10-27"]["prod.apache-access"]
        self.assertEqual(cov["state"], "fetch-failed")
        self.assertIn("Permission denied", cov["reason"])

    def test_truncated_history_fails_instead_of_writing_an_empty_day(self):
        (self.server / "access.log-20261027.gz").unlink()
        client, fake = classic_client(), FakeServer(self.server)
        summary = self.run_reconcile(client, fake)
        self.assertEqual((summary["fetched"], summary["failed"]), (1, 1))
        cov = pull.load_coverage(self.root)["2026-10-27"]["prod.apache-access"]
        self.assertEqual(cov["state"], "fetch-failed")
        self.assertIn("holds no rotated logs before 2026-10-28", cov["reason"])
        self.assertIsNone(pull.find_log_file(self.root, date(2026, 10, 27), "prod", "apache-access"))

    def test_cache_from_another_log_does_not_vouch_for_lost_history(self):
        # An earlier pull cached access for 10-27; the server has since lost
        # everything before 10-28, including php-errors for 10-27.
        cache = self.root / ".drover" / "cache" / "classic" / "prod" / "srv-1"
        cache.mkdir(parents=True)
        shutil.copy2(self.server / "access.log-20261027.gz", cache)
        (self.server / "access.log-20261027.gz").unlink()
        write_gz(self.server / "php-errors.log-20261028.gz", "[27-Oct-2026 15:00:00 UTC] PHP Warning: x\n")
        self.envs[0]["types"] = ["php-error"]
        summary = self.run_reconcile(classic_client(), FakeServer(self.server))
        cov = pull.load_coverage(self.root)["2026-10-27"]["prod.php-error"]
        self.assertEqual(cov["state"], "fetch-failed")
        self.assertEqual(summary["failed"], 1)

    def test_cloud_next_keeps_the_api_snapshot_path(self):
        client = mock.MagicMock()
        client.get_environment.return_value = {"platform": "cloud-next"}
        client.request_log_download.return_value = {
            "_links": {"notification": {"href": "https://x/n"}},
        }
        client.check_log_download.return_value = {"status": "failed"}
        fake = FakeServer(self.server)
        with mock.patch.dict(pull.PLATFORM_SOURCES, {"cloud": fake}):
            pull.reconcile(
                client, self.root, self.envs, None, [date(2026, 10, 27)],
                rate_limit_s=0, retries=0, poll_interval_s=0,
            )
        client.request_log_download.assert_called()
        self.assertEqual(fake.calls, [])

    def test_manifest_platform_skips_the_api_lookup(self):
        client = mock.MagicMock()
        env = {"name": "prod", "env_id": "env-id", "platform": "cloud"}
        self.assertEqual(pull.detect_platform(client, env), "cloud")
        client.get_environment.assert_not_called()

    def test_unknown_platform_falls_back_to_the_api(self):
        client = mock.MagicMock()
        client.get_environment.side_effect = RuntimeError("boom")
        self.assertIsNone(pull.detect_platform(client, {"name": "prod", "env_id": "x"}))


if __name__ == "__main__":
    unittest.main()
