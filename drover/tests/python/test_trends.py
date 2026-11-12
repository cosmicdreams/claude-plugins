"""Tests for access-log trend reports (scripts/trends.py, scripts/clickhouse.py).

Unit tests run everywhere. The rollup tests need clickhouse-local and are
skipped when drover cannot find it (DROVER_CLICKHOUSE or `clickhouse` on PATH).
All log lines are synthetic, using documentation IP ranges.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import clickhouse  # noqa: E402
import trends  # noqa: E402

try:
    CH = clickhouse.find_clickhouse()
except clickhouse.ClickHouseUnavailable:
    CH = None


def line(ip, day, method, path, status, size, ua, ms=120, ff=None, host="www.example.org"):
    ff_field = f'forwarded_for="{ff}, 192.0.2.1"' if ff else 'forwarded_for="-"'
    rt = f"request_time={ms * 1000} " if ms is not None else ""
    return (f'{ip} - - [{day}/Oct/2026:10:00:00 +0000] "{method} {path} HTTP/1.1" {status} {size} '
            f'"-" "{ua}" vhost=site.prod.acquia-sites.com host={host} hosting_site=site pid=1 '
            f'{rt}{ff_field} request_id="v-1" location="-"')


BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36"
GOOGLE = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
GPT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)"

DAY1 = [
    line("192.0.2.10", "01", "GET", "/", 200, 5000, BROWSER, ff="198.51.100.1"),
    line("192.0.2.10", "01", "GET", "/node/123?page=2", 200, 3000, BROWSER, ms=900, ff="198.51.100.2"),
    line("192.0.2.10", "01", "GET", "/node/456", 404, 100, BROWSER, ff="198.51.100.2"),
    line("192.0.2.10", "01", "GET", "/news", 500, 100, GOOGLE, ms=3000, ff="198.51.100.3"),
    line("2001:db8::7", "01", "POST", "/user/login", 302, 0, BROWSER, ms=None),
    line("192.0.2.11", "01", "GET", "/_fragment?_path=x", 403, 10, "curl/8.4.0", ff="203.0.113.9"),
    line("192.0.2.11", "01", "GET", "/wp-login.php", 200, 10, "-", ff="203.0.113.9"),
]
DAY2 = [
    line("192.0.2.10", "02", "GET", "/", 200, 5000, BROWSER, ff="198.51.100.1"),
    line("192.0.2.10", "02", "GET", "/news", 200, 4000, GPT, ff="198.51.100.4", host="Example.ORG"),
    line("192.0.2.12", "02", "GET", "/.env", 404, 10, "python-requests/2.32", ff="203.0.113.10"),
]


def write_logs(root: Path, day_lines: dict[str, list[str]], env="prod"):
    folder = root / "2026" / "10"
    folder.mkdir(parents=True, exist_ok=True)
    for day, lines in day_lines.items():
        p = folder / f"2026-10-{day}.{env}.apache-access.log.gz"
        with gzip.open(p, "wt") as fh:
            fh.write("\n".join(lines) + "\n")
    (root / ".drover").mkdir(exist_ok=True)
    (root / ".drover" / "manifest.json").write_text(json.dumps({"project": "example", "acquia": {"envs": []}}))


def reference(lines: list[str]) -> dict:
    """Plain-Python count of what the rollup totals should say."""
    statuses = [int(re.search(r'" (\d{3}) ', l).group(1)) for l in lines]
    ips = set()
    for l in lines:
        ff = re.search(r'forwarded_for="([^",]+)', l).group(1)
        ips.add(ff if ff != "-" else l.split(" ")[0])
    return {
        "requests": len(lines),
        "bytes": sum(int(re.search(r'" \d{3} (\d+)', l).group(1)) for l in lines),
        "unique_ips": len(ips),
        "s4xx": sum(400 <= s < 500 for s in statuses),
        "s5xx": sum(s >= 500 for s in statuses),
        "s404": statuses.count(404),
    }


class MonthMathTests(unittest.TestCase):
    def test_months_back_crosses_year(self):
        self.assertEqual(trends.months_back((2026, 2), 3), ["2025-12", "2026-01", "2026-02"])

    def test_rate_change_uses_per_day_rates(self):
        # 900 requests in 9 days vs 3,100 in 31 days is flat, not -71%.
        self.assertEqual(trends.rate_change(900, 9, 3100, 31), 0.0)
        self.assertIsNone(trends.rate_change(5, 1, None, 31))

    def test_in_progress_month_does_not_count_future_days_missing(self):
        r = {"present_days": 2, "missing_days": [f"2026-10-{d:02d}" for d in range(3, 32)],
             "expected_days": 31, "totals": {"requests": 10}, "days": [], "agents": [], "probes": []}
        with mock.patch.object(trends, "date") as d:
            d.today.return_value.isoformat.return_value = "2026-10-05"
            row = trends.month_row("2026-10", r)
        self.assertEqual(row["missing_days"], ["2026-10-03", "2026-10-04", "2026-10-05"])
        self.assertEqual(row["expected_days"], 5)
        self.assertTrue(row["in_progress"])


class DiscoveryTests(unittest.TestCase):
    def fake(self, folder: Path, version_line: str) -> Path:
        p = folder / "clickhouse"
        p.write_text(f"#!/bin/sh\necho '{version_line}'\n")
        p.chmod(p.stat().st_mode | stat.S_IEXEC)
        return p

    def test_missing_override_is_unavailable(self):
        with mock.patch.dict(os.environ, {"DROVER_CLICKHOUSE": "/nonexistent/clickhouse"}):
            with self.assertRaises(clickhouse.ClickHouseUnavailable) as cm:
                clickhouse.find_clickhouse()
        self.assertIn("brew install --cask clickhouse", str(cm.exception))

    def test_old_version_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self.fake(Path(tmp), "ClickHouse local version 25.3.1.1 (official build).")
            with mock.patch.dict(os.environ, {"DROVER_CLICKHOUSE": str(p)}):
                with self.assertRaises(clickhouse.ClickHouseUnavailable) as cm:
                    clickhouse.find_clickhouse()
        self.assertIn("25.3", str(cm.exception))

    def test_supported_version_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self.fake(Path(tmp), "ClickHouse local version 26.10.3.7 (official build).")
            with mock.patch.dict(os.environ, {"DROVER_CLICKHOUSE": str(p)}):
                self.assertEqual(clickhouse.find_clickhouse().version, "26.10")

    def test_cli_exits_3_with_hint_when_a_rollup_is_needed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_logs(root, {"01": DAY1})
            with mock.patch.dict(os.environ, {"DROVER_CLICKHOUSE": "/nonexistent/clickhouse"}):
                with mock.patch("sys.stderr"):
                    rc = trends.main(["--project", str(root), "--months", "1"])
        self.assertEqual(rc, 3)


@unittest.skipIf(CH is None, "clickhouse-local not found; set DROVER_CLICKHOUSE to run rollup tests")
class RollupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        write_logs(self.root, {"01": DAY1, "02": DAY2})

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, **kw):
        return trends.load_or_build(self.root, "prod", "2026-10", rebuild=False, ch_holder=kw.get("holder", {}),
                                    log=lambda s: None)

    def test_totals_match_python_reference(self):
        r = self.build()
        ref = reference(DAY1 + DAY2)
        for key, value in ref.items():
            self.assertEqual(r["totals"][key], value, key)
        self.assertEqual(r["totals"]["unparsed"], 0)
        self.assertEqual([d["day"] for d in r["days"]], ["2026-10-01", "2026-10-02"])
        self.assertEqual(sum(d["requests"] for d in r["days"]), len(DAY1 + DAY2))
        self.assertEqual(r["present_days"], 2)

    def test_classification_routes_and_probes(self):
        r = self.build()
        agents = {(a["agent_class"], a["agent_name"]): a["requests"] for a in r["agents"]}
        self.assertEqual(agents[("human", "browsers")], 5)
        self.assertEqual(agents[("search", "Googlebot")], 1)
        self.assertEqual(agents[("ai", "GPTBot")], 1)
        self.assertEqual(agents[("other-bot", "curl")], 1)
        self.assertEqual(agents[("other-bot", "(no user agent)")], 1)
        probes = {p["probe"]: p for p in r["probes"]}
        self.assertEqual(probes["symfony-fragment"]["requests"], 1)
        self.assertEqual(probes["wordpress"]["answered_200"], 1)
        self.assertEqual(probes["secrets"]["requests"], 1)
        routes = {x["route"]: x["requests"] for x in r["routes"]}
        self.assertEqual(routes["/node/{n}"], 2)  # ids collapsed, query string dropped
        self.assertNotIn("/_fragment", routes)  # probes stay out of routes
        hosts = {h["host"]: h["requests"] for h in r["hosts"]}
        self.assertEqual(hosts["example.org"], 1)  # lowercased

    def test_rollup_is_reused_until_a_log_changes(self):
        self.build()
        holder: dict = {}
        self.build(holder=holder)
        self.assertNotIn("ch", holder, "an unchanged month must not run ClickHouse")
        write_logs(self.root, {"02": DAY2 + DAY2})
        r = self.build(holder=holder)
        self.assertIn("ch", holder)
        self.assertEqual(r["totals"]["requests"], len(DAY1) + 2 * len(DAY2))

    def test_report_end_to_end(self):
        out = self.root / "t.json"
        with mock.patch("sys.stderr"):
            rc = trends.main(["--project", str(self.root), "--months", "2", "--format", "json", "--out", str(out)])
        self.assertEqual(rc, 0)
        t = json.loads(out.read_text())
        self.assertEqual([m["has_data"] for m in t["months"]], [False, True])
        self.assertEqual(t["latest"]["requests"], len(DAY1 + DAY2))
        self.assertIn("September 2026: no access logs on disk.", t["notes"])
        md = trends.render_markdown(t)
        self.assertIn("## Security probes (requests per day)", md)


if __name__ == "__main__":
    unittest.main()
