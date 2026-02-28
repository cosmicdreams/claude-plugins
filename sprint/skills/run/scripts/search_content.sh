#!/usr/bin/env bash
# Search kanban card content (case-insensitive). Recurses all status directories.
# Usage: bash search_content.sh [kanban-directory] "<search term>"
# Compatible with macOS bash 3.x.

KANBAN_DIR="${1:-.}"
shift
SEARCH_TERM="$*"

if [ -z "$SEARCH_TERM" ]; then
    echo "Usage: $0 [kanban_dir] <search_term>"
    echo "Example: $0 kanban/sprint-run/ 'jQuery removal'"
    exit 1
fi

if [ ! -d "$KANBAN_DIR" ]; then
    echo "Error: '$KANBAN_DIR' not found." >&2
    exit 1
fi

echo "=== Cards matching: $SEARCH_TERM ==="
echo

found=0

# Recurse all status directories
for dir in "$KANBAN_DIR"/*/; do
    [ -d "$dir" ] || continue
    dir_name=$(basename "$dir")
    status=$(echo "$dir_name" | sed 's/^[0-9]*_//')

    for file in "$dir"*.md; do
        [ -f "$file" ] || continue
        grep -qi "$SEARCH_TERM" "$file" || continue

        id=$(grep "^id:" "$file" | sed 's/id: *//')
        t=$(grep "^# " "$file" | head -1 | sed 's/^# //')

        printf "#%-3s %-18s %s\n" "${id:-?}" "[$status]" "$t"

        echo "  Matches:"
        grep -i -n -C1 "$SEARCH_TERM" "$file" | head -10 | sed 's/^/    /'
        echo
        found=1
    done
done

[ "$found" -eq 0 ] && echo "  No cards matching: $SEARCH_TERM"
