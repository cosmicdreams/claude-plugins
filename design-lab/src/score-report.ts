/** Self-contained benchmark report, preserving the baseline oracle's text, charts and styles. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sharedRequire } from './runtime.ts';
import { roundEven } from './json.ts';
import { resizeRgb } from './report-images.ts';
import * as library_counts from './library-counts.ts';
import { flattenRgbaOverWhite } from './figma-compare.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;

// Small value helpers preserve empty-container truthiness and lexicographic tuple ordering.
function truth(v: any): boolean { return v != null && (typeof v === 'object' ? v instanceof Set ? v.size > 0 : Object.keys(v).length > 0 : !!v); }
function either(...values: (() => any)[]): any { let v; for (const f of values) { v=f(); if(truth(v)) return v; } return v; }
function both(...values: (() => any)[]): any { let v; for (const f of values) { v=f(); if(!truth(v)) return v; } return v; }
function iterable(v: any): any[] { return v == null ? [] : typeof v[Symbol.iterator] === 'function' ? [...v] : Object.keys(v); }
function key(k: any): string { return Array.isArray(k) ? JSON.stringify(k) : String(k); }
function get(v: any, k: any, fallback: any = null): any { return Object.hasOwn(v ?? {}, key(k)) ? v[key(k)] : fallback; }
function at(v: any, k: any): any { return Array.isArray(v) || typeof v === 'string' ? v[k < 0 ? v.length + k : k] : v[key(k)]; }
function set(v: any, k: any, value: any): void { v[key(k)] = value; }
function setdefault(v: any, k: any, value: any): any { if(!Object.hasOwn(v,key(k))) v[key(k)]=value; return v[key(k)]; }
function pyItems(v: any): any[] { return Object.entries(v).map(([k,val]) => [k.startsWith('[') ? JSON.parse(k) : k,val]); }
function pyKeys(v: any): any[] { return Object.keys(v); }
function pyValues(v: any): any[] { return Object.values(v); }
function contains(v: any, x: any): boolean { return Array.isArray(v) || typeof v === 'string' ? v.includes(x) : v instanceof Set ? v.has(x) : Object.hasOwn(v,key(x)); }
function len(v: any): number { return v instanceof Set ? v.size : Array.isArray(v) || typeof v === 'string' ? v.length : Object.keys(v).length; }
function add(a: any,b: any): any { return Array.isArray(a) ? [...a,...b] : a+b; }
function mul(a: any,b: any): any { return Array.isArray(a) ? Array.from({length:b},()=>a).flat() : typeof a === 'string' ? a.repeat(b) : a*b; }
function slice(v: any,a?:number,b?:number): any { return v.slice(a,b); }
function compare(a: any,b: any): number { if(Array.isArray(a)&&Array.isArray(b)) { for(let i=0;i<Math.min(a.length,b.length);i++){const c=compare(a[i],b[i]);if(c)return c;}return a.length-b.length;} return a<b ? -1 : a>b ? 1 : 0; }
function sorted(v: any,by: (v:any)=>any = x=>x): any[] { return iterable(v).sort((a,b)=>compare(by(a),by(b))); }
function sum(v: any): number { return iterable(v).reduce((a,b)=>a+Number(b),0); }
function maximum(...v: any[]): number { return Array.isArray(v[0]) ? Math.max(...v[0],...(v[0].length ? [] : [v[1] ?? -Infinity])) : Math.max(...v); }
function minimum(...v: any[]): number { return Array.isArray(v[0]) ? Math.min(...v[0]) : Math.min(...v); }
function any(v: any): boolean { return iterable(v).some(truth); }
function enumerate(v: any): any[] { return iterable(v).map((x,i)=>[i,x]); }
function zip(a: any,b: any): any[] { return iterable(a).slice(0,len(b)).map((x,i)=>[x,b[i]]); }
function range(a: number,b?:number): number[] { return Array.from({length:Math.max(0,b===undefined?a:b-a)},(_,i)=>i+(b===undefined?0:a)); }
function replace(s: string,a:string,b:string,count?:number): string { return count===1 ? s.replace(a,()=>b) : s.replaceAll(a,()=>b); }
function pyString(v: any): string { return v == null ? 'None' : v === true ? 'True' : v === false ? 'False' : String(v); }
/** baseline's fixed point format rounds ties to even (including binary decimal representation). */
function fixed(v: number,digits: number): string {
  if(!Number.isFinite(v)) return String(v);
  const negative=v<0||Object.is(v,-0), data=new DataView(new ArrayBuffer(8)); data.setFloat64(0,Math.abs(v));
  const bits=data.getBigUint64(0), exponent=Number((bits>>52n)&2047n), fraction=bits&((1n<<52n)-1n);
  let numerator=(exponent?fraction+(1n<<52n):fraction)*10n**BigInt(digits), denominator=1n;
  const shift=(exponent?exponent-1023:1-1023)-52; if(shift>=0)numerator<<=BigInt(shift);else denominator<<=BigInt(-shift);
  let n=numerator/denominator; const rem=numerator%denominator; if(rem*2n>denominator||(rem*2n===denominator&&n%2n))n++;
  const s=n.toString().padStart(digits+1,'0'); return (negative?'-':'')+(digits?s.slice(0,-digits)+'.'+s.slice(-digits):s);
}
function floatString(v:number):string {return Number.isInteger(v)?v.toFixed(1):String(v);}
function format(v: any,spec=''): string { if(!spec)return pyString(v); if(spec==='g')return Number(v.toPrecision(6)).toString(); const m=/^(,)?\.(\d+)f$/.exec(spec); if(!m)throw new Error('unsupported report format '+spec); const out=fixed(Number(v),Number(m[2]));return m[1]?out.replace(/\B(?=(\d{3})+(?!\d))/g,','):out; }
export function esc(v:any):string { return (v==null?'':pyString(v)).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#x27;'); }
export function num(v:any):string { if(v==null)return '–'; const out=Number.isInteger(v)?String(Math.trunc(v)):fixed(v,1);const [integer,decimal]=out.split('.');return integer!.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(decimal===undefined?'':'.'+decimal); }
export function pct(v:any,digits=0):string {return v==null?'–':fixed(v*100,digits)+'%';}
export function duration(v:any):string {if(v==null)return '–';const s=Math.trunc(v);if(s<90)return `${s} s`;const hours=Math.floor(s/3600),rest=s%3600;return hours?`${hours} h ${roundEven(rest/60)} min`:rest%60?`${Math.floor(rest/60)} min ${rest%60} s`:`${Math.floor(rest/60)} min`;}
export function split_duration(v:any):[string,string] {const s=roundEven(v);if(s<90)return [String(s),' s'];const hours=Math.floor(s/3600),rest=s%3600;return hours?[String(hours),` h ${roundEven(rest/60)} min`]:[String(Math.floor(rest/60)),rest%60?` min ${rest%60} s`:' min'];}
function date(v:any):Date|null {if(v==null)return null;const d=new Date(String(v));return Number.isNaN(d.getTime())?null:d;}
export function day(v:any):string {const d=date(v);if(!d)return 'date not recorded'; // fromisoformat retains the written date's offset, without converting to local time.
 const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));if(!m)return 'date not recorded';const months=['January','February','March','April','May','June','July','August','September','October','November','December'];return `${Number(m[3])} ${months[Number(m[2])-1]} ${m[1]}`;}
export function stamp(v:any):string {const d=date(v);if(!d)return '–';return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
export function compact(v:any):string {if(v==null)return '–';for(const [size,suffix] of [[1e9,'B'],[1e6,'M'],[1e3,'k']] as const){if(v>=size){const f=v/size;return fixed(f,f<10?1:0)+suffix;}}return String(v);}

export interface Thumbnail {src:string;w:number;h:number;cropped:boolean}
export async function thumbnails(runDir:string,pairs:any[],breakpoint:string):Promise<Record<string,Record<string,Thumbnail>>> {
 const wanted:Record<string,any>={};for(const p of pairs)if(p.breakpoint===breakpoint&&p.evidence)wanted[p.component]=p;
 const result:Record<string,Record<string,Thumbnail>>={};
 for(const [component,pair] of Object.entries(wanted)) {
  const ev=pair.evidence;
  // Geometry-file read errors deliberately propagate, matching the oracle.
  const geometry=JSON.parse(readFileSync(resolve(runDir,ev.geometry),'utf8')).geometry??{};
  let canvas:Buffer,info:{width:number;height:number;channels:number};let variant:any,capture:any;
  try{variant=geometry.variants[ev.index];capture=geometry.captures[ev.index];if(!variant||!capture)continue;const decoded=await sharp(resolve(runDir,ev.specimen)).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});canvas=Buffer.from(flattenRgbaOverWhite(decoded.data));info=decoded.info;}catch{continue;}
  const shots:Record<string,Thumbnail>={};
  for(const [side,box] of [['figma',variant],['live',capture]] as const){
   const x=roundEven(box.x),y=roundEven(box.y),w=roundEven(box.width),h=roundEven(box.height);
   if(w<=0||h<=0)throw new Error('invalid thumbnail crop');
   // Pillow permits out-of-bounds crops and pads them black.
   const raw=Buffer.alloc(w*h*3);
   for(let row=0;row<h;row++){const sy=y+row,left=Math.max(0,x),right=Math.min(info.width,x+w);if(sy<0||sy>=info.height||right<=left)continue;canvas.copy(raw,(row*w+left-x)*3,(sy*info.width+left)*3,(sy*info.width+right)*3);}
   const scale=Math.min(1,THUMB_WIDTH/Math.max(1,w)),width=Math.max(1,roundEven(w*scale)),height=Math.max(1,roundEven(h*scale)),cropped=height>THUMB_MAX_HEIGHT;
   const resized=resizeRgb(raw,w,h,width,height,Math.min(height,THUMB_MAX_HEIGHT));
   const bytes=await sharp(resized,{raw:{width,height:Math.min(height,THUMB_MAX_HEIGHT),channels:3}}).webp({quality:72,effort:5}).toBuffer();
   shots[side]={src:'data:image/webp;base64,'+bytes.toString('base64'),w:width,h:Math.min(height,THUMB_MAX_HEIGHT),cropped};
  }
  result[component]=shots;
 }
 return result;
}

const BREAKPOINT_NAMES: any = {["desktop"]: "Desktop", ["tablet"]: "Tablet", ["mobile"]: "Mobile"};

const BP_ORDER: any = {["desktop"]: 0, ["tablet"]: 1, ["mobile"]: 2};

const RATIO_EDGES: any = [0.02, 0.04, 0.06, 0.09, 0.12, 0.18, 0.25, 0.35, 0.5];

const HEIGHT_EDGES: any = [1, 2, 5, 10, 25, 50, 100];

const BINS: any = [[0.02, "q5", "under 2%"], [0.06, "q4", "2–6%"], [0.12, "q3", "6–12%"], [0.25, "q2", "12–25%"], [9.0, "q1", "over 25%"]];

const THUMB_WIDTH: any = 520;

const THUMB_MAX_HEIGHT: any = 300;

