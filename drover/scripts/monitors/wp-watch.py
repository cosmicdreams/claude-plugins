#!/usr/bin/env python3
"""
wp-watch.py <project-name>

Monitors one DDEV-hosted WordPress project for PHP errors and container
warnings. Mirrors ddev-watch.py but tails WP-native log sources instead
of drush watchdog:

  ddev exec -d <p> -- tail -n 0 -f /var/www/html/wp-content/debug.log
  ddev logs -f --service web <p>

fingerprint.py's classify()/source_of() rules already recognize
WordPress log shapes — "PHP Fatal error", "PHP Warning", "Deprecated",
etc. — so no WP-specific parsing logic lives here.

Environment overrides (tests):
  DROVER_STATE_DIR          state dir (default under CLAUDE_PLUGIN_DATA)
  DROVER_THRESHOLD          emit threshold (default 50)
  DROVER_MAX_EVENTS         exit after N processed events (tests)
  DROVER_FINGERPRINT_SCRIPT override fingerprint.py path
  DROVER_WP_DEBUG_LOG       override debug.log path inside container
                            (default /var/www/html/wp-content/debug.log)

Signals: SIGINT/SIGTERM terminate tail subprocesses and exit cleanly.

Shared loop implementation lives in common.py.
"""
import os
import sys

from common import run_tail_watcher


def main() -> int:
    if len(sys.argv) < 2:
        print("wp-watch: missing project name", file=sys.stderr)
        return 2
    project = sys.argv[1]
    debug_log = os.environ.get(
        "DROVER_WP_DEBUG_LOG", "/var/www/html/wp-content/debug.log"
    )
    commands = [
        ["ddev", "exec", "-d", project, "--", "tail", "-n", "0", "-f", debug_log],
        ["ddev", "logs", "-f", "--service", "web", project],
    ]
    return run_tail_watcher(project, "wp-state", commands)


if __name__ == "__main__":
    sys.exit(main())
