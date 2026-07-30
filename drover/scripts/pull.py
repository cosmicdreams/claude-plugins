#!/usr/bin/env python3
"""drover.pull — date-ranged Acquia application error log fetcher.

Reconciles a project's local log folder against the manifest.

THE ONE-PER-24h CONSTRAINT
--------------------------
Acquia keeps exactly **one** packaged log file per ``(environment, log_type)``
at a time. The download endpoint is keyed only by env + type and always
hands back "the most recently created snapshot" — there is no snapshot id
in the download path. So each new log-create for the same ``(env, type)``
*supersedes* the previous packaged file.

A naïve batch (fire all creates, then download all) therefore returns the
SAME last-created snapshot for every day — duplicate, mislabeled files.

The only correct algorithm is to **fully download a snapshot before creating
the next one for the same ``(env, type)``**:

  for day in days:                       # strict serial within (env, type)
      create(env, type, day) → poll → download → verify dominant date

Distinct ``(env, type)`` keys map to distinct packaged files, so they may run
in parallel. ``reconcile`` groups missing tuples by ``(env, type)``,
serializes days within a group, and parallelizes across groups
(``--concurrency`` = max parallel groups).

Every downloaded file is verified post-download: its dominant log date must
match the requested day, or it is rejected (``snapshot-mismatch``) and never
recorded as ``present``.

CLI usage:
  # Single day:
  python3 pull.py --env prod --date 2026-04-03 [--type drupal-watchdog]

  # Explicit range:
  python3 pull.py --env prod --from 2026-04-01 --to 2026-04-30

  # Last 30 days, fill any gaps (default backfill window):
  python3 pull.py --env prod --backfill

  # Yesterday only — for daily cron:
  python3 pull.py --env prod --daily

  # All envs configured in the manifest:
  python3 pull.py --env all --daily

  # Preview only:
  python3 pull.py --env prod --backfill --dry-run
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# Import AcquiaClient from sibling module without pip install.
sys.path.insert(0, str(Path(__file__).parent / "monitors"))
from acquia_api import AcquiaClient, AcquiaAPIError  # noqa: E402


DEFAULT_TYPES = ["apache-error", "drupal-watchdog", "php-error"]
POLL_DEADLINE_S = 180
POLL_INTERVAL_S = 3
RATE_LIMIT_BETWEEN_CALLS_S = 1.0
DEFAULT_BACKFILL_DAYS = 30
RETRY_TRANSIENT_FAILURES = 1
# Verification reads at most this many lines to find the dominant log date.
# A day's true date dwarfs the handful of UTC-midnight spillover lines at the
# top of a file, so a bounded head-scan is both fast and correct.
MAX_VERIFY_LINES = 50000


# --- Path helpers ---------------------------------------------------------

def find_drover_root(cwd: Path) -> Path:
    """Find the drover data root from a working directory.

    When running inside a git worktree (.../worktrees/<name>/...),
    returns the directory above worktrees/ so artifacts land outside
    the git repo. Otherwise walks up to the nearest ancestor that
    already has .drover/manifest.json. Falls back to cwd.
    """
    resolved = cwd.resolve()
    for candidate in [resolved, *resolved.parents]:
        if candidate.name == "worktrees" and candidate.parent.is_dir():
            return candidate.parent
    for candidate in [resolved, *resolved.parents]:
        if (candidate / ".drover" / "manifest.json").exists():
            return candidate
    return resolved


def canonical_path(
    project_root: Path,
    day: date,
    env_name: str,
    log_type: str,
) -> Path:
    """Return <project_root>/<year>/<month>/<date>.<env>.<type>.log.gz"""
    return (
        project_root
        / f"{day.year:04d}"
        / f"{day.month:02d}"
        / f"{day.isoformat()}.{env_name}.{log_type}.log.gz"
    )


def find_log_file(
    project_root: Path,
    day: date,
    env_name: str,
    log_type: str,
) -> Path | None:
    """Return path of an existing log file: checks .log.gz then .log."""
    gz = canonical_path(project_root, day, env_name, log_type)
    if file_present_and_complete(gz):
        return gz
    plain = gz.with_suffix("")  # .log.gz → .log
    if file_present_and_complete(plain):
        return plain
    return None


def manifest_path(project_root: Path) -> Path:
    return project_root / ".drover" / "manifest.json"


def coverage_path(project_root: Path) -> Path:
    return project_root / ".drover" / "coverage.json"


# --- Manifest -------------------------------------------------------------

def load_manifest(project_root: Path) -> dict:
    p = manifest_path(project_root)
    if not p.exists():
        raise FileNotFoundError(
            f"No manifest at {p}. Run /drover:init first."
        )
    with open(p) as fh:
        return json.load(fh)


def find_env(manifest: dict, env_name: str) -> dict:
    envs = manifest.get("acquia", {}).get("envs", [])
    for env in envs:
        if env.get("name") == env_name:
            return env
    available = [e.get("name") for e in envs]
    raise ValueError(
        f"env '{env_name}' not in manifest. Available: {available}"
    )


# --- Coverage ledger ------------------------------------------------------

def load_coverage(project_root: Path) -> dict:
    p = coverage_path(project_root)
    if not p.exists():
        return {}
    with open(p) as fh:
        return json.load(fh)


def save_coverage(project_root: Path, coverage: dict) -> None:
    p = coverage_path(project_root)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    with open(tmp, "w") as fh:
        json.dump(coverage, fh, indent=2, sort_keys=True)
    os.rename(tmp, p)


def mark_coverage(
    coverage: dict,
    day: date,
    env_name: str,
    log_type: str,
    state: str,
    **extra,
) -> None:
    key = day.isoformat()
    coverage.setdefault(key, {})
    coverage[key][f"{env_name}.{log_type}"] = {
        "state": state,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        **extra,
    }


# --- Single-file primitives -----------------------------------------------

class PullError(Exception):
    """Recoverable failure on a single (day, env, type) — caller marks
    coverage=fetch-failed and moves on."""


def file_present_and_complete(path: Path) -> bool:
    """Existence + non-empty. Atomic rename guarantees a canonical file is
    always complete — a partial download never reaches the canonical name."""
    return path.exists() and path.stat().st_size > 0


GZIP_MAGIC = b"\x1f\x8b"


def is_gzip(path: Path) -> bool:
    """True when the file starts with the gzip magic number."""
    with open(path, "rb") as fh:
        return fh.read(2) == GZIP_MAGIC


def gzip_in_place(path: Path) -> None:
    """Compress `path` with gzip, replacing it atomically."""
    tmp = path.with_name(path.name + ".gztmp")
    try:
        with open(path, "rb") as src, gzip.open(tmp, "wb") as dst:
            shutil.copyfileobj(src, dst)
        os.replace(tmp, path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def download_atomic(s3_url: str, dest: Path) -> int:
    """Stream a file from S3 and store it gzip-compressed at dest.

    Returns the stored file size in bytes. Raises on network failure.

    Acquia serves these logs already gzipped, which is why nothing here
    re-compresses a payload that arrives compressed — that would spend CPU to
    shave a constant factor off a cost that is already small. But the stored
    path always ends in .log.gz, and every reader picks its opener from that
    suffix, so a payload that arrived *un*compressed would be stored under a
    name that lies about its contents. Downstream that surfaces as a gzip
    error far from the cause. Sniff the magic number and compress only when
    it is actually missing, so what is on disk always matches its name.

    Atomicity: staged as a sibling tempfile, then os.rename into place.
    A failure at any step leaves the canonical path untouched.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "wb",
        delete=False,
        dir=dest.parent,
        prefix=".drover-pull-",
        suffix=".gz",
    ) as t:
        tmp_path = Path(t.name)
    try:
        urllib.request.urlretrieve(s3_url, tmp_path)
        if not is_gzip(tmp_path):
            gzip_in_place(tmp_path)
        gz_size = tmp_path.stat().st_size
        os.rename(tmp_path, dest)
        return gz_size
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


