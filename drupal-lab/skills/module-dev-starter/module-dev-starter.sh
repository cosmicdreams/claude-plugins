#!/usr/bin/env bash
# module-dev-starter.sh — Drupal contrib module DDEV scaffold
# Usage: module-dev-starter.sh <target>
# Output: structured key=value lines + +created / =skipped lines
set -euo pipefail

TARGET="${1:?Usage: module-dev-starter.sh <target>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Resolve absolute path
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "ERROR: target does not exist: $TARGET" >&2; exit 1; }

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

# --- Detect module name ---
MODULE_NAME=""

# From composer.json: "name": "drupal/my_module" → my_module
COMPOSER="$TARGET/worktrees/main/composer.json"
if [ -z "$MODULE_NAME" ] && [ -f "$COMPOSER" ] && command -v python3 >/dev/null 2>&1; then
  MODULE_NAME=$(python3 -c "
import json, sys
d = json.load(open('$COMPOSER'))
n = d.get('name', '')
print(n.split('/')[-1] if '/' in n else n)
" 2>/dev/null || true)
fi

# From *.info.yml: my_module.info.yml → my_module
if [ -z "$MODULE_NAME" ]; then
  INFO=$(find "$TARGET/worktrees/main" -maxdepth 2 -name "*.info.yml" 2>/dev/null | head -1 || true)
  if [ -n "$INFO" ]; then
    MODULE_NAME=$(basename "$INFO" .info.yml)
  fi
fi

# Fallback: directory basename
if [ -z "$MODULE_NAME" ]; then
  MODULE_NAME=$(basename "$TARGET")
fi

echo "MODULE_STARTER_TARGET=$TARGET"
echo "MODULE_STARTER_MODULE=$MODULE_NAME"

# --- Drupal-specific directories ---
make_dir "analysis-reports/drupal-issue"
make_dir "tests"

# --- Append Drupal contrib section to CLAUDE.md ---
CLAUDE_MD="$TARGET/CLAUDE.md"
if grep -q "## Drupal Contrib Module" "$CLAUDE_MD" 2>/dev/null; then
  skipped+=("CLAUDE.md (Drupal section)")
else
  # Substitute MODULE_NAME and DDEV_NAME in template and append.
  # DDEV_NAME uses hyphens for DDEV compatibility.
  DDEV_NAME_TMPL="${MODULE_NAME//_/-}"
  sed -e "s/MODULE_NAME/$MODULE_NAME/g" -e "s/DDEV_NAME/$DDEV_NAME_TMPL/g" "$SCRIPT_DIR/drupal-section.md.tmpl" >> "$CLAUDE_MD"
  created+=("CLAUDE.md (Drupal section appended)")
fi

# --- Gate: validate worktrees/main/ ---
MAIN="$TARGET/worktrees/main"
DDEV_STATUS=""

if [ ! -d "$MAIN" ]; then
  DDEV_STATUS="skipped:no-worktree"
elif ! git -C "$MAIN" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  DDEV_STATUS="skipped:no-worktree"
elif [ ! -f "$MAIN/composer.json" ] && ! find "$MAIN" -maxdepth 2 -name "*.info.yml" 2>/dev/null | grep -q .; then
  DDEV_STATUS="skipped:no-worktree"
fi

if [ -z "$DDEV_STATUS" ]; then
  # --- Gate: prerequisites ---
  if ! command -v ddev >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    DDEV_STATUS="skipped:no-prerequisites"
  fi
fi

if [ -z "$DDEV_STATUS" ]; then
  # --- DDEV setup ---
  if [ -d "$MAIN/.ddev" ]; then
    DDEV_STATUS="already-exists"
    skipped+=(".ddev/ (already configured)")
  else
    cd "$MAIN"

    # Derive a DDEV-safe project name (hyphens, not underscores).
    DDEV_NAME="${MODULE_NAME//_/-}-main"

    # 6b: ddev config — always pass --project-name to avoid collisions.
    # The worktree directory is always "main", which collides with other
    # projects using the same worktree convention.
    ddev config --project-name="$DDEV_NAME" --project-type=drupal --docroot=web --php-version=8.3 --corepack-enable
    created+=(".ddev/ (ddev config, project=$DDEV_NAME)")

    # 6c: config.local.yaml — pin the project name so restarts are stable.
    LOCAL_YAML="$MAIN/.ddev/config.local.yaml"
    if [ ! -f "$LOCAL_YAML" ]; then
      printf 'name: %s\n' "$DDEV_NAME" > "$LOCAL_YAML"
      created+=(".ddev/config.local.yaml")
    else
      skipped+=(".ddev/config.local.yaml")
    fi

    # 6d: addons
    ddev add-on get ddev/ddev-drupal-contrib
    ddev add-on get ddev/ddev-selenium-standalone-chrome

    # 6e: start, then bootstrap inside the running container.
    # poser and symlink-project must run after ddev start so they execute
    # inside the container with the full PHP/composer environment.
    ddev start
    ddev poser
    ddev symlink-project

    # 6f: verify phpunit is available — poser should have installed it.
    if ! ddev exec which phpunit >/dev/null 2>&1; then
      echo "WARNING: phpunit not found after ddev poser. Running ddev poser again..."
      ddev poser
    fi

    DDEV_STATUS="configured"
  fi
fi

# --- settings.json: mark drupalScaffoldComplete ---
SETTINGS="$TARGET/.claude/settings.json"
mkdir -p "$TARGET/.claude"
python3 - "$SETTINGS" <<'EOF'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
s = json.loads(p.read_text()) if p.exists() else {}
s.setdefault("agentSquad", {})["drupalScaffoldComplete"] = True
p.write_text(json.dumps(s, indent=2) + "\n")
EOF
created+=(".claude/settings.json (drupalScaffoldComplete=true)")

echo "MODULE_STARTER_DDEV=$DDEV_STATUS"
echo ""

echo "Created:"
for f in "${created[@]}"; do echo "  + $f"; done

if [ ${#skipped[@]} -gt 0 ]; then
  echo ""
  echo "Skipped (already existed):"
  for f in "${skipped[@]}"; do echo "  = $f"; done
fi

# --- Human-readable hints for skipped DDEV ---
if [ "$DDEV_STATUS" = "skipped:no-worktree" ]; then
  echo ""
  echo "DDEV setup skipped: worktrees/main/ is not set up yet."
  echo ""
  echo "Clone your module there first:"
  echo ""
  echo "   git clone <your-module-repo-url> $TARGET/worktrees/main"
  echo ""
  echo "Then run /drupal-lab:module-dev-starter again to configure DDEV."
fi

if [ "$DDEV_STATUS" = "skipped:no-prerequisites" ]; then
  echo ""
  echo "DDEV setup skipped: prerequisites not met."
  echo ""
  echo "Required:"
  echo "- DDEV: https://ddev.readthedocs.io/en/stable/users/install/"
  echo "- Docker Desktop (must be running)"
  echo ""
  echo "Install these, then run /drupal-lab:module-dev-starter again."
fi
