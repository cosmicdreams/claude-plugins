#!/usr/bin/env python3
"""Run Screaming Frog SEO Spider headless against the local DDEV site only.

Shared by test-lab's SEO and accessibility skills. The target comes from the
DDEV guard, never from a URL argument. Screaming Frog runs inside a macOS
sandbox that blocks every non-loopback connection. The config is a partial
JSON file in Screaming Frog's own config schema (the one its MCP server
documents), applied over the defaults; it must also turn external crawling off.
After the run the wrapper checks, from Screaming Frog's own log, that the config
loaded without unknown fields, that every value it sets took effect, that the
crawl finished, and that every requested export file exists. A missing file is
always an error, never "zero issues".

  frog_crawl.py check
  frog_crawl.py crawl --project <root> --config seo-local.json --output <dir>
        [--crawl-list urls.txt] [--export-tabs "Internal:All,..."]
        [--bulk-export "Issues:All,..."] [--save-report "Crawl Overview,..."]
        [--require mCrawlSitemaps=true ...]
  frog_crawl.py compare --previous <db id> --current <db id> --output <dir>
        [--export-tabs ...] [--save-report "Issues Diff Overview,..."]

Each command prints one JSON object. Exit codes: 0 ok, 2 setup or DDEV problem,
3 refused URL, 4 Screaming Frog failed or its output didn't verify.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ddev_guard  # noqa: E402

HERE = Path(__file__).resolve().parent
APP = Path("/Applications/Screaming Frog SEO Spider.app/Contents")
SF_HOME = Path.home() / ".ScreamingFrogSEOSpider"
SANDBOX = HERE / "localonly.sb"
ALWAYS_REQUIRED = {"mCrawlExternalLinks": "false"}

# Export names whose file names don't follow the snake_case rule (observed on 25.1).
FILE_OVERRIDES = {
    "Issues:All": "issues_reports",
    "Issues Overview:All Issues": "issues_overview_report_all",
    "Redirects:All Redirects": "redirects",
    "Structured Data:Validation Errors & Warnings Summary": "structured_data_error_summary_report",
    "Segments Overview": "segments_overview_report_issues",
    "Crawl Overview Comparison": "comparison_crawl_overview",
    "Issues Diff Overview": "issues_diff_report",
    "Content:Exact Duplicates": "exact_duplicates_report",
    "Content:Near Duplicates": "near_duplicates_report",
}

CONFIG_RE = re.compile(r"\b(m[A-Z][A-Za-z0-9]*)=([^,\[\]\s]*)")
UNKNOWN_RE = re.compile(r"Unknown export: '([^']*)'")
RENDER_FAIL_RE = re.compile(r"Failed to render[^\n]*")
CONFIG_FAIL_RE = re.compile(r"Ignoring unknown config field '[^']*'|Failed to load config[^\n]*")
GIVING_UP_RE = re.compile(r"Giving up on ([^:\s]+)")
VERSION_RE = re.compile(r"Running: Screaming Frog SEO Spider ([0-9.]+)")


class FrogError(Exception):
    def __init__(self, message: str, code: int = 4):
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- parsing

def effective_config(log: str) -> dict[str, list[str]]:
    """Every mField=value Screaming Frog printed when it loaded the config."""
    seen: dict[str, list[str]] = {}
    for key, value in CONFIG_RE.findall(log):
        seen.setdefault(key, []).append(value)
    return seen


def config_requirements(config: dict) -> dict[str, str]:
    """mField=value pairs a JSON config should produce in SF's startup dump.

    JSON keys map to fields by prefixing "m" (crawlExternalLinks ->
    mCrawlExternalLinks). Only scalars are checked; lists and free text are not.
    """
    out: dict[str, str] = {}

    def walk(obj):
        for key, value in obj.items():
            if isinstance(value, dict):
                walk(value)
            elif isinstance(value, bool):
                out["m" + key[0].upper() + key[1:]] = "true" if value else "false"
            elif isinstance(value, (int, float)) or (isinstance(value, str) and value and not any(c.isspace() for c in value)):
                out["m" + key[0].upper() + key[1:]] = str(value)

    walk(config)
    return out


def check_required(config: dict[str, list[str]], required: dict[str, str],
                   optional: dict[str, str] | None = None) -> list[str]:
    """Mismatches. `required` keys must appear in the dump; `optional` keys
    (derived from a JSON config) are checked only when the dump prints them."""
    problems = []
    for key, want in {**(optional or {}), **ALWAYS_REQUIRED, **required}.items():
        got = config.get(key)
        if not got:
            if key in ALWAYS_REQUIRED or key in required:
                problems.append(f"{key} not found in Screaming Frog's config dump")
        elif any(v != want for v in got):
            problems.append(f"{key}={','.join(sorted(set(got)))} (need {want})")
    return problems


def parse_list_crawls(text: str) -> list[dict]:
    """Rows of `--list-crawls`. Wrapped cells continue on rows with an empty id."""
    rows: list[dict] = []
    cols = ["id", "name", "url", "mode", "status", "urls", "complete", "modified", "version"]
    for line in text.splitlines():
        if not line.startswith("║") or "Database Id" in line:
            continue
        cells = [c.strip() for c in line.strip("║").split("│")]
        if len(cells) != len(cols):
            continue
        if cells[0]:
            rows.append(dict(zip(cols, cells)))
        elif rows:
            for k, v in zip(cols, cells):
                if v:
                    rows[-1][k] = rows[-1][k] + v
    return rows


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def candidates(name: str) -> list[str]:
    """Possible file stems for an export, report or bulk-export name."""
    parts = name.split(":")
    out = [FILE_OVERRIDES[name]] if name in FILE_OVERRIDES else []
    out += [" ".join(parts), parts[-1], " ".join(parts[-2:])]
    return [_key(c) for c in out]


def locate(name: str, files: dict[str, Path]) -> Path | None:
    for cand in candidates(name):
        if cand in files:
            return files[cand]
    return None


def output_files(folder: Path) -> dict[str, Path]:
    found = {}
    for p in folder.iterdir():
        if p.is_dir() or p.suffix.lower() in (".csv", ".xlsx", ".xls"):
            found[_key(p.stem)] = p
    return found


def crawl_outcome(status: str, log: str, target_hosts: list[str]) -> list[str]:
    """Warnings for an acceptable non-Finished crawl; FrogError otherwise."""
    if status == "Finished":
        return []
    if status == "Paused" and "Ending the crawl early" in log:
        stuck = set(GIVING_UP_RE.findall(log))
        internal = sorted(h for h in stuck if h.lower() in target_hosts)
        if not internal:
            return [f"crawl ended Paused: only blocked off-site hosts were left ({len(stuck)})"]
        raise FrogError(f"crawl ended Paused with the local site unreachable: {', '.join(internal)}")
    raise FrogError(f"crawl status is {status or 'unknown'}, not Finished")


# ---------------------------------------------------------------- running

def launcher() -> Path:
    path = Path(os.environ.get("FROG_LAUNCHER", APP / "MacOS/ScreamingFrogSEOSpiderLauncher"))
    if not path.exists():
        raise FrogError(f"Screaming Frog not found at {path}; install it or set FROG_LAUNCHER", 2)
    return path


def check_setup() -> dict:
    if sys.platform != "darwin" or not shutil.which("sandbox-exec"):
        raise FrogError("local-only enforcement needs macOS sandbox-exec; other platforms are refused", 2)
    exe = launcher()
    licence = SF_HOME / "licence.txt"
    if not licence.is_file() or licence.stat().st_size == 0:
        raise FrogError("Screaming Frog has no licence: open the app once and enter it (Licence > Enter Licence)", 2)
    spider = SF_HOME / "spider.config"
    if not spider.is_file() or "eula.accepted" not in spider.read_text(errors="ignore"):
        raise FrogError("Screaming Frog's licence agreement isn't accepted: open the app once and accept it", 2)
    return {"launcher": str(exe), "sandbox": str(SANDBOX)}


def resolve_config(path: str) -> tuple[Path, dict[str, str]]:
    """The config file and the field values it must produce."""
    cfg = Path(path).expanduser().resolve()
    if not cfg.is_file():
        raise FrogError(f"config {cfg} is missing", 2)
    if cfg.suffix == ".json":
        try:
            return cfg, config_requirements(json.loads(cfg.read_text()))
        except json.JSONDecodeError as e:
            raise FrogError(f"config {cfg} is not valid JSON: {e}", 2) from None
    if cfg.suffix == ".seospiderconfig":
        return cfg, {}
    raise FrogError(f"config {cfg} must be .json or .seospiderconfig", 2)


def _sandboxed(args: list[str], sandbox: bool = True) -> list[str]:
    """The launcher command, inside the loopback-only sandbox unless rendering.

    Chrome can't start its own sandbox inside sandbox-exec, so JavaScript
    rendering runs outside it. Those runs rely on crawlExternalLinks=false,
    which Screaming Frog applies to every request Chrome makes, and on
    render_selftest proving that before the crawl.
    """
    cmd = [str(launcher()), *args]
    return ["sandbox-exec", "-f", str(SANDBOX), *cmd] if sandbox else cmd


def _join(items) -> str:
    return ",".join(items)


def crawl_args(start: str, url_list: Path | None, config: Path, folder: Path,
               project_name: str, task_name: str, tabs, bulk, reports) -> list[str]:
    args = ["--headless", "--config", str(config)]
    args += ["--crawl-list", str(url_list)] if url_list else ["--crawl", start]
    args += ["--project-name", project_name, "--task-name", task_name,
             "--output-folder", str(folder), "--timestamped-output", "--export-format", "csv"]
    if tabs:
        args += ["--export-tabs", _join(tabs)]
    if bulk:
        args += ["--bulk-export", _join(bulk)]
    if reports:
        args += ["--save-report", _join(reports)]
    return args


def _run_sf(args: list[str], folder: Path, timeout: int, run=subprocess.run,
            sandbox: bool = True) -> tuple[Path, str]:
    """Run SF, return the new timestamped output folder and the log text."""
    folder.mkdir(parents=True, exist_ok=True)
    before = {p.name for p in folder.iterdir()}
    log_path = folder / f".frog-{dt.datetime.now():%Y%m%d%H%M%S}.log"
    try:
        with log_path.open("w") as log:
            proc = run(_sandboxed(args, sandbox), stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise FrogError(f"Screaming Frog ran longer than {timeout}s and was stopped; log {log_path}") from None
    text = log_path.read_text(errors="ignore")
    new = [folder / n for n in {p.name for p in folder.iterdir()} - before if (folder / n).is_dir()]
    if proc.returncode != 0:
        raise FrogError(f"Screaming Frog exited {proc.returncode}; log {log_path}")
    bad_config = CONFIG_FAIL_RE.findall(text)
    if bad_config:
        raise FrogError(f"Screaming Frog didn't load the config cleanly: {bad_config[:3]}. Log {log_path}")
    failed_renders = RENDER_FAIL_RE.findall(text)
    if failed_renders:
        raise FrogError(f"{len(failed_renders)} page(s) failed to render, e.g. {failed_renders[0][:200]}. Log {log_path}")
    unknown = UNKNOWN_RE.findall(text)
    if unknown:
        raise FrogError(f"Screaming Frog rejected export name(s) {unknown}; nothing was written. Log {log_path}")
    if len(new) != 1:
        raise FrogError(f"expected one new timestamped folder in {folder}, found {len(new)}; log {log_path}")
    out = new[0]
    shutil.move(str(log_path), out / "frog.log")
    return out, text


def _verify_files(out: Path, tabs, bulk, reports) -> dict:
    files = output_files(out)
    found, missing = {}, []
    for kind, names in (("export_tabs", tabs), ("bulk_exports", bulk), ("reports", reports)):
        found[kind] = {}
        for name in names:
            path = locate(name, files)
            if path is None:
                missing.append(name)
            else:
                found[kind][name] = str(path)
    if missing:
        raise FrogError(f"missing export file(s) for {missing} in {out}")
    return found


def _db_row(task_name: str, run=subprocess.run) -> dict:
    proc = run(_sandboxed(["--headless", "--list-crawls"]), capture_output=True, text=True, timeout=300)
    matches = [r for r in parse_list_crawls(proc.stdout) if r["name"] == task_name]
    if not matches:
        raise FrogError(f"crawl {task_name!r} not in --list-crawls; is Screaming Frog in database storage mode?")
    return matches[0]


PROBE_PAGE = """<!doctype html><html lang="en"><head><title>frog render self-test</title>
<link rel="stylesheet" href="{ext}/style.css"><script src="{ext}/script.js"></script></head>
<body><h1>self-test</h1><img src="{ext}/img.png" alt="probe"><iframe src="{ext}/frame.html" title="probe"></iframe>
<script>fetch('/render-ok').catch(function(){{}}); fetch('{ext}/fetch').catch(function(){{}});
var i = new Image(); i.src = '{ext}/jsimg.png';</script></body></html>"""


def _server(hits: list, body: str | None = None) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            hits.append(self.path)
            data = (body if body is not None and self.path == "/" else "ok").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html" if self.path == "/" else "text/plain")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def render_selftest(config: Path, run=subprocess.run, timeout: int = 600) -> dict:
    """Prove this config renders JavaScript and requests nothing off-site.

    Serves a page on 127.0.0.1 that loads a script, stylesheet, image, iframe,
    link, fetch() and a script-made image from a second local server reached
    as "localhost" (a different host, so external to Screaming Frog). The crawl
    must hit /render-ok on the page's own host, which only executed JavaScript
    does, and must send nothing at all to the second server.
    """
    ext_hits: list = []
    site_hits: list = []
    ext = _server(ext_hits)
    ext_url = f"http://localhost:{ext.server_address[1]}"
    site = _server(site_hits, PROBE_PAGE.format(ext=ext_url))
    task = f"render-selftest-{dt.datetime.now():%Y%m%d%H%M%S}"
    try:
        with tempfile.TemporaryDirectory() as tmp:
            args = ["--headless", "--config", str(config), "--crawl", f"http://127.0.0.1:{site.server_address[1]}/",
                    "--task-name", task, "--output-folder", tmp, "--timestamped-output",
                    "--export-tabs", "Internal:All"]
            try:
                _, log = _run_sf(args, Path(tmp), timeout, run, sandbox=False)
            except FrogError as e:
                raise FrogError(f"render self-test failed: {e}") from None
    finally:
        site.shutdown()
        ext.shutdown()
    if ext_hits:
        raise FrogError(f"render self-test: the config let Screaming Frog request off-site URLs {sorted(set(ext_hits))}")
    if "/render-ok" not in site_hits:
        raise FrogError("render self-test: the page's JavaScript never ran, so rendering isn't working")
    version = VERSION_RE.search(log)
    return {"passed": True, "offsite_requests": 0, "javascript_ran": True,
            "sf_version": version.group(1) if version else None}


def crawl(project_root, output, config_path, url_list=None,
          tabs=(), bulk=(), reports=(), required=None, start=True, timeout=4 * 3600,
          run=subprocess.run) -> dict:
    setup = check_setup()
    target = ddev_guard.resolve(project_root, start=start)
    list_path = None
    if url_list:
        ddev_guard.check_list(url_list, target)
        list_path = Path(url_list).resolve()
    config, from_config = resolve_config(config_path)
    render = from_config.get("mCrawlerMode") in ("RENDER", "AJAX")
    selftest = render_selftest(config, run) if render else None
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    task = f"{config.stem}-{stamp}"
    args = crawl_args(target.primary_url, list_path, config, Path(output).resolve(),
                      target.name, task, tabs, bulk, reports)
    out, log = _run_sf(args, Path(output).resolve(), timeout, run, sandbox=not render)
    eff = effective_config(log)
    problems = check_required(eff, required or {}, from_config)
    unverified = sorted(k for k in from_config if k not in eff)
    if problems:
        raise FrogError("config check failed: " + "; ".join(problems) + f". Log {out / 'frog.log'}")
    row = _db_row(task, run)
    warnings = crawl_outcome(row.get("status", ""), log, target.hosts)
    version = VERSION_RE.search(log)
    return {
        "target_url": target.primary_url,
        "ddev_project": target.name,
        "allowed_hosts": target.hosts,
        "output_dir": str(out),
        "log": str(out / "frog.log"),
        "exports": _verify_files(out, tabs, bulk, reports),
        "crawl_db_id": row["id"],
        "crawl_status": row.get("status"),
        "crawl_urls": row.get("urls"),
        "task_name": task,
        "sf_version": version.group(1) if version else None,
        "config_path": str(config),
        "effective_config": {k: v[0] for k, v in eff.items() if len(set(v)) == 1},
        "warnings": warnings,
        "unverified_settings": unverified,
        "sandboxed": not render,
        "render_selftest": selftest,
        "launcher": setup["launcher"],
    }


def compare(previous, current, output, tabs=(), reports=(), timeout=3600, run=subprocess.run) -> dict:
    check_setup()
    args = ["--headless", "--crawl-comparison", previous, current, "--output-folder",
            str(Path(output).resolve()), "--timestamped-output", "--export-format", "csv"]
    if tabs:
        args += ["--export-tabs", _join(tabs)]
    if reports:
        args += ["--save-report", _join(reports)]
    out, log = _run_sf(args, Path(output).resolve(), timeout, run)
    version = VERSION_RE.search(log)
    return {
        "previous": previous,
        "current": current,
        "output_dir": str(out),
        "log": str(out / "frog.log"),
        "exports": _verify_files(out, tabs, (), reports),
        "sf_version": version.group(1) if version else None,
    }


# ---------------------------------------------------------------- CLI

def _csv(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def _required(pairs) -> dict[str, str]:
    out = {}
    for pair in pairs or []:
        key, _, value = pair.partition("=")
        if not key or not _:
            raise FrogError(f"--require needs key=value, got {pair!r}", 2)
        out[key] = value
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    c = sub.add_parser("crawl")
    c.add_argument("--project", default=".")
    c.add_argument("--output", required=True)
    c.add_argument("--config", required=True, help="partial JSON config (or a .seospiderconfig)")
    c.add_argument("--crawl-list")
    c.add_argument("--export-tabs")
    c.add_argument("--bulk-export")
    c.add_argument("--save-report")
    c.add_argument("--require", action="append")
    c.add_argument("--no-start", action="store_true")
    m = sub.add_parser("compare")
    m.add_argument("--previous", required=True)
    m.add_argument("--current", required=True)
    m.add_argument("--output", required=True)
    m.add_argument("--export-tabs")
    m.add_argument("--save-report")
    a = p.parse_args(argv)
    try:
        if a.cmd == "check":
            result = check_setup()
        elif a.cmd == "crawl":
            result = crawl(a.project, a.output, a.config, a.crawl_list,
                           _csv(a.export_tabs), _csv(a.bulk_export), _csv(a.save_report),
                           _required(a.require), start=not a.no_start)
        else:
            result = compare(a.previous, a.current, a.output, _csv(a.export_tabs), _csv(a.save_report))
    except (FrogError, ddev_guard.GuardError) as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        return e.code
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
