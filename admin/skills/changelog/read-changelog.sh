#!/usr/bin/env bash
# read-changelog.sh — Read and optionally filter any installed plugin's CHANGELOG.md
#
# Usage: read-changelog.sh <plugin-name> <admin-plugin-root> [filter]
#
# Arguments:
#   plugin-name        — target plugin, e.g. "sprint", "retro", "admin"
#   admin-plugin-root  — $CLAUDE_PLUGIN_ROOT from the admin skill context
#   filter             — optional: "--latest", "--since X.Y.Z", or "X.Y.Z"
#
# Plugin resolution: admin root is ~/.claude/plugins/cache/local/admin/<ver>/
# Other plugins live at   ~/.claude/plugins/cache/local/<plugin>/<ver>/
# The script derives the sibling cache root and picks the latest installed version.
set -euo pipefail

PLUGIN_NAME="${1:?Usage: read-changelog.sh <plugin-name> <admin-plugin-root> [filter]}"
ADMIN_PLUGIN_ROOT="${2:?Usage: read-changelog.sh <plugin-name> <admin-plugin-root> [filter]}"
FILTER="${3:-}"

# Derive the plugins cache root from admin's plugin root
# Pattern: <cache-root>/admin/<version>/ → <cache-root>/
PLUGINS_CACHE_ROOT="$(dirname "$(dirname "$ADMIN_PLUGIN_ROOT")")"

# Resolve target plugin's installed root (latest semver dir)
TARGET_CACHE="${PLUGINS_CACHE_ROOT}/${PLUGIN_NAME}"
if [ ! -d "$TARGET_CACHE" ]; then
    echo "ERROR: Plugin '$PLUGIN_NAME' not found." >&2
    echo "Available: $(ls "$PLUGINS_CACHE_ROOT" 2>/dev/null | sort | tr '\n' ' ')" >&2
    exit 1
fi

LATEST_VER=$(ls "$TARGET_CACHE" 2>/dev/null \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -t. -k1,1n -k2,2n -k3,3n \
    | tail -1)

if [ -z "$LATEST_VER" ]; then
    echo "ERROR: No installed version found for plugin '$PLUGIN_NAME' in $TARGET_CACHE" >&2
    exit 1
fi

TARGET_ROOT="${TARGET_CACHE}/${LATEST_VER}"

# Locate CHANGELOG
CHANGELOG="${TARGET_ROOT}/CHANGELOG.md"
if [ ! -f "$CHANGELOG" ]; then
    echo "ERROR: CHANGELOG.md not found for plugin '$PLUGIN_NAME' at $CHANGELOG" >&2
    exit 1
fi

# Get installed version from plugin.json (fall back to dir name)
INSTALLED=$(python3 -c "
import json, pathlib
p = pathlib.Path('${TARGET_ROOT}/.claude-plugin/plugin.json')
print(json.loads(p.read_text())['version'] if p.exists() else '${LATEST_VER}')
" 2>/dev/null || echo "$LATEST_VER")

# Apply filter via python for reliable semver comparison
python3 - "$CHANGELOG" "$INSTALLED" "$PLUGIN_NAME" "$FILTER" <<'PYEOF'
import sys, re

changelog_path, installed, plugin_name, filter_arg = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
content = open(changelog_path).read()

# Split into version sections
section_re = re.compile(r'^## (\d+\.\d+\.\d+)', re.MULTILINE)
splits = list(section_re.finditer(content))

def version_tuple(v):
    return tuple(int(x) for x in v.split('.'))

if not filter_arg:
    print(f"{plugin_name} {installed} — release notes")
    print()
    print(content.rstrip())

elif filter_arg == '--latest':
    if splits:
        start = splits[0].start()
        end = splits[1].start() if len(splits) > 1 else len(content)
        section = content[start:end].rstrip()
        ver = splits[0].group(1)
        print(f"{plugin_name} {installed} — release notes (latest: {ver})")
        print()
        print(section)
    else:
        print(f"{plugin_name} {installed} — release notes (no versions found)")

elif filter_arg.startswith('--since '):
    since_ver = filter_arg[len('--since '):]
    since_tuple = version_tuple(since_ver)
    sections = []
    for i, m in enumerate(splits):
        ver = m.group(1)
        if version_tuple(ver) > since_tuple:
            end = splits[i+1].start() if i+1 < len(splits) else len(content)
            sections.append(content[m.start():end].rstrip())
    print(f"{plugin_name} {installed} — release notes (since {since_ver})")
    print()
    if sections:
        print('\n\n'.join(sections))
    else:
        print(f"No versions after {since_ver}.")

else:
    # Specific version lookup
    target = filter_arg.strip()
    for i, m in enumerate(splits):
        if m.group(1) == target:
            end = splits[i+1].start() if i+1 < len(splits) else len(content)
            print(f"{plugin_name} {installed} — release notes ({target})")
            print()
            print(content[m.start():end].rstrip())
            sys.exit(0)
    print(f"{plugin_name} {installed} — release notes")
    print()
    print(f"Version {target} not found in CHANGELOG.")
PYEOF
