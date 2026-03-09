#!/usr/bin/env zsh
# migrate-to-beads.sh
# Migrates existing markdown kanban cards to Beads databases.
# Run once from the project root after initializing the databases.
#
# Prerequisites:
#   brew install beads
#   dolt sql-server &   (must be running on default port 3307)
#   bd init --prefix sprint
#   bd init --prefix retro
#
# Usage:
#   zsh scripts/migrate-to-beads.sh [--dry-run]

set -euo pipefail

SPRINT_DB=".beads/sprint.db"
RETRO_DB=".beads/retro.db"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# Verify databases exist
if [[ $DRY_RUN -eq 0 ]]; then
  if ! bd --db "$SPRINT_DB" list --json &>/dev/null; then
    echo "ERROR: Sprint database not found at $SPRINT_DB"
    echo "Run: bd init --prefix sprint"
    exit 1
  fi
  if ! bd --db "$RETRO_DB" list --json &>/dev/null; then
    echo "ERROR: Retro database not found at $RETRO_DB"
    echo "Run: bd init --prefix retro"
    exit 1
  fi
fi

sprint_count=0
retro_count=0

# ---------------------------------------------------------------------------
# Sprint cards
# ---------------------------------------------------------------------------
SPRINT_DIR="kanban/sprint-run"
if [[ -d "$SPRINT_DIR" ]]; then
  echo "Migrating sprint cards from $SPRINT_DIR..."

  for dir in "$SPRINT_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    lane=$(basename "$dir")

    # Map directory to status and label
    case "$lane" in
      1_backlog)      status="open";        lane_label="lane-backlog" ;;
      2_analyzing)    status="in_progress"; lane_label="lane-analyzing" ;;
      3_developing)   status="in_progress"; lane_label="lane-developing" ;;
      4_needs-review) status="open";        lane_label="lane-needs-review" ;;
      5_reviewing)    status="in_progress"; lane_label="lane-reviewing" ;;
      6_review-failed)status="open";        lane_label="lane-review-failed" ;;
      7_done)         status="closed";      lane_label="" ;;
      *)              lane_label="lane-$lane"; status="open" ;;
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

      # Build labels
      labels="$lane_label"
      [[ -n "$stage" ]] && labels="$labels,stage-$stage"
      [[ -n "$issue" ]] && labels="$labels,issue-$issue"
      [[ -n "$review_scope" ]] && labels="$labels,review-scope-$review_scope"
      [[ "$fix_loop" -gt 0 ]] 2>/dev/null && labels="$labels,fix-loop-$fix_loop"

      # Trim leading comma if lane_label was empty (7_done)
      labels="${labels#,}"

      if [[ $DRY_RUN -eq 1 ]]; then
        echo "[DRY-RUN] sprint create: '$title' (p=$priority labels=$labels lane=$lane)"
      else
        id=$(bd --db "$SPRINT_DB" create "$title" \
          -p "$priority" -t task \
          --labels "$labels" \
          --description "$description" \
          ${acceptance:+--acceptance "$acceptance"} \
          --silent 2>/dev/null)

        # Handle ddev metadata
        if [[ "$ddev" == "true" && -n "$id" ]]; then
          bd --db "$SPRINT_DB" update "$id" --set-metadata ddev=true &>/dev/null
        fi

        # Close cards that were in 7_done
        if [[ "$lane" == "7_done" && -n "$id" ]]; then
          bd --db "$SPRINT_DB" close "$id" --reason "Migrated from 7_done." &>/dev/null
        fi

        echo "  Created: $id ← $card"
      fi

      (( sprint_count++ ))
    done
  done
else
  echo "No sprint board found at $SPRINT_DIR — skipping."
fi

# ---------------------------------------------------------------------------
# Retro cards
# ---------------------------------------------------------------------------
RETRO_DIR="kanban/retrospective-actions"
if [[ -d "$RETRO_DIR" ]]; then
  echo "Migrating retro cards from $RETRO_DIR..."

  for dir in "$RETRO_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    lane=$(basename "$dir")

    case "$lane" in
      1_backlog)     status="open";        lane_label="lane-backlog" ;;
      2_approved)    status="open";        lane_label="lane-approved" ;;
      3_in-progress) status="in_progress"; lane_label="lane-in-progress" ;;
      4_done)        status="closed";      lane_label="" ;;
      *)             lane_label="lane-$lane"; status="open" ;;
    esac

    for card in "$dir"*.md; do
      [[ -f "$card" ]] || continue

      title=$(grep "^# " "$card" 2>/dev/null | head -1 | sed 's/^# //' || echo "Untitled")
      description=$(cat "$card")

      # Priority mapping: Critical→0, High→1, Medium→2, Low→3
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

      # Build labels
      labels="$lane_label"
      [[ -n "$target" ]] && labels="$labels,target-$target"
      [[ -n "$category" ]] && labels="$labels,cat-$category"
      [[ -n "$effort" ]] && labels="$labels,effort-$effort"
      [[ -n "$session" ]] && labels="$labels,session-$session"
      [[ -n "$source_weight" ]] && labels="$labels,weight-$source_weight"
      [[ "$verification" == "true" ]] && labels="$labels,verification-required"
      labels="${labels#,}"

      if [[ $DRY_RUN -eq 1 ]]; then
        echo "[DRY-RUN] retro create: '$title' (p=$priority labels=$labels lane=$lane)"
      else
        id=$(bd --db "$RETRO_DB" create "$title" \
          -p "$priority" -t task \
          --labels "$labels" \
          --description "$description" \
          --silent 2>/dev/null)

        # Close 4_done cards
        if [[ "$lane" == "4_done" && -n "$id" ]]; then
          bd --db "$RETRO_DB" close "$id" --reason "Migrated from 4_done." &>/dev/null
        fi

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
  echo "  bd --db $SPRINT_DB list --json | jq 'length'"
  echo "  bd --db $RETRO_DB list --json | jq 'length'"
fi
