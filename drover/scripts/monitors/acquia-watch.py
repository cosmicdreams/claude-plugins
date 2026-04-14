#!/usr/bin/env python3
"""
acquia-watch.py <environment-id>

Streams logs from one Acquia Cloud environment via `acli app:log:tail`,
fingerprints each error line, and emits ECA events identical in format
to ddev-watch.py:

  NEW     <fp> <severity> <source> <env-id> <message>
  THRESH  <fp> count=<n>  <severity> <source> <env-id>

State persists at ${DROVER_STATE_DIR:-...}/acquia-<envId>.json.

Environment overrides (tests):
  DROVER_STATE_DIR          state dir
  DROVER_THRESHOLD          emit threshold (default 50)
  DROVER_MAX_EVENTS         exit after N events (tests)
  DROVER_FINGERPRINT_SCRIPT override fingerprint.py path
  DROVER_ACLI               override acli command (tests stub with a fake)
"""
import importlib.util
import json
import os
import pathlib
import signal
import subprocess
import sys


STREAM_READY_MARKER = "Streaming has started"


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
        print("acquia-watch: missing environment id", file=sys.stderr)
        return 2

    env_id = sys.argv[1]
    fingerprint = load_fingerprint()

    threshold = int(os.environ.get("DROVER_THRESHOLD", "50"))
    max_events = int(os.environ.get("DROVER_MAX_EVENTS", "0"))
    acli = os.environ.get("DROVER_ACLI", "acli")

    state_dir_env = os.environ.get("DROVER_STATE_DIR")
    if state_dir_env:
        state_dir = pathlib.Path(state_dir_env)
    else:
        base = os.environ.get(
            "CLAUDE_PLUGIN_DATA",
            os.path.expanduser("~/.claude/plugins/data/drover-fallback"),
        )
        state_dir = pathlib.Path(base) / "acquia-state"
    state_dir.mkdir(parents=True, exist_ok=True)
    state_file = state_dir / f"{env_id}.json"
    try:
        state = json.loads(state_file.read_text()) if state_file.exists() else {}
    except Exception:
        state = {}

    proc = subprocess.Popen(
        [acli, "app:log:tail", env_id, "-n"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
    )

    def shutdown(_signum=None, _frame=None):
        try:
            proc.terminate()
        except Exception:
            pass

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    streaming = False
    processed = 0
    try:
        for raw in proc.stdout:
            if not streaming:
                if STREAM_READY_MARKER in raw:
                    streaming = True
                continue
            ev = fingerprint.process(raw)
            if ev is None:
                continue
            fp = ev["fingerprint"]
            sev = ev["severity"]
            src = ev["source"]
            msg = ev["message"]
            entry = state.get(fp, {"count": 0, "severity": sev, "source": src})
            is_new = entry["count"] == 0
            entry["count"] += 1
            state[fp] = entry
            if is_new:
                print(f"NEW {fp} {sev} {src} {env_id} {msg}", flush=True)
            elif entry["count"] == threshold:
                print(f"THRESH {fp} count={threshold} {sev} {src} {env_id}", flush=True)
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
