#!/usr/bin/env bash
# umbrella-ideas.sh — multiplexer for the ideas-funnel pipeline
#
# Runs background producers (currently: rss-ingest). Emits each producer's
# stdout lines verbatim.
# Registered in monitors.json — Claude Code's plugin monitor invokes this
# script and watches its stdout; each line wakes the orchestrator.
#
# Keep stdout line-oriented. Everything printed here becomes a Monitor signal.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RSS_INGEST="$SCRIPT_DIR/rss-ingest.sh"

POLL_INTERVAL_SECONDS="${IDEAS_FUNNEL_POLL_INTERVAL:-1800}"   # 30 minutes

last_poll=0

log_stderr() {
  echo "[umbrella-ideas $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >&2
}

run_rss_ingest() {
  if [ -x "$RSS_INGEST" ]; then
    # Produce signals on stdout. Errors go to stderr.
    "$RSS_INGEST" || log_stderr "rss-ingest.sh exited $?"
  else
    log_stderr "rss-ingest.sh not executable at $RSS_INGEST"
  fi
}

log_stderr "umbrella starting (poll=${POLL_INTERVAL_SECONDS}s)"

# Main loop
while true; do
  now=$(date +%s)

  if [ $((now - last_poll)) -ge $POLL_INTERVAL_SECONDS ]; then
    run_rss_ingest
    last_poll=$now
  fi

  sleep 30
done
