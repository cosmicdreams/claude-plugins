"""drover.classic_source — pull logs from Acquia Cloud Classic servers.

Cloud Classic environments refuse dated log snapshots: the Cloud API answers
HTTP 409 "Date ranges for log file snapshots are not supported on this
environment." and only hands back the live buffer. Acquia documents SSH,
rsync and SCP as the way to reach older logs there. Each web server keeps one
file per day under ``/var/log/sites/<site>.<env>/logs/<server>/``, rotated
early each morning (around 06:25 UTC) and named for the rotation date:
``access.log-20261028.gz`` holds 2026-10-27 ~06:25 to 2026-10-28 ~06:25.
A log that was empty at rotation gets no file that day, so one rotated file
can span several days.

``ClassicRsyncSource`` mirrors only the rotated files a pull needs into the
project's ``.drover/cache/classic/<env>/<server>/`` with rsync, then cuts
each UTC calendar day out of them by every line's own timestamp. The result
is the same canonical ``<date>.<env>.<type>.log.gz`` file the Cloud API path
writes, so reports cannot tell the two sources apart.
"""
from __future__ import annotations

import gzip
import os
import re
import shlex
import subprocess
import tempfile
from datetime import date, timedelta
from pathlib import Path

# drover log type -> file name stem in the server's log folder.
CLASSIC_BASENAMES = {
    "apache-access": "access",
    "apache-error": "error",
    "drupal-watchdog": "drupal-watchdog",
    "php-error": "php-errors",
    "drupal-request": "drupal-requests",
}

SSH_OPTS = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=30",
    "-o", "StrictHostKeyChecking=accept-new",
]
COMMAND_TIMEOUT_S = 900

_SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_ROTATED = re.compile(r"^(?P<base>[A-Za-z0-9._-]+?)\.log-(?P<ymd>\d{8})(?:\.gz)?$")

_MONTHS = {
    m: i for i, m in enumerate(
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
         "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1,
    )
}
_MON = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
# dd/Mon or dd-Mon: access ([28/Oct/2026:...]) and php-errors ([28-Oct-2026 ...])
_RE_DAY_MON = re.compile(r"\b(\d{1,2})[/-]" + _MON + r"\b")
# Mon dd: error ([Wed Oct 28 ...]) and drupal-watchdog (Oct 28 06:35:46 ...)
_RE_MON_DAY = re.compile(r"\b" + _MON + r"\s+(\d{1,2})\b")
# Every format puts its timestamp at the start of the line.
_TIMESTAMP_WINDOW = 100


class ClassicSourceError(Exception):
    """The environment's server logs could not be listed or copied."""


def line_month_day(line: str) -> tuple[int, int] | None:
    """(month, day) of a line's leading timestamp, or None for a line
    without one (a stack-trace or other continuation line).

    Takes the earliest match so a date quoted later in the message cannot
    stand in for the line's own timestamp.
    """
    head = line[:_TIMESTAMP_WINDOW]
    best: tuple[int, tuple[int, int]] | None = None
    m = _RE_DAY_MON.search(head)
    if m:
        best = (m.start(), (_MONTHS[m.group(2)], int(m.group(1))))
    m = _RE_MON_DAY.search(head)
    if m and (best is None or m.start() < best[0]):
        best = (m.start(), (_MONTHS[m.group(1)], int(m.group(2))))
    return best[1] if best else None


def parse_listing(names: list[str]) -> dict[str, dict]:
    """Group a server log folder listing by file stem.

    Returns {stem: {"rotated": {date: file name}, "live": bool}}.
    """
    listing: dict[str, dict] = {}
    for name in names:
        name = name.strip()
        m = _ROTATED.match(name)
        if m:
            ymd = m.group("ymd")
            try:
                d = date(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:]))
            except ValueError:
                continue
            entry = listing.setdefault(m.group("base"), {"rotated": {}, "live": False})
            # Prefer the compressed copy if both briefly exist.
            if d not in entry["rotated"] or name.endswith(".gz"):
                entry["rotated"][d] = name
        elif name.endswith(".log"):
            entry = listing.setdefault(name[:-4], {"rotated": {}, "live": False})
            entry["live"] = True
    return listing


def files_for_day(listing: dict[str, dict], stem: str, day: date) -> list[str] | None:
    """File names that can hold `stem`'s lines for `day`, oldest first.

    None when the server has not yet rotated past `day`, so the day is still
    being written. Any stem's rotation counts: rotation runs for every log at
    once, and a log that was empty then simply gets no file.

    A file dated `d` holds lines from the stem's previous rotation up to
    rotation on `d`. So the day's lines sit in every file dated from `day`
    up to and including the first one dated after it. If the stem has not
    rotated since the day, its tail is still in the live log.
    """
    after = day + timedelta(days=1)
    if not any(
        d >= after for e in listing.values() for d in e["rotated"]
    ):
        return None
    entry = listing.get(stem, {"rotated": {}, "live": False})
    names: list[str] = []
    for d in sorted(entry["rotated"]):
        if d < day:
            continue
        names.append(entry["rotated"][d])
        if d >= after:
            return names
    if entry["live"]:
        names.append(f"{stem}.log")
    return names


