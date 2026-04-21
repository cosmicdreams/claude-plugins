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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# Drush aliases + Acquia env discovery (optional, may not exist).
# For each drush/sites/<site>.site.yml, extract alias names and any
# Acquia env blocks that carry ac-site + ac-env keys. Those blocks
# become entries under acquia.environments[].alias, in the form
# "<ac-site>.<ac-env>", which is the argument `acli app:log:tail`
# accepts directly.
ALIASES_JSON="[]"
ACQUIA_JSON="[]"
if [ -d "$ABS_PATH/drush/sites" ]; then
  DISCOVERY="$(find "$ABS_PATH/drush/sites" -maxdepth 1 -name '*.site.yml' 2>/dev/null \
    | python3 -c '
import json, re, sys

aliases = []
acquia_envs = []
# Dedup envs by (ac-site, ac-env) across drush alias files — many projects
# have multiple alias files pointing at the same Acquia app/env, and
# without dedup the umbrella spawns N copies of the same watcher and the
# triage agent sees N-fold inflated occurrence counts.
seen_env_keys: set[tuple[str, str]] = set()
for path in (l.strip() for l in sys.stdin if l.strip()):
    site = path.rsplit("/", 1)[-1].replace(".site.yml", "")
    aliases.append(site)
    # Lightweight YAML parse: top-level keys are env blocks (e.g. "dev:", "prod:"),
    # each followed by indented key-value pairs including optional ac-site / ac-env.
    try:
        text = open(path).read()
    except Exception:
        continue
    current = None
    block = {}
    def flush():
        if current and "ac-site" in block and "ac-env" in block:
            ac_site = block["ac-site"]
            ac_env = block["ac-env"]
            key = (ac_site, ac_env)
            if key in seen_env_keys:
                # Second/nth alias file pointing at the same Acquia env.
                # Record the additional drush_alias on the existing entry
                # so we do not lose information, but skip the duplicate.
                for existing in acquia_envs:
                    if existing["alias"] == ac_site + "." + ac_env:
                        existing.setdefault("drush_aliases_all", [existing["drush_alias"]])
                        extra = "@" + site + "." + current
                        if extra not in existing["drush_aliases_all"]:
                            existing["drush_aliases_all"].append(extra)
                        break
                return
            seen_env_keys.add(key)
            acquia_envs.append({
                "alias": ac_site + "." + ac_env,
                "env": ac_env,
                "site": ac_site,
                "drush_alias": "@" + site + "." + current,
            })
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        m = re.match(r"^([A-Za-z0-9_-]+):\s*$", raw)
        if m:
            flush()
            current = m.group(1)
            block = {}
            continue
        m = re.match(r"^\s+([A-Za-z0-9_-]+):\s*(.*)$", raw)
        if m and current:
            key = m.group(1)
            val = m.group(2).strip().strip("\"\x27")
            if val:
                block[key] = val
    flush()
print(json.dumps({"aliases": aliases, "acquia": acquia_envs}))
')"
  ALIASES_JSON="$(echo "$DISCOVERY" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["aliases"]))')"
  ACQUIA_JSON="$(echo "$DISCOVERY" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["acquia"]))')"

  # Enrich Acquia envs with cached UUIDs if acli is available and we're
  # not running under a test (DROVER_SKIP_UUID_RESOLVE=1).
  if [ "$ACQUIA_JSON" != "[]" ] && [ -z "${DROVER_SKIP_UUID_RESOLVE:-}" ] \
     && command -v "${DROVER_ACLI:-acli}" >/dev/null 2>&1; then
    RESOLVER="${SCRIPT_DIR}/resolve-acquia-uuids.sh"
    if [ -x "$RESOLVER" ]; then
      ENRICHED="$(echo "$ACQUIA_JSON" | "$RESOLVER" 2>/dev/null || true)"
      [ -n "$ENRICHED" ] && ACQUIA_JSON="$ENRICHED"
    fi
  fi
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
  DROVER_ACQUIA="$ACQUIA_JSON" \
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
    "acquia": {"environments": json.loads(os.environ.get("DROVER_ACQUIA","[]") or "[]")},
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
