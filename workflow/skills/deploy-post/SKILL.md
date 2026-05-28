---
name: deploy-post
description: >
  Post a deployment checklist to Slack. Guides the user through three inputs — target channel,
  current production release, and the tag or branch being deployed — then renders the canonical
  checklist (every task starting at :rocket: pending) and posts it once via agent-slack.
  The user edits the emojis directly in Slack as the deployment proceeds; this skill does not
  track or update status.
  Use when the user says "post deployment checklist", "send deploy checklist", "deploy post",
  "announce a deployment", or "workflow:deploy-post".
  Do NOT use for reading Slack (use lib:slack) or for non-deployment posts.
triggers:
  - "workflow:deploy-post"
  - "post deployment checklist"
  - "deploy checklist"
  - "deploy post"
  - "deployment announcement"
allowed-tools: Bash, Read
---

# workflow:deploy-post — Slack Deployment Checklist

Post a single deployment checklist to Slack. The user edits the emojis in place as work proceeds —
this skill only creates the initial post.

## Inputs to collect

Ask the user for any not already provided:

1. **Channel** — where to post (e.g. `#deployments`).
2. **Current production release** — what is live on production now, being replaced (e.g. `tags/2026-04-16`).
3. **Deploying** — the tag or branch going out (e.g. `release/2026.05.28`).

The date is today's date — do not ask for it.

## Steps

1. **Verify auth.** Run `agent-slack auth whoami`. If it fails, see `references/ops.md`.

2. **Render the post.** Read `assets/checklist.tpl` and substitute:
   - `{DATE}` → today in `MM/DD/YYYY`
   - `{DEPLOYING}` → the tag/branch being deployed (appears in the header and the "Deploy staged code" line)
   - `{CURRENT}` → the current production release

3. **Confirm.** Show the rendered post to the user and confirm the channel before sending.

4. **Post it.**
   ```bash
   agent-slack message send '#<channel>' "<rendered post>"
   ```
   Add `--workspace <url>` only if the user has multiple workspaces (see `references/ops.md`).

5. **Done.** Tell the user the post is up and that they edit the `:rocket:` → `:loading:` → `:white_check_mark:` icons directly in Slack as the deployment progresses.

## Template

The canonical checklist lives in `assets/checklist.tpl`. Edit that file to change the task list —
do not hardcode tasks here.