def write_day(paths: list[Path], day: date, dest: Path) -> tuple[int, int]:
    """Write the lines of `paths` dated `day` to `dest` as gzip, atomically.

    A line without a timestamp belongs to the dated line above it. Returns
    (lines written, bytes stored). A day with no lines still gets a file:
    on Classic, no lines means the server logged nothing that day.
    """
    target = (day.month, day.day)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "wb", delete=False, dir=dest.parent,
        prefix=".drover-classic-", suffix=".gz",
    ) as t:
        tmp = Path(t.name)
    written = 0
    try:
        with gzip.open(tmp, "wb") as out:
            for path in paths:
                opener = gzip.open if path.name.endswith(".gz") else open
                current: tuple[int, int] | None = None
                with opener(path, "rb") as fh:
                    for raw in fh:
                        md = line_month_day(raw.decode("utf-8", "replace"))
                        if md is not None:
                            current = md
                        if current != target:
                            continue
                        out.write(raw if raw.endswith(b"\n") else raw + b"\n")
                        written += 1
        size = tmp.stat().st_size
        os.replace(tmp, dest)
        return written, size
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


class ClassicRsyncSource:
    """Cloud Classic: rsync rotated server logs, then split them into days."""

    def __init__(self, client, env: dict, cache_dir: Path, *,
                 run=subprocess.run, log_fn=print):
        self.client = client
        self.env_name = env["name"]
        self.env_id = env["env_id"]
        self.cache_dir = Path(cache_dir)
        self.run = run
        self.log_fn = log_fn
        self.ssh_url = ""
        self.log_root = ""
        self.listings: dict[str, dict] = {}

    def _check(self, cmd: list[str], what: str) -> str:
        try:
            r = self.run(cmd, capture_output=True, text=True,
                         timeout=COMMAND_TIMEOUT_S, check=False)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise ClassicSourceError(f"{what}: {e}") from e
        if r.returncode != 0:
            detail = (r.stderr or r.stdout or "").strip().splitlines()
            raise ClassicSourceError(
                f"{what} exited {r.returncode}"
                + (f": {detail[-1]}" if detail else "")
            )
        return r.stdout

    def prepare(self, log_types: list[str], days: list[date]) -> None:
        """Find the web servers and copy the files `days` need."""
        record = self.client.get_environment(self.env_id)
        ssh_url = record.get("ssh_url") or ""
        user, _, host = ssh_url.partition("@")
        if not (_SAFE_NAME.fullmatch(user) and _SAFE_NAME.fullmatch(host)):
            raise ClassicSourceError(f"unusable ssh_url {ssh_url!r}")
        self.ssh_url = ssh_url
        self.log_root = f"/var/log/sites/{user}/logs"

        servers = [
            s.get("name") for s in self.client.list_servers(self.env_id)
            if "web" in (s.get("roles") or [])
        ]
        if not servers:
            raise ClassicSourceError("no web servers listed for the environment")
        stems = sorted({CLASSIC_BASENAMES[t] for t in log_types
                        if t in CLASSIC_BASENAMES})
        for server in servers:
            if not _SAFE_NAME.fullmatch(server or ""):
                raise ClassicSourceError(f"unusable server name {server!r}")
            remote = f"{self.log_root}/{server}"
            out = self._check(
                ["ssh", *SSH_OPTS, ssh_url, f"ls -1 {shlex.quote(remote)}"],
                f"listing {server}",
            )
            listing = parse_listing(out.splitlines())
            self.listings[server] = listing
            wanted = sorted({
                name for stem in stems for day in days
                for name in (files_for_day(listing, stem, day) or [])
            })
            if not wanted:
                continue
            local = self.cache_dir / server
            local.mkdir(parents=True, exist_ok=True)
            self.log_fn(
                f"  ⇣ {self.env_name} {server}: rsync {len(wanted)} file(s)"
            )
            self._check(
                ["rsync", "-rt", "-e", shlex.join(["ssh", *SSH_OPTS]),
                 *[f"--include={n}" for n in wanted], "--exclude=*",
                 f"{ssh_url}:{remote}/", f"{local}/"],
                f"rsync from {server}",
            )

    def fetch_day(self, log_type: str, day: date, dest: Path) -> dict:
        """Write one day's file to `dest`. Raises ClassicSourceError."""
        stem = CLASSIC_BASENAMES.get(log_type)
        if stem is None:
            raise ClassicSourceError(f"no Cloud Classic server log for {log_type}")
        if not self.listings:
            raise ClassicSourceError("server logs were not listed")
        paths: list[Path] = []
        for server, listing in self.listings.items():
            names = files_for_day(listing, stem, day)
            if names is None:
                raise ClassicSourceError(
                    f"{server} has not rotated past {day} yet"
                )
            for name in names:
                p = self.cache_dir / server / name
                if not p.is_file():
                    raise ClassicSourceError(f"{server}/{name} missing from the cache")
                paths.append(p)
        lines, size = write_day(paths, day, dest)
        return {"bytes": size, "lines": lines, "servers": sorted(self.listings)}