# --- Post-download verification ------------------------------------------

_MONTHS = {
    m: i for i, m in enumerate(
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
         "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1,
    )
}
_MON_RE = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
# dd/Mon or dd-Mon — apache-access ([10/May/2026]) and php-error (03-Apr-2026)
_RE_DAY_MON = re.compile(r"\b(\d{1,2})[/-]" + _MON_RE + r"\b")
# Mon dd — apache-error ([Tue Apr 03 ...]) and drupal-watchdog (Apr  3 ...)
_RE_MON_DAY = re.compile(r"\b" + _MON_RE + r"\s+(\d{1,2})\b")


def _line_month_day(line: str) -> tuple[int, int] | None:
    """Extract a (month, day) from one log line across all four log formats.

    Year is intentionally ignored — drupal-watchdog (syslog) carries no year,
    and (month, day) alone uniquely identifies a day within Acquia's 30-day
    retention window, which is all the snapshot-mismatch check needs.
    """
    m = _RE_DAY_MON.search(line)
    if m:
        return (_MONTHS[m.group(2)], int(m.group(1)))
    m = _RE_MON_DAY.search(line)
    if m:
        return (_MONTHS[m.group(1)], int(m.group(2)))
    return None


class UnreadableLogFile(PullError):
    """A downloaded file could not be read at all (e.g. not valid gzip)."""


