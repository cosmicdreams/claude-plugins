---
name: drover:create-tickets
description: >
  Read a drover sidecar JSON (one ticket spec per top issue from
  /drover:report) and create one JIRA issue per spec. Reads the
  project's manifest for JIRA project key, default sprint, default
  issue type. Pure stdlib — no jira-cli, no PHP, no third-party Python
  packages. Trigger phrases — "create the JIRA tickets", "file these
  in JIRA", "make tickets from the report".
allowed-tools: Bash, Read, AskUserQuestion
---

# drover:create-tickets

## What it does

For each ticket spec in a drover sidecar JSON, creates a JIRA issue
with the spec's title + description + labels + drover-suggested
priority (mapped to JIRA's standard priority names). Optionally
assigns each created issue to a sprint and links it to a parent
issue.

The sidecar comes from `/drover:report` when run with a stakeholder
template (`monthly-client`, `root-cause-summary`, `calendar-boundary`).
Each top issue → one ticket spec → one JIRA issue.

## Prerequisites

```bash
test -f .drover/manifest.json \
  || { echo "Run /drover:init first."; exit 1; }
test -n "$JIRA_API_TOKEN" \
  || { echo "Export JIRA_API_TOKEN (token from id.atlassian.com)."; exit 1; }
```

The skill reads JIRA server + email from `~/.config/.jira/.config.yml`
(jira-cli's standard config) when those aren't set in the manifest.
Most operators already have that file from running jira-cli once;
if not, write it manually:

```yaml
server: https://your-org.atlassian.net
login: you@example.com
```

The project's `.drover/manifest.json` must carry a `jira` block:

```json
"jira": {
  "project_key": "PPS",
  "board_id": 845,
  "default_sprint_id": 18347,
  "default_sprint_name": "2026.2",
  "default_issue_type": "Chore"
}
```

`/drover:init` writes this on a new project; for existing manifests,
hand-edit (one-time setup per project).

## Step 1: Resolve the plugin's create-tickets script

```bash
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/ 2>/dev/null | tail -1)
SCRIPT="${PLUGIN_ROOT}scripts/create_tickets.py"
test -f "$SCRIPT" || { echo "drover plugin not installed at $SCRIPT"; exit 1; }
```

## Step 2: Preview (dry run)

Always preview first.

```bash
python3 "$SCRIPT" --dry-run
```

The output shows which specs will be processed, what priority + labels
they'll carry, and which sprint/parent linking will happen. Nothing is
sent to JIRA.

## Step 3: Use AskUserQuestion to decide on the plan

After the dry-run, the agent (you, Claude) presents the operator with
options:

```
Use AskUserQuestion:
  question: "Create N JIRA tickets in <project_key>, sprint <name>?"
  options:
    - "Create all" — proceed with --all (no per-ticket prompts)
    - "Pick" — proceed interactive (prompt before each spec)
    - "Filter" — narrow with a regex first, then re-preview
    - "Edit sidecar" — open the sidecar JSON in $EDITOR; user adjusts;
      then re-preview
    - "Skip" — abort, leave sidecar in place
```

## Step 4: Run the create

```bash
# Create all (no per-ticket prompts)
python3 "$SCRIPT" --all

# Interactive — prompt before each spec
python3 "$SCRIPT"

# Narrow with a regex match against spec title
python3 "$SCRIPT" --filter "simple_cron|cron"

# Override the manifest's default issue type
python3 "$SCRIPT" --type Bug

# Override the manifest's default sprint
python3 "$SCRIPT" --sprint 18347
python3 "$SCRIPT" --sprint none           # skip sprint assignment

# Link each created issue to a parent (e.g. an Epic / Feature)
python3 "$SCRIPT" --parent PPS-327

# Use a specific sidecar (default: most recent reports/*.tickets.json)
python3 "$SCRIPT" --sidecar reports/2026-04-root-cause-summary.md.tickets.json
```

## Step 5: Inspect results

The script writes a results sidecar next to the input sidecar:

```
reports/<month>-<template>.md.tickets.json          # the input
reports/<month>-<template>.md.tickets.created.json  # created issues
```

The results JSON has one row per spec with `key`, `url`, `status`
(`created` | `skipped` | `create-failed`), and a `reason` field for
partial failures (e.g. issue created OK but sprint-assignment failed).

The terminal also prints a `+` per created issue with its URL.

## Failure modes

| Condition | Behavior |
|---|---|
| `JIRA_API_TOKEN` not set | Aborts with explicit instruction. |
| `~/.config/.jira/.config.yml` missing server/login | Aborts; tells you how to write minimal version. |
| Manifest has no `jira` block | Aborts; points at the manifest path. |
| Issue type invalid for project | JIRA returns 400; we surface the error and continue with remaining specs. |
| Sprint id wrong / inactive | Issue created OK; sprint-assign failure surfaces in `reason`. |
| Parent issue key invalid | Issue created OK; link failure surfaces in `reason`. |
| Auth fails (401) | Aborts immediately — no point trying others. |

Created issues stay created on partial failures. The results JSON
makes it easy to audit and re-attempt sprint/parent linking
manually for any row in `create-failed` state.

## Why pure-stdlib REST instead of jira-cli

`jira-cli` is configured with a single default project + board in
`~/.config/.jira/.config.yml`. Switching to a different Atlassian
project mid-session means swapping config files or fighting the `-p`
flag's incomplete project scoping (some commands respect it, some
don't). For a multi-client consultancy, drover would either need to
manage `JIRA_CONFIG_FILE` per project OR talk REST directly. The
REST path is simpler, has no install dependency, and avoids
modifying jira-cli's config.

The REST endpoints used:

- `POST /rest/api/2/issue` — create
- `POST /rest/agile/1.0/sprint/{id}/issue` — assign sprint
- `POST /rest/api/2/issueLink` — parent / related links
- `GET /rest/api/2/myself` — auth smoke-test before any writes
