#!/usr/bin/env bash
# add-project.sh <absolute-path>
#
# Register a Drupal/DDEV project with drover. Idempotent.
#
# Reads:
#   <path>/.ddev/config.yaml     — ddev project name, type, docroot
#   <path>/drush/sites/*.site.yml — drush aliases (optional)
#   <path>/.git/config            — origin remote URL (optional)
#
# Writes:
#   $DROVER_PROJECTS_FILE (default: $CLAUDE_PLUGIN_DATA/projects.json)
#
# Emits one JSON object to stdout:
#   {"status":"added|exists|error","path":"...","name":"...","message":"..."}
#
# Exit codes:
#   0 — added or already-exists
#   1 — validation or write error

set -uo pipefail

PATH_ARG="${1:-}"
if [ -z "$PATH_ARG" ]; then
  echo '{"status":"error","message":"missing path argument"}'
  exit 1
fi

if [ ! -d "$PATH_ARG" ]; then
  echo "{\"status\":\"error\",\"path\":\"$PATH_ARG\",\"message\":\"not a directory\"}"
  exit 1
fi

ABS_PATH="$(cd "$PATH_ARG" && pwd)"
DDEV_CONFIG="$ABS_PATH/.ddev/config.yaml"

if [ ! -f "$DDEV_CONFIG" ]; then
  echo "{\"status\":\"error\",\"path\":\"$ABS_PATH\",\"message\":\"no .ddev/config.yaml\"}"
  exit 1
fi

# Parse minimal DDEV config without yq dependency.
DDEV_NAME="$(awk -F': *' '/^name: */ {print $2; exit}' "$DDEV_CONFIG" | tr -d '"' | tr -d "'")"
DDEV_TYPE="$(awk -F': *' '/^type: */ {print $2; exit}' "$DDEV_CONFIG" | tr -d '"' | tr -d "'")"
DDEV_DOCROOT="$(awk -F': *' '/^docroot: */ {print $2; exit}' "$DDEV_CONFIG" | tr -d '"' | tr -d "'")"

if [ -z "$DDEV_NAME" ]; then
  echo "{\"status\":\"error\",\"path\":\"$ABS_PATH\",\"message\":\"config.yaml missing name\"}"
  exit 1
fi

# Drush aliases (optional, may not exist).
ALIASES_JSON="[]"
if [ -d "$ABS_PATH/drush/sites" ]; then
  ALIASES_JSON="$(
    find "$ABS_PATH/drush/sites" -maxdepth 1 -name '*.site.yml' 2>/dev/null \
      | awk -F/ '{ gsub(/\.site\.yml$/,"",$NF); print $NF }' \
      | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))'
  )"
fi

# Git remote (optional).
GIT_REMOTE=""
if [ -f "$ABS_PATH/.git/config" ]; then
  GIT_REMOTE="$(awk '/\[remote "origin"\]/,/\[/{if(/url *=/){sub(/^[^=]*= */,""); print; exit}}' "$ABS_PATH/.git/config")"
fi

PROJECTS_FILE="${DROVER_PROJECTS_FILE:-${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugins/data/drover-fallback}/projects.json}"
mkdir -p "$(dirname "$PROJECTS_FILE")"
[ -f "$PROJECTS_FILE" ] || echo "[]" > "$PROJECTS_FILE"

# Atomic dedupe + append via Python (uses only stdlib).
RESULT="$(
  DROVER_PATH="$ABS_PATH" \
  DROVER_NAME="$DDEV_NAME" \
  DROVER_TYPE="$DDEV_TYPE" \
  DROVER_DOCROOT="$DDEV_DOCROOT" \
  DROVER_ALIASES="$ALIASES_JSON" \
  DROVER_GIT="$GIT_REMOTE" \
  DROVER_FILE="$PROJECTS_FILE" \
  python3 -c '
import json, os, sys, tempfile, datetime
path = os.environ["DROVER_PATH"]
name = os.environ["DROVER_NAME"]
file = os.environ["DROVER_FILE"]
try:
    data = json.load(open(file))
    if not isinstance(data, list):
        raise ValueError("projects file is not a list")
except Exception as e:
    print(json.dumps({"status":"error","path":path,"message":f"corrupt projects file: {e}"}))
    sys.exit(1)
for entry in data:
    if entry.get("path") == path:
        print(json.dumps({"status":"exists","path":path,"name":entry.get("name",name),"message":"already registered"}))
        sys.exit(0)
entry = {
    "name": name,
    "path": path,
    "ddev_project": name,
    "ddev_type": os.environ.get("DROVER_TYPE",""),
    "docroot": os.environ.get("DROVER_DOCROOT",""),
    "drush_aliases": json.loads(os.environ.get("DROVER_ALIASES","[]") or "[]"),
    "git_remote": os.environ.get("DROVER_GIT",""),
    "added": datetime.datetime.now(datetime.UTC).replace(microsecond=0).isoformat().replace("+00:00","Z"),
}
data.append(entry)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(file), prefix=".projects.", suffix=".json")
with os.fdopen(fd, "w") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, file)
print(json.dumps({"status":"added","path":path,"name":name,"message":"registered"}))
'
)"
rc=$?
echo "$RESULT"
exit "$rc"