export function coverage_strip(cov: any): any {
  let breakdown: any, g: any, gap: any, gap_first: any, item: any, items: any, k: any, kind: any, labels: any, n: any, name: any, o: any, op: any, os_: any, out: any, outside: any, parts: any, row: any, squares: any, usage: any, weighted: any;
  if (truth(((get(cov, "status") !== "measured")))) {
    return "";
  }
  labels = either(() => (get(cov, "reasonLabels")), () => ({}));
  items = either(() => (get(cov, "items")), () => ([]));
  breakdown = either(() => (get(cov, "coverBreakdown")), () => ([{["tier"]: "Other", ["built"]: at(cov, "built")}]));
  squares = [];
  for (const row of iterable(breakdown)) {
    name = get(library_counts.COVER_LABELS, at(row, "tier"), at(row, "tier"));
    squares = add(squares, mul([("<span class=\"c-built\" style=\"background:" + format(at(library_counts.TIER_COLORS, at(row, "tier")), "") + "\" data-tier=\"" + format(esc(at(row, "tier")), "") + "\" title=\"built · " + format(esc(name), "") + "\"></span>")], at(row, "built")));
  }
  gap_first = sorted(items, (item: any) => (!contains(either(() => (get(cov, "gap")), () => ({})), at(item, "reason"))));
  for (const item of iterable(gap_first)) {
    kind = (truth((contains(either(() => (get(cov, "gap")), () => ({})), at(item, "reason")))) ? "c-gap" : (truth(((at(item, "reason") === "retirement"))) ? "c-out c-retire" : "c-out"));
    squares.push(("<span class=\"" + format(kind, "") + "\" title=\"" + format(esc(at(item, "label")), "") + ": " + format(esc(get(labels, at(item, "reason"))), "") + "\"></span>"));
  }
  gap = iterable(pyItems(either(() => (get(cov, "gap")), () => ({})))).filter(([k, n]: any) => truth(n)).map(([k, n]: any) => (format(n, "") + " " + format(get(labels, k, k), "")));
  out = iterable(pyItems(either(() => (get(cov, "excluded")), () => ({})))).filter(([k, n]: any) => truth(n)).map(([k, n]: any) => ("<span class=\"key " + format((truth(((k === "retirement"))) ? "key-retire" : "key-out"), "") + "\"></span>" + format(n, "") + " " + format(esc(get(labels, k, k)), "") + format((truth(both(() => (((n !== 1))), () => (((k === "retirement"))))) ? "s" : ""), "")));
  usage = either(() => (get(cov, "usageWeighted")), () => ({}));
  parts = iterable(breakdown).map((row: any) => ("<span class=\"key\" style=\"--k:" + format(at(library_counts.TIER_COLORS, at(row, "tier")), "") + "\"></span><b>" + format(at(row, "built"), "") + "</b> " + format(esc(get(library_counts.COVER_LABELS, at(row, "tier"), at(row, "tier"))), "")));
  if (truth(gap)) {
    parts.push(add("<span class=\"key key-gap\"></span>not built: ", iterable(iterable(gap).map((g: any) => esc(g))).map(pyString).join("; ")));
  }
  if (truth(out)) {
    parts.push(add("not counted: ", iterable(out).map(pyString).join("; ")));
  }
  weighted = (truth(get(usage, "placements")) ? add(add(("<p class=\"cov-w\">Built components carry <b>" + format(num(at(usage, "covered")), "") + " of " + format(num(at(usage, "placements")), "") + "</b> placements on the site (<b>" + format(mul(at(usage, "ratio"), 100), (".0f")) + "%</b>)"), (truth(get(usage, "structuralRefs")) ? (" and " + format(num(at(usage, "structuralCovered")), "") + " of " + format(num(at(usage, "structuralRefs")), "") + " nested uses") : "")), ".</p>") : "");
  outside = either(() => (get(cov, "outsideInventory")), () => ([]));
  if (truth(both(() => (outside), () => (weighted)))) {
    [op, os_] = [sum(iterable(outside).map((o: any) => at(o, "placements"))), sum(iterable(outside).map((o: any) => at(o, "structural")))];
    weighted = replace(weighted, "</p>", (" The usage scan also saw " + format(len(outside), "") + " item" + format((truth(((len(outside) !== 1))) ? "s" : ""), "") + " outside the inventory (" + format(op, "") + " placement" + format((truth(((op !== 1))) ? "s" : ""), "") + ", " + format(os_, "") + " nested use" + format((truth(((os_ !== 1))) ? "s" : ""), "") + "), not counted here.</p>"), 1);
  }
  return ("<div class=\"cov\" role=\"img\" aria-label=\"" + format(esc(get(cov, "summary")), "") + "\" style=\"--ground:" + format(library_counts.COVER_GROUND, "") + "\"><div class=\"cov-sq\" aria-hidden=\"true\">" + format(iterable(squares).map(pyString).join(""), "") + "</div><p class=\"cov-k\">" + format(iterable(parts).map(pyString).join(" · "), "") + "</p></div>" + format(weighted, ""));
}

export function bin_of(ratio: any): any {
  let _: any, limit: any, name: any;
  for (const [limit, name, _] of iterable(BINS)) {
    if (truth(((ratio <= limit)))) {
      return name;
    }
  }
  return "q1";
}

const STATUS: any = {["measured"]: ["Measured", "●"], ["partial"]: ["Partly measured", "◐"], ["not-measured"]: ["Not measured", "○"], ["scored-later"]: ["Scored later", "◌"]};

export function status_tag(status: any): any {
  let glyph: any, label: any;
  [label, glyph] = get(STATUS, status, [status, "·"]);
  return ("<span class=\"tag tag-" + format(esc(status), "") + "\"><span aria-hidden=\"true\">" + format(glyph, "") + "</span> " + format(esc(label), "") + "</span>");
}

export function section(ident: any, title: any, status: any, lead: any, body: any): any {
  return ("<section class=\"sec\" id=\"" + format(ident, "") + "\" aria-labelledby=\"" + format(ident, "") + "-h\"><header class=\"sec-head\"><h2 id=\"" + format(ident, "") + "-h\">" + format(esc(title), "") + "</h2>" + format(status_tag(status), "") + "</header><p class=\"lead\">" + format(lead, "") + "</p>" + format(body, "") + "</section>");
}

export function absent(title: any, part: any): any {
  let how: any;
  how = get(part, "howToMeasure");
  return add(add(("<div class=\"absent\" role=\"note\"><p class=\"absent-t\">" + format(esc(title), "") + "</p><p>" + format(esc(either(() => (get(part, "reason")), () => ("No evidence for this run."))), "") + "</p>"), (truth(how) ? ("<p class=\"how\"><span>Next run:</span> " + format(esc(how), "") + "</p>") : "")), "</div>");
}

export function field(accuracy: any): any {
  let _: any, b: any, c: any, cell: any, component: any, components: any, gap: any, height: any, label_w: any, legend: any, metric: any, name: any, order: any, out: any, p: any, pair: any, pairs: any, r: any, rows: any, text: any, threshold: any, tip: any, v: any, value: any, width: any, x: any, y: any;
  pairs = either(() => (get(accuracy, "pairs")), () => ([]));
  metric = (truth(both(() => (pairs), () => (get(at(pairs, 0), "corrected")))) ? "corrected" : "original");
  components = {};
  for (const p of iterable(pairs)) {
    set(setdefault(components, at(p, "component"), {}), at(p, "breakpoint"), p);
  }
  rows = iterable(["desktop", "tablet", "mobile"]).filter((b: any) => truth(any(iterable(pyValues(components)).map((v: any) => (contains(v, b)))))).map((b: any) => b);
  function verdicts(c: any): any {
    let b: any;
    return iterable(iterable(rows).map((b: any) => !truth(get(get(either(() => (get(at(components, c), b)), () => ({})), metric, {}), "pass"))));
  }
  order = sorted(components, (c: any) => [sum(verdicts(c)), verdicts(c), (sum(iterable(pyValues(at(components, c))).map((v: any) => at(at(v, metric), "ratio"))) / maximum(1, len(at(components, c))))]);
  [cell, gap, label_w] = [30, 4, 86];
  width = add(label_w, mul(len(order), add(cell, gap)));
  height = mul(len(rows), add(cell, gap));
  out = [("<svg class=\"field-svg\" viewBox=\"0 0 " + format(width, "") + " " + format(height, "") + "\" role=\"img\" aria-labelledby=\"field-t field-d\"><title id=\"field-t\">Closeness to the live site, every component at every width</title><desc id=\"field-d\">" + format(esc(field_desc(accuracy, metric)), "") + "</desc>")];
  for (const [r, name] of iterable(enumerate(rows))) {
    y = mul(r, add(cell, gap));
    out.push(("<text class=\"f-row\" x=\"" + format((label_w - 12), "") + "\" y=\"" + floatString(add(add(y, (cell / 2)), 4)) + "\" text-anchor=\"end\">" + format(get(BREAKPOINT_NAMES, name, name), "") + "</text>"));
    for (const [c, component] of iterable(enumerate(order))) {
      pair = get(at(components, component), name);
      x = add(label_w, mul(c, add(cell, gap)));
      if (truth(!truth(pair))) {
        out.push(("<rect class=\"f-none\" x=\"" + format(x, "") + "\" y=\"" + format(y, "") + "\" width=\"" + format(cell, "") + "\" height=\"" + format(cell, "") + "\" rx=\"3\"/>"));
        continue;
      }
      value = at(pair, metric);
      tip = add(add(add((format(at(pair, "label"), "") + " · " + format(get(BREAKPOINT_NAMES, name, name), "") + " " + format(get(pair, "width"), "") + "px · " + format(pct(at(value, "ratio"), 1), "") + " of pixels differ"), (truth(((metric === "corrected"))) ? (" (original measure " + format(pct(at(at(pair, "original"), "ratio"), 1), "") + ")") : "")), (truth(get(pair, "heightDelta")) ? (" · " + format(num(get(pair, "heightDelta")), "") + "px height difference") : "")), (truth(at(value, "pass")) ? " · within tolerance" : ""));
      out.push(add(add(("<g class=\"f-cell\" tabindex=\"0\" data-tip=\"" + format(esc(tip), "") + "\"><rect class=\"" + format(bin_of(at(value, "ratio")), "") + "\" x=\"" + format(x, "") + "\" y=\"" + format(y, "") + "\" width=\"" + format(cell, "") + "\" height=\"" + format(cell, "") + "\" rx=\"3\"/>"), (truth(at(value, "pass")) ? ("<path class=\"f-check\" d=\"M" + format(add(x, 9), "") + " " + format(add(y, 15.5), "") + "l4.5 4.5 8-9\"/>") : "")), "</g>"));
    }
  }
  out.push("</svg>");
  legend = iterable(iterable(BINS).map(([_, name, text]: any) => ("<li><span class=\"sw " + format(name, "") + "\"></span>" + format(esc(text), "") + "</li>"))).map(pyString).join("");
  threshold = pct(get(accuracy, "threshold"), 0);
  return add(iterable(out).map(pyString).join(""), ("<div class=\"field-key\"><p class=\"mono\">Pixels that differ from the live capture</p><ul class=\"bins\">" + format(legend, "") + "</ul><p class=\"mono key-note\"><svg width=\"14\" height=\"12\" aria-hidden=\"true\"><path class=\"f-check key\" d=\"M1 6l4 4 8-9\"/></svg> within the " + format(threshold, "") + " tolerance</p></div>"));
}

export function field_desc(accuracy: any, metric: any): any {
  let m: any, name: any, parts: any, value: any;
  parts = [];
  for (const [name, value] of iterable(pyItems(either(() => (get(accuracy, "byBreakpoint")), () => ({}))))) {
    m = either(() => (get(value, metric)), () => ({}));
    parts.push((format(get(BREAKPOINT_NAMES, name, name), "") + ": " + format(get(m, "pass"), "") + " of " + format(get(m, "total"), "") + " within tolerance, median " + format(pct(get(m, "medianRatio"), 1), "") + " of pixels differ"));
  }
  return add(iterable(parts).map(pyString).join("; "), ".");
}

export function pass_bars(accuracy: any): any {
  let _: any, bar_h: any, by: any, gap: any, group_gap: any, height: any, i: any, j: any, label_w: any, m: any, metric: any, name: any, out: any, plot_w: any, rows: any, total: any, value: any, w: any, y: any;
  rows = iterable(pyItems(either(() => (get(accuracy, "byBreakpoint")), () => ({})))).map(([name, value]: any) => [name, value]);
  if (truth(!truth(rows))) {
    return "";
  }
  total = either(() => (maximum(iterable(rows).map(([_, value]: any) => at(at(value, "original"), "total")))), () => (1));
  [bar_h, gap, group_gap, label_w, plot_w] = [12, 4, 22, 70, 330];
  height = mul(len(rows), add(add(mul(2, bar_h), gap), group_gap));
  out = [("<svg class=\"bars\" viewBox=\"0 0 " + format(add(add(label_w, plot_w), 90), "") + " " + format(height, "") + "\" role=\"img\" aria-labelledby=\"pb-t\"><title id=\"pb-t\">Widths within tolerance, original and corrected measure, by breakpoint</title>")];
  out.push(("<line class=\"axis\" x1=\"" + format(label_w, "") + "\" x2=\"" + format(label_w, "") + "\" y1=\"0\" y2=\"" + format(add((height - group_gap), 6), "") + "\"/>"));
  for (const [i, [name, value]] of iterable(enumerate(rows))) {
    y = mul(i, add(add(mul(2, bar_h), gap), group_gap));
    out.push(("<text class=\"axis-l\" x=\"" + format((label_w - 12), "") + "\" y=\"" + format(add(add(y, bar_h), 5), "") + "\" text-anchor=\"end\">" + format(get(BREAKPOINT_NAMES, name, name), "") + "</text>"));
    for (const [j, metric] of iterable(enumerate(["original", "corrected"]))) {
      m = get(value, metric);
      if (truth(!truth(m))) {
        continue;
      }
      w = maximum(2, mul((at(m, "pass") / total), plot_w));
      by = add(y, mul(j, add(bar_h, gap)));
      out.push(("<g tabindex=\"0\" data-tip=\"" + format(get(BREAKPOINT_NAMES, name, name), "") + ", " + format(metric, "") + " measure: " + format(at(m, "pass"), "") + " of " + format(at(m, "total"), "") + " within tolerance\"><path class=\"bar " + format(metric, "") + "\" d=\"" + format(bar_path(label_w, by, w, bar_h, 4, w > 2), "") + "\"/><text class=\"val\" x=\"" + (w > 2 ? floatString(add(add(label_w, w), 8)) : String(add(add(label_w, w), 8))) + "\" y=\"" + format((add(by, bar_h) - 2), "") + "\">" + format(at(m, "pass"), "") + "<tspan class=\"of\"> of " + format(at(m, "total"), "") + "</tspan></text></g>"));
    }
  }
  out.push("</svg>");
  return iterable(out).map(pyString).join("");
}

export function bar_path(x: number,y:number,w:number,h:number,r=4,wFloat=false):string {
 const radius=Math.min(r,w/2,h/2),rFloat=radius!==r,rs=rFloat?floatString(radius):String(radius),d=w-radius,ds=wFloat||rFloat?floatString(d):String(d),v=h-2*radius;
 return `M${x} ${y}h${ds}a${rs} ${rs} 0 0 1 ${rs} ${rs}v${rFloat?floatString(v):v}a${rs} ${rs} 0 0 1 -${rs} ${rs}h-${ds}z`;
}

