# Step 3 — Drupal.org Credentials

These are needed for MR submission and contribution comment generation.

## Username

Ask: "What is your Drupal.org username? (shown on your profile at drupal.org/u/...)"

This is used to:
- Generate MR URLs: `https://git.drupalcode.org/project/drupal/-/merge_requests`
- Pre-fill contribution comments in `drupal-lab:issue-summary`

## Git remote

Check the git remote in the main worktree of each configured project:

```bash
git -C <project_root>/worktrees/main remote -v 2>/dev/null | head -4
```

If the remote is `origin` pointing to `git.drupalcode.org` or `git.drupal.org` → use `origin`.

If the remote name differs, ask: "What git remote do you push to for Drupal.org? (default: origin)"

Store per-project if different, or as a global default if the same across projects.

## Result

```json
"drupal_org": {
  "username": "cweber",
  "gitlab_remote": "origin"
}
```

These fields can also be overridden per-project if needed:

```json
{
  "alias": "drupal-core",
  ...
  "drupal_org_username": "cweber",
  "gitlab_remote": "origin"
}
```
