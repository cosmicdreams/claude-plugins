#!/usr/bin/env bash
# scaffold-silence.sh — Set agentSquad.scaffoldDetect=false in .claude/settings.json
# Usage: scaffold-silence.sh <target-dir>
set -euo pipefail

TARGET="${1:?Usage: scaffold-silence.sh <target-dir>}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "ERROR: target does not exist: $TARGET" >&2; exit 1; }

mkdir -p "$TARGET/.claude"
SETTINGS="$TARGET/.claude/settings.json"

python3 - "$SETTINGS" <<'EOF'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
s = json.loads(p.read_text()) if p.exists() else {}
s.setdefault("agentSquad", {})["scaffoldDetect"] = False
p.write_text(json.dumps(s, indent=2) + "\n")
EOF

PROJECT_NAME="$(basename "$TARGET")"
echo "SILENCE_TARGET=$TARGET"
echo "SILENCE_PROJECT=$PROJECT_NAME"