def dominant_month_day(
    path: Path, *, max_lines: int = MAX_VERIFY_LINES,
) -> tuple[int, int] | None:
    """Return the most common (month, day) across a log file's lines.

    Reads .gz transparently. Returns None when the file is readable but no
    line carries a recognizable date — the caller treats that as "cannot
    verify" rather than a mismatch.

    Raises UnreadableLogFile when the file cannot be decoded at all. That is
    a different condition entirely: a file we cannot open is corrupt, not
    merely undated, and collapsing the two would let a broken download skip
    verification and be recorded `present` — failing later, at report time,
    far from the cause.
    """
    opener = gzip.open if path.suffix == ".gz" else open
    counts: Counter[tuple[int, int]] = Counter()
    try:
        with opener(path, "rt", errors="replace") as fh:
            for i, line in enumerate(fh):
                if i >= max_lines:
                    break
                md = _line_month_day(line)
                if md is not None:
                    counts[md] += 1
    except OSError as e:
        raise UnreadableLogFile(f"{path.name}: {type(e).__name__}: {e}") from e
    if not counts:
        return None
    return counts.most_common(1)[0][0]


def file_md5(path: Path) -> str:
    """Hex md5 of a file, streamed in chunks."""
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pull_one(
    client: AcquiaClient,
    env_id: str,
    env_name: str,
    log_type: str,
    day: date,
    project_root: Path,
    *,
    poll_deadline_s: int = POLL_DEADLINE_S,
    poll_interval_s: int = POLL_INTERVAL_S,
) -> dict:
    """Fetch a single (day, env, type) end-to-end (create → poll → download).

    For single-file fetches. Bulk backfills should use reconcile(), which
    separates Phase 1 (create-all) from Phase 2 (poll+download-loop) so
    Acquia processes all snapshots in parallel.
    """
    existing = find_log_file(project_root, day, env_name, log_type)
    if existing is not None:
        return {
            "state": "present",
            "bytes": existing.stat().st_size,
            "fetched": False,
        }

    from_iso = f"{day.isoformat()}T00:00:00+00:00"
    to_iso = f"{day.isoformat()}T23:59:59+00:00"

    notif = client.request_log_download(
        env_id, log_type, from_iso=from_iso, to_iso=to_iso,
    )
    notif_url = (
        notif.get("_links", {}).get("notification", {}).get("href")
    )
    if not notif_url:
        raise PullError(
            f"no notification URL in create response: {notif!r}"
        )
    notif_uuid = notif_url.rsplit("/", 1)[-1]

    deadline = time.time() + poll_deadline_s
    last_status = "?"
    while time.time() < deadline:
        s = client.check_log_download(notif_url)
        last_status = s.get("status", "?")
        if last_status in ("completed", "failed"):
            break
        time.sleep(poll_interval_s)
    if last_status != "completed":
        raise PullError(
            f"notification {notif_uuid} ended with status={last_status}"
        )

    local = canonical_path(project_root, day, env_name, log_type)
    s3_url = client.get_log_download_url(env_id, log_type)
    gz_size = download_atomic(s3_url, local)

    try:
        observed = dominant_month_day(local)
    except UnreadableLogFile:
        local.unlink(missing_ok=True)
        raise
    if observed is not None and observed != (day.month, day.day):
        local.unlink(missing_ok=True)
        raise PullError(
            f"snapshot-mismatch: file dominant date "
            f"{observed[0]:02d}-{observed[1]:02d} != requested "
            f"{day.month:02d}-{day.day:02d} (stale Acquia snapshot)"
        )

    return {
        "state": "present",
        "bytes": gz_size,
        "notification_uuid": notif_uuid,
        "fetched": True,
    }


