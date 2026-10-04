#!/usr/bin/env python3
"""design-lab:init's checks and fixes: everything about the person and this machine, settled once.

Preflight is about one site and one run; this is about who runs design-lab and with what. Each
check reports `ok`, `missing` (design-lab cannot run until it is fixed) or `advice` (works, with a
cost the person should know), and says how it is fixed and whether fixing installs or changes
something, in which case design-lab:init asks first.

    lab_setup.py check [--json]                 report every check, change nothing
    lab_setup.py set runs project|home          where runs live
    lab_setup.py set operator "<name>"          who runs design-lab, for reports
    lab_setup.py set evaluation <corpus> <ledger> <dashboard>
    lab_setup.py install playwright             a shared Playwright and Chromium for capture
    lab_setup.py install python                 the Python packages the scripts import
    lab_setup.py runner [--imported]            refresh the runner copy and token; record the import
    lab_setup.py claude-settings --allow-folders [<projects folder> ...]
                                                let Claude Code read design-lab's folders (asked first)
    lab_setup.py claude-settings --allow-reads  or turn the read-blocking setting off (asked first)
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import lab_config

PLUGIN_DIR = Path(__file__).resolve().parents[1]
# Third-party Python packages the scripts import, by import name and install name.
PYTHON_PACKAGES = {"PIL": "pillow", "cairosvg": "cairosvg"}   # yaml is optional: scripts fall back
# The first Claude Code that loads mods (the design-lab pane); 2.1.284 does not.
PANE_VERSION = (2, 1, 286)
READ_BLOCK = "blockReadsOutsideWorkingDirectories"


def cache_folder() -> Path:
    """design-lab's own downloads, outside every repository and the person's projects."""
    if os.environ.get("DESIGN_LAB_CACHE"):
        return Path(os.environ["DESIGN_LAB_CACHE"]).expanduser()
    base = Path.home() / ("Library/Caches" if sys.platform == "darwin" else ".cache")
    return base / "design-lab"


def playwright_folder() -> Path:
    return cache_folder() / "playwright"


def run(command: list[str], cwd: Path | None = None, timeout: float = 60) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None


def externally_managed() -> bool:
    """Whether this Python refuses pip installs outside a virtual environment (PEP 668), as
    Homebrew's does; a --user install then needs --break-system-packages."""
    import sysconfig
    return Path(sysconfig.get_paths()["stdlib"], "EXTERNALLY-MANAGED").is_file()


def playwright_ready(folder: Path) -> tuple[bool, str]:
    """Whether node resolves Playwright in `folder` and its Chromium is downloaded."""
    if not shutil.which("node"):
        return False, "node is not installed"
    probe = run(["node", "-e", "const p=require('playwright');console.log(p.chromium.executablePath())"], folder)
    if not probe or probe.returncode != 0:
        return False, f"Playwright does not resolve in {folder}"
    browser = probe.stdout.strip()
    if not browser or not Path(browser).exists():
        return False, f"Playwright's Chromium is not downloaded ({browser or 'no path'})"
    return True, browser


def claude_config_dirs() -> list[Path]:
    dirs = [Path.home() / ".claude"]
    if os.environ.get("CLAUDE_CONFIG_DIR"):
        dirs.append(Path(os.environ["CLAUDE_CONFIG_DIR"]).expanduser())
    seen, out = set(), []
    for folder in dirs:
        settings = (folder / "settings.json").resolve()
        if settings not in seen:
            seen.add(settings)
            out.append(folder)
    return out


def plugin_folders() -> list[Path]:
    """Where design-lab's scripts live for each account: the installed plugin's folder (above its
    version folder, so updates stay covered), or this working copy when run from one."""
    folders = []
    for config in claude_config_dirs():
        cache = config / "plugins" / "cache" / "local" / "design-lab"
        if cache.is_dir():
            folders.append(cache.resolve())
    if not any(PLUGIN_DIR.is_relative_to(folder) for folder in folders):
        folders.append(PLUGIN_DIR)
    return folders


def run_folders(config: dict) -> list[Path]:
    """Where runs live: ~/.design, or the folders the person keeps projects in."""
    if (config.get("runs") or {}).get("convention") == "home":
        return [Path.home() / ".design"]
    return [Path(p).expanduser() for p in (config.get("runs") or {}).get("projectsFolders") or []]


