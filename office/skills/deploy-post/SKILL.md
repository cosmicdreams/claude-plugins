---
name: deploy-post
description: >
  Manage a live Slack deployment checklist: post the initial all-pending checklist, then update
  individual steps to in-progress or complete as the deployment proceeds.
  Use when the user says "post deployment checklist", "send deploy checklist", "init deploy post",
  "mark deploy step done", "start deploy step", "update deployment post", "office:deploy-post",
  or asks to track deployment progress in Slack.
  Takes a channel as the required first argument; release and prev-tag are named flags.
  Do NOT use for reading Slack messages (use office:slack); do NOT use for non-deployment posts.
triggers:
  - "office:deploy-post"
  - "post deployment checklist"
  - "deploy checklist"
  - "init deploy post"
  - "mark deploy step done"
  - "update deployment post"
  - "deployment announcement"
allowed-tools: Bash, Read
---

# office:deploy-post — Slack Deployment Checklist

Post and progressively update a deployment checklist in Slack. The checklist starts with all steps
pending, and you update individual steps to in-progress or done as the deployment proceeds.

## Step names

| Name | Description |
|---|---|
| `develop` | Tested on develop |
| `staging` | Tested on staging |
| `backup` | Back up database |
| `approved` | Launch approved |
| `precheck` | Pre-deployment check |
| `email` | Email sent to client |
| `maint-on` | Put site in maintenance mode |
| `deploy` | Deploy staged code |
| `search` | Rebuild search index |
| `testing` | Manual testing |
| `maint-off` | Take site out of maintenance mode |
| `uat` | User acceptance |
| `merge-main` | Merge to main |
| `merge-develop` | Merge to develop |

Aliases accepted: `maintenance-on`, `maintenance-off`, `manual-test`, `acceptance`, `merge_main`, `merge_develop`.
Prefix matching also works: `maint` → `maint-on` if unambiguous.

## Commands

### Post initial checklist (all pending)

```bash
SCRIPT="${CLAUDE_PLUGIN_ROOT}/skills/deploy-post/scripts/deploy-post.py"

python3 "$SCRIPT" init <channel> \
  --release release/2025.12.02-build \
  --prev-tag tags/2025-11-05
```

- `<channel>`: with or without `#`
- `--release`: release branch name (default: `release/TBD`)
- `--prev-tag` or `--prev_tag`: previous git tag (default: `tags/TBD`)
- `--workspace <url>`: Slack workspace URL (only needed if you have multiple workspaces)

On success, prints the message ts. The ts is stored in `~/.deploy-post-state.json` — all subsequent
`done` and `start` calls will edit the Slack post in-place.

### Mark a step complete

```bash
python3 "$SCRIPT" done <step>
```

Changes the step icon to `:white_check_mark:` and edits the live Slack post.

### Mark a step in progress

```bash
python3 "$SCRIPT" start <step>
```

Changes the step icon to `:loading:` and edits the live Slack post.

### Reset a step to pending

```bash
python3 "$SCRIPT" undo <step>
```

### Show current state in terminal

```bash
python3 "$SCRIPT" status
```

### Clear state (after deployment is complete)

```bash
python3 "$SCRIPT" reset
```

## Initial icon states

- All steps: `:white_square:` (pending)
- `uat`: `:rocket:` (pending — signals this is the final gate)

## Authentication

Before any operation, verify `agent-slack` is ready:

```bash
agent-slack auth whoami
```

If `agent-slack: command not found`:
> Install with: `npm i -g agent-slack`, then authenticate: `agent-slack auth import-desktop`

If auth fails:
> Run: `agent-slack auth import-desktop`

## Typical deployment flow

```
/office:deploy-post init #deployments --release release/2025.12.02-build --prev-tag tags/2025-11-05
/office:deploy-post start maint-on
/office:deploy-post done maint-on
/office:deploy-post start deploy
/office:deploy-post done deploy
/office:deploy-post done search
/office:deploy-post done testing
/office:deploy-post done maint-off
/office:deploy-post done uat
/office:deploy-post done merge-main
/office:deploy-post done merge-develop
/office:deploy-post reset
```

## State file

Stored at `~/.deploy-post-state.json`. Contains channel, release info, message ts, and per-step status.
If the ts is missing (e.g. was not captured after init), Slack edits will fail gracefully with a local-only update.
You can manually add the ts by finding the message in Slack (right-click → Copy link, extract the p-prefixed number).

## Error handling

| Error | Action |
|---|---|
| `command not found` | Prompt: `npm i -g agent-slack` |
| Auth error | Prompt: `agent-slack auth import-desktop` |
| Channel not found | Verify name; suggest `agent-slack channel list` |
| Edit fails (no ts) | Update state locally, warn user |
| Any other non-zero exit | Show stderr and stop |
