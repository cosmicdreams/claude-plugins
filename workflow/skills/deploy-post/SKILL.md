---
name: deploy-post
description: >
  Manage a live Slack deployment checklist: post the initial all-pending checklist, then update
  individual steps to in-progress or complete as the deployment proceeds.
  Use when the user says "post deployment checklist", "send deploy checklist", "init deploy post",
  "mark deploy step done", "start deploy step", "update deployment post", "workflow:deploy-post",
  or asks to track deployment progress in Slack.
  Takes a channel as the required first argument; release and prev-tag are named flags.
  Do NOT use for reading Slack messages (use lib:slack); do NOT use for non-deployment posts.
triggers:
  - "workflow:deploy-post"
  - "post deployment checklist"
  - "deploy checklist"
  - "init deploy post"
  - "mark deploy step done"
  - "update deployment post"
  - "deployment announcement"
allowed-tools: Bash, Read
---

# workflow:deploy-post — Slack Deployment Checklist

Post and progressively update a deployment checklist in Slack.

## Commands

```bash
SCRIPT="${CLAUDE_PLUGIN_ROOT}/skills/deploy-post/scripts/deploy-post.py"

# Post initial checklist (all pending)
python3 "$SCRIPT" init <channel> --release release/2025.12.02-build --prev-tag tags/2025-11-05

# Mark a step complete / in-progress / pending / show status / clear
python3 "$SCRIPT" done <step>
python3 "$SCRIPT" start <step>
python3 "$SCRIPT" undo <step>
python3 "$SCRIPT" status
python3 "$SCRIPT" reset
```

For step names and aliases, read `references/step-names.md`.
For auth setup, error handling, and state file details, read `references/ops.md`.

## Typical flow

```
init #deployments --release release/2025.12.02-build --prev-tag tags/2025-11-05
start maint-on → done maint-on → start deploy → done deploy
done search → done testing → done maint-off → done uat
done merge-main → done merge-develop → reset
```
