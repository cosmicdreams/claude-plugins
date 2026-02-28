#!/usr/bin/env bash
# List all kanban cards in pipe-delimited format. Recurses all status directories.
# Output: id|status|stage|assignee|blocked_by|title
# Status is derived from directory name (no status: frontmatter field).
# Usage: bash list_all_cards.sh [kanban-directory]
# Compatible with macOS bash 3.x.

KANBAN_DIR="${1:-.}"

if [ ! -d "$KANBAN_DIR" ]; then
    echo "Error: '$KANBAN_DIR' not found." >&2
    exit 1
fi

# Recurse all status directories in pipeline order
for dir_name in 1_backlog 2_analyzing 3_developing 4_needs-review 5_reviewing 6_review-failed 7_done; do
    dir="$KANBAN_DIR/$dir_name"
    [ -d "$dir" ] || continue

    # Derive status from directory name
    status=$(echo "$dir_name" | sed 's/^[0-9]*_//')

    for f in "$dir"/*.md; do
        [ -f "$f" ] || continue
        id=$(grep "^id:" "$f" | awk '{print $2}')
        stage=$(grep "^stage:" "$f" | awk '{print $2}')
        assignee=$(grep "^assignee:" "$f" | sed 's/assignee: *//' | tr -d '"'"'"'')
        blocked=$(grep "^blocked_by:" "$f" | sed 's/blocked_by: \[//' | sed 's/\]//')
        title=$(grep "^# " "$f" | head -1 | sed 's/^# //')
        echo "$id|$status|${stage:--}|${assignee:--}|${blocked:--}|$title"
    done
done | sort -n
