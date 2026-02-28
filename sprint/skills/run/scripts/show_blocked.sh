#!/usr/bin/env bash
# Show cards that are blocked and what's blocking them.
# Status is derived from directory name (no status: frontmatter field).
# Usage: bash show_blocked.sh [kanban-directory]
# Compatible with macOS bash 3.x.

KANBAN_DIR="${1:-kanban}"

if [ ! -d "$KANBAN_DIR" ]; then
    echo "Error: '$KANBAN_DIR' not found." >&2
    exit 1
fi

echo "=== Blocked Cards ==="
echo

found=0

# Recurse all 7 status directories
for dir in "$KANBAN_DIR"/*/; do
    [ -d "$dir" ] || continue
    dir_name=$(basename "$dir")
    status=$(echo "$dir_name" | sed 's/^[0-9]*_//')

    for file in "$dir"*.md; do
        [ -f "$file" ] || continue

        blocked_by=$(grep "^blocked_by:" "$file" | sed 's/blocked_by: *//' | tr -d '[]')

        # Skip if not blocked (empty or only whitespace/commas)
        [ -z "$(echo "$blocked_by" | tr -d ' ,')" ] && continue

        id=$(grep "^id:" "$file" | sed 's/id: *//')
        t=$(grep "^# " "$file" | head -1 | sed 's/^# //')

        printf "#%-3s %-18s %s\n" "${id:-?}" "[$status]" "$t"
        echo "  Blocked by: $blocked_by"

        # Show status of blocking cards
        for bid in $(echo "$blocked_by" | tr ',' ' '); do
            bid=$(echo "$bid" | tr -d ' ')
            [ -z "$bid" ] && continue
            for search_dir in "$KANBAN_DIR"/*/; do
                [ -d "$search_dir" ] || continue
                for bf in "$search_dir"*.md; do
                    [ -f "$bf" ] || continue
                    bfid=$(grep "^id:" "$bf" | sed 's/id: *//' | tr -d ' ')
                    if [ "$bfid" = "$bid" ]; then
                        bdir=$(basename "$(dirname "$bf")")
                        bstatus=$(echo "$bdir" | sed 's/^[0-9]*_//')
                        btitle=$(grep "^# " "$bf" | head -1 | sed 's/^# //')
                        printf "    -> #%s [%s] %s\n" "$bid" "$bstatus" "$btitle"
                        break 2
                    fi
                done
            done
        done
        echo
        found=1
    done
done

[ "$found" -eq 0 ] && echo "  No blocked cards."
