"""Time Python drover vs clickhouse-local aggregation and check they agree.

For each project and month: run scripts/aggregate.aggregate_files() and
ch_aggregate.aggregate_type() over the same files, record wall time and
peak memory of each (each runs in its own child process), and compare
every group field ch_aggregate produces, the totals and the group order.
Writes results/bench.json.

  python3 bench.py ~/Sites/<PROJECT>:2026-10 ~/Sites/<OTHER>:2026-09
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
TYPES = ["apache-error", "drupal-watchdog", "php-error"]
FIELDS = ("count", "source", "channel", "severity", "severities", "days", "summary", "samples")

CHILD = r"""
import json, sys
from datetime import date
sys.path.insert(0, {here!r})
import ch_aggregate as ch
project, env, t, s, e, engine = sys.argv[1:]
s, e = date.fromisoformat(s), date.fromisoformat(e)
from pathlib import Path
if engine == "python":
    agg = ch.py_aggregate.aggregate_files(Path(project), env=env, types=[t], from_date=s, to_date=e)
else:
    agg = ch.aggregate_type(Path(project), env, t, s, e)
agg.pop("metadata", None)
for g in agg["groups"]:
    g.pop("first_seen", None); g.pop("last_seen", None)
import resource
rss = max(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)
json.dump({{"agg": agg, "peak_bytes": rss}}, sys.stdout)
"""


def month_range(ym: str) -> tuple[date, date]:
    y, m = map(int, ym.split("-"))
    return date(y, m, 1), date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)


def timed(engine: str, project: Path, t: str, s: date, e: date) -> tuple[dict, float, float]:
    """Run one engine in a child; return (aggregate, seconds, peak RSS MB).

    Peak is the larger of the child's own peak and its clickhouse process's
    peak (they barely overlap), not their sum."""
    t0 = time.perf_counter()
    proc = subprocess.run(
        [sys.executable, "-I", "-c", CHILD.format(here=str(HERE)), str(project), "prod", t,
         s.isoformat(), e.isoformat(), engine],
        capture_output=True, text=True, env={"JEV_DISABLED": "1", "PATH": "/usr/bin:/bin"},
    )
    secs = time.perf_counter() - t0
    if proc.returncode != 0:
        raise RuntimeError(f"{engine} {project.name} {t}: {proc.stderr[-2000:]}")
    # ru_maxrss is bytes on macOS: max of the child itself and its clickhouse process.
    out = json.loads(proc.stdout)
    return out["agg"], secs, out["peak_bytes"] / 1e6


def compare(py: dict, ch: dict) -> dict:
    """Field-by-field agreement between the two aggregates."""
    pg = {g["fingerprint"]: g for g in py["groups"]}
    cg = {g["fingerprint"]: g for g in ch["groups"]}
    both = pg.keys() & cg.keys()
    field_mismatch = {f: sorted(fp for fp in both if pg[fp][f] != cg[fp][f])[:5] for f in FIELDS}
    order_matches = [g["fingerprint"] for g in py["groups"]] == [g["fingerprint"] for g in ch["groups"]]
    only_py, only_ch = sorted(pg.keys() - cg.keys()), sorted(cg.keys() - pg.keys())
    return {
        "events": [py["events_total"], ch["events_total"]],
        "groups": [len(pg), len(cg)],
        "only_python": only_py[:5], "only_python_n": len(only_py),
        "only_python_events": sum(pg[f]["count"] for f in only_py),
        "only_clickhouse": only_ch[:5], "only_clickhouse_n": len(only_ch),
        "field_mismatch": {f: v for f, v in field_mismatch.items() if v},
        "field_mismatch_n": {f: sum(1 for fp in both if pg[fp][f] != cg[fp][f]) for f in FIELDS},
        "order_matches": order_matches,
        "totals_match": all(py[k] == ch[k] for k in ("events_total", "by_severity", "by_channel", "by_day")),
        "identical": py["events_total"] == ch["events_total"] and not only_py and not only_ch and order_matches
                     and not any(field_mismatch.values())
                     and all(py[k] == ch[k] for k in ("by_severity", "by_channel", "by_day")),
    }


def main(argv: list[str]) -> int:
    runs = []
    for spec in argv:
        proj, ym = spec.rsplit(":", 1)
        project = Path(proj).expanduser()
        s, e = month_range(ym)
        for t in TYPES:
            py, py_s, py_mb = timed("python", project, t, s, e)
            ch, ch_s, ch_mb = timed("clickhouse", project, t, s, e)
            row = {"project": project.name, "month": ym, "type": t,
                   "python_s": round(py_s, 2), "clickhouse_s": round(ch_s, 2),
                   "python_peak_mb": round(py_mb), "clickhouse_peak_mb": round(ch_mb),
                   **compare(py, ch)}
            runs.append(row)
            print(json.dumps({k: row[k] for k in ("project", "month", "type", "python_s", "clickhouse_s",
                                                  "events", "groups", "identical", "field_mismatch_n")}),
                  flush=True)
    out = HERE / "results" / "bench.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(runs, indent=1))
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
