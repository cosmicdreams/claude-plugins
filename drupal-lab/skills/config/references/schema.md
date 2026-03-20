# drupal-lab.json Schema Reference

Full schema for `~/.claude/drupal-lab.json`.

```json
{
  "projects": [
    {
      "alias": "string",
      "root": "string (absolute path to project root containing worktrees/)",
      "cwd_patterns": ["string"],
      "ddev_prefix": "string (e.g. 'drupal' → ddev project 'drupal-3456789')",
      "drupal_org_username": "string (optional override, falls back to drupal_org.username)",
      "gitlab_remote": "string (optional override, falls back to drupal_org.gitlab_remote)",
      "default": true
    }
  ],
  "drupal_org": {
    "username": "string",
    "gitlab_remote": "string (default: 'origin')"
  }
}
```

## Resolution rules (for agent reasoning)

- **Active project**: match cwd against each project's `cwd_patterns`; if no match, use `default: true`
- **DDEV project name**: `{ddev_prefix}-{issue_number}` — set in worktree's `config.local.yaml`
- **Project root**: the directory containing `worktrees/`; all relative paths in skills are from here
- **MR URL pattern**: `https://git.drupalcode.org/project/drupal/-/merge_requests` (branch: `issue-{number}`)

## Example

```json
{
  "projects": [
    {
      "alias": "drupal-core",
      "root": "/Users/cweber/OpenSource/DRUPAL",
      "cwd_patterns": [
        "/Users/cweber/OpenSource/DRUPAL"
      ],
      "ddev_prefix": "drupal",
      "default": true
    }
  ],
  "drupal_org": {
    "username": "cweber",
    "gitlab_remote": "origin"
  }
}
```
