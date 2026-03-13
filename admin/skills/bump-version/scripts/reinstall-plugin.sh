#!/usr/bin/env bash
# reinstall-plugin.sh — Clean all cached versions and reinstall plugin(s) from local source
#
# Usage:
#   reinstall-plugin.sh <plugin|all>
#
# Arguments:
#   plugin — sprint | retro | ideate | admin | drupal-lab | all
#
# What it does:
#   For each specified plugin:
#   1. Removes ALL cached version directories
#   2. Asserts the cache is empty (catches silent rm failures)
#   3. Reinstalls from local source
#   4. Asserts the install produced the expected state (4 checks)
#
# Verification boundary:
#   This script verifies filesystem state only. It cannot verify that Claude Code
#   loads the plugin in a live session. After this script passes, run /reload-plugins
#   in your active Claude Code session to pick up the changes without restarting.
#
# Must be run outside an active Claude Code session (CLAUDECODE env var blocks
# the Claude CLI).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
CACHE_BASE="$HOME/.claude/plugins/cache/local"
PLUGINS=(sprint retro ideate admin drupal-lab office drover)

# --- Helpers ---

pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ FAIL: $*" >&2; }

usage() {
    echo "Usage: $0 <plugin|all>"
    echo ""
    echo "  Plugins: ${PLUGINS[*]}"
    echo ""
    echo "  Cleans all cached versions, reinstalls from local source, then"
    echo "  verifies the resulting cache state."
    echo "  Must be run outside an active Claude Code session."
    exit 1
}

