# Resolving Project Context

`~/.claude/drupal-lab.json` is an **optional enrichment registry**, not a
universal gate. Skills consult it when they need project-specific data the
repo can't supply on its own — DDEV prefix conventions, drupal.org
credentials for contrib MR push, opt-in scope for the branch-guard hook.

A skill that only needs git + JIRA + a Drupal-shaped repo (e.g.
`drupal-lab:sprint-start`) **must not** require registration. Detect
Drupal-ness from the repo itself.

## When to require registration

A skill legitimately requires `drupal-lab.json` registration only if it needs
one of these:

- `ddev_prefix` — to launch DDEV with the project's naming convention
- `drupal_org_username` / `gitlab_remote` — to push to drupal.org or post MR
  comments under the user's identity
- The branch-guard hook's opt-in scope — `cwd_patterns` tells the hook which
  directories to actively protect

If a skill needs **none** of the above, it must operate on Drupal-shape
detection alone (see below) and treat registration as best-effort enrichment.

## Detecting a Drupal repo (no registration required)

```bash
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[[ -z "$REPO_ROOT" ]] && { echo "Not a git repository."; exit 1; }

# composer.json declares drupal/core or drupal/core-recommended
grep -qE '"drupal/core(-recommended)?"' "$REPO_ROOT/composer.json" 2>/dev/null \
  || { echo "Not a Drupal project (composer.json missing drupal/core)."; exit 1; }

# docroot/ or web/ exists
[[ -d "$REPO_ROOT/docroot" || -d "$REPO_ROOT/web" ]] \
  || { echo "Not a Drupal project (no docroot/ or web/)."; exit 1; }
```

That is sufficient detection. If both checks pass, the cwd is a Drupal repo.

## Detecting worktree discipline

```bash
WORKTREE_PARENT=""
if [[ "$(basename "$(dirname "$REPO_ROOT")")" == "worktrees" ]]; then
  WORKTREE_PARENT="$(dirname "$REPO_ROOT")"
fi
```

If `WORKTREE_PARENT` is set, the repo uses worktree discipline. Skills that
create branches must use `git worktree add <WORKTREE_PARENT>/<slug> -b ...`
rather than `git checkout -B`, because the Golden Rule for these projects is
"never modify code in any working directory named `main` or with main
checked out."

## Resolving registration data (when needed)

For skills that DO need DDEV or drupal.org context:

1. **Check config exists**:
   ```bash
   cat ~/.claude/drupal-lab.json 2>/dev/null || echo "NOT_FOUND"
   ```
   If `NOT_FOUND` and the skill needs registered data: tell the user to run
   `drupal-lab:config` first, then stop.

2. **Match cwd to a project** — check whether the current working directory
   falls under any project's `cwd_patterns`. Use the first match.

3. **Fall back to default** — if no cwd match, use the project with
   `"default": true`.

4. **Use the resolved project's fields**:
   - `root` — the project root (contains `worktrees/`)
   - `ddev_prefix` — DDEV project name prefix (e.g. `drupal` → `drupal-3456789`)
   - `drupal_org_username` — for MR URLs and contribution comments (falls back
     to `drupal_org.username`)
   - `gitlab_remote` — git remote for pushing to Drupal.org (falls back to
     `drupal_org.gitlab_remote`)

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
