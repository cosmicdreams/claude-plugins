#!/usr/bin/env python3
"""Access-log traffic trends across months.

    python3 trends.py [--project DIR] [--env prod] [--through YYYY-MM]
                      [--months 6] [--format md|json] [--out PATH] [--rebuild]

Each month of `apache-access` logs is summarised once by clickhouse-local into
a small rollup, `.drover/rollups/<env>/apache-access/<YYYY-MM>.json`. A rollup
is rebuilt only when that month's log files change (name, size or mtime), or
with --rebuild. Trend reports read rollups only, so ClickHouse is needed only
when a rollup must be built. Rollups hold aggregate counts, top routes and
named user agents, never raw lines; they are safe to delete and rebuild.

The JSON output (`--format json`, default path reports/trends-<through>.json)
feeds the `traffic-trends` HTML template:

    node render-html/render.mjs --data reports/trends-2026-10.json --template traffic-trends
"""
from __future__ import annotations

import argparse
import calendar
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from clickhouse import ClickHouseUnavailable, find_clickhouse  # noqa: E402
from pull import find_log_file  # noqa: E402

LOG_TYPE = "apache-access"
ROLLUP_SCHEMA = 1
ROUTES_KEPT = 200
SQL_PATH = HERE / "sql" / "access_rollup.sql"
AGENT_CLASSES = [("human", "Browsers"), ("search", "Search engines"),
                 ("ai", "AI crawlers and assistants"), ("other-bot", "Other bots and scripts")]
PROBE_LABELS = {
    "symfony-fragment": "/_fragment (Symfony exploit probe)",
    "wordpress": "WordPress paths",
    "secrets": "Secret files (.env, .git)",
    "admin-tools": "Admin tools (phpMyAdmin, cgi-bin)",
}


# --- months ----------------------------------------------------------------

def parse_month(text: str) -> tuple[int, int]:
    try:
        d = datetime.strptime(text, "%Y-%m")
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM, got {text!r}") from exc
    return d.year, d.month


def month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def month_label(key: str, short: bool = False) -> str:
    y, m = parse_month(key)
    return f"{calendar.month_abbr[m] if short else calendar.month_name[m]} {y}"


def months_back(through: tuple[int, int], count: int) -> list[str]:
    y, m = through
    out = []
    for _ in range(count):
        out.append(month_key(y, m))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return out[::-1]


def month_files(project: Path, env: str, key: str) -> list[Path]:
    y, m = parse_month(key)
    days = calendar.monthrange(y, m)[1]
    found = (find_log_file(project, date(y, m, d), env, LOG_TYPE) for d in range(1, days + 1))
    return [p for p in found if p is not None]


def latest_month_with_logs(project: Path, env: str) -> tuple[int, int] | None:
    keys = sorted({p.name[:7] for p in project.glob(f"[0-9][0-9][0-9][0-9]/[0-9][0-9]/*.{env}.{LOG_TYPE}.log*")})
    return parse_month(keys[-1]) if keys else None


# --- rollups ---------------------------------------------------------------

def rollup_path(project: Path, env: str, key: str) -> Path:
    return project / ".drover" / "rollups" / env / LOG_TYPE / f"{key}.json"


def sources_of(files: list[Path]) -> list[list]:
    return [[p.name, p.stat().st_size, p.stat().st_mtime_ns] for p in files]


def sql_string(text: str) -> str:
    return "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'"


def build_rollup(ch, project: Path, env: str, key: str, files: list[Path]) -> dict:
    """Summarise one month of access logs with clickhouse-local."""
    folder = files[0].parent
    if any(p.parent != folder for p in files):
        raise RuntimeError(f"{key}: log files span several folders")
    if any(c in p.name for p in files for c in ",{}*?"):
        raise RuntimeError(f"{key}: unexpected character in a log file name")
    glob = f"{folder}/{{{','.join(p.name for p in files)}}}"
    sql = SQL_PATH.read_text().replace("__GLOB__", sql_string(glob))
    rows = [json.loads(line) for line in ch.run(sql, {"top": str(ROUTES_KEPT)}).splitlines() if line]
    by = {}
    for row in rows:
        by.setdefault(row.pop("section"), []).append(row)
    routes: dict[str, dict] = {}
    for r in by.get("route", []):
        routes.setdefault(r["route"], r)
    y, m = parse_month(key)
    present = sorted(p.name[:10] for p in files)
    expected = [f"{key}-{d:02d}" for d in range(1, calendar.monthrange(y, m)[1] + 1)]
    return {
        "schema": ROLLUP_SCHEMA,
        "log_type": LOG_TYPE,
        "env": env,
        "month": key,
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "clickhouse_version": ch.version,
        "sources": sources_of(files),
        "expected_days": len(expected),
        "present_days": len(present),
        "missing_days": [d for d in expected if d not in present],
        "totals": (by.get("totals") or [{}])[0],
        "days": by.get("day", []),
        "agents": by.get("agent", []),
        "hosts": by.get("host", []),
        "probes": by.get("probe", []),
        "routes": sorted(routes.values(), key=lambda r: (-r["requests"], r["route"])),
    }