# Count version directories in the plugin's cache dir.
count_version_dirs() {
    local cache_dir="$1"
    local count=0
    if [[ -d "$cache_dir" ]]; then
        for d in "$cache_dir"/*/; do
            [[ -d "$d" ]] && count=$((count + 1))
        done
    fi
    echo "$count"
}

# --- Post-clean assertion ---
# Asserts the cache directory is empty. Returns 1 if any version dirs survive.
assert_clean() {
    local plugin="$1"
    local cache_dir="$CACHE_BASE/$plugin"
    local remaining
    remaining=$(count_version_dirs "$cache_dir")

    if [[ "$remaining" -eq 0 ]]; then
        pass "cache empty after clean"
        return 0
    else
        fail "cache not empty after clean ($remaining version dir(s) remain)"
        return 1
    fi
}

# --- Post-install assertions ---
# Runs 4 assertions against the installed state. Returns 1 if any fail.
assert_installed() {
    local plugin="$1"
    local target_version="$2"
    local repo_json="$REPO_ROOT/$plugin/.claude-plugin/plugin.json"
    local cache_dir="$CACHE_BASE/$plugin"
    local target_dir="$cache_dir/$target_version"
    local cache_json="$target_dir/.claude-plugin/plugin.json"
    local failures=0

    # Assertion 1: Exactly one version directory in cache.
    # Catches: install created multiple dirs, or created none.
    local version_count
    version_count=$(count_version_dirs "$cache_dir")
    if [[ "$version_count" -eq 1 ]]; then
        pass "exactly 1 version dir in cache"
    else
        fail "expected 1 version dir in cache, found $version_count"
        failures=$((failures + 1))
    fi

    # Assertion 2: The target version directory exists by name.
    # Catches: install created a dir with an unexpected version string.
    if [[ -d "$target_dir" ]]; then
        pass "version dir $target_version exists"
    else
        fail "version dir $target_version missing — found: $(ls "$cache_dir" 2>/dev/null || echo '(empty)')"
        failures=$((failures + 1))
    fi

    # Assertion 3: plugin.json inside the installed dir reports the target version.
    # Catches: stale file copied from wrong source, or install wrote a bad manifest.
    if [[ -f "$cache_json" ]]; then
        local cached_version
        cached_version=$(python3 -c "import json,sys; print(json.load(open('$cache_json'))['version'])" 2>/dev/null || echo "PARSE_ERROR")
        if [[ "$cached_version" == "$target_version" ]]; then
            pass "cached plugin.json version = $cached_version"
        else
            fail "cached plugin.json says '$cached_version', expected '$target_version'"
            failures=$((failures + 1))
        fi
    else
        fail "plugin.json missing from installed dir $target_dir"
        failures=$((failures + 1))
    fi

    # Assertion 4: Non-empty install — the installed dir has a meaningful number of files.
    # Catches: install command ran but copied nothing (empty or near-empty dir).
    # Threshold is > 2: any real plugin has at least plugin.json + one content file + CHANGELOG.md.
    local file_count
    file_count=$(find "$target_dir" -type f 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$file_count" -gt 2 ]]; then
        pass "installed dir contains $file_count files"
    else
        fail "installed dir has only $file_count file(s) — possible empty install"
        failures=$((failures + 1))
    fi

    return "$failures"
}

# --- Main install + verify sequence ---
reinstall_plugin() {
    local plugin="$1"
    local json="$REPO_ROOT/$plugin/.claude-plugin/plugin.json"
    local cache_dir="$CACHE_BASE/$plugin"
    local overall_failures=0

    if [[ ! -f "$json" ]]; then
        echo "Error: plugin.json not found at $json" >&2
        exit 1
    fi

    local target_version
    target_version=$(python3 -c "import json,sys; print(json.load(open('$json'))['version'])")

    echo ""
    echo "[$plugin] $target_version"

    # Step 1: Remove all cached versions
    echo "  Cleaning cache..."
    if [[ -d "$cache_dir" ]]; then
        local removed=0
        for version_dir in "$cache_dir"/*/; do
            [[ -d "$version_dir" ]] || continue
            local ver
            ver="$(basename "$version_dir")"
            rm -rf "$version_dir"
            removed=$((removed + 1))
        done
        if [[ $removed -gt 0 ]]; then
            echo "  Removed $removed cached version(s)"
        fi
    fi

    # Assert clean succeeded
    assert_clean "$plugin" || overall_failures=$((overall_failures + 1))

    # Step 2: Reinstall from local source
    echo "  Installing $plugin@local..."
    if ! (cd "$REPO_ROOT" && claude plugin install "$plugin@local" --scope user 2>&1 | sed 's/^/  /'); then
        fail "claude plugin install exited non-zero"
        overall_failures=$((overall_failures + 1))
    fi

    # Assert install produced expected state
    assert_installed "$plugin" "$target_version" || overall_failures=$((overall_failures + $?))

    if [[ "$overall_failures" -eq 0 ]]; then
        echo "  → PASS (filesystem state verified)"
    else
        echo "  → FAIL ($overall_failures assertion(s) failed)" >&2
    fi

    return "$overall_failures"
}

# --- Entry point ---

if [[ $# -ne 1 ]]; then
    usage
fi

PLUGIN="$1"
total_failures=0

if [[ "$PLUGIN" == "all" ]]; then
    for p in "${PLUGINS[@]}"; do
        reinstall_plugin "$p" || total_failures=$((total_failures + $?))
    done
else
    valid=false
    for p in "${PLUGINS[@]}"; do
        [[ "$p" == "$PLUGIN" ]] && valid=true && break
    done
    if ! $valid; then
        echo "Error: unknown plugin '$PLUGIN'. Valid: ${PLUGINS[*]}" >&2
        usage
    fi
    reinstall_plugin "$PLUGIN" || total_failures=$((total_failures + $?))
fi

echo ""
if [[ "$total_failures" -eq 0 ]]; then
    echo "All assertions passed."
    echo "NOTE: filesystem state only. Run /reload-plugins in your active Claude Code"
    echo "session to pick up the changes, then invoke a skill to verify end-to-end."
    exit 0
else
    echo "FAILED: $total_failures assertion(s) did not pass." >&2
    exit 1
fi