# --- Range expansion ------------------------------------------------------

def date_range(from_d: date, to_d: date) -> list[date]:
    """Inclusive list of dates from from_d to to_d."""
    if from_d > to_d:
        return []
    out = []
    cur = from_d
    while cur <= to_d:
        out.append(cur)
        cur = cur + timedelta(days=1)
    return out


def resolve_target_envs(manifest: dict, env_arg: str) -> list[dict]:
    """Resolve --env <name> | --env all into a list of env entries."""
    envs = manifest.get("acquia", {}).get("envs", []) or []
    if env_arg == "all":
        if not envs:
            raise ValueError("manifest has no envs")
        return envs
    match = next((e for e in envs if e.get("name") == env_arg), None)
    if not match:
        names = [e.get("name") for e in envs]
        raise ValueError(
            f"env '{env_arg}' not in manifest. Available: {names}"
        )
    return [match]


def resolve_dates(args: argparse.Namespace) -> list[date]:
    """Resolve the date range from CLI args. Exactly one mode required."""
    modes = [bool(args.date), bool(args.daily), bool(args.backfill),
             bool(args.from_ and args.to)]
    if sum(modes) != 1:
        raise ValueError(
            "specify exactly one of: --date, --daily, --backfill, "
            "--from/--to"
        )
    today = datetime.now(timezone.utc).date()
    if args.date:
        d = date.fromisoformat(args.date)
        return [d]
    if args.daily:
        return [today - timedelta(days=1)]
    if args.backfill:
        days = (
            args.backfill_days if args.backfill_days else DEFAULT_BACKFILL_DAYS
        )
        # Never include today — Acquia rotates at UTC midnight, so today's
        # slice is still being written.
        end = today - timedelta(days=1)
        start = end - timedelta(days=days - 1)
        return date_range(start, end)
    # --from/--to: exclude today. A create for the current UTC day returns
    # HTTP 400 (Acquia rotates at UTC midnight, so today's slice is still
    # being written), so clamp the window end to yesterday.
    from_d = date.fromisoformat(args.from_)
    to_d = date.fromisoformat(args.to)
    yesterday = today - timedelta(days=1)
    if to_d > yesterday:
        to_d = yesterday
    return date_range(from_d, to_d)


# --- Reconcile orchestrator -----------------------------------------------

