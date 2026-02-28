#!/usr/bin/env bash
# Search kanban cards by tag. Recurses all status directories.
# Usage: bash search_by_tag.sh [kanban-directory] <tag>
# Compatible with macOS bash 3.x.

KANBAN_DIR="${1:-.}"
shift
TAG="$1"

if [ -z "$TAG" ]; then
    echo "Usage: $0 [kanban_dir] <tag>"
    echo "Example: $0 kanban/sprint-run/ settings-tray"
    exit 1
fi

if [ ! -d "$KANBAN_DIR" ]; then
    echo "Error: '$KANBAN_DIR' not found." >&2
    exit 1
fi

echo "=== Cards tagged: $TAG ==="
echo

found=0

# Recurse all status directories
for dir in "$KANBAN_DIR"/*/; do
    [ -d "$dir" ] || continue
    dir_name=$(basename "$dir")
    status=$(echo "$dir_name" | sed 's/^[0-9]*_//')

    for file in "$dir"*.md; do
        [ -f "$file" ] || continue
        grep -q "tags:.*$TAG" "$file" || continue

        id=$(grep "^id:" "$file" | sed 's/id: *//')
        t=$(grep "^# " "$file" | head -1 | sed 's/^# //')

        printf "#%-3s %-18s %s\n" "${id:-?}" "[$status]" "$t"
        found=1
    done
done

[ "$found" -eq 0 ] && echo "  No cards found with tag: $TAG"
