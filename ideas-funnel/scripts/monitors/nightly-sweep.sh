#!/usr/bin/env bash
# nightly-sweep.sh — scheduled maintenance for the ideas-funnel pipeline.
#
# Runs via system cron (default 03:00 America/Chicago). Phase 2: lint only.
# Phase 4+ will add: decay, emerge, rescue.
#
# Output goes to ~/.claude/ideas-funnel.nightly.log.

set -euo pipefail

LOG=~/.claude/ideas-funnel.nightly.log
VAULT="${OBSIDIAN_VAULT:-$HOME/Vaults/Neurons}"

mkdir -p "$(dirname "$LOG")"

{
  echo "=== nightly-sweep $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

  # Phase 2: run lint only
  # The lint skill is invoked via Claude Code; the sweep script just notes the
  # intention and writes a marker file that the lint agent picks up on next wake.
  touch "$VAULT/_meta/.lint-requested"

  # Phase 4 additions (placeholders — uncomment when implementing):
  # touch "$VAULT/_meta/.decay-requested"
  # touch "$VAULT/_meta/.emerge-requested"
  # touch "$VAULT/_meta/.rescue-requested"

  echo "Markers written. Agents will process on next Monitor wake or next human invocation."
} >> "$LOG" 2>&1
