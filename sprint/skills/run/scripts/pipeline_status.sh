#!/usr/bin/env bash
# Show pipeline health: stage counts, DDEV slot usage, blocked cards, fix loops.
# Status is derived from directory name (no status: frontmatter field).
# Usage: bash pipeline_status.sh [kanban-directory]
# Compatible with macOS bash 3.x (no associative arrays).

KANBAN_DIR="${1:-kanban}"

if [ ! -d "$KANBAN_DIR" ]; then
    echo "Error: '$KANBAN_DIR' not found." >&2
    exit 1
fi

# Extract a YAML frontmatter field value
field() {
    awk -v f="$2" '/^---$/{fm++;next} fm==1 && $0 ~ "^"f":"{sub("^"f":[ \t]*","");print;exit}' "$1"
}

# Counters per directory
cnt_backlog=0; cnt_analyzing=0; cnt_developing=0; cnt_needs_review=0
cnt_reviewing=0; cnt_review_failed=0; cnt_done=0
ddev_count=0; total_cards=0; high_priority=0; fix_loops_high=0; blocked_count=0

# Status directories in pipeline order
DIRS="1_backlog 2_analyzing 3_developing 4_needs-review 5_reviewing 6_review-failed 7_done"

for dir_name in $DIRS; do
    dir="$KANBAN_DIR/$dir_name"
    [ -d "$dir" ] || continue

    for f in "$dir"/*.md; do
        [ -f "$f" ] || continue
        total_cards=$((total_cards + 1))

        priority=$(field "$f" priority)
        ddev=$(field "$f" ddev)
        fix_loop=$(field "$f" fix_loop)
        blocked=$(field "$f" blocked_by)

        case "$dir_name" in
            1_backlog)       cnt_backlog=$((cnt_backlog + 1)) ;;
            2_analyzing)     cnt_analyzing=$((cnt_analyzing + 1)) ;;
            3_developing)    cnt_developing=$((cnt_developing + 1)) ;;
            4_needs-review)  cnt_needs_review=$((cnt_needs_review + 1)) ;;
            5_reviewing)     cnt_reviewing=$((cnt_reviewing + 1)) ;;
            6_review-failed) cnt_review_failed=$((cnt_review_failed + 1)) ;;
            7_done)          cnt_done=$((cnt_done + 1)) ;;
        esac

        [ "$priority" = "High" ] && high_priority=$((high_priority + 1))
        [ "$ddev" = "true" ] && ddev_count=$((ddev_count + 1))
        [ -n "$fix_loop" ] && [ "$fix_loop" -ge 3 ] 2>/dev/null && fix_loops_high=$((fix_loops_high + 1))
        [ -n "$blocked" ] && [ "$blocked" != "[]" ] && blocked_count=$((blocked_count + 1))
    done
done

echo "=== PIPELINE STATUS ==="
echo
printf "  Total cards:    %d\n" "$total_cards"
printf "  High priority:  %d\n" "$high_priority"
echo

echo "--- Stage Counts ---"
for pair in "backlog:$cnt_backlog" "analyzing:$cnt_analyzing" "developing:$cnt_developing" \
            "needs-review:$cnt_needs_review" "reviewing:$cnt_reviewing" \
            "review-failed:$cnt_review_failed" "done:$cnt_done"; do
    name="${pair%%:*}"
    count="${pair##*:}"
    bar=""
    i=0; while [ "$i" -lt "$count" ]; do bar="${bar}#"; i=$((i + 1)); done
    printf "  %-14s %2d  %s\n" "$name" "$count" "$bar"
done
echo

echo "--- DDEV Slots ---"
printf "  In use:    %d / 3\n" "$ddev_count"
if [ "$ddev_count" -ge 3 ]; then
    echo "  Status:    FULL -- new validators must queue or do Phase 1 work"
elif [ "$ddev_count" -eq 0 ]; then
    echo "  Status:    EMPTY -- slots available"
else
    printf "  Status:    %d available\n" "$((3 - ddev_count))"
fi
echo

# Pipeline health assessment
echo "--- Health ---"
if [ "$fix_loops_high" -gt 0 ]; then
    printf "  WARNING: %d card(s) at fix_loop >= 3 -- escalate to team-lead\n" "$fix_loops_high"
fi

if [ "$blocked_count" -gt 0 ]; then
    printf "  WARNING: %d card(s) blocked -- check dependencies\n" "$blocked_count"
fi

if [ "$cnt_reviewing" -eq 0 ] && [ "$cnt_needs_review" -gt 0 ]; then
    echo "  NOTE: $cnt_needs_review card(s) awaiting review but none being reviewed"
fi

if [ "$cnt_developing" -gt 0 ] && [ "$cnt_reviewing" -eq 0 ] && [ "$cnt_needs_review" -eq 0 ]; then
    echo "  NOTE: $cnt_developing developing but no review activity -- reviewers may be idle"
fi

if [ "$cnt_backlog" -gt 0 ] && [ "$cnt_analyzing" -eq 0 ] && [ "$cnt_developing" -eq 0 ]; then
    echo "  NOTE: $cnt_backlog cards in backlog but no active work -- agents may be idle"
fi

if [ "$cnt_review_failed" -gt 0 ]; then
    printf "  WARNING: %d card(s) in review-failed -- implementer action needed\n" "$cnt_review_failed"
fi

if [ "$total_cards" -gt 0 ]; then
    pct=$((cnt_done * 100 / total_cards))
    printf "\n  Progress: %d/%d (%d%%)\n" "$cnt_done" "$total_cards" "$pct"
fi
echo