def allowed_folders(path: Path) -> list[Path]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [Path(p).expanduser() for p in (value.get("permissions") or {}).get("additionalDirectories") or []]


def uncovered(needed: list[Path], allowed: list[Path]) -> list[Path]:
    return [n for n in needed if not any(n.resolve() == a.resolve() or n.resolve().is_relative_to(a.resolve())
                                         for a in allowed)]


def blocking_settings() -> list[Path]:
    """Claude Code settings files that block reads outside the working folders."""
    found = []
    for folder in claude_config_dirs():
        path = folder / "settings.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if ((value.get("permissions") or {}).get(READ_BLOCK)) is True:
            found.append(path.resolve())
    return found


def claude_version() -> tuple[int, ...] | None:
    probe = run(["claude", "--version"], timeout=20)
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", probe.stdout if probe else "")
    return tuple(int(x) for x in match.groups()) if match else None


def check(item, status, label, detail, fix=None, approval=None, **extra):
    return {"id": item, "status": status, "label": label, "detail": detail,
            "fix": fix, "needsApproval": approval, **extra}


def checks() -> list[dict]:
    config = lab_config.read_config()
    out = []

    convention = (config.get("runs") or {}).get("convention")
    out.append(check("runs", "ok" if convention in lab_config.CONVENTIONS else "missing", "Where runs live",
                     {"project": "next to each project: PROJECT/design/<date> (PROJECT/worktrees/<name> layouts, or a "
                                 "folder above the repository holding plans/, analysis-reports/ or design/)",
                      "home": "one folder for everything: ~/.design/<project>/<date>"}.get(convention,
                     "not chosen: runs need a folder outside every repository"),
                     None if convention in lab_config.CONVENTIONS else "lab_setup.py set runs project|home"))

    operator = config.get("operator")
    out.append(check("operator", "ok" if operator else "missing", "Your name for reports",
                     operator or "not set: each run would ask for it", None if operator else 'lab_setup.py set operator "<name>"'))

    node = shutil.which("node")
    out.append(check("node", "ok" if node else "missing", "Node.js", node or "not on the path: capture runs Playwright through node",
                     None if node else "install Node.js (for example: brew install node)", None if node else "installs Node.js"))

    folder = Path(config.get("nodeCwd") or playwright_folder())
    ready, detail = playwright_ready(folder)
    out.append(check("playwright", "ok" if ready else "missing", "Playwright and its Chromium, for capture",
                     f"{folder}: Chromium at {detail}" if ready else detail,
                     None if ready else "lab_setup.py install playwright",
                     None if ready else f"downloads Playwright and Chromium (about 150 MB) into {playwright_folder()}",
                     nodeCwd=str(folder) if ready else None))

    absent = [name for module, name in PYTHON_PACKAGES.items() if importlib.util.find_spec(module) is None]
    out.append(check("python", "missing" if absent else "ok", "Python packages",
                     f"missing: {', '.join(absent)}" if absent else ", ".join(PYTHON_PACKAGES.values()),
                     "lab_setup.py install python" if absent else None,
                     f"installs {', '.join(absent)} with pip into your own user folder for {sys.executable}"
                     + (" (Homebrew's Python needs --break-system-packages for that; the system packages are untouched)"
                        if externally_managed() else "") if absent else None))

    ddev = shutil.which("ddev")
    out.append(check("ddev", "ok" if ddev else "advice", "DDEV, for usage counts from a site's database",
                     ddev or "not installed: runs can still build, without usage tiers from a database",
                     None if ddev else "install DDEV if your sites run on it (https://ddev.com)"))

    import figma_runner
    copied = (figma_runner.HOME / "runner" / "manifest.json").is_file()
    token = (figma_runner.HOME / figma_runner.TOKEN_FILE).is_file()
    imported = bool((config.get("runner") or {}).get("imported"))
    status = "ok" if copied and token and imported else "missing"
    detail = ("copied, token ready, imported into Figma desktop" if status == "ok" else
              "; ".join(x for x in (None if copied else "the runner is not copied to its stable folder yet",
                                    None if token else "no runner token yet",
                                    None if imported else "not yet imported into Figma desktop (a one-time step only you can do)") if x))
    out.append(check("runner", status, "The design-lab runner in Figma desktop", detail,
                     None if status == "ok" else "lab_setup.py runner, then import it in Figma desktop, then lab_setup.py runner --imported",
                     manifest=str(figma_runner.HOME / "runner" / "manifest.json")))

    # With Claude Code's read-blocking setting on, every command that names a folder outside the
    # session's own (design-lab's scripts, the run folders) waits for the person, even with
    # permission checks bypassed: runs cannot go unattended until those folders are allowed or
    # the setting is off. Allowing the folders keeps the protection everywhere else.
    blocking = blocking_settings()
    needed = plugin_folders() + run_folders(config)
    missing_folders = sorted({str(f) for path in blocking for f in uncovered(needed, allowed_folders(path))})
    no_projects = blocking and convention == "project" and not run_folders(config)
    if not blocking:
        detail, status = f"{READ_BLOCK} is off", "ok"
    elif not missing_folders and not no_projects:
        detail, status = f"{READ_BLOCK} is on, and design-lab's folders are allowed", "ok"
    else:
        detail, status = (f"{READ_BLOCK} is on in {', '.join(map(str, blocking))}: Claude Code makes you approve every "
                          "command that names a folder outside the session's own, even with permission checks bypassed, "
                          "so runs cannot go unattended. Not yet allowed: "
                          + ", ".join(missing_folders + (["the folders you keep projects in"] if no_projects else []))), "missing"
    out.append(check("claude-settings", status, "Claude Code runs design-lab without asking", detail,
                     None if status == "ok" else "lab_setup.py claude-settings --allow-folders <the folders you keep projects in> "
                     "(recommended: keeps the setting for everything else), or --allow-reads (turns it off)",
                     None if status == "ok" else "changes your Claude Code settings; open sessions need restarting",
                     neededFolders=[str(f) for f in needed]))

    version = claude_version()
    pane = version is not None and version >= PANE_VERSION
    out.append(check("pane", "ok" if pane else "advice", "Claude Code can draw the design-lab pane",
                     f"Claude Code {'.'.join(map(str, version)) if version else 'not found'}" +
                     ("" if pane else f"; the pane needs {'.'.join(map(str, PANE_VERSION))} or later, and runs work without it"),
                     None if pane else "update Claude Code"))

    try:
        lab_config.load_config()
        evaluation = True
    except ValueError:
        evaluation = False
    out.append(check("evaluation", "ok" if evaluation else "advice", "Scoreboard and corpus (optional)",
                     "set" if evaluation else "not set: runs work and score without them; they keep a ledger across runs",
                     None if evaluation else "lab_setup.py set evaluation <corpus> <ledger> <dashboard>"))
    return out


