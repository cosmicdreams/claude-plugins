#!/usr/bin/env bash
# bump-version.sh — SemVer bump for CLAUDE-PLUGINS plugins
#
# Usage:
#   bump-version.sh <plugin> <bump-type>
#   bump-version.sh all <bump-type>
#
# Arguments:
#   plugin     — sprint | retro | ideate | admin | drupal-lab | all
#   bump-type  — major | minor | patch
#
# What it does:
#   1. Reads current version from <plugin>/.claude-plugin/plugin.json
#   2. Calculates new version per SemVer rules
#   3. Updates plugin.json
#   4. Replaces all hardcoded version references inside the plugin directory

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PLUGINS=(sprint retro ideate admin drupal-lab ideas-funnel lib workflow drover research-lab improve)

# Validate PLUGINS array matches the filesystem before doing any work.
"$REPO_ROOT/admin/scripts/validate-plugin-list.sh" "$REPO_ROOT" "${PLUGINS[@]}"

usage() {
    echo "Usage: $0 <plugin|all> <major|minor|patch>"
    echo ""
    echo "  Plugins: ${PLUGINS[*]}"
    echo "  Types:   major (breaking change), minor (new feature), patch (bug fix)"
    exit 1
}

semver_bump() {
    local version="$1"
    local bump_type="$2"

    local major minor patch
    IFS='.' read -r major minor patch <<< "$version"

    case "$bump_type" in
        major) major=$((major + 1)); minor=0; patch=0 ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        patch) patch=$((patch + 1)) ;;
        *) echo "Error: unknown bump type '$bump_type'" >&2; exit 1 ;;
    esac

    echo "${major}.${minor}.${patch}"
}

bump_plugin() {
    local plugin="$1"
    local bump_type="$2"
    local plugin_dir="$REPO_ROOT/$plugin"
    local json="$plugin_dir/.claude-plugin/plugin.json"

    if [[ ! -f "$json" ]]; then
        echo "Error: plugin.json not found at $json" >&2
        exit 1
    fi

    # Read current version (requires python3 or use sed/grep)
    local old_version
    old_version=$(python3 -c "import json,sys; print(json.load(open('$json'))['version'])")

    local new_version
    new_version=$(semver_bump "$old_version" "$bump_type")

    echo "[$plugin] $old_version → $new_version ($bump_type)"

    # Update plugin.json
    python3 - "$json" "$old_version" "$new_version" <<'PYEOF'
import json, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    data = json.load(f)
data['version'] = new
with open(path, 'w') as f:
    json.dump(data, f, indent=4)
    f.write('\n')
print(f"  Updated: {path}")
PYEOF

    # Replace all occurrences of the old version string inside the plugin directory
    # (covers hardcoded cache paths in SKILL.md, templates, .sh scripts, etc.)
    local changed_files=()
    while IFS= read -r -d '' file; do
        # Skip binary files, plugin.json (already updated), and CHANGELOG.md
        # (CHANGELOG history must be preserved; new entries are prepended by the skill, not the script)
        if [[ "$file" == "$json" ]] || [[ "$(basename "$file")" == "CHANGELOG.md" ]]; then
            continue
        fi
        if grep -qF "$old_version" "$file" 2>/dev/null; then
            sed -i '' "s|${old_version}|${new_version}|g" "$file"
            changed_files+=("  Updated: ${file#$REPO_ROOT/}")
        fi
    done < <(find "$plugin_dir" -type f \( \
        -name "*.md" -o -name "*.json" -o -name "*.sh" -o -name "*.txt" -o -name "*.yaml" \
    \) -print0)

    for f in "${changed_files[@]+"${changed_files[@]}"}"; do
        echo "$f"
    done

    # Strip any stray "version" field from this plugin's root marketplace entry.
    # Convention: marketplace.json entries carry no version — the installer reads
    # plugin.json. A stale version field here makes `claude plugin install` treat
    # the plugin as already-satisfied and skip the re-pull. Self-heal it on bump.
    local marketplace="$REPO_ROOT/.claude-plugin/marketplace.json"
    if [[ -f "$marketplace" ]]; then
        python3 - "$marketplace" "$plugin" <<'PYEOF'
import json, sys
path, plugin = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
changed = False
for entry in data.get('plugins', []):
    if entry.get('name') == plugin and 'version' in entry:
        entry.pop('version')
        changed = True
if changed:
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print("  Updated: .claude-plugin/marketplace.json (removed stray version field)")
PYEOF
    fi

    echo ""
    echo "  Next step: claude plugin install ${plugin}@local --scope user"
}

# --- Main ---

if [[ $# -ne 2 ]]; then
    usage
fi

PLUGIN="$1"
BUMP_TYPE="$2"

case "$BUMP_TYPE" in
    major|minor|patch) ;;
    *) echo "Error: bump type must be major, minor, or patch (got: $BUMP_TYPE)" >&2; usage ;;
esac

if [[ "$PLUGIN" == "all" ]]; then
    for p in "${PLUGINS[@]}"; do
        bump_plugin "$p" "$BUMP_TYPE"
    done
else
    # Validate plugin name
    valid=false
    for p in "${PLUGINS[@]}"; do
        [[ "$p" == "$PLUGIN" ]] && valid=true && break
    done
    if ! $valid; then
        echo "Error: unknown plugin '$PLUGIN'. Valid: ${PLUGINS[*]}" >&2
        usage
    fi
    bump_plugin "$PLUGIN" "$BUMP_TYPE"
fi
