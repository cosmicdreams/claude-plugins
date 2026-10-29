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
each calendar day out of them by every line's own timestamp. The result
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
# Each log's own timestamp, anchored at the start of the line, as
# (pattern, month group, day group). Anything else is a continuation line.
_TIMESTAMPS = {
    # 62.122.109.250 - - [27/Oct/2026:06:25:14 +0000] "GET ...
    "access": (re.compile(r"^[^\[]*\[(\d{1,2})/" + _MON + r"/\d{4}:"), 2, 1),
    # [Wed Oct 28 02:07:47 2026] [error] ...
    "error": (re.compile(r"^\[\w{3} " + _MON + r"\s+(\d{1,2}) \d\d:"), 1, 2),
    # Oct 27 06:31:55 srv-7135 site[28617]: ...
    "drupal-watchdog": (re.compile(r"^" + _MON + r"\s+(\d{1,2}) \d\d:"), 1, 2),
    # [27-Oct-2026 18:34:31 America/Chicago] Uncaught PHP Exception ...
    "php-errors": (re.compile(r"^\[(\d{1,2})-" + _MON + r"-\d{4} "), 2, 1),
    # [27/Oct/2026:06:26:05 +0000] host GET /path ...
    "drupal-requests": (re.compile(r"^\[(\d{1,2})/" + _MON + r"/\d{4}:"), 2, 1),
}


class ClassicSourceError(Exception):
    """The environment's server logs could not be listed or copied."""


def line_month_day(line: str, stem: str) -> tuple[int, int] | None:
    """(month, day) of the timestamp that starts a `stem` log line, or None
    for a line that does not start with one (a stack-trace frame or other
    continuation line, which belongs to the entry above it).
    """
    pattern, month, day = _TIMESTAMPS[stem]
    m = pattern.match(line)
    if not m:
        return None
    return (_MONTHS[m.group(month)], int(m.group(day)))


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


def history_gap(listing: dict[str, dict], day: date) -> str | None:
    """Why `day` cannot be cut from these files, or None when it can.

    Rotation runs for every log at once and a log that was empty then just
    gets no file, so any stem's rotated files mark the span of history held.
    A day is whole once a file is dated after it. It is only known to be
    held if a file is dated on or before it: older files may have been
    cleaned up or lost when Acquia relaunched the server. Only the server's
    own listing counts; the local cache holds just the files earlier pulls
    asked for, so it cannot show which days a log was empty.
    """
    dates = [d for e in listing.values() for d in e["rotated"]]
    if not dates or max(dates) <= day:
        return f"has not rotated past {day} yet"
    if min(dates) > day:
        return f"holds no rotated logs before {min(dates)}"
    return None


def files_for_day(listing: dict[str, dict], stem: str, day: date) -> list[str] | None:
    """File names that can hold `stem`'s lines for `day`, oldest first, or
    None when `history_gap` says the day cannot be cut from them.

    A file dated `d` holds lines from the stem's previous rotation up to
    rotation on `d`. So the day's lines sit in every file dated from `day`
    up to and including the first one dated after it. If the stem has not
    rotated since the day, its tail is still in the live log.
    """
    if history_gap(listing, day) is not None:
        return None
    after = day + timedelta(days=1)
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


def write_day(paths: list[Path], stem: str, day: date, dest: Path) -> tuple[int, int]:
    """Write the lines of `stem` log `paths` dated `day` to `dest` as gzip,
    atomically. Each line is filed under the date its own timestamp shows
    (UTC, except php-errors, which uses the PHP timezone).

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
                        md = line_month_day(raw.decode("utf-8", "replace"), stem)
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
            gap = history_gap(listing, day)
            if gap is not None:
                raise ClassicSourceError(f"{server} {gap}")
            names = files_for_day(listing, stem, day) or []
            for name in names:
                p = self.cache_dir / server / name
                if not p.is_file():
                    raise ClassicSourceError(f"{server}/{name} missing from the cache")
                paths.append(p)
        lines, size = write_day(paths, stem, day, dest)
        return {"bytes": size, "lines": lines, "servers": sorted(self.listings)}
