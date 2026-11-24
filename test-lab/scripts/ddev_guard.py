#!/usr/bin/env python3
"""Resolve a scan target from DDEV and refuse anything that isn't that local site.

Scanners in test-lab run only against a locally running DDEV project. The target
URL comes from `ddev describe -j` in the project folder, never from the user.
A stopped project is started (unless --no-start). Any URL whose host isn't one
of the project's DDEV hostnames, localhost or 127.0.0.1 is refused.

  ddev_guard.py describe --project <root> [--no-start]   -> JSON target
  ddev_guard.py check-url --project <root> <url>...       -> exit 0 or 3
  ddev_guard.py check-list --project <root> <file>        -> exit 0 or 3

Exit codes: 0 ok, 2 DDEV unavailable or not running, 3 refused URL.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

LOOPBACK = {"localhost", "127.0.0.1"}


class GuardError(Exception):
    """The target can't be resolved or a URL is outside the guarded site."""

    def __init__(self, message: str, code: int = 2):
        super().__init__(message)
        self.code = code


@dataclass
class Target:
    name: str
    approot: str
    primary_url: str
    hosts: list[str] = field(default_factory=list)
    project_type: str = ""

    def allows(self, url: str) -> bool:
        parts = urlsplit(url.strip())
        if parts.scheme not in ("http", "https") or not parts.hostname:
            return False
        return parts.hostname.lower() in self.hosts


def _run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def describe(project_root: str | Path, run=_run) -> dict:
    root = Path(project_root).expanduser().resolve()
    if not (root / ".ddev" / "config.yaml").is_file():
        raise GuardError(f"{root} is not a DDEV project (.ddev/config.yaml missing)")
    try:
        proc = run(["ddev", "describe", "-j"], str(root))
    except FileNotFoundError:
        raise GuardError("ddev is not installed or not on PATH") from None
    if proc.returncode != 0:
        raise GuardError(f"ddev describe failed: {(proc.stderr or proc.stdout).strip()[:300]}")
    # Usually one JSON document; some ddev versions print log lines first,
    # one JSON object per line. The object with "raw" is the description.
    try:
        data = json.loads(proc.stdout)
        if isinstance(data, dict) and "raw" in data:
            return data["raw"]
    except json.JSONDecodeError:
        pass
    for line in reversed(proc.stdout.splitlines()):
        line = line.strip()
        if line.startswith("{"):
            data = json.loads(line)
            if "raw" in data:
                return data["raw"]
    raise GuardError("ddev describe -j returned no project description")


def _target(raw: dict) -> Target:
    hosts = {h.lower() for h in raw.get("hostnames") or []}
    for key in ("primary_url", "httpurl", "httpsurl"):
        host = urlsplit(raw.get(key) or "").hostname
        if host:
            hosts.add(host.lower())
    for url in raw.get("urls") or []:
        host = urlsplit(url).hostname
        if host:
            hosts.add(host.lower())
    hosts |= LOOPBACK
    primary = raw.get("primary_url") or raw.get("httpsurl") or raw.get("httpurl") or ""
    if not primary:
        raise GuardError("DDEV reports no primary URL for this project")
    return Target(
        name=raw.get("name", ""),
        approot=raw.get("approot", ""),
        primary_url=primary.rstrip("/") + "/",
        hosts=sorted(hosts),
        project_type=raw.get("type", ""),
    )


def resolve(project_root: str | Path, start: bool = True, run=_run) -> Target:
    raw = describe(project_root, run)
    if raw.get("status") != "running":
        if not start:
            raise GuardError(f"DDEV project {raw.get('name')} is {raw.get('status')}; start it with `ddev start`")
        proc = run(["ddev", "start"], str(Path(project_root).expanduser().resolve()))
        if proc.returncode != 0:
            raise GuardError(f"ddev start failed: {(proc.stderr or proc.stdout).strip()[:300]}")
        raw = describe(project_root, run)
        if raw.get("status") != "running":
            raise GuardError(f"DDEV project {raw.get('name')} is still {raw.get('status')} after ddev start")
    return _target(raw)


def check_url(url: str, target: Target) -> str:
    if not target.allows(url):
        raise GuardError(f"refused: {url!r} is not on {target.name} ({', '.join(target.hosts)})", 3)
    return url.strip()


def check_list(path: str | Path, target: Target) -> list[str]:
    urls = [line.strip() for line in Path(path).read_text().splitlines() if line.strip()]
    if not urls:
        raise GuardError(f"{path} has no URLs", 3)
    refused = [u for u in urls if not target.allows(u)]
    if refused:
        shown = ", ".join(refused[:5]) + (" ..." if len(refused) > 5 else "")
        raise GuardError(f"refused {len(refused)} URL(s) not on {target.name}: {shown}", 3)
    return urls


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("describe")
    d.add_argument("--project", default=".")
    d.add_argument("--no-start", action="store_true")
    u = sub.add_parser("check-url")
    u.add_argument("--project", default=".")
    u.add_argument("urls", nargs="+")
    lst = sub.add_parser("check-list")
    lst.add_argument("--project", default=".")
    lst.add_argument("file")
    a = p.parse_args(argv)
    try:
        target = resolve(a.project, start=not getattr(a, "no_start", False))
        if a.cmd == "describe":
            print(json.dumps(asdict(target), indent=2))
        elif a.cmd == "check-url":
            for url in a.urls:
                check_url(url, target)
        else:
            check_list(a.file, target)
    except GuardError as e:
        print(str(e), file=sys.stderr)
        return e.code
    return 0


if __name__ == "__main__":
    sys.exit(main())
