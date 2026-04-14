#!/usr/bin/env python3
"""
bd-ready-watch.py <project-path>

Polls the drover Beads board for newly-ready, unassigned tickets and
emits one line per ticket the first time it appears in the ready
lane. Intended replacement for the `/loop 30m /drover:implement`
cadence: detection by the monitor, implementation still triggered
manually or by an agent in a watching session.

Emits:
  READY  <ticket-id>  <severity>  <fingerprint>  <project-slug>

Environment overrides (tests):
  DROVER_BD                 override `bd` binary
  DROVER_STATE_DIR          state dir (default under CLAUDE_PLUGIN_DATA)
  DROVER_BD_POLL_INTERVAL   seconds between polls (default 60)
  DROVER_MAX_ITERATIONS     exit after N polls (tests)
"""
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time

def main() -> int:
    if len(sys.argv) < 2:
        print("bd-ready-watch: missing project path", file=sys.stderr)
        return 2

    project_path = pathlib.Path(sys.argv[1]).resolve()
    db_path = project_path / ".beads" / "drover.db"
    slug = project_path.name

    bd = os.environ.get("DROVER_BD", "bd")
    poll = int(os.environ.get("DROVER_BD_POLL_INTERVAL", "60"))
    max_iters = int(os.environ.get("DROVER_MAX_ITERATIONS", "0"))

    state_dir_env = os.environ.get("DROVER_STATE_DIR")
    if state_dir_env:
        state_dir = pathlib.Path(state_dir_env)
    else:
        base = os.environ.get(
            "CLAUDE_PLUGIN_DATA",
            os.path.expanduser("~/.claude/plugins/data/drover-fallback"),
        )
        state_dir = pathlib.Path(base) / "bd-ready-state"
    state_dir.mkdir(parents=True, exist_ok=True)
    state_file = state_dir / f"{slug}.json"

    try:
        seen = set(json.loads(state_file.read_text())) if state_file.exists() else set()
    except Exception:
        seen = set()

    stopped = False
    def shutdown(_signum=None, _frame=None):
        nonlocal stopped
        stopped = True
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    iteration = 0
    try:
        while not stopped:
            iteration += 1
            # Skip the poll when the DB isn't there yet — register the project and
            # come back next interval.
            if db_path.exists():
                try:
                    out = subprocess.check_output(
                        [
                            bd, "list",
                            "-l", "board-drover",
                            "-l", "lane-ready",
                            "--no-assignee",
                            "--json", "--flat",
                            "--db", str(db_path),
                        ],
                        stderr=subprocess.DEVNULL, text=True, timeout=15,
                    )
                    items = json.loads(out)
                except Exception:
                    items = []

                for item in items or []:
                    tid = item.get("id")
                    if not tid or tid in seen:
                        continue
                    seen.add(tid)
                    sev = severity_from(item)
                    fp = fingerprint_from(item)
                    print(f"READY {tid} {sev} {fp} {slug}", flush=True)

                try:
                    state_file.write_text(json.dumps(sorted(seen)))
                except Exception:
                    pass

            if max_iters and iteration >= max_iters:
                break
            # Sleep in short slices so SIGTERM is honored quickly.
            slept = 0
            while slept < poll and not stopped:
                time.sleep(min(1, poll - slept))
                slept += 1
    finally:
        pass
    return 0


def severity_from(item) -> str:
    labels = item.get("labels") or []
    for tag in ("severity-error", "severity-critical", "severity-warning", "severity-notice"):
        if tag in labels:
            return tag.replace("severity-", "")
    return "unknown"


def fingerprint_from(item) -> str:
    body = item.get("body") or ""
    m = re.search(r"\*\*Fingerprint:\*\*\s*`([0-9a-f]{6,16})`", body)
    if m:
        return m.group(1)
    m = re.search(r'"fp":\s*"([0-9a-f]{6,16})"', body)
    if m:
        return m.group(1)
    return "-"


if __name__ == "__main__":
    sys.exit(main())
