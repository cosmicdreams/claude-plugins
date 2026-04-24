#!/usr/bin/env python3
"""
ddev-watch.py <project-name>

Monitors one DDEV project for Drupal errors. Spawns two persistent
subprocesses and runs them through the shared tail-watcher core:

  ddev --project <p> drush watchdog:tail
  ddev --project <p> logs -f --service web

Emits one line per ECA event:
  NEW     <fp> <severity> <source> <project> <message>
  THRESH  <fp> count=<n>  <severity> <source> <project>

Environment overrides (all optional, for tests):
  DROVER_STATE_DIR         state dir (default under CLAUDE_PLUGIN_DATA)
  DROVER_THRESHOLD         emit threshold (default 50 — Drupal's
                           watchdog batch size)
  DROVER_MAX_EVENTS        exit after N processed events (tests)
  DROVER_FINGERPRINT_SCRIPT override fingerprint.py path
  DROVER_NOISE_FILTER=1    drop known dev-env noise before
                           fingerprinting (set by the umbrella for
                           low-trust envs)

Signals:
  SIGINT/SIGTERM — kill subprocesses and exit cleanly.

Shared loop implementation lives in common.py.
"""
import sys

from common import run_tail_watcher


def main() -> int:
    if len(sys.argv) < 2:
        print("ddev-watch: missing project name", file=sys.stderr)
        return 2
    project = sys.argv[1]
    commands = [
        ["ddev", "--project", project, "drush", "watchdog:tail"],
        ["ddev", "--project", project, "logs", "-f", "--service", "web"],
    ]
    return run_tail_watcher(project, "ddev-state", commands)


if __name__ == "__main__":
    sys.exit(main())