export function dot_histogram(values: any, {edges, threshold_bins = null, title, fmt, rows = null}: any): any {
  let _: any, a: any, b: any, base: any, bins: any, cap: any, col: any, cx: any, cy: any, dot: any, edge: any, height: any, i: any, index: any, items: any, k: any, l: any, labels: any, left: any, out: any, shown: any, stack: any, tallest: any, v: any, width: any;
  labels = add(add([("≤" + format(fmt(at(edges, 0)), ""))], iterable(zip(edges, slice(edges, 1, undefined))).map(([a, b]: any) => (format(fmt(a), "") + "–" + format(fmt(b), "")))), [(">" + format(fmt(at(edges, (-1))), ""))]);
  bins = iterable(labels).map((_: any) => []);
  for (const v of iterable(values)) {
    index = get(iterable(enumerate(edges)).filter(([i, edge]: any) => truth(((v <= edge)))).map(([i, edge]: any) => i), 0, len(edges));
    at(bins, index).push(v);
  }
  [width, left, dot] = [400, 2, 6];
  col = ((width - mul(left, 2)) / len(labels));
  cap = 9;
  tallest = minimum(cap, maximum(1, either(() => (rows), () => (0)), maximum(iterable(bins).map((b: any) => len(b)))));
  stack = mul(tallest, add(mul(dot, 2), 2));
  height = add(stack, 62);
  base = add(stack, 22);
  out = [add(add(("<svg class=\"hist\" viewBox=\"0 0 " + format(width, "") + " " + format(height, "") + "\" role=\"img\" aria-label=\"" + format(esc(title), "") + ": "), esc(iterable(iterable(zip(bins, labels)).filter(([b, l]: any) => truth(b)).map(([b, l]: any) => (format(len(b), "") + " at " + format(l, "")))).map(pyString).join(", "))), "\">")];
  if (truth(threshold_bins)) {
    out.push(("<rect class=\"pass-zone\" x=\"" + format(left, "") + "\" y=\"0\" width=\"" + format(mul(threshold_bins, col), "") + "\" height=\"" + format(base, "") + "\" rx=\"4\"/><text class=\"t-note\" x=\"" + format(add(left, 4), "") + "\" y=\"14\">within tolerance</text>"));
  }
  out.push(("<line class=\"axis\" x1=\"" + format(left, "") + "\" x2=\"" + format((width - left), "") + "\" y1=\"" + format(add(base, 0.5), "") + "\" y2=\"" + format(add(base, 0.5), "") + "\"/>"));
  for (const [i, items] of iterable(enumerate(bins))) {
    cx = add(left, mul(add(i, 0.5), col));
    shown = (truth(((len(items) > cap))) ? slice(sorted(items, undefined), undefined, (cap - 1)) : sorted(items, undefined));
    for (const [k, v] of iterable(enumerate(shown))) {
      cy = (((base - dot) - 2) - mul(k, add(mul(dot, 2), 2)));
      out.push(("<circle class=\"dot\" cx=\"" + format(cx, (".1f")) + "\" cy=\"" + format(cy, (".1f")) + "\" r=\"" + format((dot - 0.5), "") + "\" tabindex=\"0\" data-tip=\"" + format(esc(fmt(v, true)), "") + "\"/>"));
    }
    if (truth(((len(items) > cap)))) {
      cy = (((base - dot) - 2) - mul((cap - 1), add(mul(dot, 2), 2)));
      out.push(("<text class=\"cnt\" x=\"" + format(cx, (".1f")) + "\" y=\"" + format(add(cy, 4), (".1f")) + "\" text-anchor=\"middle\">+" + format(add((len(items) - cap), 1), "") + "</text>"));
    }
    out.push(("<text class=\"tick\" x=\"" + format(cx, (".1f")) + "\" y=\"" + format(add(base, 18), "") + "\" text-anchor=\"middle\">" + format(esc(at(labels, i)), "") + "</text>"));
    if (truth(items)) {
      out.push(("<text class=\"cnt\" x=\"" + format(cx, (".1f")) + "\" y=\"" + format(add(base, 36), "") + "\" text-anchor=\"middle\">" + format(len(items), "") + "</text>"));
    }
  }
  out.push("</svg>");
  return iterable(out).map(pyString).join("");
}

export function bar_list(items: any, {unit_fmt, title}: any): any {
  let _: any, height: any, i: any, label_w: any, name: any, out: any, peak: any, plot_w: any, row: any, v: any, value: any, w: any, y: any;
  if (truth(!truth(items))) {
    return "";
  }
  peak = either(() => (maximum(iterable(items).map(([_, v]: any) => v))), () => (1));
  [row, label_w, plot_w] = [24, 150, 360];
  height = mul(len(items), row);
  out = [("<svg class=\"bars\" viewBox=\"0 0 " + format(add(add(label_w, plot_w), 80), "") + " " + format(height, "") + "\" role=\"img\" aria-label=\"" + format(esc(title), "") + "\">")];
  for (const [i, [name, value]] of iterable(enumerate(items))) {
    y = mul(i, row);
    w = maximum(2, mul((value / peak), plot_w));
    out.push(("<text class=\"axis-l\" x=\"" + format((label_w - 10), "") + "\" y=\"" + format(add(y, 15), "") + "\" text-anchor=\"end\">" + format(esc(name), "") + "</text><path class=\"bar corrected\" d=\"" + format(bar_path(label_w, add(y, 5), w, 12, 4, w > 2), "") + "\"/><text class=\"val\" x=\"" + (w > 2 ? floatString(add(add(label_w, w), 8)) : String(add(add(label_w, w), 8))) + "\" y=\"" + format(add(y, 15), "") + "\">" + format(esc(unit_fmt(value)), "") + "</text>"));
  }
  out.push("</svg>");
  return iterable(out).map(pyString).join("");
}

export function hero(card: any): any {
  let acc: any, added: any, bench: any, blocks: any, build: any, built: any, caption: any, commit: any, corr: any, cov: any, coverage_html: any, dek: any, effort: any, figure: any, fld: any, h: any, head: any, highs: any, ident: any, identity: any, k: any, label: any, lib: any, made: any, median_match: any, model: any, orig: any, others: any, production: any, r: any, repeat: any, row: any, runner: any, s: any, scored: any, title: any, top: any, total: any, unit: any, value: any, waits: any, what: any, working: any, yield_items: any, yields: any;
  s = at(card, "sections");
  head = at(card, "headline");
  identity = either(() => (get(at(s, "identity"), "fields")), () => ({}));
  lib = at(s, "library");
  built = at(head, "built");
  acc = at(head, "accuracy");
  [corr, orig] = [get(acc, "corrected"), get(acc, "original")];
  effort = at(head, "effort");
  repeat = at(s, "repeatability");
  cov = either(() => (get(s, "coverage")), () => ({}));
  if (truth(both(() => (((get(cov, "status") === "measured"))), () => (get(cov, "eligible"))))) {
    title = ("Built " + format(at(cov, "built"), "") + " of " + format(at(cov, "eligible"), "") + " components it could have built (" + format(mul(at(cov, "ratio"), 100), (".0f")) + "%).");
  } else {
    if (truth(get(built, "components"))) {
      title = (format(num(get(built, "components")), "") + " components, rebuilt in Figma from the live site.");
    } else {
      title = "A design-lab run, scored.";
    }
  }
  commit = slice(either(() => (get(identity, "repositoryCommit")), () => ("")), undefined, 7);
  dek = add(add(("Built " + format(day(get(identity, "startedAt")), "") + " with design-lab " + format(esc(get(identity, "pluginVersion")), "")), (truth(commit) ? (" from repository commit <code>" + format(esc(commit), "") + "</code>") : "")), ". Every figure on this page is measured from the evidence the run left behind; anything that was not recorded says so.");
  yield_items = [["components", get(built, "components")], ["variants", get(built, "variants")], ["variables", get(built, "variables")], ["pages", get(built, "pages")], ["Figma nodes", get(built, "nodes")]];
  yields = (truth(get(built, "components")) ? iterable(iterable(yield_items).filter(([label, value]: any) => truth(value)).map(([label, value]: any) => ("<div class=\"y\"><dt>" + format(esc(label), "") + "</dt><dd>" + format(num(value), "") + "</dd></div>"))).map(pyString).join("") : "");
  coverage_html = coverage_strip(cov);
  function verdict(label: any, figure: any, unit: any, caption: any, state: any = "measured"): any {
    return ("<div class=\"v v-" + format(state, "") + "\"><p class=\"v-l\">" + format(esc(label), "") + "</p><p class=\"v-n\">" + format(figure, "") + "<span class=\"v-u\">" + format(unit, "") + "</span></p><p class=\"v-c\">" + format(caption, "") + "</p></div>");
  }
  blocks = [];
  if (truth(corr)) {
    median_match = (truth(((get(corr, "medianRatio") != null))) ? (1 - at(corr, "medianRatio")) : null);
    blocks.push(verdict("Faithful to the live site", (format(at(corr, "pass"), "")), (" of " + format(at(corr, "total"), "")), ("widths within " + format(pct(get(at(s, "accuracy"), "threshold")), "") + " of the live capture on the corrected measure; " + format(at(orig, "pass"), "") + " of " + format(at(orig, "total"), "") + " on the original. The typical width matches " + format(pct(median_match), "") + " of live pixels.")));
  } else {
    if (truth(orig)) {
      blocks.push(verdict("Faithful to the live site", (format(at(orig, "pass"), "")), (" of " + format(at(orig, "total"), "")), "widths within tolerance on the original measure."));
    } else {
      blocks.push(verdict("Faithful to the live site", "–", "", "not measured for this run", "none"));
    }
  }
  runner = either(() => (get(at(s, "cost"), "runner")), () => ({}));
  working = either(() => (get(at(s, "cost"), "working")), () => ({}));
  made = either(() => (get(working, "production")), () => ({}));
  build = (truth(get(runner, "steps")) ? ("The Figma build itself took " + format(duration(at(runner, "activeSeconds")), "") + " over " + format(num(at(runner, "steps")), "") + " steps, with no model in the loop.") : "No runner log for this run.");
  if (truth(((get(made, "status") === "measured")))) {
    waits = iterable([["waitingOnPersonSeconds", "the person"], ["waitingOnLimitsSeconds", "usage limits"], ["waitingOnServiceSeconds", "the service"]]).filter(([k, what]: any) => truth(get(made, k))).map(([k, what]: any) => (format(duration(at(made, k)), "") + " waiting on " + format(what, "")));
    bench = either(() => (get(working, "benchmark")), () => ({}));
    [figure, unit] = split_duration(at(made, "workingSeconds"));
    blocks.push(verdict("design-lab took", figure, unit, add(add(add(add("of working time to produce the library, when Claude or its tools were working", (truth(waits) ? ("; " + format(iterable(waits).map(pyString).join(", "), "") + " not counted") : "")), (truth(((get(bench, "status") === "measured"))) ? (". The benchmark took " + format(duration(at(bench, "workingSeconds")), "") + " more") : "")), ". "), build)));
  } else {
    if (truth(get(runner, "steps"))) {
      [figure, unit] = split_duration(at(runner, "activeSeconds"));
      blocks.push(verdict("Figma build time", figure, unit, (format(num(at(runner, "steps")), "") + " steps written by the runner, no model in the loop. Working time was not measured for this run: score it with --session &lt;id&gt; to measure when Claude or its tools were working.")));
    } else {
      blocks.push(verdict("Working time", "–", "", "not measured for this run; score with --session &lt;id&gt; to measure when Claude or its tools were working", "none"));
    }
  }
  model = either(() => (get(at(s, "cost"), "model")), () => ({}));
  production = either(() => (get(either(() => (get(model, "production")), () => ({})), "byModel")), () => ([]));
  if (truth(both(() => (((get(model, "status") === "measured"))), () => (production)))) {
    [top, others] = [at(production, 0), slice(production, 1, undefined)];
    bench = either(() => (get(model, "benchmark")), () => ({}));
    added = (truth(((get(bench, "status") === "measured"))) ? add("; benchmarking added ", either(() => (iterable(iterable(at(bench, "byModel")).map((r: any) => (format(num(at(r, "total")), "") + " " + format(esc(at(r, "name")), "")))).map(pyString).join(", ")), () => ("none"))) : "; benchmark tokens not separated");
    caption = add(add(add(("Used " + format(num(at(top, "total")), "") + " " + format(esc(at(top, "name")), "") + " tokens to produce the library, " + format(num(at(top, "output")), "") + " of them output"), (truth(others) ? add("; also ", iterable(iterable(others).map((r: any) => (format(num(at(r, "total")), "") + " " + format(esc(at(r, "name")), "")))).map(pyString).join(", ")) : "")), added), ".");
    blocks.push(verdict((format(at(top, "name"), "") + " tokens"), compact(at(top, "total")), "", caption));
  } else {
    blocks.push(verdict("Model tokens", "–", "", "not measured for this run; score with --session &lt;id&gt; to count them by model", "none"));
  }
  if (truth(((get(repeat, "status") === "measured")))) {
    scored = iterable(at(repeat, "comparisons")).filter((row: any) => truth((contains(row, "score")))).map((row: any) => row);
    ident = minimum(iterable(scored).map((row: any) => at(row, "identicalApartFromAddresses")));
    total = maximum(iterable(scored).map((row: any) => at(row, "totalNodes")));
    blocks.push(verdict("Repeatable", (format(mul((ident / total), 100), (".2f"))), "%", ("of " + format(num(total), "") + " nodes identical across " + format(add(len(scored), 1), "") + " runs, apart from each file's own links.")));
  } else {
    blocks.push(verdict("Repeatable", "–", "", "one run only; score with --compare after a second run", "none"));
  }
  highs = iterable(iterable(either(() => (get(head, "highlights")), () => ([]))).filter((h: any) => truth(!truth(h.startsWith("The Figma build ran")))).map((h: any) => ("<li>" + format(esc(h), "") + "</li>"))).map(pyString).join("");
  fld = "";
  if (truth(get(at(s, "accuracy"), "pairs"))) {
    fld = ("<figure class=\"field\"><figcaption><span class=\"mono\">Every width, every component</span><span>Most widths within tolerance first, grouped by which widths pass, then by closeness. Hover or focus a square for its numbers.</span></figcaption>" + format(field(at(s, "accuracy")), "") + "</figure>");
  }
  return add(add(add(add(("<section class=\"hero\" aria-labelledby=\"hero-h\"><p class=\"site\">" + format(esc(at(at(card, "run"), "siteLabel")), "") + "</p><h1 id=\"hero-h\">" + format(esc(title), "") + "</h1>" + format(coverage_html, "") + "<p class=\"dek\">" + format(dek, "") + "</p>"), (truth(yields) ? ("<dl class=\"yield\">" + format(yields, "") + "</dl>") : "")), ("<div class=\"verdicts\">" + format(iterable(blocks).map(pyString).join(""), "") + "</div>")), (truth(highs) ? ("<ul class=\"highlights\" aria-label=\"Highlights\">" + format(highs, "") + "</ul>") : "")), (format(fld, "") + "</section>"));
}

