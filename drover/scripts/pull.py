#!/usr/bin/env python3
"""drover.pull — date-ranged Acquia application error log fetcher.

Reconciles a project's local log folder against the manifest in two phases:

  Phase 1 — Create: POST a log-create request for every missing
    (date, env, type) tuple. Cheap and fast (~1s each). Acquia begins
    building all snapshots in parallel on their end.

  Phase 2 — Poll + Download: loop over all pending notifications.
    The moment a notification completes, download and gunzip immediately.
    Report progress after each file lands: "N/total done, M pending".

Total wall time for a 30-day × 3-type backfill drops from ~60 min
(serial create→poll→download) to ~5–10 min (batch create, then
parallel-by-Acquia poll loop).

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


# --- Single-file primitives -----------------------------------------------

class PullError(Exception):
    """Recoverable failure on a single (day, env, type) — caller marks
    coverage=fetch-failed and moves on."""


def file_present_and_complete(path: Path) -> bool:
    """Existence + non-empty. Atomic rename guarantees a canonical file is
    always complete — a partial download never reaches the canonical name."""
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
    """Fetch a single (day, env, type) end-to-end (create → poll → download).

    For single-file fetches. Bulk backfills should use reconcile(), which
    separates Phase 1 (create-all) from Phase 2 (poll+download-loop) so
    Acquia processes all snapshots in parallel.
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
    return date_range(date.fromisoformat(args.from_),
                      date.fromisoformat(args.to))


# --- Phase 1: log-create --------------------------------------------------

def _phase_create(
    client: AcquiaClient,
    missing: list[tuple],
    *,
    rate_limit_s: float = RATE_LIMIT_BETWEEN_CALLS_S,
    retries: int = RETRY_TRANSIENT_FAILURES,
    log_fn=print,
) -> tuple[list[dict], list[tuple]]:
    """Phase 1: fire log-create for every (env, log_type, day) tuple.

    Each POST returns immediately with a notification URL — cheap, ~1s each.
    Acquia begins building all snapshots in parallel on their end.

    Returns:
      pending       — items ready for Phase 2 poll+download
      create_failed — list of (env, log_type, day, exc) that couldn't start
    """
    pending = []
    create_failed = []
    n = len(missing)
    for i, (env, log_type, day) in enumerate(missing):
        env_name = env["name"]
        env_id = env.get("env_id")
        from_iso = f"{day.isoformat()}T00:00:00+00:00"
        to_iso = f"{day.isoformat()}T23:59:59+00:00"
        try:
            notif = client.request_log_download(
                env_id, log_type, from_iso=from_iso, to_iso=to_iso,
            )
            notif_url = (
                notif.get("_links", {}).get("notification", {}).get("href")
            )
            if not notif_url:
                raise PullError(f"no notification URL: {notif!r}")
            notif_uuid = notif_url.rsplit("/", 1)[-1]
            pending.append({
                "env": env,
                "log_type": log_type,
                "day": day,
                "from_iso": from_iso,
                "to_iso": to_iso,
                "notif_url": notif_url,
                "notif_uuid": notif_uuid,
                "retries_remaining": retries,
            })
            log_fn(
                f"  → {day} {env_name} {log_type}: requested "
                f"({i + 1}/{n})"
            )
        except (PullError, AcquiaAPIError, Exception) as e:
            log_fn(f"  ! {day} {env_name} {log_type}: create failed ({e})")
            create_failed.append((env, log_type, day, e))
        if i < n - 1:
            time.sleep(rate_limit_s)
    return pending, create_failed


# --- Phase 2: poll + download as files become ready -----------------------

