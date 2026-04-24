"""
Shared monitor core.

ddev-watch.py and wp-watch.py used to carry ~110 lines of byte-identical
tail-subprocess-and-emit logic, differing only in the state-subdir name
and the `commands = [...]` array they spawn. This module extracts the
shared core so they collapse to ~30-line wrappers and a bug fix lands in
one place.

run_tail_watcher(project, state_subdir, commands) runs the per-project
tail loop used by both the Drupal and WordPress monitors. It's called
from each monitor's main() after that script has parsed its own
CLI/docstring and built the command list.
"""
from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import queue
import signal
import subprocess
import sys
import threading


def load_fingerprint():
    """Import fingerprint.py as a module.

    DROVER_FINGERPRINT_SCRIPT overrides the default sibling-directory
    lookup (tests use this to substitute a fake).
    """
    path = os.environ.get("DROVER_FINGERPRINT_SCRIPT") or str(
        pathlib.Path(__file__).resolve().parent.parent / "fingerprint.py"
    )
    spec = importlib.util.spec_from_file_location("fingerprint", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def resolve_state_dir(state_subdir: str) -> pathlib.Path:
    """Return the on-disk state directory for a monitor.

    DROVER_STATE_DIR overrides the default under CLAUDE_PLUGIN_DATA.
    The directory is created if it does not already exist.
    """
    state_dir_env = os.environ.get("DROVER_STATE_DIR")
    if state_dir_env:
        state_dir = pathlib.Path(state_dir_env)
    else:
        base = os.environ.get(
            "CLAUDE_PLUGIN_DATA",
            os.path.expanduser("~/.claude/plugins/data/drover-fallback"),
        )
        state_dir = pathlib.Path(base) / state_subdir
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir


def run_tail_watcher(project: str, state_subdir: str, commands: list[list[str]]) -> int:
    """Run the tail loop for one project and return the exit code.

    Every command in `commands` is spawned as a persistent subprocess;
    stdout lines are merged into a single queue and passed to
    fingerprint.process(). Each new fingerprint emits `NEW <fp> ...`;
    fingerprints hitting DROVER_THRESHOLD emit `THRESH <fp> ...`.

    Environment toggles:
      DROVER_THRESHOLD       emit-on-count target (default 50)
      DROVER_MAX_EVENTS      exit after N processed events (tests)
      DROVER_NOISE_FILTER    when "1", drop known-noise lines before
                             fingerprinting (low-trust dev envs)
      DROVER_STATE_DIR       override the state directory
    """
    fingerprint = load_fingerprint()

    threshold = int(os.environ.get("DROVER_THRESHOLD", "50"))
    max_events = int(os.environ.get("DROVER_MAX_EVENTS", "0"))
    # sprint-etd: the umbrella sets DROVER_NOISE_FILTER=1 for low-trust
    # DDEV envs whose projects.json carries noise_filter: true. Known
    # dev-env noise (missing public files, cache-backend refused, etc.)
    # is dropped upstream of the fingerprint pipeline.
    noise_filter = os.environ.get("DROVER_NOISE_FILTER") == "1"

    state_dir = resolve_state_dir(state_subdir)
    state_file = state_dir / f"{project}.json"
    try:
        state = json.loads(state_file.read_text()) if state_file.exists() else {}
    except Exception:
        state = {}

    q: "queue.Queue[str]" = queue.Queue()
    sentinel = object()
    procs: list[subprocess.Popen] = []
    stop = threading.Event()

    def tail(cmd: list[str]) -> None:
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError:
            q.put(sentinel)
            return
        procs.append(proc)
        try:
            for line in proc.stdout:
                if stop.is_set():
                    break
                q.put(line)
        finally:
            q.put(sentinel)

    threads = [threading.Thread(target=tail, args=(c,), daemon=True) for c in commands]
    for t in threads:
        t.start()

    def shutdown(_signum=None, _frame=None):
        stop.set()
        for p in procs:
            try:
                p.terminate()
            except Exception:
                pass

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    processed = 0
    done_count = 0
    try:
        while done_count < len(threads):
            item = q.get()
            if item is sentinel:
                done_count += 1
                continue
            if noise_filter and fingerprint.is_noise(item):
                continue
            ev = fingerprint.process(item)
            if ev is None:
                continue
            fp = ev["fingerprint"]
            entry = state.get(fp, {"count": 0, "severity": ev["severity"], "source": ev["source"]})
            is_new = entry["count"] == 0
            entry["count"] += 1
            state[fp] = entry
            if is_new:
                print(
                    f"NEW {fp} {ev['severity']} {ev['source']} {project} {ev['message']}",
                    flush=True,
                )
            elif entry["count"] == threshold:
                print(
                    f"THRESH {fp} count={threshold} {ev['severity']} {ev['source']} {project}",
                    flush=True,
                )
            processed += 1
            if max_events and processed >= max_events:
                break
    finally:
        shutdown()
        # State-file write failure at shutdown means the next watcher run
        # re-emits NEW for every fingerprint we'd already counted — noisy
        # but non-fatal. Log it so the umbrella logs capture the reason
        # instead of silently dropping the checkpoint.
        try:
            state_file.write_text(json.dumps(state))
        except Exception as e:
            print(f"{project}-watch: state checkpoint failed: {e}", file=sys.stderr, flush=True)

    return 0