def set_value(key: str, values: list[str]) -> dict:
    config = lab_config.read_config()
    if key == "runs":
        if not values or values[0] not in lab_config.CONVENTIONS:
            raise ValueError(f"runs takes one of: {', '.join(lab_config.CONVENTIONS)}")
        config["runs"] = {"convention": values[0]}
    elif key == "operator":
        if not values or not values[0].strip():
            raise ValueError("operator takes a name")
        config["operator"] = values[0].strip()
    elif key == "evaluation":
        if len(values) != 3:
            raise ValueError("evaluation takes three paths: corpus, scoreboard ledger, scoreboard dashboard")
        config["corpus"] = values[0]
        config["scoreboard"] = {"ledger": values[1], "dashboard": values[2]}
    else:
        raise ValueError(f"unknown setting {key}")
    lab_config.write_config(config)
    return {"written": str(lab_config.config_path()), key: config.get(key) if key != "evaluation" else values}


def install_playwright() -> dict:
    folder = playwright_folder()
    folder.mkdir(parents=True, exist_ok=True)
    if not (folder / "package.json").is_file():
        (folder / "package.json").write_text(json.dumps({"name": "design-lab-playwright", "private": True}) + "\n")
    for command in (["npm", "install", "--no-audit", "--no-fund", "playwright"],
                    ["npx", "playwright", "install", "chromium"]):
        done = run(command, folder, timeout=900)
        if not done or done.returncode != 0:
            raise RuntimeError(f"{' '.join(command)} failed in {folder}: {(done.stderr if done else 'could not run')[-400:]}")
    ready, detail = playwright_ready(folder)
    if not ready:
        raise RuntimeError(detail)
    config = lab_config.read_config()
    config["nodeCwd"] = str(folder)
    lab_config.write_config(config)
    return {"nodeCwd": str(folder), "chromium": detail}


