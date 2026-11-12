"""Render results/bench.json + results/explore.json into results/demo.html."""
from __future__ import annotations

import collections
import html
import json
import platform
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
RES = HERE / "results"
E = html.escape

PY, CH = "Python drover", "clickhouse-local"


def fmt_s(s: float) -> str:
    return f"{s:.1f} s" if s < 90 else f"{s / 60:.1f} min"


def num(n: float) -> str:
    return f"{n:,.0f}"


def bars(rows: list[tuple[str, float, float]]) -> str:
    """Horizontal paired bars: one row per project, Python vs ClickHouse seconds."""
    w, label_w, row_h, bar_h = 760, 190, 46, 15
    vmax = max(max(p, c) for _, p, c in rows) or 1
    plot = w - label_w - 90
    out = [f'<svg viewBox="0 0 {w} {row_h * len(rows) + 10}" role="img" aria-label="Seconds per project">']
    for i, (name, p, c) in enumerate(rows):
        y = i * row_h + 6
        out.append(f'<text x="{label_w - 12}" y="{y + bar_h + 4}" class="lbl" text-anchor="end">{E(name)}</text>')
        for j, (v, cls, who) in enumerate(((p, "s1", PY), (c, "s2", CH))):
            by = y + j * (bar_h + 2)
            bw = max(2, plot * v / vmax)
            out.append(f'<g class="hit"><title>{E(name)} · {who}: {fmt_s(v)}</title>'
                       f'<rect x="{label_w}" y="{by - 2}" width="{plot + 80}" height="{bar_h + 2}" fill="transparent"/>'
                       f'<rect x="{label_w}" y="{by}" width="{bw:.1f}" height="{bar_h}" rx="4" class="{cls}"/>'
                       f'<text x="{label_w + bw + 6:.1f}" y="{by + bar_h - 3}" class="val">{fmt_s(v)}</text></g>')
    out.append("</svg>")
    return "".join(out)


def table(rows: list[dict], cols: list[tuple[str, str]], limit: int | None = None) -> str:
    head = "".join(f"<th>{E(label)}</th>" for _, label in cols)
    body = []
    for r in rows[:limit]:
        cells = []
        for key, _ in cols:
            v = r.get(key, "")
            cls = ' class="n"' if isinstance(v, (int, float)) else ""
            cells.append(f"<td{cls}>{E(num(v) if isinstance(v, int) else str(v))}</td>")
        body.append("<tr>" + "".join(cells) + "</tr>")
    return f'<table><thead><tr>{head}</tr></thead><tbody>{"".join(body)}</tbody></table>'


def main() -> None:
    bench = json.loads((RES / "bench.json").read_text())
    explore = {q["query"]: q for q in json.loads((RES / "explore.json").read_text())}

    py_total = sum(r["python_s"] for r in bench)
    ch_total = sum(r["clickhouse_s"] for r in bench)
    events = sum(r["events"][0] for r in bench)
    identical = sum(r["identical"] for r in bench)

    # Per project (the two ported types carry the volume; php-error is Python in both).
    per = collections.defaultdict(lambda: [0.0, 0.0, 0, 0, 0, 0, 0, 0])
    months = collections.defaultdict(set)
    for r in bench:
        a = per[r["project"]]
        a[0] += r["python_s"]; a[1] += r["clickhouse_s"]; a[2] += r["events"][0]
        a[3] += r["groups"][0]; a[4] += r["identical"]; a[5] += 1
        a[6] = max(a[6], r["python_peak_mb"]); a[7] = max(a[7], r["clickhouse_peak_mb"])
        months[r["project"]].add(r["month"])
    order = sorted(per, key=lambda p: per[p][0], reverse=True)
    chart = bars([(p, per[p][0], per[p][1]) for p in order])

    # Largest single month: what one /drover:report waits on today.
    by_month = collections.defaultdict(lambda: [0.0, 0.0, 0])
    for r in bench:
        k = (r["project"], r["month"])
        by_month[k][0] += r["python_s"]; by_month[k][1] += r["clickhouse_s"]; by_month[k][2] += r["events"][0]
    (bp, bm), (bpy, bch, bev) = max(by_month.items(), key=lambda kv: kv[1][0])

    parity_rows = [{"project": p, "months": len(months[p]), "events": per[p][2], "groups": per[p][3],
                    "checks": f"{per[p][4]} / {per[p][5]} identical",
                    "mem": f"{per[p][6]:,} / {per[p][7]:,}"} for p in order]

    corpus = explore["01_corpus"]
    c_lines = sum(r["lines"] for r in corpus["rows"])
    c_gb = sum(r["bytes"] for r in corpus["rows"]) / 1e9
    c_gz_gb = sum(r["gz_bytes"] for r in corpus["rows"]) / 1e9
    c_files = sum(r["files"] for r in corpus["rows"])
    projects = sorted({r["project"] for r in corpus["rows"]})
    explore_total = sum(q["seconds"] for q in explore.values())

    def card(key: str, cols: list[tuple[str, str]], note: str, limit: int = 8, wide: bool = False) -> str:
        q = explore[key]
        return (f'<section class="card{" wide" if wide else ""}" id="q-{key}"><header><h3>{E(q["title"])}</h3>'
                f'<span class="time">{fmt_s(q["seconds"])}</span></header><p class="note">{note}</p>'
                f'{table(q["rows"], cols, limit)}'
                f'<details><summary>SQL</summary><pre>{E(q["sql"])}</pre></details></section>')


    ch_version = subprocess.run([str(HERE / "bin" / "clickhouse"), "local", "--version"],
                                capture_output=True, text=True).stdout.strip()

    page = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>drover × clickhouse-local</title>
