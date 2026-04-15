#!/usr/bin/env bash
# rss-ingest.sh — poll RSS/API feeds per active domain, drop new items into
# Raw/Inbox/<domain>/, emit batch_complete signals.
#
# Invoked by umbrella-ideas.sh on a ~30-minute cadence. Exits after one pass.
#
# Stdout: signal lines (consumed by Monitor via the umbrella).
# Stderr: diagnostic logs.

set -euo pipefail

VAULT="${OBSIDIAN_VAULT:-$HOME/Vaults/Neurons}"
CONFIG_DIR="$HOME/.config/ideas-funnel/domains"
MANIFEST="$VAULT/Raw/.manifest.json"
SEEN_URLS_CACHE="$HOME/.claude/ideas-funnel.seen-urls.txt"
EVENTS_LOG="$HOME/.claude/ideas-funnel.events.jsonl"

mkdir -p "$(dirname "$EVENTS_LOG")"
touch "$SEEN_URLS_CACHE"

# Cap the seen-URL cache to the most recent 400 entries
if [ "$(wc -l < "$SEEN_URLS_CACHE")" -gt 400 ]; then
  tail -200 "$SEEN_URLS_CACHE" > "${SEEN_URLS_CACHE}.tmp" && mv "${SEEN_URLS_CACHE}.tmp" "$SEEN_URLS_CACHE"
fi

log_stderr() {
  echo "[rss-ingest $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >&2
}

log_event() {
  local event="$1"
  echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"source\":\"rss-ingest\",\"event\":\"$event\"}" >> "$EVENTS_LOG"
}

# Require yq + curl. If either is missing, skip gracefully.
for tool in curl yq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    log_stderr "missing tool: $tool — aborting"
    log_event "missing-tool:$tool"
    exit 1
  fi
done

# Iterate active domain configs
for yaml_file in "$CONFIG_DIR"/*.yaml; do
  [ -f "$yaml_file" ] || continue

  slug=$(yq -r '.slug' "$yaml_file")
  active=$(yq -r '.active // true' "$yaml_file")
  [ "$active" != "true" ] && continue

  raw_inbox="$VAULT/$(yq -r '.raw_inbox' "$yaml_file")"
  mkdir -p "$raw_inbox"

  # Collect RSS feeds + API endpoints
  rss_feeds=$(yq -r '.feeds.rss[]?' "$yaml_file")
  api_endpoints=$(yq -r '.feeds.api[]?' "$yaml_file")
  keywords=$(yq -r '.feeds.keywords[]?' "$yaml_file" | tr '\n' '|' | sed 's/|$//')
  exclude=$(yq -r '.feeds.exclude_keywords[]?' "$yaml_file" | tr '\n' '|' | sed 's/|$//')

  count=0
  batch_id="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # RSS: fetch, parse <item><link> and <entry><link href=>
  for feed in $rss_feeds; do
    log_stderr "fetching RSS: $slug ← $feed"
    xml=$(curl -fsSL --max-time 15 "$feed" 2>/dev/null) || {
      echo "Raw/Inbox/$slug/error $slug rss_fetch_failed:$feed"
      continue
    }

    # Extract URLs + titles. Lightweight: grep for <link> and <title>.
    # NOTE: this is a minimal starter. Swap in xmlstarlet/yq for production quality.
    echo "$xml" | grep -oE '<link[^>]*>[^<]*</link>|<link[^>]+href="[^"]+"' | \
      grep -oE 'https?://[^"<]+' | sort -u | while read -r url; do
      # Dedup against cache
      grep -qF "$url" "$SEEN_URLS_CACHE" && continue

      # Apply keyword filter (minimal — fetch title via curl HEAD won't do, we trust URL)
      # In practice the ingest skill applies the quality gate using page content.

      # Apply exclude filter (against URL)
      if [ -n "$exclude" ] && echo "$url" | grep -qEi "$exclude"; then
        echo "$url" >> "$SEEN_URLS_CACHE"
        continue
      fi

      # Write raw item with minimal frontmatter
      slug_from_url=$(echo "$url" | sed 's|https\?://||; s|/$||; s|[^a-zA-Z0-9]|-|g' | cut -c1-60)
      today=$(date -u +%Y-%m-%d)
      out="$raw_inbox/${today}-${slug_from_url}.md"
      [ -f "$out" ] && continue

      cat > "$out" <<EOF
---
type: raw
date: $today
origin: $url
domain: $slug
status: new
fetched_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
batch_id: $batch_id
---

# Source: $url

EOF
      echo "$url" >> "$SEEN_URLS_CACHE"
      count=$((count + 1))
    done
  done

  # API endpoints: HackerNews Algolia style. Extract URLs from JSON.
  for api_url in $api_endpoints; do
    log_stderr "fetching API: $slug ← $api_url"
    json=$(curl -fsSL --max-time 15 "$api_url" 2>/dev/null) || {
      echo "Raw/Inbox/$slug/error $slug api_fetch_failed:$api_url"
      continue
    }

    # HackerNews Algolia returns hits with .url and .title
    echo "$json" | yq -r '.hits[]? | select(.url) | .url + "\t" + (.title // "")' 2>/dev/null | while IFS=$'\t' read -r url title; do
      [ -z "$url" ] && continue
      grep -qF "$url" "$SEEN_URLS_CACHE" && continue

      # Keyword gate — require at least one positive keyword match in title (if keywords defined)
      if [ -n "$keywords" ]; then
        echo "$title" | grep -qEi "$keywords" || { echo "$url" >> "$SEEN_URLS_CACHE"; continue; }
      fi

      # Exclude gate
      if [ -n "$exclude" ] && echo "$title $url" | grep -qEi "$exclude"; then
        echo "$url" >> "$SEEN_URLS_CACHE"
        continue
      fi

      slug_from_url=$(echo "$url" | sed 's|https\?://||; s|/$||; s|[^a-zA-Z0-9]|-|g' | cut -c1-60)
      today=$(date -u +%Y-%m-%d)
      out="$raw_inbox/${today}-${slug_from_url}.md"
      [ -f "$out" ] && continue

      cat > "$out" <<EOF
---
type: raw
date: $today
origin: $url
domain: $slug
title: "$title"
status: new
fetched_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
batch_id: $batch_id
---

# $title

$url
EOF
      echo "$url" >> "$SEEN_URLS_CACHE"
      count=$((count + 1))
    done
  done

  if [ "$count" -gt 0 ]; then
    echo "Raw/Inbox/$slug/batch_complete $slug $count $batch_id"
    log_event "batch_complete:$slug:$count"
    log_stderr "domain=$slug added $count new items"
  else
    log_stderr "domain=$slug no new items"
  fi
done