def reconcile(
    client: AcquiaClient | None,
    project_root: Path,
    target_envs: list[dict],
    target_types: list[str] | None,
    days: list[date],
    *,
    dry_run: bool = False,
    rate_limit_s: float = RATE_LIMIT_BETWEEN_CALLS_S,
    retries: int = RETRY_TRANSIENT_FAILURES,
    poll_interval_s: int = POLL_INTERVAL_S,
    poll_deadline_s: int = POLL_DEADLINE_S,
    concurrency: int = 4,
    log_fn=print,
) -> dict:
    """Reconcile missing logs, serial per ``(env, type)`` across days.

    Missing tuples are grouped by ``(env, type)``. Days within a group are
    fetched strictly one at a time — create → poll → download → verify —
    because Acquia keeps only one packaged snapshot per ``(env, type)`` and
    the download endpoint always returns "the most recent" one. Groups
    (distinct ``(env, type)`` keys, which map to distinct packaged files)
    run in parallel, up to ``concurrency`` at a time.

    Every download is verified: its dominant log date must match the
    requested day, or it is rejected as ``snapshot-mismatch`` (retried once,
    never recorded as ``present``).

    Returns a summary dict: {present, fetched, failed, skipped, total}
    """
    coverage = load_coverage(project_root)
    summary = {"present": 0, "fetched": 0, "failed": 0, "skipped": 0, "total": 0}

    # Scan disk: count already-present files, collect missing tuples.
    missing: list[tuple] = []
    for env in target_envs:
        env_name = env["name"]
        env_id = env.get("env_id")
        types = target_types or env.get("types") or DEFAULT_TYPES
        log_fn(
            f"\n[{env_name}] env_id={env_id or '<none>'} "
            f"types={types} days={len(days)}"
        )
        for log_type in types:
            for day in days:
                summary["total"] += 1
                if dry_run:
                    if find_log_file(project_root, day, env_name, log_type) is not None:
                        log_fn(f"  [dry] {day} {log_type}: present")
                        summary["present"] += 1
                    else:
                        log_fn(f"  [dry] {day} {log_type}: would fetch")
                        summary["skipped"] += 1
                else:
                    existing_path = find_log_file(
                        project_root, day, env_name, log_type,
                    )
                    if existing_path is not None:
                        cov_entry = coverage.get(day.isoformat(), {}).get(
                            f"{env_name}.{log_type}"
                        )
                        if not cov_entry:
                            mark_coverage(
                                coverage, day, env_name, log_type,
                                state="present",
                                bytes=existing_path.stat().st_size,
                            )
                        log_fn(
                            f"  = {day} {log_type}: present "
                            f"({existing_path.stat().st_size:,} bytes)"
                        )
                        summary["present"] += 1
                    else:
                        missing.append((env, log_type, day))

    if dry_run:
        return summary

    if not missing:
        save_coverage(project_root, coverage)
        return summary

    # Group missing tuples by (env, type). Days within a group are fetched
    # strictly serially (the one-per-24h constraint); distinct groups run in
    # parallel up to `concurrency`.
    groups: dict[tuple[str, str], dict] = {}
    for env, log_type, day in missing:
        key = (env["name"], log_type)
        g = groups.setdefault(
            key, {"env": env, "log_type": log_type, "days": []}
        )
        g["days"].append(day)
    for g in groups.values():
        g["days"].sort()

    total_missing = len(missing)
    pace_lock = threading.Lock()     # guard the log-create pacing schedule
    ledger_lock = threading.Lock()   # guard the shared coverage dict + file
    print_lock = threading.Lock()    # keep progress lines from interleaving
    counters = {"fetched": 0, "failed": 0}
    next_create_at = [0.0]           # monotonic time of the next allowed create

    def safe_log(msg: str) -> None:
        with print_lock:
            log_fn(msg)

    def create_notification(env_id, log_type, from_iso, to_iso):
        """Fire one log-create, paced `rate_limit_s` apart across all groups.

        The lock is held only long enough to claim a slot in the pacing
        schedule. Both the wait and the HTTP request happen outside it, so a
        group awaiting its turn no longer blocks every other group's create,
        and a group that has just fired starts polling immediately instead of
        sleeping out the rate limit first.

        Returns (notif_url, notif_uuid). Raises on failure."""
        if client is None:
            raise PullError("Client is None")
        with pace_lock:
            now = time.monotonic()
            wait = max(0.0, next_create_at[0] - now)
            next_create_at[0] = max(now, next_create_at[0]) + rate_limit_s
        if wait > 0:
            time.sleep(wait)
        notif = client.request_log_download(
            env_id, log_type, from_iso=from_iso, to_iso=to_iso,
        )
        notif_url = (
            notif.get("_links", {}).get("notification", {}).get("href")
        )
        if not notif_url:
            raise PullError(f"no notification URL in response: {notif!r}")
        return notif_url, notif_url.rsplit("/", 1)[-1]

    def fetch_day(env_id, env_name, log_type, day, seen_md5) -> tuple[str, str]:
        """create → poll → download → verify for a single day.

        Retries once (per `retries`) on notification failure, poll-deadline,
        or snapshot-mismatch. Returns (state, detail) where state is
        'present' or 'fetch-failed'.
        """
        from_iso = f"{day.isoformat()}T00:00:00+00:00"
        to_iso = f"{day.isoformat()}T23:59:59+00:00"
        attempts = retries + 1
        reason = "unknown"

        for attempt in range(attempts):
            last = attempt == attempts - 1

            # Re-check presence immediately before spending a create. The
            # up-front scan is a snapshot of the filesystem at start-up; a
            # long run gives another writer (a concurrent pull, a manual
            # fetch) time to land this file in the meantime. Re-checking
            # costs one stat and avoids both a wasted snapshot request and a
            # needless overwrite of a file that is already good.
            existing = find_log_file(project_root, day, env_name, log_type)
            if existing is not None:
                size = existing.stat().st_size
                safe_log(
                    f"  = {day} {env_name} {log_type}: appeared during run, "
                    f"skipping ({size:,} bytes)"
                )
                with ledger_lock:
                    mark_coverage(
                        coverage, day, env_name, log_type,
                        state="present", bytes=size,
                    )
                    save_coverage(project_root, coverage)
                return "present", str(size)
            try:
                notif_url, notif_uuid = create_notification(
                    env_id, log_type, from_iso, to_iso,
                )
            except Exception as e:
                reason = (
                    f"acquia-api {e.status} {e.error_slug}"
                    if isinstance(e, AcquiaAPIError)
                    else f"{type(e).__name__}: {e}"
                )
                safe_log(
                    f"  ! {day} {env_name} {log_type}: create failed ({e})"
                    + ("" if last else ", retrying")
                )
                continue

            safe_log(
                f"  + {day} {env_name} {log_type}: snapshot requested"
                + (f" (attempt {attempt + 1}/{attempts})" if attempt else "")
            )

            # Poll this day's notification to completion. Acquia packages the
            # snapshot asynchronously onto S3, so this is the long leg of the
            # run. Every check is reported: without it, a snapshot that is
            # still building and one whose status call is erroring on every
            # attempt look identical — both are silent until the deadline.
            deadline = time.time() + poll_deadline_s
            started = time.time()
            status = "?"
            checks = 0
            last_error: str | None = None
            while time.time() < deadline:
                checks += 1
                try:
                    status = client.check_log_download(notif_url).get(
                        "status", "?"
                    )
                    last_error = None
                    detail = f"status={status}"
                except Exception as e:
                    # Do not leave `status` holding a stale value from an
                    # earlier successful check — an errored check knows
                    # nothing about the snapshot's current state.
                    status = "?"
                    last_error = f"{type(e).__name__}: {e}"
                    detail = f"check failed ({last_error})"
                elapsed = time.time() - started
                if status in ("completed", "failed"):
                    safe_log(
                        f"  · {day} {env_name} {log_type}: {detail} "
                        f"after {elapsed:.0f}s ({checks} checks)"
                    )
                    break
                safe_log(
                    f"  · {day} {env_name} {log_type}: poll {checks} "
                    f"{detail} ({elapsed:.0f}s elapsed, "
                    f"{max(0.0, deadline - time.time()):.0f}s to deadline)"
                )
                time.sleep(poll_interval_s)

            if status != "completed":
                if status == "failed":
                    reason = "notification status=failed"
                elif last_error is not None:
                    reason = (
                        f"poll deadline exceeded after {checks} checks; "
                        f"last check error: {last_error}"
                    )
                else:
                    reason = (
                        f"poll deadline exceeded after {checks} checks "
                        f"(last status={status})"
                    )
                safe_log(
                    f"  ~ {day} {env_name} {log_type}: {reason}"
                    + ("" if last else ", retrying")
                )
                continue

            # Download the snapshot we just created (== "most recent").
            local = canonical_path(project_root, day, env_name, log_type)
            try:
                s3_url = client.get_log_download_url(env_id, log_type)
                safe_log(
                    f"  ↓ {day} {env_name} {log_type}: downloading"
                )
                gz_size = download_atomic(s3_url, local)
            except Exception as e:
                reason = f"{type(e).__name__}: {e}"
                safe_log(
                    f"  ! {day} {env_name} {log_type}: download failed ({e})"
                    + ("" if last else ", retrying")
                )
                continue

            # Verify: dominant date must match the requested day, and the
            # file must not duplicate another day already pulled in this group.
            try:
                observed = dominant_month_day(local)
            except UnreadableLogFile as e:
                local.unlink(missing_ok=True)
                reason = f"unreadable download: {e}"
                safe_log(
                    f"  ✗ {day} {env_name} {log_type}: {reason}"
                    + ("" if last else ", retrying")
                )
                continue
            if observed is not None and observed != (day.month, day.day):
                local.unlink(missing_ok=True)
                reason = (
                    f"snapshot-mismatch: file dominant date "
                    f"{observed[0]:02d}-{observed[1]:02d} != requested "
                    f"{day.month:02d}-{day.day:02d}"
                )
                safe_log(
                    f"  ✗ {day} {env_name} {log_type}: {reason}"
                    + ("" if last else ", retrying")
                )
                continue

            digest = file_md5(local)
            dup_day = seen_md5.get(digest)
            if dup_day is not None:
                local.unlink(missing_ok=True)
                reason = (
                    f"snapshot-mismatch: byte-identical to {dup_day} "
                    f"(stale snapshot)"
                )
                safe_log(
                    f"  ✗ {day} {env_name} {log_type}: {reason}"
                    + ("" if last else ", retrying")
                )
                continue

            seen_md5[digest] = day.isoformat()
            with ledger_lock:
                mark_coverage(
                    coverage, day, env_name, log_type,
                    state="present", bytes=gz_size,
                    notification_uuid=notif_uuid,
                )
                save_coverage(project_root, coverage)
            return "present", str(gz_size)

        # All attempts exhausted.
        with ledger_lock:
            mark_coverage(
                coverage, day, env_name, log_type,
                state="fetch-failed", reason=reason,
            )
            save_coverage(project_root, coverage)
        return "fetch-failed", reason

    def process_group(g: dict) -> None:
        """Fetch every day of one (env, type) group, strictly in order."""
        env = g["env"]
        env_name = env["name"]
        env_id = env.get("env_id")
        log_type = g["log_type"]
        seen_md5: dict[str, str] = {}
        for day in g["days"]:
            state, detail = fetch_day(
                env_id, env_name, log_type, day, seen_md5,
            )
            with print_lock:
                if state == "present":
                    counters["fetched"] += 1
                else:
                    counters["failed"] += 1
                done = counters["fetched"]
                failed = counters["failed"]
                pending = total_missing - done - failed
                if state == "present":
                    log_fn(
                        f"  ✓ {day} {env_name} {log_type}: "
                        f"{int(detail):,} bytes — "
                        f"{done}/{total_missing} done, {pending} pending"
                    )
                else:
                    log_fn(
                        f"  ! {day} {env_name} {log_type}: "
                        f"fetch-failed ({detail})"
                    )

    log_fn(
        f"\nReconciling {total_missing} files across {len(groups)} "
        f"(env,type) group(s), {min(concurrency, len(groups))} in parallel; "
        f"serial per group across days."
    )
    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as executor:
        futures = [
            executor.submit(process_group, g) for g in groups.values()
        ]
        for f in futures:
            f.result()

    summary["fetched"] = counters["fetched"]
    summary["failed"] = counters["failed"]
    return summary


