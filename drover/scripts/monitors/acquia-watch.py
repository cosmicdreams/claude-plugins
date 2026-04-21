#!/usr/bin/env python3
"""
acquia-watch.py <acquia-env-alias>

Streams logs from one Acquia Cloud environment via direct WSS connection
to the Acquia logstream service. Fingerprints each error line and emits
ECA events:

  NEW     <fp> <severity> <source> <env-alias> <message>
  THRESH  <fp> count=<n>  <severity> <source> <env-alias>

For non-error log types (apache-request, drupal-request, fpm-access),
emits periodic TRAFFIC summaries instead of per-line events.

The env alias format is "<env_name>.<app_uuid>" — e.g. "prod.fa5e7770-...".
The umbrella passes this; it's split here into app_uuid and env_name.

State persists at ${DROVER_STATE_DIR:-...}/acquia-<alias>.json.

Environment overrides (tests):
  DROVER_STATE_DIR          state dir
  DROVER_THRESHOLD          emit threshold (default 50)
  DROVER_MAX_EVENTS         exit after N events (tests)
  DROVER_FINGERPRINT_SCRIPT override fingerprint.py path
  DROVER_LOG_TYPES          comma-separated log types (default: all)
"""
import asyncio
import importlib.util
import json
import os
import pathlib
import signal
import sys
import time


def load_fingerprint():
    path = os.environ.get("DROVER_FINGERPRINT_SCRIPT") or str(
        pathlib.Path(__file__).resolve().parent.parent / "fingerprint.py"
    )
    spec = importlib.util.spec_from_file_location("fingerprint", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ERROR_TYPES = {"apache-error", "php-error", "drupal-watchdog", "fpm-error"}
TRAFFIC_TYPES = {"apache-request", "drupal-request", "fpm-access",
                 "bal-request", "varnish-request"}


async def main() -> int:
    if len(sys.argv) < 2:
        print("acquia-watch: missing env alias (env_name.app_uuid)", file=sys.stderr)
        return 2

    alias = sys.argv[1]
    # Support both "prod.fa5e7770-..." and legacy "30395-fa5e7770-..." formats.
    if "." in alias and not alias[0].isdigit():
        env_name, app_uuid = alias.split(".", 1)
    else:
        print(f"acquia-watch: expected alias format 'env.app_uuid', got '{alias}'",
              file=sys.stderr)
        return 2

    fingerprint = load_fingerprint()
    threshold = int(os.environ.get("DROVER_THRESHOLD", "50"))
    max_events = int(os.environ.get("DROVER_MAX_EVENTS", "0"))

    type_env = os.environ.get("DROVER_LOG_TYPES")
    log_types = type_env.split(",") if type_env else None

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
    state_file = state_dir / f"{alias}.json"
    try:
        state = json.loads(state_file.read_text()) if state_file.exists() else {}
    except Exception:
        state = {}

    # Import the logstream client (sibling module).
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from acquia_logstream import connect

    stop = asyncio.Event()

    def handle_signal():
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, handle_signal)

    processed = 0
    try:
        async for event in connect(app_uuid, env_name, types=log_types):
            if stop.is_set():
                break

            log_type = event.get("log_type", "")
            text = event.get("text", "")

            if log_type in ERROR_TYPES:
                ev = fingerprint.process(text)
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
                    print(f"NEW {fp} {sev} {src} {alias} {msg}", flush=True)
                elif entry["count"] == threshold:
                    print(f"THRESH {fp} count={threshold} {sev} {src} {alias}",
                          flush=True)
            elif log_type in TRAFFIC_TYPES:
                # Accumulate traffic stats; emit periodically.
                bucket = state.setdefault("_traffic", {})
                type_bucket = bucket.setdefault(log_type, {"count": 0, "status": {}})
                type_bucket["count"] += 1
                status = str(event.get("http_status", "?"))
                type_bucket["status"][status] = type_bucket["status"].get(status, 0) + 1
                # Emit summary every 100 lines per type.
                if type_bucket["count"] % 100 == 0:
                    print(
                        f"TRAFFIC {log_type} count={type_bucket['count']} "
                        f"status={json.dumps(type_bucket['status'])} {alias}",
                        flush=True,
                    )

            processed += 1
            if max_events and processed >= max_events:
                break
    except Exception as e:
        # Distinguish permanent auth/IP failures from transient network blips so
        # the umbrella can back off permanently-failing envs instead of
        # respawning every cycle and flooding notifications.
        permanent_slugs = {"forbidden_ip", "invalid_grant", "invalid_client",
                           "not_found", "access_denied"}
        status = getattr(e, "status", None)
        slug = getattr(e, "error_slug", "")
        if slug in permanent_slugs:
            # Record in state so dashboard can surface per-env status; umbrella
            # greps stderr for PERMANENT to decide whether to stop respawning.
            state["_last_error"] = {
                "kind": "permanent", "slug": slug, "status": status,
                "at": int(time.time()),
            }
            print(f"acquia-watch: PERMANENT {alias} status={status} slug={slug} {e}",
                  file=sys.stderr)
            return 3
        state["_last_error"] = {
            "kind": "transient",
            "status": status,
            "slug": slug,
            "msg": str(e)[:200],
            "at": int(time.time()),
        }
        print(f"acquia-watch: TRANSIENT {alias} status={status or '?'} {e}",
              file=sys.stderr)
        return 1
    finally:
        try:
            state_file.write_text(json.dumps(state))
        except Exception:
            pass

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
