"""drover aggregation via clickhouse-local.

Reproduces scripts/aggregate.aggregate_files() for one project, env and
month of daily files, except per-group first_seen/last_seen and the
top-level metadata, which this experiment does not compute.
drupal-watchdog and apache-error run in ClickHouse (sql/*.sql); php-error
stays on the Python parser because its stack-trace state machine is
small-volume and not worth porting.
"""
from __future__ import annotations

import collections
import functools
import json
import os
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
DROVER_SCRIPTS = HERE.parent.parent / "scripts"
sys.path.insert(0, str(DROVER_SCRIPTS))

import aggregate as py_aggregate  # noqa: E402
from pull import find_log_file  # noqa: E402
from parsers.common import parse_apache_ts, parse_syslog_ts  # noqa: E402

CLICKHOUSE = os.environ.get("CLICKHOUSE_BIN", str(HERE / "bin" / "clickhouse"))
SQL_BY_TYPE = {"drupal-watchdog": "watchdog.sql", "apache-error": "apache_error.sql"}


# Python's str.isspace() set. RE2's \s and \S are ASCII-only, so the SQL files are
# written with \s / \S and rewritten to this class on load. The rewrite is textual:
# use \s and \S only outside [...] classes, except the literal [^\s/] handled below.
PY_WS = (r"\\t-\\r\\x1c-\\x20\\x{85}\\x{a0}\\x{1680}\\x{2000}-\\x{200a}"
         r"\\x{2028}\\x{2029}\\x{202f}\\x{205f}\\x{3000}")


def load_sql(name: str) -> str:
    """Read sql/<name> with \\s and \\S given Python's Unicode meaning."""
    s = (HERE / "sql" / name).read_text()
    s = s.replace(r"[^\\s/]", f"[^{PY_WS}/]")
    return s.replace(r"\\S", f"[^{PY_WS}]").replace(r"\\s", f"[{PY_WS}]")


def run_sql(sql_name: str, files: list[Path]) -> list[dict]:
    """Run one SQL file over the given log files; return JSONEachRow rows."""
    if not files:
        return []
    # file() expands {a,b,c} within one path segment, so files must share a folder
    # (drover keeps one folder per month). Names contain no commas or braces.
    folders = {f.parent for f in files}
    if len(folders) != 1:
        raise ValueError(f"run_sql takes files from one month folder, got {sorted(map(str, folders))}")
    names = [f.name for f in files]
    glob = str(files[0].parent / ("{" + ",".join(names) + "}" if len(names) > 1 else names[0]))
    sql = load_sql("functions.sql") + load_sql(sql_name)
    proc = subprocess.run(
        [CLICKHOUSE, "local", "--multiquery", f"--param_glob={glob}"],
        input=sql, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"clickhouse {sql_name} failed: {proc.stderr.strip()[:2000]}")
    return [json.loads(line) for line in proc.stdout.splitlines() if line]


@functools.lru_cache(maxsize=None)
def resolve_day(key: str) -> str:
    """Turn a SQL day key into the ISO day drover's own parsers would give.

    'syslog|<file day>|<Mon>|<DD>' (watchdog: no year) goes through
    parse_syslog_ts() with the file's day as hint; 'apache|<timestamp>' through
    parse_apache_ts(); anything else is 'unknown'. Keys are few per file.
    """
    kind, _, rest = key.partition("|")
    if kind == "syslog":
        fday, mon, dd = rest.split("|")
        ts = parse_syslog_ts(f"{mon} {dd} 00:00:00", day_hint=date.fromisoformat(fday))
    elif kind == "apache":
        ts = parse_apache_ts(rest)
    else:
        ts = None
    return ts.date().isoformat() if ts else "unknown"


def rows_to_aggregate(rows: list[dict], log_type: str) -> dict:
    """Fold ClickHouse group rows into aggregate_files()'s return shape.

    Each row's buckets are (day key, severity, channel, count, first occurrence),
    one file per bucket. Python keeps encounter order: a group's channel is its
    first event's, a severity tie goes to the severity seen first, and groups
    with equal counts keep the order aggregate_files() inserted them in: by the
    first file they appear in, then by their count in that file (descending),
    then by first appearance there. Sorting buckets by first occurrence
    reproduces all three.
    """
    src = py_aggregate.LOG_TYPE_TO_SOURCE.get(log_type, "other")
    by_sev: collections.Counter = collections.Counter()
    by_ch: collections.Counter = collections.Counter()
    by_day: dict[str, dict] = {}
    groups = []
    order = {}
    total = 0
    for r in rows:
        sevs: collections.Counter = collections.Counter()
        days: collections.Counter = collections.Counter()
        buckets = sorted(r["buckets"], key=lambda b: b[4])
        sev_first = {}
        per_file: dict[str, list] = {}
        for day_key, sev, channel, n, first in buckets:
            d = resolve_day(day_key)
            sev_first.setdefault(sev, first)
            f = per_file.setdefault(first[0], [0, first[1]])
            f[0] += n
            sevs[sev] += n
            days[d] += n
            by_ch[channel or "(none)"] += n
            b = by_day.setdefault(d, {"total": 0, "severities": collections.Counter()})
            b["total"] += n
            b["severities"][sev] += n
        total += r["count"]
        by_sev.update(sevs)
        top = max(sevs.values())
        first_file = buckets[0][4][0]
        order[r["fingerprint"]] = (first_file, -per_file[first_file][0], per_file[first_file][1])
        groups.append({
            "fingerprint": r["fingerprint"],
            "source": src,
            "channel": buckets[0][2],
            "severity": min((s for s, n in sevs.items() if n == top), key=sev_first.__getitem__),
            "severities": dict(sevs),
            "count": r["count"],
            "samples": r["samples"],
            "summary": r["summary"],
            "days": dict(days),
        })
    groups.sort(key=lambda g: order[g["fingerprint"]])
    groups.sort(key=lambda g: g["count"], reverse=True)  # stable: ties keep insertion order
    return {
        "events_total": total, "groups": groups,
        "by_severity": dict(by_sev), "by_channel": dict(by_ch),
        "by_day": {d: {"total": v["total"], "severities": dict(v["severities"])} for d, v in by_day.items()},
    }


def files_for(project: Path, env: str, log_type: str, start: date, end: date) -> list[Path]:
    out, d = [], start
    while d <= end:
        f = find_log_file(project, d, env, log_type)
        if f is not None:
            out.append(f)
        d += timedelta(days=1)
    return out


def aggregate_type(project: Path, env: str, log_type: str, start: date, end: date) -> dict:
    """One log type over a date range: ClickHouse where ported, else Python."""
    if log_type in SQL_BY_TYPE:
        files = files_for(project, env, log_type, start, end)
        return rows_to_aggregate(run_sql(SQL_BY_TYPE[log_type], files), log_type)
    return py_aggregate.aggregate_files(project, env=env, types=[log_type], from_date=start, to_date=end)
