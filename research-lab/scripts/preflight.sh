#!/usr/bin/env bash
# Preflight audit script for Drupal cache optimization engagements
# Checks for common cache misconfigurations, cache tag blast radius,
# and blocks with problematic cache metadata.
#
# Usage: preflight.sh <site-url> [pages...]
#
# If no pages given AND drush is available, auto-discovers content types
# and samples one published page per type.
#
# Output: structured markdown to stdout (redirect to 01-preflight.md)
# Must be run from inside the DDEV project directory (so ddev drush works).

set -uo pipefail

URL="${1:?Usage: preflight.sh <site-url> [pages...]}"
shift

# --- Guard: don't run in worktrees/main/ ---
CWD=$(pwd)
if [[ "$CWD" == */worktrees/main || "$CWD" == */worktrees/main/* ]]; then
  echo "ERROR: Running in worktrees/main/ is not allowed. Use a dedicated worktree." >&2
  exit 1
fi

# --- Detect DDEV/drush ---
DRUSH_CMD=""
if command -v ddev &>/dev/null && ddev describe &>/dev/null 2>&1; then
  DRUSH_CMD="ddev drush"
elif command -v drush &>/dev/null; then
  DRUSH_CMD="drush"
fi

# --- Auto-discover pages if none provided ---
if [ $# -eq 0 ] && [ -n "$DRUSH_CMD" ]; then
  >&2 echo "No pages specified. Auto-discovering content types..."
  DISCOVERED=$($DRUSH_CMD sql:query "SELECT nfd.type, MIN(pa.alias) as alias FROM node_field_data nfd INNER JOIN path_alias pa ON CONCAT('/node/', nfd.nid) = pa.path WHERE nfd.status = 1 GROUP BY nfd.type ORDER BY nfd.type" 2>/dev/null || true)
  PAGES=(/)
  while IFS=$'\t' read -r type alias; do
    [ -n "$alias" ] && PAGES+=("$alias")
  done <<< "$DISCOVERED"
  >&2 echo "  Discovered ${#PAGES[@]} pages (1 per content type + homepage)"
else
  PAGES=("${@:-/}")
fi

echo "# Preflight Audit: $URL"
echo ""
echo "Date: $(date +%Y-%m-%d)"
echo ""

# --- Section 1: HTTP Cache Headers + Status ---
echo "## HTTP Cache Headers"
echo ""
echo "| Page | Status | Page Cache | Dynamic Cache | Max-Age | Cache-Control | Session Cookie |"
echo "|------|--------|------------|--------------|---------|---------------|----------------|"

for PAGE in "${PAGES[@]}"; do
  FULL_URL="${URL%/}${PAGE}"

  # Follow redirects, capture final response. Don't exit on curl failure.
  HEADERS=$(curl -sI -L "$FULL_URL" 2>/dev/null || echo "FAILED")
  STATUS=$(echo "$HEADERS" | grep '^HTTP/' | tail -1 | awk '{print $2}')
  PAGE_CACHE=$(echo "$HEADERS" | grep -i 'x-drupal-cache:' | tail -1 | sed 's/.*: //' | tr -d '\r')
  DYN_CACHE=$(echo "$HEADERS" | grep -i 'x-drupal-dynamic-cache' | tail -1 | sed 's/.*: //' | tr -d '\r')
  MAX_AGE=$(echo "$HEADERS" | grep -i 'x-drupal-cache-max-age' | tail -1 | sed 's/.*: //' | tr -d '\r')
  CC=$(echo "$HEADERS" | grep -i '^cache-control:' | tail -1 | sed 's/.*: //' | tr -d '\r')
  COOKIE=$(echo "$HEADERS" | grep -ci 'Set-Cookie:.*SESS' 2>/dev/null || echo "0")

  # Flag issues
  STATUS_FLAG=""
  [ "$STATUS" = "404" ] && STATUS_FLAG=" (NOT FOUND)"
  [ "$STATUS" = "500" ] && STATUS_FLAG=" (ERROR)"

  echo "| $PAGE | ${STATUS}${STATUS_FLAG} | ${PAGE_CACHE:-n/a} | ${DYN_CACHE:-n/a} | ${MAX_AGE:-n/a} | ${CC:-n/a} | ${COOKIE} |"
done

echo ""

# --- Section 2: Drupal Module Status ---
echo "## Drupal Module Status"
echo ""

if [ -n "$DRUSH_CMD" ]; then
  echo "### Cache-Related Modules"
  echo ""
  echo '```'
  $DRUSH_CMD pm:list --status=enabled --filter=cache 2>/dev/null || echo "Could not list modules"
  echo '```'
  echo ""

  echo "### BigPipe Status"
  echo ""
  echo '```'
  $DRUSH_CMD pm:list --filter=big_pipe 2>/dev/null || echo "Could not check BigPipe"
  echo '```'
  echo ""

  echo "### Performance Configuration"
  echo ""
  echo '```'
  $DRUSH_CMD config:get system.performance 2>/dev/null || echo "Could not read performance config"
  echo '```'
  echo ""
else
  echo "*Drush not available — run this script from inside the DDEV project directory.*"
  echo ""
fi

# --- Section 3: Block Cache Audit ---
echo "## Block Cache Audit"
echo ""

if [ -n "$DRUSH_CMD" ]; then
  echo "Blocks with \`max-age: 0\`, \`node_list\` tag, or \`user\` context:"
  echo ""
  echo "| Block ID | max-age | Visibility | Problematic Tags/Contexts |"
  echo "|----------|---------|------------|--------------------------|"

  $DRUSH_CMD ev '
use Drupal\Core\Cache\CacheableMetadata;
$block_storage = \Drupal::entityTypeManager()->getStorage("block");
$theme = \Drupal::theme()->getActiveTheme()->getName();
$blocks = $block_storage->loadByProperties(["theme" => $theme, "status" => TRUE]);
foreach ($blocks as $id => $block) {
  try {
    $plugin = $block->getPlugin();
    $build = $plugin->build();
    if (!is_array($build)) continue;
    $metadata = CacheableMetadata::createFromRenderArray($build);
    $max_age = $metadata->getCacheMaxAge();
    $contexts = $metadata->getCacheContexts();
    $tags = $metadata->getCacheTags();
    $vis = $block->getVisibility();
    $has_vis = !empty($vis) ? "restricted" : "UNRESTRICTED";
    $problems = [];
    if ($max_age === 0) $problems[] = "max-age=0";
    if (in_array("node_list", $tags)) $problems[] = "node_list tag";
    if (in_array("user", $contexts)) $problems[] = "user context";
    if (in_array("session", $contexts)) $problems[] = "session context";
    $broad_tags = array_filter($tags, function($t) {
      return in_array($t, ["node_list", "node_view", "rendered", "http_response"]) || strpos($t, "search_api_list:") === 0;
    });
    foreach ($broad_tags as $bt) $problems[] = $bt;
    if (!empty($problems)) {
      echo "| $id | $max_age | $has_vis | " . implode(", ", array_unique($problems)) . " |\n";
    }
  } catch (\Exception $e) {
    continue;
  }
}
' 2>/dev/null || echo "Could not audit blocks (drush eval failed)"

  echo ""
else
  echo "*Drush not available — skipping block audit.*"
  echo ""
fi

# --- Section 4: Cache Tag Blast Radius Test ---
echo "## Cache Tag Blast Radius"
echo ""

if [ -n "$DRUSH_CMD" ]; then
  echo "Testing: prime all pages → save one node → check which pages survive."
  echo ""

  # Clear and prime
  $DRUSH_CMD cr 2>/dev/null
  for PAGE in "${PAGES[@]}"; do
    curl -sI -L "${URL%/}${PAGE}" > /dev/null 2>&1
  done
  # Second request to populate page cache
  for PAGE in "${PAGES[@]}"; do
    curl -sI -L "${URL%/}${PAGE}" > /dev/null 2>&1
  done

  # Find a node to save (first published article, or first published node)
  EDIT_NID=$($DRUSH_CMD sql:query "SELECT nid FROM node_field_data WHERE status = 1 ORDER BY changed DESC LIMIT 1" 2>/dev/null || true)

  if [ -n "$EDIT_NID" ]; then
    # Save the node
    $DRUSH_CMD ev "\$n = \Drupal\node\Entity\Node::load($EDIT_NID); \$n->setChangedTime(time()); \$n->save();" 2>/dev/null || true

    echo "Saved node $EDIT_NID. Cache survival:"
    echo ""
    echo "| Page | Status After Save |"
    echo "|------|------------------|"

    HIT_COUNT=0
    TOTAL=0
    for PAGE in "${PAGES[@]}"; do
      ((TOTAL++))
      CACHE=$(curl -sI -L "${URL%/}${PAGE}" 2>/dev/null | grep -i 'x-drupal-cache:' | tail -1 | sed 's/.*: //' | tr -d '\r')
      echo "| $PAGE | ${CACHE:-n/a} |"
      [[ "$CACHE" == "HIT" ]] && ((HIT_COUNT++)) || true
    done

    echo ""
    echo "**Cache survival: ${HIT_COUNT}/${TOTAL} pages still cached after node save**"
    echo ""

    # Show which tags were invalidated
    echo "Tags invalidated during save:"
    echo ""
    echo '```'
    $DRUSH_CMD ev '
$db = \Drupal::database();
$result = $db->select("cachetags", "ct")->fields("ct", ["tag", "invalidations"])->condition("invalidations", 0, ">") ->orderBy("invalidations", "DESC")->execute();
foreach ($result as $row) {
  echo "$row->tag (count: $row->invalidations)\n";
}
' 2>/dev/null || echo "Could not read cachetags table"
    echo '```'
    echo ""
  else
    echo "*Could not find a node to test with.*"
    echo ""
  fi
else
  echo "*Drush not available — skipping blast radius test.*"
  echo ""
fi

# --- Section 5: Page Load Baseline ---
echo "## Baseline Measurements"
echo ""
echo "| Page | Status | TTFB (s) | Total (s) | Size (bytes) |"
echo "|------|--------|----------|-----------|--------------|"

for PAGE in "${PAGES[@]}"; do
  FULL_URL="${URL%/}${PAGE}"
  STATUS=$(curl -sI -L "$FULL_URL" -o /dev/null -w '%{http_code}' 2>/dev/null || echo "err")
  METRICS=$(curl -L -o /dev/null -s -w '%{time_starttransfer}\t%{time_total}\t%{size_download}' "$FULL_URL" 2>/dev/null || echo "0\t0\t0")
  TTFB=$(echo "$METRICS" | cut -f1)
  TOTAL_TIME=$(echo "$METRICS" | cut -f2)
  SIZE=$(echo "$METRICS" | cut -f3)
  echo "| $PAGE | $STATUS | $TTFB | $TOTAL_TIME | $SIZE |"
done

echo ""

# --- Section 6: Summary ---
echo "## Summary"
echo ""
echo "- **Pages audited:** ${#PAGES[@]}"
echo "- **Auto-discovered:** $([ $# -eq 0 ] && echo "yes (one per content type)" || echo "no (manually specified)")"
echo "- **Drush available:** $([ -n "$DRUSH_CMD" ] && echo "yes ($DRUSH_CMD)" || echo "no")"
echo "- **Findings:** Review cache headers, block audit, and blast radius test above."