def _phase_poll_and_download(
    client: AcquiaClient,
    project_root: Path,
    coverage: dict,
    pending: list[dict],
    *,
    poll_deadline_s: int = POLL_DEADLINE_S,
    poll_interval_s: int = POLL_INTERVAL_S,
    log_fn=print,
) -> tuple[list[dict], list[dict]]:
    """Phase 2: poll all pending notifications; download each file the moment
    its notification completes.

    Acquia built all snapshots in parallel during Phase 1, so most
    notifications complete within the same ~60s window. Files are downloaded
    as they become available — we don't wait for all to finish before
    starting any download.

    After each download reports:
      "✓ {date} {env} {type}: N,NNN bytes — X/total done, Y pending"

    Returns (downloaded_items, failed_items).
    """
    total = len(pending)
    downloaded: list[dict] = []
    failed: list[dict] = []
    deadline = time.time() + poll_deadline_s

    while pending:
        if time.time() > deadline:
            for item in pending:
                env_name = item["env"]["name"]
                log_fn(
                    f"  ! {item['day']} {env_name} {item['log_type']}: "
                    "poll deadline exceeded"
                )
            failed.extend(pending)
            break

        still_pending = []
        for item in pending:
            env = item["env"]
            env_name = env["name"]
            env_id = env.get("env_id")
            log_type = item["log_type"]
            day = item["day"]
            notif_url = item["notif_url"]
            notif_uuid = item["notif_uuid"]

            try:
                s = client.check_log_download(notif_url)
                status = s.get("status", "?")
            except Exception:
                still_pending.append(item)
                continue

            if status == "completed":
                local = canonical_path(project_root, day, env_name, log_type)
                try:
                    s3_url = client.get_log_download_url(env_id, log_type)
                    gz_size, decoded = download_atomic_gunzip(s3_url, local)
                    item.update({"bytes": decoded, "gz_bytes": gz_size})
                    downloaded.append(item)
                    mark_coverage(
                        coverage, day, env_name, log_type,
                        state="present",
                        bytes=decoded,
                        gz_bytes=gz_size,
                        notification_uuid=notif_uuid,
                    )
                    save_coverage(project_root, coverage)
                    done = len(downloaded)
                    pending_count = total - done - len(failed)
                    log_fn(
                        f"  ✓ {day} {env_name} {log_type}: "
                        f"{decoded:,} bytes — "
                        f"{done}/{total} done, {pending_count} pending"
                    )
                except Exception as e:
                    log_fn(
                        f"  ! {day} {env_name} {log_type}: "
                        f"download failed ({e})"
                    )
                    failed.append(item)
                    mark_coverage(
                        coverage, day, env_name, log_type,
                        state="fetch-failed",
                        reason=f"{type(e).__name__}: {e}",
                    )
                    save_coverage(project_root, coverage)

            elif status == "failed":
                if item.get("retries_remaining", 0) > 0:
                    # Re-issue log-create and add back to pending.
                    try:
                        notif = client.request_log_download(
                            env_id, log_type,
                            from_iso=item["from_iso"],
                            to_iso=item["to_iso"],
                        )
                        new_url = (
                            notif.get("_links", {})
                            .get("notification", {})
                            .get("href")
                        )
                        if new_url:
                            item["notif_url"] = new_url
                            item["notif_uuid"] = new_url.rsplit("/", 1)[-1]
                            item["retries_remaining"] -= 1
                            still_pending.append(item)
                            log_fn(
                                f"  ~ {day} {env_name} {log_type}: "
                                "notification failed, retrying"
                            )
                            continue
                    except Exception:
                        pass
                log_fn(
                    f"  ! {day} {env_name} {log_type}: notification failed"
                )
                failed.append(item)
                mark_coverage(
                    coverage, day, env_name, log_type,
                    state="fetch-failed",
                    reason="notification status=failed",
                )
                save_coverage(project_root, coverage)

            else:
                still_pending.append(item)

        pending = still_pending
        if pending:
            time.sleep(poll_interval_s)

    return downloaded, failed


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
    log_fn=print,
) -> dict:
    """Orchestrate Phase 1 (create-all) then Phase 2 (poll+download loop).

    Phase 1 fires all log-create requests upfront — cheap, ~1s each.
    Acquia builds all snapshots in parallel on their end. Phase 2 polls
    all pending notifications and downloads each file the moment it's ready.

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
                local = canonical_path(project_root, day, env_name, log_type)
                if dry_run:
                    if file_present_and_complete(local):
                        log_fn(f"  [dry] {day} {log_type}: present")
                        summary["present"] += 1
                    else:
                        log_fn(f"  [dry] {day} {log_type}: would fetch")
                        summary["skipped"] += 1
                elif file_present_and_complete(local):
                    existing = coverage.get(day.isoformat(), {}).get(
                        f"{env_name}.{log_type}"
                    )
                    if not existing:
                        mark_coverage(
                            coverage, day, env_name, log_type,
                            state="present",
                            bytes=local.stat().st_size,
                        )
                    log_fn(
                        f"  = {day} {log_type}: present "
                        f"({local.stat().st_size:,} bytes)"
                    )
                    summary["present"] += 1
                else:
                    missing.append((env, log_type, day))

    if dry_run:
        return summary

    if not missing:
        save_coverage(project_root, coverage)
        return summary

    # Phase 1: fire all log-create requests.
    log_fn(f"\nPhase 1 — log-create: {len(missing)} requests")
    pending, create_failed = _phase_create(
        client, missing,
        rate_limit_s=rate_limit_s,
        retries=retries,
        log_fn=log_fn,
    )

    for (env, log_type, day, exc) in create_failed:
        env_name = env["name"]
        reason = (
            f"acquia-api {exc.status} {exc.error_slug}"
            if isinstance(exc, AcquiaAPIError)
            else f"{type(exc).__name__}: {exc}"
        )
        mark_coverage(
            coverage, day, env_name, log_type,
            state="fetch-failed", reason=reason,
        )
        summary["failed"] += 1
    if create_failed:
        save_coverage(project_root, coverage)

    if not pending:
        return summary

    # Phase 2: poll all notifications, download files as they become ready.
    log_fn(
        f"\nPhase 2 — poll + download: {len(pending)} files "
        f"(deadline {poll_deadline_s}s)"
    )
    downloaded, dl_failed = _phase_poll_and_download(
        client, project_root, coverage, pending,
        poll_deadline_s=poll_deadline_s,
        poll_interval_s=poll_interval_s,
        log_fn=log_fn,
    )

    summary["fetched"] = len(downloaded)
    for item in dl_failed:
        summary["failed"] += 1

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
        poll_deadline_s=args.poll_deadline_s,
    )

    print(
        f"\nDone. total={summary['total']} "
        f"fetched={summary['fetched']} present={summary['present']} "
        f"failed={summary['failed']} skipped={summary['skipped']}"
    )
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    sys.exit(cli_main())
