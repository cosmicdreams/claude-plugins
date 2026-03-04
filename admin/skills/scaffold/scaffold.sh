#!/usr/bin/env bash
# scaffold.sh — Create project directory structure for sprint/admin work
# Usage: scaffold.sh <target> <project_name>
# Exit codes: 0=success, 1=bad args, 2=cannot create target dir
set -euo pipefail

TARGET="${1:?Usage: scaffold.sh <target> <project_name>}"
PROJECT_NAME="${2:?Usage: scaffold.sh <target> <project_name>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Resolve absolute path
TARGET="$(cd "$(dirname "$TARGET")" 2>/dev/null && pwd)/$(basename "$TARGET")" || true
mkdir -p "$TARGET" || { echo "ERROR: cannot create $TARGET" >&2; exit 2; }
TARGET="$(cd "$TARGET" && pwd)"

created=()
skipped=()

make_dir() {
  local d="$TARGET/$1"
  if [ -d "$d" ]; then
    skipped+=("$1/")
  else
    mkdir -p "$d"
    created+=("$1/")
  fi
}

write_file() {
  local dest="$TARGET/$1"
  local src="$2"
  local content="$3"
  if [ -f "$dest" ]; then
    skipped+=("$1")
  else
    mkdir -p "$(dirname "$dest")"
    if [ -n "$src" ] && [ -f "$src" ]; then
      sed "s/{{PROJECT_NAME}}/$PROJECT_NAME/g" "$src" > "$dest"
    else
      printf '%s' "$content" > "$dest"
    fi
    created+=("$1")
  fi
}

# --- Directories ---
make_dir ".claude/memory"
make_dir "analysis-reports/retro-session"
make_dir "kanban/sprint-run/1_backlog"
make_dir "kanban/sprint-run/2_analyzing"
make_dir "kanban/sprint-run/3_developing"
make_dir "kanban/sprint-run/4_needs-qa"
make_dir "kanban/sprint-run/5_validating"
make_dir "kanban/sprint-run/6_qa-failed"
make_dir "kanban/sprint-run/7_done"
make_dir "kanban/retrospective-actions/1_backlog"
make_dir "kanban/retrospective-actions/2_approved"
make_dir "kanban/retrospective-actions/3_in-progress"
make_dir "kanban/retrospective-actions/4_done"
make_dir "plans"
make_dir "worktrees"

# --- Files from templates ---
write_file "CLAUDE.md"          "$SCRIPT_DIR/CLAUDE.md.tmpl" ""
write_file ".claude/memory/MEMORY.md" "$SCRIPT_DIR/MEMORY.md.tmpl" ""

# --- settings.json: mark scaffold complete ---
SETTINGS="$TARGET/.claude/settings.json"
mkdir -p "$TARGET/.claude"
python3 - "$SETTINGS" <<'EOF'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
s = json.loads(p.read_text()) if p.exists() else {}
s.setdefault("agentSquad", {})["scaffoldComplete"] = True
p.write_text(json.dumps(s, indent=2) + "\n")
EOF
created+=(".claude/settings.json (scaffoldComplete=true)")

# --- Worktrees hint ---
worktrees_hint=""
if [ ! -d "$TARGET/worktrees/main" ]; then
  worktrees_hint="MISSING"
fi

# --- Report ---
echo "SCAFFOLD_TARGET=$TARGET"
echo "SCAFFOLD_PROJECT=$PROJECT_NAME"
echo "SCAFFOLD_WORKTREES_MAIN=${worktrees_hint:-present}"

echo ""
echo "Created:"
for f in "${created[@]}"; do echo "  + $f"; done

if [ ${#skipped[@]} -gt 0 ]; then
  echo ""
  echo "Skipped (already existed):"
  for f in "${skipped[@]}"; do echo "  = $f"; done
fi
