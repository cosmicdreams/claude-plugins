#!/usr/bin/env python3
"""Run a WCAG 2.1 AA assessment of a local DDEV site, end to end.

  run_assessment.py --project <ddev project root> [--out <dir>] [--site <name>]
                    [--findings findings.json] [--manual manual.json]
                    [--compare-to <earlier run dir>] [--max-templates 25]
                    [--crawl-list urls.txt] [--skip-crawl <existing frog export dir>]

Steps, each output kept in the run folder:
  1. frog/      Screaming Frog crawl through the shared wrapper (DDEV guard, JSON config,
                render self-test, export verification): every page, axe on every page,
                media and form inventory.
  2. pages.json one representative page per template.
  3. checks/    Playwright keyboard, focus, zoom, reflow, spacing, hover, orientation and
                shortcut checks in Chromium, Firefox and WebKit, after the detector self-test.
  4. report.*   assess.py: 50 criteria, score, report.html, report.json, manual-worksheet.md.
  5. comparison.md when --compare-to names an earlier run.

The target always comes from DDEV; there is no URL argument.
"""
import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SKILL.parents[1] / "scripts" / "frog"))

import assess  # noqa: E402
import compare  # noqa: E402
import frog_inputs  # noqa: E402
import templates  # noqa: E402

CONFIG = SKILL / "config" / "accessibility-local.json"
TABS = ["Internal:All", "Accessibility:All", "Custom Extraction:All"]
BULK = ["Accessibility:All Violations", "Accessibility:All Incomplete"]
REPORTS = ["Accessibility:Accessibility Violations Summary"]
# Rendering may fetch the page's own off-site stylesheets and fonts so axe sees real styles
# (approved 2026-11-24). Everything else off-site stays refused by the wrapper's self-test.
OFFSITE_ASSETS = ("stylesheet", "font")
REQUIRED = {"mCrawlerMode": "RENDER", "mInspectAccessibility": "true", "mCrawlExternalLinks": "false"}


def step(msg):
    print(f"[assess-accessibility] {msg}", flush=True)


def git_commit(root):
    p = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
    return p.stdout.strip() if p.returncode == 0 else None


def crawl(args, out):
    import frog_crawl  # the shared wrapper: test-lab/scripts/frog/frog_crawl.py
    try:
        res = frog_crawl.crawl(args.project, out / "frog", str(CONFIG), url_list=args.crawl_list,
                               tabs=TABS, bulk=BULK, reports=REPORTS, required=REQUIRED,
                               allow_offsite_assets=OFFSITE_ASSETS)
    except (frog_crawl.FrogError, frog_crawl.ddev_guard.GuardError) as e:
        sys.exit(f"crawl refused or failed: {e}")
    (out / "frog-result.json").write_text(json.dumps(res, indent=1))
    for w in res.get("warnings", []):
        step(f"crawl warning: {w}")
    if res.get("crawl_status") != "Finished":
        sys.exit(f"crawl ended {res.get('crawl_status')!r}, not Finished; see {res['log']}")
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--project", required=True, help="DDEV project root")
    ap.add_argument("--out", help="run folder (default <project>/analysis-reports/accessibility-<date>)")
    ap.add_argument("--site", help="name shown on the report (default: DDEV project name)")
    ap.add_argument("--findings")
    ap.add_argument("--manual")
    ap.add_argument("--compare-to")
    ap.add_argument("--max-templates", type=int, default=25)
    ap.add_argument("--crawl-list", help="crawl only these URLs (all must be on the DDEV site)")
    ap.add_argument("--skip-crawl", help="reuse an existing Screaming Frog export folder")
    ap.add_argument("--browsers", default="chromium,firefox,webkit")
    a = ap.parse_args(argv)

    project = Path(a.project).expanduser().resolve()
    stamp = dt.datetime.now().strftime("%Y-%m-%d-%H%M")
    out = Path(a.out).expanduser().resolve() if a.out else project / "analysis-reports" / f"accessibility-{stamp}"
    out.mkdir(parents=True, exist_ok=True)

    if a.skip_crawl:
        frog_dir, meta = Path(a.skip_crawl), {}
        step(f"reusing crawl exports in {frog_dir}")
    else:
        step("crawling with Screaming Frog (this takes a while on large sites)")
        res = crawl(a, out)
        frog_dir = Path(res["output_dir"])
        meta = {k: res.get(k) for k in ("sf_version", "crawl_db_id", "crawl_urls", "ddev_project", "target_url",
                                         "config_path", "sandboxed", "render_selftest", "warnings")}
    meta["commit"] = git_commit(project)

    try:
        data = frog_inputs.load(frog_dir)
    except frog_inputs.ExportError as e:
        sys.exit(f"exports unusable: {e}")
    reps, skipped = templates.choose(data["pages"], a.max_templates)
    origin = data["pages"][next(iter(data["pages"]))]["url"].split("/", 3)
    pages_doc = {"origin": "/".join(origin[:3]), "pages": reps, "templates_not_sampled": skipped,
                 "pages_crawled": len(data["pages"]),
                 "pages_covered_by_sampled_templates": sum(r["count"] for r in reps)}
    (out / "pages.json").write_text(json.dumps(pages_doc, indent=1))
    step(f"{len(data['pages'])} pages crawled; {len(reps)} templates sampled")

    checks = HERE / "checks"
    if not (checks / "node_modules").is_dir():
        sys.exit(f"browser checks not installed: cd {checks} && npm ci && npx playwright install chromium firefox webkit")
    for label, extra in (("detector self-test", ["--self-test"]), ("browser checks", [])):
        step(f"running {label}")
        target = out / ("checks-selftest" if extra else "checks")
        p = subprocess.run(["node", "run.mjs", "--pages", str(out / "pages.json"), "--out", str(target),
                            "--browsers", a.browsers, *extra], cwd=checks)
        if p.returncode != 0:
            sys.exit(f"{label} failed (exit {p.returncode}); see {target}")

    (out / "run-meta.json").write_text(json.dumps(meta, indent=1))
    site = a.site or meta.get("ddev_project") or project.name
    baseline = f"local DDEV {meta.get('ddev_project') or project.name}" + (f", commit {meta['commit']}" if meta.get("commit") else "")
    cli = ["--frog", str(frog_dir), "--pages", str(out / "pages.json"), "--checks", str(out / "checks"),
           "--out", str(out), "--site", site, "--baseline", baseline, "--meta", str(out / "run-meta.json")]
    for flag, val in (("--findings", a.findings), ("--manual", a.manual)):
        if val:
            cli += [flag, val]
    assess.main(cli)

    if a.compare_to:
        before = Path(a.compare_to).expanduser() / "report.json"
        md = compare.markdown(json.loads(before.read_text()), json.loads((out / "report.json").read_text()))
        (out / "comparison.md").write_text(md)
        step(f"comparison -> {out / 'comparison.md'}")
    step(f"done: {out / 'report.html'}")


if __name__ == "__main__":
    main()