export function library_section(lib: any, cov: any): any {
  let body: any, c: any, comp: any, extras: any, funnel: any, gap_items: any, i: any, items: any, k: any, labels: any, lead: any, n: any, not_built: any, out_items: any, p: any, pages: any, peak: any, plural: any, r: any, rows: any, steps: any, text: any, tier_rows: any, tier_table: any, total: any;
  if (truth(((get(lib, "status") === "not-measured")))) {
    return section("library", "What the run built", "not-measured", "Nothing to count.", absent("Library contents", lib));
  }
  comp = at(lib, "components");
  labels = either(() => (get(cov, "reasonLabels")), () => ({}));
  if (truth(((get(cov, "status") === "measured")))) {
    plural = (k: any, n: any) => (format(get(labels, k, k), "") + format((truth(both(() => (((n !== 1))), () => (((k === "retirement"))))) ? "s" : ""), ""));
    steps = [["", at(cov, "found"), "found in the source"]];
    steps = add(steps, iterable(pyItems(at(cov, "excluded"))).filter(([k, n]: any) => truth(n)).map(([k, n]: any) => ["muted", n, (format(plural(k, n), "") + " not counted")]));
    steps = add(steps, [["", at(cov, "eligible"), "it could have built"], ["", at(cov, "built"), "built in Figma"]]);
    steps = add(steps, iterable(pyItems(at(cov, "gap"))).filter(([k, n]: any) => truth(n)).map(([k, n]: any) => ["muted", n, get(labels, k, k)]));
  } else {
    steps = [["", get(comp, "found"), "found in the source"], ["", get(comp, "planned"), "planned to build"], ["", get(comp, "built"), "built in Figma"], ["muted", get(comp, "refused"), "refused by the plan"]];
  }
  funnel = add(add("<ol class=\"funnel\">", iterable(iterable(steps).map(([c, n, text]: any) => add((truth(c) ? ("<li class=\"" + format(c, "") + "\">") : "<li>"), ("<b>" + format(num(n), "") + "</b> " + format(esc(text), "") + "</li>")))).map(pyString).join("")), "</ol>");
  rows = either(() => (get(lib, "tierTable")), () => ([]));
  function holds(tiers: any): any {
    let h: any;
    return iterable(iterable(tiers).map((h: any) => (format(at(h, "tier"), "") + ": " + format(at(h, "built"), "") + " of " + format(at(h, "found"), "") + " built"))).map(pyString).join("; ");
  }
  peak = either(() => (maximum(iterable(rows).map((r: any) => at(r, "found")), 0)), () => (1));
  tier_rows = iterable(iterable(rows).map((r: any) => add(add(add(add((truth(at(r, "counted")) ? "<tr>" : "<tr class=\"out\">"), ("<th scope=\"row\"><span class=\"t-sw\" style=\"background:" + format(at(r, "color"), "") + "\"></span>" + format(esc(at(r, "label")), ""))), (truth(get(r, "holds")) ? ("<span class=\"t-note\">" + format(esc(holds(at(r, "holds"))), "") + "</span>") : "")), (truth(!truth(at(r, "counted"))) ? "<span class=\"t-note\">not counted</span>" : "")), ("</th><td class=\"n\">" + format(num(at(r, "built")), "") + "</td><td class=\"n\">" + format(num(at(r, "found")), "") + "</td><td><span class=\"t-bar\" style=\"--v:" + floatString((at(r, "built") / peak)) + ";--f:" + floatString((at(r, "found") / peak)) + ";--c:" + format(at(r, "color"), "") + "\"></span></td></tr>")))).map(pyString).join("");
  total = sum(iterable(rows).filter((r: any) => truth(at(r, "counted"))).map((r: any) => at(r, "built")));
  tier_table = (truth(tier_rows) ? ("<div class=\"tier-panel\" style=\"--ground:" + format(library_counts.COVER_GROUND, "") + "\"><table class=\"tbl tiers\"><caption>By usage tier, as on the Cover</caption><thead><tr><th scope=\"col\">Category</th><th scope=\"col\" class=\"n\">Built</th><th scope=\"col\" class=\"n\">Found</th><th scope=\"col\"><span class=\"sr\">Built out of found</span></th></tr></thead><tbody>" + format(tier_rows, "") + "<tr class=\"sum\"><th scope=\"row\">Total</th><td class=\"n\">" + format(num(total), "") + "</td><td class=\"n\">" + format(num(sum(iterable(rows).map((r: any) => at(r, "found")))), "") + "</td><td></td></tr></tbody></table></div>") : "");
  pages = iterable(iterable(either(() => (get(lib, "pageNames")), () => ([]))).map((p: any) => ("<li>" + format(esc(p), "") + "</li>"))).map(pyString).join("");
  extras = [];
  if (truth(get(lib, "voicePage"))) {
    extras.push("a brand voice and language page");
  }
  if (truth(get(lib, "examplesPage"))) {
    extras.push("an examples page assembled from real compositions");
  }
  if (truth(((get(cov, "status") === "measured")))) {
    function why(item: any): any {
      return add(add(("<li><b>" + format(esc(at(item, "label")), "") + "</b> — " + format(esc(get(labels, at(item, "reason"), at(item, "reason"))), "")), (truth(get(item, "detail")) ? (": " + format(esc(at(item, "detail")), "")) : "")), "</li>");
    }
    gap_items = iterable(either(() => (get(cov, "items")), () => ([]))).filter((i: any) => truth((contains(at(cov, "gap"), at(i, "reason"))))).map((i: any) => i);
    out_items = iterable(either(() => (get(cov, "items")), () => ([]))).filter((i: any) => truth((!contains(at(cov, "gap"), at(i, "reason"))))).map((i: any) => i);
    not_built = add((truth(gap_items) ? ("<h3>Not built, and why</h3><ul class=\"plain\">" + format(iterable(iterable(gap_items).map((i: any) => why(i))).map(pyString).join(""), "") + "</ul>") : ""), (truth(out_items) ? ("<h3 class=\"h-gap\">Not counted, and why</h3><ul class=\"plain\">" + format(iterable(iterable(out_items).map((i: any) => why(i))).map(pyString).join(""), "") + "</ul>") : ""));
  } else {
    items = iterable(iterable(either(() => (get(lib, "notBuiltReasons")), () => ([]))).map((i: any) => ("<li><b>" + format(esc(either(() => (at(i, "label")), () => (at(i, "id")))), "") + "</b> — " + format(esc(at(i, "reason")), "") + "</li>"))).map(pyString).join("");
    not_built = (truth(items) ? ("<h3>Not built, and why</h3><ul class=\"plain\">" + format(items, "") + "</ul>") : "");
  }
  lead = add(add(add((truth(((get(comp, "built") != null))) ? (format(num(get(comp, "built")), "") + " components with ") : ("No build was recorded; the plan holds " + format(num(get(comp, "planned")), "") + " components with ")), (format(num(get(lib, "variants")), "") + " variants and " + format(num(get(lib, "properties")), "") + " properties, bound to " + format(num(get(lib, "variables")), "") + " variables")), (truth(extras) ? add(", plus ", iterable(extras).map(pyString).join(" and ")) : "")), ".");
  body = add(add(add(add(("<div class=\"two\">" + format(funnel, "") + format(tier_table, "") + "</div><div class=\"two\"><div>"), (truth(pages) ? ("<h3>Pages in the file</h3><ul class=\"chips\">" + format(pages, "") + "</ul>") : "")), "</div>"), (truth(not_built) ? ("<div>" + format(not_built, "") + "</div>") : "")), "</div>");
  return section("library", "What the run built", "measured", esc(lead), body);
}

export function accuracy_section(acc: any, thumbs: any): any {
  let chart: any, corrected: any, dist: any, e: any, explain: any, g: any, gallery: any, groups: any, h: any, height_rows: any, lead: any, m: any, metric: any, metrics: any, multiples: any, n: any, name: any, orig: any, p: any, ratio_rows: any, subset: any, table: any, value: any;
  if (truth(((get(acc, "status") === "not-measured")))) {
    return section("accuracy", "Accuracy against the live site", "not-measured", "No comparison evidence.", absent("Accuracy", acc));
  }
  corrected = get(at(acc, "overall"), "corrected");
  orig = at(at(acc, "overall"), "original");
  lead = add(("Each component is compared with its live capture at every width. "), (truth(corrected) ? (format(at(corrected, "pass"), "") + " of " + format(at(corrected, "total"), "") + " widths are within tolerance on the corrected measure, " + format(at(orig, "pass"), "") + " of " + format(at(orig, "total"), "") + " on the original one.") : (format(at(orig, "pass"), "") + " of " + format(at(orig, "total"), "") + " widths are within tolerance on the original measure.")));
  metrics = either(() => (get(acc, "metrics")), () => ({}));
  explain = ("<dl class=\"defs\"><div><dt><span class=\"key-sw original\"></span>Original measure</dt><dd>" + format(esc(get(metrics, "original")), "") + "</dd></div><div><dt><span class=\"key-sw corrected\"></span>Corrected measure</dt><dd>" + format(esc(get(metrics, "corrected")), "") + " A width passes when no more than " + format(pct(get(acc, "threshold")), "") + " of its pixels differ by over " + format(esc(get(acc, "tolerance")), "") + " levels.</dd></div></dl>");
  chart = ("<figure class=\"chart\"><figcaption><h3>Widths within tolerance</h3><p>Out of " + format(num(Math.floor(at(orig, "total") / maximum(1, len(at(acc, "byBreakpoint"))))), "") + " components per breakpoint.</p></figcaption>" + format(pass_bars(acc), "") + "</figure>");
  metric = (truth(corrected) ? "corrected" : "original");
  multiples = [];
  function ratio_fmt(v: any, precise: any = false): any {
    return (truth(precise) ? pct(v, 1) : (format(mul(v, 100), ("g"))));
  }
  function height_fmt(v: any, precise: any = false): any {
    return (truth(precise) ? (format(v, ("g")) + " px") : (format(v, ("g"))));
  }
  function tallest(values_by_bp: any, edges: any): any {
    let counts: any, e: any, i: any, k: any, peak: any, v: any, values: any;
    peak = 1;
    for (const values of iterable(values_by_bp)) {
      counts = {};
      for (const v of iterable(values)) {
        i = get(iterable(enumerate(edges)).filter(([k, e]: any) => truth(((v <= e)))).map(([k, e]: any) => k), 0, len(edges));
        set(counts, i, add(get(counts, i, 0), 1));
      }
      peak = maximum([peak, ...iterable(pyValues(counts))]);
    }
    return peak;
  }
  groups = iterable(at(acc, "byBreakpoint")).map((n: any) => iterable(at(acc, "pairs")).filter((p: any) => truth(((at(p, "breakpoint") === n)))).map((p: any) => p));
  ratio_rows = tallest(iterable(groups).map((g: any) => iterable(g).map((p: any) => at(at(p, metric), "ratio"))), RATIO_EDGES);
  height_rows = tallest(iterable(groups).map((g: any) => iterable(g).map((p: any) => either(() => (at(p, "heightDelta")), () => (0)))), HEIGHT_EDGES);
  for (const [name, value] of iterable(pyItems(at(acc, "byBreakpoint")))) {
    subset = iterable(at(acc, "pairs")).filter((p: any) => truth(((at(p, "breakpoint") === name)))).map((p: any) => p);
    m = at(value, metric);
    h = at(value, "heightDelta");
    multiples.push(add(add(add(add(("<div class=\"sm\"><h4>" + format(get(BREAKPOINT_NAMES, name, name), "") + "</h4><p class=\"sm-stat\">Pixels that differ, percent · median <b>" + format(pct(at(m, "medianRatio"), 1), "") + "</b></p>"), dot_histogram(iterable(subset).map((p: any) => at(at(p, metric), "ratio")), {edges: RATIO_EDGES, threshold_bins: sum(iterable(RATIO_EDGES).filter((e: any) => truth(((e <= either(() => (get(acc, "threshold")), () => (0)))))).map((e: any) => 1)), title: (format(get(BREAKPOINT_NAMES, name, name), "") + ": components by share of pixels that differ"), fmt: ratio_fmt, rows: ratio_rows})), ("<p class=\"sm-stat\">Height difference, pixels · <b>" + format(at(h, "over10px"), "") + "</b> off by more than 10</p>")), dot_histogram(iterable(subset).map((p: any) => either(() => (at(p, "heightDelta")), () => (0))), {edges: HEIGHT_EDGES, title: (format(get(BREAKPOINT_NAMES, name, name), "") + ": components by height difference"), fmt: height_fmt, rows: height_rows})), "</div>"));
  }
  dist = ("<figure class=\"chart\"><figcaption><h3>How far off, at each breakpoint</h3><p>One dot per component. Top: share of pixels that differ (" + format(metric, "") + " measure); the shaded bins are within tolerance. Bottom: height difference between the Figma component and the live element. The number under each bin counts its components.</p></figcaption><div class=\"smalls\">" + format(iterable(multiples).map(pyString).join(""), "") + "</div></figure>");
  table = accuracy_table(acc, metric);
  gallery = gallery_html(acc, thumbs, metric);
  return section("accuracy", "Accuracy against the live site", at(acc, "status"), esc(lead), add(add(add(("<div class=\"acc-top\">" + format(explain, "") + format(chart, "") + "</div>"), dist), gallery), table));
}

