#!/usr/bin/env python3
"""Render the scoreboard ledger as one self-contained HTML dashboard.

The scoreboard tracks run quality in aggregate over time, one ledger row per tier 2 or tier 3
evaluation. This page charts the numbers that matter across versions and sites; the detail of
any one run lives in its benchmark report, not here. Everything is inline: no network assets.
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

# Each chart reads one number per row, from the fields run_metrics writes. A metric lists the
# paths it accepts so a renamed field can be read alongside the old name; first match wins.
METRICS = [
    {"id": "fidelity", "title": "Widths that match the live site",
     "note": "Corrected comparison: height and unshared area count.", "unit": "percent",
     "paths": [("correctedWidths.pass", "correctedWidths.total")]},
    {"id": "coverage", "title": "Placements covered by built components",
     "note": "Share of the site's author placements.", "unit": "percent",
     "paths": [("coverage.placementShare",)]},
    {"id": "findings", "title": "Open blocker and major findings",
     "note": "Unwaived, from the verify report.", "unit": "count",
     "paths": [("openFindings.blocker", "openFindings.major")]},
]


def dig(row: dict, path: str):
    value = row
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def metric_value(row: dict, metric: dict):
    """The metric for one row, or None when the row does not carry it."""
    for path in metric["paths"]:
        parts = [dig(row, p) for p in path]
        if any(v is None for v in parts):
            continue
        if metric["unit"] == "percent" and len(parts) == 2:
            return round(100 * parts[0] / parts[1], 1) if parts[1] else None
        if metric["unit"] == "percent":
            share = parts[0]
            return round(share * 100, 1) if share <= 1 else round(share, 1)
        return sum(parts)
    return None


def first(row: dict, *names: str):
    for name in names:
        value = dig(row, name)
        if value not in (None, ""):
            return value
    return None


def normalise(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows:
        out.append({
            "site": first(row, "site", "siteLabel", "site_label") or "unlabelled",
            "version": str(first(row, "version", "pluginVersion", "plugin.version") or "?"),
            "commit": str(first(row, "commit", "pluginCommit", "plugin.commit") or "")[:8],
            "tier": first(row, "tier"),
            "time": str(first(row, "timestamp", "recordedAt", "time") or ""),
            "values": {m["id"]: metric_value(row, m) for m in METRICS},
            "detail": {
                "widths": "%s of %s" % (first(row, "correctedWidths.pass"), first(row, "correctedWidths.total")),
            },
        })
    out.sort(key=lambda r: r["time"])
    return out


def load_rows(ledger: Path) -> list[dict]:
    rows = []
    for line in ledger.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def render(rows: list[dict], title: str = "design-lab scoreboard") -> str:
    data = normalise(rows)
    payload = json.dumps({"rows": data, "metrics": [
        {k: m[k] for k in ("id", "title", "note", "unit")} for m in METRICS]})
    return PAGE.replace("{{TITLE}}", html.escape(title)).replace(
        "{{DATA}}", payload.replace("</", "<\\/"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ledger", required=True, help="JSON Lines ledger")
    ap.add_argument("--out", required=True, help="dashboard HTML to write")
    a = ap.parse_args()
    Path(a.out).write_text(render(load_rows(Path(a.ledger))), encoding="utf-8")
    print(a.out)
    return 0


PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}}</title>
<style>
:root{color-scheme:light;
 --page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;
 --grid:#e1e0d9;--axis:#c3c2b7;--ring:rgba(11,11,11,.10);--up:#006300;--down:#d03b3b;
 --s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--s6:#008300;--s7:#4a3aa7;--s8:#e34948}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;
 --page:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink-2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;
 --ring:rgba(255,255,255,.10);--up:#0ca30c;--down:#e66767;
 --s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#008300;--s7:#9085e9;--s8:#e66767}}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 24px 48px}
header{border-top:3px solid var(--ink);padding-top:14px;margin-bottom:24px}
h1{font-size:22px;margin:0 0 4px;font-weight:650}
.sub{color:var(--ink-2);margin:0}
h2{font-size:15px;margin:32px 0 12px;font-weight:650}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.tile{background:var(--surface);border:1px solid var(--ring);border-radius:10px;padding:14px 16px}
.tile .site{display:flex;align-items:center;gap:8px;font-weight:600}
.key{width:10px;height:10px;border-radius:50%;flex:none}
.tile .label{color:var(--ink-2);font-size:12px;margin-top:10px}
.tile .value{font-size:30px;font-weight:650;line-height:1.1}
.tile .delta{font-size:12px;margin-left:6px;font-weight:600}
.tile .meta{color:var(--muted);font-size:12px;margin-top:8px}
.up{color:var(--up)}.down{color:var(--down)}.flat{color:var(--muted)}
.legend{display:flex;gap:18px;flex-wrap:wrap;color:var(--ink-2);margin:0 0 4px}
.legend span{display:flex;align-items:center;gap:6px}
.charts{display:grid;grid-template-columns:1fr;gap:16px}
.chart{background:var(--surface);border:1px solid var(--ring);border-radius:10px;padding:14px 14px 8px;position:relative}
.chart h3{font-size:14px;margin:0;font-weight:600}
.chart p{margin:2px 0 6px;color:var(--muted);font-size:12px}
svg text{fill:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
svg .end{fill:var(--ink-2);font-size:12px;font-weight:600}
.tip{position:absolute;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--ring);
 border-radius:8px;padding:8px 10px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.12);display:none;white-space:nowrap;z-index:2}
.tip b{display:block;margin-bottom:4px}
.tip div{display:flex;align-items:center;gap:6px}
table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--ring);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--grid);font-variant-numeric:tabular-nums}
th{color:var(--ink-2);font-weight:600;font-size:12px}
td.num,th.num{text-align:right}
.empty{color:var(--ink-2);background:var(--surface);border:1px solid var(--ring);border-radius:10px;padding:24px}
</style></head>
<body><main>
<header><h1>{{TITLE}}</h1><p class="sub" id="sub"></p></header>
<section><h2>Latest evaluation per site</h2><div class="tiles" id="tiles"></div></section>
<section><h2>Across versions</h2><div class="legend" id="legend"></div><div class="charts" id="charts"></div></section>
<section><h2>Every evaluation</h2><div id="table"></div></section>
</main>
<script>
const DATA={{DATA}};
const rows=DATA.rows, metrics=DATA.metrics;
const sites=[...new Set(rows.map(r=>r.site))];
const color=s=>`var(--s${(sites.indexOf(s)%8)+1})`;
const versions=[];rows.forEach(r=>{if(!versions.includes(r.version))versions.push(r.version)});
const fmt=(v,u)=>v==null?"not measured":(u==="percent"?`${v}%`:`${v}`);
const when=t=>{const d=new Date(t);return isNaN(d)?t:d.toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
document.getElementById("sub").textContent=rows.length
 ?`${rows.length} evaluation${rows.length>1?"s":""} across ${sites.length} site${sites.length>1?"s":""} and ${versions.length} version${versions.length>1?"s":""}; last recorded ${when(rows[rows.length-1].time)||"unknown"}.`
 :"No evaluations recorded yet.";
// Stat tiles: the newest row per site, with the change from that site's previous row.
const tiles=document.getElementById("tiles");
for(const s of sites){
 const mine=rows.filter(r=>r.site===s), last=mine[mine.length-1], prev=mine[mine.length-2];
 const v=last.values.fidelity, p=prev?prev.values.fidelity:null;
 let delta="";
 if(v!=null&&p!=null){const d=Math.round((v-p)*10)/10;
  delta=d>0?`<span class="delta up">▲ ${d} points</span>`:d<0?`<span class="delta down">▼ ${Math.abs(d)} points</span>`:`<span class="delta flat">no change</span>`;}
 tiles.insertAdjacentHTML("beforeend",`<div class="tile"><div class="site"><span class="key" style="background:${color(s)}"></span>${esc(s)}</div>
  <div class="label">Widths that match the live site</div><div class="value">${fmt(v,"percent")}${delta}</div>
  <div class="meta">${esc(last.detail.widths)} widths · coverage ${fmt(last.values.coverage,"percent")} · ${fmt(last.values.findings,"count")} open blockers and majors<br>
  ${esc(last.version)}${last.commit?" ("+esc(last.commit)+")":""} · tier ${esc(last.tier??"?")}</div></div>`);
}
const legend=document.getElementById("legend");
sites.forEach(s=>legend.insertAdjacentHTML("beforeend",`<span><span class="key" style="background:${color(s)}"></span>${esc(s)}</span>`));
// One chart per metric; x is the plugin version, each site's newest row for that version.
const W=1100,H=240,M={l:44,r:230,t:12,b:28};
// Four gridline bands, so a count axis needs a top that divides into whole quarters.
function niceMax(max,unit){if(unit==="percent")return 100;const q=Math.max(1,Math.ceil(max/4));const nice=[1,2,5,10,20,25,50,100,250,500,1000].find(n=>n>=q)||q;return nice*4}
function chart(m){
 const series=sites.map(s=>({site:s,pts:versions.map((v,i)=>{const r=rows.filter(x=>x.site===s&&x.version===v).pop();return r&&r.values[m.id]!=null?{i,v:r.values[m.id],row:r}:null}).filter(Boolean)}));
 const all=series.flatMap(x=>x.pts.map(p=>p.v));
 const ymax=niceMax(Math.max(0,...all),m.unit);
 const x=i=>versions.length<2?M.l+(W-M.l-M.r)/2:M.l+i*(W-M.l-M.r)/(versions.length-1);
 const y=v=>M.t+(H-M.t-M.b)*(1-v/ymax);
 let g="";
 for(let k=0;k<=4;k++){const v=ymax*k/4,yy=y(v);g+=`<line x1="${M.l}" x2="${W-M.r}" y1="${yy}" y2="${yy}" stroke="var(--grid)" stroke-width="1"/><text x="${M.l-6}" y="${yy+4}" text-anchor="end">${m.unit==="percent"?Math.round(v)+"%":Math.round(v)}</text>`}
 g+=`<line x1="${M.l}" x2="${W-M.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>`;
 versions.forEach((v,i)=>g+=`<text x="${x(i)}" y="${H-10}" text-anchor="middle">${esc(v)}</text>`);
 const ends=[];
 for(const s of series){if(!s.pts.length)continue;
  const d=s.pts.map((p,k)=>`${k?"L":"M"}${x(p.i)},${y(p.v)}`).join("");
  g+=`<path d="${d}" fill="none" stroke="${color(s.site)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  for(const p of s.pts)g+=`<circle cx="${x(p.i)}" cy="${y(p.v)}" r="4" fill="${color(s.site)}" stroke="var(--surface)" stroke-width="2"/>`;
  const last=s.pts[s.pts.length-1];ends.push({site:s.site,x:x(last.i),y:y(last.v),v:last.v});}
 // End labels: one per site, nudged apart instead of stacked on top of each other.
 ends.sort((a,b)=>a.y-b.y);for(let k=1;k<ends.length;k++)if(ends[k].y-ends[k-1].y<14)ends[k].y=ends[k-1].y+14;
 for(const e of ends)g+=`<text class="end" x="${e.x+10}" y="${e.y+4}">${esc(e.site)} ${fmt(e.v,m.unit)}</text>`;
 g+=`<line class="cross" x1="0" x2="0" y1="${M.t}" y2="${H-M.b}" stroke="var(--axis)" stroke-dasharray="3 3" visibility="hidden"/>`;
 g+=`<rect class="hit" x="${M.l-10}" y="0" width="${W-M.l-M.r+20}" height="${H}" fill="transparent"/>`;
 const el=document.createElement("div");el.className="chart";
 el.innerHTML=`<h3>${esc(m.title)}</h3><p>${esc(m.note)}</p><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(m.title)} by version and site">${g}</svg><div class="tip"></div>`;
 const svg=el.querySelector("svg"),tip=el.querySelector(".tip"),cross=el.querySelector(".cross");
 el.querySelector(".hit").addEventListener("mousemove",ev=>{
  const pt=svg.createSVGPoint();pt.x=ev.clientX;pt.y=ev.clientY;const loc=pt.matrixTransform(svg.getScreenCTM().inverse());
  let best=0,bd=1e9;versions.forEach((v,i)=>{const d=Math.abs(x(i)-loc.x);if(d<bd){bd=d;best=i}});
  cross.setAttribute("x1",x(best));cross.setAttribute("x2",x(best));cross.setAttribute("visibility","visible");
  const lines=series.map(s=>{const p=s.pts.find(p=>p.i===best);return p?`<div><span class="key" style="background:${color(s.site)}"></span>${esc(s.site)}: ${fmt(p.v,m.unit)}</div>`:""}).join("");
  tip.innerHTML=`<b>${esc(versions[best])}</b>${lines||"<div>No evaluation</div>"}`;tip.style.display="block";
  const box=el.getBoundingClientRect();let left=ev.clientX-box.left+14;if(left+tip.offsetWidth>box.width)left=ev.clientX-box.left-tip.offsetWidth-14;
  tip.style.left=left+"px";tip.style.top=(ev.clientY-box.top+10)+"px";});
 el.querySelector(".hit").addEventListener("mouseleave",()=>{tip.style.display="none";cross.setAttribute("visibility","hidden")});
 return el;
}
const charts=document.getElementById("charts");
if(rows.length)metrics.forEach(m=>charts.appendChild(chart(m)));else charts.innerHTML='<div class="empty">Record an evaluation to start the charts.</div>';
// The table is the full record and the accessible view of every chart.
document.getElementById("table").innerHTML=rows.length?`<table><thead><tr><th>Recorded</th><th>Site</th><th>Version</th><th>Tier</th>${metrics.map(m=>`<th class="num">${esc(m.title)}</th>`).join("")}</tr></thead><tbody>${
 rows.slice().reverse().map(r=>`<tr><td style="white-space:nowrap">${esc(when(r.time))}</td><td><span style="display:inline-flex;align-items:center;gap:6px"><span class="key" style="background:${color(r.site)}"></span>${esc(r.site)}</span></td><td>${esc(r.version)}${r.commit?" <span style='color:var(--muted)'>"+esc(r.commit)+"</span>":""}</td><td>${esc(r.tier??"")}</td>${metrics.map(m=>`<td class="num">${fmt(r.values[m.id],m.unit)}</td>`).join("")}</tr>`).join("")
}</tbody></table>`:"";
</script></body></html>
"""


if __name__ == "__main__":
    raise SystemExit(main())
