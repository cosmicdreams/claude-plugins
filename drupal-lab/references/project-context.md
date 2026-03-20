# Resolving Project Context

All drupal-lab skills that reference a project root or DDEV prefix must resolve
context from `~/.claude/drupal-lab.json` rather than using hardcoded paths.

## Resolution steps

1. **Check config exists**:
   ```bash
   cat ~/.claude/drupal-lab.json 2>/dev/null || echo "NOT_FOUND"
   ```
   If `NOT_FOUND`: tell the user to run `drupal-lab:config` first, then stop.

2. **Match cwd to a project** — check whether the current working directory falls
   under any project's `cwd_patterns`. Use the first match.

3. **Fall back to default** — if no cwd match, use the project with `"default": true`.

4. **Use the resolved project's fields**:
   - `root` — the project root (contains `worktrees/`)
   - `ddev_prefix` — DDEV project name prefix (e.g. `drupal` → `drupal-3456789`)
   - `drupal_org_username` — for MR URLs and contribution comments (falls back to `drupal_org.username`)
   - `gitlab_remote` — git remote for pushing to Drupal.org (falls back to `drupal_org.gitlab_remote`)

## Example

Config:
```json
{
  "projects": [{ "alias": "drupal-core", "root": "/Users/cweber/OpenSource/DRUPAL",
    "cwd_patterns": ["/Users/cweber/OpenSource/DRUPAL"], "ddev_prefix": "drupal", "default": true }],
  "drupal_org": { "username": "cweber", "gitlab_remote": "origin" }
}
```

cwd = `/Users/cweber/OpenSource/DRUPAL/worktrees/3456789`
→ matches `cwd_patterns[0]`
→ `PROJECT_ROOT=/Users/cweber/OpenSource/DRUPAL`
→ `DDEV_PREFIX=drupal` → DDEV project name `drupal-3456789`

## Context Awareness note (replaces hardcoded example)

Skills that previously said:
> "All relative paths assume you are executing from the Project Root (e.g. `~/OpenSource/SAME_PAGE_PREVIEW`)"

Should instead resolve the project root from config as above. The resolved `root` is
the Project Root. All relative paths (`./worktrees/...`) are relative to it.