def install_python() -> dict:
    absent = [name for module, name in PYTHON_PACKAGES.items() if importlib.util.find_spec(module) is None]
    if not absent:
        return {"installed": []}
    extra = ["--break-system-packages"] if externally_managed() else []
    done = run([sys.executable, "-m", "pip", "install", "--user", *extra, *absent], timeout=600)
    if not done or done.returncode != 0:
        raise RuntimeError(f"pip install {' '.join(absent)} failed: {(done.stderr if done else 'could not run')[-400:]}")
    return {"installed": absent}


def runner(imported: bool) -> dict:
    import figma_runner
    install = figma_runner.install_runner()
    figma_runner.person_token()            # created once, never printed
    config = lab_config.read_config()
    if imported:
        config["runner"] = {"imported": True}
        lab_config.write_config(config)
    return {"manifest": str(figma_runner.HOME / "runner" / "manifest.json"), "version": install.get("version"),
            "updated": install.get("updated"), "imported": bool((config.get("runner") or {}).get("imported")),
            "token": "ready (copy it in your own terminal with: pbcopy < ~/.design-lab/runner-token)"}


def allow_folders(projects: list[str]) -> dict:
    """Add design-lab's folders to Claude Code's allowed folders, in every settings file that
    blocks reads; the project folders are remembered for the next check."""
    config = lab_config.read_config()
    if projects:
        runs = config.setdefault("runs", {})
        runs["projectsFolders"] = sorted({*runs.get("projectsFolders", []),
                                          *(str(Path(p).expanduser().resolve()) for p in projects)})
        lab_config.write_config(config)
    needed = plugin_folders() + run_folders(config)
    changed = []
    for path in blocking_settings():
        value = json.loads(path.read_text(encoding="utf-8"))
        allowed = value.setdefault("permissions", {}).setdefault("additionalDirectories", [])
        added = [str(f) for f in uncovered(needed, [Path(p).expanduser() for p in allowed])]
        if added:
            allowed.extend(added)
            temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
            temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
            os.replace(temporary, path)
            changed.append({"settings": str(path), "added": added})
    return {"changed": changed, "restart": bool(changed)}


def allow_reads() -> dict:
    changed = []
    for path in blocking_settings():
        value = json.loads(path.read_text(encoding="utf-8"))
        value["permissions"].pop(READ_BLOCK, None)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)
        changed.append(str(path))
    return {"changed": changed, "restart": bool(changed)}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("check")
    c.add_argument("--json", action="store_true")
    s = sub.add_parser("set")
    s.add_argument("key", choices=("runs", "operator", "evaluation"))
    s.add_argument("values", nargs="*")
    i = sub.add_parser("install")
    i.add_argument("what", choices=("playwright", "python"))
    r = sub.add_parser("runner")
    r.add_argument("--imported", action="store_true", help="record that the runner is imported into Figma desktop")
    a = sub.add_parser("claude-settings")
    group = a.add_mutually_exclusive_group(required=True)
    group.add_argument("--allow-folders", nargs="*", metavar="PROJECTS_FOLDER",
                       help="allow design-lab's folders (and the folders you keep projects in, for the project convention)")
    group.add_argument("--allow-reads", action="store_true", help="turn the read-blocking setting off")
    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            found = checks()
            if args.json:
                print(json.dumps({"config": str(lab_config.config_path()), "checks": found}, indent=2))
            else:
                marks = {"ok": "✓", "missing": "✗", "advice": "!"}
                for item in found:
                    print(f"{marks[item['status']]} {item['label']}: {item['detail']}")
                    if item["fix"]:
                        print(f"    fix: {item['fix']}" + (f" ({item['needsApproval']})" if item["needsApproval"] else ""))
            return 0 if all(item["status"] != "missing" for item in found) else 1
        result = (set_value(args.key, args.values) if args.command == "set" else
                  install_playwright() if args.command == "install" and args.what == "playwright" else
                  install_python() if args.command == "install" else
                  runner(args.imported) if args.command == "runner" else
                  allow_folders(args.allow_folders) if args.allow_folders is not None else allow_reads())
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, RuntimeError) as error:
        print(f"design-lab: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
