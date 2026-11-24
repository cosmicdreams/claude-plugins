#!/usr/bin/env python3
"""Reduce Screaming Frog axe results, Playwright checks, recorded findings and manual reviews
to one verdict per WCAG 2.1 A/AA success criterion. Writes report.json, report.html and
manual-worksheet.md.

Usage:
  assess.py --frog <export dir> --pages <pages.json> --checks <checks dir> --out <dir>
            --site <name> [--findings findings.json] [--manual manual.json]
            [--baseline "<what was tested>"] [--meta run-meta.json]

Statuses:
  not_compliant       a confirmed failure: an axe violation of a WCAG-tagged rule, a Playwright
                      failure the reviewer has not dismissed, an open recorded finding, or a
                      manual fail
  compliant           evidence that decides the whole criterion: the standard itself, a site-wide
                      axe pass for 3.1.1, a decisive Playwright check that passed on every sampled
                      template in all three browsers, or a recorded manual pass
  not_applicable      the full-crawl inventory proves the content type is absent, or a manual review
  needs_manual_check  everything else, with whatever automated evidence exists shown as leads
"""
import argparse
import html
import json
import math
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import criteria as C  # noqa: E402
import frog_inputs  # noqa: E402

BROWSERS = {"chromium", "firefox", "webkit"}
STATUSES = ("not_compliant", "needs_manual_check", "compliant", "not_applicable")
CLOSED = {"done", "closed", "resolved", "fixed"}


def n(k, word):
    return f"{k} {word}" + ("" if k == 1 else "s")


def worst(sevs):
    s = [x for x in sevs if x in C.SEVERITY_ORDER]
    return min(s, key=C.SEVERITY_ORDER.index) if s else None


def load_json(path, default):
    return json.loads(Path(path).read_text()) if path and Path(path).is_file() else default


def mapped(issue):
    """Criteria an axe issue bears on: the Guidelines column first, else the rule map.
    Criteria the standard decides (4.1.1) are never failed by a scanner."""
    scs = [s for s in frog_inputs.criteria_in(issue["guidelines"]) if s in C.IDS] or C.AXE_RULE_SC.get(issue["rule"], [])
    return [s for s in scs if s not in C.STANDARD_PASS]