# --- CLI ------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="drover-pull",
        description="Reconcile Acquia application error logs into a "
                    "project's local folder by date.",
    )
    p.add_argument(
        "--project", type=Path, default=Path.cwd(),
        help="project root (default: cwd)",
    )
    p.add_argument(
        "--env", default="prod",
        help="env name from manifest, or 'all' (default: prod)",
    )

    # Date selection (mutually exclusive — exactly one required)
    p.add_argument("--date", default=None, help="single day, YYYY-MM-DD")
    p.add_argument("--from", dest="from_", default=None,
                   help="range start, YYYY-MM-DD (use with --to)")
    p.add_argument("--to", default=None,
                   help="range end, YYYY-MM-DD (use with --from)")
    p.add_argument("--backfill", action="store_true",
                   help="fill gaps over the last N days (default 30)")
    p.add_argument("--backfill-days", type=int, default=None,
                   help="override default 30-day backfill window")
    p.add_argument("--daily", action="store_true",
                   help="yesterday only — for cron")

    # Type selection
    p.add_argument("--type", default=None,
                   help="single log type (default: all types from manifest)")
    p.add_argument("--types", default=None,
                   help="comma-separated log types (overrides --type)")

    # Behavior
    p.add_argument("--dry-run", action="store_true",
                   help="show what would be fetched, do nothing")
    p.add_argument("--retries", type=int, default=RETRY_TRANSIENT_FAILURES,
                   help=f"retries on create failure "
                        f"(default {RETRY_TRANSIENT_FAILURES})")
    p.add_argument("--rate-limit-s", type=float,
                   default=RATE_LIMIT_BETWEEN_CALLS_S,
                   help=f"sleep between log-create requests in Phase 1 "
                        f"(default {RATE_LIMIT_BETWEEN_CALLS_S}s)")
    p.add_argument("--poll-deadline-s", type=int, default=POLL_DEADLINE_S,
                   help=f"max seconds to wait in Phase 2 poll loop "
                        f"(default {POLL_DEADLINE_S}s)")
    p.add_argument("--concurrency", type=int, default=4,
                   help="max (env,type) groups fetched in parallel "
                        "(default: 4). Days within a group are always "
                        "serial — Acquia keeps one snapshot per (env,type).")

    return p.parse_args(argv)


