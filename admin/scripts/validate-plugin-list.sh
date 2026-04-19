#!/usr/bin/env zsh
# validate-plugin-list.sh — Cross-check a hardcoded PLUGINS array against the filesystem.
#
# Usage:
#   validate-plugin-list.sh <repo-root> <plugin1> [plugin2 ...]
#
# The script scans <repo-root> for top-level directories that look like plugins
# (have a .claude-plugin/plugin.json inside) and compares that set against the
# supplied array.  Exits 1 and prints a clear diff if they disagree.
#
# Excluded dirs (never plugins): analysis-reports plans scripts worktrees
# Hidden dirs (.*) are also excluded.
#
# Callers pass the PLUGINS array as individual arguments after REPO_ROOT:
#
#   source validate-plugin-list.sh "$REPO_ROOT" "${PLUGINS[@]}"
#
# or invoke directly for a standalone check:
#
#   validate-plugin-list.sh /path/to/repo sprint retro admin

set -euo pipefail

REPO_ROOT="${1:?Usage: validate-plugin-list.sh <repo-root> <plugin...>}"
shift
HARDCODED=("$@")

EXCLUDE=(analysis-reports plans scripts worktrees)

# Collect filesystem plugins: top-level dirs that contain .claude-plugin/plugin.json
filesystem_plugins=()
for dir in "$REPO_ROOT"/*/; do
    [[ -d "$dir" ]] || continue
    name="$(basename "$dir")"
    # Skip hidden dirs
    [[ "$name" == .* ]] && continue
    # Skip known non-plugin dirs
    skip=false
    for ex in "${EXCLUDE[@]}"; do
        [[ "$name" == "$ex" ]] && skip=true && break
    done
    $skip && continue
    # Must have a plugin.json to count as a plugin
    [[ -f "$dir/.claude-plugin/plugin.json" ]] || continue
    filesystem_plugins+=("$name")
done

# Sort both arrays for comparison
fs_sorted=($(printf '%s\n' "${filesystem_plugins[@]}" | sort))
hc_sorted=($(printf '%s\n' "${HARDCODED[@]}" | sort))

fs_str="${fs_sorted[*]:-}"
hc_str="${hc_sorted[*]:-}"

if [[ "$fs_str" == "$hc_str" ]]; then
    exit 0
fi

echo "ERROR: PLUGINS array is out of sync with the filesystem." >&2
echo "" >&2

# On filesystem but not in hardcoded array
missing_from_array=()
for p in "${fs_sorted[@]}"; do
    found=false
    for h in "${hc_sorted[@]}"; do
        [[ "$p" == "$h" ]] && found=true && break
    done
    $found || missing_from_array+=("$p")
done

# In hardcoded array but not on filesystem
missing_from_fs=()
for h in "${hc_sorted[@]}"; do
    found=false
    for p in "${fs_sorted[@]}"; do
        [[ "$h" == "$p" ]] && found=true && break
    done
    $found || missing_from_fs+=("$h")
done

if [[ ${#missing_from_array[@]} -gt 0 ]]; then
    echo "  Plugins on filesystem but missing from PLUGINS array:" >&2
    for p in "${missing_from_array[@]}"; do
        echo "    + $p" >&2
    done
fi

if [[ ${#missing_from_fs[@]} -gt 0 ]]; then
    echo "  Plugins in PLUGINS array but not on filesystem (stale/retired):" >&2
    for p in "${missing_from_fs[@]}"; do
        echo "    - $p" >&2
    done
fi

echo "" >&2
echo "  Fix: update the PLUGINS array in bump-version.sh and reinstall-plugin.sh" >&2
echo "  Expected: ${fs_sorted[*]}" >&2

exit 1