export function accuracy_table(acc: any, metric: any): any {
  let _: any, by: any, c: any, cells: any, comps: any, head: any, label: any, n: any, names: any, p: any, rows: any;
  comps = {};
  for (const p of iterable(at(acc, "pairs"))) {
    set(setdefault(comps, [at(p, "label"), at(p, "component")], {}), at(p, "breakpoint"), p);
  }
  names = iterable(pyKeys(at(acc, "byBreakpoint")));
  head = iterable(iterable(names).map((n: any) => ("<th scope=\"col\" class=\"n\">" + format(get(BREAKPOINT_NAMES, n, n), "") + "</th>"))).map(pyString).join("");
  rows = [];
  for (const [[label, _], by] of iterable(sorted(pyItems(comps), undefined))) {
    cells = [];
    for (const n of iterable(names)) {
      p = get(by, n);
      if (truth(!truth(p))) {
        cells.push("<td class=\"n\">–</td>");
        continue;
      }
      c = get(p, "corrected");
      cells.push(add(add(add(("<td class=\"n\">" + format(pct(at(at(p, "original"), "ratio"), 1), "") + " · "), (truth(c) ? ("<b>" + format(pct(at(c, "ratio"), 1), "") + "</b> ") : "")), (truth(at(at(p, metric), "pass")) ? "<span class=\"ok\" aria-label=\"within tolerance\">✓</span>" : "<span class=\"no\" aria-label=\"outside tolerance\">✕</span>")), ("<br><span class=\"sub\">height " + format(num(get(p, "heightDelta")), "") + " px</span></td>")));
    }
    rows.push(("<tr><th scope=\"row\">" + format(esc(label), "") + "</th>" + format(iterable(cells).map(pyString).join(""), "") + "</tr>"));
  }
  return ("<details class=\"data\"><summary>Every comparison as a table (" + format(len(at(acc, "pairs")), "") + " widths)</summary><table class=\"tbl wide\"><caption>Pixels that differ: original · <b>corrected</b>, with the verdict on the " + format(metric, "") + " measure</caption><thead><tr><th scope=\"col\">Component</th>" + format(head, "") + "</tr></thead><tbody>" + format(iterable(rows).map(pyString).join(""), "") + "</tbody></table></details>");
}

export function gallery_html(acc: any, thumbs: any, metric: any): any {
  let best: any, c: any, comps: any, order: any, p: any, parts: any, rest: any, worst: any;
  if (truth(!truth(thumbs))) {
    return "";
  }
  comps = {};
  for (const p of iterable(at(acc, "pairs"))) {
    set(setdefault(comps, at(p, "component"), {}), at(p, "breakpoint"), p);
  }
  order = sorted(thumbs, (c: any) => [(-sum(iterable(pyValues(at(comps, c))).map((v: any) => at(at(v, metric), "pass")))), (sum(iterable(pyValues(at(comps, c))).map((v: any) => at(at(v, metric), "ratio"))) / len(at(comps, c)))]);
  function card(component: any): any {
    let by: any, chips: any, figma: any, label: any, n: any, p: any, shots: any, wide: any;
    by = at(comps, component);
    shots = at(thumbs, component);
    label = at(get(iterable(pyValues(by)), 0, null), "label");
    chips = iterable(iterable(sorted(pyItems(by), (item: any) => get(BP_ORDER, at(item, 0), 9))).map(([n, p]: any) => ("<li class=\"" + format((truth(at(at(p, metric), "pass")) ? "pass" : "fail"), "") + "\"><span>" + format(at(get(BREAKPOINT_NAMES, n, n), 0), "") + "</span>" + format(pct(at(at(p, metric), "ratio"), 0), "") + "<span class=\"sr\"> of pixels differ at " + format(get(BREAKPOINT_NAMES, n, n), "") + format((truth(at(at(p, metric), "pass")) ? ", within tolerance" : ""), "") + "</span></li>"))).map(pyString).join("");
    figma = either(() => (get(shots, "figma")), () => ({}));
    wide = (((get(figma, "w", 1) / maximum(1, get(figma, "h", 1))) > 3.5));
    function img(side: any, text: any): any {
      let shot: any;
      shot = get(shots, side);
      if (truth(!truth(shot))) {
        return "";
      }
      return ("<figure class=\"shot" + format((truth(at(shot, "cropped")) ? " cut" : ""), "") + "\"><figcaption>" + format(text, "") + "</figcaption><img src=\"" + format(at(shot, "src"), "") + "\" width=\"" + format(at(shot, "w"), "") + "\" height=\"" + format(at(shot, "h"), "") + "\" decoding=\"async\" alt=\"" + format(esc(label), "") + ", " + format(text.toLowerCase(), "") + ", desktop width\"></figure>");
    }
    return ("<article class=\"card" + format((truth(wide) ? " wide" : ""), "") + "\"><div class=\"card-h\"><h4>" + format(esc(label), "") + "</h4><ul class=\"chips-bp\" aria-label=\"Pixels that differ by breakpoint\">" + format(chips, "") + "</ul></div><div class=\"pair\">" + format(img("figma", "Figma"), "") + format(img("live", "Live site"), "") + "</div></article>");
  }
  [best, worst] = [slice(order, undefined, 6), (truth(((len(order) > 10))) ? slice(order, (-4), undefined) : [])];
  rest = iterable(order).filter((c: any) => truth(both(() => ((!contains(best, c))), () => ((!contains(worst, c)))))).map((c: any) => c);
  parts = [("<div class=\"gallery-head\"><h3>Side by side, at desktop width</h3><p>Figma component and live capture, cut from the same specimen screenshot the comparison measured. Chips give the share of pixels that differ at each breakpoint (D desktop, T tablet, M mobile); filled chips are within tolerance.</p></div>"), ("<h4 class=\"g-sub\">Closest to the live site</h4><div class=\"gallery\">" + format(iterable(iterable(best).map((c: any) => card(c))).map(pyString).join(""), "") + "</div>")];
  if (truth(worst)) {
    parts.push(("<h4 class=\"g-sub\">Furthest from the live site</h4><div class=\"gallery\">" + format(iterable(iterable(worst).map((c: any) => card(c))).map(pyString).join(""), "") + "</div>"));
  }
  if (truth(rest)) {
    parts.push(("<details class=\"data more\"><summary>Show the other " + format(len(rest), "") + " components</summary><div class=\"gallery\">" + format(iterable(iterable(rest).map((c: any) => card(c))).map(pyString).join(""), "") + "</div></details>"));
  }
  return iterable(parts).map(pyString).join("");
}

export function repeat_section(rep: any): any {
  let agree: any, body: any, counts: any, d: any, diffs: any, k: any, lead: any, name: any, note: any, paths: any, row: any, rows: any, scored: any, v: any;
  if (truth(((get(rep, "status") === "not-measured")))) {
    return section("repeatability", "Repeatability", "not-measured", "One run cannot show that a second would match.", absent("Repeatability", rep));
  }
  rows = [];
  for (const row of iterable(at(rep, "comparisons"))) {
    if (truth((contains(row, "error")))) {
      rows.push(("<tr><th scope=\"row\">" + format(esc(at(row, "run")), "") + "</th><td colspan=\"4\">" + format(esc(at(row, "error")), "") + "</td></tr>"));
      continue;
    }
    diffs = either(() => (iterable(iterable(pyItems(at(row, "categoryCounts"))).filter(([k, v]: any) => truth(v)).map(([k, v]: any) => add((format(k, "") + " " + format(v, "")), (truth(((k === "docs"))) ? " (file links)" : "")))).map(pyString).join(", ")), () => ("none"));
    agree = get(row, "accuracyAgreement");
    rows.push(add(add(("<tr><th scope=\"row\">" + format(esc(at(row, "run")), "") + "</th><td class=\"n\">" + format(at(row, "score"), (".2f")) + "</td><td class=\"n\">" + format(num(at(row, "identicalApartFromAddresses")), "") + " of " + format(num(at(row, "totalNodes")), "") + "</td><td>" + format(esc(diffs), "") + "</td><td>"), (truth(agree) ? (format(at(agree, "sameVerdict"), "") + " of " + format(at(agree, "pairs"), "") + " same verdict; ratios within " + format(pct(at(agree, "maxRatioDifference"), 2), "")) : "–")), "</td></tr>"));
  }
  counts = {};
  for (const row of iterable(at(rep, "comparisons"))) {
    for (const d of iterable(either(() => (get(row, "artifactDifferences")), () => ([])))) {
      setdefault(counts, at(d, "artifact"), new Set<any>()).add(at(d, "path"));
    }
  }
  note = esc(get(rep, "levelNote"));
  if (truth(counts)) {
    note = add(note, add(add(" Values that differ: ", iterable(iterable(sorted(pyItems(counts), undefined)).map(([name, paths]: any) => ("<code>" + format(esc(name), "") + "</code> " + format(len(paths), "")))).map(pyString).join("; ")), "."));
  }
  scored = iterable(at(rep, "comparisons")).filter((row: any) => truth((contains(row, "score")))).map((row: any) => row);
  lead = (truth(scored) ? ("Compared node by node with " + format(len(scored), "") + " other run" + format((truth(((len(scored) !== 1))) ? "s" : ""), "") + " of the same site.") : "The comparison could not run.");
  body = ("<table class=\"tbl wide\"><caption>This run against each other run</caption><thead><tr><th scope=\"col\">Other run</th><th scope=\"col\" class=\"n\">Score / 100</th><th scope=\"col\" class=\"n\">Nodes identical, apart from file links</th><th scope=\"col\">Nodes that differ, by category</th><th scope=\"col\">Accuracy results</th></tr></thead><tbody>" + format(iterable(rows).map(pyString).join(""), "") + "</tbody></table><p class=\"note\">" + format(note, "") + " The score counts documentation links as differences because each file links to itself; the identical-node column does not.</p>");
  return section("repeatability", "Repeatability", at(rep, "status"), esc(lead), body);
}

