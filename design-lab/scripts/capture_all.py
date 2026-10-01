#!/usr/bin/env python3
"""Scaffold, check, measure, capture, assemble, and register visual evidence.

Incremental: every component's outcome is recorded in `capture/records/` the moment it
finishes, and a later run skips any component whose record matches its current config. An
interrupted run loses at most the component in progress, and fixing one component costs one
component (`--only`). `--check` runs only the selector check: one desktop page load per
candidate page, which finds broken selectors and hidden instances in seconds per component.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from glob import escape as glob_escape
from pathlib import Path

from artifact_contracts import write_json


SCRIPTS = Path(__file__).resolve().parent
NO_EVIDENCE = "Not built — no visual evidence"
VIEWPORTS = ("desktop", "tablet", "mobile")


def run(command, cwd=None):
    return subprocess.run(command, cwd=cwd, text=True, capture_output=True)


def check(result, label):
    if result.returncode:
        raise RuntimeError(f"{label} failed: {(result.stderr or result.stdout).strip()}")


def globally_excluded(component):
    usage = component.get("usage") or {}
    return bool(component.get("globallyExcluded") or usage.get("globallyExcluded")
                or component.get("excluded") or usage.get("excluded"))


def stem(component_id):
    """The file stem for a component. Machine names collide (a block and a paragraph can
    both be `card`); component ids do not."""
    return component_id.replace(":", "__").replace("/", "__")


def config_hash(cfg, scale):
    """What an outcome was produced from: the config and the screenshot scale."""
    return hashlib.sha256(json.dumps([cfg, scale], sort_keys=True).encode()).hexdigest()


def read_record(record_path):
    """A record, or None when it is missing or unreadable (treated as not captured)."""
    try:
        return json.loads(record_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def candidate_pages(cfg, component, limit):
    """The scaffolded page first, then the other verified example pages, at most `limit`."""
    pages = [cfg["path"]]
    for example in (component.get("usage") or {}).get("examples") or []:
        if isinstance(example, dict) and example.get("path") and example["path"] not in pages:
            pages.append(example["path"])
    return pages[:limit]


def on_page(cfg, path, site_url, canonical_base_url):
    moved = dict(cfg)
    moved["path"] = path
    moved["verificationUrl"] = site_url.rstrip("/") + "/" + path.lstrip("/")
    moved["linkUrl"] = canonical_base_url.rstrip("/") + "/" + path.lstrip("/")
    return moved


def measurement_failures(spec_path):
    if not spec_path.is_file():
        return ["measure.mjs"]
    results = json.loads(spec_path.read_text(encoding="utf-8")).get("measurements") or {}
    failures = sorted({f"{viewport}:default" for viewport in VIEWPORTS} - results.keys())
    failures.extend(key for key, value in results.items()
                    if not isinstance(value, dict) or value.get("error"))
    return failures


def record_is_current(record_path, digest):
    record = read_record(record_path)
    return bool(record) and record.get("configHash") == digest and record.get("status") == "complete"


def selector_check(pending, by_id, site_url, canonical_base_url, max_pages, capture_dir,
                   node_cwd):
    """Run check_selectors.mjs once over every pending component; return results by id."""
    checks = []
    for cfg in pending:
        pages = candidate_pages(cfg, by_id[cfg["componentId"]], max_pages)
        states = cfg.get("states") or [{}]
        checks.append({
            "componentId": cfg["componentId"], "rootSelector": cfg["rootSelector"],
            "setup": states[0].get("setup"), "anchorText": cfg.get("anchorText"),
            "mustContain": cfg.get("mustContain"),
            "pages": [{"path": page, "verificationUrl":
                       on_page(cfg, page, site_url, canonical_base_url)["verificationUrl"]}
                      for page in pages]})
    checks_path = capture_dir / "selector-check-input.json"
    result_path = capture_dir / "selector-check.json"
    write_json(checks_path, checks)
    result_path.unlink(missing_ok=True)
    started = time.monotonic()
    print(f"selector check: {len(checks)} component(s)", flush=True)
    result = run(["node", str(SCRIPTS / "check_selectors.mjs"), "--input", str(checks_path),
                  "--out", str(result_path)], cwd=node_cwd)
    print(result.stdout, end="", flush=True)
    if result.returncode or not result_path.is_file():
        raise RuntimeError("selector check failed: " +
                           (result.stderr or result.stdout or "no result").strip()[:240])
    print(f"selector check took {time.monotonic() - started:.0f}s", flush=True)
    return {row["componentId"]: row for row in
            json.loads(result_path.read_text(encoding="utf-8"))}


def check_detail(checked):
    pages = checked.get("pages") or []
    parts = [f"{page['path']}: " + (page["error"] if page.get("error") else
                                    f"{page.get('matches', 0)} match(es), none visible")
             for page in pages]
    return "selector check: no visible match on %d page(s) (%s)" % (len(pages), "; ".join(parts))


def measure(cfg, pages, config_path, spec_path, measurements, args):
    """Measure on each page in turn until one gives all three widths; return the outcome."""
    failures, result, used = ["measure.mjs"], None, None
    for page in pages:
        cfg = on_page(cfg, page, args.site_url, args.canonical_base_url)
        config_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
        spec_path.unlink(missing_ok=True)
        # One retry: a local development server under load occasionally times out a page.
        for _attempt in range(2):
            result = run(["node", str(SCRIPTS / "measure.mjs"), "--config", str(config_path),
                          "--out", str(measurements)], cwd=args.node_cwd)
            if not result.returncode and spec_path.is_file():
                break
        failures, used = measurement_failures(spec_path), page
        if not failures:
            break
    return cfg, used, failures, result


def screenshots(cfg, configs, shots, args):
    """Capture one component's screenshots, file them under its stem, and return the rows."""
    work = shots / ".work" / stem(cfg["componentId"])
    shutil.rmtree(work, ignore_errors=True)
    # A recapture replaces the component's pictures; a leftover would read as a duplicate.
    for old in shots.glob(glob_escape(stem(cfg["componentId"])) + "__*.png"):
        old.unlink()
    work.mkdir(parents=True)
    result = run(["node", str(SCRIPTS / "capture.mjs"), "--configs", str(configs),
                  "--only-ids", cfg["componentId"], "--out", str(work),
                  "--scale", str(args.scale)], cwd=args.node_cwd)
    index = work / "index.json"
    if not index.is_file():
        return [{"componentId": cfg["componentId"], "machine": cfg["machineName"],
                 "error": "capture failed: " +
                          (result.stderr or result.stdout or "index.json missing").strip()[:240]}]
    rows = [row for row in json.loads(index.read_text(encoding="utf-8"))
            if row.get("componentId", cfg["componentId"]) == cfg["componentId"]
            and (row.get("machine") in (None, cfg["machineName"]))]
    for row in rows:
        row["componentId"] = cfg["componentId"]
        if row.get("file"):
            name = stem(cfg["componentId"]) + row["file"][len(cfg["machineName"]):]
            shutil.move(str(work / row["file"]), str(shots / name))
            row["file"] = name
    shutil.rmtree(work, ignore_errors=True)
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--site-url", required=True)
    parser.add_argument("--canonical-base-url", required=True)
    parser.add_argument("--theme-root", required=True, type=Path)
    parser.add_argument("--node-cwd", required=True, type=Path)
    parser.add_argument("--scale", type=float, default=1)
    parser.add_argument("--only", help="comma-separated component ids to (re)capture")
    parser.add_argument("--check", action="store_true",
                        help="run only the selector check and report; capture nothing")
    parser.add_argument("--no-check", action="store_true",
                        help="skip the selector check (it loads desktop width only)")
    parser.add_argument("--fresh", action="store_true",
                        help="discard recorded outcomes for the selected components first")
    parser.add_argument("--max-pages", type=int, default=3,
                        help="verified example pages to try per component (default 3)")
    args = parser.parse_args(argv)
    workspace = args.project.resolve()
    components_path = workspace / "components.json"
    components = json.loads(components_path.read_text(encoding="utf-8"))["components"]
    capture_dir = workspace / "capture"
    configs = capture_dir / "configs"
    measurements = capture_dir / "measurements"
    shots = capture_dir / "shots"
    records = capture_dir / "records"
    for directory in (configs, measurements, shots, records):
        directory.mkdir(parents=True, exist_ok=True)

    # Configs are derived and cheap, so they are rewritten every run; the record of each
    # component's outcome carries the hash of the config it was produced from, and a changed
    # config (new selector, new example page) makes the old outcome stale.
    scaffold = run([sys.executable, str(SCRIPTS / "scaffold_configs.py"),
                    str(components_path), "--out", str(configs), "--force",
                    "--site-url", args.site_url, "--canonical-base-url",
                    args.canonical_base_url, "--theme-root", str(args.theme_root)])
    check(scaffold, "scaffold")

    by_id = {c["id"]: c for c in components}
    selected = set(args.only.split(",")) if args.only else None
    unknown = sorted((selected or set()) - by_id.keys())
    if unknown:
        raise SystemExit("unknown component id(s): " + ", ".join(unknown))
    eligible = {cid for cid, c in by_id.items() if not globally_excluded(c)}
    problems, ready = {}, []
    for path in sorted(configs.glob("*.json")):
        cfg = json.loads(path.read_text(encoding="utf-8"))
        cid = cfg["componentId"]
        if cid not in eligible:
            path.unlink()
        elif not cfg.get("path") or not cfg.get("verificationUrl"):
            problems[cid] = NO_EVIDENCE
            path.unlink()
        elif not cfg.get("rootSelector"):
            problems[cid] = "no root selector"
            path.unlink()
        else:
            ready.append((path, cfg, config_hash(cfg, args.scale)))

    pending, complete = [], 0
    for path, cfg, digest in ready:
        record_path = records / f"{stem(cfg['componentId'])}.json"
        chosen = selected is None or cfg["componentId"] in selected
        if chosen and args.fresh:
            record_path.unlink(missing_ok=True)
        current = record_is_current(record_path, digest)
        complete += current
        if chosen and (args.check or not current):
            pending.append((path, cfg, digest))
    print(f"{len(ready)} component(s) capturable, {complete} complete, "
          f"{len(pending)} to do now", flush=True)

    checked = {}
    if pending and not args.no_check:
        checked = selector_check([cfg for _, cfg, _ in pending], by_id, args.site_url,
                                 args.canonical_base_url, args.max_pages, capture_dir,
                                 args.node_cwd)
    if args.check:
        failed = [cid for cid, row in checked.items() if not row.get("chosen")]
        print(f"selector check: {len(checked) - len(failed)} found, {len(failed)} not found")
        return 1 if failed else 0

    started_all = time.monotonic()
    for number, (path, cfg, digest) in enumerate(pending, 1):
        started = time.monotonic()
        cid = cfg["componentId"]
        component = by_id[cid]
        record = {"componentId": cid, "configHash": digest, "status": "failed",
                  "problems": [], "rows": []}
        row = checked.get(cid)
        if row is not None and not row.get("chosen"):
            record["problems"].append(check_detail(row))
            record["selectorCheck"] = row
        else:
            # The selector check already found the page; measurement then needs one page.
            pages = ([row["chosen"]] if row else
                     candidate_pages(cfg, component, args.max_pages))
            if row and row.get("revealed"):
                # Drawn only by showing a hidden ancestor (an inactive tab or closed panel).
                record["revealed"] = True
            spec_path = measurements / f"{cfg['machineName']}.spec.json"
            cfg, used, failures, result = measure(cfg, pages, path, spec_path, measurements, args)
            record["path"] = used
            if failures == ["measure.mjs"]:
                record["problems"].append("measurement failed: " + (
                    (result.stderr or result.stdout) if result else "spec file missing"
                ).strip()[:240])
            elif failures:
                record["problems"].append("measurement failed: " + ", ".join(sorted(failures)))
            if spec_path.is_file():
                # Filed under the component id so a block and a paragraph sharing a machine
                # name never overwrite each other.
                spec_path.replace(measurements / f"{stem(cid)}.spec.json")
            record["rows"] = screenshots(cfg, configs, shots, args)
            record["problems"].extend(
                f"capture failed at {r.get('viewport') or '?'} ({r.get('state') or 'default'}): "
                f"{r['error']}" for r in record["rows"] if r.get("error"))
            observed = {r["viewport"].lower() for r in record["rows"]
                        if not r.get("error") and r.get("state") == "default"}
            missing = sorted(set(VIEWPORTS) - observed)
            if missing:
                record["problems"].append("default capture missing: " + ", ".join(missing))
            if not record["problems"]:
                record["status"] = "complete"
        record["seconds"] = round(time.monotonic() - started, 1)
        write_json(records / f"{stem(cid)}.json", record)
        elapsed = time.monotonic() - started_all
        remaining = elapsed / number * (len(pending) - number)
        print(f"[{number}/{len(pending)}] {cid}: {record['status']} in {record['seconds']}s"
              + (" (revealed)" if record.get("revealed") else "")
              + f" — about {remaining / 60:.0f} min left"
              + ("" if record["status"] == "complete" else f" ({record['problems'][0]})"),
              flush=True)

    # Evidence is assembled from every current record, so a partial run (`--only`, or an
    # interrupted one resumed later) still produces evidence for everything finished so far.
    rows = []
    for path, cfg, digest in ready:
        record_path = records / f"{stem(cfg['componentId'])}.json"
        record = read_record(record_path)
        if not record or record.get("configHash") != digest:
            problems[cfg["componentId"]] = "not captured yet"
            continue
        rows.extend(r for r in record["rows"] if not r.get("error"))
        if record["problems"]:
            problems[cfg["componentId"]] = "; ".join(record["problems"])
    index_path = shots / "index.json"
    write_json(index_path, rows)

    evidence_path = workspace / "capture-evidence.json"
    assembled = run([sys.executable, str(SCRIPTS / "assemble_capture_evidence.py"),
                     str(index_path), "--out", str(evidence_path),
                     "--canonical-base-url", args.canonical_base_url])
    check(assembled, "assemble capture evidence")
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    # Keep what the assembler found too, one line per component.
    for problem in evidence["problems"]:
        cid = problem["componentId"]
        if problem["detail"] not in problems.get(cid, ""):
            problems[cid] = "; ".join(filter(None, [problems.get(cid), problem["detail"]]))
    evidence["problems"] = [{"componentId": cid, "detail": detail}
                            for cid, detail in sorted(problems.items())]
    write_json(evidence_path, evidence)
    registered = run([sys.executable, str(SCRIPTS / "workflow.py"), "register",
                      "--project", str(workspace), "--name", "captureEvidence",
                      "--path", str(evidence_path), "--kind", "capture-evidence",
                      "--phase", "capture"])
    check(registered, "register capture evidence")

    print(f"captured: {len(evidence['captures'])}; failed: {len(evidence['problems'])}")
    for problem in evidence["problems"]:
        print(f"  {problem['componentId']}: {problem['detail']}")
    return 1 if evidence["problems"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
