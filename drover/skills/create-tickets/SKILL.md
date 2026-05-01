---
name: drover:create-tickets
description: >
  Read a drover sidecar JSON (one ticket spec per top issue from
  /drover:report) and create JIRA tickets — through the operator's
  preferred mechanism. Drover stays agnostic: it can drive Atlassian
  Cloud's REST API directly, OR emit a structured plan that an
  Atlassian MCP server / jira-cli / manual workflow can execute.
  Reads the project's manifest for JIRA project key, default sprint,
  default issue type. Pure stdlib — no jira-cli or PHP dependency.
  Trigger phrases — "create the JIRA tickets", "file these in JIRA",
  "make tickets from the report".
allowed-tools: Bash, Read, AskUserQuestion
---

# drover:create-tickets

## What it does

For each ticket spec in a drover sidecar JSON, prepares a JIRA issue
with the spec's title + description + labels + drover-suggested
priority (mapped to JIRA's standard priority names). Optionally
assigns each issue to a sprint and links it to a parent issue.

The sidecar comes from `/drover:report` when run with a stakeholder
template (`monthly-client`, `root-cause-summary`, `calendar-boundary`).

**Drover does not lock you into a single JIRA execution path.** It
offers three:

1. **Atlassian MCP** — if Claude has Atlassian's MCP server
   configured, Claude calls those tools directly. Drover hands off a
   structured plan; Claude reads it and invokes the matching MCP
   tools (`createIssue`, `assignSprint`, `addIssueLink`, etc.). No
   shared API token needed.
2. **Direct REST** — drover's built-in executor talks to
   `https://<instance>.atlassian.net` via the Cloud REST API. Needs
   `JIRA_API_TOKEN` in the env. Best for batch / scripted / cron
   workflows.
3. **jira-cli or manual** — drover writes the plan; the operator
   reviews it and runs the equivalent commands themselves (or pastes
   the description fields into JIRA's web UI). Best for cautious
   first-time runs.

## Step 0: Detect the operator's preferred execution path

Before doing anything, the agent should check what's available and
ask the operator which path to take:

```
Use AskUserQuestion:
  question: "How should we file these tickets in JIRA?"
  options:
    - "Atlassian MCP" (recommended if MCP tools are visible in this
      session — names matching mcp__*atlassian* or mcp__*jira*)
    - "Direct REST" (needs JIRA_API_TOKEN env var; runs the script's
      built-in executor)
    - "Plan only" (drover writes a plan file; operator runs the
      writes themselves — jira-cli, paste, etc.)
    - "Skip"
```

Detection hints for the agent:
- Atlassian MCP tools — look for tool names with `atlassian` or
  `jira` substrings in the active tools list.
- `JIRA_API_TOKEN` — `test -n "$JIRA_API_TOKEN" && echo present`.
- `~/.config/.jira/.config.yml` — jira-cli's config file; if present,
  drover can read server + email from it without setup.

## Prerequisites

```bash
test -f .drover/manifest.json \
  || { echo "Run /drover:init first."; exit 1; }
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

For paths 1 and 2 (MCP / Direct REST), you also need:
- `JIRA_API_TOKEN` env var (Direct REST only — MCP handles auth itself)
- Server + email from `~/.config/.jira/.config.yml` OR
  `manifest.jira.{server, email}` overrides

## Step 1: Resolve the plugin's create-tickets script

```bash
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/ 2>/dev/null | tail -1)
SCRIPT="${PLUGIN_ROOT}scripts/create_tickets.py"
test -f "$SCRIPT" || { echo "drover plugin not installed at $SCRIPT"; exit 1; }
```

## Step 2: Always preview first

```bash
python3 "$SCRIPT" --dry-run
```

Output shows which specs will be processed, what priority + labels
they'll carry, which sprint/parent linking will happen. No
side effects.

## Step 3a — Path 1: Atlassian MCP

Drover writes a plan file; the agent reads it and invokes the MCP
tools.

```bash
python3 "$SCRIPT" --plan reports/2026-04.plan.json
cat reports/2026-04.plan.json
```

Plan structure (stable schema, version 1):

```json
{
  "drover_plan_version": 1,
  "instance": {"server": "https://velir.atlassian.net"},
  "context": {
    "project_key": "PPS",
    "default_issue_type": "Chore",
    "default_sprint_id": 18347,
    "default_sprint_name": "2026.2",
    "default_parent_key": "PPS-327"
  },
  "tickets": [
    {
      "spec_fingerprint": "abc123def456",
      "issue": {
        "project_key": "PPS",
        "type": "Chore",
        "summary": "...",
        "description": "...",
        "priority": "High",
        "labels": [...]
      },
      "sprint": {"id": 18347, "name": "2026.2"},
      "parent": {"key": "PPS-327", "link_type": "Relates"}
    }
  ]
}
```

For each ticket the agent should:

1. Call the MCP equivalent of `createIssue` with fields from
   `tickets[i].issue`. Capture the returned `key`.
2. If `tickets[i].sprint` is present, call the MCP equivalent of
   sprint-assignment with the captured key + `sprint.id`.
3. If `tickets[i].parent` is present, call the MCP equivalent of
   add-issue-link from the captured key to `parent.key` with link
   type `Relates`.

The agent should write a results sidecar at `<plan>.created.json`
mirroring the direct-REST executor's output:

```json
[
  {"spec_fingerprint": "...", "key": "PPS-329",
   "url": "https://velir.atlassian.net/browse/PPS-329",
   "status": "created", "reason": null},
  ...
]
```

## Step 3b — Path 2: Direct REST

Drover's built-in executor.

```bash
# Create all (no per-ticket prompts) — uses JIRA_API_TOKEN
python3 "$SCRIPT" --all

# Interactive — prompt before each spec
python3 "$SCRIPT"

# Narrow with a regex match against spec title
python3 "$SCRIPT" --filter "simple_cron|cron"

# Override the manifest's default issue type / sprint / priority
python3 "$SCRIPT" --type Bug
python3 "$SCRIPT" --sprint 18347
python3 "$SCRIPT" --sprint none           # skip sprint assignment
python3 "$SCRIPT" --priority High         # override every spec

# Link each created issue to a parent (e.g. an Epic / Feature)
python3 "$SCRIPT" --parent PPS-327

# Use a specific sidecar (default: most recent reports/*.tickets.json)
python3 "$SCRIPT" --sidecar reports/2026-04-root-cause-summary.md.tickets.json
```

Direct REST writes a results sidecar at
`<input-sidecar>.created.json` automatically.

## Step 3c — Path 3: Plan-only / jira-cli / manual

For operators who want to review every command before it runs.

```bash
python3 "$SCRIPT" --plan reports/2026-04.plan.json
```

The plan JSON is human-readable and self-contained. The operator can:

- Translate each `tickets[i].issue` block into a `jira issue create`
  command, then add labels/priority/sprint per the same block.
- Paste each `summary` + `description` into JIRA's web UI manually.
- Pipe the plan into a custom script for special workflows.

## Failure modes

| Condition | Behavior |
|---|---|
| `JIRA_API_TOKEN` not set (Direct REST only) | Aborts with explicit instruction. |
| `~/.config/.jira/.config.yml` missing server/login | Aborts; tells you how to write minimal version. |
| Manifest has no `jira` block | Aborts; points at the manifest path. |
| Issue type invalid for project | JIRA returns 400; we surface the error and continue with remaining specs. |
| Sprint id wrong / inactive | Issue created OK; sprint-assign failure surfaces in `reason`. |
| Parent issue key invalid | Issue created OK; link failure surfaces in `reason`. |
| Auth fails (401) | Aborts immediately — no point trying others. |

Created issues stay created on partial failures. The results sidecar
makes it easy to audit and re-attempt sprint/parent linking
manually for any row in `create-failed` state.

## Why three paths instead of one

Different operators have different JIRA setups:

- **Some teams use Atlassian's official MCP server** so Claude can act
  on JIRA without a shared API token; auth is per-user and managed
  by the MCP layer.
- **Some operators have `JIRA_API_TOKEN` set up** for `jira-cli` or
  custom scripting; drover reuses it.
- **Some operators want to review every write** before it happens —
  the plan-only path lets them.

Drover writes a stable, versioned plan schema either way. The same
plan file can be replayed through any of the three executors,
which keeps drover honest: the *intent* is what's captured, not the
implementation.

## REST endpoints used (Direct REST path)

- `POST /rest/api/2/issue` — create
- `POST /rest/agile/1.0/sprint/{id}/issue` — assign sprint
- `POST /rest/api/2/issueLink` — parent / related links
- `GET /rest/api/2/myself` — auth smoke-test before any writes

For MCP and plan-only paths, drover does not call any endpoints; the
executor (Claude via MCP, or the operator) does.
