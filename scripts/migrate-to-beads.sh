#!/usr/bin/env zsh
# migrate-to-beads.sh
# Migrates existing markdown kanban cards into the shared Beads database.
# Run once from the project root after bd init.
#
# Prerequisites:
#   brew install beads
#   bd init --prefix sprint   (one init only — creates shared .beads/ database)
#
# Usage:
#   zsh scripts/migrate-to-beads.sh [--dry-run]

set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# Verify database exists
if [[ $DRY_RUN -eq 0 ]]; then
  if ! bd list --json &>/dev/null; then
    echo "ERROR: Beads database not found. Run: bd init --prefix sprint"
    exit 1
  fi
fi

sprint_count=0
retro_count=0

# ---------------------------------------------------------------------------
# Sprint cards  (all get board-sprint label)
# ---------------------------------------------------------------------------
SPRINT_DIR="kanban/sprint-run"
if [[ -d "$SPRINT_DIR" ]]; then
  echo "Migrating sprint cards from $SPRINT_DIR..."

  for dir in "$SPRINT_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    lane=$(basename "$dir")

    case "$lane" in
      1_backlog)       lane_label="lane-backlog" ;;
      2_analyzing)     lane_label="lane-analyzing" ;;
      3_developing)    lane_label="lane-developing" ;;
      4_needs-review)  lane_label="lane-needs-review" ;;
      5_reviewing)     lane_label="lane-reviewing" ;;
      6_review-failed) lane_label="lane-review-failed" ;;
      7_done)          lane_label="" ;;
      *)               lane_label="lane-$lane" ;;
    esac

    for card in "$dir"*.md; do
      [[ -f "$card" ]] || continue

      title=$(grep "^# " "$card" 2>/dev/null | head -1 | sed 's/^# //' || echo "Untitled")
      description=$(cat "$card")
      priority_raw=$(grep "^priority:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' || echo "Normal")
      priority=$([[ "$priority_raw" == "High" ]] && echo "1" || echo "2")
      stage=$(grep "^stage:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' || echo "")
      issue=$(grep "^issue:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' || echo "")
      review_scope=$(grep "^review_scope:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' | tr '[:upper:]' '[:lower:]' || echo "")
      ddev=$(grep "^ddev:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' || echo "false")
      fix_loop=$(grep "^fix_loop:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' || echo "0")
      acceptance=$(awk '/^## Acceptance Criteria/,/^##/' "$card" 2>/dev/null | grep -v "^##" | tr '\n' ' ' | sed 's/^[ -]*//' || echo "")

      # All sprint issues carry board-sprint
      labels="board-sprint"
      [[ -n "$lane_label" ]] && labels="$labels,$lane_label"
      [[ -n "$stage" ]] && labels="$labels,stage-$stage"
      [[ -n "$issue" ]] && labels="$labels,issue-$issue"
      [[ -n "$review_scope" ]] && labels="$labels,review-scope-$review_scope"
      [[ "$fix_loop" -gt 0 ]] 2>/dev/null && labels="$labels,fix-loop-$fix_loop"

      if [[ $DRY_RUN -eq 1 ]]; then
        echo "[DRY-RUN] sprint create: '$title' (p=$priority labels=$labels)"
      else
        id=$(bd create "$title" \
          --prefix sprint \
          -p "$priority" -t task \
          --labels "$labels" \
          --description "$description" \
          ${acceptance:+--acceptance "$acceptance"} \
          --silent 2>/dev/null)

        [[ "$ddev" == "true" && -n "$id" ]] && bd update "$id" --set-metadata ddev=true &>/dev/null
        [[ "$lane" == "7_done" && -n "$id" ]] && bd close "$id" --reason "Migrated from 7_done." &>/dev/null

        echo "  Created: $id ← $card"
      fi

      (( sprint_count++ ))
    done
  done
else
  echo "No sprint board found at $SPRINT_DIR — skipping."
fi

# ---------------------------------------------------------------------------
# Retro cards  (all get board-retro label)
# ---------------------------------------------------------------------------
RETRO_DIR="kanban/retrospective-actions"
if [[ -d "$RETRO_DIR" ]]; then
  echo "Migrating retro cards from $RETRO_DIR..."

  for dir in "$RETRO_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    lane=$(basename "$dir")

    case "$lane" in
      1_backlog)     lane_label="lane-backlog" ;;
      2_approved)    lane_label="lane-approved" ;;
      3_in-progress) lane_label="lane-in-progress" ;;
      4_done)        lane_label="" ;;
      *)             lane_label="lane-$lane" ;;
    esac

    for card in "$dir"*.md; do
      [[ -f "$card" ]] || continue

      title=$(grep "^# " "$card" 2>/dev/null | head -1 | sed 's/^# //' || echo "Untitled")
      description=$(cat "$card")

      priority_raw=$(grep "^priority:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' || echo "Medium")
      case "$priority_raw" in
        Critical) priority=0 ;;
        High)     priority=1 ;;
        Medium)   priority=2 ;;
        Low)      priority=3 ;;
        *)        priority=2 ;;
      esac

      target=$(grep "^target:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' | tr '[:upper:]' '[:lower:]' || echo "")
      category=$(grep "^category:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' | tr '[:upper:]' '[:lower:]' || echo "")
      effort=$(grep "^effort:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' | tr '[:upper:]' '[:lower:]' || echo "")
      session=$(grep "^session:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' || echo "")
      source_weight=$(grep "^source_weight:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' | tr '[:upper:]' '[:lower:]' || echo "")
      verification=$(grep "^verification_required:" "$card" 2>/dev/null | awk '{print $2}' | tr -d '"' || echo "false")

      # All retro issues carry board-retro
      labels="board-retro"
      [[ -n "$lane_label" ]] && labels="$labels,$lane_label"
      [[ -n "$target" ]] && labels="$labels,target-$target"
      [[ -n "$category" ]] && labels="$labels,cat-$category"
      [[ -n "$effort" ]] && labels="$labels,effort-$effort"
      [[ -n "$session" ]] && labels="$labels,session-$session"
      [[ -n "$source_weight" ]] && labels="$labels,weight-$source_weight"
      [[ "$verification" == "true" ]] && labels="$labels,verification-required"

      if [[ $DRY_RUN -eq 1 ]]; then
        echo "[DRY-RUN] retro create: '$title' (p=$priority labels=$labels)"
      else
        id=$(bd create "$title" \
          --prefix retro \
          -p "$priority" -t task \
          --labels "$labels" \
          --description "$description" \
          --silent 2>/dev/null)

        [[ "$lane" == "4_done" && -n "$id" ]] && bd close "$id" --reason "Migrated from 4_done." &>/dev/null

        echo "  Created: $id ← $card"
      fi

      (( retro_count++ ))
    done
  done
else
  echo "No retro board found at $RETRO_DIR — skipping."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [[ $DRY_RUN -eq 1 ]]; then
  echo "DRY RUN complete. Would migrate: $sprint_count sprint cards, $retro_count retro cards."
  echo "Run without --dry-run to perform the migration."
else
  echo "Migration complete: $sprint_count sprint cards, $retro_count retro cards."
  echo ""
  echo "Verify:"
  echo "  bd list -l board-sprint --json | jq 'length'"
  echo "  bd list -l board-retro --json | jq 'length'"
fi
