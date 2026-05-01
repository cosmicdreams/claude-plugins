#!/usr/bin/env python3
"""drover.pull — date-ranged Acquia application error log fetcher.

Reconciles a project's local log folder against the manifest. For each
(date, env, type) tuple requested:

  1. If the file is already on disk and complete, mark coverage=present.
  2. Otherwise: POST a 24-hour log snapshot to Acquia, poll until
     status=completed, GET the resource path to capture the 301 redirect
     to the presigned S3 URL, download, gunzip, atomically rename into
     <project>/<year>/<month>/<date>.<env>.<type>.log, update the
     coverage ledger.

Uses only the public API of AcquiaClient. Pure stdlib.

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
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.request
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


# --- Path helpers ---------------------------------------------------------

def canonical_path(
    project_root: Path,
    day: date,
    env_name: str,
    log_type: str,
) -> Path:
    """Return <project_root>/<year>/<month>/<date>.<env>.<type>.log."""
    return (
        project_root
        / f"{day.year:04d}"
        / f"{day.month:02d}"
        / f"{day.isoformat()}.{env_name}.{log_type}.log"
    )


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


# --- Single-day pull primitive --------------------------------------------

class PullError(Exception):
    """Recoverable failure on a single (day, env, type) — caller marks
    coverage=fetch-failed and moves on."""


def file_present_and_complete(path: Path) -> bool:
    """Existence + non-empty. A future hardening would add a per-file
    completion sentinel (size manifest, trailing-newline check, etc.).
    For 2.0 we trust atomic rename — a partial download never reaches
    the canonical filename."""
    return path.exists() and path.stat().st_size > 0


def download_atomic_gunzip(s3_url: str, dest: Path) -> tuple[int, int]:
    """Stream a gzipped file from S3, gunzip into `dest` atomically.

    Returns (gz_bytes, decoded_bytes). Raises on network or decode failure.

    Atomicity: stages the gzipped download AND the decoded output as
    sibling tempfiles, then `os.rename`s the decoded file into place.
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
        gz_path = Path(t.name)
    try:
        urllib.request.urlretrieve(s3_url, gz_path)
        gz_size = gz_path.stat().st_size
        decoded_tmp = dest.with_suffix(dest.suffix + ".tmp")
        with gzip.open(gz_path, "rb") as fin, open(decoded_tmp, "wb") as fout:
            shutil.copyfileobj(fin, fout)
        decoded_size = decoded_tmp.stat().st_size
        os.rename(decoded_tmp, dest)
        return gz_size, decoded_size
    finally:
        gz_path.unlink(missing_ok=True)


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
    """Fetch a single (day, env, type) into the canonical local file.

    Returns a dict suitable for the coverage ledger:
      {state, bytes, gz_bytes, notification_uuid}
    or short-circuits with {state: "present", bytes: ...} if the file
    was already on disk.

    Raises PullError on any recoverable failure (caller marks
    state=fetch-failed). Hard failures (e.g. invalid creds via
    AcquiaAPIError) propagate raw.
    """
    local = canonical_path(project_root, day, env_name, log_type)
    if file_present_and_complete(local):
        return {
            "state": "present",
            "bytes": local.stat().st_size,
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

    s3_url = client.get_log_download_url(env_id, log_type)
    gz_size, decoded = download_atomic_gunzip(s3_url, local)

    return {
        "state": "present",
        "bytes": decoded,
        "gz_bytes": gz_size,
        "notification_uuid": notif_uuid,
        "fetched": True,
    }


# --- Range expansion ------------------------------------------------------

def date_range(from_d: date, to_d: date) -> list[date]:
    """Inclusive list of dates from from_d to to_d (no calendar magic)."""
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
        # Backfill never includes "today" (still being written) — Acquia
        # rotates at UTC midnight, so today's full slice is incomplete.
        end = today - timedelta(days=1)
        start = end - timedelta(days=days - 1)
        return date_range(start, end)
    return date_range(date.fromisoformat(args.from_),
                      date.fromisoformat(args.to))


# --- Multi-day reconcile orchestrator -------------------------------------

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
    log_fn=print,
) -> dict:
    """Walk (env x type x day) tuples, fetching what's missing.

    `target_types`, when set, overrides each env's manifest types.
    `client` may be None when dry_run=True — no network is touched.

    Returns a summary dict:
      {present, fetched, failed, skipped, total}
    """
    coverage = load_coverage(project_root)
    summary = {"present": 0, "fetched": 0, "failed": 0, "skipped": 0, "total": 0}

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
                local = canonical_path(
                    project_root, day, env_name, log_type,
                )
                if dry_run:
                    if file_present_and_complete(local):
                        log_fn(f"  [dry] {day} {log_type}: present")
                        summary["present"] += 1
                    else:
                        log_fn(f"  [dry] {day} {log_type}: would fetch")
                        summary["skipped"] += 1
                    continue

                # Live fetch path. Catch broadly so a single transient
                # network failure (TLS read timeout, DNS hiccup, etc.)
                # never kills the whole reconcile loop. We mark the
                # tuple fetch-failed and move on; a later --backfill
                # picks it up.
                attempts = retries + 1
                last_err: Exception | None = None
                result: dict | None = None
                for attempt in range(attempts):
                    try:
                        result = pull_one(
                            client, env_id, env_name, log_type, day,
                            project_root,
                            poll_interval_s=poll_interval_s,
                            poll_deadline_s=poll_deadline_s,
                        )
                        last_err = None
                        break
                    except (PullError, AcquiaAPIError) as e:
                        last_err = e
                        if attempt < attempts - 1:
                            log_fn(
                                f"  ~ {day} {log_type}: retry "
                                f"{attempt + 1}/{retries} ({e})"
                            )
                            time.sleep(rate_limit_s)
                            continue
                    except Exception as e:  # noqa: BLE001
                        # Unexpected transient — log and retry once;
                        # never let it crash the loop.
                        last_err = e
                        if attempt < attempts - 1:
                            log_fn(
                                f"  ~ {day} {log_type}: retry "
                                f"{attempt + 1}/{retries} after unexpected "
                                f"{type(e).__name__}: {e}"
                            )
                            time.sleep(rate_limit_s)
                            continue

                if last_err is not None:
                    if isinstance(last_err, AcquiaAPIError):
                        reason = (
                            f"acquia-api {last_err.status} "
                            f"{last_err.error_slug}"
                        )
                    else:
                        reason = (
                            f"{type(last_err).__name__}: {last_err}"
                        )
                    mark_coverage(
                        coverage, day, env_name, log_type,
                        state="fetch-failed", reason=reason,
                    )
                    log_fn(f"  ! {day} {log_type}: {reason}")
                    summary["failed"] += 1
                    # Checkpoint the ledger so progress survives a kill.
                    save_coverage(project_root, coverage)
                    continue

                # Defensive — we should always have a result if last_err
                # is None, but guard anyway.
                if result is None:
                    summary["failed"] += 1
                    continue

                if result.get("fetched"):
                    ledger_fields = {
                        k: v for k, v in result.items() if k != "fetched"
                    }
                    mark_coverage(
                        coverage, day, env_name, log_type, **ledger_fields,
                    )
                    log_fn(
                        f"  + {day} {log_type}: fetched "
                        f"({result.get('bytes', 0):,} bytes)"
                    )
                    summary["fetched"] += 1
                    # Checkpoint after every successful fetch — long
                    # backfills should never lose progress on crash.
                    save_coverage(project_root, coverage)
                    time.sleep(rate_limit_s)
                else:
                    existing = coverage.get(day.isoformat(), {}).get(
                        f"{env_name}.{log_type}"
                    )
                    if not existing:
                        mark_coverage(
                            coverage, day, env_name, log_type,
                            state="present", bytes=result.get("bytes", 0),
                            verified_at=datetime.now(
                                timezone.utc,
                            ).isoformat(),
                        )
                    log_fn(
                        f"  = {day} {log_type}: present "
                        f"({result.get('bytes', 0):,} bytes)"
                    )
                    summary["present"] += 1

    if not dry_run:
        save_coverage(project_root, coverage)
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
        help="env name from manifest, or 'all' to iterate every env "
             "(default: prod — override when you need other envs)",
    )

    # Date selection (mutually exclusive — exactly one required)
    p.add_argument("--date", default=None,
                   help="single day, YYYY-MM-DD")
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
    p.add_argument(
        "--type", default=None,
        help="single log type (default: all types from manifest)",
    )
    p.add_argument(
        "--types", default=None,
        help="comma-separated log types (overrides --type)",
    )

    # Behavior
    p.add_argument("--dry-run", action="store_true",
                   help="show what would be fetched, do nothing")
    p.add_argument("--retries", type=int, default=RETRY_TRANSIENT_FAILURES,
                   help=f"retries on transient failure "
                        f"(default {RETRY_TRANSIENT_FAILURES})")
    p.add_argument("--rate-limit-s", type=float,
                   default=RATE_LIMIT_BETWEEN_CALLS_S,
                   help=f"sleep between API round-trips "
                        f"(default {RATE_LIMIT_BETWEEN_CALLS_S}s)")

    return p.parse_args(argv)


def cli_main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    project_root = args.project.resolve()

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
        f"dry_run={args.dry_run}"
    )

    client = None if args.dry_run else AcquiaClient()
    summary = reconcile(
        client, project_root, envs, types_override, days,
        dry_run=args.dry_run,
        rate_limit_s=args.rate_limit_s,
        retries=args.retries,
    )

    print(
        f"\nDone. total={summary['total']} "
        f"fetched={summary['fetched']} present={summary['present']} "
        f"failed={summary['failed']} skipped={summary['skipped']}"
    )
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    sys.exit(cli_main())
