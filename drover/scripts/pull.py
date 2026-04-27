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

CLI usage (slice 2 — single day):
  python3 pull.py --project /path/to/project --env prod \\
                  --date 2026-04-03 [--type drupal-watchdog]

A multi-day reconcile loop with --from/--to/--backfill/--daily lands in
slice 3 and reuses the same pull_one primitive.
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
from datetime import date, datetime, timezone
from pathlib import Path

# Import AcquiaClient from sibling module without pip install.
sys.path.insert(0, str(Path(__file__).parent / "monitors"))
from acquia_api import AcquiaClient, AcquiaAPIError  # noqa: E402


DEFAULT_TYPES = ["apache-error", "drupal-watchdog", "php-error"]
POLL_DEADLINE_S = 180
POLL_INTERVAL_S = 3


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


# --- CLI ------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="drover-pull",
        description="Fetch Acquia application error logs by date.",
    )
    p.add_argument(
        "--project", type=Path, default=Path.cwd(),
        help="project root (default: cwd)",
    )
    p.add_argument(
        "--env", required=True,
        help="env name (must match an entry in the manifest)",
    )
    p.add_argument(
        "--date", required=True,
        help="single day to fetch, YYYY-MM-DD (slice 2 limit; "
             "ranges arrive in slice 3)",
    )
    p.add_argument(
        "--type", default=None,
        help="single log type (default: all types from manifest)",
    )
    p.add_argument(
        "--types", default=None,
        help="comma-separated log types (overrides --type)",
    )
    return p.parse_args(argv)


def cli_main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    project_root = args.project.resolve()
    day = date.fromisoformat(args.date)

    try:
        manifest = load_manifest(project_root)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    env = find_env(manifest, args.env)
    env_id = env["env_id"]

    if args.types:
        types = [t.strip() for t in args.types.split(",") if t.strip()]
    elif args.type:
        types = [args.type]
    else:
        types = env.get("types") or DEFAULT_TYPES

    client = AcquiaClient()
    coverage = load_coverage(project_root)

    print(
        f"pull project={project_root.name} env={args.env} "
        f"date={day} types={types}"
    )
    failed = 0
    for log_type in types:
        try:
            result = pull_one(
                client, env_id, args.env, log_type, day, project_root,
            )
            local = canonical_path(
                project_root, day, args.env, log_type,
            )
            # Only update the ledger if we actually fetched. Short-circuit
            # paths (file already present) preserve the prior entry's
            # provenance fields (notification_uuid, gz_bytes, fetched_at).
            if result.get("fetched"):
                ledger_fields = {k: v for k, v in result.items() if k != "fetched"}
                mark_coverage(coverage, day, args.env, log_type, **ledger_fields)
                print(
                    f"  + {log_type}: {result['state']} "
                    f"({result.get('bytes', 0):,} bytes) -> {local}"
                )
            else:
                # Reconcile a missing ledger entry against an existing file
                # so operators who delete .drover/ get a fresh ledger.
                existing = coverage.get(day.isoformat(), {}).get(
                    f"{args.env}.{log_type}"
                )
                if not existing:
                    mark_coverage(
                        coverage, day, args.env, log_type,
                        state="present", bytes=result.get("bytes", 0),
                        verified_at=datetime.now(timezone.utc).isoformat(),
                    )
                print(
                    f"  = {log_type}: already present "
                    f"({result.get('bytes', 0):,} bytes) -> {local}"
                )
        except PullError as e:
            mark_coverage(
                coverage, day, args.env, log_type,
                state="fetch-failed", reason=str(e),
            )
            print(f"  ! {log_type}: {e}")
            failed += 1
        except AcquiaAPIError as e:
            mark_coverage(
                coverage, day, args.env, log_type,
                state="fetch-failed",
                reason=f"acquia-api {e.status} {e.error_slug}",
            )
            print(f"  ! {log_type}: {e}")
            failed += 1

    save_coverage(project_root, coverage)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(cli_main())