def reduce(frog, pages_doc, checks, findings, manual):
    pages = frog["pages"]
    npages = len(pages)
    reps = pages_doc.get("pages", [])
    rep_paths = {r["path"] for r in reps}
    ev = defaultdict(lambda: {"fail": [], "pages": set(), "templates": set(), "sev": [], "leads": [],
                              "findings": [], "method": set()})
    unmapped = set()

    # 1. Screaming Frog axe violations, every crawled page.
    by_rule = defaultdict(lambda: {"pages": set(), "n": 0, "impact": None, "issue": "", "sc": set(), "bp": None})
    for v in frog["violations"]:
        scs = mapped(v)
        r = by_rule[v["rule"] or v["issue"]]
        r["pages"].add(v["url"]); r["n"] += 1; r["impact"] = r["impact"] or v["impact"]; r["issue"] = v["issue"]
        r["sc"].update(scs)
        if not scs:
            r["bp"] = C.BEST_PRACTICE_LEADS.get(v["rule"])
            if not r["bp"] and not re.search(r"WCAG 2\.2|AAA", v["guidelines"]):
                unmapped.add(v["rule"] or v["issue"])  # WCAG 2.2-only and AAA rules are out of scope
    for rid, r in by_rule.items():
        if r["sc"]:
            for sc in r["sc"]:
                e = ev[sc]
                e["fail"].append(f"{r['issue'].rstrip('.')} (axe {rid}: {n(r['n'], 'instance')} on {n(len(r['pages']), 'page')})")
                e["pages"] |= r["pages"]; e["sev"].append(C.AXE_SEVERITY.get(r["impact"])); e["method"].add("Screaming Frog axe")
        elif r["bp"]:
            ev[r["bp"]]["leads"].append(f"Best-practice rule {rid} flagged {n(len(r['pages']), 'page')}: {r['issue']}")

    # 2. axe "incomplete": the scanner could not decide; a lead, never a failure.
    inc = defaultdict(lambda: {"pages": set(), "issue": "", "sc": set()})
    for v in frog["incomplete"]:
        scs = mapped(v)
        r = inc[v["rule"] or v["issue"]]; r["pages"].add(v["url"]); r["issue"] = v["issue"]; r["sc"].update(scs)
    for rid, r in inc.items():
        for sc in r["sc"]:
            ev[sc]["leads"].append(f"axe could not decide {rid} on {n(len(r['pages']), 'page')} (needs review)")

    # 3. Playwright checks on representative pages, minus reviewer dismissals.
    dismissed = manual.get("dismissals", [])

    def is_dismissed(row):
        return any(d.get("criterion") == row.get("criterion") and d.get("check") in (None, row.get("check"))
                   and d.get("page") in (None, row.get("page")) and d.get("browser") in (None, row.get("browser"))
                   for d in dismissed)

    cres = defaultdict(lambda: {"pass": set(), "fail": defaultdict(lambda: {"pages": set(), "browsers": set(), "evidence": ""}),
                                "inconclusive": 0, "dismissed": 0, "seen": set()})
    for row in checks:
        for sc in re.findall(r"\d\.\d\.\d+", str(row.get("criterion", ""))):
            if sc not in C.IDS or sc in C.STANDARD_PASS:
                continue
            c = cres[sc]
            c["seen"].add((row.get("page"), row.get("browser")))
            res = row.get("result")
            if res == "fail" and is_dismissed(row):
                c["dismissed"] += 1
            elif res == "fail":
                f = c["fail"][row.get("check", "")]
                f["pages"].add(row.get("page")); f["browsers"].add(row.get("browser"))
                f["evidence"] = f["evidence"] or str(row.get("evidence", ""))[:240]
            elif res == "inconclusive":
                c["inconclusive"] += 1
            elif res == "pass":
                c["pass"].add((row.get("page"), row.get("browser")))
    browsers_run = {r.get("browser") for r in checks if r.get("browser")}
    for sc, c in cres.items():
        e = ev[sc]
        for check, f in c["fail"].items():
            e["fail"].append(f"Browser check {check} failed on {n(len(f['pages']), 'template')} "
                             f"[{', '.join(sorted(f['browsers']))}]")
            e["templates"] |= f["pages"]; e["sev"].append("High"); e["method"].add("Playwright")
        if c["inconclusive"]:
            e["leads"].append(f"{n(c['inconclusive'], 'browser check')} inconclusive")
        if c["dismissed"]:
            e["leads"].append(f"{n(c['dismissed'], 'browser-check failure')} dismissed by a reviewer as false positives")
        if not c["fail"] and c["pass"]:
            e["leads"].append(f"Browser checks passed on {n(len({p for p, _ in c['pass']}), 'template')} in "
                              f"{', '.join(sorted({b for _, b in c['pass']}))}")

    # 4. Recorded findings (tickets, prior audits) that are still open.
    for fnd in findings:
        if str(fnd.get("status", "")).lower() in CLOSED:
            continue
        for sc in fnd.get("criteria", []):
            if sc in C.IDS and sc not in C.STANDARD_PASS:
                ev[sc]["findings"].append(fnd); ev[sc]["sev"].append(fnd.get("severity")); ev[sc]["method"].add("Recorded finding")

    # 5. Manual reviews, newest per criterion.
    reviews = {}
    for rv in sorted(manual.get("reviews", []), key=lambda r: r.get("date", "")):
        if rv.get("criterion") in C.IDS:
            reviews[rv["criterion"]] = rv

    # 6. Inventory for not-applicable decisions.
    def absent(cols):
        if not frog["inventory_available"]:
            return False
        for p in pages.values():
            for col in cols:
                v = p["inventory"].get(col)
                if v is None or math.isnan(v) or v != 0:
                    return False
        return True

    axe_everywhere = len(frog["axe_ran"]) == npages
    rows, conflicts = [], []
    for cid, name, lvl, anchor in C.CRITERIA:
        e = ev[cid]
        g = cid.rsplit(".", 1)[0]
        r = {"id": cid, "name": name, "level": lvl, "principle": C.PRINCIPLES[cid[0]],
             "guideline": f"{g} {C.GUIDELINES[g]}", "url": f"https://www.w3.org/TR/WCAG21/#{anchor}",
             "leads": e["leads"], "findings": [{k: f.get(k) for k in ("key", "summary", "url")} for f in e["findings"]]}
        rv = reviews.get(cid)
        manual_fail = rv and rv.get("verdict") == "fail"
        if e["fail"] or e["findings"] or manual_fail:
            parts = list(e["fail"]) + [f"{f.get('key', 'Finding')}: {f.get('summary', '')}" for f in e["findings"]]
            sev = list(e["sev"])
            method = set(e["method"])
            if manual_fail:
                parts.append(f"Manual review by {rv.get('reviewer', 'a reviewer')} on {rv.get('date', '?')}: {rv.get('note', 'fails')}")
                sev.append(rv.get("severity", "High")); method.add("Manual review")
            elif rv and rv.get("verdict") in ("pass", "not_applicable"):
                conflicts.append(f"{cid}: manual {rv['verdict']} on {rv.get('date', '?')} conflicts with automated failures")
            r.update(status="not_compliant", severity=worst(sev) or "Medium", method=" + ".join(sorted(method)),
                     evidence="; ".join(parts), pages_affected=len({p for p in e["pages"] if p in pages}) or None,
                     templates_affected=len(e["templates"]) or None)
        elif cid in C.STANDARD_PASS:
            r.update(status="compliant", method="Standard", evidence=C.STANDARD_PASS[cid])
        elif rv and rv.get("verdict") == "pass":
            r.update(status="compliant", method="Manual review",
                     evidence=f"Passed manual review by {rv.get('reviewer', '?')} on {rv.get('date', '?')}"
                              + (f" ({rv['scope']})" if rv.get("scope") else "") + (f": {rv['note']}" if rv.get("note") else ""))
        elif rv and rv.get("verdict") == "not_applicable":
            r.update(status="not_applicable", method="Manual review",
                     evidence=f"Not applicable per {rv.get('reviewer', '?')} on {rv.get('date', '?')}: {rv.get('note', '')}")
        elif cid in C.AXE_SITEWIDE_PASS and axe_everywhere:
            r.update(status="compliant", method="Screaming Frog axe",
                     evidence=f"axe rules {', '.join(C.AXE_SITEWIDE_PASS[cid])} pass on all {npages} crawled pages")
        elif cid in C.DECISIVE_CHECKS and decisive(cres.get(cid), rep_paths, browsers_run):
            r.update(status="compliant", method="Playwright (3 browsers)",
                     evidence=f"{C.DECISIVE_CHECKS[cid]} on all {n(len(rep_paths), 'sampled template')} "
                              f"in Chromium, Firefox and WebKit")
        elif cid in C.NOT_APPLICABLE_WHEN_ABSENT and absent(C.NOT_APPLICABLE_WHEN_ABSENT[cid]):
            what = " or ".join(dict.fromkeys(C.ABSENT_PHRASE[c] for c in C.NOT_APPLICABLE_WHEN_ABSENT[cid]))
            r.update(status="not_applicable", method="Screaming Frog inventory",
                     evidence=f"No {what} on any of the {npages} crawled pages")
        else:
            r.update(status="needs_manual_check", method="Not decided",
                     evidence="; ".join(e["leads"]) or "Automated checks cannot decide this criterion",
                     manual_steps=C.STEPS[cid])
        rows.append(r)

    counts = {s: sum(r["status"] == s for r in rows) for s in STATUSES}
    proven = counts["compliant"] + counts["not_applicable"]
    if counts["not_compliant"]:
        verdict = "Does not conform"
    elif counts["needs_manual_check"]:
        verdict = "Conformance not established"
    else:
        verdict = "Conforms"
    score = {
        "verdict": verdict,
        "proven": proven,
        "assurance": round(proven / 50, 2),
        "failing": counts["not_compliant"],
        "to_check": counts["needs_manual_check"],
        "to_check_with_automated_evidence": sum(1 for r in rows if r["status"] == "needs_manual_check" and r["leads"]),
    }
    return {
        "standard": "WCAG 2.1 Level AA",
        "summary": counts,
        "score": score,
        "coverage": {
            "pages_crawled": npages,
            "axe_ran_on": len(frog["axe_ran"]),
            "inventory_available": frog["inventory_available"],
            "templates_sampled": len(reps),
            "pages_covered_by_sampled_templates": pages_doc.get("pages_covered_by_sampled_templates"),
            "templates_not_sampled": pages_doc.get("templates_not_sampled", []),
            "browsers": sorted(browsers_run),
        },
        "unmapped_axe_rules": sorted(unmapped),
        "manual_conflicts": conflicts,
        "representatives": reps,
        "criteria": rows,
    }


