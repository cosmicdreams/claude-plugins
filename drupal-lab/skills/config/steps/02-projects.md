# Step 2 — Discover Drupal Projects

## Auto-discover candidates

Probe common locations for Drupal project roots (directories containing a `worktrees/` subdirectory):

```bash
# Common locations
for base in ~/OpenSource ~/Sites ~/Projects ~/Development; do
  find "$base" -maxdepth 2 -name "worktrees" -type d 2>/dev/null | sed 's|/worktrees||'
done

# Also check running DDEV projects for hints
ddev list 2>/dev/null | grep -v "^$" | tail -n +3 | awk '{print $1}'
```

Present any discovered candidates to the user and ask for confirmation.

## Ask about each project

For each candidate (and prompt for any not auto-discovered):

Ask: "For project at `<path>`, what alias should I use? (e.g. 'drupal-core', 'schusterman')"

Then ask: "What DDEV name prefix do you use for this project's worktrees?
The prefix appears in `config.local.yaml` — e.g. prefix 'drupal' produces names like
'drupal-3456789' for worktree 3456789. (default: the alias you just gave)"

Parse responses into project entries:

```json
{
  "alias": "drupal-core",
  "root": "/Users/you/OpenSource/DRUPAL",
  "cwd_patterns": ["/Users/you/OpenSource/DRUPAL"],
  "ddev_prefix": "drupal",
  "default": true
}
```

## Multiple projects

If more than one project is configured, ask which is the default:
"Which project is your primary one? (used when cwd doesn't match any pattern)"

Mark that project with `"default": true`.

## cwd_patterns

The `cwd_patterns` array is used by drupal-lab skills to infer which project is active
from the current working directory. Include the project root and any common sub-paths:

```json
"cwd_patterns": [
  "/Users/you/OpenSource/DRUPAL",
  "/Users/you/OpenSource/DRUPAL/worktrees"
]
```