export function cost_section(cost: any): any {
  let accounts: any, approval: any, attended: any, bench: any, c: any, caption: any, clock: any, d: any, headline_: any, how: any, i: any, items: any, k: any, kinds: any, lead: any, made: any, model: any, n: any, part: any, parts: any, r: any, rows: any, runner: any, s: any, sessions: any, tables: any, time_rows: any, timings: any, v: any, warning: any, working: any;
  runner = either(() => (get(cost, "runner")), () => ({}));
  parts = [];
  if (truth(both(() => (((get(runner, "status") !== "not-measured"))), () => (get(runner, "sessions"))))) {
    sessions = iterable(iterable(at(runner, "sessions")).map((s: any) => ("<li><b>" + format(duration(at(s, "seconds")), "") + "</b> · " + format(num(at(s, "steps")), "") + " steps · from " + format(stamp(at(s, "start")), "") + "</li>"))).map(pyString).join("");
    kinds = iterable(pyItems(either(() => (get(runner, "secondsByKind")), () => ({})))).filter(([k, v]: any) => truth(((v >= 1)))).map(([k, v]: any) => [k, v]);
    parts.push(("<div class=\"two\"><div><h3>Runner sessions</h3><ul class=\"plain\">" + format(sessions, "") + "</ul><p class=\"note\">" + format(num(get(runner, "errors")), "") + " errors and " + format(num(get(runner, "skipped")), "") + " skipped steps logged. Times are the build machine's clock.</p></div><figure class=\"chart\"><figcaption><h3>Where the build time went</h3><p>Seconds per kind of step.</p></figcaption>" + format(bar_list(kinds, {unit_fmt: (v: any) => (format(v, (".0f")) + " s"), title: "Seconds of build time by kind of step"}), "") + "</figure></div>"));
  } else {
    parts.push(absent("Runner timing", runner));
  }
  timings = either(() => (get(cost, "timings")), () => ({}));
  if (truth(get(timings, "phases"))) {
    rows = iterable(iterable(at(timings, "phases")).map((r: any) => ("<tr><th scope=\"row\">" + format(esc(at(r, "phase")), "") + "</th><td>" + format(stamp(at(r, "start")), "") + "</td><td>" + format(stamp(at(r, "end")), "") + "</td><td class=\"n\">" + format(duration(at(r, "seconds")), "") + "</td></tr>"))).map(pyString).join("");
    parts.push(("<table class=\"tbl\"><caption>Time per phase</caption><thead><tr><th scope=\"col\">Phase</th><th scope=\"col\">Start</th><th scope=\"col\">End</th><th scope=\"col\" class=\"n\">Wall clock</th></tr></thead><tbody>" + format(rows, "") + "</tbody></table><p class=\"note\">Each phase runs from the previous phase's end to its own; waiting is included, so these are not working time.</p>"));
  } else {
    if (truth(get(timings, "checkpoints"))) {
      rows = iterable(iterable(at(timings, "checkpoints")).map((c: any) => ("<li><span class=\"mono\">" + format(stamp(at(c, "at")), "") + "</span> " + format(esc(at(c, "phase")), "") + " " + format(esc(at(c, "status")), "") + "</li>"))).map(pyString).join("");
      parts.push(("<div><h3>Phase checkpoints</h3><ul class=\"plain cols\">" + format(rows, "") + "</ul><p class=\"note\">" + format(esc(get(timings, "note")), "") + "</p></div>"));
    }
  }
  clock = either(() => (get(cost, "clock")), () => ({}));
  working = either(() => (get(cost, "working")), () => ({}));
  time_rows = [];
  if (truth(((get(working, "status") === "measured")))) {
    for (const [caption, part] of iterable([["To produce the library", either(() => (get(working, "production")), () => ({}))], ["The benchmark", either(() => (get(working, "benchmark")), () => ({}))]])) {
      if (truth(((get(part, "status") !== "measured")))) {
        time_rows.push([caption, null, either(() => (get(part, "reason")), () => ("not measured"))]);
        continue;
      }
      time_rows = add(time_rows, [[(format(caption, "") + ": working"), at(part, "workingSeconds"), "Claude or its tools working"], [(format(caption, "") + ": waiting on the person"), at(part, "waitingOnPersonSeconds"), "the assistant had finished, or a tool was waiting for the person's answer"], [(format(caption, "") + ": waiting on usage limits"), at(part, "waitingOnLimitsSeconds"), "after a rate, session, usage or spend limit, until it reset"], [(format(caption, "") + ": waiting on the service"), at(part, "waitingOnServiceSeconds"), "the service was overloaded or unavailable"]]);
    }
  } else {
    time_rows.push(["Working time", null, either(() => (get(working, "reason")), () => ("not measured"))]);
  }
  if (truth(get(runner, "steps"))) {
    time_rows.push(["Figma build", at(runner, "activeSeconds"), (format(num(at(runner, "steps")), "") + " runner steps, no model in the loop")]);
  }
  time_rows = add(time_rows, [["Wall time", get(clock, "wallSeconds"), (truth(((get(clock, "wallSeconds") != null))) ? "workflow.ts init to the end of the benchmark" : ("not shown: " + format(either(() => (get(clock, "notShownBecause")), () => ("its ends were not recorded")), "")))], ["Scoring script alone", get(clock, "scorerSeconds"), "this report's own computation"]]);
  approval = (truth(((get(working, "fullAccess") == false))) ? "<p class=\"note\">This session did not run with full access throughout, so a tool span may include a wait for the person's approval, counted here as working time.</p>" : "");
  how = (truth(((get(working, "status") === "measured"))) ? "" : ("<p class=\"note\"><b>Working time was not measured for this run.</b> To measure it, " + format(esc(either(() => (get(working, "howToMeasure")), () => ("score with --session <id>"))), "") + ".</p>"));
  parts.push(add(add("<div style=\"margin-bottom:32px\"><h3>Time</h3><table class=\"tbl\"><caption>Measured intervals</caption><tbody>", iterable(iterable(time_rows).map(([n, v, d]: any) => ("<tr><th scope=\"row\">" + format(esc(n), "") + "</th><td class=\"n\">" + format((truth(((v != null))) ? duration(v) : "–"), "") + "</td><td class=\"sub\">" + format(esc(d), "") + "</td></tr>"))).map(pyString).join("")), ("</tbody></table>" + format(how, "") + format(approval, "") + "<p class=\"note\"><b>How time is measured.</b> " + format(esc(get(cost, "definition")), "") + "</p></div>")));
  attended = either(() => (get(cost, "unattended")), () => ({}));
  if (truth(((get(attended, "status") === "measured")))) {
    items = iterable(iterable(at(attended, "interruptions")).map((i: any) => add(add(("<li><span class=\"mono\">" + format(stamp(at(i, "at")), "") + "</span> " + format(esc((truth(((at(i, "kind") === "question"))) ? "A question to the person" : (truth(at(i, "kind").startsWith("stopped: ")) ? add("The run stopped: ", slice(at(i, "kind"), 9, undefined)) : "A turn that ended and waited for a prompt"))), "") + " during " + format(esc(at(i, "phase")), "")), (truth(at(i, "planned")) ? " (the plan review chosen at preflight)" : "")), "</li>"))).map(pyString).join("");
    headline_ = (truth(at(attended, "ranUnattended")) ? "Ran unattended after preflight: yes." : (format(at(attended, "count"), "") + " interruption" + format((truth(((at(attended, "count") !== 1))) ? "s" : ""), "") + " after preflight."));
    parts.push(add(add(("<div style=\"margin-bottom:32px\"><h3>" + format(esc(headline_), "") + "</h3>"), (truth(items) ? ("<ul class=\"plain\">" + format(items, "") + "</ul>") : "")), ("<p class=\"note\">From the preflight go-ahead at " + format(stamp(at(attended, "goAheadAt")), "") + " to the benchmark's start, every question the run asked the person and every turn that waited for a prompt. Waits before the go-ahead are setup.</p></div>")));
  } else {
    parts.push(absent("Unattended after preflight", attended));
  }
  warning = get(either(() => (get(cost, "developer")), () => ({})), "sessionWarning");
  if (truth(warning)) {
    parts.push(("<p class=\"note\"><b>Which session was scored.</b> " + format(esc(warning), "") + ".</p>"));
  }
  model = either(() => (get(cost, "model")), () => ({}));
  if (truth(((get(model, "status") === "measured")))) {
    function token_table(caption: any, part: any): any {
      let body: any, foot: any, k: any, r: any, rows: any, t: any;
      rows = either(() => (get(part, "byModel")), () => ([]));
      if (truth(!truth(rows))) {
        return ("<p class=\"note\">" + format(esc(caption), "") + ": no model turns.</p>");
      }
      t = at(part, "tokens");
      body = iterable(iterable(rows).map((r: any) => add(add(("<tr><th scope=\"row\">" + format(esc(at(r, "name")), "") + "<span class=\"sub\"> " + format((truth(((at(r, "model") !== at(r, "name")))) ? esc(at(r, "model")) : ""), "") + "</span></th>"), iterable(iterable(["input", "output", "cacheWrite", "cacheRead", "total", "turns", "toolCalls"]).map((k: any) => ("<td class=\"n\">" + format(num(at(r, k)), "") + "</td>"))).map(pyString).join("")), "</tr>"))).map(pyString).join("");
      foot = add(add("<tr class=\"sum\"><th scope=\"row\">All models</th>", iterable(iterable(["input", "output", "cacheWrite", "cacheRead", "total"]).map((k: any) => ("<td class=\"n\">" + format(num(at(t, k)), "") + "</td>"))).map(pyString).join("")), ("<td class=\"n\">" + format(num(at(part, "turns")), "") + "</td><td class=\"n\">" + format(num(at(part, "toolCalls")), "") + "</td></tr>"));
      return ("<table class=\"tbl wide\"><caption>" + format(esc(caption), "") + "</caption><thead><tr><th scope=\"col\">Model</th><th scope=\"col\" class=\"n\">Input</th><th scope=\"col\" class=\"n\">Output</th><th scope=\"col\" class=\"n\">Cache write</th><th scope=\"col\" class=\"n\">Cache read</th><th scope=\"col\" class=\"n\">Total</th><th scope=\"col\" class=\"n\">Turns</th><th scope=\"col\" class=\"n\">Tool calls</th></tr></thead><tbody>" + format(body, "") + format(foot, "") + "</tbody></table>");
    }
    bench = either(() => (get(model, "benchmark")), () => ({}));
    tables = token_table("To produce the library", either(() => (get(model, "production")), () => ({})));
    tables = add(tables, (truth(((get(bench, "status") === "measured"))) ? token_table("Added by benchmarking", bench) : absent("Benchmark tokens", bench)));
    accounts = either(() => (iterable(either(() => (get(model, "configDirs")), () => ([]))).map(pyString).join(", ")), () => ("not known"));
    parts.push(("<div><h3>Tokens by model</h3>" + format(tables, "") + "<p class=\"note\">From " + format(esc(get(model, "source")), "") + ": " + format(num(at(model, "files")), "") + " transcript file(s), main session and subagents together. Claude configuration folder (account): " + format(esc(accounts), "") + ". Cache reads are prompt tokens served from cache and cost far less than the other kinds. " + format(esc(get(model, "benchmarkNote")), "") + " " + format(esc(get(model, "caveat")), "") + "</p></div>"));
  } else {
    parts.push(absent("Model tokens and tool calls", model));
  }
  made = (truth(((get(working, "status") === "measured"))) ? either(() => (get(working, "production")), () => ({})) : {});
  lead = (truth(((get(made, "status") === "measured"))) ? ("design-lab took " + format(duration(at(made, "workingSeconds")), "") + " of working time to produce the library.") : (truth(get(runner, "steps")) ? ("The Figma build itself took " + format(duration(at(runner, "activeSeconds")), "") + " across " + format(num(at(runner, "steps")), "") + " steps; working time was not measured for this run.") : "Timing evidence is incomplete for this run."));
  return section("cost", "Time and tokens", at(cost, "status"), esc(lead), iterable(parts).map(pyString).join(""));
}

export function conformance_section(conf: any): any {
  let body: any, f: any, k: any, o: any, v: any;
  if (truth(((get(conf, "status") === "not-measured")))) {
    return section("conformance", "Conformance to the library standard", "not-measured", "Whole-file verification was not run.", absent("Verification findings", conf));
  }
  o = at(conf, "open");
  body = add(add(("<dl class=\"yield small\">"), iterable(iterable(pyItems(o)).map(([k, v]: any) => ("<div class=\"y\"><dt>" + format(k, "") + " open</dt><dd>" + format(num(v), "") + "</dd></div>"))).map(pyString).join("")), ("<div class=\"y\"><dt>waived</dt><dd>" + format(num(at(conf, "waived")), "") + "</dd></div><div class=\"y\"><dt>checks passed</dt><dd>" + format(num(at(conf, "passed")), "") + "</dd></div></dl>"));
  if (truth(get(conf, "findings"))) {
    body = add(body, add(add("<ul class=\"plain\">", iterable(iterable(at(conf, "findings")).map((f: any) => ("<li><span class=\"cat\">" + format(esc(at(f, "severity")), "") + "</span> " + format(esc(at(f, "check")), "") + ": " + format(esc(at(f, "message")), "") + "</li>"))).map(pyString).join("")), "</ul>"));
  }
  return section("conformance", "Conformance to the library standard", "measured", esc(get(conf, "summary")), body);
}

export function churn_section(churn: any): any {
  let c: any, items: any;
  if (truth(((get(churn, "status") === "not-measured")))) {
    return section("churn", "Schema churn", "not-measured", "Whether this run needed a schema change was not recorded.", absent("Schema churn", churn));
  }
  items = iterable(iterable(either(() => (get(churn, "changes")), () => ([]))).map((c: any) => ("<li>" + format(esc(at(c, "text")), "") + "</li>"))).map(pyString).join("");
  return section("churn", "Schema churn", "measured", esc(get(churn, "summary")), (truth(items) ? ("<ul class=\"plain\">" + format(items, "") + "</ul>") : ""));
}