def decisive(c, rep_paths, browsers_run):
    if not c or c["fail"] or c["inconclusive"] or not rep_paths or not BROWSERS <= browsers_run:
        return False
    needed = {(p, b) for p in rep_paths for b in BROWSERS}
    return needed <= c["pass"] and needed <= c["seen"]


# ------------------------------------------------------------------ worksheet
def worksheet(report):
    lines = [f"# Manual checks: {report['site']}", "",
             f"{report['score']['to_check']} of 50 criteria need a person. Record each result in `manual.json` "
             "and re-run the assessment; the report merges it.", "",
             "```json", json.dumps({"reviews": [{"criterion": "2.4.2", "verdict": "pass | fail | not_applicable",
                                                 "reviewer": "Name", "date": "YYYY-MM-DD", "scope": "all templates",
                                                 "note": "what you checked"}],
                                    "dismissals": [{"criterion": "2.4.7", "check": "<check id>", "page": "/path",
                                                    "browser": "firefox", "reason": "why it is a false positive",
                                                    "reviewer": "Name", "date": "YYYY-MM-DD"}]}, indent=2), "```", "",
             "## Pages to use (one per template)", ""]
    for r in report["representatives"]:
        lines.append(f"- {r['template']} ({n(r['count'], 'page')}): {r['url']}")
    for r in report["criteria"]:
        if r["status"] != "needs_manual_check":
            continue
        lines += ["", f"## {r['id']} {r['name']} (Level {r['level']})", "", f"[Understanding]({r['url']})", ""]
        lines += [f"- [ ] {s.strip()}" for s in r["manual_steps"].split(";")]
        if r["leads"]:
            lines += ["", "Automated leads:"] + [f"- {x}" for x in r["leads"]]
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------ render
STATUS = {"not_compliant": ("fail", "Not compliant"), "needs_manual_check": ("check", "Needs manual check"),
          "compliant": ("pass", "Compliant"), "not_applicable": ("na", "Not applicable")}
