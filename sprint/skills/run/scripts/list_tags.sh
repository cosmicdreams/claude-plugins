#!/usr/bin/env bash
# List all tags used in kanban cards with counts. Recurses all status directories.
# Usage: bash list_tags.sh [kanban-directory]
# Compatible with macOS bash 3.x.

KANBAN_DIR="${1:-.}"

if [ ! -d "$KANBAN_DIR" ]; then
    echo "Error: '$KANBAN_DIR' not found." >&2
    exit 1
fi

echo "=== Tag Usage ==="
echo

# Recurse all status directories
for dir in "$KANBAN_DIR"/*/; do
    [ -d "$dir" ] || continue
    for f in "$dir"*.md; do
        [ -f "$f" ] && grep "^tags:" "$f"
    done
done | \
    sed 's/.*tags: //' | \
    tr -d '[]' | \
    tr ',' '\n' | \
    sed 's/^ *//' | \
    sort | \
    uniq -c | \
    sort -rn | \
    awk '{printf "%3d  %s\n", $1, $2}'
