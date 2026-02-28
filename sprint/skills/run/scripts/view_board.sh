#!/usr/bin/env bash
# Display kanban cards grouped by status column.
# Status is derived from directory name (no status: frontmatter field).
# Usage: bash view_board.sh [kanban-directory]
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

# Extract first H1 title from body (after frontmatter)
title() {
    awk '/^---$/{fm++;next} fm==2 && /^# /{sub("^# ","");print;exit}' "$1"
}

# Status directories in pipeline order
DIRS="1_backlog 2_analyzing 3_developing 4_needs-review 5_reviewing 6_review-failed 7_done"

for dir_name in $DIRS; do
    dir="$KANBAN_DIR/$dir_name"
    # Derive display name: strip leading number and underscore
    display=$(echo "$dir_name" | sed 's/^[0-9]*_//')

    printf "=== %-18s ===\n" "$(echo "$display" | tr '[:lower:]' '[:upper:]')"

    found=0
    if [ -d "$dir" ]; then
        for f in "$dir"/*.md; do
            [ -f "$f" ] || continue

            id=$(field "$f" id)
            priority=$(field "$f" priority)
            blocked=$(field "$f" blocked_by)
            assignee=$(field "$f" assignee)
            ddev=$(field "$f" ddev)
            t=$(title "$f")
            [ -z "$t" ] && t=$(basename "$f" .md)

            line="  #${id} ${t}"
            [ "$priority" = "High" ] && line="$line [HIGH]"
            [ -n "$assignee" ] && [ "$assignee" != '""' ] && [ "$assignee" != "''" ] && [ "$assignee" != "" ] && line="$line (${assignee})"
            [ "$ddev" = "true" ] && line="$line [DDEV]"
            [ -n "$blocked" ] && [ "$blocked" != "[]" ] && line="$line [blocked: $blocked]"

            echo "$line"
            found=1
        done
    fi

    [ "$found" -eq 0 ] && echo "  (empty)"
    echo
done
