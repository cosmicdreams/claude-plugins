import { readFileSync } from 'node:fs';

export const METRICS = [
  {
    id: 'fidelity',
    title: 'Widths that match the live site',
    note: 'Corrected comparison: height and unshared area count.',
    unit: 'percent',
    paths: [['correctedWidths.pass', 'correctedWidths.total']],
  },
  {
    id: 'coverage',
    title: 'Placements covered by built components',
    note: "Share of the site's author placements.",
    unit: 'percent',
    paths: [['coverage.placementShare']],
  },
  {
    id: 'findings',
    title: 'Open blocker and major findings',
    note: 'Unwaived, from the verify report.',
    unit: 'count',
    paths: [['openFindings.blocker', 'openFindings.major']],
  },
] as const;
function dig(row: any, path: string): any {
  let value = row;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !(part in value)) return null;
    value = value[part];
  }
  return value;
}
export function metricValue(row: any, metric: (typeof METRICS)[number]): number | null {
  for (const paths of metric.paths) {
    const parts = paths.map((path) => dig(row, path));
    if (parts.some((v) => v === null || v === undefined)) continue;
    if (metric.unit === 'percent' && parts.length === 2)
      return parts[1] ? Math.round((1000 * parts[0]) / parts[1]) / 10 : null;
    if (metric.unit === 'percent') return Math.round((parts[0] <= 1 ? parts[0] * 100 : parts[0]) * 10) / 10;
    return parts.reduce((sum, value) => sum + value, 0);
  }
  return null;
}
function first(row: any, ...names: string[]): any {
  for (const name of names) {
    const value = dig(row, name);
    if (value !== null && value !== '') return value;
  }
  return null;
}
export function normalise(rows: any[]) {
  return rows
    .map((row) => ({
      site: first(row, 'site', 'siteLabel', 'site_label') || 'unlabelled',
      version: String(first(row, 'version', 'pluginVersion', 'plugin.version') || '?'),
      commit: String(first(row, 'commit', 'pluginCommit', 'plugin.commit') || '').slice(0, 8),
      tier: first(row, 'tier'),
      time: String(first(row, 'timestamp', 'recordedAt', 'time') || ''),
      values: Object.fromEntries(METRICS.map((m) => [m.id, metricValue(row, m)])),
      detail: { widths: `${first(row, 'correctedWidths.pass')} of ${first(row, 'correctedWidths.total')}` },
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}
export const normalize = normalise;
export function loadRows(path: string): any[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
const PAGE =
  '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>{{TITLE}}</title>\n<style>\n:root{color-scheme:light;\n --page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;\n --grid:#e1e0d9;--axis:#c3c2b7;--ring:rgba(11,11,11,.10);--up:#006300;--down:#d03b3b;\n --s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--s6:#008300;--s7:#4a3aa7;--s8:#e34948}\n@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;\n --page:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink-2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;\n --ring:rgba(255,255,255,.10);--up:#0ca30c;--down:#e66767;\n --s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#008300;--s7:#9085e9;--s8:#e66767}}\n*{box-sizing:border-box}\nbody{margin:0;background:var(--page);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}\nmain{max-width:1180px;margin:0 auto;padding:32px 24px 48px}\nheader{border-top:3px solid var(--ink);padding-top:14px;margin-bottom:24px}\nh1{font-size:22px;margin:0 0 4px;font-weight:650}\n.sub{color:var(--ink-2);margin:0}\nh2{font-size:15px;margin:32px 0 12px;font-weight:650}\n.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}\n.tile{background:var(--surface);border:1px solid var(--ring);border-radius:10px;padding:14px 16px}\n.tile .site{display:flex;align-items:center;gap:8px;font-weight:600}\n.key{width:10px;height:10px;border-radius:50%;flex:none}\n.tile .label{color:var(--ink-2);font-size:12px;margin-top:10px}\n.tile .value{font-size:30px;font-weight:650;line-height:1.1}\n.tile .delta{font-size:12px;margin-left:6px;font-weight:600}\n.tile .meta{color:var(--muted);font-size:12px;margin-top:8px}\n.up{color:var(--up)}.down{color:var(--down)}.flat{color:var(--muted)}\n.legend{display:flex;gap:18px;flex-wrap:wrap;color:var(--ink-2);margin:0 0 4px}\n.legend span{display:flex;align-items:center;gap:6px}\n.charts{display:grid;grid-template-columns:1fr;gap:16px}\n.chart{background:var(--surface);border:1px solid var(--ring);border-radius:10px;padding:14px 14px 8px;position:relative}\n.chart h3{font-size:14px;margin:0;font-weight:600}\n.chart p{margin:2px 0 6px;color:var(--muted);font-size:12px}\nsvg text{fill:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}\nsvg .end{fill:var(--ink-2);font-size:12px;font-weight:600}\n.tip{position:absolute;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--ring);\n border-radius:8px;padding:8px 10px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.12);display:none;white-space:nowrap;z-index:2}\n.tip b{display:block;margin-bottom:4px}\n.tip div{display:flex;align-items:center;gap:6px}\ntable{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--ring);border-radius:10px;overflow:hidden}\nth,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--grid);font-variant-numeric:tabular-nums}\nth{color:var(--ink-2);font-weight:600;font-size:12px}\ntd.num,th.num{text-align:right}\n.empty{color:var(--ink-2);background:var(--surface);border:1px solid var(--ring);border-radius:10px;padding:24px}\n</style></head>\n<body><main>\n<header><h1>{{TITLE}}</h1><p class="sub" id="sub"></p></header>\n<section><h2>Latest evaluation per site</h2><div class="tiles" id="tiles"></div></section>\n<section><h2>Across versions</h2><div class="legend" id="legend"></div><div class="charts" id="charts"></div></section>\n<section><h2>Every evaluation</h2><div id="table"></div></section>\n</main>\n<script>\nconst DATA={{DATA}};\nconst rows=DATA.rows, metrics=DATA.metrics;\nconst sites=[...new Set(rows.map(r=>r.site))];\nconst color=s=>`var(--s${(sites.indexOf(s)%8)+1})`;\nconst versions=[];rows.forEach(r=>{if(!versions.includes(r.version))versions.push(r.version)});\nconst fmt=(v,u)=>v==null?"not measured":(u==="percent"?`${v}%`:`${v}`);\nconst when=t=>{const d=new Date(t);return isNaN(d)?t:d.toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})};\nconst esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;"}[c]));\ndocument.getElementById("sub").textContent=rows.length\n ?`${rows.length} evaluation${rows.length>1?"s":""} across ${sites.length} site${sites.length>1?"s":""} and ${versions.length} version${versions.length>1?"s":""}; last recorded ${when(rows[rows.length-1].time)||"unknown"}.`\n :"No evaluations recorded yet.";\n// Stat tiles: the newest row per site, with the change from that site\'s previous row.\nconst tiles=document.getElementById("tiles");\nfor(const s of sites){\n const mine=rows.filter(r=>r.site===s), last=mine[mine.length-1], prev=mine[mine.length-2];\n const v=last.values.fidelity, p=prev?prev.values.fidelity:null;\n let delta="";\n if(v!=null&&p!=null){const d=Math.round((v-p)*10)/10;\n  delta=d>0?`<span class="delta up">▲ ${d} points</span>`:d<0?`<span class="delta down">▼ ${Math.abs(d)} points</span>`:`<span class="delta flat">no change</span>`;}\n tiles.insertAdjacentHTML("beforeend",`<div class="tile"><div class="site"><span class="key" style="background:${color(s)}"></span>${esc(s)}</div>\n  <div class="label">Widths that match the live site</div><div class="value">${fmt(v,"percent")}${delta}</div>\n  <div class="meta">${esc(last.detail.widths)} widths · coverage ${fmt(last.values.coverage,"percent")} · ${fmt(last.values.findings,"count")} open blockers and majors<br>\n  ${esc(last.version)}${last.commit?" ("+esc(last.commit)+")":""} · tier ${esc(last.tier??"?")}</div></div>`);\n}\nconst legend=document.getElementById("legend");\nsites.forEach(s=>legend.insertAdjacentHTML("beforeend",`<span><span class="key" style="background:${color(s)}"></span>${esc(s)}</span>`));\n// One chart per metric; x is the plugin version, each site\'s newest row for that version.\nconst W=1100,H=240,M={l:44,r:230,t:12,b:28};\n// Four gridline bands, so a count axis needs a top that divides into whole quarters.\nfunction niceMax(max,unit){if(unit==="percent")return 100;const q=Math.max(1,Math.ceil(max/4));const nice=[1,2,5,10,20,25,50,100,250,500,1000].find(n=>n>=q)||q;return nice*4}\nfunction chart(m){\n const series=sites.map(s=>({site:s,pts:versions.map((v,i)=>{const r=rows.filter(x=>x.site===s&&x.version===v).pop();return r&&r.values[m.id]!=null?{i,v:r.values[m.id],row:r}:null}).filter(Boolean)}));\n const all=series.flatMap(x=>x.pts.map(p=>p.v));\n const ymax=niceMax(Math.max(0,...all),m.unit);\n const x=i=>versions.length<2?M.l+(W-M.l-M.r)/2:M.l+i*(W-M.l-M.r)/(versions.length-1);\n const y=v=>M.t+(H-M.t-M.b)*(1-v/ymax);\n let g="";\n for(let k=0;k<=4;k++){const v=ymax*k/4,yy=y(v);g+=`<line x1="${M.l}" x2="${W-M.r}" y1="${yy}" y2="${yy}" stroke="var(--grid)" stroke-width="1"/><text x="${M.l-6}" y="${yy+4}" text-anchor="end">${m.unit==="percent"?Math.round(v)+"%":Math.round(v)}</text>`}\n g+=`<line x1="${M.l}" x2="${W-M.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>`;\n versions.forEach((v,i)=>g+=`<text x="${x(i)}" y="${H-10}" text-anchor="middle">${esc(v)}</text>`);\n const ends=[];\n for(const s of series){if(!s.pts.length)continue;\n  const d=s.pts.map((p,k)=>`${k?"L":"M"}${x(p.i)},${y(p.v)}`).join("");\n  g+=`<path d="${d}" fill="none" stroke="${color(s.site)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;\n  for(const p of s.pts)g+=`<circle cx="${x(p.i)}" cy="${y(p.v)}" r="4" fill="${color(s.site)}" stroke="var(--surface)" stroke-width="2"/>`;\n  const last=s.pts[s.pts.length-1];ends.push({site:s.site,x:x(last.i),y:y(last.v),v:last.v});}\n // End labels: one per site, nudged apart instead of stacked on top of each other.\n ends.sort((a,b)=>a.y-b.y);for(let k=1;k<ends.length;k++)if(ends[k].y-ends[k-1].y<14)ends[k].y=ends[k-1].y+14;\n for(const e of ends)g+=`<text class="end" x="${e.x+10}" y="${e.y+4}">${esc(e.site)} ${fmt(e.v,m.unit)}</text>`;\n g+=`<line class="cross" x1="0" x2="0" y1="${M.t}" y2="${H-M.b}" stroke="var(--axis)" stroke-dasharray="3 3" visibility="hidden"/>`;\n g+=`<rect class="hit" x="${M.l-10}" y="0" width="${W-M.l-M.r+20}" height="${H}" fill="transparent"/>`;\n const el=document.createElement("div");el.className="chart";\n el.innerHTML=`<h3>${esc(m.title)}</h3><p>${esc(m.note)}</p><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(m.title)} by version and site">${g}</svg><div class="tip"></div>`;\n const svg=el.querySelector("svg"),tip=el.querySelector(".tip"),cross=el.querySelector(".cross");\n el.querySelector(".hit").addEventListener("mousemove",ev=>{\n  const pt=svg.createSVGPoint();pt.x=ev.clientX;pt.y=ev.clientY;const loc=pt.matrixTransform(svg.getScreenCTM().inverse());\n  let best=0,bd=1e9;versions.forEach((v,i)=>{const d=Math.abs(x(i)-loc.x);if(d<bd){bd=d;best=i}});\n  cross.setAttribute("x1",x(best));cross.setAttribute("x2",x(best));cross.setAttribute("visibility","visible");\n  const lines=series.map(s=>{const p=s.pts.find(p=>p.i===best);return p?`<div><span class="key" style="background:${color(s.site)}"></span>${esc(s.site)}: ${fmt(p.v,m.unit)}</div>`:""}).join("");\n  tip.innerHTML=`<b>${esc(versions[best])}</b>${lines||"<div>No evaluation</div>"}`;tip.style.display="block";\n  const box=el.getBoundingClientRect();let left=ev.clientX-box.left+14;if(left+tip.offsetWidth>box.width)left=ev.clientX-box.left-tip.offsetWidth-14;\n  tip.style.left=left+"px";tip.style.top=(ev.clientY-box.top+10)+"px";});\n el.querySelector(".hit").addEventListener("mouseleave",()=>{tip.style.display="none";cross.setAttribute("visibility","hidden")});\n return el;\n}\nconst charts=document.getElementById("charts");\nif(rows.length)metrics.forEach(m=>charts.appendChild(chart(m)));else charts.innerHTML=\'<div class="empty">Record an evaluation to start the charts.</div>\';\n// The table is the full record and the accessible view of every chart.\ndocument.getElementById("table").innerHTML=rows.length?`<table><thead><tr><th>Recorded</th><th>Site</th><th>Version</th><th>Tier</th>${metrics.map(m=>`<th class="num">${esc(m.title)}</th>`).join("")}</tr></thead><tbody>${\n rows.slice().reverse().map(r=>`<tr><td style="white-space:nowrap">${esc(when(r.time))}</td><td><span style="display:inline-flex;align-items:center;gap:6px"><span class="key" style="background:${color(r.site)}"></span>${esc(r.site)}</span></td><td>${esc(r.version)}${r.commit?" <span style=\'color:var(--muted)\'>"+esc(r.commit)+"</span>":""}</td><td>${esc(r.tier??"")}</td>${metrics.map(m=>`<td class="num">${fmt(r.values[m.id],m.unit)}</td>`).join("")}</tr>`).join("")\n}</tbody></table>`:"";\n</script></body></html>\n';
function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]!,
  );
}
function canonicalString(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) => {
    const code = char.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${code}`;
  });
}
function canonicalDump(value: any, key = ''): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return canonicalString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Out of range float values are not JSON compliant');
    const text = String(value);
    return ['fidelity', 'coverage'].includes(key) && Number.isInteger(value) ? `${text}.0` : text;
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalDump(item)).join(', ')}]`;
  if (typeof value === 'object')
    return `{${Object.entries(value)
      .map(([k, item]) => `${canonicalString(k)}: ${canonicalDump(item, k)}`)
      .join(', ')}}`;
  throw new TypeError('value is not JSON serializable');
}
export function render(rows: any[], title = 'design-lab scoreboard'): string {
  const data = normalise(rows);
  const payload = canonicalDump({
    rows: data,
    metrics: METRICS.map(({ id, title: metricTitle, note, unit }) => ({ id, title: metricTitle, note, unit })),
  });
  return PAGE.replaceAll('{{TITLE}}', () => escapeHtml(title)).replace('{{DATA}}', () =>
    payload.replace(/<\//g, '<\\/'),
  );
}