export function later_section(fv: any, blind: any, pages: any): any {
  let body: any, boxes: any, c: any, criteria: any, foundation_pages: any, i: any, p: any, scale: any, targets: any;
  scale = either(() => (get(blind, "scale")), () => ({["min"]: 1, ["max"]: 5}));
  boxes = iterable(iterable(range(at(scale, "min"), add(at(scale, "max"), 1))).map((i: any) => ("<span>" + format(i, "") + "</span>"))).map(pyString).join("");
  criteria = iterable(iterable(either(() => (get(blind, "criteria")), () => ([]))).map((c: any) => ("<li><span>" + format(esc(at(c, "label")), "") + "</span><span class=\"scale\" aria-label=\"not yet scored\">" + format(boxes, "") + "</span></li>"))).map(pyString).join("");
  foundation_pages = iterable(pages).filter((p: any) => truth(p.toLowerCase().startsWith("foundations"))).map((p: any) => p);
  targets = iterable(iterable(foundation_pages).map((p: any) => ("<li><span>" + format(esc(at(p.split("—"), (-1)).trim()), "") + "</span><span class=\"pending\">awaiting rubric</span></li>"))).map(pyString).join("");
  body = add(add(("<div class=\"two\"><div class=\"later\"><h3>Foundations and voice</h3><p>" + format(esc(get(fv, "reason")), "") + " The scorecard already has a slot for the rubric and its scores.</p>"), (truth(targets) ? ("<ul class=\"rubric\">" + format(targets, "") + "</ul>") : "")), ("</div><div class=\"later\"><h3>Blinded visual judgement</h3><p>" + format(esc(get(blind, "reason")), "") + "</p><ul class=\"rubric\">" + format(criteria, "") + "</ul></div></div>"));
  return section("later", "Judged by people", "scored-later", "Two parts of the benchmark need human eyes and are added after the run.", body);
}

export function identity_section(ident: any): any {
  let f: any, items: any, k: any, rebuilt: any, rows: any, v: any, x: any;
  if (truth(((get(ident, "status") === "not-measured")))) {
    return section("identity", "Run identity", "not-measured", "Nothing identifies this run.", absent("Run identity", ident));
  }
  f = at(ident, "fields");
  rows = [["Site", get(f, "siteLabel")], ["Public address", get(f, "publicAddress")], ["Local site", get(f, "siteUrl")], ["Operator", get(f, "operator")], ["Started", (truth(get(f, "startedAt")) ? day(get(f, "startedAt")) : null)], ["design-lab", iterable(iterable([get(f, "pluginVersion"), slice(either(() => (get(f, "pluginCommit")), () => ("")), undefined, 10)]).filter((x: any) => truth(x)).map((x: any) => x)).map(pyString).join(" ")], ["Library standard", get(f, "standardVersion")], ["Figma build", either(() => (iterable(iterable([(truth(get(f, "builtToStandard")) ? ("standard " + format(at(f, "builtToStandard"), "")) : null), (truth(get(f, "rendererRuntime")) ? ("renderer runtime " + format(at(f, "rendererRuntime"), "")) : null)]).filter((x: any) => truth(x)).map((x: any) => x)).map(pyString).join(" · ")), () => (null))], ["Repository commit", (truth(get(f, "repositoryCommit")) ? add(slice(either(() => (get(f, "repositoryCommit")), () => ("")), undefined, 12), (truth(get(f, "repositoryDirty")) ? " (uncommitted changes)" : "")) : null)], ["Figma file", get(f, "figmaUrl")], ["Claude configuration", get(f, "claudeConfigDir")], ["Model", (truth(pyString(either(() => (get(f, "model")), () => (""))).startsWith("claude-")) ? get(f, "model") : null)], ["Strategies", iterable(iterable(pyItems(either(() => (get(f, "strategies")), () => ({})))).filter(([k, v]: any) => truth(v)).map(([k, v]: any) => (format(replace(k, "Source", ""), "") + ": " + format(v, "")))).map(pyString).join(", ")]];
  rebuilt = get(f, "rebuiltFrom");
  if (truth(rebuilt)) {
    rows.push(["Rebuilt inputs", ("This run rebuilt an earlier run's capture and plan from " + format(at(rebuilt, "run"), "") + ".")]);
  }
  items = iterable(iterable(rows).map(([k, v]: any) => ("<div><dt>" + format(esc(k), "") + "</dt><dd>" + format((truth(v) ? esc(v) : "<span class=na>not recorded</span>"), "") + "</dd></div>"))).map(pyString).join("");
  return section("identity", "Run identity and provenance", at(ident, "status"), esc(get(ident, "summary")), ("<dl class=\"sheet\">" + format(items, "") + "</dl><p class=\"note\">This is the provenance the Figma Cover used to print. The file now keeps it as hidden plugin data (<code>designlab</code> / <code>provenance</code> on the document and the Cover) and no page shows it.</p>"));
}

