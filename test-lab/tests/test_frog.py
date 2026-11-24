"""Offline tests for the DDEV guard and the Screaming Frog wrapper. No DDEV, no SF.

Fixtures copy the shape of real Screaming Frog 25.1 output with made-up URLs.
"""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import ddev_guard  # noqa: E402

spec = importlib.util.spec_from_file_location("frog_crawl", ROOT / "scripts/frog/frog_crawl.py")
frog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frog)

RAW = {
    "name": "demo",
    "status": "running",
    "approot": "/tmp/demo",
    "primary_url": "https://demo.ddev.site",
    "httpurl": "http://demo.ddev.site",
    "httpsurl": "https://demo.ddev.site",
    "hostnames": ["demo.ddev.site", "alt.ddev.site"],
    "type": "drupal10",
}

LOG = """2026-11-24 12:00:00,000 [1] [main] INFO  - Running: Screaming Frog SEO Spider 25.1
2026-11-24 12:00:01,000 [1] [main] INFO  - Config loaded: Spider
SpiderCrawlConfig [mCrawlExternalLinks=false, mCrawlSitemaps=true, mCrawlerMode=STANDARD,
 mUserAgent=Screaming Frog SEO Spider/25.1, mIncludeImages=false, mIncludeImages=true]
2026-11-24 12:00:09,000 [1] [SpiderMain 1] WARN  - Giving up on www.example.org: has stopped responding
2026-11-24 12:00:09,100 [1] [SpiderMain 1] WARN  - Ending the crawl early: every remaining host is rate limiting us or unreachable.
"""

LIST_CRAWLS = """╔══════════════════╤════════════╤═════════════════╤════════╤══════════╤══════╤════════════╤══════════╤═════════╗
║ Database Id      │ Name       │ URL             │ Mode   │ Status   │ URLs │ % Complete │ Modified │ Version ║
╠══════════════════╪════════════╪═════════════════╪════════╪══════════╪══════╪════════════╪══════════╪═════════╣
║ 0fbf8c31-aaaa    │ seo-local- │ https://demo.dd │ Spider │ Finished │ 2997 │        100 │ Nov 24   │    25.1 ║
║                  │ 2026112412 │       ev.site/  │        │          │      │            │          │         ║
╟──────────────────┼────────────┼─────────────────┼────────┼──────────┼──────┼────────────┼──────────┼─────────╢
║ 265f87c4-bbbb    │ list13.txt │   Multiple URLs │   List │   Paused │   13 │       83.5 │ Nov 24   │    25.1 ║
╚══════════════════╧════════════╧═════════════════╧════════╧══════════╧══════╧════════════╧══════════╧═════════╝
"""


def fake_run(responses):
    """subprocess.run stand-in: pops (returncode, stdout) per call, records argv."""
    calls = []

    def run(cmd, cwd=None, **_):
        calls.append(cmd)
        code, out = responses.pop(0)
        return SimpleNamespace(returncode=code, stdout=out, stderr="")

    run.calls = calls
    return run


class DdevGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / ".ddev").mkdir()
        (self.root / ".ddev/config.yaml").write_text("name: demo\n")

    def tearDown(self):
        self.tmp.cleanup()

    def test_running_project_resolves_hosts(self):
        run = fake_run([(0, json.dumps({"raw": RAW}))])
        t = ddev_guard.resolve(self.root, run=run)
        self.assertEqual(t.primary_url, "https://demo.ddev.site/")
        self.assertEqual(t.hosts, ["127.0.0.1", "alt.ddev.site", "demo.ddev.site", "localhost"])
        self.assertEqual(run.calls, [["ddev", "describe", "-j"]])

    def test_stopped_project_is_started(self):
        stopped = dict(RAW, status="stopped")
        run = fake_run([(0, json.dumps({"raw": stopped})), (0, "started"), (0, json.dumps({"raw": RAW}))])
        ddev_guard.resolve(self.root, run=run)
        self.assertEqual(run.calls[1], ["ddev", "start"])

    def test_stopped_project_without_start_is_refused(self):
        run = fake_run([(0, json.dumps({"raw": dict(RAW, status="stopped")}))])
        with self.assertRaises(ddev_guard.GuardError) as e:
            ddev_guard.resolve(self.root, start=False, run=run)
        self.assertEqual(e.exception.code, 2)

    def test_log_lines_before_json_are_ignored(self):
        run = fake_run([(0, "some notice\n" + json.dumps({"raw": RAW}))])
        self.assertEqual(ddev_guard.resolve(self.root, run=run).name, "demo")

    def test_not_a_ddev_project(self):
        with tempfile.TemporaryDirectory() as other:
            with self.assertRaises(ddev_guard.GuardError):
                ddev_guard.resolve(other, run=fake_run([]))

    def test_url_checks(self):
        t = ddev_guard._target(RAW)
        self.assertTrue(t.allows("https://demo.ddev.site/about"))
        self.assertTrue(t.allows("http://localhost:8080/"))
        self.assertFalse(t.allows("https://www.example.org/"))
        self.assertFalse(t.allows("https://demo.ddev.site.evil.test/"))
        self.assertFalse(t.allows("ftp://demo.ddev.site/"))
        self.assertFalse(t.allows("/relative/path"))

    def test_list_with_one_external_url_is_refused(self):
        t = ddev_guard._target(RAW)
        lst = self.root / "urls.txt"
        lst.write_text("https://demo.ddev.site/\n\nhttps://www.example.org/\n")
        with self.assertRaises(ddev_guard.GuardError) as e:
            ddev_guard.check_list(lst, t)
        self.assertEqual(e.exception.code, 3)
        lst.write_text("https://demo.ddev.site/\nhttps://alt.ddev.site/x\n")
        self.assertEqual(len(ddev_guard.check_list(lst, t)), 2)


