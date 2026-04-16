#!/usr/bin/env zsh
# update-plugins.sh — Reinstall all local plugins and patch CLAUDE.md version paths
# Uses associative arrays (declare -A); runs under zsh to avoid needing bash 4+ on macOS.
#
# Usage: update-plugins.sh [claude_md_path]
#
# Arguments:
#   claude_md_path — optional path to CLAUDE.md to patch (default: $PWD/CLAUDE.md)
#
# Output: structured lines for skill reporting
#   PLUGIN_BEFORE:<name>:<version|not-installed>
#   PLUGIN_AFTER:<name>:<version>
#   CLAUDE_MD_UPDATED:<count>
#   STATUS:changed|unchanged
#
# Works inside or outside a Claude Code session (unsets CLAUDECODE so the CLI is not blocked).
# For a clean cache-wipe reinstall with assertions, use reinstall-plugin.sh instead.
set -uo pipefail

CLAUDE_MD="${1:-$PWD/CLAUDE.md}"
CACHE_BASE="$HOME/.claude/plugins/cache/local"
PLUGINS=(sprint admin drupal-lab retro ideate drover improve lib research-lab workflow)

declare -A BEFORE
declare -A AFTER

# --- Capture before versions ---
for plugin in "${PLUGINS[@]}"; do
    version=$(ls "$CACHE_BASE/$plugin/" 2>/dev/null | sort -V | tail -1)
    if [ -n "$version" ]; then
        BEFORE[$plugin]="$version"
        echo "PLUGIN_BEFORE:$plugin:$version"
    else
        BEFORE[$plugin]="not-installed"
        echo "PLUGIN_BEFORE:$plugin:not-installed"
    fi
done

# --- Reinstall installed plugins ---
for plugin in "${PLUGINS[@]}"; do
    if [ "${BEFORE[$plugin]}" != "not-installed" ]; then
        env -u CLAUDECODE claude plugin install "$plugin@local" --scope user >/dev/null 2>&1 || true
    fi
done

# --- Capture after versions ---
for plugin in "${PLUGINS[@]}"; do
    if [ "${BEFORE[$plugin]}" != "not-installed" ]; then
        version=$(ls "$CACHE_BASE/$plugin/" 2>/dev/null | sort -V | tail -1)
        AFTER[$plugin]="${version:-${BEFORE[$plugin]}}"
        echo "PLUGIN_AFTER:$plugin:${AFTER[$plugin]}"
    fi
done

# --- Patch CLAUDE.md version paths ---
claude_md_updates=0
if [ -f "$CLAUDE_MD" ]; then
    for plugin in "${PLUGINS[@]}"; do
        before="${BEFORE[$plugin]:-}"
        after="${AFTER[$plugin]:-}"
        if [ -n "$before" ] && [ -n "$after" ] && [ "$before" != "$after" ] && [ "$before" != "not-installed" ]; then
            count=$(grep -c "plugins/cache/local/$plugin/$before/" "$CLAUDE_MD" 2>/dev/null || echo 0)
            if [ "$count" -gt 0 ]; then
                sed -i '' "s|plugins/cache/local/$plugin/$before/|plugins/cache/local/$plugin/$after/|g" "$CLAUDE_MD"
                claude_md_updates=$((claude_md_updates + count))
            fi
        fi
    done
fi
echo "CLAUDE_MD_UPDATED:$claude_md_updates"

# --- Overall status ---
changed=false
for plugin in "${PLUGINS[@]}"; do
    before="${BEFORE[$plugin]:-not-installed}"
    after="${AFTER[$plugin]:-not-installed}"
    if [ "$before" != "$after" ]; then
        changed=true
        break
    fi
done
echo "STATUS:$([ "$changed" = true ] && echo changed || echo unchanged)"