const CSS = String.raw`
:root{color-scheme:light;
--paper:#f4f5f7;--surface:#ffffff;--ink:#14161b;--ink2:#474d59;--muted:#6b717d;--hair:#dadde3;--hair2:#e9ebef;
--accent:#2f3fb8;--orig:#7d828c;--corr:#2a78d6;--pass-zone:rgba(42,120,214,.08);
--q5:#0d366b;--q4:#1c5cab;--q3:#2a78d6;--q2:#5598e7;--q1:#86b6ef;--check:#ffffff;--none:#e9ebef;
--good:#0a7d0a;--bad:#c23434;--hatch:rgba(20,22,27,.05);
--display:"Avenir Next Condensed","Avenir Next","Helvetica Neue","Arial Narrow",system-ui,sans-serif;
--body:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
--mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;
--paper:#0e1014;--surface:#161a21;--ink:#eceef2;--ink2:#b4bac6;--muted:#8d93a0;--hair:#2b303a;--hair2:#20242c;
--accent:#9aa6ff;--orig:#7c828e;--corr:#3987e5;--pass-zone:rgba(57,135,229,.12);
--q5:#b7d3f6;--q4:#6da7ec;--q3:#3987e5;--q2:#256abf;--q1:#184f95;--check:#0e1014;--none:#20242c;
--good:#3fbf3f;--bad:#ef6b6b;--hatch:rgba(255,255,255,.04)}}
*{box-sizing:border-box}
html{background:var(--paper)}
body{margin:0;color:var(--ink);font:16px/1.55 var(--body);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.page{max-width:1180px;margin:0 auto;padding:28px 40px 80px}
code,.mono{font-family:var(--mono);font-size:.82em;letter-spacing:.01em}
a{color:var(--accent)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* masthead */
.mast{display:flex;justify-content:space-between;align-items:baseline;gap:24px;padding-bottom:14px;border-bottom:1px solid var(--ink)}
.mast p{margin:0;font:600 13px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase}
.mast dl{display:flex;gap:22px;margin:0;font:12px/1 var(--mono);color:var(--muted)}
.mast dl div{display:flex;gap:6px}.mast dd{margin:0;color:var(--ink2)}
/* hero */
.hero{padding:52px 0 8px}
.site{margin:0 0 10px;font:500 14px/1 var(--mono);color:var(--accent);letter-spacing:.04em}
h1{font:700 clamp(40px,5.6vw,68px)/.98 var(--display);letter-spacing:-.018em;margin:0;max-width:21ch;font-stretch:condensed}
.dek{max-width:64ch;color:var(--ink2);margin:20px 0 0;font-size:17px}
.yield{display:flex;flex-wrap:wrap;gap:0;margin:40px 0 0;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair)}
.yield .y{flex:1 1 140px;padding:18px 20px 16px 0;margin-right:20px;border-right:1px solid var(--hair)}
.yield .y:last-child{border-right:0}
.yield dt{font:12px/1.2 var(--mono);color:var(--muted);order:2}
.yield dd{margin:0 0 4px;font:600 46px/1 var(--display);letter-spacing:-.01em;font-variant-numeric:lining-nums}
.yield .y{display:flex;flex-direction:column}
.yield.small dd{font-size:30px}.yield.small{margin-top:10px}
.verdicts{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:34px}
.v{padding:0 22px 0 0;margin-right:22px;border-right:1px solid var(--hair)}
.v:last-child{border-right:0;margin-right:0}
.v-l{margin:0;font:600 12px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}
.v-n{margin:10px 0 6px;font:700 64px/.9 var(--display);letter-spacing:-.02em;color:var(--ink)}
.v-u{font:600 28px/1 var(--display);color:var(--muted);margin-left:4px;letter-spacing:0}
.v-c{margin:0;color:var(--ink2);font-size:14.5px;max-width:34ch}
.v-none .v-n{color:var(--muted)}
/* The coverage strip is drawn on the Cover's navy in both modes, so its category colors match the Cover. */
.cov{margin:22px 0 0;padding:18px 20px 14px;border-radius:12px;background:var(--ground);display:inline-block;max-width:100%}
.cov-sq{display:flex;flex-wrap:wrap;gap:4px;max-width:720px}
.cov-sq span{width:16px;height:16px;border-radius:3px}
.c-gap{box-shadow:inset 0 0 0 1.5px #E6E8FF}
.c-out{background:repeating-linear-gradient(135deg,rgba(230,232,255,.7) 0 1.5px,transparent 1.5px 4px)}
.c-out.c-retire{background:repeating-linear-gradient(135deg,#B9003F 0 2px,transparent 2px 4px);box-shadow:inset 0 0 0 1px #B9003F}
.cov-k{margin:12px 0 0;font:13px/1.6 var(--mono);color:#E6E8FF}.cov-k b{color:#fff;font-weight:600}
.cov-k .key{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:var(--k);vertical-align:-1px}
.cov-k .key-gap{background:none;box-shadow:inset 0 0 0 1.5px #E6E8FF}
.cov-k .key-out{background:repeating-linear-gradient(135deg,rgba(230,232,255,.7) 0 1.5px,transparent 1.5px 4px)}
.cov-k .key-retire{background:repeating-linear-gradient(135deg,#B9003F 0 2px,transparent 2px 4px);box-shadow:inset 0 0 0 1px #B9003F}
.cov,.cov *,.tier-panel,.tier-panel *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
/* The tier table sits on the Cover's navy too, so its category colors read exactly as on the Cover. */
.tier-panel{background:var(--ground);border-radius:12px;padding:16px 20px 8px;align-self:start}
.tbl.tiers caption{color:#E6E8FF}.tbl.tiers thead th{color:#AEB6E6}
.tbl.tiers th,.tbl.tiers td{color:#fff;border-top-color:rgba(230,232,255,.16)}
.tbl.tiers tr.out th,.tbl.tiers tr.out td{color:#AEB6E6}
.tbl.tiers tr.sum th,.tbl.tiers tr.sum td{border-top:1px solid rgba(230,232,255,.5)}
.t-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px}
tr.out .t-sw{background:repeating-linear-gradient(135deg,#B9003F 0 2px,transparent 2px 4px)!important;box-shadow:inset 0 0 0 1px #B9003F}
.t-note{display:block;margin:2px 0 0 18px;font:12px/1.4 var(--mono);color:#AEB6E6;font-weight:400}
.t-bar{display:block;height:8px;border-radius:4px;margin-top:6px;min-width:80px;position:relative;background:linear-gradient(90deg,rgba(230,232,255,.18) calc(var(--f)*100%),transparent 0)}
.t-bar::after{content:"";position:absolute;inset:0 auto 0 0;width:calc(var(--v)*100%);background:var(--c);border-radius:4px}
.h-gap{margin-top:20px}
.cov-w{margin:14px 0 0;font-size:16px;color:var(--ink2);max-width:72ch}.cov-w b{color:var(--ink)}
.tbl tr.sum th,.tbl tr.sum td{border-top:1px solid var(--ink2);font-weight:600}
.highlights{list-style:none;margin:40px 0 0;padding:0;columns:2;column-gap:36px}
.highlights li{break-inside:avoid;padding:12px 0 12px 26px;border-top:1px solid var(--hair);position:relative;font-size:15.5px}
.highlights li::before{content:"";position:absolute;left:0;top:19px;width:12px;height:2px;background:var(--ink)}
/* the field */
.field{margin:48px 0 0;padding:26px 28px 22px;background:var(--surface);border-radius:14px;box-shadow:0 0 0 1px var(--hair2)}
.field figcaption{display:flex;justify-content:space-between;gap:20px;align-items:baseline;margin-bottom:18px;color:var(--ink2);font-size:14px}
.field figcaption .mono{font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--ink)}
.field-svg{width:100%;height:auto;display:block;overflow:visible}
.f-row{font:12px var(--mono);fill:var(--ink2)}
.f-cell{cursor:default;outline:none}
.f-cell rect{transition:opacity .15s}
.f-cell:hover rect,.f-cell:focus rect{stroke:var(--ink);stroke-width:2}
.q5{fill:var(--q5)}.q4{fill:var(--q4)}.q3{fill:var(--q3)}.q2{fill:var(--q2)}.q1{fill:var(--q1)}.f-none{fill:var(--none)}
.f-check{fill:none;stroke:var(--check);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.f-check.key{stroke:var(--ink)}
.field-key{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center;margin-top:18px;color:var(--ink2);font-size:13px}
.field-key p{margin:0}
.bins{display:flex;gap:16px;list-style:none;margin:0;padding:0;font:12px var(--mono)}
.bins li{display:flex;align-items:center;gap:6px}
.sw{display:inline-block;width:14px;height:14px;border-radius:3px}
.sw.q5{background:var(--q5)}.sw.q4{background:var(--q4)}.sw.q3{background:var(--q3)}.sw.q2{background:var(--q2)}.sw.q1{background:var(--q1)}
.key-note{display:flex;align-items:center;gap:6px}
/* sections */
.toc{display:flex;flex-wrap:wrap;gap:6px 18px;margin:56px 0 0;padding:14px 0;border-top:1px solid var(--ink);border-bottom:1px solid var(--hair);font:13px var(--mono)}
.toc a{color:var(--ink2);text-decoration:none}.toc a:hover{color:var(--accent);text-decoration:underline}
.sec{padding:56px 0 8px;border-bottom:1px solid var(--hair)}
.sec-head{display:flex;justify-content:space-between;align-items:baseline;gap:20px}
h2{font:700 38px/1.05 var(--display);letter-spacing:-.01em;margin:0}
h3{font:600 17px/1.3 var(--body);margin:0 0 8px}
h4{font:600 12px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;margin:0 0 6px;color:var(--ink2)}
.lead{font-size:19px;line-height:1.45;max-width:62ch;color:var(--ink);margin:14px 0 28px}
.tag{font:600 11.5px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;color:var(--ink2);padding:6px 10px;border-radius:99px;box-shadow:inset 0 0 0 1px var(--hair)}
.tag-measured{color:var(--ink)}
.tag-not-measured,.tag-scored-later{color:var(--muted)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin:0 0 32px}
.note{color:var(--muted);font-size:13.5px;max-width:70ch}
.absent{margin:0 0 24px;padding:18px 22px;border-radius:10px;background:repeating-linear-gradient(135deg,var(--hatch) 0 2px,transparent 2px 9px),var(--surface);box-shadow:inset 0 0 0 1px var(--hair)}
.absent p{margin:0;color:var(--ink2);font-size:14.5px}
.absent .absent-t{font:600 12px/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink);margin-bottom:6px}
.absent .how{margin-top:8px;font-size:13.5px}.absent .how span{font-family:var(--mono);color:var(--muted)}
/* lists and tables */
.funnel{list-style:none;margin:0;padding:0}
.funnel li{display:flex;align-items:baseline;gap:14px;padding:10px 0;border-top:1px solid var(--hair2);color:var(--ink2)}
.funnel b{font:700 34px/1 var(--display);color:var(--ink);min-width:2.2ch;text-align:right}
.funnel .muted b{color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0}
.chips li{font:12.5px/1 var(--mono);padding:7px 10px;border-radius:6px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--hair)}
.plain{list-style:none;margin:0;padding:0}
.plain li{padding:7px 0;border-top:1px solid var(--hair2);font-size:14.5px;color:var(--ink2)}
.plain li b{color:var(--ink)}
.plain.cols{columns:2;column-gap:32px}
.cat{font:11.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-right:6px}
.tbl{border-collapse:collapse;width:100%;font-size:14px}
.tbl caption{text-align:left;font:600 12px/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);padding-bottom:8px}
.tbl th,.tbl td{text-align:left;padding:8px 10px 8px 0;border-top:1px solid var(--hair2);vertical-align:top}
.tbl thead th{font:12px var(--mono);color:var(--muted);border-top:0}
.tbl .n{text-align:right;font-variant-numeric:tabular-nums}
.tbl .sub{color:var(--muted);font-size:12px}
.tbl.wide{margin:6px 0 20px}
.meter{display:block;height:8px;border-radius:4px;background:var(--hair2);margin-top:6px;position:relative;min-width:80px}
.meter::after{content:"";position:absolute;inset:0 auto 0 0;width:calc(var(--v)*100%);background:var(--corr);border-radius:4px}
.ok{color:var(--good);font-weight:700}.no{color:var(--bad);font-weight:700}
details.data{margin:10px 0 32px}
details.data summary{cursor:pointer;font:13px var(--mono);color:var(--accent);padding:10px 0}
.defs{display:grid;grid-template-columns:1fr;gap:22px;margin:0 0 36px;align-content:start}
.acc-top{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:48px;align-items:start}
.defs dt{font-weight:600;display:flex;align-items:center;gap:8px}.defs dd{margin:4px 0 0;color:var(--ink2);font-size:14.5px}
.key-sw{width:18px;height:8px;border-radius:4px;display:inline-block}.key-sw.original{background:var(--orig)}.key-sw.corrected{background:var(--corr)}
/* charts */
.chart{margin:0 0 36px}
.chart figcaption p{margin:0 0 14px;color:var(--ink2);font-size:14px;max-width:70ch}
.bars{width:100%;max-width:700px;height:auto;display:block}
.bar.original{fill:var(--orig)}.bar.corrected{fill:var(--corr)}
.grid{stroke:var(--hair2);stroke-width:1}.axis{stroke:var(--hair);stroke-width:1}
.axis-l{font:12.5px var(--mono);fill:var(--ink2)}
.val{font:600 13px var(--body);fill:var(--ink)}.val .of{font-weight:400;fill:var(--muted)}
.smalls{display:grid;grid-template-columns:repeat(3,1fr);gap:30px}
.sm-stat{margin:0 0 4px;font-size:13px;color:var(--ink2)}
.hist{width:100%;height:auto;display:block;margin-bottom:12px}
.dot{fill:var(--corr);stroke:var(--surface);stroke-width:1.5}
.dot:hover,.dot:focus{stroke:var(--ink);outline:none}
.pass-zone{fill:var(--pass-zone)}.thresh{stroke:var(--ink2);stroke-width:1}
.t-note,.tick{font:12px var(--mono);fill:var(--muted)}.cnt{font:600 13px var(--mono);fill:var(--ink2)}.t-note{fill:var(--ink2)}
/* gallery */
.gallery-head p{color:var(--ink2);font-size:14px;margin:0 0 18px;max-width:72ch}
.gallery{display:grid;align-items:start;grid-template-columns:repeat(2,1fr);gap:18px;margin-bottom:28px}
.g-sub{margin:26px 0 12px}
.card{background:var(--surface);border-radius:12px;padding:14px 16px 16px;box-shadow:0 0 0 1px var(--hair2)}
.card-h{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}
.card h4{color:var(--ink);letter-spacing:.01em;text-transform:none;font:600 15px/1.3 var(--body);margin:0}
.chips-bp{display:flex;gap:5px;list-style:none;margin:0;padding:0;font:11.5px var(--mono);flex:none}
.chips-bp li{padding:4px 7px;border-radius:5px;background:var(--hair2);color:var(--ink2)}
.chips-bp li span:first-child{font-weight:700;margin-right:5px;color:var(--ink)}
.chips-bp li.pass{background:var(--corr);color:#fff}.chips-bp li.pass span:first-child{color:#fff}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
.card.wide .pair{grid-template-columns:1fr}
.shot{margin:0}.shot figcaption{font:10.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.shot img{display:block;width:100%;height:auto;border-radius:4px;box-shadow:0 0 0 1px var(--hair2);background:#fff}
.shot.cut{position:relative}.shot.cut::after{content:"";position:absolute;left:0;right:0;bottom:0;height:34px;background:linear-gradient(transparent,var(--surface))}
details.more summary{margin-bottom:14px}
/* later and identity */
.later{padding:20px 22px;border-radius:12px;background:var(--surface);box-shadow:0 0 0 1px var(--hair2)}
.later p{color:var(--ink2);font-size:14.5px}
.rubric{list-style:none;margin:12px 0 0;padding:0}
.rubric li{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-top:1px solid var(--hair2);font-size:14.5px}
.pending{font:11px var(--mono);color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.scale{display:flex;gap:4px}.scale span{width:24px;height:24px;border-radius:5px;display:grid;place-items:center;font:11px var(--mono);color:var(--muted);box-shadow:inset 0 0 0 1px var(--hair)}
.sheet{display:grid;grid-template-columns:repeat(2,1fr);gap:0 40px;margin:0 0 32px}
.sheet div{display:grid;grid-template-columns:170px 1fr;gap:12px;padding:9px 0;border-top:1px solid var(--hair2);font-size:14px}
.sheet dt{font:12px/1.6 var(--mono);color:var(--muted)}.sheet dd{margin:0;overflow-wrap:anywhere}
.na{color:var(--muted);font-style:italic}
footer.colophon{padding:36px 0 0;color:var(--muted);font:12px/1.7 var(--mono)}
/* tooltip */
.tip{position:fixed;z-index:10;pointer-events:none;max-width:300px;padding:8px 10px;border-radius:8px;background:var(--ink);color:var(--paper);font:12.5px/1.4 var(--body);box-shadow:0 6px 24px rgba(0,0,0,.18);opacity:0;transition:opacity .12s}
.tip.on{opacity:1}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media (max-width:860px){.page{padding:20px}.highlights{columns:1}.acc-top,.verdicts,.two,.defs,.highlights,.smalls,.sheet{grid-template-columns:1fr}
.v{border-right:0;margin:0 0 24px;padding:0}.mast{flex-direction:column}.mast dl{flex-wrap:wrap}
.gallery,.pair{grid-template-columns:1fr}.card-h{flex-wrap:wrap}.tbl.wide{display:block;overflow-x:auto}
.sec-head{flex-wrap:wrap}.field{padding:18px 14px;overflow-x:auto}.field-svg{min-width:640px}.plain.cols{columns:1}
.sheet div{grid-template-columns:120px 1fr}.yield .y{flex-basis:40%;border-right:0}}
@page{margin:14mm}
@media print{:root{color-scheme:light;--paper:#fff;--surface:#fff;--ink:#000;--ink2:#333;--muted:#555;--hair:#bbb;--hair2:#ddd;
--q5:#0d366b;--q4:#1c5cab;--q3:#2a78d6;--q2:#5598e7;--q1:#86b6ef;--check:#fff;--corr:#2a78d6;--orig:#7d828c}
.page{max-width:none;padding:0}.sec,.field,.card,.chart,.v,table,.absent{break-inside:avoid}
.toc,.tip,details.data summary{display:none}details.data{display:block}details.data>*{display:block}
.gallery{grid-template-columns:repeat(2,1fr)}.hero{padding-top:20px}}
`;

const JS = String.raw`
(function(){var t=document.createElement('div');t.className='tip';t.setAttribute('role','tooltip');document.body.appendChild(t);
function show(e){var el=e.target.closest('[data-tip]');if(!el){t.classList.remove('on');return}
t.textContent=el.getAttribute('data-tip');var r=el.getBoundingClientRect();var x=r.left+r.width/2,y=r.top;
t.style.left=Math.max(8,Math.min(window.innerWidth-310,x-150))+'px';t.style.top=Math.max(8,y-t.offsetHeight-10)+'px';t.classList.add('on')}
document.addEventListener('mouseover',show);document.addEventListener('focusin',show);
document.addEventListener('mouseout',function(e){if(e.target.closest('[data-tip]'))t.classList.remove('on')});
document.addEventListener('focusout',function(){t.classList.remove('on')});})();
`;

export async function render(card: any, run_dir: any): Promise<string> {
  let body: any, i: any, identity: any, s: any, t: any, thumbs: any, toc: any;
  s = at(card, "sections");
  identity = either(() => (get(at(s, "identity"), "fields")), () => ({}));
  thumbs = {};
  if (truth(both(() => (get(at(s, "accuracy"), "pairs")), () => (get(at(at(at(s, "accuracy"), "pairs"), 0), "evidence"))))) {
    thumbs = await thumbnails(run_dir, at(at(s, "accuracy"), "pairs"), "desktop");
  }
  toc = [["library", "What the run built"], ["accuracy", "Accuracy"], ["repeatability", "Repeatability"], ["cost", "Time and tokens"], ["conformance", "Conformance"], ["churn", "Schema churn"], ["later", "Judged by people"], ["identity", "Identity and provenance"]];
  body = [("<header class=\"mast\"><p>design-lab · run report</p><dl><div><dt>run</dt><dd>" + format(esc(at(at(card, "run"), "name")), "") + "</dd></div><div><dt>built</dt><dd>" + format(esc(day(get(identity, "startedAt"))), "") + "</dd></div><div><dt>version</dt><dd>" + format(esc(either(() => (get(identity, "pluginVersion")), () => ("–"))), "") + "</dd></div><div><dt>scored</dt><dd>" + format(esc(day(at(card, "generatedAt"))), "") + "</dd></div></dl></header>"), "<main>", hero(card), add(add("<nav class=\"toc\" aria-label=\"Sections\">", iterable(iterable(toc).map(([i, t]: any) => ("<a href=\"#" + format(i, "") + "\">" + format(esc(t), "") + "</a>"))).map(pyString).join("")), "</nav>"), library_section(at(s, "library"), either(() => (get(s, "coverage")), () => ({}))), accuracy_section(at(s, "accuracy"), thumbs), repeat_section(at(s, "repeatability")), cost_section(at(s, "cost")), conformance_section(at(s, "conformance")), churn_section(at(s, "schemaChurn")), later_section(at(s, "foundationsVoice"), at(s, "blindedJudgement"), either(() => (get(at(s, "library"), "pageNames")), () => ([]))), identity_section(at(s, "identity")), "</main>", ("<footer class=\"colophon\">Generated by " + format(esc(at(card, "generator")), "") + " (scripts/score_run.ts) on " + format(esc(day(at(card, "generatedAt"))), "") + ". The numbers come from scorecard.json beside this file; re-run the scorer to refresh them. Accuracy figures are recomputed from the run's specimen screenshots.</footer>")];
  return ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"color-scheme\" content=\"light dark\"><title>" + format(esc(at(at(card, "run"), "siteLabel")), "") + " · design-lab run report</title><style>" + format(CSS, "") + "</style></head><body><div class=\"page\">" + format(iterable(body).map(pyString).join(""), "") + "</div><script>" + format(JS, "") + "</script></body></html>\n");
}