class FrogParsingTest(unittest.TestCase):
    def test_effective_config_and_required(self):
        cfg = frog.effective_config(LOG)
        self.assertEqual(cfg["mCrawlExternalLinks"], ["false"])
        self.assertEqual(frog.check_required(cfg, {"mCrawlSitemaps": "true"}), [])
        problems = frog.check_required(cfg, {"mCrawlerMode": "RENDER", "mInspectAccessibility": "true"})
        self.assertEqual(len(problems), 2)

    def test_external_links_on_is_always_refused(self):
        cfg = frog.effective_config(LOG.replace("mCrawlExternalLinks=false", "mCrawlExternalLinks=true"))
        self.assertTrue(frog.check_required(cfg, {}))

    def test_mixed_values_fail(self):
        cfg = frog.effective_config(LOG)
        self.assertTrue(frog.check_required(cfg, {"mIncludeImages": "true"}))

    def test_list_crawls_joins_wrapped_cells(self):
        rows = frog.parse_list_crawls(LIST_CRAWLS)
        self.assertEqual([r["id"] for r in rows], ["0fbf8c31-aaaa", "265f87c4-bbbb"])
        self.assertEqual(rows[0]["name"], "seo-local-2026112412")
        self.assertEqual(rows[0]["url"], "https://demo.ddev.site/")
        self.assertEqual(rows[1]["status"], "Paused")

    def test_file_names(self):
        files = {frog._key(n): Path(n) for n in [
            "internal_all", "response_codes_internal_client_error_(4xx)", "page_titles_outside_head",
            "canonicals_nonindexable_canonical", "issues_reports", "issues_overview_report_all",
            "redirects", "all_inlinks", "internal_all_error_(4xx_5xx_no_response)_inlinks",
            "wcag_2_1_aa_all_violations", "comparison_crawl_overview", "issues_diff_report"]}
        for name in ["Internal:All", "Response Codes:Internal Client Error (4xx)", "Page Titles:Outside <head>",
                     "Canonicals:Non-Indexable Canonical", "Issues:All", "Issues Overview:All Issues",
                     "Redirects:All Redirects", "Links:All Inlinks",
                     "Response Codes:Internal:Internal All Error (4xx 5xx & No Response) Inlinks",
                     "Accessibility:WCAG 2.1 AA:All Violations", "Crawl Overview Comparison",
                     "Issues Diff Overview"]:
            self.assertIsNotNone(frog.locate(name, files), name)
        self.assertIsNone(frog.locate("H1:Missing", files))

    def test_crawl_outcome(self):
        hosts = ["demo.ddev.site", "localhost", "127.0.0.1"]
        self.assertEqual(frog.crawl_outcome("Finished", "", hosts), [])
        self.assertEqual(len(frog.crawl_outcome("Paused", LOG, hosts)), 1)
        stuck_local = LOG.replace("www.example.org", "demo.ddev.site")
        with self.assertRaises(frog.FrogError):
            frog.crawl_outcome("Paused", stuck_local, hosts)
        with self.assertRaises(frog.FrogError):
            frog.crawl_outcome("Paused", "user paused", hosts)
        with self.assertRaises(frog.FrogError):
            frog.crawl_outcome("Running", "", hosts)

    def test_crawl_args(self):
        args = frog.crawl_args("https://demo.ddev.site/", None, Path("/c/seo.seospiderconfig"), Path("/out"),
                               "demo", "seo-local-1", ["Internal:All"], ["Issues:All"], ["Crawl Overview"])
        self.assertIn("--headless", args)
        self.assertEqual(args[args.index("--crawl") + 1], "https://demo.ddev.site/")
        for flag in ("--skip-empty", "--save-crawl", "--overwrite", "--use-pagespeed"):
            self.assertNotIn(flag, args)
        listed = frog.crawl_args("https://demo.ddev.site/", Path("/l.txt"), Path("/c"), Path("/o"),
                                 "demo", "t", [], [], [])
        self.assertNotIn("--crawl", listed)
        self.assertEqual(listed[listed.index("--crawl-list") + 1], "/l.txt")

    def test_unknown_export_is_an_error_even_on_exit_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            def run(cmd, stdout=None, **_):
                stdout.write("Unknown export: 'Issues Overview:All Issues'. Available:\n")
                return SimpleNamespace(returncode=0)
            with self.assertRaises(frog.FrogError) as e:
                frog._run_sf(["--headless"], Path(tmp), 10, run)
            self.assertIn("rejected export", str(e.exception))

    def test_timeout_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            def run(cmd, **_):
                raise subprocess.TimeoutExpired(cmd, 1)
            with self.assertRaises(frog.FrogError):
                frog._run_sf(["--headless"], Path(tmp), 1, run)

    def test_missing_export_file_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "internal_all.csv").write_text("﻿Address\n")
            found = frog._verify_files(out, ["Internal:All"], [], [])
            self.assertTrue(found["export_tabs"]["Internal:All"].endswith("internal_all.csv"))
            with self.assertRaises(frog.FrogError):
                frog._verify_files(out, ["Internal:All", "H1:All"], [], [])

    def test_runs_inside_the_sandbox(self):
        with unittest.mock.patch.dict("os.environ", {"FROG_LAUNCHER": sys.executable}):
            cmd = frog._sandboxed(["--headless"])
        self.assertEqual(cmd, ["sandbox-exec", "-f", str(frog.SANDBOX), sys.executable, "--headless"])
        profile = frog.SANDBOX.read_text()
        self.assertIn("(deny network-outbound)", profile)
        self.assertIn('(allow network-outbound (remote ip "localhost:*"))', profile)


if __name__ == "__main__":
    unittest.main()