METER = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}
E = html.escape


def render(report, template):
    T = template
    rows, counts, score, cov = report["criteria"], report["summary"], report["score"], report["coverage"]
    npages = cov["pages_crawled"]

    def mark(st):
        return f'<span class="mark mark--{STATUS[st][0]} " aria-hidden="true"></span>'

    def meter(sev):
        return '<span class="meter" aria-hidden="true">' + "".join(
            f'<i class="{"on" if i < METER[sev] else ""}"></i>' for i in range(4)) + "</span>"

    DASH = '<span class="muted" aria-hidden="true">–</span><span class="sr">None</span>'
    d = date.fromisoformat(report["run_date"])
    run_human = f"{d.day} {d.strftime('%B %Y')}"
    site = E(report["site"])

    head = T[:T.index('<div class="progress"')]
    head = re.sub(r"<title>.*?</title>", f"<title>Accessibility assessment: {site}, {run_human}</title>", head, flags=re.S)
    head = re.sub(r'(<p class="page-header__meta">)Run [^<]*(</p>)', rf"\g<1>Run {run_human}\g<2>", head)
    head = re.sub(r'(<h1 class="page-header__site">)[^<]*(</h1>)', rf"\g<1>{site}\g<2>", head)
    tail = T[T.index("  </main>"):]
    tail = re.sub(r"(<span>)[^<]*· WCAG 2\.1 Level AA · Run [^<]*(</span>)",
                  rf"\g<1>{site} · WCAG 2.1 Level AA · Run {run_human}\g<2>", tail)

    out = [head]
    out.append(f'''<div class="progress" role="region" aria-label="Progress toward conformance">
    <p class="progress__verdict">{E(score["verdict"])}</p>
    <div class="progress__bar" aria-hidden="true">
      <span class="seg seg--pass" style="flex-grow:{score["proven"]}"></span><span class="seg seg--fail" style="flex-grow:{counts["not_compliant"]}"></span><span class="seg seg--check" style="flex-grow:{counts["needs_manual_check"]}"></span>
    </div>
    <p class="progress__counts"><strong>{score["proven"]} of 50 proven</strong> · {counts["not_compliant"]} failing · {counts["needs_manual_check"]} to check</p>
  </div>

  <main id="main" class="page-body">
''')
    vh = {"Conforms": "Conforms to WCAG 2.1 Level AA",
          "Does not conform": "Does not conform to WCAG 2.1 Level AA",
          "Conformance not established": "Conformance to WCAG 2.1 Level AA not yet established"}[score["verdict"]]
    out.append(f'''    <section class="verdict" aria-labelledby="verdict-h">
      <h2 id="verdict-h" class="verdict__h">{vh}</h2>
      <ul class="verdict__counts">
        <li>{mark("not_compliant")}<strong>{counts["not_compliant"]}</strong> not compliant</li>
        <li>{mark("needs_manual_check")}<strong>{counts["needs_manual_check"]}</strong> need a manual check ({score["to_check_with_automated_evidence"]} with automated leads)</li>
        <li>{mark("compliant")}<strong>{counts["compliant"]}</strong> compliant</li>
        <li>{mark("not_applicable")}<strong>{counts["not_applicable"]}</strong> not applicable</li>
      </ul>
      <p class="verdict__rule">To conform, all 50 criteria must be compliant or not applicable. Automated checks can show failures; most passes need a person. "Proven" counts only criteria the evidence fully decides.</p>
    </section>
''')
    out.append('    <section aria-labelledby="board-h">\n      <h2 class="section" id="board-h">All 50 criteria at a glance</h2>\n      <div class="board">\n')
    for pk, pname in C.PRINCIPLES.items():
        pr = [r for r in rows if r["id"][0] == pk]
        parts = [f"{k} {w}" for st, w in (("not_compliant", "failing"), ("needs_manual_check", "to check"),
                                           ("compliant", "compliant"), ("not_applicable", "not applicable"))
                 if (k := sum(r["status"] == st for r in pr))]
        cells = []
        for g in dict.fromkeys(r["guideline"] for r in pr):
            lis = []
            for r in [x for x in pr if x["guideline"] == g]:
                al = f'{r["id"]} {r["name"]}: {STATUS[r["status"]][1].lower()}' + (f', {r["severity"].lower()} severity' if r.get("severity") else "")
                lis.append(f'<li><a class="cell" href="#c-{r["id"].replace(".", "-")}" aria-label="{E(al)}">{mark(r["status"])}<span class="cell__id">{r["id"]}</span></a></li>')
            cells.append(f'<ul class="board__gl" aria-label="Guideline {E(g)}">{"".join(lis)}</ul>')
        out.append(f'      <div class="board__row">\n        <h3 class="board__p">{pname}<span class="board__n">{len(pr)} criteria: {", ".join(parts)}</span></h3>\n        <div class="board__cells">{"".join(cells)}</div>\n      </div>\n')
    out.append("      </div>\n    </section>\n\n")

    sevkey = re.search(r'<dl class="sevkey">.*?</dl>', T, re.S)
    out.append(f'    <section aria-labelledby="dev-h">\n      <h2 class="section" id="dev-h">For developers: fix</h2>\n      {sevkey[0] if sevkey else ""}\n')
    fails = [r for r in rows if r["status"] == "not_compliant"]
    if not fails:
        out.append('      <p>No confirmed failures.</p>\n')
    for sev in C.SEVERITY_ORDER:
        grp = [r for r in fails if r["severity"] == sev]
        if not grp:
            continue
        out.append(f'      <h3 class="sevhead">{meter(sev)}{sev} <span class="sevhead__n">{len(grp)} criteri{"on" if len(grp) == 1 else "a"}</span></h3>\n      <ol class="items">')
        for r in grp:
            scope = []
            if r.get("pages_affected"):
                scope.append(f"{r['pages_affected']} of {npages} crawled pages")
            if r.get("templates_affected"):
                scope.append(f"{n(r['templates_affected'], 'sampled template')}")
            tks = "".join(f'<li>{"<a href=" + chr(34) + E(f["url"]) + chr(34) + ">" + E(f["key"] or "") + "</a>" if f.get("url") else E(f.get("key") or "")} <span>{E(f.get("summary") or "")}</span></li>' for f in r["findings"])
            out.append(f'''
        <li class="item">
          <p class="item__key"><a href="#c-{r["id"].replace(".", "-")}">{r["id"]}</a><span>Level {r["level"]}</span></p>
          <div class="item__body">
            <h4>{E(r["name"])}</h4>
            <p>{E(r["evidence"])}. <span class="muted">{E("Affects " + " and ".join(scope) + "; " if scope else "")}{E(r["method"])}.</span></p>
            {f'<ul class="tickets" aria-label="Recorded findings for {r["id"]}">{tks}</ul>' if tks else ""}
          </div>
        </li>''')
        out.append("</ol>\n")
    out.append("    </section>\n\n")

    out.append('    <section aria-labelledby="rev-h">\n      <h2 class="section" id="rev-h">For reviewers: check by hand</h2>\n      <ol class="items items--check">')
    for r in [x for x in rows if x["status"] == "needs_manual_check"]:
        steps = [s.strip() for s in r["manual_steps"].split(";")]
        lead = "" if not r["leads"] else f'<p class="muted">{E("; ".join(r["leads"]))}.</p>'
        out.append(f'''
        <li class="item">
          <p class="item__key"><a href="#c-{r["id"].replace(".", "-")}">{r["id"]}</a><span>Level {r["level"]}</span></p>
          <div class="item__body">
            <h3 class="item__h">{E(r["name"])}</h3>
            {lead}<ul class="steps" aria-label="Steps for {r["id"]}">{"".join(f'<li><span class="box" aria-hidden="true"></span>{E(s)}</li>' for s in steps)}</ul>
          </div>
        </li>''')
    out.append("\n      </ol>\n    </section>\n\n")

    thead = re.search(r'    <section aria-labelledby="detail-h">.*?</thead>\n', T, re.S)[0]
    out.append(thead.replace(">Tickets<", ">Findings<"))
    for pk, pname in C.PRINCIPLES.items():
        pid = pname.lower()
        out.append(f'          <tbody id="tb-{pid}"><tr class="tr-p"><th colspan="9" scope="colgroup" id="tp-{pid}"><button type="button" class="ptoggle" aria-expanded="true" aria-controls="tb-{pid}"><span class="ptoggle__chev" aria-hidden="true"></span>{pname}</button></th></tr>')
        lastg = None
        for r in [x for x in rows if x["id"][0] == pk]:
            if r["guideline"] != lastg:
                out.append(f'<tr class="tr-g"><th colspan="9" scope="colgroup">Guideline {E(r["guideline"])}</th></tr>')
                lastg = r["guideline"]
            cls, label = STATUS[r["status"]]
            pages = f'{r["pages_affected"]} of {npages}' if r.get("pages_affected") else DASH
            sev = f'{meter(r["severity"])}{r["severity"]}' if r.get("severity") else DASH
            tks = ("<span class=\"tks\">" + "".join(
                (f'<a href="{E(f["url"])}">{E(f.get("key") or "")}</a>' if f.get("url") else E(f.get("key") or ""))
                for f in r["findings"]) + "</span>") if r["findings"] else DASH
            out.append(f'''<tr id="c-{r["id"].replace(".", "-")}" class="tr-c tr-{cls}">
          <th scope="row" class="num">{r["id"]}</th>
          <td><a href="{r["url"]}">{E(r["name"])}</a></td>
          <td>{r["level"]}</td>
          <td class="st"><span class="st__in">{mark(r["status"])}<span>{label}</span></span></td>
          <td>{E(r["method"])}</td>
          <td>{E(r["evidence"])}</td>
          <td class="num">{pages}</td>
          <td class="sev">{sev}</td>
          <td>{tks}</td>
        </tr>''')
        out.append("</tbody>\n")
    out.append("        </table>\n      </div>\n    </section>\n\n")

    m = report.get("meta", {})
    not_sampled = cov["templates_not_sampled"]
    out.append(f'''    <section aria-labelledby="method-h">
      <h2 class="section" id="method-h">Method and scope</h2>
      <dl class="facts">
        <div><dt>Site tested</dt><dd>{E(report.get("baseline") or "")}</dd></div>
        <div><dt>Crawl</dt><dd>Screaming Frog SEO Spider {E(str(m.get("sf_version", "?")))} with JavaScript rendering: {npages} HTML pages; axe-core ran on {cov["axe_ran_on"]}. Requests outside the local site were blocked.</dd></div>
        <div><dt>Browser checks</dt><dd>Playwright keyboard, focus, zoom, reflow, text-spacing, hover, orientation and shortcut checks in {E(", ".join(cov["browsers"]) or "no browsers")} on one page from each of {cov["templates_sampled"]} templates, covering {cov["pages_covered_by_sampled_templates"]} of {npages} pages{f"; {len(not_sampled)} smaller templates were not sampled" if not_sampled else ""}. The accessibility tree stands in for a screen reader; no screen reader was run.</dd></div>
        <div><dt>Not applicable</dt><dd>{"Decided from a full-crawl inventory of media, forms and inputs." if cov["inventory_available"] else "No inventory columns in the crawl, so nothing was marked not applicable automatically."}</dd></div>
        <div><dt>Severity</dt><dd>axe-core impact (critical → Critical, serious → High, moderate → Medium, minor → Low); browser-check and manual failures default to High; recorded findings keep their own.</dd></div>
        <div><dt>Templates</dt><dd><ul class="pages">{"".join(f"<li>{E(r['template'])}: {E(r['path'])} ({r['count']})</li>" for r in report["representatives"])}</ul></dd></div>
      </dl>
    </section>

''')
    out.append(tail)
    return "".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--frog", required=True)
    ap.add_argument("--pages", required=True)
    ap.add_argument("--checks", required=True, help="folder holding checks.json (and run-meta.json)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--site", required=True)
    ap.add_argument("--findings")
    ap.add_argument("--manual")
    ap.add_argument("--baseline", default="")
    ap.add_argument("--meta", help="JSON with sf_version, crawl_db_id, commit, ...")
    ap.add_argument("--run-date", default=date.today().isoformat())
    ap.add_argument("--template", default=str(Path(__file__).resolve().parent.parent / "template" / "accessibility-report.html"))
    a = ap.parse_args(argv)

    try:
        frog = frog_inputs.load(a.frog)
    except frog_inputs.ExportError as e:
        sys.exit(f"assess: {e}")
    checks_dir = Path(a.checks)
    if not (checks_dir / "checks.json").is_file():
        sys.exit(f"assess: no checks.json in {checks_dir}; run the browser checks first")
    report = reduce(frog, load_json(a.pages, {}), load_json(checks_dir / "checks.json", []),
                    load_json(a.findings, []), load_json(a.manual, {}))
    report.update(site=a.site, run_date=a.run_date, baseline=a.baseline,
                  meta={**load_json(a.meta, {}), "checks": load_json(checks_dir / "run-meta.json", {})})
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.json").write_text(json.dumps(report, indent=1))
    (out / "report.html").write_text(render(report, Path(a.template).read_text()))
    (out / "manual-worksheet.md").write_text(worksheet(report))
    s = report["score"]
    print(f"{s['verdict']}: {s['failing']} failing, {s['proven']} of 50 proven, {s['to_check']} to check -> {out / 'report.html'}")
    for c in report["manual_conflicts"]:
        print(f"conflict: {c}", file=sys.stderr)
    if report["unmapped_axe_rules"]:
        print(f"note: axe rules with no criterion mapping: {', '.join(report['unmapped_axe_rules'])}", file=sys.stderr)


if __name__ == "__main__":
    main()
