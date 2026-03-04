#!/usr/bin/env bash
# read-changelog.sh — Read and optionally filter a plugin's CHANGELOG.md
#
# Usage: read-changelog.sh <plugin-name> <plugin-root> [filter]
#
# Arguments:
#   plugin-name  — display name, e.g. "admin"
#   plugin-root  — path to installed plugin root (e.g. $CLAUDE_PLUGIN_ROOT)
#   filter       — optional: "--latest", "--since X.Y.Z", or "X.Y.Z"
#
# Output: formatted changelog content, ready to print to the user
set -euo pipefail

PLUGIN_NAME="${1:?Usage: read-changelog.sh <plugin-name> <plugin-root> [filter]}"
PLUGIN_ROOT="${2:?Usage: read-changelog.sh <plugin-name> <plugin-root> [filter]}"
FILTER="${3:-}"

# Locate CHANGELOG
CHANGELOG="$PLUGIN_ROOT/CHANGELOG.md"
if [ ! -f "$CHANGELOG" ]; then
    # Fallback: repo source
    REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
    if [ -n "$REPO_ROOT" ]; then
        CHANGELOG="$REPO_ROOT/$PLUGIN_NAME/CHANGELOG.md"
    fi
fi

if [ ! -f "$CHANGELOG" ]; then
    echo "ERROR: CHANGELOG.md not found for $PLUGIN_NAME" >&2
    exit 1
fi

# Get installed version
INSTALLED=$(python3 -c "
import json, pathlib
p = pathlib.Path('$PLUGIN_ROOT/.claude-plugin/plugin.json')
print(json.loads(p.read_text())['version'] if p.exists() else 'unknown')
" 2>/dev/null || echo "unknown")

# Apply filter via python for reliable semver comparison
python3 - "$CHANGELOG" "$INSTALLED" "$PLUGIN_NAME" "$FILTER" <<'EOF'
import sys, re

changelog_path, installed, plugin_name, filter_arg = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
content = open(changelog_path).read()

# Split into version sections
section_re = re.compile(r'^## (\d+\.\d+\.\d+)', re.MULTILINE)
splits = list(section_re.finditer(content))

def version_tuple(v):
    return tuple(int(x) for x in v.split('.'))

if not filter_arg:
    label = f"{plugin_name} {installed} — release notes"
    print(label)
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
EOF
