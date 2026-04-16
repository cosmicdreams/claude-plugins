---
name: drover:add-project
description: Register a Drupal/DDEV project with drover so it begins monitoring watchdog and web-container logs. On macOS opens a native folder picker; accepts a path argument on other platforms. Reads .ddev/config.yaml, drush aliases, and git remote automatically. Idempotent. Trigger phrases - "add a project to drover", "drover should watch this project", "register a new site with drover", "onboard a project to drover".
---

# drover:add-project

## What it does

Adds one Drupal/DDEV project to the list of projects drover monitors.
Once added, the umbrella monitor starts tailing `drush watchdog:tail`
and `ddev logs --service web` for that project on the next poll — no
`/reload-plugins` required.

Idempotent: re-adding the same path is a no-op.

## Procedure

### 1. Pick the project folder

On macOS:

```bash
PATH_ARG="$(osascript -e 'POSIX path of (choose folder with prompt "Pick the main folder of the project to add to drover")')"
```

If the user already passed an explicit path as argument, use that
instead of invoking the picker.

If the user cancels the picker (`osascript` exits non-zero), stop and
report that nothing was added.

### 2. Register it

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/add-project.sh" "$PATH_ARG"
```

The script emits one JSON object on stdout. Parse it and report:

- `"status":"added"` → "Added {name} at {path}. Drover will start watching within 30s."
- `"status":"exists"` → "{name} is already registered."
- `"status":"error"` → show the `message` field to the user and stop.

### 3. Confirm

List the currently-registered projects so the user sees the new state:

```bash
python3 <<'PY'
import json, os, pathlib
candidates = [
    os.environ.get("DROVER_PROJECTS_FILE", ""),
    os.path.join(os.environ.get("CLAUDE_PLUGIN_DATA", ""), "projects.json"),
    os.path.expanduser("~/.claude/plugins/data/drover/projects.json"),
]
for f in candidates:
    if f and pathlib.Path(f).exists():
        for e in json.load(open(f)):
            print(f"- {e['name']} ({e['path']})")
        break
else:
    print("No projects registered yet.")
PY
```

## Notes

- **State location**: `${CLAUDE_PLUGIN_DATA}/projects.json` — survives
  plugin updates.
- **Umbrella poll interval**: 30s by default. Override with
  `DROVER_UMBRELLA_POLL` env var.
- **To remove a project**: edit the JSON directly or (TODO) use
  `drover:remove-project` once that skill exists.
- **Requirements**: the chosen folder must contain `.ddev/config.yaml`.
  Drush aliases and git remote are optional enrichments.