def load_or_build(project: Path, env: str, key: str, *, rebuild: bool, ch_holder: dict,
                  log=print) -> dict | None:
    """Return the month's rollup, building it if missing or stale. None if no logs."""
    files = month_files(project, env, key)
    path = rollup_path(project, env, key)
    if not files:
        return None
    if path.exists() and not rebuild:
        cached = json.loads(path.read_text())
        if cached.get("schema") == ROLLUP_SCHEMA and cached.get("sources") == sources_of(files):
            return cached
    if "ch" not in ch_holder:
        ch_holder["ch"] = find_clickhouse()
    log(f"summarising {key}: {len(files)} file(s)")
    rollup = build_rollup(ch_holder["ch"], project, env, key, files)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(rollup, indent=1))
    tmp.replace(path)
    return rollup


# --- trends ----------------------------------------------------------------

def pct(part: float, whole: float) -> float | None:
    return round(100 * part / whole, 2) if whole else None


def change(new: float | None, old: float | None) -> float | None:
    if new is None or not old:
        return None
    return round(100 * (new - old) / old, 1)


def signed(v: float | None) -> str:
    return "–" if v is None else f"{v:+.1f}%"


def rate_change(new: float | None, new_days: int, old: float | None, old_days: int) -> float | None:
    """Change in a per-day rate, so a month with missing days is not read as a drop."""
    if new is None or old is None or not new_days or not old_days:
        return None
    return change(new / new_days, old / old_days)


def month_row(key: str, r: dict | None) -> dict:
    row = {"month": key, "label": month_label(key, short=True), "has_data": r is not None}
    if r is None:
        return row
    t = r["totals"]
    n = t.get("requests", 0)
    by_class = {c: 0 for c, _ in AGENT_CLASSES}
    for a in r["agents"]:
        by_class[a["agent_class"]] = by_class.get(a["agent_class"], 0) + a["requests"]
    # Agents beyond the kept list still count toward their class via day rows.
    day_class = {c: sum(d.get(c.replace("-", "_"), 0) for d in r["days"]) for c, _ in AGENT_CLASSES}
    # Days after today are not missing yet: the current month is still in progress.
    today = date.today().isoformat()
    missing = [d for d in r["missing_days"] if d <= today]
    row.update({
        "present_days": r["present_days"], "expected_days": r["present_days"] + len(missing),
        "missing_days": missing, "in_progress": f"{key}-31" >= today >= f"{key}-01",
        "requests": n, "bytes": t.get("bytes", 0), "unique_ips": t.get("unique_ips", 0),
        "daily_unique_ips": round(sum(d["unique_ips"] for d in r["days"]) / len(r["days"])) if r["days"] else 0,
        "unparsed": t.get("unparsed", 0),
        "p50_ms": t.get("p50_ms"), "p95_ms": t.get("p95_ms"),
        "server_hours": round(t.get("time_ms", 0) / 3.6e6, 1),
        "requests_per_day": round(n / r["present_days"]) if r["present_days"] else 0,
        "share_4xx": pct(t.get("s4xx", 0), n), "share_5xx": pct(t.get("s5xx", 0), n),
        "share_404": pct(t.get("s404", 0), n), "s5xx": t.get("s5xx", 0),
        "share_by_class": {c: pct(day_class[c], n) for c, _ in AGENT_CLASSES},
        "probe_requests": sum(p["requests"] for p in r["probes"]),
    })
    return row


def bar_rows(items: list[dict], value_key: str, total: float) -> list[dict]:
    top = max((i[value_key] for i in items), default=0) or 1
    for i in items:
        i["share_pct"] = pct(i[value_key], total)
        i["width_pct"] = round(100 * i[value_key] / top, 1)
    return items


