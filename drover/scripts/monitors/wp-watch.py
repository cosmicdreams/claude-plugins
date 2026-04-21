#!/usr/bin/env python3
"""
wp-watch.py <project-name>

Monitors one DDEV-hosted WordPress project for PHP errors and container
warnings. Mirrors ddev-watch.py (the Drupal watcher) but tails WP-native
log sources instead of drush watchdog:

  ddev exec -d <p> -- tail -n 0 -f /var/www/html/wp-content/debug.log
  ddev logs -f --service web <p>

Each stdout line is piped through fingerprint.process() and the watcher
emits one line per ECA event:

  NEW     <fp> <severity> <source> <project> <message>
  THRESH  <fp> count=<n>  <severity> <source> <project>

fingerprint.py's classify()/source_of() rules already recognize WordPress
log shapes — "PHP Fatal error", "PHP Warning", "Deprecated", etc. — so no
WP-specific parsing logic lives here.

Environment overrides (tests):
  DROVER_STATE_DIR          state dir
  DROVER_THRESHOLD          emit threshold (default 50)
  DROVER_MAX_EVENTS         exit after N processed events
  DROVER_FINGERPRINT_SCRIPT override fingerprint.py path
  DROVER_WP_DEBUG_LOG       override debug.log path inside container
                            (default /var/www/html/wp-content/debug.log)

Signals: SIGINT/SIGTERM terminate tail subprocesses and exit cleanly.
"""
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
    path = os.environ.get("DROVER_FINGERPRINT_SCRIPT") or str(
        pathlib.Path(__file__).resolve().parent.parent / "fingerprint.py"
    )
    spec = importlib.util.spec_from_file_location("fingerprint", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    if len(sys.argv) < 2:
        print("wp-watch: missing project name", file=sys.stderr)
        return 2

    project = sys.argv[1]
    fingerprint = load_fingerprint()

    threshold = int(os.environ.get("DROVER_THRESHOLD", "50"))
    max_events = int(os.environ.get("DROVER_MAX_EVENTS", "0"))
    debug_log = os.environ.get(
        "DROVER_WP_DEBUG_LOG", "/var/www/html/wp-content/debug.log"
    )

    state_dir_env = os.environ.get("DROVER_STATE_DIR")
    if state_dir_env:
        state_dir = pathlib.Path(state_dir_env)
    else:
        base = os.environ.get(
            "CLAUDE_PLUGIN_DATA",
            os.path.expanduser("~/.claude/plugins/data/drover-fallback"),
        )
        state_dir = pathlib.Path(base) / "wp-state"
    state_dir.mkdir(parents=True, exist_ok=True)
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

    commands = [
        ["ddev", "exec", "-d", project, "--", "tail", "-n", "0", "-f", debug_log],
        ["ddev", "logs", "-f", "--service", "web", project],
    ]
    threads = [
        threading.Thread(target=tail, args=(c,), daemon=True) for c in commands
    ]
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
            ev = fingerprint.process(item)
            if ev is None:
                continue
            fp = ev["fingerprint"]
            entry = state.get(
                fp, {"count": 0, "severity": ev["severity"], "source": ev["source"]}
            )
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
        try:
            state_file.write_text(json.dumps(state))
        except Exception:
            pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
