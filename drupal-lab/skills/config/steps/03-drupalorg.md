# Step 3 — Drupal.org and GitLab contribution access

Read `drupal-lab/references/drupalorg-cli.md`. Preserve existing username/remote settings. Determine each project's canonical Drupal machine name and upstream GitLab path, verifying actual remotes rather than assuming core.

Select the dedicated feature worktree whose DDEV environment will run the upstream tool. Check its repository, branch, sibling main and DDEV readiness; never install in a main reference checkout or borrow an unrelated project's runtime. Prepare it through the existing worktree/lifecycle skills when necessary.

Run the shared adapter's `install` operation with that explicit runtime worktree, then `doctor`. The installer pins/checksums the PHAR and ignores its local DDEV tooling directory. Record the returned container path and runtime worktree in `drupal_org.cli` or the project's `drupal_org_cli` override. The supported command list is a capability check, not evidence that private endpoints are accessible.

Reuse existing host/container `DRUPALORG_GITLAB_TOKEN` or host `glab` access for `git.drupalcode.org`. Credentials are transported through private temporary requests to the child environment, never saved in this config. Probe the requested read capability. Ask through the host's secret mechanism only when needed access is genuinely unavailable; do not echo tokens or dump environment settings. Anonymous discovery may work when discussion access does not.

Example non-secret configuration:

```json
{
  "drupal_org": {
    "username": "cweber",
    "gitlab_remote": "origin",
    "cli": {
      "runtime_worktree": "/absolute/project/worktrees/issue-topic",
      "phar": "/mnt/ddev_config/drupalorg/0.15.1/drupalorg.phar"
    }
  }
}
```

Per-project fields `upstream_project` and `drupal_org_cli` identify the source project and optional runtime override. Store the actual fork remote for the specific issue when known; an origin pointing at the main project is not necessarily a push destination. Authentication never grants permission to assign, label, comment, commit or push. Local DDEV/Drush tasks continue without these optional upstream settings.