def build_trends(project_name: str, env: str, keys: list[str], rollups: dict[str, dict | None]) -> dict:
    months = [month_row(k, rollups[k]) for k in keys]
    with_data = [m for m in months if m["has_data"]]
    if not with_data:
        raise SystemExit(f"no {LOG_TYPE} logs for {env} in {keys[0]}..{keys[-1]}")
    latest = with_data[-1]
    prior = with_data[-2] if len(with_data) > 1 else None
    lr = rollups[latest["month"]]
    pr = rollups[prior["month"]] if prior else None

    ld = latest["present_days"]
    pd = prior["present_days"] if prior else 0

    changes = {
        "requests_per_day_pct": rate_change(latest["requests"], ld, prior and prior["requests"], pd),
        "daily_unique_ips_pct": change(latest["daily_unique_ips"], prior["daily_unique_ips"]) if prior else None,
        "p95_ms_pct": change(latest["p95_ms"], prior["p95_ms"]) if prior else None,
        "share_5xx_points": (round(latest["share_5xx"] - prior["share_5xx"], 2) if prior else None),
    }
    change_labels = {k: signed(v) for k, v in changes.items() if k.endswith("_pct")}

    # Named agents (not "browsers"), with the prior month's count beside them.
    prior_agents = {(a["agent_class"], a["agent_name"]): a["requests"] for a in (pr["agents"] if pr else [])}
    agents = [dict(a, prior_requests=prior_agents.get((a["agent_class"], a["agent_name"])),
                   change_pct=rate_change(a["requests"], ld,
                                          prior_agents.get((a["agent_class"], a["agent_name"])), pd),
                   class_label=dict(AGENT_CLASSES)[a["agent_class"]],
                   change_label=signed(rate_change(a["requests"], ld,
                                                   prior_agents.get((a["agent_class"], a["agent_name"])), pd)),
                   server_hours=round(a["time_ms"] / 3.6e6, 1))
              for a in lr["agents"] if a["agent_class"] != "human"][:15]
    bar_rows(agents, "requests", latest["requests"])

    prior_routes = {r["route"]: r for r in (pr["routes"] if pr else [])}

    def route_row(r: dict) -> dict:
        p = prior_routes.get(r["route"])
        return {"route": r["route"], "requests": r["requests"],
                "prior_requests": p["requests"] if p else None,
                "change_pct": rate_change(r["requests"], ld, p["requests"], pd) if p else None,
                "server_hours": round(r["time_ms"] / 3.6e6, 1), "p95_ms": r["p95_ms"],
                "share_non_human": pct(r["non_human"], r["requests"]),
                "s5xx": r["s5xx"], "s404": r["s404"],
                "change_label": signed(rate_change(r["requests"], ld, p["requests"], pd) if p else None)}

    routes_by_requests = [route_row(r) for r in lr["routes"][:15]]
    routes_by_time = [route_row(r) for r in sorted(lr["routes"], key=lambda r: -r["time_ms"])[:15]]
    # Movers: routes busy in both months, ranked by the change in requests per day.
    floor = max(1000, latest["requests"] // 1000)
    movers = []
    if pr:
        for r in lr["routes"]:
            p = prior_routes.get(r["route"])
            if p and max(r["requests"], p["requests"]) >= floor:
                delta = r["requests"] / ld - p["requests"] / pd
                movers.append((delta, route_row(r)))
    risers = [m for d, m in sorted(movers, key=lambda x: -x[0]) if d > 0][:8]
    fallers = [m for d, m in sorted(movers, key=lambda x: x[0]) if d < 0][:8]
    new_routes = [route_row(r) for r in lr["routes"][:50] if pr and r["route"] not in prior_routes][:8]

    probe_by_month = {k: {p["probe"]: p for p in (rollups[k]["probes"] if rollups[k] else [])} for k in keys}
    probes = []
    for cls, label in PROBE_LABELS.items():
        cur = probe_by_month[latest["month"]].get(cls, {})
        probes.append({
            "probe": cls, "label": label,
            "requests": cur.get("requests", 0), "answered_200": cur.get("answered_200", 0),
            "unique_ips": cur.get("unique_ips", 0),
            "per_day_by_month": [
                {"label": m["label"],
                 "value": round(probe_by_month[m["month"]].get(cls, {}).get("requests", 0) / m["present_days"])}
                for m in with_data],
        })
    probes_answered = sum(p["answered_200"] for p in probes)

    series = {
        "requests_per_day": [{"label": m["label"], "value": m["requests_per_day"]} for m in with_data],
        "p95_ms": [{"label": m["label"], "value": m["p95_ms"]} for m in with_data],
        "unique_ips": [{"label": m["label"], "value": m["unique_ips"]} for m in with_data],
        "agent_share": [
            {"label": label, "slot": i + 1,
             "points": [{"label": m["label"], "value": m["share_by_class"][cls] or 0} for m in with_data]}
            for i, (cls, label) in enumerate(AGENT_CLASSES)],
        "daily_requests": [{"label": d["day"][5:], "value": d["requests"]} for d in lr["days"]],
    }

    notes = []
    for m in months:
        if not m["has_data"]:
            notes.append(f"{month_label(m['month'])}: no access logs on disk.")
        if m["has_data"] and m["unparsed"]:
            notes.append(f"{month_label(m['month'])}: {m['unparsed']:,} lines had no status code and count only toward totals.")
        if m["has_data"] and m["in_progress"]:
            notes.append(f"{month_label(m['month'])} is in progress: {m['present_days']} days so far.")
        if m["has_data"] and m["missing_days"]:
            notes.append(f"{month_label(m['month'])}: {len(m['missing_days'])} of {m['expected_days']} days missing; "
                         "per-day rates are used for comparisons.")

    hosts = bar_rows([dict(h) for h in lr["hosts"][:10]], "requests", latest["requests"])
    return {
        "schema_version": 1,
        "kind": "traffic-trends",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "meta": {"project": project_name, "env": env,
                 "month_label": f"{month_label(keys[0], short=True)} – {month_label(keys[-1], short=True)}",
                 "from": keys[0], "through": keys[-1],
                 "latest_label": month_label(latest["month"]),
                 "prior_label": month_label(prior["month"]) if prior else None},
        "months": months,
        "latest": latest, "prior": prior, "changes": changes, "change_labels": change_labels,
        "series": series,
        "agents": agents,
        "hosts": hosts,
        "routes_by_requests": routes_by_requests,
        "routes_by_time": routes_by_time,
        "route_risers": risers, "route_fallers": fallers, "route_new": new_routes,
        "probes": probes, "probes_answered_200": probes_answered,
        "notes": notes,
    }


# --- markdown ----------------------------------------------------------------

def _n(v) -> str:
    return "–" if v is None else f"{v:,}" if isinstance(v, int) else f"{v:,.1f}" if isinstance(v, float) else str(v)


def _p(v) -> str:
    return signed(v)


def render_markdown(t: dict) -> str:
    meta, latest = t["meta"], t["latest"]
    out = [f"# {meta['project']} traffic trends, {meta['month_label']} ({meta['env']})", ""]
    if t["notes"]:
        out += ["> **Coverage:** " + " ".join(t["notes"]), ""]
    c = t["changes"]
    out += [f"## {meta['latest_label']} at a glance", "",
            f"- Requests: {_n(latest['requests'])} ({_n(latest['requests_per_day'])} a day, "
            f"{_p(c['requests_per_day_pct'])} vs {meta['prior_label'] or 'no prior month'})",
            f"- Unique client IPs: {_n(latest['unique_ips'])} in the month, {_n(latest['daily_unique_ips'])} on an average day "
            f"({_p(c['daily_unique_ips_pct'])})",
            f"- Response time: p50 {_n(latest['p50_ms'])} ms, p95 {_n(latest['p95_ms'])} ms ({_p(c['p95_ms_pct'])})",
            f"- Server errors (5xx): {_n(latest['s5xx'])} ({latest['share_5xx']}% of requests)",
            ""]
    out += ["## Month by month", "",
            "| Month | Days | Requests/day | Daily unique IPs | p95 ms | 4xx % | 5xx % | Browsers % | Search % | AI % | Other bots % |",
            "|---|---|---|---|---|---|---|---|---|---|---|"]
    for m in t["months"]:
        if not m["has_data"]:
            out.append(f"| {m['label']} | 0 | – | – | – | – | – | – | – | – | – |")
            continue
        s = m["share_by_class"]
        out.append(f"| {m['label']} | {m['present_days']}/{m['expected_days']} | {_n(m['requests_per_day'])} | "
                   f"{_n(m['daily_unique_ips'])} | {_n(m['p95_ms'])} | {m['share_4xx']} | {m['share_5xx']} | "
                   f"{s['human']} | {s['search']} | {s['ai']} | {s['other-bot']} |")
    out += ["", f"## Crawlers and bots in {meta['latest_label']}", "",
            "| Agent | Class | Requests | Share | Change per day | Server hours |", "|---|---|---|---|---|---|"]
    for a in t["agents"]:
        out.append(f"| {a['agent_name']} | {a['class_label']} | {_n(a['requests'])} | {a['share_pct']}% | "
                   f"{_p(a['change_pct'])} | {_n(a['server_hours'])} |")

    def routes_table(title: str, rows: list[dict]) -> list[str]:
        lines = ["", f"## {title}", "", "| Route | Requests | Change per day | Server hours | p95 ms | Non-human % |",
                 "|---|---|---|---|---|---|"]
        for r in rows:
            lines.append(f"| `{r['route'][:90]}` | {_n(r['requests'])} | {_p(r['change_pct'])} | "
                         f"{_n(r['server_hours'])} | {_n(r['p95_ms'])} | {r['share_non_human']} |")
        return lines

    out += routes_table("Busiest routes", t["routes_by_requests"])
    out += routes_table("Where server time goes", t["routes_by_time"])
    if t["route_risers"]:
        out += routes_table("Biggest risers (requests per day)", t["route_risers"])
    if t["route_fallers"]:
        out += routes_table("Biggest fallers (requests per day)", t["route_fallers"])
    out += ["", "## Security probes (requests per day)", "",
            "| Probe | " + " | ".join(p["label"] for p in t["months"] if p["has_data"]) + " | Answered 200 (latest) |",
            "|---|" + "---|" * (len([m for m in t["months"] if m["has_data"]]) + 1)]
    for p in t["probes"]:
        out.append(f"| {p['label']} | " + " | ".join(_n(x["value"]) for x in p["per_day_by_month"]) +
                   f" | {_n(p['answered_200'])} |")
    out += ["", "## Hosts", "", "| Host | Requests | Share |", "|---|---|---|"]
    for h in t["hosts"]:
        out.append(f"| {h['host']} | {_n(h['requests'])} | {h['share_pct']}% |")
    out += ["", f"_Generated {t['generated_at']} by drover trends from {LOG_TYPE} rollups._", ""]
    return "\n".join(out)


# --- CLI ---------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--project", type=Path, default=Path.cwd())
    p.add_argument("--env", default="prod")
    p.add_argument("--through", type=parse_month, default=None,
                   help="last month to include, YYYY-MM (default: latest month with access logs)")
    p.add_argument("--months", type=int, default=6, help="how many months to compare (default 6)")
    p.add_argument("--format", choices=["md", "json"], default="md")
    p.add_argument("--out", type=Path, default=None)
    p.add_argument("--rebuild", action="store_true", help="rebuild rollups even if they look current")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    project = args.project.resolve()
    manifest_path = project / ".drover" / "manifest.json"
    if not manifest_path.exists():
        print(f"No manifest at {manifest_path}. Run /drover:init first.", file=sys.stderr)
        return 2
    manifest = json.loads(manifest_path.read_text())
    if args.months < 1:
        print("--months must be at least 1", file=sys.stderr)
        return 2
    through = args.through or latest_month_with_logs(project, args.env)
    if through is None:
        print(f"No {LOG_TYPE} logs for env {args.env!r} under {project}. Add {LOG_TYPE} to the "
              "manifest's types for this env (drover:init) and run drover:acquia-pull.", file=sys.stderr)
        return 2
    keys = months_back(through, args.months)
    ch_holder: dict = {}
    try:
        rollups = {k: load_or_build(project, args.env, k, rebuild=args.rebuild, ch_holder=ch_holder,
                                    log=lambda s: print(s, file=sys.stderr)) for k in keys}
    except ClickHouseUnavailable as exc:
        print(exc, file=sys.stderr)
        return 3
    trends = build_trends(manifest.get("project") or project.name, args.env, keys, rollups)
    reports = project / "reports"
    if args.format == "json":
        out = args.out or reports / f"trends-{keys[-1]}.json"
        body = json.dumps(trends, indent=1)
    else:
        out = args.out or reports / f"trends-{keys[-1]}.md"
        body = render_markdown(trends)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body)
    latest = trends["latest"]
    print(f"months: {', '.join(m['label'] + ('' if m['has_data'] else ' (no logs)') for m in trends['months'])}",
          file=sys.stderr)
    print(f"latest: {trends['meta']['latest_label']}, {latest['requests']:,} requests", file=sys.stderr)
    print(f"wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