def cli_main(argv: list[str] | None = None) -> int:
    # A pull is long and mostly silent while Acquia builds snapshots. Python
    # block-buffers stdout when it is redirected to a file or a pipe, which
    # holds every progress line until the run ends — making a working pull
    # indistinguishable from a hung one. Force line buffering so callers see
    # each event as it happens without needing `python3 -u`.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(line_buffering=True)
        except (AttributeError, ValueError):
            pass

    args = parse_args(argv)
    project_root = find_drover_root(args.project.resolve())

    try:
        manifest = load_manifest(project_root)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    try:
        envs = resolve_target_envs(manifest, args.env)
        days = resolve_dates(args)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    if args.types:
        types_override = [
            t.strip() for t in args.types.split(",") if t.strip()
        ]
    elif args.type:
        types_override = [args.type]
    else:
        types_override = None

    print(
        f"pull project={project_root.name} envs={[e['name'] for e in envs]} "
        f"days={len(days)} ({days[0]}..{days[-1]}) "
        f"types={types_override or 'manifest-default'} "
        f"dry_run={args.dry_run} concurrency={args.concurrency}"
    )

    client = None if args.dry_run else AcquiaClient()
    summary = reconcile(
        client, project_root, envs, types_override, days,
        dry_run=args.dry_run,
        rate_limit_s=args.rate_limit_s,
        retries=args.retries,
        poll_deadline_s=args.poll_deadline_s,
        concurrency=args.concurrency,
    )

    print(
        f"\nDone. total={summary['total']} "
        f"fetched={summary['fetched']} present={summary['present']} "
        f"failed={summary['failed']} skipped={summary['skipped']}"
    )
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    sys.exit(cli_main())
