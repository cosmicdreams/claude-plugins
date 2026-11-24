#!/usr/bin/env python3
"""Compare two assessment runs (before and after) criterion by criterion.

Usage: compare.py <before report.json> <after report.json> [--out comparison.md]

The comparison uses each run's own report.json rather than a recomputation, so a change
in method between runs (crawl size, templates sampled, browsers, manual reviews) shows
up in the coverage table rather than hiding inside the counts.
"""
import argparse
import json
from pathlib import Path

LABEL = {"not_compliant": "Not compliant", "needs_manual_check": "Needs manual check",
         "compliant": "Compliant", "not_applicable": "Not applicable"}


def compare(before, after):
    b = {r["id"]: r for r in before["criteria"]}
    a = {r["id"]: r for r in after["criteria"]}
    changed, pages = [], []
    for cid, ra in a.items():
        rb = b.get(cid, {})
        if rb.get("status") != ra["status"]:
            changed.append((cid, ra["name"], rb.get("status"), ra["status"]))
        pb, pa = rb.get("pages_affected") or 0, ra.get("pages_affected") or 0
        if pb != pa and (ra["status"] == "not_compliant" or rb.get("status") == "not_compliant"):
            pages.append((cid, ra["name"], pb, pa))
    return changed, pages


def markdown(before, after):
    changed, pages = compare(before, after)
    sb, sa = before["score"], after["score"]
    cb, ca = before["coverage"], after["coverage"]
    lines = [f"# Accessibility comparison: {after['site']}", "",
             f"Before: {before['run_date']} ({before.get('baseline', '')})  ",
             f"After: {after['run_date']} ({after.get('baseline', '')})", "",
             "| | Before | After |", "|---|---:|---:|",
             f"| Verdict | {sb['verdict']} | {sa['verdict']} |",
             f"| Not compliant | {sb['failing']} | {sa['failing']} |",
             f"| Proven (compliant + not applicable) | {sb['proven']} | {sa['proven']} |",
             f"| Needs manual check | {sb['to_check']} | {sa['to_check']} |",
             "", "Coverage (a difference here means the method changed, not only the site):", "",
             "| | Before | After |", "|---|---:|---:|",
             f"| Pages crawled | {cb['pages_crawled']} | {ca['pages_crawled']} |",
             f"| axe ran on | {cb['axe_ran_on']} | {ca['axe_ran_on']} |",
             f"| Templates sampled | {cb['templates_sampled']} | {ca['templates_sampled']} |",
             f"| Browsers | {', '.join(cb['browsers'])} | {', '.join(ca['browsers'])} |", ""]
    if changed:
        lines += ["## Status changes", "", "| Criterion | Before | After |", "|---|---|---|"]
        lines += [f"| {c} {n} | {LABEL.get(x, 'Not assessed')} | {LABEL[y]} |" for c, n, x, y in changed]
    else:
        lines.append("No criterion changed status.")
    if pages:
        lines += ["", "## Pages affected by failures", "", "| Criterion | Before | After |", "|---|---:|---:|"]
        lines += [f"| {c} {n} | {x} | {y} |" for c, n, x, y in pages]
    new = [c for c, _, x, y in changed if y == "not_compliant"]
    if new:
        lines += ["", f"New failures: {', '.join(new)}."]
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("before")
    ap.add_argument("after")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    md = markdown(json.loads(Path(a.before).read_text()), json.loads(Path(a.after).read_text()))
    if a.out:
        Path(a.out).write_text(md)
    print(md)


if __name__ == "__main__":
    main()
