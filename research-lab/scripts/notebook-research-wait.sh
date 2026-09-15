#!/usr/bin/env bash
# Wait for a deep-research task to finish, then import its sources.
#
# Usage: notebook-research-wait.sh NOTEBOOK_ID [--max-wait SECONDS] [--cited-only]
#
# Replaces the retired `notebooklm research wait --import-all -n <id>`, which
# was a single blocking call. `nlm` splits that into two steps:
#   1. `nlm research status <id> --max-wait N --compact`
#   2. `nlm research import <id> <observed-task-id>`
# v0.9.11 and v0.11.4 have no status --json option. Parse only their explicit
# compact completion block (cli/commands/research.py:_display_research_status).
# Pin import to that completed task rather than auto-detecting a different one.
# Initial task selection still belongs to upstream: this notebook-only interface
# cannot determine whether an already-completed task was the caller's intended one.
#
# Deep research runs ~5 minutes for the deep mode but can stretch well past that
# on a large query, so the default wait is 15 minutes rather than the CLI's own
# 5-minute default. Run this as a BACKGROUND task from a skill.

set -uo pipefail

NB="${1:?Usage: notebook-research-wait.sh NOTEBOOK_ID [--max-wait SECONDS] [--cited-only]}"
shift

MAX_WAIT=900
CITED_ONLY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --max-wait)   MAX_WAIT="$2"; shift 2 ;;
    --cited-only) CITED_ONLY="--cited-only"; shift ;;
    *) >&2 echo "Unknown arg: $1"; exit 1 ;;
  esac
done

>&2 echo "[research-wait] polling notebook $NB (max ${MAX_WAIT}s)…"
if output=$(NO_COLOR=1 TERM=dumb COLUMNS=200 nlm research status "$NB" --max-wait "$MAX_WAIT" --compact); then
  printf '%s\n' "$output" >&2
else
  status=$?
  printf '%s\n' "$output" >&2
  >&2 echo "[research-wait] status check failed; no sources imported."
  exit "$status"
fi

# Rich output is captured (not a TTY) with color disabled. Fail closed on a
# changed, partial, or ambiguous format; never infer completion from exit zero.
if ! task_id=$(printf '%s' "$output" | python3 -c '
import re, sys
lines = [line.strip() for line in sys.stdin.read().splitlines()]
headers = [i for i, line in enumerate(lines) if line == "Research Status:"]
statuses = [line for line in lines if line.startswith("Status:")]
tasks = [line for line in lines if line.startswith("Task ID:")]
counts = [line for line in lines if line.startswith("Sources found:")]
if len(headers) != 1 or statuses != ["Status: completed"] or len(tasks) != 1 or len(counts) != 1:
    sys.exit(1)
task = re.fullmatch(r"Task ID: ([A-Za-z0-9][A-Za-z0-9_-]*)", tasks[0])
if not task or not re.fullmatch(r"Sources found: [0-9]+", counts[0]):
    sys.exit(1)
start = headers[0]
if lines[start:start + 4] != ["Research Status:", statuses[0], tasks[0], counts[0]]:
    sys.exit(1)
print(task.group(1))
'); then
  >&2 echo "[research-wait] no unambiguous completed task in status output; no sources imported."
  >&2 echo "[research-wait] research may still be running or the CLI format changed; check status before retrying."
  exit 1
fi

>&2 echo "[research-wait] importing discovered sources…"
if nlm research import "$NB" "$task_id" ${CITED_ONLY:+$CITED_ONLY} >&2; then
  >&2 echo "[research-wait] import complete. Next: notebook-dedup.sh $NB --apply"
else
  status=$?
  >&2 echo "[research-wait] import FAILED — retry with: nlm research import $NB $task_id ${CITED_ONLY}"
  exit "$status"
fi