<style>
.viz-root{{color-scheme:light;--surface-0:#f4f3f0;--surface-1:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;
 --muted:#8a8984;--rule:#e2e1dc;--series-1:#2a78d6;--series-2:#eb6834;--good:#0ca30c}}
@media (prefers-color-scheme:dark){{:root:where(:not([data-theme="light"])) .viz-root{{color-scheme:dark;--surface-0:#111110;
 --surface-1:#1a1a19;--text-primary:#f0efec;--text-secondary:#c3c2b7;--muted:#8f8e86;--rule:#2e2e2b;--series-1:#3987e5;--series-2:#d95926}}}}
*{{box-sizing:border-box}}
body{{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
.viz-root{{background:var(--surface-0);color:var(--text-primary);min-height:100vh;padding:40px 48px 80px}}
main{{max-width:1080px;margin:0 auto}}
h1{{font-size:34px;line-height:1.15;margin:0 0 8px;letter-spacing:-.01em}}
h2{{font-size:22px;margin:56px 0 6px}} h3{{font-size:16px;margin:0}}
.lede{{color:var(--text-secondary);font-size:17px;max-width:760px;margin:0}}
.tiles{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:28px 0 0}}
.tile{{background:var(--surface-1);border:1px solid var(--rule);border-radius:10px;padding:18px 20px}}
.tile .big{{font-size:34px;font-weight:650;letter-spacing:-.02em;line-height:1.1}}
.tile .sub{{color:var(--text-secondary);font-size:13.5px;margin-top:6px}}
.tile .k{{color:var(--text-secondary);font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}}
.ok{{color:var(--good)}}
.panel{{background:var(--surface-1);border:1px solid var(--rule);border-radius:10px;padding:20px 22px;margin-top:14px}}
.legend{{display:flex;gap:18px;font-size:13px;color:var(--text-secondary);margin-bottom:8px}}
.legend i{{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}}
svg{{width:100%;height:auto;display:block}}
svg .lbl{{font-size:13px;fill:var(--text-primary)}} svg .val{{font-size:12px;fill:var(--text-secondary)}}
svg .s1{{fill:var(--series-1)}} svg .s2{{fill:var(--series-2)}} svg .hit:hover rect[class]{{opacity:.8}}
table{{border-collapse:collapse;width:100%;font-size:13.5px;margin-top:8px}}
th{{text-align:left;color:var(--text-secondary);font-weight:600;border-bottom:1px solid var(--rule);padding:6px 10px 6px 0}}
td{{border-bottom:1px solid var(--rule);padding:6px 10px 6px 0;vertical-align:top;overflow-wrap:anywhere}}
td.n{{text-align:right;font-variant-numeric:tabular-nums}}
.cards{{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px}}
.card{{background:var(--surface-1);border:1px solid var(--rule);border-radius:10px;padding:18px 20px}}
.card.wide{{grid-column:1/-1}}
.card header{{display:flex;justify-content:space-between;gap:12px;align-items:baseline}}
.time{{font-variant-numeric:tabular-nums;color:var(--text-primary);background:var(--surface-0);border:1px solid var(--rule);
 border-radius:999px;padding:1px 10px;font-size:13px;white-space:nowrap}}
.note{{color:var(--text-secondary);font-size:13.5px;margin:6px 0 4px}}
details{{margin-top:10px;font-size:13px;color:var(--text-secondary)}}
pre{{white-space:pre-wrap;font-size:12px;background:var(--surface-0);padding:10px;border-radius:6px;color:var(--text-primary)}}
.foot{{color:var(--muted);font-size:13px;margin-top:48px;border-top:1px solid var(--rule);padding-top:16px}}
.foot li{{margin:4px 0}}
</style></head>
<body><div class="viz-root"><main>

<h1>drover on clickhouse-local</h1>
<p class="lede">Every drover log captured so far, {len(projects)} projects, run through drover's own Python aggregation
and through a SQL port of it on <code>clickhouse-local</code>: a single free binary, no server, reading the
<code>.log.gz</code> files where they sit.</p>

<div class="tiles">
 <div class="tile" id="t-speed"><div class="k">Same work, every month</div>
  <div class="big">{fmt_s(py_total)} → {fmt_s(ch_total)}</div>
  <div class="sub">{len(by_month)} project-months of error logs, {num(events)} events.
  {py_total / ch_total:.1f}× faster overall.</div></div>
 <div class="tile" id="t-parity"><div class="k">Same answers</div>
  <div class="big ok">{identical} / {len(bench)}</div>
  <div class="sub">project × month × log-type aggregates identical: every fingerprint, count, channel,
  severity, day, summary, first three samples and group order. First/last-seen times not yet produced.</div></div>
 <div class="tile" id="t-corpus"><div class="k">Whole corpus, ad hoc</div>
  <div class="big">{num(c_lines / 1e6)}M lines in {fmt_s(corpus["seconds"])}</div>
  <div class="sub">{c_gb:.1f} GB of log text ({c_gz_gb:.1f} GB gzipped on disk) in {num(c_files)} non-empty files,
  every log type including access logs drover never reads today.</div></div>
</div>

<h2>1 · The monthly report's heavy step</h2>
<p class="lede">Seconds to aggregate apache-error, drupal-watchdog and php-error for every captured month, per project.
The busiest single month, {E(bp)} {bm}, takes {fmt_s(bpy)} in Python and {fmt_s(bch)} in ClickHouse
({num(bev)} events). <code>/drover:report</code> does this twice per run: the month and the prior month.
On small months ClickHouse's start-up, a few tenths of a second, makes it no faster or slightly slower.</p>
<div class="panel" id="chart">
 <div class="legend"><span><i style="background:var(--series-1)"></i>{PY}</span><span><i style="background:var(--series-2)"></i>{CH}</span></div>
 {chart}
</div>

<h2>2 · Identical output</h2>
<p class="lede">Both engines ran on the same files; <code>bench.py</code> compares every group field it produces, the totals and the group order.
Not yet produced: each group's first/last-seen time, which the reports also show.
php-error stays on the Python parser in both columns (tiny volume, stack-trace state machine).
The cost: ClickHouse reads a month at once, so its peak memory is higher than Python's day-at-a-time loop.</p>
<div class="panel" id="parity">{table(parity_rows, [("project", "Project"), ("months", "Months"), ("events", "Events"), ("groups", "Error groups"), ("checks", "Aggregates"), ("mem", "Peak MB, Python / ClickHouse")])}</div>

<h2>3 · Questions across every project at once, {fmt_s(explore_total)} for all of them</h2>
<p class="lede">Each card is one SQL file in <code>sql/explore/</code> run across every project and month at once. The access-log cards answer questions drover has no parser for today.</p>
<div class="cards" id="explore">
{card("04_probes", [("project", "Project"), ("probe", "Probe"), ("requests", "Requests"), ("client_ips", "IPs"), ("pct_200", "% 200")],
      "Grouped by what the probe is after. A 200 answer to a probe deserves a look.", wide=True)}
{card("05_ai_crawlers", [("project", "Project"), ("requests", "Requests"), ("pct_ai", "% AI crawlers"), ("pct_search", "% search"), ("pct_any_bot", "% any bot")],
      "Who is actually reading each site.")}
{card("03_slow_routes", [("project", "Project"), ("route", "Route"), ("hits", "Hits"), ("p95_ms", "p95 ms"), ("server_hours", "Server hours")],
      "Where server time goes: busy routes ranked by total response time.", 10, wide=True)}
{card("06_watchdog_noise", [("project", "Project"), ("channel", "Channel"), ("entries", "Entries"), ("pct", "%")],
      "Top three channels per site, by entries.", 30)}
{card("01_corpus", [("project", "Project"), ("log_type", "Type"), ("files", "Files"), ("lines", "Lines")],
      "The corpus itself.", 40)}
{card("02_traffic_health", [("project", "Project"), ("month", "Month"), ("requests", "Requests"), ("pct_5xx", "% 5xx"), ("pct_404", "% 404"), ("p50_ms", "p50 ms"), ("p95_ms", "p95 ms")],
      "Monthly traffic health per site from Apache access logs.", 60, wide=True)}
</div>

<div class="foot"><ul>
<li>Python numbers: <code>scripts/aggregate.aggregate_files()</code> unchanged, one child process per project × month × type, Jev off.
ClickHouse numbers: <code>ch_aggregate.aggregate_type()</code> (<code>sql/watchdog.sql</code>, <code>sql/apache_error.sql</code>), same process model, including ClickHouse start-up.</li>
<li>{E(ch_version)} · {E(platform.platform())} · {E(platform.machine())}. Times are wall-clock, single run, one benchmark at a time.</li>
<li>Out of scope here: first/last-seen times, report rendering, Jev classification, cause collapse and month-over-month deltas.</li>
</ul></div>
</main></div></body></html>"""
    (RES / "demo.html").write_text(page)
    print(RES / "demo.html")


if __name__ == "__main__":
    main()
